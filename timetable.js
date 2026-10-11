// 默认课表只用于首次启用/旧版本迁移；运行时始终读取 state.settings.timetable。
const legacyWeeks = (end, tail = 0) => [...Array.from({ length: Math.min(end, 5) }, (_, i) => i + 1), ...Array.from({ length: Math.max(0, tail - 10) }, (_, i) => i + 11)];
const legacyCourse = (id, day, period, name, teacher, room, activeWeeks, parity = '') => ({ id, day, period, name, teacher, room, weeks: activeWeeks.filter(value => !parity || (parity === 'odd' ? value % 2 : !(value % 2))) });

export const semesterStart = '2026-09-07';
export const periodTimes = {
  1: { start: '08:00', end: '09:40' },
  3: { start: '10:00', end: '11:40' },
  5: { start: '14:30', end: '16:10' },
  7: { start: '16:30', end: '18:10' },
  9: { start: '19:30', end: '21:10' }
};
export const courses = [
  legacyCourse('m1', 1, 1, '智能制造技术基础', '乔东平', '教三楼213', legacyWeeks(5, 14)),
  legacyCourse('m2', 1, 3, '形势与政策5', '牛纪凤', '教三楼104', legacyWeeks(4)),
  legacyCourse('m3', 1, 5, '智能生产计划与控制', '张丽科', '教一楼218', legacyWeeks(5, 15)),
  legacyCourse('m4', 1, 7, '毛泽东思想和中国特色社会主义理论体系概论', '聂海杰', '教二楼109', legacyWeeks(5, 17), 'odd'),
  legacyCourse('m5', 1, 9, '科技文献检索', '聂钰洪', '教三楼205', legacyWeeks(5, 13)),
  legacyCourse('t3', 2, 5, '现代电气与可编程控制技术', '李琳利', '教二楼217', legacyWeeks(5, 15)),
  legacyCourse('w2', 3, 3, '智能生产计划与控制', '张丽科', '教一楼218', legacyWeeks(5, 15), 'even'),
  legacyCourse('w3a', 3, 5, '智能制造技术基础', '乔东平', '教一楼218', legacyWeeks(5, 14), 'odd'),
  legacyCourse('w3b', 3, 5, '控制工程基础B', '王鹏鹏', '教一楼218', legacyWeeks(5, 15), 'even'),
  legacyCourse('w4', 3, 7, '毛泽东思想和中国特色社会主义理论体系概论', '聂海杰', '教二楼109', legacyWeeks(5, 17), 'odd'),
  legacyCourse('th2', 4, 3, '传感器与智能检测技术', '张玉彦', '教一楼124', legacyWeeks(5, 17)),
  legacyCourse('f2', 5, 3, '现代电气与可编程控制技术', '李琳利', '教二楼217', legacyWeeks(5, 15), 'even'),
  legacyCourse('f3', 5, 5, '液压与气压传动', '孙春亚', '教一楼105', legacyWeeks(5, 17)),
  legacyCourse('f4', 5, 7, '控制工程基础B', '王鹏鹏', '教一楼213', legacyWeeks(5, 15))
];
export const practice = [
  { id: 'practice-1', weeks: [6, 7, 8], name: '机械基础工程训练（二）', teacher: '崔光珍' },
  { id: 'practice-2', weeks: [9], name: '电子实习B', teacher: '王俊杰、周振' },
  { id: 'practice-3', weeks: [10], name: '电工实习B', teacher: '顾冬华、杨立' }
];

const defaultPeriods = () => Object.entries(periodTimes).map(([period, time]) => ({
  id: `period-${period}`,
  startPeriod: Number(period),
  endPeriod: Number(period) + 1,
  start: time.start,
  end: time.end
}));

const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
const clampInt = (value, min, max, fallback = min) => Math.max(min, Math.min(max, Math.floor(Number(value) || fallback)));
const normalizedWeeks = (values, totalWeeks) => [...new Set((Array.isArray(values) ? values : []).map(Number).filter(value => Number.isInteger(value) && value >= 1 && value <= totalWeeks))].sort((a, b) => a - b);

export function makeDefaultTimetable(courseOverrides = {}) {
  return {
    semesterName: '2026–2027 学年第一学期',
    semesterStart,
    totalWeeks: 18,
    periods: defaultPeriods(),
    courses: courses.map(item => ({ ...item, ...(courseOverrides?.[item.id] || {}), weeks: [...item.weeks] })),
    practice: practice.map(item => ({ ...item, weeks: [...item.weeks] }))
  };
}

export function normalizeTimetable(input, courseOverrides = {}) {
  const fallback = makeDefaultTimetable(courseOverrides);
  if (!input || typeof input !== 'object') return fallback;
  const totalWeeks = clampInt(input.totalWeeks, 1, 60, fallback.totalWeeks);
  const periods = (Array.isArray(input.periods) ? input.periods : fallback.periods).map((item, index) => {
    const startPeriod = clampInt(item?.startPeriod, 1, 30, index * 2 + 1);
    return {
      id: String(item?.id || `period-${startPeriod}`).slice(0, 80),
      startPeriod,
      endPeriod: clampInt(item?.endPeriod, startPeriod, 30, startPeriod + 1),
      start: validTime(item?.start) ? item.start : '08:00',
      end: validTime(item?.end) ? item.end : '09:40'
    };
  }).filter((item, index, list) => list.findIndex(entry => entry.startPeriod === item.startPeriod) === index).sort((a, b) => a.startPeriod - b.startPeriod).slice(0, 20);
  const periodIds = new Set(periods.map(item => item.startPeriod));
  const normalizedCourses = (Array.isArray(input.courses) ? input.courses : fallback.courses).map(item => ({
    id: String(item?.id || crypto.randomUUID()).slice(0, 80),
    day: clampInt(item?.day, 1, 7, 1),
    period: clampInt(item?.period, 1, 30, 1),
    name: String(item?.name || '').trim().slice(0, 80),
    teacher: String(item?.teacher || '').trim().slice(0, 60),
    room: String(item?.room || '').trim().slice(0, 60),
    weeks: normalizedWeeks(item?.weeks, totalWeeks)
  })).filter(item => item.name && item.weeks.length && periodIds.has(item.period)).filter((item, index, list) => list.findIndex(entry => entry.id === item.id) === index).slice(0, 300);
  const normalizedPractice = (Array.isArray(input.practice) ? input.practice : fallback.practice).map(item => ({
    id: String(item?.id || crypto.randomUUID()).slice(0, 80),
    name: String(item?.name || '').trim().slice(0, 80),
    teacher: String(item?.teacher || '').trim().slice(0, 60),
    weeks: normalizedWeeks(item?.weeks, totalWeeks)
  })).filter(item => item.name && item.weeks.length).filter((item, index, list) => list.findIndex(entry => entry.id === item.id) === index).slice(0, 100);
  return {
    semesterName: String(input.semesterName || fallback.semesterName).trim().slice(0, 80) || fallback.semesterName,
    semesterStart: validDate(input.semesterStart) ? input.semesterStart : fallback.semesterStart,
    totalWeeks,
    periods: periods.length ? periods : fallback.periods,
    courses: normalizedCourses,
    practice: normalizedPractice
  };
}

const scheduleStart = schedule => typeof schedule === 'string' ? schedule : schedule?.semesterStart || semesterStart;
// 只取日期部分：调用方可能传 'YYYY-MM-DD'、完整 ISO 时间戳或 Date，统一归一到 'YYYY-MM-DD' 再算，
// 否则传时间戳会被再拼一次 T00:00:00Z 变成 NaN。
const dateOnly = value => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value || '').trim();
  const matched = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return matched ? matched[1] : text;
};
export function teachingWeek(day, schedule) { return Math.floor((Date.parse(`${dateOnly(day)}T00:00:00Z`) - Date.parse(`${dateOnly(scheduleStart(schedule))}T00:00:00Z`)) / 604800000) + 1; }
export function coursesFor(day, entries = courses, schedule) { const week = teachingWeek(day, schedule), weekday = new Date(`${day}T12:00:00Z`).getUTCDay() || 7; return entries.filter(item => item.day === weekday && item.weeks.includes(week)).sort((a, b) => a.period - b.period); }
export function weekDate(week, day, schedule) { return new Date(Date.parse(`${scheduleStart(schedule)}T00:00:00Z`) + ((week - 1) * 7 + day - 1) * 86400000).toISOString().slice(0, 10); }
export function periodLabel(period, schedule) { const slot = schedule?.periods?.find(item => item.startPeriod === Number(period)); const time = slot || periodTimes[period]; return time ? `${time.start}–${time.end}` : '时间待定'; }
export function periodRangeLabel(period, schedule) { const slot = schedule?.periods?.find(item => item.startPeriod === Number(period)); return slot ? `${slot.startPeriod}–${slot.endPeriod} 节` : `${period}–${Number(period) + 1} 节`; }
export function courseMoment(day, entries = courses, now = new Date(), schedule) {
  const list = coursesFor(day, entries, schedule);
  if (!list.length) return { type: 'empty', item: null, remaining: 0 };
  const minute = now.getHours() * 60 + now.getMinutes();
  const toMinute = value => { const [hour, tail] = String(value).split(':').map(Number); return hour * 60 + tail; };
  const slotFor = item => schedule?.periods?.find(slot => slot.startPeriod === item.period) || periodTimes[item.period];
  const timed = list.filter(item => slotFor(item));
  const active = timed.find(item => minute >= toMinute(slotFor(item).start) && minute < toMinute(slotFor(item).end));
  if (active) return { type: 'active', item: active, remaining: list.filter(item => item.period > active.period).length };
  const next = timed.find(item => minute < toMinute(slotFor(item).start));
  return next ? { type: 'next', item: next, remaining: list.filter(item => item.period > next.period).length } : { type: 'finished', item: list.at(-1), remaining: 0 };
}
