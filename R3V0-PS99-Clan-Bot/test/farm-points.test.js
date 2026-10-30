import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFarmPointsEmbed, FARM_POINTS } from '../src/farm-points.js';
import { getR3V0MemberSuggestions } from '../src/ps99.js';

test('farm-points command embed includes the complete requested purple point table', () => {
  const embed = buildFarmPointsEmbed().toJSON();
  assert.equal(embed.title, 'Fantasy Clan Battle — Points Table');
  assert.equal(embed.color, 0x9858f5);
  assert.match(embed.fields[0].value, /Difficulty 1.*10 points/);
  assert.match(embed.fields[0].value, /Difficulty 5.*1,000 points/);
  assert.match(embed.fields[1].value, /Rarer than 1 in 100,000.*10,000 points/);
  assert.match(embed.fields[2].value, /Hatch a Huge.*5,000 points/);
  assert.match(embed.fields[3].value, /60,000 points/);
  assert.equal(FARM_POINTS.achievements.length, 5);
  assert.equal(FARM_POINTS.index.length, 7);
  assert.equal(FARM_POINTS.huges.length, 2);
});

test('player autocomplete exposes separate display names but submits the matching Roblox username', () => {
  const choices = getR3V0MemberSuggestions([
    { userId: '1', username: 'B3STTIEE', displayName: 'Malb0', aliases: ['B3sttiee', 'Malb0'], points: 9000 },
    { userId: '2', username: 'Other', displayName: 'Other Name', points: 1000 },
  ], 'malb0');
  assert.deepEqual(choices, [{ name: 'Malb0 (@B3STTIEE)', value: 'B3STTIEE' }]);
});
