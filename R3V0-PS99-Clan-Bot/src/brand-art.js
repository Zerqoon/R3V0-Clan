import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadImage } from '@napi-rs/canvas';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
// Original user-supplied artwork. All public headers share the same clan banner.
export const BRAND_ASSETS = Object.freeze({
  battle: { file: 'r3v0-banner.png' }, recruitment: { file: 'r3v0-banner.png' },
  rules: { file: 'r3v0-banner.png' }, giveaway: { file: 'r3v0-banner.png' },
  arcade: { file: 'r3v0-banner.png' },
});
export function brandAssetPath(kind) {
  const spec = BRAND_ASSETS[kind];
  if (!spec) throw new Error(`Unknown clan artwork: ${kind}`);
  return path.join(assets, spec.file);
}
let logoPromise;
export async function drawClanLogo(ctx, cx, cy, size) {
  if (!logoPromise) logoPromise = loadImage(path.join(assets, 'r3v0-logo.png')).catch(() => null);
  const image = await logoPromise;
  if (!image) return;
  const scale = size / Math.max(image.width, image.height);
  ctx.drawImage(image, cx - image.width * scale / 2, cy - image.height * scale / 2, image.width * scale, image.height * scale);
}
export function validateBrandAssets() {
  for (const file of ['r3v0-logo.png', 'r3v0-banner.png', 'background.png']) {
    if (!fs.existsSync(path.join(assets, file))) throw new Error(`Missing original clan artwork: assets/${file}`);
  }
}
