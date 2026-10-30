import { enqueueJob } from './outbox.js';
import { clanEmbed, CLAN_COLORS } from './theme.js';
import { PermissionFlagsBits } from 'discord.js';
import { config } from './config.js';
import { db, nextCaseId } from './db.js';
import { clip, formatDate, parseDuration } from './utils.js';
import { sendLog } from './logging.js';

export function isModerationStaff(member, action = 'warn') {
  if (!member) return false;
  if (member.roles?.cache?.has(config.roles.owner)) return true;
  if (config.moderatorRoleIds.some(id => member.roles?.cache?.has(id))) return true;
  const perms = member.permissions;
  if (action === 'ban') return Boolean(perms?.has(PermissionFlagsBits.BanMembers) || perms?.has(PermissionFlagsBits.Administrator));
  if (action === 'mute') return Boolean(perms?.has(PermissionFlagsBits.ModerateMembers) || perms?.has(PermissionFlagsBits.Administrator));
  return Boolean(perms?.has(PermissionFlagsBits.ModerateMembers) || perms?.has(PermissionFlagsBits.Administrator));
}
function protectedTarget(interaction, targetMember, userId) {
  return Boolean(userId === interaction.guild.ownerId || targetMember?.roles?.cache?.has(config.roles.owner) || (config.ownerUserId && userId === config.ownerUserId));
}
function canActOn(interaction, targetMember, userId) {
  if (protectedTarget(interaction, targetMember, userId)) throw new Error('This target is protected from bot moderation.');
  if (userId === interaction.user.id) throw new Error('You cannot use this action on yourself.');
  if (targetMember?.user?.bot) throw new Error('Bot accounts cannot be targeted by this command.');
  if (targetMember && interaction.user.id !== interaction.guild.ownerId && targetMember.roles?.highest && interaction.member?.roles?.highest && targetMember.roles.highest.comparePositionTo(interaction.member.roles.highest) >= 0) throw new Error('Your highest role must be above the target member role.');
  if (targetMember && !targetMember.moderatable && !targetMember.bannable) throw new Error('Discord role hierarchy prevents this action. Move the bot role higher.');
}
function buildCaseEmbed({ caseId, type, target, moderator, reason, durationMs, expiresAt }) {
  const labels = { BAN: 'Permanent Ban', TIMEOUT: 'Timeout', CLAN_WARNING: 'R3V0 Clan Warning' };
  const embed = clanEmbed('CLAN STAFF').setColor(type === 'BAN' ? CLAN_COLORS.danger : type === 'TIMEOUT' ? CLAN_COLORS.warning : CLAN_COLORS.info)
    .setTitle(`${labels[type] || type} • ${caseId}`)
    .setDescription(`An action has been recorded on your account in **${target.guild?.name || 'the R3V0 Discord server'}**.`)
    .addFields(
      { name: 'Action', value: labels[type] || type, inline: true },
      { name: 'Case ID', value: `\`${caseId}\``, inline: true },
      { name: 'Issued by', value: clip(moderator.tag || moderator.username, 100), inline: true },
      { name: 'Reason', value: clip(reason || 'No reason provided', 1000), inline: false },
      ...(durationMs ? [{ name: 'Duration', value: formatDuration(durationMs), inline: true }] : []),
      ...(expiresAt ? [{ name: 'Expires', value: `<t:${Math.floor(expiresAt / 1000)}:F>`, inline: true }] : []),
      { name: 'Appeal / support', value: 'If you believe this action was issued by mistake, open a support ticket with the Case ID. Do not send passwords, cookies or verification codes.', inline: false }
    ).setFooter({ text: 'R3V0 Moderation • Keep this Case ID for reference' }).setTimestamp(new Date());
  return embed;
}
function formatDuration(ms) {
  const units = [['d', 86400000], ['h', 3600000], ['m', 60000], ['s', 1000]];
  let left = ms; const parts = [];
  for (const [label, size] of units) { const n = Math.floor(left / size); if (n) { parts.push(`${n}${label}`); left %= size; } }
  return parts.join(' ') || '0s';
}
async function sendCaseLog(caseRow, targetUser, moderator, dmDelivered, extra = '') {
  const embed = clanEmbed('CLAN STAFF').setColor(caseRow.type === 'BAN' ? CLAN_COLORS.danger : caseRow.type === 'TIMEOUT' ? CLAN_COLORS.warning : CLAN_COLORS.info)
    .setTitle(`${caseRow.type} • ${caseRow.case_id}`)
    .addFields(
      { name: 'Target', value: `${clip(targetUser.tag || targetUser.username, 100)} (\`${targetUser.id}\`)`, inline: true },
      { name: 'Moderator', value: `${clip(moderator.tag || moderator.username, 100)} (\`${moderator.id}\`)`, inline: true },
      { name: 'DM delivered', value: dmDelivered ? 'Yes' : 'No — DMs closed or delivery failed', inline: true },
      { name: 'Reason', value: clip(caseRow.reason, 1000), inline: false },
      ...(caseRow.expires_at ? [{ name: 'Expires', value: `<t:${Math.floor(caseRow.expires_at / 1000)}:F>`, inline: true }] : []),
      ...(extra ? [{ name: 'Result', value: clip(extra, 500), inline: false }] : [])
    ).setTimestamp(new Date(caseRow.created_at));
  enqueueJob('message', `moderation-case:${caseRow.case_id}`, { title: `${caseRow.type} · ${caseRow.case_id}`, body: embed.toJSON().fields.map(field => `**${field.name}:** ${field.value}`).join('\n'), color: embed.toJSON().color, channelKind: 'moderation' });
}
function storeCase({ caseId, type, interaction, target, reason, expiresAt = null, dmDelivered = false }) {
  db.prepare(`INSERT INTO moderation_cases(case_id,type,guild_id,target_id,moderator_id,reason,created_at,expires_at,dm_delivered)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(caseId, type, interaction.guildId, target.id, interaction.user.id, clip(reason, 1000), Date.now(), expiresAt, dmDelivered ? 1 : 0);
  return db.prepare('SELECT * FROM moderation_cases WHERE case_id=?').get(caseId);
}
async function dmUser(target, embed) {
  try { await target.send({ embeds: [embed], allowedMentions: { parse: [] } }); return true; }
  catch { return false; }
}
export async function executeBan(interaction, targetUser, reason) {
  if (!isModerationStaff(interaction.member, 'ban')) throw new Error('You need the Owner role or Discord Ban Members permission to use this command.');
  const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  canActOn(interaction, target, targetUser.id);
  if (!target?.bannable) throw new Error('The bot cannot ban this member. Check Ban Members permission and role hierarchy.');
  const caseId = nextCaseId('BAN');
  const dummy = { guild: interaction.guild };
  const dmDelivered = await dmUser(targetUser, buildCaseEmbed({ caseId, type: 'BAN', target: dummy, moderator: interaction.user, reason }));
  try { await interaction.guild.members.ban(targetUser.id, { reason: `${caseId} | ${clip(reason, 400)}` }); }
  catch (error) {
    if (dmDelivered) await dmUser(targetUser, clanEmbed('CLAN STAFF').setColor(CLAN_COLORS.danger).setTitle(`Update for ${caseId}`).setDescription('The ban could not be completed. Please contact server support if you received an earlier notice.').setTimestamp(new Date())).catch(() => {});
    throw new Error(`Discord rejected the ban: ${error.message}`);
  }
  const row = storeCase({ caseId, type: 'BAN', interaction, target: targetUser, reason, dmDelivered });
  await sendCaseLog(row, targetUser, interaction.user, dmDelivered, 'Ban completed');
  return `Ban completed. Case ID: **${caseId}**. DM ${dmDelivered ? 'delivered' : 'could not be delivered'}.`;
}
export async function executeTimeout(interaction, targetUser, durationInput, reason) {
  if (!isModerationStaff(interaction.member, 'mute')) throw new Error('You need the Owner role or Discord Moderate Members permission to use this command.');
  const durationMs = parseDuration(durationInput, 28 * 24 * 60 * 60 * 1000);
  const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!target) throw new Error('The user must be a member of this server to receive a timeout.');
  canActOn(interaction, target, targetUser.id);
  if (!target.moderatable) throw new Error('The bot cannot timeout this member. Check Moderate Members permission and role hierarchy.');
  const caseId = nextCaseId('TIMEOUT');
  const expiresAt = Date.now() + durationMs;
  const dmDelivered = await dmUser(targetUser, buildCaseEmbed({ caseId, type: 'TIMEOUT', target: { guild: interaction.guild }, moderator: interaction.user, reason, durationMs, expiresAt }));
  try { await target.timeout(durationMs, `${caseId} | ${clip(reason, 400)}`); }
  catch (error) {
    if (dmDelivered) await dmUser(targetUser, clanEmbed('CLAN STAFF').setColor(CLAN_COLORS.warning).setTitle(`Update for ${caseId}`).setDescription('The timeout could not be applied. Contact server support if you received an earlier notice.').setTimestamp(new Date())).catch(() => {});
    throw new Error(`Discord rejected the timeout: ${error.message}`);
  }
  const row = storeCase({ caseId, type: 'TIMEOUT', interaction, target: targetUser, reason, expiresAt, dmDelivered });
  await sendCaseLog(row, targetUser, interaction.user, dmDelivered, `Timeout applied for ${formatDuration(durationMs)}`);
  return `Timeout applied for **${formatDuration(durationMs)}**. Case ID: **${caseId}**. DM ${dmDelivered ? 'delivered' : 'could not be delivered'}.`;
}
export async function executeClanWarning(interaction, targetUser, robloxName, reason) {
  if (!isModerationStaff(interaction.member, 'warn')) throw new Error('You need the Owner role or Discord Moderate Members permission to use this command.');
  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  canActOn(interaction, targetMember, targetUser.id);
  const caseId = nextCaseId('CLAN_WARNING');
  const embed = clanEmbed('CLAN STAFF').setColor(CLAN_COLORS.warning).setTitle(`R3V0 Clan Activity Warning • ${caseId}`)
    .setDescription(`Hi ${targetUser.username}, this is an official activity warning from the **R3V0 clan team**.`)
    .addFields(
      { name: 'Reason', value: clip(reason, 1000), inline: false },
      { name: 'Roblox account', value: clip(robloxName || 'Not specified', 100), inline: true },
      { name: 'Issued by', value: clip(interaction.user.tag || interaction.user.username, 100), inline: true },
      { name: 'What you need to do', value: 'Please improve your activity and contribute to the current clan battle where possible. If activity does not improve, clan leadership may remove you from R3V0.', inline: false },
      { name: 'Case ID', value: `\`${caseId}\``, inline: true },
      { name: 'Support', value: 'Reply to the staff team through a support ticket if you believe this warning is incorrect.', inline: false }
    ).setFooter({ text: 'R3V0 Clan Team • Keep this message for reference' }).setTimestamp(new Date());
  const dmDelivered = await dmUser(targetUser, embed);
  const row = storeCase({ caseId, type: 'CLAN_WARNING', interaction, target: targetUser, reason, dmDelivered });
  await sendCaseLog(row, targetUser, interaction.user, dmDelivered, 'Clan activity warning issued');
  return `Clan warning recorded as **${caseId}**. DM ${dmDelivered ? 'delivered' : 'could not be delivered'}.`;
}
export function getCase(caseId) {
  return db.prepare('SELECT * FROM moderation_cases WHERE case_id=?').get(String(caseId).trim().toUpperCase()) || null;
}
