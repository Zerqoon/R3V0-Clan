/** Pure Guess Huge text-input and progressive-hint helpers. */
export function normalizeHugeGuess(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200F\uFEFF]/g, '')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Accept a plain Huge name, or an explicitly marked guess such as `guess: Huge Cat`.
 * This prevents ordinary chat messages from consuming a player's one guess.
 */
export function extractHugeGuess(content, knownPetNames = []) {
  const raw = String(content ?? '').trim();
  if (!raw || raw.length > 140 || raw.startsWith('/')) return null;
  const prefix = raw.match(/^(?:!guess|guess|\?guess|zgaduj(?:ę|e)?)\s*[:\-]?\s*(.+)$/iu);
  if (prefix?.[1]?.trim()) return prefix[1].trim();
  const normalized = normalizeHugeGuess(raw);
  if (!normalized) return null;
  const known = new Set((Array.isArray(knownPetNames) ? knownPetNames : []).map(normalizeHugeGuess).filter(Boolean));
  if (known.has(normalized)) return raw;
  if (/^(?:huge|titanic|gargantuan)\b/iu.test(raw)) return raw;
  return null;
}

export function isHugeGuessCorrect(guess, answer) {
  const normalizedGuess = normalizeHugeGuess(guess);
  return Boolean(normalizedGuess) && normalizedGuess === normalizeHugeGuess(answer);
}

export function createHugeHintState(answerName) {
  const chars = Array.from(String(answerName ?? ''));
  const visible = new Set();
  const remaining = [];
  let atWordStart = true;
  chars.forEach((char, index) => {
    if (/\s/u.test(char)) { atWordStart = true; return; }
    if (!/[\p{L}\p{N}]/u.test(char)) { visible.add(index); atWordStart = false; return; }
    if (atWordStart) visible.add(index);
    else remaining.push(index);
    atWordStart = false;
  });
  // Reveal letters from left to right so the hint reads naturally (not like random missing letters).
  return { answerName: String(answerName ?? ''), chars, visible, remaining };
}

export function revealNextHugeHint(state) {
  if (!state || !Array.isArray(state.remaining) || !state.remaining.length) return false;
  state.visible.add(state.remaining.shift());
  return true;
}

export function renderHugeHint(state) {
  if (!state || !Array.isArray(state.chars)) return '';
  const words = [];
  let word = '';
  state.chars.forEach((char, index) => {
    if (/\s/u.test(char)) {
      if (word) { words.push(word); word = ''; }
      return;
    }
    word += state.visible.has(index) || !/[\p{L}\p{N}]/u.test(char) ? char : '_';
  });
  if (word) words.push(word);
  return words.map(part => Array.from(part).join('')).join('   ');
}
