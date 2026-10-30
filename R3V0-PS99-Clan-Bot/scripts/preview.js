import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A preview must never create sample settings or tickets in the production volume.
const previewDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3v0-preview-'));
process.env.DATA_DIR = previewDataDir;
try {
  const { createPreviewImages } = await import('../src/canvas.js');
  await createPreviewImages();
  const { createInterfacePreview } = await import('./preview-ui.js');
  await createInterfacePreview();
  console.log('[preview] Created native Clan Battle, tickets, account linking, profiles, staff and PSX Classic Canvas previews; legacy welcome/player images are included.');
} finally {
  const { closeDb } = await import('../src/db.js');
  closeDb();
  fs.rmSync(previewDataDir, { recursive: true, force: true });
}
