import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { makeDefaultState, migrateState } from '../model.js';

const aiSource = readFileSync(new URL('../views/ai.js', import.meta.url), 'utf8');
const focusSource = readFileSync(new URL('../views/focus.js', import.meta.url), 'utf8');
const mineSource = readFileSync(new URL('../views/mine.js', import.meta.url), 'utf8');

test('从未保存过的提醒是空列表，随机提醒默认关闭', () => {
  const fresh = makeDefaultState();
  assert.deepEqual(fresh.settings.dailyReminders, []);
  assert.equal(fresh.settings.aiRandomRemindersEnabled, false);

  const migrated = migrateState({});
  assert.deepEqual(migrated.settings.dailyReminders, []);
  assert.equal(migrated.settings.aiRandomRemindersEnabled, false);
  assert.equal(migrated.settings.focusAlarmSoundEnabled, true, '全新安装的专注提示音沿用原先的默认开启');
});

test('已经保存的提醒原样保留，清空后的空列表不会被旧开关灌回来', () => {
  const kept = migrateState({
    settings: {
      dailyReminders: [{ id: 'morning', hour: 9, minute: 15, type: 'photo' }],
      aiRandomRemindersEnabled: true
    }
  });
  assert.deepEqual(kept.settings.dailyReminders, [{ id: 'morning', hour: 9, minute: 15, type: 'photo' }]);
  assert.equal(kept.settings.aiRandomRemindersEnabled, true);

  const cleared = migrateState({
    settings: {
      dailyReminders: [],
      dailyReminderEnabled: true,
      dailyReminderHour: 8,
      dailyReminderMinute: 30,
      aiRandomRemindersEnabled: false
    }
  });
  assert.deepEqual(cleared.settings.dailyReminders, []);
  assert.equal(cleared.settings.aiRandomRemindersEnabled, false);
});

test('只有从未写过提醒数组的旧数据，才保留更早的单条提醒', () => {
  const legacy = migrateState({
    settings: { dailyReminderEnabled: true, dailyReminderHour: 7, dailyReminderMinute: 5 }
  });
  assert.equal(legacy.settings.dailyReminders.length, 1);
  assert.equal(legacy.settings.dailyReminders[0].hour, 7);
  assert.equal(legacy.settings.dailyReminders[0].minute, 5);
  assert.equal(legacy.settings.dailyReminders[0].type, 'journal');

  const legacyOff = migrateState({ settings: { dailyReminderEnabled: false, dailyReminderHour: 7 } });
  assert.deepEqual(legacyOff.settings.dailyReminders, []);
});

test('随机提醒只有明确保存为 true 才开启', () => {
  assert.equal(migrateState({ settings: {} }).settings.aiRandomRemindersEnabled, false);
  assert.equal(migrateState({ settings: { aiRandomRemindersEnabled: true } }).settings.aiRandomRemindersEnabled, true);
  assert.equal(migrateState({ settings: { aiRandomRemindersEnabled: false } }).settings.aiRandomRemindersEnabled, false);
  assert.equal(migrateState({ settings: { aiRandomRemindersEnabled: 'true' } }).settings.aiRandomRemindersEnabled, false);
});

test('专注提示音只在旧数据没有独立字段时沿用原来的通知开关', () => {
  const turnedOff = migrateState({ settings: { notificationsEnabled: false } });
  assert.equal(turnedOff.settings.focusAlarmSoundEnabled, false);
  assert.equal(turnedOff.settings.notificationsEnabled, false);

  const turnedOn = migrateState({ settings: { notificationsEnabled: true } });
  assert.equal(turnedOn.settings.focusAlarmSoundEnabled, true);

  const soundOff = migrateState({ settings: { notificationsEnabled: true, focusAlarmSoundEnabled: false } });
  assert.equal(soundOff.settings.focusAlarmSoundEnabled, false);
  assert.equal(soundOff.settings.notificationsEnabled, true);

  const soundOn = migrateState({ settings: { notificationsEnabled: false, focusAlarmSoundEnabled: true } });
  assert.equal(soundOn.settings.focusAlarmSoundEnabled, true);
  assert.equal(soundOn.settings.notificationsEnabled, false);
});

test('迁移两遍不会丢掉已保存的提醒或提示音选择', () => {
  const once = migrateState({
    settings: {
      dailyReminders: [{ id: 'evening', hour: 18, minute: 0, type: 'journal' }],
      aiRandomRemindersEnabled: true,
      notificationsEnabled: false,
      focusAlarmSoundEnabled: false
    }
  });
  const twice = migrateState({ settings: once.settings });
  assert.deepEqual(twice.settings.dailyReminders, [{ id: 'evening', hour: 18, minute: 0, type: 'journal' }]);
  assert.equal(twice.settings.aiRandomRemindersEnabled, true);
  assert.equal(twice.settings.focusAlarmSoundEnabled, false);
  assert.equal(twice.settings.notificationsEnabled, false);
});

test('提醒表单不再预填，专注提示音不再驱动我的页提醒状态', () => {
  const form = aiSource.slice(aiSource.indexOf('function dailyReminderSettingsForm'), aiSource.indexOf('function aiCopyStatus'));
  assert.doesNotMatch(form, /hour:\s*10/, '空列表不应再预填三条提醒');
  assert.match(form, /Array\.isArray\(state\.settings\.dailyReminders\)/);
  assert.match(form, /aiRandomRemindersEnabled === true \? 'checked'/);
  assert.match(aiSource, /aiRandomRemindersEnabled = \$\('#random-reminders-toggle'\)\?\.checked === true/);
  const scheduler = aiSource.slice(aiSource.indexOf('async function scheduleTodayRandomReminders'), aiSource.indexOf('async function scheduleTodayRandomReminders') + 500);
  assert.match(scheduler, /aiRandomRemindersEnabled !== true/);

  assert.doesNotMatch(focusSource, /notificationsEnabled/);
  assert.match(focusSource, /data-focus-preference="focusAlarmSoundEnabled"/);
  assert.match(focusSource, /name="focusAlarm"/);
  assert.match(focusSource, /state\.settings\.focusAlarmSoundEnabled = data\.get\('focusAlarm'\) === 'on'/);

  assert.doesNotMatch(mineSource, /notificationsEnabled/);
  assert.match(mineSource, /const reminderCount = \(state\.settings\?\.dailyReminders \|\| \[\]\)\.length/);
});
