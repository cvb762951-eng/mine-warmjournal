import { initializeStorage, persistState, blockStorageWrites } from './storage.js';
import { APP_VERSION_NAME } from './app-updater.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { $, $$, state, cursor, selected, setState, setCursor, setSelected, defaults, render, go, goBack, save, show, confirmDelete, closeModal, getSubmitHandler, registerBinder, registerHelper, registerOnRender, callHelper, pushBackState } from './core.js';
import { installPressFeedback } from './motion.js';
import { migrateState, dateKey } from './model.js';
import { externalizeStateMedia } from './media-store.js';
import { rebuildActivityLog } from './activity-log.js';
import { ensureReleaseActivities } from './release-activity.js';
import { initializeNotificationChannel, prepareNotifications, scheduleDailyReminders, restoreRandomReminders, onNotificationAction, isTimerAlarmRinging } from './notifications.js';
import './orientation.js';
import './voice.js';
import './daily-summary.js';
import './weather.js';

// ---- 模块加载（触发各模块的 view/binder/submit/helper 注册）----
import './views/countdown.js';
import './views/timetable.js';
import './views/today.js';
import './views/habits.js';
import './views/snippets.js';
import './views/media.js';
import './views/journal.js';
import './views/calendar.js';
import './views/stats.js';
import './views/focus.js';
import './views/mine.js';
import './views/ai.js';
import './views/documents.js';
import './views/private-vault.js';
import './views/incoming-share.js';
import './views/password-vault.js';
import './views/ledger.js';
import './views/taste.js';
import './views/local-gallery.js';

// ---- 跨模块函数（供全局事件委托 / boot 使用）----
import { habitForm, setHabitRestDay, todoForm, habitLogForm } from './views/habits.js';
import { snippetForm } from './views/snippets.js';
import { journalForm } from './views/journal.js';
import { sessionForm } from './views/calendar.js';
import { mediaForm } from './views/media.js';
import { syncCountdownWidget } from './views/countdown.js';
import { completeTimer, completionAlarmModal } from './views/focus.js';
import { photoViewer } from './views/common.js';
import { recoverJournalDraftCache } from './journal-drafts.js';

// ---- 本地状态（boot 协调用）----
let booted = false;
let pendingJournalReminder = false;
let pendingPhotoReminder = false;
let pendingIncomingShare = false;
const SystemBack = registerPlugin('SystemBack');

// 岗位④在 AI 聊天态切换的当下调用；AI tab 的内部状态仍由其公开 helper 独占。
function syncAiChatChrome(active) {
  const requestedActive = typeof active === 'boolean'
    ? active
    : Boolean(callHelper('isAiChatActive'));
  // AI 模块可保留聊天态；一旦离开 AI 路由，全局 chrome 必须立即恢复。
  const isActive = state.route === 'ai' && requestedActive;
  document.body.classList.toggle('ai-chat-active', isActive);
  SystemBack.setAiChatActive({ active: isActive }).catch(() => {});
  return isActive;
}
registerHelper('syncAiChatChrome', syncAiChatChrome);
// 弹窗/二级页共用同一原生返回消费状态；AI 聊天仍由 syncAiChatChrome 独立维护。
function syncSystemBackConsumption() {
  const active = Boolean(callHelper('isModalOpen')) || Boolean(callHelper('isSubpageOpen')) || Boolean(callHelper('isAiChatActive')) || Boolean(callHelper('canGoBack'));
  Promise.resolve(SystemBack.setSubpageActive?.({ active })).catch(() => {});
  return active;
}
registerHelper('syncSystemBackConsumption', syncSystemBackConsumption);
registerHelper('setVideoGestureExclusion', active => {
  if (!Capacitor.isNativePlatform()) return;
  Promise.resolve(SystemBack.setVideoGestureExclusion?.({ active: Boolean(active) })).catch(() => {});
});
// 兜底：任何全局 render 后都重新校准 AI 聊天页 chrome。
registerOnRender(() => syncAiChatChrome());
window.addEventListener('mine-system-back', () => {
  if (!booted) return;
  if (callHelper('isIncomingShareOpen')) { callHelper('cancelIncomingShare'); return; }
  if (callHelper('isModalOpen')) {
    closeModal();
    return;
  }
  if (callHelper('closeSubpage')) return;
  if (callHelper('returnToAiOverview')) { syncAiChatChrome(); return; }
  goBack();
});

// ---- 全局页面导航绑定 ----
function bindNavigation() {
  $('[data-route="mine"]', $('#app-header'))?.addEventListener('click', () => go('mine'));
  $('#open-countdown-mine')?.addEventListener('click', () => { pushBackState(); go('countdown'); });
  $('#open-snippets-mine')?.addEventListener('click', () => { pushBackState(); go('snippets'); });
  $('#open-library')?.addEventListener('click', () => { pushBackState(); go('library'); });
  $('#open-ai-mine')?.addEventListener('click', () => go('ai'));
  $('#countdown-back')?.addEventListener('click', goBack);
  $('#snippets-back')?.addEventListener('click', goBack);
  $('#library-back')?.addEventListener('click', goBack);
  $('#documents-back')?.addEventListener('click', goBack);
}
registerBinder(bindNavigation);

// ---- 日历事件路由（按事件类型分发到各模块表单）----
function openCalendarEvent(id) {
  const item = rebuildActivityLog(state).find(event => event.id === id);
  if (!item) return;
  if (item.kind === 'focus') return sessionForm(state.sessions.find(session => session.id === item.sourceId));
  if (item.kind === 'journal') return journalForm(item.sourceId);
  if (item.kind === 'photo') {
    const snippet = state.snippets.find(entry => entry.type === 'photo' && entry.id === item.sourceId);
    const photos = snippet?.photos?.length ? snippet.photos : (snippet?.photo ? [snippet.photo] : []);
    if (snippet?.videos?.length) return callHelper('playSnippetVideo', snippet.videos[0], snippet, 0);
    return photoViewer(photos, 0);
  }
  if (item.kind === 'note') return snippetForm(state.snippets.find(entry => entry.id === item.sourceId));
  if (item.kind === 'todo') return todoForm(state.todos.find(todo => todo.id === item.sourceId));
  if (['book', 'movie'].includes(item.kind)) return mediaForm(state.media.find(entry => entry.id === item.sourceId));
  if (item.kind === 'taste') return callHelper('openTasteEntry', item.sourceId);
  const habit = state.habits.find(entry => entry.id === item.sourceId);
  if (habit) habitLogForm(habit);
}
registerHelper('openCalendarEvent', openCalendarEvent);
registerHelper('getSelected', () => selected);

// ---- 全局事件委托 ----
document.addEventListener('click', event => {
  if (event.target.closest('[data-close]')) closeModal();
  if (event.target.id === 'modal-layer' && !$('.alarm-modal')) { if (callHelper('isIncomingShareOpen')) callHelper('cancelIncomingShare'); else closeModal(); }
  const editHabit = event.target.closest('[data-edit-habit]');
  if (editHabit) habitForm(state.habits.find(habit => habit.id === editHabit.dataset.editHabit));
  const unskipHabit = event.target.closest('[data-unskip-habit]');
  if (unskipHabit) setHabitRestDay(unskipHabit.dataset.unskipHabit, false);
  if (event.target.closest('#new-habit')) habitForm();
  const editTodo = event.target.closest('[data-edit-todo]');
  if (editTodo) todoForm(state.todos.find(todo => todo.id === editTodo.dataset.editTodo));
  if (event.target.closest('#new-todo-modal')) todoForm();
  const openJournal = event.target.closest('[data-open-journal]');
  if (openJournal) { const day = openJournal.dataset.openJournal; closeModal(); go('calendar', day); }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('#modal-layer').classList.contains('open') && !$('.alarm-modal')) { if (callHelper('isIncomingShareOpen')) callHelper('cancelIncomingShare'); else closeModal(); }
});

document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  const formId = form.getAttribute('id') || '';
  const data = new FormData(form);
  const handler = getSubmitHandler(formId);
  if (!handler) return;
  try {
    const handled = await handler(data, form);
    if (handled !== false) {
      await save();
      closeModal(); render(); show('已保存');
    }
  } catch (error) {
    show(error.message);
  }
});

document.addEventListener('click', event => {
  if (event.target.closest('#delete-habit')) {
    const id = new FormData($('#habit-form')).get('id');
    confirmDelete('删除这个习惯？历史打卡会保留在数据中。', async () => { const habit = state.habits.find(item => item.id === id); if (habit) habit.archived = true; await save(); render(); });
  }
  if (event.target.closest('#delete-todo')) {
    const id = new FormData($('#todo-form')).get('id');
    confirmDelete('删除这条待办？', async () => { state.todos = state.todos.filter(todo => todo.id !== id); await save(); render(); });
  }
});

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && await isTimerAlarmRinging().catch(() => false)) completionAlarmModal('计时');
});

/* 主题自检（2026-10-10）
 *
 * 清简主题靠 themes-plain.css 把原始主题的图片素材整体撤掉。
 * 万一这个文件没能到位（热更新下载中断、缓存半新半旧），页面就会出现
 * 「一部分界面变回旧样子」—— 用户报的「用着用着有一部分切回原始素材」。
 *
 * 做法：渲染完验一次。选了清简、却仍能看到 `#app` 上的原始纸纹图，就自动重载一次。
 * 只重重载一次（sessionStorage 打时间戳防死循环）；重载后仍不对就安静放弃 ——
 * 宁可看到旧界面，也绝不白屏或动数据。
 */
function healPlainTheme(theme) {
  if (theme !== 'plain') return;
  const app = document.querySelector('#app');
  if (!app) return;
  let paperTexture = '';
  try {
    paperTexture = getComputedStyle(app).backgroundImage || '';
  } catch {
    return;
  }
  // 清简下这里应该是 none；还带着 assets/ 的图就说明撤图样式没生效
  if (!paperTexture || paperTexture === 'none' || !paperTexture.includes('assets/')) return;
  const KEY = 'mine-plain-theme-heal';
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last < 60000) return; // 一分钟内只自救一次
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return;
  }
  console.warn('清简主题样式未生效，自动重载一次');
  location.reload();
}

async function boot() {
  globalThis.__warmAppBootStarted = true;
  // 全局按压物理：一次挂载，之后新渲染出来的按钮自动生效（事件委托）
  installPressFeedback();
  let autoSummaryLaunch = false;
  try {
    // 在任何 UI/通知初始化前识别凌晨静默唤醒，避免改变用户正常启动流程。
    autoSummaryLaunch = Boolean(await callHelper('isAutoSummaryLaunch'));
    setState(await initializeStorage(defaults));
    recoverJournalDraftCache(state);
    // 版本更新动态：升级后首次启动，把错过的版本说明写进当天活动（幂等，见 release-activity.js）。
    ensureReleaseActivities(state);
    await callHelper('scheduleAutoSummary');
    callHelper('setAiHistory', [...(state.aiHistory || [])]);
    const migratedMedia = await externalizeStateMedia(state);
    // 浏览器媒体外置后用短引用覆盖 localStorage；Android 重复持久化由分区差异检查跳过。
    if (await persistState(state) === false) throw new Error('密钥加密失败，启动数据尚未保存');
    booted = true;
    if (autoSummaryLaunch) {
      try {
        // 岗位④负责前一天/周一上一完整自然周的生成与补生成判断；失败不伪造成功。
        await callHelper('generateAutoSummary');
      } catch (error) {
        console.warn('每日小结静默生成失败', error);
      } finally {
        await callHelper('finishAutoSummary');
      }
      return;
    }
    // 每次打开默认今日页（仅影响本次打开，之后手动切页不受影响）。
    state.route = 'today';
    await initializeNotificationChannel().catch(console.warn);
    prepareNotifications().catch(() => {});
    if (state.settings.dailyReminders.length) {
      scheduleDailyReminders(state.settings.dailyReminders, state.settings.reminderAiCopy).catch(() => {});
    }
    restoreRandomReminders().catch(() => {});
    syncCountdownWidget();
    if (state.timer.running && state.timer.mode !== 'stopwatch' && state.timer.endAt <= Date.now()) await completeTimer(true);
    else {
      render();
      healPlainTheme(state.settings?.theme);
      if (await isTimerAlarmRinging().catch(() => false)) completionAlarmModal('计时');
    }
    if (pendingIncomingShare || Capacitor.isNativePlatform()) {
      pendingIncomingShare = false;
      setTimeout(() => callHelper('checkIncomingShare'), 120);
    }
    if (pendingPhotoReminder) {
      pendingPhotoReminder = false;
      setTimeout(() => snippetForm(null, 'photo', true), 300);
    }
    if (pendingJournalReminder) {
      pendingJournalReminder = false;
      setTimeout(() => journalForm(dateKey()), 300);
    }
  } catch (error) {
    booted = false;
    blockStorageWrites();
    console.error(error);
    if (autoSummaryLaunch) {
      // 静默任务即使初始化或网络失败也必须结束；岗位④可在下次启动/进入 AI 时补生成。
      await callHelper('finishAutoSummary').catch(() => {});
      return;
    }
    // 不用空默认数据覆盖故障中的真实状态，也不开放可能写回空库的页面。
    $('#app').innerHTML = '<div class="empty-state"><strong>本机数据暂时无法打开</strong><p>为保护已有记录，已停止加载和保存。请重新打开 App 再试。</p><button type="button" id="retry-storage">重新打开</button></div>';
    $('#floating-dock').innerHTML = '';
    $('#retry-storage').onclick = () => location.reload();
    show(`数据库初始化失败：${error.message}`);
  }
}

boot();

/* 中文兜底字体（Noto SC 三份共约 8MB）不参与首屏。
   实测：让它们在首屏加载与解析，会把「第一帧出现内容」推迟约 176ms ——
   也就是「打开 App 先卡一下」里可量化的那一段。
   它们只是霞鹜文楷缺字时的兜底，晚几百毫秒到位不影响观感；
   所以等第一帧画完再挂载（双 rAF 跨过首帧，再排到下一个任务）。 */
function loadFallbackFonts() {
  if (document.querySelector('link[data-fallback-fonts]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.dataset.fallbackFonts = '1';
  link.href = `fonts-fallback.css?v=${APP_VERSION_NAME}`;
  document.head.appendChild(link);
}
requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(loadFallbackFonts, 0)));

window.addEventListener('mine-incoming-share', () => {
  if (booted) setTimeout(() => callHelper('checkIncomingShare'), 80);
  else pendingIncomingShare = true;
});

onNotificationAction(route => {
  if (route === 'snippet-photo') {
    if (booted) snippetForm(null, 'photo', true);
    else pendingPhotoReminder = true;
    return;
  }
  if (route !== 'journal') return;
  if (booted) journalForm(dateKey());
  else pendingJournalReminder = true;
});
