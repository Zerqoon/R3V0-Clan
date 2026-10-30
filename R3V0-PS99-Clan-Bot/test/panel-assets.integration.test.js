import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3v0-panel-assets-'));
process.env.DATA_DIR = tempDir;
const { config } = await import('../src/config.js');
const { setSetting, getSetting, closeDb } = await import('../src/db.js');
const { upsertR3V0Panel, buildLeaderboardPayload } = await import('../src/monitor.js');
const { publishTicketPanel } = await import('../src/tickets.js');
const { buildGiveawayPayload } = await import('../src/giveaways.js');
const { ComponentType } = await import('discord.js');
after(() => { closeDb(); fs.rmSync(tempDir, { recursive: true, force: true }); });

function fakeClient(channelId, names) {
  const edits = [], deleted = [];
  const message = {
    id: '100000000000000001', flags: { has: () => true },
    attachments: new Map(names.map((name, i) => [String(i), { id: String(i), name }])),
    edit: async payload => { edits.push(payload); return message; },
    delete: async () => { deleted.push(true); },
  };
  const channel = { isTextBased: () => true, messages: { fetch: async () => message }, send: async () => { throw new Error('A saved panel must be edited'); } };
  return { client: { channels: { cache: new Map([[channelId, channel]]) } }, message, edits, deleted };
}
const clan = { members: [], activeBattle: 'Test battle', updatedAt: Date.now(), totalBattlePoints: null };

test('native battle refresh edits text while reusing its original logo and banner', async () => {
  const fake = fakeClient(config.channels.leaderboard, ['r3v0-banner.png','r3v0-logo.png']);
  setSetting('r3v0_panel_message_id', fake.message.id);
  setSetting('r3v0_panel_design_version', 'battle-native-v3');
  const result = await upsertR3V0Panel(fake.client, clan);
  assert.equal(result.message.id, fake.message.id);
  assert.equal(fake.edits[0].files, undefined);
  assert.deepEqual(fake.edits[0].attachments.map(a=>a.filename), ['r3v0-banner.png','r3v0-logo.png']);
  assert.equal(fake.deleted.length, 0);
});

test('the Canvas V2 panel migrates to native text without deleting its message', async () => {
  const fake = fakeClient(config.channels.leaderboard, ['r3v0-clan-battle.png']);
  setSetting('r3v0_panel_message_id', fake.message.id);
  setSetting('r3v0_panel_design_version', 'battle-dashboard-v2');
  const result = await upsertR3V0Panel(fake.client, clan);
  assert.equal(result.message.id, fake.message.id);
  assert.deepEqual(fake.edits[0].files.map(f=>f.name), ['r3v0-banner.png','r3v0-logo.png']);
  assert.deepEqual(fake.edits[0].attachments, []);
  assert.equal(getSetting('r3v0_panel_design_version'), 'battle-native-v4');
  assert.equal(fake.deleted.length, 0);
});

test('a failed native migration leaves the saved page and last working message intact', async () => {
  const fake = fakeClient(config.channels.leaderboard, ['r3v0-clan-battle.png']);
  fake.message.edit = async () => { throw new Error('upload failed'); };
  setSetting('r3v0_panel_message_id', fake.message.id);
  setSetting('r3v0_panel_page', 0);
  setSetting('r3v0_panel_design_version', 'battle-dashboard-v2');
  await assert.rejects(upsertR3V0Panel(fake.client, clan), /upload failed/);
  assert.equal(getSetting('r3v0_panel_message_id'), fake.message.id);
  assert.equal(getSetting('r3v0_panel_page'), 0);
  assert.equal(getSetting('r3v0_panel_design_version'), 'battle-dashboard-v2');
  assert.equal(fake.deleted.length, 0);
});

test('recruitment slot refresh reuses the clan banner already attached to the message', async () => {
  const fake = fakeClient(config.channels.ticketPanel, ['r3v0-recruitment.png']);
  setSetting('ticket_panel_message_id', fake.message.id);
  setSetting('ticket_panel_design_version', 'citadel-v1');
  await publishTicketPanel(fake.client);
  assert.equal(fake.edits[0].files, undefined);
  assert.deepEqual(fake.edits[0].attachments, [{ id: '0', filename: 'r3v0-recruitment.png' }]);
});

test('giveaway participant edits reuse the default banner and preserve custom prize images', () => {
  const giveaway = { id: 1, prize: 'Huge Cat', status: 'active', winnersCount: 1, endsAt: Date.now() + 60000, createdAt: Date.now() };
  const initial = buildGiveawayPayload(giveaway, 0);
  assert.equal(initial.files.length, 1);
  assert.equal(initial.components[0].toJSON().components.find(c=>c.type===ComponentType.MediaGallery).items[0].media.url, 'attachment://r3v0-giveaway.png');
  const refresh = buildGiveawayPayload(giveaway, 2, [{ name: 'r3v0-giveaway.png' }]);
  assert.equal(refresh.files, undefined);
  const prizeUrl = 'https://example.com/prize.png';
  const custom = buildGiveawayPayload({ ...giveaway, imageUrl: prizeUrl }, 2);
  assert.equal(custom.files, undefined);
  assert.equal(custom.components[0].toJSON().components.find(c=>c.type===ComponentType.MediaGallery).items[0].media.url, prizeUrl);
  const ended = buildGiveawayPayload({ ...giveaway, status: 'ended', winnersJson: '["123"]' }, 2);
  assert.equal(ended.components[0].toJSON().components.find(c=>c.type===ComponentType.Section).accessory.disabled, true);
});
