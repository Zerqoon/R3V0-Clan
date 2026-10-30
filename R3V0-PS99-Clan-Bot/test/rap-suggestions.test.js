import test from 'node:test';
import assert from 'node:assert/strict';
import { getRAPPetSuggestions } from '../src/rap-suggestions.js';

const items = [
  { category: 'Pet', configData: { id: 'Cat' }, value: 100 },
  { category: 'Pet', configData: { id: 'Huge Cat', huge: true }, value: 900 },
  { category: 'Pet', configData: { id: 'Huge Cat', pt: 1, huge: true }, value: 1200 },
  { category: 'Pet', configData: { id: 'Titanic Dragon' }, value: 5000 },
  { category: 'Egg', configData: { id: 'Cat Egg' }, value: 20 },
  { category: 'Pet', configData: { id: 'Rainbow Fox' }, value: 300 }
];

test('RAP autocomplete returns unique pet names, not eggs or duplicate variants', () => {
  const values = getRAPPetSuggestions(items, '', 25).map(choice => choice.value);
  assert.equal(values.length, 4);
  assert.equal(values.filter(value => value === 'Huge Cat').length, 1);
  assert.ok(!values.includes('Cat Egg'));
});

test('RAP autocomplete matches partial input and prioritizes starts-with matches', () => {
  const values = getRAPPetSuggestions(items, 'huge', 25);
  assert.deepEqual(values.map(choice => choice.value), ['Huge Cat']);
  assert.match(values[0].name, /HUGE/);
});

test('RAP autocomplete caps result count at Discord limit of 25 and tolerates empty data', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ category: 'Pet', configData: { id: `Pet ${i}` } }));
  assert.equal(getRAPPetSuggestions(many, '', 99).length, 25);
  assert.deepEqual(getRAPPetSuggestions([], ''), []);
});
