import { createHash } from 'node:crypto';
import { AttachmentBuilder } from 'discord.js';
import { renderPsxLeaderboard, renderPsxPoints } from './psx-canvas.js';
import { buildPsxLeaderboardPayload, buildPsxPointsPayload } from './psx-views.js';

const renders = new Map();
async function cachedRender(kind, data, render) {
  const key = createHash('sha256').update(`${kind}:${JSON.stringify(data)}`).digest('hex');
  if (!renders.has(key)) {
    const pending = render().catch(error => { renders.delete(key); throw error; });
    renders.set(key, pending);
    while (renders.size > 16) renders.delete(renders.keys().next().value);
  }
  return renders.get(key);
}
export async function buildPsxLeaderboardMessage(board) {
  try {
    const image = await cachedRender('board', board, () => renderPsxLeaderboard(board));
    const name = 'r3v0-psx-leaderboard.png';
    return { ...buildPsxLeaderboardPayload(board, { imageUrl: `attachment://${name}` }), files: [new AttachmentBuilder(image, { name })] };
  } catch (error) { console.warn(`[psx-canvas] ${error.message}`); return buildPsxLeaderboardPayload(board); }
}
export async function buildPsxPointsMessage(result, account = {}) {
  try {
    const image = await cachedRender('points', { result, account }, () => renderPsxPoints(result, account));
    const name = 'r3v0-psx-points.png';
    return { ...buildPsxPointsPayload(result, account, { imageUrl: `attachment://${name}` }), files: [new AttachmentBuilder(image, { name })] };
  } catch (error) { console.warn(`[psx-canvas] ${error.message}`); return buildPsxPointsPayload(result, account); }
}
