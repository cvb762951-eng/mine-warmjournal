import { daysUntil } from './model.js';

/**
 * 桌面倒数日的天数。
 * 不重复时直接调用 daysUntil，和 App 内卡片用的是同一个函数。
 * 每年重复（公历或农历）先算出「下一次发生的公历日期」，再交给 daysUntil。
 * 农历换算用 1900–2100 的月历表，公历日差用本地日历，和 daysUntil 的午夜差一致。
 */

// 1900–2100 农历大小月表。低 4 位是闰月（0 表示没有），中间 12 位是各月大小，0x10000 表示闰月为大月。
// LUNAR_INFO_BEGIN
const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x16a95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
  0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
  0x0d520
];
// LUNAR_INFO_END

export const COUNTDOWN_WIDGET_THEMES = ['classic', 'sunny', 'plain', 'dark'];

function floorDiv(value, divisor) {
  return Math.floor(value / divisor);
}

/** Howard Hinnant 公历日序。1970-01-01 = 0。只用于 1900–2100 的正年份。 */
export function daysFromCivil(year, month, day) {
  let y = year;
  y -= month <= 2 ? 1 : 0;
  const era = floorDiv(y, 400);
  const yoe = y - era * 400;
  const doy = floorDiv(153 * (month + (month > 2 ? -3 : 9)) + 2, 5) + day - 1;
  const doe = yoe * 365 + floorDiv(yoe, 4) - floorDiv(yoe, 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(ordinal) {
  let z = ordinal + 719468;
  const era = floorDiv(z, 146097);
  const doe = z - era * 146097;
  const yoe = floorDiv(doe - floorDiv(doe, 1460) + floorDiv(doe, 36524) - floorDiv(doe, 146096), 365);
  let year = yoe + era * 400;
  const doy = doe - (365 * yoe + floorDiv(yoe, 4) - floorDiv(yoe, 100));
  const mp = floorDiv(5 * doy + 2, 153);
  const day = doy - floorDiv(153 * mp + 2, 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  year += month <= 2 ? 1 : 0;
  return { y: year, m: month, d: day };
}

function lunarYearDays(year) {
  let sum = 348;
  for (let bit = 0x8000; bit > 0x8; bit >>= 1) sum += (LUNAR_INFO[year - 1900] & bit) ? 1 : 0;
  return sum + leapDays(year);
}

export function leapMonth(year) {
  return LUNAR_INFO[year - 1900] & 0xf;
}

function leapDays(year) {
  if (leapMonth(year)) return (LUNAR_INFO[year - 1900] & 0x10000) ? 30 : 29;
  return 0;
}

function monthDays(year, month) {
  if (month > 12 || month < 1) return -1;
  return (LUNAR_INFO[year - 1900] & (0x10000 >> month)) ? 30 : 29;
}

export function solarToLunar(year, month, day) {
  if (year < 1900 || year > 2100) return null;
  if (year === 1900 && month === 1 && day < 31) return null;
  let offset = daysFromCivil(year, month, day) - daysFromCivil(1900, 1, 31);
  if (offset < 0) return null;
  let temp = 0;
  let index = 1900;
  for (index = 1900; index < 2101 && offset > 0; index += 1) {
    temp = lunarYearDays(index);
    offset -= temp;
  }
  if (offset < 0) {
    offset += temp;
    index -= 1;
  }
  const lunarYear = index;
  const leap = leapMonth(lunarYear);
  let isLeap = false;
  for (index = 1; index < 13 && offset > 0; index += 1) {
    if (leap > 0 && index === leap + 1 && isLeap === false) {
      index -= 1;
      isLeap = true;
      temp = leapDays(lunarYear);
    } else {
      temp = monthDays(lunarYear, index);
    }
    if (isLeap === true && index === leap + 1) isLeap = false;
    offset -= temp;
  }
  if (offset === 0 && leap > 0 && index === leap + 1) {
    if (isLeap) isLeap = false;
    else {
      isLeap = true;
      index -= 1;
    }
  }
  if (offset < 0) {
    offset += temp;
    index -= 1;
  }
  return { year: lunarYear, month: index, day: offset + 1, isLeap };
}

export function lunarToSolar(year, month, day, isLeapMonth = false) {
  const leap = leapMonth(year);
  if (isLeapMonth && leap !== month) return null;
  if ((year === 2100 && month === 12 && day > 1) || (year === 1900 && month === 1 && day < 31)) return null;
  const length = monthDays(year, month);
  const limit = isLeapMonth ? leapDays(year) : length;
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > limit) return null;
  let offset = 0;
  for (let index = 1900; index < year; index += 1) offset += lunarYearDays(index);
  let addedLeap = false;
  for (let index = 1; index < month; index += 1) {
    if (!addedLeap && leap <= index && leap > 0) {
      offset += leapDays(year);
      addedLeap = true;
    }
    offset += monthDays(year, index);
  }
  if (isLeapMonth) offset += length;
  return civilFromDays(daysFromCivil(1900, 1, 31) + offset + day - 1);
}

function lunarMonthLength(year, month, isLeap) {
  if (isLeap) return leapMonth(year) === month ? leapDays(year) : 0;
  return monthDays(year, month);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

export function formatCivil(date) {
  return `${date.y}-${pad(date.m)}-${pad(date.d)}`;
}

function civilFromDate(now) {
  const date = now instanceof Date ? now : new Date(now);
  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
}

function solarMonthLength(year, month) {
  return new Date(year, month, 0).getDate();
}

function nextSolarAnniversary(month, day, today) {
  const todayOrdinal = daysFromCivil(today.y, today.m, today.d);
  for (let year = today.y; year <= today.y + 1; year += 1) {
    // 2 月 29 在平年落到当月最后一天（2 月 28），不跳到 3 月 1 日。
    const useDay = Math.min(day, solarMonthLength(year, month));
    if (daysFromCivil(year, month, useDay) >= todayOrdinal) return { y: year, m: month, d: useDay };
  }
  return null;
}

function nextLunarAnniversary(month, day, isLeap, today) {
  const todayOrdinal = daysFromCivil(today.y, today.m, today.d);
  const todayLunar = solarToLunar(today.y, today.m, today.d);
  const start = todayLunar ? todayLunar.year : 1900;
  for (let year = start; year <= 2100; year += 1) {
    const length = lunarMonthLength(year, month, isLeap);
    if (!length) continue;
    const solar = lunarToSolar(year, month, Math.min(day, length), isLeap);
    if (!solar) continue;
    if (daysFromCivil(solar.y, solar.m, solar.d) >= todayOrdinal) return solar;
  }
  return null;
}

function specDate(spec) {
  return typeof spec === 'string' ? spec : String(spec?.date || '');
}

/** 下一次要倒数的公历日期。不重复时就是原日期。 */
export function resolveCountdownDate(spec, now = new Date()) {
  const date = specDate(spec);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const repeat = typeof spec === 'object' && spec?.repeat === 'yearly';
  if (!repeat) return date;
  const [year, month, day] = date.split('-').map(Number);
  const today = civilFromDate(now);
  if (spec?.lunar === true) {
    let lunarMonth = Number(spec.lunarMonth);
    let lunarDay = Number(spec.lunarDay);
    let lunarLeap = spec.lunarLeap === true;
    const explicit = Number.isInteger(lunarMonth) && lunarMonth >= 1 && lunarMonth <= 12
      && Number.isInteger(lunarDay) && lunarDay >= 1 && lunarDay <= 30;
    if (!explicit) {
      const lunar = solarToLunar(year, month, day);
      if (!lunar) return date;
      lunarMonth = lunar.month;
      lunarDay = lunar.day;
      lunarLeap = lunar.isLeap;
    }
    const next = nextLunarAnniversary(lunarMonth, lunarDay, lunarLeap, today);
    return next ? formatCivil(next) : date;
  }
  const next = nextSolarAnniversary(month, day, today);
  return next ? formatCivil(next) : date;
}

export function countdownDaysUntil(spec, now = new Date()) {
  const target = resolveCountdownDate(spec, now);
  if (!target) return 0;
  const days = daysUntil(target, now);
  return Number.isInteger(days) ? days : 0;
}

export function countdownWidgetTheme(theme) {
  return COUNTDOWN_WIDGET_THEMES.includes(theme) ? theme : 'classic';
}

const WIDGET_ITEM_KEYS = ['id', 'title', 'date', 'repeat', 'lunar', 'lunarMonth', 'lunarDay', 'lunarLeap'];

/** 推给原生的快照。只有标题、日期和算天数需要的字段，没有备注、图片、天数。 */
export function countdownWidgetSnapshot(countdowns, theme) {
  const items = (Array.isArray(countdowns) ? countdowns : []).map(entry => {
    const item = {
      id: String(entry?.id || '').slice(0, 80),
      title: String(entry?.title || '').trim().slice(0, 40),
      date: /^\d{4}-\d{2}-\d{2}$/.test(entry?.date || '') ? entry.date : ''
    };
    if (entry?.repeat === 'yearly') item.repeat = 'yearly';
    if (entry?.lunar === true) {
      item.lunar = true;
      const lunarMonth = Number(entry.lunarMonth);
      const lunarDay = Number(entry.lunarDay);
      if (Number.isInteger(lunarMonth) && lunarMonth >= 1 && lunarMonth <= 12) item.lunarMonth = lunarMonth;
      if (Number.isInteger(lunarDay) && lunarDay >= 1 && lunarDay <= 30) item.lunarDay = lunarDay;
      if (entry.lunarLeap === true) item.lunarLeap = true;
    }
    return item;
  }).filter(item => item.id && item.title && item.date);
  return {
    theme: countdownWidgetTheme(theme),
    items: items.map(item => Object.fromEntries(WIDGET_ITEM_KEYS.filter(key => key in item).map(key => [key, item[key]])))
  };
}

export function nearestCountdown(items, now = new Date()) {
  const rows = (Array.isArray(items) ? items : []).map((item, index) => ({
    item,
    index,
    days: countdownDaysUntil(item, now)
  }));
  const upcoming = rows.filter(row => row.days >= 0).sort((a, b) => a.days - b.days || a.index - b.index);
  const past = rows.filter(row => row.days < 0).sort((a, b) => b.days - a.days || a.index - b.index);
  return (upcoming[0] || past[0])?.item || null;
}

export function countdownWidgetCopy(days) {
  if (days === 0) return { number: '0', unit: '就是今天', label: '今天' };
  if (days < 0) return { number: String(-days), unit: '天前', label: '已经过去' };
  return { number: String(days), unit: '天后', label: '倒数日' };
}
