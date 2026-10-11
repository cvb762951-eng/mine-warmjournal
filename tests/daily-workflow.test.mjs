import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDefaultState, makeHabit } from '../model.js';
import { dailyTodoGroups, prepareDailyFocus, focusHasProgress, habitClickValue } from '../daily-workflow.js';

test('todo groups retain earlier, future and completed work without silently moving dates', () => {
  const state = { todos: [{ id:'old', date:'2026-10-07' }, { id:'now', date:'2026-10-08' }, { id:'later', date:'2026-10-10' }, { id:'done', date:'2026-10-08', completed:true, completedAt:1 }] };
  const before = structuredClone(state);
  const groups = dailyTodoGroups(state, '2026-10-08');
  assert.equal(groups.today[0].id, 'now'); assert.equal(groups.earlier[0].id, 'old');
  assert.equal(groups.later[0].id, 'later'); assert.equal(groups.completed[0].id, 'done');
  assert.deepEqual(state, before);
});

test('a concrete todo becomes the focus purpose without completing it or requiring a category', () => {
  const state = makeDefaultState(); state.todos = [{ id:'task', title:'读十页书', completed:false }];
  const before = structuredClone(state);
  const next = prepareDailyFocus(state, { todoId:'task', minutes:10 });
  assert.equal(next.timer.task, '读十页书'); assert.equal(next.timer.duration, 600);
  assert.equal(next.intent.todoId, 'task'); assert.equal(next.timer.running, false);
  assert.deepEqual(state, before);
});

test('paused or active focus is preserved when another task is selected', () => {
  const state = makeDefaultState(); state.timer.left -= 60;
  assert.equal(focusHasProgress(state), true);
  const before = structuredClone(state);
  assert.throws(() => prepareDailyFocus(state, { minutes:25 }), /还未结束/);
  assert.deepEqual(state, before);
});

test('a click records one cup or weekly occurrence instead of fabricating the full goal', () => {
  const water = makeHabit({ target:8, tracking:'tap', unit:'杯' });
  assert.equal(habitClickValue(water, 0), 1);
  assert.equal(habitClickValue(water, 3), 4);
  assert.equal(habitClickValue(makeHabit({ target:3, tracking:'tap', goalPeriod:'weekly' }), 0), 1);
  assert.equal(habitClickValue(makeHabit({ target:1, tracking:'tap' }), 1), 0);
  assert.equal(habitClickValue(makeHabit({ target:20, tracking:'quantity', unit:'分钟' }), 0), null);
});

test('invalid or already completed targets cannot become invisible links', () => {
  const state = makeDefaultState(); state.todos = [{ id:'done', title:'已完成', completed:true }];
  assert.throws(() => prepareDailyFocus(state, { todoId:'done' }), /已完成/);
  assert.throws(() => prepareDailyFocus(state, { habitId:'missing' }), /归档/);
});
