import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3v0-psx-ui-'));
process.env.DATA_DIR = dir;
const { db, closeDb } = await import('../src/db.js');
const { buildCommands } = await import('../src/commands.js');
const { handlePsxSlash, handlePsxComponent, handlePsxModal, psxFindModal } = await import('../src/psx-commands.js');
const { normalizePsxPage, comparePsxNeighbours } = await import('../src/psx-classic.js');
const { buildPsxPointsMessage, buildPsxLeaderboardMessage } = await import('../src/psx-messages.js');
const { buildPsxPointsPayload, buildPsxLeaderboardPayload } = await import('../src/psx-views.js');
const { loadImage } = await import('@napi-rs/canvas');
const { MessageFlags } = await import('discord.js');
after(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => db.exec('DELETE FROM account_links;'));
const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/psx-classic-live.json', import.meta.url))).data;
const board = { ...normalizePsxPage(raw, 1), receivedAt: 1793356250000, cacheFallback: false };
const result = { found: true, entry: board.entries[1], userId: board.entries[1].userId, source: 'live', board, receivedAt: board.receivedAt, cacheFallback: false, ...comparePsxNeighbours(board.entries[1], board.entries) };
function interaction(commandName = 'psx-points') {
  const seen = { replies: [], defers: [] };
  return { commandName, guildId: 'guild', user: { id: 'caller' }, options: { getInteger: () => null, getString: () => null, getUser: () => null }, seen, deferReply: async value => { seen.defers.push(value); }, deferUpdate: async () => { seen.update = true; }, editReply: async payload => { seen.replies.push(payload); }, showModal: async modal => { seen.modal = modal; } };
}
const walk = nodes => nodes.flatMap(value => { const node = value.toJSON?.() || value; return [node, ...walk(node.components || []), ...(node.accessory ? walk([node.accessory]) : [])]; });
const content = payload => walk(payload.components).filter(node => node.type === 10).map(node => node.content).join('\n');
test('both PSX commands register once and are open to everyone by default', () => {
  const commands = buildCommands().map(command => command.toJSON());
  for (const name of ['psx-points', 'psx-leaderboard']) { const rows = commands.filter(command => command.name === name); assert.equal(rows.length, 1); assert.ok(rows[0].default_member_permissions == null); }
});
test('public leaderboard acknowledges before fetching and includes Canvas under V2 controls', async () => {
  const i = interaction('psx-leaderboard');
  await handlePsxSlash(i, { leaderboard: async () => { assert.equal(i.seen.defers.length, 1); return board; } });
  assert.deepEqual(i.seen.defers, [undefined]); const payload = i.seen.replies[0]; assert.equal(payload.flags, MessageFlags.IsComponentsV2); assert.equal(payload.files[0].name, 'r3v0-psx-leaderboard.png');
});
test('the linked account is used automatically and its points result is public', async () => {
  db.prepare('INSERT INTO account_links VALUES(?,?,?,?,?)').run('guild', 'caller', result.userId, 'LinkedPlayer', Date.now());
  const i = interaction(); let lookedUp;
  await handlePsxSlash(i, { points: async id => { lookedUp = id; return result; } });
  assert.equal(lookedUp, result.userId); assert.deepEqual(i.seen.defers, [undefined]); assert.match(content(i.seen.replies[0]), /206,952/); assert.match(content(i.seen.replies[0]), /7,056/);
});
test('unlinked players get account linking and manual lookup without an API request', async () => {
  const i = interaction(); await handlePsxSlash(i, { points: async () => { throw new Error('Must not be called'); } });
  assert.match(content(i.seen.replies[0]), /\/link/); assert.ok(walk(i.seen.replies[0].components).some(node => node.custom_id === 'account:start'));
});
test('navigation from a public ranking opens a private copy without updating the original', async () => {
  const i = interaction(); i.customId = 'psx:page:2:next'; i.message = { flags: { has: () => false } };
  await handlePsxComponent(i, { leaderboard: async page => { assert.equal(page, 2); return board; } });
  assert.deepEqual(i.seen.defers, [{ flags: MessageFlags.Ephemeral }]); assert.equal(i.seen.update, undefined);
});
test('refresh keeps the selected Roblox account even when another member presses the button', async () => {
  const i = interaction(); i.customId = `psx:refresh-player:${result.userId}`;
  await handlePsxComponent(i, { points: async id => { assert.equal(id, result.userId); return result; } });
  assert.equal(i.seen.update, true); assert.match(content(i.seen.replies[0]), new RegExp(result.userId));
});
test('manual lookup modal is labelled correctly and returns a public player result', async () => {
  const modal = psxFindModal().toJSON(); assert.equal(modal.custom_id, 'psx:find-submit'); assert.equal(modal.components[0].type, 18);
  const i = interaction(); i.customId = 'psx:find-submit'; i.fields = { getTextInputValue: () => 'BuilDerManNo4' };
  await handlePsxModal(i, { resolve: async value => { assert.equal(value, 'BuilDerManNo4'); return { id: result.userId }; }, points: async () => result });
  assert.deepEqual(i.seen.defers, [undefined]); assert.match(content(i.seen.replies[0]), /206,952/);
});
test('API failures stay in a valid V2 error card and do not publish invented scores', async () => {
  const i = interaction('psx-leaderboard'); await handlePsxSlash(i, { leaderboard: async () => { throw new Error('Test outage'); } });
  const payload = i.seen.replies[0]; assert.equal(payload.flags, MessageFlags.IsComponentsV2); assert.match(content(payload), /RESULT UNAVAILABLE/); assert.equal(payload.files, undefined);
});
test('Canvas images are real PNGs, readable at full resolution, and appear before button rows', async () => {
  const points = await buildPsxPointsMessage(result), ranking = await buildPsxLeaderboardMessage(board);
  for (const [payload, height] of [[points, 1100], [ranking, 1150]]) {
    assert.ok(payload.files[0].attachment.length > 30000); const img = await loadImage(payload.files[0].attachment); assert.equal(img.width, 1200); assert.equal(img.height, height);
    const root = payload.components[0].toJSON(), gallery = root.components.findIndex(node => node.type === 12), buttons = root.components.findIndex(node => node.type === 1);
    assert.ok(gallery >= 0 && gallery < buttons); assert.ok(root.components[gallery].items[0].media.url.startsWith('attachment://'));
  }
});
test('native and graphical views retain unique controls and fit Discord limits for unknown, live and final scores', () => {
  const unknown = { ...result, found: false, entry: null, nextPlayer: null, pointsToPass: null, behindPlayer: null, leadOverBehind: null };
  for (const payload of [buildPsxLeaderboardPayload(board), buildPsxPointsPayload(result), buildPsxPointsPayload(unknown), buildPsxLeaderboardPayload({ ...board, page: 1, pages: 1, source: 'final' }, { imageUrl: 'attachment://test.png' })]) {
    const nodes = walk(payload.components), ids = nodes.filter(node => node.custom_id).map(node => node.custom_id);
    assert.equal(ids.length, new Set(ids).size); assert.ok(nodes.length <= 40); assert.ok(content(payload).length < 4000); assert.deepEqual(payload.allowedMentions, { parse: [] });
  }
  assert.match(content(buildPsxPointsPayload(unknown)), /unknown/);
});
