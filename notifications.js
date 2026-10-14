import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { registerHelper, callHelper, state, save } from './core.js';
import {
  DAILY_CHANNEL_ID,
  DAILY_MAX_PER_DAY,
  RANDOM_CHANNEL_ID,
  IMMEDIATE_CHANNEL_ID,
  COUNTDOWN_CHANNEL_ID,
  buildDailyAlarms,
  buildRandomAlarms,
  buildCountdownAlarms,
  toLocalNotification,
  pendingIdsToCancel,
  isDailyId,
  isLegacyDailyId,
  isRandomId,
  isCountdownId,
  isManagedReminderId,
  formatHm,
  formatYmd
} from './reminder-plan.js';

const TIMER_NOTIFICATION_ID = 25001;
const TimerAlarm = registerPlugin('TimerAlarm');
const APP_PACKAGE = 'com.mine.warmjournal';

let lastError = null;
let permissionTask = null;
let permissionPrompted = false;
let gate = Promise.resolve();
let gateDepth = 0;
let lastDailyAt = [];

function unsupportedStatus() {
  return { ok: false, permission: 'unsupported', exactAlarm: 'unavailable', scheduledCount: 0, lastError: null };
}

function statusResult({ ok, permission = 'unknown', exactAlarm = 'unknown', scheduledCount = 0, error = undefined }) {
  if (error !== undefined) lastError = error;
  return { ok: Boolean(ok), permission, exactAlarm, scheduledCount, lastError };
}

function withNotificationGate(task) {
  if (gateDepth > 0) return Promise.resolve().then(task);
  const run = gate.then(async () => {
    gateDepth += 1;
    try { return await task(); }
    finally { gateDepth -= 1; }
  });
  gate = run.then(() => {}, () => {});
  return run;
}

export function prepareNotifications({ request = true, userInitiated = false } = {}) {
  if (!Capacitor.isNativePlatform()) return Promise.resolve(false);
  if (userInitiated) permissionPrompted = false;
  if (permissionTask) return permissionTask;
  permissionTask = (async () => {
    const current = await LocalNotifications.checkPermissions();
    if (current.display === 'granted') return true;
    if (!request || permissionPrompted) return false;
    permissionPrompted = true;
    const requested = await LocalNotifications.requestPermissions();
    return requested.display === 'granted';
  })().finally(() => { permissionTask = null; });
  return permissionTask;
}

async function readPermissionLabel() {
  if (!Capacitor.isNativePlatform()) return 'unsupported';
  try {
    const current = await LocalNotifications.checkPermissions();
    return current.display || 'denied';
  } catch (error) {
    lastError = error?.message || '读不到通知权限';
    return 'denied';
  }
}

async function readExactAlarm() {
  if (!Capacitor.isNativePlatform()) return 'unavailable';
  try {
    const result = await LocalNotifications.checkExactNotificationSetting();
    return result?.exact_alarm || result?.exactAlarm || 'denied';
  } catch (error) {
    lastError = error?.message || '读不到精确闹钟权限';
    return 'unavailable';
  }
}

async function listPendingIds() {
  const pending = await LocalNotifications.getPending();
  return (pending?.notifications || []).map(item => item.id).filter(id => Number.isInteger(id));
}

async function listDeliveredIds() {
  const delivered = await LocalNotifications.getDeliveredNotifications();
  return (delivered?.notifications || []).map(item => item.id).filter(id => Number.isInteger(id));
}

async function cancelIds(ids) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  await LocalNotifications.cancel({ notifications: unique.map(id => ({ id })) });
}

async function ensureChannels() {
  const channels = [
    { id: DAILY_CHANNEL_ID, name: '日常记录提醒', description: '提醒你随手拍、记录今天的生活', importance: 4, vibration: true },
    { id: RANDOM_CHANNEL_ID, name: '记录提醒', description: '随机记录提醒', importance: 4, vibration: true },
    { id: IMMEDIATE_CHANNEL_ID, name: 'AI 陪伴提醒', description: '关键节点与陪伴提醒', importance: 4, vibration: true },
    { id: COUNTDOWN_CHANNEL_ID, name: '倒数日节点', description: '倒数日 30、7、1 天和当天的提醒', importance: 4, vibration: true }
  ];
  for (const channel of channels) {
    try { await LocalNotifications.createChannel(channel); }
    catch (error) { console.warn('创建提醒频道失败', error); }
  }
}

async function scheduleAlarms(alarms) {
  const notifications = alarms.map(toLocalNotification);
  const chunkSize = 40;
  for (let index = 0; index < notifications.length; index += chunkSize) {
    await LocalNotifications.schedule({ notifications: notifications.slice(index, index + chunkSize) });
  }
}

function dailyOccupiedTimes() {
  if (lastDailyAt.length) return lastDailyAt;
  const { alarms } = buildDailyAlarms(state.settings?.dailyReminders || [], state.settings?.reminderAiCopy, new Date());
  return alarms.map(alarm => alarm.at.getTime());
}

function plannedItem(alarm, pushed) {
  return {
    id: String(alarm.sourceIndex),
    time: formatHm(alarm.at),
    title: alarm.title,
    body: alarm.body,
    pushed
  };
}

export async function getReminderStatus() {
  if (!Capacitor.isNativePlatform()) return { permission: 'unsupported', exactAlarm: 'unavailable', scheduledCount: 0, lastError };
  const permission = await readPermissionLabel();
  const exactAlarm = await readExactAlarm();
  let scheduledCount = 0;
  try {
    const ids = await listPendingIds();
    scheduledCount = ids.filter(isManagedReminderId).length;
  } catch (error) {
    lastError = error?.message || '读不到已排闹钟';
  }
  return { permission, exactAlarm, scheduledCount, lastError };
}

export async function openExactAlarmSettings() {
  if (!Capacitor.isNativePlatform()) {
    lastError = '只能在安装后的 App 里打开精确闹钟设置';
    return false;
  }
  try {
    await LocalNotifications.changeExactNotificationSetting();
    return true;
  } catch (error) {
    lastError = error?.message || '无法打开精确闹钟设置';
    return false;
  }
}

export async function openNotificationSettings() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    lastError = '只能在 Android 安装包里打开系统通知设置';
    return false;
  }
  // 仓库里没有 Android 工程，不能注册原生插件。用系统 intent 打开本应用的通知设置。
  const intent = `intent:#Intent;action=android.settings.APP_NOTIFICATION_SETTINGS;S.android.provider.extra.APP_PACKAGE=${APP_PACKAGE};end`;
  try {
    if (typeof document === 'undefined') throw new Error('没有页面可以打开设置');
    const anchor = document.createElement('a');
    anchor.href = intent;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } catch (error) {
    lastError = error?.message || '打不开系统通知设置';
    return false;
  }
}

export async function scheduleTimerNotification(endAt, task, label = '专注') {
  if (!Capacitor.isNativePlatform()) return false;
  if (Capacitor.getPlatform() === 'android') {
    // Android 用原生闹铃（AlarmManager），不依赖通知权限；先调度闹铃，权限异步请求避免阻塞
    await TimerAlarm.schedule({ at: endAt, task: task || label, label });
    prepareNotifications({ userInitiated: true }).catch(() => {});
    return true;
  }
  const allowed = await prepareNotifications({ userInitiated: true });
  if (!allowed) return false;
  await cancelTimerNotification();
  await LocalNotifications.schedule({ notifications: [{
    id: TIMER_NOTIFICATION_ID,
    title: `${label}完成`,
    body: `${task || label}已结束，打开 Mine 开始下一阶段。`,
    schedule: { at: new Date(endAt), allowWhileIdle: true },
    channelId: 'focus-timer',
    extra: { route: 'focus' }
  }] });
  return true;
}

export async function cancelTimerNotification() {
  if (!Capacitor.isNativePlatform()) return;
  if (Capacitor.getPlatform() === 'android') {
    await TimerAlarm.stop();
    return;
  }
  await LocalNotifications.cancel({ notifications: [{ id: TIMER_NOTIFICATION_ID }] });
}

export async function cancelScheduledTimerNotification() {
  if (!Capacitor.isNativePlatform()) return;
  if (Capacitor.getPlatform() === 'android') {
    await TimerAlarm.cancelScheduled();
    return;
  }
  await LocalNotifications.cancel({ notifications: [{ id: TIMER_NOTIFICATION_ID }] });
}

export async function isTimerAlarmRinging() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return false;
  const result = await TimerAlarm.isRinging();
  return Boolean(result.ringing);
}

export async function initializeNotificationChannel() {
  if (!Capacitor.isNativePlatform()) return false;
  await ensureChannels();
  return true;
}

export async function setKeepAwake(keep) {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return false;
  try {
    await TimerAlarm.setKeepAwake({ keep: Boolean(keep) });
    return true;
  } catch (error) {
    console.warn('屏幕常亮设置失败', error);
    return false;
  }
}

export async function startFocusNotification(task, endAt) {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return false;
  try {
    await TimerAlarm.startFocusNotification({ task, endAt });
    return true;
  } catch (error) {
    console.warn('计时通知启动失败', error);
    return false;
  }
}

export async function stopFocusNotification() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  try { await TimerAlarm.stopFocusNotification(); } catch (error) { console.warn('计时通知停止失败', error); }
}

export async function updateCountdownWidget(payload) {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return false;
  try {
    await TimerAlarm.updateCountdownWidget(payload);
    return true;
  } catch (error) {
    console.warn('倒数日组件更新失败', error);
    return false;
  }
}

export async function consumeWidgetRoute() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return null;
  try {
    return await TimerAlarm.consumeWidgetRoute();
  } catch (error) {
    console.warn('读取小组件跳转失败', error);
    return null;
  }
}

async function cancelStale(matches, keepIds) {
  const pending = await listPendingIds();
  const delivered = await listDeliveredIds();
  const drop = pendingIdsToCancel(pending, delivered, keepIds, matches);
  await cancelIds(drop);
}

async function cancelOrphanCountdownAlarms() {
  const live = new Set((state.countdowns || []).map(item => String(item?.id || '')).filter(Boolean));
  const pending = await LocalNotifications.getPending();
  const delivered = new Set(await listDeliveredIds());
  const ids = (pending?.notifications || [])
    .filter(item => Number.isInteger(item.id) && isCountdownId(item.id) && item.extra?.countdownId && !live.has(String(item.extra.countdownId)) && !delivered.has(item.id))
    .map(item => item.id);
  await cancelIds(ids);
}

export async function scheduleDailyReminders(reminders, aiCopy = null, options = {}) {
  if (!Capacitor.isNativePlatform()) return unsupportedStatus();
  return withNotificationGate(async () => {
    const list = Array.isArray(reminders) ? reminders : [];
    const permission = await readPermissionLabel();
    const exactAlarm = await readExactAlarm();
    if (!list.length) {
      try {
        await cancelStale(id => isDailyId(id) || isLegacyDailyId(id), []);
        lastDailyAt = [];
        return statusResult({ ok: true, permission, exactAlarm, scheduledCount: 0, error: null });
      } catch (error) {
        return statusResult({ ok: false, permission, exactAlarm, scheduledCount: 0, error: error?.message || '取消旧提醒失败' });
      }
    }
    const allowed = await prepareNotifications({
      request: options.requestPermission !== false,
      userInitiated: options.userInitiated === true
    });
    const permissionAfter = allowed ? 'granted' : await readPermissionLabel();
    if (!allowed) {
      return statusResult({
        ok: false,
        permission: permissionAfter,
        exactAlarm,
        scheduledCount: 0,
        error: '通知权限未授予，原来的提醒还留着'
      });
    }
    const { alarms, truncated, heldIds } = buildDailyAlarms(list, aiCopy, new Date());
    const keepIds = [...alarms.map(alarm => alarm.id), ...(heldIds || [])];
    if (!alarms.length && !keepIds.length) {
      return statusResult({
        ok: false,
        permission: 'granted',
        exactAlarm,
        scheduledCount: 0,
        error: '没有排出未来的每日提醒，原来的闹钟还留着'
      });
    }
    if (!alarms.length) {
      try {
        await cancelStale(id => isDailyId(id) || isLegacyDailyId(id), keepIds);
        return statusResult({ ok: true, permission: 'granted', exactAlarm, scheduledCount: 0, error: null });
      } catch (error) {
        return statusResult({ ok: false, permission: 'granted', exactAlarm, scheduledCount: 0, error: error?.message || '马上要响的提醒还留着' });
      }
    }
    try {
      await ensureChannels();
      await scheduleAlarms(alarms);
    } catch (error) {
      return statusResult({
        ok: false,
        permission: 'granted',
        exactAlarm,
        scheduledCount: 0,
        error: error?.message || '每日提醒没排上，原来的闹钟还留着'
      });
    }
    let cancelNote = null;
    try {
      await cancelStale(id => isDailyId(id) || isLegacyDailyId(id), keepIds);
    } catch (error) {
      cancelNote = '新的每日提醒已经排上，有一条旧闹钟暂时没取消';
      console.warn(cancelNote, error);
    }
    lastDailyAt = alarms.map(alarm => alarm.at.getTime());
    const note = truncated > 0 ? `每天最多排 ${DAILY_MAX_PER_DAY} 条，多出来的 ${truncated} 条仍留在设置里` : cancelNote;
    return statusResult({ ok: true, permission: 'granted', exactAlarm, scheduledCount: alarms.length, error: note });
  });
}

export async function cancelDailyReminders() {
  if (!Capacitor.isNativePlatform()) return unsupportedStatus();
  return scheduleDailyReminders([], null, { requestPermission: false });
}

const TEST_NOTIFICATION_ID = 25999;

export async function sendTestNotification() {
  if (!Capacitor.isNativePlatform()) return 'browser';
  try {
    let current = await LocalNotifications.checkPermissions();
    if (current.display !== 'granted') {
      permissionPrompted = false;
      current = await LocalNotifications.requestPermissions();
    }
    if (current.display !== 'granted') return `权限未授予：${current.display}`;
    await ensureChannels();
    await LocalNotifications.schedule({
      notifications: [{
        id: TEST_NOTIFICATION_ID,
        title: 'Mine 测试通知',
        body: '如果你看到这条，通知链路正常',
        schedule: { at: new Date(Date.now() + 2000), allowWhileIdle: true },
        channelId: DAILY_CHANNEL_ID
      }]
    });
    return 'scheduled';
  } catch (error) {
    return `通知发送失败：${error?.message || error}`;
  }
}

export function onNotificationAction(callback) {
  if (!Capacitor.isNativePlatform()) return;
  LocalNotifications.addListener('localNotificationActionPerformed', notification => {
    const route = notification?.notification?.extra?.route;
    if (route) callback(route, notification);
  });
}

const IMMEDIATE_BASE = 25200;
let immediateSeq = 0;

export async function notifyNow(title, body, extra = {}) {
  if (!Capacitor.isNativePlatform()) return false;
  const allowed = await prepareNotifications({ userInitiated: true });
  if (!allowed) return false;
  try {
    await ensureChannels();
    const id = IMMEDIATE_BASE + ((immediateSeq = (immediateSeq + 1) % 100));
    await LocalNotifications.schedule({ notifications: [{
      id,
      title: String(title || 'Mine'),
      body: String(body || ''),
      schedule: { at: new Date(Date.now() + 250), allowWhileIdle: true },
      channelId: IMMEDIATE_CHANNEL_ID,
      extra
    }] });
    return true;
  } catch (error) {
    lastError = error?.message || '立即通知推送失败';
    console.warn('立即通知推送失败', error);
    return false;
  }
}

registerHelper('notifyNow', notifyNow);

function todayKey(now = new Date()) {
  return formatYmd(now);
}

export async function scheduleRandomReminders(plan, options = {}) {
  if (!Capacitor.isNativePlatform()) return unsupportedStatus();
  return withNotificationGate(async () => {
    const now = new Date();
    const sourceItems = (Array.isArray(plan) ? plan : []).filter(item => /^\d{2}:\d{2}$/.test(String(item?.time || ''))).slice(0, 8);
    const built = buildRandomAlarms(sourceItems, now, dailyOccupiedTimes());
    const alarms = built.alarms;
    const keepIds = [...alarms.map(alarm => alarm.id), ...built.heldIds];
    const exactAlarm = await readExactAlarm();
    if (!alarms.length && !built.held.length) {
      try {
        await cancelStale(isRandomId, []);
        state.settings.aiRandomReminders = {
          date: todayKey(now),
          armed: true,
          items: sourceItems.map((item, index) => ({
            id: String(item?.id || index),
            time: String(item.time),
            title: String(item.title || '记录生活').slice(0, 60),
            body: String(item.body || '').slice(0, 120),
            pushed: true
          }))
        };
        await save();
        return statusResult({ ok: true, permission: await readPermissionLabel(), exactAlarm, scheduledCount: 0, error: null });
      } catch (error) {
        return statusResult({ ok: false, permission: await readPermissionLabel(), exactAlarm, scheduledCount: 0, error: error?.message || '今天没有可排的随机提醒' });
      }
    }
    const allowed = await prepareNotifications({
      request: options.requestPermission !== false,
      userInitiated: options.userInitiated === true
    });
    const permission = allowed ? 'granted' : await readPermissionLabel();
    if (!allowed) {
      state.settings.aiRandomReminders = {
        date: todayKey(now),
        armed: false,
        items: sourceItems.map((item, index) => ({
          id: String(item?.id || index),
          time: String(item.time),
          title: String(item.title || '记录生活').slice(0, 60),
          body: String(item.body || '').slice(0, 120),
          pushed: false
        }))
      };
      try { await save(); }
      catch (error) { console.warn('随机提醒没排上，计划也没记下', error); }
      return statusResult({ ok: false, permission, exactAlarm, scheduledCount: 0, error: '通知权限未授予，随机提醒没有写成已排' });
    }
    try {
      await ensureChannels();
      if (alarms.length) await scheduleAlarms(alarms);
    } catch (error) {
      return statusResult({ ok: false, permission: 'granted', exactAlarm, scheduledCount: 0, error: error?.message || '随机提醒没排上' });
    }
    try {
      await cancelStale(isRandomId, keepIds);
    } catch (error) {
      console.warn('新的随机提醒已经排上，旧的没取消干净', error);
    }
    state.settings.aiRandomReminders = {
      date: todayKey(now),
      armed: true,
      items: [...alarms, ...built.held].map(alarm => plannedItem(alarm, false))
    };
    try {
      await save();
    } catch (error) {
      return statusResult({ ok: false, permission: 'granted', exactAlarm, scheduledCount: alarms.length, error: error?.message || '随机提醒排上了，但计划没写进设置' });
    }
    return statusResult({ ok: true, permission: 'granted', exactAlarm, scheduledCount: alarms.length, error: null });
  });
}

export async function cancelRandomReminders() {
  if (!Capacitor.isNativePlatform()) return unsupportedStatus();
  return withNotificationGate(async () => {
    try {
      await cancelStale(isRandomId, []);
      if (state.settings?.aiRandomReminders && typeof state.settings.aiRandomReminders === 'object') {
        state.settings.aiRandomReminders.armed = false;
        await save();
      }
      return statusResult({ ok: true, permission: await readPermissionLabel(), exactAlarm: await readExactAlarm(), scheduledCount: 0, error: null });
    } catch (error) {
      return statusResult({ ok: false, permission: await readPermissionLabel(), exactAlarm: await readExactAlarm(), scheduledCount: 0, error: error?.message || '取消随机提醒失败' });
    }
  });
}

export async function restoreRandomReminders(options = {}) {
  if (!Capacitor.isNativePlatform()) return unsupportedStatus();
  const plan = state.settings?.aiRandomReminders;
  if (!plan || plan.date !== todayKey() || !Array.isArray(plan.items) || !plan.items.length) {
    return statusResult({ ok: true, permission: await readPermissionLabel(), exactAlarm: await readExactAlarm(), scheduledCount: 0, error: null });
  }
  if (state.settings?.aiRandomRemindersEnabled !== true) {
    return statusResult({ ok: true, permission: await readPermissionLabel(), exactAlarm: await readExactAlarm(), scheduledCount: 0, error: null });
  }
  const result = await scheduleRandomReminders(plan.items, options);
  if (result.ok === false && state.settings?.aiRandomReminders) {
    state.settings.aiRandomReminders.armed = false;
    try { await save(); } catch (error) { console.warn('随机提醒状态没写上', error); }
  }
  return result;
}

export async function syncCountdownNodeAlarms(options = {}) {
  if (!Capacitor.isNativePlatform()) return unsupportedStatus();
  return withNotificationGate(async () => {
    const cfg = state.settings?.countdownAiReminders || {};
    const exactAlarm = await readExactAlarm();
    if (cfg.nodeReminder === false || cfg.nodeNotify === false) {
      try {
        await cancelStale(isCountdownId, []);
        return statusResult({ ok: true, permission: await readPermissionLabel(), exactAlarm, scheduledCount: 0, error: null });
      } catch (error) {
        return statusResult({ ok: false, permission: await readPermissionLabel(), exactAlarm, scheduledCount: 0, error: error?.message || '取消倒数日提醒失败' });
      }
    }
    const allowed = await prepareNotifications({
      request: options.requestPermission !== false,
      userInitiated: options.userInitiated === true
    });
    const permission = allowed ? 'granted' : await readPermissionLabel();
    if (!allowed) {
      try { await cancelOrphanCountdownAlarms(); }
      catch (error) { console.warn('没能清掉已删除倒数日的闹钟', error); }
      return statusResult({ ok: false, permission, exactAlarm, scheduledCount: 0, error: '通知权限未授予，倒数日提醒没有排上' });
    }
    const now = new Date();
    const randomItems = state.settings?.aiRandomReminders?.date === todayKey(now) ? state.settings.aiRandomReminders.items : [];
    const randomBuilt = buildRandomAlarms(randomItems, now, dailyOccupiedTimes());
    const occupied = [
      ...dailyOccupiedTimes(),
      ...randomBuilt.alarms.map(alarm => alarm.at.getTime()),
      ...randomBuilt.held.map(alarm => alarm.at.getTime())
    ];
    const { alarms, catchupKeys, heldIds } = buildCountdownAlarms(state.countdowns || [], {
      now,
      notified: state.meta?.aiCountdownNodes || {},
      nodeReminder: cfg.nodeReminder !== false,
      nodeNotify: cfg.nodeNotify !== false,
      occupied
    });
    const keepIds = [...alarms.map(alarm => alarm.id), ...(heldIds || [])];
    try {
      await ensureChannels();
      if (alarms.length) await scheduleAlarms(alarms);
    } catch (error) {
      return statusResult({ ok: false, permission: 'granted', exactAlarm, scheduledCount: 0, error: error?.message || '倒数日提醒没排上' });
    }
    try {
      await cancelStale(isCountdownId, keepIds);
      if (catchupKeys.length) {
        state.meta = state.meta || {};
        const notified = { ...(state.meta.aiCountdownNodes || {}) };
        const today = todayKey(now);
        catchupKeys.forEach(key => {
          notified[key] = true;
          const countdownId = key.split('|')[1];
          if (countdownId) notified[`${today}|${countdownId}`] = true;
        });
        state.meta.aiCountdownNodes = notified;
        try { await save(); }
        catch (error) { console.warn('倒数日已排上，已提醒标记没写上', error); }
      }
      return statusResult({ ok: true, permission: 'granted', exactAlarm, scheduledCount: alarms.length, error: null });
    } catch (error) {
      return statusResult({
        ok: true,
        permission: 'granted',
        exactAlarm,
        scheduledCount: alarms.length,
        error: '倒数日闹钟已经排上，已提醒标记或旧闹钟没处理完'
      });
    }
  });
}

export async function syncScheduledReminders({ requestPermission = true } = {}) {
  if (!Capacitor.isNativePlatform()) return unsupportedStatus();
  await prepareNotifications({ request: requestPermission });
  const quiet = { requestPermission: false };
  const daily = await scheduleDailyReminders(state.settings?.dailyReminders || [], state.settings?.reminderAiCopy, quiet);
  try {
    await callHelper('ensureTodayRandomReminders', quiet);
  } catch (error) {
    console.warn('随机提醒没有续上', error);
  }
  await syncCountdownNodeAlarms(quiet);
  return daily;
}

registerHelper('getReminderStatus', getReminderStatus);
registerHelper('openExactAlarmSettings', openExactAlarmSettings);
registerHelper('openNotificationSettings', openNotificationSettings);
registerHelper('scheduleRandomReminders', scheduleRandomReminders);
registerHelper('cancelRandomReminders', cancelRandomReminders);
registerHelper('restoreRandomReminders', restoreRandomReminders);
registerHelper('syncCountdownNodeAlarms', syncCountdownNodeAlarms);
registerHelper('syncScheduledReminders', syncScheduledReminders);
