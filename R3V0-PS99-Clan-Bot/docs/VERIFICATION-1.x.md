# Version 1.18.2 — build verification

Verified with Node v22.23.4, npm 10.9.9 and NODE_ENV=production after a fresh `npm ci --omit=dev` installation.

| Scenario | check | tests | preview |
| --- | --- | --- | --- |
| Clean install | pass | 87/87 | pass |
| Upload over 1.18.0, retaining its old renderer | pass | 87/87 | pass |
| Upload over 1.17.0, replacing its legacy test | pass | 87/87 | pass |

The original 1.18.1 upload was reproduced failing on the unused renderer presence check and the stale one-card integration assertion. The fix retains active native-panel guards and all tests. No renderer is included in a fresh archive, and `src/monitor.js` remains byte-identical to the native 1.18.1 release.

The three Docker RUN validation commands were executed with the Dockerfile's Node major and production dependencies. A Docker daemon and a signed-in Discord bot were not available, so no actual image build or deployment is claimed.

Earlier release records follow.

# Version 1.18.1 — native Clan Battle

- 85/85 tests pass. Source guards and offline preview generation pass.
- Browser checks confirm native score text, original-only image paths, pagination, Details and no horizontal overflow at 390 px.

- All scores and visible player names are native Text Display components, not a generated scoreboard.
- The only battle image files are the unchanged original banner/logo; no battle-canvas.js or generated battle PNGs are shipped.
- V2 migration preserves message identity and replaces the old generated attachment once.
- Later text refreshes keep the original attachments. Failed migration does not advance settings.
- Pagination, unavailable scores, zero scores, unique button IDs and exact text values are covered by integration tests.
- Browser preview uses real builder JSON and sample data. A real Discord session was not used.

Earlier release records follow.

# Version 1.18.0 — Clan Battle dashboard

- 85 tests pass with bounded file concurrency (`--test-concurrency=2`).
- Source syntax and the updated dashboard regression guards pass.
- Real Canvas output is generated for normal, empty, partial, long-name and large-score data.
- Pagination covers the whole roster once per page; text Details uses the same ordering and exact scores.
- Unknown scores are excluded from percentages, zero scores remain visible, and missing official totals/rank stay unreported.
- Navigation button custom IDs remain unique even on a one-page or empty board.
- Existing V2 message identity survives migration. Each score-image update clears old uploads, and failed edits leave saved settings unchanged.
- Offline browser checks cover Next/Back, private-view preview dialog, loaded PNGs and no horizontal overflow at 390 px.
- All visual review screenshots are internal QA files. Deliverable previews are the actual Canvas PNGs and offline HTML.
- No real Discord session or Docker daemon was used.

Earlier release records follow.

# Version 1.17.0 — verified locally

- `npm run check`: syntax and all feature guards pass.
- `npm test`: 81 tests pass, zero failures.
- `npm run preview`: generates both Canvas images and the offline preview from real Discord.js builder JSON, using a disposable database.
- Browser inspection: 6 public panels, all images loaded, no JavaScript errors; no horizontal overflow at 1800 px or 390 px.
- Original supplied PNG files are copied without transformations; byte hashes are checked before packaging.
- Attachment regression coverage checks persistent V2 message identity, one-time artwork replacement, later attachment reuse, missing API icon handling and custom giveaway prize images.
- Long display names and missing point/history data were rendered and inspected. No production Discord session was used.
- Docker installation uses the shipped lockfile through `npm ci`.

Earlier release records follow.

# Version 1.14.0 changes and checks

- Guess Huge shows a 5-to-1 countdown in the same embed. The bot downloads the image during that countdown, then uploads it as a Discord attachment when valid image bytes are available; the 60-second answer timer starts only after the image is ready.
- Pet Scramble and Emoji Pet use the same visible start countdown and prepare the reveal image; their answer images remain hidden until the round closes. Higher or Lower prepares both pet images before its A/B voting controls appear.
- Image loading permits HTTPS only, validates content types (including binary responses by image-signature sniffing), caps downloads at 7.5 MB and aborts after 7 seconds. If the source image cannot be downloaded, the game falls back to the original HTTPS URL.
- Guess Huge retains the uploaded image attachment through hint edits and the round-end edit. Higher or Lower retains both images through voting and results.
- `node scripts/check.js` passes for all JavaScript files and feature regression guards. `node --test test/arcade-media.test.js` passes 7/7 tests. Full project tests and actual Discord upload/visibility still need confirmation in a runtime with dependencies installed and a real Discord channel.

# Version 1.12.0 changes and checks

- Guess Huge active card no longer renders the two side-by-side leaderboards that caused extreme wrapping; the top lists remain available in `/guess-huge-top`. The hint is compact (`H___   H___   R___`) and reveals letters sequentially from left to right.
- Added `/pet-scramble`, `/emoji-pet`, `/higher-lower` and `/arcade-top`. New text rounds use public pet-collection names; Higher or Lower draws distinct normal pet RAP records and hides values until completion.
- Added a shared per-channel game lock across Guess Huge and all extra arcade modes, plus SQLite arcade-win statistics.
- Added pure unit tests for answer normalization, scramble, emoji clue generation, RAP pair selection and per-channel locks.
- `npm run check` passed after this release. Pure arcade and Guess Huge tests passed 9/9. The SQLite stats test requires `dotenv`, which is not installed in this workspace; full Discord.js integration still must be confirmed in the Railway Docker build.

# Version 1.11.1 changes and checks

- Clan Battle is a wider Components V2 card with the muted R3V0 banner as a full-width media gallery, the clan icon in its heading, and Refresh/Previous/Next in a single in-card row. The banner file is reused on edits.
- Player search and welcome Canvas draw a dark R3V0 scene with cover-cropping under translucent panels. The player chart is 700px high and includes a rounded value scale, horizontal/vertical guides, seven time labels and a peak-value label.
- Guess Huge uses typed channel messages instead of answer-choice buttons. Word initials are shown at round start; one extra letter is revealed every 8 seconds. Wrong entries get a ❌ reaction; the first correct answer closes the same public message.
- `npm run check` passed after these changes. `node --test test/guess-huge-game.test.js` passed 4/4 pure input/hint tests. A broader dependency-light subset passed 16/16.
- Full Discord.js/Canvas integration and image serialization still need a runtime run with installed dependencies; this workspace does not have `discord.js`/`dotenv` installed. Run `npm test && npm run preview` in the Railway Docker build and confirm logs.

# Verification notes

- Version 1.9.0 `npm run check` passed: all JavaScript source/test files parse and automated feature guards pass.
- Giveaway-focused unit and SQLite tests passed: `node --test test/giveaway-utils.test.js test/giveaway-db.test.js` (6/6). These cover duration validation, weighted distinct winners, eligibility explanations, giveaway/entry schema and persistent message counter increments.
- Full local `npm test` could not fully pass because the workspace does not have `discord.js` installed. `npm install --no-audit --no-fund` timed out in this environment. The five integration test files that import `discord.js` therefore could not load; unrelated dependency-light tests passed. The Dockerfile installs project dependencies and runs `npm run check`, `npm test`, and `npm run preview`, so confirm the full integration result in Railway build logs.
- A real Discord connection, guild permission checks, live message delivery and actual image embedding have not been tested from this workspace.
- `node:sqlite` may print an ExperimentalWarning on Node 22; the warning itself is not a failure.

## Giveaway feature checks (1.9.0)

- `/create-giveaway` registers as a lowercase Discord slash command and exposes fields for prize, duration, winner count, channel, required role, minimum observed messages, minimum Discord account age, minimum server membership age, bonus role/tickets, description, HTTPS image link, or uploaded image attachment.
- Giveaway records, entries and observed message counts are stored in SQLite. A unique `(giveaway_id, user_id)` key prevents duplicate participant records; entries persist through restarts when `DATA_DIR` is persistent.
- Button eligibility is checked at entry and checked again before the draw. A bonus role adds weighted chances, but a user can only win once in a drawing. Scheduled expiry survives restarts; staff can end early and reroll additional winners.
- `min-messages` uses messages observed after release 1.9.0 starts recording them. Discord does not expose a complete server-wide historical message count that this bot can safely backfill, so no historical totals are fabricated.

## Live data caveats

- The `/api/clan/R3V0` endpoint is the sole authority for the roster and direct points. The parser reads `Battles[activeBattleId].PointContributions` and the corresponding `Battles[activeBattleId].Points` total first, then supports legacy `Contribution.Battle`. Only if the active-battle table is missing does fallback order use current battle details, current-battle aggregate, then per-member `/v1/clans/players/{userId}`. Every fallback is checked against the active event ID and current R3V0 roster Roblox IDs; rows explicitly tagged with another clan are rejected. Only R3V0 scores are written to snapshots or displayed.
- Automatic gem-deposit entries are generated only when the R3V0-specific clan payload itself supplies individual diamond contribution rows. The documented API does not guarantee such rows; otherwise use `/log-gem-deposit` or the authenticated `POST /webhooks/gem-deposit` endpoint from a trusted verified source. No donor or amount is fabricated.


## Railway SQLite volume fix

- The runtime entrypoint runs before Node.js and creates the configured `/app/data` directory.
- It repairs the owner and owner read/write permissions on the mounted volume and existing SQLite/WAL files.
- It drops privileges to `bot:bot` via `gosu` before running `npm start`.
- `src/db.js` logs the resolved database path and prints an actionable error if the directory cannot be accessed.
- Keep the Railway Volume mounted at `/app/data` and keep `DATA_DIR=/app/data`; do not delete the volume to resolve permissions.

- Confirm `/rap` pet option shows autocomplete suggestions from the public RAP dataset (up to 25 choices) and includes Huge/Titanic/Gargantuan pets when those entries exist.
- Confirm `/rap` supports Normal, Golden, Rainbow, Shiny, Golden Shiny and Rainbow Shiny.
- Confirm the live clan battle panel is a restrained Components V2 card with a wide banner-first card with the clan logo, current stats and pagination, without decorative divider text; no Clan Battle Canvas is used.
- Confirm the recruitment panel is one purple Components V2 card with exactly two section-accessory buttons: Pet Simulator 99 and Classic Pet Simulator X. Generic Support and Reward Claim options must not appear. Test both ticket types and confirm each is created in the configured category.

- Confirm Clan Battle is one purple Components V2 container; verify event/rank/total/leader/updated stats, member rows, and functional Refresh/Previous/Next buttons inside the card, with a full-width media gallery and clan thumbnail accessory. The legacy embed should be replaced once during migration; later refreshes edit the same V2 message. Verify no Clan Battle Canvas preview is generated.
- Runtime test `test/ticket-panel-components.integration.test.js` serializes real discord.js V2 builders and checks the two embedded button accessories.
- Runtime test `test/clan-embed.integration.test.js` serializes a real discord.js Components V2 container and verifies live stats, a media gallery banner, clan logo thumbnail, in-card action row and banner attachment. Player-progress and welcome views continue using Canvas. Player-progress and welcome cards continue using Canvas.

- Confirm the separate Big Games `Owner` ID is included in the roster when not present in `Members`, and is not duplicated when present in both.
- The official rank is shown only if the active battle detail response itself includes R3V0. If it is missing from that response, the panel marks rank unavailable instead of guessing.

- Test that the Big Games `Owner` ID is included if absent from the `Members` array and that `B3STTIEE` appears as the leader fallback name.
- Test that current battle totals are the sum of known members from `/api/clan/R3V0` only, and rank is not guessed.

- Confirm the embed summary visibly says `Leader: B3STTIEE`, and the owner is also merged into the roster when the Big Games API places `Owner` outside `Members`.
- Confirm the active battle name comes from `/api/activeClanBattle`; individual scores, current-roster total and full member count come only from `/api/clan/R3V0`.
- Verify the kick line only shows a computed cooldown when `PS99_KICK_COOLDOWN_HOURS` is explicitly configured; otherwise it reports the last kick timestamp without guessing.

## Earlier build fix 1.6.1
- Replaced the obsolete `test/clan-canvas.integration.test.js` that expected `renderClanBattleCanvas`.
- Clan Battle uses a purple Components V2 card with in-card buttons; only player progress and welcome cards use Canvas.
- `scripts/check.js` now checks that the compatibility test does not require a removed Clan Battle Canvas renderer.


## Earlier 1.6.1 regression cases
- Search resolves both Roblox account username and separate display name (e.g. `B3sttiee` and `Malb0`) when the user is in the live R3V0 roster.
- Roblox ID/name records keep both `name` and `displayName` fields; the player Canvas renders the headshot and both labels.
- Historical pre-1.7.0 behaviour used only the per-clan `Contribution.Battle` table. Current versions enrich missing values from active-battle details and per-member lookups, but only for current R3V0 roster IDs and the exact active event.
- The member leaderboard prints full formatted values (e.g. `68,000`, not `68K`).
- `/farm-points` publishes the achievements, index rarity and Huge point table in a purple Discord Components V2 card.


## 1.6.1 Player search and point clarity
- Username/display-name search falls back to Roblox keyword search, then matches the candidate to the current R3V0 roster by Roblox user ID; never selects a non-roster player.
- Search normalizes Unicode zero-width characters and accepts Discord nicknames prefixed `R3V0 | `.
- Autocomplete can perform a shared first-load roster fetch if the monitor cache has not warmed yet.
- Player Canvas shows the Roblox avatar and exact current battle points, or `Not reported` when sources do not contain a point value.
- `/farm-points` lists all supplied achievements, index rarity bands and Huge point values.
- When the per-clan contribution table is missing, current versions try active battle details, the current player aggregate and direct player-by-ID lookups. Rows must match the active event and current R3V0 roster; no score is fabricated when the API omits it.


## 1.6.1 player search and farm-points improvements
- Added Roblox keyword search fallback for display-name queries and strict ID mapping back into the live R3V0 roster.
- Exact username search no longer silently accepts the first unrelated Roblox API result.
- Search normalization strips zero-width characters and accepts a `R3V0 | ` Discord nickname prefix.
- Autocomplete uses the most recent monitor snapshot or a single shared fallback load if the cache is still cold.
- Player Canvas includes the Roblox avatar, username, display name, exact current battle point value, and an explicit “Not reported” state for missing scores.
- `/farm-points` renders all user-supplied Fantasy Clan Battle scoring values in a purple embed.
- 27 dependency-light logic tests passed locally. `node scripts/check.js` passed. Full Discord.js/Canvas integration tests and image rendering still need confirmation in Railway because those packages were not available in this local session.


## 1.6.1 fixes

- `getRobloxAvatarUrl` reads `data[0].imageUrl` after the common API helper unwraps Roblox's `{ data: [...] }` envelope; it retries transient `Pending` thumbnails once.
- Founder resolution independently queries the configured Roblox username (or uses `CLAN_OWNER_ROBLOX_ID` if configured), reconciles a stale/missing Big Games `Owner` ID, and includes diagnostics in `/r3v0-status`.
- Added regression tests for avatar URL extraction, cache behavior, founder search by display name, owner roster inclusion, and points joining by Roblox user ID.
- Local checks: `node scripts/check.js` and `node --test test/ps99.test.js` passed. Full Discord/Canvas tests were not run because real `discord.js`/`@napi-rs/canvas` dependencies are not installed in this workspace.


## Version 1.7.0 — current battle point fallback

- Fixed the production case where `/api/clan/R3V0` returned its roster and owner but no `Contribution` object.
- Uses `/v1/clans/battles/{activeBattleConfigName}` for current battle total/rank/member contributions, then `/v1/clans/players` only when current R3V0 members still lack points.
- Maps point rows by immutable Roblox User ID to members from the exact `/api/clan/R3V0` roster; explicit non-R3V0 records are rejected and never shown.
- Refuses to apply aggregate points if `activeBattleConfigName` differs from the current event.
- `/r3v0-status` now exposes battle detail status, matched rows, sampled coverage and API errors for diagnosis.
- Added mocked integration tests for the production payload shape where `Contribution` is missing, including the reported 81,000-point founder and rejection of unrelated-clan points.


## Version 1.7.0 — individual player point fallback
- Adds individual `/v1/clans/players/{userId}` requests for unresolved current R3V0 members after battle details and aggregate. The returned `activeBattleId` must exactly match the active event and `player.Clan.Name` must be exactly R3V0.
- `/r3v0-status` now shows per-member lookup matches and bounded per-user errors.
- Added a regression test matching the production issue: the R3V0 clan payload has no `Contribution`, battle and aggregate samples omit the founder, and the individual player endpoint reports 81,000 points for B3STTIEE/Malb0.

## Current battle points API coverage
- The direct R3V0 clan endpoint remains the authoritative roster and preferred source for the exact active battle snapshot at `Battles[activeBattleId].PointContributions`, including the clan total from `Battles[activeBattleId].Points`. Legacy `Contribution.Battle` is still supported. If no contribution table for the current battle is present, the monitor checks active battle details, then current player aggregate, and then per-user endpoints for unresolved IDs in that exact roster.
- All fallback points must match a current R3V0 Roblox user ID, the current battle ID and an explicit `Clan.Name === R3V0` on current-player lookup. Records explicitly attributed to another clan are rejected.
- Big Games documents its battle/player aggregates as sampled, so complete 12/12 coverage cannot be promised when the public API excludes a member. In that case keep `Not reported`, do not invent a score.
- The new integration test confirms a missing direct `Contribution` table can still recover the founder's 81,000 current-battle points when the per-user API reports `activeBattleId=FantasyBattle2026` and `Clan.Name=R3V0`.


## Version 1.8.0 validation notes

- Redesigned the Clan Battle panel as a purple Components V2 container with a separate event header, compact status text, clean member contributions without ornamental divider strings, and in-card Previous/Next/Refresh buttons. No Clan Battle Canvas image is attached.
- Updated both Clan Battle compatibility tests to assert the V2 container, its button accessories, and the live stats.
- Build result must still be confirmed by `npm run check && npm test && npm run preview` in Railway's Docker build.


## Version 1.8.1 live battle parser regression

- Added a fixture mirroring the live `/api/clan/R3V0` response where `Battles.FantasyBattle2026.PointContributions` contains nine member records and `Points` is `251800`.
- Regression test confirms the owner is included, all 12 roster members get known values (missing entries in the current contribution array are zero), the full total is `251800`, and previous battle data is never substituted for the current battle.


## Version 1.10.0 redesign verification

- `node scripts/check.js`: passed syntax checks and source-level feature regression guards.
- Focused logic tests for battle ranking, giveaway utilities, and persistent Guess Huge stats: 10/10 passed. The Guess Huge stats test used a temporary no-op `dotenv/config` stub because external packages could not be installed in this workspace; the stub was removed after the test.
- Full Discord.js / Canvas integration tests and the full `npm test` suite were not run successfully in this workspace because `npm install --no-audit --no-fund` timed out. Confirm them in the Railway Docker build after deployment.
- Clan Battle card uses a concise Components V2 layout with no ornamental divider strings or repetitive score stars.
- `/guess-huge` disables all answers and updates the same public message as soon as the first correct answer arrives; if the interaction update fails, the bot also tries to edit the original message directly.
- `/guess-huge-top` displays persistent all-time user wins and per-Huge correct-answer counts.
- Player progress Canvas uses a restrained palette without background grids or chart glow.
- Added tests for persisted Guess Huge wins and identified Huge pets.


## 1.11.1 CI regression fix

The previous CI run passed syntax checks and 58 of 59 tests. The only failing test was stale: it expected `.addActionRowComponents(pagination)` and `attachments: []`, while the current wide Components V2 panel correctly uses `.addActionRowComponents(controls)` and attaches `r3v0-banner.jpg` on creation, retaining that attachment on subsequent edits. Updated `test/battle-layout.test.js` to verify the active implementation (banner gallery, in-card controls, initial attachment and retained attachment) rather than the old layout.


## Arcade clue accuracy follow-up (1.14.0)

- `Pet Scramble`: rarity is displayed as its own field; name letters are shuffled within each word, not between words. Progressive letter hints target only the post-rarity name.
- `Emoji Pet`: replaced substring matching with a small explicit clue dictionary. The clue resolver matches complete tokens/phrases and prefers specific phrases over overlapping generic words. It returns no puzzle for names with no curated clue rather than inventing one.
- Extra explanatory hints unlock one at a time every 12 seconds. The pet image remains hidden until a correct answer or timeout.
- Regression tests cover exact clue separation for `Vampire Bat`, `Snowflake`, `Leprechaun`, and `Moon`, and ensure `Caterpillar` does not accidentally match `cat`.


## Version 1.15.0 — Guess Pet single-image fix

- Public command names: `/guess-pet` and `/guess-pet-top`.
- Guess Pet uses Components V2 with one Media Gallery image reference; it does not mix an attachment preview with a legacy embed image.
- Countdown states intentionally omit the image; after preload the image is referenced once inside the active card and retained on edits.
- Regression test verifies one Media Gallery item, absence of `embeds`, and that countdown state has no image.
- Verify on Railway after deployment: `/guess-pet`; the card should contain exactly one pet image.

## Version 1.15.1 — Player Canvas contrast redesign

- `src/canvas.js` keeps the welcome Canvas on the original shared palette and introduces `PLAYER_PALETTE` plus `drawPlayerBackground()` for `/search-player` only.
- `renderPlayerCanvas()` has a higher-contrast identity header, stronger metric cards, clearer chart guides, and a compact peak callout.
- `scripts/check.js` validates the new dedicated palette while preserving guards for exact points and the display name.
- Syntax/static checks must be run in the deployment environment. Full Canvas preview generation requires project dependencies to be installed.





## 1.16.3 official PS99 emoji correction

- `assets/emojis/` contains no PNG files; generated/local custom emoji artwork is intentionally absent.
- `src/server-emojis.js` resolves custom server emojis only from BIG Games public PS99 data and the BIG Games GitHub pet-icon attempt.
- Official API source paths are `/api/collection/{collectionName}` and `/image/{assetId}`.
- Generic UI symbols remain Unicode rather than custom generated artwork.
- `npm run check` validates that no local PNG emoji pack or local fallback loader has been reintroduced.

## 1.16.4 official emoji installer checks

- `npm run check` verifies the installer discovers `/api/collections`, reads `/api/collection/{name}`, uses `/image/{id}`, and still attempts the official BIG Games GitHub `Pet Icons` directory for pet portraits.
- No PNG artwork is shipped in `assets/emojis`.
- Runtime source parsing handles uppercase and lowercase artwork fields including `Icon`, `icon`, `Thumbnail`, `thumbnail`, `Image`, `image`, and nested equivalents carrying `rbxassetid://...` values.
- `/emoji-status` is the authoritative post-deploy check because it fetches the live Discord emoji list.
