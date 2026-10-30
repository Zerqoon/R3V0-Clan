import { db } from './db.js';

function safeLimit(value, fallback = 10) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.max(1, Math.min(10, number)) : fallback;
}

function parsePetNames(raw) {
  try {
    const value = JSON.parse(String(raw || '[]'));
    return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()).slice(-30) : [];
  } catch {
    return [];
  }
}

/** Persist a correct answer in both the player and pet leaderboards. */
export function recordHugeGuessWin({ userId, username, petName, now = Date.now() }) {
  const id = String(userId ?? '').trim();
  const cleanUsername = String(username ?? '').trim().slice(0, 80) || `Player ${id}`;
  const cleanPetName = String(petName ?? '').trim().slice(0, 150);
  const timestamp = Math.max(0, Math.floor(Number(now) || Date.now()));
  if (!id || !cleanPetName) throw new Error('A Discord user ID and Huge pet name are required to record a correct guess.');

  const old = db.prepare('SELECT correct_guesses AS wins, pet_names_json AS petNamesJson FROM huge_guess_stats WHERE user_id=?').get(id);
  const petNames = parsePetNames(old?.petNamesJson);
  if (!petNames.some(name => name.toLocaleLowerCase('en-US') === cleanPetName.toLocaleLowerCase('en-US'))) {
    petNames.push(cleanPetName);
  }
  const uniqueNames = petNames.slice(-30);
  const wins = Number(old?.wins || 0) + 1;
  db.prepare(`INSERT INTO huge_guess_stats(user_id,username,correct_guesses,pet_names_json,last_win_at)
    VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,
    correct_guesses=excluded.correct_guesses, pet_names_json=excluded.pet_names_json, last_win_at=excluded.last_win_at`)
    .run(id, cleanUsername, wins, JSON.stringify(uniqueNames), timestamp);

  db.prepare(`INSERT INTO huge_guess_pet_stats(pet_name,correct_guesses,last_guessed_at)
    VALUES(?,1,?) ON CONFLICT(pet_name) DO UPDATE SET
    correct_guesses=huge_guess_pet_stats.correct_guesses+1,last_guessed_at=excluded.last_guessed_at`)
    .run(cleanPetName, timestamp);

  return { userId: id, username: cleanUsername, wins, petNames: uniqueNames, lastWinAt: timestamp };
}

export function getHugeGuessLeaderboard(limit = 10) {
  const rows = db.prepare(`SELECT user_id AS userId,username,correct_guesses AS wins,
    pet_names_json AS petNamesJson,last_win_at AS lastWinAt FROM huge_guess_stats
    ORDER BY correct_guesses DESC,last_win_at ASC,username COLLATE NOCASE ASC LIMIT ?`)
    .all(safeLimit(limit));
  return rows.map(row => ({ ...row, wins: Number(row.wins) || 0, petNames: parsePetNames(row.petNamesJson) }));
}

export function getMostIdentifiedHugePets(limit = 10) {
  return db.prepare(`SELECT pet_name AS petName,correct_guesses AS correctGuesses,last_guessed_at AS lastGuessedAt
    FROM huge_guess_pet_stats ORDER BY correct_guesses DESC,last_guessed_at ASC,pet_name COLLATE NOCASE ASC LIMIT ?`)
    .all(safeLimit(limit))
    .map(row => ({ ...row, correctGuesses: Number(row.correctGuesses) || 0, lastGuessedAt: Number(row.lastGuessedAt) || 0 }));
}
