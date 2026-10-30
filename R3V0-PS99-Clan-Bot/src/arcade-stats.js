import { db } from './db.js';

const GAME_COLUMNS = Object.freeze({ scramble: 'scramble_wins', emoji: 'emoji_wins', higherlower: 'higherlower_wins' });

export function recordArcadeWin({ userId, username, gameType, now = Date.now() }) {
  const id = String(userId ?? '').trim();
  const game = String(gameType ?? '').trim().toLowerCase();
  const column = GAME_COLUMNS[game];
  if (!id || !column) throw new Error('A user ID and a supported arcade game type are required.');
  const cleanName = String(username ?? '').trim().slice(0, 80) || `Player ${id}`;
  const time = Math.max(0, Math.floor(Number(now) || Date.now()));
  db.prepare(`INSERT INTO arcade_game_stats(user_id,username,total_wins,${column},last_win_at) VALUES(?,?,1,1,?)
    ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,total_wins=arcade_game_stats.total_wins+1,
    ${column}=arcade_game_stats.${column}+1,last_win_at=excluded.last_win_at`).run(id, cleanName, time);
  return db.prepare('SELECT user_id AS userId,username,total_wins AS totalWins,scramble_wins AS scrambleWins,emoji_wins AS emojiWins,higherlower_wins AS higherLowerWins,last_win_at AS lastWinAt FROM arcade_game_stats WHERE user_id=?').get(id);
}

export function getArcadeLeaderboard(limit = 10) {
  const n = Math.max(1, Math.min(20, Math.floor(Number(limit) || 10)));
  return db.prepare(`SELECT user_id AS userId,username,total_wins AS totalWins,scramble_wins AS scrambleWins,
    emoji_wins AS emojiWins,higherlower_wins AS higherLowerWins,last_win_at AS lastWinAt
    FROM arcade_game_stats ORDER BY total_wins DESC,last_win_at ASC,username COLLATE NOCASE ASC LIMIT ?`).all(n);
}
