import { $, $$, pad, esc, imgSrc, state, cursor, formatMinutes, category, modal, closeModal, confirmDelete, save, render, show, callHelper } from '../core.js';
import { clampStillTransform, measureLongStill } from '../photo-utils.js';
import { photoFrameLayersHtml, revealViewerImageWhenDecoded } from '../photo-frame.js';
import { thumbSource, thumbKeyFor, watchThumbImages } from '../photo-thumbs.js';
import { MOODS, WEATHERS, WEEK_DAYS, dateKey, habitProgressForDate, habitGoalMet, formatShanghaiDateTime } from '../model.js';
import { mediaFocusSummary } from '../analytics.js';
import { rebuildActivityLog } from '../activity-log.js';
import { openVideoSession } from '../video-session.js';

// ---- 专注-习惯联动逻辑（focus / habits / calendar 共用）----
export function activeFocusProject() {
  return state.focusProjects.find(project => project.id === state.timer.projectId && !project.archived)
    || state.focusProjects.find(project => !project.archived)
    || null;
}

export function linkedHabitMinutes(day, habitId) {
  return state.sessions
    .filter(session => session.date === day && session.habitId === habitId)
    .reduce((sum, session) => sum + Number(session.habitMinutes || 0), 0);
}

export function weekDateKeys(day) {
  const base = new Date(`${day}T12:00:00`);
  base.setDate(base.getDate() - ((base.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => { const value = new Date(base); value.setDate(base.getDate() + index); return dateKey(value); });
}

export function updateHabitCompletion(day, habit, previous, next, completedAt = null) {
  const after = habitProgressForDate(state, habit, day);
  const before = Math.max(0, after - (next - previous));
  const wasDone = habitGoalMet(habit, before), isDone = habitGoalMet(habit, after);
  const affectedDays = habit.goalPeriod === 'weekly' ? weekDateKeys(day) : [day];
  if (!isDone) {
    affectedDays.forEach(key => {
      const completions = { ...(state.habitCompletions[key] || {}) };
      delete completions[habit.id];
      if (Object.keys(completions).length) state.habitCompletions[key] = completions;
      else delete state.habitCompletions[key];
    });
    return;
  }
  if (!wasDone && !affectedDays.some(key => state.habitCompletions[key]?.[habit.id])) {
    const completions = { ...(state.habitCompletions[day] || {}) };
    completions[habit.id] = Number(completedAt) || (day === dateKey() ? Date.now() : new Date(`${day}T12:00:00`).getTime());
    state.habitCompletions[day] = completions;
  }
}

export function adjustHabitMinutes(day, habitId, difference, completedAt = null) {
  if (!habitId || !difference) return;
  const habit = state.habits.find(item => item.id === habitId);
  if (!habit || habit.tracking !== 'quantity' || !/分钟/.test(habit.unit)) return;
  const progress = { ...(state.checks[day] || {}) };
  const previous = Number(progress[habitId] || 0);
  const next = Math.max(0, previous + difference);
  if (next) progress[habitId] = next;
  else delete progress[habitId];
  state.checks[day] = progress;
  updateHabitCompletion(day, habit, previous, next, completedAt);
}

export function replaceSessionHabitContribution(previous, next) {
  if (previous?.habitId && previous.habitMinutes) adjustHabitMinutes(previous.date, previous.habitId, -previous.habitMinutes);
  if (next?.habitId && next.habitMinutes) adjustHabitMinutes(next.date, next.habitId, next.habitMinutes, Number(next.startedAt) + Number(next.minutes) * 60000);
}

// ---- 跨模块共享的纯渲染函数 ----
export function repeatLabel(days) {
  if (days.length === 7) return '每天';
  if (days.join(',') === '1,2,3,4,5') return '工作日';
  return days.map(day => `周${WEEK_DAYS[day]}`).join('、');
}

export function todoCard(todo) {
  // ⚠️ 图标写在按钮内部的 span 上：弹层里的 `.modal button{font:inherit}` 会压掉挂在按钮
  //    上的图标字体，字形会退化成字面文字（2026-10-12 真机乱码即此）。
  return `<article class="todo-row ${todo.completed ? 'done' : ''}"><button class="todo-check" data-toggle-todo="${todo.id}" aria-label="${todo.completed ? '取消完成' : '完成待办'}"><span class="material-symbols-outlined">${todo.completed ? 'check_circle' : 'radio_button_unchecked'}</span></button><button class="todo-copy" data-edit-todo="${todo.id}"><strong>${esc(todo.title)}</strong><small>${todo.completed ? '已完成' : '今天'}</small></button><button class="todo-more" data-edit-todo="${todo.id}" aria-label="编辑待办"><span class="material-symbols-outlined">more_horiz</span></button></article>`;
}

export function openReleaseNotes(code) {
  const release = (state.releases || []).find(entry => Number(entry.code) === Number(code));
  if (!release) return;
  const bullets = (release.bullets || []).map(entry => `<li>${esc(entry)}</li>`).join('');
  const shots = (release.screenshots || []).map(entry => `<img class="release-notes-shot" src="${imgSrc(entry)}" alt="${esc(release.title)} 演示图" loading="lazy">`).join('');
  const when = formatShanghaiDateTime(release.createdAt) || release.date || '';
  modal(`<div class="release-notes-modal"><div class="release-notes-head"><span class="release-notes-badge"><span class="material-symbols-outlined" aria-hidden="true">new_releases</span></span><div class="release-notes-head-copy"><span class="eyebrow">RELEASE NOTES</span><h2>${esc(release.title)}</h2><p>更新到 ${esc(release.versionName)} · ${esc(when)}</p></div><span class="release-notes-pill">v${esc(release.versionName)}</span></div><p class="release-notes-summary">${esc(release.summary)}</p>${bullets ? `<ul class="release-notes-bullets">${bullets}</ul>` : ''}${shots ? `<div class="release-notes-shots">${shots}</div>` : ''}<div class="modal-actions"><button type="button" class="save" data-close>知道了</button></div></div>`, 'release-notes-modal-dialog');
}

export function recentActivity() {
  const labels = { focus: '专注', journal: '日记', movie: '电影', book: '书籍', photo: '随手拍', note: '随手记', todo: '待办', habit: '习惯', taste: '尝鲜', release: '更新' };
  return rebuildActivityLog(state).map(item => {
    // 版本更新动态要带全量说明和演示图，从 releases 分区整条取回。
    if (item.kind === 'release') {
      const release = (state.releases || []).find(entry => String(entry.code) === item.sourceId) || null;
      return { type: '更新', date: item.date, time: item.timestamp, text: item.title, release };
    }
    return {
      type: labels[item.kind] || '记录', date: item.date, time: item.timestamp,
      text: item.kind === 'focus' ? `${item.title} · ${formatMinutes(item.value)}` : `${item.title}${item.summary ? ` · ${item.summary}` : ''}`,
      photo: item.kind === 'photo' ? item.media : ''
    };
  });
}

export function activityItem(item) {
  const time = new Date(item.time);
  const styles = { '专注': ['timer', 'blue'], '习惯': ['task_alt', 'green'], '待办': ['checklist', 'amber'], '随手拍': ['photo_camera', 'rose'], '随手记': ['edit_note', 'violet'], '日记': ['menu_book', 'violet'], '电影': ['movie', 'amber'], '书籍': ['auto_stories', 'green'], '尝鲜': ['restaurant_menu', 'amber'] };
  const [icon, tone] = styles[item.type] || ['history', 'blue'];
  const today = item.date === dateKey();
  const label = `${today ? '今天' : item.date.slice(5).replace('-', '月') + '日'} ${pad(time.getHours())}:${pad(time.getMinutes())}`;
  return `<button class="activity-card ${tone}" data-activity-day="${item.date}"><span class="activity-icon material-symbols-outlined">${icon}</span><span class="activity-copy"><span><b>${item.type}</b><time>${label}</time></span><strong>${esc(item.text)}</strong></span>${item.photo ? `<span class="activity-photo-thumb photo-blur-frame is-edge">${photoFrameLayersHtml(imgSrc(item.photo), { alt: '随手拍缩略图', lazy: true })}</span>` : '<i class="material-symbols-outlined">chevron_right</i>'}</button>`;
}

export function sessionCard(session) {
  return `<article class="record"><span class="record-icon material-symbols-outlined">${category(session.category).icon}</span><span><strong>${esc(session.task)}</strong><small>${esc(session.detail || category(session.category).label)}</small></span><span class="record-time">${formatMinutes(session.minutes)}</span><span class="row-actions record-actions"><button data-edit-session="${session.id}">编辑</button><button class="danger" data-delete-session="${session.id}">删除</button></span></article>`;
}

export function journalSummary(journal) {
  const parts = [MOODS[journal.mood]?.label, WEATHERS[journal.weather]?.label, journal.content].filter(Boolean);
  return parts.join(' · ') || `${journal.photos?.length || 0} 张照片`;
}

export function journalMeta(journal) {
  return `${journal.mood ? `<span class="journal-mood">${MOODS[journal.mood].symbol} ${MOODS[journal.mood].label}</span>` : ''}${journal.weather ? `<span><i class="material-symbols-outlined">${WEATHERS[journal.weather].icon}</i>${WEATHERS[journal.weather].label}</span>` : ''}`;
}

export function journalPhotos(photos = [], className = '') {
  return photos.length ? `<div class="journal-photo-grid ${className}">${photos.map((photo, index) => `<button type="button" class="photo-blur-frame is-edge" data-view-photo="${index}" aria-label="查看第 ${index + 1} 张照片">${photoFrameLayersHtml(imgSrc(photo), { alt: `日记照片 ${index + 1}`, lazy: true })}</button>`).join('')}</div>` : '';
}

export function journalDetailCard(journal, day) {
  return `<article class="journal-card rich-journal"><div class="journal-card-head"><div><strong>生活记录</strong><small>${new Date(journal.updatedAt).toLocaleString('zh-CN')}</small></div><div class="journal-meta">${journalMeta(journal)}</div></div>${journalPhotos(journal.photos)}${journal.content ? `<p>${esc(journal.content)}</p>` : ''}<div class="row-actions"><button data-edit-journal="${day}">编辑</button><button class="danger" data-delete-journal="${day}">删除</button></div></article>`;
}

export function completionArchiveCard(type, text, timestamp, icon) {
  const time = timestamp ? new Date(timestamp) : null;
  return `<article class="completion-record"><span class="material-symbols-outlined">${icon}</span><span><small>${type}</small><strong>${esc(text)}</strong></span><time>${time ? `${pad(time.getHours())}:${pad(time.getMinutes())}` : '旧版未记录时间'}</time></article>`;
}

export function snapshotCard(entry) {
  const time = new Date(entry.createdAt);
  return `<article class="calendar-snapshot"><button class="photo-blur-frame is-edge" data-view-calendar-snapshot="${entry.id}" aria-label="查看 ${pad(time.getHours())}:${pad(time.getMinutes())} 的随手拍">${photoFrameLayersHtml(imgSrc(entry.photo), { alt: entry.text || '随手拍', lazy: true })}<span><i class="material-symbols-outlined">schedule</i>${pad(time.getHours())}:${pad(time.getMinutes())}</span></button>${entry.text ? `<p>${esc(entry.text)}</p>` : ''}</article>`;
}

export function monthDays() {
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const start = new Date(year, month, 1 - new Date(year, month, 1).getDay());
  return Array.from({ length: 42 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date; });
}

export function calendarEventCard(item) {
  const meta = {
    focus: ['timer', '专注'], todo: ['task_alt', '待办'], habit: ['check_circle', '习惯'], photo: ['photo_camera', '随手拍'],
    note: ['edit_note', '随手记'], journal: ['menu_book', '日记'], book: ['auto_stories', '书籍'], movie: ['movie', '电影']
  }[item.kind] || ['history', '记录'];
  const time = new Date(item.timestamp);
  return `<button class="calendar-event" data-calendar-event="${esc(item.id)}"><span class="calendar-event-time">${pad(time.getHours())}:${pad(time.getMinutes())}</span><i class="material-symbols-outlined">${meta[0]}</i><span><small>${meta[1]}</small><strong>${esc(item.title)}</strong><em>${esc(item.summary)}</em></span>${item.media ? `<span class="calendar-event-media photo-blur-frame is-edge">${photoFrameLayersHtml(imgSrc(item.media), { alt: item.title, lazy: true })}</span>` : '<b class="material-symbols-outlined">chevron_right</b>'}</button>`;
}

export function mediaStatusLabel(entry) {
  if (entry.status === 'completed') return entry.type === 'movie' ? '已看' : '已读';
  if (entry.status === 'in_progress') return entry.type === 'movie' ? '在看' : '在读';
  return entry.type === 'movie' ? '想看' : '想读';
}

export function mediaCard(entry) {
  const typeLabel = entry.type === 'movie' ? '电影' : '书籍';
  const statusLabel = mediaStatusLabel(entry);
  const cover = entry.poster ? `<img src="${imgSrc(entry.poster)}" alt="${esc(entry.title)}封面">` : `<div class="media-placeholder"><span class="material-symbols-outlined">${entry.type === 'movie' ? 'movie' : 'menu_book'}</span><small>${typeLabel}</small></div>`;
  const stars = entry.rating ? `<span class="media-stars" aria-label="${entry.rating} 星">${'★'.repeat(entry.rating)}${'☆'.repeat(5 - entry.rating)}</span>` : '<span class="media-stars muted-stars">尚未评分</span>';
  const focus = mediaFocusSummary(state, entry.id);
  return `<article class="media-card"><button class="media-cover" data-edit-media="${entry.id}" aria-label="编辑${esc(entry.title)}">${cover}<span class="media-type">${typeLabel}</span></button><div class="media-card-copy"><div><span class="media-state ${entry.status}">${statusLabel}</span>${entry.completedDate ? `<time>${entry.completedDate}</time>` : ''}</div><h3>${esc(entry.title)}</h3>${stars}<p>${esc(entry.notes || '还没有写下感受。')}</p>${entry.type === 'book' && focus.minutes ? `<button class="media-focus-link" data-media-focus="${entry.id}"><span class="material-symbols-outlined">timer</span>${formatMinutes(focus.minutes)} · ${focus.sessions.length} 次阅读专注</button>` : ''}<div class="media-card-actions"><button data-edit-media="${entry.id}">编辑</button><button class="danger" data-delete-media="${entry.id}">删除</button></div></div></article>`;
}

// 大图里的普通视频不再内嵌 <video controls>，统一交给公共播放会话（与私密空间同一个播放器）。
// 页面有自己的会话（带续播、观看记录写回）时通过 options.onOpenVideo 接管；否则只读打开，不写任何数据。
// 大图里的视频地址本来就是页面自己的（data:/file:/blob:），不需要再缓存：
// 不放进全局 plainVideoCache（没有 id 的视频会按位置撞 id、串台，还越积越多），
// 也绝不 revoke —— blob 归原页面管。id 按地址生成，地址不同就不会是同一条。
export function viewerVideoId(item) {
  return `viewer:${item?.video || ''}`;
}

export const viewerVideoCache = Object.freeze({
  has: () => false,
  get: () => undefined,
  inflight: () => false,
  resolve: item => {
    try { return Promise.resolve(item.resolveSource()); }
    catch (error) { return Promise.reject(error); }
  },
  drop() {},
  retain() {},
  release() {}
});

function viewerSessionItem(item, index, meta) {
  return {
    id: viewerVideoId(item),
    resolveSource: () => item.video,
    poster: item.poster || '',
    label: item.label || meta?.[index]?.text?.slice(0, 20) || '视频',
    date: meta?.[index]?.time || '',
    sourceType: item.sourceType || '',
    position: item.position || 0,
    duration: item.duration || 0,
    trim: item.trim || null,
    crop: item.crop || null,
    width: item.width || 0,
    height: item.height || 0
  };
}

export function openPhotoViewerVideo(photos, active, meta = null, options = {}) {
  const current = photos[active];
  if (!current || typeof current !== 'object' || !current.video) return null;
  closeModal();
  if (typeof options.onOpenVideo === 'function') return options.onOpenVideo(active, current);
  const entries = photos.map((item, index) => ({ item, index })).filter(({ item }) => item && typeof item === 'object' && item.video && (!item.live || item === current));
  const start = Math.max(0, entries.findIndex(({ item }) => item === current));
  return openVideoSession({
    items: entries.map(({ item, index }) => viewerSessionItem(item, index, meta)),
    startIndex: start,
    sourceCache: viewerVideoCache
  }).catch(error => show(error?.message || '视频无法播放'));
}

export function photoViewer(photos, active = 0, meta = null, options = {}) {
  if (!photos.length) return;
  // 相册模式：meta 为与 photos 等长的 [{ text, time }]，显示当前照片说明与时间。
  const metaItem = meta?.[active];
  const current = photos[active];
  // 视频项支持：非实况视频项展示海报图与居中播放按钮；轻触打开统一播放会话 openVideoSession。
  const isVideo = current && typeof current === 'object' && current.video;
  const isLive = Boolean(isVideo && current.live);
  let mediaHtml;
  if (isVideo && !isLive) {
    mediaHtml = `<div class="photo-viewer-video-container"><img id="photo-viewer-image" class="photo-viewer-poster" src="${imgSrc(current.poster || current.video)}" alt="视频 ${active + 1}，共 ${photos.length} 项" draggable="false"><button type="button" class="photo-viewer-play-btn" id="photo-viewer-play-btn" aria-label="播放视频"><span class="material-symbols-outlined">play_arrow</span></button></div>`;
  } else if (isLive) {
    mediaHtml = `<video id="photo-viewer-image" class="is-live-photo" src="${imgSrc(current.video)}" poster="${imgSrc(current.poster)}" autoplay loop muted playsinline preload="metadata" draggable="false"></video>`;
  } else {
    mediaHtml = `<img id="photo-viewer-image" src="${imgSrc(current)}" alt="照片 ${active + 1}，共 ${photos.length} 张" draggable="false">`;
  }
  const metaLayer = meta
    ? `<div class="photo-viewer-meta">${metaItem?.time ? `<time>${esc(metaItem.time)}</time>` : ''}${metaItem?.text ? `<p>${esc(metaItem.text)}</p>` : '<p class="photo-viewer-no-caption">无说明</p>'}</div>`
    : '';
  const previous = options.loop && photos.length > 1 ? (active - 1 + photos.length) % photos.length : active - 1;
  const next = options.loop && photos.length > 1 ? (active + 1) % photos.length : active + 1;
  const strip = options.filmstrip && photos.length > 1 ? `<nav class="photo-viewer-filmstrip" aria-label="照片缩略图">${photos.map((item, index) => {
    const source = item && typeof item === 'object' ? item.poster : item;
    const thumbRef = thumbKeyFor(source) ? source : '';
    const src = thumbRef ? esc(thumbSource(source)) : imgSrc(source);
    return `<button type="button" data-photo-strip="${index}" class="${index === active ? 'active' : ''}" aria-label="查看第 ${index + 1} 张"><img src="${src}" alt="" loading="lazy" decoding="async"${thumbRef ? ` data-thumb-ref="${esc(thumbRef)}"` : ''}></button>`;
  }).join('')}</nav>` : '';
  modal(`<div class="photo-viewer ${strip ? 'has-filmstrip' : ''}"><div class="photo-viewer-stage" id="photo-viewer-stage">${mediaHtml}</div><div class="photo-viewer-chrome"><header><span><b>${active + 1}</b> / ${photos.length}${isLive ? '<em class="live-photo-mark photo-viewer-live-badge" role="button" tabindex="0" aria-label="播放实况视频">实况</em>' : ''}</span><button type="button" data-close aria-label="关闭大图"><span class="material-symbols-outlined">close</span></button></header>${strip}${metaLayer}<footer><button type="button" data-photo-prev="${previous}" ${!options.loop && active <= 0 ? 'disabled' : ''} aria-label="上一张"><span class="material-symbols-outlined">arrow_back</span></button><small>${isLive ? '实况静音循环 · 点「实况」用播放器看 · ' : ''}双击放大 · 双指缩放 · ${meta ? '左右滑动切换' : '拖动查看'}</small><button type="button" data-photo-next="${next}" ${!options.loop && active >= photos.length - 1 ? 'disabled' : ''} aria-label="下一张"><span class="material-symbols-outlined">arrow_forward</span></button></footer></div></div>`, 'photo-modal');
  revealViewerImageWhenDecoded($('#photo-viewer-image'));
  if (isLive) {
    const video = $('#photo-viewer-image');
    if (video?.play) video.play().catch(() => {});
    $('.photo-viewer-live-badge')?.addEventListener('click', event => {
      event.stopPropagation();
      openPhotoViewerVideo(photos, active, meta, options);
    });
  }
  if (isVideo && !isLive) {
    $('#photo-viewer-play-btn')?.addEventListener('click', event => {
      event.stopPropagation();
      openPhotoViewerVideo(photos, active, meta, options);
    });
  }
  if (options.onVerticalNavigate) {
    const hint = $('.photo-viewer-chrome footer small');
    if (hint) hint.textContent = isLive ? '实况循环 · 下滑下一条 · 上滑上一条 · 左右切图' : '下滑下一条 · 上滑上一条 · 左右切图';
  }
  bindPhotoViewerGestures(photos, meta, active, options);
  $('[data-photo-prev]:not(:disabled)')?.addEventListener('click', event => openPhotoAt(photos, meta, Number(event.currentTarget.dataset.photoPrev), options));
  $('[data-photo-next]:not(:disabled)')?.addEventListener('click', event => openPhotoAt(photos, meta, Number(event.currentTarget.dataset.photoNext), options));
  $$('[data-photo-strip]').forEach(button => button.onclick = () => openPhotoAt(photos, meta, Number(button.dataset.photoStrip), options));
  requestAnimationFrame(() => $('.photo-viewer-filmstrip .active')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  if (strip) watchThumbImages($('.photo-viewer-filmstrip'));
}

function openPhotoAt(photos, meta, index, options = {}) {
  if (options.loop && photos.length) index = (index + photos.length) % photos.length;
  if (index < 0 || index >= photos.length) return;
  photoViewer(photos, index, meta, options);
}

export function bindPhotoViewerGestures(photos = [], meta = null, active = 0, options = {}) {
  const stage = $('#photo-viewer-stage'), image = $('#photo-viewer-image'), chrome = $('.photo-viewer-chrome');
  if (!stage || !image) return;
  const pointers = new Map();
  let scale = 1, x = 0, y = 0, startDistance = 0, startScale = 1, moved = false, lastTap = 0, switched = false, startX = 0, startY = 0, multiTouch = false;
  let longMode = false, baseHeight = 0;
  const clampView = () => {
    const rect = stage.getBoundingClientRect();
    const next = clampStillTransform({ longMode, baseHeight, scale, x, y, width: rect.width, height: rect.height });
    scale = next.scale; x = next.x; y = next.y;
    image.style.transform = `translate3d(${x}px,${y}px,0) scale(${scale})`;
    image.classList.toggle('zoomed', scale > 1);
  };
  const zoomAtCenter = next => {
    if (longMode && baseHeight > 0) {
      const rect = stage.getBoundingClientRect();
      const anchor = (-y + rect.height / 2) / Math.max(scale, 1);
      scale = next;
      y = rect.height / 2 - anchor * next;
      x = 0;
      clampView();
      return;
    }
    scale = next; clampView();
  };
  const refreshLongImage = () => {
    const rect = stage.getBoundingClientRect?.() || { width: 0, height: 0 };
    const measured = measureLongStill(image, rect.width, rect.height);
    longMode = measured.long;
    baseHeight = measured.baseHeight;
    stage.classList?.toggle?.('is-long-image', longMode);
    if (!longMode) return;
    const hint = $('.photo-viewer-chrome footer small');
    if (hint) hint.textContent = '上下滑动浏览长图 · 双指缩放 · 左右滑动切换';
    clampView();
  };
  stage.onpointerdown = event => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      moved = false; switched = false;
      startX = event.clientX; startY = event.clientY;
    }
    stage.setPointerCapture(event.pointerId);
    if (pointers.size === 2) {
      multiTouch = true;
      const [a, b] = [...pointers.values()];
      startDistance = Math.hypot(a.x - b.x, a.y - b.y);
      startScale = scale;
    }
  };
  stage.onpointermove = event => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      scale = Math.max(1, Math.min(5, startScale * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, startDistance)));
    } else if (scale > 1) { x += dx; y += dy; }
    else if (longMode && !switched && !multiTouch) {
      const totalDx = event.clientX - startX;
      const totalDy = event.clientY - startY;
      if (Math.abs(totalDx) > Math.abs(totalDy) && Math.abs(totalDx) > 60) {
        switched = true;
        openPhotoAt(photos, meta, totalDx < 0 ? active + 1 : active - 1, options);
        return;
      }
      y += dy;
      if (Math.abs(totalDx) + Math.abs(totalDy) > 8) moved = true;
    } else if (!switched && !multiTouch) {
      // 未缩放时水平滑动切换（位移为主且超阈值约 60px），向左下一张、向右上一张。
      const totalDx = event.clientX - startX;
      const totalDy = event.clientY - startY;
      if (Math.abs(totalDx) > Math.abs(totalDy) && Math.abs(totalDx) > 60) {
        switched = true;
        openPhotoAt(photos, meta, totalDx < 0 ? active + 1 : active - 1, options);
        return;
      }
      if (options.onVerticalNavigate && Math.abs(totalDy) > Math.abs(totalDx) && Math.abs(totalDy) > 72) {
        switched = true;
        options.onVerticalNavigate(totalDy > 0 ? 1 : -1);
        return;
      }
    }
    clampView();
  };
  const release = event => { pointers.delete(event.pointerId); if (!pointers.size) multiTouch = false; };
  stage.onpointerup = event => {
    const wasMultiTouch = multiTouch;
    release(event);
    if (moved || switched || wasMultiTouch || pointers.size) return;
    const current = photos[active];
    if (current && typeof current === 'object' && current.video && !current.live) {
      if (event.target?.closest?.('.photo-viewer-play-btn')) return;
      openPhotoViewerVideo(photos, active, meta, options);
      return;
    }
    const now = Date.now();
    if (now - lastTap < 280) { zoomAtCenter(scale > 1 ? 1 : 2.5); lastTap = 0; }
    else { lastTap = now; setTimeout(() => { if (lastTap === now) chrome.classList.toggle('hidden'); }, 290); }
  };
  stage.onpointercancel = release;
  stage.onwheel = event => {
    event.preventDefault();
    if (longMode && scale <= 1 && !event.ctrlKey && !event.metaKey) { y -= event.deltaY; clampView(); return; }
    const next = Math.max(1, Math.min(5, scale + (event.deltaY < 0 ? .25 : -.25)));
    if (longMode) zoomAtCenter(next);
    else { scale = next; clampView(); }
  };
  if (typeof image.addEventListener === 'function') image.addEventListener('load', refreshLongImage);
  if (image.complete && image.naturalWidth) refreshLongImage();
}

// 会话记录的编辑/删除绑定（供专注项目历史、阅读专注历史复用）
export function bindRecordActions() {
  $$('[data-edit-session]').forEach(button => button.onclick = () => callHelper('sessionForm', state.sessions.find(session => session.id === button.dataset.editSession)));
  $$('[data-delete-session]').forEach(button => button.onclick = () => confirmDelete('删除这条专注记录？关联习惯中的分钟数也会同步扣除。', async () => { const session = state.sessions.find(item => item.id === button.dataset.deleteSession); if (session) callHelper('replaceSessionHabitContribution', session, null); state.sessions = state.sessions.filter(item => item.id !== button.dataset.deleteSession); await save(); render(); callHelper('scheduleAiRefresh'); }));
}

// ---- 共享语音输入组件（R5，供日记/随手记/账本/AI 对话等输入框接入）----
// 用法（岗位③④）：
//   <button class="mic-btn" data-mic aria-label="语音输入"><span class="material-symbols-outlined">mic</span></button>
//   bindVoiceInput($('#xxx-form'), { input: () => $('#xxx-form [name=content]'), onText: text => {...} })
// 返回 { destroy }：页面/弹窗销毁时调用清理监听；无语音引擎时按钮自动隐藏。
export function micButtonHtml() {
  return `<button type="button" class="mic-btn" data-mic aria-label="语音输入"><span class="material-symbols-outlined">mic</span></button>`;
}

export function bindVoiceInput(container, { input, onText } = {}) {
  if (!container) return { destroy: () => {} };
  const button = container.querySelector('[data-mic]');
  if (!button) return { destroy: () => {} };
  let listening = false;
  let detached = false;
  const stateRef = { listening: () => listening };

  const setListening = (on) => {
    listening = on;
    button.classList.toggle('mic-listening', on);
    button.querySelector('.material-symbols-outlined').textContent = on ? 'graphic_eq' : 'mic';
    button.setAttribute('aria-label', on ? '停止录音' : '语音输入');
  };

  const showToast = (message) => {
    if (typeof show === 'function') show(message);
  };

  const stop = async () => {
    if (!listening) return;
    setListening(false);
    await callHelper('cancelVoiceInput').catch(() => {});
  };

  const start = async () => {
    if (listening) return;
    // 白噪音提示：ambient 播放中提醒关闭，不强停
    if (state.ambientSound && state.ambientSound !== 'none') {
      showToast('环境音播放中，建议先关闭再语音输入');
    }
    try {
      await callHelper('startVoiceInput');
      setListening(true);
    } catch (error) {
      const code = String(error?.message || error || '').toLowerCase();
      if (code.includes('permission_denied') || code.includes('麦克风')) {
        showToast('需要麦克风权限，请到系统设置开启');
      } else if (code.includes('no_engine')) {
        button.style.display = 'none';
      } else if (code.includes('busy')) {
        showToast('语音识别正忙，请稍后再试');
      } else if (code.includes('browser_unsupported')) {
        button.style.display = 'none';
      } else {
        showToast('语音识别启动失败');
      }
    }
  };

  button.addEventListener('click', () => { listening ? stop() : start(); });

  // 结果/错误监听
  const offResult = callHelper('onVoiceResult', (data) => {
    if (!listening) return;
    if (data?.status === 'result' && data.text) {
      setListening(false);
      const target = typeof input === 'function' ? input() : input;
      if (target) {
        target.value = data.text;
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (typeof onText === 'function') onText(data.text);
    } else if (data?.status === 'error' || data?.status === 'canceled') {
      setListening(false);
    }
  });
  const offError = callHelper('onVoiceError', (data) => {
    if (!listening) return;
    setListening(false);
    const code = data?.code || 'recognizer_error';
    if (code === 'permission_denied') showToast('需要麦克风权限，请到系统设置开启');
    else if (code === 'no_match') showToast('没听清，请再说一次');
    else if (code === 'speech_timeout') showToast('没听到声音，请再说一次');
    else if (code === 'network') showToast('网络异常，识别失败');
    else showToast('语音识别失败，请重试');
  });

  // 可用性检查：无引擎/浏览器隐藏按钮
  callHelper('isVoiceAvailable').then((available) => {
    if (!available && !detached) button.style.display = 'none';
  }).catch(() => {});

  return {
    destroy: () => {
      detached = true;
      stop();
      if (typeof offResult === 'function') offResult();
      if (typeof offError === 'function') offError();
    },
    stop,
    state: stateRef
  };
}
