import { $, $$, esc, uid, state, save, render, modal, closeModal, show, confirmDelete, emptyState, registerBinder, registerSubmitHandler, registerHelper, callHelper, HABIT_ICONS } from '../core.js';
import { makeHabit, makeTodo, habitProgressForDate, habitGoalMet, todosForDate, dateKey, WEEK_DAYS } from '../model.js';
import { repeatLabel, linkedHabitMinutes, updateHabitCompletion } from './common.js';
import { dailyTodoGroups, habitClickValue, habitOneTapValue } from '../daily-workflow.js';
import { celebrateHabitCheck, autoStagger } from '../motion.js';
import { habitDayStreak, refreshTodayHabitChrome } from './today.js';

// 打卡成功后的轻动效：render 会重建 DOM，先记下 id，绑定后再弹
let pendingHabitCelebrateId = null;
// 一键打卡前的今日值，只存在内存里，按「日期|习惯」记，用于撤销恢复；不写存储。
const habitOneTapPrior = new Map();

// ---- 习惯管理 ----
export function habitManager() {
  modal(`<div class="modal-head"><div><h2>习惯管理</h2><p>点击习惯可编辑目标和重复日期。</p></div><button id="new-habit" class="icon-button"><span class="material-symbols-outlined">add</span></button></div><div class="manage-list">${state.habits.filter(habit => !habit.archived).map(habit => `<button data-edit-habit="${habit.id}"><span class="round-icon material-symbols-outlined">${habit.icon}</span><span><strong>${esc(habit.name)}</strong><small>目标 ${habit.target}${esc(habit.unit)} · ${repeatLabel(habit.repeatDays)}</small></span><span class="material-symbols-outlined">edit</span></button>`).join('') || emptyState('还没有习惯', '点击右上角新建。')}</div><div class="modal-actions"><button type="button" data-close>完成</button></div>`, 'large-modal habit-manager-modal');
}

function habitQuickAmounts(habit) {
  const unit = habit.unit;
  const presets = /分钟/.test(unit) ? [5, 10, habit.target]
    : /小时/.test(unit) ? [1, 2, habit.target]
      : /页/.test(unit) ? [5, 10, habit.target]
        : /公里|千米/.test(unit) ? [1, 3, habit.target]
          : /米/.test(unit) ? [100, 500, habit.target]
            : /步/.test(unit) ? [1000, 3000, habit.target]
              : /字|词|题/.test(unit) ? [10, 50, habit.target]
                : [1, 5, habit.target];
  return [...new Set(presets.map(Number).filter(value => Number.isInteger(value) && value > 0))].slice(0, 3);
}

/** 今日习惯行就地刷新：只改这一行的完成态与文案，不整页 render。 */
function refreshHabitCardDom(habitId) {
  const habit = state.habits.find(item => item.id === habitId);
  const card = document.querySelector(`[data-habit-card="${habitId}"]`);
  if (!habit || !card) return null;
  const day = dateKey();
  const count = habitProgressForDate(state, habit, day);
  const done = habitGoalMet(habit, count);
  const streak = habitDayStreak(habit, day);
  const target = Number(habit.target) || 1;
  const unit = esc(habit.unit);
  const status = done
    ? (target > 1 ? `已打卡 ${count}/${target}${unit}` : '今日已打卡')
    : (count > 0 ? `${count}/${target}${unit} · 点勾补满` : '今日未打卡');
  const meta = streak > 0 ? `<span>${status}</span> · <span>已连续 ${streak} 天</span>` : `<span>${status}</span>`;
  card.classList.toggle('is-done', done);
  card.classList.toggle('is-progress', !done && count > 0);
  if (done || count > 0) { /* keep */ } else { card.classList.remove('is-done', 'is-progress'); }
  const metaEl = card.querySelector('.habit-card-meta');
  if (metaEl) metaEl.innerHTML = meta;
  const tick = card.querySelector(`.habit-check-btn[data-habit="${habitId}"]`);
  if (tick) {
    tick.classList.toggle('is-done', done);
    tick.setAttribute('aria-label', `${done ? '已完成' : '打卡'} ${habit.name}`);
  }
  return { tick, done, count };
}

export async function commitHabitProgress(habitId, nextValue, message = '') {
  const habit = state.habits.find(item => item.id === habitId);
  if (!habit) return;
  const day = dateKey();
  const previous = structuredClone(state.checks[day] || {});
  const previousCompletions = structuredClone(state.habitCompletions[day] || {});
  const previousSkips = [...(state.habitSkips[day] || [])];
  const progress = { ...previous };
  const linked = linkedHabitMinutes(day, habitId);
  const requested = Math.max(0, Math.min(999999, Math.round(Number(nextValue) || 0)));
  const next = Math.max(linked, requested);
  if (next) progress[habitId] = next;
  else delete progress[habitId];
  state.checks[day] = progress;
  state.habitSkips[day] = previousSkips.filter(id => id !== habitId);
  if (!state.habitSkips[day].length) delete state.habitSkips[day];
  updateHabitCompletion(day, habit, Number(previous[habitId] || 0), next);
  try {
    await save();
    if ($('#modal-layer').classList.contains('open')) closeModal();
    const increased = next > Number(previous[habitId] || 0);
    // 优先就地更新今日行 + 只在勾上 celebrate，避免整页 render/autoStagger 盖住轻反馈、画报闪纸色
    const updated = refreshHabitCardDom(habitId);
    if (updated) {
      refreshTodayHabitChrome();
      if (increased && updated.tick) celebrateHabitCheck(updated.tick);
      show(requested < linked ? `已保留专注自动同步的 ${linked}${habit.unit}` : message || `${habit.name}：今日 ${next}/${habit.target}${habit.unit}`);
      return true;
    }
    if (increased) pendingHabitCelebrateId = habitId;
    render(false, { skipStagger: true });
    show(requested < linked ? `已保留专注自动同步的 ${linked}${habit.unit}` : message || `${habit.name}：今日 ${next}/${habit.target}${habit.unit}`);
    return true;
  } catch (error) {
    state.checks[day] = previous;
    if (Object.keys(previousCompletions).length) state.habitCompletions[day] = previousCompletions;
    else delete state.habitCompletions[day];
    if (previousSkips.length) state.habitSkips[day] = previousSkips;
    else delete state.habitSkips[day];
    show(error.message);
    return false;
  }
}

// 一键打卡（今日行的小圆勾与详情页顶部的小圆勾共用）：未达标补满今日目标，已达标撤销回打卡前的值。
function oneTapHabit(habit) {
  const day = dateKey();
  const key = `${day}|${habit.id}`;
  const todayValue = Number(state.checks[day]?.[habit.id] || 0);
  const result = habitOneTapValue(habit, todayValue, habitProgressForDate(state, habit, day), habitOneTapPrior.has(key) ? habitOneTapPrior.get(key) : null);
  if (result.action === 'noop') { show(habit.goalPeriod === 'weekly' ? '本周已达标' : '本周期已达标'); return Promise.resolve(false); }
  if (result.action === 'confirm') {
    confirmDelete(`${esc(habit.name)}今天记下的 ${todayValue}${esc(habit.unit)} 会清零。`, () => { habitOneTapPrior.delete(key); return commitHabitProgress(habit.id, 0, `已清空${habit.name}今天的记录`); }, { title: '清空今天的记录？', note: '', confirmText: '清空', cancelText: '取消', light: true });
    return Promise.resolve(false);
  }
  if (result.action === 'fill') habitOneTapPrior.set(key, result.prior);
  else habitOneTapPrior.delete(key);
  return commitHabitProgress(habit.id, result.next, result.action === 'fill' ? `${habit.name} 今日已打卡` : `已撤销${habit.name}今天的打卡`);
}

// 最近五周的小热力格：只读 habitHeatmapData（跨年时把两年拼起来），不另算。
function habitRecentWeeks(habit, weeks = 5) {
  const today = dateKey();
  const end = new Date(`${today}T12:00:00`);
  const start = new Date(end);
  start.setDate(start.getDate() - ((end.getDay() + 6) % 7) - (weeks - 1) * 7);
  const years = [...new Set([start.getFullYear(), end.getFullYear()])];
  const byDate = new Map();
  years.forEach(year => (callHelper('habitHeatmapData', habit.id, year)?.days || []).forEach(day => byDate.set(day.date, day)));
  const rest = state.habitSkips || {};
  const cells = [];
  let active = 0;
  for (let cursor = new Date(start); cells.length < weeks * 7; cursor.setDate(cursor.getDate() + 1)) {
    const key = dateKey(cursor);
    const future = key > today;
    const resting = (rest[key] || []).includes(habit.id);
    const level = future || resting ? 0 : Number(byDate.get(key)?.level || 0);
    if (level > 0) active += 1;
    cells.push(`<i class="hs-heat-cell level-${level}${future ? ' is-future' : ''}${resting ? ' is-rest' : ''}${key === today ? ' is-today' : ''}" title="${key}${resting ? ' · 休息' : ''}"></i>`);
  }
  return { html: cells.join(''), active };
}

// 习惯详情（点习惯名进入）：纸面、细线、留白；状态与连续天数用灰字，不做大色块。
export function habitLogForm(habit) {
  const day = dateKey();
  const todayValue = Number(state.checks[day]?.[habit.id] || 0);
  const current = habitProgressForDate(state, habit, day);
  const linked = linkedHabitMinutes(day, habit.id);
  const met = habitGoalMet(habit, current);
  const resting = (state.habitSkips?.[day] || []).includes(habit.id);
  const streak = habitDayStreak(habit, day);
  const percent = Math.min(100, Math.round(current / Math.max(1, habit.target) * 100));
  const quickAmounts = habitQuickAmounts(habit);
  const step = quickAmounts[0] || 1;
  const unit = esc(habit.unit);
  const weekly = habit.goalPeriod === 'weekly';
  const goalText = habit.goalType === 'range' ? `${habit.target}–${habit.targetMax}${unit}` : `${habit.target}${unit}`;
  const periodWord = weekly ? '本周' : '今天';
  const status = resting ? '今天休息，不影响连续'
    : met ? `${periodWord}已完成 · ${current}/${goalText}`
      : current > 0 ? `${periodWord} ${current}/${goalText} · 还差 ${Math.max(0, habit.target - current)}${unit}`
        : `${periodWord}还没打卡 · 目标 ${goalText}`;
  const quiet = [streak > 0 ? `已连续 ${streak} 天` : '还没有连续记录', weekly ? `今天记了 ${todayValue}${unit}` : '', linked ? `${linked}${unit} 来自专注` : ''].filter(Boolean).join(' · ');
  const recent = habitRecentWeeks(habit);
  const secondary = [
    /分钟/.test(habit.unit) ? '<button type="button" id="habit-focus-start">专注 10 分钟</button>' : '',
    '<button type="button" id="adjust-habit-total">改今日累计</button>',
    resting ? '<button type="button" id="unskip-habit-today">恢复今天</button>' : '<button type="button" id="skip-habit-today">今天休息</button>',
    todayValue ? '<button type="button" id="reset-habit-total">清除今日记录</button>' : '',
    '<button type="button" id="habit-sheet-edit">编辑或删除</button>'
  ].filter(Boolean).join('');
  modal(`<header class="hs-head detail-sheet-row">
    <div class="hs-title"><span class="hs-eyebrow">${weekly ? '每周习惯' : '每日习惯'}</span><h2>${esc(habit.name)}</h2><p class="hs-status">${status}</p><p class="hs-quiet">${quiet}</p></div>
    <button type="button" class="hs-tick ${met ? 'is-done' : ''}" id="habit-sheet-tick" aria-pressed="${met}" aria-label="${met ? '撤销今天的打卡' : '一键打卡'}"><span class="hs-tick-dot" aria-hidden="true"><span class="material-symbols-outlined">check</span></span></button>
  </header>
  <div class="hs-progress detail-sheet-row" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="transform:scaleX(${percent / 100})"></i></div>
  <section class="hs-section detail-sheet-row" aria-label="记一笔">
    <div class="hs-label-row"><h3>记一笔</h3><small>记在今天</small></div>
    <div class="habit-quick-log hs-chips">${quickAmounts.map(amount => `<button type="button" data-habit-amount="${amount}">+${amount}<small>${unit}</small></button>`).join('')}</div>
    <form id="habit-amount-form" class="hs-stepper-form"><input type="hidden" name="id" value="${habit.id}">
      <div class="hs-stepper"><button type="button" data-hs-step="-${step}" aria-label="减少"><span class="material-symbols-outlined">remove</span></button><label class="hs-stepper-value"><input name="amount" type="number" inputmode="numeric" min="1" max="999999" required value="${step}" aria-label="本次完成量"><span>${unit}</span></label><button type="button" data-hs-step="${step}" aria-label="增加"><span class="material-symbols-outlined">add</span></button></div>
      <button class="save hs-commit">记上</button>
    </form>
  </section>
  <section class="hs-section detail-sheet-row" aria-label="最近五周">
    <div class="hs-label-row"><h3>最近五周</h3><small>${recent.active} 天有记录</small></div>
    <div class="hs-heat-week" aria-hidden="true">${WEEK_DAYS.slice(1).concat(WEEK_DAYS[0]).map(name => `<span>${name}</span>`).join('')}</div>
    <div class="hs-heat">${recent.html}</div>
  </section>
  <nav class="hs-secondary detail-sheet-row" aria-label="更多操作">${secondary}</nav>
  <div class="modal-actions hs-actions"><button type="button" data-close>关闭</button></div>`, 'habit-log-modal detail-sheet habit-sheet');
  const sheet = $('#modal-layer .habit-sheet');
  autoStagger(sheet);
  $('#habit-sheet-tick').onclick = () => oneTapHabit(habit);
  $$('[data-habit-amount]').forEach(button => button.onclick = () => commitHabitProgress(habit.id, todayValue + Number(button.dataset.habitAmount), `${habit.name} +${button.dataset.habitAmount}${habit.unit}`));
  const amountInput = $('#habit-amount-form [name="amount"]');
  $$('[data-hs-step]').forEach(button => button.onclick = () => {
    amountInput.value = String(Math.max(1, Math.min(999999, (Number(amountInput.value) || 0) + Number(button.dataset.hsStep))));
  });
  $('#adjust-habit-total').onclick = () => habitTotalForm(habit);
  $('#habit-focus-start')?.addEventListener('click', () => Promise.resolve(callHelper('startFocusForHabit', habit.id)).catch(error => show(error.message)));
  $('#reset-habit-total')?.addEventListener('click', () => confirmDelete(`${esc(habit.name)}今天记下的 ${todayValue}${esc(habit.unit)} 会清零，专注同步的部分保留。`, () => commitHabitProgress(habit.id, 0, `${habit.name}今日记录已清空`), { title: '清空今天的记录？', note: '', confirmText: '清空', cancelText: '取消', light: true }));
  $('#skip-habit-today')?.addEventListener('click', () => setHabitRestDay(habit.id, true));
  $('#unskip-habit-today')?.addEventListener('click', () => setHabitRestDay(habit.id, false));
  $('#habit-sheet-edit').onclick = () => habitForm(habit);
}

export async function setHabitRestDay(habitId, resting) {
  const day = dateKey();
  const skips = new Set(state.habitSkips[day] || []);
  resting ? skips.add(habitId) : skips.delete(habitId);
  if (skips.size) state.habitSkips[day] = [...skips]; else delete state.habitSkips[day];
  await save(); closeModal(); render(); show(resting ? '已标记为今天休息，不影响连续记录' : '已恢复今天的习惯');
}

function habitTotalForm(habit) {
  const current = Number(state.checks[dateKey()]?.[habit.id] || 0);
  const linked = linkedHabitMinutes(dateKey(), habit.id);
  modal(`<form id="habit-total-form"><input type="hidden" name="id" value="${habit.id}"><span class="eyebrow">CORRECT PROGRESS</span><h2>修改${esc(habit.name)}累计</h2><p class="subtle">直接填写今天实际完成的总量；专注计时同步的 ${linked}${esc(habit.unit)} 会保留。</p><label>今日累计</label><div class="habit-total-input"><input name="total" type="number" inputmode="numeric" min="${linked}" max="999999" required value="${current}"><span>${esc(habit.unit)}</span></div><div class="modal-actions"><button type="button" id="habit-log-back">返回</button><button class="save">保存修改</button></div></form>`, 'habit-log-modal');
  $('#habit-log-back').onclick = () => habitLogForm(habit);
}

export function habitForm(habit = null, preset = null) {
  const item = habit || makeHabit(preset || { name: '', target: 1, unit: '次', repeatDays: [0, 1, 2, 3, 4, 5, 6] });
  modal(`<form id="habit-form"><input type="hidden" name="id" value="${habit ? item.id : ''}"><h2>${habit ? '编辑' : '新建'}习惯</h2><p class="subtle">从容易做到的一小步开始，目标以后可以调整。</p>${!habit ? '<div class="habit-starter-choices"><button type="button" data-habit-preset="read">读书10分钟</button><button type="button" data-habit-preset="water">每天喝水</button><button type="button" data-habit-preset="move">散步20分钟</button></div>' : ''}<label>习惯名称</label><input name="name" required maxlength="20" value="${esc(item.name)}" placeholder="例如：阅读"><div class="form-grid"><div><label>最低目标</label><input name="target" type="number" min="1" max="999999" required value="${item.target}"></div><div><label>单位</label><input name="unit" maxlength="6" required value="${esc(item.unit)}"></div></div><details class="habit-advanced"><summary>重复日期、计数方式与更多设置</summary><fieldset><legend>目标周期</legend><div class="habit-tracking-picker"><label><input type="radio" name="goalPeriod" value="daily" ${item.goalPeriod === 'daily' ? 'checked' : ''}><span><strong>每日目标</strong><small>按天完成</small></span></label><label><input type="radio" name="goalPeriod" value="weekly" ${item.goalPeriod === 'weekly' ? 'checked' : ''}><span><strong>每周目标</strong><small>周一至周日累计</small></span></label></div></fieldset><fieldset><legend>目标类型</legend><div class="habit-goal-picker"><label><input type="radio" name="goalType" value="quantity" ${item.goalType !== 'range' ? 'checked' : ''}><span>达到最低值</span></label><label><input type="radio" name="goalType" value="range" ${item.goalType === 'range' ? 'checked' : ''}><span>保持在区间</span></label></div></fieldset><label>理想上限（仅区间目标）</label><input name="targetMax" type="number" min="1" max="999999" value="${item.targetMax}"><fieldset class="habit-tracking-field"><legend>记录方式</legend><div class="habit-tracking-picker"><label><input type="radio" name="tracking" value="tap" ${item.tracking === 'tap' ? 'checked' : ''}><span><i class="material-symbols-outlined">touch_app</i><strong>一键计数</strong><small>适合杯、次、组</small></span></label><label><input type="radio" name="tracking" value="quantity" ${item.tracking === 'quantity' ? 'checked' : ''}><span><i class="material-symbols-outlined">edit_note</i><strong>累计数值</strong><small>适合分钟、页数</small></span></label></div></fieldset><fieldset class="habit-icon-field"><legend>选择图标</legend><div class="habit-icon-picker">${HABIT_ICONS.map(([value, label]) => `<label title="${label}"><input type="radio" name="icon" value="${value}" ${item.icon === value ? 'checked' : ''}><span><i class="material-symbols-outlined" aria-hidden="true">${value}</i><small>${label}</small></span></label>`).join('')}</div></fieldset><label>重复日期</label><div class="weekday-picker">${WEEK_DAYS.map((day, index) => `<label><input type="checkbox" name="repeat" value="${index}" ${item.repeatDays.includes(index) ? 'checked' : ''}><span>${day}</span></label>`).join('')}</div></details><div class="modal-actions">${habit ? '<button type="button" class="danger" id="delete-habit">删除</button>' : ''}<button type="button" data-close>取消</button><button class="save">保存</button></div></form>`, 'large-modal habit-modal');
  const presets = { read: { name:'阅读', target:10, unit:'分钟', tracking:'quantity', icon:'menu_book' }, water: { name:'喝水', target:8, unit:'杯', tracking:'tap', icon:'water_drop' }, move: { name:'散步', target:20, unit:'分钟', tracking:'quantity', icon:'directions_walk' } };
  $$('[data-habit-preset]').forEach(button => button.onclick = () => habitForm(null, presets[button.dataset.habitPreset]));
  const unitInput = $('#habit-form [name="unit"]');
  unitInput.addEventListener('change', () => {
    if (/分钟|小时|页|公里|千米|米|步|字|词|题|毫升|升|元/.test(unitInput.value)) $('#habit-form [name="tracking"][value="quantity"]').checked = true;
  });
}

// ---- 待办 ----
export function todoManager() {
  const groups = dailyTodoGroups(state);
  const row = todo => `<article class="daily-task-row ${todo.completed ? 'done' : ''}"><button type="button" class="daily-task-check material-symbols-outlined" data-daily-todo-toggle="${esc(todo.id)}" aria-label="${todo.completed ? '恢复待办' : '完成待办'}">${todo.completed ? 'check_circle' : 'radio_button_unchecked'}</button><button type="button" class="daily-task-copy" data-edit-todo="${esc(todo.id)}"><strong>${esc(todo.title)}</strong><small>${todo.date}${todo.completed ? ' · 已完成' : ''}</small></button>${todo.completed ? '' : `<button type="button" class="daily-task-start" data-focus-todo="${esc(todo.id)}"><span class="material-symbols-outlined">play_arrow</span>先做</button>`}</article>`;
  const fold = (label, list) => `<details class="daily-task-fold"><summary>${label}<span>${list.length}</span></summary>${list.map(row).join('') || '<p class="subtle">这里暂时没有安排。</p>'}</details>`;
  modal(`<div class="modal-head"><div><span class="eyebrow">ONE THING AT A TIME</span><h2>今天，先做一件事</h2><p>写下具体的一小步，点“先做”开始专注；计时结束后再确认是否完成。</p></div><button id="new-todo-modal" class="icon-button" aria-label="新增待办"><span class="material-symbols-outlined">add</span></button></div><section class="todo-manage-day"><header><strong>今天要做</strong><small>${groups.today.length} 件</small></header>${groups.today.map(row).join('') || '<p class="subtle">今天还没安排。写下一件想完成的小事就够了。</p>'}</section>${fold('之前没做完，按自己的节奏处理', groups.earlier)}${fold('以后再做', groups.later)}${fold('已经完成', groups.completed)}<div class="modal-actions"><button type="button" data-close>完成</button></div>`, 'large-modal todo-manager-modal');
  $$('[data-daily-todo-toggle]').forEach(button => button.onclick = async () => {
    const todo = state.todos.find(item => item.id === button.dataset.dailyTodoToggle);
    try { await setTodoCompleted(todo.id, !todo.completed); todoManager(); render(); } catch (error) { show(error.message); }
  });
  $$('[data-focus-todo]').forEach(button => button.onclick = () => Promise.resolve(callHelper('startFocusForTodo', button.dataset.focusTodo)).catch(error => show(error.message)));
}

export async function setTodoCompleted(id, completed = true) {
  const todo = state.todos.find(item => item.id === id);
  if (!todo) throw new Error('待办不存在');
  const previous = { ...todo };
  todo.completed = completed;
  todo.updatedAt = Date.now();
  todo.completedAt = completed ? todo.updatedAt : 0;
  todo.completedDate = completed ? dateKey() : '';
  try { await save(); return true; }
  catch (error) { Object.assign(todo, previous); throw error; }
}

export function todoForm(todo = null) {
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const item = todo || makeTodo({ date: dateKey(), title: '' });
  const today = dateKey();
  const tomorrowKey = dateKey(tomorrow);
  const custom = item.date !== today && item.date !== tomorrowKey;
  const options = [[today, '今天', today.slice(5).replace('-', '月') + '日'], [tomorrowKey, '明天', tomorrowKey.slice(5).replace('-', '月') + '日'], ['custom', '指定日期', custom ? item.date.slice(5).replace('-', '月') + '日' : '自由选择']];
  const dateLabel = key => key === today ? '今天' : key === tomorrowKey ? '明天' : `${Number(key.slice(5, 7))}月${Number(key.slice(8, 10))}日`;
  const quietMeta = todo ? [item.completed ? `${item.completedDate ? dateLabel(item.completedDate) : ''}已完成` : (item.date < today ? `原定${dateLabel(item.date)}，还没做完` : `安排在${dateLabel(item.date)}`), item.createdAt ? `写于${dateLabel(dateKey(new Date(item.createdAt)))}` : ''].filter(Boolean).join(' · ') : '写下具体的一小步就够了';
  // 待办详情：标题行带小圆勾（只在编辑已有待办时出现），日期是三枚细线选项，删除收在左下角灰字。
  modal(`<form id="todo-form" class="todo-sheet-form"><input type="hidden" name="id" value="${todo ? item.id : ''}">
    <span class="hs-eyebrow detail-sheet-row">${todo ? '待办' : '新增待办'}</span>
    <div class="ts-title-row detail-sheet-row">${todo ? `<button type="button" class="hs-tick ${item.completed ? 'is-done' : ''}" id="todo-sheet-tick" aria-pressed="${item.completed}" aria-label="${item.completed ? '恢复为未完成' : '标记完成'}"><span class="hs-tick-dot" aria-hidden="true"><span class="material-symbols-outlined">check</span></span></button>` : ''}<h2 class="ts-visually-hidden">${todo ? '编辑' : '新增'}待办</h2><label class="ts-title"><span class="ts-visually-hidden">要做什么</span><textarea name="title" maxlength="80" required rows="1" placeholder="例如：整理本周读书笔记" autofocus>${esc(item.title)}</textarea></label></div>
    <p class="hs-quiet ts-meta detail-sheet-row" id="todo-sheet-meta">${quietMeta}</p>
    <fieldset class="todo-date-field hs-section detail-sheet-row"><legend>安排日期</legend><div>${options.map(([value, label, detail]) => `<label><input type="radio" name="date" value="${value}" ${(custom ? value === 'custom' : item.date === value) ? 'checked' : ''}><span><strong>${label}</strong><small>${detail}</small></span></label>`).join('')}</div><label class="todo-custom-date" id="todo-custom-date-wrap" ${custom ? '' : 'hidden'}><span>选择具体日期</span><input name="customDate" id="todo-custom-date" type="date" value="${custom ? item.date : today}" ${custom ? 'required' : 'disabled'}></label></fieldset>
    <div class="modal-actions ts-actions">${todo ? '<button type="button" class="danger" id="delete-todo">删除</button>' : ''}<span class="ts-spacer"></span><button type="button" data-close>取消</button><button class="save">保存</button></div></form>`, 'todo-form-modal detail-sheet todo-sheet');
  autoStagger($('#modal-layer .todo-sheet'));
  const titleInput = $('#todo-form [name="title"]');
  const fitTitle = () => { titleInput.style.height = 'auto'; titleInput.style.height = `${titleInput.scrollHeight}px`; };
  titleInput.addEventListener('input', fitTitle);
  titleInput.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); $('#todo-form').requestSubmit(); } });
  requestAnimationFrame(fitTitle);
  $('#todo-sheet-tick')?.addEventListener('click', async event => {
    const tick = event.currentTarget;
    const current = state.todos.find(entry => entry.id === item.id);
    if (!current) return;
    try {
      await setTodoCompleted(current.id, !current.completed);
      tick.classList.toggle('is-done', current.completed);
      tick.setAttribute('aria-pressed', String(current.completed));
      tick.setAttribute('aria-label', current.completed ? '恢复为未完成' : '标记完成');
      if (current.completed) celebrateHabitCheck(tick);
      $('#todo-sheet-meta').textContent = current.completed ? '今天已完成' : `安排在${dateLabel(current.date)}`;
      render();
    } catch (error) { show(error.message); }
  });
  const syncCustomDate = () => {
    const enabled = $('#todo-form [name="date"]:checked')?.value === 'custom';
    const wrap = $('#todo-custom-date-wrap');
    const input = $('#todo-custom-date');
    if (wrap) wrap.hidden = !enabled;
    if (input) { input.disabled = !enabled; input.required = enabled; }
    if (input) { input.disabled = !enabled; input.required = enabled; }
  };
  $$('[name="date"]', $('#todo-form')).forEach(radio => radio.addEventListener('change', syncCustomDate));
  syncCustomDate();
}

// ---- 习惯行侧滑手势：左滑一键打卡（补满今日目标）/ 右滑或点击进详情 ----
const HABIT_SWIPE_THRESHOLD = 64;
let habitSwipeButton = null;
let habitSwipeStartX = 0, habitSwipeStartY = 0;
let habitSwipeAxis = '';
let habitSwipeSuppressedClick = null;

function bindHabitSwipe(button) {
  // 位移只写在卡面 button（[data-habit-open]）上，打卡钮是兄弟节点，不跟着 translate
  const wrap = button.closest('.habit-swipe-wrap');
  const resetSwipe = () => {
    if (habitSwipeButton === button) habitSwipeButton = null;
    button.classList.remove('dragging');
    button.style.transform = '';
    wrap?.classList.remove('swiping-left', 'swiping-right');
  };
  button.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    habitSwipeSuppressedClick = null;
    habitSwipeButton = button;
    habitSwipeStartX = event.clientX;
    habitSwipeStartY = event.clientY;
    habitSwipeAxis = '';
    button.classList.add('dragging');
    button.setPointerCapture?.(event.pointerId);
  });
  button.addEventListener('pointermove', event => {
    if (habitSwipeButton !== button) return;
    const dx = event.clientX - habitSwipeStartX;
    const dy = event.clientY - habitSwipeStartY;
    if (!habitSwipeAxis) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      habitSwipeAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (habitSwipeAxis !== 'x') return;
    button.style.transform = `translateX(${Math.max(-84, Math.min(84, dx))}px)`;
    wrap?.classList.toggle('swiping-left', dx < -8);
    wrap?.classList.toggle('swiping-right', dx > 8);
  });
  button.addEventListener('pointerup', event => {
    if (habitSwipeButton !== button) return;
    const dx = event.clientX - habitSwipeStartX;
    resetSwipe();
    if (habitSwipeAxis !== 'x' || Math.abs(dx) < HABIT_SWIPE_THRESHOLD) return;
    habitSwipeSuppressedClick = button;
    const habitId = button.dataset.habit || button.dataset.habitOpen;
    const habit = state.habits.find(item => item.id === habitId);
    if (!habit) return;
    if (dx < 0) {
      const current = habitProgressForDate(state, habit, dateKey());
      const target = Number(habit.target) || 1;
      if (current >= target) {
        show('今日已完成');
      } else {
        habit.tracking === 'tap' ? commitHabitProgress(habit.id, current + 1, `${habit.name} +1${habit.unit}`) : habitLogForm(habit);
      }
    } else {
      habitLogForm(habit);
    }
  });
  button.addEventListener('pointercancel', resetSwipe);
}

// ---- 绑定（今日页的习惯/待办交互）----
function bindHabits() {
  // 大号打卡钮：一键计数走 habitClickValue；累计型打开记录表
  // stopPropagation：避免与卡面侧滑抢 pointer/click；侧滑只绑在 [data-habit-open] 上
  $$('.habit-check-btn[data-habit]').forEach(button => {
    const stopSwipeConflict = event => { event.stopPropagation(); };
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click']) {
      button.addEventListener(type, stopSwipeConflict);
    }
    button.onclick = event => {
      event.stopPropagation();
      if (habitSwipeSuppressedClick === button) { habitSwipeSuppressedClick = null; return; }
      const habit = state.habits.find(item => item.id === button.dataset.habit);
      if (!habit) return;
      oneTapHabit(habit);
    };
  });
  // 卡面点进去看详情 / 记量；侧滑仍可用
  $$('[data-habit-open]').forEach(button => {
    button.onclick = () => {
      if (habitSwipeSuppressedClick === button) { habitSwipeSuppressedClick = null; return; }
      const habit = state.habits.find(item => item.id === button.dataset.habitOpen);
      if (!habit) return;
      habitLogForm(habit);
    };
    bindHabitSwipe(button);
  });
  // 兼容旧版迷你行（若别处仍渲染）
  $$('button.bento-item-mini[data-habit]').forEach(button => {
    if (button.classList.contains('habit-check-btn')) return;
    button.onclick = () => {
      if (habitSwipeSuppressedClick === button) { habitSwipeSuppressedClick = null; return; }
      const habit = state.habits.find(item => item.id === button.dataset.habit);
      if (!habit) return;
      const todayValue = Number(state.checks[dateKey()]?.[habit.id] || 0);
      const next = habitClickValue(habit, todayValue, linkedHabitMinutes(dateKey(), habit.id));
      if (next !== null) { commitHabitProgress(habit.id, next, next > todayValue ? `${habit.name} +1${habit.unit}` : '已撤销今天的手动记录'); return; }
      habitLogForm(habit);
    };
    bindHabitSwipe(button);
  });
  if (pendingHabitCelebrateId) {
    const celebrateId = pendingHabitCelebrateId;
    pendingHabitCelebrateId = null;
    const checkBtn = [...document.querySelectorAll('.habit-check-btn[data-habit]')].find(el => el.dataset.habit === celebrateId);
    if (checkBtn) requestAnimationFrame(() => celebrateHabitCheck(checkBtn));
  }
  $('#new-todo')?.addEventListener('click', () => todoForm());
  $$('[data-toggle-todo]').forEach(button => button.onclick = async () => {
    const todo = state.todos.find(item => item.id === button.dataset.toggleTodo);
    if (!todo) return;
    const previous = structuredClone(todo);
    todo.completed = !todo.completed;
    todo.updatedAt = Date.now();
    todo.completedAt = todo.completed ? todo.updatedAt : 0;
    todo.completedDate = todo.completed ? dateKey(new Date(todo.completedAt)) : '';
    try { await save(); render(); } catch (error) { Object.assign(todo, previous); show(error.message); }
  });
  // 旧版「我的」页里的 #manage-habits-mine / #new-todo-empty / #open-todos-mine 三个入口
  // 在当前 UI 里已不存在，绑定全是空转（?. 不会报错，只是永远不触发），已移除。
  // 习惯管理请走统计页或今日页习惯卡的入口。
}

// ---- 表单提交 ----
registerSubmitHandler('habit-form', async data => {
  const repeatDays = data.getAll('repeat').map(Number);
  if (!repeatDays.length) throw new Error('至少选择一个重复日期');
  const existing = state.habits.find(habit => habit.id === data.get('id'));
  const next = makeHabit({ ...existing, id: existing?.id || uid(), name: data.get('name'), target: data.get('target'), targetMax: data.get('targetMax'), unit: data.get('unit'), tracking: data.get('tracking'), goalType: data.get('goalType'), goalPeriod: data.get('goalPeriod'), icon: data.get('icon'), repeatDays, createdAt: existing?.createdAt });
  existing ? Object.assign(existing, next) : state.habits.push(next);
});

registerSubmitHandler('habit-amount-form', async data => {
  const habit = state.habits.find(item => item.id === data.get('id'));
  if (!habit) throw new Error('没有找到这个习惯');
  const amount = Number(data.get('amount'));
  if (!Number.isInteger(amount) || amount < 1) throw new Error('请输入有效的本次完成量');
  await commitHabitProgress(habit.id, Number(state.checks[dateKey()]?.[habit.id] || 0) + amount, `${habit.name} +${amount}${habit.unit}`);
  return false;
});

registerSubmitHandler('habit-total-form', async data => {
  const habit = state.habits.find(item => item.id === data.get('id'));
  if (!habit) throw new Error('没有找到这个习惯');
  const total = Number(data.get('total'));
  if (!Number.isInteger(total) || total < 0) throw new Error('请输入有效的今日累计');
  await commitHabitProgress(habit.id, total);
  return false;
});

registerSubmitHandler('todo-form', async data => {
  const existing = state.todos.find(todo => todo.id === data.get('id'));
  const previous = existing ? structuredClone(existing) : null;
  const dateChoice = data.get('date');
  const todoDate = dateChoice === 'custom' ? data.get('customDate') : dateChoice;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(todoDate || ''))) throw new Error('请选择有效的待办日期');
  const next = makeTodo({ ...existing, id: existing?.id || uid(), title: data.get('title'), date: todoDate, createdAt: existing?.createdAt, updatedAt: Date.now() });
  const rollbackTodo = () => previous ? Object.assign(existing, previous) : state.todos = state.todos.filter(todo => todo.id !== next.id);
  try {
    existing ? Object.assign(existing, next) : state.todos.push(next);
    await save(); closeModal(); render(); show('待办已保存');
  } catch (error) {
    rollbackTodo();
    throw error;
  }
  return false;
});

registerBinder(bindHabits);
registerHelper('openHabitManager', habitManager);
// 待办清单（按日期看全部，不只今天/明天）。原「我的」页入口已下线，
// 改由今日页待办卡片的「查看全部」按钮进入，避免这段能力变成死代码。
registerHelper('openTodoManager', todoManager);
registerHelper('openTodoForm', () => todoForm());

registerHelper('setTodoCompleted', setTodoCompleted);

registerHelper('commitHabitProgress', commitHabitProgress);
