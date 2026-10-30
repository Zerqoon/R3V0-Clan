import { config } from './config.js';

import { requestJson as fetchJson, clearRequestCache } from './api-client.js';
let clanPending = null;
let clanCache = null;
let clanCacheAt = 0;
export function clearApiCache() { clearRequestCache(); clanCache = null; clanCacheAt = 0; }
export function extractAssetId(value) {
  const match = String(value ?? '').match(/(\d{5,})/);
  return match ? match[1] : null;
}
export function bigGamesImageUrl(value) {
  const assetId = extractAssetId(value);
  return assetId ? `${config.apiBase}/image/${assetId}` : null;
}
export function extractClanOwnerId(value) {
  const candidate = value && typeof value === 'object'
    ? (value.UserID ?? value.userId ?? value.Id ?? value.id ?? value.ID)
    : value;
  const id = String(candidate ?? '').trim();
  return /^\d+$/.test(id) ? id : null;
}

function identityFor(id, namesById, isOwner = false) {
  const raw = namesById instanceof Map ? namesById.get(String(id)) : null;
  const entry = raw && typeof raw === 'object' ? raw : { username: typeof raw === 'string' ? raw : '' };
  const resolvedUsername = String(entry.username ?? entry.name ?? entry.userName ?? entry.UserName ?? '').trim();
  const resolvedDisplayName = String(entry.displayName ?? entry.DisplayName ?? entry.globalName ?? entry.GlobalName ?? '').trim();
  const fallback = `RobloxUser_${id}`;
  const configuredOwner = String(config.ownerFallbackUsername || '').trim();
  const username = isOwner ? (configuredOwner || resolvedUsername || fallback) : (resolvedUsername || resolvedDisplayName || fallback);
  const configuredOwnerDisplay = String(config.ownerFallbackDisplayName || '').trim();
  const displayName = resolvedDisplayName || (raw && typeof raw === 'string' ? raw : '') || (isOwner ? configuredOwnerDisplay : '') || resolvedUsername || fallback;
  const aliases = [...new Set([username, resolvedUsername, displayName, configuredOwner && isOwner ? configuredOwner : '', configuredOwnerDisplay && isOwner ? configuredOwnerDisplay : ''].map(x => String(x || '').trim()).filter(Boolean))];
  return { username, displayName, aliases };
}

export function normalizePlayerSearchValue(value) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\u200B-\u200F\uFEFF]/g, '')
    .trim()
    .replace(/^@+/, '')
    .replace(/^r3v0\s*[|:•-]\s*/i, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
}

/** Find roster members by username, display name, known alias, or Roblox user ID. */
export function findClanMemberByQuery(members, query) {
  const wanted = normalizePlayerSearchValue(query);
  if (!wanted) return null;
  const roster = Array.isArray(members) ? members : [];
  const accountCandidates = member => [member?.username, member?.UserName, member?.userName, member?.robloxUsername, member?.userId, member?.UserID]
    .map(normalizePlayerSearchValue).filter(Boolean);
  const displayCandidates = member => [member?.displayName, member?.display_name, member?.robloxDisplayName]
    .map(normalizePlayerSearchValue).filter(Boolean);
  const aliases = member => [...accountCandidates(member), ...displayCandidates(member), ...(Array.isArray(member?.aliases) ? member.aliases : []).map(normalizePlayerSearchValue)].filter(Boolean);

  const accountMatches = roster.filter(member => accountCandidates(member).includes(wanted));
  if (accountMatches.length === 1) return accountMatches[0];
  if (accountMatches.length > 1) return null;
  const displayMatches = roster.filter(member => displayCandidates(member).includes(wanted));
  if (displayMatches.length === 1) return displayMatches[0];
  if (displayMatches.length > 1) return null;
  const aliasMatches = roster.filter(member => aliases(member).includes(wanted));
  if (aliasMatches.length === 1) return aliasMatches[0];
  if (aliasMatches.length > 1) return null;
  // Allow a unique partial match for convenient typing, but never pick arbitrarily
  // when two clan members share a similar display name.
  const partial = roster.filter(member => aliases(member).some(alias => alias.startsWith(wanted) || wanted.startsWith(alias)));
  return partial.length === 1 ? partial[0] : null;
}

/** Build Discord autocomplete choices from current R3V0 members, including display names. */
export function getR3V0MemberSuggestions(members, query = '', limit = 25) {
  const q = normalizePlayerSearchValue(query);
  const max = Math.max(1, Math.min(25, Math.floor(Number(limit) || 25)));
  const rows = (Array.isArray(members) ? members : []).map(member => {
    const username = String(member?.username ?? '').trim();
    const displayName = String(member?.displayName ?? '').trim();
    const aliases = [username, displayName, ...(Array.isArray(member?.aliases) ? member.aliases : [])].map(normalizePlayerSearchValue).filter(Boolean);
    const score = !q ? 0 : aliases.some(alias => alias === q) ? 0 : aliases.some(alias => alias.startsWith(q)) ? 1 : aliases.some(alias => alias.includes(q)) ? 2 : 99;
    return { member, username: username || String(member?.userId ?? ''), displayName, score };
  }).filter(row => row.username && row.score < 99)
    .sort((a, b) => a.score - b.score || Number(Boolean(b.member?.isOwner)) - Number(Boolean(a.member?.isOwner)) || (Number(b.member?.points) || 0) - (Number(a.member?.points) || 0) || a.username.localeCompare(b.username, 'en'))
    .slice(0, max);
  return rows.map(row => {
    const label = row.displayName && normalizePlayerSearchValue(row.displayName) !== normalizePlayerSearchValue(row.username)
      ? `${row.displayName} (@${row.username})`
      : row.username;
    return { name: label.slice(0, 100), value: row.username.slice(0, 100) };
  });
}

function numericPoints(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value === 'string') value = value.replace(/[,_\s]/g, '');
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

/** Find only the explicitly requested battle snapshot in the per-clan API payload. */
function getClanBattleSnapshot(data, battleId) {
  const battles = data?.Battles ?? data?.battles;
  const requestedId = String(battleId ?? '').trim();
  if (!requestedId || !battles || typeof battles !== 'object' || Array.isArray(battles)) return null;
  if (battles[requestedId] && typeof battles[requestedId] === 'object') return battles[requestedId];
  // Be resilient if the API's dictionary key changes but the contained BattleID
  // remains authoritative. Do not use a different/historical battle as fallback.
  for (const battle of Object.values(battles)) {
    const id = String(battle?.BattleID ?? battle?.battleId ?? battle?.BattleId ?? '').trim();
    if (id === requestedId) return battle;
  }
  return null;
}

/**
 * Extract the direct per-clan battle contribution table from /api/clan/R3V0.
 * Newer live payloads use Battles[activeBattleId].PointContributions, while
 * older payloads may use Contribution.Battle. The current battle ID is required
 * for Battles[] so historical scores can never leak into the live leaderboard.
 */
export function extractClanBattleContributionRows(data, activeBattleId = '') {
  const currentBattle = getClanBattleSnapshot(data, activeBattleId);
  const currentBattleRows = currentBattle?.PointContributions ?? currentBattle?.pointContributions;
  if (Array.isArray(currentBattleRows)) {
    return { rows: currentBattleRows, path: `Battles.${String(activeBattleId)}.PointContributions` };
  }

  const candidates = [
    ['Contribution.Battle', data?.Contribution?.Battle],
    ['Contribution.battle', data?.Contribution?.battle],
    ['contribution.Battle', data?.contribution?.Battle],
    ['contribution.battle', data?.contribution?.battle],
    ['Contributions.Battle', data?.Contributions?.Battle],
    ['contributions.battle', data?.contributions?.battle],
    ['BattleContributions', data?.BattleContributions],
    ['battleContributions', data?.battleContributions],
  ];
  for (const [path, value] of candidates) {
    if (Array.isArray(value)) return { rows: value, path };
    if (!value || typeof value !== 'object') continue;
    for (const nestedKey of ['rows', 'Rows', 'members', 'Members', 'players', 'Players', 'contributions', 'Contributions']) {
      if (Array.isArray(value[nestedKey])) return { rows: value[nestedKey], path: `${path}.${nestedKey}` };
    }
    // Defensive support for a keyed { "robloxUserId": points } table.
    const entries = Object.entries(value).filter(([key]) => /^\d+$/.test(key));
    if (entries.length) {
      return {
        rows: entries.map(([id, points]) => typeof points === 'object' && points !== null
          ? { UserID: id, ...points }
          : { UserID: id, Points: points }),
        path: `${path} (keyed)`
      };
    }
  }
  return { rows: null, path: null };
}

function inlineMemberPoints(member) {
  const candidates = [
    ['ActiveBattlePoints', member?.ActiveBattlePoints], ['activeBattlePoints', member?.activeBattlePoints],
    ['BattlePoints', member?.BattlePoints], ['battlePoints', member?.battlePoints],
    ['CurrentBattlePoints', member?.CurrentBattlePoints], ['currentBattlePoints', member?.currentBattlePoints],
    ['Points', member?.Points], ['points', member?.points]
  ];
  for (const [source, value] of candidates) {
    const points = numericPoints(value);
    if (points !== null) return { points, source: `member.${source}` };
  }
  return null;
}

export function normalizeClan(data, namesById = new Map(), activeBattle = null) {
  if (!data || String(data.Name ?? data.name ?? '').toUpperCase() !== 'R3V0') {
    throw new Error('The API response was not for clan R3V0. No other clan will be monitored.');
  }
  const activeBattleLookupId = String(activeBattle?.configName || activeBattle?._id || '').trim();
  const activeBattleId = activeBattleLookupId || 'unknown-battle';
  const currentBattleSnapshot = getClanBattleSnapshot(data, activeBattleLookupId);
  const currentBattleTotalPoints = numericPoints(currentBattleSnapshot?.Points ?? currentBattleSnapshot?.points);

  // Only the single-clan endpoint is authoritative for this bot's roster.
  const ownerId = extractClanOwnerId(data.Owner ?? data.owner ?? data.OwnerID ?? data.ownerId) || '';
  const rawMembers = Array.isArray(data.Members) ? data.Members
    : Array.isArray(data.members) ? data.members : [];
  const byId = new Map();
  for (const member of rawMembers) {
    const id = String(member?.UserID ?? member?.userId ?? member?.UserId ?? '');
    if (!/^\d+$/.test(id)) continue;
    byId.set(id, { ...member, UserID: id, IsOwner: id === ownerId || Boolean(member.IsOwner ?? member.isOwner) });
  }
  if (/^\d+$/.test(ownerId)) {
    if (byId.has(ownerId)) byId.set(ownerId, { ...byId.get(ownerId), IsOwner: true });
    else byId.set(ownerId, { UserID: ownerId, PermissionLevel: 100, JoinTime: null, IsOwner: true });
  }

  const { rows: contributionRows, path: contributionPath } = extractClanBattleContributionRows(data, activeBattleLookupId);
  const contributionTableProvided = Array.isArray(contributionRows);
  const memberPoints = new Map();
  const pointSources = new Map();
  const allContributionPoints = new Map();
  let validContributionRows = 0;

  // The exact R3V0 clan payload can include contribution entries for someone who
  // left after contributing. Keep those in the clan's total, but only current roster
  // members appear in the individual leaderboard below.
  for (const row of contributionRows || []) {
    const id = String(row?.UserID ?? row?.userId ?? row?.UserId ?? row?.userid ?? '');
    const points = numericPoints(row?.Points ?? row?.points ?? row?.ActiveBattlePoints ?? row?.activeBattlePoints ?? row?.BattlePoints ?? row?.battlePoints);
    if (!/^\d+$/.test(id) || points === null) continue;
    validContributionRows += 1;
    allContributionPoints.set(id, points);
    if (byId.has(id)) {
      memberPoints.set(id, points);
      pointSources.set(id, `R3V0 clan endpoint (${contributionPath || 'Contribution.Battle'})`);
    }
  }

  const contributionTableAvailable = contributionTableProvided
    && (contributionRows.length === 0 || validContributionRows > 0);
  if (contributionTableAvailable) {
    // If the API returned the full clan contribution table, a current member absent
    // from it has no recorded points for this battle snapshot (zero, not unknown).
    for (const id of byId.keys()) {
      if (!memberPoints.has(id)) {
        memberPoints.set(id, 0);
        pointSources.set(id, `R3V0 clan endpoint (${contributionPath || 'Contribution.Battle'}; no entry)`);
      }
    }
  } else {
    // Some payload versions may expose points directly on member records. Use these
    // only when the authoritative clan contribution table is unavailable.
    for (const [id, member] of byId) {
      const inline = inlineMemberPoints(member);
      if (inline) {
        memberPoints.set(id, inline.points);
        pointSources.set(id, `R3V0 clan endpoint (${inline.source})`);
      }
    }
  }

  const normalizedMembers = [...byId.values()].map(member => {
    const id = String(member.UserID);
    const isOwner = id === ownerId || Boolean(member.IsOwner);
    const identity = identityFor(id, namesById, isOwner);
    const pointsKnown = memberPoints.has(id);
    return {
      userId: id,
      username: identity.username,
      displayName: identity.displayName,
      aliases: identity.aliases,
      permissionLevel: Number(member.PermissionLevel ?? member.permissionLevel) || (isOwner ? 100 : 0),
      joinTime: Number(member.JoinTime ?? member.joinTime) || null,
      points: pointsKnown ? memberPoints.get(id) : null,
      pointsKnown,
      pointsSource: pointSources.get(id) || 'not-reported-by-clan-endpoint',
      isOwner
    };
  });
  normalizedMembers.sort((a, b) => Number(b.pointsKnown) - Number(a.pointsKnown)
    || (Number(b.points) || 0) - (Number(a.points) || 0)
    || Number(b.isOwner) - Number(a.isOwner)
    || a.username.localeCompare(b.username));
  normalizedMembers.forEach((member, index) => { member.clanRank = index + 1; });

  const reportedPointMembers = normalizedMembers.filter(member => member.pointsKnown).length;
  // Only claim a complete clan total when the API provided the complete Battle table.
  // Inline member fields may be partial and must not be presented as the whole-clan total.
  const totalBattlePoints = contributionTableAvailable
    ? (currentBattleTotalPoints ?? [...allContributionPoints.values()].reduce((sum, points) => sum + points, 0))
    : null;
  const metadata = activeBattle || {};
  const battlePointsSource = contributionTableAvailable
    ? `R3V0 clan endpoint: ${contributionPath || 'Contribution.Battle'}`
    : reportedPointMembers > 0 ? 'R3V0 clan endpoint: per-member point fields' : 'not reported by R3V0 clan endpoint';

  return {
    name: 'R3V0', ownerId, icon: data.Icon ?? data.icon ?? null,
    description: data.Desc ?? data.desc ?? '', level: Number(data.GuildLevel ?? data.guildLevel) || 0,
    memberCapacity: Number(data.MemberCapacity ?? data.memberCapacity) || 50,
    officerCapacity: Number(data.OfficerCapacity ?? data.officerCapacity) || 0,
    createdAt: Number(data.Created ?? data.created) || null,
    lastKickTimestamp: Number(data.LastKickTimestamp ?? data.lastKickTimestamp) || null,
    kickCooldownEndsAt: Number(data.LastKickTimestamp ?? data.lastKickTimestamp) > 0 && config.kickCooldownHours > 0
      ? Math.floor(Number(data.LastKickTimestamp ?? data.lastKickTimestamp) + config.kickCooldownHours * 3600)
      : null,
    depositedDiamonds: Number(data.DepositedDiamonds ?? data.depositedDiamonds) || 0,
    bronzeMedals: Number(data.BronzeMedals ?? data.bronzeMedals) || 0,
    silverMedals: Number(data.SilverMedals ?? data.silverMedals) || 0,
    goldMedals: Number(data.GoldMedals ?? data.goldMedals) || 0,
    members: normalizedMembers,
    reportedPointMembers,
    pointCoverage: normalizedMembers.length ? reportedPointMembers / normalizedMembers.length : 0,
    battlePointsAvailable: contributionTableAvailable || reportedPointMembers > 0,
    battlePointsSource,
    battleContributionRowsCount: contributionRows?.length ?? 0,
    totalBattlePoints,
    officialBattlePoints: contributionTableAvailable ? currentBattleTotalPoints : null,
    directBattleSnapshotPath: currentBattleSnapshot ? `Battles.${activeBattleId}` : null,
    // The clan-specific endpoint does not publish an official battle rank. Do not
    // infer it from an unrelated top-clans/top-players sample.
    battleRank: null,
    battleRankReportedPlace: null,
    battleRankSampleCount: null,
    battleRankAvailable: false,
    battleMedal: null,
    battleContributorCount: contributionTableAvailable ? allContributionPoints.size : null,
    battleState: String(metadata.state || ''),
    battleStartTime: Number(metadata.startTime) || null,
    battleFinishTime: Number(metadata.finishTime) || null,
    activeBattle: String(activeBattle?.configName || metadata.title || activeBattle?.Name || 'Unknown / not reported'),
    activeBattleId,
    updatedAt: Date.now(), raw: data
  };
}

export async function getRobloxUserByUsername(username) {
  const value = String(username ?? '').trim();
  if (!value || value.length > 20) throw new Error('Enter a valid Roblox username.');
  const data = await fetchJson('https://users.roblox.com/v1/usernames/users', {
    method: 'POST', body: { usernames: [value], excludeBannedUsers: false }, ttlMs: 60_000
  });
  const users = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  // Only accept an exact username response; never silently map a query to the first result.
  return users.find(user => normalizePlayerSearchValue(user.name) === normalizePlayerSearchValue(value)) ?? null;
}

/** Roblox keyword search can resolve display names that /usernames/users does not accept. */
export async function searchRobloxUsersByKeyword(keyword) {
  const value = String(keyword ?? '').normalize('NFKC').replace(/[\u200B-\u200F\uFEFF]/g, '').trim().replace(/^@+/, '');
  if (value.length < 2 || value.length > 40) return [];
  const data = await fetchJson(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(value)}&limit=10`, { ttlMs: 60_000 });
  const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return rows.filter(user => user && (user.id ?? user.userId ?? user.UserID) != null);
}

/** Match Roblox keyword-search hits back to the exact current R3V0 roster by immutable user ID. */
export function matchR3V0MemberFromRobloxSearch(members, users, query) {
  const roster = Array.isArray(members) ? members : [];
  const wanted = normalizePlayerSearchValue(query);
  const rosterById = new Map(roster.map(member => [String(member?.userId ?? member?.UserID ?? ''), member]));
  const linked = (Array.isArray(users) ? users : []).flatMap(user => {
    const id = String(user?.id ?? user?.userId ?? user?.UserID ?? user?.UserId ?? '');
    const member = rosterById.get(id);
    return member ? [{ user, member, id }] : [];
  });
  if (!linked.length) return null;
  const exact = linked.filter(({ user, member }) => [
    user?.name, user?.username, user?.displayName, user?.display_name,
    member?.username, member?.displayName, ...(Array.isArray(member?.aliases) ? member.aliases : [])
  ].some(value => normalizePlayerSearchValue(value) === wanted));
  const uniqueExactIds = [...new Set(exact.map(row => row.id))];
  if (uniqueExactIds.length === 1) return exact.find(row => row.id === uniqueExactIds[0]).member;
  // Roblox's keyword endpoint may return only the username even when a display name
  // triggered the search. In that case accept only a single hit that belongs to R3V0.
  const uniqueRosterIds = [...new Set(linked.map(row => row.id))];
  return uniqueRosterIds.length === 1 ? linked[0].member : null;
}
export async function getRobloxUsersByIds(ids) {
  const unique = [...new Set(ids.map(String))].filter(id => /^\d+$/.test(id));
  const names = new Map();
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100).map(Number);
    if (!batch.length) continue;
    try {
      const data = await fetchJson('https://users.roblox.com/v1/users', {
        method: 'POST', body: { userIds: batch, excludeBannedUsers: false }, ttlMs: 5 * 60_000
      });
      const users = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      for (const user of users) if (user.id != null) names.set(String(user.id), { username: String(user.name || `RobloxUser_${user.id}`), displayName: String(user.displayName || user.name || `RobloxUser_${user.id}`) });
    } catch (error) {
      console.warn(`[ps99] Could not resolve Roblox names for batch: ${error.message}`);
    }
  }
  return names;
}
export async function getRobloxAvatarUrl(userId) {
  const id = String(userId ?? '').trim();
  if (!/^\d+$/.test(id) || Number(id) <= 0) return null;
  // fetchJson unwraps Roblox's { data: [...] } response envelope and therefore
  // returns the array itself. Support both forms defensively; reading data.data
  // after unwrapping was the reason every Player Canvas silently showed a fallback.
  const url = `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${encodeURIComponent(id)}&size=420x420&format=Png&isCircular=false`;
  let data = await fetchJson(url, { ttlMs: 10 * 60_000 });
  let row = Array.isArray(data) ? data[0] : Array.isArray(data?.data) ? data.data[0] : null;
  // Roblox thumbnails can briefly return Pending without a usable image. Do not
  // keep that transient response cached for ten minutes; retry once immediately.
  if (row?.state === 'Pending') {
    cache.delete(`GET:${url}:`);
    data = await fetchJson(url, { ttlMs: 0 });
    row = Array.isArray(data) ? data[0] : Array.isArray(data?.data) ? data.data[0] : null;
  }
  if (!row || (row.state && row.state !== 'Completed')) return null;
  const imageUrl = String(row.imageUrl ?? '').trim();
  return /^https:\/\//i.test(imageUrl) ? imageUrl : null;
}

function unwrapDataEnvelope(value) {
  if (value && typeof value === 'object' && value.data && typeof value.data === 'object') return value.data;
  return value;
}
function normalClanName(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, '').toUpperCase();
}
function battleRowUserId(row, isBattleDetail) {
  return String(isBattleDetail
    ? (row?.userId ?? row?.UserID ?? row?.UserId ?? row?.userid ?? '')
    : (row?.UserID ?? row?.userId ?? row?.UserId ?? row?.userid ?? '')).trim();
}
function battleRowClanName(row, isBattleDetail) {
  return String(isBattleDetail
    ? (row?.clan?.name ?? row?.Clan?.Name ?? row?.clanName ?? row?.ClanName ?? '')
    : (row?.Clan?.Name ?? row?.clan?.name ?? row?.ClanName ?? row?.clanName ?? '')).trim();
}

/**
 * Parse BIG Games' documented current-battle endpoints, but only retain rows
 * whose immutable Roblox user ID is in the current R3V0 roster. Records with an
 * explicit different clan name are rejected. The API may return other clans in
 * its sampled response; no such rows are ever applied to this bot's data.
 */
export function extractOfficialR3V0BattleData({ battleDetails = null, playerAggregate = null, playerLookups = [], roster = [], expectedBattleId = '' } = {}) {
  const membersById = new Map((Array.isArray(roster) ? roster : []).map(member => [String(member?.userId ?? member?.UserID ?? ''), member]));
  const pointsByUserId = new Map();
  const pointSources = new Map();
  const diagnostics = {
    expectedBattleId: String(expectedBattleId || ''),
    battleDetailStatus: battleDetails ? 'loaded' : 'unavailable',
    battleDetailId: null,
    battleDetailSampledClans: null,
    battleDetailClanFound: false,
    battleDetailRowsMatched: 0,
    playerAggregateStatus: playerAggregate ? 'loaded' : 'not-requested',
    playerAggregateBattleId: null,
    playerAggregateSampledClans: null,
    playerAggregateRowsMatched: 0,
    playerLookupAttempts: Array.isArray(playerLookups) ? playerLookups.length : 0,
    playerLookupRowsMatched: 0,
    playerLookupRowsSkipped: 0,
    rowsRejectedForOtherClan: 0,
    mismatchReason: null,
  };
  const detail = unwrapDataEnvelope(battleDetails);
  const aggregate = unwrapDataEnvelope(playerAggregate);

  let matchingDetail = null;
  if (detail && typeof detail === 'object') {
    const responseId = String(detail?.meta?.id ?? detail?.id ?? detail?.configName ?? '').trim();
    diagnostics.battleDetailId = responseId || null;
    diagnostics.battleDetailSampledClans = Number(detail?.stats?.sampledClans ?? detail?.stats?.participatingClans) || null;
    if (expectedBattleId && responseId && responseId !== String(expectedBattleId)) {
      diagnostics.battleDetailStatus = 'battle-id-mismatch';
      diagnostics.mismatchReason = `battle details returned ${responseId}, expected ${expectedBattleId}`;
    } else {
      matchingDetail = detail;
      diagnostics.battleDetailStatus = 'matched-current-battle';
      const clans = Array.isArray(detail.topClans) ? detail.topClans : Array.isArray(detail.TopClans) ? detail.TopClans : [];
      const clanRow = clans.find(row => normalClanName(row?.name ?? row?.Name) === 'R3V0');
      if (clanRow) {
        diagnostics.battleDetailClanFound = true;
        const total = numericPoints(clanRow.points ?? clanRow.Points);
        const rank = numericPoints(clanRow.reportedPlace ?? clanRow.ReportedPlace ?? clanRow.rank ?? clanRow.Rank);
        diagnostics.officialClan = {
          totalBattlePoints: total,
          battleRank: rank,
          reportedPlace: numericPoints(clanRow.reportedPlace ?? clanRow.ReportedPlace),
          rank: numericPoints(clanRow.rank ?? clanRow.Rank),
          contributorCount: numericPoints(clanRow.contributorCount ?? clanRow.ContributorCount),
          memberCapacity: numericPoints(clanRow.memberCapacity ?? clanRow.MemberCapacity),
        };
      } else {
        diagnostics.officialClan = null;
      }

      const rows = Array.isArray(detail.topPlayers) ? detail.topPlayers : Array.isArray(detail.TopPlayers) ? detail.TopPlayers : [];
      for (const row of rows) {
        const id = battleRowUserId(row, true);
        if (!/^\d+$/.test(id) || !membersById.has(id)) continue;
        const sourceClanName = battleRowClanName(row, true);
        if (sourceClanName && normalClanName(sourceClanName) !== 'R3V0') {
          diagnostics.rowsRejectedForOtherClan += 1;
          continue;
        }
        const points = numericPoints(row?.points ?? row?.Points ?? row?.ActiveBattlePoints ?? row?.activeBattlePoints);
        if (points === null) continue;
        const previous = pointsByUserId.get(id);
        if (!previous || points > previous.points) {
          pointsByUserId.set(id, { points, source: `BIG Games battle details (${expectedBattleId || responseId || 'current battle'})` });
          pointSources.set(id, 'battle-details');
        }
      }
      diagnostics.battleDetailRowsMatched = pointsByUserId.size;
    }
  }

  if (aggregate && typeof aggregate === 'object') {
    const aggregateBattleId = String(aggregate.activeBattleConfigName ?? aggregate.activeBattleId ?? '').trim();
    diagnostics.playerAggregateBattleId = aggregateBattleId || null;
    diagnostics.playerAggregateSampledClans = Number(aggregate.sampledClans) || null;
    if (!expectedBattleId || aggregateBattleId !== String(expectedBattleId)) {
      diagnostics.playerAggregateStatus = 'skipped-battle-id-mismatch';
      if (!diagnostics.mismatchReason) diagnostics.mismatchReason = `player aggregate battle ${aggregateBattleId || '(missing)'} does not match ${expectedBattleId || '(unknown)'}`;
    } else {
      diagnostics.playerAggregateStatus = 'matched-current-battle';
      const rows = Array.isArray(aggregate.players) ? aggregate.players : Array.isArray(aggregate.Players) ? aggregate.Players : [];
      let acceptedRows = 0;
      for (const row of rows) {
        const id = battleRowUserId(row, false);
        if (!/^\d+$/.test(id) || !membersById.has(id)) continue;
        const sourceClanName = battleRowClanName(row, false);
        // The aggregate must explicitly identify R3V0; this prevents points from
        // a different/currently previous clan being attributed to a roster member.
        if (normalClanName(sourceClanName) !== 'R3V0') {
          if (sourceClanName) diagnostics.rowsRejectedForOtherClan += 1;
          continue;
        }
        const points = numericPoints(row?.ActiveBattlePoints ?? row?.activeBattlePoints ?? row?.Points ?? row?.points);
        if (points === null) continue;
        acceptedRows += 1;
        if (!pointsByUserId.has(id)) {
          pointsByUserId.set(id, { points, source: `BIG Games current-battle player data (${expectedBattleId})` });
          pointSources.set(id, 'player-aggregate');
        }
      }
      diagnostics.playerAggregateRowsMatched = acceptedRows;
    }
  }

  // Last-resort lookup by each unresolved member's immutable Roblox User ID.
  // This endpoint returns { player, activeBattleId }; accept it only for the
  // current battle and only when the returned player's clan is explicitly R3V0.
  // It improves coverage when the aggregate omits R3V0, without adding any other
  // clan to the bot's stored or displayed roster.
  for (const response of (Array.isArray(playerLookups) ? playerLookups : [])) {
    const lookup = unwrapDataEnvelope(response);
    const row = lookup?.player ?? lookup?.Player ?? null;
    if (!row || typeof row !== 'object') { diagnostics.playerLookupRowsSkipped += 1; continue; }
    const lookupBattleId = String(lookup?.activeBattleId ?? lookup?.activeBattleConfigName ?? '').trim();
    if (!expectedBattleId || lookupBattleId !== String(expectedBattleId)) {
      diagnostics.playerLookupRowsSkipped += 1;
      continue;
    }
    const id = battleRowUserId(row, false);
    if (!/^\d+$/.test(id) || !membersById.has(id)) { diagnostics.playerLookupRowsSkipped += 1; continue; }
    const sourceClanName = battleRowClanName(row, false);
    if (normalClanName(sourceClanName) !== 'R3V0') {
      if (sourceClanName) diagnostics.rowsRejectedForOtherClan += 1;
      diagnostics.playerLookupRowsSkipped += 1;
      continue;
    }
    const points = numericPoints(row?.ActiveBattlePoints ?? row?.activeBattlePoints ?? row?.Points ?? row?.points);
    if (points === null) { diagnostics.playerLookupRowsSkipped += 1; continue; }
    diagnostics.playerLookupRowsMatched += 1;
    if (!pointsByUserId.has(id)) {
      pointsByUserId.set(id, { points, source: `BIG Games direct player lookup (${expectedBattleId})` });
      pointSources.set(id, 'player-lookup');
    }
  }

  return { pointsByUserId, pointSources, diagnostics, officialClan: diagnostics.officialClan || null, meta: matchingDetail?.meta || null };
}

/** Apply external current-battle scores only to member IDs in the exact R3V0 roster. */
export function applyOfficialR3V0BattleData(clan, sources) {
  if (!clan || !Array.isArray(clan.members)) throw new TypeError('A normalized R3V0 clan with members is required.');
  const extracted = extractOfficialR3V0BattleData({
    battleDetails: sources?.battleDetails,
    playerAggregate: sources?.playerAggregate,
    playerLookups: sources?.playerLookups,
    roster: clan.members,
    expectedBattleId: sources?.expectedBattleId || clan.activeBattleId,
  });
  let appliedRows = 0;
  for (const member of clan.members) {
    const id = String(member.userId);
    if (member.pointsKnown) continue; // the exact /api/clan/R3V0 score has highest precedence
    const entry = extracted.pointsByUserId.get(id);
    if (!entry) continue;
    member.points = entry.points;
    member.pointsKnown = true;
    member.pointsSource = entry.source;
    appliedRows += 1;
  }

  const official = extracted.officialClan;
  if (clan.totalBattlePoints == null && official?.totalBattlePoints != null) {
    clan.totalBattlePoints = official.totalBattlePoints;
    clan.officialBattlePoints = official.totalBattlePoints;
    clan.totalBattlePointsSource = 'BIG Games current battle standings: R3V0';
  }
  if (official?.battleRank != null) {
    clan.battleRank = official.battleRank;
    clan.battleRankReportedPlace = official.reportedPlace;
    clan.battleRankSampleCount = extracted.diagnostics.battleDetailSampledClans;
    clan.battleRankAvailable = true;
  }
  if (extracted.meta) {
    if (Number(extracted.meta.startTime) > 0) clan.battleStartTime = Number(extracted.meta.startTime);
    if (Number(extracted.meta.finishTime) > 0) clan.battleFinishTime = Number(extracted.meta.finishTime);
    if (extracted.meta.state) clan.battleState = String(extracted.meta.state);
  }

  clan.members.sort((a, b) => Number(Boolean(b.pointsKnown)) - Number(Boolean(a.pointsKnown))
    || (Number(b.points) || 0) - (Number(a.points) || 0)
    || Number(Boolean(b.isOwner)) - Number(Boolean(a.isOwner))
    || String(a.username || '').localeCompare(String(b.username || '')));
  clan.members.forEach((member, index) => { member.clanRank = index + 1; });
  clan.reportedPointMembers = clan.members.filter(member => member.pointsKnown).length;
  clan.pointCoverage = clan.members.length ? clan.reportedPointMembers / clan.members.length : 0;
  clan.battlePointsAvailable = Boolean(clan.battlePointsAvailable || clan.reportedPointMembers > 0);

  if (clan.totalBattlePoints == null && clan.reportedPointMembers > 0) {
    clan.totalBattlePoints = clan.members.filter(member => member.pointsKnown).reduce((sum, member) => sum + Number(member.points || 0), 0);
    clan.totalBattlePointsIsRosterSum = true;
    clan.totalBattlePointsSource = `Sum of reported current R3V0 members (${clan.reportedPointMembers}/${clan.members.length}); departed members may not be included`;
  }
  if (appliedRows > 0 || official?.totalBattlePoints != null) {
    const sourcesUsed = new Set(clan.members.filter(member => member.pointsKnown).map(member => member.pointsSource || 'R3V0 clan endpoint'));
    clan.battlePointsSource = sourcesUsed.size > 1
      ? 'BIG Games battle data matched to R3V0 roster by Roblox User ID'
      : [...sourcesUsed][0] || 'BIG Games current battle details (R3V0 only)';
  }
  clan.battleDiagnostics = {
    ...extracted.diagnostics,
    fallbackRowsApplied: appliedRows,
    reportedPointMembers: clan.reportedPointMembers,
    rosterSize: clan.members.length,
    totalBattlePointsSource: clan.totalBattlePointsSource || (clan.totalBattlePoints == null ? 'unavailable' : clan.battlePointsSource),
  };
  return clan;
}

export async function getClanData({ force = false } = {}) {
  if (!force && clanCache && Date.now() - clanCacheAt < 45_000) return clanCache;
  if (clanPending) return clanPending;
  clanPending = loadClanData({ force }).then(clan => { clanCache = clan; clanCacheAt = Date.now(); return clan; });
  try { return await clanPending; } finally { clanPending = null; }
}
async function loadClanData({ force = false } = {}) {
  // R3V0's single-clan endpoint is the authoritative roster and may report live
  // scores under Battles[activeBattleId].PointContributions rather than Contribution.Battle.
  // Parse the exact active battle first; only then enrich genuinely missing scores
  // from current-battle endpoints. Every external score is filtered back to the
  // exact R3V0 roster by Roblox User ID and rejected if it explicitly belongs to
  // another clan; other clans are never displayed or stored by this bot.
  const ttl = force ? 0 : 90_000;
  const raw = await fetchJson(`${config.apiBase}/api/clan/${encodeURIComponent(config.clanName)}`, { ttlMs: ttl });
  let data = raw?.Name ? raw : raw?.data?.Name ? raw.data : raw;
  if (!data || String(data.Name ?? data.name ?? '').toUpperCase() !== 'R3V0') {
    throw new Error('Big Games API did not return the R3V0 clan payload. Monitoring stopped to avoid displaying another clan.');
  }
  const apiOwnerId = extractClanOwnerId(data?.Owner ?? data?.owner ?? data?.OwnerID ?? data?.ownerId);
  let configuredOwnerId = null;
  let ownerResolution = apiOwnerId ? 'big-games-owner-id' : 'owner-id-missing';
  if (config.ownerRobloxId || config.ownerFallbackUsername) {
    try {
      const configuredOwner = config.ownerRobloxId
        ? { id: config.ownerRobloxId, name: config.ownerFallbackUsername, displayName: config.ownerFallbackDisplayName }
        : await getRobloxUserByUsername(config.ownerFallbackUsername);
      if (configuredOwner?.id != null && /^\d+$/.test(String(configuredOwner.id))) {
        configuredOwnerId = String(configuredOwner.id);
        const rawMemberIds = new Set((Array.isArray(data?.Members) ? data.Members : Array.isArray(data?.members) ? data.members : [])
          .map(member => String(member?.UserID ?? member?.userId ?? member?.UserId ?? ''))
          .filter(id => /^\d+$/.test(id)));
        if (apiOwnerId === configuredOwnerId) {
          ownerResolution = config.ownerRobloxId ? 'verified-api-owner-and-explicit-founder-id' : 'verified-api-owner-and-configured-founder';
        } else if (rawMemberIds.has(configuredOwnerId)) {
          ownerResolution = 'configured-founder-confirmed-in-roster';
          console.warn(`[ps99] Big Games Owner ID ${apiOwnerId || 'missing'} differs from configured founder ${config.ownerFallbackUsername} (${configuredOwnerId}), but the configured founder is present in R3V0 Members. Using the roster-confirmed founder.`);
        } else {
          ownerResolution = apiOwnerId ? 'configured-founder-override-api-owner-mismatch' : 'configured-founder-resolved-owner-missing';
          console.warn(`[ps99] Owner reconciliation: Big Games Owner=${apiOwnerId || 'missing'}, configured ${config.ownerFallbackUsername} Roblox ID=${configuredOwnerId}; using the configured founder identity for the R3V0 monitor.`);
        }
        data = { ...data, Owner: configuredOwnerId };
      }
    } catch (error) {
      console.warn(`[ps99] Could not resolve configured founder ${config.ownerFallbackUsername}: ${error.message}`);
    }
  }
  const ids = Array.isArray(data?.Members ?? data?.members)
    ? (data.Members ?? data.members).map(m => String(m?.UserID ?? m?.userId ?? m?.UserId ?? '')).filter(id => /^\d+$/.test(id))
    : [];
  const resolvedOwnerId = extractClanOwnerId(data?.Owner ?? data?.owner ?? data?.OwnerID ?? data?.ownerId);
  if (resolvedOwnerId) ids.push(resolvedOwnerId);
  const names = await getRobloxUsersByIds(ids);

  let activeBattle = null;
  try {
    activeBattle = await fetchJson(`${config.apiBase}/api/activeClanBattle`, { ttlMs: force ? 0 : 120_000 });
    activeBattle = activeBattle?.configName ? activeBattle : activeBattle?.data?.configName ? activeBattle.data : null;
  } catch (error) {
    console.warn(`[ps99] Active battle metadata unavailable: ${error.message}`);
  }

  const clan = normalizeClan(data, names, activeBattle);
  const expectedBattleId = String(activeBattle?.configName || clan.activeBattleId || '').trim();
  let battleDetails = null;
  let battleDetailsError = null;
  let playerAggregate = null;
  let playerAggregateError = null;
  const playerLookups = [];
  const playerLookupErrors = [];
  let playerLookupSkipReason = null;
  if (/^[A-Za-z0-9_]{1,100}$/.test(expectedBattleId)) {
    // Prefer the active battle's points for individual contributors. The response
    // can include other clans, but only current R3V0 roster IDs are ever accepted.
    try {
      battleDetails = await fetchJson(`${config.apiBase}/v1/clans/battles/${encodeURIComponent(expectedBattleId)}`, { ttlMs: force ? 0 : 180_000 });
    } catch (error) {
      battleDetailsError = error.message;
      console.warn(`[ps99] Current-battle details unavailable for ${expectedBattleId}: ${error.message}`);
    }

    const detailExtracted = extractOfficialR3V0BattleData({ battleDetails, roster: clan.members, expectedBattleId });
    const detailCoveredIds = new Set(detailExtracted.pointsByUserId.keys());
    let missingIds = clan.members.filter(member => !member.pointsKnown && !detailCoveredIds.has(String(member.userId)));
    if (missingIds.length) {
      try {
        playerAggregate = await fetchJson(`${config.apiBase}/v1/clans/players`, { ttlMs: force ? 0 : 180_000 });
      } catch (error) {
        playerAggregateError = error.message;
        console.warn(`[ps99] Current-battle player aggregate unavailable: ${error.message}`);
      }
    }

    // The bulk aggregate is sampled and may omit R3V0 entirely. Query unresolved
    // current R3V0 roster members individually by their user IDs as a final fallback.
    // API cache is >= 3 minutes; the local cache limits repeated refreshes as well.
    const afterAggregate = extractOfficialR3V0BattleData({ battleDetails, playerAggregate, roster: clan.members, expectedBattleId });
    const coveredByFallbacks = new Set(afterAggregate.pointsByUserId.keys());
    missingIds = clan.members.filter(member => !member.pointsKnown && !coveredByFallbacks.has(String(member.userId)));

    // Both public fallback datasets are sampled. When the active battle response
    // has reached the 100-clan cap without R3V0 and a healthy 25-clan player sample
    // contains no current R3V0 roster member, the per-user route filters the exact
    // same player sample and will predictably return 404 for each unresolved member.
    // Skip that burst of futile requests, but keep the direct fallback whenever the
    // samples are incomplete, errored, or contain at least one current R3V0 member.
    const aggregatePlayers = Array.isArray(playerAggregate?.players)
      ? playerAggregate.players
      : Array.isArray(playerAggregate?.Players) ? playerAggregate.Players : [];
    const rosterIds = new Set(clan.members.map(member => String(member.userId)));
    const aggregateContainsR3V0Member = aggregatePlayers.some(row => {
      const id = battleRowUserId(row, false);
      return /^\d+$/.test(id) && rosterIds.has(id) && normalClanName(battleRowClanName(row, false)) === 'R3V0';
    });
    const battleSampleIsFullAndMissingR3V0 = afterAggregate.diagnostics.battleDetailStatus === 'matched-current-battle'
      && Number(afterAggregate.diagnostics.battleDetailSampledClans) >= 100
      && afterAggregate.diagnostics.battleDetailClanFound === false;
    const playerSampleIsHealthyAndMissingR3V0 = afterAggregate.diagnostics.playerAggregateStatus === 'matched-current-battle'
      && Number(afterAggregate.diagnostics.playerAggregateSampledClans) >= 25
      && playerAggregate?.loadError == null
      && aggregatePlayers.length > 0
      && !aggregateContainsR3V0Member;
    if (missingIds.length && battleSampleIsFullAndMissingR3V0 && playerSampleIsHealthyAndMissingR3V0) {
      playerLookupSkipReason = `R3V0 was absent from the top ${afterAggregate.diagnostics.battleDetailSampledClans} battle-clan sample and the top ${afterAggregate.diagnostics.playerAggregateSampledClans} player-clan sample; individual lookups use the same sampled player dataset.`;
      console.warn(`[ps99] ${playerLookupSkipReason} Skipping ${missingIds.length} individual player lookup requests; scores remain unreported.`);
      missingIds = [];
    }

    const lookupBatchSize = 8;
    for (let index = 0; index < missingIds.length; index += lookupBatchSize) {
      const batch = missingIds.slice(index, index + lookupBatchSize);
      const responses = await Promise.all(batch.map(async member => {
        const id = String(member.userId);
        try {
          const response = await fetchJson(`${config.apiBase}/v1/clans/players/${encodeURIComponent(id)}`, { ttlMs: 180_000 });
          return { id, response };
        } catch (error) {
          playerLookupErrors.push({ userId: id, error: String(error.message || error).slice(0, 180) });
          return null;
        }
      }));
      playerLookups.push(...responses.filter(Boolean).map(row => row.response));
    }
  } else {
    battleDetailsError = 'No valid active battle configName was returned by /api/activeClanBattle.';
  }

  applyOfficialR3V0BattleData(clan, { battleDetails, playerAggregate, playerLookups, expectedBattleId });
  clan.battleDiagnostics = {
    ...clan.battleDiagnostics,
    battleDetailsError,
    playerAggregateError,
    playerLookupAttempts: playerLookups.length + playerLookupErrors.length,
    playerLookupSuccessfulResponses: playerLookups.length,
    playerLookupErrors: playerLookupErrors.slice(0, 12),
    playerLookupSkipReason,
    apiClanContributionKeys: Object.keys(data?.Contribution ?? data?.contribution ?? {}).join(', ') || 'none',
    apiClanBattleIds: Object.keys(data?.Battles ?? data?.battles ?? {}).join(', ') || 'none',
    apiClanBattleContributionPath: clan.directBattleSnapshotPath && clan.battleContributionRowsCount > 0
      ? `${clan.directBattleSnapshotPath}.PointContributions`
      : 'none',
  };
  clan.ownerDiagnostics = {
    apiOwnerId: apiOwnerId || null,
    configuredOwnerId: configuredOwnerId || null,
    resolvedOwnerId: resolvedOwnerId || null,
    resolution: ownerResolution,
    ownerInRoster: clan.members.some(member => member.userId === resolvedOwnerId)
  };
  console.info(`[ps99] R3V0 refresh: roster=${clan.members.length}, directContributionRows=${clan.battleContributionRowsCount}, battleDetailMatches=${clan.battleDiagnostics?.battleDetailRowsMatched ?? 0}, aggregateMatches=${clan.battleDiagnostics?.playerAggregateRowsMatched ?? 0}, individualMatches=${clan.battleDiagnostics?.playerLookupRowsMatched ?? 0}, pointsReported=${clan.reportedPointMembers}/${clan.members.length}, total=${clan.totalBattlePoints == null ? 'unavailable' : clan.totalBattlePoints}, source=${clan.battlePointsSource}.`);
  if (clan.reportedPointMembers < clan.members.length) {
    console.warn(`[ps99] Current R3V0 battle points remain incomplete: ${clan.reportedPointMembers}/${clan.members.length}. Diagnostics=${JSON.stringify(clan.battleDiagnostics)}. Only exact R3V0 roster IDs were retained; no external clan row was used.`);
  }
  return clan;
}
export async function getRAPData({ force = false } = {}) {
  const ttl = force ? 0 : config.rapCacheHours * 60 * 60_000;
  const data = await fetchJson(`${config.apiBase}/api/rap`, { ttlMs: ttl });
  return Array.isArray(data) ? data : [];
}
function normaliseVariant(value) {
  const v = String(value ?? 'normal').toLowerCase().replace(/[\s_-]+/g, '');
  const map = {
    normal: { name: 'Normal', pt: 0, sh: false },
    golden: { name: 'Golden', pt: 1, sh: false },
    rainbow: { name: 'Rainbow', pt: 2, sh: false },
    shiny: { name: 'Shiny', pt: 0, sh: true },
    goldenshiny: { name: 'Golden Shiny', pt: 1, sh: true },
    rainbowshiny: { name: 'Rainbow Shiny', pt: 2, sh: true }
  };
  return map[v] || null;
}
export function findRAPItem(items, petName, variant = 'normal') {
  const target = String(petName ?? '').trim().toLowerCase();
  const wanted = normaliseVariant(variant);
  if (!target || !wanted) return null;
  const exact = items.filter(item => String(item?.configData?.id ?? item?.configData?.name ?? item?.id ?? '').trim().toLowerCase() === target && (String(item.category ?? '').toLowerCase().includes('pet') || String(item.category ?? '').toLowerCase() === 'huge'));
  const chosen = exact.find(item => {
    const conf = item.configData || {};
    const pt = Number(conf.pt) || 0;
    const sh = Boolean(conf.sh) || Number(conf.sh) === 1;
    return pt === wanted.pt && sh === wanted.sh;
  }) || exact.find(item => {
    const id = String(item?.configData?.id ?? '').toLowerCase();
    return id.includes(wanted.name.toLowerCase()) && (wanted.pt !== 0 || wanted.sh === false);
  });
  return chosen ? { ...chosen, variant: wanted.name, value: Number(chosen.value) || 0 } : null;
}
let petsCache = { at: 0, value: [] };
export async function getPetsCollection({ force = false } = {}) {
  if (!force && Date.now() - petsCache.at < 6 * 60 * 60_000) return petsCache.value;
  const data = await fetchJson(`${config.apiBase}/api/collection/Pets`, { ttlMs: force ? 0 : 6 * 60 * 60_000 });
  const pets = Array.isArray(data) ? data : [];
  petsCache = { at: Date.now(), value: pets };
  return pets;
}
/** Return distinct Huge/special-Huge names from the public collection for typed guesses. */
export function getHugePetNames(pets) {
  return normalizeHugePets(pets).map(pet => pet.name);
}

function randomUnit(random) {
  const value = Number(random());
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0.999999999, value));
}

function normalizeHugePets(pets) {
  const unique = new Map();
  for (const pet of Array.isArray(pets) ? pets : []) {
    const name = String(pet?.configName ?? pet?.configData?.name ?? pet?.configData?.id ?? '').trim();
    if (!name || name === 'Unknown pet') continue;
    const category = String(pet?.category ?? '').toLowerCase();
    const huge = Boolean(pet?.configData?.huge)
      || category === 'huge'
      || /\b(huge|titanic|gargantuan)\b/i.test(name);
    if (!huge) continue;
    const key = name.toLocaleLowerCase('en-US');
    const candidate = {
      name,
      category: String(pet?.category ?? ''),
      huge: true,
      thumbnail: pet?.configData?.thumbnail || pet?.configData?.goldenThumbnail || null
    };
    const previous = unique.get(key);
    if (!previous || (!previous.thumbnail && candidate.thumbnail)) unique.set(key, candidate);
  }
  return [...unique.values()];
}

/** Pick the hidden answer only from Huge/special Huge pets; regular pets are never candidates. */
export function pickHugeGamePet(pets, random = Math.random) {
  const huges = normalizeHugePets(pets).filter(pet => pet.thumbnail);
  if (!huges.length) throw new Error('The public pet collection did not include any Huge pets with images.');
  const chosen = huges[Math.floor(randomUnit(random) * huges.length)];
  return { ...chosen, answerIsHuge: true };
}
