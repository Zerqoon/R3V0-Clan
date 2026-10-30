import { clanEmbed, CLAN_COLORS } from './theme.js';
import { config } from './config.js';
import { clip } from './utils.js';

let clientRef = null;
export function setLogClient(client) { clientRef = client; }
export async function sendLog(kind, payload) {
  const key = ({ welcome: 'welcome', rules: 'rules', leaderboard: 'leaderboard', gems: 'gems', messages: 'messages', ticketPanel: 'ticketPanel', ticketLogs: 'ticketLogs', moderation: 'moderation', audit: 'audit' })[kind] || kind;
  const channelId = config.channels[key];
  if (!clientRef || !channelId) throw new Error(`Log channel is not configured: ${kind}`);
  const channel = clientRef.channels.cache.get(channelId) || await clientRef.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) throw new Error(`Configured channel ${channelId} is not a text channel or is not accessible.`);
  return channel.send({ allowedMentions: { parse: [] }, ...payload });
}
export function safeEmbedText(value, max = 1000) { return clip(value, max); }
export function makeAuditEmbed({ title, description, actor = null, target = null, fields = [], color = CLAN_COLORS.neutral }) {
  const embed = clanEmbed('STAFF RECORDS').setColor(color).setTitle(clip(title, 256)).setDescription(clip(description, 4000)).setTimestamp(new Date());
  if (actor) embed.addFields({ name: 'Actor', value: clip(actor, 250), inline: true });
  if (target) embed.addFields({ name: 'Target', value: clip(target, 250), inline: true });
  if (fields.length) embed.addFields(fields.map(field => ({ name: clip(field.name, 256), value: clip(field.value, 1024), inline: Boolean(field.inline) })));
  return embed;
}
export async function logMessageDelete(message) {
  const content = clip(message.content || '[No cached message content]', 3200);
  const attachments = [...(message.attachments?.values?.() || [])].map(a => `${clip(a.name || 'attachment', 120)}: ${a.url}`).slice(0, 8);
  const embed = makeAuditEmbed({
    title: 'Message Deleted', description: content || '[empty message]', actor: message.author ? `${message.author.tag} (${message.author.id})` : 'Unknown author',
    fields: [
      { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
      { name: 'Message ID', value: `\`${message.id}\``, inline: true },
      ...(attachments.length ? [{ name: 'Attachments', value: clip(attachments.join('\n'), 1000), inline: false }] : [])
    ], color: CLAN_COLORS.danger
  });
  await sendLog('messages', { embeds: [embed], allowedMentions: { parse: [] } });
}
export async function logMessageEdit(oldMessage, newMessage) {
  const before = clip(oldMessage?.content || '[Content unavailable in cache]', 1500);
  const after = clip(newMessage?.content || '[No text content]', 1500);
  if (before === after && !(newMessage.attachments?.size > 0)) return;
  const embed = makeAuditEmbed({
    title: 'Message Edited', description: `**Before**\n${before}\n\n**After**\n${after}`,
    actor: newMessage.author ? `${newMessage.author.tag} (${newMessage.author.id})` : 'Unknown author',
    fields: [{ name: 'Channel', value: `<#${newMessage.channelId}>`, inline: true }, { name: 'Open message', value: `[Jump to message](${newMessage.url})`, inline: true }], color: CLAN_COLORS.info
  });
  await sendLog('messages', { embeds: [embed], allowedMentions: { parse: [] } });
}
export async function logGif(message, allowed, reason = 'GIF detected') {
  const files = [...(message.attachments?.values?.() || [])].filter(a => String(a.contentType || '').includes('gif') || String(a.name || '').toLowerCase().endsWith('.gif')).map(a => a.url);
  const links = [...String(message.content || '').matchAll(/https?:\/\/[^\s<>]+/gi)].map(m => m[0]).filter(url => /giphy|klipy|tenor|\.gif(?:$|[?#])/i.test(url));
  const embed = makeAuditEmbed({
    title: allowed ? 'GIF / Animation Posted' : 'GIF Blocked', description: clip(message.content || '[Attachment only]', 2500),
    actor: message.author ? `${message.author.tag} (${message.author.id})` : 'Unknown author',
    fields: [
      { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
      { name: 'Result', value: allowed ? 'Allowed by policy' : `Removed: ${clip(reason, 200)}`, inline: true },
      ...((files.length || links.length) ? [{ name: 'Media URLs', value: clip([...files, ...links].join('\n'), 1000), inline: false }] : [])
    ], color: allowed ? CLAN_COLORS.success : CLAN_COLORS.danger
  });
  await sendLog('messages', { embeds: [embed], allowedMentions: { parse: [] } });
}
