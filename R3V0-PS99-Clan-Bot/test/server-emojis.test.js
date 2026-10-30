import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import {
  OFFICIAL_PS99_EMOJI_SPECS, ensureServerEmojis, refreshEmojiRegistry, emoji, emojiId
} from '../src/server-emojis.js';

function fakeGuildWithOfficialEmojis() {
  const cache = new Collection();
  let next = 100000000000000000n;
  for (const spec of OFFICIAL_PS99_EMOJI_SPECS) {
    const item = { id: String(next++), name: spec.name, animated: false };
    cache.set(item.id, item);
  }
  return {
    members: { me: { permissions: { has: () => true } } },
    emojis: {
      cache,
      fetch: async () => cache,
      create: async () => { throw new Error('No creation expected when official emojis already exist'); }
    }
  };
}

test('official PS99 emoji setup reuses existing BIG Games artwork without local/generated files', async () => {
  const guild = fakeGuildWithOfficialEmojis();
  const summary = await ensureServerEmojis(guild);
  assert.equal(summary.failed.length, 0);
  assert.equal(summary.created.length, 0);
  assert.equal(summary.existing.length, OFFICIAL_PS99_EMOJI_SPECS.length);
  assert.match(emoji('ps99Huge'), /^<:ps99_huge:\d+>$/);
  assert.match(emoji('battle'), /^<:ps99_battle:\d+>$/);
  assert.ok(emojiId('ps99Gems'));
});

test('generic UI falls back to Unicode and PS99 keys fall back safely before setup', () => {
  refreshEmojiRegistry({ emojis: { cache: new Collection() } });
  assert.equal(emoji('refresh'), '🔄');
  assert.equal(emoji('rank1'), '🥇');
  assert.equal(emoji('ps99Huge'), '🐾');
  assert.equal(emoji('battle'), '⚔️');
});
