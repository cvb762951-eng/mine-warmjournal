import assert from 'node:assert/strict';
import test from 'node:test';
import { isRegression, parseTapSummary } from '../scripts/ci-test-report.mjs';

const TAP = `
ok 1 - passes
not ok 2 - fails
# tests 2
# pass 1
# fail 1
# skipped 0
# cancelled 0
`;

test('能从 TAP 汇总里读出失败数', () => {
  const summary = parseTapSummary(TAP);
  assert.equal(summary.tests, 2);
  assert.equal(summary.pass, 1);
  assert.equal(summary.fail, 1);
});

test('只有失败数比基线更多才算退步', () => {
  assert.equal(isRegression(4, 3), true);
  assert.equal(isRegression(3, 3), false);
  assert.equal(isRegression(2, 5), false);
  assert.equal(isRegression(null, 1), false);
  assert.equal(isRegression(1, null), false);
});
