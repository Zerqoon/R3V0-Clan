const pending = new Map();
export async function singleFlight(key, task) {
  if (pending.has(key)) return pending.get(key);
  const promise = Promise.resolve().then(task);
  pending.set(key, promise);
  try { return await promise; } finally { if (pending.get(key) === promise) pending.delete(key); }
}
