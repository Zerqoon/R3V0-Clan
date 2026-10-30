import test from 'node:test';
import assert from 'node:assert/strict';
import { clip, compactNumber, parseDuration, safeChannelSlug, hostAllowed } from '../src/utils.js';

test('duration parser accepts common units and enforces the Discord 28-day maximum', () => {
  assert.equal(parseDuration('10m'), 600000);
  assert.equal(parseDuration('2h'), 7200000);
  assert.equal(parseDuration('3d'), 259200000);
  assert.throws(() => parseDuration('0m'));
  assert.throws(() => parseDuration('29d'));
  assert.throws(() => parseDuration('2 hours'));
});
test('channel slugs and log text strip unsafe control characters and cap lengths', () => {
  assert.equal(safeChannelSlug('John / Doe @home'), 'john-doe-home');
  assert.equal(clip('hello\u202Eevil\u0000world'), 'helloevilworld');
  assert.equal(clip('x'.repeat(30), 10).length, 10);
  assert.ok(!clip('@everyone @here').includes('@everyone'));
});
test('number formatter keeps compact values readable', () => {
  assert.equal(compactNumber(76030), '76.03k');
  assert.equal(compactNumber(1500000), '1.50M');
  assert.equal(compactNumber(3), '3');
});
test('link allowlist supports subdomains but always denies Discord domains', () => {
  const list = ['giphy.com', 'tenor.com', 'roblox.com', 'tiktok.com'];
  assert.equal(hostAllowed('media.tenor.com', list), true);
  assert.equal(hostAllowed('www.roblox.com', list), true);
  assert.equal(hostAllowed('discord.gg', list), false);
  assert.equal(hostAllowed('cdn.discordapp.com', list), false);
  assert.equal(hostAllowed('evil-tenor.com', list), false);
});
