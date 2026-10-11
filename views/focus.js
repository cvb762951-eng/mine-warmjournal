import { Capacitor } from '@capacitor/core';
import { $, $$, esc, uid, state, save, render, modal, closeModal, show, confirmDelete, emptyState, go, formatMinutes, clock, durationText, setTick, registerView, registerBinder, registerOnRender, registerSubmitHandler, registerHelper, callHelper, subpageHeader, PROJECT_ICONS, PROJECT_COLORS } from '../core.js';
import { dateKey, nextPomodoroStage, pomodoroPhaseSeconds, makeFocusCategory } from '../model.js';
import { dailyTodoGroups, prepareDailyFocus, focusHasProgress } from '../daily-workflow.js';
import { sessionCard, bindRecordActions, replaceSessionHabitContribution, adjustHabitMinutes } from './common.js';
import { setKeepAwake, startFocusNotification, stopFocusNotification, scheduleTimerNotification, cancelTimerNotification, isTimerAlarmRinging } from '../notifications.js';
import { AMBIENT_SOUNDS, currentAmbient, currentAmbientMix, pauseAmbientMix, resumeAmbientMix, setAmbient, setAmbientMixTrack, setAmbientMixVolume, setAmbientVolume, stopAmbient } from '../ambient.js';

// ---- 本地状态 ----
let completionToneInterval = null;
let completionAudioContext = null;
let floatingTick = null;
let immersiveDismissed = false;
let idleTimer = null;
let pureCountdownActive = false;
const PURE_COUNTDOWN_IDLE_MS = 10000;
const prefersReducedMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
const TOKEN_EASE = (getComputedStyle(document.documentElement).getPropertyValue('--ease-ios-out') || '').trim() || 'cubic-bezier(.22,.61,.36,1)';
const TOKEN_DUR = (() => { const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-slow').trim(); const value = parseFloat(raw); if (!value) return 420; return /s$/.test(raw) ? value * 1000 : value; })();
// 白噪音混音台三轨：forest 复用 leaves.mp3，fire 为程序化壁炉底噪。
const SOUND_TRACKS = [
  { id: 'rain', label: '窗外细雨', icon: 'rainy', defaultVolume: 0.65 },
  { id: 'fire', label: '壁炉柴火', icon: 'local_fire_department', defaultVolume: 0.40, procedural: true },
  { id: 'forest', label: '森林微风', icon: 'forest', defaultVolume: 0 }
];

function mixSoundLabel(soundId) {
  return SOUND_TRACKS.find(track => track.id === soundId)?.label
    || AMBIENT_SOUNDS[soundId]?.label
    || soundId;
}

const expandedCategories = new Set();
const focusCoachCache = new Map();
let sessionInterruptions = 0;
let sessionStartedAt = 0;
let hiddenStateRecorded = false;
let visibilityChangeRegistered = false;
let focusReportReturnObserver = null;

function resetSessionTracking() {
  sessionInterruptions = 0;
  sessionStartedAt = 0;
  hiddenStateRecorded = false;
}

function registerVisibilityChangeTracking() {
  if (visibilityChangeRegistered) return;
  visibilityChangeRegistered = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      hiddenStateRecorded = false;
      return;
    }
    if (document.visibilityState === 'hidden' && state.timer.running && !hiddenStateRecorded) {
      sessionInterruptions += 1;
      hiddenStateRecorded = true;
    }
  });
}

function primeCompletionTone() {
  if (Capacitor.isNativePlatform()) return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    completionAudioContext ||= new AudioContextClass();
    if (completionAudioContext.state === 'suspended') completionAudioContext.resume().catch(() => {});
    return completionAudioContext;
  } catch (error) {
    console.warn('提示音初始化失败', error);
    return null;
  }
}

function playCompletionChime() {
  const context = primeCompletionTone();
  if (!context) return;
  const play = () => {
    const startAt = context.currentTime + 0.02;
    [[659.25, 0, 0.19], [783.99, 0.21, 0.3]].forEach(([frequency, offset, duration]) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const toneStart = startAt + offset;
      const toneEnd = toneStart + duration;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, toneStart);
      gain.gain.setValueAtTime(0.0001, toneStart);
      gain.gain.exponentialRampToValueAtTime(0.16, toneStart + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, toneEnd);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(toneStart);
      oscillator.stop(toneEnd + 0.03);
    });
  };
  if (context.state === 'suspended') context.resume().then(play).catch(error => console.warn('提示音播放失败', error));
  else play();
}

function startBrowserCompletionAlarm() {
  if (Capacitor.isNativePlatform() || completionToneInterval) return;
  playCompletionChime();
  completionToneInterval = setInterval(playCompletionChime, 1800);
}

async function stopCompletionAlarm() {
  clearInterval(completionToneInterval);
  completionToneInterval = null;
  await cancelTimerNotification().catch(console.warn);
}

function completionAlarmModal(label = '计时') {
  if ($('.alarm-modal')) return;
  modal(`<div class="alarm-visual"><span class="material-symbols-outlined" aria-hidden="true">notifications_active</span></div><span class="eyebrow">TIMER COMPLETE</span><h2>${esc(label)}结束</h2><p>提示音会持续播放，直到你手动停止。</p><button class="stop-alarm" id="stop-completion-alarm"><span class="material-symbols-outlined" aria-hidden="true">notifications_off</span>停止提示音</button>`, 'alarm-modal');
  $('#stop-completion-alarm').onclick = async () => { await stopCompletionAlarm(); closeModal(); show('提示音已停止'); };
}
export { completionAlarmModal };

function currentElapsed() {
  if (state.timer.mode !== 'stopwatch') return 0;
  return state.timer.running && state.timer.startedAt
    ? Math.max(0, Math.floor((Date.now() - state.timer.startedAt) / 1000))
    : Math.max(0, Number(state.timer.elapsed || 0));
}

function currentLeft() {
  return state.timer.running ? Math.max(0, Math.ceil((state.timer.endAt - Date.now()) / 1000)) : state.timer.left;
}

// ---- 分类树工具 ----
function focusCategories() {
  return (state.focusCategories || []).filter(category => !category.archived);
}

function isLeafCategory(id) {
  return !focusCategories().some(category => category.parentId === id);
}

function currentCategory() {
  const cats = focusCategories();
  const selected = cats.find(category => category.id === state.timer.projectId && isLeafCategory(category.id));
  if (selected) return selected;
  return cats.find(category => isLeafCategory(category.id)) || null;
}

function categoryName(id) {
  const category = (state.focusCategories || []).find(item => item.id === id);
  if (category) return category.name;
  const project = (state.focusProjects || []).find(item => item.id === id);
  return project?.name || '未分类专注';
}

function categoryPath(id) {
  const byId = new Map((state.focusCategories || []).map(category => [category.id, category]));
  const parts = [];
  const seen = new Set();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return parts.join(' / ');
}

function collectDescendants(id) {
  const byParent = new Map();
  (state.focusCategories || []).forEach(category => {
    if (!byParent.has(category.parentId)) byParent.set(category.parentId, []);
    byParent.get(category.parentId).push(category.id);
  });
  const result = [];
  const walk = parentId => {
    (byParent.get(parentId) || []).forEach(childId => { result.push(childId); walk(childId); });
  };
  walk(id);
  return result;
}

function isDescendantOf(ancestorId, nodeId) {
  const byId = new Map((state.focusCategories || []).map(category => [category.id, category]));
  const seen = new Set();
  let current = byId.get(nodeId);
  while (current && current.parentId) {
    if (current.parentId === ancestorId) return true;
    if (seen.has(current.id)) break;
    seen.add(current.id);
    current = byId.get(current.parentId);
  }
  return false;
}

// ---- 实时统计 ----
function focusStats() {
  const sessions = state.sessions || [];
  const today = dateKey();
  const now = new Date();
  const monday = new Date(now); monday.setHours(12, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const sum = list => list.reduce((total, session) => total + (Number(session.minutes) || 0), 0);
  return {
    today: sum(sessions.filter(session => session.date === today)),
    week: sum(sessions.filter(session => new Date(`${session.date}T12:00:00`) >= monday)),
    total: sum(sessions)
  };
}

function categoryTotalMinutes(categoryId) {
  return (state.sessions || []).filter(session => (session.categoryId || session.projectId) === categoryId).reduce((total, session) => total + (Number(session.minutes) || 0), 0);
}

function recentCategories() {
  const seen = new Set();
  const result = [];
  const sessions = [...(state.sessions || [])].sort((a, b) => b.startedAt - a.startedAt);
  for (const session of sessions) {
    const id = session.categoryId || session.projectId;
    if (!id || seen.has(id)) continue;
    const category = (state.focusCategories || []).find(item => item.id === id);
    if (category && !category.archived && isLeafCategory(id)) {
      seen.add(id);
      result.push(category);
      if (result.length >= 5) break;
    }
  }
  return result;
}

export function focusView() {
  const quickDurations = [15, 25, 30, 45, 60, 90];
  const stopwatch = state.timer.mode === 'stopwatch';
  const pomodoro = state.timer.mode === 'pomodoro';
  const running = state.timer.running;
  const left = stopwatch ? currentElapsed() : currentLeft();
  const progress = stopwatch ? Math.min(1, (left % 60) / 60) : state.timer.duration ? Math.max(0, Math.min(1, left / state.timer.duration)) : 0;
  const cat = currentCategory();
  const catPath = cat ? categoryPath(cat.id) : '';
  const phaseLabel = { focus: '专注', shortBreak: '短休息', longBreak: '长休息' }[state.timer.phase];
  const nextBreakMinutes = state.timer.round >= state.settings.pomodoroRounds ? state.settings.pomodoroLongBreakMinutes : state.settings.pomodoroShortBreakMinutes;
  const status = pomodoro
    ? state.timer.phase === 'focus'
      ? `第 ${state.timer.round}/${state.settings.pomodoroRounds} 轮专注中 · 随后${state.timer.round >= state.settings.pomodoroRounds ? '长休' : '短休'} ${nextBreakMinutes}m`
      : `${phaseLabel}中 · 下一阶段专注`
    : stopwatch ? '正向秒表累加中' : '自由倒计时模式';
  const categoryLabel = catPath || cat?.name || '选择专注分类';
  const ambientMix = currentAmbientMix();
  const legacyAmbient = AMBIENT_SOUNDS[state.settings.ambientSound] || AMBIENT_SOUNDS.none;
  const legacyAmbientButton = `<button type="button" class="focus-single-ambient" id="ambient-change"><span class="material-symbols-outlined">${legacyAmbient.icon}</span>单轨：${esc(legacyAmbient.label)}</button>`;
  const durationLabel = minutes => minutes === 25 ? '25m · 标准' : minutes === 45 ? '45m · 深度' : `${minutes}m`;
  const presetChips = stopwatch ? '' : `<div class="preset-duration-grid">${quickDurations.map(minutes => `<button data-duration="${minutes}" class="duration-chip ${state.timer.duration === minutes * 60 ? 'active' : ''}" ${running ? 'disabled' : ''}>${durationLabel(minutes)}</button>`).join('')}</div>`;
  const categoryPickerHtml = `<button class="focus-category-picker" id="category-change" ${running || (pomodoro && state.timer.phase !== 'focus') ? 'disabled' : ''}><span class="material-symbols-outlined" aria-hidden="true">folder_open</span><span class="focus-cat-label">${esc(categoryLabel)}</span><span class="material-symbols-outlined" aria-hidden="true">unfold_more</span></button>`;
  const totalLabel = !stopwatch ? `<span class="focus-total">/ ${clock(state.timer.duration)}</span>` : '';
  const pomoDots = pomodoro ? `<div class="pomo-stage-dots" aria-label="番茄轮次">${Array.from({ length: state.settings.pomodoroRounds }, (_, index) => `<span class="pomo-dot ${index + 1 < state.timer.round ? 'filled' : ''} ${index + 1 === state.timer.round ? 'current' : ''}"></span>`).join('')}</div>` : '';
  const mixById = new Map(ambientMix.map(track => [track.soundId, track]));
  const mixerRows = SOUND_TRACKS.map(track => {
    const mixTrack = mixById.get(track.id);
    const trackActive = Boolean(mixTrack && mixTrack.volume > 0);
    const trackVolume = Math.round((mixTrack?.volume ?? track.defaultVolume) * 100);
    const volumeLabel = trackVolume ? `${trackVolume}%` : '静音';
    return `<div class="sound-track-row ${trackActive ? 'active' : ''}" id="sound-track-${track.id}"><button type="button" class="sound-track-toggle" data-sound-toggle="${track.id}" aria-pressed="${trackActive}"><span class="material-symbols-outlined sound-track-icon" aria-hidden="true">${track.icon}</span><span class="sound-track-name">${track.label}</span>${track.procedural ? '<small class="sound-track-kind">程序化底噪</small>' : ''}</button><input class="sound-slider" type="range" min="0" max="100" value="${trackVolume}" data-sound-volume="${track.id}" aria-label="${track.label}音量"><span class="sound-track-pct">${volumeLabel}</span></div>`;
  }).join('');
  const keepAwakeOn = running;
  const preferencesHtml = `<section class="focus-preferences" aria-label="专注偏好"><h2 class="sheet-title"><small>FOCUS PREFERENCES</small>专注偏好</h2><div class="focus-preference-box"><div class="timer-preference-row"><span><span class="material-symbols-outlined" aria-hidden="true">lightbulb</span> 专注期间保持屏幕常亮<small>随计时自动控制</small></span><button type="button" class="switch-pill ${keepAwakeOn ? '' : 'off'} unavailable" disabled aria-label="系统随计时自动控制"></button></div><div class="timer-preference-row"><span><span class="material-symbols-outlined" aria-hidden="true">notifications_active</span> 阶段结束持续播放提示音</span><button type="button" class="switch-pill ${state.settings.notificationsEnabled ? '' : 'off'}" data-focus-preference="notificationsEnabled" aria-pressed="${Boolean(state.settings.notificationsEnabled)}"></button></div><div class="timer-preference-row"><span><span class="material-symbols-outlined" aria-hidden="true">coffee</span> 自动无缝进入下一轮休息</span><button type="button" class="switch-pill ${state.settings.pomodoroAutoStart ? '' : 'off'}" data-focus-preference="pomodoroAutoStart" aria-pressed="${Boolean(state.settings.pomodoroAutoStart)}"></button></div></div></section>`;
  const immersiveHtml = running ? `<button type="button" id="exit-immersive" class="immersive-exit" aria-label="退出沉浸计时"><span class="material-symbols-outlined">minimize</span></button><button type="button" id="orientation-toggle" class="orientation-toggle" data-mode="${state.settings.timerOrientation || 'auto'}" aria-label="${orientationToast(state.settings.timerOrientation || 'auto')}"><span class="material-symbols-outlined">${orientationIcon(state.settings.timerOrientation || 'auto')}</span></button><div class="immersive-clock-screen" id="immersive-clock-screen"><span class="immersive-eyebrow">IMMERSIVE DEEP FLOW</span><div class="flip-clock" id="flip-clock" aria-hidden="true"></div><span class="immersive-cat-label" id="immersive-giant-cat">${esc(cat?.name || '专注中')}</span><span class="immersive-wake-hint"><span class="material-symbols-outlined" aria-hidden="true">touch_app</span>轻触任意位置唤醒</span></div>` : '';
  return `<section class="view focus-view focus-screen${running ? ' focus-immersed' : ''}">${immersiveHtml}<header class="focus-intro focus-main-header"><span class="focus-header-kicker">FOCUS ATELIER · N° ${new Date().getDate()}</span><div class="subpage-title">专注工坊</div><div class="subpage-subtitle">让时间沉静下来，完成此刻的一件事</div></header><article class="focus-main-panel"><div class="focus-mode-selector"><button data-timer-mode="pomodoro" id="fmode-pomo" class="focus-mode-btn ${pomodoro ? 'active' : ''}" ${running ? 'disabled' : ''}><span class="material-symbols-outlined" aria-hidden="true">timer</span> 番茄钟</button><button data-timer-mode="free" id="fmode-countdown" class="focus-mode-btn ${!pomodoro && !stopwatch ? 'active' : ''}" ${running ? 'disabled' : ''}><span class="material-symbols-outlined" aria-hidden="true">hourglass_top</span> 倒计时</button><button data-timer-mode="stopwatch" id="fmode-stopwatch" class="focus-mode-btn ${stopwatch ? 'active' : ''}" ${running ? 'disabled' : ''}><span class="material-symbols-outlined" aria-hidden="true">timer_10</span> 正向秒表</button></div>${dailyFocusHtml()}${categoryPickerHtml}${presetChips}<div class="focus-ring-box"><div class="timer-svg-wrap timer-ring" style="--remaining:${progress}"><svg class="timer-svg" viewBox="0 0 200 200" aria-hidden="true"><circle class="timer-track" pathLength="1" cx="100" cy="100" r="90"></circle><circle class="timer-progress" id="timer-progress" pathLength="1" cx="100" cy="100" r="90"></circle></svg><div class="timer-copy timer-center"><span class="timer-kicker" id="timer-status">${status}</span><div class="timer-value ${(stopwatch ? left : state.timer.duration) >= 3600 ? 'with-hours' : ''}" id="timer-value">${clock(left)}</div>${totalLabel}${pomoDots}<span class="timer-label">${pomodoro && state.timer.phase !== 'focus' ? '休息一下，准备下一轮' : status}</span></div></div><div class="focus-timer-actions"><button id="reset" class="timer-action-secondary" aria-label="${running ? '放弃本次计时' : '重置计时'}"><span class="material-symbols-outlined">${running ? 'close' : 'replay'}</span><small>${running ? '放弃' : '重置'}</small></button><button class="play" id="play" aria-label="${running ? '暂停' : '开始'}"><span class="material-symbols-outlined">${running ? 'pause' : 'play_arrow'}</span><small>${running ? '暂停' : (stopwatch ? state.timer.elapsed : state.timer.left < state.timer.duration) ? '继续' : '开始'}</small></button><button id="finish" class="timer-action-secondary" aria-label="${pomodoro ? '完成当前阶段' : '结算计时'}"><span class="material-symbols-outlined">check</span><small>结算</small></button><button type="button" id="screensaver-trigger" class="timer-action-screensaver" ${running ? '' : 'disabled'} aria-label="进入沉浸屏保"><span class="material-symbols-outlined" aria-hidden="true">fullscreen</span><small>屏保</small></button></div></div></article><details class="focus-stream-sheet stream-sheet" aria-label="环境声音与专注偏好"><summary class="focus-optional-summary"><span class="material-symbols-outlined">tune</span><span>环境声音与更多设置<small>按需要展开，安静开始也很好</small></span><span class="material-symbols-outlined">expand_more</span></summary><div class="sheet-handle"></div><div class="focus-audio-header"><h2 class="sheet-title"><small>AMBIENT SOUND</small>环境声景</h2>${legacyAmbientButton}</div><div class="sound-mixer-box">${mixerRows}</div>${preferencesHtml}<div class="focus-context-actions"><button type="button" id="task-change"><span class="material-symbols-outlined">edit_note</span><span>${esc(state.timer.task || '本次内容')}</span></button><button type="button" id="custom-duration" ${running || stopwatch ? 'disabled' : ''}><span class="material-symbols-outlined">schedule</span><span>自定义</span></button><button type="button" id="focus-settings-open"><span class="material-symbols-outlined">tune</span><span>计时设置</span></button><button type="button" id="focus-report-open"><span class="material-symbols-outlined">insights</span><span>复盘报告</span></button></div></details></section>`;
}

function dailyFocusHtml() {
  const intent = state.settings.focusIntent || {};
  const task = state.todos.find(item => item.id === intent.todoId);
  const habit = state.habits.find(item => item.id === intent.habitId);
  const busy = focusHasProgress(state);
  const candidates = dailyTodoGroups(state).today.slice(0, 3);
  return `<section class="daily-focus-sheet"><header><small>JUST ONE SMALL STEP</small><h2>这一刻，只做一件事</h2></header><label for="focus-task-inline">这次想做什么</label><input id="focus-task-inline" maxlength="80" value="${esc(state.timer.task || '')}" placeholder="例如：读十页书，或整理一段笔记" ${busy ? 'disabled' : ''}>${task || habit ? `<p class="daily-focus-link">${task ? '来自待办' : '来自习惯'} · ${esc(task?.title || habit?.name)}</p>` : ''}<div class="daily-focus-starts"><button type="button" data-focus-quick-start="10" ${busy ? 'disabled' : ''}>先做 10 分钟</button><button type="button" data-focus-quick-start="25" ${busy ? 'disabled' : ''}>专注 25 分钟</button></div>${!busy && candidates.length ? `<div class="daily-focus-candidates"><small>也可以从今天的待办开始</small>${candidates.map(item => `<button type="button" data-focus-pick-todo="${esc(item.id)}"><span class="material-symbols-outlined">play_arrow</span>${esc(item.title)}</button>`).join('')}</div>` : ''}<p class="daily-focus-note">分类和环境音都可以稍后再选。结束后保留实际时间，再确认这件事是否完成。</p></section>`;
}

export async function startDailyFocus(options) {
  const previousTimer = { ...state.timer }, previousIntent = state.settings.focusIntent;
  const next = prepareDailyFocus(state, options);
  state.timer = next.timer;
  state.settings.focusIntent = next.intent;
  try { await save(); }
  catch (error) { state.timer = previousTimer; state.settings.focusIntent = previousIntent; throw error; }
  closeModal(); callHelper('closeSubpage'); go('focus');
  await startTimer();
}

function focusOutcome(sessionId, intent) {
  focusDetailReport(sessionId);
  const todo = state.todos.find(item => item.id === intent?.todoId && !item.completed);
  const habit = state.habits.find(item => item.id === intent?.habitId && !item.archived);
  if (!todo && (!habit || (habit.tracking === 'quantity' && /分钟/.test(habit.unit)))) return;
  const target = $('#subpage-focus-detail .focus-report-body');
  if (!target) return;
  target.insertAdjacentHTML('afterbegin', `<section class="daily-focus-outcome"><small>ONE STEP FORWARD</small><h2>这一小步，做完了吗？</h2><p>${esc(todo?.title || habit.name)}</p><button type="button" id="focus-target-complete">${todo ? '这件待办已完成' : '给这个习惯记一次'}</button><small>只有点击确认才会更新记录；还没做完也没关系，保留清单继续做。</small></section>`);
  $('#focus-target-complete').onclick = async event => {
    const button = event.currentTarget; button.disabled = true;
    try {
      if (todo) await callHelper('setTodoCompleted', todo.id, true);
      else if (await callHelper('commitHabitProgress', habit.id, Number(state.checks[dateKey()]?.[habit.id] || 0) + 1, '已记下一次') !== true) throw new Error('习惯还没有保存，请重试');
      button.textContent = '已记下这一步';
    } catch (error) { button.disabled = false; show(error.message); }
  };
}

function syncTimer() {
  if (!state.timer.running) return;
  const update = () => {
    const stopwatch = state.timer.mode === 'stopwatch';
    const value = stopwatch ? currentElapsed() : currentLeft();
    if (stopwatch) state.timer.elapsed = value;
    else state.timer.left = value;
    const element = $('#timer-value');
    if (element) element.textContent = clock(value);
    updateFlipClock(value);
    const summary = $('#duration-summary');
    if (summary && stopwatch) summary.textContent = durationText(value);
    const ring = $('.timer-ring');
    if (ring) ring.style.setProperty('--remaining', stopwatch ? Math.min(1, (value % 60) / 60) : state.timer.duration ? Math.max(0, Math.min(1, value / state.timer.duration)) : 0);
    if (!stopwatch && value <= 0) completeTimer(true).catch(error => show(error.message));
  };
  update();
  setTick(setInterval(update, 250));
}

export async function startTimer() {
  const previousTimer = { ...state.timer };
  const previousTracking = { startedAt: sessionStartedAt, interruptions: sessionInterruptions };
  immersiveDismissed = false;
  primeCompletionTone();
  const stopwatch = state.timer.mode === 'stopwatch';
  const currentCat = currentCategory();
  const resuming = stopwatch ? state.timer.elapsed > 0 : state.timer.left < state.timer.duration;
  if (!resuming) {
    resetSessionTracking();
    sessionStartedAt = Date.now();
  } else if (!sessionStartedAt) {
    sessionStartedAt = state.timer.startedAt || Date.now();
  }
  state.timer.running = true;
  state.timer.startedAt = stopwatch ? Date.now() - state.timer.elapsed * 1000 : Date.now();
  state.timer.endAt = stopwatch ? null : Date.now() + state.timer.left * 1000;
  try { await save(); }
  catch (error) {
    state.timer = previousTimer;
    sessionStartedAt = previousTracking.startedAt; sessionInterruptions = previousTracking.interruptions;
    render(); throw error;
  }
  setKeepAwake(true).catch(() => {});
  if (!stopwatch) startFocusNotification(state.timer.task || currentCat?.name || '专注', state.timer.endAt).catch(() => {});
  const mix = currentAmbientMix();
  const ambient = state.settings.ambientSound;
  if (mix.length) resumeAmbientMix();
  else if (ambient && ambient !== 'none' && currentAmbient() !== ambient) setAmbient(ambient, state.settings.ambientVolume);
  if (!stopwatch && state.settings.notificationsEnabled) {
    const label = state.timer.mode === 'pomodoro' ? ({ focus: '番茄专注', shortBreak: '短休息', longBreak: '长休息' }[state.timer.phase]) : '专注';
    try {
      const allowed = await scheduleTimerNotification(state.timer.endAt, state.timer.task || currentCat?.name, label);
      if (!allowed) show('通知权限未开启，计时结束后台可能无法弹出提醒');
    }
    catch (error) { console.warn(error); show('计时已开始，但通知未能启用'); }
  }
  render();
}

async function pauseTimer() {
  if (state.timer.mode === 'stopwatch') state.timer.elapsed = currentElapsed();
  else state.timer.left = currentLeft();
  state.timer.running = false;
  state.timer.endAt = null;
  state.timer.startedAt = null;
  pauseAmbientMix();
  setKeepAwake(false).catch(() => {});
  stopFocusNotification().catch(() => {});
  await cancelTimerNotification().catch(console.warn);
  await save();
  render();
}

// 重置与放弃共用：把计时归位到设定时长（正计时归零），不产生记录。
// 界面区分：计时中显示「放弃」，空闲/暂停显示「重置」，仅文案与图标不同，动作一致。
async function resetTimerState() {
  resetSessionTracking();
  stopAmbient();
  state.timer.left = state.timer.duration;
  state.timer.elapsed = 0;
  state.timer.running = false;
  state.timer.endAt = null;
  state.timer.startedAt = null;
  state.settings.focusIntent = null;
  setKeepAwake(false).catch(() => {});
  stopFocusNotification().catch(() => {});
  await cancelTimerNotification().catch(console.warn);
  await save();
  render();
}

async function resetTimer() {
  await resetTimerState();
  show('已重置本次计时，未保存记录');
}

export async function abandonTimer() {
  await resetTimerState();
  show('已放弃本次计时，未保存记录');
}

export async function completeTimer(automatic = false) {
  if (!state.timer.running && automatic) return;
  const previous = { timer: { ...state.timer }, sessions: [...state.sessions], checks: structuredClone(state.checks), completions: structuredClone(state.habitCompletions), intent: state.settings.focusIntent, startedAt: sessionStartedAt, interruptions: sessionInterruptions };
  const completedPhase = state.timer.mode === 'pomodoro'
    ? ({ focus: '番茄专注', shortBreak: '短休息', longBreak: '长休息' }[state.timer.phase])
    : '专注计时';
  const stopwatch = state.timer.mode === 'stopwatch';
  const elapsedSeconds = stopwatch ? currentElapsed() : automatic ? state.timer.duration : state.timer.duration - currentLeft();
  const minutes = Math.max(0, Math.floor(elapsedSeconds / 60));
  const shouldRecord = state.timer.mode !== 'pomodoro' || state.timer.phase === 'focus';
  const category = currentCategory();
  let completedSessionId = '';
  const completedIntent = { ...(state.settings.focusIntent || {}) };
  if (shouldRecord && minutes >= 1) {
    const endedAt = Date.now();
    const targetDurationSeconds = stopwatch ? 0 : state.timer.duration;
    const mixSnapshot = currentAmbientMix();
    const soundId = currentAmbient();
    // 结算时才解析联动习惯：migrateState 已保证指向的习惯仍然有效，这里再兜一次底。
    const linkedHabitId = (() => {
      const id = state.settings?.focusIntent?.habitId || state.settings?.focusLinkedHabitId;
      if (!id) return '';
      const habit = (state.habits || []).find(item => item.id === id);
      return habit && !habit.archived && habit.tracking === 'quantity' && /分钟/.test(habit.unit || '') ? id : '';
    })();
    const session = {
      id: uid(),
      date: dateKey(),
      mode: state.timer.mode === 'pomodoro' ? 'pomo' : state.timer.mode === 'free' ? 'countdown' : 'stopwatch',
      category: category?.name || '未分类专注',
      categoryId: category?.id || '',
      projectId: category?.id || '',
      task: state.timer.task || '',
      detail: state.timer.mode === 'pomodoro' ? `番茄专注第 ${state.timer.round} 轮` : stopwatch ? '正向计时' : automatic ? '计时完成' : '提前完成',
      durationSeconds: elapsedSeconds,
      targetDurationSeconds,
      minutes,
      ambientSoundsUsed: mixSnapshot.length ? mixSnapshot : (soundId && soundId !== 'none' ? [{ soundId, volume: Number(state.settings.ambientVolume) || 0 }] : []),
      interruptionsCount: sessionInterruptions,
      // 专注↔习惯联动：用户在计时设置里选定习惯后，这里把实际专注分钟数带上，
      // 由 common.js 的 adjustHabitMinutes 统一累加并判定达标。
      // 记录里保留 habitId / habitMinutes，编辑或删除这条专注时能按原样回退。
      habitId: linkedHabitId,
      habitMinutes: linkedHabitId ? minutes : 0,
      mediaId: '',
      startedAt: sessionStartedAt || state.timer.startedAt || endedAt - elapsedSeconds * 1000,
      endedAt
    };
    session.flowScore = callHelper('calculateFlowScore', session);
    state.sessions.push(session);
    // 真正累加到习惯：放在 push 之后，保证即使联动失败也不会影响这条专注记录本身。
    if (linkedHabitId && minutes > 0) {
      adjustHabitMinutes(session.date, linkedHabitId, minutes, Number(session.startedAt) + minutes * 60000);
    }
    completedSessionId = session.id;
  }
  resetSessionTracking();
  stopAmbient();
  state.timer.running = false;
  state.timer.endAt = null;
  state.timer.startedAt = null;
  state.timer.elapsed = 0;
  setKeepAwake(false).catch(() => {});
  stopFocusNotification().catch(() => {});
  if (state.timer.mode === 'pomodoro') {
    const next = nextPomodoroStage(state.timer, state.settings);
    state.timer.phase = next.phase;
    state.timer.round = next.round;
    state.timer.duration = pomodoroPhaseSeconds(state.settings, next.phase);
    state.timer.left = state.timer.duration;
  } else state.timer.left = state.timer.duration;
  const autoAdvance = state.timer.mode === 'pomodoro' && automatic && state.settings.pomodoroAutoStart;
  if (completedSessionId && !autoAdvance) state.settings.focusIntent = null;
  const nativeAlarmIsRinging = automatic && state.settings.notificationsEnabled
    ? await isTimerAlarmRinging().catch(() => false)
    : false;
  if (!automatic || autoAdvance) await cancelTimerNotification().catch(console.warn);
  try { await save(); }
  catch (error) {
    state.sessions = previous.sessions; state.checks = previous.checks; state.habitCompletions = previous.completions;
    state.settings.focusIntent = previous.intent;
    state.timer = { ...previous.timer, running: false, endAt: null, startedAt: null, left: stopwatch ? previous.timer.left : Math.max(0, previous.timer.duration - elapsedSeconds), elapsed: stopwatch ? elapsedSeconds : previous.timer.elapsed };
    sessionStartedAt = previous.startedAt; sessionInterruptions = previous.interruptions;
    render(); throw error;
  }
  render();
  if (automatic && state.settings.notificationsEnabled && !autoAdvance) {
    if (Capacitor.isNativePlatform()) {
      if (nativeAlarmIsRinging) completionAlarmModal(completedPhase);
      else setTimeout(async () => {
        if (await isTimerAlarmRinging().catch(() => false)) completionAlarmModal(completedPhase);
      }, 1200);
    } else {
      startBrowserCompletionAlarm();
      completionAlarmModal(completedPhase);
    }
  }
  if (autoAdvance) {
    if (nativeAlarmIsRinging) await stopCompletionAlarm().catch(console.warn);
    else if (!Capacitor.isNativePlatform()) playCompletionChime();
    const nextLabel = { focus: '专注', shortBreak: '短休息', longBreak: '长休息' }[state.timer.phase];
    show(`${completedPhase}完成，自动开始${nextLabel}`);
    await startTimer();
  } else if (state.timer.mode === 'pomodoro') {
    show(`${automatic ? '阶段完成' : '已切换'}，请手动开始下一阶段`);
  } else {
    show(minutes >= 1 ? `已保存 ${minutes} 分钟专注记录` : '计时已完成；不足 1 分钟，不计入专注统计');
  }
  if (completedSessionId && (!automatic || completedIntent.todoId || completedIntent.habitId) && !autoAdvance) focusOutcome(completedSessionId, completedIntent);
}

function setTimerMode(mode) {
  if (focusHasProgress(state)) { show('本次专注还未结束，请先继续、结束或放弃。'); return; }
  if (!['free', 'stopwatch', 'pomodoro'].includes(mode)) return;
  state.timer.mode = mode;
  state.timer.phase = 'focus';
  state.timer.round = 1;
  state.timer.elapsed = 0;
  state.timer.duration = mode === 'pomodoro' ? pomodoroPhaseSeconds(state.settings, 'focus') : state.settings.defaultDurationMinutes * 60;
  state.timer.left = state.timer.duration;
  save().catch(error => show(error.message));
  render();
}

function taskForm() {
  modal(`<form id="task-form"><span class="eyebrow">SESSION NOTE</span><h2>本次专注内容</h2><p class="subtle">分类负责统计归类；这里只记录这次具体做了什么，仅作备注、不参与统计，可以留空。</p><label>具体内容</label><input name="task" maxlength="80" value="${esc(state.timer.task)}" placeholder="例如：高数第三章习题"><div class="modal-actions"><button type="button" data-close>取消</button><button class="save">保存</button></div></form>`);
}

// ---- 树形分类渲染（选择器 + 管理共用）----
function renderCategoryBranch(parentId, depth, currentId, mode) {
  const children = focusCategories().filter(category => category.parentId === parentId).sort((a, b) => (a.sortOrder - b.sortOrder) || (a.createdAt - b.createdAt));
  return children.map(category => {
    const hasChildren = !isLeafCategory(category.id);
    const expanded = expandedCategories.has(category.id);
    const isLeaf = !hasChildren;
    const action = mode === 'pick' && isLeaf ? `data-pick-category="${category.id}"` : `data-edit-category="${category.id}"`;
    const trail = hasChildren
      ? `<i class="material-symbols-outlined cat-arrow">${expanded ? 'expand_more' : 'chevron_right'}</i>`
      : (mode === 'pick' ? (category.id === currentId ? '<i class="material-symbols-outlined cat-check">check_circle</i>' : '<i class="material-symbols-outlined cat-arrow">arrow_forward</i>') : '');
    const childHtml = (hasChildren && expanded) ? renderCategoryBranch(category.id, depth + 1, currentId, mode) : '';
    return `<div class="cat-row" style="padding-left:${depth * 20}px"><button class="cat-pick ${category.id === currentId ? 'active' : ''}" ${hasChildren ? `data-toggle-category="${category.id}"` : action}><span class="cat-dot" style="--project-color:${category.color}"><i class="material-symbols-outlined">${category.icon}</i></span><span class="cat-name">${esc(category.name)}</span>${trail}</button><button class="cat-edit" data-edit-category="${category.id}" aria-label="编辑${esc(category.name)}"><i class="material-symbols-outlined">edit</i></button></div>${childHtml}`;
  }).join('');
}

function categoryPicker() {
  const currentId = state.timer.projectId;
  const tree = renderCategoryBranch('', 0, currentId, 'pick');
  const recent = recentCategories();
  const recentHtml = recent.length ? `<section class="category-picker-recent"><small>最近使用</small><div>${recent.map(category => `<button type="button" data-pick-recent-category="${category.id}"><span class="material-symbols-outlined">${category.icon}</span>${esc(category.name)}</button>`).join('')}</div></section>` : '';
  modal(`<div class="modal-head"><div><span class="eyebrow">FOCUS CATEGORY</span><h2>选择专注分类</h2><p>展开到最底层分类，点击即可开始计时。</p></div><button id="manage-categories" class="icon-button" aria-label="管理分类"><span class="material-symbols-outlined">tune</span></button></div>${recentHtml}${tree ? `<div class="category-tree">${tree}</div>` : `<div class="category-tree-empty">${emptyState('还没有分类', '点右上角管理，新建「考研 → 英语 → 背单词」这样的层级。')}</div>`}<div class="modal-actions"><button type="button" data-close>取消</button></div>`, 'large-modal category-picker-modal');
  $$('[data-pick-recent-category]').forEach(button => button.onclick = async () => { state.timer.projectId = button.dataset.pickRecentCategory; await save(); closeModal(); render(); });
  $$('[data-pick-category]').forEach(button => button.onclick = async () => { state.timer.projectId = button.dataset.pickCategory; await save(); closeModal(); render(); });
  $$('[data-toggle-category]').forEach(button => button.onclick = () => { const id = button.dataset.toggleCategory; expandedCategories.has(id) ? expandedCategories.delete(id) : expandedCategories.add(id); categoryPicker(); });
  $$('[data-edit-category]').forEach(button => button.onclick = () => categoryForm((state.focusCategories || []).find(category => category.id === button.dataset.editCategory)));
  $('#manage-categories')?.addEventListener('click', categoryManager);
}

function categoryManager() {
  const tree = renderCategoryBranch('', 0, state.timer.projectId, 'manage');
  modal(`<div class="modal-head"><div><h2>分类管理</h2><p>点击分类可编辑，可嵌套多级层级。</p></div><button id="new-category-root" class="icon-button" aria-label="新建分类"><span class="material-symbols-outlined">add</span></button></div>${tree ? `<div class="category-tree">${tree}</div>` : `<div class="category-tree-empty">${emptyState('还没有分类', '点右上角新建第一个分类。')}</div>`}<div class="modal-actions"><button type="button" data-close>完成</button></div>`, 'large-modal');
  $$('[data-edit-category]').forEach(button => button.onclick = () => categoryForm((state.focusCategories || []).find(category => category.id === button.dataset.editCategory)));
  $$('[data-toggle-category]').forEach(button => button.onclick = () => { const id = button.dataset.toggleCategory; expandedCategories.has(id) ? expandedCategories.delete(id) : expandedCategories.add(id); categoryManager(); });
  $('#new-category-root').onclick = () => categoryForm();
}

function categoryForm(category = null) {
  const item = category || makeFocusCategory({ name: '', icon: 'school', color: PROJECT_COLORS[0] });
  const parentOptions = focusCategories()
    .filter(candidate => candidate.id !== item.id && !isDescendantOf(item.id, candidate.id))
    .map(candidate => `<option value="${candidate.id}" ${candidate.id === item.parentId ? 'selected' : ''}>${esc(categoryPath(candidate.id) || candidate.name)}</option>`).join('');
  modal(`<form id="category-form"><input type="hidden" name="id" value="${category ? item.id : ''}"><span class="eyebrow">FOCUS CATEGORY</span><h2>${category ? '编辑' : '新建'}分类</h2><label>分类名称</label><input name="name" maxlength="24" required value="${esc(item.name)}" placeholder="例如：高等数学"><label>父分类（可选，留空为顶级）</label><select name="parentId"><option value="">（顶级分类）</option>${parentOptions}</select><small class="field-help">放在父分类下可形成多级层级，如「考研 → 英语 → 背单词」。</small><fieldset class="project-icon-field"><legend>图标</legend><div class="project-icon-picker">${PROJECT_ICONS.map(([value, label]) => `<label><input type="radio" name="icon" value="${value}" ${item.icon === value ? 'checked' : ''}><span><i class="material-symbols-outlined">${value}</i><small>${label}</small></span></label>`).join('')}</div></fieldset><fieldset class="project-color-field"><legend>颜色</legend><div class="project-color-picker">${PROJECT_COLORS.map(value => `<label><input type="radio" name="color" value="${value}" ${item.color === value ? 'checked' : ''}><span style="--swatch:${value}"></span></label>`).join('')}</div></fieldset><div class="modal-actions">${category ? '<button type="button" class="danger" id="delete-category">删除</button>' : ''}<button type="button" id="category-form-back">返回</button><button class="save">保存分类</button></div></form>`, 'large-modal');
  $('#category-form-back').onclick = categoryManager;
  $('#delete-category')?.addEventListener('click', () => confirmDeleteCategory(category));
}

function confirmDeleteCategory(category) {
  const descendants = collectDescendants(category.id);
  const ids = [category.id, ...descendants];
  const linkedSessions = (state.sessions || []).filter(session => ids.includes(session.categoryId || session.projectId));
  const message = `删除「${category.name}」${descendants.length ? `及其 ${descendants.length} 个子分类` : ''}？${linkedSessions.length ? `有 ${linkedSessions.length} 条专注记录关联此分类，删除后这些记录将归为「未分类」。` : '此操作无法撤销。'}`;
  confirmDelete(message, async () => {
    state.focusCategories = (state.focusCategories || []).filter(item => !ids.includes(item.id));
    (state.sessions || []).forEach(session => { if (ids.includes(session.categoryId || session.projectId)) session.categoryId = ''; });
    if (ids.includes(state.timer.projectId)) state.timer.projectId = '';
    ids.forEach(id => expandedCategories.delete(id));
    await save();
    categoryManager();
  });
}

function customDurationForm() {
  const hours = Math.floor(state.timer.duration / 3600), minutes = Math.floor(state.timer.duration % 3600 / 60), seconds = state.timer.duration % 60;
  modal(`<form id="duration-form"><span class="eyebrow">CUSTOM TIMER</span><h2>自定义专注时长</h2><p class="subtle">最长 23 小时 59 分 59 秒，至少设置 1 秒。</p><div class="time-inputs"><label><input name="hours" type="number" inputmode="numeric" min="0" max="23" required value="${hours}"><span>小时</span></label><b>:</b><label><input name="minutes" type="number" inputmode="numeric" min="0" max="59" required value="${minutes}"><span>分钟</span></label><b>:</b><label><input name="seconds" type="number" inputmode="numeric" min="0" max="59" required value="${seconds}"><span>秒</span></label></div><div class="modal-actions"><button type="button" data-close>取消</button><button class="save">应用时长</button></div></form>`, 'duration-modal');
}

function timerSettingsForm() {
  // 联动候选：只列「按分钟计量的数量型习惯」，其余类型无法用时长自动累加。
  const linkableHabits = (state.habits || []).filter(habit => !habit.archived && habit.tracking === 'quantity' && /分钟/.test(habit.unit || ''));
  const habitOptions = `<option value="">不自动记入习惯</option>${linkableHabits.map(habit => `<option value="${habit.id}" ${state.settings.focusLinkedHabitId === habit.id ? 'selected' : ''}>${esc(habit.name)}（每天 ${habit.target} 分钟）</option>`).join('')}`;
  modal(`<form id="timer-settings-form"><h2>计时与番茄循环</h2><label>自由计时默认时长（分钟）</label><input name="duration" type="number" min="1" max="180" required value="${state.settings.defaultDurationMinutes}"><label>专注结束自动记入习惯</label><select name="focusLinkedHabit">${habitOptions}</select><small class="field-help">选择后，每次专注结束（倒计时 / 正向计时 / 番茄钟专注段）会把实际专注分钟数自动加到该习惯；不足 1 分钟的专注不计入。</small><div class="pomodoro-settings"><h3>番茄循环</h3><div class="form-grid"><div><label>专注（分钟）</label><input name="pomodoroFocus" type="number" min="1" max="180" required value="${state.settings.pomodoroFocusMinutes}"></div><div><label>短休息（分钟）</label><input name="pomodoroShort" type="number" min="1" max="60" required value="${state.settings.pomodoroShortBreakMinutes}"></div><div><label>长休息（分钟）</label><input name="pomodoroLong" type="number" min="1" max="120" required value="${state.settings.pomodoroLongBreakMinutes}"></div><div><label>每组轮数</label><input name="pomodoroRounds" type="number" min="1" max="12" required value="${state.settings.pomodoroRounds}"></div></div></div><fieldset class="orientation-field"><legend>屏幕方向</legend><small class="field-help">进入沉浸计时后按此方向显示，退出自动恢复竖屏。</small><label class="orientation-option"><input type="radio" name="orientation" value="auto" ${(state.settings.timerOrientation || 'auto') === 'auto' ? 'checked' : ''}><span>自动跟随手机姿态</span></label><label class="orientation-option"><input type="radio" name="orientation" value="landscape" ${state.settings.timerOrientation === 'landscape' ? 'checked' : ''}><span>锁定横屏</span></label><label class="orientation-option"><input type="radio" name="orientation" value="portrait" ${state.settings.timerOrientation === 'portrait' ? 'checked' : ''}><span>锁定竖屏</span></label></fieldset><label class="confirm-line"><input name="autoStart" type="checkbox" ${state.settings.pomodoroAutoStart ? 'checked' : ''}> 自动开始下一阶段</label><label class="confirm-line"><input name="notifications" type="checkbox" ${state.settings.notificationsEnabled ? 'checked' : ''}> 启用结束闹铃与后台通知</label><p class="subtle">专注或休息结束后会持续播放提示音，直到你在软件或通知栏中手动停止。开启自动开始后，阶段结束会直接进入下一阶段。</p><div class="modal-actions"><button type="button" data-close>取消</button><button class="save">保存</button></div></form>`, 'timer-settings-modal');
}

function ambientPicker() {
  const current = state.settings.ambientSound || 'none';
  const items = Object.entries(AMBIENT_SOUNDS).map(([key, item]) => `<button class="ambient-option ${key === current ? 'active' : ''}" data-ambient="${key}"><span class="material-symbols-outlined">${item.icon}</span><strong>${item.label}</strong>${key === current && key !== 'none' ? '<i class="material-symbols-outlined">check</i>' : ''}</button>`).join('');
  modal(`<div class="modal-head"><div><h2>环境音</h2><p>专注时播放舒缓的背景声，随计时开启。</p></div></div><div class="ambient-list">${items}</div><div class="ambient-volume"><span class="material-symbols-outlined">volume_down</span><input type="range" id="ambient-volume" min="0" max="100" value="${Math.round(state.settings.ambientVolume * 100)}"><span class="material-symbols-outlined">volume_up</span></div><div class="modal-actions"><button type="button" data-close>完成</button></div>`, 'large-modal ambient-modal');
  $$('[data-ambient]').forEach(button => button.onclick = () => {
    const key = button.dataset.ambient;
    state.settings.ambientSound = key;
    setAmbient(key, state.settings.ambientVolume);
    save().catch(error => show(error.message));
    $$('[data-ambient]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.ambient === key);
      const check = btn.querySelector('i');
      if (btn.dataset.ambient === key && key !== 'none') { if (!check) btn.insertAdjacentHTML('beforeend', '<i class="material-symbols-outlined">check</i>'); }
      else if (check) check.remove();
    });
    // 同步单轨入口按钮的回显。旧实现查的是 .round-icon 和 <strong>，
    // 但真实 DOM 里按钮是 <span class="material-symbols-outlined"> + 纯文本，
    // 两处都是 null → 选完音就抛 TypeError，UI 完全不回显。
    const item = AMBIENT_SOUNDS[key] || AMBIENT_SOUNDS.none;
    const picker = $('#ambient-change');
    if (picker) {
      picker.innerHTML = `<span class="material-symbols-outlined">${item.icon}</span>单轨：${esc(item.label)}`;
    }
  });
  $('#ambient-volume')?.addEventListener('input', event => {
    state.settings.ambientVolume = Number(event.target.value) / 100;
    setAmbientVolume(state.settings.ambientVolume);
  });
  $('#ambient-volume')?.addEventListener('change', () => save().catch(error => show(error.message)));
}

export function projectSessionHistory(categoryId) {
  const sessions = state.sessions.filter(item => (item.categoryId || item.projectId) === categoryId).sort((a, b) => b.startedAt - a.startedAt);
  modal(`<div class="modal-head"><div><h2>${esc(categoryName(categoryId))}</h2><p>全部 ${sessions.length} 次原始专注记录</p></div></div><div class="record-list">${sessions.length ? sessions.map(sessionCard).join('') : emptyState('还没有记录', '完成一次这个分类的专注后会显示。')}</div><div class="modal-actions"><button type="button" data-close>关闭</button></div>`, 'large-modal focus-history-modal');
  bindRecordActions();
}

// ---- 补录辅助（供复盘岗位阶段 3 在 sessionForm 中接入）----
export function focusCategoryOptions(selectedId = '') {
  const cats = focusCategories();
  const rows = [];
  const walk = (parentId, depth) => {
    cats.filter(category => category.parentId === parentId).sort((a, b) => (a.sortOrder - b.sortOrder) || (a.createdAt - b.createdAt)).forEach(category => {
      const isLeaf = !cats.some(item => item.parentId === category.id);
      const prefix = '　'.repeat(depth) + (depth ? '└ ' : '');
      rows.push({ id: category.id, label: prefix + category.name, isLeaf });
      if (!isLeaf) walk(category.id, depth + 1);
    });
  };
  walk('', 0);
  return rows.map(row => `<option value="${row.id}" ${row.id === selectedId ? 'selected' : ''} ${row.isLeaf ? '' : 'disabled'}>${esc(row.label)}${row.isLeaf ? '' : '（含子分类）'}</option>`).join('');
}

// ---- 全局「计时中」指示器 ----
function syncFloatingIndicator() {
  clearInterval(floatingTick);
  floatingTick = null;
  if (!state.timer.running) {
    $('#floating-timer')?.remove();
    return;
  }
  const update = () => {
    const stopwatch = state.timer.mode === 'stopwatch';
    const value = stopwatch ? currentElapsed() : currentLeft();
    const cat = currentCategory();
    const el = $('#floating-timer');
    if (!el) return;
    const nameEl = el.querySelector('.floating-timer-name');
    const timeEl = el.querySelector('.floating-timer-time');
    if (nameEl) nameEl.textContent = cat?.name || '专注中';
    if (timeEl) timeEl.textContent = clock(value);
  };
  if (!$('#floating-timer')) {
    const stopwatch = state.timer.mode === 'stopwatch';
    const value = stopwatch ? currentElapsed() : currentLeft();
    const cat = currentCategory();
    document.body.insertAdjacentHTML('beforeend', `<button class="floating-timer" id="floating-timer"><span class="floating-timer-dot"></span><span class="floating-timer-name">${esc(cat?.name || '专注中')}</span><span class="floating-timer-time">${clock(value)}</span></button>`);
    $('#floating-timer').addEventListener('click', () => go('focus'));
  }
  update();
  floatingTick = setInterval(update, 1000);
}

// ---- 全屏沉浸：计时中且在专注页且未手动最小化时，body 加 focus-fullscreen 由 CSS 隐藏全局 header/底部导航（不动其渲染逻辑）----
function syncImmersiveBody() {
  const fullscreen = Boolean(state.timer.running && state.route === 'focus' && !immersiveDismissed);
  const wasFullscreen = document.body.classList.contains('focus-fullscreen');
  let entryFrom = null;
  if (fullscreen && !wasFullscreen) {
    const ring = $('.timer-ring');
    const card = $('.timer-card');
    entryFrom = { ring: ring ? { w: ring.offsetWidth, h: ring.offsetHeight } : null, card: card ? parseFloat(getComputedStyle(card).opacity) : null };
  }
  document.body.classList.toggle('focus-fullscreen', fullscreen);
  if (fullscreen && !wasFullscreen) {
    applyTimerOrientation();
  } else if (!fullscreen && wasFullscreen) {
    restoreTimerOrientation();
  }
  if (fullscreen && !wasFullscreen && !prefersReducedMotion && !Capacitor.isNativePlatform() && entryFrom) {
    // 进入全屏过渡：元素在 render 同一任务重建，CSS transition 不会触发，用 WAAPI 一次性动画
    const ring = $('.timer-ring');
    if (ring && entryFrom.ring) {
      ring.animate([
        { width: entryFrom.ring.w + 'px', height: entryFrom.ring.h + 'px' },
        { width: ring.offsetWidth + 'px', height: ring.offsetHeight + 'px' }
      ], { duration: TOKEN_DUR, easing: TOKEN_EASE });
    }
    const card = $('.timer-card');
    if (card) card.animate([{ opacity: entryFrom.card ?? 0 }, { opacity: 1 }], { duration: TOKEN_DUR, easing: 'ease' });
  }
  if (!fullscreen) {
    stopIdleWatch();
    if (pureCountdownActive) {
      pureCountdownActive = false;
      document.body.classList.remove('focus-pure');
    }
  } else {
    startIdleWatch();
  }
}

// ---- 沉浸态屏幕方向：进入全屏按设置生效，退出恢复竖屏（依赖核心平台 helper，浏览器端返回 false 无副作用）----
const ORIENTATION_CYCLE = ['auto', 'landscape', 'portrait'];
const ORIENTATION_ICONS = { auto: 'screen_rotation', portrait: 'stay_current_portrait', landscape: 'stay_current_landscape' };
const ORIENTATION_TOAST = { auto: '自动跟随手机', portrait: '已切换竖屏', landscape: '已切换横屏' };

function orientationIcon(mode) {
  return ORIENTATION_ICONS[mode] || ORIENTATION_ICONS.auto;
}

function orientationToast(mode) {
  return ORIENTATION_TOAST[mode] || ORIENTATION_TOAST.auto;
}

function nextOrientationMode(current) {
  return ORIENTATION_CYCLE[(ORIENTATION_CYCLE.indexOf(current) + 1) % ORIENTATION_CYCLE.length] || 'auto';
}

function applyTimerOrientation() {
  callHelper('setTimerOrientation', state.settings.timerOrientation || 'auto');
}

function restoreTimerOrientation() {
  callHelper('restoreTimerOrientation');
}

function setOrientationMode(mode) {
  state.settings.timerOrientation = mode;
  applyTimerOrientation();
  save().catch(error => show(error.message));
  const btn = $('#orientation-toggle');
  if (btn) {
    btn.querySelector('.material-symbols-outlined').textContent = orientationIcon(mode);
    btn.dataset.mode = mode;
    btn.setAttribute('aria-label', orientationToast(mode));
  }
  show(Capacitor.isNativePlatform() ? orientationToast(mode) : '方向切换仅真机生效');
}

// ---- 无操作自动进入纯倒计时（大字屏保浮层）：计时中无触摸超时后进入；任意触摸恢复并重置计时器 ----
function enterPureCountdown() {
  if (!state.timer.running || state.route !== 'focus' || immersiveDismissed) return;
  pureCountdownActive = true;
  document.body.classList.add('focus-pure');
}

function startIdleWatch() {
  if (idleTimer) return;
  idleTimer = setTimeout(() => { idleTimer = null; enterPureCountdown(); }, PURE_COUNTDOWN_IDLE_MS);
}

function stopIdleWatch() {
  clearTimeout(idleTimer);
  idleTimer = null;
}

function onIdleInteraction() {
  if (!state.timer.running || immersiveDismissed) return;
  if (pureCountdownActive) {
    pureCountdownActive = false;
    document.body.classList.remove('focus-pure');
  }
  stopIdleWatch();
  startIdleWatch();
}

document.addEventListener('pointerdown', onIdleInteraction, { passive: true });
document.addEventListener('touchstart', onIdleInteraction, { passive: true });

// ---- 翻页数字（纯倒计时）：每个数字上下两半卡片，值变化时上半 3D 翻转落下、下半同步换新；仅显示值变化时触发动画 ----
function updateFlipClock(seconds) {
  const clockEl = $('#flip-clock');
  if (!clockEl) return;
  const text = clock(seconds);
  clockEl.classList.toggle('with-hours', text.length > 5);
  const cells = [...clockEl.children];
  const target = [...text].map(ch => ch === ':' ? null : ch);
  if (cells.length !== target.length) {
    clockEl.innerHTML = target.map(ch => ch === null ? '<span class="flip-colon">:</span>' : `<span class="flip-digit" data-digit="${ch}"><span class="flip-card-top">${ch}</span><span class="flip-ghost-top">${ch}</span><span class="flip-card-bottom">${ch}</span></span>`).join('');
    return;
  }
  cells.forEach((cell, index) => {
    const ch = target[index];
    if (ch === null) return;
    if (cell.dataset.digit === ch) return;
    cell.dataset.digit = ch;
    const cardTop = cell.querySelector('.flip-card-top');
    const ghostTop = cell.querySelector('.flip-ghost-top');
    const cardBottom = cell.querySelector('.flip-card-bottom');
    ghostTop.textContent = ch;
    cardBottom.textContent = ch;
    if (!document.body.classList.contains('focus-pure') || prefersReducedMotion) { cardTop.textContent = ch; return; }
    cell.classList.remove('flipping');
    void cell.offsetWidth;
    cell.classList.add('flipping');
    clearTimeout(cell._flipTimer);
    cell._flipTimer = setTimeout(() => {
      cardTop.textContent = ch;
      cell.classList.remove('flipping');
    }, 340);
  });
}

function formatFocusReportDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const restSeconds = total % 60;
  if (hours) return `${hours}小时${minutes ? ` ${minutes}分钟` : ''}`;
  if (minutes) return `${minutes}分钟${restSeconds ? ` ${restSeconds}秒` : ''}`;
  return `${restSeconds}秒`;
}

function focusReportHeader() {
  return subpageHeader('单次专注复盘报告', { action: { id: 'focus-share-unavailable', html: '<span class="material-symbols-outlined">share</span><small>暂不可用</small>' } });
}

function markFocusReportContext(sourceEntry, sessionId = '') {
  const layer = $('#subpage-focus-detail');
  if (!layer) return;
  layer.dataset.reportSource = sourceEntry;
  layer.dataset.sessionId = sessionId;
  const share = $('#focus-share-unavailable');
  if (share) {
    share.disabled = true;
    share.setAttribute('aria-label', '分享暂不可用');
    share.title = '分享能力需要核心平台接线';
  }
}

function preserveFocusScrollOnReportReturn(scrollTop) {
  const layer = $('#subpage-focus-detail');
  if (!layer) return;
  focusReportReturnObserver?.disconnect();
  focusReportReturnObserver = new MutationObserver(() => {
    if (layer.classList.contains('active')) return;
    focusReportReturnObserver?.disconnect();
    focusReportReturnObserver = null;
    requestAnimationFrame(() => {
      const app = $('#app');
      if (app) app.scrollTop = scrollTop;
    });
  });
  focusReportReturnObserver.observe(layer, { attributes: true, attributeFilter: ['class'] });
}

// ---- 专注复盘报告：只读取真实 FocusSession，不补造阶段或 AI 点评 ----
function focusDetailReport(sessionId = '', sourceEntry = sessionId ? 'completed' : 'latest') {
  const returnScrollTop = $('#app')?.scrollTop || 0;
  const sessions = [...(state.sessions || [])].sort((a, b) => Number(b.endedAt || b.startedAt || 0) - Number(a.endedAt || a.startedAt || 0));
  const session = sessionId ? sessions.find(item => item.id === sessionId) : sessions[0];
  const header = focusReportHeader();
  if (!session) {
    callHelper('openSubpage', 'subpage-focus-detail', header + `<div class="subpage-body focus-report-empty"><span class="material-symbols-outlined" aria-hidden="true">hourglass_empty</span><h2>还没有可复盘的专注</h2><p>完成至少 1 分钟的专注后，这里会展示真实的心流记录。</p></div>`);
    markFocusReportContext('empty');
    preserveFocusScrollOnReportReturn(returnScrollTop);
    return;
  }
  const pad = value => String(value).padStart(2, '0');
  const formatTime = value => {
    const time = new Date(Number(value));
    return Number.isNaN(time.getTime()) ? '--:--' : `${pad(time.getHours())}:${pad(time.getMinutes())}`;
  };
  const date = new Date(`${session.date || dateKey()}T12:00:00`);
  const dateLabel = Number.isNaN(date.getTime()) ? session.date || '未记录日期' : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  const modeLabel = { pomo: '番茄钟模式', countdown: '倒计时模式', stopwatch: '正向秒表模式' }[session.mode] || '专注计时模式';
  const rawCategory = String(session.category || '').trim();
  const category = rawCategory && !['work', 'study', 'focus'].includes(rawCategory)
    ? rawCategory
    : categoryName(session.categoryId || session.projectId);
  const project = session.projectId ? categoryName(session.projectId) : '';
  const contextLabel = [...new Set([category, project].filter(Boolean))].join(' / ');
  const task = session.task || '未填写具体任务';
  const sounds = Array.isArray(session.ambientSoundsUsed) ? session.ambientSoundsUsed.filter(sound => Number(sound?.volume) > 0) : [];
  const soundLabel = sounds.length
    ? sounds.map(sound => `${mixSoundLabel(sound.soundId)} ${Math.round((Number(sound.volume) || 0) * 100)}%`).join(' · ')
    : '未使用环境音';
  const durationSeconds = Math.max(0, Number(session.durationSeconds) || Number(session.minutes || 0) * 60);
  const formattedDuration = formatFocusReportDuration(durationSeconds);
  const flowScore = Number.isFinite(Number(session.flowScore)) ? Math.round(Number(session.flowScore)) : callHelper('calculateFlowScore', session);
  const timeRange = `${formatTime(session.startedAt)} - ${formatTime(session.endedAt)}`;
  const cachedCoach = focusCoachCache.get(session.id);
  const hasAiKey = Boolean(state.settings.aiApiKey);
  const coachButtonLabel = cachedCoach ? '已生成点评' : hasAiKey ? '生成 AI 点评' : '配置 AI 后生成点评';
  const coachResult = cachedCoach
    ? `<p class="focus-coach-result success">${esc(cachedCoach)}</p>`
    : '<p class="focus-coach-result idle">点击按钮后生成本次专注点评。</p>';
  const html = header + `<div class="subpage-body focus-report-body"><div class="focus-report-hero"><span class="focus-report-badge">DEEP FLOW SESSION</span><h2>${esc(formattedDuration)} · ${esc(contextLabel)}</h2><p class="focus-report-task">${esc(task)}</p><small>${esc(dateLabel)} · ${timeRange} · ${esc(modeLabel)}</small><div class="focus-report-kpis"><div class="focus-report-kpi primary"><b>${flowScore} 分</b><small>心流指数</small></div><div class="focus-report-kpi"><b>${Math.max(0, Number(session.interruptionsCount) || 0)} 次</b><small>屏幕跳出</small></div><div class="focus-report-kpi"><b>${esc(formattedDuration)}</b><small>实际专注</small></div></div></div><div class="focus-report-card"><h3>心流专注轨迹与时间线</h3><div class="focus-timeline"><div class="focus-timeline-row"><span class="focus-timeline-tag sage">${timeRange}</span><div><strong>完整专注会话 · ${esc(task)}</strong><small>${esc(contextLabel)} · 环境音：${esc(soundLabel)}</small></div></div></div></div><div class="focus-report-coach"><div class="focus-coach-head"><span class="material-symbols-outlined" aria-hidden="true">psychology</span><span>AI 专注教练智能点评</span></div><div id="focus-coach-result">${coachResult}</div><button type="button" id="generate-focus-coach" ${cachedCoach ? 'disabled' : ''}>${coachButtonLabel}</button><p class="focus-coach-privacy">点击后仅发送本次专注的时长、模式、中断和心流指标，不发送任务内容。</p></div></div>`;
  callHelper('openSubpage', 'subpage-focus-detail', html);
  markFocusReportContext(sourceEntry, session.id);
  preserveFocusScrollOnReportReturn(returnScrollTop);
  bindFocusCoach(session);
}

function focusCoachPayload(session) {
  const ambientTrackCount = Array.isArray(session.ambientSoundsUsed) ? session.ambientSoundsUsed.length : 0;
  return {
    mode: session.mode,
    durationSeconds: Number(session.durationSeconds) || 0,
    targetDurationSeconds: Number(session.targetDurationSeconds) || 0,
    interruptionsCount: Number(session.interruptionsCount) || 0,
    flowScore: Number(session.flowScore) || 0,
    ambientSoundsUsed: Array.from({ length: ambientTrackCount }, () => ({}))
  };
}

function bindFocusCoach(session) {
  const button = $('#generate-focus-coach');
  const result = $('#focus-coach-result');
  if (!button || !result) return;
  button.addEventListener('click', async () => {
    if (!state.settings.aiApiKey) {
      callHelper('aiSettingsForm');
      return;
    }
    const cached = focusCoachCache.get(session.id);
    if (cached) {
      result.innerHTML = `<p class="focus-coach-result success">${esc(cached)}</p>`;
      button.disabled = true;
      button.textContent = '已生成点评';
      return;
    }
    button.disabled = true;
    button.textContent = '正在生成点评…';
    result.innerHTML = '<p class="focus-coach-result loading">正在生成点评…</p>';
    try {
      const text = await callHelper('aiFocusCoach', focusCoachPayload(session));
      const coachText = String(text || '').trim();
      if (!coachText) throw new Error('AI 专注点评返回为空');
      focusCoachCache.set(session.id, coachText);
      result.innerHTML = `<p class="focus-coach-result success">${esc(coachText)}</p>`;
      button.textContent = '已生成点评';
    } catch (error) {
      result.innerHTML = `<p class="focus-coach-result error">生成失败：${esc(error?.message || '请稍后重试')}</p>`;
      button.disabled = false;
      button.textContent = '生成 AI 点评';
    }
  });
}

// ---- 白噪音混音台交互：每轨独立开关、音量与百分比 ----
function bindSoundMixer() {
  $$('[data-sound-toggle]').forEach(button => button.onclick = () => {
    const track = SOUND_TRACKS.find(item => item.id === button.dataset.soundToggle);
    if (!track) return;
    const active = currentAmbientMix().some(item => item.soundId === track.id);
    const slider = $(`[data-sound-volume="${track.id}"]`);
    const volume = Number(slider?.value || 50) / 100;
    const supported = setAmbientMixTrack(track.id, !active, volume);
    if (!supported) { show('当前设备不支持此环境音轨'); return; }
    if (!active) state.settings.ambientSound = 'none';
    save().catch(error => show(error.message));
    render();
  });
  $$('[data-sound-volume]').forEach(slider => {
    slider.oninput = () => {
      const volume = Number(slider.value) / 100;
      const soundId = slider.dataset.soundVolume;
      const updated = setAmbientMixVolume(soundId, volume) || (volume > 0 && setAmbientMixTrack(soundId, true, volume));
      const pct = slider.parentElement.querySelector('.sound-track-pct');
      if (pct) pct.textContent = volume > 0 ? `${Math.round(slider.value)}%` : '静音';
      if (updated) {
        slider.parentElement.classList.toggle('active', volume > 0);
        slider.parentElement.querySelector('.sound-track-toggle')?.setAttribute('aria-pressed', String(volume > 0));
      }
    };
  });
}

// ---- 绑定 ----
function bindFocus() {
  $('#focus-task-inline')?.addEventListener('change', async event => {
    if (focusHasProgress(state)) return;
    const previousTask = state.timer.task, previousIntent = state.settings.focusIntent;
    state.timer.task = event.target.value.trim(); state.settings.focusIntent = null;
    try { await save(); } catch (error) { state.timer.task = previousTask; state.settings.focusIntent = previousIntent; show(error.message); }
  });
  $$('[data-focus-quick-start]').forEach(button => button.onclick = () => startDailyFocus({ ...(state.settings.focusIntent || {}), minutes: Number(button.dataset.focusQuickStart) }).catch(error => show(error.message)));
  $$('[data-focus-pick-todo]').forEach(button => button.onclick = () => startDailyFocus({ todoId: button.dataset.focusPickTodo, minutes: 25 }).catch(error => show(error.message)));

  $('#play')?.addEventListener('click', () => (state.timer.running ? pauseTimer() : startTimer()).catch(error => show(error.message)));
  $('#reset')?.addEventListener('click', () => state.timer.running ? abandonTimer() : resetTimer());
  $('#finish')?.addEventListener('click', () => completeTimer(false).catch(error => show(error.message)));
  $('#exit-immersive')?.addEventListener('click', () => { immersiveDismissed = true; syncImmersiveBody(); });
  $('#orientation-toggle')?.addEventListener('click', () => setOrientationMode(nextOrientationMode(state.settings.timerOrientation || 'auto')));
  $('#screensaver-trigger')?.addEventListener('click', enterPureCountdown);
  $('#focus-report-open')?.addEventListener('click', () => focusDetailReport('', 'manual'));
  $('#focus-settings-open')?.addEventListener('click', timerSettingsForm);
  $('#category-change')?.addEventListener('click', categoryPicker);
  $('#manage-categories')?.addEventListener('click', categoryManager);
  $('#task-change')?.addEventListener('click', taskForm);
  $('#ambient-change')?.addEventListener('click', ambientPicker);
  $('#custom-duration')?.addEventListener('click', customDurationForm);
  $$('[data-timer-mode]').forEach(button => button.onclick = () => setTimerMode(button.dataset.timerMode));
  $$('[data-duration]').forEach(button => button.onclick = async () => { const seconds = Number(button.dataset.duration) * 60; state.timer.duration = seconds; state.timer.left = seconds; await save(); render(); });
  $$('[data-recent-category]').forEach(button => button.onclick = async () => { if (state.timer.running) return; state.timer.projectId = button.dataset.recentCategory; await save(); await startTimer(); });
  $$('[data-focus-preference]').forEach(button => button.onclick = async () => {
    const key = button.dataset.focusPreference;
    if (!['notificationsEnabled', 'pomodoroAutoStart'].includes(key)) return;
    state.settings[key] = !state.settings[key];
    await save();
    render();
  });
  bindSoundMixer();
}

// ---- 表单提交 ----
registerSubmitHandler('timer-settings-form', async data => {
  state.settings.defaultDurationMinutes = Number(data.get('duration'));
  // 专注↔习惯联动：只允许选按分钟计量的数量型习惯，避免选了记不进去的假联动。
  const linkedId = data.get('focusLinkedHabit');
  const linkable = (state.habits || []).some(habit => habit.id === linkedId && !habit.archived && habit.tracking === 'quantity' && /分钟/.test(habit.unit || ''));
  state.settings.focusLinkedHabitId = linkable ? linkedId : '';
  state.settings.pomodoroFocusMinutes = Number(data.get('pomodoroFocus'));
  state.settings.pomodoroShortBreakMinutes = Number(data.get('pomodoroShort'));
  state.settings.pomodoroLongBreakMinutes = Number(data.get('pomodoroLong'));
  state.settings.pomodoroRounds = Number(data.get('pomodoroRounds'));
  state.settings.pomodoroAutoStart = data.get('autoStart') === 'on';
  state.settings.notificationsEnabled = data.get('notifications') === 'on';
  const orientation = data.get('orientation');
  if (ORIENTATION_CYCLE.includes(orientation)) state.settings.timerOrientation = orientation;
  if (!state.timer.running) {
    state.timer.duration = state.timer.mode === 'pomodoro' ? pomodoroPhaseSeconds(state.settings, state.timer.phase) : state.settings.defaultDurationMinutes * 60;
    state.timer.left = state.timer.duration;
    state.timer.round = Math.min(state.timer.round, state.settings.pomodoroRounds);
  }
});

registerSubmitHandler('task-form', async data => {
  state.timer.task = data.get('task').trim();
});

registerSubmitHandler('category-form', async data => {
  const existing = state.focusCategories.find(category => category.id === data.get('id'));
  const next = makeFocusCategory({ ...existing, id: existing?.id || uid(), name: data.get('name'), parentId: data.get('parentId'), icon: data.get('icon'), color: data.get('color'), sortOrder: existing?.sortOrder || 0, createdAt: existing?.createdAt });
  existing ? Object.assign(existing, next) : state.focusCategories.push(next);
  if (state.timer.projectId && !focusCategories().some(category => category.id === state.timer.projectId)) state.timer.projectId = next.id;
});

registerSubmitHandler('duration-form', async data => {
  const seconds = Number(data.get('hours')) * 3600 + Number(data.get('minutes')) * 60 + Number(data.get('seconds'));
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86399) throw new Error('请设置 1 秒到 23:59:59 之间的时长');
  state.timer.duration = seconds; state.timer.left = seconds;
});

// ---- 注册 ----
registerView('focus', focusView);
registerBinder(bindFocus);
registerOnRender(syncTimer);
registerOnRender(syncFloatingIndicator);
registerOnRender(syncImmersiveBody);
registerHelper('startTimer', startTimer);
registerHelper('pauseTimer', pauseTimer);
registerHelper('resetTimer', resetTimer);
registerHelper('completeTimer', completeTimer);
registerHelper('abandonTimer', abandonTimer);
registerHelper('projectSessionHistory', projectSessionHistory);
registerHelper('replaceSessionHabitContribution', replaceSessionHabitContribution);
registerHelper('currentElapsed', currentElapsed);
registerHelper('currentLeft', currentLeft);
registerHelper('timerSettingsForm', timerSettingsForm);
registerHelper('focusCategoryOptions', focusCategoryOptions);
registerVisibilityChangeTracking();

registerHelper('startFocusForTodo', id => startDailyFocus({ todoId: id, minutes: 25 }));
registerHelper('startFocusForHabit', id => startDailyFocus({ habitId: id, minutes: 10 }));
