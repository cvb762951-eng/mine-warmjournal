import { $, $$, esc, uid, state, cursor, selected, save, render, modal, closeModal, show, confirmDelete, imgSrc, emptyState, go, formatMinutes, setSelected, setCursor, registerView, registerBinder, registerSubmitHandler, registerHelper, callHelper } from '../core.js';
import { WEEK_DAYS, dateKey, minutesOnDate, todayCompletion, habitsForDate, habitGoalMet, habitProgressForDate, MOODS, WEATHERS, formatShanghaiClock } from '../model.js';
import { activityForDate } from '../activity-log.js';
import { journalForm } from './journal.js';
import { monthDays, sessionCard, bindRecordActions, replaceSessionHabitContribution, photoViewer } from './common.js';
import { formatVideoDuration } from '../video-player.js';
import { photoFrameLayersHtml } from '../photo-frame.js';

// ---- 本地状态 ----
let summaryGenerating = false;    // AI 当日小结生成中

const money = value => Number(value || 0).toFixed(2);
const MONTH_EN = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const CALENDAR_EVENT_META = {
  focus: { icon: 'timer', tone: 'sage', label: '专注' },
  habit: { icon: 'check_circle', tone: 'sage', label: '习惯' },
  journal: { icon: 'menu_book', tone: 'terracotta', label: '日记' },
  note: { icon: 'edit_note', tone: 'terracotta', label: '随手记' },
  photo: { icon: 'photo_camera', tone: 'ochre', label: '随手拍' },
  todo: { icon: 'task_alt', tone: 'gold', label: '待办' },
  book: { icon: 'menu_book', tone: 'brown', label: '阅读' },
  movie: { icon: 'movie', tone: 'brown', label: '观影' },
  expense: { icon: 'receipt_long', tone: 'terracotta', label: '支出' },
  income: { icon: 'payments', tone: 'sage', label: '收入' },
  transfer: { icon: 'swap_horiz', tone: 'brown', label: '转账' },
  calibrate: { icon: 'balance', tone: 'gold', label: '校准' },
  taste: { icon: 'restaurant_menu', tone: 'ochre', label: '尝鲜' },
  release: { icon: 'new_releases', tone: 'sage', label: '更新' }
};

// 当天全部图片与视频保留真实类型；视频不再退化成一张无法播放的普通封面图。
function mediaForDay(day) {
  const media = [];
  const seen = new Set();
  const add = item => {
    const key = item.kind === 'video' ? `video:${item.video?.video}` : `photo:${item.source}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    media.push(item);
  };
  (state.snippets || [])
    .filter(item => item.type === 'photo' && item.date === day)
    .sort((a, b) => b.createdAt - a.createdAt)
    .forEach(entry => {
      const photos = entry.photos?.length ? entry.photos : (entry.photo ? [entry.photo] : []);
      photos.filter(Boolean).forEach(source => add({ kind: 'photo', source, motion: (entry.livePhotos || []).find(item => item.still === source)?.video || '', entryId: entry.id }));
      (entry.videos || []).filter(video => video?.video).forEach((video, index) => add({ kind: 'video', video, entryId: entry.id, index }));
    });
  (state.journals[day]?.photos || []).filter(Boolean).forEach(source => add({ kind: 'photo', source, motion: (state.journals[day]?.livePhotos || []).find(item => item.still === source)?.video || '', entryId: `journal:${day}` }));
  (state.tasteEntries || []).filter(entry => entry.date === day).forEach(entry => (entry.photos || []).forEach(source => add({ kind: 'photo', source, entryId: `taste:${entry.id}` })));
  return media;
}

function photosForDay(day) { return mediaForDay(day).filter(item => item.kind === 'photo').map(item => item.source); }

function sessionMinutes(session) {
  const seconds = Number(session?.durationSeconds);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds / 60) : Math.max(0, Number(session?.minutes) || 0);
}

export function calendarEventPresentation(input) {
  const event = typeof input === 'string' ? { kind: input } : (input || {});
  const kind = String(event.kind || '');
  const meta = CALENDAR_EVENT_META[kind] || { icon: 'history', tone: 'neutral', label: '生活记录' };
  const title = String(event.title || '').trim();
  const summary = String(event.summary || '').trim();
  let primary = title || summary || '未命名记录';
  let secondary = summary && summary !== primary ? summary : '';
  let accent = '';

  if (kind === 'note') {
    primary = summary || title || '未命名随手记';
    secondary = '';
  } else if (kind === 'expense' || kind === 'income') {
    primary = title || `${meta.label}记录`;
    accent = summary;
    secondary = '';
  } else if (kind === 'transfer' || kind === 'calibrate') {
    primary = title || (kind === 'transfer' ? '账户转账' : '余额校准');
    secondary = [summary, '不计收支'].filter(Boolean).join(' · ');
  }

  return { ...meta, primary, secondary, accent };
}

export function calendarArchiveEvents(events) {
  return (events || []).filter(event => !['journal', 'habit'].includes(event.kind));
}

function eventTime(timestamp) {
  const date = new Date(Number(timestamp));
  if (!Number.isFinite(date.getTime()) || Number(timestamp) <= 0) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function calendarJournalContent(content) {
  const raw = String(content || '').trim();
  const titleMatch = raw.match(/^《([^》\r\n]{1,80})》(?:\r?\n){0,2}/);
  if (!titleMatch) return { title: '', body: raw };
  return { title: titleMatch[1].trim(), body: raw.slice(titleMatch[0].length).trim() };
}

function calendarArchiveEvent(event) {
  const meta = calendarEventPresentation(event);
  const time = event.kind === 'release' ? formatShanghaiClock(event.timestamp) : eventTime(event.timestamp);
  const accessibleLabel = [time || '无时间', meta.label, meta.primary, meta.secondary, meta.accent].filter(Boolean).join('，');
  return `<button class="cal-archive-event tone-${meta.tone}" data-calendar-event="${esc(event.id)}" data-event-kind="${esc(event.kind)}" aria-label="${esc(accessibleLabel)}"><span class="cal-archive-time">${time ? `<time>${time}</time>` : '<span aria-hidden="true">—</span>'}</span><span class="cal-archive-axis" aria-hidden="true"><span class="cal-archive-node material-symbols-outlined">${meta.icon}</span></span><span class="cal-archive-paper"><span class="cal-archive-meta"><span class="cal-archive-type">${meta.label}</span>${meta.accent ? `<em>${esc(meta.accent)}</em>` : ''}<span class="material-symbols-outlined">chevron_right</span></span><strong>${esc(meta.primary)}</strong>${meta.secondary ? `<small>${esc(meta.secondary)}</small>` : ''}</span></button>`;
}

function calendarDayDetail(day) {
  const journal = state.journals?.[day];
  const dayTransactions = (state.transactions || []).filter(item => item.date === day);
  const completedHabits = habitsForDate(state, day).filter(habit => habitGoalMet(habit, habitProgressForDate(state, habit, day)));
  return {
    date: day,
    journal,
    hasJournal: Boolean(journal),
    journalPreview: String(journal?.content || '').slice(0, 120),
    totalExpense: dayTransactions.filter(item => item.type === 'expense').reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    totalFocusMinutes: (state.sessions || []).filter(item => item.date === day).reduce((sum, item) => sum + sessionMinutes(item), 0),
    completedHabits,
    photos: photosForDay(day),
    media: mediaForDay(day),
    events: activityForDate(state, day)
  };
}

export function calendarView() {
  const date = new Date(`${selected}T12:00:00`);
  const today = dateKey();
  return `<section class="view calendar-view cal-screen">
    <header class="cal-screen-head"><span class="cal-issue-mark" aria-hidden="true">MINE · LIFE ARCHIVE</span><div class="cal-screen-title">Mine Calendar</div><div class="cal-screen-subtitle">Life Archive · ${cursor.getMonth() + 1}月生活档案</div><span class="cal-corner-note" aria-hidden="true">A Better<br>Me<br>Everyday.</span></header>
    <div class="cal-tools-bar"><button class="cal-tool-btn" id="journal-history"><span class="material-symbols-outlined">search</span><span class="cal-tool-copy"><strong>搜索日记</strong><small>回忆生活里的每一刻</small></span></button><button class="cal-tool-btn" id="new-session"><span class="material-symbols-outlined">add_circle</span><span class="cal-tool-copy"><strong>补记专注</strong><small>不让努力被遗忘</small></span></button></div>
    <section class="calendar-month-paper"><div class="month-navigator"><button class="month-nav-arrow" id="prev" aria-label="上一月">‹</button><div class="month-nav-title">${cursor.getFullYear()}年${cursor.getMonth() + 1}月 · ${MONTH_EN[cursor.getMonth()]}</div><button class="month-nav-arrow" id="next" aria-label="下一月">›</button></div><div class="calendar-full-grid">${WEEK_DAYS.map(day => `<span class="cal-col-head">${day}</span>`).join('')}${monthDays().map(item => { const day = dateKey(item); const events = activityForDate(state, day); const hasFocus = events.some(event => event.kind === 'focus'); const hasJournal = events.some(event => event.kind === 'journal'); const hasLife = events.some(event => ['habit', 'photo', 'taste', 'expense', 'income', 'calibrate'].includes(event.kind)); return `<button class="cal-cell ${item.getMonth() !== cursor.getMonth() ? 'out' : ''} ${day === today ? 'today' : ''} ${hasFocus ? 'has-focus-ring' : ''} ${hasJournal ? 'has-journal' : ''} ${hasLife ? 'has-life-event' : ''} ${day === selected ? 'active' : ''}" data-day="${day}">${item.getDate()}</button>`; }).join('')}</div></section>
    ${dayArchive(date)}
  </section>`;
}

// ---- 当日全景档案（对齐原型 #cal-day-content-box）----
function dayArchive(date) {
  const day = selected;
  const detail = calendarDayDetail(day);
  const journal = detail.journal;
  const dailySummary = state.dailySummaries?.[day];
  const focusMinutes = detail.totalFocusMinutes;
  const completion = { done: detail.completedHabits.length, total: todayCompletion(state, day).total };
  const dayMedia = detail.media;
  const journalContent = calendarJournalContent(journal?.content);
  const journalTitle = journalContent.title || '这一天';
  const journalBody = journalContent.body || '这一天还没有正文';
  const aiBlock = dailySummary?.text
    ? `<section class="day-summary-card"><div class="pill-left"><span class="material-symbols-outlined">auto_awesome</span><div><strong>AI 当日生活小结</strong><small>${esc(dailySummary.text)}</small></div></div><button type="button" id="gen-day-summary" data-regenerate="true" ${summaryGenerating ? 'disabled' : ''}><span class="material-symbols-outlined">refresh</span>${summaryGenerating ? '更新中…' : '重新生成'}</button></section>`
    : `<button class="day-summary-action" id="gen-day-summary" ${summaryGenerating ? 'disabled' : ''}><span class="material-symbols-outlined">${summaryGenerating ? 'hourglass_top' : 'auto_awesome'}</span><span><strong>${summaryGenerating ? '生成中…' : state.settings.aiApiKey ? '生成 AI 当日小结' : '未配置 AI，去设置'}</strong><small>${state.settings.aiApiKey ? '回顾这一天，让 AI 陪你复盘' : '需要先在 AI 设置里配置 Key'}</small></span></button>`;
  const journalBlock = journal
    ? `<div class="cal-journal-card" style="cursor:pointer"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div style="display:flex;align-items:center;gap:6px"><span class="material-symbols-outlined" style="font-size:18px;color:#6b7c6e">menu_book</span><strong style="font-size:13px">生活随笔《${esc(journalTitle)}》</strong></div><span style="font-size:10px;color:#8c8880">${journalMetaText(journal)} · 详情 ›</span></div><p style="font-size:12px;color:#5a5652;line-height:1.55;margin:0 0 10px">“${esc(journalBody.slice(0, 120))}”${journalBody.length > 120 ? '…' : ''}</p><div class="row-actions"><button data-edit-journal="${day}">编辑</button><button class="danger" data-delete-journal="${day}">删除</button></div></div>`
    : `<button id="write-empty" class="journal-empty-button"><span class="material-symbols-outlined">edit_note</span><span><strong>写下这一天</strong><small>心情、天气、照片和随手记素材都可以加入</small></span><span class="material-symbols-outlined">arrow_forward</span></button>`;
  const habitNames = detail.completedHabits.map(habit => esc(habit.name)).join('、');
  const archiveEvents = calendarArchiveEvents(detail.events);
  const eventRows = archiveEvents.map(calendarArchiveEvent).join('');
  const activitySection = eventRows ? `<section class="cal-activity-section"><header class="cal-activity-head"><div><span>LIFE CHRONICLE</span><strong>当天活动</strong></div><small>${archiveEvents.length} 条记录</small></header><div class="cal-archive-events">${eventRows}</div></section>` : '';
  return `<div class="stream-sheet cal-day-sheet"><div class="sheet-handle"></div><div class="day-detail-content-wrap" id="cal-day-content-box"><div class="cal-detail-head"><h2 class="sheet-title" style="margin-bottom:0">${date.getMonth() + 1}月${date.getDate()}日 · 星期${WEEK_DAYS[date.getDay()]}档案</h2><button class="cal-edit-journal-btn" id="write"><span class="material-symbols-outlined">edit_note</span><span>${journal ? '编辑日记' : '写日记'}</span></button></div>${aiBlock}${journalBlock}<div class="cal-kpi-strip"><div class="cal-kpi-cell"><span class="material-symbols-outlined">timer</span><span><b>${formatMinutes(focusMinutes)}</b><small>专注</small></span></div><button class="cal-kpi-cell" id="day-ledger-go"><span class="material-symbols-outlined">toll</span><span><b>¥${money(detail.totalExpense)}</b><small>支出</small></span></button><div class="cal-kpi-cell"><span class="material-symbols-outlined">task_alt</span><span><b>${completion.done}/${completion.total}</b><small>习惯完成</small></span></div></div>${habitNames ? `<section class="cal-habit-summary"><span class="material-symbols-outlined">task_alt</span><span><strong>已完成习惯</strong><small>${habitNames}</small></span><em>${detail.completedHabits.length} 项</em></section>` : ''}<section class="cal-photo-paper">${dayMedia.length ? `<div class="day-photos-strip">${dayMedia.map((item, index) => item.kind === 'video' ? `<button class="day-photo-thumb day-video-thumb photo-blur-frame is-edge" data-view-day-media="${index}" aria-label="播放当天第 ${index + 1} 项视频">${item.video.poster ? photoFrameLayersHtml(imgSrc(item.video.poster), { alt: `当天视频 ${index + 1} 封面`, lazy: true }) : '<span class="cal-video-placeholder material-symbols-outlined">stream</span>'}<span class="cal-video-play material-symbols-outlined" aria-hidden="true">play_arrow</span><span class="video-duration-stamp">${formatVideoDuration(item.video.duration, item.video.sourceType === 'hls' ? '在线' : '待读取')}</span><small>${item.video.sourceType === 'hls' ? '在线' : '视频'}</small></button>` : `<button class="day-photo-thumb photo-blur-frame is-edge" data-view-day-media="${index}" aria-label="查看当天照片 ${index + 1}">${photoFrameLayersHtml(imgSrc(item.source), { alt: `当天照片 ${index + 1}`, lazy: true })}</button>`).join('')}</div>` : `<div class="cal-no-photo"><span class="material-symbols-outlined">photo_library</span>这一天还没有照片或视频</div>`}<span class="cal-photo-script" aria-hidden="true">Collect<br>Ordinary<br>Moments</span></section>${activitySection}<p class="cal-closing-quote">“平凡的日子<br>也值得被认真收藏。”</p></div></div>`;
}

function journalMetaText(journal) {
  const parts = [];
  if (journal.mood) parts.push(`${MOODS[journal.mood]?.symbol || ''} ${MOODS[journal.mood]?.label || journal.mood}`);
  if (journal.weather) parts.push(WEATHERS[journal.weather]?.label || journal.weather);
  return parts.join(' · ') || '生活记录';
}

// 生成分类下拉选项（带层级缩进）
function categoryOptionsHtml(selectedId) {
  const cats = state.focusCategories || [];
  const build = (parentId, depth) => cats
    .filter(category => category.parentId === parentId && !category.archived)
    .sort((a, b) => (a.sortOrder - b.sortOrder) || (a.createdAt - b.createdAt))
    .map(category => `<option value="${category.id}" ${category.id === selectedId ? 'selected' : ''}>${'　'.repeat(depth)}${esc(category.name)}</option>${build(category.id, depth + 1)}`)
    .join('');
  return build('', 0) || '<option value="">（请先在计时页创建分类）</option>';
}

export function sessionForm(session = null, initialDate = selected) {
  const currentCategory = (state.focusCategories || []).find(item => item.id === (session?.categoryId || session?.projectId));
  const item = session || { id: '', date: initialDate, minutes: state.settings.defaultDurationMinutes, task: currentCategory?.name || '专注记录', detail: '', category: 'work', projectId: currentCategory?.id || '', categoryId: currentCategory?.id || '' };
  modal(`<form id="session-form"><input type="hidden" name="id" value="${item.id}"><h2>${session ? '编辑' : '补记'}专注</h2><label>日期</label><input name="date" type="date" required value="${item.date}"><label>学习分类</label><select name="categoryId" required>${categoryOptionsHtml(currentCategory?.id)}</select><label>本次内容</label><input name="detail" maxlength="80" value="${esc(item.detail)}" placeholder="例如：第三章习题"><label>时长（分钟）</label><input name="minutes" type="number" min="1" max="1440" required value="${item.minutes}"><div class="modal-actions">${session ? `<button type="button" class="danger" data-delete-session="${session.id}">删除</button>` : ''}<button type="button" data-close>取消</button><button class="save">保存</button></div></form>`);
  bindRecordActions();
}

// ---- 绑定 ----
// 进日历自动补前一天小结（AI 岗位 helper，无 key / 已有则静默跳过；生成成功后重渲染一次让「昨天」立刻可见）
function refreshYesterdaySummary() {
  const before = JSON.stringify(state.dailySummaries || {});
  let p;
  try { p = callHelper('ensureDailySummary'); } catch { return; }
  Promise.resolve(p).catch(() => {}).finally(() => {
    if (JSON.stringify(state.dailySummaries || {}) !== before) render();
  });
}

function shiftCalendarMonth(offset) {
  const currentDay = Number(selected.slice(8, 10)) || 1;
  cursor.setMonth(cursor.getMonth() + offset);
  const targetDay = Math.min(currentDay, new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate());
  setSelected(dateKey(new Date(cursor.getFullYear(), cursor.getMonth(), targetDay, 12)));
  render();
}

function openJournalForSelectedDay(event) {
  event?.stopImmediatePropagation();
  const day = selected;
  setSelected(day);
  setCursor(new Date(`${day}T12:00:00`));
  callHelper('setJournalEditingDay', day);
  go('journal');
}

function bindCalendar() {
  if (state.route === 'calendar') refreshYesterdaySummary();
  $('#prev')?.addEventListener('click', () => shiftCalendarMonth(-1));
  $('#next')?.addEventListener('click', () => shiftCalendarMonth(1));
  $$('[data-day]').forEach(button => button.onclick = () => { setSelected(button.dataset.day); render(); });
  $$('[data-calendar-event]').forEach(button => button.onclick = () => callHelper('openCalendarEvent', button.dataset.calendarEvent));
  $('#new-session')?.addEventListener('click', () => sessionForm(null, selected));
  $$('[data-view-day-media]').forEach(button => button.onclick = () => {
    const media = mediaForDay(selected);
    const item = media[Number(button.dataset.viewDayMedia)];
    if (!item) return;
    if (item.kind === 'video') {
      // 视频播放器没有稳定落点，直接播
      const entry = state.snippets.find(snippet => snippet.id === item.entryId);
      callHelper('playSnippetVideo', item.video, entry, item.index);
      return;
    }
    const photos = media.filter(entry => entry.kind === 'photo');
    const photoIndex = photos.findIndex(entry => entry === item);
    // 点照片直接开大图，不做进入动效（用户 2026-10-12 要求去掉放大的动效；与随手拍一致）
    photoViewer(photos.map(entry => entry.motion ? { poster: entry.source, video: entry.motion, live: true } : entry.source), Math.max(0, photoIndex));
  });
  $('#gen-day-summary')?.addEventListener('click', () => {
    if (summaryGenerating) return;
    if (!state.settings.aiApiKey) { callHelper('aiSettingsForm'); show('请先在 AI 设置中配置 Key'); return; }
    summaryGenerating = true;
    const force = $('#gen-day-summary')?.dataset.regenerate === 'true';
    render();
    const before = JSON.stringify(state.dailySummaries || {});
    Promise.resolve(callHelper('ensureDailySummary', { explicit: true, date: selected, force })).catch(error => show(error.message)).finally(() => { summaryGenerating = false; render(); });
  });
  $('#day-ledger-go')?.addEventListener('click', () => go('ledger'));
  // 新日记统一进入 Journal 主页面；已有日记仍可从档案卡直接编辑。
  $('#write')?.addEventListener('click', openJournalForSelectedDay, { capture: true });
  $('#write-empty')?.addEventListener('click', openJournalForSelectedDay, { capture: true });
  $$('[data-edit-journal]').forEach(button => button.onclick = () => journalForm(button.dataset.editJournal));
  $$('[data-delete-journal]').forEach(button => button.onclick = () => confirmDelete('删除这篇日记？', async () => { delete state.journals[button.dataset.deleteJournal]; await save(); render(); callHelper('scheduleAiRefresh'); }));
}

// ---- 表单提交 ----
registerSubmitHandler('session-form', async data => {
  const previousSessions = structuredClone(state.sessions);
  const previousChecks = structuredClone(state.checks);
  const rollbackSession = () => { state.sessions = previousSessions; state.checks = previousChecks; };
  try {
    const existing = state.sessions.find(session => session.id === data.get('id'));
    const previous = existing ? structuredClone(existing) : null;
    const category = (state.focusCategories || []).find(item => item.id === data.get('categoryId'));
    if (!category) throw new Error('请选择有效的学习分类');
    const minutes = Number(data.get('minutes'));
    const startedAt = existing?.startedAt || new Date(`${data.get('date')}T12:00:00`).getTime();
    const next = { id: existing?.id || uid(), date: data.get('date'), startedAt, minutes, durationSeconds: minutes * 60, targetDurationSeconds: existing?.targetDurationSeconds || minutes * 60, mode: existing?.mode || 'manual', interruptionsCount: Number(existing?.interruptionsCount) || 0, flowScore: Number(existing?.flowScore) || 0, task: category.name, detail: data.get('detail').trim(), category: 'work', projectId: category.id, categoryId: category.id, habitId: '', habitMinutes: 0, mediaId: '', endedAt: existing?.endedAt || (startedAt + minutes * 60000) };
    replaceSessionHabitContribution(previous, next);
    existing ? Object.assign(existing, next) : state.sessions.push(next);
    setSelected(next.date); setCursor(new Date(`${selected}T12:00:00`));
  } catch (error) {
    rollbackSession();
    throw error;
  }
});

registerView('calendar', calendarView);
registerBinder(bindCalendar);
registerHelper('sessionForm', sessionForm);
