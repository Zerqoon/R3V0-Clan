import { EmbedBuilder } from 'discord.js';

// One visual identity for public panels, private replies and staff records.
// Discord controls the message background and button colours; the artwork and
// Canvas cards carry the custom obsidian/amethyst treatment.
export const CLAN_BRAND = Object.freeze({
  name: 'R3V0', edition: 'CITADEL', motto: 'ONE CLAN. ONE LEGACY.',
});

export const CLAN_COLORS = Object.freeze({
  accent: 0x9858F5, success: 0x76C9AC, warning: 0xDCB879,
  danger: 0xE48098, neutral: 0x887C9C, info: 0xB394DF,
});

export const CLAN_PALETTE = Object.freeze({
  background: '#08060F', panel: '#120E1D', panel2: '#1B1429',
  border: '#3C2A53', borderStrong: '#6F4A98', text: '#F6F1FF',
  muted: '#B7A9CA', subdued: '#8B7C9F', purple: '#BA90FF',
  blue: '#BBA9EE', mint: '#C5A2FF', orange: '#E0C28A',
  red: '#E48098', green: '#91D4B9', chart: '#BB8BFF',
});

export function clanEmbed(section = 'CLAN COMMUNITY') {
  return new EmbedBuilder()
    .setColor(CLAN_COLORS.accent)
    .setAuthor({ name: `R3V0  /  ${section}` })
    .setFooter({ text: `R3V0 CLAN  •  ${CLAN_BRAND.motto}` });
}

export function slotMeter(current, capacity, width = 12) {
  const max = Math.max(0, Number(capacity) || 0);
  const count = Math.max(0, Math.min(max, Number(current) || 0));
  const cells = Math.max(1, Math.min(20, Math.floor(Number(width) || 12)));
  const filled = max ? Math.round(count / max * cells) : 0;
  return `${'▰'.repeat(filled)}${'▱'.repeat(cells - filled)}`;
}
