import http from 'node:http';
import crypto from 'node:crypto';
import { config } from './config.js';
import { getClanData } from './ps99.js';
import { recordDonationReceipt } from './donations.js';
import { databaseIsReady } from './maintenance.js';
import { clip } from './utils.js';
function tokenMatches(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(String(provided)), b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function respond(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}
async function readJson(req, limit = 16_384) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > limit) throw new Error('Payload too large.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
export function createHttpHandler(client, { loadClan = getClanData, secret = config.gemWebhookSecret, ready = databaseIsReady } = {}) {
  const startedAt = Date.now();
  return async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (req.method === 'GET' && ['/health', '/ready', '/live'].includes(url.pathname)) {
        const botReady = Boolean(client.isReady()), databaseReady = ready();
        const ok = url.pathname === '/live' || (botReady && databaseReady);
        return respond(res, ok ? 200 : 503, { ok, botReady, databaseReady, clan: 'R3V0', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) });
      }
      if (req.method === 'POST' && url.pathname === '/webhooks/gem-deposit') {
        if (!tokenMatches((req.headers.authorization || '').replace(/^Bearer\s+/i, ''), secret)) return respond(res, 401, { ok: false, error: 'Unauthorized' });
        let body;
        try { body = await readJson(req); } catch (error) { return respond(res, error.message === 'Payload too large.' ? 413 : 400, { ok: false, error: error.message === 'Payload too large.' ? error.message : 'Invalid JSON' }); }
        const userId = String(body.robloxUserId || '').trim(), amount = Number(body.amount);
        const eventId = String(body.eventId || req.headers['idempotency-key'] || '').trim();
        if (body.eventId && req.headers['idempotency-key'] && String(body.eventId) !== String(req.headers['idempotency-key'])) return respond(res, 400, { ok: false, error: 'eventId and Idempotency-Key must match' });
        if (String(body.clan || 'R3V0').toUpperCase() !== 'R3V0') return respond(res, 403, { ok: false, error: 'Only R3V0 receipts are accepted' });
        if (!/^[1-9]\d{0,15}$/.test(userId) || !Number.isSafeInteger(amount) || amount <= 0 || !/^[A-Za-z0-9_.:-]{1,150}$/.test(eventId)) return respond(res, 400, { ok: false, error: 'Use a numeric Roblox ID, positive whole amount, and unique eventId (1–150 letters, digits, _, ., :, -).' });
        const clan = await loadClan();
        const member = clan.members.find(item => String(item.userId) === userId);
        if (!member) return respond(res, 403, { ok: false, error: 'Roblox user is not in the current R3V0 roster' });
        let receipt;
        try { receipt = recordDonationReceipt({ eventId: `webhook:${eventId}`, robloxUserId: userId, username: member.username, amount, source: 'Authenticated deposit webhook', note: clip(body.note || '', 400) }); }
        catch (error) { return respond(res, 409, { ok: false, error: error.message }); }
        return respond(res, receipt.duplicate ? 200 : 202, { ok: true, receiptId: receipt.id, duplicate: receipt.duplicate, status: receipt.status, officialTotalsChanged: false, message: 'Receipt recorded. Only an observed increase in the official clan contribution counter confirms donated gems.' });
      }
      return respond(res, 404, { ok: false, error: 'Not found' });
    } catch (error) {
      console.error(`[http] ${error.message}`);
      if (!res.headersSent) respond(res, 503, { ok: false, error: 'Service temporarily unavailable' }); else res.end();
    }
  };
}
export function startHttpServer(client) {
  const server = http.createServer(createHttpHandler(client));
  server.requestTimeout = 20_000; server.headersTimeout = 10_000;
  server.listen(config.port, '0.0.0.0', () => console.log(`[http] Health and donation receipts listening on ${config.port}`));
  server.on('error', error => console.error(`[http] ${error.message}`));
  return () => new Promise(resolve => server.close(resolve));
}
