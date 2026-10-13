import { initializeStorage, persistState, blockStorageWrites } from './storage.js';
import { APP_VERSION_NAME } from './app-updater.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { $, $$, state, cursor, selected, setState, setCursor, setSelected, defaults, render, go, goBack, save, show, confirmDelete, closeModal, getSubmitHandler, registerBinder, registerHelper, registerOnRender, callHelper, pushBackState, applyTheme, primeThemeFromNativeMirror, notifyPersistedKeySeal } from './core.js';
import { installPressFeedback, installMagneticDock } from './motion.js';
import { migrateState, dateKey } from './model.js';
import { externalizeStateMedia } from './media-store.js';
import { rebuildActivityLog } from './activity-log.js';
import { openReleaseNotes } from './views/common.js';
import { ensureReleaseActivities } from './release-activity.js';
import { initializeNotificationChannel, syncScheduledReminders, onNotificationAction, isTimerAlarmRinging } from './notifications.js';
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
let pendingCountdownReminder = false;
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
  const active = Boolean(callHelper('isModalOpen')) || Boolean(callHelper('isMomentAlbumOpen')) || Boolean(callHelper('isSubpageOpen')) || Boolean(callHelper('isAiChatActive')) || Boolean(callHelper('canGoBack'));
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
  if (callHelper('isMomentAlbumOpen')) { callHelper('closeMomentAlbum'); return; }
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
  if (item.kind === 'release') return openReleaseNotes(item.sourceId);
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
  // 过往篇章 / 日记历史都用 data-open-journal。这里若再跳日历，会盖掉阅读页和编辑页。
  // 按钮自己的处理会 preventDefault；没拦住时由这里打开阅读或编辑，而不是日历。
  if (openJournal && !event.defaultPrevented) {
    event.preventDefault();
    closeModal();
    callHelper('openPastJournal', openJournal.dataset.openJournal);
  }
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
      closeModal(); render(); show(typeof handled === 'string' && handled ? handled : '已保存');
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
  if (document.visibilityState !== 'visible') return;
  if (booted) {
    syncScheduledReminders({ requestPermission: false })
      .catch(error => console.warn('回到前台时没有续上提醒', error))
      .finally(() => window.dispatchEvent(new Event('reminders:synced')));
  }
  if (await isTimerAlarmRinging().catch(() => false)) completionAlarmModal('计时');
});

/* 主题自检（2026-10-10；2026-10-11 不再整页重载）
 *
 * 清简主题靠 themes-plain.css 把原始主题的图片素材整体撤掉。
 * 万一这个文件没能到位（热更新下载中断、缓存半新半旧），页面就会出现
 * 「一部分界面变回旧样子」。
 *
 * 以前的做法是发现 `#app` 上还有 assets/ 纸纹就 location.reload()。
 * 重载会把「先暖色纸、再清简」再播一遍，而且一分钟内只能救一次。
 * 现在改为把 data-theme 和样式表再拨正一次；样式表还在加载就等它。
 * 仍然不对才轻提示一句，不刷新、不动数据。
 */
function plainPaperStillShowing(node) {
  let paperTexture = '';
  try { paperTexture = getComputedStyle(node).backgroundImage || ''; }
  catch { return false; }
  return Boolean(paperTexture && paperTexture !== 'none' && paperTexture.includes('assets/'));
}

function healPlainTheme(theme) {
  if (theme !== 'plain') return;
  const app = document.querySelector('#app');
  if (!app || !plainPaperStillShowing(app)) return;
  document.documentElement?.setAttribute?.('data-theme', 'plain');
  const sheet = document.getElementById('plain-theme-sheet');
  if (sheet) {
    sheet.media = 'all';
    sheet.disabled = false;
  }
  applyTheme('plain');
  const hint = () => {
    if (!plainPaperStillShowing(app)) return;
    const KEY = 'mine-plain-theme-heal';
    let last = 0;
    try { last = Number(sessionStorage.getItem(KEY) || 0); }
    catch { return; }
    if (Date.now() - last < 60000) return;
    try { sessionStorage.setItem(KEY, String(Date.now())); }
    catch { return; }
    show('清简样式还没完全生效，界面可能暂时还带着纸纹');
  };
  // 等一帧，让刚启用的样式表参与级联，避免样式其实马上就到、却先弹出提示。
  const recheck = () => requestAnimationFrame(() => hint());
  let ready = true;
  try { ready = Boolean(sheet?.sheet); }
  catch { ready = true; }
  if (sheet && !ready) {
    let settled = false;
    const done = () => { if (settled) return; settled = true; recheck(); };
    sheet.addEventListener('load', done, { once: true });
    sheet.addEventListener('error', done, { once: true });
    setTimeout(done, 1200);
    return;
  }
  recheck();
}

async function boot() {
  globalThis.__warmAppBootStarted = true;
  // 全局按压物理：一次挂载，之后新渲染出来的按钮自动生效（事件委托）
  installPressFeedback();
  installMagneticDock();
  let autoSummaryLaunch = false;
  try {
    // 解析期没读到主题时，先用原生存储把清简/暖阳补上，避免数据库打开期间先露出暖色纸。
    await primeThemeFromNativeMirror();
    // 在任何 UI/通知初始化前识别凌晨静默唤醒，避免改变用户正常启动流程。
    autoSummaryLaunch = Boolean(await callHelper('isAutoSummaryLaunch'));
    setState(await initializeStorage(defaults));
    recoverJournalDraftCache(state);
    // 版本更新：说明仍整份入库；当天活动只钉刚升级到的这一版（见 release-activity.js）。
    ensureReleaseActivities(state);
    await callHelper('scheduleAutoSummary');
    callHelper('setAiHistory', [...(state.aiHistory || [])]);
    const migratedMedia = await externalizeStateMedia(state);
    // 浏览器媒体外置后用短引用覆盖 localStorage；Android 重复持久化由分区差异检查跳过。
    const persisted = await persistState(state);
    if (persisted === false) throw new Error('启动数据尚未保存。请重新打开 App 再试。');
    notifyPersistedKeySeal(persisted);
    booted = true;
    if (autoSummaryLaunch) {
      try {
        // 岗位④负责前一天/周一上一完整自然周的生成与补生成判断；失败不伪造成功。
        await callHelper('generateAutoSummary');
      } catch (error) {
        console.warn('每日小结静默生成失败', error);
      } finally {
        try {
          await syncScheduledReminders({ requestPermission: false });
        } catch (error) {
          console.warn('静默唤醒时没有续上提醒', error);
        }
        await callHelper('finishAutoSummary');
      }
      return;
    }
    // 每次打开默认今日页（仅影响本次打开，之后手动切页不受影响）。
    state.route = 'today';
    await initializeNotificationChannel().catch(console.warn);
    // 排闹钟不挡住第一帧。权限只在这一次启动里问一次，和页面渲染并行。
    syncScheduledReminders({ requestPermission: true }).then(result => {
      if (result?.lastError) console.warn('提醒排程', result.lastError);
    }).catch(error => console.warn('提醒没有排上', error))
      .finally(() => window.dispatchEvent(new Event('reminders:synced')));
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
    if (pendingCountdownReminder) {
      pendingCountdownReminder = false;
      setTimeout(() => go('countdown'), 300);
    }
  } catch (error) {
    booted = false;
    document.documentElement?.classList?.remove('theme-pending');
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
  if (route === 'countdown') {
    if (booted) go('countdown');
    else pendingCountdownReminder = true;
    return;
  }
  if (route !== 'journal') return;
  if (booted) journalForm(dateKey());
  else pendingJournalReminder = true;
});
