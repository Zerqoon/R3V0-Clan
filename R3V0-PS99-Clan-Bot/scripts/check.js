import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve('.');
const files = [];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) { if (!['node_modules', '.git', 'data', 'preview'].includes(item.name)) walk(full); }
    else if (item.isFile() && full.endsWith('.js')) files.push(full);
  }
}
walk(path.join(root, 'src')); walk(path.join(root, 'scripts')); walk(path.join(root, 'test'));
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { failed = true; console.error(`[check] ${file}\n${result.stderr || result.stdout}`); }
}
// Keep the Clan Battle card free of the old decorative divider.
const monitorSource = fs.readFileSync(path.join(root, 'src/monitor.js'), 'utf8');
if (/BATTLE_STAR_DIVIDER|✦\s*━{5,}/u.test(monitorSource)) {
  failed = true;
  console.error('[check] src/monitor.js must not render the old decorative divider');
}
// File uploads onto an older repo may retain an unused renderer. Guard the
// active panel code; the native integration test verifies every visible score.
if (monitorSource.includes('renderBattleDashboard') || monitorSource.includes("from './battle-canvas.js'")) {
  failed = true;
  console.error('[check] Clan Battle must use native Discord text, never a generated scoreboard image');
}
if (failed) process.exit(1);

// Keep player search resilient to Roblox username/display-name differences and
// verify the full user-provided Fantasy Clan Battle point table.
const ps99Source = fs.readFileSync(path.join(root, 'src/ps99.js'), 'utf8');
const getClanDataSource = ps99Source.slice(ps99Source.indexOf('export async function getClanData'), ps99Source.indexOf('export async function getRAPData'));
for (const [label, ok] of [
  ['per-clan endpoint remains the authoritative roster source', getClanDataSource.includes('/api/clan/${encodeURIComponent(config.clanName)}')],
  ['current BattleID snapshot reads the live Battles[].PointContributions response', ps99Source.includes('Battles.${String(activeBattleId)}.PointContributions') && ps99Source.includes('getClanBattleSnapshot(data, activeBattleId)')],
  ['current battle detail is used only as a score/rank fallback', getClanDataSource.includes('/v1/clans/battles/${encodeURIComponent(expectedBattleId)}')],
  ['player aggregate is used only when current roster members remain unreported', getClanDataSource.includes('if (missingIds.length)') && getClanDataSource.includes('/v1/clans/players')],
  ['unresolved R3V0 members receive individual current-battle lookup attempts', getClanDataSource.includes('/v1/clans/players/${encodeURIComponent(id)}') && ps99Source.includes('playerLookups: sources?.playerLookups')],
  ['external point rows are filtered to immutable R3V0 roster IDs', ps99Source.includes('membersById.has(id)')],
  ['explicit rows from other clans are rejected', ps99Source.includes("normalClanName(sourceClanName) !== 'R3V0'")],
  ['aggregate data must match the active battle ID', ps99Source.includes("aggregateBattleId !== String(expectedBattleId)")]
]) {
  if (!ok) { failed = true; console.error(`[check] Missing safe single-clan point fallback: ${label}`); }
}
const monitorSourceForSearch = fs.readFileSync(path.join(root, 'src/monitor.js'), 'utf8');
const commandsSource = fs.readFileSync(path.join(root, 'src/commands.js'), 'utf8');
const indexSourceForSearch = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
for (const [label, ok] of [
  ['new-member welcome handler passes the imported Canvas renderer', indexSourceForSearch.includes('handleNewMember(member, renderWelcomeCanvas, sendLog)') && indexSourceForSearch.includes("import { renderWelcomeCanvas } from './canvas.js'")],
  ['Guess Pet accepts typed names, progressively reveals letters, closes the message on a correct answer, and exposes top lists', commandsSource.includes('getHugePetNames(pets)') && commandsSource.includes('createHugeHintState(pet.name)') && commandsSource.includes('handleGuessMessage') && indexSourceForSearch.includes('handleGuessMessage(message)') && commandsSource.includes("message.react('✅')") && commandsSource.includes('finishGuessPetGame(game') && commandsSource.includes('guess-pet-top') && commandsSource.includes('getMostIdentifiedHugePets') && fs.existsSync(path.join(root, 'src/guess-huge-game.js')) && !commandsSource.includes('buildGuessButtonRow') && !commandsSource.includes('.setLabel(clip(option.name, 80))')],
  ['Clan Battle presents scores in native text components with original art and controls', monitorSourceForSearch.includes('MessageFlags.IsComponentsV2') && monitorSourceForSearch.includes('.addSectionComponents(header)') && monitorSourceForSearch.includes('.addMediaGalleryComponents(') && monitorSourceForSearch.includes('ranking.addActionRowComponents(controls)') && monitorSourceForSearch.includes('r3v0-banner.png') && monitorSourceForSearch.includes('summaryLines') && commandsSource.includes("r3v0:details:") && !monitorSourceForSearch.includes('renderBattleDashboard')],
  ['API sampling skip does not fabricate missing battle points', getClanDataSource.includes('playerLookupSkipReason =') && getClanDataSource.includes('scores remain unreported')]
]) {
  if (!ok) { failed = true; console.error(`[check] Regression guard failed: ${label}`); }
}
const canvasSource = fs.readFileSync(path.join(root, 'src/canvas.js'), 'utf8');
const databaseSource = fs.readFileSync(path.join(root, 'src/db.js'), 'utf8');
const farmPointsSource = fs.readFileSync(path.join(root, 'src/farm-points.js'), 'utf8');
for (const [label, ok] of [
  ['Roblox keyword search supports display-name fallback', ps99Source.includes('users/search?keyword=') && ps99Source.includes('matchR3V0MemberFromRobloxSearch')],
  ['player search matches current R3V0 roster before responding', monitorSourceForSearch.includes('findClanMemberByQuery(clan.members, search)') && monitorSourceForSearch.includes('matchR3V0MemberFromRobloxSearch(clan.members, candidates, search)')],
  ['search autocomplete can warm the roster on first use', commandsSource.includes('loadPlayerAutocompleteMembers') && commandsSource.includes('playerAutocompletePending')],
  ['player Canvas includes display name and exact known point values', canvasSource.includes('Display name: ${displayName}') && canvasSource.includes("player.pointsKnown === false ? 'Not reported' : formatNumber(player.points)")],
  ['player Canvas uses a dedicated high-contrast R3V0 palette without a neon-glow chart', canvasSource.includes('const PLAYER_PALETTE = Object.freeze({') && canvasSource.includes('drawPlayerBackground(ctx, width, height)') && canvasSource.includes('Display name: ${displayName}') && canvasSource.includes("player.pointsKnown === false ? 'Not reported' : formatNumber(player.points)") && !canvasSource.includes('shadowBlur = 8')],
  ['Guess Pet persistence tracks player wins and individual pet counts', fs.existsSync(path.join(root, 'src/guess-huge-stats.js')) && databaseSource.includes('CREATE TABLE IF NOT EXISTS huge_guess_stats') && databaseSource.includes('CREATE TABLE IF NOT EXISTS huge_guess_pet_stats') && commandsSource.includes('recordHugeGuessWin')],
  ['player search Canvas uses the shared R3V0 background and a full-width time/value chart', canvasSource.includes('drawWidth = image.width * scale') && canvasSource.includes('niceChartMax') && canvasSource.includes('chartTickLabel') && canvasSource.includes('24h ago') && fs.existsSync(path.join(root, 'assets/r3v0-banner.png'))],
  ['farm-points command is registered', commandsSource.includes("setName('farm-points')") && farmPointsSource.includes('Fantasy Clan Battle — Points Table')],
  ['farm-points values are present', ['10000','2500','5000','Difficulty 1','Rarer than 1 in 100,000'].every(value => farmPointsSource.includes(value))]
]) {
  if (!ok) { failed = true; console.error(`[check] Missing feature: ${label}`); }
}
const giveawaySource = fs.readFileSync(path.join(root, 'src/giveaways.js'), 'utf8');
const giveawayUtilsSource = fs.readFileSync(path.join(root, 'src/giveaway-utils.js'), 'utf8');
for (const [label, ok] of [
  ['giveaway create/end/reroll slash commands are registered', commandsSource.includes("setName('create-giveaway')") && commandsSource.includes("setName('end-giveaway')") && commandsSource.includes("setName('reroll-giveaway')")],
  ['giveaway form supports role, activity, age, bonus entries, URL and attachment image', commandsSource.includes("setName('required-role')") && commandsSource.includes("setName('min-messages')") && commandsSource.includes("setName('min-account-days')") && commandsSource.includes("setName('min-server-days')") && commandsSource.includes("setName('bonus-role')") && commandsSource.includes("setName('image-url')") && commandsSource.includes("setName('image')")],
  ['giveaways have persistent rows and unique entry tracking', databaseSource.includes('CREATE TABLE IF NOT EXISTS giveaways') && databaseSource.includes('CREATE TABLE IF NOT EXISTS giveaway_entries') && databaseSource.includes('PRIMARY KEY (giveaway_id, user_id)')],
  ['message activity is tracked for eligibility and the persistent expiry worker is connected', giveawaySource.includes('giveaway_message_counts') && indexSourceForSearch.includes('recordGiveawayMessage(message)') && indexSourceForSearch.includes('startGiveawayWorker(readyClient)')],
  ['giveaway duration and unique weighted draw helpers have direct unit coverage', giveawayUtilsSource.includes('MAX_GIVEAWAY_DURATION_MS') && fs.existsSync(path.join(root, 'test/giveaway-utils.test.js'))],
  ['giveaway entrants are validated on entry and again before drawing', giveawaySource.includes('eligibilityForUser(interaction.guild, giveaway, interaction.user.id)') && giveawaySource.includes('const entrants = await eligibleEntries(guild, giveaway)')],
]) {
  if (!ok) { failed = true; console.error(`[check] Giveaway feature guard failed: ${label}`); }
}
const arcadeSource = fs.readFileSync(path.join(root, 'src/arcade.js'), 'utf8');
const arcadeUtilsSource = fs.readFileSync(path.join(root, 'src/arcade-utils.js'), 'utf8');
const arcadeStatsSource = fs.readFileSync(path.join(root, 'src/arcade-stats.js'), 'utf8');
for (const [label, ok] of [
  ['three extra PS99 arcade commands are registered and dispatched', ["setName('pet-scramble')", "setName('emoji-pet')", "setName('higher-lower')"].every(token => commandsSource.includes(token)) && commandsSource.includes("commandName === 'pet-scramble'") && commandsSource.includes("commandName === 'emoji-pet'") && commandsSource.includes("commandName === 'higher-lower'")],
  ['arcade chat guesses and button interactions are routed', indexSourceForSearch.includes('handleArcadeChatMessage(message)') && commandsSource.includes('handleArcadeComponent(interaction)')],
  ['arcade games share a per-channel game lock', arcadeSource.includes('reserveGameChannel(channelId, type)') && commandsSource.includes("reserveGameChannel(channelId, 'guess-pet')")],
  ['arcade wins persist in SQLite and have a leaderboard', databaseSource.includes('CREATE TABLE IF NOT EXISTS arcade_game_stats') && arcadeStatsSource.includes('getArcadeLeaderboard') && commandsSource.includes("setName('arcade-top')")],
  ['Pet Scramble keeps rarity readable and scrambles words independently', arcadeUtilsSource.includes('splitPetRarity') && arcadeUtilsSource.includes('Shuffle letters inside each word') && arcadeSource.includes('Scrambled pet name')],
  ['Emoji Pet uses curated whole-word semantic clues and delayed extra hints', arcadeUtilsSource.includes('whole pet-name word') && arcadeUtilsSource.includes('snowflake') && arcadeUtilsSource.includes('leprechaun') && arcadeSource.includes('game.hintsRevealed')],
  ['Higher or Lower uses valid normal RAP entries and ends with the RAP comparison', arcadeUtilsSource.includes('pickHigherLowerPair') && arcadeSource.includes('finishHigherLower(game')],
  ['Guess Pet uses a single Components V2 image gallery and no duplicate legacy embed', commandsSource.includes('export function buildGuessPetComponents') && commandsSource.includes('MediaGalleryBuilder') && commandsSource.includes('MessageFlags.IsComponentsV2') && commandsSource.includes("setName('guess-pet')") && commandsSource.includes("setName('guess-pet-top')") && !commandsSource.includes('buildGuessHugeEmbed') && !commandsSource.includes('.setImage(imageUrl)')],
  ['Guess Pet hints reveal sequentially in compact word-shaped clues', fs.existsSync(path.join(root, 'src/guess-huge-game.js')) && !fs.readFileSync(path.join(root, 'src/guess-huge-game.js'), 'utf8').includes('remaining[i], remaining[pick]')],
  ['Guess Pet has an in-card countdown, prepares the image first, uploads it to Discord, and preserves it in the single media gallery', commandsSource.includes('runStartCountdown({') && commandsSource.includes('countdown: seconds') && commandsSource.includes('fetchImageForDiscord(imageUrl)') && commandsSource.includes('new AttachmentBuilder(preparedImage.buffer') && commandsSource.includes('keepDiscordAttachments(')],
  ['all image-based arcade modes show a countdown and Higher/Lower keeps both uploaded pet images', arcadeSource.includes('runStartCountdown({') && arcadeSource.includes('Loading both pet images into Discord') && arcadeSource.includes('new AttachmentBuilder(aImage.buffer') && arcadeSource.includes('new AttachmentBuilder(bImage.buffer') && fs.existsSync(path.join(root, 'src/arcade-media.js'))]
]) {
  if (!ok) { failed = true; console.error(`[check] Arcade feature guard failed: ${label}`); }
}
if (failed) process.exit(1);

const emojiSource = fs.readFileSync(path.join(root, 'src/server-emojis.js'), 'utf8');
const emojiAssetDir = path.join(root, 'assets/emojis');
const emojiAssets = fs.existsSync(emojiAssetDir) ? fs.readdirSync(emojiAssetDir).filter(name => name.endsWith('.png')) : [];
for (const [label, ok] of [
  ['official PS99 emoji installer exists and is wired into startup', fs.existsSync(path.join(root, 'src/server-emojis.js')) && indexSourceForSearch.includes("ensureServerEmojis(guild)")],
  ['emoji setup and status slash commands are registered', commandsSource.includes("setName('setup-emojis')") && commandsSource.includes("setName('emoji-status')") && commandsSource.includes("commandName === 'setup-emojis'")],
  ['official PS99 artwork is dynamically resolved through BIG Games collections/image API plus the official BIG Games GitHub Pet Icons attempt', emojiSource.includes('/api/collections') && emojiSource.includes('/api/collection/${encodeURIComponent(name)}') && emojiSource.includes('/image/${id}') && emojiSource.includes('extractImageAssetCandidates') && emojiSource.includes('api.github.com/repos/BIG-Games-LLC/ps99-public-api-docs/contents/Pet%20Icons') && emojiSource.includes('OFFICIAL_PS99_EMOJI_SPECS')],
  ['generated/local emoji artwork is not shipped', emojiAssets.length === 0 && !emojiSource.includes('localBuffer(') && !emojiSource.includes('fallbackFile')],
  ['Clan Battle uses official PS99 battle/rank artwork with Unicode for generic UI', monitorSourceForSearch.includes("emoji('ps99Battle'") && monitorSourceForSearch.includes("emoji('ps99Rank'")],
  ['PS99 modules use official registry keys', commandsSource.includes("emoji('ps99Huge'") && fs.readFileSync(path.join(root, 'src/tickets.js'), 'utf8').includes("emoji('ps99Pet'") && giveawaySource.includes("emoji('ps99Gift'")],
]) {
  if (!ok) { failed = true; console.error(`[check] Official PS99 emoji feature guard failed: ${label}`); }
}
if (failed) process.exit(1);

console.log(`[check] Syntax OK for ${files.length} JavaScript files and feature regression guards.`);

// Railway volume safety: chown at image-build time is not enough because
// Railway mounts volumes at runtime. Ensure the startup entrypoint repairs
// ownership before dropping privileges to the bot user.
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const entrypoint = fs.readFileSync(path.join(root, 'docker-entrypoint.sh'), 'utf8');
for (const [label, ok] of [
  ['Dockerfile installs gosu', /gosu/.test(dockerfile)],
  ['Dockerfile uses the runtime entrypoint', /ENTRYPOINT.*docker-entrypoint\.sh/.test(dockerfile)],
  ['entrypoint fixes runtime volume ownership', entrypoint.includes('chown -R bot:bot "$DATA_DIR"')],
  ['entrypoint drops privileges to bot:bot', /exec gosu bot:bot/.test(entrypoint)],
  ['database path is logged for diagnostics', /SQLite opened:/.test(fs.readFileSync(path.join(root, 'src/db.js'), 'utf8'))]
]) {
  if (!ok) { failed = true; console.error(`[check] Railway volume configuration missing: ${label}`); }
}
if (failed) process.exit(1);
