import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Keep this test isolated from the app's real data path. The test runs in the
// Docker build after discord.js is installed, so it validates real builder JSON.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r3v0-ticket-v2-'));

const { buildTicketPanelPayload } = await import('../src/tickets.js');
const { ComponentType, MessageFlags } = await import('discord.js');

test('real discord.js Components V2 panel serializes two inline game application buttons', () => {
  const payload = buildTicketPanelPayload();
  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.equal(payload.embeds, undefined, 'Components V2 must not be mixed with legacy embeds');
  assert.equal(payload.components.length, 1);
  const container = payload.components[0].toJSON();
  assert.equal(container.type, ComponentType.Container);

  const children = container.components || [];
  const sections = children.filter(component => component.type === ComponentType.Section);
  assert.equal(sections.length, 2);
  assert.deepEqual(sections.map(section => section.accessory?.custom_id), ['ticket:open:clan', 'ticket:open:psx']);
  assert.ok(sections.every(section => section.accessory?.type === ComponentType.Button));

  const collectText = component => {
    if (component.type === ComponentType.TextDisplay) return [component.content || ''];
    return (component.components || []).flatMap(collectText);
  };
  const allText = collectText(container).join('\n');
  assert.match(allText, /R3V0 Clan Recruitment/);
  assert.match(allText, /Rank \*\*15\+\*\*/);
  assert.match(allText, /15 Huge pets/);
  assert.match(allText, /6–12 hours daily/);
  assert.match(allText, /Most Game Passes/);
  assert.match(allText, /Classic Pet Simulator X/);
  assert.match(allText, /all Game Passes/);
});
