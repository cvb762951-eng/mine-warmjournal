// Unsaved journal text stays separate from the published diary. The settings copy is
// included in SQLite/portable backups; localStorage is an immediate crash fallback.
const CACHE_KEY = 'mine-warmjournal-journal-drafts-v1';
const validDay = day => /^\d{4}-\d{2}-\d{2}$/.test(String(day || ''));

function normalizeDraft(value) {
  if (!value || typeof value !== 'object') return null;
  const updatedAt = Number(value.updatedAt) || 0;
  if (updatedAt <= 0) return null;
  return {
    title: String(value.title || '').slice(0, 120),
    body: String(value.body || '').slice(0, 4000),
    mood: String(value.mood || '').slice(0, 40),
    weather: String(value.weather || '').slice(0, 40),
    photos: Array.isArray(value.photos) ? value.photos.filter(photo => typeof photo === 'string' && photo).slice(0, 60) : [],
    tags: Array.isArray(value.tags) ? value.tags.filter(tag => typeof tag === 'string' && tag).slice(0, 8) : [],
    summary: String(value.summary || '').slice(0, 120),
    updatedAt
  };
}

function readCache() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function compact(drafts) {
  const entries = Object.entries(drafts)
    .filter(([day, draft]) => validDay(day) && normalizeDraft(draft))
    .map(([day, draft]) => [day, normalizeDraft(draft)]);
  return Object.fromEntries(entries);
}

export function journalDraftFor(state, day) {
  if (!validDay(day)) return null;
  const stored = normalizeDraft(state.settings?.journalDrafts?.[day]);
  const cached = normalizeDraft(readCache()[day]);
  const draft = (cached?.updatedAt || 0) > (stored?.updatedAt || 0) ? cached : stored;
  if (!draft || draft.updatedAt <= Number(state.journals?.[day]?.updatedAt || 0)) return null;
  state.settings.journalDrafts ||= {};
  state.settings.journalDrafts[day] = draft;
  return draft;
}

export function recoverJournalDraftCache(state) {
  const cached = readCache();
  let recovered = 0;
  state.settings.journalDrafts ||= {};
  for (const [day, value] of Object.entries(cached)) {
    if (!validDay(day)) continue;
    const draft = normalizeDraft(value);
    if (!draft || draft.updatedAt <= Number(state.journals?.[day]?.updatedAt || 0)) continue;
    if (draft.updatedAt <= Number(state.settings.journalDrafts[day]?.updatedAt || 0)) continue;
    state.settings.journalDrafts[day] = draft;
    recovered++;
  }
  return recovered;
}

export function recordJournalDraft(state, day, values) {
  if (!validDay(day)) throw new Error('日记日期无效');
  state.settings.journalDrafts ||= {};
  const previous = state.settings.journalDrafts[day];
  const updatedAt = Math.max(Date.now(), Number(previous?.updatedAt || 0) + 1, Number(state.journals?.[day]?.updatedAt || 0) + 1);
  const draft = normalizeDraft({ ...values, updatedAt });
  state.settings.journalDrafts = compact({ ...state.settings.journalDrafts, [day]: draft });
  try {
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(compact({ ...readCache(), [day]: draft })));
    return { draft, cached: Boolean(globalThis.localStorage) };
  } catch { return { draft, cached: false }; }
}

export function clearJournalDraft(state, day, { keepCache = false } = {}) {
  if (!validDay(day)) return;
  if (state.settings?.journalDrafts) delete state.settings.journalDrafts[day];
  if (keepCache) return;
  try {
    const cache = readCache();
    delete cache[day];
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* The saved diary remains authoritative even if cache cleanup fails. */ }
}

export function clearJournalDraftCache() {
  try { globalThis.localStorage?.removeItem(CACHE_KEY); }
  catch { /* The restored settings copy is still authoritative. */ }
}
