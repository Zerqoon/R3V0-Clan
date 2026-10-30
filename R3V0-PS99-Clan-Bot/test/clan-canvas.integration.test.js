// Keep this legacy filename in release archives: uploading a new ZIP over an
// older repository must overwrite the obsolete graphic-layout test too.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3v0-upgrade-contract-'));
process.env.DATA_DIR = path.join(tempDir, 'database');
const root = fileURLToPath(new URL('..', import.meta.url));
const { buildLeaderboardPayload } = await import('../src/monitor.js');
const { closeDb } = await import('../src/db.js');
const { ComponentType } = await import('discord.js');
after(() => { closeDb(); fs.rmSync(tempDir, { recursive: true, force: true }); });

function walk(nodes) {
  return nodes.flatMap(value => {
    const node = value.toJSON?.() || value;
    return [node, ...walk(node.components || []), ...(node.accessory ? walk([node.accessory]) : [])];
  });
}

test('legacy test path validates native Clan Battle text and original artwork', async () => {
  const { payload } = await buildLeaderboardPayload({
    activeBattle: 'FantasyBattle2026', totalBattlePoints: 100, updatedAt: Date.now(),
    members: [{ username: 'Alice', points: 100 }, { username: 'Bob', points: 0 }, { username: 'Unreported', pointsKnown: false }]
  });
  const text = walk(payload.components).filter(node => node.type === ComponentType.TextDisplay).map(node => node.content).join('\n');
  assert.match(text, /100 points/);
  assert.match(text, /Alice/);
  assert.match(text, /Bob.*\*\*0\*\* pts/);
  assert.match(text, /Unreported.*Not reported/);
  assert.deepEqual(payload.files.map(file => file.name), ['r3v0-banner.png', 'r3v0-logo.png']);
  assert.ok(payload.files.every(file => typeof file.attachment === 'string'));
});

test('build checks tolerate an unused renderer left by an older repository upload', () => {
  const overlay = path.join(tempDir, 'old-overlay');
  fs.mkdirSync(overlay);
  for (const name of ['src', 'scripts', 'test', 'assets', 'Dockerfile', 'docker-entrypoint.sh', 'package.json']) {
    fs.cpSync(path.join(root, name), path.join(overlay, name), { recursive: true });
  }
  // If the active native panel imports or calls this module, its own guard fails.
  // Its mere presence after an upload must not reject an otherwise native build.
  fs.writeFileSync(path.join(overlay, 'src/battle-canvas.js'), "export function renderBattleDashboard() { throw new Error('Obsolete renderer must not execute'); }\n");
  const result = spawnSync(process.execPath, ['scripts/check.js'], { cwd: overlay, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Syntax OK/);
});
