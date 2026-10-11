import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const habits = await readFile(new URL('../views/habits.js', import.meta.url), 'utf8');
const countdown = await readFile(new URL('../views/countdown.js', import.meta.url), 'utf8');
const media = await readFile(new URL('../views/media.js', import.meta.url), 'utf8');
const mine = await readFile(new URL('../views/mine.js', import.meta.url), 'utf8');
const timetable = await readFile(new URL('../views/timetable.js', import.meta.url), 'utf8');
const documents = await readFile(new URL('../views/documents.js', import.meta.url), 'utf8');
const ai = await readFile(new URL('../views/ai.js', import.meta.url), 'utf8');
const focus = await readFile(new URL('../views/focus.js', import.meta.url), 'utf8');
const section = styles.slice(styles.indexOf('/* 二级页美化续作'));

test('habit todo and countdown flows own scoped editorial modal classes', () => {
  for (const className of ['habit-manager-modal', 'habit-log-modal', 'habit-modal', 'todo-manager-modal', 'todo-form-modal']) {
    assert.match(habits, new RegExp(className));
    assert.match(section, new RegExp(`\\.modal\\.${className}`));
  }
  assert.match(countdown, /countdown-form-modal/);
  assert.match(section, /\.modal\.countdown-form-modal/);
});

test('secondary forms use existing paper assets instead of modern white cards', () => {
  for (const asset of ['secondary-page-canvas-v1.png', 'secondary-header-paper-v1.png', 'secondary-content-paper-v1.png', 'secondary-habit-accent-v1.png', 'secondary-focus-accent-v1.png', 'quick-control-ivory-v1.png', 'quick-control-sage-v1.png', 'quick-control-terracotta-v1.png']) {
    assert.match(section, new RegExp(asset.replace('.', '\\.')));
  }
  assert.match(section, /border-radius:0/);
  assert.match(section, /max-height:calc\(100dvh - 24px\)/);
  assert.match(section, /@media\(max-width:370px\)/);
});

test('all existing save delete image and navigation controls remain present', () => {
  for (const id of ['new-habit', 'adjust-habit-total', 'skip-habit-today', 'delete-habit', 'new-todo-modal', 'delete-todo']) assert.match(habits, new RegExp(id));
  for (const id of ['pick-countdown-image', 'remove-countdown-image', 'delete-countdown']) assert.match(countdown, new RegExp(id));
  assert.match(habits, /registerSubmitHandler\('habit-form'/);
  assert.match(habits, /registerSubmitHandler\('todo-form'/);
  assert.match(countdown, /registerSubmitHandler\('countdown-form'/);
});

test('todo form supports a custom date and manager renders every dated section', () => {
  assert.match(habits, /\['custom', '指定日期'/);
  assert.match(habits, /id="todo-custom-date" type="date"/);
  assert.match(habits, /dateChoice === 'custom' \? data\.get\('customDate'\)/);
  assert.match(habits, /dailyTodoGroups\(state\)/);
  for (const group of ['today','earlier','later','completed']) assert.ok(habits.includes('groups.' + group));
  assert.match(section, /todo-date-field input:checked\+span strong/);
  assert.match(section, /color:#fff0d8!important/);
});

test('media course profile settings backup and folder forms use scoped paper surfaces', () => {
  assert.match(media, /media-form-modal/);
  assert.match(media, /media-history-modal/);
  assert.match(timetable, /course-edit-modal/);
  for (const className of ['profile-modal', 'mine-background-modal', 'mine-data-modal', 'mine-snapshot-modal', 'mine-snapshot-confirm-modal', 'mine-backup-modal', 'mine-restore-modal']) assert.match(mine, new RegExp(className));
  assert.match(documents, /folder-modal/);
  for (const className of ['media-form-modal','course-edit-modal','profile-modal','mine-background-modal','mine-data-modal','mine-snapshot-modal','mine-backup-modal','mine-restore-modal','folder-modal']) assert.match(section, new RegExp(`\\.modal\\.${className}`));
  assert.match(section, /secondary-media-accent-v1\.png/);
});

test('AI reminder timer ambient and focus history settings finish the scoped paper system', () => {
  for (const className of ['ai-settings-modal', 'reminder-modal', 'ai-memory-import-modal']) assert.match(ai, new RegExp(className));
  for (const className of ['timer-settings-modal', 'ambient-modal', 'focus-history-modal']) assert.match(focus, new RegExp(className));
  for (const className of ['ai-settings-modal','reminder-modal','timer-settings-modal','ambient-modal','focus-history-modal','ai-memory-import-modal']) assert.match(section, new RegExp(`\\.modal\\.${className}`));
  assert.match(section, /ai-companion-canvas-v1\.png/);
  assert.match(ai, /registerSubmitHandler\('ai-settings-form'/);
  assert.match(focus, /registerSubmitHandler\('timer-settings-form'/);
});
