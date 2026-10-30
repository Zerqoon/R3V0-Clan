import 'dotenv/config';
import { liveGroup } from './runtime-config.js';

const splitIds = (value) => String(value ?? '').split(',').map(x => x.trim()).filter(Boolean);

export const config = Object.freeze({
  token: String(process.env.DISCORD_TOKEN || '').trim(),
  clientId: String(process.env.CLIENT_ID || '').trim(),
  guildId: String(process.env.GUILD_ID || '').trim(),
  clanName: (process.env.PS99_CLAN_NAME || 'R3V0').trim().toUpperCase(),
  ownerFallbackUsername: String(process.env.CLAN_OWNER_FALLBACK_USERNAME || 'B3STTIEE').trim().slice(0, 20),
  ownerFallbackDisplayName: String(process.env.CLAN_OWNER_DISPLAY_NAME || 'Malb0').trim().slice(0, 30),
  ownerRobloxId: String(process.env.CLAN_OWNER_ROBLOX_ID || '').trim(),
  // Optional because the public API reports LastKickTimestamp, not the cooldown duration.
  kickCooldownHours: Math.max(0, Math.min(168, Number(process.env.PS99_KICK_COOLDOWN_HOURS) || 0)),
  apiBase: (process.env.PS99_API_BASE || 'https://ps99.biggamesapi.io').replace(/\/+$/, ''),
  refreshMinutes: Math.max(2, Math.min(60, Number(process.env.PS99_REFRESH_MINUTES || 5))),
  historyDays: Math.max(1, Math.min(30, Number(process.env.PS99_HISTORY_DAYS || 8))),
  rapCacheHours: Math.max(1, Math.min(24, Number(process.env.PS99_RAP_CACHE_HOURS || 4))),
  dataDir: process.env.DATA_DIR || '/app/data',
  port: Math.max(1, Math.min(65535, Number(process.env.PORT || 3000))),
  channels: liveGroup('channels', {
    welcome: process.env.WELCOME_CHANNEL_ID || '1564412964608672070',
    rules: process.env.RULES_CHANNEL_ID || '1564413086243233842',
    leaderboard: process.env.LEADERBOARD_CHANNEL_ID || '1564416597253165086',
    gems: process.env.GEM_LOG_CHANNEL_ID || '1564416615725015094',
    messages: process.env.MESSAGE_LOG_CHANNEL_ID || '1564417028159184986',
    ticketPanel: process.env.TICKET_PANEL_CHANNEL_ID || '1564416280864227359',
    ticketCategory: process.env.TICKET_CATEGORY_ID || '1564420505132605490',
    ticketLogs: process.env.TICKET_LOG_CHANNEL_ID || '1564417050439585862',
    moderation: process.env.MODERATION_LOG_CHANNEL_ID || '1564417071666831431',
    audit: process.env.AUDIT_LOG_CHANNEL_ID || '1564417092500062279'
  }),
  roles: liveGroup('roles', {
    owner: process.env.OWNER_ROLE_ID || '1564414645920596113',
    officer: process.env.OFFICER_ROLE_ID || '1564412137881739406',
    community: process.env.COMMUNITY_ROLE_ID || '1564414643655413770',
    clan: process.env.R3V0_ROLE_ID || '1564414641768108123',
    verified: process.env.VERIFIED_ROLE_ID || ''
  }),
  ticketStaffRoleIds: splitIds(process.env.TICKET_STAFF_ROLE_IDS || '1564412137881739406'),
  moderatorRoleIds: splitIds(process.env.MODERATOR_ROLE_IDS || ''),
  linkAllowlist: splitIds(process.env.LINK_ALLOWLIST || 'giphy.com,klipy.com,tenor.com,roblox.com,rbxcdn.com,tiktok.com,vm.tiktok.com,youtube.com,youtu.be,twitch.tv').map(x => x.toLowerCase().replace(/^\./, '')),
  initialClanSlots: Math.max(0, Number(process.env.CLAN_SLOTS_CURRENT || 20)),
  initialClanCapacity: Math.max(1, Number(process.env.CLAN_SLOTS_CAPACITY || 50)),
  gemWebhookSecret: process.env.GEMS_WEBHOOK_SECRET || '',
  ownerUserId: process.env.OWNER_USER_ID || ''
});

export function validateConfig() {
  for (const name of ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID']) {
    const value = String(process.env[name] || '').trim();
    if (!value || value.startsWith('PASTE_')) throw new Error(`Missing required environment variable: ${name}`);
  }
  const snowflake = /^\d{15,22}$/;
  for (const [name, id] of Object.entries({
    CLIENT_ID: config.clientId, GUILD_ID: config.guildId,
    WELCOME_CHANNEL_ID: config.channels.welcome, RULES_CHANNEL_ID: config.channels.rules,
    LEADERBOARD_CHANNEL_ID: config.channels.leaderboard, GEM_LOG_CHANNEL_ID: config.channels.gems,
    MESSAGE_LOG_CHANNEL_ID: config.channels.messages, TICKET_PANEL_CHANNEL_ID: config.channels.ticketPanel,
    TICKET_CATEGORY_ID: config.channels.ticketCategory, TICKET_LOG_CHANNEL_ID: config.channels.ticketLogs,
    MODERATION_LOG_CHANNEL_ID: config.channels.moderation, AUDIT_LOG_CHANNEL_ID: config.channels.audit,
    OWNER_ROLE_ID: config.roles.owner, OFFICER_ROLE_ID: config.roles.officer,
    COMMUNITY_ROLE_ID: config.roles.community, R3V0_ROLE_ID: config.roles.clan,
    ...(config.roles.verified ? { VERIFIED_ROLE_ID: config.roles.verified } : {}),
    ...(config.ownerUserId ? { OWNER_USER_ID: config.ownerUserId } : {})
  })) {
    if (!snowflake.test(id)) throw new Error(`${name} must be a Discord ID (digits only).`);
  }
  for (const [name, ids] of Object.entries({ TICKET_STAFF_ROLE_IDS: config.ticketStaffRoleIds, MODERATOR_ROLE_IDS: config.moderatorRoleIds })) {
    if (ids.some(id => !snowflake.test(id))) throw new Error(`${name} must be a comma-separated list of Discord role IDs.`);
  }
  if (config.initialClanSlots > config.initialClanCapacity) throw new Error('CLAN_SLOTS_CURRENT cannot exceed CLAN_SLOTS_CAPACITY.');
  if (config.ownerRobloxId && !/^\d{1,20}$/.test(config.ownerRobloxId)) throw new Error('CLAN_OWNER_ROBLOX_ID must contain digits only.');
  if (config.clanName !== 'R3V0') throw new Error('This bot is locked to the R3V0 clan. Set PS99_CLAN_NAME=R3V0.');
  return true;
}
