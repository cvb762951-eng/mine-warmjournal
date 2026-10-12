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
  // 第三条入口：待办弹层里直接勾完成。
  // 2026-10-12 起待办与专注解耦，原来那条「专注结束确认这件事完成了」的入口已删除，
  // 换成弹层自己的勾（所有完成入口仍然共用同一个 helper）。
  const manager = habits.slice(habits.indexOf('export function todoManager'), habits.indexOf('export async function setTodoCompleted'));
  assert.match(manager, /offerTodoJournalFootnote\(todo\.title\)/, '弹层里勾完成也要给「写进日记」纸签');
  assert.doesNotMatch(focus, /offerTodoJournalFootnote/, '专注不再和待办挂钩，也不从专注提示完成待办');
});

test('reader shows footnotes after body and before footprints', () => {
  assert.match(journal, /journal-reader-footnotes/);
  assert.match(journal, /\$\{footnotesHtml\}[\s\S]*journal-reader-footprints/);
  assert.match(css, /#subpage-journal-reader \.journal-reader-footnotes/);
  assert.match(css, /\.todo-footnote-offer/);
});
