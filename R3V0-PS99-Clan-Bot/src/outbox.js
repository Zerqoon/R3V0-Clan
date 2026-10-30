import { db } from './db.js';
import crypto from 'node:crypto';
import { config } from './config.js';
const handlers = new Map();
let draining = false;
export function registerJob(kind, handler) { handlers.set(kind, handler); }
export function enqueueJob(kind, key, payload, nextAt = Date.now()) {
  db.prepare('INSERT OR IGNORE INTO outbox(job_key,kind,payload_json,next_at,created_at) VALUES(?,?,?,?,?)').run(String(key), kind, JSON.stringify(payload), nextAt, Date.now());
  return db.prepare('SELECT * FROM outbox WHERE job_key=?').get(String(key));
}
export function outboxStatus() {
  return db.prepare("SELECT status,COUNT(*) AS count FROM outbox WHERE status!='done' GROUP BY status").all();
}
export async function processJob(client, jobId, { force = false } = {}) {
  const now = Date.now();
  const result = db.prepare("UPDATE outbox SET status='processing',lease_until=? WHERE id=? AND (status='pending' OR (status='processing' AND lease_until<?)) AND (? OR next_at<=?)").run(now + 15 * 60_000, jobId, now, force ? 1 : 0, now);
  if (!result.changes) return false;
  const job = db.prepare('SELECT * FROM outbox WHERE id=?').get(jobId);
  try {
    const handler = handlers.get(job.kind);
    if (!handler) throw new Error(`No worker registered for ${job.kind}`);
    await handler(client, JSON.parse(job.payload_json), job);
    db.prepare("UPDATE outbox SET status='done',completed_at=?,lease_until=0,last_error='' WHERE id=?").run(Date.now(), job.id);
    return true;
  } catch (error) {
    const attempts = job.attempts + 1;
    db.prepare("UPDATE outbox SET status='pending',attempts=?,next_at=?,lease_until=0,last_error=? WHERE id=?").run(attempts, Date.now() + Math.min(3_600_000, 5000 * 2 ** Math.min(attempts, 9)), String(error.message).slice(0, 1000), job.id);
    throw error;
  }
}
export async function drainOutbox(client, limit = 15) {
  if (draining) return 0;
  draining = true;
  let sent = 0;
  try {
    const jobs = db.prepare("SELECT id FROM outbox WHERE (status='pending' AND next_at<=?) OR (status='processing' AND lease_until<?) ORDER BY next_at,id LIMIT ?").all(Date.now(), Date.now(), limit);
    for (const job of jobs) { try { if (await processJob(client, job.id)) sent++; } catch (error) { console.warn(`[outbox] Job ${job.id}: ${error.message}`); } }
    db.prepare("DELETE FROM outbox WHERE status='done' AND completed_at<?").run(Date.now() - 30 * 86400_000);
  } finally { draining = false; }
  return sent;
}
export function startOutbox(client) {
  db.prepare("UPDATE outbox SET status='pending',lease_until=0 WHERE status='processing'").run();
  void drainOutbox(client);
  const timer = setInterval(() => void drainOutbox(client), 10_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
// A marker makes a retried send recover a message accepted just before a crash.
export async function deliverOnce(client, channelId, payload, marker) {
  const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
  if (!channel?.isTextBased?.()) throw new Error(`Channel ${channelId} is unavailable`);
  const recent = await channel.messages.fetch({ limit: 100 });
  const existing = recent.find(message => message.author?.id === client.user.id && JSON.stringify(message.components || []).includes(marker));
  if (existing) return existing;
  const nonce = crypto.createHash('sha256').update(marker).digest('hex').slice(0, 24);
  return channel.send({ ...payload, nonce, enforceNonce: true });
}
registerJob('message', async (client, payload, job) => {
  const marker = `R3V0-RECORD-${job.id}`;
  const { card, text, v2 } = await import('./ui.js');
  const container = card(payload.title, payload.body, payload.color);
  container.addTextDisplayComponents(text(`-# ${marker}`));
  await deliverOnce(client, payload.channelId || config.channels[payload.channelKind || 'audit'], v2(container), marker);
});
