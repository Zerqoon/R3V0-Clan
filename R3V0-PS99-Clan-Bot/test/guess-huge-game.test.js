import test from 'node:test';
import assert from 'node:assert/strict';
import { createHugeHintState, extractHugeGuess, isHugeGuessCorrect, normalizeHugeGuess, renderHugeHint, revealNextHugeHint } from '../src/guess-huge-game.js';

test('typed Guess Pet accepts exact pet names and explicit typo guesses, not ordinary chat or commands', () => {
  const known = ['Huge Hell Rock', 'Titanic Kitsune Fox'];
  assert.equal(extractHugeGuess('Huge Hell Rock', known), 'Huge Hell Rock');
  assert.equal(extractHugeGuess('titanic kitsune fox', known), 'titanic kitsune fox');
  assert.equal(extractHugeGuess('guess: Huge Banana', known), 'Huge Banana');
  assert.equal(extractHugeGuess('!guess Huge Cat', known), 'Huge Cat');
  assert.equal(extractHugeGuess('hello everybody', known), null);
  assert.equal(extractHugeGuess('/guess-pet', known), null);
});

test('pet-name matching ignores case, spaces, punctuation, and Unicode compatibility characters', () => {
  assert.equal(normalizeHugeGuess('Huge-Hell_Rock'), 'hugehellrock');
  assert.equal(isHugeGuessCorrect('huge hell-rock!', 'Huge Hell Rock'), true);
  assert.equal(isHugeGuessCorrect('Huge Cat', 'Huge Hell Rock'), false);
});

test('hint reveals word initials first, then one additional letter per scheduled tick', () => {
  const hint = createHugeHintState('Huge Hell Rock');
  assert.equal(renderHugeHint(hint), 'H___   H___   R___');
  const hiddenBefore = hint.remaining.length;
  assert.equal(revealNextHugeHint(hint), true);
  assert.equal(hint.remaining.length, hiddenBefore - 1);
  assert.notEqual(renderHugeHint(hint), 'H___   H___   R___');
  while (revealNextHugeHint(hint)) {}
  assert.equal(renderHugeHint(hint), 'Huge   Hell   Rock');
  assert.equal(revealNextHugeHint(hint), false);
});

test('hint formatting preserves punctuation and word boundaries', () => {
  const hint = createHugeHintState("Huge Cat's Eye");
  const text = renderHugeHint(hint);
  assert.equal(text, "H___   C__'_   E__");
});
