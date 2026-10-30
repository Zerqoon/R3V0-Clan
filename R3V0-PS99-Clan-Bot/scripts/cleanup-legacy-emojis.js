import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const emojiDir = path.join(root, 'assets', 'emojis');

if (!fs.existsSync(emojiDir)) {
  console.log('[emoji-cleanup] No assets/emojis directory; nothing to remove.');
  process.exit(0);
}

const removed = [];
for (const entry of fs.readdirSync(emojiDir, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (!/\.(?:png|jpe?g|webp|gif)$/i.test(entry.name)) continue;
  const full = path.join(emojiDir, entry.name);
  fs.rmSync(full, { force: true });
  removed.push(entry.name);
}

if (removed.length) {
  console.log(`[emoji-cleanup] Removed ${removed.length} legacy local emoji artwork file(s): ${removed.join(', ')}`);
} else {
  console.log('[emoji-cleanup] No legacy local emoji artwork found.');
}
