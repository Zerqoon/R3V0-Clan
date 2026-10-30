import { clanEmbed, CLAN_COLORS } from './theme.js';
import { config } from './config.js';
import { db } from './db.js';
import { sendLog } from './logging.js';
import { clip } from './utils.js';

const PREFIX = 'R3V0 | ';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Prefix the Discord nickname only while the member has the R3V0 clan role.
 * The Discord nickname limit is 32 characters; existing prefixes are removed
 * before applying the current state so a repeated role update never doubles it.
 */
export function applyClanNickPrefix(currentNickname, username, hasClanRole) {
  const original = String(currentNickname ?? '').trim();
  const fallback = String(username ?? 'Member').trim() || 'Member';
  const base = original.replace(/^R3V0\s*\|\s*/i, '').trim() || fallback;
  const desired = hasClanRole ? `${PREFIX}${base}` : base;
  return desired.slice(0, 32);
}
let queueRunning = false;
let retryTimer = null;
export function queueRoleAssignment(guildId, userId, roleId, nextRetryAt = Date.now()) {
  db.prepare(`INSERT INTO autorole_jobs(guild_id,user_id,role_id,attempts,next_retry_at,last_error) VALUES(?,?,?,0,?, '')
    ON CONFLICT(guild_id,user_id,role_id) DO UPDATE SET next_retry_at=MIN(autorole_jobs.next_retry_at, excluded.next_retry_at)`)
    .run(String(guildId), String(userId), String(roleId), Number(nextRetryAt));
}
function failRoleJob(job, error) {
  const attempts = Number(job.attempts || 0) + 1;
  const delay = Math.min(60 * 60 * 1000, 60 * 1000 * (2 ** Math.min(attempts, 6)));
  db.prepare(`UPDATE autorole_jobs SET attempts=?, next_retry_at=?, last_error=? WHERE guild_id=? AND user_id=? AND role_id=?`)
    .run(attempts, Date.now() + delay, String(error?.message || error).slice(0, 500), job.guild_id, job.user_id, job.role_id);
  console.warn(`[autorole] Assignment failed for member ${job.user_id}, role ${job.role_id}; retry ${attempts} in ${Math.round(delay / 60000)} min: ${error?.message || error}`);
}
export async function processRoleJobs(client, limit = 30) {
  if (queueRunning) return 0;
  queueRunning = true;
  let processed = 0;
  try {
    const rows = db.prepare(`SELECT guild_id,user_id,role_id,attempts,next_retry_at FROM autorole_jobs WHERE next_retry_at<=? ORDER BY attempts ASC,next_retry_at ASC LIMIT ?`).all(Date.now(), Math.max(1, Math.min(100, Number(limit) || 30)));
    for (const job of rows) {
      const guild = client.guilds.cache.get(job.guild_id);
      if (!guild) { failRoleJob(job, new Error('Configured guild is not available yet')); continue; }
      const member = guild.members.cache.get(job.user_id) || await guild.members.fetch(job.user_id).catch(() => null);
      if (!member) { db.prepare('DELETE FROM autorole_jobs WHERE guild_id=? AND user_id=? AND role_id=?').run(job.guild_id, job.user_id, job.role_id); continue; }
      const role = guild.roles.cache.get(job.role_id) || await guild.roles.fetch(job.role_id).catch(() => null);
      if (!role) { failRoleJob(job, new Error('Configured role is missing')); continue; }
      if (member.roles.cache.has(role.id)) { db.prepare('DELETE FROM autorole_jobs WHERE guild_id=? AND user_id=? AND role_id=?').run(job.guild_id, job.user_id, job.role_id); continue; }
      try {
        await member.roles.add(role, 'R3V0 community auto-role');
        db.prepare('DELETE FROM autorole_jobs WHERE guild_id=? AND user_id=? AND role_id=?').run(job.guild_id, job.user_id, job.role_id);
        processed++;
      } catch (error) { failRoleJob(job, error); }
      await sleep(100);
    }
  } finally { queueRunning = false; }
  return processed;
}
async function updateClanNickname(member) {
  const hasClanRole = member.roles.cache.has(config.roles.clan);
  const existing = member.nickname || member.user.username;
  const desired = applyClanNickPrefix(existing, member.user.username, hasClanRole);
  if (existing === desired || !member.manageable) return;
  await member.setNickname(desired, hasClanRole ? 'R3V0 clan role added' : 'R3V0 clan role removed').catch(error => {
    console.warn(`[roles] Could not update nickname for ${member.id}: ${error.message}`);
  });
}
export async function grantCommunityRole(member) {
  if (!member?.guild || member.guild.id !== config.guildId || member.user.bot) return;
  const role = member.guild.roles.cache.get(config.roles.community) || await member.guild.roles.fetch(config.roles.community).catch(() => null);
  if (!role) {
    queueRoleAssignment(member.guild.id, member.id, config.roles.community);
    console.warn(`[autorole] Community role ${config.roles.community} not found; saved a retry job.`);
    return;
  }
  if (member.roles.cache.has(role.id)) return;
  try { await member.roles.add(role, 'Community auto-role'); }
  catch (error) {
    queueRoleAssignment(member.guild.id, member.id, role.id);
    const row = db.prepare('SELECT guild_id,user_id,role_id,attempts,next_retry_at FROM autorole_jobs WHERE guild_id=? AND user_id=? AND role_id=?').get(member.guild.id, member.id, role.id);
    if (row) failRoleJob(row, error);
  }
}
export async function syncExistingMembers(client) {
  const guild = client.guilds.cache.get(config.guildId) || await client.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) throw new Error(`R3V0 Discord server ${config.guildId} is not accessible.`);
  const role = guild.roles.cache.get(config.roles.community) || await guild.roles.fetch(config.roles.community).catch(() => null);
  if (!role) throw new Error(`Community auto-role ${config.roles.community} is missing.`);
  const members = await guild.members.fetch();
  let queued = 0;
  for (const member of members.values()) {
    if (member.user.bot) continue;
    if (!member.roles.cache.has(role.id)) { queueRoleAssignment(guild.id, member.id, role.id); queued++; }
    if (member.roles.cache.has(config.roles.clan)) await updateClanNickname(member);
  }
  console.log(`[autorole] Scanned ${members.size} members; saved ${queued} community-role jobs.`);
  const processed = await processRoleJobs(client, 100);
  console.log(`[autorole] Applied ${processed} queued role assignments; failures remain in persistent retry queue.`);
  return { total: members.size, queued, processed };
}
export function startAutoRoleWorker(client) {
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = setInterval(() => { void processRoleJobs(client, 30).catch(error => console.error(`[autorole] Retry worker failed: ${error.stack || error.message}`)); }, 60_000);
  retryTimer.unref?.();
  return () => { if (retryTimer) clearInterval(retryTimer); retryTimer = null; };
}
export async function handleRoleChanges(oldMember, newMember) {
  if (newMember.guild.id !== config.guildId || newMember.user.bot) return;
  const oldRoleIds = new Set(oldMember.roles.cache.keys());
  const newRoleIds = new Set(newMember.roles.cache.keys());
  const added = [...newRoleIds].filter(id => !oldRoleIds.has(id));
  const removed = [...oldRoleIds].filter(id => !newRoleIds.has(id));
  if (added.includes(config.roles.clan) || removed.includes(config.roles.clan) || oldMember.nickname !== newMember.nickname || oldMember.user.username !== newMember.user.username) await updateClanNickname(newMember);
  if (added.length === 1 && added[0] === config.roles.community && removed.length === 0) return; // Don't flood audit logs during community-role backfill.
  if (added.length || removed.length || oldMember.nickname !== newMember.nickname || oldMember.user.avatar !== newMember.user.avatar) {
    const roleText = [...added.map(id => `+ <@&${id}>`), ...removed.map(id => `- <@&${id}>`)].join('\n') || 'No role changes';
    await sendLog('audit', { embeds: [{ author: { name: 'R3V0 / CLAN ACTIVITY' }, footer: { text: 'R3V0 CLAN / STAFF RECORDS' }, color: CLAN_COLORS.info, title: 'Member Updated', description: `**Member:** ${newMember.user.tag} (\`${newMember.id}\`)\n**Nickname:** ${clip(oldMember.nickname || oldMember.user.username, 80)} → ${clip(newMember.nickname || newMember.user.username, 80)}\n**Avatar changed:** ${oldMember.user.avatar !== newMember.user.avatar ? 'Yes' : 'No'}\n**Roles:**\n${roleText}`, timestamp: new Date().toISOString() }], allowedMentions: { parse: [] } }).catch(error => console.warn(`[audit] Member update log failed: ${error.message}`));
  }
}
export async function handleNewMember(member, renderWelcome, sendLog) {
  if (member.guild.id !== config.guildId || member.user.bot) return;
  await grantCommunityRole(member);
  try {
    const count = member.guild.memberCount;
    const image = await renderWelcome(member, count);
    const channel = member.client.channels.cache.get(config.channels.welcome) || await member.client.channels.fetch(config.channels.welcome).catch(() => null);
    if (channel?.isTextBased?.()) {
      const { AttachmentBuilder } = await import('discord.js');
      const attachment = new AttachmentBuilder(image, { name: 'r3v0-welcome.png' });
      const embed = clanEmbed('CLAN COMMUNITY').setColor(CLAN_COLORS.accent).setTitle('Welcome to R3V0!')
        .setDescription(`Welcome ${member}. Make yourself at home in the **R3V0** community.\n\n**Clan code** <#${config.channels.rules}>  ·  **Recruitment** <#${config.channels.ticketPanel}>`)
        .setImage('attachment://r3v0-welcome.png').setTimestamp(new Date());
      await channel.send({ embeds: [embed], files: [attachment], allowedMentions: { users: [member.id] } });
    }
  } catch (error) { console.error(`[welcome] Failed to create/send welcome card: ${error.stack || error.message}`); }
}
