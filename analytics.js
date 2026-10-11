import { dateKey, habitsForDate, habitGoalMet, habitProgressForDate, ledgerSummary } from './model.js';

const minutesOf = session => {
  const seconds = Number(session?.durationSeconds);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds / 60) : Math.max(0, Number(session?.minutes) || 0);
};
const dateAtNoon = value => new Date(`${value}T12:00:00`);
const rangeDays = (start, end) => {
  const days = [];
  for (const date = dateAtNoon(start); date <= dateAtNoon(end); date.setDate(date.getDate() + 1)) days.push(dateKey(date));
  return days;
};
const sum = (items, pick) => items.reduce((total, item) => total + (Number(pick(item)) || 0), 0);

// ---------------------------------------------------------------------------
// 习惯统计原语（2026-10-20 重做）
//
// 背景：旧的 habitArchiveMetrics / warmWeeklyLifeMetrics 把「周目标习惯」当成
// 「每天都要达标」来统计 —— 用户设「每周 3 次跑步」，周一二三做完、周四到周日
// 本来就没打算做，统计却报 3/7 天 43%「未达标」。越认真记越挫败。
//
// 三个原则：
//   1. 周目标按周算，不按天算。
//   2. 连续天数按单个习惯独立计算，互不牵连（漏一次喝水不该让运动归零）。
//   3. 用户主动标的休息日不进分母 —— 主动休息是加分不是扣分。
// ---------------------------------------------------------------------------

/** 该习惯在这一天是否被用户主动标为休息。 */
export function habitRestDay(state, habitId, day) {
  return new Set(state.habitSkips?.[day] || []).has(habitId);
}

/**
 * 单个习惯在给定日期区间的完成情况。
 * 返回的 days 里：
 *   planned=true 需要做（未休息）；rest=true 用户主动休息
 *   met=当次进度是否达标（周目标按整周进度判定）
 */
export function habitRangeStatus(state, habitId, days) {
  const habit = (state.habits || []).find(item => item.id === habitId);
  if (!habit) return null;
  const rows = days.map(day => {
    const rest = habitRestDay(state, habitId, day);
    const value = habitProgressForDate(state, habit, day);
    const met = !rest && habitGoalMet(habit, value);
    return { day, value, rest, met, planned: !rest };
  });
  const plannedRows = rows.filter(row => row.planned);
  const metRows = plannedRows.filter(row => row.met);
  return {
    habit,
    days: rows,
    plannedDays: plannedRows.length,
    restDays: rows.length - plannedRows.length,
    metDays: metRows.length,
    // 休息日不进分母
    rate: plannedRows.length ? Math.round(metRows.length / plannedRows.length * 100) : 0,
    current: habitProgressForDate(state, habit, days[days.length - 1] || dateKey()),
    target: habit.target
  };
}

/**
 * 连续天数（单个习惯独立算）。
 * 口径：当天该习惯达标 → 累加；主动休息 → 不打断也不累加；漏做 → 归零。
 */
export function habitStreak(state, habitId, days) {
  let current = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const day = days[index];
    if (habitRestDay(state, habitId, day)) continue;
    const habit = (state.habits || []).find(item => item.id === habitId);
    if (!habit) break;
    if (habitGoalMet(habit, habitProgressForDate(state, habit, day))) current += 1;
    else break;
  }
  let longest = 0;
  let run = 0;
  days.forEach(day => {
    if (habitRestDay(state, habitId, day)) return;
    const habit = (state.habits || []).find(item => item.id === habitId);
    if (habit && habitGoalMet(habit, habitProgressForDate(state, habit, day))) { run += 1; longest = Math.max(longest, run); }
    else run = 0;
  });
  return { current, longest };
}

/**
 * 周目标习惯的进度条：这一周做了几次 / 要几次。
 * 周目标习惯的进度天然按周累加（见 habitProgressForDate），
 * 所以只看「今天这一周」就够了，不需要再乘 7。
 */
export function habitWeekProgress(state, habitId, day = dateKey()) {
  const habit = (state.habits || []).find(item => item.id === habitId);
  if (!habit) return null;
  const done = Number(habitProgressForDate(state, habit, day)) || 0;
  const target = Math.max(1, Number(habit.target) || 1);
  return { habit, done, target, met: done >= target, percent: Math.min(100, Math.round(done / target * 100)) };
}

/** 一句人话评价，替代生硬的百分比。 */
export function habitVerdict(status) {
  if (!status) return { text: '暂无记录', tone: 'idle' };
  if (status.goalPeriod === 'weekly') {
    if (status.metThisPeriod) return { text: `本周已完成 ${status.metThisPeriod}/${status.target}`, tone: 'good' };
    const left = Math.max(0, status.target - status.metThisPeriod);
    return { text: `本周还差 ${left} 次`, tone: 'mid' };
  }
  if (!status.plannedDays) return { text: '这几天都休息了', tone: 'idle' };
  if (status.rate >= 90) return { text: `${status.plannedDays} 天里做到了 ${status.metDays} 天`, tone: 'good' };
  if (status.rate >= 60) return { text: `${status.plannedDays} 天里做到了 ${status.metDays} 天`, tone: 'mid' };
  return { text: `这阵子状态回落了，慢慢来`, tone: 'low' };
}

export function completeStatsWeekSummary(state, summary) {
  if (!summary?.start) return summary;
  const start = dateAtNoon(summary.start);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const previousStart = new Date(start); previousStart.setDate(start.getDate() - 7);
  const previousEnd = new Date(start); previousEnd.setDate(start.getDate() - 1);
  const currentDays = rangeDays(dateKey(start), dateKey(end));
  const previousDays = rangeDays(dateKey(previousStart), dateKey(previousEnd));
  const sessions = (state.sessions || []).filter(item => currentDays.includes(item.date));
  const previousSessions = (state.sessions || []).filter(item => previousDays.includes(item.date));
  const totalMinutes = sum(sessions, minutesOf);
  const previousMinutes = sum(previousSessions, minutesOf);
  const byProject = {};
  sessions.forEach(item => {
    const id = item.categoryId || item.projectId || '';
    if (id) byProject[id] = (byProject[id] || 0) + minutesOf(item);
  });
  return {
    ...summary,
    end: dateKey(end),
    sessions,
    totalMinutes,
    previousMinutes,
    difference: totalMinutes - previousMinutes,
    averageMinutes: Math.round(totalMinutes / 7),
    longestMinutes: sessions.reduce((maximum, item) => Math.max(maximum, minutesOf(item)), 0),
    byProject,
    daily: currentDays.map((day, index) => ({ day, label: ['一', '二', '三', '四', '五', '六', '日'][index], minutes: sum(sessions.filter(item => item.date === day), minutesOf) }))
  };
}

export function habitArchiveMetrics(state, habitId, year, heatmap, now = new Date()) {
  const habit = (state.habits || []).find(item => item.id === habitId);
  const days = Array.isArray(heatmap?.days) ? heatmap.days : [];
  if (!habit) return { habitId:String(habitId || ''), habitName:'', year:Number(year) || now.getFullYear(), daysInYear:days.length, plannedDays:0, completedDays:0, completionRate:0, currentStreak:0, longestStreak:0, totalActiveDays:0, levelCounts:{0:days.length,1:0,2:0,3:0,4:0}, today:{date:dateKey(now),status:'unavailable',value:0,level:0}, futureDays:0, plannedDates:[], achievements:[] };
  const today = dateKey(now);
  const occurred = days.filter(item => item.date <= today);
  const planned = occurred.filter(item => habitsForDate(state, item.date).some(candidate => candidate.id === habitId));
  const completed = planned.filter(item => habitGoalMet(habit, item.value));
  // 2026-10-20 重做：周目标习惯不该按天算分母。
  // 旧算法把「每周 3 次」当成 7 天里每天都要达标，导致用户做满 3 次仍显示 43% 未达标。
  // 现在：周目标习惯的「计划天数」= 有记录的自然周数，「完成」= 达标周数。
  // 日目标习惯维持原口径，但主动休息日不再计入分母。
  const isWeekly = habit.goalPeriod === 'weekly';
  const weekKeyOf = day => {
    const cursor = new Date(`${day}T12:00:00`);
    cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
    return dateKey(cursor);
  };
  const plannedForRate = isWeekly ? planned : planned.filter(item => !habitRestDay(state, habitId, item.date));
  const completedForRate = isWeekly ? completed : completed.filter(item => !habitRestDay(state, habitId, item.date));
  // 周目标：同一天可能多次达标，用 Set 折叠成「周数」
  const weeks = new Set(plannedForRate.map(item => weekKeyOf(item.date))).size;
  const metWeeks = new Set(completedForRate.map(item => weekKeyOf(item.date))).size;
  const rateDenominator = isWeekly ? weeks : plannedForRate.length;
  const rateNumerator = isWeekly ? metWeeks : completedForRate.length;
  const completionRate = rateDenominator ? Math.round(rateNumerator / rateDenominator * 100) : 0;
  const perHabitStreak = habitStreak(state, habitId, occurred.map(item => item.date));
  const levelCounts = { 0:0, 1:0, 2:0, 3:0, 4:0 };
  days.forEach(item => { levelCounts[item.level] = (levelCounts[item.level] || 0) + 1; });
  const todayItem = days.find(item => item.date === today);
  const todayPlanned = todayItem ? planned.some(item => item.date === today) : false;
  const todayStatus = !todayItem ? 'outside-year' : todayPlanned ? (habitGoalMet(habit, todayItem.value) ? 'completed' : todayItem.value > 0 ? 'in-progress' : 'planned') : 'rest';
  const currentStreak = Number(heatmap?.currentStreak) || 0;
  const longestStreak = Number(heatmap?.longestStreak) || 0;
  const totalActiveDays = Number(heatmap?.totalActiveDays) || 0;
  const restDays = planned.length - plannedForRate.length;
  const weekProgress = habitWeekProgress(state, habit.id, today);
  const definitions = [
    { id:'first', label:'初心萌芽', icon:'eco', target:1, value:completed.length, unit:'次达标' },
    { id:'streak-7', label:'7天连续', icon:'local_fire_department', target:7, value:perHabitStreak.longest, unit:'天连续' },
    { id:'streak-14', label:'14天连击', icon:'whatshot', target:14, value:perHabitStreak.longest, unit:'天连续' },
    { id:'streak-30', label:'30天参天', icon:'forest', target:30, value:perHabitStreak.longest, unit:'天连续' },
    { id:'active-100', label:'百次坚持', icon:'workspace_premium', target:100, value:totalActiveDays, unit:'次活跃' }
  ];
  return {
    habitId:habit.id,
    habitName:habit.name,
    year:Number(year),
    daysInYear:days.length,
    isWeekly,
    // 分母口径已按日/周目标分别处理，休息日不计入
    plannedDays:plannedForRate.length,
    restDays,
    completedDays:completedForRate.length,
    // UI 必须按 rateUnit 读取周期数，不能把累计天数误标成周数。
    completedPeriods:rateNumerator,
    plannedPeriods:rateDenominator,
    completionRate,
    rateUnit: isWeekly ? '周' : '天',
    currentStreak,
    longestStreak,
    // 达标连续天数与单纯有记录的热力图连续天数是不同口径。
    streak:perHabitStreak,
    totalActiveDays,
    weekProgress,
    levelCounts,
    today:{ date:today, status:todayStatus, value:Number(todayItem?.value) || 0, level:Number(todayItem?.level) || 0 },
    futureDays:days.filter(item => item.date > today).length,
    plannedDates:planned.map(item => item.date),
    achievements:definitions.map(item => ({ ...item, unlocked:item.value >= item.target, remaining:Math.max(0, item.target - item.value) }))
  };
}

// AI 周报的数据源：只做真实数据聚合，不写入状态也不生成文案。
export function warmWeeklyLifeMetrics(state, range) {
  const dateRange = range && range.start && range.end ? range : { start: '', end: '', weekNumber: 0 };
  const days = dateRange.start && dateRange.end ? rangeDays(dateRange.start, dateRange.end) : [];
  const inRange = item => days.includes(item?.date);
  const sessions = (state.sessions || []).filter(inRange);
  const dailyFocus = days.map(date => {
    const daySessions = sessions.filter(item => item.date === date);
    const minutes = sum(daySessions, minutesOf);
    return { date, minutes, hours: Number((minutes / 60).toFixed(2)), sessions: daySessions.length };
  });
  const totalMinutes = sum(dailyFocus, item => item.minutes);
  const previousStart = dateRange.start ? dateAtNoon(dateRange.start) : null;
  if (previousStart) previousStart.setDate(previousStart.getDate() - 7);
  const previousEnd = dateRange.end ? dateAtNoon(dateRange.end) : null;
  if (previousEnd) previousEnd.setDate(previousEnd.getDate() - 7);
  const previousDays = previousStart && previousEnd ? rangeDays(dateKey(previousStart), dateKey(previousEnd)) : [];
  const previousMinutes = sum((state.sessions || []).filter(item => previousDays.includes(item.date)), minutesOf);
  const peakFocusDay = dailyFocus.reduce((peak, item) => item.minutes > (peak?.minutes || 0) ? item : peak, null);

  const habitDays = days.map(date => {
    const habits = habitsForDate(state, date);
    const done = habits.filter(habit => habitGoalMet(habit, habitProgressForDate(state, habit, date)));
    return { date, total: habits.length, done: done.length, completedHabitIds: done.map(habit => habit.id) };
  });
  // 2026-10-20 重做：
  // 旧口径「habitTargets/habitDone」把每个日目标习惯每天都算一次分母，
  // 休息日也算「没做」→ 明明主动休息反而拉低分数。
  // 现在：休息日不进分母；周目标习惯按周折算，不再要求每天达标。
  const activeHabits = (state.habits || []).filter(habit => !habit.archived);
  const perHabit = activeHabits.map(habit => {
    const weekProgress = habitWeekProgress(state, habit.id, days[days.length - 1] || dateKey());
    if (habit.goalPeriod === 'weekly') {
      return {
        id: habit.id,
        name: habit.name,
        isWeekly: true,
        // 周目标：一周只要做够次数就算本周达成
        rate: weekProgress?.met ? 100 : 0,
        met: weekProgress?.met || false,
        done: weekProgress?.done || 0,
        target: weekProgress?.target || habit.target,
        streak: habitStreak(state, habit.id, days)
      };
    }
    const dailyRows = days.map(day => ({
      rest: habitRestDay(state, habit.id, day),
      met: habitGoalMet(habit, habitProgressForDate(state, habit, day))
    }));
    const planned = dailyRows.filter(row => !row.rest);
    const met = planned.filter(row => row.met);
    return {
      id: habit.id,
      name: habit.name,
      isWeekly: false,
      rate: planned.length ? Math.round(met.length / planned.length * 100) : 0,
      met: planned.length > 0 && met.length === planned.length,
      done: met.length,
      target: planned.length,
      restDays: dailyRows.length - planned.length,
      streak: habitStreak(state, habit.id, days)
    };
  });
  const habitTargets = sum(perHabit, item => item.target);
  const habitDone = sum(perHabit, item => item.done);
  // 连续天数：取各习惯里最好的那个（不再要求全部习惯同时达标）
  // 旧口径下只要有一天没做满全部习惯就归零，导致长期显示「当前连续 0 天」。
  const currentStreak = perHabit.reduce((best, item) => Math.max(best, item.streak.current), 0);
  const longestStreak = perHabit.reduce((best, item) => Math.max(best, item.streak.longest), 0);

  const transactions = (state.transactions || []).filter(inRange);
  const totalExpense = sum(transactions.filter(item => item.type === 'expense'), item => item.amount);
  const totalIncome = sum(transactions.filter(item => item.type === 'income'), item => item.amount);
  const budgetSnapshot = dateRange.end ? ledgerSummary(state, dateAtNoon(dateRange.end)) : { budgetProgress: { total: 0, spent: 0 } };
  const budgetTotal = Number(budgetSnapshot.budgetProgress?.total) || 0;
  const remainingBudget = Number((budgetTotal - (Number(budgetSnapshot.budgetProgress?.spent) || 0)).toFixed(2));
  const journals = Object.entries(state.journals || {}).filter(([date]) => days.includes(date));
  const journalWords = sum(journals, ([, entry]) => Array.from(String(entry?.content || '').replace(/\s/g, '')).length);
  const completedMedia = (state.media || []).filter(item => item.status === 'completed' && days.includes(item.completedDate || dateKey(new Date(item.updatedAt || 0))));
  const inProgressMedia = (state.media || []).filter(item => item.status !== 'completed' && Number(item.progress || 0) > 0);

  return {
    dateRange: { start: dateRange.start || '', end: dateRange.end || '' },
    weekNumber: Number(dateRange.weekNumber) || 0,
    dailyFocus,
    peakFocusDay: peakFocusDay?.minutes ? peakFocusDay : null,
    focus: { totalMinutes, totalHours: Number((totalMinutes / 60).toFixed(2)), previousMinutes, differenceMinutes: totalMinutes - previousMinutes, sessions: sessions.length },
    habits: { days: habitDays, perHabit, completed: habitDone, targets: habitTargets, completionRate: habitTargets ? Math.round(habitDone / habitTargets * 100) : 0, currentStreak, longestStreak },
    ledger: { totalExpense: Number(totalExpense.toFixed(2)), totalIncome: Number(totalIncome.toFixed(2)), transactionCount: transactions.filter(item => ['expense', 'income'].includes(item.type)).length, budgetTotal, budgetSpentToRangeEnd: Number(budgetSnapshot.budgetProgress?.spent) || 0, remainingBudget },
    journals: { count: journals.length, wordCount: journalWords, dates: journals.map(([date]) => date) },
    media: { completed: completedMedia.length, inProgress: inProgressMedia.length, completedItems: completedMedia.map(item => ({ id: item.id, title: item.title, type: item.type || '' })) },
    tracks: {
      focus: { daily: dailyFocus, totalMinutes, peakDay: peakFocusDay?.date || '' },
      habits: { completionRate: habitTargets ? Math.round(habitDone / habitTargets * 100) : 0, currentStreak, longestStreak },
      finance: { expense: Number(totalExpense.toFixed(2)), income: Number(totalIncome.toFixed(2)), remainingBudget },
      reflection: { journalCount: journals.length, journalWords, mediaCompleted: completedMedia.length }
    }
  };
}

export function focusInsights(state, sessions, now = new Date()) {
  const buckets = [
    { id:'morning', label:'上午', start:5, end:12, minutes:0 },
    { id:'afternoon', label:'下午', start:12, end:18, minutes:0 },
    { id:'evening', label:'晚上', start:18, end:24, minutes:0 },
    { id:'night', label:'深夜', start:0, end:5, minutes:0 }
  ];
  sessions.forEach(session => {
    const hour = new Date(session.startedAt || `${session.date}T12:00:00`).getHours();
    const bucket = buckets.find(item => hour >= item.start && hour < item.end);
    if (bucket) bucket.minutes += minutesOf(session);
  });
  const total = sessions.reduce((sum, item) => sum + minutesOf(item), 0);
  const heatmap = Array.from({ length:28 }, (_, offset) => {
    const date = new Date(now); date.setHours(12,0,0,0); date.setDate(date.getDate() - (27 - offset));
    const day = dateKey(date);
    return { day, minutes:(state.sessions || []).filter(item=>item.date===day).reduce((sum,item)=>sum+minutesOf(item),0) };
  });
  const peak = [...buckets].sort((a,b)=>b.minutes-a.minutes)[0];
  return {
    averageSessionMinutes: sessions.length ? Math.round(total / sessions.length) : 0,
    buckets,
    peakLabel: peak?.minutes ? peak.label : '暂无',
    heatmap,
    maxHeatMinutes: Math.max(1, ...heatmap.map(item=>item.minutes))
  };
}

export function mediaFocusSummary(state, mediaId) {
  const sessions = (state.sessions || []).filter(item => item.mediaId === mediaId).sort((a,b)=>b.startedAt-a.startedAt);
  return {
    sessions,
    minutes:sessions.reduce((sum,item)=>sum+Number(item.minutes||0),0),
    lastDate:sessions[0]?.date || ''
  };
}

export function projectGoalSummary(state, project, now = new Date()) {
  const monday = new Date(now); monday.setHours(12,0,0,0); monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
  const monthStart = new Date(now.getFullYear(),now.getMonth(),1,12);
  const sessions = (state.sessions || []).filter(item=>item.projectId===project.id);
  const weekly = sessions.filter(item=>new Date(`${item.date}T12:00:00`)>=monday).reduce((sum,item)=>sum+item.minutes,0);
  const monthly = sessions.filter(item=>new Date(`${item.date}T12:00:00`)>=monthStart).reduce((sum,item)=>sum+item.minutes,0);
  return {
    weekly, monthly,
    weeklyPercent:project.weeklyTargetMinutes ? Math.min(100,Math.round(weekly/project.weeklyTargetMinutes*100)) : 0,
    monthlyPercent:project.monthlyTargetMinutes ? Math.min(100,Math.round(monthly/project.monthlyTargetMinutes*100)) : 0
  };
}
