/** Keeps one public mini-game active per Discord channel, across all game modes. */
const channelSessions = new Map();

export function reserveGameChannel(channelId, gameType) {
  const id = String(channelId ?? '').trim();
  const type = String(gameType ?? '').trim();
  if (!id || !type || channelSessions.has(id)) return false;
  channelSessions.set(id, type);
  return true;
}

export function releaseGameChannel(channelId, gameType) {
  const id = String(channelId ?? '').trim();
  if (!id) return false;
  if (gameType && channelSessions.get(id) !== String(gameType)) return false;
  return channelSessions.delete(id);
}

export function getGameInChannel(channelId) {
  return channelSessions.get(String(channelId ?? '').trim()) ?? null;
}
