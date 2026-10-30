import { rememberGame, forgetGame } from './game-recovery.js';
import { clanEmbed, CLAN_COLORS } from './theme.js';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from './config.js';
import { getRAPData, getPetsCollection, bigGamesImageUrl } from './ps99.js';
import { clip, formatNumber } from './utils.js';
import { createHugeHintState, renderHugeHint, revealNextHugeHint, isHugeGuessCorrect } from './guess-huge-game.js';
import { petNameOf, petNamesFromCollection, splitPetRarity, scramblePetWords, pickEmojiPet, pickHigherLowerPair, extractArcadeGuess } from './arcade-utils.js';
import { recordArcadeWin, getArcadeLeaderboard } from './arcade-stats.js';
import { reserveGameChannel, releaseGameChannel, getGameInChannel } from './game-locks.js';
import { fetchImageForDiscord, imageAttachmentName, attachmentReference, keepDiscordAttachments, runStartCountdown, countdownDescription } from './arcade-media.js';
import { emoji, emojiId } from './server-emojis.js';

const ARCADE_COLOR = CLAN_COLORS.accent;
const TEXT_ROUND_MS = 75_000;
const HINT_INTERVAL_MS = 12_000;
const HIGHER_LOWER_ROUND_MS = 45_000;
const ARCADE_START_COUNTDOWN_SECONDS = 5;
const textGames = new Map();
const higherLowerGames = new Map();
const textGameByChannel = new Map();

function randomIndex(length, random = Math.random) {
  return Math.max(0, Math.min(length - 1, Math.floor(Math.max(0, Math.min(0.999999, Number(random()) || 0)) * length)));
}

function petImageUrl(pet) {
  return bigGamesImageUrl(pet?.configData?.thumbnail || pet?.configData?.goldenThumbnail || pet?.thumbnail || null);
}

function arcadeCountdownEmbed(gameName, seconds, detail = 'The game is preparing. The round timer starts when the puzzle appears.') {
  return clanEmbed('CLAN ARCADE').setColor(ARCADE_COLOR)
    .setAuthor({ name: 'R3V0  /  CLAN ARCADE' })
    .setTitle(`${emoji('ps99Pet', '🎮')} ${clip(gameName, 80)} · Get ready`)
    .setDescription(`${countdownDescription(gameName, seconds)}\n\n${detail}`)
    .addFields({ name: 'STARTS IN', value: `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`, inline: true })
    .setFooter({ text: 'Round and scoring have not started yet' })
    .setTimestamp(new Date());
}

function arcadePreparingImageEmbed(gameName) {
  return clanEmbed('CLAN ARCADE').setColor(ARCADE_COLOR)
    .setAuthor({ name: 'R3V0  /  CLAN ARCADE' })
    .setTitle(`${'⌛'} ${clip(gameName, 80)} · Preparing image`)
    .setDescription('The image is taking a little longer than expected. The game will start as soon as preparation finishes.')
    .setFooter({ text: 'The round timer has not started yet' })
    .setTimestamp(new Date());
}

function arcadeTextEmbed(game, result = null) {
  const titleByType = { scramble: 'Pet Scramble', emoji: 'Emoji Pet' };
  const title = result ? `${titleByType[game.type]} · Round complete` : titleByType[game.type];
  const description = result?.winnerName
    ? `**${clip(result.winnerName, 70)}** solved the puzzle first.\n\nCorrect pet: **${clip(game.answerName, 120)}**\nThe round is closed.`
    : result?.answerName
      ? `Time is up. The correct pet was **${clip(game.answerName, 120)}**.\nNo one solved this round.`
      : game.type === 'scramble'
        ? 'Unscramble the name. The rarity is shown separately, and letters are shuffled inside each word. Type the pet name or the scrambled name without its rarity.'
        : 'Identify the PS99 pet from clues that match its name. Clues are curated by exact words, and an extra hint appears every 12 seconds.';
  const embed = clanEmbed('CLAN ARCADE').setColor(ARCADE_COLOR)
    .setAuthor({ name: 'R3V0  /  CLAN ARCADE' })
    .setTitle(`${emoji('ps99Pet', '🎮')} ${title}`)
    .setDescription(description)
    .setFooter({ text: result ? 'R3V0 Arcade · Round closed' : 'One recognized guess per player · No random answer buttons' })
    .setTimestamp(new Date());
  if (!result && game.type === 'scramble') {
    embed.addFields(
      { name: 'Rarity', value: clip(game.rarity || 'Standard pet', 40), inline: true },
      { name: 'Scrambled pet name', value: `\`${clip(game.puzzle, 120)}\``, inline: false },
      { name: 'Letter hint', value: `\`${clip(renderHugeHint(game.hintState), 180)}\``, inline: false },
      { name: 'Round closes', value: `<t:${Math.floor(game.expiresAt / 1000)}:R>`, inline: true },
      { name: 'Next hint', value: 'In 12 seconds', inline: true }
    );
  } else if (!result && game.type === 'emoji') {
    const revealedHints = game.emojiClue.hints.slice(0, game.hintsRevealed);
    embed.addFields(
      { name: 'Emoji clues', value: clip(game.emojiClue.emojis.join('   '), 120), inline: false },
      { name: `Extra hint ${game.hintsRevealed}/${game.emojiClue.hints.length}`, value: clip(revealedHints.at(-1) || 'The first extra hint unlocks in 12 seconds.', 220), inline: false },
      { name: 'Round closes', value: `<t:${Math.floor(game.expiresAt / 1000)}:R>`, inline: true },
      { name: 'Next clue', value: game.hintsRevealed >= game.emojiClue.hints.length ? 'All clues shown' : 'In 12 seconds', inline: true }
    );
  } else if (result) {
    embed.addFields({ name: 'Correct answer', value: clip(game.answerName, 120), inline: true });
  }
  // Keep the puzzle hidden during play; show the prepared image at full width only after the round ends.
  if (game.imageUrl && result) embed.setImage(game.imageReference || game.imageUrl);
  return embed;
}

function higherLowerButtons(game, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`arcade:hl:${game.messageId}:A`).setLabel(`A · ${clip(game.a.name, 42)}`).setEmoji('🐾').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`arcade:hl:${game.messageId}:B`).setLabel(`B · ${clip(game.b.name, 42)}`).setEmoji('🐾').setStyle(ButtonStyle.Secondary).setDisabled(disabled)
  );
}

function higherLowerEmbed(game, result = null) {
  const description = result?.winnerName
    ? `**${clip(result.winnerName, 70)}** picked the higher RAP correctly.\n\n**${clip(game.a.name, 90)}** — ${formatNumber(game.a.value)} RAP\n**${clip(game.b.name, 90)}** — ${formatNumber(game.b.value)} RAP`
    : result?.timedOut
      ? `Time is up. The answers are:\n\n**${clip(game.a.name, 90)}** — ${formatNumber(game.a.value)} RAP\n**${clip(game.b.name, 90)}** — ${formatNumber(game.b.value)} RAP`
      : 'Which pet has the higher RAP? Choose A or B. Values stay hidden until the round ends. One vote per player.';
  const embed = clanEmbed('CLAN ARCADE').setColor(ARCADE_COLOR)
    .setAuthor({ name: 'R3V0  /  RAP CHALLENGE' })
    .setTitle(result ? `${emoji('ps99Rank', '🏆')} Higher or Lower · Round complete` : `${'📈'} Higher or Lower · RAP`)
    .setDescription(description)
    .setFooter({ text: result ? 'R3V0 Arcade · Round closed' : `Round closes <t:${Math.floor(game.expiresAt / 1000)}:R>` })
    .setTimestamp(new Date());
  if (!result) embed.addFields(
    { name: 'PET A', value: `**${clip(game.a.name, 90)}**`, inline: true },
    { name: 'PET B', value: `**${clip(game.b.name, 90)}**`, inline: true }
  );
  if (game.aImageReference || game.a.thumbnail) embed.setImage(game.aImageReference || game.a.thumbnail);
  if (game.bImageReference || game.b.thumbnail) embed.setThumbnail(game.bImageReference || game.b.thumbnail);
  return embed;
}

async function finishTextGame(game, winner = null) {
  if (!game || game.ended) return false;
  game.ended = true;
  if (game.timeout) clearTimeout(game.timeout);
  if (game.hintTimer) clearInterval(game.hintTimer);
  textGames.delete(game.messageId);
  textGameByChannel.delete(game.channelId);
  releaseGameChannel(game.channelId, game.type);
  if (winner) {
    try { recordArcadeWin({ userId: winner.userId, username: winner.username, gameType: game.type }); }
    catch (error) { console.error(`[arcade] Could not save ${game.type} win: ${error.message}`); }
  }
  const result = winner ? { winnerName: winner.username } : { answerName: game.answerName };
  game.imageReference = game.preparedImage ? attachmentReference(game.imageFilename) : game.imageUrl;
  const payload = { embeds: [arcadeTextEmbed(game, result)], components: [], allowedMentions: { parse: [] } };
  if (game.preparedImage) payload.files = [new AttachmentBuilder(game.preparedImage.buffer, { name: game.imageFilename })];
  try {
    await game.message.edit(payload);
    forgetGame(game.messageId);
  } catch (error) {
    if (!game.preparedImage) {
      console.warn(`[arcade] Could not close ${game.type} message ${game.messageId}: ${error.message}`);
      return true;
    }
    console.warn(`[arcade] Could not upload ${game.type} reveal image; falling back to source URL: ${error.message}`);
    game.imageReference = game.imageUrl;
    await game.message.edit({ embeds: [arcadeTextEmbed(game, result)], components: [], allowedMentions: { parse: [] } })
      .then(() => forgetGame(game.messageId))
      .catch(fallbackError => console.warn(`[arcade] Could not close ${game.type} message ${game.messageId}: ${fallbackError.message}`));
  }
  return true;
}

async function startTextGame(interaction, type) {
  const channelId = String(interaction.channelId || '');
  if (!reserveGameChannel(channelId, type)) {
    const active = getGameInChannel(channelId) || 'another game';
    await interaction.reply({ content: `A game is already active in this channel (**${active}**). Finish it before starting another one.`, ephemeral: true });
    return;
  }
  let started = false;
  try {
    await interaction.deferReply();
    const pets = await getPetsCollection();
    const names = petNamesFromCollection(pets);
    let answerName;
    let emojiClue = null;
    let imageUrl = null;
    let puzzle = '';
    let rarity = null;
    let scrambleAnswerName = null;
    let selected;
    if (type === 'scramble') {
      const eligible = pets.filter(pet => {
        const petName = petNameOf(pet);
        const parts = splitPetRarity(petName);
        return petName && Array.from(parts.name).filter(char => /[\p{L}\p{N}]/u.test(char)).length >= 4;
      });
      if (!eligible.length) throw new Error('The public PS99 pet collection has no usable names right now.');
      selected = eligible[randomIndex(eligible.length)];
      answerName = petNameOf(selected);
      const parts = splitPetRarity(answerName);
      rarity = parts.rarity;
      scrambleAnswerName = parts.name;
      puzzle = scramblePetWords(scrambleAnswerName);
      imageUrl = petImageUrl(selected);
    } else {
      selected = pickEmojiPet(pets);
      answerName = selected.name;
      emojiClue = selected.clue;
      imageUrl = petImageUrl(selected.pet); // Stored for the result card; hidden while the puzzle is active.
    }
    if (!answerName) throw new Error('Could not choose a pet for this round. Try again in a moment.');
    const preparedImage = await runStartCountdown({
      seconds: ARCADE_START_COUNTDOWN_SECONDS,
      intervalMs: 1000,
      prepare: () => fetchImageForDiscord(imageUrl),
      onTick: seconds => interaction.editReply({
        embeds: [arcadeCountdownEmbed(type === 'scramble' ? 'Pet Scramble' : 'Emoji Pet', seconds, 'Fetching the reveal image before the round begins.')],
        allowedMentions: { parse: [] }
      }),
      onWaiting: () => interaction.editReply({ embeds: [arcadePreparingImageEmbed(type === 'scramble' ? 'Pet Scramble' : 'Emoji Pet')], allowedMentions: { parse: [] } })
    });
    const imageFilename = preparedImage ? imageAttachmentName(`r3v0-${type}`, interaction.id, preparedImage.extension) : null;
    const startedAt = Date.now();
    const game = {
      type, answerName, knownNames: [...new Set([...names, ...(scrambleAnswerName ? [scrambleAnswerName] : [])])],
      acceptedAnswers: scrambleAnswerName ? [answerName, scrambleAnswerName] : [answerName],
      puzzle, rarity, emojiClue, hintsRevealed: 0, imageUrl,
      imageReference: imageUrl, preparedImage, imageFilename,
      hintState: createHugeHintState(type === 'scramble' ? scrambleAnswerName : answerName), startedAt,
      expiresAt: startedAt + TEXT_ROUND_MS, guildId: interaction.guildId, channelId,
      guesses: new Set(), ended: false, message: null, messageId: null, timeout: null, hintTimer: null
    };
    await interaction.editReply({ embeds: [arcadeTextEmbed(game)], allowedMentions: { parse: [] } });
    game.message = await interaction.fetchReply();
    game.messageId = game.message.id;
    rememberGame(game.messageId, game.channelId, game.type);
    textGames.set(game.messageId, game);
    textGameByChannel.set(channelId, game.messageId);
    game.hintTimer = setInterval(() => {
      if (game.ended) { clearInterval(game.hintTimer); return; }
      if (game.type === 'emoji') {
        if (game.hintsRevealed >= game.emojiClue.hints.length) { clearInterval(game.hintTimer); game.hintTimer = null; return; }
        game.hintsRevealed += 1;
      } else if (!revealNextHugeHint(game.hintState)) {
        clearInterval(game.hintTimer); game.hintTimer = null; return;
      }
      void game.message.edit({ embeds: [arcadeTextEmbed(game)], allowedMentions: { parse: [] } })
        .catch(error => console.warn(`[arcade] Could not update ${type} hint: ${error.message}`));
    }, HINT_INTERVAL_MS);
    game.hintTimer.unref?.();
    game.timeout = setTimeout(() => { void finishTextGame(game); }, Math.max(0, game.expiresAt - Date.now()));
    game.timeout.unref?.();
    started = true;
  } finally {
    if (!started) releaseGameChannel(channelId, type);
  }
}

export async function startPetScramble(interaction) { return startTextGame(interaction, 'scramble'); }
export async function startEmojiPet(interaction) { return startTextGame(interaction, 'emoji'); }

export async function startHigherLower(interaction) {
  const channelId = String(interaction.channelId || '');
  if (!reserveGameChannel(channelId, 'higherlower')) {
    await interaction.reply({ content: `A game is already active in this channel (**${getGameInChannel(channelId)}**). Finish it before starting another one.`, ephemeral: true });
    return;
  }
  let started = false;
  try {
    await interaction.deferReply();
    const rapData = await getRAPData();
    const pair = pickHigherLowerPair(rapData);
    pair.a.thumbnail = bigGamesImageUrl(pair.a.thumbnail);
    pair.b.thumbnail = bigGamesImageUrl(pair.b.thumbnail);
    const [aImage, bImage] = await runStartCountdown({
      seconds: ARCADE_START_COUNTDOWN_SECONDS,
      intervalMs: 1000,
      prepare: () => Promise.all([fetchImageForDiscord(pair.a.thumbnail), fetchImageForDiscord(pair.b.thumbnail)]),
      onTick: seconds => interaction.editReply({ embeds: [arcadeCountdownEmbed('Higher or Lower · RAP', seconds, 'Loading both pet images into Discord before voting opens.')], allowedMentions: { parse: [] } }),
      onWaiting: () => interaction.editReply({ embeds: [arcadePreparingImageEmbed('Higher or Lower · RAP')], allowedMentions: { parse: [] } })
    });
    const aImageFilename = aImage ? imageAttachmentName('r3v0-rap-a', interaction.id, aImage.extension) : null;
    const bImageFilename = bImage ? imageAttachmentName('r3v0-rap-b', interaction.id, bImage.extension) : null;
    const startedAt = Date.now();
    const game = {
      ...pair, type: 'higherlower', channelId, guildId: interaction.guildId,
      aImageReference: aImage ? attachmentReference(aImageFilename) : pair.a.thumbnail,
      bImageReference: bImage ? attachmentReference(bImageFilename) : pair.b.thumbnail,
      aImageFilename, bImageFilename, imageAttachments: [],
      startedAt, expiresAt: startedAt + HIGHER_LOWER_ROUND_MS, votes: new Set(), ended: false,
      message: null, messageId: null, timeout: null
    };
    const payload = { embeds: [higherLowerEmbed(game)], components: [], allowedMentions: { parse: [] } };
    payload.files = [];
    if (aImage) payload.files.push(new AttachmentBuilder(aImage.buffer, { name: aImageFilename }));
    if (bImage) payload.files.push(new AttachmentBuilder(bImage.buffer, { name: bImageFilename }));
    try {
      await interaction.editReply(payload);
    } catch (error) {
      if (!aImage && !bImage) throw error;
      console.warn(`[arcade] Higher/Lower Discord image upload failed; falling back to source URLs: ${error.message}`);
      game.aImageReference = pair.a.thumbnail;
      game.bImageReference = pair.b.thumbnail;
      await interaction.editReply({ embeds: [higherLowerEmbed(game)], components: [], allowedMentions: { parse: [] } });
    }
    game.message = await interaction.fetchReply();
    game.messageId = game.message.id;
    const uploaded = [...game.message.attachments.values()];
    const aAttachment = aImage ? uploaded.find(item => item.name === aImageFilename) : null;
    const bAttachment = bImage ? uploaded.find(item => item.name === bImageFilename) : null;
    if (aAttachment) game.imageAttachments.push({ id: aAttachment.id, filename: aAttachment.name });
    else if (aImage) game.aImageReference = pair.a.thumbnail;
    if (bAttachment) game.imageAttachments.push({ id: bAttachment.id, filename: bAttachment.name });
    else if (bImage) game.bImageReference = pair.b.thumbnail;
    rememberGame(game.messageId, game.channelId, 'higherlower');
    higherLowerGames.set(game.messageId, game);
    const keep = keepDiscordAttachments(game.imageAttachments);
    await game.message.edit({ embeds: [higherLowerEmbed(game)], components: [higherLowerButtons(game)], ...keep, allowedMentions: { parse: [] } });
    game.timeout = setTimeout(() => { void finishHigherLower(game); }, Math.max(0, game.expiresAt - Date.now()));
    game.timeout.unref?.();
    started = true;
  } finally {
    if (!started) releaseGameChannel(channelId, 'higherlower');
  }
}

async function finishHigherLower(game, winner = null) {
  if (!game || game.ended) return false;
  game.ended = true;
  if (game.timeout) clearTimeout(game.timeout);
  higherLowerGames.delete(game.messageId);
  releaseGameChannel(game.channelId, 'higherlower');
  if (winner) {
    try { recordArcadeWin({ userId: winner.userId, username: winner.username, gameType: 'higherlower' }); }
    catch (error) { console.error(`[arcade] Could not save higher/lower win: ${error.message}`); }
  }
  await game.message.edit({ embeds: [higherLowerEmbed(game, winner ? { winnerName: winner.username } : { timedOut: true })], components: [], ...keepDiscordAttachments(game.imageAttachments), allowedMentions: { parse: [] } })
    .then(() => forgetGame(game.messageId))
    .catch(error => console.warn(`[arcade] Could not close higher/lower message ${game.messageId}: ${error.message}`));
  return true;
}

export async function handleArcadeMessage(message) {
  if (!message?.guildId || message.guildId !== config.guildId || message.author?.bot || message.webhookId) return false;
  const gameId = textGameByChannel.get(String(message.channelId));
  const game = gameId ? textGames.get(gameId) : null;
  if (!game || game.ended || game.guildId !== message.guildId || Number(message.createdTimestamp || 0) < game.startedAt) return false;
  const submitted = extractArcadeGuess(message.content, game.knownNames);
  if (!submitted || game.guesses.has(message.author.id)) return false;
  game.guesses.add(message.author.id);
  if (!(game.acceptedAnswers || [game.answerName]).some(answer => isHugeGuessCorrect(submitted, answer))) {
    await message.react('❌').catch(() => {});
    return true;
  }
  await message.react('✅').catch(() => {});
  const username = message.member?.displayName || message.author.globalName || message.author.username || 'Player';
  await finishTextGame(game, { userId: message.author.id, username });
  return true;
}

export async function handleArcadeComponent(interaction) {
  const match = String(interaction.customId || '').match(/^arcade:hl:(\d+):(A|B)$/);
  if (!match) return false;
  const game = higherLowerGames.get(match[1]);
  if (!game || game.ended) {
    await interaction.reply({ content: 'This RAP round has already closed.', ephemeral: true }).catch(() => {});
    return true;
  }
  if (game.votes.has(interaction.user.id)) {
    await interaction.reply({ content: 'You have already voted in this round.', ephemeral: true }).catch(() => {});
    return true;
  }
  game.votes.add(interaction.user.id);
  if (match[2] !== game.answer) {
    await interaction.reply({ content: 'Not this time! Your vote is locked for this round.', ephemeral: true }).catch(() => {});
    return true;
  }
  await interaction.deferUpdate();
  const username = interaction.member?.displayName || interaction.user.globalName || interaction.user.username || 'Player';
  await finishHigherLower(game, { userId: interaction.user.id, username });
  return true;
}

export function getArcadeLeaderboardText(limit = 10) {
  const rows = getArcadeLeaderboard(limit);
  if (!rows.length) return 'No arcade wins recorded yet. Start `/pet-scramble`, `/emoji-pet` or `/higher-lower` to make the leaderboard.';
  const medals = ['🥇', '🥈', '🥉'];
  return rows.map((row, index) => `${medals[index] || `#${index + 1}`} **${clip(row.username, 45)}** · **${Number(row.totalWins) || 0}** wins\n↳ Scramble ${Number(row.scrambleWins) || 0} · Emoji ${Number(row.emojiWins) || 0} · RAP ${Number(row.higherLowerWins) || 0}`).join('\n');
}
