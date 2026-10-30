import { getDomainFromUrl, hostAllowed } from './utils.js';

const CONFUSABLES = new Map(Object.entries({
  'а':'a','А':'a','е':'e','Е':'e','о':'o','О':'o','р':'p','Р':'p','с':'c','С':'c','х':'x','Х':'x','у':'y','У':'y',
  'і':'i','І':'i','ї':'i','ј':'j','Ј':'j','ӏ':'l','ⅼ':'l','ԁ':'d','ԛ':'q','ν':'v','Ν':'n','κ':'k','Κ':'k',
  '@':'a','$':'s','0':'o','1':'i','!':'i','3':'e','4':'a','5':'s','7':'t','|':'l'
}));
const BANNED_TERMS = new Set([
  'nigger','niggers','nigga','niggas','nigglet','faggot','faggots','fag','fags','tranny','trannies',
  'kike','kikes','chink','chinks','spic','spics','wetback','wetbacks','coon','coons','dyke','dykes',
  'pedophile','pedophiles','pedophilia','paedophile','paedophilia','pedo','pedos','pedobait','pedobaiting',
  'childmolester','childmolesters','groomer'
]);
const NSFW_HOSTS = new Set([
  'pornhub.com','xvideos.com','xnxx.com','redtube.com','youporn.com','rule34.xxx','e621.net','gelbooru.com',
  'bestgore.fun','kaotic.com','crazyshit.com','watchpeopledie.tv','theync.com'
]);
const NSFW_PATH = /(?:\/|\b)(?:porn|hentai|rule\s*34|nsfw|bestgore|gore-compilation|watchpeopledie)(?:\/|\b)/i;
const URL_REGEX = /(?:https?:\/\/|www\.)[^\s<>]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|gg|io|tv|co|pl|xyz|app|dev|me|ru|cn|link|site|top|online|club|info|biz)(?:\/[^\s<>]*)?/giu;

export function normalizeForModeration(value) {
  let s = String(value ?? '').normalize('NFKC').toLowerCase();
  s = [...s].map(ch => CONFUSABLES.get(ch) ?? ch).join('');
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '');
  return s;
}
export function containsProhibitedLanguage(value) {
  const normalized = normalizeForModeration(value).replace(/[^a-z0-9]+/g, ' ').trim();
  if (!normalized) return null;
  const tokens = normalized.split(/\s+/);
  const candidates = new Set(tokens);
  // Join only short fragments to catch forms such as "n i g g e r" without
  // combining every ordinary word into a huge string and causing false positives.
  for (let start = 0; start < tokens.length; start++) {
    let joined = '';
    for (let end = start; end < Math.min(tokens.length, start + 10); end++) {
      if (tokens[end].length > 4) break;
      joined += tokens[end];
      if (joined.length > 1 && joined.length <= 22) candidates.add(joined);
    }
  }
  for (const term of BANNED_TERMS) if (candidates.has(term)) return 'prohibited_slur_or_sexualization';
  return null;
}
export function getUrls(text) {
  return [...String(text ?? '').matchAll(URL_REGEX)].map(m => m[0].replace(/[),.!?]+$/g, '')).filter(Boolean);
}
export function checkLinks(text, allowlist) {
  const normalized = normalizeForModeration(text);
  if (/discord\s*(?:\.|dot)\s*(?:gg|com|app)\s*(?:\/\s*invite|\/|\b)/i.test(normalized)) return { ok: false, reason: 'discord_links_not_allowed' };
  const urls = getUrls(text);
  for (const url of urls) {
    const host = getDomainFromUrl(url);
    if (!host) return { ok: false, reason: 'invalid_or_obfuscated_link' };
    if ([...NSFW_HOSTS].some(banned => host === banned || host.endsWith(`.${banned}`))) return { ok: false, reason: 'prohibited_domain' };
    if (NSFW_PATH.test(new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).pathname)) return { ok: false, reason: 'prohibited_link_content' };
    if (!hostAllowed(host, allowlist)) return { ok: false, reason: 'domain_not_allowed' };
  }
  return { ok: true, urls };
}
export function isGifAttachment(attachment) {
  const type = String(attachment?.contentType ?? '').toLowerCase();
  const name = String(attachment?.name ?? attachment?.url ?? '').toLowerCase();
  return type === 'image/gif' || /\.gif(?:$|[?#])/i.test(name);
}
export function isGifUrl(url) {
  const text = String(url ?? '').toLowerCase();
  return /\.gif(?:$|[?#])/.test(text) || /(?:giphy\.com|klipy\.com|tenor\.com)\/(?:gifs?|view)\//.test(text);
}
export function evaluateContent({ content, attachments = [], allowlist, hasOwnerRole = false, hasOfficerRole = false }) {
  if (hasOwnerRole) return { allowed: true, reason: 'owner_exempt' };
  const language = containsProhibitedLanguage(content);
  if (language) return { allowed: false, reason: language };
  const links = checkLinks(content, allowlist);
  if (!links.ok) return { allowed: false, reason: links.reason };
  if (!hasOfficerRole && attachments.some(isGifAttachment)) return { allowed: false, reason: 'gif_attachment_not_allowed' };
  // Allowed providers are deliberately limited to the configured allowlist; Discord links/CDN are not accepted.
  return { allowed: true, reason: 'allowed', urls: links.urls ?? [] };
}
