import test from 'node:test';
import assert from 'node:assert/strict';
import { leaderboardPages, getLeaderboardPage, computeHourlyProgress } from '../src/monitor.js';
import { applyClanNickPrefix } from '../src/roles.js';

test('leaderboard paginates the full roster instead of truncating to the top three', () => {
  const members = Array.from({ length: 50 }, (_, i) => ({ username: `Player${i + 1}`, points: 50 - i }));
  assert.equal(leaderboardPages(members, 10), 5);
  assert.deepEqual(getLeaderboardPage(members, 4, 10).members.map(m => m.username), members.slice(40).map(m => m.username));
  assert.equal(getLeaderboardPage(members, 200, 10).page, 4);
});
test('24-hour points history is stable and non-negative', () => {
  const now = 24 * 60 * 60 * 1000;
  const snapshots = [
    { capturedAt: now - 25 * 60 * 60 * 1000, points: 100 },
    { capturedAt: now - 23 * 60 * 60 * 1000, points: 200 },
    { capturedAt: now - 2 * 60 * 60 * 1000, points: 150 },
    { capturedAt: now - 60 * 60 * 1000, points: 220 },
    { capturedAt: now - 10 * 60 * 1000, points: 250 }
  ];
  const result = computeHourlyProgress(snapshots, 250, now);
  assert.equal(result.progress24h, 150);
  assert.equal(result.series.length, 24);
  assert.ok(result.series.every(n => n >= 0));
});
test('R3V0 nickname prefix is added and removed without doubling', () => {
  assert.equal(applyClanNickPrefix('Alpha', 'Alpha', true), 'R3V0 | Alpha');
  assert.equal(applyClanNickPrefix('R3V0 | Alpha', 'Alpha', true), 'R3V0 | Alpha');
  assert.equal(applyClanNickPrefix('R3V0 | Alpha', 'Alpha', false), 'Alpha');
  assert.equal(applyClanNickPrefix('A'.repeat(40), 'Alpha', true).length, 32);
});

test('progress labels include whether a full day of snapshots is available', async () => {
  const now = 100 * 60 * 60 * 1000;
  const shortHistory = computeHourlyProgress([
    { capturedAt: now - 3 * 60 * 60 * 1000, points: 100 },
    { capturedAt: now - 2 * 60 * 60 * 1000, points: 150 },
    { capturedAt: now - 60 * 60 * 1000, points: 200 }
  ], 250, now);
  assert.equal(shortHistory.historyIsFullDay, false);
  assert.equal(shortHistory.progress24h, 150);
  assert.equal(shortHistory.historyCoverageHours, 3);
  const fullHistory = computeHourlyProgress([
    { capturedAt: now - 25 * 60 * 60 * 1000, points: 100 },
    { capturedAt: now - 24 * 60 * 60 * 1000, points: 200 },
    { capturedAt: now - 1 * 60 * 60 * 1000, points: 250 }
  ], 300, now);
  assert.equal(fullHistory.historyIsFullDay, true);
});

test('progress history exposes real coverage so the Canvas does not claim a full day too early', () => {
  const now = 200 * 60 * 60 * 1000;
  const result = computeHourlyProgress([
    { capturedAt: now - 2 * 60 * 60 * 1000, points: 20 },
    { capturedAt: now - 60 * 60 * 1000, points: 50 }
  ], 80, now);
  assert.equal(result.historyIsFullDay, false);
  assert.equal(result.progress24h, 60);
  assert.equal(result.historyCoverageHours, 2);
});
