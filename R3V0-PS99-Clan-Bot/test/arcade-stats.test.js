import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3v0-arcade-stats-'));
process.env.DATA_DIR = tempDir;
const { closeDb } = await import('../src/db.js');
const { getArcadeLeaderboard, recordArcadeWin } = await import('../src/arcade-stats.js');

after(() => { closeDb(); fs.rmSync(tempDir, { recursive: true, force: true }); });

test('arcade win stats aggregate wins per player and game type', () => {
  recordArcadeWin({ userId: '1', username: 'Malbo', gameType: 'scramble', now: 100 });
  recordArcadeWin({ userId: '1', username: 'Malbo', gameType: 'emoji', now: 200 });
  recordArcadeWin({ userId: '1', username: 'Malbo', gameType: 'higherlower', now: 300 });
  recordArcadeWin({ userId: '2', username: 'Player Two', gameType: 'emoji', now: 400 });
  const rows = getArcadeLeaderboard();
  assert.equal(rows[0].userId, '1');
  assert.equal(rows[0].totalWins, 3);
  assert.equal(rows[0].scrambleWins, 1);
  assert.equal(rows[0].emojiWins, 1);
  assert.equal(rows[0].higherLowerWins, 1);
  assert.equal(rows[1].totalWins, 1);
  assert.throws(() => recordArcadeWin({ userId: '', username: 'Bad', gameType: 'scramble' }), /user ID/);
});
