import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeReminderStatus as d } from '../views/reminder-status.js';

test('提醒状态文案按真实状态显示', () => {
  assert.equal(d({ permission: 'granted', exactAlarm: 'granted', scheduledCount: 42, lastError: null }, 2).right, '已生效 2 项');
  const noPerm = d({ permission: 'denied', exactAlarm: 'granted', scheduledCount: 0 }, 1);
  assert.equal(noPerm.action.kind, 'notification');
  assert.match(noPerm.note, /通知权限未开启/);
  const noExact = d({ permission: 'granted', exactAlarm: 'denied', scheduledCount: 21 }, 1);
  assert.equal(noExact.action.kind, 'exact');
  assert.equal(noExact.right, '已生效 1 项');
  assert.match(noExact.note, /精确闹钟未开启，提醒可能延迟/);
  assert.equal(d({ permission: 'granted', exactAlarm: 'granted', scheduledCount: 3, lastError: 'boom' }, 1).action, null);
  assert.equal(d({ permission: 'unsupported', exactAlarm: 'unavailable', scheduledCount: 0 }, 2).action, null);
  assert.equal(d(null, 0).right, '未开启');
});

test('设置页不再盲写「已开启」，回前台会刷新', () => {
  const mine = readFileSync(new URL('../views/mine.js', import.meta.url), 'utf8');
  assert.doesNotMatch(mine, /已开启 \$\{reminderCount\}/);
  assert.match(mine, /import \{[^}]*getReminderStatus[^}]*openExactAlarmSettings[^}]*openNotificationSettings[^}]*\} from '\.\.\/notifications\.js'/);
  assert.doesNotMatch(mine, /callHelper\('(getReminderStatus|openExactAlarmSettings|openNotificationSettings)'/);
  assert.match(mine, /reminders:synced[\s\S]{0,120}refreshReminderStatus/);
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /syncScheduledReminders\([\s\S]{0,200}finally\([\s\S]{0,80}reminders:synced/);
  assert.match(app, /syncScheduledReminders\(\{ requestPermission: true \}\)[\s\S]{0,300}finally\([\s\S]{0,80}reminders:synced/, '冷启动排程结束后也要发 reminders:synced');
  const notifications = readFileSync(new URL('../notifications.js', import.meta.url), 'utf8');
  for (const name of ['getReminderStatus', 'openExactAlarmSettings', 'openNotificationSettings']) assert.match(notifications, new RegExp(`export async function ${name}\\(`));
  assert.doesNotMatch(notifications, /from '\.\/views\/mine\.js'/, 'notifications.js 不能反向依赖 mine.js（避免循环引用）');
});
