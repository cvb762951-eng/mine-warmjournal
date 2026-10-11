import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const snippets = await readFile(new URL('../views/snippets.js', import.meta.url), 'utf8');
const journal = await readFile(new URL('../views/journal.js', import.meta.url), 'utf8');
const ledgerStyles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const performanceStyles = await readFile(new URL('../performance.css', import.meta.url), 'utf8');

test('quick photo and memo modals use the shared editorial header structure', () => {
  assert.equal((snippets.match(/quick-modal-title-mark material-symbols-outlined/g) || []).length, 2);
  assert.match(snippets, /VISUAL MOMENT/);
  assert.match(snippets, /DAILY NOTE/);
  assert.match(performanceStyles, /\.quick-modal-title-mark\s*\{/);
  assert.match(performanceStyles, /\.quick-modal-card\s*\{[^}]*max-height:/);
});

test('Journal main-page add-photo action opens the picker without reopening journalForm', () => {
  assert.match(journal, /function addPhotosToJournal\(day\)/);
  assert.match(journal, /#journal-add-screen-photo.*addPhotosToJournal\(journalEditingDay\)/);
  assert.doesNotMatch(journal, /#journal-add-screen-photo.*journalForm\(dateKey\(\)\)/);
});

test('Ledger account selector uses one scoped focus ring', () => {
  assert.match(ledgerStyles, /#screen-ledger \.ledger-quick-account-wrap select:focus-visible[\s\S]{0,120}outline: 0/);
  assert.match(ledgerStyles, /#screen-ledger \.ledger-quick-account-wrap:focus-within/);
});
