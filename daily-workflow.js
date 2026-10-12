import { dateKey } from './model.js';

// 只派生分组与本次目标，不建立第二份待办或习惯记录。
export function dailyTodoGroups(state, today = dateKey()) {
  const list = [...(state.todos || [])];
  const byDate = (a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.createdAt) - Number(b.createdAt);
  return {
    today: list.filter(item => !item.completed && item.date === today).sort(byDate),
    earlier: list.filter(item => !item.completed && item.date < today).sort(byDate),
    later: list.filter(item => !item.completed && item.date > today).sort(byDate),
    completed: list.filter(item => item.completed).sort((a, b) => Number(b.completedAt || b.updatedAt) - Number(a.completedAt || a.updatedAt))
  };
}

export function focusHasProgress(state) {
  const timer = state.timer || {};
  return Boolean(timer.running || Number(timer.elapsed) > 0 || (Number(timer.left) >= 0 && Number(timer.left) < Number(timer.duration)));
}

export function prepareDailyFocus(state, { todoId = '', habitId = '', minutes = 25 } = {}) {
  if (focusHasProgress(state)) throw new Error('本次专注还未结束，请先继续、结束或放弃后再换一件事。');
  const todo = todoId ? (state.todos || []).find(item => item.id === todoId && !item.completed) : null;
  const habit = habitId ? (state.habits || []).find(item => item.id === habitId && !item.archived) : null;
  if (todoId && !todo) throw new Error('这件待办已完成或不存在');
  if (habitId && !habit) throw new Error('这个习惯已归档或不存在');
  const duration = Math.max(1, Math.min(180, Math.round(Number(minutes) || 25))) * 60;
  return {
    timer: { ...state.timer, mode: 'free', phase: 'focus', round: 1, duration, left: duration, elapsed: 0, startedAt: null, endAt: null, running: false, task: todo?.title || habit?.name || state.timer.task || '' },
    intent: { todoId: todo?.id || '', habitId: habit?.id || '' }
  };
}

export function habitOneTapValue(habit, todayValue, periodValue = todayValue, remembered = null) {
  // 一键打卡：未完成 → 只把「今天」这一格补到刚好达标。
  // 已完成：只有本次打开期间用圆勾补满的（remembered 有效）才撤销回原值；
  // 没有记忆（详情里手动记满 / 重启后）→ 'confirm'，由调用方弹窗确认后才清零，绝不静默清空；
  // 今天是 0、靠本周期其他天已达标 → 'noop'（不是撤销）。
  const today = Math.max(0, Number(todayValue) || 0);
  const period = Math.max(today, Number(periodValue) || 0);
  const target = Math.max(1, Number(habit.target) || 1);
  const met = habit.goalType === 'range'
    ? period >= target && period <= Number(habit.targetMax ?? Infinity)
    : period >= target;
  if (met) {
    if (today === 0) return { action: 'noop', next: 0, prior: null };
    const prior = Number(remembered);
    if (remembered !== null && Number.isFinite(prior) && prior >= 0 && prior < today) return { action: 'undo', next: prior, prior: null };
    return { action: 'confirm', next: 0, prior: null };
  }
  const otherDays = period - today;
  return { action: 'fill', next: Math.max(today, target - otherDays), prior: today };
}

export function habitClickValue(habit, todayValue, linked = 0) {
  // 多次目标点击只加一次；只有每日单次习惯才支持再次点击撤销。
  const value = Number(todayValue) || 0;
  if (habit.tracking !== 'tap' || habit.goalType === 'range') return null;
  if (habit.goalPeriod !== 'weekly' && Number(habit.target) === 1 && value > linked) return linked;
  return value + 1;
}
