import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { db, getSetting, setSetting } from './db.js';
import { config } from './config.js';
export function databaseIsReady() { try { return db.prepare('SELECT 1 AS ok').get()?.ok === 1; } catch { return false; } }
export function createDatabaseBackup({ force = false, now = Date.now() } = {}) {
  if (!force && now - Number(getSetting('last_backup_at', 0)) < 24 * 3600_000) return null;
  const directory = path.join(path.resolve(config.dataDir), 'backups');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `r3v0-${new Date(now).toISOString().replace(/[:.]/g, '-')}.sqlite`);
  // VACUUM INTO includes committed WAL data; copying the main SQLite file does not.
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const check = new DatabaseSync(file, { readOnly: true });
  try { if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup integrity verification failed'); } finally { check.close(); }
  setSetting('last_backup_at', now);
  setSetting('last_backup_file', file);
  const files = fs.readdirSync(directory).filter(name => /^r3v0-.*\.sqlite$/.test(name)).sort().reverse();
  for (const name of files.slice(7)) fs.unlinkSync(path.join(directory, name));
  return file;
}
export function startMaintenance() {
  const run = () => { try { createDatabaseBackup(); db.prepare('DELETE FROM link_challenges WHERE expires_at<?').run(Date.now()); } catch (error) { console.warn(`[maintenance] ${error.message}`); } };
  run();
  const timer = setInterval(run, 3600_000); timer.unref?.();
  return () => clearInterval(timer);
}
