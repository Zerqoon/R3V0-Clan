import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3v0-arcade-commands-'));
process.env.DATA_DIR = tempDir;
const { buildCommands } = await import('../src/commands.js');
const { closeDb } = await import('../src/db.js');

after(() => { closeDb(); fs.rmSync(tempDir, { recursive: true, force: true }); });

test('the three arcade games and both arcade rankings are valid registered guild slash commands', () => {
  const serialized = buildCommands().map(command => command.toJSON());
  const byName = new Map(serialized.map(command => [command.name, command]));
  for (const name of ['guess-pet', 'guess-pet-top', 'pet-scramble', 'emoji-pet', 'higher-lower', 'arcade-top']) {
    assert.ok(byName.has(name), `missing /${name}`);
  }
  assert.equal(new Set(serialized.map(command => command.name)).size, serialized.length, 'slash command names must be unique');
  for (const command of serialized) {
    assert.match(command.name, /^[a-z0-9-]{1,32}$/);
    assert.ok(command.description.length > 0 && command.description.length <= 100);
  }
});


test('Guess Pet has a single Components V2 media gallery and no legacy duplicate embed image', async () => {
  const { buildGuessPetComponents } = await import('../src/commands.js');
  const { MessageFlags, ComponentType } = await import('discord.js');
  const payload = buildGuessPetComponents({
    expiresAt: Date.now() + 60000,
    imageUrl: 'attachment://r3v0-pet.png',
    hint: 'H___   H___',
    nextHintAt: Date.now() + 8000
  });
  const json = payload.components[0].toJSON();
  const galleries = json.components.filter(component => component.type === ComponentType.MediaGallery);
  assert.equal(payload.embeds, undefined, 'legacy embeds must not display a second copy of the attachment');
  assert.equal(payload.flags, MessageFlags.IsComponentsV2, 'the single media gallery must be rendered in Components V2 mode');
  assert.equal(galleries.length, 1, 'one pet image gallery is rendered in the card');
  assert.equal(galleries[0].items.length, 1, 'only one image is shown per round');
  assert.equal(galleries[0].items[0].media.url, 'attachment://r3v0-pet.png');
  const allText = json.components.filter(component => component.type === ComponentType.TextDisplay).map(component => component.content).join('\n');
  assert.match(allText, /Guess Pet/);
  assert.match(allText, /guess-pet-top/);
  assert.ok((payload.allowedMentions.parse || []).length === 0);

  const countdown = buildGuessPetComponents({ countdown: 3 });
  assert.equal(countdown.components[0].toJSON().components.some(component => component.type === ComponentType.MediaGallery), false, 'no image is attached to the countdown state');
});
