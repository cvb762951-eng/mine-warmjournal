import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { registerHelper, state, save } from './core.js';

const TIMER_NOTIFICATION_ID = 25001;
const TimerAlarm = registerPlugin('TimerAlarm');

export async function prepareNotifications() {
  if (!Capacitor.isNativePlatform()) return false;
  const current = await LocalNotifications.checkPermissions();
  if (current.display === 'granted') return true;
  const requested = await LocalNotifications.requestPermissions();
  return requested.display === 'granted';
}

export async function scheduleTimerNotification(endAt, task, label = '专注') {
  if (!Capacitor.isNativePlatform()) return false;
  if (Capacitor.getPlatform() === 'android') {
    // Android 用原生闹铃（AlarmManager），不依赖通知权限；先调度闹铃，权限异步请求避免阻塞
    await TimerAlarm.schedule({ at: endAt, task: task || label, label });
    prepareNotifications().catch(() => {});
    return true;
  }
  const allowed = await prepareNotifications();
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
  // Android 的持续闹铃频道由原生服务创建；其他平台不需要预建频道。
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

const DAILY_REMINDER_BASE = 25100;
const DAILY_REMINDER_MAX = 20;

const REMINDER_COPY = {
  photo: {
    title: '随手拍',
    bodies: [
      '此刻的画面值得被记住，随手拍一张吧',
      '抬头看看四周，有没有想拍下的瞬间？',
      '给这一刻留个影，随手拍一张'
    ]
  },
  journal: {
    title: '记录今天',
    bodies: [
      '花一分钟，记下此刻的念头',
      '今天有什么想记住的？写两句吧',
      '此刻的心情如何？记下来留给自己'
    ]
  }
};

function pickReminder(type, aiCopy) {
  if (type === 'photo') {
    const pool = [...(aiCopy?.photo || []), ...REMINDER_COPY.photo.bodies];
    return { title: '随手拍', body: pickOne(pool), route: 'snippet-photo' };
  }
  if (type === 'journal') {
    const pool = [...(aiCopy?.journal || []), ...REMINDER_COPY.journal.bodies];
    return { title: '记录今天', body: pickOne(pool), route: 'journal' };
  }
  const kind = Math.random() < 0.5 ? 'photo' : 'journal';
  return pickReminder(kind, aiCopy);
}

function pickOne(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export async function scheduleDailyReminders(reminders, aiCopy = null) {
  if (!Capacitor.isNativePlatform()) return false;
  await cancelDailyReminders();
  if (!reminders.length) return true;
  const allowed = await prepareNotifications();
  if (!allowed) return false;
  try {
    await LocalNotifications.createChannel({
      id: 'daily-reminder',
      name: '日常记录提醒',
      description: '提醒你随手拍、记录今天的生活',
      importance: 4
    });
  } catch (error) {
    console.warn('创建提醒频道失败', error);
  }
  const notifications = reminders.map((reminder, index) => {
    const copy = pickReminder(reminder.type, aiCopy);
    return {
      id: DAILY_REMINDER_BASE + index,
      title: copy.title,
      body: copy.body,
      // Capacitor 8：on（cron 固定时刻）+ repeats 为每日定时标准写法；
      // 不要同时写 every:'day'（内部按保存时刻 +24h 重排，与 on 冲突覆盖）。
      schedule: { on: { hour: reminder.hour, minute: reminder.minute }, repeats: true, allowWhileIdle: true },
      channelId: 'daily-reminder',
      extra: { route: copy.route }
    };
  });
  try {
    await LocalNotifications.schedule({ notifications });
    return true;
  } catch (error) {
    console.warn('日常提醒调度失败', error);
    return false;
  }
}

export async function cancelDailyReminders() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const pending = await LocalNotifications.getPending();
    const ids = pending.notifications
      .filter(item => item.id >= DAILY_REMINDER_BASE && item.id < DAILY_REMINDER_BASE + DAILY_REMINDER_MAX)
      .map(item => item.id);
    if (ids.length) await LocalNotifications.cancel({ notifications: ids.map(id => ({ id })) });
  } catch (error) {
    console.warn('取消提醒失败', error);
  }
}

/**
 * 立即发送一条测试通知，用于排查真机通知不弹的问题。
 * 返回状态字符串：'browser'（非原生平台）/ 'scheduled'（已排期）/ 权限状态 / 错误 message。
 */
export async function sendTestNotification() {
  if (!Capacitor.isNativePlatform()) return 'browser';
  try {
    let current = await LocalNotifications.checkPermissions();
    if (current.display !== 'granted') {
      current = await LocalNotifications.requestPermissions();
    }
    if (current.display !== 'granted') return `权限未授予：${current.display}`;
    await LocalNotifications.createChannel({
      id: 'daily-reminder',
      name: '日常记录提醒',
      description: '提醒你随手拍、记录今天的生活',
      importance: 4
    }).catch(() => {});
    // 固定测试 ID（25999 与既有通知 ID 段不冲突），重复发送覆盖同一条。
    await LocalNotifications.schedule({
      notifications: [{
        id: 25999,
        title: 'Mine 测试通知',
        body: '如果你看到这条，通知链路正常',
        schedule: { at: new Date(Date.now() + 2000), allowWhileIdle: true },
        channelId: 'daily-reminder'
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

/**
 * 立即推送一条通知（标题+正文）。
 * 供 AI 岗位在 App 运行/回前台时推送节点提醒等；浏览器返回 false 不抛错。
 */
export async function notifyNow(title, body, extra = {}) {
  if (!Capacitor.isNativePlatform()) return false;
  const allowed = await prepareNotifications();
  if (!allowed) return false;
  try {
    await LocalNotifications.createChannel({
      id: 'immediate',
      name: 'AI 陪伴提醒',
      description: '关键节点与陪伴提醒',
      importance: 4
    }).catch(() => {});
    const id = IMMEDIATE_BASE + ((immediateSeq = (immediateSeq + 1) % 100));
    await LocalNotifications.schedule({ notifications: [{
      id,
      title: String(title || 'Mine'),
      body: String(body || ''),
      schedule: { at: new Date(Date.now() + 250), allowWhileIdle: true },
      channelId: 'immediate',
      extra
    }] });
    return true;
  } catch (error) {
    console.warn('立即通知推送失败', error);
    return false;
  }
}

registerHelper('notifyNow', notifyNow);

// ---- AI 随机提醒（每天 2-4 次不定时，App 关闭也能推；文案由岗位④预生成当天计划）----
const RANDOM_REMINDER_BASE = 25400;
const RANDOM_REMINDER_MAX = 8;

const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

function persistRandomPlan() {
  state.settings.aiRandomReminders = state.settings.aiRandomReminders || { date: '', items: [] };
  save().catch(() => {});
}

/**
 * 调度当天 AI 随机提醒计划：plan = [{ time: 'HH:MM', title, body }]。
 * 同一天重复调用覆盖（先 cancel 再排）；计划与 pushed 标记写入 settings，供重启恢复。
 * 浏览器返回 false 不抛错。
 */
export async function scheduleRandomReminders(plan) {
  if (!Capacitor.isNativePlatform()) return false;
  await cancelRandomReminders();
  const items = (Array.isArray(plan) ? plan : []).filter(item => /^\d{2}:\d{2}$/.test(String(item?.time || ''))).slice(0, RANDOM_REMINDER_MAX);
  state.settings.aiRandomReminders = {
    date: todayKey(),
    items: items.map((item, index) => ({ id: String(index), time: String(item.time), title: String(item.title || '记录生活'), body: String(item.body || ''), pushed: false }))
  };
  persistRandomPlan();
  if (!items.length) return true;
  const allowed = await prepareNotifications();
  if (!allowed) return false;
  try {
    await LocalNotifications.createChannel({
      id: 'random-reminder',
      name: '记录提醒',
      description: 'AI 为你挑选的随机记录提醒',
      importance: 4
    }).catch(() => {});
    const notifications = items.map((item, index) => {
      const [hour, minute] = String(item.time).split(':').map(Number);
      const at = new Date();
      at.setHours(hour, minute, 0, 0);
      return {
        id: RANDOM_REMINDER_BASE + index,
        title: String(item.title || '记录生活'),
        body: String(item.body || ''),
        schedule: { at, allowWhileIdle: true },
        channelId: 'random-reminder',
        extra: { route: 'journal', randomReminder: true }
      };
    });
    await LocalNotifications.schedule({ notifications });
    return true;
  } catch (error) {
    console.warn('AI 随机提醒调度失败', error);
    return false;
  }
}

/** 取消全部 AI 随机提醒（含当天已排的） */
export async function cancelRandomReminders() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const pending = await LocalNotifications.getPending();
    const ids = pending.notifications
      .filter(item => item.id >= RANDOM_REMINDER_BASE && item.id < RANDOM_REMINDER_BASE + RANDOM_REMINDER_MAX)
      .map(item => item.id);
    if (ids.length) await LocalNotifications.cancel({ notifications: ids.map(id => ({ id })) });
  } catch (error) {
    console.warn('取消 AI 随机提醒失败', error);
  }
}

/**
 * 启动/回前台时恢复当天剩余计划：未推且未过期的补排；已过期标记 pushed 不再推。
 * 当天已推过的不重复；计划日期不是今天则清空。
 */
export async function restoreRandomReminders() {
  if (!Capacitor.isNativePlatform()) return false;
  const plan = state.settings?.aiRandomReminders;
  if (!plan || !plan.items?.length) return true;
  if (plan.date !== todayKey()) {
    state.settings.aiRandomReminders = { date: '', items: [] };
    persistRandomPlan();
    return true;
  }
  if (!state.settings?.aiRandomRemindersEnabled) return true;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const pendingItems = [];
  let changed = false;
  plan.items.forEach(item => {
    if (item.pushed) return;
    const [hour, minute] = String(item.time).split(':').map(Number);
    const atMinutes = hour * 60 + minute;
    if (atMinutes <= nowMinutes) {
      item.pushed = true; // 已过时间：跳过，标记防重复
      changed = true;
      return;
    }
    pendingItems.push(item);
  });
  if (changed) persistRandomPlan();
  if (!pendingItems.length) return true;
  const allowed = await prepareNotifications();
  if (!allowed) return false;
  try {
    const notifications = pendingItems.map(item => {
      const index = plan.items.indexOf(item);
      const [hour, minute] = String(item.time).split(':').map(Number);
      const at = new Date();
      at.setHours(hour, minute, 0, 0);
      return {
        id: RANDOM_REMINDER_BASE + index,
        title: String(item.title || '记录生活'),
        body: String(item.body || ''),
        schedule: { at, allowWhileIdle: true },
        channelId: 'random-reminder',
        extra: { route: 'journal', randomReminder: true }
      };
    });
    await LocalNotifications.schedule({ notifications });
    return true;
  } catch (error) {
    console.warn('AI 随机提醒恢复失败', error);
    return false;
  }
}

registerHelper('scheduleRandomReminders', scheduleRandomReminders);
registerHelper('cancelRandomReminders', cancelRandomReminders);
registerHelper('restoreRandomReminders', restoreRandomReminders);
