import { clanEmbed, CLAN_COLORS } from './theme.js';

export const FARM_POINTS = Object.freeze({
  achievements: [
    ['Difficulty 1', 10], ['Difficulty 2', 25], ['Difficulty 3', 75],
    ['Difficulty 4', 250], ['Difficulty 5', 1000],
  ],
  index: [
    ['1 in 10 or easier', 25], ['1 in 11 to 50', 50], ['1 in 51 to 200', 100],
    ['1 in 201 to 1,000', 250], ['1 in 1,001 to 10,000', 1000],
    ['1 in 10,001 to 100,000', 2500], ['Rarer than 1 in 100,000', 10000],
  ],
  huges: [
    ['Index a Huge (first time)', 10000], ['Hatch a Huge (each, up to 12)', 5000],
  ],
});

const number = value => Number(value).toLocaleString('en-US');
const rows = entries => entries.map(([label, points]) => `**${label}**  ·  ${number(points)} points`).join('\n');

export function buildFarmPointsEmbed() {
  return clanEmbed('CLAN BATTLE / FIELD GUIDE')
    .setColor(CLAN_COLORS.accent)
    .setTitle('Fantasy Clan Battle — Points Table')
    .setDescription('**Every point builds our legacy.**\n\nPoint values for farming during the Fantasy Clan Battle. Use this as a quick reference when planning your contribution.')
    .addFields(
      { name: '🏆 Achievements · per stage', value: rows(FARM_POINTS.achievements), inline: false },
      { name: '📘 Index · first time per pet', value: rows(FARM_POINTS.index), inline: false },
      { name: '🥚 Huges', value: rows(FARM_POINTS.huges), inline: false },
      { name: 'Maximum Huge hatch points', value: '**60,000 points** across the first 12 eligible Huge hatches.', inline: false },
    )
    .setFooter({ text: 'R3V0 • Fantasy Clan Battle' })
    .setTimestamp(new Date());
}
