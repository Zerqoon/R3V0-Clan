import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { compactNumber, formatNumber } from './utils.js';
import { getRobloxAvatarUrl } from './ps99.js';
import { CLAN_PALETTE, CLAN_BRAND } from './theme.js';
import { drawClanLogo, validateBrandAssets } from './brand-art.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKGROUND_PATH = path.join(root, 'assets/background.png');
for (const [name, family] of [['DejaVuSans.ttf', 'R3V0 Sans'], ['DejaVuSans-Bold.ttf', 'R3V0 Bold']]) {
  const font = `/usr/share/fonts/truetype/dejavu/${name}`;
  if (fs.existsSync(font)) GlobalFonts.registerFromPath(font, family);
}
export const CANVAS_PALETTE = CLAN_PALETTE;
const PLAYER_PALETTE = Object.freeze({ ...CLAN_PALETTE, panelRaised: CLAN_PALETTE.panel2 });
let cachedBackgroundPromise = null;
const avatarCache = new Map();
const AVATAR_CACHE_TTL = 10 * 60 * 1000;
const safeNumber = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

function roundedRect(ctx, x, y, w, h, r, fill, stroke = null, lineWidth = 1) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}
function font(ctx, size, bold = false) {
  ctx.font = `${bold ? 'bold' : 'normal'} ${size}px "R3V0 ${bold ? 'Bold' : 'Sans'}", sans-serif`;
}
function text(ctx, value, x, y, size, color = CANVAS_PALETTE.text, weight = 'normal', align = 'left', maxWidth = null) {
  let label = String(value ?? '').replace(/[\r\n\t]/g, ' ');
  let fontSize = size;
  font(ctx, fontSize, weight === 'bold');
  if (maxWidth) {
    while (fontSize > Math.max(10, size * 0.66) && ctx.measureText(label).width > maxWidth) {
      fontSize -= 1; font(ctx, fontSize, weight === 'bold');
    }
    if (ctx.measureText(label).width > maxWidth) {
      while (label.length && ctx.measureText(`${label}…`).width > maxWidth) label = label.slice(0, -1);
      label += '…';
    }
  }
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(label, x, y);
}
async function remoteImage(url) {
  if (!url) return null;
  const now = Date.now(), cached = avatarCache.get(url);
  if (cached && cached.expiresAt > now) return cached.image;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok || !(res.headers.get('content-type') || '').toLowerCase().startsWith('image/')) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > 4_000_000) return null;
    const image = await loadImage(bytes);
    if (avatarCache.size >= 150) avatarCache.delete(avatarCache.keys().next().value);
    avatarCache.set(url, { image, expiresAt: now + AVATAR_CACHE_TTL });
    return image;
  } catch { return null; }
}
async function getBackgroundImage() {
  if (!cachedBackgroundPromise) cachedBackgroundPromise = loadImage(BACKGROUND_PATH).catch(() => null);
  return cachedBackgroundPromise;
}
async function drawBackground(ctx, width, height) {
  ctx.fillStyle = CANVAS_PALETTE.background; ctx.fillRect(0, 0, width, height);
  const image = await getBackgroundImage();
  if (image) {
    const scale = Math.max(width / image.width, height / image.height);
    const drawWidth = image.width * scale, drawHeight = image.height * scale;
    ctx.save(); ctx.globalAlpha = 0.70;
    ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    ctx.restore();
  }
  const shade = ctx.createLinearGradient(0, 0, width, height);
  shade.addColorStop(0, 'rgba(8,6,15,0.55)'); shade.addColorStop(0.5, 'rgba(8,6,15,0.36)');
  shade.addColorStop(1, 'rgba(8,6,15,0.75)'); ctx.fillStyle = shade; ctx.fillRect(0, 0, width, height);
}
async function drawPlayerBackground(ctx, width, height) { await drawBackground(ctx, width, height); }
function frame(ctx, width, height) {
  roundedRect(ctx, 16, 16, width - 32, height - 32, 24, 'rgba(12,8,21,0.79)', '#4D3469', 1.5);
  const line = ctx.createLinearGradient(32, 0, width - 32, 0);
  line.addColorStop(0, '#E0C28A'); line.addColorStop(0.18, '#BA90FF');
  line.addColorStop(0.65, '#4C2D70'); line.addColorStop(1, '#B189EC');
  ctx.fillStyle = line; ctx.fillRect(38, 17, width - 76, 3);
  ctx.strokeStyle = '#AA7BDA'; ctx.lineWidth = 2;
  for (const [x, direction] of [[32, 1], [width - 32, -1]]) {
    ctx.beginPath(); ctx.moveTo(x, 60); ctx.lineTo(x, 32); ctx.lineTo(x + direction * 30, 32); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, height - 60); ctx.lineTo(x, height - 32); ctx.lineTo(x + direction * 30, height - 32); ctx.stroke();
  }
}
function pill(ctx, label, x, y, w, color = CANVAS_PALETTE.purple) {
  roundedRect(ctx, x, y, w, 30, 8, '#21162F', '#58406E');
  text(ctx, label, x + w / 2, y + 20, 11, color, 'bold', 'center', w - 18);
}
async function drawAvatar(ctx, url, x, y, size, fallback = 'R3V0') {
  const image = await remoteImage(url), cx = x + size / 2, cy = y + size / 2;
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, Math.PI * 2); ctx.clip();
  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, '#3A2356'); gradient.addColorStop(1, '#150D25');
  ctx.fillStyle = gradient; ctx.fillRect(x, y, size, size);
  if (image) {
    const scale = Math.max(size / image.width, size / image.height);
    ctx.drawImage(image, cx - image.width * scale / 2, cy - image.height * scale / 2, image.width * scale, image.height * scale);
  } else {
    text(ctx, String(fallback).slice(0, 1).toUpperCase(), cx, cy + size * 0.17, size * 0.48, '#EAD7FF', 'bold', 'center');
  }
  ctx.restore();
  for (const [r, color, stroke] of [[size / 2 + 5, '#BA90FF', 2], [size / 2 + 12, '#4B3265', 1]]) {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.lineWidth = stroke; ctx.stroke();
  }
}

export async function renderWelcomeCanvas(member, memberCount) {
  const width = 1440, height = 560, canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  const p = CANVAS_PALETTE;
  await drawBackground(ctx, width, height); frame(ctx, width, height);
  await drawClanLogo(ctx, 84, 82, 84);
  text(ctx, 'R3V0', 134, 79, 30, p.text, 'bold');
  text(ctx, 'CLAN COMMUNITY', 136, 101, 11, p.purple, 'bold');
  text(ctx, 'A NEW FACE. A SHARED LEGACY.', 66, 177, 13, p.orange, 'bold');
  text(ctx, 'WELCOME TO R3V0', 62, 237, 48, p.text, 'bold', 'left', 840);
  const displayName = member.user.globalName || member.user.username || 'New member';
  text(ctx, displayName, 64, 306, 48, p.purple, 'bold', 'left', 800);
  text(ctx, 'Find your people. Build your legacy with us.', 67, 350, 19, p.muted, 'normal', 'left', 790);
  text(ctx, 'Read the clan code and make yourself at home.', 67, 381, 17, p.muted);
  roundedRect(ctx, 66, 416, 228, 63, 12, '#1B122A', '#503867');
  text(ctx, 'COMMUNITY MEMBER', 84, 440, 10, p.muted, 'bold');
  text(ctx, `#${formatNumber(safeNumber(memberCount))}`, 84, 465, 21, p.text, 'bold', 'left', 190);
  pill(ctx, 'PET SIMULATOR 99', 310, 433, 180, p.orange);
  // A heraldic shield makes the member portrait part of the clan identity.
  const cx = 1155;
  ctx.beginPath(); ctx.moveTo(cx - 139, 149); ctx.lineTo(cx, 124); ctx.lineTo(cx + 139, 149);
  ctx.lineTo(cx + 126, 334); ctx.quadraticCurveTo(cx + 103, 387, cx, 426);
  ctx.quadraticCurveTo(cx - 103, 387, cx - 126, 334); ctx.closePath();
  ctx.fillStyle = 'rgba(27,16,44,0.92)'; ctx.fill(); ctx.strokeStyle = '#725096'; ctx.lineWidth = 1.5; ctx.stroke();
  await drawAvatar(ctx, member.user.displayAvatarURL?.({ extension: 'png', size: 512 }), cx - 86, 179, 172, member.user.username);
  pill(ctx, 'COMMUNITY MEMBER', cx - 103, 371, 206);
  text(ctx, `@${member.user.username || 'newmember'}`, cx, 458, 18, p.muted, 'bold', 'center', 312);
  text(ctx, CLAN_BRAND.motto, width - 64, 518, 11, p.muted, 'bold', 'right');
  return canvas.toBuffer('image/png');
}

function niceChartMax(value) {
  const safe = Math.max(1, safeNumber(value)), power = 10 ** Math.floor(Math.log10(safe));
  const fraction = safe / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
}
function chartTickLabel(value, scaleMax) { return scaleMax < 1000 ? formatNumber(Math.round(value)) : compactNumber(value); }
function hourLabels(ctx, x, y, w) {
  for (const [index, label] of [[0, '24h ago'], [4, '20h'], [8, '16h'], [12, '12h ago'], [16, '8h'], [20, '4h'], [23, 'NOW']]) {
    text(ctx, label, x + w * index / 23, y, 12, index === 23 ? PLAYER_PALETTE.purple : PLAYER_PALETTE.muted,
      index === 23 ? 'bold' : 'normal', index === 0 ? 'left' : index === 23 ? 'right' : 'center');
  }
}
export async function renderPlayerCanvas({ player, clan, history = [], avatarUrl = null }) {
  const width = 1440, height = 880, canvas = createCanvas(width, height), ctx = canvas.getContext('2d'), p = PLAYER_PALETTE;
  await drawPlayerBackground(ctx, width, height); frame(ctx, width, height);
  const avatar = avatarUrl === false ? null : avatarUrl || await getRobloxAvatarUrl(player.userId).catch(() => null);
  await drawAvatar(ctx, avatar, 65, 71, 108, player.username);
  text(ctx, 'R3V0  /  MEMBER DOSSIER', 205, 67, 13, p.orange, 'bold');
  text(ctx, `@${player.username || 'Unknown'}`, 202, 118, 38, p.text, 'bold', 'left', 735);
  const displayName = String(player.displayName || player.username || 'Unknown');
  text(ctx, `Display name: ${displayName}`, 205, 150, 15, p.muted, 'normal', 'left', 715);
  text(ctx, String(clan.activeBattle || 'Battle data unavailable'), 205, 183, 14, p.purple, 'bold', 'left', 715);
  await drawClanLogo(ctx, 1320, 88, 112);
  pill(ctx, player.clanRank == null ? 'CLAN MEMBER' : `#${player.clanRank} IN R3V0`, 1086, 153, 240);
  text(ctx, 'PLAYER PROGRESS', 1166, 125, 12, p.muted, 'bold', 'center');
  const known = player.pointsKnown !== false;
  const stats = [
    { label: 'BATTLE POINTS', value: player.pointsKnown === false ? 'Not reported' : formatNumber(player.points), color: p.text },
    { label: player.historyIsFullDay === false ? 'SINCE TRACKING' : '24H PROGRESS', value: known ? `+${compactNumber(safeNumber(player.progress24h))}` : 'Not reported', color: p.purple },
    { label: 'AVERAGE / HOUR', value: known ? compactNumber(safeNumber(player.averagePerHour)) : '—', color: p.blue },
    { label: 'BEST HOUR', value: known ? compactNumber(safeNumber(player.bestHour)) : '—', color: p.orange },
    { label: 'LATEST HOUR', value: known ? compactNumber(safeNumber(player.latestHour)) : '—', color: p.green },
  ];
  const margin = 44, gap = 14, sw = (width - margin * 2 - gap * 4) / 5, sy = 221;
  stats.forEach((s, i) => {
    const x = margin + (sw + gap) * i;
    const fill = ctx.createLinearGradient(0, sy, 0, sy + 116);
    fill.addColorStop(0, '#241832'); fill.addColorStop(1, '#130D1E');
    roundedRect(ctx, x, sy, sw, 116, 14, fill, i === 0 ? '#9062BA' : '#47305F');
    ctx.fillStyle = i === 0 ? p.purple : '#69488A'; ctx.fillRect(x + 18, sy + 19, 23, 3);
    text(ctx, s.label, x + 18, sy + 48, 11, p.muted, 'bold', 'left', sw - 35);
    text(ctx, s.value, x + 17, sy + 89, 30, s.color, 'bold', 'left', sw - 34);
  });
  roundedRect(ctx, 44, 358, width - 88, 421, 18, 'rgba(16,10,28,0.96)', '#46305D');
  text(ctx, 'HOURLY PERFORMANCE', 69, 397, 22, p.text, 'bold');
  const coverage = Math.min(24, safeNumber(player.historyCoverageHours));
  text(ctx, player.historyIsFullDay === false ? `Points earned per hour · tracking for ${coverage.toFixed(1)} hours` : 'Points earned per hour · last 24 hours', 70, 425, 13, p.muted);
  pill(ctx, 'POINTS / HOUR', 1197, 381, 166);
  const chart = { x: 135, y: 467, w: 1223, h: 229 };
  const values = Array.from({ length: 24 }, (_, i) => safeNumber(history[i]));
  const maxValue = Math.max(4, Math.ceil(niceChartMax(Math.max(1, ...values) * 1.12) / 4) * 4);
  for (let i = 0; i <= 4; i++) {
    const y = chart.y + chart.h * i / 4;
    ctx.strokeStyle = i === 4 ? '#584367' : '#30223F'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(chart.x, y); ctx.lineTo(chart.x + chart.w, y); ctx.stroke();
    text(ctx, chartTickLabel(maxValue * (1 - i / 4), maxValue), chart.x - 18, y + 4, 12, p.muted, 'normal', 'right');
  }
  for (const i of [0, 4, 8, 12, 16, 20, 23]) {
    const x = chart.x + chart.w * i / 23;
    ctx.strokeStyle = '#251A31'; ctx.beginPath(); ctx.moveTo(x, chart.y); ctx.lineTo(x, chart.y + chart.h); ctx.stroke();
  }
  const points = values.map((v, i) => ({ x: chart.x + chart.w * i / 23, y: chart.y + chart.h - v / maxValue * chart.h }));
  const fill = ctx.createLinearGradient(0, chart.y, 0, chart.y + chart.h);
  fill.addColorStop(0, 'rgba(169,109,247,0.25)'); fill.addColorStop(1, 'rgba(169,109,247,0.01)');
  ctx.beginPath(); ctx.moveTo(chart.x, chart.y + chart.h);
  points.forEach(point => ctx.lineTo(point.x, point.y));
  ctx.lineTo(chart.x + chart.w, chart.y + chart.h); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  ctx.beginPath(); points.forEach((point, i) => i === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
  ctx.strokeStyle = p.chart; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
  const peak = Math.max(...values), peakIndex = values.lastIndexOf(peak);
  for (const i of new Set([0, 4, 8, 12, 16, 20, 23, peakIndex])) {
    const point = points[i];
    ctx.beginPath(); ctx.arc(point.x, point.y, i === peakIndex || i === 23 ? 4.5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = i === peakIndex && peak > 0 ? p.orange : p.chart; ctx.fill();
  }
  if (peak > 0) {
    const point = points[peakIndex], label = `BEST  ${compactNumber(peak)}`;
    const labelWidth = 142, x = Math.max(chart.x, Math.min(chart.x + chart.w - labelWidth, point.x - labelWidth / 2));
    const y = Math.max(chart.y + 5, point.y - 40);
    roundedRect(ctx, x, y, labelWidth, 28, 7, '#312139', '#9A794C');
    text(ctx, label, x + labelWidth / 2, y + 19, 11, p.orange, 'bold', 'center');
  } else {
    text(ctx, history.length ? 'No points recorded in this window' : 'Hourly history will appear as snapshots are collected', chart.x + chart.w / 2, chart.y + chart.h / 2, 15, p.muted, 'normal', 'center', chart.w - 80);
  }
  hourLabels(ctx, chart.x, 733, chart.w);
  const memberCount = Array.isArray(clan.members) ? clan.members.length : 0;
  text(ctx, `ROSTER  ${memberCount}/${Math.max(memberCount, safeNumber(clan.memberCapacity))}`, 61, 817, 11, p.muted, 'bold');
  text(ctx, 'SOURCE  BIG GAMES PUBLIC API', width / 2, 817, 11, p.subdued, 'bold', 'center');
  text(ctx, `RENDERED ${new Date().toISOString().slice(11, 16)} UTC`, width - 61, 817, 11, p.muted, 'normal', 'right');
  text(ctx, CLAN_BRAND.motto, width / 2, 847, 10, p.purple, 'bold', 'center');
  return canvas.toBuffer('image/png');
}

export async function createPreviewImages() {
  await validateBrandAssets();
  const preview = path.join(root, 'preview'); fs.mkdirSync(preview, { recursive: true });
  const member = { user: { username: 'R3V0_Player', globalName: 'R3V0 Player', displayAvatarURL: () => null } };
  fs.writeFileSync(path.join(preview, 'welcome.png'), await renderWelcomeCanvas(member, 125));
  const player = { userId: '123', username: 'B3STTIEE', displayName: 'Clan Leader', points: 276030, clanRank: 1, progress24h: 107830, averagePerHour: 4493, bestHour: 38000, latestHour: 12830, historyIsFullDay: true, historyCoverageHours: 24 };
  const history = [0, 0, 18000, 0, 0, 10000, 0, 0, 0, 24000, 0, 0, 0, 0, 0, 0, 38000, 0, 0, 0, 0, 0, 5000, 12830];
  fs.writeFileSync(path.join(preview, 'player-progress.png'), await renderPlayerCanvas({ player, clan: { activeBattle: 'Fantasy Clan Battle', members: Array.from({ length: 50 }, () => ({})), memberCapacity: 50 }, history, avatarUrl: false }));
}
