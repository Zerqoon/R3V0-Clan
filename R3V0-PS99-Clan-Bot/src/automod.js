import { clanEmbed, CLAN_COLORS } from './theme.js';
import { config } from './config.js';
import { evaluateContent, isGifAttachment, isGifUrl } from './content-filter.js';
import { clip } from './utils.js';
import { sendLog, logGif } from './logging.js';

const warnedAt = new Map();
export async function handleAutoModMessage(message) {
  if (!message?.guild || message.guild.id !== config.guildId || message.author?.bot || !message.member) return;
  const roles = message.member.roles?.cache;
  const isOwner = roles?.has(config.roles.owner) || (config.ownerUserId && message.author.id === config.ownerUserId);
  const isOfficer = roles?.has(config.roles.officer);
  const result = evaluateContent({ content: message.content, attachments: [...(message.attachments?.values?.() || [])], allowlist: config.linkAllowlist, hasOwnerRole: isOwner, hasOfficerRole: isOfficer });
  const gifFound = [...(message.attachments?.values?.() || [])].some(isGifAttachment) || isGifUrl(message.content);
  if (gifFound) await logGif(message, result.allowed, result.reason).catch(err => console.warn(`[automod] GIF log failed: ${err.message}`));
  if (result.allowed) return;
  await message.delete().catch(err => console.warn(`[automod] Could not delete message ${message.id}: ${err.message}`));
  await sendLog('messages', { embeds: [clanEmbed('CLAN GUARD').setColor(CLAN_COLORS.danger).setTitle('AutoMod Action')
    .setDescription(`A message was removed by AutoMod.\n**Reason:** ${clip(result.reason, 100)}\n**Content:** ${clip(message.content || '[attachment]', 1200)}`)
    .addFields({ name: 'Author', value: `${clip(message.author.tag || message.author.username, 100)} (\`${message.author.id}\`)`, inline: true }, { name: 'Channel', value: `<#${message.channelId}>`, inline: true })
    .setTimestamp(new Date())], allowedMentions: { parse: [] } }).catch(err => console.warn(`[automod] log failed: ${err.message}`));
  const now = Date.now();
  const last = warnedAt.get(message.author.id) || 0;
  if (now - last > 10_000 && message.channel?.isTextBased?.()) {
    warnedAt.set(message.author.id, now);
    const warning = await message.channel.send({ content: `<@${message.author.id}>, your message was removed by the server's content policy. Please review the rules.`, allowedMentions: { users: [message.author.id] } }).catch(() => null);
    if (warning) setTimeout(() => warning.delete().catch(() => {}), 8000).unref?.();
  }
}
