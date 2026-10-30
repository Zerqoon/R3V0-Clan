import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchImageForDiscord, imageAttachmentName, attachmentReference,
  keepDiscordAttachments, runStartCountdown, countdownDescription
} from '../src/arcade-media.js';

function fakeResponse({ contentType = 'image/png', body = Buffer.from([137, 80, 78, 71]), contentLength = null, ok = true } = {}) {
  return {
    ok,
    headers: { get(name) {
      if (name === 'content-type') return contentType;
      if (name === 'content-length') return contentLength == null ? String(body.length) : String(contentLength);
      return null;
    } },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
  };
}

test('image fetch accepts HTTPS image content and returns Discord-uploadable bytes', async () => {
  const image = await fetchImageForDiscord('https://images.example/pet', { fetchImpl: async () => fakeResponse() });
  assert.deepEqual(image.buffer, Buffer.from([137, 80, 78, 71]));
  assert.equal(image.extension, 'png');
  assert.equal(image.mimeType, 'image/png');
});

test('image fetch refuses HTTP, non-image responses, unsuccessful responses and oversized images', async () => {
  assert.equal(await fetchImageForDiscord('http://images.example/pet', { fetchImpl: async () => fakeResponse() }), null);
  assert.equal(await fetchImageForDiscord('https://images.example/page', { fetchImpl: async () => fakeResponse({ contentType: 'text/html' }) }), null);
  assert.equal(await fetchImageForDiscord('https://images.example/missing', { fetchImpl: async () => fakeResponse({ ok: false }) }), null);
  assert.equal(await fetchImageForDiscord('https://images.example/large', { maxBytes: 3, fetchImpl: async () => fakeResponse({ contentLength: 10 }) }), null);
});

test('image upload helpers create safe attachment references and preserve Discord CDN attachments', () => {
  const filename = imageAttachmentName('R3V0 Huge', '1234567890', 'webp');
  assert.equal(filename, 'r3v0-huge-1234567890.webp');
  assert.equal(attachmentReference(filename), `attachment://${filename}`);
  assert.deepEqual(keepDiscordAttachments([{ id: '99', filename }, { filename: 'missing-id.webp' }]), {
    attachments: [{ id: '99', filename }]
  });
  assert.deepEqual(keepDiscordAttachments([]), {});
});

test('start countdown ticks 5-to-1 and prepares image in parallel before releasing the round', async () => {
  const ticks = [];
  let prepared = false;
  const result = await runStartCountdown({
    seconds: 5,
    intervalMs: 1000,
    onTick: async seconds => { ticks.push(seconds); },
    prepare: async () => { prepared = true; return { extension: 'png' }; },
    sleepImpl: async () => {}
  });
  assert.deepEqual(ticks, [5, 4, 3, 2, 1]);
  assert.equal(prepared, true);
  assert.deepEqual(result, { extension: 'png' });
});

test('countdown copy explicitly states the same round start and image preparation', () => {
  assert.match(countdownDescription('Guess the Huge', 5), /starts in 5 seconds/i);
  assert.match(countdownDescription('Guess the Huge', 5), /image is being prepared/i);
  assert.match(countdownDescription('Guess the Huge', 1), /starts in 1 second\*/i);
});

test('image fetch detects supported images when the upstream host uses generic binary MIME', async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const image = await fetchImageForDiscord('https://images.example/octet-stream', {
    fetchImpl: async () => fakeResponse({ contentType: 'application/octet-stream', body: png })
  });
  assert.equal(image.extension, 'png');
  assert.equal(image.mimeType, 'image/png');
});

test('slow image preparation changes the embed from a countdown to a preparation status instead of pretending it started', async () => {
  let resolveImage;
  let waitingWasShown = false;
  const pendingImage = new Promise(resolve => { resolveImage = resolve; });
  const result = await runStartCountdown({
    seconds: 2,
    intervalMs: 1,
    onTick: async () => {},
    prepare: () => pendingImage,
    onWaiting: async () => { waitingWasShown = true; resolveImage('loaded-image'); },
    sleepImpl: async () => {}
  });
  assert.equal(waitingWasShown, true);
  assert.equal(result, 'loaded-image');
});
