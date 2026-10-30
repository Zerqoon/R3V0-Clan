/** Pure helpers for the R3V0 PS99 arcade games. */
export function petNameOf(pet) {
  return String(pet?.configName ?? pet?.configData?.id ?? pet?.configData?.name ?? pet?.name ?? '').trim();
}

export function normalizeArcadeAnswer(value) {
  return String(value ?? '').normalize('NFKC').replace(/[\u200B-\u200F\uFEFF]/g, '')
    .trim().toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]/gu, '');
}

export function extractArcadeGuess(content, knownNames = []) {
  const raw = String(content ?? '').trim();
  if (!raw || raw.length > 140 || raw.startsWith('/')) return null;
  const marked = raw.match(/^(?:!guess|guess|!answer|answer|zgaduj(?:ę|e)?)\s*[:\-]?\s*(.+)$/iu);
  if (marked?.[1]?.trim()) return marked[1].trim();
  const normalized = normalizeArcadeAnswer(raw);
  if (!normalized) return null;
  const known = new Set((Array.isArray(knownNames) ? knownNames : []).map(normalizeArcadeAnswer).filter(Boolean));
  return known.has(normalized) ? raw : null;
}

export function isArcadeAnswerCorrect(guess, answer) {
  const g = normalizeArcadeAnswer(guess);
  return Boolean(g) && g === normalizeArcadeAnswer(answer);
}

function randomIndex(length, random) {
  const n = Number(random());
  return Math.max(0, Math.min(length - 1, Math.floor((Number.isFinite(n) ? n : 0) * length)));
}

/** Keep a known rarity readable and shuffle only the pet's actual name. */
export function splitPetRarity(value) {
  const source = String(value ?? '').trim();
  const match = source.match(/^(Huge|Titanic|Gargantuan)\s+(.+)$/iu);
  if (!match) return { rarity: null, name: source };
  return { rarity: match[1][0].toLocaleUpperCase('en-US') + match[1].slice(1).toLocaleLowerCase('en-US'), name: match[2].trim() };
}

function scrambleWord(value, random) {
  const original = Array.from(String(value));
  if (original.length < 2) return String(value);
  const source = original.map(char => char.toLocaleLowerCase('en-US'));
  let shuffled = [...source];
  for (let attempt = 0; attempt < 16; attempt++) {
    shuffled = [...source];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1, random);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (shuffled.join('') !== source.join('')) break;
  }
  if (shuffled.join('') === source.join('') && new Set(source).size > 1) {
    shuffled.push(shuffled.shift());
  }
  // Keep ordinary title casing so the puzzle reads cleanly in Discord.
  if (/^\p{Lu}/u.test(original[0])) shuffled[0] = shuffled[0].toLocaleUpperCase('en-US');
  return shuffled.join('');
}

/** Shuffle letters inside each word, never move letters between words. */
export function scramblePetWords(value, random = Math.random) {
  return String(value ?? '').replace(/[\p{L}\p{N}]+/gu, word => scrambleWord(word, random));
}

/** Keep a known rarity prefix readable, scrambling only the pet name that follows it. */
export function scramblePetName(value, random = Math.random) {
  const { rarity, name } = splitPetRarity(value);
  const scrambledName = scramblePetWords(name, random);
  return rarity ? `${rarity} ${scrambledName}` : scrambledName;
}

/*
 * Curated semantic clues for known PS99 pet-name tokens. Matching is by complete
 * words (or complete phrases), never substring matching. Each clue is explicit:
 * moon belongs to moon-named pets, snowflake to snowflake-named pets, and so on.
 */
const EMOJI_CLUES = [
  { terms: ['hell rock'], emojis: ['🌋', '🪨'], hints: ['A rocky pet with a volcanic theme.', 'Its name combines a fiery underworld with a stone.'] },
  { terms: ['hot dog'], emojis: ['🌭'], hints: ['A food-shaped pet inspired by a familiar street snack.', 'Its name is also a common food order.'] },
  { terms: ['marshmallow'], emojis: ['☁️', '🍬'], hints: ['A soft, sweet confection.', 'Its name is often associated with a fluffy white treat.'] },
  { terms: ['snowflake'], emojis: ['❄️', '🌨️'], hints: ['A tiny shape associated with winter weather.', 'Its name refers to frozen precipitation.'] },
  { terms: ['leprechaun'], emojis: ['🍀', '🪙'], hints: ['A character from Irish folklore.', 'Stories link this character with a hidden pot of gold.'] },
  { terms: ['vampire'], emojis: ['🧛', '🦇'], hints: ['A creature from gothic folklore.', 'Classic stories describe it as nocturnal and blood-seeking.'] },
  { terms: ['kitsune'], emojis: ['🦊', '🎭'], hints: ['A figure from Japanese folklore.', 'It is commonly portrayed as a magical fox spirit.'] },
  { terms: ['dinosaur', 'dino'], emojis: ['🦖', '🦕'], hints: ['A creature from prehistoric life.', 'Some members of this group were enormous reptiles.'] },
  { terms: ['reindeer'], emojis: ['🦌', '🛷'], hints: ['A northern deer species.', 'It is strongly associated with winter holiday stories.'] },
  { terms: ['crocodile'], emojis: ['🐊', '🌿'], hints: ['A large reptile that lives near water.', 'It has powerful jaws and armored-looking skin.'] },
  { terms: ['axolotl'], emojis: ['🦎', '💧'], hints: ['An aquatic amphibian known for its frilly external gills.', 'It is famous for keeping juvenile features as an adult.'] },
  { terms: ['penguin'], emojis: ['🐧', '🌊'], hints: ['A flightless bird.', 'It is an excellent swimmer and is often associated with cold regions.'] },
  { terms: ['panda'], emojis: ['🐼', '🎋'], hints: ['A black-and-white mammal.', 'Bamboo makes up much of its diet.'] },
  { terms: ['monkey'], emojis: ['🐒', '🌴'], hints: ['A primate known for climbing.', 'Some species are often portrayed in tropical settings.'] },
  { terms: ['rabbit', 'bunny'], emojis: ['🐇', '🥕'], hints: ['A small mammal with long ears.', 'It is often associated with carrots in cartoons.'] },
  { terms: ['chicken'], emojis: ['🐔', '🥚'], hints: ['A common domesticated bird.', 'It is known for laying eggs.'] },
  { terms: ['unicorn'], emojis: ['🦄', '🌈'], hints: ['A legendary animal.', 'Traditional depictions give it a single horn.'] },
  { terms: ['angel'], emojis: ['😇', '🪽'], hints: ['A benevolent supernatural figure.', 'Art often depicts it with wings or a halo.'] },
  { terms: ['demon'], emojis: ['😈', '🔥'], hints: ['A supernatural figure from religious or fantasy stories.', 'It is often used as the opposite of an angel.'] },
  { terms: ['ghost'], emojis: ['👻', '🌫️'], hints: ['A spirit said to remain among the living.', 'It is often portrayed as pale and translucent.'] },
  { terms: ['moon'], emojis: ['🌙', '🌌'], hints: ['A natural object visible in the night sky.', 'It orbits a planet and reflects sunlight.'] },
  { terms: ['bat'], emojis: ['🦇'], hints: ['A flying mammal.', 'Many species are active at night.'] },
  { terms: ['fox'], emojis: ['🦊', '🌲'], hints: ['A small wild canine.', 'Folklore often portrays it as clever.'] },
  { terms: ['cat'], emojis: ['🐈', '🐾'], hints: ['A domesticated feline.', 'It is known for retractable claws and whiskers.'] },
  { terms: ['dog'], emojis: ['🐕', '🦴'], hints: ['A domesticated canine.', 'It is often described as a loyal companion.'] },
  { terms: ['dragon'], emojis: ['🐉', '🔥'], hints: ['A mythical creature found in many cultures.', 'Fantasy stories often give it scales and fire breath.'] },
  { terms: ['shark'], emojis: ['🦈', '🌊'], hints: ['A large fish with a cartilaginous skeleton.', 'It has several rows of replaceable teeth.'] },
  { terms: ['cow'], emojis: ['🐄', '🌾'], hints: ['A farm animal raised for milk.', 'It is a member of the cattle family.'] },
  { terms: ['bee'], emojis: ['🐝', '🍯'], hints: ['A flying insect that visits flowers.', 'Some species produce honey.'] },
  { terms: ['duck'], emojis: ['🦆', '💧'], hints: ['A water bird with a broad bill.', 'It often paddles across ponds.'] },
  { terms: ['tiger'], emojis: ['🐅', '🌿'], hints: ['A large wild cat.', 'Its coat is marked with dark stripes.'] },
  { terms: ['lion'], emojis: ['🦁', '🌾'], hints: ['A large wild cat.', 'Adult males are known for their manes.'] },
  { terms: ['fish'], emojis: ['🐟', '🌊'], hints: ['An aquatic animal that breathes through gills.', 'It lives in water and usually has fins.'] },
  { terms: ['balloon'], emojis: ['🎈', '🎉'], hints: ['A light object filled with gas or air.', 'It is commonly used at celebrations.'] },
  { terms: ['cupcake'], emojis: ['🧁', '🍰'], hints: ['A small baked dessert.', 'It is usually served in a paper cup with frosting.'] },
  { terms: ['cookie'], emojis: ['🍪', '🥛'], hints: ['A small baked sweet.', 'It is commonly dipped in milk.'] },
  { terms: ['elephant'], emojis: ['🐘', '🌿'], hints: ['A very large land mammal.', 'It has a trunk and large ears.'] },
  { terms: ['turtle'], emojis: ['🐢', '💧'], hints: ['A reptile.', 'Its body is protected by a shell.'] },
  { terms: ['owl'], emojis: ['🦉', '🌙'], hints: ['A bird of prey.', 'Many species are active at night and have forward-facing eyes.'] },
  { terms: ['parrot'], emojis: ['🦜', '🌴'], hints: ['A colorful bird.', 'Some species can mimic sounds and speech.'] },
  { terms: ['bear'], emojis: ['🐻', '🌲'], hints: ['A large mammal.', 'Many species hibernate or enter winter dens.'] },
  { terms: ['hamster'], emojis: ['🐹', '🌻'], hints: ['A small rodent often kept as a pet.', 'It stores food in cheek pouches.'] },
  { terms: ['snake'], emojis: ['🐍', '🌿'], hints: ['A legless reptile.', 'It moves by slithering.'] },
  { terms: ['spider'], emojis: ['🕷️', '🕸️'], hints: ['An eight-legged arachnid.', 'Many species make silk webs.'] },
  { terms: ['pig'], emojis: ['🐖', '🌾'], hints: ['A farm mammal.', 'It has a snout and is often associated with mud.'] },
  { terms: ['horse'], emojis: ['🐎', '🌾'], hints: ['A large hoofed mammal.', 'Humans have used it for riding and transport.'] },
  { terms: ['santa'], emojis: ['🎅', '🎁'], hints: ['A festive folklore character.', 'Stories connect it with gifts delivered in winter.'] },
  { terms: ['pumpkin'], emojis: ['🎃', '🍂'], hints: ['An orange winter squash.', 'It is often carved for Halloween.'] },
  { terms: ['koala'], emojis: ['🐨', '🌿'], hints: ['An Australian marsupial.', 'It spends much of its time in eucalyptus trees.'] },
  { terms: ['banana'], emojis: ['🍌', '🌴'], hints: ['A long, curved fruit.', 'It has a peel and grows in bunches.'] },
  { terms: ['pineapple'], emojis: ['🍍', '🌴'], hints: ['A tropical fruit with a spiky crown.', 'Its skin is rough and patterned.'] },
  { terms: ['watermelon'], emojis: ['🍉', '☀️'], hints: ['A large fruit with a green rind.', 'The inside is usually red or pink and juicy.'] },
  { terms: ['chest'], emojis: ['🧰', '💎'], hints: ['A container for storing valuables.', 'In games it may contain loot or rewards.'] },
  { terms: ['rock'], emojis: ['🪨', '⛰️'], hints: ['A naturally occurring solid made of minerals.', 'It can form part of mountains and cliffs.'] },
  { terms: ['marshmallow chick'], emojis: ['🐥', '🍬'], hints: ['A sweet shaped like a young bird.', 'It is often associated with springtime candy.'] }
];

function petTokens(value) {
  // Split PascalCase IDs before tokenising, so `VampireBat` remains searchable.
  const withBoundaries = String(value ?? '').replace(/([a-z])([A-Z])/gu, '$1 $2').replace(/([A-Z])([A-Z][a-z])/gu, '$1 $2');
  return withBoundaries.normalize('NFKC').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu) || [];
}

function findTermSpans(tokens, term) {
  const phraseTokens = petTokens(term);
  if (!phraseTokens.length || phraseTokens.length > tokens.length) return [];
  const spans = [];
  for (let start = 0; start <= tokens.length - phraseTokens.length; start++) {
    if (phraseTokens.every((word, offset) => tokens[start + offset] === word)) {
      spans.push({ start, end: start + phraseTokens.length, term: phraseTokens.join(' ') });
    }
  }
  return spans;
}

/** Return clues only when a whole pet-name word or phrase has a curated meaning. */
export function emojiClueForPet(name) {
  const tokens = petTokens(name);
  if (!tokens.length) return null;
  const candidates = [];
  for (const definition of EMOJI_CLUES) {
    for (const term of definition.terms) {
      for (const span of findTermSpans(tokens, term)) candidates.push({ ...span, definition });
    }
  }
  if (!candidates.length) return null;
  // A phrase clue such as "hell rock" replaces its less-specific sub-clue "rock".
  const matches = candidates.filter((candidate, index) => !candidates.some((other, otherIndex) =>
    otherIndex !== index && other.start <= candidate.start && other.end >= candidate.end &&
    (other.end - other.start) > (candidate.end - candidate.start)));
  const uniqueDefinitions = [];
  const seen = new Set();
  for (const match of matches) {
    const key = `${match.definition.terms[0]}:${match.start}:${match.end}`;
    if (!seen.has(key)) { seen.add(key); uniqueDefinitions.push(match); }
  }
  const selected = uniqueDefinitions.slice(0, 3);
  const emojis = [];
  const hints = [];
  const matchedWords = [];
  for (const match of selected) {
    matchedWords.push(match.term);
    for (const emoji of match.definition.emojis) if (!emojis.includes(emoji)) emojis.push(emoji);
    for (const hint of match.definition.hints) if (!hints.includes(hint)) hints.push(hint);
  }
  return { emojis: emojis.slice(0, 5), matchedWords, hints: hints.slice(0, 3) };
}

export function pickEmojiPet(pets, random = Math.random) {
  const options = (Array.isArray(pets) ? pets : []).map(pet => {
    const name = petNameOf(pet);
    return { pet, name, clue: emojiClueForPet(name) };
  }).filter(row => row.name && row.clue?.emojis?.length && row.clue.hints?.length);
  if (!options.length) throw new Error('No pets with curated semantic emoji clues were found in the PS99 collection.');
  // Prefer puzzles with more than one independently supported clue, while preserving variety.
  const multi = options.filter(row => row.clue.matchedWords.length >= 2 && row.clue.emojis.length >= 2);
  const pool = multi.length ? multi : options;
  return pool[randomIndex(pool.length, random)];
}

function rapName(item) {
  return String(item?.configData?.id ?? item?.configData?.name ?? item?.id ?? '').trim();
}

export function pickHigherLowerPair(items, random = Math.random) {
  const byName = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const category = String(item?.category ?? '').toLocaleLowerCase('en-US');
    const config = item?.configData ?? {};
    const name = rapName(item);
    const value = Math.floor(Number(item?.value));
    const isNormal = !(Number(config.pt) > 0) && !(Boolean(config.sh) || Number(config.sh) === 1);
    const isPet = category.includes('pet') || category === 'huge' || Boolean(config.huge) || /\b(huge|titanic|gargantuan)\b/i.test(name);
    if (!name || !isPet || !isNormal || !Number.isFinite(value) || value <= 0) continue;
    const key = name.toLocaleLowerCase('en-US');
    const previous = byName.get(key);
    if (!previous || value > previous.value) byName.set(key, {
      name, value, thumbnail: config.thumbnail || config.goldenThumbnail || null
    });
  }
  const pool = [...byName.values()];
  if (pool.length < 2) throw new Error('The public RAP dataset does not contain enough distinct pets with valid values.');
  const aIndex = randomIndex(pool.length, random);
  const a = pool[aIndex];
  const bPool = pool.filter((pet, index) => index !== aIndex && pet.value !== a.value);
  if (!bPool.length) throw new Error('The public RAP dataset does not contain two pets with different values.');
  const b = bPool[randomIndex(bPool.length, random)];
  return { a, b, answer: a.value > b.value ? 'A' : 'B' };
}

export function petNamesFromCollection(pets) {
  const unique = new Map();
  for (const pet of Array.isArray(pets) ? pets : []) {
    const name = petNameOf(pet);
    if (name && name.length <= 120) unique.set(normalizeArcadeAnswer(name), name);
  }
  return [...unique.values()];
}
