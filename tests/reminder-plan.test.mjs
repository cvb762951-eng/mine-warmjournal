import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATCHUP_DELAY_MS,
  COUNTDOWN_ID_BASE,
  DAILY_HORIZON_DAYS,
  DAILY_ID_BASE,
  DAILY_ID_SLOTS,
  DAILY_MAX_PER_DAY,
  LEGACY_DAILY_ID_END,
  MIN_IDLE_GAP_MS,
  RANDOM_ID_BASE,
  RANDOM_SEGMENT_END,
  RANDOM_SEGMENT_START,
  SCHEDULE_LEAD_MS,
  buildCountdownAlarms,
  buildDailyAlarms,
  buildRandomAlarms,
  countdownNotificationId,
  dailyNotificationId,
  futureRandomMinutes,
  isCountdownId,
  isDailyId,
  isLegacyDailyId,
  isManagedReminderId,
  isRandomId,
  pendingIdsToCancel,
  pickCopy,
  reminderCopy,
  staggerAlarms,
  toLocalNotification
} from '../reminder-plan.js';

const at = (y, m, d, h, min, s = 0) => new Date(y, m, d, h, min, s);

test('过点的每日提醒留在今天，不挪到现在，也不占用明天的点', () => {
  const now = at(2026, 9, 13, 15, 0, 0);
  const reminders = [{ id: 'morning', hour: 9, minute: 0, type: 'photo' }];
  const { alarms } = buildDailyAlarms(reminders, null, now);
  assert.equal(reminders[0].hour, 9);
  assert.equal(reminders[0].minute, 0);
  assert.ok(alarms.every(alarm => alarm.at.getDate() !== 13));
  assert.ok(!alarms.some(alarm => alarm.at.getHours() === 15));
  const tomorrow = alarms.find(alarm => alarm.at.getDate() === 14);
  assert.equal(tomorrow.at.getHours(), 9);
  assert.equal(tomorrow.at.getMinutes(), 0);
});

test('未来 21 天的每日 id 互不重复，并且落在每日段里', () => {
  const { alarms } = buildDailyAlarms(
    [{ id: 'morning', hour: 9, minute: 0, type: 'journal' }],
    null,
    at(2026, 9, 13, 8, 0, 0)
  );
  const ids = alarms.map(alarm => alarm.id);
  assert.equal(alarms.length, DAILY_HORIZON_DAYS);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(DAILY_HORIZON_DAYS < DAILY_ID_SLOTS);
  assert.ok(ids.every(isDailyId));
  assert.ok(ids.every(id => id >= DAILY_ID_BASE));
});

test('马上要响的那一次只记住 id，不重新排', () => {
  const now = at(2026, 9, 13, 8, 59, 57);
  const { alarms, heldIds } = buildDailyAlarms(
    [{ id: 'morning', hour: 9, minute: 0, type: 'photo' }],
    null,
    now
  );
  assert.ok(heldIds.includes(dailyNotificationId(at(2026, 9, 13, 9, 0, 0), 0)));
  assert.ok(!alarms.some(alarm => alarm.at.getTime() - now.getTime() <= SCHEDULE_LEAD_MS));
  assert.ok(alarms.some(alarm => alarm.at.getDate() === 14 && alarm.at.getHours() === 9));
});

test('排给系统的是一次性准点闹钟', () => {
  const { alarms } = buildDailyAlarms(
    [{ id: 'morning', hour: 9, minute: 0, type: 'journal' }],
    null,
    at(2026, 9, 13, 8, 0, 0)
  );
  const notification = toLocalNotification(alarms[0]);
  assert.equal(notification.schedule.allowWhileIdle, true);
  assert.ok(notification.schedule.at instanceof Date);
  assert.equal(Object.hasOwn(notification.schedule, 'on'), false);
  assert.equal(Object.hasOwn(notification.schedule, 'repeats'), false);
});

test('间隔太近的闹钟会拉开，但仍留在当天', () => {
  const first = { at: at(2026, 9, 13, 9, 0, 0) };
  const second = { at: at(2026, 9, 13, 9, 5, 0) };
  const third = { at: at(2026, 9, 13, 9, 6, 0) };
  staggerAlarms([first, second, third]);
  assert.ok(second.at.getTime() - first.at.getTime() >= MIN_IDLE_GAP_MS);
  assert.ok(third.at.getTime() - second.at.getTime() >= MIN_IDLE_GAP_MS);
  assert.equal(second.at.getHours(), 9);
  assert.equal(second.at.getMinutes(), 9);

  const late = { at: at(2026, 9, 13, 23, 56, 0) };
  staggerAlarms([late], { occupied: [at(2026, 9, 13, 23, 50, 0).getTime()] });
  assert.equal(late.at.getDate(), 13);
  assert.equal(late.at.getMonth(), 9);
  assert.equal(late.at.getHours(), 23);
});

test('随机提醒避开已经占用的时刻，并且只排未来', () => {
  const now = at(2026, 9, 13, 9, 0, 0);
  const { alarms } = buildRandomAlarms(
    [{ time: '10:05', title: '记一下', body: '晚饭吃了啥' }],
    now,
    [at(2026, 9, 13, 10, 0, 0).getTime()]
  );
  assert.equal(alarms.length, 1);
  assert.ok(alarms[0].at.getTime() >= at(2026, 9, 13, 10, 9, 0).getTime());
  const missed = buildRandomAlarms([{ time: '08:00', title: '早', body: '早' }], at(2026, 9, 13, 15, 0, 0));
  assert.equal(missed.alarms.length, 0);
  assert.equal(missed.held.length, 0);
});

test('每天超过 48 条时多出来的仍留在原数组里，只是不排', () => {
  const reminders = Array.from({ length: DAILY_MAX_PER_DAY + 1 }, (_, index) => ({
    id: String(index),
    hour: 16,
    minute: 0,
    type: 'journal'
  }));
  const snapshot = reminders.map(item => ({ ...item }));
  const { alarms, truncated } = buildDailyAlarms(reminders, null, at(2026, 9, 13, 8, 0, 0));
  assert.equal(truncated, 1);
  assert.deepEqual(reminders, snapshot);
  assert.ok(alarms.every(alarm => alarm.extra.reminderId !== String(DAILY_MAX_PER_DAY)));
});

test('同一类文案按日期轮换', () => {
  const first = reminderCopy('journal', null, at(2026, 9, 13, 9, 0, 0), 0);
  const second = reminderCopy('journal', null, at(2026, 9, 14, 9, 0, 0), 0);
  assert.notEqual(first.body, second.body);
  assert.notEqual(pickCopy(['甲', '乙', '丙'], 0, at(2026, 9, 13, 9, 0, 0)), pickCopy(['甲', '乙', '丙'], 0, at(2026, 9, 14, 9, 0, 0)));
});

test('随机时刻落在 8:00 到 22:00，并且晚于现在', () => {
  const morning = futureRandomMinutes(4, at(2026, 9, 13, 7, 0, 0));
  assert.ok(morning.length >= 1);
  assert.ok(morning.every(minute => minute >= 8 * 60 && minute < 22 * 60));
  const late = futureRandomMinutes(4, at(2026, 9, 13, 21, 50, 0));
  assert.ok(late.every(minute => minute > 21 * 60 + 50 && minute < 22 * 60));
  assert.deepEqual(futureRandomMinutes(3, at(2026, 9, 13, 22, 10, 0)), []);
});

test('倒数日节点排在当天 9 点，过了 9 点就补在今天而不是明天', () => {
  const entry = { id: 'exam', title: '考研', date: '2026-11-12', note: '带好证件' };
  const early = buildCountdownAlarms([entry], { now: at(2026, 9, 13, 8, 0, 0) });
  const dates = early.alarms.map(alarm => `${alarm.at.getMonth() + 1}-${alarm.at.getDate()} ${alarm.at.getHours()}:${alarm.at.getMinutes()}`);
  assert.deepEqual(dates, ['10-13 9:0', '11-5 9:0', '11-11 9:0', '11-12 9:0']);
  assert.equal(early.catchupKeys.length, 0);

  const late = buildCountdownAlarms([entry], { now: at(2026, 9, 13, 15, 0, 0) });
  assert.equal(late.catchupKeys.length, 1);
  const catchup = late.alarms.find(alarm => alarm.catchupKey);
  assert.equal(catchup.at.getDate(), 13);
  assert.ok(Math.abs(catchup.at.getTime() - at(2026, 9, 13, 15, 0, 0).getTime() - CATCHUP_DELAY_MS) < 1000);
  assert.ok(!late.alarms.some(alarm => alarm.at.getDate() === 14 && alarm.at.getHours() === 9));

  const skipped = buildCountdownAlarms([entry], {
    now: at(2026, 9, 13, 15, 0, 0),
    notified: { '2026-10-13|exam': true }
  });
  assert.equal(skipped.catchupKeys.length, 0);
  assert.ok(!skipped.alarms.some(alarm => alarm.at.getDate() === 13));

  const off = buildCountdownAlarms([entry], { now: at(2026, 9, 13, 8, 0, 0), nodeNotify: false });
  assert.deepEqual(off.alarms, []);

  const yesterday = buildCountdownAlarms(
    [{ id: 'gone', title: '昨天', date: '2026-10-12' }],
    { now: at(2026, 9, 13, 15, 0, 0) }
  );
  assert.deepEqual(yesterday.alarms, []);

  const again = buildCountdownAlarms([entry], { now: at(2026, 9, 13, 8, 0, 0) });
  assert.equal(again.alarms[0].id, early.alarms[0].id);
  assert.equal(
    countdownNotificationId('exam', '2026-10-13|30'),
    countdownNotificationId('exam', '2026-10-13|30')
  );
});

test('取消时跳过通知栏里还在的，也跳过这次仍然要留的', () => {
  const matches = id => isLegacyDailyId(id) || isDailyId(id);
  assert.deepEqual(
    pendingIdsToCancel([25100, 25101, 31000, 25400], [25100], [31000], matches),
    [25101]
  );
  assert.equal(isRandomId(25400), true);
  assert.equal(isRandomId(RANDOM_ID_BASE), true);
  assert.equal(isRandomId(RANDOM_SEGMENT_END), false);
  assert.equal(isManagedReminderId(25999), false);
  assert.equal(isManagedReminderId(25001), false);
  assert.equal(isManagedReminderId(25200), false);
  assert.ok(DAILY_ID_BASE >= LEGACY_DAILY_ID_END);
  assert.ok(DAILY_ID_BASE > RANDOM_SEGMENT_END);
  assert.ok(COUNTDOWN_ID_BASE > DAILY_ID_BASE + DAILY_ID_SLOTS * DAILY_MAX_PER_DAY);
  assert.equal(isCountdownId(COUNTDOWN_ID_BASE), true);
  assert.equal(isRandomId(RANDOM_SEGMENT_START), true);
});
