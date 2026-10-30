import { clanEmbed, CLAN_COLORS } from './theme.js';
import { ButtonBuilder, ButtonStyle, ActionRowBuilder, AttachmentBuilder, ContainerBuilder, SectionBuilder, ThumbnailBuilder, TextDisplayBuilder, MessageFlags, MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder, SeparatorSpacingSize } from 'discord.js';
import { config } from './config.js';
import { db, getSetting, setSetting, recordSnapshot, getUserSnapshots, cleanupSnapshots } from './db.js';
import { getClanData, getRobloxAvatarUrl, getRobloxUserByUsername, searchRobloxUsersByKeyword, matchR3V0MemberFromRobloxSearch, findClanMemberByQuery } from './ps99.js';
import { renderPlayerCanvas } from './canvas.js';
import { formatNumber, clip, escapeMarkdown } from './utils.js';
import { sendLog } from './logging.js';
import { buildBattlePageDescription, buildBattleDashboardModel, PURPLE_BATTLE_COLOR } from './battle-layout.js';
import { emoji } from './server-emojis.js';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { singleFlight } from './locks.js';
import { observeDiamondContributions, recordDonationReceipt } from './donations.js';
import { currentClan, storeClanObservation, recordMonitorError, goalsForBattle, clanDataState } from './clan-store.js';

const BATTLE_NATIVE_VERSION = 'battle-native-v4';
const BATTLE_ARTWORK = [
  { name: 'r3v0-banner.png', path: fileURLToPath(new URL('../assets/r3v0-banner.png', import.meta.url)) },
  { name: 'r3v0-logo.png', path: fileURLToPath(new URL('../assets/r3v0-logo.png', import.meta.url)) },
];

export function leaderboardPages(members, pageSize = 10) { return Math.max(1, Math.ceil(members.length / pageSize)); }
export function getLeaderboardPage(members, page = 0, pageSize = 10) {
  const pages = leaderboardPages(members, pageSize);
  const safePage = Math.min(Math.max(0, Math.floor(Number(page) || 0)), pages - 1);
  return { page: safePage, pages, members: members.slice(safePage * pageSize, (safePage + 1) * pageSize) };
}
export function computeHourlyProgress(snapshots, currentPoints, now = Date.now()) {
  const hourMs = 60 * 60 * 1000;
  const start = now - 24 * hourMs;
  const sorted = [...snapshots].filter(x => Number.isFinite(Number(x.capturedAt)) && Number.isFinite(Number(x.points)))
    .sort((a, b) => Number(a.capturedAt) - Number(b.capturedAt));
  const baseline24h = sorted.filter(s => Number(s.capturedAt) <= start).at(-1) || null;
  const firstSnapshot = sorted[0] || null;
  const baseline = baseline24h || firstSnapshot;
  const historyCoverageHours = firstSnapshot ? Math.max(0, Math.min(24, (now - Number(firstSnapshot.capturedAt)) / hourMs)) : 0;
  const progress24h = baseline ? Math.max(0, Number(currentPoints) - Number(baseline.points)) : 0;
  const series = [];
  for (let i = 0; i < 24; i++) {
    const bucketStart = Math.floor(start / hourMs) * hourMs + i * hourMs;
    const bucketEnd = bucketStart + hourMs;
    const before = sorted.filter(s => Number(s.capturedAt) <= bucketStart).at(-1);
    const during = sorted.filter(s => Number(s.capturedAt) >= bucketStart && Number(s.capturedAt) < bucketEnd).at(-1);
    const after = during || sorted.filter(s => Number(s.capturedAt) < bucketEnd).at(-1);
    let value = 0;
    if (after) {
      const prior = before || sorted.find(s => Number(s.capturedAt) < bucketStart);
      if (prior) value = Math.max(0, Number(after.points) - Number(prior.points));
    }
    series.push(Math.floor(value));
  }
  const observedHours = Math.max(1, Math.min(24, sorted.length > 1 ? Math.ceil((Number(sorted.at(-1).capturedAt) - Number(sorted[0].capturedAt)) / hourMs) : 1));
  return { progress24h, historyCoverageHours, historyIsFullDay: Boolean(baseline24h), averagePerHour: Math.floor(progress24h / observedHours), bestHour: Math.max(0, ...series), latestHour: series.at(-1) || 0, series };
}

let lastSnapshot = currentClan();
let lastSnapshotAt = Number(lastSnapshot?.updatedAt) || 0;
let snapshotPending = null;
export async function takeClanSnapshot({ force = false } = {}) {
  if (!force && lastSnapshot && Date.now() - lastSnapshotAt < 45_000) return lastSnapshot;
  if (snapshotPending) return snapshotPending;
  snapshotPending = (async () => {
    try {
      const clan = await getClanData({ force });
      const now = Date.now();
      const battleId = String(clan.activeBattleId || 'unknown-battle');
      for (const member of clan.members) if (member.pointsKnown && battleId !== 'unknown-battle') recordSnapshot({ battleId, capturedAt: now, userId: member.userId, username: member.username, points: member.points });
      if (clan.raw) observeDiamondContributions(clan.raw, clan.members, now);
      cleanupSnapshots(now - config.historyDays * 86400_000);
      storeClanObservation(clan);
      lastSnapshot = clan;
      lastSnapshotAt = now;
      return clan;
    } catch (error) {
      recordMonitorError(error);
      if (!force && lastSnapshot) return { ...lastSnapshot, snapshotIsStale: true };
      throw error;
    }
  })();
  try { return await snapshotPending; } finally { snapshotPending = null; }
}
export async function logGemEvent({ robloxUserId, username, amount, source = 'Staff receipt', note = '', eventId }) {
  const receipt = recordDonationReceipt({ eventId: eventId || `staff:${crypto.randomUUID()}`, robloxUserId, username, amount, source, note });
  return receipt.created_at;
}

export function buildBattleDetailsPayload(clan, page = 0) {
  const model = buildBattleDashboardModel({ ...clan, ownerFallbackUsername: config.ownerFallbackUsername }, page);
  const layout = buildBattlePageDescription(clan, model.page);
  const cooldownEnd = Number(clan.kickCooldownEndsAt) || 0;
  const lastKick = Number(clan.lastKickTimestamp) || 0;
  const kickText = config.kickCooldownHours > 0
    ? cooldownEnd > Math.floor(Date.now() / 1000) ? `<t:${Math.floor(cooldownEnd)}:R>` : 'Ready'
    : lastKick > 0 ? `<t:${Math.floor(lastKick)}:R>` : 'Not reported';
  const embed = clanEmbed('CLAN BATTLE / DETAILS')
    .setTitle(`${emoji('ps99Battle', '⚔️')} R3V0 Clan Battle`)
    .setDescription(`**${escapeMarkdown(model.battleName, 100)}**\n\n${layout.description}`)
    .addFields(
      { name: 'Total points', value: model.totalPoints === null ? 'Not reported' : formatNumber(model.totalPoints), inline: true },
      { name: `${emoji('ps99Rank', '🏆')} Clan rank`, value: model.clanRank === null ? 'Not reported' : `#${formatNumber(model.clanRank)}`, inline: true },
      { name: 'Scores reported', value: `${model.reportedMembers}/${model.members.length}`, inline: true },
      { name: 'Clan leader', value: escapeMarkdown(model.ownerName, 80), inline: true },
      { name: 'Battle ends', value: model.battleEndsAt ? `<t:${model.battleEndsAt}:F>\n<t:${model.battleEndsAt}:R>` : 'Not reported', inline: true },
      { name: 'Kick status', value: kickText, inline: true },
      { name: 'Roster share', value: `Shares use the **${formatNumber(model.reportedMemberTotal)}** reported points of current members. Unreported scores are excluded.`, inline: false }
    )
    .setFooter({ text: `R3V0 CLAN • Page ${model.page + 1}/${model.pages} • BIG Games data` })
    .setTimestamp(new Date(model.updatedAt));
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

export async function buildLeaderboardPayload(clan, page = 0) {
  const model = buildBattleDashboardModel({ ...clan, ownerFallbackUsername: config.ownerFallbackUsername }, page);
  const state = clanDataState(clan);
  const goal = goalsForBattle(clan.activeBattleId).find(item => !item.user_id);
  const username = member => escapeMarkdown(member.username, 64);
  const share = member => member.rosterShare === null ? '—' : `${(member.rosterShare * 100).toFixed(1)}%`;
  const points = member => member.pointsKnown ? formatNumber(member.points) : 'Not reported';
  const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
  const header = new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ⚔️ R3V0 CLAN BATTLE\n**${escapeMarkdown(model.battleName, 100)}**`))
    .setThumbnailAccessory(new ThumbnailBuilder().setURL('attachment://r3v0-logo.png').setDescription('Original R3V0 clan logo'));
  const summaryLines = [
    `**Members** ${model.members.length}${model.capacity ? `/${model.capacity}` : ''}  ·  **Scoring** ${model.scoringMembers}  ·  **Scores reported** ${model.reportedMembers}/${model.members.length}`,
    `**Clan leader** ${escapeMarkdown(model.ownerName, 64)}`,
  ];
  if (goal) summaryLines.push(`**Clan goal** ${model.totalPoints === null ? 'Not reported' : `${formatNumber(model.totalPoints)} / ${formatNumber(goal.target)} · ${Math.min(100, Math.floor(model.totalPoints / goal.target * 100))}%`}`);
  if (model.clanRank !== null) summaryLines.push(`**Global rank** #${formatNumber(model.clanRank)}`);
  if (model.battleEndsAt) summaryLines.push(`**Battle ends** <t:${model.battleEndsAt}:R>`);
  const overview = new ContainerBuilder().setAccentColor(PURPLE_BATTLE_COLOR)
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL('attachment://r3v0-banner.png').setDescription('Original R3V0 clan banner')
    ))
    .addSectionComponents(header)
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(model.totalPoints === null ? '## Battle points not reported' : `# ${formatNumber(model.totalPoints)} points`))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(summaryLines.join('\n')))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${state.name} · Updated <t:${Math.floor(model.updatedAt / 1000)}:R> · ONE CLAN. ONE LEGACY.`));

  const ranking = new ContainerBuilder().setAccentColor(PURPLE_BATTLE_COLOR)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      '## 🏆 CLAN CONTRIBUTIONS',
      `-# ${model.pageMembers.length ? `Top ${model.pageMembers.length} · ${model.members.length} current clan members` : 'No members reported yet'} · Full ranking opens privately`,
    ].join('\n')));
  if (model.podium.length) {
    ranking.addTextDisplayComponents(new TextDisplayBuilder().setContent(model.podium.map(member => {
      const medal = ['🥇', '🥈', '🥉'][member.clanRank - 1];
      return `${medal} **${username(member)}**${member.isOwner ? ' · Leader' : ''} · **${points(member)} points**`;
    }).join('\n')));
    if (model.rows.length) ranking.addSeparatorComponents(divider());
  }
  if (model.rows.length) {
    ranking.addTextDisplayComponents(new TextDisplayBuilder().setContent(model.rows.map(member =>
      `\`${String(member.clanRank).padStart(2, '0')}\` **${username(member)}**${member.isOwner ? ' · *Leader*' : ''} · **${points(member)}** pts · \`${share(member)}\``
    ).join('\n\n')));
  } else if (!model.podium.length) {
    ranking.addTextDisplayComponents(new TextDisplayBuilder().setContent('The current R3V0 roster will appear here after the next successful update.'));
  }
  ranking
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Roster share uses reported scores of current members. Unreported scores remain unknown.'));
  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('clan:profile:self').setLabel('My result').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('clan:ranking:total:0').setLabel('Full ranking').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('clan:goals:0').setLabel('Goals').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('clan:history:0').setLabel('History').setStyle(ButtonStyle.Secondary)
  );
  ranking.addActionRowComponents(controls);
  return {
    page: model.page,
    payload: {
      components: [overview, ranking],
      files: BATTLE_ARTWORK.map(asset => new AttachmentBuilder(asset.path, { name: asset.name })),
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] }
    }
  };
}

async function getTextChannel(client, channelId) {
  const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) throw new Error(`Configured text channel ${channelId} is not accessible.`);
  return channel;
}
async function findExistingBotPanel(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    return messages.find(message => {
      if (message.author?.bot !== true) return false;
      const titleMatch = message.embeds.some(embed =>
        ['R3V0', 'R3V0 Clan Battle', 'R3V0 • Clan Battle', 'CLAN BATTLE • LIVE CONTRIBUTIONS'].includes(String(embed.title || '')) ||
        String(embed.footer?.text || '').includes('PANEL_ID=r3v0-panel-v1')
      );
      const serialized = JSON.stringify((message.components || []).map(component => component?.toJSON?.() ?? component));
      const componentMatch = serialized.includes('r3v0:page:') || serialized.includes('clan:ranking:');
      return titleMatch || componentMatch;
    }) || null;
  } catch { return null; }
}
export async function upsertR3V0Panel(client, clan = null, pageOverride = undefined) {
  return singleFlight(`battle-panel:${config.channels.leaderboard}`, () => updateR3V0Panel(client, clan, pageOverride));
}
async function updateR3V0Panel(client, clan = null, pageOverride = undefined) {
  const currentClan = clan || await takeClanSnapshot();
  const channel = await getTextChannel(client, config.channels.leaderboard);
  const savedPage = getSetting('r3v0_panel_page', 0);
  const desiredPage = 0; // The public Top 10 never changes when someone browses privately.
  const built = await buildLeaderboardPayload(currentClan, desiredPage);
  let message = null;
  const savedId = getSetting('r3v0_panel_message_id', null);
  if (savedId) message = await channel.messages.fetch(String(savedId)).catch(() => null);
  if (!message) message = await findExistingBotPanel(channel);

  if (message && !message.flags?.has?.(MessageFlags.IsComponentsV2)) {
    // Legacy embeds need a one-time migration; existing V2 messages keep their ID.
    await message.delete().catch(error => console.warn(`[R3V0] Could not remove the old Clan Battle panel: ${error.message}`));
    message = null;
  }
  if (message) {
    const attachments = [...message.attachments.values()];
    const hasOriginalArt = BATTLE_ARTWORK.every(asset => attachments.some(item => item.name === asset.name));
    if (hasOriginalArt) {
      // Scores are native text. Reuse the original logo/banner when only data changes.
      const { files, ...editPayload } = built.payload;
      await message.edit({ ...editPayload, attachments: attachments.map(item => ({ id: item.id, filename: item.name })) });
    } else {
      // Remove the previous generated scoreboard once while retaining the V2 message ID.
      await message.edit({ ...built.payload, attachments: [] });
    }
  } else {
    message = await channel.send(built.payload);
  }
  setSetting('r3v0_panel_design_version', BATTLE_NATIVE_VERSION);
  setSetting('r3v0_panel_message_id', message.id);
  setSetting('r3v0_panel_page', built.page);
  return { message, clan: currentClan, page: built.page };
}
export function getCachedClanSnapshot() { return lastSnapshot; }

export async function searchR3V0Player(nickname) {
  const clan = await takeClanSnapshot();
  const search = String(nickname ?? '').normalize('NFKC').replace(/[\u200B-\u200F\uFEFF]/g, '').trim().replace(/^@+/, '');
  if (!search || search.length > 40) throw new Error('Enter a Roblox username or display name.');

  // Search the complete live R3V0 roster by username, display name, aliases and ID
  // before using Roblox's username-only endpoint as a fallback.
  let member = findClanMemberByQuery(clan.members, search);
  if (!member) {
    const robloxUser = await getRobloxUserByUsername(search).catch(() => null);
    if (robloxUser?.id != null) member = clan.members.find(m => String(m.userId) === String(robloxUser.id));
  }
  if (!member) {
    const candidates = await searchRobloxUsersByKeyword(search).catch(error => {
      console.warn(`[player-search] Roblox keyword search failed for ${clip(search, 40)}: ${error.message}`);
      return [];
    });
    member = matchR3V0MemberFromRobloxSearch(clan.members, candidates, search);
  }
  if (!member) throw new Error(`**${clip(search, 40)}** was not found in the current **R3V0** roster. Search by Roblox username, display name, or Roblox user ID. Only current R3V0 members are returned; if Roblox's name lookup is temporarily unavailable, try the username or user ID.`);

  const snapshots = getUserSnapshots(member.userId, Date.now() - 25 * 60 * 60 * 1000, clan.activeBattleId);
  const progress = computeHourlyProgress(snapshots, member.points, Date.now());
  const player = { ...member, ...progress };
  const avatarUrl = await getRobloxAvatarUrl(member.userId).catch(() => null);
  const image = await renderPlayerCanvas({ player, clan, history: progress.series, avatarUrl });
  return { player, clan, image };
}
export async function publishPlayerProgress(interaction, nickname) {
  const result = await searchR3V0Player(nickname);
  const attachment = new AttachmentBuilder(result.image, { name: 'r3v0-player-progress.png' });
  await interaction.reply({ content: `R3V0 progress for **${clip(result.player.username, 40)}**. Data is limited to the current R3V0 roster.`, files: [attachment], ephemeral: true, allowedMentions: { parse: [] } });
  return result;
}
export async function refreshClanMonitor(client, { force = false, page } = {}) {
  const clan = await takeClanSnapshot({ force });
  const result = await upsertR3V0Panel(client, clan, page);
  return { ...result, force };
}
export function startMonitor(client) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await refreshClanMonitor(client, { force: true });
      const { syncLinkedRoles } = await import('./account-links.js');
      await syncLinkedRoles(client, result.clan);
      const slotsKey = `${result.clan.members.length}/${result.clan.memberCapacity}`;
      if (getSetting('recruitment_roster_key') !== slotsKey) {
        const { publishTicketPanel } = await import('./tickets.js');
        await publishTicketPanel(client).then(() => setSetting('recruitment_roster_key', slotsKey)).catch(error => console.warn(`[recruitment] ${error.message}`));
      }
      console.log(`[R3V0] Updated the single persistent clan panel.`);
    } catch (error) {
      console.error(`[R3V0] Monitor refresh failed; last good panel is preserved: ${error.stack || error.message}`);
      if (lastSnapshot) await upsertR3V0Panel(client, lastSnapshot).catch(() => {});
      const status = getSetting('monitor_status', {});
      if (status.failures === 1 || status.failures % 12 === 0) await sendLog('audit', { content: `R3V0 monitor refresh failed: ${clip(error.message, 800)}`, allowedMentions: { parse: [] } }).catch(() => {});
    } finally { busy = false; }
  };
  void run();
  const timer = setInterval(run, config.refreshMinutes * 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}
