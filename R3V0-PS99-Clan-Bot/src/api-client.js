const cache = new Map();
const pending = new Map();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export function clearRequestCache() { cache.clear(); }
export async function requestJson(url, { method = 'GET', body, ttlMs = 0, retries = 2, timeoutMs = 12_000 } = {}) {
  const key = `${method}:${url}:${body ? JSON.stringify(body) : ''}`;
  const stored = cache.get(key);
  if (ttlMs > 0 && stored && stored.expiresAt > Date.now()) return stored.value;
  if (pending.has(key)) return pending.get(key);
  const request = (async () => {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let retryAfter = 0;
      try {
        const response = await fetch(url, { method, signal: controller.signal, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        const json = await response.json().catch(() => null);
        if (!response.ok) {
          const message = String(json?.error?.message ?? json?.message ?? json?.errors?.[0]?.message ?? '').slice(0, 200);
          const error = new Error(`PS99/Roblox API returned HTTP ${response.status}${message ? `: ${message}` : ''}`);
          error.httpStatus = response.status;
          error.apiCode = json?.error?.code || null;
          error.apiMessage = message;
          error.retryable = response.status === 429 || response.status >= 500;
          const raw = response.headers?.get?.('retry-after');
          retryAfter = raw ? Math.min(15_000, Math.max(500, Number(raw) * 1000 || Date.parse(raw) - Date.now() || 1000)) : 0;
          throw error;
        }
        if (json === null) throw Object.assign(new Error('API returned invalid JSON'), { retryable: true });
        if (json?.status === 'error') throw Object.assign(new Error(json?.error?.message || json?.error?.code || 'API returned an error'), { httpStatus: response.status, apiCode: json?.error?.code || null, apiMessage: String(json?.error?.message || '') });
        const value = Object.hasOwn(json ?? {}, 'data') ? json.data : json;
        if (ttlMs > 0) cache.set(key, { value, expiresAt: Date.now() + ttlMs });
        for (const [id, entry] of cache) if (entry.expiresAt <= Date.now()) cache.delete(id);
        while (cache.size > 400) cache.delete(cache.keys().next().value);
        return value;
      } catch (error) {
        if (attempt >= retries || (error.retryable === false) || (!error.retryable && error.name !== 'AbortError' && !(error instanceof TypeError))) throw error;
      } finally { clearTimeout(timeout); }
      await pause(retryAfter || Math.min(3000, 350 * 2 ** attempt));
    }
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}
