import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { journalDraftFor, recordJournalDraft, clearJournalDraft, recoverJournalDraftCache, clearJournalDraftCache } from '../journal-drafts.js';

const values = new Map();
globalThis.localStorage = {
  getItem(key) { return values.get(key) ?? null; },
  setItem(key, value) { values.set(key, value); },
  removeItem(key) { values.delete(key); }
};
const state = () => ({ settings: { journalDrafts: {} }, journals: { '2026-10-07': { content: '旧日记', photos: [], updatedAt: 100 } } });

test('journal drafts survive reopening and remain separate from the published diary', () => {
  values.clear();
  const current = state();
  const result = recordJournalDraft(current, '2026-10-07', { title: '未完成', body: '还要继续写', mood: 'happy', photos: ['mine-media://draft.jpg'] });
  assert.equal(result.cached, true);
  assert.equal(current.journals['2026-10-07'].content, '旧日记');
  assert.equal(current.settings.journalDrafts['2026-10-07'].photos[0], 'mine-media://draft.jpg');

  const restarted = state();
  assert.equal(recoverJournalDraftCache(restarted), 1);
  const recovered = journalDraftFor(restarted, '2026-10-07');
  assert.equal(recovered.body, '还要继续写');
  assert.equal(restarted.settings.journalDrafts['2026-10-07'].title, '未完成');
  clearJournalDraft(restarted, '2026-10-07');
  assert.equal(journalDraftFor(restarted, '2026-10-07'), null);
  assert.equal(restarted.journals['2026-10-07'].content, '旧日记');
  clearJournalDraftCache();
  assert.equal(values.size, 0);
});

test('an older crash cache never overwrites a newer formally saved journal', () => {
  values.clear();
  const current = state();
  const { draft } = recordJournalDraft(current, '2026-10-07', { body: '过时草稿' });
  current.journals['2026-10-07'] = { content: '正式新版', updatedAt: draft.updatedAt + 1 };
  assert.equal(journalDraftFor(current, '2026-10-07'), null);
});

test('drafts are in the backed-up settings section and their photo refs are protected from media cleanup', async () => {
  const model = await readFile(new URL('../model.js', import.meta.url), 'utf8');
  const storage = await readFile(new URL('../storage.js', import.meta.url), 'utf8');
  const media = await readFile(new URL('../media-store.js', import.meta.url), 'utf8');
  const view = await readFile(new URL('../views/journal.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const mine = await readFile(new URL('../views/mine.js', import.meta.url), 'utf8');
  assert.match(model, /journalDrafts: \{\}/);
  assert.match(storage, /'settings'/);
  assert.match(media, /state\.settings\.journalDrafts/);
  assert.match(view, /clearJournalDraft\(state, day, \{ keepCache: true \}\);\s*await save\(\)/);
  assert.match(view, /if \(previousDraft\) state\.settings\.journalDrafts\[day\] = previousDraft/);
  assert.match(app, /recoverJournalDraftCache\(state\)/);
  assert.match(mine, /clearJournalDraftCache\(\)/);
});
