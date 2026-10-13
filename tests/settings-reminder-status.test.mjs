import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeReminderStatus as d } from '../views/reminder-status.js';

test('提醒状态文案按真实状态显示', () => {
  assert.equal(d({ permission: 'granted', exactAlarm: 'granted', scheduledCount: 21, lastError: null }, 1).right, '已排好 21 条提醒');
  const noPerm = d({ permission: 'denied', exactAlarm: 'granted', scheduledCount: 0 }, 1);
  assert.equal(noPerm.action.kind, 'notification');
  assert.match(noPerm.note, /通知权限未开启/);
  const noExact = d({ permission: 'granted', exactAlarm: 'denied', scheduledCount: 21 }, 1);
  assert.equal(noExact.action.kind, 'exact');
  assert.match(noExact.note, /精确闹钟未开启，提醒可能延迟/);
  assert.equal(d({ permission: 'granted', exactAlarm: 'granted', scheduledCount: 3, lastError: 'boom' }, 1).action, null);
  assert.equal(d({ permission: 'unsupported', exactAlarm: 'unavailable', scheduledCount: 0 }, 2).action, null);
  assert.equal(d(null, 0).right, '未开启');
});

test('设置页不再盲写「已开启」，回前台会刷新', () => {
  const mine = readFileSync(new URL('../views/mine.js', import.meta.url), 'utf8');
  assert.doesNotMatch(mine, /已开启 \$\{reminderCount\}/);
  assert.match(mine, /callHelper\('getReminderStatus'\)/);
  assert.match(mine, /visibilitychange[\s\S]{0,200}refreshReminderStatus/);
});
