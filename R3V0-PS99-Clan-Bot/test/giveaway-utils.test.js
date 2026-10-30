import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_GIVEAWAY_DURATION_MS,
  formatGiveawayDuration,
  getGiveawayEligibilityReasons,
  parseGiveawayDuration,
  pickWeightedWinners,
} from '../src/giveaway-utils.js';

test('giveaway duration parser supports seconds through weeks and caps at 30 days', () => {
  assert.equal(parseGiveawayDuration('30m'), 30 * 60_000);
  assert.equal(parseGiveawayDuration('2H'), 2 * 3_600_000);
  assert.equal(parseGiveawayDuration('1w'), 7 * 86_400_000);
  assert.equal(parseGiveawayDuration('30d'), MAX_GIVEAWAY_DURATION_MS);
  assert.throws(() => parseGiveawayDuration('0m'), /at least one minute/);
  assert.throws(() => parseGiveawayDuration('31d'), /maximum giveaway duration/i);
  assert.throws(() => parseGiveawayDuration('2 months'), /duration/);
});

test('giveaway duration formatter is compact and handles zero', () => {
  assert.equal(formatGiveawayDuration(2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000), '2d 3h 4m');
  assert.equal(formatGiveawayDuration(0), '0s');
});

test('weighted drawing selects distinct users and honors ticket weights', () => {
  const entrants = [
    { userId: 'low', weight: 1 },
    { userId: 'high', weight: 5 },
    { userId: 'invalid', weight: 0 },
  ];
  assert.deepEqual(pickWeightedWinners(entrants, 1, total => total - 1), ['high']);
  assert.deepEqual(pickWeightedWinners(entrants, 2, () => 0), ['low', 'high']);
  assert.deepEqual(pickWeightedWinners(entrants, 10, () => 0).sort(), ['high', 'low']);
});

test('giveaway requirements return actionable explanations', () => {
  assert.deepEqual(getGiveawayEligibilityReasons({
    memberPresent: true,
    hasRequiredRole: false,
    messageCount: 2,
    minMessages: 10,
    accountAgeDays: 3,
    minAccountAgeDays: 7,
    serverAgeDays: 1,
    minServerAgeDays: 2,
  }), [
    'You do not have the required role.',
    'You need at least 10 messages (you have 2).',
    'Your account must be at least 7 days old.',
    'You must have been on the server for at least 2 days.',
  ]);
  assert.deepEqual(getGiveawayEligibilityReasons({}), []);
});
