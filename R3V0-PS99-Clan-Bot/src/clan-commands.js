import crypto from 'node:crypto';
import { SlashCommandBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType, PermissionFlagsBits, MessageFlags, AttachmentBuilder, FileBuilder } from 'discord.js';
import { config } from './config.js';
import { db, getSetting, setSetting } from './db.js';
import { applyRuntimeOverrides } from './runtime-config.js';
import { requireAccess } from './access.js';
import { card, text, divider, section, row, button, v2, form } from './ui.js';
import { accountLinkModal, beginAccountLink, buildLinkChallengePayload, verifyAccountLink, getAccountLink, unlinkAccount, syncLinkedRoles } from './account-links.js';
import { getCachedClanSnapshot, takeClanSnapshot, refreshClanMonitor } from './monitor.js';
import { currentClan, setBattleGoal } from './clan-store.js';
import { buildDonationsPayload, getDonationSummary, refreshDonations } from './donations.js';
import { buildProfilePayload, buildRankingPayload, buildGoalsPayload, buildHistoryPayload, buildSeasonPayload, buildDiagnosticsPayload, buildStaffPayload, buildTicketListPayload } from './clan-views.js';
import { enqueueJob, registerJob, drainOutbox } from './outbox.js';
import { getRobloxAvatarUrl, findClanMemberByQuery } from './ps99.js';
import { createDatabaseBackup } from './maintenance.js';
import { escapeMarkdown, formatNumber } from './utils.js';

export function buildClanCommands() {
  return [
    new SlashCommandBuilder().setName('clan').setDescription('Open your private R3V0 clan dashboard.'),
    new SlashCommandBuilder().setName('profile').setDescription('View a verified R3V0 member profile.').addUserOption(option => option.setName('member').setDescription('Discord member (default: you)')),
    new SlashCommandBuilder().setName('link').setDescription('Connect Roblox using a code in your public profile.').addStringOption(option => option.setName('roblox').setDescription('Roblox username, numeric user ID or profile link').setMaxLength(150)),
    new SlashCommandBuilder().setName('unlink').setDescription('Disconnect your verified Roblox account.'),
    new SlashCommandBuilder().setName('goals').setDescription('View clan and member targets for the current battle.'),
    new SlashCommandBuilder().setName('donations').setDescription('View official R3V0 diamond contributions and donation history.'),
    new SlashCommandBuilder().setName('battle-history').setDescription('View saved R3V0 battle results and podiums.'),
    new SlashCommandBuilder().setName('staff').setDescription('Manage R3V0 recruitment, goals, settings and diagnostics.'),
    new SlashCommandBuilder().setName('ticket-archive').setDescription('Staff: retrieve a saved ticket transcript.').addStringOption(option => option.setName('ticket-id').setDescription('Ticket channel ID').setRequired(true).setMaxLength(22)),
  ];
}
async function cachedClan() {
  return getCachedClanSnapshot() || currentClan() || await takeClanSnapshot().catch(() => null);
}
async function show(interaction, payload) {
  if (!interaction.deferred && !interaction.replied) {
    if (interaction.message?.flags?.has?.(MessageFlags.Ephemeral) && !interaction.isModalSubmit?.()) await interaction.deferUpdate();
    else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  return interaction.editReply({ content: null, embeds: [], attachments: [], ...payload });
}
function unlinkPrompt(interaction) {
  const link = getAccountLink(interaction.guildId, interaction.user.id);
  if (!link) return v2(card('ACCOUNT NOT CONNECTED', 'Use /link to connect your Roblox account.'));
  return v2(card('DISCONNECT ROBLOX?', `Disconnect **${escapeMarkdown(link.username, 30)}** from your Discord profile? Your recorded clan history will be preserved.`).addActionRowComponents(row(button(`account:unlink-confirm:${interaction.user.id}:${link.verifiedAt}`, 'Disconnect', ButtonStyle.Danger), button('clan:profile:self', 'Keep connected'))));
}
export async function handleClanSlash(interaction) {
  const name = interaction.commandName;
  if (!['clan', 'profile', 'link', 'unlink', 'goals', 'donations', 'battle-history', 'staff', 'ticket-archive', 'r3v0-status'].includes(name)) return false;
  if (name === 'link' && !interaction.options.getString('roblox')) { await interaction.showModal(accountLinkModal()); return true; }
  if (name === 'staff' || name === 'ticket-archive' || name === 'r3v0-status') requireAccess(interaction.member, name === 'ticket-archive' ? 'recruiter' : 'officer');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (name === 'link') await show(interaction, buildLinkChallengePayload(await beginAccountLink(interaction.guildId, interaction.user.id, interaction.options.getString('roblox'))));
  if (name === 'unlink') await show(interaction, unlinkPrompt(interaction));
  if (name === 'profile' || name === 'clan') {
    const user = name === 'profile' ? interaction.options.getUser('member') || interaction.user : interaction.user;
    const clan = await cachedClan();
    const link = getAccountLink(interaction.guildId, user.id);
    const avatar = link ? await getRobloxAvatarUrl(link.robloxId).catch(() => null) : null;
    await show(interaction, buildProfilePayload(interaction.guildId, user.id, clan, avatar));
  }
  if (name === 'goals') await show(interaction, buildGoalsPayload(await cachedClan()));
  if (name === 'donations') await show(interaction, buildDonationsPayload(0, getAccountLink(interaction.guildId, interaction.user.id)?.robloxId));
  if (name === 'battle-history') await show(interaction, buildHistoryPayload());
  if (name === 'r3v0-status') await show(interaction, buildDiagnosticsPayload());
  if (name === 'staff') await show(interaction, buildStaffPayload());
  if (name === 'ticket-archive') {
    const id = interaction.options.getString('ticket-id', true);
    const saved = db.prepare('SELECT t.*,x.guild_id FROM ticket_transcripts t JOIN tickets x ON x.channel_id=t.channel_id WHERE t.channel_id=?').get(id);
    if (!saved || saved.guild_id !== interaction.guildId) throw new Error('No saved transcript exists for this ticket.');
    const fileName = `ticket-${id}.txt`;
    await show(interaction, { ...v2(card('🎫 SAVED TICKET TRANSCRIPT', `${saved.message_count} messages · Captured <t:${Math.floor(saved.created_at / 1000)}:F>`).addFileComponents(new FileBuilder().setURL(`attachment://${fileName}`))), files: [new AttachmentBuilder(Buffer.from(saved.body), { name: fileName })] });
  }
  return true;
}
function buildSettingsPayload() {
  const channels = new StringSelectMenuBuilder().setCustomId('staff:channel-key').setPlaceholder('Choose a channel setting').addOptions(...Object.keys(config.channels).map(key => ({ label: key, value: key })));
  const roles = new StringSelectMenuBuilder().setCustomId('staff:role-key').setPlaceholder('Choose a role setting').addOptions(...Object.keys(config.roles).map(key => ({ label: key, value: key })));
  return v2(card('⚙️ CLAN SETTINGS', 'Channel and role changes are saved and survive restarts. Only the owner or server management can change them.')
    .addActionRowComponents(new ActionRowBuilder().addComponents(channels), new ActionRowBuilder().addComponents(roles))
    .addActionRowComponents(row(button('staff:requirements', 'Recruitment requirements'), button('staff:slots', 'Set slots manually'), button('staff:auto-slots', 'Use live roster'), button('staff:home', 'Back'))));
}
function goalModal() { return form('staff:goal-submit', 'Set a battle goal', [{ id: 'target', label: 'Target points (whole number)', max: 16 }, { id: 'member', label: 'Roblox username / ID, or leave empty for clan', required: false, max: 40 }]); }
function requirementsModal() {
  const values = getSetting('recruitment_requirements', {});
  return form('staff:requirements-submit', 'Recruitment requirements', [{ id: 'rank', label: 'Minimum PS99 rank', max: 4, value: String(values.rank || 15) }, { id: 'huges', label: 'Minimum Huge pets', max: 7, value: String(values.huges || 15) }, { id: 'activity', label: 'PS99 activity requirement', max: 150, value: values.activity || 'Active around 6–12 hours daily' }, { id: 'passes', label: 'PS99 Game Pass requirement', max: 200, value: values.passes || 'Most Game Passes are expected' }, { id: 'psx', label: 'Classic PSX requirement', max: 200, value: values.psx || 'Own all Game Passes in Classic Pet Simulator X' }]);
}
function staffDonationsPayload() {
  const summary = getDonationSummary();
  const receipts = db.prepare("SELECT * FROM donation_receipts WHERE status='pending' ORDER BY created_at DESC LIMIT 5").all();
  const container = card('💎 DONATION CONTROL', `**API source:** ${summary.source || 'Not reported'}\n**Last successful read:** ${summary.lastSuccessAt ? `<t:${Math.floor(summary.lastSuccessAt / 1000)}:R>` : 'Not yet'}\n**Observed increases:** ${formatNumber(summary.observedAmount)} gems\n**Awaiting API coverage:** ${summary.pendingReceipts} receipts\n-# Receipts are records, not confirmed additions to official totals. A matching API increase covers them without adding gems twice.`);
  for (const receipt of receipts) container.addSectionComponents(section(`**Receipt #${receipt.id} · ${escapeMarkdown(receipt.username, 40)}**\n${formatNumber(receipt.amount)} gems · ${escapeMarkdown(receipt.source, 100)}\n<t:${Math.floor(receipt.created_at / 1000)}:R>`, button(`staff:receipt:${receipt.id}`, 'Dismiss receipt')));
  container.addActionRowComponents(row(button('staff:donation-refresh', 'Check API now', ButtonStyle.Primary), button('clan:donations:0', 'Official contributions'), button('staff:home', 'Staff home')));
  return v2(container);
}
async function saveRuntimeSetting(interaction, group, key, id) {
  const saved = getSetting('runtime_config', {});
  saved[group] = { ...(saved[group] || {}), [key]: id };
  setSetting('runtime_config', saved); applyRuntimeOverrides(saved);
  enqueueJob('message', `config:${crypto.randomUUID()}`, { title: 'Bot setting changed', body: `<@${interaction.user.id}> updated **${group}.${key}** to \`${id}\`.`, channelKind: 'audit' });
  enqueueJob('republish-panels', `republish:${crypto.randomUUID()}`, {});
}
registerJob('republish-panels', async client => {
  const { publishTicketPanel } = await import('./tickets.js');
  const { publishRules } = await import('./rules.js');
  await publishTicketPanel(client); await publishRules(client);
  const clan = getCachedClanSnapshot() || currentClan();
  if (clan) { const { upsertR3V0Panel } = await import('./monitor.js'); await upsertR3V0Panel(client, clan); }
});
export async function handleClanComponent(interaction) {
  const [prefix, action, argument, extra] = interaction.customId.split(':');
  if (!['account', 'clan', 'staff'].includes(prefix)) return false;
  if (prefix === 'account') {
    if (action === 'start') { await interaction.showModal(accountLinkModal()); return true; }
    if (action === 'verify') {
      await interaction.deferUpdate();
      const link = await verifyAccountLink(interaction.guildId, interaction.user.id);
      const clan = await cachedClan();
      if (clan) await syncLinkedRoles(interaction.client, clan);
      await show(interaction, v2(card('✅ ROBLOX ACCOUNT CONNECTED', `**${escapeMarkdown(link.username, 30)}** is now connected to your Discord account. You can remove the code from your Roblox profile.`).addActionRowComponents(row(button('clan:profile:self', 'Open my profile', ButtonStyle.Primary)))));
    } else if (action === 'cancel') {
      db.prepare('DELETE FROM link_challenges WHERE guild_id=? AND discord_id=?').run(interaction.guildId, interaction.user.id);
      await show(interaction, v2(card('VERIFICATION CANCELLED', 'Run /link whenever you want to connect your account.')));
    } else if (action === 'unlink-confirm') {
      if (argument !== interaction.user.id) throw new Error('This confirmation belongs to another member.');
      const old = unlinkAccount(interaction.guildId, interaction.user.id, extra);
      // Only the optional verification role is managed on disconnect. Clan staff roles are preserved.
      if (config.roles.verified && interaction.member?.roles?.remove) await interaction.member.roles.remove(config.roles.verified, 'Roblox account disconnected').catch(() => {});
      await show(interaction, v2(card('ROBLOX ACCOUNT DISCONNECTED', `Disconnected **${escapeMarkdown(old.username, 30)}**. Use /link to connect another account.`)));
    } else throw new Error('Unknown account action.');
    return true;
  }
  if (prefix === 'clan') {
    if (!interaction.deferred && !interaction.replied) {
      if (interaction.message?.flags?.has?.(MessageFlags.Ephemeral)) await interaction.deferUpdate();
      else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    if (action === 'profile') {
      await show(interaction, buildProfilePayload(interaction.guildId, interaction.user.id, await cachedClan()));
    } else if (action === 'ranking') await show(interaction, buildRankingPayload(await cachedClan(), argument, extra));
    else if (action === 'rank-sort') await show(interaction, buildRankingPayload(await cachedClan(), interaction.values[0], 0));
    else if (action === 'goals') await show(interaction, buildGoalsPayload(await cachedClan(), argument));
    else if (action === 'history') await show(interaction, buildHistoryPayload(argument));
    else if (action === 'season') await show(interaction, buildSeasonPayload(argument, extra));
    else if (action === 'donations') await show(interaction, buildDonationsPayload(argument, getAccountLink(interaction.guildId, interaction.user.id)?.robloxId));
    else throw new Error('Unknown clan view.');
    return true;
  }
  requireAccess(interaction.member, ['settings', 'channel-key', 'role-key', 'set-channel', 'set-role'].includes(action) ? 'owner' : 'officer');
  if (action === 'goal') { await interaction.showModal(goalModal()); return true; }
  if (action === 'requirements') { await interaction.showModal(requirementsModal()); return true; }
  if (action === 'slots') {
    await interaction.showModal(form('staff:slots-submit', 'Manual clan availability', [{ id: 'current', label: 'Occupied slots', max: 4 }, { id: 'capacity', label: 'Total capacity', max: 4 }])); return true;
  }
  if (action === 'receipt') {
    await interaction.showModal(form(`staff:receipt-submit:${argument}`, 'Dismiss unconfirmed receipt', [{ id: 'reason', label: 'Reason (official totals remain unchanged)', long: true, max: 300 }])); return true;
  }
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (action === 'home') await show(interaction, buildStaffPayload());
  else if (action === 'settings') await show(interaction, buildSettingsPayload());
  else if (action === 'tickets') await show(interaction, buildTicketListPayload(argument));
  else if (action === 'diagnostics') await show(interaction, buildDiagnosticsPayload());
  else if (action === 'donations') await show(interaction, staffDonationsPayload());
  else if (action === 'donation-refresh') { await refreshDonations(currentClan()?.members || []); await show(interaction, staffDonationsPayload()); }
  else if (action === 'refresh') {
    if (Date.now() - Number(getSetting('staff_refresh_at', 0)) < 15_000) throw new Error('A refresh was just requested. Wait 15 seconds.');
    setSetting('staff_refresh_at', Date.now());
    await refreshClanMonitor(interaction.client, { force: true }); await show(interaction, buildDiagnosticsPayload());
  } else if (action === 'retry') {
    db.prepare("UPDATE outbox SET next_at=? WHERE status='pending'").run(Date.now());
    const count = await drainOutbox(interaction.client, 25);
    await show(interaction, v2(card('DELIVERY QUEUE CHECKED', `${count} operations completed. Remaining failures stay in the queue for automatic retry.`).addActionRowComponents(row(button('staff:diagnostics', 'View status')))));
  } else if (action === 'backup') {
    createDatabaseBackup({ force: true }); await show(interaction, v2(card('✅ DATABASE BACKUP VERIFIED', 'A new SQLite backup passed its integrity check. It is included in the seven-backup rotation on your data volume.')));
  } else if (action === 'auto-slots') {
    setSetting('clan_slots_manual_override', false); enqueueJob('republish-panels', `republish:${crypto.randomUUID()}`, {});
    await show(interaction, v2(card('LIVE ROSTER ENABLED', 'Recruitment availability now uses the latest R3V0 roster and capacity.')));
  } else if (action === 'channel-key' || action === 'role-key') {
    const key = interaction.values[0], group = action === 'channel-key' ? 'channels' : 'roles';
    if (!Object.hasOwn(config[group], key)) throw new Error('Unknown setting.');
    const picker = group === 'channels' ? new ChannelSelectMenuBuilder().setCustomId(`staff:set-channel:${key}`).setChannelTypes(key === 'ticketCategory' ? ChannelType.GuildCategory : ChannelType.GuildText, ...(key === 'ticketCategory' ? [] : [ChannelType.GuildAnnouncement])) : new RoleSelectMenuBuilder().setCustomId(`staff:set-role:${key}`);
    await show(interaction, v2(card(`SET ${key.toUpperCase()}`, 'Choose the new value below.').addActionRowComponents(new ActionRowBuilder().addComponents(picker))));
  } else if (action === 'set-channel' || action === 'set-role') {
    const group = action === 'set-channel' ? 'channels' : 'roles';
    if (!Object.hasOwn(config[group], argument)) throw new Error('Unknown setting.');
    const id = interaction.values[0];
    if (!/^\d{15,22}$/.test(id)) throw new Error('Choose one valid Discord channel or role.');
    const me = interaction.guild.members.me || await interaction.guild.members.fetchMe();
    if (group === 'channels') {
      const channel = await interaction.guild.channels.fetch(id);
      if (!channel || (argument === 'ticketCategory' ? channel.type !== ChannelType.GuildCategory : ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type))) throw new Error('Choose a suitable channel from this server.');
      if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ViewChannel)) throw new Error('The bot cannot view that channel.');
      if (argument !== 'ticketCategory' && !channel.permissionsFor(me)?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory])) throw new Error('The bot needs Send Messages and Attach Files there.');
    } else {
      const role = await interaction.guild.roles.fetch(id);
      if (!role || role.id === interaction.guildId || role.managed) throw new Error('Choose a regular server role.');
      if (['community', 'clan', 'verified'].includes(argument) && role.comparePositionTo(me.roles.highest) >= 0) throw new Error('Move the bot role above the role it needs to assign.');
    }
    await saveRuntimeSetting(interaction, group, argument, id);
    await show(interaction, v2(card('✅ SETTING SAVED', `**${group}.${argument}** updated. Public panels are queued for refresh.`).addActionRowComponents(row(button('staff:settings', 'More settings')))));
  } else throw new Error('Unknown staff action.');
  return true;
}
export async function handleClanModal(interaction) {
  const [prefix, action, argument] = interaction.customId.split(':');
  if (prefix === 'account' && action === 'link-submit') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await show(interaction, buildLinkChallengePayload(await beginAccountLink(interaction.guildId, interaction.user.id, interaction.fields.getTextInputValue('roblox')))); return true;
  }
  if (prefix !== 'staff') return false;
  requireAccess(interaction.member, 'officer');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (action === 'goal-submit') {
    const clan = await cachedClan();
    const query = interaction.fields.getTextInputValue('member').trim();
    const member = query ? findClanMemberByQuery(clan?.members || [], query) : null;
    if (query && !member) throw new Error('This Roblox member is not in the current R3V0 roster.');
    const raw = interaction.fields.getTextInputValue('target').trim();
    if (!/^\d{1,16}$/.test(raw)) throw new Error('Target points must be a positive whole number.');
    setBattleGoal({ battleId: clan?.activeBattleId, userId: member?.userId || '', target: Number(raw), actorId: interaction.user.id, clan });
    await show(interaction, buildGoalsPayload(clan));
  } else if (action === 'requirements-submit') {
    const value = Object.fromEntries(['rank', 'huges', 'activity', 'passes', 'psx'].map(key => [key, interaction.fields.getTextInputValue(key).trim()]));
    if (!/^\d{1,4}$/.test(value.rank) || !/^\d{1,7}$/.test(value.huges) || !value.activity || !value.passes || !value.psx) throw new Error('Enter valid whole-number requirements and complete all text fields.');
    setSetting('recruitment_requirements', value); enqueueJob('republish-panels', `republish:${crypto.randomUUID()}`, {});
    await show(interaction, v2(card('✅ REQUIREMENTS SAVED', 'The updated requirements will appear on the recruitment panel.')));
  } else if (action === 'slots-submit') {
    const a = interaction.fields.getTextInputValue('current').trim(), b = interaction.fields.getTextInputValue('capacity').trim();
    if (!/^\d{1,4}$/.test(a) || !/^\d{1,4}$/.test(b) || Number(b) < 1 || Number(b) > 1000 || Number(a) > Number(b)) throw new Error('Use whole numbers with occupied slots at or below capacity (1–1000).');
    setSetting('clan_slots_current', Number(a)); setSetting('clan_slots_capacity', Number(b)); setSetting('clan_slots_manual_override', true);
    enqueueJob('republish-panels', `republish:${crypto.randomUUID()}`, {});
    await show(interaction, v2(card('✅ MANUAL AVAILABILITY SAVED', `${a}/${b} slots occupied. Use “Use live roster” to resume automatic availability.`)));
  } else if (action === 'receipt-submit') {
    const reason = interaction.fields.getTextInputValue('reason').trim();
    if (!reason) throw new Error('A reason is required.');
    const changed = db.prepare("UPDATE donation_receipts SET status='dismissed',note=note || ? WHERE id=? AND status='pending'").run(`\nDismissed by ${interaction.user.id}: ${reason}`, Number(argument));
    if (!changed.changes) throw new Error('This receipt is no longer pending.');
    await show(interaction, staffDonationsPayload());
  } else throw new Error('Unknown staff form.');
  return true;
}
export async function reportInteractionError(interaction, error) {
  console.error(`[interaction] ${interaction.commandName || interaction.customId}: ${error.stack || error.message}`);
  const payload = v2(card('ACTION COULD NOT BE COMPLETED', escapeMarkdown(error.message || 'Try again later.', 1600), 0xE48098));
  if (interaction.deferred) await interaction.editReply({ content: null, embeds: [], ...payload }).catch(() => {});
  else if (interaction.replied) await interaction.followUp({ ...payload, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
  else await interaction.reply({ ...payload, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
}
