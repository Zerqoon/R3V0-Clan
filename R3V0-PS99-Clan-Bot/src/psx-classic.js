import { config } from './config.js';
import { getSetting, setSetting } from './db.js';
import { requestJson } from './api-client.js';

// This is the rare-hatch points board shown beside the PSX Classic portal.
// PSXRebornSpeedrun and FantasyBattle2026 measure different things.
export const PSX_BOARD_ID = 'PSXRebornEggs';
export const PSX_PAGE_SIZE = 10;
const CACHE_KEY = 'psx_classic_cache_v1';
const CACHE_MS = 60_000;
const MAX_CACHE_ENTRIES = 100;
const states = new Set(['live', 'ended', 'final', 'inactive']);
const sources = new Set(['live', 'final']);
const whole = value => (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const timestamp = value => whole(value) > 0 ? whole(value) : null;
const sameBoard = id => String(id || '').toLowerCase() === PSX_BOARD_ID.toLowerCase();
export function validRobloxId(value) { return /^[1-9]\d{0,15}$/.test(String(value)) && Number.isSafeInteger(Number(value)); }

function normalizeEntry(row) {
  const rank = whole(row?.Rank), points = whole(row?.Value);
  const userId = row?.UserID == null ? null : String(row.UserID);
  if (!rank || points === null || (userId !== null && !validRobloxId(userId))) throw new Error('Invalid PSX Classic leaderboard row.');
  return { rank, userId, username: typeof row.Name === 'string' ? row.Name.slice(0, 40) : null, displayName: typeof row.DisplayName === 'string' ? row.DisplayName.slice(0, 80) : null, points, rewardTier: whole(row.RewardTier) };
}
export function normalizePsxPage(data, requestedPage) {
  const board = data?.leaderboard;
  if (!sameBoard(board?.id) || !states.has(board.state) || !sources.has(data.source) || (board.codec != null && board.codec !== 'Integer')) throw new Error('The API did not return the PSX Classic rare-pet points board.');
  const total = whole(data.total), page = whole(data.page), pageSize = whole(data.pageSize);
  if (total === null || page !== requestedPage || pageSize !== PSX_PAGE_SIZE || !Array.isArray(data.entries) || data.entries.length > PSX_PAGE_SIZE) throw new Error('Invalid PSX Classic page metadata.');
  const entries = data.entries.map(normalizeEntry);
  const ids = entries.map(entry => entry.userId).filter(Boolean);
  if (new Set(ids).size !== ids.length || entries.some((entry, i) => entry.rank > total || entry.rank !== (page - 1) * PSX_PAGE_SIZE + i + 1)) throw new Error('Invalid PSX Classic ranking order.');
  return { boardId: PSX_BOARD_ID, state: board.state, source: data.source, endsAt: timestamp(board.scoringEndsAt), updatedAt: timestamp(data.updatedAt), total, page, pages: Math.max(1, Math.ceil(total / PSX_PAGE_SIZE)), entries, rewardedThroughRank: whole(board.final?.rewardedThroughRank) };
}
export function normalizePsxPlayer(data, userId, source) {
  if (!sameBoard(data?.leaderboard) || data.source !== source) throw new Error('The API returned a different PSX Classic board or source.');
  const entry = normalizeEntry(data.entry);
  if (entry.userId !== String(userId)) throw new Error('The PSX Classic result belongs to a different Roblox account.');
  return { entry, source };
}

export function comparePsxNeighbours(entry, rows = []) {
  if (!entry) return { neighbours: [], nextPlayer: null, scoreGap: null, pointsToPass: null, behindPlayer: null, leadOverBehind: null };
  const unique = [...new Map(rows.map(row => [row.rank, row])).values()].sort((a, b) => a.rank - b.rank);
  const neighbours = unique.filter(row => row.rank >= Math.max(1, entry.rank - 3) && row.rank <= entry.rank + 2);
  const nextPlayer = unique.find(row => row.rank === entry.rank - 1) || null;
  const scoreGap = nextPlayer && nextPlayer.points >= entry.points ? nextPlayer.points - entry.points : null;
  const pointsToPass = scoreGap !== null && Number.isSafeInteger(scoreGap + 1) ? scoreGap + 1 : null;
  const behindPlayer = unique.find(row => row.rank === entry.rank + 1 && row.points <= entry.points) || null;
  return { neighbours, nextPlayer: scoreGap === null ? null : nextPlayer, scoreGap, pointsToPass, behindPlayer, leadOverBehind: behindPlayer ? entry.points - behindPlayer.points : null };
}

export function createPsxClassicService({ request = requestJson, now = () => Date.now(), readCache = () => getSetting(CACHE_KEY, []), writeCache = entries => setSetting(CACHE_KEY, entries) } = {}) {
  const saved = readCache();
  const cache = new Map((Array.isArray(saved) ? saved : []).filter(item => Array.isArray(item) && typeof item[0] === 'string' && Number.isFinite(item[1]?.receivedAt) && item[1]?.data).slice(-MAX_CACHE_ENTRIES));
  const pending = new Map(), failures = new Map();
  function save(key, data) {
    const value = { data, receivedAt: now() };
    cache.delete(key); cache.set(key, value);
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    writeCache([...cache]);
    return value;
  }
  function result(value, cacheFallback = false) { return { ...value.data, receivedAt: value.receivedAt, cacheFallback }; }
  async function read(key, loader, { savedOnly = false } = {}) {
    const previous = cache.get(key);
    if (savedOnly) {
      if (previous) return result(previous, true);
      throw new Error('No saved PSX Classic result is available while the board API is unavailable.');
    }
    if (previous && now() - previous.receivedAt < CACHE_MS && now() >= previous.receivedAt) return result(previous);
    if (pending.has(key)) return pending.get(key);
    if (failures.get(key)?.retryAt > now()) {
      if (previous) return result(previous, true);
      throw failures.get(key).error;
    }
    const task = (async () => {
      try { const value = save(key, await loader()); failures.delete(key); return result(value); }
      catch (error) {
        failures.set(key, { error, retryAt: now() + 20_000 });
        while (failures.size > MAX_CACHE_ENTRIES) failures.delete(failures.keys().next().value);
        if (previous) return result(previous, true);
        throw error;
      }
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }
  async function getLeaderboard(requestedPage = 1, { savedOnly = false } = {}) {
    const page = Number(requestedPage);
    if (!Number.isInteger(page) || page < 1 || page > 10_000) throw new Error('Choose a page from 1 to 10000.');
    const value = await read(`page:${page}`, async () => normalizePsxPage(await request(`${config.apiBase}/v1/leaderboards/${PSX_BOARD_ID}?page=${page}&pageSize=${PSX_PAGE_SIZE}`, { ttlMs: 0, retries: 2 }), page), { savedOnly });
    // An old button may point beyond the last page after finalization.
    if (value.page > value.pages && value.pages <= 10_000) return getLeaderboard(value.pages, { savedOnly });
    return value;
  }
  async function getPlayerPoints(userId) {
    const id = String(userId);
    if (!validRobloxId(id)) throw new Error('Use a valid numeric Roblox user ID.');
    const board = await getLeaderboard(1);
    const key = `player:${board.endsAt ?? 'permanent'}:${board.source}:${id}`;
    const score = await read(key, async () => {
      try {
        return { ...normalizePsxPlayer(await request(`${config.apiBase}/v1/leaderboards/${PSX_BOARD_ID}/players/${id}?source=${board.source}`, { ttlMs: 0, retries: 2 }), id, board.source), found: true };
      } catch (error) {
        // Only this documented 404 means outside the published rows. An outage,
        // removed board or missing standings must never erase an existing score.
        if (error.httpStatus === 404 && /^Player is not on this leaderboard\.?$/i.test(String(error.apiMessage || '').trim())) return { entry: null, found: false, source: board.source };
        throw error;
      }
    }, { savedOnly: board.cacheFallback });
    let result = { ...score, userId: id, board, cacheFallback: board.cacheFallback || score.cacheFallback, ...comparePsxNeighbours(null) };
    if (!score.found) return result;
    try {
      const nearby = await getLeaderboard(Math.floor((score.entry.rank - 1) / PSX_PAGE_SIZE) + 1, { savedOnly: result.cacheFallback });
      const ownRow = nearby.entries.find(entry => entry.userId === id);
      if (!ownRow || nearby.source !== score.source || nearby.endsAt !== board.endsAt) return result;
      let rows = nearby.entries;
      let comparisonFallback = nearby.cacheFallback;
      if (ownRow.rank > 1 && !rows.some(row => row.rank === ownRow.rank - 1)) {
        try {
          const preceding = await getLeaderboard(Math.max(1, nearby.page - 1), { savedOnly: result.cacheFallback });
          // Cross-page neighbours can move between refreshes. Only compare rows
          // from the same backend snapshot, source and contest run.
          if (nearby.updatedAt && preceding.updatedAt === nearby.updatedAt && preceding.source === nearby.source && preceding.endsAt === nearby.endsAt) {
            rows = [...preceding.entries, ...rows]; comparisonFallback ||= preceding.cacheFallback;
          }
        } catch { /* Keep the score and the neighbours from the readable page. */ }
      }
      result = { ...result, entry: ownRow, board: nearby, receivedAt: nearby.receivedAt, cacheFallback: result.cacheFallback || comparisonFallback, ...comparePsxNeighbours(ownRow, rows) };
    } catch {
      // The individual score is still useful if the surrounding page is down.
    }
    return result;
  }
  return { getLeaderboard, getPlayerPoints };
}
const service = createPsxClassicService();
export const getPsxLeaderboard = service.getLeaderboard;
export const getPsxPlayerPoints = service.getPlayerPoints;
