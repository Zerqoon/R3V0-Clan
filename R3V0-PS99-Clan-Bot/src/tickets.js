import { singleFlight } from './locks.js';
import { escapeMarkdown } from './utils.js';
import { brandAssetPath } from './brand-art.js';
import { clanEmbed, CLAN_COLORS, slotMeter } from './theme.js';
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType,
  PermissionFlagsBits, ContainerBuilder, SectionBuilder, TextDisplayBuilder,
  SeparatorBuilder, SeparatorSpacingSize, MessageFlags, MediaGalleryBuilder, MediaGalleryItemBuilder
} from 'discord.js';
import { config } from './config.js';
import { getSetting, setSetting, getOpenTicketForUser, getTicket, saveTicket, updateTicket } from './db.js';
import { clip, formatDate, safeChannelSlug } from './utils.js';
import { sendLog } from './logging.js';
import { emoji, emojiId } from './server-emojis.js';

export function buildTicketPanelPayload() {
  const live = getSetting('last_good_clan');
  const manual = getSetting('clan_slots_manual_override', false);
  const current = Number(!manual && live ? live.members.length : getSetting('clan_slots_current', config.initialClanSlots));
  const capacity = Number(!manual && live ? live.memberCapacity : getSetting('clan_slots_capacity', config.initialClanCapacity));
  const safeCapacity = Number.isFinite(capacity) ? Math.max(0, capacity) : 50;
  const safeCurrent = Number.isFinite(current) ? Math.max(0, Math.min(current, safeCapacity)) : 0;

  const requirements = getSetting('recruitment_requirements', {});
  const ps99Section = new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `### ${emoji('ps99Huge', '🐾')} Pet Simulator 99`,
      `**Recruitment requirements**`,
      requirements.rank ? `• Rank **${Number(requirements.rank)}+**` : `• Rank **15+**`,
      requirements.huges ? `• At least **${Number(requirements.huges)} Huge pets**` : `• At least **15 Huge pets**`,
      requirements.activity ? `• ${escapeMarkdown(requirements.activity, 150)}` : `• Active around **6–12 hours daily**`,
      requirements.passes ? `• ${escapeMarkdown(requirements.passes, 200)}` : `• **Most Game Passes** are expected`,
      `**Clan slots:** ${safeCurrent}/${safeCapacity}  ·  **${safeCapacity - safeCurrent} available**`,
      `\`${slotMeter(safeCurrent, safeCapacity)}\``
    ].join('\n')))
    .setButtonAccessory(new ButtonBuilder()
      .setCustomId('ticket:open:clan')
      .setLabel('Apply for PS99')
      .setEmoji('🐾')
      .setStyle(ButtonStyle.Primary));

  const psxSection = new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `### ${emoji('ps99Pet', '🐾')} Classic Pet Simulator X`,
      '**Recruitment requirements**',
      requirements.psx ? `• ${escapeMarkdown(requirements.psx, 200)}` : '• Own **all Game Passes** in Classic Pet Simulator X',
      '• Include your Roblox username and relevant details in the ticket'
    ].join('\n')))
    .setButtonAccessory(new ButtonBuilder()
      .setCustomId('ticket:open:psx')
      .setLabel('Apply for Classic PSX')
      .setEmoji('🐾')
      .setStyle(ButtonStyle.Secondary));

  const container = new ContainerBuilder()
    .setAccentColor(CLAN_COLORS.accent)
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL('attachment://r3v0-recruitment.png').setDescription('R3V0 clan recruitment')
    ))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `# ${'🎫'} R3V0 Clan Recruitment`,
      '**ONE CLAN. ONE LEGACY.**',
      'Apply for the game you play. Fill in the form, add screenshots in your private ticket, and wait for a staff decision.'
    ].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addSectionComponents(ps99Section)
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addSectionComponents(psxSection)
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '**How it works**\nApply → staff review → accepted, declined or waiting list. Your ticket shows its status and assigned staff member.\n\n-# Connect Roblox using a public profile code. Staff never need passwords, browser cookies or login codes.'
    ));

  return {
    components: [container],
    files: [new AttachmentBuilder(brandAssetPath('recruitment'), { name: 'r3v0-recruitment.png' })],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }
  };
}
async function getTextChannel(client, channelId) {
  const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) throw new Error(`Configured channel ${channelId} is unavailable.`);
  return channel;
}
function componentTreeHasTicketButton(message) {
  try {
    const serialized = JSON.stringify((message.components || []).map(component => component?.toJSON?.() ?? component));
    return serialized.includes('ticket:open:clan') || serialized.includes('ticket:open:psx');
  } catch { return false; }
}

export async function publishTicketPanel(client) {
  return singleFlight(`recruitment-panel:${config.channels.ticketPanel}`, () => updateTicketPanel(client));
}
async function updateTicketPanel(client) {
  const channel = await getTextChannel(client, config.channels.ticketPanel);
  const savedId = getSetting('ticket_panel_message_id');
  let message = savedId ? await channel.messages.fetch(String(savedId)).catch(() => null) : null;

  if (!message) {
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    message = recent?.find(m => m.author?.id === client.user.id && (
      componentTreeHasTicketButton(m) || m.embeds.some(e =>
        /R3V0 PS99.*Ticket|R3V0.*Clan Ticket/i.test(String(e.title || '')) ||
        String(e.footer?.text || '').includes('PANEL_ID=r3v0-ticket-panel-v1')
      )
    )) || null;
  }

  const payload = buildTicketPanelPayload();
  if (message) {
    // Components V2 is a different message format from legacy embeds. Replace an
    // old panel once instead of trying to mix embeds and V2 display components.
    const isV2 = Boolean(message.flags?.has?.(MessageFlags.IsComponentsV2));
    if (!isV2) {
      await message.delete().catch(error => console.warn(`[ticket] Could not replace the legacy panel: ${error.message}`));
      message = null;
    }
  }

  if (message) {
    const hasArt = [...message.attachments.values()].some(item => item.name === 'r3v0-recruitment.png');
    if (hasArt) {
      const { files, ...editPayload } = payload;
      await message.edit({ ...editPayload, attachments: [...message.attachments.values()].map(item => ({ id: item.id, filename: item.name })) });
    } else await message.edit({ ...payload, attachments: [] });
  } else message = await channel.send(payload);
  setSetting('ticket_panel_design_version', 'citadel-v2');
  setSetting('ticket_panel_message_id', message.id);
  return message;
}
export { createTicket, handleTicketComponent, handleTicketModal, closeTicket, closeTicketFromCommand, isTicketStaff, buildTicketMessagePayload } from './ticket-system.js';
