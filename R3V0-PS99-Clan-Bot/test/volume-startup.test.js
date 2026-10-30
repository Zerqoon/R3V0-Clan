import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const entrypoint = fs.readFileSync(new URL('../docker-entrypoint.sh', import.meta.url), 'utf8');
const dbSource = fs.readFileSync(new URL('../src/db.js', import.meta.url), 'utf8');
const railway = fs.readFileSync(new URL('../RAILWAY.md', import.meta.url), 'utf8');

test('Railway volume is made writable at runtime before dropping to bot user', () => {
  assert.match(dockerfile, /gosu/);
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/local\/bin\/docker-entrypoint\.sh"\]/);
  assert.doesNotMatch(dockerfile, /^USER bot\s*$/m, 'container must start as root so runtime volume ownership can be repaired');
  assert.ok(entrypoint.includes('chown -R bot:bot "$DATA_DIR"'));
  assert.ok(entrypoint.includes('chmod -R u+rwX "$DATA_DIR"'));
  assert.match(entrypoint, /exec gosu bot:bot/);
});

test('SQLite reports the resolved path and how to fix volume permission failures', () => {
  assert.match(dbSource, /Cannot access DATA_DIR/);
  assert.match(dbSource, /Cannot open SQLite database/);
  assert.match(dbSource, /SQLite opened:/);
  assert.match(railway, /Mount Path.*`\/app\/data`/);
  assert.match(railway, /drops privileges/);
});
