import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PermissionFlagsBits } from 'discord.js';
import { config } from './config.js';

// Official BIG Games / Pet Simulator 99 artwork only.
// The installer resolves artwork at runtime from the public BIG Games API
// (and, for pet portraits, first tries the official BIG Games GitHub Pet Icons folder).
// No generated/local emoji artwork is shipped with the bot.
export const OFFICIAL_PS99_EMOJI_SPECS = Object.freeze([
  { key: 'ps99Huge', name: 'ps99_huge', collection: 'Pets', preferredNames: ['Huge Cat', 'Huge Hell Rock', 'Huge Dog'], categories: ['Huge'], keywords: ['huge'], githubPetIcon: true, fallback: '🐾' },
  { key: 'ps99Pet', name: 'ps99_pet', collection: 'Pets', preferredNames: ['Cat', 'Dog', 'Axolotl'], keywords: ['cat', 'dog'], githubPetIcon: true, fallback: '🐾' },
  { key: 'ps99Titanic', name: 'ps99_titanic', collection: 'Pets', preferredNames: ['Titanic Cat', 'Titanic Jolly Cat'], categories: ['Titanic'], keywords: ['titanic'], githubPetIcon: true, fallback: '🐾' },
  { key: 'ps99Egg', name: 'ps99_egg', collection: 'Eggs', preferredNames: ['Cracked Egg', 'Spotted Egg'], keywords: ['egg'], fallback: '🥚' },
  { key: 'ps99Gems', name: 'ps99_gems', collection: 'Currency', preferredNames: ['Diamonds', 'Diamond'], keywords: ['diamond', 'gems'], fallback: '💎' },
  { key: 'ps99Coins', name: 'ps99_coins', collection: 'Currency', preferredNames: ['Coins', 'Coin'], keywords: ['coin'], fallback: '🪙' },
  { key: 'ps99Gift', name: 'ps99_gift', collection: 'Lootboxes', preferredNames: ['Global Event Gift', 'Large Christmas Present', 'Large Gift Bag', 'Gift Bag'], keywords: ['gift', 'present'], fallback: '🎁' },
  { key: 'ps99Battle', name: 'ps99_battle', collection: 'Lootboxes', preferredNames: ['Clan Gift'], keywords: ['clan gift'], activeBattleReward: true, fallback: '⚔️' },
  { key: 'ps99Rank', name: 'ps99_rank', collection: 'Ranks', preferredNames: ['Rank 1', '1'], keywords: ['rank'], fallback: '🏆' },
  { key: 'ps99Charm', name: 'ps99_charm', collection: 'Charms', preferredNames: ['Royalty', 'Glittering', 'Strength'], keywords: ['royalty', 'charm'], fallback: '🔷' },
  { key: 'ps99Enchant', name: 'ps99_enchant', collection: 'Enchants', preferredNames: ['Treasure Hunter', 'Criticals', 'Strong Pets', 'Diamonds'], keywords: ['treasure', 'critical', 'strong'], fallback: '📘' },
  { key: 'ps99Potion', name: 'ps99_potion', collection: 'Potions', preferredNames: ['Diamonds', 'Coins', 'Lucky Eggs'], keywords: ['diamond', 'coins', 'lucky'], fallback: '🧪' },
  { key: 'ps99Fruit', name: 'ps99_fruit', collection: 'Fruits', preferredNames: ['Apple', 'Orange', 'Rainbow Fruit'], keywords: ['apple', 'orange', 'fruit'], fallback: '🍎' },
  { key: 'ps99Hoverboard', name: 'ps99_hoverboard', collection: 'Hoverboards', preferredNames: ['Cat Hoverboard', 'Hoverboard'], keywords: ['hoverboard'], fallback: '🛹' },
  { key: 'ps99Ultimate', name: 'ps99_ultimate', collection: 'Ultimates', preferredNames: ['Tsunami', 'Black Hole', 'Pet Surge'], keywords: ['ultimate', 'tsunami', 'black hole'], fallback: '✨' },
  { key: 'ps99Booth', name: 'ps99_booth', collection: 'Booths', preferredNames: ['Cat Booth', 'Galaxy Booth'], keywords: ['booth'], fallback: '🏪' },
  { key: 'ps99Key', name: 'ps99_key', collection: 'MiscItems', preferredNames: ['Crystal Key', 'Tech Key', 'Void Key', 'Secret Key'], keywords: ['key'], fallback: '🔑' },
  { key: 'ps99Box', name: 'ps99_box', collection: 'Boxes', preferredNames: [], keywords: ['box'], fallback: '📦' },
  { key: 'ps99Rod', name: 'ps99_rod', collection: 'FishingRods', preferredNames: [], keywords: ['rod'], fallback: '🎣' },
  { key: 'ps99Shovel', name: 'ps99_shovel', collection: 'Shovels', preferredNames: [], keywords: ['shovel'], fallback: '⛏️' },
  { key: 'ps99Sprinkler', name: 'ps99_sprinkler', collection: 'Sprinklers', preferredNames: [], keywords: ['sprinkler'], fallback: '💦' },
  { key: 'ps99WateringCan', name: 'ps99_wateringcan', collection: 'WateringCans', preferredNames: [], keywords: ['watering'], fallback: '🚿' },
  { key: 'ps99Seed', name: 'ps99_seed', collection: 'Seeds', preferredNames: [], keywords: ['seed'], fallback: '🌱' },
  { key: 'ps99CharmRoyalty', name: 'ps99_charm_royalty', collection: 'Charms', preferredNames: ['Charm | Royalty'], keywords: ['royalty'], fallback: '👑' },
  { key: 'ps99CharmDiamonds', name: 'ps99_charm_diamonds', collection: 'Charms', preferredNames: ['Charm | Diamonds'], keywords: ['diamonds'], fallback: '💎' },
  { key: 'ps99PotionDiamonds', name: 'ps99_potion_diamonds', collection: 'Potions', preferredNames: ['Potion | Diamonds'], keywords: ['diamonds'], fallback: '🧪' },
  { key: 'ps99PotionLucky', name: 'ps99_potion_lucky', collection: 'Potions', preferredNames: ['Potion | Lucky'], keywords: ['lucky'], fallback: '🍀' },
  { key: 'ps99PotionHuge', name: 'ps99_potion_huge', collection: 'Potions', preferredNames: ['Potion | Huge'], keywords: ['huge'], fallback: '🧪' },
  { key: 'ps99ArcadeEgg', name: 'ps99_arcade_egg', collection: 'Lootboxes', preferredNames: ['Arcade Egg 1'], keywords: ['arcade egg'], fallback: '🥚' },
  { key: 'ps99HypeEgg', name: 'ps99_hype_egg', collection: 'Lootboxes', preferredNames: ['Hype Egg'], keywords: ['hype egg'], fallback: '🥚' }
]);

const GENERIC_FALLBACKS = Object.freeze({
  logo: '🟣', crown: '👑', member: '👤', leader: '👑', officer: '🛡️', verified: '✅', clan: '👥',
  battle: '⚔️', trophy: '🏆', points: '💎', giveaway: '🎁', ticket: '🎫', announce: '📣', event: '📅',
  refresh: '🔄', success: '✅', error: '❌', time: '⏱️', countdown: '⌛', settings: '⚙️', stats: '📈',
  level: '⭐', pets: '🐾', arcade: '🎮', rank1: '🥇', rank2: '🥈', rank3: '🥉'
});

const aliases = new Map([
  ['battle', 'ps99Battle'],
  ['points', 'ps99Gems'],
  ['pets', 'ps99Pet'],
  ['giveaway', 'ps99Gift'],
  ['arcade', 'ps99Pet'],
  ['trophy', 'ps99Rank']
]);
const fallbackByKey = new Map([
  ...Object.entries(GENERIC_FALLBACKS),
  ...OFFICIAL_PS99_EMOJI_SPECS.map(spec => [spec.key, spec.fallback])
]);
const nameByKey = new Map(OFFICIAL_PS99_EMOJI_SPECS.map(spec => [spec.key, spec.name]));
const registry = new Map();
let lastSetupSummary = null;
let availableCollectionsPromise = null;
const collectionPromises = new Map();

function canonicalKey(key) {
  const clean = String(key);
  return aliases.get(clean) || clean;
}

export function emoji(key, fallback = null) {
  const cleanKey = String(key);
  const canonical = canonicalKey(cleanKey);
  const item = registry.get(canonical);
  if (item?.id) return `<:${item.name}:${item.id}>`;
  return fallback ?? fallbackByKey.get(cleanKey) ?? fallbackByKey.get(canonical) ?? '';
}

export function emojiId(key) { return registry.get(canonicalKey(key))?.id || null; }
export function emojiName(key) { return nameByKey.get(canonicalKey(key)) || null; }
export function getEmojiRegistrySnapshot() { return Object.fromEntries([...registry.entries()].map(([key, value]) => [key, { ...value }])); }
export function getLastEmojiSetupSummary() { return lastSetupSummary; }

export function refreshEmojiRegistry(guild) {
  registry.clear();
  const byName = new Map(guild?.emojis?.cache?.map?.(item => [item.name, item]) || []);
  for (const [key, name] of nameByKey) {
    const existing = byName.get(name);
    if (existing) registry.set(key, { id: existing.id, name: existing.name, animated: Boolean(existing.animated) });
  }
  return getEmojiRegistrySnapshot();
}

function normalizedRecordName(record) {
  const data = record?.configData || record?.data || record || {};
  return String(record?.configName || data.DisplayName || data.displayName || data.name || data.Name || data.id || data.ID || '').trim();
}

function assetId(value) {
  const match = String(value ?? '').match(/(?:rbxassetid:\/\/)?(\d{5,})/i);
  return match ? match[1] : null;
}

const IMAGE_KEY_RE = /(thumbnail|icon|image|texture|art|picture|sprite)/i;

export function extractImageAssetCandidates(record) {
  const root = record?.configData || record?.data || record || {};
  const found = [];
  const seenObjects = new Set();
  const seenIds = new Set();

  function visit(value, key = '', path = '', depth = 0) {
    if (depth > 5 || value == null) return;
    if (typeof value === 'string' || typeof value === 'number') {
      const id = assetId(value);
      if (!id || seenIds.has(id)) return;
      const raw = String(value);
      const imageKey = IMAGE_KEY_RE.test(String(key));
      const explicitAsset = /rbxassetid:\/\//i.test(raw);
      if (!imageKey && !explicitAsset) return;
      seenIds.add(id);
      found.push({ id, path, score: (imageKey ? 20 : 0) + (explicitAsset ? 8 : 0) + (/thumbnail/i.test(key) ? 5 : 0) + (/icon/i.test(key) ? 4 : 0) });
      return;
    }
    if (typeof value !== 'object') return;
    if (seenObjects.has(value)) return;
    seenObjects.add(value);
    for (const [childKey, child] of Object.entries(value)) {
      visit(child, childKey, path ? `${path}.${childKey}` : childKey, depth + 1);
    }
  }

  visit(root);
  return found.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

function normalizeName(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function scoreOfficialRecord(record, spec) {
  const name = normalizeName(normalizedRecordName(record));
  const category = normalizeName(record?.category || record?.configData?.Category || record?.configData?.category || '');
  const preferred = (spec.preferredNames || []).map(normalizeName).filter(Boolean);
  const categories = (spec.categories || []).map(normalizeName).filter(Boolean);
  const keywords = (spec.keywords || []).map(normalizeName).filter(Boolean);
  let score = 0;
  const exact = preferred.indexOf(name);
  if (exact >= 0) score += 1000 - exact * 10;
  else {
    for (let i = 0; i < preferred.length; i++) {
      if (name.includes(preferred[i]) || preferred[i].includes(name)) score = Math.max(score, 700 - i * 8);
    }
  }
  if (categories.includes(category)) score += 500;
  for (const word of keywords) {
    if (word && name.includes(word)) score += 160;
    if (word && category.includes(word)) score += 80;
  }
  score += Math.min(40, extractImageAssetCandidates(record).length * 10);
  return score;
}

function orderedCandidateRecords(records, spec) {
  return (Array.isArray(records) ? records : [])
    .map((record, index) => ({ record, index, score: scoreOfficialRecord(record, spec), images: extractImageAssetCandidates(record) }))
    .filter(row => row.images.length)
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  if (json?.status === 'error') throw new Error(json?.error?.message || 'BIG Games API error');
  return Object.hasOwn(json ?? {}, 'data') ? json.data : json;
}

async function getAvailableCollections() {
  if (!availableCollectionsPromise) {
    availableCollectionsPromise = fetchJson(`${config.apiBase}/api/collections`)
      .then(rows => new Set((Array.isArray(rows) ? rows : []).map(String)))
      .catch(error => {
        availableCollectionsPromise = null;
        throw error;
      });
  }
  return availableCollectionsPromise;
}

async function getCollection(name) {
  if (!collectionPromises.has(name)) {
    collectionPromises.set(name, fetchJson(`${config.apiBase}/api/collection/${encodeURIComponent(name)}`).catch(error => {
      collectionPromises.delete(name);
      throw error;
    }));
  }
  return collectionPromises.get(name);
}

function normalizeFileKey(value) {
  return String(value ?? '').toLowerCase().replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9]+/g, '');
}

async function fetchGithubPetIcon(spec) {
  if (!spec.githubPetIcon) return null;
  const response = await fetch('https://api.github.com/repos/BIG-Games-LLC/ps99-public-api-docs/contents/Pet%20Icons?ref=master', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'R3V0-PS99-Discord-Bot' },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('GitHub Pet Icons listing was not an array');
  const preferred = (spec.preferredNames || []).map(normalizeFileKey).filter(Boolean);
  const files = rows.filter(row => row?.type === 'file' && row?.download_url);
  const match = files.find(row => preferred.includes(normalizeFileKey(row.name)))
    || files.find(row => preferred.some(key => normalizeFileKey(row.name).includes(key) || key.includes(normalizeFileKey(row.name))));
  if (!match) return null;
  const imageResponse = await fetch(match.download_url, { headers: { 'User-Agent': 'R3V0-PS99-Discord-Bot' }, signal: AbortSignal.timeout(12_000) });
  if (!imageResponse.ok) throw new Error(`GitHub image HTTP ${imageResponse.status}`);
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  if (!bytes.length || bytes.length > 8_000_000) throw new Error(`Invalid GitHub image size (${bytes.length} bytes)`);
  return { buffer: await normalizeEmojiImage(bytes), source: `BIG Games GitHub / Pet Icons / ${match.name}`, assetId: null, recordName: match.name };
}

async function activeBattleRewardName() {
  try {
    const battle = await fetchJson(`${config.apiBase}/api/activeClanBattle`);
    const rewards = battle?.configData?.PlacementRewards || battle?.PlacementRewards || [];
    for (const reward of rewards) {
      const id = reward?.Item?._data?.id || reward?.Item?.id || reward?.item?._data?.id || reward?.item?.id;
      if (id) return String(id);
    }
  } catch {}
  return null;
}

async function fetchImageBufferByAssetId(id) {
  const response = await fetch(`${config.apiBase}/image/${id}`, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (type && !type.startsWith('image/')) throw new Error(`Image endpoint returned ${type}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 8_000_000) throw new Error(`Invalid image size (${bytes.length} bytes)`);
  return normalizeEmojiImage(bytes);
}

async function fetchOfficialPs99Image(spec, availableCollections, usedAssetIds) {
  if (!availableCollections.has(spec.collection)) throw new Error(`Official collection ${spec.collection} is not currently exposed by BIG Games.`);
  let effectiveSpec = spec;
  if (spec.activeBattleReward) {
    const rewardName = await activeBattleRewardName();
    if (rewardName) effectiveSpec = { ...spec, preferredNames: [rewardName, ...(spec.preferredNames || [])] };
  }

  const records = await getCollection(spec.collection);
  const candidates = orderedCandidateRecords(records, effectiveSpec);
  if (!candidates.length) throw new Error(`No image-backed records found in ${spec.collection}.`);

  const errors = [];
  for (const candidate of candidates.slice(0, 24)) {
    for (const image of candidate.images.slice(0, 4)) {
      if (usedAssetIds?.has(image.id)) continue;
      try {
        const buffer = await fetchImageBufferByAssetId(image.id);
        return {
          buffer,
          source: `BIG Games API ${spec.collection}:${normalizedRecordName(candidate.record) || image.id}`,
          assetId: image.id,
          recordName: normalizedRecordName(candidate.record) || image.id,
          imageField: image.path
        };
      } catch (error) {
        errors.push(`${image.id}: ${error.message}`);
      }
    }
  }
  throw new Error(`No decodable image found in ${spec.collection}${errors.length ? ` (${errors.slice(0, 3).join('; ')})` : ''}.`);
}

async function normalizeEmojiImage(buffer) {
  const image = await loadImage(buffer);
  const size = 128;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const scale = Math.min(size / image.width, size / image.height) * 0.94;
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toBuffer('image/png');
}

function hasPermission(guild, permission) {
  if (!permission) return false;
  return Boolean(guild?.members?.me?.permissions?.has?.(permission));
}
function hasCreateExpressions(guild) {
  const permissions = guild?.members?.me?.permissions;
  if (!permissions) return false;
  return Boolean(
    hasPermission(guild, PermissionFlagsBits.Administrator) ||
    hasPermission(guild, PermissionFlagsBits.CreateGuildExpressions) ||
    hasPermission(guild, PermissionFlagsBits.ManageGuildExpressions) ||
    hasPermission(guild, PermissionFlagsBits.ManageEmojisAndStickers)
  );
}
function hasManageExpressions(guild) {
  return Boolean(
    hasPermission(guild, PermissionFlagsBits.Administrator) ||
    hasPermission(guild, PermissionFlagsBits.ManageGuildExpressions) ||
    hasPermission(guild, PermissionFlagsBits.ManageEmojisAndStickers)
  );
}
async function createEmoji(guild, name, attachment) {
  return guild.emojis.create({ attachment, name, reason: 'R3V0 bot: official Pet Simulator 99 artwork from BIG Games' });
}

export async function ensureServerEmojis(guild) {
  if (!guild) throw new Error('Guild is required for emoji setup.');

  const initial = await guild.emojis.fetch();
  refreshEmojiRegistry(guild);
  let availableCollections = new Set();
  let collectionDiscoveryError = null;
  try { availableCollections = await getAvailableCollections(); }
  catch (error) { collectionDiscoveryError = error.message; }

  const summary = {
    created: [], existing: [], failed: [], sources: {},
    totalWanted: OFFICIAL_PS99_EMOJI_SPECS.length,
    createPermission: hasCreateExpressions(guild), managePermission: hasManageExpressions(guild),
    permission: hasCreateExpressions(guild), guildId: String(guild.id || ''), guildName: String(guild.name || 'Unknown guild'),
    beforeCount: initial.size, afterCount: initial.size, verifiedWanted: 0, actualOfficialNames: [],
    availableCollections: [...availableCollections].sort(), collectionDiscoveryError,
    discoveredCollections: availableCollections.size
  };
  const existingByName = new Map(initial.map(item => [item.name, item]));
  const usedAssetIds = new Set();

  // Preserve source IDs already known from the previous run in this process so newly-created icons stay visually distinct.
  for (const meta of Object.values(lastSetupSummary?.sources || {})) if (meta?.assetId) usedAssetIds.add(String(meta.assetId));

  for (const spec of OFFICIAL_PS99_EMOJI_SPECS) {
    const existing = existingByName.get(spec.name);
    if (existing) {
      registry.set(spec.key, { id: existing.id, name: existing.name, animated: Boolean(existing.animated) });
      summary.existing.push(spec.name);
      continue;
    }
    if (!summary.createPermission) {
      summary.failed.push({ name: spec.name, collection: spec.collection, error: 'Bot lacks Create Expressions / compatible emoji-create permission.' });
      continue;
    }
    if (collectionDiscoveryError) {
      summary.failed.push({ name: spec.name, collection: spec.collection, error: `Could not load /api/collections: ${collectionDiscoveryError}` });
      continue;
    }

    try {
      let official = null;
      let githubError = null;
      if (spec.githubPetIcon) {
        try { official = await fetchGithubPetIcon(spec); }
        catch (error) { githubError = error.message; }
      }
      if (!official) official = await fetchOfficialPs99Image(spec, availableCollections, usedAssetIds);

      const created = await createEmoji(guild, spec.name, official.buffer);
      const verified = await guild.emojis.fetch(created.id).catch(() => null);
      if (!verified || verified.name !== spec.name) throw new Error(`Discord created ${spec.name}, but it was not present when fetched back.`);

      existingByName.set(verified.name, verified);
      registry.set(spec.key, { id: verified.id, name: verified.name, animated: Boolean(verified.animated) });
      summary.created.push(spec.name);
      if (official.assetId) usedAssetIds.add(String(official.assetId));
      summary.sources[spec.name] = {
        source: official.source, assetId: official.assetId, recordName: official.recordName,
        imageField: official.imageField, discordEmojiId: verified.id,
        ...(githubError ? { githubAttempt: githubError } : {})
      };
    } catch (error) {
      summary.failed.push({ name: spec.name, collection: spec.collection, error: error.message });
      registry.delete(spec.key);
    }
  }

  const finalCollection = await guild.emojis.fetch();
  summary.afterCount = finalCollection.size;
  const finalByName = new Map(finalCollection.map(item => [item.name, item]));
  summary.actualOfficialNames = OFFICIAL_PS99_EMOJI_SPECS.map(spec => spec.name).filter(name => finalByName.has(name));
  summary.verifiedWanted = summary.actualOfficialNames.length;
  for (const name of [...summary.created]) {
    if (!finalByName.has(name)) {
      summary.created.splice(summary.created.indexOf(name), 1);
      summary.failed.push({ name, error: 'Emoji disappeared before the final Discord verification fetch.' });
    }
  }

  refreshEmojiRegistry(guild);
  lastSetupSummary = summary;
  return summary;
}

export async function inspectServerEmojis(guild) {
  if (!guild) throw new Error('Guild is required for emoji inspection.');
  const collection = await guild.emojis.fetch();
  const names = new Set(collection.map(item => item.name));
  const wanted = OFFICIAL_PS99_EMOJI_SPECS.map(spec => spec.name);
  return {
    guildId: String(guild.id || ''), guildName: String(guild.name || 'Unknown guild'), totalCustomEmojis: collection.size,
    officialPresent: wanted.filter(name => names.has(name)), officialMissing: wanted.filter(name => !names.has(name)),
    allNames: [...collection.values()].map(item => item.name).sort((a, b) => a.localeCompare(b))
  };
}

export function formatLiveEmojiStatus(status) {
  if (!status) return 'Live emoji status unavailable.';
  return [
    `**Live guild:** ${status.guildName} (\`${status.guildId}\`)`,
    `**Discord currently reports:** ${status.totalCustomEmojis} custom emoji`,
    `**Official PS99 present:** ${status.officialPresent.length}/${OFFICIAL_PS99_EMOJI_SPECS.length}`,
    status.officialPresent.length ? `**Present:** ${status.officialPresent.slice(0, 15).map(name => `\`${name}\``).join(', ')}${status.officialPresent.length > 15 ? ` … +${status.officialPresent.length - 15}` : ''}` : '**Present:** none',
    status.officialMissing.length ? `**Missing:** ${status.officialMissing.slice(0, 12).map(name => `\`${name}\``).join(', ')}${status.officialMissing.length > 12 ? ` … +${status.officialMissing.length - 12}` : ''}` : '**Missing:** none'
  ].join('\n');
}

export function formatEmojiSetupSummary(summary) {
  if (!summary) return 'Official PS99 emoji setup has not run yet.';
  const sourceLines = Object.entries(summary.sources || {}).slice(0, 8).map(([name, meta]) =>
    `• \`${name}\` ← ${meta.source}${meta.assetId ? ` (asset ${meta.assetId})` : ''}${meta.discordEmojiId ? ` · Discord ID ${meta.discordEmojiId}` : ''}`
  );
  const officialNames = (summary.actualOfficialNames || []).map(name => `\`${name}\``).join(', ');
  return [
    '**Mode:** official BIG Games / Pet Simulator 99 artwork only',
    `**Target guild:** ${summary.guildName || 'Unknown'}${summary.guildId ? ` (\`${summary.guildId}\`)` : ''}`,
    `**BIG Games collections discovered:** ${summary.discoveredCollections ?? 0}${summary.collectionDiscoveryError ? ` · ERROR: ${summary.collectionDiscoveryError}` : ''}`,
    `**Discord emoji count:** ${summary.beforeCount ?? '?'} → ${summary.afterCount ?? '?'}`,
    `**Verified official emojis:** ${summary.verifiedWanted ?? 0}/${summary.totalWanted ?? OFFICIAL_PS99_EMOJI_SPECS.length}`,
    `**Created and verified:** ${summary.created.length}`,
    `**Already present:** ${summary.existing.length}`,
    `**Failed:** ${summary.failed.length}`,
    `**Create Expressions:** ${summary.createPermission ? 'Yes' : 'No'}`,
    `**Manage Expressions:** ${summary.managePermission ? 'Yes' : 'No'}`,
    officialNames ? `**Actually present now:** ${officialNames}` : '**Actually present now:** none of the requested PS99 emojis',
    sourceLines.length ? `\n**Official artwork sources**\n${sourceLines.join('\n')}` : '',
    summary.failed.length ? `\n**Failures**\n${summary.failed.slice(0, 8).map(row => `• \`${row.name}\`${row.collection ? ` [${row.collection}]` : ''} — ${row.error}`).join('\n')}` : ''
  ].filter(Boolean).join('\n');
}
