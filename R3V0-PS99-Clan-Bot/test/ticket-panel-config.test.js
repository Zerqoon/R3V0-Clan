import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ticketSource = fs.readFileSync(path.resolve('src/tickets.js'), 'utf8') + fs.readFileSync(path.resolve('src/ticket-system.js'), 'utf8');
const panelSource = ticketSource.split('export function buildTicketPanelPayload() {')[1]?.split('async function getTextChannel')[0] || '';

test('recruitment panel is a Components V2 card with button accessories inside each game section', () => {
  assert.match(panelSource, /new ContainerBuilder\(\)/);
  assert.match(panelSource, /new SectionBuilder\(\)/);
  assert.match(panelSource, /setButtonAccessory/);
  assert.match(panelSource, /MessageFlags\.IsComponentsV2/);
  assert.match(panelSource, /ticket:open:clan/);
  assert.match(panelSource, /ticket:open:psx/);
});

test('recruitment requirements are plain and generic support/reward tickets are not offered', () => {
  assert.ok(panelSource.includes('Rank **15+**'));
  assert.match(panelSource, /15 Huge pets/);
  assert.match(panelSource, /6–12 hours daily/);
  assert.match(panelSource, /Most Game Passes/);
  assert.match(panelSource, /all Game Passes/);
  assert.doesNotMatch(panelSource, /ticket:open:general|ticket:open:reward|General Support|Reward Claim|PANEL_ID=/);
});

test('only PS99 and Classic PSX recruitment ticket types are accepted', () => {
  assert.match(ticketSource, /if \(!\['clan', 'psx'\]\.includes\(type\)\)/);
  assert.match(ticketSource, /prefix: 'ps99'/);
  assert.match(ticketSource, /prefix: 'psx'/);
  assert.match(ticketSource, /if \(!\['clan', 'psx'\]\.includes\(argument\)\)/);
});
