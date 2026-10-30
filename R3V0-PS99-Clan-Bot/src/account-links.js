import crypto from 'node:crypto';
import { ButtonBuilder, ButtonStyle } from 'discord.js';
import { db, transaction } from './db.js';
import { requestJson } from './api-client.js';
import { getRobloxUserByUsername } from './ps99.js';
import { card, text, divider, row, button, v2, form } from './ui.js';
import { escapeMarkdown } from './utils.js';
import { enqueueJob } from './outbox.js';
import { config } from './config.js';

export function getAccountLink(guildId, discordId) {
  return db.prepare('SELECT guild_id AS guildId,discord_id AS discordId,roblox_id AS robloxId,username,verified_at AS verifiedAt FROM account_links WHERE guild_id=? AND discord_id=?').get(String(guildId), String(discordId)) || null;
}
export async function getRobloxProfile(userId) {
  const id = String(userId);
  if (!/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Enter a valid Roblox user ID.');
  // Ownership checks deliberately bypass cached descriptions and never use a cookie.
  const profile = await requestJson(`https://users.roblox.com/v1/users/${id}`, { ttlMs: 0, retries: 1 });
  if (String(profile?.id) !== id || typeof profile.description !== 'string') throw new Error('Roblox did not return a readable public profile. Try again later.');
  if (profile.isBanned) throw new Error('This Roblox account is currently unavailable.');
  return profile;
}
export async function resolveRobloxAccount(value) {
  const input = String(value || '').trim().replace(/^@/, '');
  const match = input.match(/^https:\/\/(?:www\.)?roblox\.com\/users\/([1-9]\d{0,15})\/profile\/?(?:\?.*)?$/i);
  const id = match?.[1] || (/^[1-9]\d{0,15}$/.test(input) ? input : null);
  if (id) return getRobloxProfile(id);
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(input)) throw new Error('Use your exact Roblox username, numeric ID, or Roblox profile link.');
  const user = await getRobloxUserByUsername(input);
  if (!user?.id) throw new Error('This Roblox username was not found. Display names are not unique; use the username.');
  return getRobloxProfile(String(user.id));
}
export function accountLinkModal() {
  return form('account:link-submit', 'Connect your Roblox account', [{ id: 'roblox', label: 'Roblox username, user ID or profile link', max: 150, placeholder: 'Your exact Roblox username' }]);
}
export async function beginAccountLink(guildId, discordId, value, { now = Date.now(), resolve = resolveRobloxAccount } = {}) {
  if (getAccountLink(guildId, discordId)) throw new Error('You already have a connected account. Use /unlink before changing it.');
  const previous = db.prepare('SELECT expires_at FROM link_challenges WHERE guild_id=? AND discord_id=?').get(guildId, discordId);
  if (previous?.expires_at > now + 19 * 60_000) throw new Error('A code was just created. Use the existing code, or wait one minute before replacing it.');
  const user = await resolve(value);
  const robloxId = String(user.id);
  if (db.prepare('SELECT 1 FROM account_links WHERE guild_id=? AND roblox_id=?').get(guildId, robloxId)) throw new Error('This Roblox account is already connected to a Discord member. Contact staff if it belongs to you.');
  const code = `R3V0-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
  const expiresAt = now + 20 * 60_000;
  // Recheck after the asynchronous lookup so an already verified link cannot be replaced.
  transaction(() => {
    if (getAccountLink(guildId, discordId)) throw new Error('Your account has already been connected.');
    db.prepare('INSERT INTO link_challenges(guild_id,discord_id,roblox_id,username,code,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(guild_id,discord_id) DO UPDATE SET roblox_id=excluded.roblox_id,username=excluded.username,code=excluded.code,expires_at=excluded.expires_at,last_check_at=0').run(guildId, discordId, robloxId, String(user.name), code, expiresAt);
  });
  return { guildId, discordId, robloxId, username: String(user.name), code, expiresAt };
}
export function buildLinkChallengePayload(challenge) {
  const container = card('🔗 CONNECT YOUR ROBLOX ACCOUNT', `**${escapeMarkdown(challenge.username, 30)}** · Roblox ID \`${challenge.robloxId}\``)
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(`**1.** Open your Roblox profile and edit **About / Description**.\n**2.** Paste this entire code and save your profile:\n\n\`${challenge.code}\`\n\n**3.** Click **Verify code** below.\n\nCode expires <t:${Math.floor(challenge.expiresAt / 1000)}:R>. After verification you can remove it.`))
    .addActionRowComponents(row(new ButtonBuilder().setLabel('Open Roblox profile').setStyle(ButtonStyle.Link).setURL(`https://www.roblox.com/users/${challenge.robloxId}/profile`), button('account:verify', 'Verify code', ButtonStyle.Success), button('account:cancel', 'Cancel')))
    .addTextDisplayComponents(text('-# Only a public profile code is needed. Keep your password and Roblox cookie private.'));
  return v2(container);
}
export async function verifyAccountLink(guildId, discordId, { now = Date.now(), fetchProfile = getRobloxProfile } = {}) {
  const challenge = db.prepare('SELECT * FROM link_challenges WHERE guild_id=? AND discord_id=?').get(guildId, discordId);
  if (!challenge || challenge.expires_at <= now) throw new Error('Your code has expired. Run /link to create a new one.');
  if (challenge.last_check_at && now - challenge.last_check_at < 5000) throw new Error('Wait five seconds before checking the profile again.');
  const claimed = db.prepare('UPDATE link_challenges SET last_check_at=? WHERE guild_id=? AND discord_id=? AND code=? AND last_check_at=?').run(now, guildId, discordId, challenge.code, challenge.last_check_at);
  if (!claimed.changes) throw new Error('A verification is already running.');
  const profile = await fetchProfile(challenge.roblox_id);
  const escaped = challenge.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (String(profile.id) !== challenge.roblox_id || !new RegExp(`(^|[^A-Za-z0-9-])${escaped}($|[^A-Za-z0-9-])`).test(String(profile.description))) throw new Error('The exact code is not visible in your Roblox About section yet. Save the description and try again.');
  const verifiedAt = Math.max(now, Date.now());
  transaction(() => {
    const current = db.prepare('SELECT * FROM link_challenges WHERE guild_id=? AND discord_id=?').get(guildId, discordId);
    if (!current || current.code !== challenge.code || current.expires_at <= verifiedAt) throw new Error('The code expired or was replaced. Start again with /link.');
    if (getAccountLink(guildId, discordId) || db.prepare('SELECT 1 FROM account_links WHERE guild_id=? AND roblox_id=?').get(guildId, challenge.roblox_id)) throw new Error('One of these accounts has already been connected.');
    db.prepare('INSERT INTO account_links(guild_id,discord_id,roblox_id,username,verified_at) VALUES(?,?,?,?,?)').run(guildId, discordId, challenge.roblox_id, String(profile.name || challenge.username), verifiedAt);
    db.prepare('DELETE FROM link_challenges WHERE guild_id=? AND discord_id=?').run(guildId, discordId);
    enqueueJob('message', `account-linked:${guildId}:${discordId}:${verifiedAt}`, { title: 'Account connected', body: `Discord <@${discordId}> connected Roblox **${escapeMarkdown(profile.name || challenge.username, 30)}** (\`${challenge.roblox_id}\`).`, channelKind: 'audit' });
  });
  return getAccountLink(guildId, discordId);
}
export function unlinkAccount(guildId, discordId, verifiedAt) {
  const link = getAccountLink(guildId, discordId);
  if (!link || String(link.verifiedAt) !== String(verifiedAt)) throw new Error('This confirmation is no longer current. Run /unlink again.');
  db.prepare('DELETE FROM account_links WHERE guild_id=? AND discord_id=? AND verified_at=?').run(guildId, discordId, link.verifiedAt);
  db.prepare('DELETE FROM link_challenges WHERE guild_id=? AND discord_id=?').run(guildId, discordId);
  enqueueJob('message', `account-unlinked:${guildId}:${discordId}:${Date.now()}`, { title: 'Account disconnected', body: `<@${discordId}> disconnected Roblox \`${link.robloxId}\`.`, channelKind: 'audit' });
  return link;
}
export async function syncLinkedRoles(client, clan) {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild || !clan?.members?.length || clan.snapshotIsStale) return;
  const roster = new Set(clan.members.map(member => String(member.userId)));
  const links = db.prepare('SELECT * FROM account_links WHERE guild_id=?').all(config.guildId);
  const { queueRoleAssignment } = await import('./roles.js');
  for (const link of links) {
    if (config.roles.verified) queueRoleAssignment(config.guildId, link.discord_id, config.roles.verified);
    if (roster.has(link.roblox_id)) queueRoleAssignment(config.guildId, link.discord_id, config.roles.clan);
  }
}
