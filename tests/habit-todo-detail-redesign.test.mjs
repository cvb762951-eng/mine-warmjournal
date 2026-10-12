import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const habits = await readFile(new URL('../views/habits.js', import.meta.url), 'utf8');
const today = await readFile(new URL('../views/today.js', import.meta.url), 'utf8');
const core = await readFile(new URL('../core.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const motion = await readFile(new URL('../motion.js', import.meta.url), 'utf8');

test('habit detail is a light sheet reusing streak/heatmap data', () => {
  assert.match(habits, /'habit-log-modal detail-sheet habit-sheet'/);
  assert.match(habits, /habitDayStreak\(habit, day\)/);
  assert.match(habits, /callHelper\('habitHeatmapData'/);
  assert.match(habits, /id="habit-sheet-tick"/);
  assert.match(habits, /data-hs-step/);
  assert.doesNotMatch(habits, /local_fire_department/);
});

test('todo detail has small round tick and quiet delete', () => {
  assert.match(habits, /'todo-form-modal detail-sheet todo-sheet'/);
  assert.match(habits, /id="todo-sheet-tick"/);
  assert.match(habits, /setTodoCompleted\(current\.id, markingDone\)/);
});

test('confirmDelete stays backward compatible and accepts custom wording', () => {
  assert.match(core, /export function confirmDelete\(message, action, options = \{\}\)/);
  assert.match(core, /title = '确认删除'/);
  assert.match(core, /confirmText = '删除'/);
});

test('today habit meta wraps up to two lines instead of truncating', () => {
  assert.match(css, /\.today-view \.habit-card-meta \{[^}]*-webkit-line-clamp: 2/);
  assert.match(today, /<span>已连续 \$\{streak\} 天<\/span>/);
});

test('detail sheet motion goes through autoStagger and respects reduced motion', () => {
  assert.match(motion, /'\.detail-sheet-row'/);
  assert.match(css, /prefers-reduced-motion: reduce\)[\s\S]{0,200}hs-tick/);
});
