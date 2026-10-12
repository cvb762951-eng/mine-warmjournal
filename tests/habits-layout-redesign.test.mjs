import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const today = await readFile(new URL('../views/today.js', import.meta.url), 'utf8');
const habits = await readFile(new URL('../views/habits.js', import.meta.url), 'utf8');
const motion = await readFile(new URL('../motion.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const plain = await readFile(new URL('../themes-plain.css', import.meta.url), 'utf8');

test('Today habit cards keep name, today status, streak, and a large check button', () => {
  assert.match(today, /function habitCardHtml\(habit, day\)/);
  assert.match(today, /function habitDayStreak\(habit,/);
  assert.match(today, /class="habit-card/);
  assert.match(today, /class="habit-check-btn/);
  assert.match(today, /data-habit="\$\{habit\.id\}"/);
  assert.match(today, /data-habit-open="\$\{habit\.id\}"/);
  assert.match(today, /habit-card-meta/);
  assert.match(today, /已连续 \$\{streak\} 天/);
  assert.doesNotMatch(today, /local_fire_department/);
  assert.match(today, /habit-check-dot/);
  assert.match(today, /今日已打卡|今日未打卡/);
  assert.doesNotMatch(today, /function habitProgressHtml/);
  assert.doesNotMatch(today, /habit-mini-row/);
});

test('Habit check-in binding stays on the large button; detail opens from the card body', () => {
  assert.match(habits, /\.habit-check-btn\[data-habit\]/);
  assert.match(habits, /\[data-habit-open\]/);
  assert.match(habits, /pendingHabitCelebrateId/);
  assert.match(habits, /celebrateHabitCheck/);
  assert.match(habits, /habitClickValue/);
  assert.match(habits, /commitHabitProgress/);
  assert.match(habits, /stopPropagation/);
  assert.match(habits, /pointerdown/);
  // 侧滑只绑在卡面；位移写在该 button.style.transform 上，不碰打卡钮
  assert.match(habits, /bindHabitSwipe\(button\)/);
  assert.match(habits, /button\.style\.transform = `translateX/);
  assert.doesNotMatch(habits, /habit-check-btn[\s\S]{0,200}bindHabitSwipe/);
});

test('Check button stays visually isolated from card-face swipe translate', () => {
  assert.match(css, /\.today-view \.habit-check-btn\s*\{[\s\S]*?isolation:\s*isolate/);
  assert.match(css, /\.today-view \.habit-check-btn\s*\{[\s\S]*?z-index:\s*2/);
  assert.match(css, /\.today-view \.habit-card\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(css, /\.today-view \.habit-card-main\s*\{[\s\S]*?will-change:\s*transform/);
});

test('Habit success motion reuses motion.js transform/opacity helpers and respects reduced motion', () => {
  assert.match(motion, /export function celebrateHabitCheck\(button\)/);
  assert.match(motion, /canAnimate\(\)/);
  assert.match(motion, /habit-check-dot/);
  assert.match(motion, /'\.habit-card'/);
  assert.match(motion, /'\.habit-check-btn'/);
  assert.match(css, /@keyframes habitCheckPop/);
  assert.match(css, /\.today-view \.habit-check-dot\s*\{[\s\S]*?width:\s*22px/);
  assert.match(css, /\.today-view \.habit-card\s*\{[\s\S]*?background:\s*transparent/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\.today-view \.habit-check-btn\s*\{[\s\S]*?width:\s*48px/);
  assert.match(css, /border-radius:\s*var\(--radius-soft\)/);
  const redesign = css.slice(css.lastIndexOf('习惯页版式重做'));
  assert.match(redesign, /habitCheckPop/);
  assert.doesNotMatch(redesign, /filter:\s*blur\(/);
  assert.doesNotMatch(redesign, /@keyframes[^{]+\{[^}]*box-shadow/);
});

test('Plain theme keeps soft radius and existing paper/blue language for habit cards', () => {
  assert.match(plain, /:root\[data-theme="plain"\] \.today-view \.habit-card/);
  assert.match(plain, /:root\[data-theme="plain"\] \.today-view \.habit-check-btn/);
  assert.match(plain, /var\(--radius-soft\)/);
});

import { habitOneTapValue } from '../daily-workflow.js';

test('One tap completes a boolean habit; tapping again undoes to 0', () => {
  const habit = { tracking: 'tap', target: 1 };
  const fill = habitOneTapValue(habit, 0, 0, null);
  assert.deepEqual(fill, { action: 'fill', next: 1, prior: 0 });
  const undo = habitOneTapValue(habit, 1, 1, fill.prior);
  assert.equal(undo.action, 'undo');
  assert.equal(undo.next, 0);
});

test('One tap fills a quantity habit to target; undo returns to 0', () => {
  const habit = { tracking: 'log', target: 20, unit: '分钟' };
  const fill = habitOneTapValue(habit, 0, 0, null);
  assert.deepEqual(fill, { action: 'fill', next: 20, prior: 0 });
  assert.equal(habitOneTapValue(habit, 20, 20, fill.prior).next, 0);
});

test('Partial log, then fill, then undo restores the partial value', () => {
  const habit = { tracking: 'log', target: 20, unit: '分钟' };
  const fill = habitOneTapValue(habit, 10, 10, null);
  assert.deepEqual(fill, { action: 'fill', next: 20, prior: 10 });
  assert.equal(habitOneTapValue(habit, 20, 20, fill.prior).next, 10);
  // 没有记忆（比如重启后）时撤销归零；记忆不可信（≥ 当前值）也归零
  // 没有可信记忆时不静默清零，交给确认弹窗
  assert.equal(habitOneTapValue(habit, 20, 20, 25).action, 'confirm');
});

test('Weekly habit: one tap only tops up today to reach the week target', () => {
  const habit = { tracking: 'tap', target: 5, goalPeriod: 'weekly' };
  assert.deepEqual(habitOneTapValue(habit, 0, 3, null), { action: 'fill', next: 2, prior: 0 });
});

test('Manual full in detail, then tap -> confirm, never silent clear', () => {
  const habit = { tracking: 'log', target: 20 };
  assert.deepEqual(habitOneTapValue(habit, 20, 20, null), { action: 'confirm', next: 0, prior: null });
  assert.equal(habitOneTapValue({ tracking: 'tap', target: 1 }, 1, 1, null).action, 'confirm');
});

test('After restart (no in-session prior) a completed habit asks to confirm', () => {
  const habit = { tracking: 'log', target: 20 };
  const fill = habitOneTapValue(habit, 10, 10, null);
  // 重启后内存 Map 为空，remembered = null
  assert.equal(habitOneTapValue(habit, 20, 20, null).action, 'confirm');
  assert.deepEqual(habitOneTapValue(habit, 20, 20, fill.prior), { action: 'undo', next: 10, prior: null });
});

test('Weekly target met by earlier days with today 0 -> not undo', () => {
  const habit = { tracking: 'tap', target: 3, goalPeriod: 'weekly' };
  assert.equal(habitOneTapValue(habit, 0, 3, null).action, 'noop');
  assert.equal(habitOneTapValue(habit, 0, 3, null).next, 0);
});

test('Check button: confirm uses existing dialog, noop shows toast', () => {
  assert.match(habits, /confirmDelete\([\s\S]{0,240}title: '清空今天的记录？'[\s\S]{0,80}confirmText: '清空'/);
  assert.match(habits, /本周已达标/);
});

test('Check button uses one-tap fill/undo, only writes today, celebrates only on increase', () => {
  assert.match(habits, /habitOneTapValue\(habit, todayValue, habitProgressForDate\(state, habit, day\)/);
  assert.match(habits, /habitOneTapPrior/);
  assert.match(habits, /const day = dateKey\(\);/);
  assert.match(habits, /if \(next > Number\(previous\[habitId\] \|\| 0\)\) pendingHabitCelebrateId = habitId/);
  assert.match(today, /点勾补满/);
});

test('习惯 / 待办列表不显示滚动条', () => {
  // 2026-10-12 用户要求「习惯页不要有滑条」：原先这里是 scrollbar-width:thin
  // 加一条 3px 宽的滑块，列表旁边会露出一根细条。
  assert.match(css, /\.today-view #habits-bento-list,\s*\.today-view #todos-bento-list\{[^}]*scrollbar-width:none/,
    '不再画滚动条');
  // 只要求「这两条列表的规则里没有 thin」；别处（其它容器）用 thin 与我们无关
  const habitsRule = css.slice(css.indexOf('.today-view #habits-bento-list'), css.indexOf('::-webkit-scrollbar{display:none;width:0;height:0}'));
  assert.doesNotMatch(habitsRule, /scrollbar-width:thin/, '这两条列表不再用细滚动条');
  assert.match(css, /#habits-bento-list::-webkit-scrollbar,[\s\S]{0,90}#todos-bento-list::-webkit-scrollbar\{display:none/,
    'WebKit 内核也要隐藏');
  assert.doesNotMatch(css, /::-webkit-scrollbar-thumb\{[\s\S]{0,90}rgba\(49,91,73,\.42\)/, '滑块规则已删除');
  // 只是不画出来，滚动本身还在
  assert.match(css, /\.today-view #habits-bento-list,\s*\.today-view #todos-bento-list\{[^}]*overflow-y:auto/,
    '仍然可以滚动');
});
