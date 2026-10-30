import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { migrateDatabase } from './migrations.js';
import { applyRuntimeOverrides } from './runtime-config.js';

const dataDir = path.resolve(config.dataDir);
try {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.accessSync(dataDir, fs.constants.R_OK | fs.constants.W_OK);
} catch (error) {
  console.error(`[database] Cannot access DATA_DIR '${dataDir}'. On Railway, attach a Volume at /app/data, select the Dockerfile builder, and keep DATA_DIR=/app/data. Original error: ${error.message}`);
  throw error;
}
const dbPath = path.join(dataDir, 'r3v0-clan-bot.sqlite');
let database;
try {
  database = new DatabaseSync(dbPath);
} catch (error) {
  console.error(`[database] Cannot open SQLite database '${dbPath}'. Check that the Railway volume is mounted at /app/data and its owner is bot:bot. Original error: ${error.message}`);
  throw error;
}
export const db = database;
console.log(`[database] SQLite opened: ${dbPath}`);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS member_snapshots (
    battle_id TEXT NOT NULL, captured_at INTEGER NOT NULL, user_id TEXT NOT NULL,
    username TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (battle_id, captured_at, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_snapshots_user_time ON member_snapshots(user_id, captured_at);
  CREATE INDEX IF NOT EXISTS idx_snapshots_battle_time ON member_snapshots(battle_id, captured_at);
  CREATE TABLE IF NOT EXISTS tickets (
    channel_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, opener_id TEXT NOT NULL,
    type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL,
    closed_at INTEGER, closed_by TEXT, claimed_by TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tickets_opener_status ON tickets(opener_id, status);
  CREATE TABLE IF NOT EXISTS moderation_cases (
    case_id TEXT PRIMARY KEY, type TEXT NOT NULL, guild_id TEXT NOT NULL,
    target_id TEXT NOT NULL, moderator_id TEXT NOT NULL, reason TEXT NOT NULL,
    created_at INTEGER NOT NULL, expires_at INTEGER, dm_delivered INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS gem_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, roblox_user_id TEXT, roblox_username TEXT,
    amount INTEGER NOT NULL, source TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS gem_contributions_seen (
    roblox_user_id TEXT PRIMARY KEY, amount INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS autorole_jobs (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (guild_id,user_id,role_id)
  );
  CREATE TABLE IF NOT EXISTS giveaways (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    creator_id TEXT NOT NULL,
    prize TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image_url TEXT,
    winners_count INTEGER NOT NULL DEFAULT 1,
    ends_at INTEGER NOT NULL,
    required_role_id TEXT,
    min_messages INTEGER NOT NULL DEFAULT 0,
    min_account_age_days INTEGER NOT NULL DEFAULT 0,
    min_server_age_days INTEGER NOT NULL DEFAULT 0,
    bonus_role_id TEXT,
    bonus_entries INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    ended_at INTEGER,
    winners_json TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX IF NOT EXISTS idx_giveaways_status_end ON giveaways(status, ends_at);
  CREATE INDEX IF NOT EXISTS idx_giveaways_guild_msg ON giveaways(guild_id, message_id);
  CREATE TABLE IF NOT EXISTS giveaway_entries (
    giveaway_id INTEGER NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    entered_at INTEGER NOT NULL,
    PRIMARY KEY (giveaway_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_giveaway_entries_id ON giveaway_entries(giveaway_id);
  CREATE TABLE IF NOT EXISTS giveaway_message_counts (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    last_message_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS huge_guess_stats (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    correct_guesses INTEGER NOT NULL DEFAULT 0,
    pet_names_json TEXT NOT NULL DEFAULT '[]',
    last_win_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_huge_guess_stats_wins ON huge_guess_stats(correct_guesses DESC, last_win_at ASC);
  CREATE TABLE IF NOT EXISTS huge_guess_pet_stats (
    pet_name TEXT PRIMARY KEY,
    correct_guesses INTEGER NOT NULL DEFAULT 0,
    last_guessed_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_huge_guess_pet_stats_count ON huge_guess_pet_stats(correct_guesses DESC, last_guessed_at ASC);
  CREATE TABLE IF NOT EXISTS arcade_game_stats (
    user_id TEXT PRIMARY KEY, username TEXT NOT NULL,
    total_wins INTEGER NOT NULL DEFAULT 0,
    scramble_wins INTEGER NOT NULL DEFAULT 0,
    emoji_wins INTEGER NOT NULL DEFAULT 0,
    higherlower_wins INTEGER NOT NULL DEFAULT 0,
    last_win_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_arcade_game_stats_wins ON arcade_game_stats(total_wins DESC, last_win_at ASC);
`);

migrateDatabase(db);

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(String(key));
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(String(key), JSON.stringify(value));
  return value;
}
export function nextCaseId(type = 'CASE') {
  const next = Number(getSetting('case_counter', 0)) + 1;
  setSetting('case_counter', next);
  const prefix = ({ BAN: 'BAN', TIMEOUT: 'MUTE', CLAN_WARNING: 'WARN' })[type] || 'CASE';
  return `${prefix}-${String(next).padStart(6, '0')}`;
}
export function recordSnapshot({ battleId, capturedAt, userId, username, points }) {
  db.prepare(`INSERT OR REPLACE INTO member_snapshots(battle_id,captured_at,user_id,username,points) VALUES(?,?,?,?,?)`)
    .run(String(battleId), Number(capturedAt), String(userId), String(username), Math.max(0, Math.floor(Number(points) || 0)));
}
export function getUserSnapshots(userId, fromTime, battleId) {
  return db.prepare(`SELECT battle_id AS battleId,captured_at AS capturedAt,user_id AS userId,username,points
    FROM member_snapshots WHERE user_id=? AND captured_at>=? AND battle_id=? ORDER BY captured_at ASC`)
    .all(String(userId), Number(fromTime), String(battleId));
}
export function cleanupSnapshots(keepSince) {
  return db.prepare('DELETE FROM member_snapshots WHERE captured_at < ?').run(Number(keepSince)).changes;
}
applyRuntimeOverrides(getSetting('runtime_config', {}));
export function transaction(work) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function saveTicket(ticket) {
  db.prepare(`INSERT INTO tickets(channel_id,guild_id,opener_id,type,status,created_at,claimed_by,application_json,creation_token)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(ticket.channelId, ticket.guildId, ticket.openerId, ticket.type, 'open', ticket.createdAt, ticket.claimedBy ?? null, JSON.stringify(ticket.application || {}), ticket.creationToken || null);
}
export function getTicket(channelId) {
  return db.prepare(`SELECT channel_id AS channelId,guild_id AS guildId,opener_id AS openerId,type,status,created_at AS createdAt,
    closed_at AS closedAt,closed_by AS closedBy,claimed_by AS claimedBy,application_json AS applicationJson,decision,decision_by AS decisionBy,decision_reason AS decisionReason,panel_message_id AS panelMessageId,close_reason AS closeReason FROM tickets WHERE channel_id=?`).get(String(channelId)) ?? null;
}
export function getOpenTicketForUser(userId) {
  return db.prepare(`SELECT channel_id AS channelId,guild_id AS guildId,opener_id AS openerId,type,status,created_at AS createdAt,
    closed_at AS closedAt,closed_by AS closedBy,claimed_by AS claimedBy FROM tickets WHERE opener_id=? AND status IN ('open','closing') ORDER BY created_at DESC LIMIT 1`).get(String(userId)) ?? null;
}
export function updateTicket(channelId, fields) {
  const map = { status: 'status', closedAt: 'closed_at', closedBy: 'closed_by', claimedBy: 'claimed_by', decision: 'decision', decisionBy: 'decision_by', decisionReason: 'decision_reason', panelMessageId: 'panel_message_id', closeReason: 'close_reason' };
  const pairs = Object.entries(fields).filter(([key]) => map[key]);
  if (!pairs.length) return;
  const sql = pairs.map(([key]) => `${map[key]}=?`).join(',');
  db.prepare(`UPDATE tickets SET ${sql} WHERE channel_id=?`).run(...pairs.map(([, value]) => value), String(channelId));
}
export function closeDb() { try { db.close(); } catch {} }
