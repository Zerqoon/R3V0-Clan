import fs from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { drawClanLogo } from './brand-art.js';
import { formatNumber, clip } from './utils.js';

for (const [file, family] of [['DejaVuSans.ttf', 'PSX Sans'], ['DejaVuSans-Bold.ttf', 'PSX Bold']]) {
  const filePath = `/usr/share/fonts/truetype/dejavu/${file}`;
  if (fs.existsSync(filePath)) GlobalFonts.registerFromPath(filePath, family);
}
const C = { bg: '#0B0D15', panel: '#141824', line: '#2C3047', muted: '#A7AEC6', white: '#F5F6FF', purple: '#BA9AFF', cyan: '#77DDD6', gold: '#F2CF88' };
const W = 1200;
const name = row => clip(row?.username || row?.displayName || (row?.userId ? `Roblox ${row.userId}` : 'Player'), 50);
function box(ctx, x, y, w, h, fill = C.panel, border = C.line, r = 18) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill();
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1.5; ctx.stroke(); }
}
function label(ctx, value, x, y, size = 22, color = C.white, bold = false, maxWidth = 1100, align = 'left') {
  let s = String(value ?? '').replace(/[\r\n\t]/g, ' ');
  ctx.font = `${bold ? 'bold' : 'normal'} ${size}px "PSX ${bold ? 'Bold' : 'Sans'}", sans-serif`;
  while (s && ctx.measureText(s).width > maxWidth) s = s.slice(0, -1);
  if (s !== String(value ?? '').replace(/[\r\n\t]/g, ' ')) s = `${s.slice(0, -1)}…`;
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = color; ctx.fillText(s, x, y);
}
function state(board) { return board.preview ? 'DEMO / OFFLINE' : board.source === 'final' ? 'FINAL RESULTS' : board.state === 'live' ? 'LIVE BOARD' : board.state === 'ended' ? 'SCORING ENDED' : 'INACTIVE'; }
async function base(height, board) {
  const canvas = createCanvas(W, height), ctx = canvas.getContext('2d');
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, height);
  const gradient = ctx.createLinearGradient(0, 0, W, 190); gradient.addColorStop(0, '#281E45'); gradient.addColorStop(1, '#101D29');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, 184);
  ctx.fillStyle = C.purple; ctx.fillRect(40, 182, 1120, 2);
  await drawClanLogo(ctx, 87, 96, 116);
  label(ctx, 'R3V0 / GLOBAL LEADERBOARDS', 164, 57, 18, C.purple, true, 650);
  label(ctx, 'PSX CLASSIC', 162, 112, 46, C.white, true, 730);
  label(ctx, 'MOST RARE PET POINTS', 164, 148, 22, C.muted, false, 690);
  box(ctx, 938, 61, 222, 42, '#192532', '#36575E', 21);
  label(ctx, state(board), 1049, 89, 16, board.source === 'final' ? C.gold : C.cyan, true, 206, 'center');
  return { canvas, ctx };
}
function snapshot(ctx, board, fallback, y) {
  const date = board.updatedAt ? new Date(board.updatedAt * 1000).toLocaleString('en-GB', { timeZone: 'Europe/Warsaw', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : 'Not reported';
  label(ctx, board.preview ? 'OFFLINE EXAMPLE / NOT A LIVE RESULT' : fallback ? 'SAVED RESULT / API UNAVAILABLE' : 'OFFICIAL BIG GAMES DATA', 42, y, 18, fallback ? C.gold : C.purple, true, 600);
  label(ctx, `Snapshot: ${date} / Warsaw`, 1158, y, 17, C.muted, false, 555, 'right');
}
function bars(ctx, rows, { x = 66, y, w = 1068, rowHeight = 48, selfId = null, nextId = null, large = false } = {}) {
  const chartX = x + 360, chartW = w - 565;
  const maximum = Math.max(1, ...rows.map(row => row.points));
  const ceiling = Math.ceil(maximum / 1000) * 1000;
  for (let i = 0; i <= 4; i++) {
    const dx = chartX + chartW * i / 4;
    ctx.beginPath(); ctx.moveTo(dx, y - 18); ctx.lineTo(dx, y + rows.length * rowHeight - 15); ctx.strokeStyle = '#252B3C'; ctx.lineWidth = 1; ctx.stroke();
  }
  rows.forEach((row, index) => {
    const cy = y + index * rowHeight;
    const own = selfId && row.userId === selfId, next = nextId && row.userId === nextId;
    if (own) box(ctx, x - 10, cy - 24, w + 20, rowHeight - 3, '#27203B', '#76609D', 9);
    label(ctx, `#${formatNumber(row.rank)}`, x + 2, cy + 3, large && row.rank < 1000 ? 25 : 21, own ? C.purple : row.rank <= 3 ? C.gold : C.muted, true, 107);
    label(ctx, name(row), x + 115, cy + 3, large ? 23 : 21, own ? C.white : C.muted, own, 235);
    const fill = ctx.createLinearGradient(chartX, 0, chartX + chartW, 0);
    fill.addColorStop(0, own ? '#6A50A5' : next || row.rank <= 3 ? '#94723E' : '#28685F');
    fill.addColorStop(1, own ? C.purple : next || row.rank <= 3 ? C.gold : C.cyan);
    const length = row.points / ceiling * chartW;
    if (length > 0) box(ctx, chartX, cy - 17, Math.max(2, length), 24, fill, null, 6);
    label(ctx, formatNumber(row.points), x + w, cy + 4, large ? 28 : 23, own ? C.purple : C.white, true, 190, 'right');
    if (large && index > 0) label(ctx, `${formatNumber(Math.max(0, rows[index - 1].points - row.points))} behind #${formatNumber(rows[index - 1].rank)}`, x + 115, cy + 26, 15, C.muted, false, 550);
  });
  const bottom = y + rows.length * rowHeight + 6;
  label(ctx, '0', chartX, bottom, 15, C.muted, false, 80);
  label(ctx, formatNumber(ceiling), chartX + chartW, bottom, 15, C.muted, false, 150, 'right');
}
export async function renderPsxLeaderboard(board) {
  const { canvas, ctx } = await base(1150, board);
  label(ctx, `GLOBAL #${formatNumber(board.entries[0]?.rank || 0)} – #${formatNumber(board.entries.at(-1)?.rank || 0)}`, 42, 235, 27, C.white, true, 740);
  label(ctx, `${formatNumber(board.total)} published players`, 1158, 235, 21, C.muted, false, 450, 'right');
  box(ctx, 40, 268, 1120, 782);
  label(ctx, 'POSITION / PLAYER', 67, 310, 17, C.muted, true, 500);
  label(ctx, 'RARE PET POINTS / SCALE FROM ZERO', 1133, 310, 17, C.muted, true, 620, 'right');
  if (board.entries.length) bars(ctx, board.entries, { y: 361, rowHeight: 65, large: true });
  else label(ctx, 'No entries published yet.', 600, 650, 31, C.muted, false, 900, 'center');
  snapshot(ctx, board, board.cacheFallback, 1090);
  label(ctx, `Page ${board.page}/${board.pages}  /  Refresh about once a minute  /  /psx-points to check yourself`, 42, 1122, 18, C.muted, false, 1120);
  return canvas.toBuffer('image/png');
}
export async function renderPsxPoints(result, account = {}) {
  const { canvas, ctx } = await base(1100, result.board);
  const entry = result.entry;
  box(ctx, 40, 213, 685, 202); box(ctx, 745, 213, 415, 202);
  label(ctx, entry ? name(entry) : account.name || account.username || `Roblox ${result.userId}`, 65, 257, 27, C.white, true, 635);
  label(ctx, entry ? formatNumber(entry.points) : 'NOT PUBLISHED', 63, 339, entry ? 73 : 43, C.white, true, 640);
  label(ctx, 'RARE PET POINTS', 65, 383, 19, C.purple, true, 620);
  label(ctx, 'GLOBAL POSITION', 774, 258, 19, C.muted, true, 350);
  label(ctx, entry ? `#${formatNumber(entry.rank)}` : 'UNKNOWN', 771, 339, entry ? 66 : 34, C.purple, true, 360);
  label(ctx, `${formatNumber(result.board.total)} published players`, 774, 383, 18, C.muted, false, 360);
  box(ctx, 40, 438, 1120, 154, '#211D2C', '#64513E');
  if (result.nextPlayer && result.pointsToPass !== null) {
    label(ctx, `NEXT PLAYER / #${formatNumber(result.nextPlayer.rank)}`, 65, 477, 18, C.gold, true, 540);
    label(ctx, name(result.nextPlayer), 65, 520, 31, C.white, true, 540);
    label(ctx, `${formatNumber(result.nextPlayer.points)} points / gap ${formatNumber(result.scoreGap)}`, 65, 562, 20, C.muted, false, 620);
    label(ctx, `+${formatNumber(result.pointsToPass)}`, 1132, 518, 53, C.gold, true, 488, 'right');
    label(ctx, 'POINTS TO PASS THEIR SCORE', 1132, 557, 18, C.gold, true, 490, 'right');
  } else {
    label(ctx, entry?.rank === 1 ? 'YOU LEAD THIS BOARD' : 'NEXT PLAYER / NOT AVAILABLE', 65, 489, 27, C.gold, true, 1040);
    label(ctx, entry?.rank === 1 ? 'No player is ahead of you in this snapshot.' : entry ? 'Refresh to compare players from the same board snapshot.' : 'Outside the published rows does not mean zero points.', 65, 547, 23, C.muted, false, 1040);
  }
  box(ctx, 40, 615, 1120, 367);
  label(ctx, 'NEARBY PLAYERS / POINTS', 66, 655, 20, C.white, true, 730);
  label(ctx, 'YOU = PURPLE', 1133, 655, 17, C.purple, true, 320, 'right');
  if (result.neighbours?.length) bars(ctx, result.neighbours, { y: 704, rowHeight: 41, selfId: result.userId, nextId: result.nextPlayer?.userId });
  else {
    label(ctx, 'Comparison data is not available.', 600, 794, 29, C.muted, false, 1000, 'center');
    label(ctx, 'Your result above is shown only when reported by the API.', 600, 842, 20, C.muted, false, 1000, 'center');
  }
  if (result.behindPlayer && result.leadOverBehind !== null) label(ctx, `Your lead over #${formatNumber(result.behindPlayer.rank)}: ${formatNumber(result.leadOverBehind)} points`, 66, 968, 16, C.cyan, false, 1068);
  snapshot(ctx, result.board, result.cacheFallback, 1022);
  label(ctx, 'Gap is a snapshot, not a rank guarantee. Other players can keep hatching. Ties need +1 to lead in points.', 42, 1063, 17, C.muted, false, 1120);
  return canvas.toBuffer('image/png');
}
