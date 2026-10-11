import assert from 'node:assert/strict';
import test from 'node:test';
import { activityForDate } from '../activity-log.js';

test('calibrate is a standalone zero-value activity event', () => {
  const events = activityForDate({
    sessions: [], todos: [], habits: [], habitCompletions: {}, snippets: [], journals: {}, media: [],
    transactions: [
      { id: 'cal-1', type: 'calibrate', date: '2026-08-10', createdAt: Date.parse('2026-08-10T12:00:00'), adjustment: 40, reasonTag: '平账核销' }
    ]
  }, '2026-08-10');
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'calibrate');
  assert.equal(events[0].value, 0);
  assert.match(events[0].summary, /平账/);
});
