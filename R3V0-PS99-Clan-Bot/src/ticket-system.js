import crypto from 'node:crypto';
import { AttachmentBuilder, ButtonStyle, ChannelType, FileBuilder, PermissionFlagsBits } from 'discord.js';
import { db, getSetting, setSetting, transaction, getTicket, getOpenTicketForUser, saveTicket, updateTicket } from './db.js';
import { config } from './config.js';
import { isRecruiter } from './access.js';
import { card, text, divider, section, row, button, v2, form, privateReply } from './ui.js';
import { clip, escapeMarkdown, safeChannelSlug } from './utils.js';
import { enqueueJob, registerJob, processJob, deliverOnce } from './outbox.js';
import { getAccountLink } from './account-links.js';
import { CLAN_COLORS } from './theme.js';

export const isTicketStaff = isRecruiter;
function kind(type) { return type === 'psx' ? { label: 'Classic Pet Simulator X', prefix: 'psx' } : { label: 'Pet Simulator 99', prefix: 'ps99' }; }
export function ticketApplicationModal(interaction, type) {
  if (!['clan', 'psx'].includes(type)) throw new Error('Choose PS99 or Classic PSX recruitment.');
  const linked = getAccountLink(interaction.guildId, interaction.user.id);
  const fields = [{ id: 'roblox', label: 'Roblox username', max: 20, value: linked?.username }];
  if (type === 'clan') fields.push({ id: 'rank', label: 'Your PS99 rank', max: 4 }, { id: 'huges', label: 'Number of Huge pets', max: 7 });
  fields.push({ id: 'passes', label: 'Which Game Passes do you own?', long: true, max: 500 }, { id: 'activity', label: 'Availability and details', long: true, max: 800, description: 'Tell staff when you play. You can add screenshots in your ticket.' });
  return form(`ticket:apply-submit:${type}`, `Apply for ${type === 'psx' ? 'Classic PSX' : 'PS99'}`, fields);
}
export function buildTicketMessagePayload(ticket) {
  let application = {}; try { application = JSON.parse(ticket.applicationJson || '{}'); } catch {}
  const link = getAccountLink(ticket.guildId, ticket.openerId);
  const identityMatches = link && (!application.roblox || application.roblox.toLowerCase() === link.username.toLowerCase());
  const labels = { review: 'Waiting for staff review', accepted: 'Accepted', rejected: 'Declined', waiting: 'On the waiting list' };
  const container = card(`🎫 ${kind(ticket.type).label.toUpperCase()} APPLICATION`, `**Applicant:** <@${ticket.openerId}>\n**Status:** ${ticket.status === 'closing' ? 'Archiving — retry will run automatically' : labels[ticket.decision] || 'Waiting for staff review'}\n**Assigned to:** ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Not claimed'}`)
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text([
      `**Roblox:** ${escapeMarkdown(application.roblox || link?.username || 'Not supplied', 40)}${identityMatches ? ' · Account verified' : link ? ' · Does not match the connected account' : ' · Account not connected'}`,
      ...(application.rank ? [`**PS99 rank:** ${escapeMarkdown(application.rank, 8)}`] : []),
      ...(application.huges ? [`**Huge pets:** ${escapeMarkdown(application.huges, 10)}`] : []),
      `**Game Passes:** ${escapeMarkdown(application.passes || 'Not supplied', 500)}`,
      `**Availability:** ${escapeMarkdown(application.activity || 'Not supplied', 800)}`,
    ].join('\n')));
  if (ticket.decisionReason) container.addTextDisplayComponents(text(`**Staff decision:** ${escapeMarkdown(ticket.decisionReason, 800)}`));
  if (ticket.status === 'open') {
    container.addSectionComponents(section('**For the applicant**\nAdd relevant screenshots here. Connect your Roblox account so staff can verify your identity.', button('account:start', link ? 'Account connected' : 'Connect Roblox').setDisabled(Boolean(link))));
    container.addActionRowComponents(row(button(`ticket:claim:${ticket.channelId}`, ticket.claimedBy ? 'Assigned' : 'Claim', ButtonStyle.Primary).setDisabled(Boolean(ticket.claimedBy)), button(`ticket:decision:${ticket.channelId}:accepted`, 'Accept', ButtonStyle.Success), button(`ticket:decision:${ticket.channelId}:rejected`, 'Decline', ButtonStyle.Danger), button(`ticket:decision:${ticket.channelId}:waiting`, 'Waitlist'), button(`ticket:close-request:${ticket.channelId}`, 'Close')));
  }
  container.addTextDisplayComponents(text(`-# Ticket ${ticket.channelId} · Opened <t:${Math.floor(ticket.createdAt / 1000)}:R> · R3V0-TICKET-${ticket.channelId}`));
  return v2(container);
}
async function fetchTicketChannel(guild, id) {
  try { return await guild.channels.fetch(id); }
  catch (error) { if (Number(error.code) === 10003) return null; throw error; }
}
export async function createTicket(interaction, type = 'clan', application = {}) {
  if (!['clan', 'psx'].includes(type)) throw new Error('This panel opens PS99 and Classic PSX recruitment only.');
  const linked = getAccountLink(interaction.guildId, interaction.user.id);
  if (linked && application.roblox && application.roblox.toLowerCase() !== linked.username.toLowerCase()) throw new Error(`Apply with your connected Roblox username ${linked.username}, or reconnect the correct account first.`);
  const token = crypto.randomBytes(12).toString('hex');
  const now = Date.now();
  const request = { type, application, username: interaction.user.username, createdAt: now };
  const claim = db.prepare('INSERT OR IGNORE INTO ticket_reservations(guild_id,opener_id,token,created_at,request_json) VALUES(?,?,?,?,?)').run(interaction.guildId, interaction.user.id, token, now, JSON.stringify(request));
  if (!claim.changes) throw new Error('Your application is already being created. Wait a moment; staff can recover it if Discord is unavailable.');
  let creationAttempted = false, saved = false;
  try {
    const existing = getOpenTicketForUser(interaction.user.id);
    if (existing) {
      const channel = await fetchTicketChannel(interaction.guild, existing.channelId);
      if (channel || existing.status === 'closing') throw new Error(`You already have an active ticket: <#${existing.channelId}>.`);
      updateTicket(existing.channelId, { status: 'orphaned', closedAt: now, closedBy: 'system' });
    }
    const category = await fetchTicketChannel(interaction.guild, config.channels.ticketCategory);
    if (!category || category.type !== ChannelType.GuildCategory) throw new Error('The recruitment category is unavailable. Staff must fix its channel setting.');
    const staffIds = [...new Set([...config.ticketStaffRoleIds, config.roles.officer, config.roles.owner])].filter(id => interaction.guild.roles.cache.has(id));
    const allow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];
    const overwrites = [{ id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: interaction.user.id, allow }];
    if (interaction.client.user?.id) overwrites.push({ id: interaction.client.user.id, allow: [...allow, PermissionFlagsBits.ManageChannels] });
    for (const id of staffIds) overwrites.push({ id, allow });
    creationAttempted = true;
    const channel = await interaction.guild.channels.create({ name: `ticket-${kind(type).prefix}-${safeChannelSlug(interaction.user.username, 35)}`, type: ChannelType.GuildText, parent: category.id, topic: `R3V0-CREATE:${token} | Applicant ${interaction.user.id} | ${kind(type).label}`, permissionOverwrites: overwrites, reason: 'R3V0 recruitment application' });
    transaction(() => {
      saveTicket({ channelId: channel.id, guildId: interaction.guildId, openerId: interaction.user.id, type, createdAt: now, application, creationToken: token });
      enqueueJob('ticket-panel', `ticket-open:${channel.id}`, { channelId: channel.id });
      enqueueJob('message', `ticket-open-audit:${channel.id}`, { title: 'Recruitment application opened', body: `<@${interaction.user.id}> opened <#${channel.id}> for **${kind(type).label}**.`, channelKind: 'ticketLogs' });
      db.prepare('DELETE FROM ticket_reservations WHERE token=?').run(token);
    });
    saved = true;
    const job = db.prepare('SELECT id FROM outbox WHERE job_key=?').get(`ticket-open:${channel.id}`);
    await processJob(interaction.client, job.id).catch(error => console.warn(`[ticket] First card queued for retry: ${error.message}`));
    return channel;
  } finally {
    // A timed-out create may have succeeded remotely. Recovery searches by token.
    if (!creationAttempted || saved) db.prepare('DELETE FROM ticket_reservations WHERE token=?').run(token);
  }
}
export async function refreshTicketMessage(client, channelId) {
  const ticket = getTicket(channelId);
  if (!ticket) throw new Error('Ticket record is missing');
  const guild = client.guilds.cache.get(ticket.guildId) || await client.guilds.fetch(ticket.guildId);
  const channel = await fetchTicketChannel(guild, channelId);
  if (!channel) throw new Error('The ticket channel no longer exists');
  let message;
  if (ticket.panelMessageId) { try { message = await channel.messages.fetch(ticket.panelMessageId); } catch (error) { if (![10008, 10003].includes(Number(error.code))) throw error; } }
  const payload = buildTicketMessagePayload(ticket);
  if (message?.flags?.has?.(32768)) await message.edit(payload);
  else {
    message = await deliverOnce(client, channelId, payload, `R3V0-TICKET-${channelId}`);
    updateTicket(channelId, { panelMessageId: message.id });
  }
  return message;
}
registerJob('ticket-panel', (client, { channelId }) => refreshTicketMessage(client, channelId));
async function updateCard(client, channelId) {
  const job = enqueueJob('ticket-panel', `ticket-update:${channelId}:${crypto.randomUUID()}`, { channelId });
  await processJob(client, job.id).catch(error => console.warn(`[ticket] Card update queued: ${error.message}`));
}
export async function setTicketDecision(client, ticket, actorId, decision, reason) {
  if (!['accepted', 'rejected', 'waiting'].includes(decision)) throw new Error('Unknown recruitment decision');
  const changed = db.prepare("UPDATE tickets SET decision=?,decision_by=?,decision_reason=? WHERE channel_id=? AND status='open'").run(decision, actorId, clip(reason, 800), ticket.channelId);
  if (!changed.changes) throw new Error('This ticket is no longer open.');
  enqueueJob('message', `ticket-decision:${ticket.channelId}:${crypto.randomUUID()}`, { title: 'Recruitment decision', body: `Ticket <#${ticket.channelId}> · Applicant <@${ticket.openerId}>\n**Decision:** ${decision}\n**By:** <@${actorId}>\n**Reason:** ${escapeMarkdown(reason, 800)}`, channelKind: 'ticketLogs' });
  await updateCard(client, ticket.channelId);
}
export async function handleTicketComponent(interaction) {
  const [prefix, action, argument, extra] = interaction.customId.split(':');
  if (prefix !== 'ticket') return false;
  if (action === 'open') {
    if (!['clan', 'psx'].includes(argument)) throw new Error('Use the current recruitment panel.');
    await interaction.showModal(ticketApplicationModal(interaction, argument));
    return true;
  }
  const ticket = getTicket(argument || interaction.channelId);
  if (!ticket || ticket.status !== 'open') throw new Error('This ticket is no longer open. Staff can retry a pending archive from /staff.');
  if (ticket.guildId !== interaction.guildId || ticket.channelId !== interaction.channelId) throw new Error('Use these controls inside their ticket.');
  if (action === 'claim') {
    if (!isTicketStaff(interaction.member)) throw new Error('Only recruitment staff can claim this application.');
    await interaction.deferReply({ ephemeral: true });
    const claimed = db.prepare("UPDATE tickets SET claimed_by=? WHERE channel_id=? AND status='open' AND claimed_by IS NULL").run(interaction.user.id, ticket.channelId);
    if (!claimed.changes) throw new Error('This application is already assigned to a staff member.');
    await updateCard(interaction.client, ticket.channelId);
    await interaction.editReply('Application assigned to you.');
    return true;
  }
  if (action === 'decision') {
    if (!isTicketStaff(interaction.member)) throw new Error('Only recruitment staff can decide applications.');
    if (!['accepted', 'rejected', 'waiting'].includes(extra)) throw new Error('Unknown decision.');
    await interaction.showModal(form(`ticket:decision-submit:${ticket.channelId}:${extra}`, 'Recruitment decision', [{ id: 'reason', label: 'Reason / message for the applicant', long: true, max: 800 }]));
    return true;
  }
  if (['close-request', 'close-confirm'].includes(action)) {
    if (interaction.user.id !== ticket.openerId && !isTicketStaff(interaction.member)) throw new Error('Only the applicant or recruitment staff can close this ticket.');
    await interaction.showModal(form(`ticket:close-submit:${ticket.channelId}`, 'Close and archive ticket', [{ id: 'reason', label: 'Reason for closing', long: true, max: 500 }]));
    return true;
  }
  if (action === 'close-cancel') { await interaction.update({ content: 'Closing cancelled.', components: [] }); return true; }
  return false;
}
export async function handleTicketModal(interaction) {
  const [, action, argument, extra] = interaction.customId.split(':');
  await interaction.deferReply({ ephemeral: true });
  if (action === 'apply-submit') {
    const application = {};
    for (const key of ['roblox', 'rank', 'huges', 'passes', 'activity']) { try { application[key] = interaction.fields.getTextInputValue(key).trim(); } catch {} }
    if (!/^[A-Za-z0-9_]{3,20}$/.test(application.roblox || '')) throw new Error('Enter an exact Roblox username.');
    if (argument === 'clan' && (!/^\d{1,4}$/.test(application.rank || '') || !/^\d{1,7}$/.test(application.huges || ''))) throw new Error('Rank and Huge count must be whole numbers.');
    const channel = await createTicket(interaction, argument, application);
    await interaction.editReply(`Your application is open: <#${channel.id}>. Add screenshots there; staff will review your information.`);
  } else {
    const ticket = getTicket(argument);
    if (!ticket || ticket.guildId !== interaction.guildId || ticket.channelId !== interaction.channelId) throw new Error('This ticket is unavailable.');
    const reason = interaction.fields.getTextInputValue('reason').trim();
    if (!reason) throw new Error('A reason is required.');
    if (action === 'decision-submit') {
      if (!isTicketStaff(interaction.member)) throw new Error('Recruitment staff access is required.');
      await setTicketDecision(interaction.client, ticket, interaction.user.id, extra, reason);
      await interaction.editReply(`Decision saved: **${extra}**. The applicant can read it in the ticket.`);
    } else if (action === 'close-submit') {
      if (interaction.user.id !== ticket.openerId && !isTicketStaff(interaction.member)) throw new Error('You cannot close this ticket.');
      await closeTicket(interaction.client, interaction.guild, ticket.channelId, interaction.user, reason);
      await interaction.editReply('Ticket locked for archiving. The channel is deleted only after the transcript is saved and delivered. Any failed delivery will retry automatically.');
    }
  }
  return true;
}
export async function fetchTranscript(channel, cutoff = Date.now()) {
  const messages = []; let before;
  while (true) {
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!page.size) break;
    messages.push(...[...page.values()].filter(message => message.createdTimestamp <= cutoff));
    const next = page.last().id;
    if (next === before) throw new Error('Discord returned the same transcript page twice');
    before = next;
    if (page.size < 100) break;
    if (messages.length >= 100_000) throw new Error('Transcript exceeds 100,000 messages; staff must export it before closing.');
  }
  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const lines = [`R3V0 ticket transcript: ${channel.name}`, `Channel ID: ${channel.id}`, `Closing snapshot: ${new Date(cutoff).toISOString()}`, ''];
  for (const message of messages) {
    lines.push(`[${new Date(message.createdTimestamp).toISOString()}] ${message.author?.tag || 'Unknown'} (${message.author?.id || 'unknown'}): ${message.content || ''}`);
    for (const attachment of message.attachments?.values?.() || []) lines.push(`  [Attachment metadata] ${attachment.name} (${attachment.size} bytes): ${attachment.url}`);
    for (const embed of message.embeds || []) lines.push(`  [Embed] ${JSON.stringify(embed.toJSON?.() || embed)}`);
    if (message.components?.length) lines.push(`  [Components] ${JSON.stringify(message.components.map(component => component.toJSON?.() || component))}`);
  }
  return { body: Buffer.from(lines.join('\n'), 'utf8'), count: messages.length };
}
export async function closeTicket(client, guild, channelId, closer, reason = 'Closed by applicant or staff') {
  const job = transaction(() => {
    const ticket = getTicket(channelId);
    if (!ticket || ticket.status !== 'open') throw new Error('This ticket is already closing or closed.');
    db.prepare("UPDATE tickets SET status='closing',closed_by=?,close_reason=? WHERE channel_id=? AND status='open'").run(closer.id, clip(reason, 500), channelId);
    return enqueueJob('ticket-close', `ticket-close:${channelId}`, { channelId, cutoff: Date.now() });
  });
  await processJob(client, job.id).catch(error => console.warn(`[ticket] Archive queued for retry: ${error.message}`));
  return getTicket(channelId);
}
registerJob('ticket-close', async (client, { channelId, cutoff }) => {
  const ticket = getTicket(channelId);
  if (!ticket || ticket.status === 'closed') return;
  const guild = client.guilds.cache.get(ticket.guildId) || await client.guilds.fetch(ticket.guildId);
  const channel = await fetchTicketChannel(guild, channelId);
  let transcript = db.prepare('SELECT * FROM ticket_transcripts WHERE channel_id=?').get(channelId);
  if (!transcript) {
    if (!channel) throw new Error('The source channel was deleted before its transcript could be captured. Staff intervention is required.');
    await channel.permissionOverwrites.edit(ticket.openerId, { SendMessages: false }, { reason: 'Ticket is being archived' });
    const captured = await fetchTranscript(channel, cutoff);
    db.prepare('INSERT INTO ticket_transcripts(channel_id,body,message_count,complete,created_at) VALUES(?,?,?,?,?)').run(channelId, captured.body, captured.count, 1, Date.now());
    transcript = db.prepare('SELECT * FROM ticket_transcripts WHERE channel_id=?').get(channelId);
  }
  const marker = `R3V0-ARCHIVE-${channelId}`;
  const body = Buffer.from(transcript.body);
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const html = Buffer.from(`<!doctype html><html lang="en"><meta charset="utf-8"><title>R3V0 ticket ${channelId}</title><style>body{background:#111017;color:#eee;font:14px/1.6 system-ui;padding:30px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>R3V0 · Ticket archive</h1><pre>${escape(body.toString('utf8'))}</pre></html>`);
  const container = card('🎫 TICKET ARCHIVED', `**Applicant:** <@${ticket.openerId}>\n**Closed by:** <@${ticket.closedBy}>\n**Decision:** ${ticket.decision}\n**Reason:** ${escapeMarkdown(ticket.closeReason, 500)}\n**Messages:** ${transcript.message_count}`)
    .addFileComponents(new FileBuilder().setURL(`attachment://ticket-${channelId}.txt`), new FileBuilder().setURL(`attachment://ticket-${channelId}.html`))
    .addTextDisplayComponents(text(`-# Text is stored durably. Attachment entries contain metadata and original CDN links.\n-# ${marker}`));
  const payload = { ...v2(container), files: [new AttachmentBuilder(body, { name: `ticket-${channelId}.txt` }), new AttachmentBuilder(html, { name: `ticket-${channelId}.html` })] };
  const archived = await deliverOnce(client, config.channels.ticketLogs, payload, marker);
  transaction(() => {
    db.prepare('UPDATE ticket_transcripts SET archive_message_id=? WHERE channel_id=?').run(archived.id, channelId);
    updateTicket(channelId, { status: 'closed', closedAt: Date.now() });
    if (channel) enqueueJob('ticket-delete', `ticket-delete:${channelId}`, { guildId: ticket.guildId, channelId }, Date.now() + 2500);
  });
});
registerJob('ticket-delete', async (client, { guildId, channelId }) => {
  const ticket = getTicket(channelId);
  const transcript = db.prepare('SELECT archive_message_id FROM ticket_transcripts WHERE channel_id=?').get(channelId);
  if (ticket?.status !== 'closed' || !transcript?.archive_message_id) throw new Error('Archive has not been delivered. Channel retained.');
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
  const channel = await fetchTicketChannel(guild, channelId);
  if (channel) await channel.delete('R3V0 ticket transcript archived');
});
export async function recoverTicketReservations(client, { now = Date.now(), startup = false } = {}) {
  const rows = db.prepare('SELECT * FROM ticket_reservations WHERE created_at<=?').all(startup ? now : now - 15 * 60_000);
  for (const reservation of rows) {
    const guild = client.guilds.cache.get(reservation.guild_id) || await client.guilds.fetch(reservation.guild_id);
    const channels = await guild.channels.fetch();
    const channel = channels.find(item => item?.topic?.includes(`R3V0-CREATE:${reservation.token}`));
    if (channel && !getTicket(channel.id)) {
      const request = JSON.parse(reservation.request_json);
      transaction(() => {
        saveTicket({ channelId: channel.id, guildId: reservation.guild_id, openerId: reservation.opener_id, type: request.type, createdAt: request.createdAt, application: request.application, creationToken: reservation.token });
        enqueueJob('ticket-panel', `ticket-open:${channel.id}`, { channelId: channel.id });
      });
    }
    if (channel || now - reservation.created_at >= 15 * 60_000) db.prepare('DELETE FROM ticket_reservations WHERE token=?').run(reservation.token);
  }
}
export function startTicketRecovery(client) {
  void recoverTicketReservations(client, { startup: true }).catch(error => console.warn(`[ticket recovery] ${error.message}`));
  const timer = setInterval(() => void recoverTicketReservations(client).catch(error => console.warn(`[ticket recovery] ${error.message}`)), 60_000); timer.unref?.();
  return () => clearInterval(timer);
}
export async function closeTicketFromCommand(interaction, reason) {
  const ticket = getTicket(interaction.channelId);
  if (!ticket || ticket.status !== 'open') throw new Error('Use this command inside an open recruitment ticket.');
  if (interaction.user.id !== ticket.openerId && !isTicketStaff(interaction.member)) throw new Error('Only the applicant or recruitment staff can close this ticket.');
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ ephemeral: true });
  await closeTicket(interaction.client, interaction.guild, ticket.channelId, interaction.user, reason);
  await interaction.editReply('Ticket closing. Its transcript is saved before deletion; failed deliveries retry automatically.');
}
