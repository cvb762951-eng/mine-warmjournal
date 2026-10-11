import test from 'node:test';
import assert from 'node:assert/strict';
import { insightDataFingerprint, rollingWeekSummaryAnchor } from './context.js';
import { buildPeriodContext } from './generate.js';

test('insight fingerprint follows real habit records but ignores its own cache', () => {
  const state = { sessions: [], journals: {}, todos: [], transactions: [], checks: { '2026-08-16': { read: 1 } }, habitCompletions: {}, habitSkips: {}, settings: { aiDailyInsight: { text: '旧洞察' } } };
  const first = insightDataFingerprint(state, '2026-08-16');
  state.settings.aiDailyInsight = { text: '新洞察' };
  assert.equal(insightDataFingerprint(state, '2026-08-16'), first);
  state.checks['2026-08-16'].read = 2;
  assert.notEqual(insightDataFingerprint(state, '2026-08-16'), first);
  assert.equal(insightDataFingerprint(state, '2026-08-16'), insightDataFingerprint(state, '2026-08-16'));
});

test('rolling weekly summary always anchors on yesterday', () => {
  assert.equal(rollingWeekSummaryAnchor(new Date('2026-08-17T02:00:00')).toISOString().slice(0, 10), '2026-08-16');
  assert.equal(rollingWeekSummaryAnchor(new Date('2026-08-19T02:00:00')).toISOString().slice(0, 10), '2026-08-18');
});

test('weekly summary context excludes records after its range', () => {
  const state = { sessions: [{ date: '2026-08-17', minutes: 30 }, { date: '2026-08-18', minutes: 45 }, { date: '2026-08-19', minutes: 99 }], journals: { '2026-08-19': { content: '今天不应出现' } }, todos: [], transactions: [] };
  const monday = buildPeriodContext(state, '2026-08-10', '2026-08-16');
  const midweek = buildPeriodContext(state, '2026-08-17', '2026-08-18');
  assert.ok(!monday.includes('2026-08-17'));
  assert.ok(midweek.includes('2026-08-17') && midweek.includes('2026-08-18'));
  assert.ok(!midweek.includes('2026-08-19') && !midweek.includes('今天不应出现'));
});
