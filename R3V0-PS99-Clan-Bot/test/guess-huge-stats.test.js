import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3v0-guess-huge-'));
process.env.DATA_DIR = tempDir;
const { closeDb } = await import('../src/db.js');
const { recordHugeGuessWin, getHugeGuessLeaderboard, getMostIdentifiedHugePets } = await import('../src/guess-huge-stats.js');

after(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('correct guesses persist in the player leaderboard and count distinct Huge names', () => {
  recordHugeGuessWin({ userId: 'discord-1', username: 'Malbo', petName: 'Huge Hell Rock', now: 100 });
  recordHugeGuessWin({ userId: 'discord-1', username: 'Malbo', petName: 'Huge Hell Rock', now: 200 });
  recordHugeGuessWin({ userId: 'discord-1', username: 'Malbo', petName: 'Huge Kitsune', now: 300 });
  recordHugeGuessWin({ userId: 'discord-2', username: 'PlayerTwo', petName: 'Huge Hell Rock', now: 400 });

  const players = getHugeGuessLeaderboard(10);
  assert.equal(players[0].userId, 'discord-1');
  assert.equal(players[0].wins, 3);
  assert.deepEqual(players[0].petNames, ['Huge Hell Rock', 'Huge Kitsune']);
  assert.equal(players[1].wins, 1);
});

test('most identified Huge pet ranking counts only correct answers', () => {
  const pets = getMostIdentifiedHugePets(10);
  assert.equal(pets[0].petName, 'Huge Hell Rock');
  assert.equal(pets[0].correctGuesses, 3);
  assert.equal(pets[1].petName, 'Huge Kitsune');
  assert.equal(pets[1].correctGuesses, 1);
});

test('invalid Huge guess result does not create a leaderboard row', () => {
  assert.throws(() => recordHugeGuessWin({ userId: '', username: 'Bad', petName: 'Huge Pet' }), /user ID/);
  assert.equal(getHugeGuessLeaderboard(10).length, 2);
});
