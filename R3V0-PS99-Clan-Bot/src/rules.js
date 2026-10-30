import { brandAssetPath } from './brand-art.js';
import { clanEmbed, CLAN_COLORS } from './theme.js';
import { AttachmentBuilder } from 'discord.js';
import { config } from './config.js';
import { getSetting, setSetting } from './db.js';
import { clip } from './utils.js';

const RULES_MARKER = 'R3V0_RULES_V1';
export function buildRulesEmbed() {
  return clanEmbed('CLAN CODE').setColor(CLAN_COLORS.accent).setTitle('R3V0 Community Rules').setImage('attachment://r3v0-rules.png')
    .setDescription('**Respect the team. Protect the community.**\nOur clan code applies to every member and every channel. Staff may remove content, issue warnings, timeouts or bans depending on severity.')
    .addFields(
      { name: '1. Respect and discrimination', value: 'No hate speech, racist language, slurs, harassment or insults targeting race, skin colour, nationality, sex, gender, religion, disability or sexuality. Attempts to disguise prohibited words with symbols, spaces or alternate characters are still violations.', inline: false },
      { name: '2. Sexual content and exploitation', value: 'No pornography, sexually explicit content, sexual harassment, sexualisation of minors, or jokes that trivialise child sexual abuse or exploitation. Do not post NSFW material in any form.', inline: false },
      { name: '3. Gore and disturbing media', value: 'No gore, real-world injury/death footage, graphic violence or shock content. Do not use spoilers, links or external embeds to bypass this rule.', inline: false },
      { name: '4. Scams and links', value: 'No scam links, phishing, fake giveaways, account-selling, malicious files, token/password requests or deceptive trades. Discord invite links and unapproved domains may be removed automatically.', inline: false },
      { name: '5. Advertising and spam', value: 'No unsolicited advertisements, server invites, repeated messages, mass mentions, copypasta spam or attempts to evade cooldowns. Ask staff before promoting anything.', inline: false },
      { name: '6. PS99 and clan conduct', value: 'Be honest about clan activity, donations, trades and rewards. Do not impersonate clan staff, fake screenshots, manipulate rankings or pressure members to share account credentials.', inline: false },
      { name: '7. Privacy and security', value: 'Never post personal information, private messages, login codes, cookies, passwords or another person’s private data. Staff will never ask for your Roblox password or Discord token.', inline: false },
      { name: '8. Staff and reports', value: 'Follow reasonable staff instructions. Use the PS99 clan ticket for clan-related questions and reports. Do not spam tickets or evade punishments with alternate accounts.', inline: false },
      { name: '9. Enforcement', value: 'Depending on severity and history, staff may remove content, warn, timeout, kick or ban. Serious scams, hateful content, sexual exploitation or gore may result in an immediate ban.', inline: false }
    )
    .setFooter({ text: `R3V0 Community • ${RULES_MARKER}` }).setTimestamp(new Date());
}
async function getChannel(client) {
  return client.channels.cache.get(config.channels.rules) || await client.channels.fetch(config.channels.rules).catch(() => null);
}
export async function publishRules(client) {
  const channel = await getChannel(client);
  if (!channel?.isTextBased?.()) throw new Error(`Rules channel ${config.channels.rules} is unavailable.`);
  const savedId = getSetting('rules_message_id');
  let message = savedId ? await channel.messages.fetch(String(savedId)).catch(() => null) : null;
  if (!message) {
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    message = recent?.find(m => m.author?.id === client.user.id && m.embeds.some(e => String(e.footer?.text || '').includes(RULES_MARKER))) || null;
  }
  const payload = { embeds: [buildRulesEmbed()], files: [new AttachmentBuilder(brandAssetPath('rules'), { name: 'r3v0-rules.png' })], allowedMentions: { parse: [] } };
  if (message) await message.edit({ ...payload, attachments: [] }); else message = await channel.send(payload);
  setSetting('rules_message_id', message.id);
  return message;
}
export { RULES_MARKER };
