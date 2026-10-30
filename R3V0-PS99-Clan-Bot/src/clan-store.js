import { db, getSetting, setSetting, transaction } from './db.js';
import { enqueueJob } from './outbox.js';
import { formatNumber, escapeMarkdown } from './utils.js';
export const currentClan = () => getSetting('last_good_clan', null);
export function clanDataState(clan = currentClan(), now = Date.now()) {
  if (!clan) return { name: 'Waiting for data', stale: true, incomplete: true, ageMs: null };
  const ageMs = Math.max(0, now - Number(clan.updatedAt || 0));
  const stale = ageMs > 15 * 60_000 || Boolean(clan.snapshotIsStale) || Boolean(getSetting('monitor_status', {})?.lastError);
  const incomplete = clan.members.some(member => !member.pointsKnown);
  return { name: stale ? 'Last available data' : incomplete ? 'Partial score coverage' : 'Current data', stale, incomplete, ageMs };
}
export function storeClanObservation(clan) {
  const now = Number(clan.updatedAt) || Date.now();
  const { raw, ...stored } = clan;
  transaction(() => {
    const knownSeason = clan.activeBattleId ? db.prepare('SELECT * FROM seasons WHERE battle_id=?').get(clan.activeBattleId) : null;
    const newestSeason = db.prepare('SELECT * FROM seasons ORDER BY started_at DESC,id DESC LIMIT 1').get();
    if (knownSeason && newestSeason && knownSeason.id !== newestSeason.id && knownSeason.status === 'ended' && knownSeason.started_at <= newestSeason.started_at) throw new Error('The API returned a previously archived battle. Last current data is retained.');
    setSetting('last_good_clan', stored);
    setSetting('monitor_status', { lastAttemptAt: now, lastSuccessAt: now, lastError: null, failures: 0 });
    const battleId = String(clan.activeBattleId || '');
    if (!battleId || battleId === 'unknown-battle') return;
    const previous = getSetting('current_season_id');
    const old = previous ? db.prepare('SELECT * FROM seasons WHERE id=?').get(previous) : null;
    let season = db.prepare('SELECT * FROM seasons WHERE battle_id=?').get(battleId);
    if (old && old.battle_id !== battleId && old.status === 'active') {
      db.prepare("UPDATE seasons SET status='ended',ended_at=? WHERE id=?").run(now, old.id);
      const top = db.prepare('SELECT username,points FROM season_members WHERE season_id=? AND points IS NOT NULL ORDER BY points DESC LIMIT 3').all(old.id);
      enqueueJob('message', `season-ended:${old.id}`, { title: '🏆 Clan Battle archived', body: `**${escapeMarkdown(old.title, 100)}**\nFinal observed clan score: **${old.total_points == null ? 'Not reported' : formatNumber(old.total_points)}**\n${top.map((member, index) => `${index + 1}. **${escapeMarkdown(member.username, 40)}** · ${formatNumber(member.points)} points`).join('\n')}\n\nOpen **History** on the Clan Battle panel for all saved results.`, channelKind: 'audit' });
    }
    if (!season) {
      const inserted = db.prepare('INSERT INTO seasons(battle_id,title,started_at,ends_at,total_points,rank,updated_at) VALUES(?,?,?,?,?,?,?)').run(battleId, clan.activeBattle, now, clan.battleFinishTime ? clan.battleFinishTime * 1000 : null, clan.totalBattlePoints ?? null, clan.battleRankAvailable ? clan.battleRank : null, now);
      season = db.prepare('SELECT * FROM seasons WHERE id=?').get(inserted.lastInsertRowid);
    } else db.prepare('UPDATE seasons SET title=?,ends_at=?,total_points=COALESCE(?,total_points),rank=COALESCE(?,rank),updated_at=? WHERE id=?').run(clan.activeBattle, clan.battleFinishTime ? clan.battleFinishTime * 1000 : season.ends_at, clan.totalBattlePoints ?? null, clan.battleRankAvailable ? clan.battleRank : null, now, season.id);
    setSetting('current_season_id', season.id);
    db.prepare('UPDATE season_members SET present=0 WHERE season_id=?').run(season.id);
    for (const member of clan.members) {
      const points = member.pointsKnown && Number.isSafeInteger(member.points) ? member.points : null;
      db.prepare(`INSERT INTO season_members(season_id,user_id,username,points,first_seen,last_seen) VALUES(?,?,?,?,?,?)
        ON CONFLICT(season_id,user_id) DO UPDATE SET username=excluded.username,points=CASE WHEN excluded.points IS NULL THEN season_members.points WHEN season_members.points IS NULL THEN excluded.points ELSE excluded.points END,present=1,last_seen=excluded.last_seen`).run(season.id, String(member.userId), member.username, points, now, now);
    }
    if (season.ends_at && season.ends_at <= now) db.prepare("UPDATE seasons SET status='ended',ended_at=COALESCE(ended_at,?) WHERE id=?").run(season.ends_at, season.id);
    for (const goal of goalsForBattle(battleId)) {
      const value = goal.user_id ? clan.members.find(member => String(member.userId) === goal.user_id && member.pointsKnown)?.points : clan.totalBattlePoints;
      if (value == null) continue;
      const reached = Math.min(100, Math.floor(value / goal.target * 4) * 25);
      if (reached > goal.reached_threshold) {
        db.prepare('UPDATE clan_goals SET reached_threshold=? WHERE id=?').run(reached, goal.id);
        const name = goal.user_id ? clan.members.find(member => String(member.userId) === goal.user_id)?.username || goal.user_id : 'R3V0';
        enqueueJob('message', `goal:${goal.id}:${goal.created_at}:${reached}`, { title: reached === 100 ? '🎯 Goal completed' : '🎯 Goal milestone', body: `**${escapeMarkdown(name, 40)}** reached **${reached}%** of the battle goal.\n**${formatNumber(value)} / ${formatNumber(goal.target)} points**`, channelKind: 'leaderboard' });
      }
    }
  });
  return stored;
}
export function recordMonitorError(error) {
  const old = getSetting('monitor_status', {});
  setSetting('monitor_status', { ...old, lastAttemptAt: Date.now(), lastError: String(error.message || error).slice(0, 600), failures: Number(old.failures || 0) + 1 });
}
export function goalsForBattle(battleId) { return db.prepare('SELECT * FROM clan_goals WHERE battle_id=? ORDER BY user_id,id').all(String(battleId)); }
export function setBattleGoal({ battleId, userId = '', target, actorId, clan = currentClan() }) {
  if (!battleId || battleId === 'unknown-battle') throw new Error('A current battle is required before setting a goal.');
  if (!Number.isSafeInteger(Number(target)) || Number(target) <= 0) throw new Error('The target must be a positive whole number.');
  if (userId && !clan?.members.some(member => String(member.userId) === String(userId))) throw new Error('Choose a current R3V0 roster member by Roblox user ID.');
  const value = userId ? clan?.members.find(member => String(member.userId) === String(userId) && member.pointsKnown)?.points : clan?.totalBattlePoints;
  const reached = value == null ? 0 : Math.min(100, Math.floor(value / Number(target) * 4) * 25);
  db.prepare('INSERT INTO clan_goals(battle_id,user_id,target,created_at,created_by,reached_threshold) VALUES(?,?,?,?,?,?) ON CONFLICT(battle_id,user_id) DO UPDATE SET target=excluded.target,created_at=excluded.created_at,created_by=excluded.created_by,reached_threshold=excluded.reached_threshold').run(battleId, String(userId), Number(target), Date.now(), String(actorId), reached);
}
export function observedProgress(userId, battleId, points, now = Date.now()) {
  if (points == null || !Number.isFinite(points)) return { growth: null, coverageHours: 0, fullDay: false, hourly: Array(24).fill(null) };
  const hour = 3600_000;
  const data = db.prepare('SELECT captured_at AS at,points FROM member_snapshots WHERE user_id=? AND battle_id=? AND captured_at>=? ORDER BY captured_at').all(String(userId), String(battleId), now - 25 * hour);
  if (!data.length) return { growth: null, coverageHours: 0, fullDay: false, hourly: Array(24).fill(null) };
  const dayStart = now - 24 * hour;
  const before = data.filter(item => item.at <= dayStart).at(-1);
  const fullDay = Boolean(before && dayStart - before.at <= 30 * 60_000);
  const base = fullDay ? before : data.find(item => item.at >= dayStart) || data.at(-1);
  const coverageHours = Math.max(0, Math.min(24, (now - base.at) / hour));
  const hourly = [];
  for (let index = 0; index < 24; index++) {
    const start = now - (24 - index) * hour, end = start + hour;
    const a = data.filter(item => item.at <= start && start - item.at <= 15 * 60_000).at(-1);
    const b = data.filter(item => item.at <= end && end - item.at <= 15 * 60_000).at(-1);
    const samples = data.filter(item => item.at > start && item.at < end);
    const sequence = [a, ...samples, b].filter(Boolean);
    const gap = sequence.some((item, i) => i && item.at - sequence[i - 1].at > 30 * 60_000);
    hourly.push(a && b && !gap && b.points >= a.points ? b.points - a.points : null);
  }
  return { growth: points >= base.points && coverageHours > 0 ? points - base.points : null, coverageHours, fullDay, hourly };
}
export function getSeasons() { return db.prepare('SELECT * FROM seasons ORDER BY started_at DESC,id DESC').all(); }
export function seasonMembers(id) { return db.prepare('SELECT * FROM season_members WHERE season_id=? ORDER BY points IS NULL,points DESC,first_seen,user_id').all(Number(id)); }
