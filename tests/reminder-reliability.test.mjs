import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const notifications = read('notifications.js');
const app = read('app.js');
const ai = read('views/ai.js');
const countdown = read('views/countdown.js');
const plan = read('reminder-plan.js');

function sliceFn(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `找不到 ${start}`);
  const to = end ? source.indexOf(end, from) : source.length;
  return source.slice(from, to > from ? to : source.length);
}

test('提醒状态接口从 notifications.js 导出', () => {
  assert.match(notifications, /export async function getReminderStatus\(\)/);
  assert.match(notifications, /export async function openExactAlarmSettings\(\)/);
  assert.match(notifications, /export async function openNotificationSettings\(\)/);
  assert.match(notifications, /checkExactNotificationSetting\(\)/);
  assert.match(notifications, /permission, exactAlarm, scheduledCount, lastError/);
  assert.match(notifications, /item\?\.time/);
  assert.doesNotMatch(notifications, /repeats:/);
  assert.match(plan, /daily-reminder-v2/);
  assert.match(plan, /random-reminder-v2/);
  assert.match(plan, /countdown-reminder-v2/);
  assert.match(notifications, /importance: 4, vibration: true/);
});

test('先排上新的每日闹钟，失败时不取消原来的', () => {
  const fn = sliceFn(notifications, 'export async function scheduleDailyReminders', 'export async function cancelDailyReminders');
  const scheduleAt = fn.indexOf('await scheduleAlarms(alarms)');
  const cancelAt = fn.indexOf('await cancelStale', scheduleAt);
  assert.ok(scheduleAt > 0 && cancelAt > scheduleAt);
  const denied = fn.indexOf('通知权限未授予，原来的提醒还留着');
  assert.ok(denied > 0);
  assert.equal(fn.slice(0, denied).includes('await scheduleAlarms'), false);
  assert.match(fn, /!list\.length/);
});

test('随机提醒权限失败不会写成已排，成功后才取消 25400 段', () => {
  const fn = sliceFn(notifications, 'export async function scheduleRandomReminders', 'export async function cancelRandomReminders');
  const denied = fn.indexOf('通知权限未授予，随机提醒没有写成已排');
  assert.ok(denied > 0);
  assert.match(fn.slice(0, denied), /armed: false/);
  assert.ok(fn.indexOf('armed: true', denied) > denied);
  const scheduleAt = fn.indexOf('await scheduleAlarms(alarms)');
  const cancelAt = fn.indexOf('await cancelStale(isRandomId', scheduleAt);
  assert.ok(scheduleAt > 0 && cancelAt > scheduleAt);
});

test('启动只请求一次权限，回前台和凌晨补闹钟不再弹窗', () => {
  assert.match(app, /syncScheduledReminders\(\{ requestPermission: true \}\)/);
  assert.match(app, /syncScheduledReminders\(\{ requestPermission: false \}\)/);
  assert.doesNotMatch(app, /prepareNotifications\(\)\.catch/);
  assert.doesNotMatch(app, /if \(state\.settings\.dailyReminders\.length\)/);
  assert.match(app, /route === 'countdown'/);
  const boot = sliceFn(app, 'async function boot', 'boot();');
  assert.equal(boot.includes('scheduleDailyReminders('), false);
  assert.match(notifications, /if \(permissionTask\) return permissionTask/);
});

test('保存提醒把真实结果显示出来', () => {
  const save = sliceFn(ai, "$('#save-reminders')?.addEventListener", "$('#gen-ai-copy')");
  assert.match(save, /await scheduleDailyReminders/);
  assert.doesNotMatch(save, /\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
  assert.match(save, /daily\?\.ok === false \|\| random\?\.ok === false/);
  assert.match(save, /exactAlarm === 'denied'/);
  const scheduler = ai.slice(ai.indexOf('async function scheduleTodayRandomReminders'), ai.indexOf('async function scheduleTodayRandomReminders') + 500);
  assert.match(scheduler, /aiRandomRemindersEnabled !== true/);
});

test('倒数日保存和删除都会同步本地闹钟', () => {
  assert.match(countdown, /syncCountdownNodeAlarms/);
  const fn = sliceFn(notifications, 'export async function syncCountdownNodeAlarms', 'export async function syncScheduledReminders');
  const scheduleAt = fn.indexOf('if (alarms.length) await scheduleAlarms(alarms)');
  const markAt = fn.indexOf('notified[key] = true');
  assert.ok(scheduleAt > 0 && markAt > scheduleAt);
  assert.match(fn, /nodeNotify === false/);
  assert.match(fn, /cancelOrphanCountdownAlarms/);
  const denied = fn.indexOf('通知权限未授予，倒数日提醒没有排上');
  assert.ok(denied > 0 && denied < scheduleAt);
});

test('没有 Key 时的随机文案会按日期错开', () => {
  const generate = read('ai/generate.js');
  assert.match(generate, /export function genericRandomReminderCopies\(count = 3, date = new Date\(\)\)/);
  assert.ok(generate.includes('FALLBACK_REMINDER_COPIES[(start + index) % FALLBACK_REMINDER_COPIES.length]'));
  assert.match(generate, /return genericRandomReminderCopies\(count, new Date\(\)\)/);
});
