// 提醒时刻的纯计算。
//
// @capacitor/local-notifications 8.2.1 在 Android 上如果用 on + repeats，
// 第一次可以 setExactAndAllowWhileIdle，响过之后接收器改用 setExact(RTC)，
// 不再在 Doze 里唤醒。这里改成「每个发生日一条一次性 at」，并且：
// - 已经过点的那一次直接跳过，不改到下一天
// - id 按日期轮换，避免同一条通知一直占着通知栏时后续静音
// - 间隔小于 9 分钟的 allowWhileIdle 会互相挤掉，排程时把后一条往后挪

export const MIN_IDLE_GAP_MS = 9 * 60 * 1000;
export const DAILY_HORIZON_DAYS = 21;
export const DAILY_MAX_PER_DAY = 48;
export const DAILY_ID_SLOTS = 32;
export const DAILY_ID_BASE = 31000;
export const LEGACY_DAILY_ID_START = 25100;
export const LEGACY_DAILY_ID_END = 25200;

export const RANDOM_SEGMENT_START = 25400;
export const RANDOM_SEGMENT_END = 25600;
export const RANDOM_ID_BASE = 25408;
export const RANDOM_PER_DAY = 8;
export const RANDOM_ID_SLOTS = 16;

export const COUNTDOWN_ID_BASE = 36000;
export const COUNTDOWN_ID_SPAN = 2000;
export const COUNTDOWN_NODE_DAYS = [30, 7, 1, 0];
export const COUNTDOWN_FIRE_HOUR = 9;
export const COUNTDOWN_FIRE_MINUTE = 0;
export const CATCHUP_DELAY_MS = 20000;
export const SCHEDULE_LEAD_MS = 5000;

export const DAILY_CHANNEL_ID = 'daily-reminder-v2';
export const RANDOM_CHANNEL_ID = 'random-reminder-v2';
export const IMMEDIATE_CHANNEL_ID = 'immediate-v2';
export const COUNTDOWN_CHANNEL_ID = 'countdown-reminder-v2';

const PHOTO_BODIES = [
  '此刻的画面值得被记住，随手拍一张吧',
  '抬头看看四周，有没有想拍下的瞬间？',
  '给这一刻留个影，随手拍一张'
];
const JOURNAL_BODIES = [
  '花一分钟，记下此刻的念头',
  '今天有什么想记住的？写两句吧',
  '此刻的心情如何？记下来留给自己'
];

export function epochDay(date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

export function formatYmd(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatHm(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function readClock(reminder) {
  const hour = Number(reminder?.hour);
  const minute = Number(reminder?.minute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function localDateTime(base, dayOffset, hour, minute) {
  const at = new Date(base.getTime());
  at.setDate(at.getDate() + dayOffset);
  at.setHours(hour, minute, 0, 0);
  return at;
}

export function dailyNotificationId(date, index) {
  const slot = ((epochDay(date) % DAILY_ID_SLOTS) + DAILY_ID_SLOTS) % DAILY_ID_SLOTS;
  return DAILY_ID_BASE + slot * DAILY_MAX_PER_DAY + index;
}

export function randomNotificationId(date, index) {
  const slot = ((epochDay(date) % RANDOM_ID_SLOTS) + RANDOM_ID_SLOTS) % RANDOM_ID_SLOTS;
  return RANDOM_ID_BASE + slot * RANDOM_PER_DAY + index;
}

export function countdownNotificationId(countdownId, nodeKey) {
  const key = `${countdownId}|${nodeKey}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return COUNTDOWN_ID_BASE + ((hash >>> 0) % COUNTDOWN_ID_SPAN);
}

export function isLegacyDailyId(id) {
  return id >= LEGACY_DAILY_ID_START && id < LEGACY_DAILY_ID_END;
}

export function isDailyId(id) {
  const end = DAILY_ID_BASE + DAILY_ID_SLOTS * DAILY_MAX_PER_DAY;
  return id >= DAILY_ID_BASE && id < end;
}

export function isRandomId(id) {
  return id >= RANDOM_SEGMENT_START && id < RANDOM_SEGMENT_END;
}

export function isCountdownId(id) {
  return id >= COUNTDOWN_ID_BASE && id < COUNTDOWN_ID_BASE + COUNTDOWN_ID_SPAN;
}

export function isManagedReminderId(id) {
  return isLegacyDailyId(id) || isDailyId(id) || isRandomId(id) || isCountdownId(id);
}

export function pendingIdsToCancel(pendingIds, deliveredIds, keepIds, matches) {
  const delivered = new Set(deliveredIds || []);
  const keep = new Set(keepIds || []);
  return [...new Set(pendingIds || [])].filter(id => matches(id) && !keep.has(id) && !delivered.has(id));
}

export function reminderCopy(type, aiCopy, date, index) {
  const epoch = epochDay(date);
  const kind = type === 'photo' || type === 'journal'
    ? type
    : ((epoch + index) % 2 === 0 ? 'photo' : 'journal');
  const extras = kind === 'photo' ? aiCopy?.photo : aiCopy?.journal;
  const defaults = kind === 'photo' ? PHOTO_BODIES : JOURNAL_BODIES;
  const pool = [...(Array.isArray(extras) ? extras.map(item => String(item || '').trim()).filter(Boolean) : []), ...defaults];
  const body = pool[Math.abs(epoch + index) % pool.length];
  return {
    title: kind === 'photo' ? '随手拍' : '记录今天',
    body,
    route: kind === 'photo' ? 'snippet-photo' : 'journal'
  };
}

export function staggerAlarms(alarms, { minGapMs = MIN_IDLE_GAP_MS, occupied = [] } = {}) {
  const placed = (occupied || []).filter(time => Number.isFinite(time)).slice().sort((a, b) => a - b);
  const sorted = [...alarms].sort((a, b) => a.at - b.at);
  for (const alarm of sorted) {
    let at = alarm.at.getTime();
    const dayEnd = new Date(alarm.at.getTime());
    dayEnd.setHours(23, 59, 0, 0);
    const cap = dayEnd.getTime();
    let guard = 0;
    while (guard < 64) {
      guard += 1;
      const conflict = placed.find(time => Math.abs(at - time) < minGapMs);
      if (!conflict) break;
      const next = Math.max(at, conflict + minGapMs);
      if (next > cap) {
        at = cap;
        break;
      }
      at = next;
    }
    alarm.at = new Date(at);
    placed.push(at);
  }
  return alarms;
}

export function buildDailyAlarms(reminders, aiCopy, now = new Date(), horizon = DAILY_HORIZON_DAYS) {
  const list = Array.isArray(reminders) ? reminders : [];
  const truncated = Math.max(0, list.length - DAILY_MAX_PER_DAY);
  const alarms = [];
  const heldIds = [];
  const heldAt = [];
  list.forEach((reminder, index) => {
    if (index >= DAILY_MAX_PER_DAY) return;
    const clock = readClock(reminder);
    if (!clock) return;
    for (let day = 0; day < horizon; day += 1) {
      const at = localDateTime(now, day, clock.hour, clock.minute);
      if (at.getTime() <= now.getTime()) continue;
      const id = dailyNotificationId(at, index);
      // 马上要响的那一条不重新 schedule：插件会先划掉同 id 的通知再取消闹钟。
      if (at.getTime() <= now.getTime() + SCHEDULE_LEAD_MS) {
        heldIds.push(id);
        heldAt.push(at.getTime());
        continue;
      }
      const copy = reminderCopy(reminder?.type, aiCopy, at, index);
      alarms.push({
        id,
        title: copy.title,
        body: copy.body,
        at,
        channelId: DAILY_CHANNEL_ID,
        allowWhileIdle: true,
        extra: { route: copy.route, kind: 'daily', reminderId: String(reminder?.id || '') }
      });
    }
  });
  staggerAlarms(alarms, { occupied: heldAt });
  return { alarms, truncated, heldIds };
}

export function futureRandomMinutes(count, now = new Date()) {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const start = Math.max(8 * 60, nowMinutes + 2);
  const end = 22 * 60;
  if (start >= end) return [];
  const requested = Math.max(1, Math.min(4, Math.floor(count) || 1));
  const span = end - start;
  const maxCount = Math.max(1, Math.min(requested, Math.floor(span / 30) || 1));
  const step = Math.max(30, Math.floor(span / maxCount));
  const minutes = [];
  for (let i = 0; i < maxCount; i += 1) {
    const room = Math.max(1, step - 30);
    let minute = start + step * i + Math.floor(Math.random() * room);
    if (minute >= end) minute = end - 1;
    if (minute <= nowMinutes) continue;
    minutes.push(minute);
  }
  return [...new Set(minutes)];
}

export function pickCopy(pool, index, date) {
  const list = (Array.isArray(pool) ? pool : []).map(item => String(item || '').trim()).filter(Boolean);
  if (!list.length) return '';
  const shift = Math.abs(epochDay(date instanceof Date ? date : new Date()));
  return list[(shift + index) % list.length];
}

export function buildRandomAlarms(items, now = new Date(), occupied = []) {
  const list = (Array.isArray(items) ? items : [])
    .filter(item => /^\d{2}:\d{2}$/.test(String(item?.time || '')))
    .slice(0, RANDOM_PER_DAY);
  const alarms = [];
  const held = [];
  list.forEach((item, index) => {
    const [hour, minute] = String(item.time).split(':').map(Number);
    const at = localDateTime(now, 0, hour, minute);
    if (at.getTime() <= now.getTime()) return;
    const draft = {
      id: randomNotificationId(at, index),
      title: String(item.title || '记录生活').slice(0, 60),
      body: String(item.body || '').slice(0, 120),
      at,
      sourceIndex: index
    };
    if (at.getTime() <= now.getTime() + SCHEDULE_LEAD_MS) {
      held.push(draft);
      return;
    }
    alarms.push({
      ...draft,
      channelId: RANDOM_CHANNEL_ID,
      allowWhileIdle: true,
      extra: { route: 'journal', randomReminder: true }
    });
  });
  staggerAlarms(alarms, { occupied: [...occupied, ...held.map(item => item.at.getTime())] });
  return { alarms, held, heldIds: held.map(item => item.id) };
}

function countdownAlarm(entry, daysBefore, at, nodeDate, catchupKey) {
  const title = daysBefore === 0 ? `「${entry.title}」就是今天` : `「${entry.title}」还有 ${daysBefore} 天`;
  const body = entry.note
    ? (daysBefore === 0 ? `${entry.note}，就是今天。` : `${entry.note}，还剩 ${daysBefore} 天。`)
    : (daysBefore === 0 ? '就是今天，值得好好纪念。' : `还剩 ${daysBefore} 天，可以提前准备起来了。`);
  return {
    id: countdownNotificationId(entry.id, `${nodeDate}|${daysBefore}`),
    title: title.slice(0, 60),
    body: body.slice(0, 120),
    at,
    channelId: COUNTDOWN_CHANNEL_ID,
    allowWhileIdle: true,
    catchupKey,
    extra: { route: 'countdown', countdownId: String(entry.id), nodeDate, daysBefore }
  };
}

export function buildCountdownAlarms(countdowns, options = {}) {
  if (options.nodeReminder === false || options.nodeNotify === false) return { alarms: [], catchupKeys: [], heldIds: [] };
  const now = options.now instanceof Date ? options.now : new Date();
  const notified = options.notified || {};
  const today = formatYmd(now);
  const alarms = [];
  const heldIds = [];
  const heldAt = [];
  const usedIds = new Set();
  const takeId = preferred => {
    let id = preferred;
    let guard = 0;
    while (usedIds.has(id) && guard < COUNTDOWN_ID_SPAN) {
      id = COUNTDOWN_ID_BASE + ((id - COUNTDOWN_ID_BASE + 1) % COUNTDOWN_ID_SPAN);
      guard += 1;
    }
    usedIds.add(id);
    return id;
  };
  for (const entry of countdowns || []) {
    if (!entry?.id || !entry.title || !/^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || ''))) continue;
    for (const daysBefore of COUNTDOWN_NODE_DAYS) {
      const node = new Date(`${entry.date}T00:00:00`);
      if (Number.isNaN(node.getTime())) continue;
      node.setDate(node.getDate() - daysBefore);
      const nodeDate = formatYmd(node);
      const at = new Date(node.getTime());
      at.setHours(COUNTDOWN_FIRE_HOUR, COUNTDOWN_FIRE_MINUTE, 0, 0);
      const key = `${nodeDate}|${entry.id}|${daysBefore}`;
      const legacyKey = `${nodeDate}|${entry.id}`;
      let fireAt = at;
      let catchupKey = '';
      if (at.getTime() <= now.getTime() + SCHEDULE_LEAD_MS) {
        if (at.getTime() > now.getTime()) {
          heldIds.push(takeId(countdownNotificationId(entry.id, `${nodeDate}|${daysBefore}`)));
          heldAt.push(at.getTime());
          continue;
        }
        if (nodeDate !== today) continue;
        if (notified[key] || notified[legacyKey]) continue;
        fireAt = new Date(now.getTime() + CATCHUP_DELAY_MS);
        catchupKey = key;
      }
      const alarm = countdownAlarm(entry, daysBefore, fireAt, nodeDate, catchupKey);
      alarm.id = takeId(alarm.id);
      alarms.push(alarm);
    }
  }
  staggerAlarms(alarms, { occupied: [...(options.occupied || []), ...heldAt] });
  return { alarms, heldIds, catchupKeys: alarms.map(alarm => alarm.catchupKey).filter(Boolean) };
}

export function toLocalNotification(alarm) {
  return {
    id: alarm.id,
    title: alarm.title,
    body: alarm.body,
    schedule: { at: alarm.at, allowWhileIdle: alarm.allowWhileIdle !== false },
    channelId: alarm.channelId,
    extra: alarm.extra || {}
  };
}
