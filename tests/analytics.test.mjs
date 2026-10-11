import assert from 'node:assert/strict';
import test from 'node:test';
import { warmWeeklyLifeMetrics, habitArchiveMetrics } from '../analytics.js';
import { makeDefaultState, makeHabit, habitHeatmapData } from '../model.js';

const range = { start: '2026-08-10', end: '2026-08-16', weekNumber: 33 };

test('weekly archive counts a completed week once even when later days retain its completed progress', () => {
  const state = makeDefaultState();
  state.habits = [makeHabit({ id: 'weekly', name: '每周三次', goalPeriod: 'weekly', target: 3 })];
  state.checks = { '2026-10-05': { weekly: 3 } };
  const before = structuredClone(state);
  const metrics = habitArchiveMetrics(state, 'weekly', 2026, habitHeatmapData(state, 'weekly', 2026), new Date('2026-10-08T12:00:00'));
  assert.equal(metrics.completedDays, 4, 'daily compatibility field still contains four completed dates');
  assert.equal(metrics.completedPeriods, 1, 'UI must show one completed week, not four weeks');
  assert.equal(metrics.rateUnit, '周');
  assert.deepEqual(state, before, 'presentation metrics must not alter records');
});

test('archive exposes the existing goal-completion streak rather than losing it or using partial activity', () => {
  const state = makeDefaultState();
  state.habits = [makeHabit({ id: 'daily', name: '每天两次', target: 2 })];
  state.checks = { '2026-10-05': { daily: 1 }, '2026-10-06': { daily: 2 }, '2026-10-07': { daily: 2 }, '2026-10-08': { daily: 2 } };
  const metrics = habitArchiveMetrics(state, 'daily', 2026, habitHeatmapData(state, 'daily', 2026), new Date('2026-10-08T12:00:00'));
  assert.deepEqual(metrics.streak, { current: 3, longest: 3 });
  assert.equal(metrics.completedPeriods, 3);
  assert.equal(metrics.rateUnit, '天');
});
const baseState = () => ({
  sessions: [
    { id: 'previous', date: '2026-08-03', minutes: 30 },
    { id: 'current', date: '2026-08-10', durationSeconds: 3600 }
  ],
  habits: [], checks: {}, journals: {}, media: [],
  settings: { ledgerBudget: { start: '2026-08-01', end: '2026-08-31', total: 100, categories: {} } },
  transactions: [
    { id: 'before', type: 'expense', amount: 30, date: '2026-08-05', accountId: 'unassigned' },
    { id: 'week', type: 'expense', amount: 20, date: '2026-08-10', accountId: 'unassigned' },
    { id: 'transfer', type: 'transfer', amount: 999, date: '2026-08-11', sourceAccountId: 'a', targetAccountId: 'b' },
    { id: 'calibrate', type: 'calibrate', adjustment: 999, amount: 999, date: '2026-08-12', accountId: 'a' }
  ],
  ledgerAccounts: []
});

test('warm weekly metrics returns seven real focus days and prior-week difference', () => {
  const metrics = warmWeeklyLifeMetrics(baseState(), range);
  assert.equal(metrics.dailyFocus.length, 7);
  assert.equal(metrics.dailyFocus[0].minutes, 60);
  assert.deepEqual(metrics.dailyFocus.slice(1).map(item => item.minutes), [0, 0, 0, 0, 0, 0]);
  assert.equal(metrics.focus.previousMinutes, 30);
  assert.equal(metrics.focus.differenceMinutes, 30);
});

test('warm weekly metrics keeps prior budget spending and excludes transfer/calibrate', () => {
  const metrics = warmWeeklyLifeMetrics(baseState(), range);
  assert.equal(metrics.ledger.totalExpense, 20);
  assert.equal(metrics.ledger.budgetSpentToRangeEnd, 50);
  assert.equal(metrics.ledger.remainingBudget, 50);
  assert.equal(metrics.ledger.transactionCount, 1);
});

test('warm weekly metrics returns zero KPIs and empty source arrays for an empty week', () => {
  const metrics = warmWeeklyLifeMetrics({ sessions: [], habits: [], checks: {}, transactions: [], journals: {}, media: [], ledgerAccounts: [], settings: { ledgerBudget: {} } }, range);
  assert.equal(metrics.dailyFocus.length, 7);
  assert.ok(metrics.dailyFocus.every(item => item.minutes === 0));
  assert.equal(metrics.focus.totalMinutes, 0);
  assert.equal(metrics.ledger.totalExpense, 0);
  assert.equal(metrics.journals.count, 0);
  assert.deepEqual(metrics.media.completedItems, []);
});
