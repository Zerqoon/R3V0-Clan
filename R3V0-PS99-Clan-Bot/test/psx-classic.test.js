import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3v0-psx-'));
process.env.DATA_DIR = dir;
const { closeDb } = await import('../src/db.js');
const { createPsxClassicService, normalizePsxPage, normalizePsxPlayer, comparePsxNeighbours } = await import('../src/psx-classic.js');
const { requestJson } = await import('../src/api-client.js');
after(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });
const live = JSON.parse(fs.readFileSync(new URL('./fixtures/psx-classic-live.json', import.meta.url))).data;
function page(number = 1, { total = 30, source = 'live', updatedAt = live.updatedAt, endsAt = live.leaderboard.scoringEndsAt } = {}) {
  return {
    leaderboard: { ...live.leaderboard, state: source === 'final' ? 'final' : 'live', scoringEndsAt: endsAt }, source, updatedAt, total, page: number, pageSize: 10,
    entries: Array.from({ length: Math.max(0, Math.min(10, total - (number - 1) * 10)) }, (_, i) => {
      const rank = (number - 1) * 10 + i + 1;
      return { Rank: rank, UserID: 100 + rank, Name: `Player_${rank}`, DisplayName: `Player ${rank}`, Value: 100000 - rank * 100 };
    })
  };
}
const missing = () => Object.assign(new Error('Not on board'), { httpStatus: 404, apiMessage: 'Player is not on this leaderboard.' });
function harness(route = null) {
  let clock = 1_000_000, saved = [], fail = false;
  const calls = [];
  const request = async url => {
    calls.push(url);
    if (fail) throw new Error('API offline');
    if (route) return route(new URL(url));
    const u = new URL(url), match = u.pathname.match(/\/players\/(\d+)$/);
    if (match) {
      const rank = Number(match[1]) - 100;
      return { leaderboard: 'PSXRebornEggs', source: u.searchParams.get('source'), entry: page(Math.ceil(rank / 10)).entries.find(row => row.UserID === Number(match[1])) };
    }
    return page(Number(u.searchParams.get('page')));
  };
  const options = { request, now: () => clock, readCache: () => structuredClone(saved), writeCache: entries => { saved = structuredClone(entries); } };
  return { service: createPsxClassicService(options), calls, advance: () => { clock += 61_000; }, offline: () => { fail = true; }, restart: () => createPsxClassicService(options) };
}

test('real public API fixture matches the user’s PSX Classic board, with exact points', () => {
  const value = normalizePsxPage(live, 1);
  assert.equal(value.boardId, 'PSXRebornEggs'); assert.equal(value.entries[0].username, 'xbutterflies3');
  assert.equal(value.entries[0].points, 214007); assert.equal(value.entries[1].points, 206952); assert.equal(value.pages, 1000);
});
test('speedrun, wrong page, missing values and malformed numeric scores are rejected', () => {
  for (const change of [data => { data.leaderboard.id = 'PSXRebornSpeedrun'; }, data => { delete data.entries[0].Value; }, data => { data.entries[0].Value = false; }, data => { data.entries[0].Value = -1; }, data => { data.entries[0].Value = Number.MAX_SAFE_INTEGER + 1; }, data => { data.page = 2; }, data => { data.entries[0].Rank = 7; }]) {
    const data = structuredClone(live); change(data); assert.throws(() => normalizePsxPage(data, 1));
  }
});
test('final standings retain nullable usernames and reject another account or source', () => {
  const data = { leaderboard: 'PSXRebornEggs', source: 'final', entry: { Rank: 2, UserID: 123, Name: null, DisplayName: 'Final name', Value: 0, RewardTier: 20 } };
  assert.equal(normalizePsxPlayer(data, '123', 'final').entry.points, 0);
  assert.equal(normalizePsxPlayer(data, '123', 'final').entry.rewardTier, 20);
  assert.throws(() => normalizePsxPlayer(data, '124', 'final'), /different Roblox/);
  assert.throws(() => normalizePsxPlayer(data, '123', 'live'), /different PSX/);
});
test('concurrent board requests share one fetch and the one-minute cache', async () => {
  const h = harness(); await Promise.all([h.service.getLeaderboard(), h.service.getLeaderboard(), h.service.getLeaderboard()]);
  await h.service.getLeaderboard(); assert.equal(h.calls.length, 1);
  h.advance(); await h.service.getLeaderboard(); assert.equal(h.calls.length, 2);
});
test('last good board survives a restart and is clearly marked during an outage', async () => {
  const h = harness(); const first = await h.service.getLeaderboard(); h.advance(); h.offline();
  const value = await h.restart().getLeaderboard(); assert.equal(value.cacheFallback, true); assert.equal(value.updatedAt, first.updatedAt); assert.deepEqual(value.entries, first.entries);
});
test('only the documented missing-player response means an unreported score', async () => {
  const h = harness(url => { if (url.pathname.includes('/players/')) throw missing(); return page(); });
  const result = await h.service.getPlayerPoints('123'); assert.equal(result.found, false); assert.equal(result.entry, null); assert.equal(result.pointsToPass, null);
  for (const error of [Object.assign(new Error('Board not found'), { httpStatus: 404, apiMessage: 'Leaderboard not found.' }), new Error('API offline')]) {
    const bad = harness(url => { if (url.pathname.includes('/players/')) throw error; return page(); });
    await assert.rejects(() => bad.service.getPlayerPoints('123'));
  }
});
test('player errors preserve the previous score instead of replacing it with an unknown or zero', async () => {
  let failPlayer = false;
  const h = harness(url => { if (url.pathname.includes('/players/')) { if (failPlayer) throw new Error('Player API offline'); return { leaderboard: 'PSXRebornEggs', source: 'live', entry: page().entries[1] }; } return page(); });
  await h.service.getPlayerPoints('102'); h.advance(); failPlayer = true;
  const value = await h.service.getPlayerPoints('102'); assert.equal(value.entry.points, 99800); assert.equal(value.cacheFallback, true);
});
test('final player lookup uses the same final source as the board', async () => {
  const h = harness(url => url.pathname.includes('/players/') ? { leaderboard: 'PSXRebornEggs', source: 'final', entry: page(1, { source: 'final' }).entries[1] } : page(Number(url.searchParams.get('page')), { source: 'final' }));
  const value = await h.service.getPlayerPoints('102'); assert.equal(value.source, 'final'); assert.ok(h.calls.some(url => url.endsWith('/players/102?source=final')));
});
test('a new contest cannot reuse a player result from the older run', async () => {
  let newRun = false;
  const h = harness(url => { if (url.pathname.includes('/players/')) { if (newRun) throw new Error('No new player data'); return { leaderboard: 'PSXRebornEggs', source: 'live', entry: page().entries[1] }; } return page(1, { endsAt: live.leaderboard.scoringEndsAt + (newRun ? 1000 : 0) }); });
  await h.service.getPlayerPoints('102'); newRun = true; h.advance();
  await assert.rejects(() => h.service.getPlayerPoints('102'), /No new player data/);
});
test('comparison uses the player and their immediate neighbours from one page snapshot', async () => {
  const h = harness(); const value = await h.service.getPlayerPoints('105');
  assert.equal(value.entry.rank, 5); assert.equal(value.nextPlayer.rank, 4); assert.equal(value.scoreGap, 100); assert.equal(value.pointsToPass, 101);
  assert.equal(value.behindPlayer.rank, 6); assert.equal(value.leadOverBehind, 100); assert.ok(value.neighbours.some(row => row.userId === '105'));
});
test('ties need one point to lead; the leader has nobody ahead', () => {
  const self = { rank: 2, userId: '2', points: 50 }, ahead = { rank: 1, userId: '1', points: 50 };
  assert.equal(comparePsxNeighbours(self, [ahead, self]).scoreGap, 0); assert.equal(comparePsxNeighbours(self, [ahead, self]).pointsToPass, 1);
  assert.equal(comparePsxNeighbours(ahead, [ahead, self]).pointsToPass, null);
  assert.equal(comparePsxNeighbours(self, [{ ...ahead, points: 10 }, self]).pointsToPass, null);
});
test('the first player on page two compares against the last player on page one', async () => {
  const h = harness(); const value = await h.service.getPlayerPoints('111');
  assert.equal(value.entry.rank, 11); assert.equal(value.nextPlayer.rank, 10); assert.equal(value.pointsToPass, 101);
});
test('different timestamps across pages keep the score but suppress the unverified gap', async () => {
  const h = harness(url => url.pathname.includes('/players/') ? { leaderboard: 'PSXRebornEggs', source: 'live', entry: page(2).entries[0] } : page(Number(url.searchParams.get('page')), { updatedAt: live.updatedAt + (url.searchParams.get('page') === '2' ? 60 : 0) }));
  const value = await h.service.getPlayerPoints('111'); assert.equal(value.entry.rank, 11); assert.equal(value.entry.points, 98900); assert.equal(value.nextPlayer, null); assert.equal(value.pointsToPass, null);
});
test('a moved player is compared using their row from the surrounding page, not an older point lookup', async () => {
  const h = harness(url => url.pathname.includes('/players/') ? { leaderboard: 'PSXRebornEggs', source: 'live', entry: { ...page().entries[4], Value: 12345 } } : page(Number(url.searchParams.get('page'))));
  const value = await h.service.getPlayerPoints('105'); assert.equal(value.entry.points, 99500); assert.equal(value.pointsToPass, 101);
});
test('a surrounding-page outage leaves the individual score available without an invented chart gap', async () => {
  const h = harness(url => { if (url.pathname.includes('/players/')) return { leaderboard: 'PSXRebornEggs', source: 'live', entry: page(2).entries[4] }; if (url.searchParams.get('page') === '2') throw new Error('Page unavailable'); return page(); });
  const value = await h.service.getPlayerPoints('115'); assert.equal(value.entry.points, 98500); assert.equal(value.pointsToPass, null); assert.deepEqual(value.neighbours, []);
});
test('a page beyond the end falls back to the final existing page', async () => {
  const h = harness(); const value = await h.service.getLeaderboard(50); assert.equal(value.page, 3); assert.equal(value.pages, 3);
  await assert.rejects(() => h.service.getLeaderboard(-1), /Choose a page/);
});
test('HTTP errors expose status and API reason so missing rows are distinguishable from outages', async () => {
  const old = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({ status: 'error', error: { message: 'Player is not on this leaderboard.' } }) });
    await assert.rejects(() => requestJson('https://api.invalid/psx-missing-test', { retries: 0 }), error => error.httpStatus === 404 && error.apiMessage === 'Player is not on this leaderboard.');
  } finally { globalThis.fetch = old; }
});
