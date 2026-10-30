import { ContainerBuilder, TextDisplayBuilder, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { CLAN_COLORS } from './theme.js';
export const text = content => new TextDisplayBuilder().setContent(String(content));
export const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
export const card = (title, description = '', color = CLAN_COLORS.accent) => new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(text(`## ${title}${description ? `\n${description}` : ''}`));
export const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
export const row = (...buttons) => new ActionRowBuilder().addComponents(buttons);
export const section = (content, action) => new SectionBuilder().addTextDisplayComponents(text(content)).setButtonAccessory(action);
export const v2 = (...containers) => ({ components: containers, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
export function form(id, title, fields) {
  return new ModalBuilder().setCustomId(id).setTitle(title).addLabelComponents(...fields.map(field => {
    const input = new TextInputBuilder().setCustomId(field.id).setStyle(field.long ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(field.required !== false).setMaxLength(field.max || 200);
    if (field.value) input.setValue(String(field.value).slice(0, field.max || 200));
    if (field.placeholder) input.setPlaceholder(field.placeholder);
    const label = new LabelBuilder().setLabel(field.label).setTextInputComponent(input);
    if (field.description) label.setDescription(field.description);
    return label;
  }));
}
export async function privateReply(interaction, payload) {
  if (interaction.deferred) return interaction.editReply(payload);
  if (interaction.replied) return interaction.followUp({ ...payload, flags: Number(payload.flags || 0) | MessageFlags.Ephemeral });
  return interaction.reply({ ...payload, flags: Number(payload.flags || 0) | MessageFlags.Ephemeral });
}
