import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../views/calendar.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../performance.css', import.meta.url), 'utf8');
const metaSource = source.slice(source.indexOf('const CALENDAR_EVENT_META'), source.indexOf('// 当天全部图片'));
const presentationSource = source.slice(source.indexOf('export function calendarEventPresentation'), source.indexOf('export function calendarArchiveEvents')).replace('export ', '');
const present = Function(`${metaSource}\n${presentationSource}\nreturn calendarEventPresentation;`)();

test('Calendar archive filters dedicated journal and habit sections but keeps quick photos', () => {
  assert.match(source, /\!\['journal', 'habit'\]\.includes\(event\.kind\)/);
  assert.doesNotMatch(source, /\!\['journal', 'photo', 'habit'\]\.includes\(event\.kind\)/);
  assert.match(source, /archiveEvents\.map\(calendarArchiveEvent\)\.join\(''\)/);
  assert.doesNotMatch(source, /archiveEvents\.slice\(0,\s*6\)/);
  assert.doesNotMatch(source, /最近 6 条/);
  assert.match(source, /当天活动/);
  assert.match(source, /archiveEvents\.length/);
});

test('Calendar archive maps every supported event kind by semantic identity', () => {
  const expected = {
    focus: 'timer', habit: 'check_circle', journal: 'menu_book', note: 'edit_note',
    photo: 'photo_camera', todo: 'task_alt', book: 'menu_book', movie: 'movie',
    expense: 'receipt_long', income: 'payments', transfer: 'swap_horiz', calibrate: 'balance'
  };
  for (const [kind, icon] of Object.entries(expected)) {
    assert.match(source, new RegExp(`${kind}: \\{ icon: '${icon}'`), `${kind} should map to ${icon}`);
  }
  assert.match(source, /\{ icon: 'history', tone: 'neutral', label: '生活记录' \}/);
});

test('Calendar archive cards keep source event ids and route through the public helper', () => {
  assert.match(source, /data-calendar-event="\$\{esc\(event\.id\)\}"/);
  assert.match(source, /callHelper\('openCalendarEvent', button\.dataset\.calendarEvent\)/);
});

test('Calendar habit completion remains a single compact summary', () => {
  assert.match(source, /class="cal-habit-summary"/);
  assert.match(source, /detail\.completedHabits\.length/);
  assert.match(source, /filter\(event => !\['journal', 'habit'\]\.includes/);
});

test('note promotes real text above the generic event type', () => {
  assert.deepEqual(present({ kind: 'note', title: '随手记', summary: '真好' }), {
    icon: 'edit_note', tone: 'terracotta', label: '随手记', primary: '真好', secondary: '', accent: ''
  });
});

test('note safely falls back to its title when real text is empty', () => {
  assert.equal(present({ kind: 'note', title: '随手记', summary: '' }).primary, '随手记');
});

test('todo keeps task text primary and completion state secondary', () => {
  const result = present({ kind: 'todo', title: '整理旅行清单', summary: '已完成' });
  assert.equal(result.primary, '整理旅行清单');
  assert.equal(result.secondary, '已完成');
});

test('focus keeps task primary and duration or mode secondary', () => {
  const result = present({ kind: 'focus', title: '深度阅读', summary: '45分钟 · focus' });
  assert.equal(result.primary, '深度阅读');
  assert.equal(result.secondary, '45分钟 · focus');
});

test('book and movie use work title before completion metadata', () => {
  assert.equal(present({ kind: 'book', title: '人类简史', summary: '5 星' }).primary, '人类简史');
  assert.equal(present({ kind: 'movie', title: '海街日记', summary: '已完成' }).secondary, '已完成');
});

test('expense and income separate their amount as a compact accent', () => {
  const expense = present({ kind: 'expense', title: '午餐', summary: '支出 ¥36.00' });
  const income = present({ kind: 'income', title: '稿费', summary: '收入 ¥500.00' });
  assert.deepEqual([expense.primary, expense.accent, expense.secondary], ['午餐', '支出 ¥36.00', '']);
  assert.deepEqual([income.primary, income.accent, income.secondary], ['稿费', '收入 ¥500.00', '']);
});

test('transfer and calibration explicitly stay outside income and expense', () => {
  assert.match(present({ kind: 'transfer', title: '账户转账', summary: '现金转储蓄' }).secondary, /不计收支/);
  assert.match(present({ kind: 'calibrate', title: '账户平账', summary: '余额校准' }).secondary, /不计收支/);
});

test('unknown event types retain a safe title and summary fallback', () => {
  const result = present({ kind: 'other', title: '生活片段', summary: '一条真实记录' });
  assert.deepEqual([result.label, result.primary, result.secondary], ['生活记录', '生活片段', '一条真实记录']);
});

test('Calendar activity renders an editorial Chronicle timeline instead of large icon cards', () => {
  assert.match(source, /LIFE CHRONICLE/);
  assert.match(source, /class="cal-archive-time"/);
  assert.match(source, /class="cal-archive-axis"/);
  assert.match(source, /class="cal-archive-paper"/);
  assert.match(styles, /grid-template-columns:36px 28px minmax\(0,1fr\)/);
  assert.match(styles, /\.cal-archive-node\{[^}]*width:28px;height:28px/);
  assert.doesNotMatch(styles, /\.cal-archive-icon\{/);
});

test('Calendar journal parsing promotes the stored title and removes it from the body preview', () => {
  const parseSource = source.slice(source.indexOf('export function calendarJournalContent'), source.indexOf('function calendarArchiveEvent(event)')).replace('export ', '');
  const parse = Function(`${parseSource}\nreturn calendarJournalContent;`)();
  assert.deepEqual(parse('《大三初始》\n\n今天开始新的学期。'), { title: '大三初始', body: '今天开始新的学期。' });
  assert.deepEqual(parse('没有标题的旧日记'), { title: '', body: '没有标题的旧日记' });
});

test('Calendar journal card uses the parsed title and body variables', () => {
  assert.match(source, /生活随笔《\$\{esc\(journalTitle\)\}》/);
  assert.match(source, /journalBody\.slice\(0, 120\)/);
  assert.match(source, /const journalTitle = journalContent\.title \|\| '这一天'/);
});
