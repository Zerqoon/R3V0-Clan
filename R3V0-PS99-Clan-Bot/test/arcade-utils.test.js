import test from 'node:test';
import assert from 'node:assert/strict';
import {
  petNameOf, normalizeArcadeAnswer, extractArcadeGuess, isArcadeAnswerCorrect,
  splitPetRarity, scramblePetName, emojiClueForPet, pickEmojiPet, pickHigherLowerPair, petNamesFromCollection
} from '../src/arcade-utils.js';

test('pet name helpers normalize answers and only accept named guesses or explicit attempts', () => {
  const known = ['Huge Hell Rock', 'Titanic Kitsune Fox'];
  assert.equal(petNameOf({ configName: 'Huge Hell Rock' }), 'Huge Hell Rock');
  assert.equal(normalizeArcadeAnswer('Huge-Hell_Rock!'), 'hugehellrock');
  assert.equal(extractArcadeGuess('Huge Hell Rock', known), 'Huge Hell Rock');
  assert.equal(extractArcadeGuess('guess: Huge Hlel Rock', known), 'Huge Hlel Rock');
  assert.equal(extractArcadeGuess('good evening', known), null);
  assert.equal(extractArcadeGuess('/pet-scramble', known), null);
  assert.equal(isArcadeAnswerCorrect('titanic kitsune fox!', 'Titanic Kitsune Fox'), true);
});

test('Pet Scramble keeps rarity separate and shuffles each word without moving letters across words', () => {
  const parts = splitPetRarity('Huge Hell Rock');
  assert.deepEqual(parts, { rarity: 'Huge', name: 'Hell Rock' });
  const puzzle = scramblePetName('Hell Rock', () => 0.41);
  const letters = value => Array.from(value.toLocaleLowerCase('en-US')).filter(char => /[\p{L}\p{N}]/u.test(char)).sort().join('');
  const originalWords = parts.name.split(' ');
  const puzzleWords = puzzle.split(' ');
  assert.equal(puzzleWords.length, originalWords.length, 'word count and boundaries stay the same');
  for (let i = 0; i < originalWords.length; i++) {
    assert.equal(letters(puzzleWords[i]), letters(originalWords[i]), `word ${i + 1} retains exactly its letters`);
  }
  assert.notEqual(puzzle, parts.name, 'the pet name is scrambled');
  assert.match(scramblePetName('Huge Hell Rock', () => 0.41), /^Huge\s+/u, 'rarity prefix remains readable');
});

test('Emoji Pet uses curated, exact-word clues and never guesses by unrelated substring', () => {
  assert.deepEqual(emojiClueForPet('Huge Hell Rock').emojis, ['🌋', '🪨']);
  assert.ok(emojiClueForPet('Huge Hell Rock').hints.length >= 2);

  const vampire = emojiClueForPet('Huge Vampire Bat');
  assert.ok(vampire.emojis.includes('🧛'));
  assert.ok(vampire.emojis.includes('🦇'));
  assert.ok(!vampire.emojis.includes('🌙'), 'vampire clues do not insert unrelated moon imagery');
  assert.ok(!vampire.emojis.includes('❄️'), 'a vampire clue must not contain snowflake imagery');

  const snowflake = emojiClueForPet('Huge Snowflake');
  assert.ok(snowflake.emojis.includes('❄️'));
  assert.ok(!snowflake.emojis.includes('🧛'), 'a snowflake clue must not contain vampire imagery');

  const leprechaun = emojiClueForPet('Huge Leprechaun');
  assert.ok(leprechaun.emojis.includes('🍀'));
  assert.ok(leprechaun.emojis.includes('🪙'));
  assert.ok(!leprechaun.emojis.includes('🌙'), 'moon imagery must not be assigned to a leprechaun');
  assert.ok(emojiClueForPet('Huge Moon').emojis.includes('🌙'));
  assert.deepEqual(emojiClueForPet('HugeVampireBat').matchedWords, ['vampire', 'bat'], 'camel-case API IDs are split into exact words');
  assert.deepEqual(emojiClueForPet('HugeLeprechaun').emojis, ['🍀', '🪙'], 'camel-case leprechaun names never inherit moon imagery');
  assert.equal(emojiClueForPet('Caterpillar'), null, 'cat must match a complete word, not a substring');
  assert.equal(emojiClueForPet('Vampiresque'), null, 'vampire must match a complete word');

  const chosen = pickEmojiPet([{ configName: 'Huge Hell Rock' }, { configName: 'Pet Without A Clue' }], () => 0);
  assert.equal(chosen.name, 'Huge Hell Rock');
  assert.ok(chosen.clue.emojis.includes('🌋'));
  assert.throws(() => pickEmojiPet([{ configName: 'Mystery' }]), /curated semantic emoji clues/);
});

test('Higher or Lower selects distinct normal RAP pet records and identifies the higher value', () => {
  const data = [
    { category: 'Pet', value: 100, configData: { id: 'Cat', pt: 0, sh: false, thumbnail: 'https://cdn.example/cat.png' } },
    { category: 'Pet', value: 300, configData: { id: 'Dog', pt: 0, sh: false, thumbnail: 'https://cdn.example/dog.png' } },
    { category: 'Pet', value: 9999, configData: { id: 'Golden Cat', pt: 1, sh: false } },
    { category: 'Egg', value: 100000, configData: { id: 'Basic Egg', pt: 0, sh: false } },
    { category: 'Pet', value: 0, configData: { id: 'Free Pet', pt: 0, sh: false } }
  ];
  const pair = pickHigherLowerPair(data, () => 0);
  assert.equal(pair.a.name, 'Cat');
  assert.equal(pair.b.name, 'Dog');
  assert.equal(pair.answer, 'B');
  assert.equal(petNamesFromCollection([{ configName: 'Cat' }, { configName: 'Cat' }, { configName: 'Dog' }]).length, 2);
});
