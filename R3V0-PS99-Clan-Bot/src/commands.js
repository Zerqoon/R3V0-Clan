import { rememberGame, forgetGame } from './game-recovery.js';
import { buildPsxCommands, handlePsxSlash, handlePsxComponent } from './psx-commands.js';
import { buildClanCommands, handleClanSlash, handleClanComponent } from './clan-commands.js';
import { buildRankingPayload } from './clan-views.js';
import { isOwner } from './access.js';
import { clanEmbed, CLAN_COLORS } from './theme.js';
import {
  SlashCommandBuilder, REST, Routes, AttachmentBuilder, PermissionFlagsBits, ChannelType,
  ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize
} from 'discord.js';
import { config } from './config.js';
import { getSetting, setSetting, db } from './db.js';
import { clip, compactNumber, formatDate, formatNumber, safeChannelSlug } from './utils.js';
import { getRAPData, findRAPItem, getPetsCollection, pickHugeGamePet, getHugePetNames, bigGamesImageUrl, getClanData, getR3V0MemberSuggestions } from './ps99.js';
import { getRAPPetSuggestions } from './rap-suggestions.js';
import { publishPlayerProgress, refreshClanMonitor, logGemEvent, getCachedClanSnapshot, takeClanSnapshot, buildBattleDetailsPayload } from './monitor.js';
import { publishRules } from './rules.js';
import { publishTicketPanel, closeTicketFromCommand, isTicketStaff, handleTicketComponent } from './tickets.js';
import { executeBan, executeTimeout, executeClanWarning, isModerationStaff, getCase } from './moderation.js';
import { sendLog } from './logging.js';
import { buildFarmPointsEmbed } from './farm-points.js';
import { createGiveaway, endGiveawayCommand, rerollGiveawayCommand, handleGiveawayComponent } from './giveaways.js';
import { recordHugeGuessWin, getHugeGuessLeaderboard, getMostIdentifiedHugePets } from './guess-huge-stats.js';
import { createHugeHintState, extractHugeGuess, isHugeGuessCorrect, renderHugeHint, revealNextHugeHint } from './guess-huge-game.js';
import { reserveGameChannel, releaseGameChannel, getGameInChannel } from './game-locks.js';
import { startPetScramble, startEmojiPet, startHigherLower, handleArcadeMessage, handleArcadeComponent, getArcadeLeaderboardText } from './arcade.js';
import { fetchImageForDiscord, imageAttachmentName, attachmentReference, keepDiscordAttachments, runStartCountdown, countdownDescription } from './arcade-media.js';
import { ensureServerEmojis, refreshEmojiRegistry, emoji, emojiId, formatEmojiSetupSummary, getLastEmojiSetupSummary, inspectServerEmojis, formatLiveEmojiStatus } from './server-emojis.js';

const guessGames = new Map();
let playerAutocompleteMembers = null;
let playerAutocompleteFetchedAt = 0;
let playerAutocompletePending = null;

async function loadPlayerAutocompleteMembers() {
  const monitorCache = getCachedClanSnapshot()?.members;
  if (Array.isArray(monitorCache) && monitorCache.length) {
    playerAutocompleteMembers = monitorCache;
    playerAutocompleteFetchedAt = Date.now();
    return monitorCache;
  }
  if (playerAutocompleteMembers?.length && Date.now() - playerAutocompleteFetchedAt < 60_000) return playerAutocompleteMembers;
  if (!playerAutocompletePending) {
    playerAutocompletePending = getClanData()
      .then(clan => {
        playerAutocompleteMembers = Array.isArray(clan.members) ? clan.members : [];
        playerAutocompleteFetchedAt = Date.now();
        return playerAutocompleteMembers;
      })
      .catch(error => {
        console.warn(`[player-search] Could not warm roster autocomplete: ${error.message}`);
        return playerAutocompleteMembers || [];
      })
      .finally(() => { playerAutocompletePending = null; });
  }
  return playerAutocompletePending;
}

export function buildCommands() {
  return [
    ...buildPsxCommands(),
    ...buildClanCommands(),
    new SlashCommandBuilder().setName('search-player').setDescription('Show player progress for a current R3V0 member by username or display name.')
      .addStringOption(o => o.setName('nickname').setDescription('Roblox username or display name; suggestions use the current R3V0 roster').setRequired(true).setMaxLength(40).setAutocomplete(true)),
    new SlashCommandBuilder().setName('check-r3v0').setDescription('Refresh the persistent full R3V0 roster leaderboard panel.'),
    new SlashCommandBuilder().setName('farm-points').setDescription('Show the Fantasy Clan Battle farming points table.'),
    new SlashCommandBuilder().setName('rap').setDescription('Look up the current PS99 RAP for a pet and variant.')
      .addStringOption(o => o.setName('pet').setDescription('Start typing a pet name to browse RAP entries').setRequired(true).setMaxLength(100).setAutocomplete(true))
      .addStringOption(o => o.setName('variant').setDescription('Pet variant').setRequired(true).addChoices(
        { name: 'Normal', value: 'normal' }, { name: 'Golden', value: 'golden' }, { name: 'Rainbow', value: 'rainbow' },
        { name: 'Shiny', value: 'shiny' }, { name: 'Golden Shiny', value: 'golden-shiny' }, { name: 'Rainbow Shiny', value: 'rainbow-shiny' }
      )),
    new SlashCommandBuilder().setName('ban').setDescription('Ban a user and send a moderation case by DM.')
      .addUserOption(o => o.setName('target').setDescription('Discord user to ban').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason for the ban').setRequired(true).setMaxLength(800)),
    new SlashCommandBuilder().setName('mute').setDescription('Apply a Discord timeout and send a moderation case by DM.')
      .addUserOption(o => o.setName('target').setDescription('Member to timeout').setRequired(true))
      .addStringOption(o => o.setName('duration').setDescription('Examples: 10m, 2h, 3d, 1w (max 28 days)').setRequired(true).setMaxLength(10))
      .addStringOption(o => o.setName('reason').setDescription('Reason for the timeout').setRequired(true).setMaxLength(800)),
    new SlashCommandBuilder().setName('clan-warning').setDescription('DM a formal warning about R3V0 clan activity.')
      .addUserOption(o => o.setName('target').setDescription('Discord member').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason for the warning').setRequired(true).setMaxLength(800))
      .addStringOption(o => o.setName('roblox-name').setDescription('Roblox username, if known').setRequired(false).setMaxLength(40)),
    new SlashCommandBuilder().setName('rules').setDescription('Publish or update the R3V0 server rules.'),
    new SlashCommandBuilder().setName('ticket-panel').setDescription('Publish or update the R3V0 ticket panel.'),
    new SlashCommandBuilder().setName('ticket-panel-edit').setDescription('Update the PS99 recruitment availability shown on the ticket panel.')
      .addIntegerOption(o => o.setName('current-slots').setDescription('Current clan members / occupied slots').setRequired(true).setMinValue(0).setMaxValue(1000))
      .addIntegerOption(o => o.setName('capacity').setDescription('Total clan slot capacity').setRequired(true).setMinValue(1).setMaxValue(1000)),
    new SlashCommandBuilder().setName('ticket-close').setDescription('Close the current ticket and archive its transcript.')
      .addStringOption(o => o.setName('reason').setDescription('Closing reason').setRequired(false).setMaxLength(500)),
    new SlashCommandBuilder().setName('log-gem-deposit').setDescription('Record a verified R3V0 clan gem deposit in the deposit log.')
      .addStringOption(o => o.setName('roblox-user-id').setDescription('Numeric Roblox user ID').setRequired(true).setMaxLength(20))
      .addIntegerOption(o => o.setName('amount').setDescription('Number of diamonds/gems donated').setRequired(true).setMinValue(1).setMaxValue(2_000_000_000))
      .addStringOption(o => o.setName('note').setDescription('Optional note or receipt reference').setRequired(false).setMaxLength(300)),
    new SlashCommandBuilder().setName('create-giveaway').setDescription('Create a clan giveaway with requirements and bonus entries.')
      .addStringOption(o => o.setName('prize').setDescription('Prize name').setRequired(true).setMaxLength(200))
      .addStringOption(o => o.setName('duration').setDescription('Duration: 30m, 2h, 3d or 1w (maximum 30 days)').setRequired(true).setMaxLength(10))
      .addIntegerOption(o => o.setName('winners').setDescription('Number of winners').setRequired(false).setMinValue(1).setMaxValue(20))
      .addChannelOption(o => o.setName('channel').setDescription('Target channel (default: current channel)').setRequired(false).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addRoleOption(o => o.setName('required-role').setDescription('Role required to enter').setRequired(false))
      .addIntegerOption(o => o.setName('min-messages').setDescription('Minimum observed server messages').setRequired(false).setMinValue(0).setMaxValue(100000))
      .addIntegerOption(o => o.setName('min-account-days').setDescription('Minimum Discord account age in days').setRequired(false).setMinValue(0).setMaxValue(3650))
      .addIntegerOption(o => o.setName('min-server-days').setDescription('Minimum server membership in days').setRequired(false).setMinValue(0).setMaxValue(3650))
      .addRoleOption(o => o.setName('bonus-role').setDescription('Role granting bonus entries').setRequired(false))
      .addIntegerOption(o => o.setName('bonus-entries').setDescription('Additional entries for the bonus role').setRequired(false).setMinValue(1).setMaxValue(100))
      .addStringOption(o => o.setName('description').setDescription('Description and additional instructions').setRequired(false).setMaxLength(1000))
      .addStringOption(o => o.setName('image-url').setDescription('HTTPS reward image URL').setRequired(false).setMaxLength(500))
      .addAttachmentOption(o => o.setName('image').setDescription('Reward image attachment').setRequired(false)),
    new SlashCommandBuilder().setName('end-giveaway').setDescription('End a giveaway early and draw its winners.')
      .addStringOption(o => o.setName('giveaway-id').setDescription('Internal giveaway ID or giveaway message ID').setRequired(true).setMaxLength(30)),
    new SlashCommandBuilder().setName('reroll-giveaway').setDescription('Draw an additional winner for an ended giveaway.')
      .addStringOption(o => o.setName('giveaway-id').setDescription('Internal giveaway ID or giveaway message ID').setRequired(true).setMaxLength(30)),
    new SlashCommandBuilder().setName('guess-pet').setDescription('Identify the mystery pet from its image by typing the name in chat.'),
    new SlashCommandBuilder().setName('guess-pet-top').setDescription('Show the leaderboard for correct pet guesses and most identified pets.'),
    new SlashCommandBuilder().setName('pet-scramble').setDescription('Unscramble a PS99 pet name before the timer runs out.'),
    new SlashCommandBuilder().setName('emoji-pet').setDescription('Guess a PS99 pet from an emoji clue.'),
    new SlashCommandBuilder().setName('higher-lower').setDescription('Pick which PS99 pet has the higher RAP value.'),
    new SlashCommandBuilder().setName('arcade-top').setDescription('Show the R3V0 arcade wins leaderboard.'),
    new SlashCommandBuilder().setName('setup-emojis').setDescription('Install or restore official Pet Simulator 99 server emojis.'),
    new SlashCommandBuilder().setName('emoji-status').setDescription('Show the current Official PS99 emoji pack status.'),
    new SlashCommandBuilder().setName('r3v0-status').setDescription('Check R3V0 roster monitor and API status.'),
    new SlashCommandBuilder().setName('moderation-case').setDescription('View a moderation case by ID.')
      .addStringOption(o => o.setName('case-id').setDescription('Example: MUTE-000123').setRequired(true).setMaxLength(30))
  ].map(command => command.setDMPermission(false));
}
export async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.token);
  const commands = buildCommands().map(command => command.toJSON());
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
  console.log(`[commands] Registered ${commands.length} guild slash commands.`);
}
function canManagePanel(member) {
  return isOwner(member);
}
function caseEmbed(row) {
  const type = String(row.type).toUpperCase();
  return clanEmbed('CLAN COMMANDS').setColor(CLAN_COLORS.accent).setTitle(`${type} • ${row.case_id}`)
    .addFields(
      { name: 'Target ID', value: `\`${row.target_id}\``, inline: true }, { name: 'Moderator ID', value: `\`${row.moderator_id}\``, inline: true },
      { name: 'DM delivered', value: row.dm_delivered ? 'Yes' : 'No', inline: true },
      { name: 'Reason', value: clip(row.reason, 1000), inline: false }, { name: 'Created', value: formatDate(row.created_at), inline: true },
      ...(row.expires_at ? [{ name: 'Expires', value: formatDate(row.expires_at), inline: true }] : [])
    ).setFooter({ text: 'R3V0 Moderation Case' });
}
const GUESS_HUGE_COLOR = CLAN_COLORS.accent;

function compactPetNames(names, max = 3) {
  const list = Array.isArray(names) ? names : [];
  if (!list.length) return 'No Huge names recorded yet';
  const shown = list.slice(-max).map(name => clip(name, 48));
  return shown.join(', ');
}

function guessLeaderboardText(rows, limit = 5) {
  if (!rows.length) return 'No correct guesses recorded yet.';
  const marks = ['🥇', '🥈', '🥉'];
  return rows.slice(0, limit).map((row, index) => {
    const rank = marks[index] || `#${index + 1}`;
    const wins = `${formatNumber(row.wins)} ${row.wins === 1 ? 'win' : 'wins'}`;
    return `${rank} **${clip(row.username, 48)}** · ${wins}`;
  }).join('\n');
}

function identifiedPetsText(rows, limit = 5) {
  if (!rows.length) return 'No pets have been guessed correctly yet.';
  return rows.slice(0, limit).map((row, index) =>
    `**${index + 1}. ${clip(row.petName, 70)}** · ${formatNumber(row.correctGuesses)} ${row.correctGuesses === 1 ? 'time' : 'times'}`
  ).join('\n');
}

export function buildGuessPetComponents({ expiresAt, imageUrl, hint = '', result = null, nextHintAt = null, countdown = null, preparingImage = false }) {
  const isWinner = Boolean(result?.winnerName);
  const container = new ContainerBuilder().setAccentColor(isWinner ? CLAN_COLORS.success : GUESS_HUGE_COLOR);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${emoji('ps99Pet', '🎮')} R3V0 ARCADE`,
    `## ${emoji('ps99Huge', '🐾')} Guess Pet`,
    preparingImage
      ? 'The pet image is being prepared. The round will open as soon as it is ready.'
      : countdown !== null
        ? `**Round starts in ${countdown} ${countdown === 1 ? 'second' : 'seconds'}**\n\nThe image is being prepared before guesses open.`
        : isWinner
          ? `**${clip(result.winnerName, 60)}** guessed it first.\n\nThe pet was **${clip(result.answerName, 120)}**. This round is closed.`
          : result?.answerName
            ? `Time is up. The pet was **${clip(result.answerName, 120)}**.\n\nNo correct answer this round.`
            : 'Identify the Huge pet from its image. Type the exact pet name in chat. The first correct answer wins.'
  ].join('\n')));

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  // A Components V2 media gallery embeds an uploaded image inside the card itself.
  // Do not also use EmbedBuilder.setImage(), which makes Discord show the same
  // image twice: once as a raw attachment preview and again inside the embed.
  if (imageUrl && countdown === null && !preparingImage) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(imageUrl).setDescription('Mystery pet image')
    ));
  }

  if (preparingImage) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('**IMAGE STATUS**\nPreparing the image before the timer begins.'));
  } else if (countdown !== null) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**START**\n${countdown} ${countdown === 1 ? 'second' : 'seconds'} remaining`));
  } else if (!result) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `### ${emoji('ps99Pet', '🐾')} Name clue`,
      `\`${clip(hint || 'Preparing clue…', 180)}\``,
      `${'⌛'} **Next letter:** ${nextHintAt ? `<t:${Math.floor(nextHintAt / 1000)}:R>` : 'Every 8 seconds'}`,
      `${'⏱️'} **Round ends:** <t:${Math.floor(expiresAt / 1000)}:R>`,
      '',
      'One recognized guess per player · Rankings: `/guess-pet-top`'
    ].join('\n')));
  } else if (result.winnerName) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `### ${emoji('ps99Rank', '🏆')} Round result`,
      `**Winner:** ${clip(result.winnerName, 80)}`,
      `**Answer:** ${clip(result.answerName, 100)}`
    ].join('\n')));
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${emoji('ps99Rank', '🏆')} Round result\n**Answer:** ${clip(result.answerName, 100)}`));
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# R3V0 CLAN  /  PLAY TOGETHER. RISE TOGETHER.'));
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

const GUESS_HUGE_ROUND_MS = 60_000;
const GUESS_HUGE_HINT_INTERVAL_MS = 8_000;

function clearGuessTimers(game) {
  if (game.timeout) clearTimeout(game.timeout);
  if (game.hintTimer) clearInterval(game.hintTimer);
  game.timeout = null;
  game.hintTimer = null;
}

async function editGuessMessage(game, result = null) {
  const nextHintAt = Date.now() + GUESS_HUGE_HINT_INTERVAL_MS;
  const payload = buildGuessPetComponents({
    expiresAt: game.expiresAt,
    imageUrl: game.imageReference || game.imageUrl,
    hint: renderHugeHint(game.hintState),
    nextHintAt,
    result
  });
  const keep = keepDiscordAttachments(game.imageAttachmentId ? [{ id: game.imageAttachmentId, filename: game.imageFilename }] : []);
  await game.message.edit({ components: payload.components, ...keep, allowedMentions: { parse: [] } });
}

async function finishGuessPetGame(game, winner = null) {
  if (!game || game.ended) return false;
  game.ended = true;
  clearGuessTimers(game);
  if (winner) {
    try {
      recordHugeGuessWin({ userId: winner.userId, username: winner.username, petName: game.answerName });
    } catch (error) {
      console.error(`[guess-pet] Could not persist winner ${winner.userId}: ${error.message}`);
    }
  }
  guessGames.delete(game.message.id);
  releaseGameChannel(game.channelId, 'guess-pet');
  await editGuessMessage(game, winner
    ? { winnerName: winner.username, answerName: game.answerName }
    : { answerName: game.answerName })
    .then(() => forgetGame(game.message.id))
    .catch(error => console.warn(`[guess-pet] Could not close round ${game.message.id}: ${error.message}`));
  return true;
}

async function doGuessPet(interaction) {
  const channelId = String(interaction.channelId || '');
  if (!reserveGameChannel(channelId, 'guess-pet')) {
    await interaction.reply({ content: `A game is already active in this channel (**${getGameInChannel(channelId)}**). Finish it before starting another one.`, ephemeral: true });
    return;
  }
  let started = false;
  try {
    await interaction.deferReply();
    const pets = await getPetsCollection();
    const pet = pickHugeGamePet(pets);
    const knownPetNames = getHugePetNames(pets);
    const hintState = createHugeHintState(pet.name);
    const imageUrl = bigGamesImageUrl(pet.thumbnail);
    const preparedImage = await runStartCountdown({
      seconds: 5,
      intervalMs: 1000,
      prepare: () => fetchImageForDiscord(imageUrl),
      onTick: seconds => interaction.editReply({
        ...buildGuessPetComponents({ countdown: seconds, imageUrl: null, expiresAt: 0, hint: '' }),
        allowedMentions: { parse: [] }
      }),
      onWaiting: () => interaction.editReply({
        ...buildGuessPetComponents({ preparingImage: true, imageUrl: null, expiresAt: 0 }),
        allowedMentions: { parse: [] }
      })
    });
    const imageFilename = preparedImage ? imageAttachmentName('r3v0-pet', interaction.id, preparedImage.extension) : null;
    const startedAt = Date.now();
    const expiresAt = startedAt + GUESS_HUGE_ROUND_MS;
    const imageReference = preparedImage ? attachmentReference(imageFilename) : imageUrl;
    const publishPayload = buildGuessPetComponents({
      expiresAt,
      imageUrl: imageReference,
      hint: renderHugeHint(hintState),
      nextHintAt: startedAt + GUESS_HUGE_HINT_INTERVAL_MS
    });
    if (preparedImage) publishPayload.files = [new AttachmentBuilder(preparedImage.buffer, { name: imageFilename })];
    let imageUploadAttempted = Boolean(preparedImage);
    let message;
    try {
      message = await interaction.editReply(publishPayload);
    } catch (error) {
      if (!preparedImage) throw error;
      imageUploadAttempted = false;
      console.warn(`[guess-pet] Discord image upload failed; falling back to the source URL: ${error.message}`);
      const fallbackPayload = buildGuessPetComponents({ expiresAt, imageUrl, hint: renderHugeHint(hintState), nextHintAt: startedAt + GUESS_HUGE_HINT_INTERVAL_MS });
      message = await interaction.editReply(fallbackPayload);
    }
    message = await interaction.fetchReply();
    const imageAttachment = imageUploadAttempted ? [...message.attachments.values()].find(item => item.name === imageFilename) : null;
    const game = {
      answerName: pet.name,
      knownPetNames,
      hintState,
      imageUrl,
      imageReference: imageAttachment ? attachmentReference(imageFilename) : imageUrl,
      imageFilename: imageAttachment ? imageFilename : null,
      imageAttachmentId: imageAttachment?.id || null,
      expiresAt,
      startedAt,
      guildId: interaction.guildId,
      channelId,
      guesses: new Set(),
      ended: false,
      message,
      timeout: null,
      hintTimer: null
    };
    if (preparedImage && imageUploadAttempted && !imageAttachment) {
      console.warn(`[guess-pet] Discord did not retain uploaded image ${imageFilename}; using the source URL.`);
      await editGuessMessage(game);
    }
    rememberGame(message.id, channelId, 'guess-pet');
    guessGames.set(message.id, game);
    game.hintTimer = setInterval(() => {
      if (game.ended) return clearGuessTimers(game);
      if (!revealNextHugeHint(game.hintState)) {
        clearInterval(game.hintTimer);
        game.hintTimer = null;
        return;
      }
      void editGuessMessage(game).catch(error => console.warn(`[guess-pet] Could not update hint ${message.id}: ${error.message}`));
    }, GUESS_HUGE_HINT_INTERVAL_MS);
    game.hintTimer.unref?.();
    game.timeout = setTimeout(() => { void finishGuessPetGame(game); }, Math.max(0, expiresAt - Date.now()));
    game.timeout.unref?.();
    started = true;
  } finally {
    if (!started) releaseGameChannel(channelId, 'guess-pet');
  }
}

/** Handles typed Huge names from chat; answer options are never exposed as buttons. */
export async function handleGuessMessage(message) {
  if (!message?.guildId || message.guildId !== config.guildId || message.author?.bot || message.webhookId) return false;
  for (const game of guessGames.values()) {
    if (game.ended || game.guildId !== message.guildId || game.channelId !== message.channelId) continue;
    if (Number(message.createdTimestamp || 0) < game.startedAt) continue;
    const submitted = extractHugeGuess(message.content, game.knownPetNames);
    if (!submitted) continue;
    if (game.guesses.has(message.author.id)) return false;
    game.guesses.add(message.author.id);
    const correct = isHugeGuessCorrect(submitted, game.answerName);
    if (!correct) {
      await message.react('❌').catch(() => {});
      return true;
    }
    await message.react('✅').catch(() => {});
    const username = message.member?.displayName || message.author.globalName || message.author.username || 'Player';
    await finishGuessPetGame(game, { userId: message.author.id, username });
    return true;
  }
  return false;
}

export async function handleArcadeChatMessage(message) {
  return handleArcadeMessage(message);
}

export async function handleAutocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (interaction.commandName === 'search-player') {
    if (focused.name !== 'nickname') return interaction.respond([]).catch(() => {});
    const query = String(focused.value ?? '').slice(0, 40);
    let timeoutId;
    try {
      // Discord autocomplete has a short deadline. If monitor startup has not warmed
      // the roster yet, share one in-flight API fetch and fall back to the last good roster.
      const membersPromise = loadPlayerAutocompleteMembers();
      const timeoutPromise = new Promise(resolve => { timeoutId = setTimeout(() => resolve([]), 1500); });
      const members = await Promise.race([membersPromise, timeoutPromise]);
      clearTimeout(timeoutId);
      const choices = getR3V0MemberSuggestions(members, query, 25);
      return interaction.respond(choices).catch(() => {});
    } catch (error) {
      clearTimeout(timeoutId);
      console.warn(`[player-search] Autocomplete failed: ${error.message}`);
      return interaction.respond([]).catch(() => {});
    }
  }
  if (interaction.commandName !== 'rap' || focused.name !== 'pet') return interaction.respond([]).catch(() => {});
  const query = String(focused.value ?? '').slice(0, 100);
  let timeoutId;
  try {
    // Discord autocomplete has a short response deadline. This uses the warmed RAP
    // cache and returns an empty list if a first-time API fetch is slow.
    const choicesPromise = getRAPData()
      .then(items => getRAPPetSuggestions(items, query, 25))
      .catch(error => {
        console.warn(`[rap] Autocomplete data unavailable: ${error.message}`);
        return [];
      });
    const timeoutPromise = new Promise(resolve => { timeoutId = setTimeout(() => resolve([]), 1800); });
    const choices = await Promise.race([choicesPromise, timeoutPromise]);
    clearTimeout(timeoutId);
    await interaction.respond(choices).catch(() => {});
  } catch (error) {
    clearTimeout(timeoutId);
    console.warn(`[rap] Could not respond to autocomplete: ${error.message}`);
    await interaction.respond([]).catch(() => {});
  }
}
export async function handleSlashCommand(interaction) {
  const { commandName } = interaction;
  try {
    if (await handlePsxSlash(interaction)) return;
    if (await handleClanSlash(interaction)) return;
    if (commandName === 'search-player') {
      await interaction.deferReply({ ephemeral: true });
      const result = await import('./monitor.js').then(m => m.searchR3V0Player(interaction.options.getString('nickname', true)));
      const attachment = new AttachmentBuilder(result.image, { name: 'r3v0-player-progress.png' });
      await interaction.editReply({ content: `Player progress for **${clip(result.player.username, 40)}**. This bot only monitors R3V0 members.`, files: [attachment], allowedMentions: { parse: [] } });
      return;
    }
    if (commandName === 'check-r3v0') {
      if (!canManagePanel(interaction.member)) throw new Error('Only clan leadership can force a manual refresh. The public panel updates automatically.');
      await interaction.deferReply({ ephemeral: true });
      const result = await refreshClanMonitor(interaction.client, { force: true });
      await interaction.editReply(`R3V0 panel updated in <#${config.channels.leaderboard}>. Tracking **${result.clan.members.length}** current clan members on page ${result.page + 1}.`);
      return;
    }
    if (commandName === 'rap') {
      await interaction.deferReply({ ephemeral: true });
      const pet = interaction.options.getString('pet', true);
      const variant = interaction.options.getString('variant', true);
      const data = await getRAPData();
      const item = findRAPItem(data, pet, variant);
      if (!item) {
        const alternatives = getRAPPetSuggestions(data, pet, 5).map(choice => `• ${choice.value}`).join('\n');
        return interaction.editReply(`No RAP entry found for **${clip(pet, 100)}** (${variant}).\n${alternatives ? `\n**Similar pet names:**\n${alternatives}` : 'Start typing in the pet option and choose a suggested name.'}`);
      }
      const actualName = String(item.configData?.id || item.configData?.name || pet);
      const petCollection = await getPetsCollection().catch(() => []);
      const artwork = petCollection.find(candidate => {
        const name = String(candidate?.configName || candidate?.configData?.id || candidate?.configData?.name || '').trim().toLowerCase();
        return name === actualName.trim().toLowerCase();
      });
      const visual = variant.startsWith('rainbow') ? artwork?.configData?.rainbowThumbnail
        : variant.startsWith('golden') ? artwork?.configData?.goldenThumbnail
        : artwork?.configData?.thumbnail;
      const imageUrl = bigGamesImageUrl(visual || item.configData?.thumbnail || item.configData?.goldenThumbnail);
      const isHuge = Boolean(item.configData?.huge) || /\b(huge|titanic|gargantuan)\b/i.test(actualName);
      const embed = clanEmbed('PET INTELLIGENCE').setColor(CLAN_COLORS.accent).setTitle(`${emoji('ps99Huge', '🐾')} PS99 RAP • PET VALUE`)
        .setDescription(`**${clip(actualName, 120)}**\nCurrent RAP estimate from the public Big Games dataset.`)
        .addFields(
          { name: `${emoji('ps99Gems', '💎')} RAP VALUE`, value: `**${formatNumber(item.value)}** diamonds`, inline: true },
          { name: 'VARIANT', value: item.variant, inline: true },
          { name: 'PET TYPE', value: isHuge ? 'Huge / Special' : 'Regular Pet', inline: true },
          { name: 'DATA SOURCE', value: '[Big Games public API](https://ps99.biggamesapi.io)', inline: true },
          { name: 'PRICE NOTE', value: 'RAP is a reference value, not a guaranteed sale or trade price.', inline: true }
        )
        .setFooter({ text: 'R3V0 PS99 Tools • Choose a pet from autocomplete for a more accurate lookup' }).setTimestamp(new Date());
      if (imageUrl) embed.setThumbnail(imageUrl);
      await interaction.editReply({ embeds: [embed] });
      return;
    }
    if (commandName === 'ban') {
      await interaction.deferReply({ ephemeral: true });
      const message = await (await import('./moderation.js')).executeBan(interaction, interaction.options.getUser('target', true), interaction.options.getString('reason', true));
      await interaction.editReply(message); return;
    }
    if (commandName === 'mute') {
      await interaction.deferReply({ ephemeral: true });
      const message = await (await import('./moderation.js')).executeTimeout(interaction, interaction.options.getUser('target', true), interaction.options.getString('duration', true), interaction.options.getString('reason', true));
      await interaction.editReply(message); return;
    }
    if (commandName === 'clan-warning') {
      await interaction.deferReply({ ephemeral: true });
      const message = await (await import('./moderation.js')).executeClanWarning(interaction, interaction.options.getUser('target', true), interaction.options.getString('roblox-name'), interaction.options.getString('reason', true));
      await interaction.editReply(message); return;
    }
    if (commandName === 'rules') {
      if (!canManagePanel(interaction.member)) throw new Error('You need the Owner role or Manage Server permission.');
      await interaction.deferReply({ ephemeral: true });
      const msg = await publishRules(interaction.client);
      await interaction.editReply(`Rules published or updated: <#${config.channels.rules}> (message ID: \`${msg.id}\`).`); return;
    }
    if (commandName === 'ticket-panel') {
      if (!canManagePanel(interaction.member)) throw new Error('You need the Owner role or Manage Server permission.');
      await interaction.deferReply({ ephemeral: true });
      const msg = await publishTicketPanel(interaction.client);
      await interaction.editReply(`Ticket panel published or updated in <#${config.channels.ticketPanel}> (message ID: \`${msg.id}\`).`); return;
    }
    if (commandName === 'create-giveaway') {
      if (!canManagePanel(interaction.member)) throw new Error('Only clan leadership or Manage Server can create giveaways.');
      await interaction.deferReply({ ephemeral: true });
      const response = await createGiveaway(interaction);
      await interaction.editReply({ content: response, allowedMentions: { parse: [] } }); return;
    }
    if (commandName === 'end-giveaway') {
      await interaction.deferReply({ ephemeral: true });
      const response = await endGiveawayCommand(interaction, interaction.options.getString('giveaway-id', true));
      await interaction.editReply({ content: response, allowedMentions: { parse: [] } }); return;
    }
    if (commandName === 'reroll-giveaway') {
      await interaction.deferReply({ ephemeral: true });
      const response = await rerollGiveawayCommand(interaction, interaction.options.getString('giveaway-id', true));
      await interaction.editReply({ content: response, allowedMentions: { parse: [] } }); return;
    }
    if (commandName === 'ticket-panel-edit') {
      if (!canManagePanel(interaction.member)) throw new Error('You need the Owner role or Manage Server permission.');
      const current = interaction.options.getInteger('current-slots', true);
      const capacity = interaction.options.getInteger('capacity', true);
      if (current > capacity) throw new Error('Current slots cannot exceed the total capacity.');
      setSetting('clan_slots_manual_override', true);
      setSetting('clan_slots_current', current); setSetting('clan_slots_capacity', capacity);
      await interaction.deferReply({ ephemeral: true });
      const msg = await publishTicketPanel(interaction.client);
      await interaction.editReply(`PS99 recruitment availability updated to **${current}/${capacity}**. Panel message ID: \`${msg.id}\`.`); return;
    }
    if (commandName === 'ticket-close') {
      await closeTicketFromCommand(interaction, interaction.options.getString('reason') || 'Closed with /ticket-close'); return;
    }
    if (commandName === 'log-gem-deposit') {
      if (!canManagePanel(interaction.member)) throw new Error('You need the Owner role or Manage Server permission to log a gem deposit.');
      await interaction.deferReply({ ephemeral: true });
      const userId = interaction.options.getString('roblox-user-id', true).trim();
      const amount = interaction.options.getInteger('amount', true);
      const note = interaction.options.getString('note') || '';
      if (!/^\d{1,20}$/.test(userId)) throw new Error('Roblox User ID must contain digits only.');
      const clan = await getClanData();
      const member = clan.members.find(m => m.userId === userId);
      if (!member) throw new Error('This Roblox account is not in the current R3V0 clan roster.');
      await logGemEvent({ robloxUserId: userId, username: member.username, amount, source: `Staff receipt by ${interaction.user.tag}`, note, eventId: `staff:${interaction.id}` });
      await interaction.editReply(`Receipt saved for **${formatNumber(amount)} gems**, **${clip(member.username, 40)}**. Official totals change only when the clan API reports an increase.`); return;
    }
    if (commandName === 'farm-points') {
      await interaction.reply({ embeds: [buildFarmPointsEmbed()], allowedMentions: { parse: [] } });
      return;
    }
    if (commandName === 'guess-pet') { await doGuessPet(interaction); return; }
    if (commandName === 'guess-pet-top') {
      const players = getHugeGuessLeaderboard(10);
      const pets = getMostIdentifiedHugePets(10);
      const embed = clanEmbed('CLAN COMMANDS').setColor(GUESS_HUGE_COLOR).setTitle(`${emoji('ps99Rank', '🏆')} PS99 · Guess Pet Leaderboard`)
        .setDescription('All-time statistics for correctly identified mystery pets from the Huge pet pool.')
        .addFields(
          { name: 'Top players', value: guessLeaderboardText(players, 10), inline: true },
          { name: 'Most identified pets', value: identifiedPetsText(pets, 10), inline: true },
          { name: 'Pets identified by top players', value: players.slice(0, 5).map(row => `**${clip(row.username, 40)}** · ${compactPetNames(row.petNames, 5)}`).join('\n') || 'No correct guesses recorded yet.', inline: false }
        ).setFooter({ text: 'R3V0 PS99 · Guess Pet' }).setTimestamp(new Date());
      await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
      return;
    }
    if (commandName === 'pet-scramble') { await startPetScramble(interaction); return; }
    if (commandName === 'emoji-pet') { await startEmojiPet(interaction); return; }
    if (commandName === 'higher-lower') { await startHigherLower(interaction); return; }
    if (commandName === 'arcade-top') {
      const embed = clanEmbed('CLAN COMMANDS').setColor(GUESS_HUGE_COLOR).setAuthor({ name: 'R3V0  /  CLAN ARCADE' })
        .setTitle(`${emoji('ps99Pet', '🎮')} Arcade leaderboard`).setDescription(getArcadeLeaderboardText(10))
        .setFooter({ text: 'Wins are saved in the R3V0 database' }).setTimestamp(new Date());
      await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
      return;
    }
    if (commandName === 'setup-emojis') {
      if (!canManagePanel(interaction.member)) throw new Error('Only clan leadership or Manage Server can install server emojis.');
      await interaction.deferReply({ ephemeral: true });
      const summary = await ensureServerEmojis(interaction.guild);
      refreshEmojiRegistry(interaction.guild);
      await interaction.editReply({ content: `${'✅'} **Official PS99 emoji setup finished**\n\n${formatEmojiSetupSummary(summary)}`, allowedMentions: { parse: [] } });
      return;
    }
    if (commandName === 'emoji-status') {
      if (!canManagePanel(interaction.member)) throw new Error('Only clan leadership or Manage Server can view the emoji setup status.');
      const live = await inspectServerEmojis(interaction.guild);
      refreshEmojiRegistry(interaction.guild);
      const summary = getLastEmojiSetupSummary();
      await interaction.reply({ content: `${'⚙️'} **Official PS99 emoji pack**\n\n${formatLiveEmojiStatus(live)}\n\n${formatEmojiSetupSummary(summary)}`, ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }
    if (commandName === 'r3v0-status') {
      await interaction.deferReply({ ephemeral: true });
      const clan = await getClanData({ force: true });
      const last = db.prepare('SELECT MAX(captured_at) AS at FROM member_snapshots').get()?.at || null;
      const embed = clanEmbed('CLAN CONTROL').setColor(CLAN_COLORS.accent).setTitle(`${'📈'} R3V0 Monitor Status`)
        .addFields(
          { name: 'Clan', value: clan.name, inline: true },
          { name: 'Roster', value: `${clan.members.length}/${clan.memberCapacity}`, inline: true },
          { name: 'Active battle', value: clip(clan.activeBattle, 100), inline: true },
          { name: 'Current battle points', value: clan.totalBattlePoints == null ? 'Not reported' : formatNumber(clan.totalBattlePoints), inline: true },
          { name: 'Point source', value: clip(clan.battlePointsSource || 'R3V0 clan endpoint', 100), inline: false },
          { name: 'Direct clan contribution rows', value: String(clan.battleContributionRowsCount ?? 0), inline: true },
          { name: 'Members with reported points', value: `${clan.reportedPointMembers}/${clan.members.length}`, inline: true },
          { name: 'Battle API matches', value: `Battle details: ${clan.battleDiagnostics?.battleDetailRowsMatched ?? 0} • Player aggregate: ${clan.battleDiagnostics?.playerAggregateRowsMatched ?? 0} • Per-member lookup: ${clan.battleDiagnostics?.playerLookupRowsMatched ?? 0}/${clan.battleDiagnostics?.playerLookupAttempts ?? 0}`, inline: false },
          { name: 'Battle API diagnostics', value: clip([clan.battleDiagnostics?.battleDetailsError, clan.battleDiagnostics?.playerAggregateError, clan.battleDiagnostics?.mismatchReason, clan.battleDiagnostics?.playerLookupSkipReason, `Battle: ${clan.battleDiagnostics?.battleDetailStatus || 'unknown'}; aggregate: ${clan.battleDiagnostics?.playerAggregateStatus || 'unknown'}; user lookups: ${clan.battleDiagnostics?.playerLookupAttempts ?? 0}; rejected other-clan rows: ${clan.battleDiagnostics?.rowsRejectedForOtherClan ?? 0}`, ...(clan.battleDiagnostics?.playerLookupErrors || []).slice(0, 3).map(row => `${row.userId}: ${row.error}`)].filter(Boolean).join(' | ') || 'No API diagnostics', 900), inline: false },
          { name: 'Big Games Owner ID', value: clan.ownerDiagnostics?.apiOwnerId ? `\`${clan.ownerDiagnostics.apiOwnerId}\`` : 'Missing', inline: true },
          { name: 'Configured founder ID', value: clan.ownerDiagnostics?.configuredOwnerId ? `\`${clan.ownerDiagnostics.configuredOwnerId}\`` : 'Could not resolve', inline: true },
          { name: 'Leader resolution', value: clip(clan.ownerDiagnostics?.resolution || 'unknown', 100), inline: false },
          { name: 'Leader present in roster', value: clan.ownerDiagnostics?.ownerInRoster ? 'Yes' : 'No', inline: true },
          { name: 'Last saved snapshot', value: last ? formatDate(last) : 'Not captured yet', inline: true },
          { name: 'Panel channel', value: `<#${config.channels.leaderboard}>`, inline: true }
        ).setFooter({ text: 'Only R3V0 is queried by this bot.' }).setTimestamp(new Date());
      await interaction.editReply({ embeds: [embed] }); return;
    }
    if (commandName === 'moderation-case') {
      if (!isModerationStaff(interaction.member, 'warn')) throw new Error('You need the Owner role or moderation permissions to view cases.');
      const id = interaction.options.getString('case-id', true);
      const row = getCase(id);
      if (!row) throw new Error(`No moderation case found for ${clip(id, 30)}.`);
      await interaction.reply({ embeds: [clanEmbed('CLAN COMMANDS').setColor(CLAN_COLORS.accent).setTitle(`${row.type} • ${row.case_id}`).addFields(
        { name: 'Target ID', value: `\`${row.target_id}\``, inline: true }, { name: 'Moderator ID', value: `\`${row.moderator_id}\``, inline: true },
        { name: 'DM delivered', value: row.dm_delivered ? 'Yes' : 'No', inline: true }, { name: 'Reason', value: clip(row.reason, 1000), inline: false }, { name: 'Created', value: formatDate(row.created_at), inline: true }, ...(row.expires_at ? [{ name: 'Expires', value: formatDate(row.expires_at), inline: true }] : [])
      )], ephemeral: true }); return;
    }
    await interaction.reply({ content: 'This command is not implemented.', ephemeral: true });
  } catch (error) {
    console.error(`[command] /${commandName} failed: ${error.stack || error.message}`);
    const content = clip(error.message || 'The command failed. Check bot logs.', 1800);
    if (interaction.deferred && interaction.commandName === 'guess-pet') {
      // Once an interaction has been converted to Components V2 it cannot be edited
      // back to legacy content/embeds. Keep failures inside a small V2 error card.
      const errorCard = new ContainerBuilder().setAccentColor(GUESS_HUGE_COLOR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# R3V0 ARCADE\n## Guess Pet could not start\n${content}`));
      await interaction.editReply({ components: [errorCard], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }).catch(() => {});
    } else if (interaction.deferred) await interaction.editReply({ content, allowedMentions: { parse: [] } }).catch(() => {});
    else if (interaction.replied) await interaction.followUp({ content, ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {});
    else await interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {});
  }
}
export async function handleComponent(interaction) {
  try {
    if (await handlePsxComponent(interaction)) return true;
    if (await handleClanComponent(interaction)) return true;
    if (interaction.customId.startsWith('arcade:hl:')) return await handleArcadeComponent(interaction);
    if (interaction.customId.startsWith('giveaway:')) return await handleGiveawayComponent(interaction);
    if (interaction.customId.startsWith('ticket:')) return await handleTicketComponent(interaction);
    if (interaction.customId.startsWith('r3v0:details:')) {
      const page = Math.max(0, Number(interaction.customId.split(':')[2]) || 0);
      await interaction.deferReply({ ephemeral: true });
      const clan = getCachedClanSnapshot() || await takeClanSnapshot();
      await interaction.editReply(buildBattleDetailsPayload(clan, page));
      return true;
    }
    if (interaction.customId.startsWith('r3v0:page:')) {
      const value = interaction.customId.split(':')[2];
      const { refreshClanMonitor } = await import('./monitor.js');
      const savedPage = value === 'current' ? Number(getSetting('r3v0_panel_page', 0)) : Math.max(0, Number(value) || 0);
      await interaction.deferReply({ ephemeral: true });
      await interaction.editReply(buildRankingPayload(getCachedClanSnapshot() || await takeClanSnapshot(), 'total', savedPage));
      return true;
    }
    if (interaction.customId === 'r3v0:refresh') {
      await interaction.deferReply({ ephemeral: true });
      if (canManagePanel(interaction.member)) await refreshClanMonitor(interaction.client);
      await interaction.editReply(buildRankingPayload(getCachedClanSnapshot() || await takeClanSnapshot()));
      return true;
    }
    return false;
  } catch (error) {
    console.error(`[component] ${interaction.customId} failed: ${error.stack || error.message}`);
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content: clip(error.message, 1700), ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {});
    else await interaction.reply({ content: clip(error.message, 1700), ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {});
    return true;
  }
}
