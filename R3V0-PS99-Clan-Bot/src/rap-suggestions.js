const petNameOf = item => String(item?.configData?.id ?? item?.configData?.name ?? item?.id ?? item?.name ?? '').trim();
const isPet = item => String(item?.category ?? '').toLowerCase().includes('pet') || String(item?.category ?? '').toLowerCase() === 'huge';
const isHugeLike = item => {
  const name = petNameOf(item);
  const conf = item?.configData || {};
  const type = String(item?.category ?? '').toLowerCase();
  return Boolean(conf.huge) || type === 'huge' || /\b(huge|titanic|gargantuan)\b/i.test(name);
};

/**
 * Build Discord autocomplete choices from the RAP dataset. Values remain the exact
 * pet name expected by the lookup; labels show useful context such as Huge/Titanic.
 * This function is intentionally dependency-free so the selection logic is testable.
 */
export function getRAPPetSuggestions(items, query = '', limit = 25) {
  const q = String(query ?? '').trim().toLocaleLowerCase('en-US');
  const max = Math.max(1, Math.min(25, Math.floor(Number(limit) || 25)));
  const unique = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!isPet(item)) continue;
    const value = petNameOf(item);
    if (!value || value.length > 100) continue;
    const key = value.toLocaleLowerCase('en-US');
    const previous = unique.get(key);
    const record = { value, huge: isHugeLike(item) };
    if (!previous || (!previous.huge && record.huge)) unique.set(key, record);
  }
  const match = [...unique.values()].map(pet => {
    const name = pet.value.toLocaleLowerCase('en-US');
    const index = q ? name.indexOf(q) : -1;
    const score = !q ? (pet.huge ? 0 : 1) : name === q ? 0 : name.startsWith(q) ? 1 : index >= 0 ? 2 : 99;
    return { ...pet, score };
  }).filter(pet => !q || pet.score < 99)
    .sort((a, b) => a.score - b.score || Number(b.huge) - Number(a.huge) || a.value.localeCompare(b.value, 'en'))
    .slice(0, max);
  return match.map(pet => ({
    name: `${pet.value}${pet.huge ? ' • HUGE / RARE' : ''}`.slice(0, 100),
    value: pet.value
  }));
}
