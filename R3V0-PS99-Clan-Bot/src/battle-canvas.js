import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { formatNumber } from './utils.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const [file, family] of [['DejaVuSans.ttf', 'Battle Sans'], ['DejaVuSans-Bold.ttf', 'Battle Bold']]) {
  const font = `/usr/share/fonts/truetype/dejavu/${file}`;
  if (fs.existsSync(font)) GlobalFonts.registerFromPath(font, family);
}
const C = Object.freeze({ background: '#080710', panel: '#100C1B', panel2: '#191124', border: '#38244D',
  text: '#F6F1FF', muted: '#A99ABF', violet: '#BB8DFF', gold: '#EAD09B', silver: '#C7C9E4', bronze: '#CD9B8A', dim: '#6D5B83' });
let artwork;
async function assets() {
  if (!artwork) artwork = Promise.all(['r3v0-banner.png', 'r3v0-logo.png', 'background.png'].map(file => loadImage(path.join(root, 'assets', file)).catch(() => null)));
  return artwork;
}
function box(ctx, x, y, w, h, r, fill, border = null) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1.3; ctx.stroke(); }
}
function label(ctx, value, x, y, size, color = C.text, bold = false, maxWidth = null, align = 'left', minimumSize = null) {
  let text = String(value ?? '').replace(/[\r\n\t]/g, ' '), px = size;
  const setFont = () => { ctx.font = `${bold ? 'bold' : 'normal'} ${px}px "Battle ${bold ? 'Bold' : 'Sans'}", sans-serif`; };
  setFont();
  if (maxWidth) {
    while (px > (minimumSize || Math.max(15, size * 0.72)) && ctx.measureText(text).width > maxWidth) { px--; setFont(); }
    if (ctx.measureText(text).width > maxWidth) {
      while (text.length && ctx.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1);
      text += '…';
    }
  }
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function crown(ctx, x, y, size, color) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 60, size / 60);
  ctx.beginPath(); ctx.moveTo(-27, -10); ctx.lineTo(-15, 0); ctx.lineTo(0, -22);
  ctx.lineTo(15, 0); ctx.lineTo(27, -10); ctx.lineTo(21, 20); ctx.lineTo(-21, 20); ctx.closePath();
  ctx.fillStyle = color; ctx.fill(); ctx.fillRect(-21, 25, 42, 5); ctx.restore();
}
function shareText(member) { return member.rosterShare === null ? '—' : `${(member.rosterShare * 100).toFixed(1)}%`; }
function scoreText(value) { return value === null ? 'NOT REPORTED' : formatNumber(value); }
function line(ctx, x1, y, x2, color = C.border) {
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
}
function podiumCard(ctx, member, rank, x, y, width, height) {
  const color = rank === 1 ? C.gold : rank === 2 ? C.silver : C.bronze;
  const fill = ctx.createLinearGradient(x, y, x, y + height);
  fill.addColorStop(0, rank === 1 ? '#302338' : '#21172F'); fill.addColorStop(1, '#130E1F');
  box(ctx, x, y, width, height, 18, fill, member ? color : C.border);
  ctx.fillStyle = member ? color : C.border; ctx.fillRect(x + 24, y + 1, width - 48, rank === 1 ? 4 : 2);
  if (!member) {
    label(ctx, `0${rank}`, x + 28, y + 48, 30, C.dim, true);
    label(ctx, 'AWAITING POINTS', x + 28, y + 115, 25, C.dim, true, width - 56);
    label(ctx, 'No scoring member in this position', x + 28, y + 151, 17, C.dim, false, width - 56);
    return;
  }
  if (rank === 1) crown(ctx, x + 44, y + 40, 35, color);
  else label(ctx, `0${rank}`, x + 25, y + 48, 31, color, true);
  label(ctx, member.isOwner ? 'CLAN LEADER' : rank === 1 ? 'TOP CONTRIBUTOR' : 'TOP THREE', x + 81, y + 46, 16, color, true, width - 215);
  label(ctx, shareText(member), x + width - 27, y + 47, 24, color, true, 110, 'right');
  label(ctx, member.username, x + 27, y + 101, 35, C.text, true, width - 54);
  label(ctx, formatNumber(member.points), x + 27, y + 155, 47, color, true, width - 130, 'left', 20);
  label(ctx, 'PTS', x + width - 28, y + 155, 18, C.muted, true, null, 'right');
  const trackY = y + height - 28;
  box(ctx, x + 28, trackY, width - 56, 6, 3, '#30223F');
  if (member.rosterShare > 0) box(ctx, x + 28, trackY, Math.max(3, (width - 56) * member.rosterShare), 6, 3, color);
}

/** Exact data is drawn with Canvas; the supplied clan artwork is only a backdrop. */
export async function renderBattleDashboard(model) {
  const width = 1600, rowTop = model.podium.length ? 897 : 674, rowPitch = 68, rowHeight = 60, rowFont = 33;
  const contentEnd = model.rows.length ? rowTop + model.rows.length * rowPitch - 8 : rowTop + 184;
  const footerY = Math.max(model.podium.length ? 1180 : 950, contentEnd + 50);
  const height = Math.ceil(footerY + 86), canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  const [banner, logo, background] = await assets();
  ctx.fillStyle = C.background; ctx.fillRect(0, 0, width, height);
  if (background) {
    ctx.save(); ctx.globalAlpha = 0.14;
    ctx.drawImage(background, 0, 0, width, height); ctx.restore();
  }
  const backdrop = ctx.createLinearGradient(0, 0, width, height);
  backdrop.addColorStop(0, 'rgba(12,7,22,0.32)'); backdrop.addColorStop(1, 'rgba(8,7,16,0.93)');
  ctx.fillStyle = backdrop; ctx.fillRect(0, 0, width, height);
  // Preserve the complete banner composition, without cropping its wordmark.
  if (banner) {
    ctx.save(); ctx.beginPath(); ctx.roundRect(610, 26, 962, 284, 18); ctx.clip();
    const scale = Math.min(962 / banner.width, 284 / banner.height);
    const w = banner.width * scale, h = banner.height * scale;
    ctx.drawImage(banner, 610 + (962 - w) / 2, 26 + (284 - h) / 2, w, h);
    const fade = ctx.createLinearGradient(610, 0, 1120, 0);
    fade.addColorStop(0, C.background); fade.addColorStop(1, 'rgba(8,7,16,0)');
    ctx.fillStyle = fade; ctx.fillRect(610, 26, 962, 284); ctx.restore();
  }
  if (logo) ctx.drawImage(logo, 58, 43, 86, 86);
  label(ctx, 'R3V0', 160, 80, 30, C.text, true);
  label(ctx, 'ONE CLAN. ONE LEGACY.', 160, 108, 14, C.violet, true);
  label(ctx, 'CLAN BATTLE', 61, 199, 66, C.text, true, 620);
  label(ctx, model.battleName, 65, 243, 25, C.violet, true, 580);
  line(ctx, 65, 270, 398, '#543574');

  const summary = ctx.createLinearGradient(0, 310, width, 480);
  summary.addColorStop(0, '#23162F'); summary.addColorStop(0.54, '#160F24'); summary.addColorStop(1, '#1A1228');
  box(ctx, 44, 310, 1512, 172, 18, summary, '#62407F');
  label(ctx, 'CLAN BATTLE POINTS', 76, 352, 17, C.violet, true);
  label(ctx, scoreText(model.totalPoints), 73, 439, model.totalPoints === null ? 45 : 84, C.text, true, 575, 'left', 28);
  ctx.fillStyle = '#513567'; ctx.fillRect(685, 342, 1, 107);
  const tiles = [
    { x: 727, title: model.clanRank === null ? 'SCORING MEMBERS' : 'GLOBAL RANK', value: model.clanRank === null ? String(model.scoringMembers) : `#${formatNumber(model.clanRank)}`, note: model.clanRank === null ? model.reportedMembers === model.members.length ? 'With battle points' : 'Among reported scores' : 'Official battle ranking' },
    { x: 1002, title: 'ROSTER', value: `${model.members.length}${model.capacity ? ` / ${model.capacity}` : ''}`, note: `${model.scoringMembers} scoring members` },
    { x: 1271, title: 'SCORES REPORTED', value: `${model.reportedMembers} / ${model.members.length}`, note: model.members.length && model.reportedMembers === model.members.length ? 'Full roster coverage' : 'Available member scores' },
  ];
  for (const tile of tiles) {
    label(ctx, tile.title, tile.x, 353, 16, C.muted, true, 236);
    label(ctx, tile.value, tile.x - 1, 413, 45, C.text, true, 235);
    label(ctx, tile.note, tile.x, 448, 15, C.muted, false, 235);
  }

  if (model.podium.length) {
    label(ctx, 'TOP CONTRIBUTORS', 64, 527, 22, C.gold, true);
    label(ctx, 'ROSTER SHARE', 1535, 527, 15, C.muted, true, null, 'right');
    podiumCard(ctx, model.podium.find(member => member.clanRank === 2), 2, 44, 569, 484, 205);
    podiumCard(ctx, model.podium.find(member => member.clanRank === 1), 1, 558, 548, 484, 226);
    podiumCard(ctx, model.podium.find(member => member.clanRank === 3), 3, 1072, 569, 484, 205);
    label(ctx, 'MEMBER CONTRIBUTIONS', 64, 826, 25, C.text, true);
    label(ctx, `PAGE ${String(model.page + 1).padStart(2, '0')} / ${String(model.pages).padStart(2, '0')}`, 1533, 826, 18, C.violet, true, null, 'right');
  } else {
    label(ctx, 'MEMBER CONTRIBUTIONS', 63, 560, 40, C.text, true, 1070);
    label(ctx, model.pageMembers.length ? `Positions ${model.pageMembers[0].clanRank}–${model.pageMembers.at(-1).clanRank} of ${model.members.length} current members` : 'Waiting for the current R3V0 roster', 65, 600, 22, C.muted);
    label(ctx, `PAGE ${String(model.page + 1).padStart(2, '0')}`, 1535, 560, 31, C.violet, true, 300, 'right');
  }
  label(ctx, 'RANK', 73, rowTop - 22, 15, C.muted, true);
  label(ctx, 'PLAYER', 164, rowTop - 22, 15, C.muted, true);
  label(ctx, 'BATTLE POINTS', 1117, rowTop - 22, 15, C.muted, true, null, 'right');
  label(ctx, 'ROSTER SHARE', 1518, rowTop - 22, 15, C.muted, true, null, 'right');
  model.rows.forEach((member, index) => {
    const y = rowTop + index * rowPitch, baseline = y + rowHeight / 2 + rowFont * 0.34;
    box(ctx, 44, y, 1512, rowHeight, 10, index % 2 ? '#100C1B' : '#191124', '#24182F');
    label(ctx, String(member.clanRank).padStart(2, '0'), 82, baseline, rowPitch < 62 ? 25 : 29, C.violet, true, 65);
    label(ctx, member.username, 164, baseline, rowFont, C.text, true, member.isOwner ? 570 : 660);
    if (member.isOwner) {
      box(ctx, 756, y + 16, 96, 29, 7, '#34243B', '#78603F');
      label(ctx, 'LEADER', 804, y + 37, 14, C.gold, true, null, 'center');
    }
    label(ctx, member.pointsKnown ? formatNumber(member.points) : 'Not reported', 1117, baseline, rowFont, member.pointsKnown ? C.text : C.muted, true, 255, 'right', 16);
    box(ctx, 1197, y + rowHeight / 2 - 3.5, 190, 7, 3.5, '#32213F');
    if (member.rosterShare > 0) box(ctx, 1197, y + rowHeight / 2 - 3.5, Math.max(2, member.rosterShare * 190), 7, 3.5, C.violet);
    label(ctx, shareText(member), 1519, baseline, 26, C.violet, true, 112, 'right');
  });
  if (!model.rows.length) {
    const y = rowTop + 140;
    label(ctx, model.members.length ? 'YOU ARE VIEWING THE COMPLETE ROSTER' : 'WAITING FOR THE CLAN ROSTER', 800, y, 28, C.muted, true, 1400, 'center');
    label(ctx, model.members.length ? 'Every current member is included in the ranking.' : 'The next successful update will fill this board.', 800, y + 44, 21, C.dim, false, 1400, 'center');
  }
  line(ctx, 63, footerY, 1537);
  label(ctx, `CLAN LEADER  ${model.ownerName}`, 64, footerY + 34, 17, C.muted, true, 630);
  const updated = new Date(model.updatedAt);
  const stamp = Number.isNaN(updated.getTime()) ? 'TIME UNAVAILABLE' : new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(updated);
  label(ctx, `${model.snapshotIsStale ? 'LAST AVAILABLE SNAPSHOT' : 'SNAPSHOT'}  ${stamp}`, 1535, footerY + 34, 17, model.snapshotIsStale ? C.gold : C.muted, true, 580, 'right');
  label(ctx, 'Shares use reported scores of current members. Unknown scores are not treated as zero.', 800, footerY + 63, 14, C.muted, false, 1440, 'center');
  box(ctx, 15, 15, width - 30, height - 30, 22, null, '#573575');
  const accent = ctx.createLinearGradient(32, 0, 1568, 0);
  accent.addColorStop(0, C.violet); accent.addColorStop(0.55, '#67428F'); accent.addColorStop(1, C.gold);
  ctx.fillStyle = accent; ctx.fillRect(37, 16, width - 74, 3);
  return canvas.toBuffer('image/png');
}
