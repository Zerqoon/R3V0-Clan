import { recoverInterruptedGames } from './game-recovery.js';
import { handlePsxModal } from './psx-commands.js';
import { handleClanModal, reportInteractionError } from './clan-commands.js';
import { handleTicketModal, startTicketRecovery } from './ticket-system.js';
import { startOutbox } from './outbox.js';
import { startDonationWorker } from './donations.js';
import { getCachedClanSnapshot } from './monitor.js';
import { startMaintenance } from './maintenance.js';
import { clanEmbed, CLAN_COLORS } from './theme.js';
import { Client, Events, GatewayIntentBits, Partials, ActivityType, AuditLogEvent } from 'discord.js';
import { config, validateConfig } from './config.js';
import { db, closeDb } from './db.js';
import { registerCommands, handleSlashCommand, handleAutocomplete, handleComponent, handleGuessMessage, handleArcadeChatMessage } from './commands.js';
import { getRAPData, getPetsCollection } from './ps99.js';
import { handleAutoModMessage } from './automod.js';
import { setLogClient, logMessageDelete, logMessageEdit, sendLog } from './logging.js';
import { publishRules } from './rules.js';
import { publishTicketPanel } from './tickets.js';
import { startMonitor } from './monitor.js';
import { startHttpServer } from './http-server.js';
import { syncExistingMembers, handleRoleChanges, handleNewMember, startAutoRoleWorker } from './roles.js';
import { renderWelcomeCanvas } from './canvas.js';
import { clip } from './utils.js';
import { recordGiveawayMessage, startGiveawayWorker } from './giveaways.js';
import { ensureServerEmojis, refreshEmojiRegistry } from './server-emojis.js';

validateConfig();
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildEmojisAndStickers
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User]
});
setLogClient(client);
let stopMonitor = null;
let stopHttp = startHttpServer(client);
let stopRoleWorker = null;
let stopGiveawayWorker = null;
let stopOutbox = null;
let stopDonations = null;
let stopMaintenance = null;
let stopTickets = null;
const loggedAuditIds = new Set();
const auditDebounce = new Map();

async function safeStartupTask(name, task) {
  try { await task(); console.log(`[startup] ${name}: OK`); }
  catch (error) { console.error(`[startup] ${name} failed: ${error.stack || error.message}`); }
}
function isTargetGuild(guildId) { return String(guildId || '') === config.guildId; }
async function logMemberJoin(member) {
  const created = member.user.createdAt ? `<t:${Math.floor(member.user.createdAt.getTime() / 1000)}:F>` : 'Unknown';
  const embed = clanEmbed('CLAN ACTIVITY').setColor(CLAN_COLORS.success).setTitle('Member Joined')
    .setDescription(`${clip(member.user.tag || member.user.username, 120)} joined R3V0 Discord.`)
    .addFields({ name: 'User ID', value: `\`${member.id}\``, inline: true }, { name: 'Account created', value: created, inline: true }, { name: 'Members', value: String(member.guild.memberCount), inline: true })
    .setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 })).setTimestamp(new Date());
  await sendLog('audit', { embeds: [embed], allowedMentions: { parse: [] } });
}
async function logMemberLeave(member) {
  const created = member.user?.createdAt ? `<t:${Math.floor(member.user.createdAt.getTime() / 1000)}:F>` : 'Unknown';
  const embed = clanEmbed('CLAN ACTIVITY').setColor(CLAN_COLORS.danger).setTitle('Member Left')
    .setDescription(`${clip(member.user?.tag || member.user?.username || member.id, 120)} left R3V0 Discord.`)
    .addFields({ name: 'User ID', value: `\`${member.id}\``, inline: true }, { name: 'Account created', value: created, inline: true })
    .setThumbnail(member.user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || null).setTimestamp(new Date());
  await sendLog('audit', { embeds: [embed], allowedMentions: { parse: [] } });
}
function auditTargetText(entry) {
  const target = entry.target;
  if (!target) return `Target ID: ${entry.targetId || 'unknown'}`;
  return `${clip(target.tag || target.username || target.name || target.id, 150)} (\`${target.id}\`)`;
}
async function logAuditEntry(entry, guild) {
  if (!isTargetGuild(guild?.id) || !entry?.id || loggedAuditIds.has(entry.id)) return;
  loggedAuditIds.add(entry.id);
  if (loggedAuditIds.size > 500) loggedAuditIds.delete(loggedAuditIds.values().next().value);
  const action = String(entry.action).replace(/([A-Z])/g, ' $1').trim();
  const actor = entry.executor ? `${clip(entry.executor.tag || entry.executor.username, 100)} (\`${entry.executor.id}\`)` : 'Unknown / unavailable';
  const reason = clip(entry.reason || 'No reason provided', 800);
  const embed = clanEmbed('CLAN ACTIVITY').setColor(CLAN_COLORS.info).setTitle(`Server Audit • ${action}`)
    .setDescription(`**Target:** ${auditTargetText(entry)}\n**Actor:** ${actor}\n**Reason:** ${reason}`)
    .setFooter({ text: `Audit entry ${entry.id}` }).setTimestamp(entry.createdAt || new Date());
  await sendLog('audit', { embeds: [embed], allowedMentions: { parse: [] } }).catch(error => console.warn(`[audit] Could not log audit entry: ${error.message}`));
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`[ready] Logged in as ${readyClient.user.tag}; monitoring only clan ${config.clanName}.`);
  readyClient.user.setPresence({ activities: [{ name: 'R3V0 | ONE CLAN. ONE LEGACY.', type: ActivityType.Watching }], status: 'online' });
  recoverInterruptedGames();
  stopOutbox = startOutbox(readyClient);
  stopMaintenance = startMaintenance();
  stopRoleWorker = startAutoRoleWorker(readyClient);
  stopGiveawayWorker = startGiveawayWorker(readyClient);
  stopMonitor = startMonitor(readyClient);
  stopDonations = startDonationWorker(() => getCachedClanSnapshot()?.members || []);
  stopTickets = startTicketRecovery(readyClient);
  void safeStartupTask('community auto-role backfill', () => syncExistingMembers(readyClient));
  await safeStartupTask('slash command registration', registerCommands);
  void safeStartupTask('official PS99 emoji pack', async () => {
    const guild = readyClient.guilds.cache.get(config.guildId) || await readyClient.guilds.fetch(config.guildId);
    const summary = await ensureServerEmojis(guild);
    refreshEmojiRegistry(guild);
    console.log(`[emojis] Guild=${summary.guildName} (${summary.guildId}) collections=${summary.discoveredCollections} count=${summary.beforeCount}->${summary.afterCount} verified=${summary.verifiedWanted}/${summary.totalWanted} created=${summary.created.length} existing=${summary.existing.length} failed=${summary.failed.length}`);
    for (const row of summary.failed.slice(0, 8)) console.warn(`[emojis] Missing ${row.name}${row.collection ? ` [${row.collection}]` : ''}: ${row.error}`);
  });
  await safeStartupTask('rules panel', () => publishRules(readyClient));
  await safeStartupTask('ticket panel', () => publishTicketPanel(readyClient));
  // Warm the public RAP and pet caches so Discord's short autocomplete deadline is reliable.
  void Promise.all([getRAPData(), getPetsCollection()]).then(() => console.log('[rap] RAP and pet autocomplete caches warmed.'))
    .catch(error => console.warn(`[rap] Cache warm-up failed; autocomplete will retry on demand: ${error.message}`));
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.guildId || !isTargetGuild(interaction.guildId)) {
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) await interaction.reply({ content: 'This bot is configured for the R3V0 Discord server only.', ephemeral: true }).catch(() => {});
    return;
  }
  try {
    if (interaction.isAutocomplete()) await handleAutocomplete(interaction);
    else if (interaction.isChatInputCommand()) {
      // Logging is detached from Discord's initial-response deadline.
      void sendLog('audit', { embeds: [clanEmbed('CLAN ACTIVITY').setTitle('Slash Command Used').setDescription(`**Command:** /${clip(interaction.commandName, 80)}\n**User:** <@${interaction.user.id}>\n**Channel:** <#${interaction.channelId}>`).setTimestamp(new Date())], allowedMentions: { parse: [] } }).catch(error => console.warn(`[audit] ${error.message}`));
      await handleSlashCommand(interaction);
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('ticket:')) await handleTicketModal(interaction);
      else if (await handlePsxModal(interaction)) { /* Public PSX Classic lookup. */ }
      else if (!await handleClanModal(interaction)) throw new Error('This form is no longer supported. Reopen the current panel.');
    } else if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) {
      if (!await handleComponent(interaction)) throw new Error('This control is no longer supported. Use the current panel.');
    }
  } catch (error) {
    if (interaction.isAutocomplete()) { if (!interaction.responded) await interaction.respond([]).catch(() => {}); }
    else await reportInteractionError(interaction, error);
  }
});

client.on(Events.MessageCreate, message => {
  void handleGuessMessage(message).catch(error => console.error(`[messageCreate] Guess Pet failed: ${error.stack || error.message}`));
  void handleArcadeChatMessage(message).catch(error => console.error(`[messageCreate] Arcade game failed: ${error.stack || error.message}`));
  void handleAutoModMessage(message).catch(error => console.error(`[messageCreate] AutoMod failed: ${error.stack || error.message}`));
  void recordGiveawayMessage(message).catch(error => console.error(`[messageCreate] Giveaway message counter failed: ${error.stack || error.message}`));
});
client.on(Events.MessageDelete, message => {
  if (!isTargetGuild(message.guildId) || message.author?.bot) return;
  void logMessageDelete(message).catch(error => console.error(`[messageDelete] ${error.message}`));
});
client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
  if (!isTargetGuild(newMessage.guildId) || newMessage.author?.bot) return;
  void logMessageEdit(oldMessage, newMessage).catch(error => console.error(`[messageUpdate] ${error.message}`));
});
client.on(Events.GuildMemberAdd, member => {
  if (!isTargetGuild(member.guild.id)) return;
  void handleNewMember(member, renderWelcomeCanvas, sendLog).catch(error => console.error(`[memberAdd] ${error.stack || error.message}`));
  void logMemberJoin(member).catch(error => console.warn(`[memberAdd] Audit log failed: ${error.message}`));
});
client.on(Events.GuildMemberRemove, member => {
  if (!isTargetGuild(member.guild.id)) return;
  void logMemberLeave(member).catch(error => console.warn(`[memberRemove] Audit log failed: ${error.message}`));
});
client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
  if (!isTargetGuild(newMember.guild.id)) return;
  void handleRoleChanges(oldMember, newMember).catch(error => console.warn(`[memberUpdate] ${error.message}`));
});
client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => void logAuditEntry(entry, guild));
client.on(Events.ChannelCreate, channel => {
  if (!isTargetGuild(channel.guildId)) return;
  void sendLog('audit', { embeds: [clanEmbed('CLAN ACTIVITY').setColor(CLAN_COLORS.success).setTitle('Channel Created').setDescription(`**Channel:** ${clip(channel.name, 100)} (\`${channel.id}\`)\n**Type:** ${channel.type}`).setTimestamp(new Date())], allowedMentions: { parse: [] } }).catch(() => {});
});
client.on(Events.ChannelDelete, channel => {
  if (!isTargetGuild(channel.guildId)) return;
  void sendLog('audit', { embeds: [clanEmbed('CLAN ACTIVITY').setColor(CLAN_COLORS.danger).setTitle('Channel Deleted').setDescription(`**Channel:** ${clip(channel.name, 100)} (\`${channel.id}\`)\n**Type:** ${channel.type}`).setTimestamp(new Date())], allowedMentions: { parse: [] } }).catch(() => {});
});
client.on(Events.ChannelUpdate, (oldChannel, newChannel) => {
  if (!isTargetGuild(newChannel.guildId) || oldChannel.name === newChannel.name && oldChannel.parentId === newChannel.parentId && oldChannel.topic === newChannel.topic) return;
  void sendLog('audit', { embeds: [clanEmbed('CLAN ACTIVITY').setColor(CLAN_COLORS.info).setTitle('Channel Updated')
    .setDescription(`**Channel ID:** \`${newChannel.id}\`\n**Name:** ${clip(oldChannel.name, 100)} → ${clip(newChannel.name, 100)}\n**Category:** ${clip(oldChannel.parent?.name || 'None', 100)} → ${clip(newChannel.parent?.name || 'None', 100)}\n**Topic:** ${clip(oldChannel.topic || 'None', 300)} → ${clip(newChannel.topic || 'None', 300)}`)
    .setTimestamp(new Date())], allowedMentions: { parse: [] } }).catch(() => {});
});
client.on(Events.RoleCreate, role => {
  if (!isTargetGuild(role.guild.id)) return;
  void sendLog('audit', { embeds: [clanEmbed('CLAN ACTIVITY').setColor(CLAN_COLORS.success).setTitle('Role Created').setDescription(`**Role:** ${clip(role.name, 100)} (\`${role.id}\`)\n**Permissions:** ${role.permissions.bitfield.toString()}`).setTimestamp(new Date())], allowedMentions: { parse: [] } }).catch(() => {});
});
client.on(Events.RoleDelete, role => {
  if (!isTargetGuild(role.guild.id)) return;
  void sendLog('audit', { embeds: [clanEmbed('CLAN ACTIVITY').setColor(CLAN_COLORS.danger).setTitle('Role Deleted').setDescription(`**Role:** ${clip(role.name, 100)} (\`${role.id}\`)`).setTimestamp(new Date())], allowedMentions: { parse: [] } }).catch(() => {});
});
client.on(Events.RoleUpdate, (oldRole, newRole) => {
  if (!isTargetGuild(newRole.guild.id) || oldRole.name === newRole.name && oldRole.color === newRole.color && oldRole.permissions.bitfield === newRole.permissions.bitfield && oldRole.hoist === newRole.hoist && oldRole.mentionable === newRole.mentionable) return;
  void sendLog('audit', { embeds: [clanEmbed('CLAN ACTIVITY').setColor(CLAN_COLORS.info).setTitle('Role Updated').setDescription(`**Role ID:** \`${newRole.id}\`\n**Name:** ${clip(oldRole.name, 100)} → ${clip(newRole.name, 100)}\n**Colour:** ${oldRole.hexColor} → ${newRole.hexColor}\n**Hoisted:** ${oldRole.hoist} → ${newRole.hoist}\n**Mentionable:** ${oldRole.mentionable} → ${newRole.mentionable}`).setTimestamp(new Date())], allowedMentions: { parse: [] } }).catch(() => {});
});
client.on(Events.GuildUpdate, (oldGuild, newGuild) => {
  if (!isTargetGuild(newGuild.id) || oldGuild.name === newGuild.name && oldGuild.icon === newGuild.icon && oldGuild.description === newGuild.description) return;
  void sendLog('audit', { embeds: [clanEmbed('CLAN ACTIVITY').setColor(CLAN_COLORS.info).setTitle('Server Updated').setDescription(`**Name:** ${clip(oldGuild.name, 100)} → ${clip(newGuild.name, 100)}\n**Icon changed:** ${oldGuild.icon !== newGuild.icon ? 'Yes' : 'No'}\n**Description changed:** ${oldGuild.description !== newGuild.description ? 'Yes' : 'No'}`).setTimestamp(new Date())], allowedMentions: { parse: [] } }).catch(() => {});
});
client.on(Events.UserUpdate, (oldUser, newUser) => {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild?.members.cache.has(newUser.id) || oldUser.avatar === newUser.avatar) return;
  void sendLog('audit', { embeds: [clanEmbed('CLAN ACTIVITY').setColor(CLAN_COLORS.info).setTitle('User Avatar Updated')
    .setDescription(`**User:** ${clip(newUser.tag || newUser.username, 100)} (\`${newUser.id}\`)\nAvatar changed.`)
    .setThumbnail(newUser.displayAvatarURL({ extension: 'png', size: 256 })).setTimestamp(new Date())], allowedMentions: { parse: [] } }).catch(() => {});
});

process.on('unhandledRejection', reason => { console.error(`[process] Unhandled rejection: ${reason?.stack || reason}`); void shutdown('UNHANDLED_REJECTION', 1); });
// A monitor listener logs without overriding Node's default fatal exit.
process.on('uncaughtExceptionMonitor', error => console.error(`[process] Fatal exception: ${error.stack || error}`));
let shuttingDown = false;
async function shutdown(signal, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadline = setTimeout(() => process.exit(code), 10_000); deadline.unref();
  console.log(`[shutdown] ${signal} received; closing bot.`);
  try { stopMonitor?.(); } catch {}
  try { stopDonations?.(); } catch {}
  try { stopOutbox?.(); } catch {}
  try { stopMaintenance?.(); } catch {}
  try { stopTickets?.(); } catch {}
  try { stopRoleWorker?.(); } catch {}
  try { stopGiveawayWorker?.(); } catch {}
  try { await stopHttp?.(); } catch {}
  try { client.destroy(); } catch {}
  try { closeDb(); } catch {}
  process.exit(code);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

client.login(config.token).catch(error => {
  console.error(`[login] Discord login failed: ${error.stack || error.message}`);
  void shutdown('LOGIN_FAILED', 1);
});
