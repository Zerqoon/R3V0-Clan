import { singleFlight } from './locks.js';
import { card, text, section, row, button, v2 } from './ui.js';
import { MediaGalleryBuilder, MediaGalleryItemBuilder } from 'discord.js';
import { enqueueJob, registerJob, processJob, deliverOnce } from './outbox.js';
import { transaction } from './db.js';
import { escapeMarkdown } from './utils.js';
import { brandAssetPath } from './brand-art.js';
import { clanEmbed, CLAN_COLORS } from './theme.js';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { db } from './db.js';
import { config } from './config.js';
import { clip, formatNumber } from './utils.js';
import { getGiveawayEligibilityReasons, parseGiveawayDuration, pickWeightedWinners } from './giveaway-utils.js';
import { emoji, emojiId } from './server-emojis.js';

let expiryWorker = null;

const SELECT_GIVEAWAY = `SELECT id, guild_id AS guildId, channel_id AS channelId, message_id AS messageId,
  creator_id AS creatorId, prize, description, image_url AS imageUrl, winners_count AS winnersCount,
  ends_at AS endsAt, required_role_id AS requiredRoleId, min_messages AS minMessages,
  min_account_age_days AS minAccountAgeDays, min_server_age_days AS minServerAgeDays,
  bonus_role_id AS bonusRoleId, bonus_entries AS bonusEntries, status, created_at AS createdAt,
  ended_at AS endedAt, winners_json AS winnersJson FROM giveaways`;

function getGiveaway(guildId, idOrMessage) {
  return db.prepare(`${SELECT_GIVEAWAY} WHERE guild_id=? AND (CAST(id AS TEXT)=? OR message_id=?) LIMIT 1`)
    .get(String(guildId), String(idOrMessage), String(idOrMessage)) ?? null;
}
function getGiveawayById(id) {
  return db.prepare(`${SELECT_GIVEAWAY} WHERE id=?`).get(Number(id)) ?? null;
}
function getEntryRows(id) {
  return db.prepare('SELECT user_id AS userId, entered_at AS enteredAt FROM giveaway_entries WHERE giveaway_id=? ORDER BY entered_at ASC')
    .all(Number(id));
}
function getMessageCount(guildId, userId) {
  return Number(db.prepare('SELECT message_count AS count FROM giveaway_message_counts WHERE guild_id=? AND user_id=?')
    .get(String(guildId), String(userId))?.count || 0);
}
function hasGuildManagement(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.ManageGuild)
    || member?.permissions?.has(PermissionFlagsBits.Administrator)
    || member?.roles?.cache?.has(config.roles.owner));
}
function safeImageUrl(value) {
  if (!value) return null;
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('The image link is not a valid URL.'); }
  if (url.protocol !== 'https:') throw new Error('The image link must start with `https://`.');
  return url.toString();
}
function attachmentImageUrl(attachment) {
  if (!attachment) return null;
  const mime = String(attachment.contentType || '').toLowerCase();
  const name = String(attachment.name || '').toLowerCase();
  if (!(mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif)$/i.test(name))) {
    throw new Error('The attachment must be a PNG, JPG, GIF, WEBP or AVIF image.');
  }
  if (attachment.size > 10 * 1024 * 1024) throw new Error('The image must be no larger than 10 MB.');
  return safeImageUrl(attachment.url);
}
function parseWinners(giveaway) {
  try { const value = JSON.parse(giveaway.winnersJson || '[]'); return Array.isArray(value) ? value.map(String) : []; }
  catch { return []; }
}
function requirementLines(giveaway) {
  const lines = [];
  if (giveaway.requiredRoleId) lines.push(`• Required role: <@&${giveaway.requiredRoleId}>`);
  if (Number(giveaway.minMessages) > 0) lines.push(`• Minimum server messages: **${formatNumber(giveaway.minMessages)}**`);
  if (Number(giveaway.minAccountAgeDays) > 0) lines.push(`• Discord account age: **${giveaway.minAccountAgeDays} days**`);
  if (Number(giveaway.minServerAgeDays) > 0) lines.push(`• Time on this server: **${giveaway.minServerAgeDays} days**`);
  if (giveaway.bonusRoleId && Number(giveaway.bonusEntries) > 0) lines.push(`• Bonus entries: role <@&${giveaway.bonusRoleId}> gives **+${giveaway.bonusEntries}** entries`);
  return lines.length ? lines.join('\n') : 'No additional requirements. Any server member can join.';
}
export function buildGiveawayEmbed(giveaway, participantCount) {
  const active = giveaway.status === 'active';
  const winners = parseWinners(giveaway);
  const embed = clanEmbed('CLAN REWARDS')
    .setColor(active ? CLAN_COLORS.accent : giveaway.status === 'cancelled' ? CLAN_COLORS.neutral : CLAN_COLORS.success)
    .setTitle(active ? `${emoji('ps99Gift', '🎁')} R3V0 • CLAN GIVEAWAY` : giveaway.status === 'cancelled' ? 'Giveaway anulowany' : `${emoji('ps99Rank', '🏆')} R3V0 • WYNIKI LOSOWANIA`)
    .setDescription([
      `**${clip(giveaway.prize, 250)}**`,
      giveaway.description ? clip(giveaway.description, 1000) : 'Klanowe nagrody dla naszej społeczności. Powodzenia!',
    ].join('\n\n'))
    .addFields(
      { name: active ? 'Koniec losowania' : 'Zakończono', value: active ? `<t:${Math.floor(Number(giveaway.endsAt) / 1000)}:R>\n<t:${Math.floor(Number(giveaway.endsAt) / 1000)}:F>` : `<t:${Math.floor(Number(giveaway.endedAt || giveaway.endsAt) / 1000)}:F>`, inline: false },
      { name: `${emoji('ps99Rank', '🏆')} Zwycięzcy`, value: `**${giveaway.winnersCount}**`, inline: true },
      { name: 'Uczestnicy', value: `**${formatNumber(participantCount)}**`, inline: true },
      { name: 'Giveaway ID', value: `#${giveaway.id}`, inline: true },
      { name: 'Warunki udziału', value: requirementLines(giveaway), inline: false },
      ...(winners.length ? [{ name: `${emoji('ps99Rank', '🏆')} Wylosowani zwycięzcy`, value: winners.map(id => `<@${id}>`).join(', '), inline: false }] : [])
    )
    .setFooter({ text: `R3V0 CLAN • ${active ? 'Kliknij, aby dołączyć. Kliknij ponownie, aby opuścić.' : 'Losowanie zakończone'} • #${giveaway.id}` })
    .setImage(giveaway.imageUrl || 'attachment://r3v0-giveaway.png')
    .setTimestamp(new Date(Number(giveaway.createdAt)));
  return embed;
}

function buildEntryRow(giveaway) {
  const active = giveaway.status === 'active';
  return new ActionRowBuilder().addComponents(new ButtonBuilder()
    .setCustomId(`giveaway:enter:${giveaway.id}`)
    .setLabel(active ? 'Dołącz / wyjdź z losowania' : 'Giveaway zakończony')
    .setEmoji('🎁')
    .setStyle(active ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(!active));
}
export function buildGiveawayPayload(giveaway, participantCount, attachments = []) {
  const active = giveaway.status === 'active';
  const winners = parseWinners(giveaway);
  const image = giveaway.imageUrl || 'attachment://r3v0-giveaway.png';
  const container = card(active ? `${emoji('ps99Gift', '🎁')} R3V0 CLAN GIVEAWAY` : '🏆 GIVEAWAY RESULTS', `### ${escapeMarkdown(giveaway.prize, 200)}${giveaway.description ? `\n${escapeMarkdown(giveaway.description, 1000)}` : ''}`)
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(image).setDescription('Giveaway reward')))
    .addTextDisplayComponents(text(`**${active ? 'Ends' : 'Ended'}:** <t:${Math.floor(Number(active ? giveaway.endsAt : giveaway.endedAt || giveaway.endsAt) / 1000)}:R>\n**Winners:** ${giveaway.winnersCount} · **Participants:** ${formatNumber(participantCount)}`))
    .addSectionComponents(section(active ? '**Enter this giveaway**\nClick to join; click again to leave.' : '**Entries closed**\nThe result is saved and survives bot restarts.', button(`giveaway:enter:${giveaway.id}`, active ? 'Join / leave' : 'Giveaway ended', active ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!active)))
    .addActionRowComponents(row(button(`giveaway:requirements:${giveaway.id}`, 'Check my requirements')));
  if (winners.length) container.addTextDisplayComponents(text(`**Selected winners:** ${winners.map(id => `<@${id}>`).join(', ')}`));
  container.addTextDisplayComponents(text(`-# Giveaway #${giveaway.id} · Requirements and bonus entries are checked again at draw time.`));
  const payload = v2(container);
  if (!giveaway.imageUrl && !attachments.some(item => item.name === 'r3v0-giveaway.png' || item.filename === 'r3v0-giveaway.png')) payload.files = [new AttachmentBuilder(brandAssetPath('giveaway'), { name: 'r3v0-giveaway.png' })];
  return payload;
}

async function fetchTextChannel(client, channelId) {
  const channel = client.channels.cache.get(String(channelId)) || await client.channels.fetch(String(channelId)).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.messages) throw new Error('The giveaway channel is unavailable or does not support messages.');
  return channel;
}
async function refreshGiveawayMessage(client, giveaway) {
  const channel = await fetchTextChannel(client, giveaway.channelId);
  const message = await channel.messages.fetch(String(giveaway.messageId)).catch(() => null);
  if (!message) return false;
  const count = db.prepare('SELECT COUNT(*) AS count FROM giveaway_entries WHERE giveaway_id=?').get(Number(giveaway.id))?.count || 0;
  await message.edit({ content: null, embeds: [], ...buildGiveawayPayload(giveaway, Number(count), [...message.attachments.values()]) });
  return true;
}

export async function recordGiveawayMessage(message) {
  if (!message?.guildId || !message.guild || message.author?.bot || message.webhookId || message.system) return false;
  if (String(message.guildId) !== String(config.guildId)) return false;
  // Count ordinary user messages, including attachment-only messages, since this version was enabled.
  if (!String(message.content || '').trim() && !(message.attachments?.size > 0)) return false;
  db.prepare(`INSERT INTO giveaway_message_counts(guild_id,user_id,message_count,last_message_at) VALUES(?,?,1,?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET message_count=message_count+1,last_message_at=excluded.last_message_at`)
    .run(String(message.guildId), String(message.author.id), Date.now());
  return true;
}

export async function createGiveaway(interaction) {
  const prize = interaction.options.getString('prize', true).trim();
  const description = (interaction.options.getString('description') || '').trim();
  const durationMs = parseGiveawayDuration(interaction.options.getString('duration', true));
  const winnersCount = interaction.options.getInteger('winners') ?? 1;
  const requiredRoleId = interaction.options.getRole('required-role')?.id || null;
  const minMessages = interaction.options.getInteger('min-messages') ?? 0;
  const minAccountAgeDays = interaction.options.getInteger('min-account-days') ?? 0;
  const minServerAgeDays = interaction.options.getInteger('min-server-days') ?? 0;
  const bonusRoleId = interaction.options.getRole('bonus-role')?.id || null;
  const bonusEntries = interaction.options.getInteger('bonus-entries') ?? 0;
  const imageAttachment = interaction.options.getAttachment('image');
  const suppliedImageUrl = interaction.options.getString('image-url');
  if (imageAttachment && suppliedImageUrl) throw new Error('Choose one image method: attachment or URL.');
  if (bonusEntries > 0 && !bonusRoleId) throw new Error('Set `bonus-role` when awarding bonus entries.');
  if (bonusRoleId && bonusEntries < 1) throw new Error('Set `bonus-entries` to at least 1 when using a bonus role.');
  const imageUrl = imageAttachment ? attachmentImageUrl(imageAttachment) : safeImageUrl(suppliedImageUrl);
  const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
  if (!targetChannel?.isTextBased?.() || !targetChannel.messages || !targetChannel.guildId) throw new Error('Choose a server text channel.');
  if (String(targetChannel.guildId) !== String(interaction.guildId)) throw new Error('The giveaway must be published on this server.');
  const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
  if (!botMember || !targetChannel.permissionsFor(botMember)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory])) {
    throw new Error('The bot needs View Channel, Send Messages, Embed Links and Attach Files in that channel.');
  }

  const now = Date.now();
  const insert = db.prepare(`INSERT INTO giveaways(
    guild_id,channel_id,creator_id,prize,description,image_url,winners_count,ends_at,required_role_id,
    min_messages,min_account_age_days,min_server_age_days,bonus_role_id,bonus_entries,status,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active',?)`);
  const result = insert.run(String(interaction.guildId), String(targetChannel.id), String(interaction.user.id), prize,
    description, imageUrl, winnersCount, now + durationMs, requiredRoleId, minMessages, minAccountAgeDays,
    minServerAgeDays, bonusRoleId, bonusEntries, now);
  const id = Number(result.lastInsertRowid);
  let giveaway = getGiveawayById(id);
  try {
    const message = await targetChannel.send(buildGiveawayPayload(giveaway, 0));
    db.prepare('UPDATE giveaways SET message_id=? WHERE id=?').run(String(message.id), id);
    giveaway = getGiveawayById(id);
    return `✅ Giveaway created!\n**Prize:** ${clip(prize, 200)}\n**Ends:** <t:${Math.floor(Number(giveaway.endsAt) / 1000)}:R>\n**Channel:** <#${targetChannel.id}>\n**ID:** \`${id}\`\n[Open giveaway](https://discord.com/channels/${interaction.guildId}/${targetChannel.id}/${message.id})`;
  } catch (error) {
    db.prepare('DELETE FROM giveaways WHERE id=?').run(id);
    throw new Error(`Could not publish the giveaway: ${error.message}`);
  }
}

async function getMember(guild, userId) {
  try { return guild.members.cache.get(String(userId)) || await guild.members.fetch(String(userId)); }
  catch (error) { if (Number(error.code) === 10007) return null; throw error; }
}
async function eligibilityForUser(guild, giveaway, userId) {
  const member = await getMember(guild, userId);
  if (!member || member.user?.bot) return { eligible: false, reasons: ['This user is no longer on the server.'], member: null };
  const now = Date.now();
  const messageCount = getMessageCount(giveaway.guildId, userId);
  const accountAgeDays = member.user?.createdTimestamp ? (now - member.user.createdTimestamp) / 86_400_000 : Infinity;
  const serverAgeDays = member.joinedTimestamp ? (now - member.joinedTimestamp) / 86_400_000 : Infinity;
  const hasRequiredRole = !giveaway.requiredRoleId || member.roles.cache.has(String(giveaway.requiredRoleId));
  const reasons = getGiveawayEligibilityReasons({
    memberPresent: true, hasRequiredRole, messageCount, minMessages: giveaway.minMessages,
    accountAgeDays, minAccountAgeDays: giveaway.minAccountAgeDays,
    serverAgeDays, minServerAgeDays: giveaway.minServerAgeDays,
  });
  const weight = 1 + (giveaway.bonusRoleId && member.roles.cache.has(String(giveaway.bonusRoleId)) ? Number(giveaway.bonusEntries) : 0);
  return { eligible: reasons.length === 0, reasons, member, weight };
}
async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  let failure = null;
  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      try { results[index] = await mapper(values[index], index); }
      catch (error) { failure ||= error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  if (failure) throw failure;
  return results;
}
async function eligibleEntries(guild, giveaway, excluded = []) {
  const excludedSet = new Set(excluded.map(String));
  const rows = getEntryRows(giveaway.id).filter(row => !excludedSet.has(String(row.userId)));
  const eligibility = await mapWithConcurrency(rows, 5, async row => {
    const result = await eligibilityForUser(guild, giveaway, row.userId);
    if (!result?.eligible) return null;
    return { userId: String(row.userId), weight: Math.max(1, Number(result.weight) || 1) };
  });
  return eligibility.filter(Boolean);
}
function queueWinners(giveaway, winnerIds, textPrefix) {
  return enqueueJob('giveaway-announcement', `giveaway-announcement:${giveaway.id}:${winnerIds.join(',') || 'none'}`, { giveawayId: giveaway.id, winnerIds, textPrefix });
}
registerJob('giveaway-announcement', async (client, { giveawayId, winnerIds, textPrefix }, job) => {
  const giveaway = getGiveawayById(giveawayId);
  if (!giveaway) throw new Error('Giveaway record is missing');
  const marker = `R3V0-GIVEAWAY-ANNOUNCEMENT-${job.id}`;
  const payload = v2(card(textPrefix || '🎉 GIVEAWAY ENDED', `**Prize:** ${escapeMarkdown(giveaway.prize, 200)}\n${winnerIds.length ? `**Winners:** ${winnerIds.map(id => `<@${id}>`).join(', ')}` : 'No eligible participants were found.'}`).addTextDisplayComponents(text(`-# ${marker}`)));
  payload.allowedMentions = { users: winnerIds };
  await deliverOnce(client, giveaway.channelId, payload, marker);
});

export async function endGiveaway(client, id, { force = false, actorId = null } = {}) {
  let giveaway = getGiveawayById(id);
  if (!giveaway) throw new Error(`Nie znaleziono giveaway o ID ${id}.`);
  if (giveaway.status !== 'active') throw new Error(`To giveaway nie jest aktywne (status: ${giveaway.status}).`);
  if (!force && Date.now() < Number(giveaway.endsAt)) return false;
  const claimed = db.prepare("UPDATE giveaways SET status='ending' WHERE id=? AND status='active'").run(Number(id));
  if (!claimed.changes) return false;
  try {
    const guild = client.guilds.cache.get(String(giveaway.guildId)) || await client.guilds.fetch(String(giveaway.guildId));
    const entrants = await eligibleEntries(guild, giveaway);
    const winners = pickWeightedWinners(entrants, giveaway.winnersCount);
    const endedAt = Date.now();
    const announcement = transaction(() => {
      db.prepare("UPDATE giveaways SET status='ended',ended_at=?,winners_json=? WHERE id=?").run(endedAt, JSON.stringify(winners), Number(id));
      return queueWinners(giveaway, winners, '🎉 GIVEAWAY ENDED');
    });
    giveaway = getGiveawayById(id);
    await refreshGiveawayMessage(client, giveaway).catch(error => console.warn(`[giveaway] Could not update ended message ${id}: ${error.message}`));
    await processJob(client, announcement.id).catch(error => console.warn(`[giveaway] Announcement queued: ${error.message}`));
    console.log(`[giveaway] Giveaway ${id} ended; eligible=${entrants.length}, winners=${winners.join(',') || 'none'}.`);
    return winners;
  } catch (error) {
    db.prepare("UPDATE giveaways SET status='active' WHERE id=? AND status='ending'").run(Number(id));
    throw error;
  }
}

export async function endGiveawayCommand(interaction, idOrMessage) {
  const giveaway = getGiveaway(interaction.guildId, idOrMessage);
  if (!giveaway) throw new Error('Giveaway not found. Use its internal ID or message ID.');
  if (!hasGuildManagement(interaction.member)) throw new Error('Only clan leadership or Manage Server can end giveaways.');
  const winners = await endGiveaway(interaction.client, giveaway.id, { force: true, actorId: interaction.user.id });
  if (winners === false) throw new Error('The giveaway is already ending or is no longer active.');
  return winners.length ? `Giveaway \`${giveaway.id}\` ended. Selected winners: ${winners.map(id => `<@${id}>`).join(', ')}.` : `Giveaway \`${giveaway.id}\` ended with no eligible participants.`;
}

export async function rerollGiveawayCommand(interaction, idOrMessage) {
  const giveaway = getGiveaway(interaction.guildId, idOrMessage);
  if (!giveaway) throw new Error('Giveaway not found on this server.');
  return singleFlight(`giveaway-reroll:${giveaway.id}`, () => performReroll(interaction, giveaway.id));
}
async function performReroll(interaction, idOrMessage) {
  const giveaway = getGiveaway(interaction.guildId, idOrMessage);
  if (!giveaway) throw new Error('Giveaway not found. Use its internal ID or message ID.');
  if (!hasGuildManagement(interaction.member)) throw new Error('Only clan leadership or Manage Server can reroll giveaways.');
  if (giveaway.status !== 'ended') throw new Error('Rerolls are available only after the giveaway ends.');
  const previousWinners = parseWinners(giveaway);
  const entrants = await eligibleEntries(interaction.guild, giveaway, previousWinners);
  const [winner] = pickWeightedWinners(entrants, 1);
  if (!winner) throw new Error('No remaining eligible entrants are available for a reroll.');
  const updatedWinners = [...previousWinners, winner];
  const announcement = transaction(() => {
    db.prepare('UPDATE giveaways SET winners_json=? WHERE id=?').run(JSON.stringify(updatedWinners), Number(giveaway.id));
    return queueWinners(giveaway, [winner], '🔄 GIVEAWAY REROLL');
  });
  const updated = getGiveawayById(giveaway.id);
  await refreshGiveawayMessage(interaction.client, updated).catch(error => console.warn(`[giveaway] Could not update rerolled giveaway message: ${error.message}`));
  await processJob(interaction.client, announcement.id).catch(error => console.warn(`[giveaway] Reroll announcement queued: ${error.message}`));
  return `The new winner of giveaway \`${giveaway.id}\` is <@${winner}>.`;
}

export async function handleGiveawayComponent(interaction) {
  const match = String(interaction.customId || '').match(/^giveaway:(enter|requirements):(\d+)$/);
  if (!match) return false;
  await interaction.deferReply({ ephemeral: true });
  const giveaway = getGiveaway(interaction.guildId, match[2]);
  if (match[1] === 'requirements' && giveaway) {
    const result = await eligibilityForUser(interaction.guild, giveaway, interaction.user.id);
    await interaction.editReply(v2(card('GIVEAWAY REQUIREMENTS', `${requirementLines(giveaway)}\n\n**Your eligibility:** ${result.eligible ? 'All requirements met' : result.reasons.join(' · ')}\n**Your entries:** ${result.weight || 0}`)));
    return true;
  }
  if (!giveaway || giveaway.status !== 'active' || Date.now() >= Number(giveaway.endsAt)) {
    if (giveaway?.status === 'active' && Date.now() >= Number(giveaway.endsAt)) {
      void endGiveaway(interaction.client, giveaway.id).catch(error => console.error(`[giveaway] Expiry from button failed: ${error.message}`));
    }
    await interaction.editReply({ content: 'This giveaway has ended. Watch for the next one!', ephemeral: true });
    return true;
  }
  if (interaction.user.bot) {
    await interaction.editReply({ content: 'Bot accounts cannot enter giveaways.', ephemeral: true });
    return true;
  }
  const eligibility = await eligibilityForUser(interaction.guild, giveaway, interaction.user.id);
  if (!eligibility.eligible) {
    await interaction.editReply({ content: `You do not meet the giveaway requirements:\n${eligibility.reasons.map(reason => `• ${reason}`).join('\n')}`, ephemeral: true, allowedMentions: { parse: [] } });
    return true;
  }
  const existing = db.prepare('SELECT 1 FROM giveaway_entries WHERE giveaway_id=? AND user_id=?').get(Number(giveaway.id), String(interaction.user.id));
  if (existing) {
    db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id=? AND user_id=?').run(Number(giveaway.id), String(interaction.user.id));
    await interaction.editReply({ content: 'You left the giveaway. Click again to rejoin.', ephemeral: true });
  } else {
    db.prepare('INSERT OR IGNORE INTO giveaway_entries(giveaway_id,user_id,entered_at) VALUES(?,?,?)')
      .run(Number(giveaway.id), String(interaction.user.id), Date.now());
    const weight = eligibility.weight > 1 ? ` You have **${eligibility.weight} entries** thanks to your bonus role.` : '';
    await interaction.editReply({ content: `✅ You entered the giveaway **${clip(giveaway.prize, 150)}**!${weight}`, ephemeral: true, allowedMentions: { parse: [] } });
  }
  const updated = getGiveawayById(giveaway.id);
  await refreshGiveawayMessage(interaction.client, updated).catch(error => console.warn(`[giveaway] Could not refresh participant count: ${error.message}`));
  return true;
}

export function startGiveawayWorker(client) {
  if (expiryWorker) clearInterval(expiryWorker);
  // Recover rows interrupted while ending during a previous process shutdown.
  db.prepare("UPDATE giveaways SET status='active' WHERE status='ending'").run();
  const tick = async () => {
    const expired = db.prepare("SELECT id FROM giveaways WHERE status='active' AND ends_at<=? ORDER BY ends_at ASC LIMIT 25").all(Date.now());
    for (const row of expired) {
      await endGiveaway(client, Number(row.id)).catch(error => console.error(`[giveaway] Could not finish giveaway ${row.id}: ${error.stack || error.message}`));
    }
  };
  void tick();
  expiryWorker = setInterval(() => void tick(), 15_000);
  expiryWorker.unref?.();
  console.log('[giveaway] Persistent expiry worker started.');
  return () => { if (expiryWorker) clearInterval(expiryWorker); expiryWorker = null; };
}
