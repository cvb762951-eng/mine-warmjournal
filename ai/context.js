import { dateKey, daysUntil, periodSummary, todayCompletion, todosForDate, ledgerSummary, WEEK_DAYS, MOODS } from '../model.js';

// R2：低落类心情（伤心/焦虑/低落类，由 AI 岗位界定）。情绪数据只在陪伴场景使用，不参与打卡/统计。
export const LOW_MOODS = new Set(['sad', 'anxious', 'tired']);

export function fmt(minutes) {
  minutes = Math.round(minutes || 0);
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

// 今日洞察只依赖当天的用户记录；刻意不读取 aiDailyInsight，避免保存洞察后触发刷新循环。
export function insightDataFingerprint(state, today = dateKey()) {
  return JSON.stringify({ today, sessions: (state.sessions || []).filter(item => item.date === today), journals: state.journals?.[today] || null, todos: (state.todos || []).filter(item => item.date === today), transactions: (state.transactions || []).filter(item => item.date === today && item.type !== 'transfer'), checks: state.checks?.[today] || null, habitCompletions: state.habitCompletions?.[today] || null, habitSkips: state.habitSkips?.[today] || null });
}

export function rollingWeekSummaryAnchor(now = new Date()) {
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1); yesterday.setHours(12, 0, 0, 0);
  return yesterday;
}

// R2：近 14 天心情序列 + 连续低落检测（跳过无心情记录的日期）。
// 返回结构：{ enabled, series: [{day,mood,label}], lowStreak, lowSince, isLow }
export function buildMoodSummary(state, windowDays = 14) {
  const enabled = (state.settings || {}).aiEmotionCare !== false;
  const from = new Date();
  from.setDate(from.getDate() - windowDays + 1);
  const fromKey = dateKey(from);
  const series = [];
  for (const day of Object.keys(state.journals || {}).sort()) {
    if (day < fromKey) continue;
    const mood = state.journals[day]?.mood;
    if (mood && MOODS[mood]) series.push({ day, mood, label: MOODS[mood].label });
  }
  let lowStreak = 0;
  let lowSince = '';
  for (let i = series.length - 1; i >= 0; i--) {
    if (LOW_MOODS.has(series[i].mood)) {
      if (!lowStreak) lowSince = series[i].day;
      lowStreak++;
    } else break;
  }
  return { enabled, series, lowStreak, lowSince, isLow: lowStreak >= 3 };
}

// R1：最近最重要的 1 个倒计时（最近目标日），没有则返回 null
export function nearestCountdown(state) {
  const upcoming = (state.countdowns || [])
    .map(c => ({ c, d: daysUntil(c.date) }))
    .filter(x => x.c.date && x.d >= 0)
    .sort((a, b) => a.d - b.d);
  const nearest = upcoming[0];
  if (!nearest) return null;
  return { title: nearest.c.title, days: nearest.d, note: nearest.c.note || '' };
}

// R1：纪念日判定（countdown 无类型字段，由标题关键词判定；无法判定则返回 null）
const ANNIVERSARY_PATTERNS = [
  { type: 'birthday', re: /(生日|诞辰|生辰)/ },
  { type: 'anniversary', re: /(纪念日|周年|结婚|领证|相遇|告白|在一起|纪念)/ }
];
export function todayAnniversary(state) {
  const today = dateKey();
  for (const c of state.countdowns || []) {
    if (c.date !== today) continue;
    for (const pattern of ANNIVERSARY_PATTERNS) {
      if (pattern.re.test(c.title)) return { type: pattern.type, title: c.title, note: c.note || '' };
    }
  }
  return null;
}

// R7：日记注入增强——近 3 天全文、第 4-10 天 150-200 字摘要、第 11-40 天每 3 天取 1 篇 80 字印象；
// 总量控制在 budget 内（超长截取中间主要部分并注明省略）；心情标签照旧带上。返回空串表示无日记。
export function buildJournalBlock(state, budget = 2000) {
  const journals = state.journals || {};
  const days = Object.keys(journals).sort();
  if (!days.length) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayDiff = day => Math.round((new Date(`${day}T00:00:00`) - today) / 86400000);
  const recent = [];
  const mid = [];
  const old = [];
  for (const day of days) {
    if (dayDiff(day) > 0) continue;
    const entry = journals[day];
    const content = String(entry?.content || '').replace(/\s+/g, ' ').trim();
    if (!content && !entry?.mood) continue;
    const moodTag = entry?.mood && MOODS[entry.mood] ? `（心情：${MOODS[entry.mood].label}）` : '';
    const item = { day, content, moodTag };
    const diff = dayDiff(day);
    if (diff >= -2) recent.push(item);
    else if (diff >= -9) mid.push(item);
    else if (diff >= -39) old.push(item);
  }
  // 更早的日记印象：每 3 天取 1 篇（从较近的往回想 3 步取 1）
  const sampled = [];
  for (let i = old.length - 1; i >= 0; i -= 3) sampled.push(old[i]);
  sampled.reverse();
  // 中间截取（长文取中间主要部分并注明省略）
  const excerpt = (text, len) => text.length <= len
    ? text
    : `…${text.slice(Math.floor((text.length - len) / 2), Math.floor((text.length - len) / 2) + len)}…`;
  const lines = [];
  let used = 0;
  const push = text => {
    if (used >= budget) return;
    const room = budget - used;
    if (text.length > room) { lines.push(`${text.slice(0, room)}…（已截断）`); used = budget; }
    else { lines.push(text); used += text.length; }
  };
  if (recent.length || mid.length || sampled.length) {
    push('日期语义：以下日记每篇按「该日期」记录当天生活，日记内容里的今天/昨天/前天等时间词一律以该篇日记标注的日期为准，与当前对话日期无关。');
  }
  if (recent.length) {
    push('近 3 天日记：');
    for (const { day, content, moodTag } of recent) push(`- ${day}${moodTag}：${excerpt(content, 700)}`);
  }
  if (mid.length) {
    push('前 7 天日记摘要：');
    for (const { day, content, moodTag } of mid) push(`- ${day}${moodTag}：${excerpt(content, 190)}`);
  }
  if (sampled.length) {
    push('更早的日记印象（每 3 天取 1 篇）：');
    for (const { day, content, moodTag } of sampled) push(`- ${day}${moodTag}：${excerpt(content, 80)}`);
  }
  return lines.join('\n');
}

// 把账本摘要转成不含任何金额的定性描述。
// 分档而非报数：AI 只需要知道「消费水平偏高还是正常、预算紧不紧」，不需要知道用户花了多少钱。
// 与周报（ai/generate.js）口径一致，两者都只发定性信号。
function describeLedgerQualitatively(ledger) {
  const parts = [];
  parts.push(`本期消费${amountBand(ledger.monthExpense)}`);
  parts.push(ledger.monthIncome > 0 ? `收入${amountBand(ledger.monthIncome)}` : '本期还没有记录收入');
  const percent = Number(ledger.budgetProgress?.percent || 0);
  if (!ledger.budgetProgress?.total) parts.push('未设置预算');
  else if (percent >= 100) parts.push(`预算已超支（用掉约 ${Math.min(999, percent)}%）`);
  else if (percent >= 80) parts.push(`预算接近上限（用掉约 ${percent}%）`);
  else parts.push(`预算有剩余（用掉约 ${percent}%）`);
  if (ledger.receivableBalance > 0) parts.push('有外借未收回');
  return `账本：${parts.join('，')}。预算只对应消费，转账不计入收支。`;
}

// 粗粒度金额分档：不给数字，只给量级区间，避免总额外泄。
function amountBand(value) {
  const amount = Number(value || 0);
  if (!(amount > 0)) return '几乎没有';
  if (amount < 50) return '很少';
  if (amount < 200) return '不算多';
  if (amount < 500) return '中等';
  if (amount < 1000) return '偏多';
  if (amount < 3000) return '较多';
  return '很多';
}

// 把整个 App 的数据转成结构化摘要，喂给大模型，让它"了解"用户状态
// now 可注入，便于测试与「以某个历史时间为基准」的调用方（如补生成的每日小结）复用。
export function buildAiContext(state, now = new Date()) {
  const lines = [];
  const profile = state.profile || {};
  if (profile.name) lines.push(`用户：${profile.name}${profile.motto ? `（${profile.motto}）` : ''}`);

  // 当前日期：明确告诉 AI「今天」是几号，避免把昨天的日记/记录误读成今天
  lines.push(`今天是 ${now.getMonth() + 1} 月 ${now.getDate()} 日（星期${WEEK_DAYS[now.getDay()]}）`);

  // 倒数日
  const upcoming = (state.countdowns || [])
    .map(c => ({ c, d: daysUntil(c.date) }))
    .filter(x => x.c.date && x.d >= 0)
    .sort((a, b) => a.d - b.d);
  if (upcoming.length) {
    const nearest = upcoming[0];
    lines.push(`重要日子：${nearest.c.title}（还有 ${nearest.d} 天）${nearest.c.note ? `，备注：${nearest.c.note}` : ''}`);
    if (upcoming.length > 1) lines.push(`其他倒数日：${upcoming.slice(1, 4).map(x => `${x.c.title}（${x.d} 天）`).join('、')}`);
  }

  // 累计学习（全部历史，按分组）
  const allGroup = new Map();
  for (const session of (state.sessions || [])) {
    const project = (state.focusProjects || []).find(p => p.id === session.projectId);
    const key = project?.group || '其他';
    allGroup.set(key, (allGroup.get(key) || 0) + session.minutes);
  }
  if (allGroup.size) {
    const total = [...allGroup.values()].reduce((a, b) => a + b, 0);
    lines.push(`累计学习共 ${fmt(total)}：${[...allGroup.entries()].sort((a, b) => b[1] - a[1]).map(([name, minutes]) => `${name} ${fmt(minutes)}`).join('，')}`);
  }

  // 本周各科学习
  const week = periodSummary(state, 'week');
  const groupMap = new Map();
  for (const [pid, minutes] of Object.entries(week.byProject)) {
    const project = (state.focusProjects || []).find(p => p.id === pid);
    const key = project?.group || '其他';
    if (!groupMap.has(key)) groupMap.set(key, { total: 0, projects: [] });
    const g = groupMap.get(key);
    g.total += minutes;
    if (project) g.projects.push({ name: project.name, minutes, target: project.weeklyTargetMinutes || 0 });
  }
  if (groupMap.size) {
    lines.push('本周各科学习时长：');
    for (const [name, g] of [...groupMap.entries()].sort((a, b) => b[1].total - a[1].total)) {
      const target = g.projects.reduce((s, p) => s + p.target, 0);
      const detail = g.projects.map(p => `${p.name} ${fmt(p.minutes)}`).join('，');
      lines.push(`- ${name}：${fmt(g.total)}${target ? `（周目标 ${fmt(target)}，完成 ${Math.round(g.total / target * 100)}%）` : ''}；明细：${detail}`);
    }
  }

  // 今日学习
  const today = dateKey();
  const todaySessions = (state.sessions || []).filter(s => s.date === today);
  const todayMinutes = todaySessions.reduce((s, x) => s + x.minutes, 0);
  if (todayMinutes) {
    const byGroup = new Map();
    todaySessions.forEach(s => {
      const p = (state.focusProjects || []).find(x => x.id === s.projectId);
      const key = p?.group || '其他';
      byGroup.set(key, (byGroup.get(key) || 0) + s.minutes);
    });
    lines.push(`今日已学习：${fmt(todayMinutes)}（${[...byGroup.entries()].map(([k, m]) => `${k} ${fmt(m)}`).join('，')}）`);
  } else {
    lines.push('今日还没有学习记录');
  }

  // 今日待办
  const todos = todosForDate(state, today);
  const open = todos.filter(t => !t.done);
  if (todos.length) lines.push(`今日待办 ${todos.length} 项（未完成 ${open.length}）：${open.slice(0, 8).map(t => t.title).join('、')}`);

  // 习惯打卡
  const completion = todayCompletion(state);
  if (completion.total) lines.push(`今日习惯打卡：${completion.done}/${completion.total} 完成`);

  // 书影音
  const reading = (state.media || []).filter(m => m.status === 'in_progress');
  if (reading.length) lines.push(`在看在读：${reading.map(m => `《${m.title}》`).join('、')}`);
  const finished = (state.media || []).filter(m => m.status === 'completed');
  if (finished.length) lines.push(`已完成书影音：${finished.map(m => `《${m.title}》`).join('、')}`);

  // 账目统计必须与同一个 now 对齐，否则「当前日期」说的是 9 月、账目算的却是 10 月。
  const ledger = ledgerSummary(state, now);
  // 最小外发载荷：这里只输出定性状态与粗粒度分档，绝不外发精确金额/账户余额/应收款。
  // 理由：通用 context 会喂给几乎所有 AI 入口（鼓励语、问候、小结、提醒文案、日记引导、记忆提炼），
  // 而这些场景只需要「钱紧不紧」，不需要知道具体数字。需要精确数值的分析类功能（周报、消费分析）
  // 走各自的专用实现，各自按最小必要原则单独取数。
  if (ledger.monthExpense || ledger.monthIncome || ledger.totalAssets) {
    lines.push(describeLedgerQualitatively(ledger));
  }

  // 日记（增强注入：近 3 天全文 / 前 7 天摘要 / 更早每 3 天 1 条印象，总量 ~2000 字，心情标签带上）
  const journalBlock = buildJournalBlock(state);
  if (journalBlock) lines.push(journalBlock);

  // 近期心情（R2：陪伴场景专用；aiEmotionCare 关闭时不输出）
  const mood = buildMoodSummary(state);
  if (mood.enabled && mood.series.length) {
    const moodText = mood.series.map(item => {
      const date = new Date(`${item.day}T00:00:00`);
      return `${date.getMonth() + 1} 月 ${date.getDate()} 日（周${WEEK_DAYS[date.getDay()]}）${item.label}`;
    }).join('，');
    if (mood.lowStreak >= 1) {
      lines.push(`近期心情（近 14 天，他最近连续 ${mood.lowStreak} 天有低落心情记录）：${moodText}${mood.lowStreak >= 3 ? '（连续 3 天及以上，请多关心一句）' : ''}`);
    } else {
      lines.push(`近期心情（近 14 天）：${moodText}`);
    }
  }

  return lines.join('\n');
}
