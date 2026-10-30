import { ButtonBuilder, ButtonStyle, MediaGalleryBuilder, MediaGalleryItemBuilder } from 'discord.js';
import { card, text, divider, section, row, button, v2 } from './ui.js';
import { escapeMarkdown, formatNumber } from './utils.js';
import { PSX_PAGE_SIZE } from './psx-classic.js';

const time = value => value ? `<t:${Math.floor(value)}:R>` : 'Not reported';
const stateName = board => board.source === 'final' ? 'FINAL RESULTS' : ({ live: 'LIVE STANDINGS', ended: 'SCORING ENDED · AWAITING FINAL RESULTS', inactive: 'INACTIVE BOARD' }[board.state] || 'LIVE STANDINGS');
const nameFor = entry => escapeMarkdown(entry.username || entry.displayName || (entry.userId ? `Roblox ${entry.userId}` : 'Unknown player'), 60);
const badge = rank => ['🥇', '🥈', '🥉'][rank - 1] || '▫️';
function freshness(board, cacheFallback) {
  return `${cacheFallback ? '**API unavailable · showing a saved result.**\n' : ''}**Board snapshot:** ${time(board.updatedAt)}\n-# BIG Games refreshes this board about once a minute. The API publishes the top rows only, up to 10,000 while live.`;
}
function sharedButtons() { return [button('psx:mine', 'My points', ButtonStyle.Primary), button('psx:find', 'Find player')]; }

export function buildPsxLeaderboardPayload(board, { imageUrl } = {}) {
  const container = card('🏆 R3V0 · PSX CLASSIC', `**Most Rare Pet Points**\n${stateName(board)} · Global leaderboard`);
  if (board.endsAt) container.addTextDisplayComponents(text(`${board.state === 'live' && board.source !== 'final' ? '**Scoring ends:**' : '**Scoring closed:**'} <t:${board.endsAt}:F> · ${time(board.endsAt)}`));
  container.addSeparatorComponents(divider());
  if (imageUrl) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl).setDescription(`PSX Classic global ranking, page ${board.page}. ${board.entries.map(entry => `#${entry.rank} ${entry.username || entry.displayName || entry.userId}: ${formatNumber(entry.points)} points`).join('; ')}`.slice(0, 1024))));
  else container.addTextDisplayComponents(text(board.entries.map(entry => `${badge(entry.rank)} **#${formatNumber(entry.rank)} · ${entry.userId ? `[@${nameFor(entry)}](https://www.roblox.com/users/${entry.userId}/profile)` : nameFor(entry)}**\n**${formatNumber(entry.points)}** rare pet points`).join('\n\n') || 'No entries are published on this page yet.'));
  container.addSeparatorComponents(divider()).addTextDisplayComponents(text(`**Page ${board.page}/${board.pages}** · ${formatNumber(board.total)} published players\n${freshness(board, board.cacheFallback)}`));
  container.addActionRowComponents(row(
    button(`psx:page:${Math.max(1, board.page - 1)}:back`, 'Previous').setDisabled(board.page <= 1),
    button(`psx:page:${Math.min(board.pages, board.page + 1)}:next`, 'Next').setDisabled(board.page >= board.pages),
    button(`psx:refresh-board:${board.page}`, 'Refresh'), ...sharedButtons()
  ));
  container.addTextDisplayComponents(text('-# /psx-points checks any Roblox player. Page buttons open your own private view; slash command results are public.'));
  return v2(container);
}

export function buildPsxPointsPayload(result, account = {}, { imageUrl } = {}) {
  const entry = result.entry;
  const name = entry ? nameFor(entry) : escapeMarkdown(account.name || account.username || `Roblox ${result.userId}`, 60);
  const container = card('🐾 R3V0 · PSX CLASSIC POINTS', `**${name}**\nMost Rare Pet Points · ${stateName(result.board)}`);
  container.addSectionComponents(section(`**Roblox ID:** \`${result.userId}\`\n**Result checked:** ${time(result.receivedAt / 1000)}`, new ButtonBuilder().setLabel('Roblox profile').setStyle(ButtonStyle.Link).setURL(`https://www.roblox.com/users/${result.userId}/profile`)));
  container.addSeparatorComponents(divider());
  if (result.found) {
    container.addTextDisplayComponents(text(`### ${formatNumber(entry.points)} rare pet points\n${badge(entry.rank)} **Global position: #${formatNumber(entry.rank)}**`));
    if (result.nextPlayer && result.pointsToPass !== null) container.addTextDisplayComponents(text(`**Next player:** ${nameFor(result.nextPlayer)} · #${formatNumber(result.nextPlayer.rank)} · ${formatNumber(result.nextPlayer.points)} points\n**Score gap:** ${formatNumber(result.scoreGap)} · **To pass their score: +${formatNumber(result.pointsToPass)} points**\n-# Snapshot comparison. Other players can gain points too.`));
    if (result.behindPlayer && result.leadOverBehind !== null) container.addTextDisplayComponents(text(`**Lead over #${formatNumber(result.behindPlayer.rank)}:** ${formatNumber(result.leadOverBehind)} points · ${nameFor(result.behindPlayer)}`));
    if (entry.rewardTier != null) container.addTextDisplayComponents(text(`**Final reward tier:** TOP ${formatNumber(entry.rewardTier)}`));
  } else container.addTextDisplayComponents(text('### Score not published\nThis account is outside the rows returned by the API, or has no entry yet. **Its score and rank are unknown.**'));
  if (imageUrl) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl).setDescription(`PSX Classic ${result.userId}: ${entry ? `${formatNumber(entry.points)} points, rank ${entry.rank}` : 'score not published'}. ${result.pointsToPass != null ? `Needs ${formatNumber(result.pointsToPass)} more points to pass the next player's score.` : 'No verified next-player comparison available.'}`)));
  container.addSeparatorComponents(divider()).addTextDisplayComponents(text(freshness(result.board, result.cacheFallback)));
  const page = entry ? Math.floor((entry.rank - 1) / PSX_PAGE_SIZE) + 1 : 1;
  container.addActionRowComponents(row(button(`psx:refresh-player:${result.userId}`, 'Refresh'), button(`psx:page:${page}:position`, entry ? 'View position' : 'Leaderboard'), ...sharedButtons()));
  return v2(container);
}

export function buildPsxConnectPayload() {
  return v2(card('🔗 PSX CLASSIC · CONNECT ROBLOX', 'Use **/link** to connect your Roblox account, then **/psx-points** will find your result automatically.\n\nYou can also check anyone with **/psx-points roblox:username**. Results are visible to everyone in this channel.').addActionRowComponents(row(button('account:start', 'Connect Roblox', ButtonStyle.Primary), button('psx:find', 'Find player'), button('psx:page:1:top', 'Leaderboard'))));
}
