import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getAccountLink, resolveRobloxAccount } from './account-links.js';
import { getPsxLeaderboard, getPsxPlayerPoints, validRobloxId } from './psx-classic.js';
import { buildPsxConnectPayload } from './psx-views.js';
import { buildPsxLeaderboardMessage, buildPsxPointsMessage } from './psx-messages.js';
import { card, row, button, v2, form } from './ui.js';

export function buildPsxCommands() {
  return [
    new SlashCommandBuilder().setName('psx-leaderboard').setDescription('Public PSX Classic rare-pet points leaderboard.').addIntegerOption(option => option.setName('page').setDescription('Leaderboard page, 10 players per page').setMinValue(1).setMaxValue(10000)),
    new SlashCommandBuilder().setName('psx-points').setDescription('Show PSX Classic rare-pet points and global rank publicly.').addStringOption(option => option.setName('roblox').setDescription('Roblox username, numeric ID or profile link (default: your linked account)').setMaxLength(150)).addUserOption(option => option.setName('member').setDescription('Use this Discord member’s linked Roblox account instead')),
  ];
}
const show = (interaction, payload) => interaction.editReply({ content: null, embeds: [], attachments: [], ...payload });
const userError = message => Object.assign(new Error(message), { userFacing: true });
async function publicPoints(interaction, { roblox, member } = {}, { resolve = resolveRobloxAccount, points = getPsxPlayerPoints } = {}) {
  if (roblox && member) throw userError('Choose either a Roblox account or a Discord member.');
  let account;
  if (roblox) {
    try { account = await resolve(roblox); }
    catch { throw userError('Could not look up that Roblox account. Use an exact username, numeric Roblox ID or profile link, then try again.'); }
  } else {
    const link = getAccountLink(interaction.guildId, (member || interaction.user).id);
    if (!link) {
      if (member) throw userError('This Discord member has not connected Roblox. Ask them to use /link, or enter their Roblox username.');
      await show(interaction, buildPsxConnectPayload()); return;
    }
    account = { id: link.robloxId, name: link.username };
  }
  await show(interaction, await buildPsxPointsMessage(await points(String(account.id)), account));
}
async function failure(interaction, error) {
  console.warn(`[psx-classic] ${error.message}`);
  await show(interaction, v2(card('PSX CLASSIC · RESULT UNAVAILABLE', error.userFacing ? error.message : 'The leaderboard API could not return a verified result. Try again shortly; no score has been replaced with zero.').addActionRowComponents(row(button('psx:page:1:retry', 'Try leaderboard'), button('psx:find', 'Find player')))));
}
export async function handlePsxSlash(interaction, services = {}) {
  if (!['psx-leaderboard', 'psx-points'].includes(interaction.commandName)) return false;
  // Intentionally public: no Ephemeral flag and no staff-only permissions.
  await interaction.deferReply();
  try {
    if (interaction.commandName === 'psx-leaderboard') await show(interaction, await buildPsxLeaderboardMessage(await (services.leaderboard || getPsxLeaderboard)(interaction.options.getInteger('page') || 1)));
    else await publicPoints(interaction, { roblox: interaction.options.getString('roblox'), member: interaction.options.getUser('member') }, services);
  } catch (error) { await failure(interaction, error); }
  return true;
}
export function psxFindModal() { return form('psx:find-submit', 'Check PSX Classic points', [{ id: 'roblox', label: 'Roblox username, numeric ID or profile link', max: 150 }]); }
export async function handlePsxComponent(interaction, services = {}) {
  if (!interaction.customId.startsWith('psx:')) return false;
  const [, action, value] = interaction.customId.split(':');
  if (action === 'find') { await interaction.showModal(psxFindModal()); return true; }
  if (!['page', 'refresh-board', 'refresh-player', 'mine'].includes(action)) throw new Error('Reopen /psx-leaderboard to use the latest controls.');
  if (action === 'mine') await interaction.deferReply();
  else if (action === 'page' && !interaction.message?.flags?.has?.(MessageFlags.Ephemeral)) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  else await interaction.deferUpdate();
  try {
    if (action === 'mine') await publicPoints(interaction, {}, services);
    else if (action === 'refresh-player') {
      if (!validRobloxId(value)) throw userError('Reopen /psx-points to refresh this result.');
      await show(interaction, await buildPsxPointsMessage(await (services.points || getPsxPlayerPoints)(value)));
    } else await show(interaction, await buildPsxLeaderboardMessage(await (services.leaderboard || getPsxLeaderboard)(Number(value))));
  } catch (error) { await failure(interaction, error); }
  return true;
}
export async function handlePsxModal(interaction, services = {}) {
  if (interaction.customId !== 'psx:find-submit') return false;
  await interaction.deferReply();
  try { await publicPoints(interaction, { roblox: interaction.fields.getTextInputValue('roblox') }, services); }
  catch (error) { await failure(interaction, error); }
  return true;
}
