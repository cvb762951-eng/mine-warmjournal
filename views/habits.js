import { $, $$, esc, uid, state, save, render, modal, closeModal, show, confirmDelete, emptyState, registerBinder, registerSubmitHandler, registerHelper, callHelper, HABIT_ICONS } from '../core.js';
import { makeHabit, makeTodo, habitProgressForDate, habitGoalMet, todosForDate, dateKey, WEEK_DAYS } from '../model.js';
import { repeatLabel, linkedHabitMinutes, updateHabitCompletion } from './common.js';
import { dailyTodoGroups, habitClickValue, habitOneTapValue } from '../daily-workflow.js';
import { celebrateHabitCheck } from '../motion.js';

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
    if (next > Number(previous[habitId] || 0)) pendingHabitCelebrateId = habitId;
    render();
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

export function habitLogForm(habit) {
  const todayValue = Number(state.checks[dateKey()]?.[habit.id] || 0);
  const current = habitProgressForDate(state, habit, dateKey());
  const linked = linkedHabitMinutes(dateKey(), habit.id);
  const percent = Math.min(100, Math.round(current / habit.target * 100));
  const quickAmounts = habitQuickAmounts(habit);
  const goalText = habit.goalType === 'range' ? `${habit.target}–${habit.targetMax}${esc(habit.unit)}` : `${habit.target}${esc(habit.unit)}`;
  const remaining = habitGoalMet(habit, current) ? (habit.goalType === 'range' ? '当前处于理想区间' : '已达到目标，可以继续累计') : `还差 ${Math.max(0, habit.target - current)}${esc(habit.unit)}`;
  modal(`<div class="habit-log-head"><span class="round-icon material-symbols-outlined">${habit.icon}</span><div><span class="eyebrow">${habit.goalPeriod === 'weekly' ? "THIS WEEK'S PROGRESS" : "TODAY'S PROGRESS"}</span><h2>记录${esc(habit.name)}</h2></div></div><div class="habit-log-progress"><div class="habit-log-numbers"><strong>${current}</strong><span>/ ${goalText}</span></div><small>${remaining}</small>${habit.goalPeriod === 'weekly' ? `<em>今天已记录 ${todayValue}${esc(habit.unit)}</em>` : ''}${linked ? `<em>其中 ${linked}${esc(habit.unit)} 来自专注计时</em>` : ''}<i><i style="width:${percent}%"></i></i></div><div class="habit-quick-log">${quickAmounts.map(amount => `<button type="button" data-habit-amount="${amount}"><strong>+${amount}</strong><small>${esc(habit.unit)}</small></button>`).join('')}</div><form id="habit-amount-form"><input type="hidden" name="id" value="${habit.id}"><label>本次完成量</label><div class="habit-amount-input"><input name="amount" type="number" inputmode="numeric" min="1" max="999999" required value="${quickAmounts[0] || 1}"><span>${esc(habit.unit)}</span></div>${/分钟/.test(habit.unit) ? '<button type="button" class="habit-focus-entry" id="habit-focus-start"><span class="material-symbols-outlined">timer</span>为这个习惯先专注 10 分钟</button>' : ''}<div class="habit-log-actions"><button type="button" id="adjust-habit-total">修改今日累计</button>${todayValue ? '<button type="button" class="danger-text" id="reset-habit-total">清除手动记录</button>' : ''}<button type="button" id="skip-habit-today">今天休息</button></div><div class="modal-actions"><button type="button" data-close>取消</button><button class="save">保存</button></div>`, 'habit-log-modal');
  $$('[data-habit-amount]').forEach(button => button.onclick = () => commitHabitProgress(habit.id, todayValue + Number(button.dataset.habitAmount), `${habit.name} +${button.dataset.habitAmount}${habit.unit}`));
  $('#adjust-habit-total').onclick = () => habitTotalForm(habit);
  $('#habit-focus-start')?.addEventListener('click', () => Promise.resolve(callHelper('startFocusForHabit', habit.id)).catch(error => show(error.message)));
  $('#reset-habit-total')?.addEventListener('click', () => commitHabitProgress(habit.id, 0, `${habit.name}今日记录已归零`));
  $('#skip-habit-today').onclick = () => setHabitRestDay(habit.id, true);
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
  modal(`<form id="todo-form"><input type="hidden" name="id" value="${todo ? item.id : ''}"><span class="eyebrow">DAILY LIST</span><h2>${todo ? '编辑' : '新增'}待办</h2><label>要做什么</label><input name="title" maxlength="80" required value="${esc(item.title)}" placeholder="例如：整理本周读书笔记" autofocus><fieldset class="todo-date-field"><legend>安排日期</legend><div>${options.map(([value, label, detail]) => `<label><input type="radio" name="date" value="${value}" ${(custom ? value === 'custom' : item.date === value) ? 'checked' : ''}><span><strong>${label}</strong><small>${detail}</small></span></label>`).join('')}</div><label class="todo-custom-date" id="todo-custom-date-wrap" ${custom ? '' : 'hidden'}><span>选择具体日期</span><input name="customDate" id="todo-custom-date" type="date" value="${custom ? item.date : today}" ${custom ? 'required' : 'disabled'}></label></fieldset><div class="modal-actions">${todo ? '<button type="button" class="danger" id="delete-todo">删除</button>' : ''}<button type="button" data-close>取消</button><button class="save">保存待办</button></div></form>`, 'todo-form-modal');
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
      const day = dateKey();
      const key = `${day}|${habit.id}`;
      const todayValue = Number(state.checks[day]?.[habit.id] || 0);
      const result = habitOneTapValue(habit, todayValue, habitProgressForDate(state, habit, day), habitOneTapPrior.has(key) ? habitOneTapPrior.get(key) : null);
      if (result.action === 'noop') { show(habit.goalPeriod === 'weekly' ? '本周已达标' : '本周期已达标'); return; }
      if (result.action === 'confirm') {
        confirmDelete('清空今天的记录？', () => { habitOneTapPrior.delete(key); commitHabitProgress(habit.id, 0, `已清空${habit.name}今天的记录`); });
        return;
      }
      if (result.action === 'fill') habitOneTapPrior.set(key, result.prior);
      else habitOneTapPrior.delete(key);
      commitHabitProgress(habit.id, result.next, result.action === 'fill' ? `${habit.name} 今日已打卡` : `已撤销${habit.name}今天的打卡`);
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
