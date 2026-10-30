// Every step is atomic and can be applied to an existing 1.x volume.
function addColumn(db, table, name, definition) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}
export function migrateDatabase(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=200').get()) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [name, type] of Object.entries({ application_json: "TEXT NOT NULL DEFAULT '{}'", decision: "TEXT NOT NULL DEFAULT 'review'", decision_by: 'TEXT', decision_reason: "TEXT NOT NULL DEFAULT ''", panel_message_id: 'TEXT', close_reason: "TEXT NOT NULL DEFAULT ''", creation_token: 'TEXT' })) addColumn(db, 'tickets', name, type);
    db.exec(`
      CREATE TABLE IF NOT EXISTS ticket_reservations(guild_id TEXT NOT NULL, opener_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, request_json TEXT NOT NULL, PRIMARY KEY(guild_id,opener_id));
      CREATE TRIGGER IF NOT EXISTS one_active_ticket_insert BEFORE INSERT ON tickets
      WHEN NEW.status IN ('open','closing') AND EXISTS(SELECT 1 FROM tickets WHERE guild_id=NEW.guild_id AND opener_id=NEW.opener_id AND status IN ('open','closing'))
      BEGIN SELECT RAISE(ABORT, 'An active ticket already exists for this user'); END;
      CREATE TABLE IF NOT EXISTS ticket_transcripts(channel_id TEXT PRIMARY KEY, body BLOB NOT NULL, message_count INTEGER NOT NULL, complete INTEGER NOT NULL, created_at INTEGER NOT NULL, archive_message_id TEXT);
      CREATE TABLE IF NOT EXISTS account_links(guild_id TEXT NOT NULL, discord_id TEXT NOT NULL, roblox_id TEXT NOT NULL, username TEXT NOT NULL, verified_at INTEGER NOT NULL, PRIMARY KEY(guild_id,discord_id), UNIQUE(guild_id,roblox_id));
      CREATE TABLE IF NOT EXISTS link_challenges(guild_id TEXT NOT NULL, discord_id TEXT NOT NULL, roblox_id TEXT NOT NULL, username TEXT NOT NULL, code TEXT NOT NULL, expires_at INTEGER NOT NULL, last_check_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(guild_id,discord_id));
      CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY AUTOINCREMENT, job_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, completed_at INTEGER);
      CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox(status,next_at);
      CREATE TABLE IF NOT EXISTS gem_counters(clan_epoch TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT NOT NULL, high_water INTEGER NOT NULL, last_value INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(clan_epoch,user_id));
      CREATE TABLE IF NOT EXISTS donation_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL UNIQUE, clan_epoch TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), counter_before INTEGER NOT NULL, counter_after INTEGER NOT NULL, observed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS donation_receipts(id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, username TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), source TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', ledger_id INTEGER REFERENCES donation_ledger(id), created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS seasons(id INTEGER PRIMARY KEY AUTOINCREMENT, battle_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, started_at INTEGER NOT NULL, ends_at INTEGER, ended_at INTEGER, status TEXT NOT NULL DEFAULT 'active', total_points INTEGER, rank INTEGER, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS season_members(season_id INTEGER NOT NULL REFERENCES seasons(id), user_id TEXT NOT NULL, username TEXT NOT NULL, points INTEGER, present INTEGER NOT NULL DEFAULT 1, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, PRIMARY KEY(season_id,user_id));
      CREATE TABLE IF NOT EXISTS clan_goals(id INTEGER PRIMARY KEY AUTOINCREMENT, battle_id TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT '', target INTEGER NOT NULL CHECK(target>0), created_at INTEGER NOT NULL, created_by TEXT NOT NULL, reached_threshold INTEGER NOT NULL DEFAULT 0, UNIQUE(battle_id,user_id));
      CREATE TABLE IF NOT EXISTS active_game_messages(message_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL);
    `);
    db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(200,?)').run(Date.now());
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
