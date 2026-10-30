export function clip(value, max = 1000) {
  const text = String(value ?? '')
    .normalize('NFKC')
    .replace(/\r/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
    .replace(/@everyone/gi, '@\u200beveryone').replace(/@here/gi, '@\u200bhere');
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}
export function escapeMarkdown(value, max = 1000) {
  return clip(value, max).replace(/([\\`*_{}\[\]()<>#+\-.!|~])/g, '\\$1');
}
export function safeChannelSlug(value, max = 70) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, max) || 'user';
}
export function compactNumber(value) {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2).replace(/\.00$/, '')}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2).replace(/\.00$/, '')}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(2).replace(/\.00$/, '')}k`;
  return Math.round(n).toLocaleString('en-US');
}
export function formatNumber(value) { return Math.round(Number(value) || 0).toLocaleString('en-US'); }
export function formatDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? 'Unknown' : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(d) + ' UTC';
}
export function parseDuration(input, maxMs = 28 * 24 * 60 * 60 * 1000) {
  const text = String(input ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const match = /^(\d{1,6})(s|m|h|d|w)$/.exec(text);
  if (!match) throw new Error('Use a duration such as 10m, 2h, 3d or 1w.');
  const amount = Number(match[1]);
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  const ms = amount * units[match[2]];
  if (amount < 1 || ms > maxMs) throw new Error('Duration is outside the allowed range.');
  return ms;
}
export function getDomainFromUrl(text) {
  try {
    const raw = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const url = new URL(raw);
    return url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  } catch { return null; }
}
export function hostAllowed(host, allowlist) {
  if (!host) return false;
  const hostname = String(host).toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (hostname === 'discord.com' || hostname.endsWith('.discord.com') || hostname === 'discord.gg' || hostname.endsWith('.discord.gg') || hostname === 'discordapp.com' || hostname.endsWith('.discordapp.com')) return false;
  return allowlist.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
}
export function clampInt(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Enter a number between ${min} and ${max}.`);
  const int = Math.floor(number);
  if (int < min || int > max) throw new Error(`Enter a number between ${min} and ${max}.`);
  return int;
}
export function isHttpUrl(value) {
  try { const u = new URL(value); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}
