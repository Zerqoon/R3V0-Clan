import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClan, findRAPItem, pickHugeGamePet, getHugePetNames, extractClanBattleContributionRows, clearApiCache, getClanData } from '../src/ps99.js';

test('R3V0 roster keeps every current member, including members with zero battle points', () => {
  const raw = { Name: 'R3V0', MemberCapacity: 50, Members: [
    { UserID: 1, PermissionLevel: 100 }, { UserID: 2 }, { UserID: 3 }, { UserID: 4 }
  ], Contribution: { Battle: [{ UserID: 2, Points: 500 }, { UserID: 4, Points: 20 }] } };
  const clan = normalizeClan(raw, new Map([['1', 'Alpha'], ['2', 'Beta'], ['3', 'Gamma'], ['4', 'Delta']]), { configName: 'FantasyBattle2026' });
  assert.equal(clan.members.length, 4);
  assert.equal(clan.members.find(m => m.userId === '1').points, 0);
  assert.equal(clan.members[0].username, 'Beta');
  assert.equal(clan.members[0].clanRank, 1);
  assert.throws(() => normalizeClan({ ...raw, Name: 'OTHER' }, new Map(), null), /not for clan R3V0/);
});

test('R3V0 owner is included when the API returns Owner separately from Members', () => {
  const raw = {
    Name: 'R3V0', Owner: 99, MemberCapacity: 50,
    Members: [{ UserID: 1 }, { UserID: 2 }],
    Contribution: { Battle: [{ UserID: 1, Points: 500 }, { UserID: 99, Points: 4200 }] }
  };
  const clan = normalizeClan(raw, new Map([['1', 'Alpha'], ['2', 'Beta']]), { configName: 'FantasyBattle2026' });
  assert.equal(clan.members.length, 3);
  const owner = clan.members.find(member => member.userId === '99');
  assert.ok(owner);
  assert.equal(owner.username, 'B3STTIEE');
  assert.equal(owner.points, 4200);
  assert.equal(owner.isOwner, true);
  assert.equal(owner.clanRank, 1);
});

test('owner already present in Members is not duplicated; only R3V0 clan contribution points are used', () => {
  const raw = { Name: 'R3V0', Owner: 99, MemberCapacity: 50, Members: [{ UserID: 99 }, { UserID: 1 }], Contribution: { Battle: [{ UserID: 99, Points: 400 }] } };
  // Extra sampled-ranking-shaped arguments are intentionally ignored for backwards compatibility.
  const unrelatedSample = { meta: { title: 'Fantasy Battle', state: 'live', finishTime: 1900000000 }, stats: { sampledClans: 80 }, topClans: [{ name: 'R3V0', rank: 7, reportedPlace: 7, points: 999999, medal: null }] };
  const clan = normalizeClan(raw, new Map([['99', 'B3STTIEE'], ['1', 'Alpha']]), { configName: 'FantasyBattle2026' }, unrelatedSample, [{ UserID: 99, ActiveBattlePoints: 888888, Clan: { Name: 'R3V0' } }]);
  assert.equal(clan.members.filter(member => member.userId === '99').length, 1);
  assert.equal(clan.members.find(member => member.userId === '99').isOwner, true);
  assert.equal(clan.battleRank, null, 'the per-clan endpoint does not provide official rank');
  assert.equal(clan.totalBattlePoints, 400);
  assert.equal(clan.activeBattle, 'FantasyBattle2026');
  assert.equal(clan.battleFinishTime, null);
});

test('RAP lookup distinguishes pet variants', () => {
  const items = [
    { category: 'Pet', configData: { id: 'Huge Cat' }, value: 1000 },
    { category: 'Pet', configData: { id: 'Huge Cat', pt: 1 }, value: 2000 },
    { category: 'Pet', configData: { id: 'Huge Cat', pt: 2, sh: true }, value: 3000 }
  ];
  assert.equal(findRAPItem(items, 'Huge Cat', 'normal').value, 1000);
  assert.equal(findRAPItem(items, 'Huge Cat', 'golden').value, 2000);
  assert.equal(findRAPItem(items, 'Huge Cat', 'rainbow-shiny').value, 3000);
  assert.equal(findRAPItem(items, 'Missing Pet', 'normal'), null);
});
test('Guess Huge chooses only image-backed Huge pets and exposes only Huge names for typed-guess validation', () => {
  const pets = [
    { configName: 'Huge Dragon', category: 'Huge', configData: { huge: true, thumbnail: 'rbxassetid://12345' } },
    { configName: 'Huge Cat', category: 'Huge', configData: { huge: true, thumbnail: 'rbxassetid://12346' } },
    { configName: 'Huge Fox', category: 'Huge', configData: { huge: true, thumbnail: 'rbxassetid://12347' } },
    { configName: 'Huge Axolotl', category: 'Huge', configData: { huge: true, thumbnail: 'rbxassetid://12348' } },
    { configName: 'Basic Cat', category: 'Basic', configData: { huge: false, thumbnail: 'rbxassetid://12349' } }
  ];
  const chosen = pickHugeGamePet(pets, () => 0);
  assert.equal(chosen.name, 'Huge Dragon');
  assert.equal(chosen.answerIsHuge, true);
  const names = getHugePetNames(pets);
  assert.deepEqual(names, ['Huge Dragon', 'Huge Cat', 'Huge Fox', 'Huge Axolotl']);
  assert.ok(names.includes(chosen.name), 'the answer must be present in typed-guess validation');
  assert.ok(names.every(name => /\bHuge\b/i.test(name)), 'regular pets must never be valid answer names');
  assert.throws(() => pickHugeGamePet([{ configName: 'Basic Cat', category: 'Basic', configData: {} }]), /did not include any Huge pets/);
});


test('configured R3V0 leader label remains B3STTIEE even if Roblox name lookup returns another label', () => {
  const raw = { Name: 'R3V0', Owner: { UserID: 99 }, Members: [{ UserID: 1 }], Contribution: { Battle: [] } };
  const clan = normalizeClan(raw, new Map([['99', 'DifferentDisplayName'], ['1', 'Alpha']]), { configName: 'FantasyBattle2026' });
  const owner = clan.members.find(member => member.userId === '99');
  assert.ok(owner);
  assert.equal(owner.username, 'B3STTIEE');
  assert.equal(owner.isOwner, true);
  assert.match(clan.ownerId, /^99$/);
});

test('player search resolves Roblox username, separate display name and prefixed Discord nickname such as B3sttiee / Malb0', async () => {
  const { findClanMemberByQuery, getR3V0MemberSuggestions, matchR3V0MemberFromRobloxSearch } = await import('../src/ps99.js');
  const raw = { Name: 'R3V0', Owner: 99, Members: [{ UserID: 99 }, { UserID: 100 }] };
  const clan = normalizeClan(raw, new Map([
    ['99', { username: 'B3sttiee', displayName: 'Malb0' }],
    ['100', { username: 'OtherPlayer', displayName: 'Other Display' }],
  ]), { configName: 'FantasyBattle2026' });
  const byUsername = findClanMemberByQuery(clan.members, 'B3sttiee');
  const byDisplayName = findClanMemberByQuery(clan.members, 'Malb0');
  const byDiscordNickname = findClanMemberByQuery(clan.members, 'R3V0 | Malb0');
  assert.equal(byUsername?.userId, '99');
  assert.equal(byDisplayName?.userId, '99');
  assert.equal(byDiscordNickname?.userId, '99');
  assert.equal(byDisplayName?.displayName, 'Malb0');
  const suggestions = getR3V0MemberSuggestions(clan.members, 'Malb0');
  assert.deepEqual(suggestions[0], { name: 'Malb0 (@B3STTIEE)', value: 'B3STTIEE' });
  const keywordSearchResult = matchR3V0MemberFromRobloxSearch(clan.members, [{ id: 99, name: 'B3sttiee' }], 'Malb0');
  assert.equal(keywordSearchResult?.userId, '99');
});

test('all current R3V0 member points come exclusively from the per-clan Contribution.Battle table', () => {
  const raw = {
    Name: 'R3V0', Owner: 101, Members: [{ UserID: 101 }, { UserID: 102 }, { UserID: 103 }, { UserID: 104 }],
    Contribution: { Battle: [{ UserID: 101, Points: 1200 }, { UserID: 104, Points: 0 }] },
  };
  const unrelatedAggregate = [
    { UserID: 102, ActiveBattlePoints: 2500, Clan: { Name: 'R3V0' } },
    { UserID: 103, ActiveBattlePoints: 999999, Clan: { Name: 'OTHER' } },
  ];
  const unrelatedDetails = { topPlayers: [
    { userId: 101, points: 1800, clan: { name: 'R3V0' } },
    { userId: 103, points: 3200 },
    { userId: 104, points: 400000, clan: { name: 'OTHER' } },
  ] };
  const clan = normalizeClan(raw, new Map([
    ['101', { username: 'B3sttiee', displayName: 'Malb0' }],
    ['102', { username: 'PlayerTwo', displayName: 'Two' }],
    ['103', { username: 'PlayerThree', displayName: 'Three' }],
    ['104', { username: 'PlayerFour', displayName: 'Four' }],
  ]), { configName: 'FantasyBattle2026' }, unrelatedDetails, unrelatedAggregate);
  const points = Object.fromEntries(clan.members.map(member => [member.userId, member.points]));
  assert.deepEqual(points, { '101': 1200, '102': 0, '103': 0, '104': 0 });
  assert.equal(clan.reportedPointMembers, 4);
  assert.equal(clan.totalBattlePoints, 1200);
  assert.equal(clan.battlePointsSource, 'R3V0 clan endpoint: Contribution.Battle');
});

test('contribution extraction handles documented and defensive field casing without any clan aggregate', () => {
  assert.deepEqual(extractClanBattleContributionRows({ Contribution: { Battle: [{ UserID: 1, Points: 55 }] } }), { rows: [{ UserID: 1, Points: 55 }], path: 'Contribution.Battle' });
  assert.deepEqual(extractClanBattleContributionRows({ contribution: { battle: [{ userId: 2, points: 66 }] } }), { rows: [{ userId: 2, points: 66 }], path: 'contribution.battle' });
  assert.equal(extractClanBattleContributionRows({ Name: 'R3V0', Members: [] }).rows, null);
});

test('live clan payload Battles[activeBattleId].PointContributions supplies all R3V0 Fantasy Battle points', async () => {
  // Mirrors the live /api/clan/R3V0 JSON returned by Big Games, including the
  // newer Battles[BattleID].PointContributions shape rather than Contribution.Battle.
  const raw = {
    Name: 'R3V0', Owner: 1308591016,
    Members: [
      { UserID: 178561454 }, { UserID: 2819770913 }, { UserID: 1245651668 },
      { UserID: 918465978 }, { UserID: 10061439495 }, { UserID: 4269932279 },
      { UserID: 2545194331 }, { UserID: 3149889251 }, { UserID: 3467178958 },
      { UserID: 2702144510 }, { UserID: 7047010212 }
    ],
    Battles: {
      SpaceMineBattle2026: {
        BattleID: 'SpaceMineBattle2026', Points: 54006654,
        PointContributions: [{ UserID: 1308591016, Points: 51730767 }]
      },
      FantasyBattle2026: {
        ProcessedAwards: false, AwardUserIDs: [], BattleID: 'FantasyBattle2026', Points: 251800,
        PointContributions: [
          { UserID: 1308591016, Points: 81075 }, { UserID: 178561454, Points: 2850 },
          { UserID: 1245651668, Points: 83225 }, { UserID: 4269932279, Points: 4325 },
          { UserID: 10061439495, Points: 7050 }, { UserID: 3149889251, Points: 16300 },
          { UserID: 3467178958, Points: 925 }, { UserID: 2702144510, Points: 32475 },
          { UserID: 2545194331, Points: 23575 }
        ], Place: 285
      }
    }
  };
  const extracted = extractClanBattleContributionRows(raw, 'FantasyBattle2026');
  assert.equal(extracted.path, 'Battles.FantasyBattle2026.PointContributions');
  assert.equal(extracted.rows.length, 9);

  const clan = normalizeClan(raw, new Map(), { configName: 'FantasyBattle2026' });
  const points = Object.fromEntries(clan.members.map(member => [member.userId, member.points]));
  assert.deepEqual(points, {
    '1308591016': 81075, '178561454': 2850, '2819770913': 0, '1245651668': 83225,
    '918465978': 0, '10061439495': 7050, '4269932279': 4325, '2545194331': 23575,
    '3149889251': 16300, '3467178958': 925, '2702144510': 32475, '7047010212': 0
  });
  assert.equal(clan.members.length, 12, 'the owner plus eleven API roster members are all represented');
  assert.equal(clan.reportedPointMembers, 12, 'missing entries in this current-battle contribution array are recorded as zero');
  assert.equal(clan.totalBattlePoints, 251800, 'use the current Battles snapshot total');
  assert.equal(clan.officialBattlePoints, 251800);
  assert.equal(clan.battleContributionRowsCount, 9);
  assert.equal(clan.battlePointsSource, 'R3V0 clan endpoint: Battles.FantasyBattle2026.PointContributions');

  const noMatchingBattle = normalizeClan({
    Name: 'R3V0', Owner: 99, Members: [{ UserID: 99 }],
    Battles: { PreviousBattle: { BattleID: 'PreviousBattle', Points: 999999, PointContributions: [{ UserID: 99, Points: 999999 }] } }
  }, new Map(), { configName: 'FantasyBattle2026' });
  assert.equal(noMatchingBattle.members[0].pointsKnown, false, 'historical battle contributions must not leak into the active battle');
  assert.equal(noMatchingBattle.totalBattlePoints, null);

  // Exercise the complete production fetch path: the current per-clan endpoint
  // already knows every score, so sampled player fallbacks must not be called.
  clearApiCache();
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input); urls.push(url);
    let payload;
    if (url.includes('/api/clan/R3V0')) payload = { status: 'ok', data: raw };
    else if (url.includes('/api/activeClanBattle')) payload = { status: 'ok', data: { configName: 'FantasyBattle2026' } };
    else if (url.includes('/v1/clans/battles/FantasyBattle2026')) payload = { status: 'ok', data: {
      meta: { id: 'FantasyBattle2026', state: 'live' }, stats: { sampledClans: 100 }, topClans: [], topPlayers: []
    } };
    else if (url.includes('users.roblox.com/v1/usernames/users')) payload = { data: [{ id: 1308591016, name: 'B3STTIEE', displayName: 'Malb0' }] };
    else if (url.includes('users.roblox.com/v1/users')) {
      const requested = JSON.parse(options.body || '{}').userIds || [];
      payload = { data: requested.map(id => ({ id, name: `R3V0User${id}`, displayName: `R3V0Display${id}` })) };
    } else throw new Error(`Unexpected API endpoint: ${url}`);
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const liveClan = await getClanData({ force: true });
    assert.equal(liveClan.reportedPointMembers, 12);
    assert.equal(liveClan.totalBattlePoints, 251800);
    assert.equal(liveClan.members.find(member => member.userId === '1308591016')?.points, 81075);
    assert.equal(liveClan.battleDiagnostics.apiClanBattleContributionPath, 'Battles.FantasyBattle2026.PointContributions');
    assert.ok(liveClan.battleDiagnostics.apiClanBattleIds.includes('FantasyBattle2026'));
    assert.ok(!urls.some(url => url.includes('/v1/clans/players')), 'complete direct scores avoid sampled player endpoint requests');
    assert.ok(!urls.some(url => /\/v1\/clans\/players\/\d+/.test(url)), 'complete direct scores avoid individual player lookups');
  } finally {
    globalThis.fetch = originalFetch;
    clearApiCache();
  }
});

test('getClanData keeps the R3V0 clan payload authoritative and uses current-battle details only to enrich rank/metadata when direct scores are complete', async () => {
  clearApiCache();
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input); urls.push(url);
    let payload;
    if (url.includes('/api/clan/R3V0')) payload = { status: 'ok', data: { Name: 'R3V0', Owner: 99, Members: [{ UserID: 99 }, { UserID: 100 }], Contribution: { Battle: [{ UserID: 99, Points: 4200 }, { UserID: 100, Points: 1800 }] } } };
    else if (url.includes('/api/activeClanBattle')) payload = { status: 'ok', data: { configName: 'FantasyBattle2026' } };
    else if (url.includes('/v1/clans/battles/FantasyBattle2026')) payload = { status: 'ok', data: { meta: { id: 'FantasyBattle2026', finishTime: 1900000000 }, stats: { sampledClans: 50 }, topClans: [{ name: 'R3V0', points: 6000, rank: 3, reportedPlace: 3 }], topPlayers: [{ userId: 99, points: 4200, clan: { name: 'R3V0' } }, { userId: 100, points: 1800, clan: { name: 'R3V0' } }] } };
    else if (url.includes('users.roblox.com/v1/usernames/users')) payload = { data: [{ id: 99, name: 'B3sttiee', displayName: 'Malb0' }] };
    else if (url.includes('users.roblox.com/v1/users')) payload = { data: [{ id: 99, name: 'B3sttiee', displayName: 'Malb0' }, { id: 100, name: 'PlayerTwo', displayName: 'Two' }] };
    else throw new Error(`Unexpected API endpoint: ${url}`);
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const clan = await getClanData({ force: true });
    assert.equal(clan.members.length, 2);
    assert.deepEqual(Object.fromEntries(clan.members.map(member => [member.userId, member.points])), { '99': 4200, '100': 1800 });
    assert.equal(clan.totalBattlePoints, 6000);
    assert.ok(urls.some(url => url.includes('/api/clan/R3V0')));
    assert.ok(urls.some(url => url.includes('/api/activeClanBattle')));
    assert.ok(urls.some(url => url.includes('/v1/clans/battles/FantasyBattle2026')));
    assert.ok(urls.every(url => !url.includes('/v1/clans/players')), 'player aggregate is only fetched when current R3V0 members are still missing points');
    assert.equal(clan.battleRank, 3);
  } finally {
    globalThis.fetch = originalFetch;
    clearApiCache();
  }
});

test('missing direct Contribution.Battle falls back to current BIG Games battle sources and filters every row to R3V0', async () => {
  clearApiCache();
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input); urls.push(url);
    let payload;
    if (url.includes('/api/clan/R3V0')) payload = { status: 'ok', data: {
      Name: 'R3V0', Owner: 99, MemberCapacity: 50,
      Members: [{ UserID: 99 }, { UserID: 100 }, { UserID: 101 }]
      // Deliberately mirrors current production response: Contribution is omitted.
    } };
    else if (url.includes('users.roblox.com/v1/usernames/users')) payload = { data: [{ id: 99, name: 'B3sttiee', displayName: 'Malb0' }] };
    else if (url.includes('users.roblox.com/v1/users')) payload = { data: [
      { id: 99, name: 'B3sttiee', displayName: 'Malb0' },
      { id: 100, name: 'PlayerTwo', displayName: 'Two' },
      { id: 101, name: 'PlayerThree', displayName: 'Three' }
    ] };
    else if (url.includes('/api/activeClanBattle')) payload = { status: 'ok', data: { configName: 'FantasyBattle2026' } };
    else if (url.includes('/v1/clans/battles/FantasyBattle2026')) payload = { status: 'ok', data: {
      meta: { id: 'FantasyBattle2026', state: 'live', finishTime: 1900000000 },
      stats: { sampledClans: 70 },
      topClans: [
        { name: 'OTHER', points: 999999999, rank: 1, reportedPlace: 1 },
        { name: 'R3V0', points: 82450, rank: 18, reportedPlace: 18 }
      ],
      topPlayers: [
        { userId: 99, displayName: 'Malb0', points: 81000, clan: { name: 'R3V0' } },
        { userId: 100, displayName: 'Two', points: 999999, clan: { name: 'OTHER' } },
        { userId: 777, displayName: 'Outside', points: 888888, clan: { name: 'OTHER' } }
      ]
    } };
    else if (url.includes('/v1/clans/players')) payload = { status: 'ok', data: {
      activeBattleConfigName: 'FantasyBattle2026', sampledClans: 25,
      players: [
        { UserID: 99, DisplayName: 'Malb0', ActiveBattlePoints: 81000, Clan: { Name: 'R3V0' } },
        { UserID: 100, DisplayName: 'Two', ActiveBattlePoints: 950, Clan: { Name: 'R3V0' } },
        { UserID: 101, DisplayName: 'Three', ActiveBattlePoints: 500, Clan: { Name: 'R3V0' } },
        { UserID: 100, DisplayName: 'Two', ActiveBattlePoints: 555555, Clan: { Name: 'OTHER' } },
        { UserID: 777, DisplayName: 'Outside', ActiveBattlePoints: 999999, Clan: { Name: 'OTHER' } }
      ]
    } };
    else throw new Error(`Unexpected API endpoint: ${url}`);
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const clan = await getClanData({ force: true });
    const points = Object.fromEntries(clan.members.map(member => [member.userId, member.points]));
    assert.deepEqual(points, { '99': 81000, '100': 950, '101': 500 });
    assert.equal(clan.reportedPointMembers, 3);
    assert.equal(clan.totalBattlePoints, 82450, 'official R3V0 clan total takes precedence over member sum');
    assert.equal(clan.battleRank, 18);
    assert.equal(clan.battleRankAvailable, true);
    assert.match(clan.battlePointsSource, /BIG Games/);
    assert.equal(clan.battleDiagnostics.battleDetailRowsMatched, 1);
    assert.equal(clan.battleDiagnostics.playerAggregateRowsMatched, 3);
    assert.ok(urls.some(url => url.includes('/v1/clans/battles/FantasyBattle2026')));
    assert.ok(urls.some(url => url.includes('/v1/clans/players')));
    assert.equal(points['777'], undefined, 'members outside the R3V0 roster must never be added');
  } finally {
    globalThis.fetch = originalFetch;
    clearApiCache();
  }
});

test('player aggregate from a different active battle is never used for R3V0 points', async () => {
  const { extractOfficialR3V0BattleData } = await import('../src/ps99.js');
  const result = extractOfficialR3V0BattleData({
    expectedBattleId: 'FantasyBattle2026',
    roster: [{ userId: '99', pointsKnown: false }],
    playerAggregate: { activeBattleConfigName: 'PreviousBattle', sampledClans: 25, players: [{ UserID: 99, ActiveBattlePoints: 81000, Clan: { Name: 'R3V0' } }] }
  });
  assert.equal(result.pointsByUserId.size, 0);
  assert.equal(result.diagnostics.playerAggregateStatus, 'skipped-battle-id-mismatch');
});

test('Roblox avatar lookup reads the unwrapped thumbnails data array instead of silently returning null', async () => {
  const { getRobloxAvatarUrl } = await import('../src/ps99.js');
  clearApiCache();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async input => {
    calls += 1;
    assert.match(String(input), /thumbnails\.roblox\.com\/v1\/users\/avatar-headshot\?userIds=12345/);
    return new Response(JSON.stringify({ data: [{ targetId: 12345, state: 'Completed', imageUrl: 'https://tr.rbxcdn.com/test-avatar.png' }] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  };
  try {
    assert.equal(await getRobloxAvatarUrl('12345'), 'https://tr.rbxcdn.com/test-avatar.png');
    assert.equal(await getRobloxAvatarUrl('12345'), 'https://tr.rbxcdn.com/test-avatar.png');
    assert.equal(calls, 1, 'avatar thumbnail response is cached');
    assert.equal(await getRobloxAvatarUrl('not-an-id'), null);
  } finally {
    globalThis.fetch = originalFetch;
    clearApiCache();
  }
});

test('configured founder is reconciled by Roblox username and remains searchable with display name even if Big Games Owner ID is stale', async () => {
  clearApiCache();
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input); urls.push(url);
    let payload;
    if (url.includes('/api/clan/R3V0')) payload = { status: 'ok', data: {
      Name: 'R3V0', Owner: 999, MemberCapacity: 50,
      Members: [{ UserID: 100, PermissionLevel: 0 }],
      Contribution: { Battle: [{ UserID: 99, Points: 9876 }, { UserID: 100, Points: 1234 }] }
    } };
    else if (url.includes('users.roblox.com/v1/usernames/users')) payload = { data: [{ id: 99, name: 'B3sttiee', displayName: 'Malb0' }] };
    else if (url.includes('users.roblox.com/v1/users')) payload = { data: [
      { id: 99, name: 'B3sttiee', displayName: 'Malb0' },
      { id: 100, name: 'OtherPlayer', displayName: 'Other Display' }
    ] };
    else if (url.includes('/api/activeClanBattle')) payload = { status: 'ok', data: { configName: 'FantasyBattle2026' } };
    else if (url.includes('/v1/clans/battles/FantasyBattle2026')) payload = { status: 'ok', data: { meta: { id: 'FantasyBattle2026' }, topClans: [], topPlayers: [] } };
    else throw new Error(`Unexpected API endpoint: ${url}`);
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const clan = await getClanData({ force: true });
    const { findClanMemberByQuery } = await import('../src/ps99.js');
    const owner = findClanMemberByQuery(clan.members, 'Malb0');
    assert.ok(owner, 'founder must be searchable by configured Roblox display name');
    assert.equal(owner.userId, '99');
    assert.equal(owner.username.toLowerCase(), 'b3sttiee');
    assert.equal(owner.isOwner, true);
    assert.equal(owner.points, 9876);
    assert.equal(clan.ownerDiagnostics.apiOwnerId, '999');
    assert.equal(clan.ownerDiagnostics.configuredOwnerId, '99');
    assert.equal(clan.ownerDiagnostics.resolvedOwnerId, '99');
    assert.equal(clan.ownerDiagnostics.ownerInRoster, true);
    assert.ok(urls.some(url => url.includes('users.roblox.com/v1/usernames/users')));
    assert.ok(urls.some(url => url.includes('/v1/clans/battles/FantasyBattle2026')));
    assert.ok(urls.every(url => !url.includes('/v1/clans/players')), 'complete direct points do not need player aggregate fallback');
  } finally {
    globalThis.fetch = originalFetch;
    clearApiCache();
  }
});


test('skips futile direct lookups when full current-battle and player samples both exclude R3V0', async () => {
  clearApiCache();
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async input => {
    const url = String(input); requested.push(url);
    let payload;
    if (url.includes('/api/clan/R3V0')) payload = { status: 'ok', data: {
      Name: 'R3V0', Owner: 99, Members: [{ UserID: 99 }, { UserID: 100 }]
    } };
    else if (url.includes('/api/activeClanBattle')) payload = { status: 'ok', data: { configName: 'FantasyBattle2026' } };
    else if (url.includes('/v1/clans/battles/FantasyBattle2026')) payload = { status: 'ok', data: {
      meta: { id: 'FantasyBattle2026', state: 'live' }, stats: { sampledClans: 100 },
      topClans: [{ name: 'OTHER', points: 999999, rank: 1, reportedPlace: 1 }],
      topPlayers: [{ userId: 777, points: 900000, clan: { name: 'OTHER' } }]
    } };
    else if (url.endsWith('/v1/clans/players')) payload = { status: 'ok', data: {
      activeBattleConfigName: 'FantasyBattle2026', sampledClans: 25, loadError: null,
      players: [{ UserID: 777, ActiveBattlePoints: 900000, Clan: { Name: 'OTHER' } }]
    } };
    else if (url.includes('users.roblox.com/v1/usernames/users')) payload = { data: [{ id: 99, name: 'B3sttiee', displayName: 'Malb0' }] };
    else if (url.includes('users.roblox.com/v1/users')) payload = { data: [
      { id: 99, name: 'B3sttiee', displayName: 'Malb0' },
      { id: 100, name: 'SecondMember', displayName: 'Second' }
    ] };
    else throw new Error(`Unexpected API endpoint: ${url}`);
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const clan = await getClanData({ force: true });
    assert.equal(clan.reportedPointMembers, 0);
    assert.match(clan.battleDiagnostics.playerLookupSkipReason, /absent from the top 100 battle-clan sample/);
    assert.equal(clan.battleDiagnostics.playerLookupAttempts, 0);
    assert.equal(requested.some(url => /\/v1\/clans\/players\/\d+$/.test(url)), false,
      'the bot must not fan out known-unrecoverable lookups for every R3V0 member');
    assert.ok(clan.members.every(member => member.pointsKnown === false), 'missing points remain unreported, not fabricated');
  } finally {
    globalThis.fetch = originalFetch;
    clearApiCache();
  }
});

test('direct per-member lookup recovers current battle points when clan payload and sampled sources omit them', async () => {
  clearApiCache();
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async input => {
    const url = String(input); requested.push(url);
    let payload;
    if (url.includes('/api/clan/R3V0')) payload = { status: 'ok', data: {
      Name: 'R3V0', Owner: 99, Members: [{ UserID: 99 }, { UserID: 100 }]
    } };
    else if (url.includes('/api/activeClanBattle')) payload = { status: 'ok', data: { configName: 'FantasyBattle2026' } };
    else if (url.includes('/v1/clans/battles/FantasyBattle2026')) payload = { status: 'ok', data: {
      meta: { id: 'FantasyBattle2026', state: 'live' }, stats: { sampledClans: 50 }, topClans: [], topPlayers: []
    } };
    else if (url.endsWith('/v1/clans/players')) payload = { status: 'ok', data: {
      activeBattleConfigName: 'FantasyBattle2026', sampledClans: 25,
      players: [{ UserID: 777, ActiveBattlePoints: 900000, Clan: { Name: 'OTHER' } }]
    } };
    else if (url.endsWith('/v1/clans/players/99')) payload = { status: 'ok', data: {
      player: { UserID: 99, DisplayName: 'Malb0', ActiveBattlePoints: 81000, Clan: { Name: 'R3V0' } },
      activeBattleId: 'FantasyBattle2026', hasActiveBattle: true, sampledClans: 25
    } };
    else if (url.endsWith('/v1/clans/players/100')) return new Response(JSON.stringify({ status: 'error', error: { message: 'Player not found in sampled clans.' } }), { status: 404, headers: { 'content-type': 'application/json' } });
    else if (url.includes('users.roblox.com/v1/usernames/users')) payload = { data: [{ id: 99, name: 'B3sttiee', displayName: 'Malb0' }] };
    else if (url.includes('users.roblox.com/v1/users')) payload = { data: [{ id: 99, name: 'B3sttiee', displayName: 'Malb0' }, { id: 100, name: 'SecondMember', displayName: 'Second' }] };
    else throw new Error(`Unexpected API endpoint: ${url}`);
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const clan = await getClanData({ force: true });
    const founder = clan.members.find(member => member.userId === '99');
    const second = clan.members.find(member => member.userId === '100');
    assert.equal(founder.username, 'B3STTIEE');
    assert.equal(founder.displayName, 'Malb0');
    assert.equal(founder.points, 81000);
    assert.equal(founder.pointsKnown, true);
    assert.match(founder.pointsSource, /direct player lookup/);
    assert.equal(second.pointsKnown, false, 'missing scores are not fabricated for other members');
    assert.equal(clan.reportedPointMembers, 1);
    assert.equal(clan.battleDiagnostics.playerLookupRowsMatched, 1);
    assert.match(clan.battleDiagnostics.playerLookupErrors.find(row => row.userId === '100')?.error || '', /Player not found in sampled clans/);
    assert.ok(requested.some(url => url.endsWith('/v1/clans/players/99')));
    assert.ok(requested.some(url => url.endsWith('/v1/clans/players/100')));
    assert.equal(clan.members.some(member => member.userId === '777'), false, 'other-clan aggregate entries never enter R3V0 roster');
  } finally {
    globalThis.fetch = originalFetch;
    clearApiCache();
  }
});
