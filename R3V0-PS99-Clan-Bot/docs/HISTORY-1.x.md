# R3V0 PS99 Clan Bot

## Current release: Version 1.18.2 — Build Fix

Fixes upgrades made by uploading the new files over an older repository:

- An unused old `src/battle-canvas.js` no longer fails the check merely because it still exists. The active Clan Battle code and integration tests continue to enforce native text scores.
- The legacy `test/clan-canvas.integration.test.js` path is included with updated native-panel tests, so an upload overwrites the stale test.
- A regression test reproduces an old renderer left in the repository.
- Docker runs check, tests and preview in separate labelled build steps; every validation remains enabled.

Clan Battle stays native Components V2. Keep the existing Railway Variables and `/app/data` volume, upload the full package and redeploy.

A standalone English-language Discord bot for the **R3V0 clan only** in Pet Simulator 99. The project is designed for Railway and uses Discord.js, Canvas and SQLite.

## Features

- **Native Clan Battle panel** with the original R3V0 artwork, text scores, podium, contribution percentages, pagination and private Details. Only the original banner/logo are uploaded; score changes edit native text in the saved message.
- **R3V0-only clan monitoring** from the official Big Games public API. The persistent leaderboard in `1564416597253165086` edits one message instead of reposting it. It includes every member in the API roster, including zero-point members, and merges the clan owner from the API `Owner` field even when the owner is not present in `Members`. The configured owner label `B3STTIEE` is shown in the summary and their roster row, even if Roblox name resolution returns a different display label. If the API omits the owner ID, the bot attempts to resolve the configured leader username. The full roster is paginated by 10. The exact `/api/clan/R3V0` response remains the authoritative source for the roster and current battle scores. The parser reads `Battles[activeBattleId].PointContributions` first (the live payload format), then supports legacy `Contribution.Battle` variants. Only if the active-battle contribution table is missing, the bot enriches missing scores and rank from BIG Games current-battle details and, only if members remain unreported, the current-battle player aggregate, then individual lookups only when their sampled source may contain the member. Every fallback record is joined by immutable Roblox User ID, must belong to the current R3V0 roster, and is rejected if it explicitly names a different clan. No other clan is shown, saved, or monitored. The player Canvas displays actual reported values; if the official endpoints do not return a member score, it stays marked as unreported instead of inventing points.
- **Player progress Canvas** through `/search-player`. It shows the Roblox headshot/avatar, account username, separate Roblox display name, current battle points and hourly progress from snapshots collected after tracking starts. The chart is larger with a readable rounded scale, horizontal and vertical time guides, seven time labels and a peak label; the dark R3V0 banner art is cropped behind the translucent content panels. Search checks username, display name, known aliases, Roblox user ID, and a prefixed Discord nickname such as `R3V0 | Malb0`; if roster name resolution fails, it queries Roblox keyword search and maps the result back to the current R3V0 roster by immutable user ID. It never returns players outside R3V0.
- **RAP lookup** through `/rap` with live pet-name autocomplete, Huge/Titanic/Gargantuan prioritisation, and Normal, Golden, Rainbow, Shiny and combined variants.
- **Guess Pet**: identify the pet shown in the in-card image by typing the exact name in the channel. The current answer pool contains Huge pets. Word initials are shown immediately and one more letter is revealed every 8 seconds. Wrong attempts are marked with ❌; the first correct answer closes the same public message immediately and shows the winner and answer. Player wins and most-identified Huge pets are saved in SQLite and shown by `/guess-pet-top`.
- **Moderation**: `/ban`, `/mute` (Discord timeout up to 28 days), `/clan-warning`, and `/moderation-case`. Each action receives a case ID, DM attempt and moderation log.
- **Recruitment panel** in `1564416280864227359`: a purple Components V2 card with an inline button for **Pet Simulator 99** and an inline button for **Classic Pet Simulator X**. PS99 requires Rank 15+, 15+ Huge pets, activity around 6–12 hours daily, and most Game Passes; Classic PSX requires all Game Passes. No generic support or reward-claim options are shown. Tickets are created under `1564420505132605490`, allow screenshots/attachments, support claiming/closing, and export a TXT transcript before deleting the ticket channel.
- **AutoMod**: blocks disallowed links (Discord invite links are always denied), configured prohibited slurs/sexualization terms, and GIF file attachments for members without the Officer role. The Owner role bypasses AutoMod; Officer only bypasses the GIF-file restriction. Allowed link domains are in `LINK_ALLOWLIST`.
- **Community auto-role** for new and existing members, persistent retry queue, and `R3V0 | ` nickname prefix for members with the R3V0 clan role.
- **Welcome Canvas** at `1564412964608672070`, using `assets/background.png` as a soft, dark background with a readable overlay. Replace that image to customize the background; keep the same filename and PNG format.
- **Logging** for deleted/edited messages and GIFs, tickets, moderation actions, member joins/leaves, role/channel/server changes and slash commands.
- **Gem contribution logging** to `1564416615725015094`, using individual diamond contribution rows only if the R3V0-specific clan payload contains them, plus an authenticated webhook and `/log-gem-deposit` fallback.
- **Health endpoint** at `/health` for Railway.

## Guess Pet gameplay

`/guess-pet` displays a Huge pet image and asks players to type its exact name directly into the same channel. The hidden target is drawn only from unique Huge/Titanic/Gargantuan entries in the public Pets collection; regular pets are never targets. The compact live card shows a clean word-shaped clue; one additional letter appears every 8 seconds from left to right. Each Discord user gets one recognized guess per round. Names can be entered directly or with `guess: Huge Name` for an explicit attempt. Wrong attempts get a ❌ reaction and do not reveal the target. The first correct answer closes the public round immediately and edits the same message with the winner and correct pet name. If no one wins, the round closes after 60 seconds and reveals the answer. Player scores and per-pet counts persist in SQLite; use `/guess-pet-top` to view both all-time rankings.

## Data accuracy notes

The bot queries only `R3V0`. Battle points are the contribution values reported by the Big Games API; they are not fabricated global rankings. The player chart is based on snapshots collected after deployment, so the first day shows a `PROGRESS SINCE TRACKING` value rather than pretending a complete 24-hour history exists.

The `/api/clan/{clanName}` endpoint includes the current roster and, in live payloads, may store scores in `Battles[activeBattleId].PointContributions` with a clan total in `Battles[activeBattleId].Points`; older responses may use `Contribution.Battle`. The bot matches the exact active battle ID first and does not reuse an entry from a previous battle. Only if a direct current-battle contribution table is absent does the bot enrich missing scores from active battle details, then the current-battle player aggregate, then the individual `/v1/clans/players/{userId}` lookup when the API samples leave a reasonable fallback path. Each fallback is checked against the current active battle and the exact R3V0 roster by immutable Roblox User ID; any record explicitly naming another clan is rejected. The bot never adds another clan to its roster or leaderboard, and never invents scores. The documented per-clan payload does not guarantee individual diamond-deposit events, so use `/log-gem-deposit` or `POST /webhooks/gem-deposit` for verified donation records.

Official source references:
- https://github.com/BIG-Games-LLC/ps99-public-api-docs
- https://github.com/BIG-Games-LLC/ps99-public-api-docs/blob/master/legacy/README.md
- https://github.com/BIG-Games-LLC/ps99-public-api-docs/blob/master/v1/clans.md

## Commands

| Command | Purpose |
|---|---|
| `/search-player nickname` | Create a player progress Canvas by Roblox username, display name, alias, Roblox user ID, or nickname prefix for a current R3V0 member. Autocomplete lists the current roster and can warm the API cache on first use. |
| `/check-r3v0` | Fetch the current roster and points and refresh the one persistent Components V2 card panel |
| `/farm-points` | Show the purple Fantasy Clan Battle achievements, index rarity and Huge points table |
| `/rap pet variant` | Start typing to autocomplete pet names (Huge pets are prioritised when the field is empty), then choose a variant and look up RAP |
| `/guess-pet` | Type the Huge pet name in chat; a 5-second in-card countdown preloads the image as a Discord attachment; a letter hint appears every 8 seconds and the first correct answer closes the round |
| `/guess-pet-top` | Show the all-time player and Huge-pet leaderboards |
| `/pet-scramble` | Unscramble a PS99 pet name; type the answer in chat |
| `/emoji-pet` | Guess a PS99 pet from an emoji clue |
| `/higher-lower` | Choose which pet has the higher RAP value |
| `/arcade-top` | Show wins across the three extra games |
| `/r3v0-status` | Check API, roster and panel monitor status |
| `/ban target reason` | Ban and issue a case ID/DM/log |
| `/mute target duration reason` | Apply timeout, e.g. `30m`, `6h`, `3d`, max 28 days |
| `/clan-warning target reason roblox-name` | Send a formal clan activity warning by DM |
| `/moderation-case case-id` | View a saved moderation case |
| `/rules` | Publish/update the single rules message |
| `/ticket-panel` | Publish/update the recruitment panel |
| `/ticket-panel-edit current-slots capacity` | Update PS99 recruitment availability |
| `/ticket-close reason` | Close a ticket and archive its transcript |
| `/log-gem-deposit roblox-user-id amount note` | Manually record a verified R3V0 member contribution |

The recruitment panel is published or updated automatically at startup. It uses Discord Components V2, placing each apply button beside its game requirements inside one purple-accented card. `/rules` is also published/updated at startup. The Clan Battle monitor refreshes on the `PS99_REFRESH_MINUTES` interval and updates the same Components V2 card after replacing the old embed once. Refresh, Previous and Next are native buttons in one in-card action row. The full-width banner is attached only when creating/migrating the panel; later edits retain that attachment and do not re-upload it. Membership always comes from the single R3V0 clan endpoint. When that response omits current battle contributions, the monitor checks the active-battle details, then the current-battle player aggregate, then direct lookups for unresolved R3V0 member IDs. Every score is matched to the current R3V0 roster by Roblox User ID and the current battle ID; records attributed to another clan are rejected. The bot never shows another clan's members. Rank is shown only when the battle endpoint returns R3V0 in its current response; otherwise it remains unreported.

## Giveaway system (1.9.0)

The bot includes persistent Discord giveaways. Discord slash-command names must be lowercase, so use `/create-giveaway` (not `/CreateGiveaway`). The command opens Discord's native slash-command form; fill in the prize and duration, then optionally set the destination channel, winner count, required role, minimum server message count, minimum Discord account age, minimum server membership age, bonus role/bonus tickets, a description, and an image URL or uploaded image attachment. Image URLs must use HTTPS; image attachments are checked for an image type and a 10 MB limit.

Giveaway commands:

- `/create-giveaway` — create and publish the giveaway. Example: `prize: Huge pet`, `duration: 2d`, `winners: 2`, `required-role: Member`, `min-messages: 25`, `min-account-days: 7`, `min-server-days: 2`, `bonus-role: Booster`, `bonus-entries: 2`, plus an optional image/link.
- `/end-giveaway giveaway-id` — staff can end a live giveaway early and draw winners.
- `/reroll-giveaway giveaway-id` — staff can select an additional winner from the remaining eligible entrants. Use the internal ID shown when the giveaway is created; the message ID also works.

Giveaways and entries are stored in SQLite, survive restarts, and finish automatically after their end time. The entry button toggles participation; each user can enter only once. Additional role entries increase the user's draw weight rather than creating duplicate participant rows, and winners are unique. Requirements are checked on entry and again at draw time; users who left the server or no longer meet requirements are excluded. Winner announcements only mention the selected users.

**Message-count note:** Discord does not provide historical message totals for a bot to query. The `min-messages` requirement counts human messages observed by this bot after version 1.9.0 starts recording them. It does not retroactively count old messages. Message counts persist in the SQLite database. Bot/webhook/system messages are ignored. Keep the `DATA_DIR` persistent (Railway Volume) so giveaway entries and counts survive redeploys.

## Player search and point data

Roblox username lookup (`/v1/usernames/users`) only accepts usernames, not display names. To support entries such as username `B3sttiee` / display name `Malb0`, the bot first searches the R3V0 roster aliases by user ID, then tries Roblox username lookup and Roblox keyword search (`/v1/users/search`) and matches returned candidates back to current R3V0 member IDs. Autocomplete uses the live roster; it starts a shared, short-deadline roster fetch if the monitor cache is not ready yet.

The exact `/api/clan/R3V0` endpoint is the sole authority for membership and the primary source for points. Current live battle data is read from `Battles[activeBattleId].PointContributions` and the matching snapshot’s `Points` total; legacy `Contribution.Battle` is supported as a backwards-compatible format. If no direct table for the active battle is available, the bot checks the active battle detail endpoint, then the sampled current-battle player aggregate and finally `/v1/clans/players/{userId}` for unresolved current R3V0 members. All fallback data is applied only to the exact R3V0 roster after matching Roblox User ID and verifying the active event ID; results explicitly attributed to another clan are rejected. The panel only displays R3V0 members. Individual scores not returned for a particular R3V0 member remain `Not reported` instead of being fabricated. The active event name is fetched separately from `/api/activeClanBattle`. See the official [Big Games legacy clan API docs](https://github.com/BIG-Games-LLC/ps99-public-api-docs/blob/master/legacy/README.md#-get-clan) and [current battle/player API docs](https://github.com/BIG-Games-LLC/ps99-public-api-docs/blob/master/v1/clans.md).

**API coverage limitation:** Big Games documents `/v1/clans/battles/{battleId}` as a sampled battle leaderboard capped at the top 100 clans/top 200 individual contributors, and `/v1/clans/players` as an aggregate sampled from the top 25 clans. A direct `/v1/clans/players/{userId}` lookup can also return 404 when that user is outside the sample. These sources can recover a member's score when the API includes that member, but they cannot guarantee complete scores for all R3V0 members if Big Games omits them from both the clan contribution table and its current public samples. When both full samples exclude every current R3V0 member, the bot skips the redundant per-player requests (the endpoint uses the same player sample), records that reason in `/r3v0-status`, and reports missing values honestly rather than borrowing points from other clans.

## Previous release: Version 1.10.0 — Dashboard and Guess Pet redesign

- Rebuilt Clan Battle text layout with a clean ranking and no ornamental divider lines or stars after every score.
- Reworked `/guess-pet`: the first correct answer closes the same public message immediately, reveals the winner and Huge name, and disables all answer buttons.
- Added persistent player and Huge-pet leaderboards, shown in rounds and available through `/guess-pet-top`.
- Reworked the player-progress Canvas with muted colors, simple borders, no neon glow, and no grid texture behind the data.

## Local checks

Requires Node.js `22.13+`. The Docker build also runs integration tests that serialize the real Discord Components V2 builders and build/serialize the real Discord.js Clan Battle Components V2 card. Only welcome and player-progress views use Canvas.

```bash
npm install
npm run check
npm test
npm run preview
npm start
```

`npm run preview` writes sample welcome and player-progress Canvas images into `preview/`. The Clan Battle panel is a Discord Components V2 card (no Canvas image) and is covered by `test/clan-embed.integration.test.js`.

## Discord application configuration

For quick copy/paste into Railway **Variables → RAW Editor**, use [`RAILWAY-VARIABLES-RAW.txt`](RAILWAY-VARIABLES-RAW.txt). Replace `PASTE_BOT_TOKEN_HERE`, `PASTE_APPLICATION_ID_HERE`, and `PASTE_DISCORD_SERVER_ID_HERE` with real values.


Enable these privileged intents in the Discord Developer Portal:
- **Server Members Intent**
- **Message Content Intent**

Give the bot access to the configured channels and the permissions it needs: View Channels, Send Messages, Read Message History, Embed Links, Attach Files, Manage Messages, Manage Roles, Manage Nicknames, Manage Channels, Ban Members, Moderate Members, and View Audit Log. Place the bot role above roles it must assign and members it must moderate. Do not grant Administrator unless you deliberately prefer that trade-off.

## Security

- Do not commit `.env`; use `.env.example` only as a template.
- Keep `GEMS_WEBHOOK_SECRET` private. The webhook accepts only numeric Roblox user IDs present in the current R3V0 roster and checks the authorization token using a timing-safe comparison.
- SQLite lives in `DATA_DIR`. On Railway, mount a persistent volume at `/app/data`. The Docker entrypoint repairs ownership and write permissions on the runtime-mounted volume before switching to the unprivileged `bot` user; the database path is logged at startup for easier diagnosis.
- No API keys or real bot tokens are included in this project.


### Recruitment panel

The recruitment panel uses Discord Components V2 so the apply buttons appear beside each game section inside a single purple-accented card. It offers **PS99** (Rank 15+, 15+ Huge pets, active 6–12 hours daily, most Game Passes) and **Classic Pet Simulator X** (all Game Passes). It does not offer generic support or reward-claim buttons.

### Clan Battle rendering
The Clan Battle dashboard uses a restrained purple Discord Components V2 container with Refresh, Previous and Next controls inside the card. Text is compact and free of decorative divider glyphs. Canvas is reserved for individual player progress and the welcome card. The test at `test/clan-canvas.integration.test.js` is retained for compatibility with existing deployments and validates the Components V2 layout; it must not import `renderClanBattleCanvas`.


## Roblox avatar and founder identity fix (1.6.1)

The Roblox thumbnails API response is unwrapped by the API helper into an array. `getRobloxAvatarUrl` now reads that array correctly and validates that the thumbnail is completed and points to HTTPS. The configured founder (`B3STTIEE` / display name `Malb0`) is resolved independently of Big Games `Owner`; if the API owner ID is stale or missing, the resolved/configured founder identity is used for the R3V0 roster and matching contribution rows. `/r3v0-status` reports API owner ID, configured founder ID, resolved owner, and whether the owner is present in the roster. Optionally set `CLAN_OWNER_ROBLOX_ID` for a permanent numeric owner ID to avoid username-lookup dependency.

### Source endpoints

- Clan roster and individual battle contributions: `GET https://ps99.biggamesapi.io/api/clan/R3V0` (official Big Games legacy per-clan endpoint).
- Battle metadata: `GET https://ps99.biggamesapi.io/api/activeClanBattle`.
- Founder reconciliation: Roblox `POST https://users.roblox.com/v1/usernames/users`; roster identity resolution: Roblox `POST https://users.roblox.com/v1/users`.
- Player headshot: Roblox `GET https://thumbnails.roblox.com/v1/users/avatar-headshot`. The API envelope is unwrapped by `fetchJson`, so the helper reads the returned array directly; a pending thumbnail is retried once.

The bot filters BIG Games battle endpoints strictly to R3V0 roster IDs, rejects rows explicitly belonging to another clan, and validates the battle ID to avoid mixing events. Run `/r3v0-status` to see direct contribution rows, per-clan battle-detail matches, player aggregate matches, and any mismatch errors.


## Version 1.9.0 — persistent giveaways

- Added `/create-giveaway` native slash form with prize, description, duration, winner count, target channel, required role, message threshold, account/server age thresholds, bonus role/tickets, and uploaded image or HTTPS image URL.
- Added join/leave button, persistent participants, weighted bonus entries, automatic expiry, eligibility re-check at draw time, `/end-giveaway`, and `/reroll-giveaway`.
- Added persisted human message counts. The threshold counts messages observed after 1.9.0 is deployed; historical messages cannot be reconstructed from Discord.
- Added 4 direct giveaway utility tests and automated feature guards.

## Version 1.8.1 — live battle contribution parser fix

- Fixed the exact live API shape shown by R3V0: `Battles.FantasyBattle2026.PointContributions` rather than `Contribution.Battle`.
- Reads the battle total from `Battles[activeBattleId].Points` and accepts point rows only from the exact active battle.
- Regression-tested the supplied payload: 251,800 total points, 12/12 current roster entries with known values (owner's 81,075 points included), and no player-aggregate fallback when direct data is complete.
- Historical `Battles` entries can never be used if the active battle ID is absent.

## Version 1.8.0 — Clan Battle Components V2 and Guess Pet

- Clan Battle remains a Discord Components V2 card (not a Canvas image).
- The event header, compact battle summary, and member contributions use readable sections without decorative divider strings or repetitive score stars.
- Current rank and battle totals are shown in their own fields; unavailable rank is described as `Not listed in current battle standings`.
- Both compatibility integration tests serialize the Components V2 container and verify its in-card controls.
- `/guess-huge` now asks for the pet's actual name from Huge-only choices, showing the pet image and allowing one guess per player per round.
- Fixed the join handler to pass the imported `renderWelcomeCanvas` function, preventing the `renderWelcome is not defined` crash.
- Improved HTTP API error messages and skipped repetitive individual-player lookups only when both complete public samples exclude R3V0; missing battle points remain unreported, never fabricated.

## R3V0 Arcade

Image-based rounds use a 5-second countdown in the same embed. During the countdown, the bot preloads pet images and uploads successful image downloads as Discord attachments, then opens the round and starts the timer. This reduces reliance on the external PS99 image host and gives everyone the same visible start signal. If the source cannot be downloaded, the bot gracefully falls back to the source image URL.

- `/pet-scramble`: rarity stays visible, while letters are shuffled separately inside each word. The letter multiset and word boundaries are preserved; the hinted name is not scattered between words.
- `/emoji-pet`: decode curated, explicit emoji clues matched to complete name words or phrases. Unrelated substrings do not match; for example, a snowflake clue requires the word “snowflake”, and moon clues do not get assigned to leprechaun pets. Extra clue text unlocks every 12 seconds. The target pet image is hidden during the round and revealed when the round closes. Pets without a supported clue are not selected.
- `/higher-lower`: vote for the pet with higher normal RAP; values are revealed when someone wins or the 45-second timer ends. Every player gets one vote.
- `/arcade-top`: view persistent wins by player and game type.

Only one public round can run at a time per channel across Guess Pet and the other arcade modes. Pet names and RAP choices come from the public PS99 collection/RAP data. Emoji Pet only uses names that can be represented by known emoji clues; it never silently substitutes unrelated answers.

## Version 1.14.0 — Accurate Arcade clues and Scramble layout

- Keeps the synchronized five-second image-preload countdown for all image-based arcade rounds. Images are attached to Discord when possible and remain hidden until the game ends.
- Pet Scramble keeps `Huge`, `Titanic`, or `Gargantuan` visible as a separate rarity clue and shuffles only the words after it. Letters are shuffled within each word, never between words; the progressive hint targets the pet name only.
- Emoji Pet now uses a curated semantic clue dictionary matched by complete words and phrases rather than substring matching. A specific phrase such as `Hell Rock` takes precedence over a generic word such as `Rock`; unrelated terms such as `Snowflake`, `Vampire`, `Moon`, and `Leprechaun` cannot cross-trigger.
- Emoji Pet reveals a new explanatory hint every 12 seconds. Names without a supported clue are not selected, and the answer image remains hidden until a correct answer or timeout.
- Added regression tests for word boundaries in anagrams, readable rarity, clue specificity, unsupported-name behavior, and misleading substrings such as `Caterpillar` matching `cat`.


## Version 1.15.1 — Player Canvas contrast redesign

The `/search-player` image has been redesigned to feel richer and easier to read: a stronger identity header, vivid but non-neon purple/blue/mint/amber accents, clearer metric cards, more legible chart guides, and a peak-value label. Only `renderPlayerCanvas()` uses the new player palette; `renderWelcomeCanvas()` retains its existing style. Exact point values and the `Not reported` state are preserved.


## Official PS99 server emojis (1.16.4)

The bot installs only real Pet Simulator 99 artwork from official BIG Games sources. No generated/local AI emoji PNGs are shipped or uploaded.

- Pet artwork tries the `BIG-Games-LLC/ps99-public-api-docs` GitHub `Pet Icons` directory when available.
- Supported in-game types resolve through the official BIG Games collections API and `/image/{assetId}` endpoint: Pets, Eggs, Currency, Lootboxes, GuildBattles, Ranks, Merchants, Charms, Enchants, Hoverboards, Ultimates, Booths, Potions and Fruits.
- Generic UI concepts such as refresh, time, members, success/error and medals use normal Unicode instead of invented custom artwork.
- If an official asset cannot be loaded or the server has no emoji slot, the bot keeps working with the Unicode fallback. It never substitutes generated graphics.
- `/setup-emojis` retries installation of missing official PS99 emojis.
- `/emoji-status` reports each created/existing/failed emoji and the BIG Games source/asset ID used.

The bot needs Discord **Manage Expressions** permission to create server emojis. Public BIG Games collections do not require a Roblox password, cookie or account token.

## 1.16.4 legacy emoji cleanup

`npm run check` now runs `scripts/cleanup-legacy-emojis.js` first. This removes stale image files left in `assets/emojis/` by older 1.16.0 deployments before the official-asset guard runs. The bot does not use these files; server emoji artwork is resolved only from official BIG Games / PS99 sources at runtime.


## Official BIG Games emoji pack (1.16.4)

The bot ships **no generated/local emoji PNG files**. At startup and through `/setup-emojis`, it discovers the live collection list from `https://ps99.biggamesapi.io/api/collections`, resolves image-backed records from official BIG Games collections, downloads their real Roblox artwork through `/image/{assetId}`, normalizes it for Discord, uploads it, and verifies it by fetching the created emoji back from Discord. Pet/Huge/Titanic portraits first attempt the official BIG Games `Pet Icons` folder on GitHub, then fall back to the official PS99 API.

The target pack contains 30 official PS99-themed emoji slots. `/emoji-status` shows the live guild count, present/missing entries, discovered BIG Games collections, exact artwork sources, asset IDs, Discord emoji IDs, and per-item failures. Generic UI actions such as refresh/clock/checkmark remain Unicode rather than fake artwork.
