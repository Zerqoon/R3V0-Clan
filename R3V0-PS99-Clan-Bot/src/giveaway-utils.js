import { randomInt } from 'node:crypto';

const DURATION_UNITS = Object.freeze({ s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 });
export const MAX_GIVEAWAY_DURATION_MS = 30 * 86_400_000;

export function parseGiveawayDuration(input) {
  const match = String(input ?? '').trim().match(/^(\d{1,4})\s*(s|m|h|d|w)$/i);
  if (!match) throw new Error('Use a duration such as `30m`, `2h`, `3d` or `1w`.');
  const amount = Number(match[1]);
  const duration = amount * DURATION_UNITS[match[2].toLowerCase()];
  if (!Number.isSafeInteger(duration) || duration < 60_000) throw new Error('A giveaway must last at least one minute.');
  if (duration > MAX_GIVEAWAY_DURATION_MS) throw new Error('The maximum giveaway duration is 30 days.');
  return duration;
}

export function formatGiveawayDuration(ms) {
  const seconds = Math.max(0, Math.floor(Number(ms) / 1000));
  const units = [['d', 86_400], ['h', 3_600], ['m', 60], ['s', 1]];
  let remaining = seconds;
  const output = [];
  for (const [label, length] of units) {
    const amount = Math.floor(remaining / length);
    if (amount) output.push(`${amount}${label}`);
    remaining %= length;
  }
  return output.join(' ') || '0s';
}

// entries: [{ userId: string, weight: positive integer }]. Winners are unique.
export function pickWeightedWinners(entries, count, random = total => randomInt(total)) {
  const pool = (Array.isArray(entries) ? entries : [])
    .map(entry => ({ userId: String(entry.userId), weight: Math.floor(Number(entry.weight) || 0) }))
    .filter(entry => entry.userId && entry.weight > 0);
  const winners = [];
  const maxWinners = Math.max(0, Math.min(pool.length, Math.floor(Number(count) || 0)));
  while (winners.length < maxWinners && pool.length) {
    const totalWeight = pool.reduce((sum, entry) => sum + entry.weight, 0);
    if (!Number.isSafeInteger(totalWeight) || totalWeight <= 0) break;
    const raw = random(totalWeight);
    const point = Math.max(0, Math.min(totalWeight - 1, Math.floor(Number(raw) || 0)));
    let cursor = point;
    let selectedIndex = pool.length - 1;
    for (let index = 0; index < pool.length; index += 1) {
      cursor -= pool[index].weight;
      if (cursor < 0) { selectedIndex = index; break; }
    }
    winners.push(pool[selectedIndex].userId);
    pool.splice(selectedIndex, 1);
  }
  return winners;
}

export function getGiveawayEligibilityReasons({
  memberPresent = true, hasRequiredRole = true, messageCount = 0, minMessages = 0,
  accountAgeDays = Infinity, minAccountAgeDays = 0,
  serverAgeDays = Infinity, minServerAgeDays = 0,
} = {}) {
  const reasons = [];
  if (!memberPresent) reasons.push('You must still be a server member.');
  if (!hasRequiredRole) reasons.push('You do not have the required role.');
  if (Number(messageCount) < Number(minMessages)) reasons.push(`You need at least ${minMessages} messages (you have ${messageCount}).`);
  if (Number(accountAgeDays) < Number(minAccountAgeDays)) reasons.push(`Your account must be at least ${minAccountAgeDays} days old.`);
  if (Number(serverAgeDays) < Number(minServerAgeDays)) reasons.push(`You must have been on the server for at least ${minServerAgeDays} days.`);
  return reasons;
}
