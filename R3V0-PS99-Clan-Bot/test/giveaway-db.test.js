import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3v0-giveaway-db-'));
process.env.DATA_DIR = tempDir;
const { db, closeDb } = await import('../src/db.js');
after(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('giveaway schema accepts a creation record and keeps participants unique', () => {
  const now = Date.now();
  const result = db.prepare(`INSERT INTO giveaways(
    guild_id,channel_id,creator_id,prize,description,image_url,winners_count,ends_at,required_role_id,
    min_messages,min_account_age_days,min_server_age_days,bonus_role_id,bonus_entries,status,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active',?)`).run(
    'guild', 'channel', 'creator', 'Huge pet', 'Test description', null, 2, now + 60_000,
    'required-role', 10, 7, 2, 'bonus-role', 2, now
  );
  const giveawayId = Number(result.lastInsertRowid);
  db.prepare('INSERT OR IGNORE INTO giveaway_entries(giveaway_id,user_id,entered_at) VALUES(?,?,?)').run(giveawayId, 'user-1', now);
  db.prepare('INSERT OR IGNORE INTO giveaway_entries(giveaway_id,user_id,entered_at) VALUES(?,?,?)').run(giveawayId, 'user-1', now + 1);
  db.prepare('INSERT OR IGNORE INTO giveaway_entries(giveaway_id,user_id,entered_at) VALUES(?,?,?)').run(giveawayId, 'user-2', now + 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM giveaways WHERE id=?').get(giveawayId).count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM giveaway_entries WHERE giveaway_id=?').get(giveawayId).count, 2);
  assert.equal(db.prepare('SELECT status FROM giveaways WHERE id=?').get(giveawayId).status, 'active');
});

test('observed message counter persists and increments atomically', () => {
  db.prepare(`INSERT INTO giveaway_message_counts(guild_id,user_id,message_count,last_message_at) VALUES(?,?,1,?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET message_count=message_count+1,last_message_at=excluded.last_message_at`)
    .run('guild', 'user-1', Date.now());
  db.prepare(`INSERT INTO giveaway_message_counts(guild_id,user_id,message_count,last_message_at) VALUES(?,?,1,?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET message_count=message_count+1,last_message_at=excluded.last_message_at`)
    .run('guild', 'user-1', Date.now());
  assert.equal(db.prepare('SELECT message_count FROM giveaway_message_counts WHERE guild_id=? AND user_id=?').get('guild', 'user-1').message_count, 2);
});
