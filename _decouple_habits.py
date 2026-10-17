# -*- coding: utf-8 -*-
"""① 习惯与专注彻底切割（历史数据保留，不回溯扣减）② 打卡/撤销都一点就完，不弹确认"""
import io, os

CLONE = "C:/Users/cvb/Documents/ChatGPT/.mine-gh-publish"
rd = lambda p: io.open(os.path.join(CLONE, p), encoding="utf-8", newline="").read()
wr = lambda p, s: io.open(os.path.join(CLONE, p), "w", encoding="utf-8", newline="").write(s)
log, miss = [], []

def rep(path, old, new, tag):
    s = rd(path)
    if old not in s:
        miss.append(tag); return
    wr(path, s.replace(old, new, 1))
    log.append(tag)

# ── ① 切割 ───────────────────────────────────────────────────────────
rep("views/common.js",
"""export function linkedHabitMinutes(day, habitId) {
  return state.sessions
    .filter(session => session.date === day && session.habitId === habitId)
    .reduce((sum, session) => sum + Number(session.habitMinutes || 0), 0);
}""",
"""export function linkedHabitMinutes(day, habitId) {
  // 2026-10-17 用户要求：习惯与专注彻底切割 —— 专注不再往习惯自动累加分钟，
  // 习惯也不会因为「专注贡献了多少」被锁住数值。只关总闸、不动历史。
  return 0;
}""", "common.js 总闸 linkedHabitMinutes → 0")

rep("views/common.js",
"""export function replaceSessionHabitContribution(previous, next) {
  if (previous?.habitId && previous.habitMinutes) adjustHabitMinutes(previous.date, previous.habitId, -previous.habitMinutes);
  if (next?.habitId && next.habitMinutes) adjustHabitMinutes(next.date, next.habitId, next.habitMinutes, Number(next.startedAt) + Number(next.minutes) * 60000);
}""",
"""export function replaceSessionHabitContribution(previous, next) {
  // 2026-10-17 切割后：编辑/删除专注记录不再回退或重算习惯分钟数。保留导出，但为空操作。
  return;
}""", "common.js 编辑/删除专注不再回退习惯")

rep("views/common.js", "删除这条专注记录？关联习惯中的分钟数也会同步扣除。", "删除这条专注记录？",
    "common.js 删除提示去掉「关联习惯」")

rep("views/focus.js", "    const linkedHabitId = (() => {",
    "    const linkedHabitId = (() => {\n      // 2026-10-17 切割：专注不再挂到任何习惯上。\n      return '';",
    "focus.js linkedHabitId 恒空")
rep("views/focus.js", "    if (linkedHabitId && minutes > 0) {", "    if (false && linkedHabitId && minutes > 0) {",
    "focus.js 停掉自动累加")
rep("views/focus.js",
    "const linkableHabits = (state.habits || []).filter(habit => !habit.archived && habit.tracking === 'quantity' && /分钟/.test(habit.unit || ''));",
    "const linkableHabits = [];  // 2026-10-17 切割：不再提供专注自动记入习惯",
    "focus.js 去掉联动候选")
rep("views/focus.js",
    '<label>专注结束自动记入习惯</label><select name="focusLinkedHabit">${habitOptions}</select><small class="field-help">选择后，每次专注结束（倒计时 / 正向计时 / 番茄钟专注段）会把实际专注分钟数自动加到该习惯；不足 1 分钟的专注不计入。</small>',
    '', "focus.js 计时设置删掉「自动记入习惯」")

rep("views/habits.js",
    '    /分钟/.test(habit.unit) ? \'<button type="button" id="habit-focus-start">专注 10 分钟</button>\' : \'\',',
    '    \'\',  // 2026-10-17 切割：习惯页不再挂「专注 10 分钟」入口', "habits.js 去掉专注按钮")
rep("views/habits.js",
    "  $('#habit-focus-start')?.addEventListener('click', () => Promise.resolve(callHelper('startFocusForHabit', habit.id)).catch(error => show(error.message)));",
    "", "habits.js 去掉按钮 handler")
rep("views/habits.js",
    "`${esc(habit.name)}今天记下的 ${todayValue}${esc(habit.unit)} 会清零，专注同步的部分保留。`",
    "`${esc(habit.name)}今天记下的 ${todayValue}${esc(habit.unit)} 会清零。`", "habits.js 清空文案")
rep("views/habits.js",
    "直接填写今天实际完成的总量；专注计时同步的 ${linked}${esc(habit.unit)} 会保留。",
    "直接填写今天实际完成的总量。", "habits.js 修改累计文案")

# ── ② 打卡/撤销 一点就完 ─────────────────────────────────────────────
rep("views/habits.js",
"""  if (result.action === 'confirm') {
    confirmDelete(`${esc(habit.name)}今天记下的 ${todayValue}${esc(habit.unit)} 会清零。`, () => { habitOneTapPrior.delete(key); return commitHabitProgress(habit.id, 0, `已清空${habit.name}今天的记录`); }, { title: '清空今天的记录？', note: '', confirmText: '清空', cancelText: '取消', light: true });
    return Promise.resolve(false);
  }""",
"""  if (result.action === 'confirm') {
    // 2026-10-17 用户要求：撤销也点一下就好，不再弹「清空今天的记录？」确认框。
    // 误触代价很小（再点一下能补回来），弹框才是真正的麻烦。
    habitOneTapPrior.delete(key);
    return commitHabitProgress(habit.id, 0, `已撤销${habit.name}今天的打卡`);
  }""", "habits.js 撤销不再弹确认")

print("== 成功 %d 项 ==" % len(log))
for x in log: print("  OK", x)
if miss:
    print("== 未命中 %d 项 ==" % len(miss))
    for x in miss: print("  XX", x)
