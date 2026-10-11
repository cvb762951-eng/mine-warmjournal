import { CATEGORIES, dateKey, habitGoalMet, habitProgressForDate, ledgerCategoryMap, ledgerSummary, MOODS, WEATHERS } from '../model.js';
import { courses, practice, teachingWeek, coursesFor, weekDate, periodLabel } from '../timetable.js';

export const SEMANTIC_SOURCE_TYPES = ['journal', 'moment', 'todo', 'habit', 'focus', 'media', 'countdown', 'ledger', 'course'];
export const SEMANTIC_DEFAULT_LIMIT = 15;
export const SEMANTIC_DEFAULT_CHAR_BUDGET = 3800;

const SOURCE_LABELS = {
  journal: '日记', moment: 'Moments', todo: '待办', habit: '习惯',
  focus: '专注', media: '书影音', countdown: '倒数日', ledger: '账本汇总', course: '课表'
};
const STATUS_LABELS = {
  completed: '已完成', pending: '未完成', in_progress: '进行中', planned: '想看/想读',
  active: '进行中', archived: '已归档', upcoming: '未到期', passed: '已过去', today: '今天', scheduled: '已安排'
};
const FOCUS_MODE_LABELS = { pomo: '番茄专注', pomodoro: '番茄专注', countdown: '倒计时', stopwatch: '正向计时', free: '自由专注' };
const INTENT_PATTERNS = {
  journal: /日记|心情|情绪|焦虑|开心|难过|疲惫|压力|感受|状态|生活/,
  moment: /moments?|随手记|瞬间|照片|拍照|灵感|便签|生活|心情|焦虑/i,
  todo: /待办|计划|安排|任务|要做|完成|学习|复习|课程|作业|考试/,
  habit: /习惯|打卡|坚持|目标|进度|学习|阅读|运动|喝水|睡眠|早起/,
  focus: /专注|学习|复习|项目|时长|效率|心流|任务|课程|考试/,
  media: /书|电影|影视|影音|阅读|在读|在看|看过|读过|评分|观后感|读后感|笔记/,
  countdown: /倒数|倒计时|日期|截止|考试|生日|纪念|还有多久|哪天/,
  course: /课表|课程|上课|教室|第[一二三四五六七八九十0-9]+节|节课|星期[一二三四五六日天]|周[一二三四五六日天]|本周|下周|明天.*课|课.*明天/,
  ledger: /预算|消费|支出|花费|账本|钱|金额|分类|超支|剩余|财务/
};
const GENERIC_QUERY = /总结|回顾|了解我|发生了什么|近况|最近.*(?:生活|状态)|生活.*(?:怎么样|状态)/;
const STOP_TOKENS = new Set(['帮我', '看看', '一下', '最近', '近况', '怎么样', '什么', '我的', '我有', '有点', '关于', '请问', '可以']);

const clean = (value, limit = 240) => String(value || '')
  .replace(/data:image\/[^;]+;base64,[a-z0-9+/=]+/gi, '[图片]')
  .replace(/mine-media:\/\/\S+/gi, '[本地媒体]')
  .replace(/[\u0000-\u001f\u007f]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, limit);
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
const amount = value => Math.round((Number(value) || 0) * 100) / 100;
const displayAmount = value => Number.isInteger(amount(value)) ? String(amount(value)) : amount(value).toFixed(2);
const stablePart = value => clean(value, 100).replace(/[|\n\r]/g, '-');
const record = (sourceType, identity, fields) => ({
  stableKey: `${sourceType}:${stablePart(identity)}`,
  sourceType,
  date: validDate(fields.date),
  ...(fields.dateRange ? { dateRange: fields.dateRange } : {}),
  title: clean(fields.title, 100),
  summary: clean(fields.summary, 360),
  status: clean(fields.status, 32),
  relationLabels: [...new Set((fields.relationLabels || []).map(item => clean(item, 48)).filter(Boolean))].slice(0, 8),
  sensitivity: fields.sensitivity || 'personal',
  allowedScope: [...new Set(fields.allowedScope || ['chat-explicit', 'memory-refresh-explicit'])]
});

export function parseJournalContent(content, fallbackTitle = '') {
  const text = String(content || '').trim();
  const match = text.match(/^《([^》]{1,80})》\s*([\s\S]*)$/);
  return {
    title: clean(match?.[1] || fallbackTitle || '生活日记', 80),
    body: clean(match?.[2] ?? text, 320)
  };
}

function localDate(now) {
  const value = now instanceof Date ? now : new Date(now || Date.now());
  return Number.isFinite(value.getTime()) ? value : new Date();
}

function dateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function buildJournalRecords(state) {
  return Object.entries(state?.journals || {}).sort(([a], [b]) => a.localeCompare(b)).flatMap(([day, entry]) => {
    if (!validDate(day)) return [];
    const parsed = parseJournalContent(entry?.content, entry?.title);
    const mood = MOODS[entry?.mood]?.label || '';
    const weather = WEATHERS[entry?.weather]?.label || '';
    const meta = [mood ? `心情${mood}` : '', weather ? `天气${weather}` : '', ...(entry?.tags || [])].filter(Boolean);
    const summary = parsed.body || clean(entry?.summary, 240) || (entry?.photos?.length ? `有 ${entry.photos.length} 张照片` : '仅记录了状态');
    return [record('journal', day, { date: day, title: parsed.title, summary, status: 'completed', relationLabels: meta, sensitivity: 'sensitive-personal-content' })];
  });
}

function buildMomentRecords(state) {
  return (state?.snippets || []).map((item, index) => {
    const day = validDate(item?.date) || dateKey(new Date(Number(item?.createdAt) || Date.now()));
    const mediaCount = (item?.photos || []).length + (item?.videos || []).length || (item?.photo ? 1 : 0);
    const kind = item?.type === 'photo' ? '随手拍' : '随手记';
    const text = clean(item?.text || item?.summary, 300);
    const summary = [text, mediaCount ? `有 ${mediaCount} 个本地影像（未包含图片数据）` : ''].filter(Boolean).join('；');
    return record('moment', item?.id || `${day}-${index}`, { date: day, title: kind, summary: summary || '没有文字说明', status: 'completed', relationLabels: item?.tags || [], sensitivity: 'sensitive-personal-content' });
  });
}

function buildTodoRecords(state) {
  return (state?.todos || []).map((item, index) => record('todo', item?.id || `${item?.date}-${index}`, {
    date: item?.date,
    title: item?.title || '未命名待办',
    summary: item?.completed ? '这项待办已经完成' : '这项待办仍待完成',
    status: item?.completed ? 'completed' : 'pending',
    relationLabels: ['待办']
  }));
}

function buildHabitRecords(state, now) {
  const today = dateKey(now);
  return (state?.habits || []).filter(item => !item?.archived).map((item, index) => {
    const progress = habitProgressForDate(state, item, today);
    const done = habitGoalMet(item, progress);
    const period = item?.goalPeriod === 'weekly' ? '本周' : '今天';
    const target = item?.goalType === 'range' ? `${item.target}–${item.targetMax}` : item?.target;
    return record('habit', item?.id || index, {
      date: today,
      title: item?.name || '未命名习惯',
      summary: `${period}真实进度 ${progress}/${target}${item?.unit || '次'}`,
      status: done ? 'completed' : 'active',
      relationLabels: [item?.goalPeriod === 'weekly' ? '每周习惯' : '每日习惯']
    });
  });
}

function relationMaps(state) {
  return {
    projects: new Map((state?.focusProjects || []).map(item => [item.id, item])),
    categories: new Map((state?.focusCategories || []).map(item => [item.id, item])),
    habits: new Map((state?.habits || []).map(item => [item.id, item])),
    media: new Map((state?.media || []).map(item => [item.id, item]))
  };
}

function buildFocusRecords(state) {
  const maps = relationMaps(state);
  return (state?.sessions || []).map((item, index) => {
    const project = maps.projects.get(item?.projectId);
    const category = maps.categories.get(item?.categoryId);
    const habit = maps.habits.get(item?.habitId);
    const media = maps.media.get(item?.mediaId);
    const relations = [project?.name, category?.name, habit?.name, media?.title, CATEGORIES[item?.category]?.label].filter(Boolean);
    const duration = Math.max(0, Math.round(Number(item?.durationSeconds) || Number(item?.minutes || 0) * 60));
    const minutes = Math.round(duration / 60);
    const task = clean(item?.task, 120);
    return record('focus', item?.id || `${item?.date}-${index}`, {
      date: item?.date,
      title: project?.name || category?.name || clean(item?.category, 80) || '专注记录',
      summary: `${minutes} 分钟 · ${FOCUS_MODE_LABELS[item?.mode] || '自由专注'}${task ? ` · 任务：${task}` : ''}`,
      status: 'completed', relationLabels: relations
    });
  });
}

function buildMediaRecords(state) {
  const maps = relationMaps(state);
  return (state?.media || []).map((item, index) => {
    const linked = (state?.sessions || []).filter(session => session?.mediaId === item?.id);
    const linkedMinutes = linked.reduce((sum, session) => sum + Math.max(0, Number(session?.minutes) || 0), 0);
    const projects = linked.map(session => maps.projects.get(session?.projectId)?.name).filter(Boolean);
    const type = item?.type === 'book' ? '书籍' : '影视';
    const notes = clean(item?.notes, 280);
    const summary = [notes ? `笔记：${notes}` : '', item?.rating ? `评分 ${item.rating}/5` : '', linkedMinutes ? `关联专注 ${Math.round(linkedMinutes)} 分钟` : ''].filter(Boolean).join('；') || '暂无笔记和关联专注';
    return record('media', item?.id || index, {
      date: item?.completedDate || dateKey(new Date(Number(item?.updatedAt || item?.createdAt) || Date.now())),
      title: `${type}《${clean(item?.title, 80)}》`, summary, status: item?.status || 'planned',
      relationLabels: [type, ...projects]
    });
  });
}

function buildCountdownRecords(state, now) {
  const today = dateKey(now);
  return (state?.countdowns || []).map((item, index) => {
    const day = validDate(item?.date);
    const delta = day ? Math.round((new Date(`${day}T12:00:00`) - new Date(`${today}T12:00:00`)) / 86400000) : 0;
    const timing = delta === 0 ? '就是今天' : delta > 0 ? `还有 ${delta} 天` : `已经过去 ${Math.abs(delta)} 天`;
    return record('countdown', item?.id || index, { date: day, title: item?.title || '未命名倒数日', summary: [timing, clean(item?.note, 180)].filter(Boolean).join('；'), status: delta < 0 ? 'passed' : delta === 0 ? 'today' : 'upcoming', relationLabels: ['重要日期'], sensitivity: 'sensitive-personal-content' });
  });
}

function buildCourseRecords(state, today) {
  // today 由 buildSemanticRecords 传入，形如 'YYYY-MM-DD'（已按本地时区归一）。
  const anchor = new Date(`${dateOnly(today)}T12:00:00`);
  // 前后各 7 天：足够覆盖「下周一/这周还有几节课」这类问句，又不会把整个学期的课都塞进上下文。
  const COURSE_WINDOW_DAYS = 7;
  const overrides = state?.settings?.courseOverrides || {};
  const schedule = courses.map(item => ({ ...item, ...(overrides[item.id] || {}) }));
  const dayNames = ['一', '二', '三', '四', '五'];
  const records = [];
  const seenDates = new Set();
  for (let offset = -COURSE_WINDOW_DAYS; offset <= COURSE_WINDOW_DAYS; offset += 1) {
    const date = dateKey(new Date(anchor.getTime() + offset * 86400000));
    const weekday = new Date(`${date}T12:00:00`).getDay() || 7;
    if (weekday > 5 || seenDates.has(date)) continue;
    seenDates.add(date);
    for (const item of coursesFor(date, schedule)) {
      const week = teachingWeek(date);
      const time = periodLabel(item.period);
      records.push(record('course', `${date}-${item.id}`, {
        date,
        title: item.name || '未命名课程',
        summary: `${item.period}–${item.period + 1} 节${time ? ` · ${time}` : ''} · ${item.room || '教室未记录'} · ${item.teacher || '教师未记录'} · 第 ${week} 周${week % 2 ? '单周' : '双周'}`,
        status: date === today ? 'today' : 'scheduled',
        relationLabels: ['课表', '课程', `星期${dayNames[weekday - 1]}`, `第${week}周`],
        sensitivity: 'sensitive-personal-content',
        allowedScope: ['chat-explicit']
      }));
    }
  }
  const currentWeek = teachingWeek(today);
  for (let week = Math.max(1, currentWeek); week <= Math.min(18, Math.max(1, currentWeek) + 2); week += 1) {
    for (const item of practice.filter(entry => entry.weeks.includes(week))) {
      records.push(record('course', `practice-${week}-${item.name}`, {
        date: weekDate(week, 1),
        dateRange: { start: weekDate(week, 1), end: weekDate(week, 5) },
        title: item.name || '实训安排',
        summary: `第 ${week} 周实训 · ${item.teacher || '教师未记录'} · 具体节次和地点以学校通知为准`,
        status: week === currentWeek ? 'today' : 'scheduled',
        relationLabels: ['课表', '实训', `第${week}周`],
        sensitivity: 'sensitive-personal-content',
        allowedScope: ['chat-explicit']
      }));
    }
  }
  return records;
}

function buildLedgerRecords(state, now) {
  const summary = ledgerSummary(state, now);
  const period = summary?.period || {};
  const start = validDate(period.start);
  const end = validDate(period.end);
  const categories = ledgerCategoryMap(state);
  const totals = new Map();
  for (const item of (state?.transactions || [])) {
    if (item?.type !== 'expense' || !start || !end || item.date < start || item.date > end) continue;
    const label = categories[item.category]?.label || categories[item.category]?.name || '其他';
    totals.set(label, amount((totals.get(label) || 0) + Number(item.amount || 0)));
  }
  const budget = summary?.budgetProgress || {};
  if (!totals.size && !budget.total) return [];
  const categoryText = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label, total]) => `${label} ¥${displayAmount(total)}`).join('、');
  const budgetText = budget.total
    ? budget.spent > budget.total ? `预算超出 ¥${displayAmount(budget.spent - budget.total)}` : budget.spent === budget.total ? '预算恰好用完' : `预算剩余 ¥${displayAmount(budget.total - budget.spent)}`
    : '未设置总预算';
  const total = amount(summary?.monthExpense || 0);
  return [record('ledger', `${start || 'period'}-${end || 'period'}`, {
    date: end,
    dateRange: { start, end },
    title: '本期消费聚合',
    summary: [`总支出 ¥${displayAmount(total)}`, categoryText ? `分类汇总：${categoryText}` : '暂无分类支出', budgetText].join('；'),
    status: budget.total && budget.spent > budget.total ? 'over-budget' : 'active',
    relationLabels: [...totals.keys()],
    sensitivity: 'financial-aggregate',
    allowedScope: ['chat-explicit']
  })];
}

export function buildSemanticRecords(state, { now = new Date() } = {}) {
  const clock = localDate(now);
  return [
    ...buildJournalRecords(state), ...buildMomentRecords(state), ...buildTodoRecords(state),
    ...buildHabitRecords(state, clock), ...buildFocusRecords(state), ...buildMediaRecords(state),
    ...buildCountdownRecords(state, clock), ...buildCourseRecords(state, clock), ...buildLedgerRecords(state, clock)
  ].filter(item => SEMANTIC_SOURCE_TYPES.includes(item.sourceType));
}

function queryTokens(query) {
  const normalized = clean(query, 500).toLowerCase();
  const tokens = new Set();
  for (const match of normalized.matchAll(/[a-z0-9_-]{2,}|[\p{Script=Han}]{2,}/gu)) {
    const word = match[0];
    if (!STOP_TOKENS.has(word)) tokens.add(word);
    if (/^[\p{Script=Han}]+$/u.test(word) && word.length > 2) {
      for (let index = 0; index < word.length - 1; index += 1) {
        const pair = word.slice(index, index + 2);
        if (!STOP_TOKENS.has(pair)) tokens.add(pair);
      }
    }
  }
  return [...tokens];
}

function requestedDate(query, now) {
  const explicit = String(query || '').match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (validDate(explicit)) return explicit;
  const clock = localDate(now);
  if (/昨天/.test(query)) { clock.setDate(clock.getDate() - 1); return dateKey(clock); }
  if (/明天/.test(query)) { clock.setDate(clock.getDate() + 1); return dateKey(clock); }
  const weekday = String(query || '').match(/(?:(下周|本周|这周))?周([一二三四五六日天])/);
  if (weekday) {
    const wanted = ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 })[weekday[2]];
    const nowDay = clock.getDay();
    const monday = new Date(clock); monday.setDate(clock.getDate() - ((nowDay + 6) % 7));
    const offset = weekday[1] === '下周' ? 7 + ((wanted + 6) % 7) : weekday[1] ? ((wanted + 6) % 7) : ((wanted - nowDay + 7) % 7);
    const target = weekday[1] ? new Date(monday.getTime() + offset * 86400000) : new Date(clock.getTime() + offset * 86400000);
    return dateKey(target);
  }
  if (/今天/.test(query)) return dateKey(clock);
  return '';
}

function scoreRecord(item, query, tokens, intents, now) {
  if ((item.sourceType === 'ledger' && !intents.has('ledger')) || (item.sourceType === 'course' && !intents.has('course'))) return 0;
  const date = item.date || item.dateRange?.end || '';
  const targetDate = requestedDate(query, now);
  if (item.sourceType === 'course' && targetDate && date !== targetDate) return 0;
  const haystack = `${item.title} ${item.summary} ${item.status} ${item.relationLabels.join(' ')}`.toLowerCase();
  let score = intents.has(item.sourceType) ? 30 : 0;
  for (const token of tokens) if (token.length >= 2 && haystack.includes(token)) score += token.length >= 4 ? 10 : 5;
  if (targetDate && date === targetDate) score += 28;
  if (GENERIC_QUERY.test(query) && item.sourceType !== 'ledger') score += 22;
  if (score > 0 && ['pending', 'in_progress', 'active', 'upcoming', 'today'].includes(item.status)) score += 3;
  if (score > 0 && validDate(date)) {
    const days = Math.abs(Math.round((new Date(`${date}T12:00:00`) - localDate(now)) / 86400000));
    score += Math.max(0, 8 - Math.floor(days / 7));
  }
  return score;
}

function lineForRecord(item, query) {
  const labels = [];
  if (item.dateRange?.start && item.dateRange?.end) labels.push(`${item.dateRange.start}~${item.dateRange.end}`);
  else if (item.date) labels.push(item.date);
  const stateLabel = STATUS_LABELS[item.status] || (item.status === 'over-budget' ? '已超支' : '');
  if (stateLabel) labels.push(stateLabel);
  const relation = item.relationLabels.slice(0, 3).join('、');
  if (relation) labels.push(relation);
  let summary = item.summary;
  if (item.sourceType === 'focus' && !INTENT_PATTERNS.focus.test(query)) summary = summary.replace(/\s*·\s*任务：.*$/, '');
  const anchor = item.sourceType === 'journal' ? `（文中的今天/昨天以 ${item.date} 为准）` : '';
  return `[${SOURCE_LABELS[item.sourceType]}${labels.length ? `｜${labels.join('｜')}` : ''}] ${item.title}${summary ? `：${summary}` : ''}${anchor}`;
}

export function retrieveSemanticContext(state, query, { now = new Date(), limit = SEMANTIC_DEFAULT_LIMIT, charBudget = SEMANTIC_DEFAULT_CHAR_BUDGET, allowedScope = 'chat-explicit' } = {}) {
  const textQuery = clean(query, 500);
  if (!textQuery) return { query: '', records: [], text: '', count: 0, charCount: 0, truncated: false, limit, charBudget };
  const intents = new Set(Object.entries(INTENT_PATTERNS).filter(([, pattern]) => pattern.test(textQuery)).map(([source]) => source));
  const tokens = queryTokens(textQuery);
  const ranked = buildSemanticRecords(state, { now })
    .filter(item => item.allowedScope.includes(allowedScope))
    .map(item => ({ item, score: scoreRecord(item, textQuery, tokens, intents, now) }))
    .filter(entry => entry.score >= 20)
    .sort((a, b) => b.score - a.score || String(b.item.date || '').localeCompare(String(a.item.date || '')) || a.item.stableKey.localeCompare(b.item.stableKey));
  const records = [];
  const lines = [];
  let used = 0;
  let truncated = ranked.length > limit;
  for (const { item } of ranked.slice(0, Math.max(0, limit))) {
    const line = lineForRecord(item, textQuery);
    const extra = (lines.length ? 1 : 0) + line.length;
    if (used + extra > charBudget) { truncated = true; break; }
    records.push(item);
    lines.push(line);
    used += extra;
  }
  if (truncated && used + 18 <= charBudget) lines.push('…（更多相关记录已在本机截断）');
  const text = lines.join('\n');
  return { query: textQuery, records, text, count: records.length, charCount: text.length, truncated, limit, charBudget };
}

export function buildSemanticOverview(state, { now = new Date(), limit = 18, charBudget = 4200 } = {}) {
  return retrieveSemanticContext(state, '最近生活心情日记随手记待办计划习惯专注学习书影音倒数日', { now, limit, charBudget, allowedScope: 'memory-refresh-explicit' });
}

export function semanticRecordLabel(item) {
  const date = item?.date || (item?.dateRange ? `${item.dateRange.start}~${item.dateRange.end}` : '无日期');
  return `${SOURCE_LABELS[item?.sourceType] || item?.sourceType || '记录'}｜${date}｜${clean(item?.title, 60)}`;
}
