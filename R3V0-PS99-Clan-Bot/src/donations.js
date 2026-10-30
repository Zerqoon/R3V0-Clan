import { ButtonBuilder, ButtonStyle } from 'discord.js';
import { db, getSetting, setSetting, transaction } from './db.js';
import { config } from './config.js';
import { getRobloxUsersByIds } from './ps99.js';
import { requestJson } from './api-client.js';
import { enqueueJob, registerJob, deliverOnce } from './outbox.js';
import { card, text, divider, row, button, v2 } from './ui.js';
import { formatNumber, escapeMarkdown, clip } from './utils.js';
import { CLAN_COLORS } from './theme.js';
const integer = value => value !== null && value !== undefined && value !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;

export function extractDiamondContributions(input) {
  const raw = input?.data?.Name ? input.data : input;
  if (String(raw?.Name ?? raw?.name ?? '').toUpperCase() !== 'R3V0') throw new Error('Donation payload is not the R3V0 clan.');
  // R3V0's live API returns DiamondContributions.AllTime.Data, NOT a flat array.
  const candidates = [
    ['DiamondContributions.AllTime.Data', raw.DiamondContributions?.AllTime?.Data, raw.DiamondContributions?.AllTime?.Sum],
    ['DiamondContributions.AllTime.data', raw.DiamondContributions?.AllTime?.data, raw.DiamondContributions?.AllTime?.sum],
    ['DiamondContributions', raw.DiamondContributions],
    ['GemContributions', raw.GemContributions],
    ['Contribution.Diamonds', raw.Contribution?.Diamonds],
    ['Contribution.Diamond', raw.Contribution?.Diamond],
    ['Contribution.Gems', raw.Contribution?.Gems],
    ['Contributions.Diamonds', raw.Contributions?.Diamonds],
  ];
  const found = candidates.find(([, data]) => Array.isArray(data));
  const epoch = `R3V0:${integer(raw.Created) ?? 'legacy'}`;
  if (!found) return { available: false, epoch, rows: [], source: null, total: null, balance: integer(raw.DepositedDiamonds), rejected: 0 };
  const rows = new Map(); let rejected = 0;
  for (const item of found[1]) {
    const userId = String(item?.UserID ?? item?.UserId ?? item?.userId ?? '');
    const amount = integer(item?.Diamonds ?? item?.AllTimeDiamonds ?? item?.allTimeDiamonds ?? item?.Amount ?? item?.Gems);
    if (!/^[1-9]\d{0,15}$/.test(userId) || amount === null) { rejected++; continue; }
    const old = rows.get(userId);
    if (!old || amount > old.amount) rows.set(userId, { userId, amount });
  }
  const sum = integer(found[2]);
  return { available: true, epoch, rows: [...rows.values()], source: found[0], total: sum, balance: integer(raw.DepositedDiamonds), rejected };
}
export function observeDiamondContributions(raw, roster = [], now = Date.now()) {
  const parsed = extractDiamondContributions(raw);
  const completeTable = parsed.available && parsed.rejected === 0 && parsed.total !== null && parsed.rows.reduce((sum, row) => sum + row.amount, 0) === parsed.total;
  const names = new Map(roster.map(member => [String(member.userId), member.username]));
  const events = [];
  let baselines = 0, regressions = 0;
  transaction(() => {
    const baseline = getSetting('donation_complete_baseline', {});
    const canObserveNewDonors = baseline.epoch === parsed.epoch && completeTable;
    if (parsed.available) for (const row of parsed.rows) {
      let old = db.prepare('SELECT * FROM gem_counters WHERE clan_epoch=? AND user_id=?').get(parsed.epoch, row.userId);
      const username = names.get(row.userId) || old?.username || `RobloxUser_${row.userId}`;
      if (!old) {
        // First installation imports history. After a verified complete table,
        // a newly appearing donor is an observed increase from zero.
        const initial = canObserveNewDonors ? 0 : row.amount;
        db.prepare('INSERT INTO gem_counters(clan_epoch,user_id,username,high_water,last_value,updated_at) VALUES(?,?,?,?,?,?)').run(parsed.epoch, row.userId, username, initial, initial, now);
        if (!canObserveNewDonors) { baselines++; continue; }
        old = { high_water: 0 };
      }
      if (row.amount < old.high_water) regressions++;
      if (row.amount > old.high_water) {
        const amount = row.amount - old.high_water;
        const key = `api:${parsed.epoch}:${row.userId}:${old.high_water}:${row.amount}`;
        const result = db.prepare('INSERT OR IGNORE INTO donation_ledger(event_key,clan_epoch,user_id,username,amount,counter_before,counter_after,observed_at) VALUES(?,?,?,?,?,?,?,?)').run(key, parsed.epoch, row.userId, username, amount, old.high_water, row.amount, now);
        if (result.changes) {
          const eventId = Number(result.lastInsertRowid);
          let uncovered = amount;
          const receipts = db.prepare("SELECT id,amount FROM donation_receipts WHERE user_id=? AND status='pending' AND created_at>=? AND created_at<=? ORDER BY created_at,id").all(row.userId, now - 2 * 3600_000, now);
          for (const receipt of receipts) {
            if (receipt.amount > uncovered) break;
            db.prepare("UPDATE donation_receipts SET status='covered_by_api',ledger_id=? WHERE id=? AND status='pending'").run(eventId, receipt.id);
            uncovered -= receipt.amount;
          }
          enqueueJob('donation-log', `donation:${eventId}`, { eventId });
          events.push({ id: eventId, userId: row.userId, username, amount });
        }
      }
      // Never lower the high-water mark: stale API responses must not double-count a rebound.
      db.prepare('UPDATE gem_counters SET username=?,high_water=MAX(high_water,?),last_value=?,updated_at=? WHERE clan_epoch=? AND user_id=?').run(username, row.amount, row.amount, now, parsed.epoch, row.userId);
    }
    if (completeTable) setSetting('donation_complete_baseline', { epoch: parsed.epoch, capturedAt: now });
    setSetting('donation_status', { ...parsed, rows: undefined, completeTable, rowCount: parsed.rows.length, lastAttemptAt: now, lastSuccessAt: parsed.available ? now : getSetting('donation_status', {})?.lastSuccessAt || null, baselines, regressions, error: parsed.available ? null : 'The clan API did not include an individual diamond contribution table.' });
  });
  return { ...parsed, events, baselines, regressions };
}
export function recordDonationReceipt({ eventId, robloxUserId, username, amount, source = 'Staff receipt', note = '', now = Date.now() }) {
  if (!eventId || String(eventId).length > 180) throw new Error('A unique eventId is required for every receipt. Reuse it for retries.');
  if (!/^[1-9]\d{0,15}$/.test(String(robloxUserId)) || integer(amount) === null || Number(amount) <= 0) throw new Error('A valid Roblox ID and positive integer gem amount are required.');
  const key = `receipt:${String(eventId)}`;
  const old = db.prepare('SELECT * FROM donation_receipts WHERE event_key=?').get(key);
  if (old) {
    if (old.user_id !== String(robloxUserId) || old.amount !== Number(amount)) throw new Error('This eventId was already used for a different receipt.');
    return { ...old, duplicate: true };
  }
  db.prepare('INSERT INTO donation_receipts(event_key,user_id,username,amount,source,note,created_at) VALUES(?,?,?,?,?,?,?)').run(key, String(robloxUserId), clip(username || `RobloxUser_${robloxUserId}`, 40), Number(amount), clip(source, 100), clip(note, 500), now);
  return { ...db.prepare('SELECT * FROM donation_receipts WHERE event_key=?').get(key), duplicate: false };
}
export function getDonationSummary() {
  const state = getSetting('donation_status', {});
  const donors = state.epoch ? db.prepare('SELECT user_id AS userId,username,high_water AS amount,last_value AS lastValue,updated_at AS updatedAt FROM gem_counters WHERE clan_epoch=? ORDER BY high_water DESC,user_id').all(state.epoch) : [];
  const observed = state.epoch ? db.prepare('SELECT COALESCE(SUM(amount),0) AS amount,COUNT(*) AS count FROM donation_ledger WHERE clan_epoch=?').get(state.epoch) : { amount: 0, count: 0 };
  const pending = db.prepare("SELECT COUNT(*) AS count FROM donation_receipts WHERE status='pending'").get().count;
  return { ...state, donors, observedAmount: observed.amount, observedEvents: observed.count, pendingReceipts: pending };
}
export function buildDonationsPayload(page = 0, userId = null) {
  const summary = getDonationSummary();
  const pages = Math.max(1, Math.ceil(summary.donors.length / 10));
  const safe = Math.min(pages - 1, Math.max(0, Number(page) || 0));
  const container = card('💎 R3V0 CLAN TREASURY', '**Official diamond contributions · BIG Games clan API**');
  container.addTextDisplayComponents(text(`**Lifetime donated:** ${summary.total == null ? 'Not reported' : formatNumber(summary.total)} gems\n**Current clan balance:** ${summary.balance == null ? 'Not reported' : formatNumber(summary.balance)} gems\n**New increases observed by this bot:** ${formatNumber(summary.observedAmount)} gems`));
  if (userId) {
    const donor = summary.donors.find(item => item.userId === String(userId));
    container.addTextDisplayComponents(text(`**Your reported lifetime contribution:** ${donor ? formatNumber(donor.amount) : 'Not reported'} gems`));
  }
  container.addSeparatorComponents(divider()).addTextDisplayComponents(text(summary.donors.slice(safe * 10, safe * 10 + 10).map((donor, index) => `**${safe * 10 + index + 1}. ${escapeMarkdown(donor.username, 40)}** · **${formatNumber(donor.amount)}** gems${donor.lastValue < donor.amount ? ' · counter under review' : ''}`).join('\n') || 'Individual contributions have not been reported yet.'));
  container.addTextDisplayComponents(text(`-# ${summary.available ? 'Contribution table available' : 'Contribution table unavailable'} · ${summary.lastSuccessAt ? `Last read <t:${Math.floor(summary.lastSuccessAt / 1000)}:R>` : 'Waiting for first read'} · Page ${safe + 1}/${pages}\n-# First readings establish lifetime baselines. Polling groups increases between reads; it cannot identify every separate in-game transaction. Receipts never add to official totals.`));
  container.addActionRowComponents(row(button(`clan:donations:${Math.max(0, safe - 1)}:back`, 'Back').setDisabled(safe === 0), button(`clan:donations:${Math.min(pages - 1, safe + 1)}:next`, 'Next').setDisabled(safe === pages - 1)));
  return v2(container);
}
export function buildDonationLogPayload(event, marker = `DONATION-${event.id}`) {
  const link = db.prepare('SELECT discord_id FROM account_links WHERE guild_id=? AND roblox_id=?').get(config.guildId, event.user_id);
  const container = card('💎 CLAN DONATION DETECTED', `**${escapeMarkdown(event.username, 40)}**${link ? ` · <@${link.discord_id}>` : ''}`, CLAN_COLORS.success)
    .addTextDisplayComponents(text(`# +${formatNumber(event.amount)} gems\n**Lifetime contribution:** ${formatNumber(event.counter_before)} → **${formatNumber(event.counter_after)}**\n**Observed:** <t:${Math.floor(event.observed_at / 1000)}:F>`))
    .addActionRowComponents(row(new ButtonBuilder().setLabel('Roblox profile').setStyle(ButtonStyle.Link).setURL(`https://www.roblox.com/users/${event.user_id}/profile`), button('clan:donations:0', 'Clan donations')))
    .addTextDisplayComponents(text(`-# Source: R3V0 lifetime contribution counter. This may group multiple deposits.\n-# ${marker}`));
  return v2(container);
}
registerJob('donation-log', async (client, { eventId }, job) => {
  const event = db.prepare('SELECT * FROM donation_ledger WHERE id=?').get(eventId);
  if (!event) throw new Error('Donation ledger entry is missing');
  const counter = db.prepare('SELECT username FROM gem_counters WHERE clan_epoch=? AND user_id=?').get(event.clan_epoch, event.user_id);
  if (event.username.startsWith('RobloxUser_') && counter?.username) event.username = counter.username;
  const marker = `R3V0-DONATION-${eventId}`;
  await deliverOnce(client, config.channels.gems, buildDonationLogPayload(event, marker), marker);
});
export async function refreshDonations(roster = []) {
  try {
    const raw = await requestJson(`${config.apiBase}/api/clan/${encodeURIComponent(config.clanName)}`, { ttlMs: 45_000, retries: 1 });
    const parsed = extractDiamondContributions(raw);
    const rosterIds = new Set(roster.map(member => String(member.userId)));
    const unresolved = parsed.rows.filter(member => !rosterIds.has(member.userId)).map(member => member.userId);
    const identities = unresolved.length ? await getRobloxUsersByIds(unresolved) : new Map();
    const names = [...roster, ...[...identities].map(([userId, identity]) => ({ userId, username: identity.username }))];
    return observeDiamondContributions(raw, names);
  } catch (error) {
    setSetting('donation_status', { ...getSetting('donation_status', {}), available: false, lastAttemptAt: Date.now(), error: clip(error.message, 400) });
    throw error;
  }
}
export function startDonationWorker(rosterProvider = () => []) {
  let busy = false;
  const run = async () => { if (busy) return; busy = true; try { await refreshDonations(rosterProvider()); } catch (error) { console.warn(`[donations] ${error.message}`); } finally { busy = false; } };
  void run();
  const timer = setInterval(run, 60_000); timer.unref?.();
  return () => clearInterval(timer);
}
