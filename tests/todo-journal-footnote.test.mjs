import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const habits = await readFile(new URL('../views/habits.js', import.meta.url), 'utf8');
const focus = await readFile(new URL('../views/focus.js', import.meta.url), 'utf8');
const journal = await readFile(new URL('../views/journal.js', import.meta.url), 'utf8');
const model = await readFile(new URL('../model.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('footnote contract lives in model normalize + append helper', () => {
  assert.match(model, /normalizeStringArray\(value\?\.footnotes, 12, 40\)/);
  assert.match(model, /export function appendJournalFootnote/);
  assert.match(model, /footnotes\.length \? \[\[day, entry\]\]/);
  assert.doesNotMatch(model, /entry\.content\s*=\s*[^;]*footnote/i);
});

test('complete paths offer opt-in footnote via shared helper', () => {
  assert.match(habits, /export function offerTodoJournalFootnote/);
  assert.match(habits, /registerHelper\('offerTodoJournalFootnote'/);
  assert.match(habits, /写进今天日记？/);
  assert.match(habits, /if \(markingDone && current\.completed\) await offerTodoJournalFootnote\(current\.title\)/);
  assert.match(habits, /if \(markingDone && todo\.completed\) await offerTodoJournalFootnote\(todo\.title\)/);
  assert.match(focus, /offerTodoJournalFootnote', todo\.title, \{ host: panel \}/);
});

test('reader shows footnotes after body and before footprints', () => {
  assert.match(journal, /journal-reader-footnotes/);
  assert.match(journal, /\$\{footnotesHtml\}[\s\S]*journal-reader-footprints/);
  assert.match(css, /#subpage-journal-reader \.journal-reader-footnotes/);
  assert.match(css, /\.todo-footnote-offer/);
});
