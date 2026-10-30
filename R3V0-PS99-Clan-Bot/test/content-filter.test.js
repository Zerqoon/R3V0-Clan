import test from 'node:test';
import assert from 'node:assert/strict';
import { containsProhibitedLanguage, evaluateContent, checkLinks, normalizeForModeration, isGifAttachment } from '../src/content-filter.js';

const allowlist = ['giphy.com', 'klipy.com', 'tenor.com', 'roblox.com', 'rbxcdn.com', 'tiktok.com', 'vm.tiktok.com', 'youtube.com', 'youtu.be', 'twitch.tv'];
test('filter catches simple and obfuscated slurs and prohibited sexualization terms', () => {
  assert.equal(containsProhibitedLanguage('nigger'), 'prohibited_slur_or_sexualization');
  assert.equal(containsProhibitedLanguage('n1gg3r'), 'prohibited_slur_or_sexualization');
  assert.equal(containsProhibitedLanguage('n i g g e r'), 'prohibited_slur_or_sexualization');
  assert.equal(containsProhibitedLanguage('p3d0philia'), 'prohibited_slur_or_sexualization');
  assert.equal(containsProhibitedLanguage('welcome to the night shift'), null);
});
test('filter handles Unicode confusables and zero-width characters', () => {
  assert.equal(containsProhibitedLanguage('n\u200bigger'), 'prohibited_slur_or_sexualization');
  assert.equal(normalizeForModeration('Ｒ３Ｖ０'), 'revo');
});
test('approved external sites are allowed; unknown and Discord links are blocked', () => {
  assert.equal(checkLinks('Great clip: https://tenor.com/view/cat', allowlist).ok, true);
  assert.equal(checkLinks('Roblox: https://www.roblox.com/games/1', allowlist).ok, true);
  assert.equal(checkLinks('Join: https://discord.gg/invitecode', allowlist).reason, 'discord_links_not_allowed');
  assert.equal(checkLinks('https://example.org/page', allowlist).reason, 'domain_not_allowed');
  assert.equal(checkLinks('https://pornhub.com/watch/123', allowlist).reason, 'prohibited_domain');
});
test('Owner bypasses all filters; Officer only bypasses GIF attachment restriction', () => {
  assert.equal(evaluateContent({ content: 'https://discord.gg/test', allowlist, hasOwnerRole: true }).allowed, true);
  assert.equal(evaluateContent({ content: '', attachments: [{ name: 'x.gif', contentType: 'image/gif' }], allowlist, hasOfficerRole: false }).reason, 'gif_attachment_not_allowed');
  assert.equal(evaluateContent({ content: '', attachments: [{ name: 'x.gif', contentType: 'image/gif' }], allowlist, hasOfficerRole: true }).allowed, true);
  assert.equal(evaluateContent({ content: 'https://discord.gg/test', allowlist, hasOfficerRole: true }).allowed, false);
  assert.equal(isGifAttachment({ name: 'clip.GIF?x=1', contentType: '' }), true);
});
