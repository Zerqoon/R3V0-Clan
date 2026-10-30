/** Image preparation and a synchronized pre-round countdown for R3V0 Arcade. */
const DEFAULT_MAX_IMAGE_BYTES = 7_500_000;
const IMAGE_EXTENSIONS = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif']
]);
const EXTENSION_MIME_TYPES = new Map([...IMAGE_EXTENSIONS].map(([mime, extension]) => [extension, mime]));

function sniffImageExtension(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buffer.toString('ascii', 4, 12).includes('ftyp') && /avif|avis/.test(buffer.toString('ascii', 8, 16))) return 'avif';
  return null;
}

export async function fetchImageForDiscord(url, {
  timeoutMs = 7000,
  maxBytes = DEFAULT_MAX_IMAGE_BYTES,
  fetchImpl = globalThis.fetch
} = {}) {
  let parsed;
  try { parsed = new URL(String(url ?? '')); } catch { return null; }
  if (parsed.protocol !== 'https:' || typeof fetchImpl !== 'function') return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(parsed, {
      signal: controller.signal,
      headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' }
    });
    if (!response?.ok) return null;
    const mimeType = String(response.headers?.get?.('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const declaredExtension = IMAGE_EXTENSIONS.get(mimeType);
    const genericBinary = mimeType === 'application/octet-stream' || mimeType === 'binary/octet-stream';
    if (!declaredExtension && !genericBinary) return null;
    const declaredLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await response.body?.cancel?.().catch?.(() => {});
      return null;
    }

    let buffer;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel().catch(() => {});
            return null;
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        try { reader.releaseLock(); } catch {}
      }
      buffer = Buffer.concat(chunks, size);
    } else {
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > maxBytes) return null;
      buffer = Buffer.from(bytes);
    }
    if (!buffer.length) return null;
    const extension = declaredExtension || sniffImageExtension(buffer);
    if (!extension) return null;
    return { buffer, extension, mimeType: EXTENSION_MIME_TYPES.get(extension) || mimeType, size: buffer.length };
  } catch {
    // Keep the game playable if the image host is temporarily unavailable.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function imageAttachmentName(prefix, interactionId, extension) {
  const safePrefix = String(prefix ?? 'pet-image').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32) || 'pet-image';
  const safeId = String(interactionId ?? Date.now()).replace(/[^0-9a-z-]/gi, '').slice(0, 40) || String(Date.now());
  const safeExtension = IMAGE_EXTENSIONS.has(`image/${String(extension).toLowerCase()}`)
    ? String(extension).toLowerCase()
    : ['png', 'jpg', 'webp', 'gif', 'avif'].includes(String(extension).toLowerCase()) ? String(extension).toLowerCase() : 'png';
  return `${safePrefix}-${safeId}.${safeExtension}`;
}

export function attachmentReference(filename) {
  return filename ? `attachment://${String(filename)}` : null;
}

export function keepDiscordAttachments(items = []) {
  const attachments = (Array.isArray(items) ? items : []).filter(item => item?.id && item?.filename)
    .map(item => ({ id: String(item.id), filename: String(item.filename) }));
  return attachments.length ? { attachments } : {};
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Runs the visible 5-second-style countdown while preparing image bytes in parallel.
 * onTick receives remaining seconds (e.g. 5, 4, 3, 2, 1); the round must only become
 * active after this function resolves and the caller has published the active embed.
 */
export async function runStartCountdown({ seconds = 5, intervalMs = 1000, onTick, prepare, onWaiting, sleepImpl = sleep } = {}) {
  const total = Math.max(1, Math.min(15, Math.floor(Number(seconds) || 5)));
  const interval = Math.max(0, Math.min(5000, Math.floor(Number(intervalMs) || 0)));
  if (typeof onTick !== 'function') throw new TypeError('onTick is required for the start countdown.');
  let preparationSettled = false;
  const preparation = Promise.resolve().then(() => typeof prepare === 'function' ? prepare() : null)
    .then(value => { preparationSettled = true; return value; }, () => { preparationSettled = true; return null; });
  for (let remaining = total; remaining >= 1; remaining--) {
    await onTick(remaining);
    if (interval && remaining > 1) await sleepImpl(interval);
  }
  if (interval) await sleepImpl(interval);
  if (!preparationSettled && typeof onWaiting === 'function') await onWaiting();
  return preparation;
}

export function countdownDescription(gameName, seconds) {
  const label = String(gameName ?? 'Game').trim() || 'Game';
  const remaining = Math.max(1, Math.floor(Number(seconds) || 1));
  return `**${label} starts in ${remaining} ${remaining === 1 ? 'second' : 'seconds'}**\n\nThe image is being prepared before the round opens. Everyone gets the same start signal.`;
}
