const values = { channels: {}, roles: {} };
export function liveGroup(group, defaults) {
  const result = {};
  for (const [key, fallback] of Object.entries(defaults)) Object.defineProperty(result, key, { enumerable: true, get: () => values[group]?.[key] ?? fallback });
  return Object.freeze(result);
}
export function applyRuntimeOverrides(overrides = {}) {
  for (const group of ['channels', 'roles']) {
    values[group] = {};
    for (const [key, value] of Object.entries(overrides[group] || {})) if (/^\d{15,22}$/.test(String(value))) values[group][key] = String(value);
  }
}
