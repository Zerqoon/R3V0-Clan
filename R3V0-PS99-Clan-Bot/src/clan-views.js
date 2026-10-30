import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ThumbnailBuilder, SectionBuilder } from 'discord.js';
import { config } from './config.js';
import { db, getSetting } from './db.js';
import { getAccountLink } from './account-links.js';
import { currentClan, clanDataState, observedProgress, goalsForBattle, getSeasons, seasonMembers } from './clan-store.js';
import { buildBattleDashboardModel } from './battle-layout.js';
import { getDonationSummary } from './donations.js';
import { card, text, divider, section, row, button, v2 } from './ui.js';
import { formatNumber, escapeMarkdown } from './utils.js';
import { slotMeter, CLAN_COLORS } from './theme.js';
import { outboxStatus } from './outbox.js';
import { databaseIsReady } from './maintenance.js';
const number = value => value == null ? 'Not reported' : formatNumber(value);
const pagesFor = (length, page, size = 10) => { const pages = Math.max(1, Math.ceil(length / size)); return { pages, page: Math.min(pages - 1, Math.max(0, Number(page) || 0)) }; };
function navigation(prefix, page, pages) { return row(button(`${prefix}:${Math.max(0, page - 1)}:back`, 'Back').setDisabled(page === 0), button(`${prefix}:${Math.min(pages - 1, page + 1)}:next`, 'Next').setDisabled(page === pages - 1)); }
export function buildProfilePayload(guildId, discordId, clan = currentClan(), avatarUrl = null) {
  const link = getAccountLink(guildId, discordId);
  if (!link) return v2(card('🔗 YOUR R3V0 PROFILE', 'Connect your Roblox account to see your clan result, goals and diamond contributions.').addSectionComponents(section('**Verify your account**\nPlace a one-time code in your Roblox About section, then let the bot check it.', button('account:start', 'Connect Roblox', ButtonStyle.Primary))));
  const model = buildBattleDashboardModel(clan || {});
  const member = model.members.find(item => String(item.userId) === link.robloxId);
  const username = member?.username || link.username;
  const state = clanDataState(clan);
  const container = card(`👤 ${escapeMarkdown(username, 30)}`, `**Verified Roblox account** · <@${discordId}>\n${member ? '**R3V0 clan member**' : 'Community member · not in the last reported R3V0 roster'}`);
  if (avatarUrl) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text(`**Roblox ID:** \`${link.robloxId}\`\n**Connected:** <t:${Math.floor(link.verifiedAt / 1000)}:D>`)).setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl)));
  else container.addTextDisplayComponents(text(`**Roblox ID:** \`${link.robloxId}\` · Connected <t:${Math.floor(link.verifiedAt / 1000)}:D>`));
  if (member) {
    const progress = observedProgress(link.robloxId, clan.activeBattleId, member.pointsKnown ? member.points : null);
    container.addSeparatorComponents(divider()).addTextDisplayComponents(text(`### ${escapeMarkdown(model.battleName, 100)}\n**Battle points:** ${number(member.pointsKnown ? member.points : null)}\n**Clan position:** ${member.pointsKnown ? `#${member.clanRank}` : 'Not reported'}\n**${progress.fullDay ? '24-hour' : 'Observed'} progress:** ${progress.growth === null ? 'Not enough data' : `+${formatNumber(progress.growth)} points`}\n-# Available history: ${progress.coverageHours.toFixed(1)} hours. Point gains do not measure online playtime.`));
    const goal = goalsForBattle(clan.activeBattleId).find(item => item.user_id === link.robloxId);
    if (goal) container.addTextDisplayComponents(text(`**Your battle goal:** ${member.pointsKnown ? `${formatNumber(member.points)} / ${formatNumber(goal.target)} · ${Math.min(100, Math.floor(member.points / goal.target * 100))}%\n\`${slotMeter(member.points, goal.target)}\`` : 'Score not reported; goal is not evaluated.'}`));
    const best = db.prepare('SELECT MAX(points) AS points FROM season_members WHERE user_id=?').get(link.robloxId)?.points;
    const badges = best >= 100000 ? '🏆 100K Contributor' : best >= 50000 ? '🥈 50K Contributor' : best >= 10000 ? '🥉 10K Contributor' : null;
    if (badges) container.addTextDisplayComponents(text(`**Achievement:** ${badges}`));
  }
  const donation = getDonationSummary().donors.find(item => item.userId === link.robloxId);
  container.addSeparatorComponents(divider()).addTextDisplayComponents(text(`**Lifetime clan donation:** ${donation ? formatNumber(donation.amount) : 'Not reported'} gems\n-# ${state.name}${clan?.updatedAt ? ` · Updated <t:${Math.floor(clan.updatedAt / 1000)}:R>` : ''}`));
  container.addActionRowComponents(row(new ButtonBuilder().setLabel('Roblox profile').setStyle(ButtonStyle.Link).setURL(`https://www.roblox.com/users/${link.robloxId}/profile`), button('clan:goals:0', 'Battle goals'), button('clan:donations:0', 'Donations')));
  return v2(container);
}
export function buildRankingPayload(clan = currentClan(), sort = 'total', requestedPage = 0) {
  if (!clan) return v2(card('🏆 CLAN RANKING', 'Waiting for the first successful R3V0 API read.'));
  const model = buildBattleDashboardModel(clan);
  const members = model.members.map(member => ({ ...member, progress: observedProgress(member.userId, clan.activeBattleId, member.pointsKnown ? member.points : null) }));
  if (sort === 'growth') members.sort((a, b) => Number(b.progress.growth !== null) - Number(a.progress.growth !== null) || (b.progress.growth || 0) - (a.progress.growth || 0) || a.clanRank - b.clanRank);
  const { page, pages } = pagesFor(members.length, requestedPage);
  const container = card('🏆 FULL CLAN RANKING', `**${escapeMarkdown(model.battleName, 100)}** · ${sort === 'growth' ? 'Observed progress, up to 24 hours' : 'Battle points'}\n-# Private view · browsing does not change the public panel.`);
  container.addTextDisplayComponents(text(members.slice(page * 10, page * 10 + 10).map((member, index) => {
    const score = sort === 'growth' ? member.progress.growth : member.pointsKnown ? member.points : null;
    const suffix = sort === 'growth' && score !== null ? ` · ${member.progress.fullDay ? '24h' : `${member.progress.coverageHours.toFixed(1)}h observed`}` : '';
    return `**${page * 10 + index + 1}. ${escapeMarkdown(member.username, 40)}**${member.isOwner ? ' · Leader' : ''}\n${score === null ? 'Not reported' : `${sort === 'growth' ? '+' : ''}${formatNumber(score)} points`}${suffix}`;
  }).join('\n\n') || 'No roster members reported.'));
  const select = new StringSelectMenuBuilder().setCustomId('clan:rank-sort').setPlaceholder('Choose ranking').addOptions({ label: 'Battle points', value: 'total', default: sort !== 'growth' }, { label: 'Observed progress', value: 'growth', default: sort === 'growth' });
  container.addActionRowComponents(new ActionRowBuilder().addComponents(select), navigation(`clan:ranking:${sort}`, page, pages));
  container.addTextDisplayComponents(text(`-# Page ${page + 1}/${pages} · ${clanDataState(clan).name} · Missing scores remain unknown.`));
  return v2(container);
}
export function buildGoalsPayload(clan = currentClan(), requestedPage = 0) {
  if (!clan) return v2(card('🎯 CLAN GOALS', 'Waiting for current battle data.'));
  const goals = goalsForBattle(clan.activeBattleId);
  const { page, pages } = pagesFor(goals.length, requestedPage);
  const container = card('🎯 BATTLE GOALS', `**${escapeMarkdown(clan.activeBattle, 100)}**`);
  if (!goals.length) container.addTextDisplayComponents(text('Clan leadership has not set a target for this battle yet.'));
  for (const goal of goals.slice(page * 10, page * 10 + 10)) {
    const member = goal.user_id ? clan.members.find(item => String(item.userId) === goal.user_id) : null;
    const value = goal.user_id ? member?.pointsKnown ? member.points : null : clan.totalBattlePoints;
    container.addTextDisplayComponents(text(`**${goal.user_id ? escapeMarkdown(member?.username || goal.user_id, 40) : 'R3V0 · CLAN GOAL'}**\n${value == null ? 'Score not reported — goal not evaluated.' : `**${formatNumber(value)} / ${formatNumber(goal.target)}** points · **${Math.min(100, Math.floor(value / goal.target * 100))}%**\n\`${slotMeter(value, goal.target)}\` · ${Math.max(0, goal.target - value) === 0 ? 'Completed' : `${formatNumber(goal.target - value)} points remaining`}`}`));
  }
  container.addActionRowComponents(navigation('clan:goals', page, pages));
  return v2(container);
}
export function buildHistoryPayload(requestedPage = 0) {
  const seasons = getSeasons();
  const { page, pages } = pagesFor(seasons.length, requestedPage, 5);
  const container = card('🏛️ R3V0 BATTLE HISTORY', 'Saved battle results and member contributions.');
  if (!seasons.length) container.addTextDisplayComponents(text('Battle history starts with the first successful read after this update.'));
  for (const season of seasons.slice(page * 5, page * 5 + 5)) container.addSectionComponents(section(`**${escapeMarkdown(season.title, 100)}**\n${season.status === 'active' ? 'Current battle' : 'Archived'} · **${number(season.total_points)}** observed points\nLast observed <t:${Math.floor(season.updated_at / 1000)}:D>`, button(`clan:season:${season.id}:0`, 'View results')));
  container.addActionRowComponents(navigation('clan:history', page, pages));
  return v2(container);
}
export function buildSeasonPayload(id, requestedPage = 0) {
  const season = db.prepare('SELECT * FROM seasons WHERE id=?').get(Number(id));
  if (!season) throw new Error('This archived battle was not found.');
  const members = seasonMembers(id), { page, pages } = pagesFor(members.length, requestedPage);
  const container = card(`🏆 ${escapeMarkdown(season.title, 100)}`, `**${number(season.total_points)}** last observed clan points${season.rank ? ` · Rank **#${season.rank}**` : ''}\n-# ${season.status === 'active' ? 'Current battle' : 'Archived'} · Last observed <t:${Math.floor(season.updated_at / 1000)}:F>`);
  container.addTextDisplayComponents(text(members.slice(page * 10, page * 10 + 10).map((member, index) => `**${page * 10 + index + 1}. ${escapeMarkdown(member.username, 40)}** · ${number(member.points)} points${member.present ? '' : ' · left the roster'}`).join('\n') || 'No member scores recorded.'));
  container.addTextDisplayComponents(text('-# These are the last scores captured by this bot, not a claim that the official final result was observed.'));
  container.addActionRowComponents(navigation(`clan:season:${season.id}`, page, pages));
  return v2(container);
}
export function buildDiagnosticsPayload() {
  const monitor = getSetting('monitor_status', {}), donation = getDonationSummary(), clan = currentClan();
  const counts = outboxStatus().map(item => `${item.status}: ${item.count}`).join(' · ') || 'No pending jobs';
  return v2(card('⚙️ R3V0 SYSTEM STATUS', `**Database:** ${databaseIsReady() ? 'Ready' : 'Unavailable'}\n**Clan data:** ${clanDataState(clan).name}\n**Last successful refresh:** ${monitor.lastSuccessAt ? `<t:${Math.floor(monitor.lastSuccessAt / 1000)}:R>` : 'Not yet'}\n**Consecutive failures:** ${monitor.failures || 0}\n**Last API error:** ${escapeMarkdown(monitor.lastError || 'None', 600)}\n\n**Donation source:** ${donation.source || 'Not reported'}\n**Reported donation rows:** ${donation.rowCount || 0}\n**Counter regressions:** ${donation.regressions || 0}\n**Receipts awaiting API coverage:** ${donation.pendingReceipts}\n**Donation read error:** ${escapeMarkdown(donation.error || 'None', 400)}\n\n**Delivery queue:** ${counts}\n**Last verified backup:** ${getSetting('last_backup_at') ? `<t:${Math.floor(getSetting('last_backup_at') / 1000)}:R>` : 'Not yet'}`)
    .addActionRowComponents(row(button('staff:refresh', 'Refresh data', ButtonStyle.Primary), button('staff:retry', 'Retry pending jobs'), button('staff:backup', 'Create backup'), button('staff:home', 'Staff home'))));
}
export function buildStaffPayload() {
  const tickets = db.prepare("SELECT COUNT(*) AS count FROM tickets WHERE status='open'").get().count;
  const closing = db.prepare("SELECT COUNT(*) AS count FROM tickets WHERE status='closing'").get().count;
  return v2(card('🛡️ R3V0 CLAN CONTROL', `**Open applications:** ${tickets} · **Archives awaiting completion:** ${closing}\nManage recruitment, battle targets and bot settings.`)
    .addSectionComponents(section('**Recruitment**\nReview applications, assigned staff and archive status.', button('staff:tickets:0', 'Applications', ButtonStyle.Primary)))
    .addSectionComponents(section('**Battle goals**\nSet the clan target or an individual member target.', button('staff:goal', 'Set a goal')))
    .addSectionComponents(section('**Treasury**\nInspect API detection and receipts awaiting an official increase.', button('staff:donations', 'Donation status')))
    .addActionRowComponents(row(button('staff:settings', 'Settings'), button('staff:diagnostics', 'Diagnostics'), button('staff:requirements', 'Recruitment requirements'))));
}
export function buildTicketListPayload(requestedPage = 0) {
  const tickets = db.prepare("SELECT * FROM tickets WHERE status IN ('open','closing') ORDER BY created_at").all();
  const { page, pages } = pagesFor(tickets.length, requestedPage, 5);
  const container = card('🎫 RECRUITMENT DESK', `${tickets.length} active applications`);
  for (const ticket of tickets.slice(page * 5, page * 5 + 5)) container.addSectionComponents(section(`<@${ticket.opener_id}> · **${ticket.type === 'psx' ? 'Classic PSX' : 'PS99'}**\n${ticket.status === 'closing' ? 'Archiving — automatic retry enabled' : ticket.decision} · ${ticket.claimed_by ? `Assigned <@${ticket.claimed_by}>` : 'Unassigned'}\nOpened <t:${Math.floor(ticket.created_at / 1000)}:R>`, new ButtonBuilder().setLabel('Open ticket').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${ticket.guild_id}/${ticket.channel_id}`)));
  if (!tickets.length) container.addTextDisplayComponents(text('There are no active applications.'));
  container.addActionRowComponents(navigation('staff:tickets', page, pages), row(button('staff:retry', 'Retry pending archives'), button('staff:home', 'Staff home')));
  return v2(container);
}
