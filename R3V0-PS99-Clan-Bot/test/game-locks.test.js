import test from 'node:test';
import assert from 'node:assert/strict';
import { getGameInChannel, releaseGameChannel, reserveGameChannel } from '../src/game-locks.js';

test('a channel can run only one arcade game at a time and locks are owned by game type', () => {
  assert.equal(reserveGameChannel('channel-1', 'guess-pet'), true);
  assert.equal(getGameInChannel('channel-1'), 'guess-pet');
  assert.equal(reserveGameChannel('channel-1', 'scramble'), false);
  assert.equal(releaseGameChannel('channel-1', 'scramble'), false);
  assert.equal(getGameInChannel('channel-1'), 'guess-pet');
  assert.equal(releaseGameChannel('channel-1', 'guess-pet'), true);
  assert.equal(reserveGameChannel('channel-1', 'scramble'), true);
  assert.equal(releaseGameChannel('channel-1'), true);
});
