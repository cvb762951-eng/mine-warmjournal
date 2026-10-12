import { $, $$, esc, state, save, render, modal, closeModal, emptyState, go, avatarContent, imgSrc, registerView, registerBinder, callHelper, pushBackState, pad, show } from '../core.js';
import { habitsForDate, todosForDate, todayCompletion, activeStreak, dateKey, WEEK_DAYS, habitProgressForDate, habitGoalMet, formatShanghaiClock } from '../model.js';
import { recentActivity, openReleaseNotes } from './common.js';
import { countdownBanner } from './countdown.js';
import { isSupportedJournalPhoto } from '../photo-utils.js';

// ---- 本地状态 ----
let photoStackIndex = 0;
let photoStackCount = 0;
let todayCoverCropState = null;
const PRIVATE_VAULT_HOLD_MS = 1500;
const PRIVATE_VAULT_MOVE_TOLERANCE = 12;

// 单习惯连续达标天数（今日未达标时从昨天往回算；休息日跳过、不打断）
function habitDayStreak(habit, endDay = dateKey()) {
  let streak = 0;
  const cursor = new Date(`${endDay}T12:00:00`);
  const todayValue = habitProgressForDate(state, habit, endDay);
  if (!habitGoalMet(habit, todayValue) && !(state.habitSkips?.[endDay] || []).includes(habit.id)) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (streak < 3660) {
    const day = dateKey(cursor);
    if ((state.habitSkips?.[day] || []).includes(habit.id)) {
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    if (!habitGoalMet(habit, habitProgressForDate(state, habit, day))) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// 习惯卡：只放名字、今日是否打卡、连续天数；大号打卡钮；细则进二级
function habitCardHtml(habit, day) {
  const count = habitProgressForDate(state, habit, day);
  const done = habitGoalMet(habit, count);
  const streak = habitDayStreak(habit, day);
  const target = Number(habit.target) || 1;
  const unit = esc(habit.unit);
  const status = done
    ? (target > 1 ? `今日已打卡 · ${count}/${target}${unit}` : '今日已打卡')
    : (count > 0 ? `${count}/${target}${unit} · 点勾补满` : '今日未打卡');
  const stateClass = done ? 'is-done' : (count > 0 ? 'is-progress' : '');
  const meta = streak > 0 ? `已连续 ${streak} 天 · ${status}` : status;
  return `<div class="habit-swipe-wrap"><article class="habit-card ${stateClass}" data-habit-card="${habit.id}">
    <button type="button" class="habit-card-main" data-habit-open="${habit.id}" aria-label="查看${esc(habit.name)}详情">
      <span class="habit-card-copy">
        <strong>${esc(habit.name)}</strong>
        <small class="habit-card-meta">${meta}</small>
      </span>
    </button>
    <button type="button" class="habit-check-btn ${done ? 'is-done' : ''}" data-habit="${habit.id}" aria-label="${done ? '已完成' : '打卡'} ${esc(habit.name)}">
      <span class="habit-check-dot" aria-hidden="true"><span class="material-symbols-outlined">check</span></span>
    </button>
  </article></div>`;
}

export function todayView() {
  const now = new Date();
  const day = dateKey();
  const habits = habitsForDate(state, day);
  const completion = todayCompletion(state, day);
  const streak = activeStreak(state, day);
  const todos = todosForDate(state, day);
  const encouragement = state.settings?.aiDailyEncouragement;
  const mottoText = encouragement?.date === day && encouragement.text ? encouragement.text : state.profile.motto;
  const doneTodos = todos.filter(todo => todo.completed).length;
  const earlierTodos = state.todos.filter(todo => !todo.completed && todo.date < day).length;
  const photoEntries = state.snippets.filter(entry => entry.type === 'photo' && (entry.photos?.length || entry.photo)).slice(-3);
  const recent = recentActivity().filter(item => item.date === day);
  const habitPercent = completion.total ? Math.round(completion.done / completion.total * 100) : 0;
  photoStackCount = photoEntries.length;
  if (photoStackIndex >= Math.max(1, photoStackCount)) photoStackIndex = 0;
  const enDayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const yearStart = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - yearStart) / 86400000);
  const magazineMonth = pad(now.getMonth() + 1);
  const magazineDay = pad(now.getDate());
  const countdownHtml = countdownBanner();
  const weather = callHelper('weatherDisplay') || { temperature: '--°', label: '点击获取当地天气', icon: 'location_searching', hint: '仅在你点击后请求定位' };
  const weatherIdle = String(weather.temperature || '').startsWith('--');
  const illustratedWeather = /云/.test(String(weather.label || ''));
  const courseHtml = callHelper('todayCoursesHtml') || '';
  const quickFuncs = [
    { action: 'mine', icon: 'person', label: '我的与设置', color: 'var(--terracotta-dark)' },
    { action: 'focus', icon: 'timer', label: '专注工坊', color: '#d48b47' },
    { action: 'statistics', icon: 'monitoring', label: '复盘统计', color: 'var(--sage-green-dark)' },
    { action: 'library', icon: 'auto_stories', label: '书影音', color: '#6b5e51' }
  ];
  const customCover = state.settings?.todayCoverImage || '';
  return `<section class="view today-view">
    <div class="today-editorial-cover">
      <span class="editorial-paperclip-corner" aria-hidden="true"></span>
      <span class="editorial-spine" aria-hidden="true">ISSUE ${dayOfYear} · MINE TODAY</span>
      <header class="magazine-header">
        <div class="magazine-brand-line"><span class="magazine-brand">Warm Life Journal</span><span class="magazine-issue-badge">N° ${dayOfYear}</span></div>
        <div class="magazine-title-date" id="today-date-secret"><span class="date-year">${now.getFullYear()}</span><span class="date-num"><b>${magazineMonth}</b><i>/</i><b>${magazineDay}</b></span><span class="date-name">${enDayNames[now.getDay()]} / 星期${WEEK_DAYS[now.getDay()]}</span></div>
        <p class="editorial-cover-motto">把每个今天，过成故事。</p>
      </header>
      <button type="button" class="editorial-hero-image ${customCover ? 'has-custom-cover' : ''}" id="today-cover-photo" aria-label="${customCover ? '轻触更换首页封面照片' : '轻触自定义首页封面照片'}">${customCover ? `<img src="${imgSrc(customCover)}" alt="自定义首页封面照片">` : ''}</button>
      <input type="file" id="today-cover-input" accept="image/jpeg,image/png,image/webp" hidden>
    </div>
    <section class="magazine-hero" aria-label="今日天气与快捷记录">
      <button class="weather-box ${weatherIdle ? 'is-idle' : ''}" id="refresh-weather" aria-label="${weather.hint}"><div class="weather-temp-row">${illustratedWeather ? '<img class="weather-art" src="assets/today-weather-illustration.png" alt="">' : `<span class="material-symbols-outlined weather-icon-glow">${weather.icon}</span>`}<span class="weather-temp">${weatherIdle ? '当地' : weather.temperature}</span><span class="weather-copy"><strong class="weather-desc">${weatherIdle ? '点击获取天气' : weather.label}</strong><small><span class="material-symbols-outlined" aria-hidden="true">sync</span></small></span></div></button>
      <div class="today-hero-actions">
        <button class="hero-icon-btn btn-snap" id="btn-snap" aria-label="随手拍"><span class="material-symbols-outlined">photo_camera</span><small>拍照</small></button>
        <button class="hero-icon-btn btn-memo" id="btn-memo" aria-label="随手记"><span class="material-symbols-outlined">edit_note</span><small>记一笔</small></button>
        <button class="hero-icon-btn btn-ai" id="btn-ai" aria-label="AI 伴侣"><span class="material-symbols-outlined hero-ai-robot" aria-hidden="true">auto_awesome</span><small>AI 助手</small><span class="ai-active-dot"></span></button>
      </div>
    </section>
    <div class="stream-sheet today-stream-sheet"><div class="sheet-handle"></div>
    ${courseHtml}
    <div id="countdown-banner">${countdownHtml || '<button type="button" class="countdown-empty-ticket" id="open-countdown-banner" aria-label="添加倒数日"><span class="material-symbols-outlined" aria-hidden="true">flag</span><span class="countdown-empty-copy"><strong>还没有重要倒数日</strong><small>添加倒数日，记录值得期待的日子</small></span><span class="countdown-empty-chevron material-symbols-outlined" aria-hidden="true">chevron_right</span></button>'}<span class="countdown-folio" aria-hidden="true">NO.<b>${dayOfYear}</b></span></div>
    <div class="today-bento-grid">
      <span class="bento-botanical bento-botanical-left" aria-hidden="true"></span><span class="bento-botanical bento-botanical-right" aria-hidden="true"></span>
      <div class="bento-card habits-bento-card">
        <div>
          <div class="bento-header"><span class="bento-title"><span class="material-symbols-outlined">eco</span> 习惯</span><span class="bento-badge-sm" id="habits-bento-badge">${completion.total ? `${completion.done}/${completion.total} · ${habitPercent}%` : '无安排'}</span></div>
          <div id="habits-bento-list">${habits.length ? habits.map(habit => habitCardHtml(habit, day)).join('') : `<p class="bento-empty">今天没有安排习惯</p>`}</div>
        </div>
        <button type="button" class="bento-card-footer" id="open-habit-detail-today"><span>今日 <b>${completion.done}</b>/${completion.total || 0} · 节奏 <b>${streak}</b> 天</span><span class="material-symbols-outlined">chevron_right</span></button>
      </div>
      <div class="bento-card todos-bento-card">
        <div>
          <div class="bento-header"><span class="bento-title"><span class="material-symbols-outlined">checklist</span> 待办</span><span class="bento-badge-sm">${doneTodos}/${todos.length} 完成</span><button type="button" class="bento-header-action" id="open-todo-manager" aria-label="查看全部待办"><span class="material-symbols-outlined">list</span></button></div>
          <div id="todos-bento-list">${todos.length ? todos.map(todo => `<button type="button" class="bento-item-mini ${todo.completed ? 'done' : ''}" data-toggle-todo="${todo.id}"><span class="bento-item-icon material-symbols-outlined">${todo.completed ? 'task_alt' : 'assignment'}</span><span class="bento-item-copy"><strong>${esc(todo.title)}</strong></span><span class="material-symbols-outlined bento-item-check">${todo.completed ? 'check_circle' : 'radio_button_unchecked'}</span></button>`).join('') : `<p class="bento-empty">今天还没有待办</p>`}</div>${earlierTodos ? `<button type="button" class="today-earlier-todos" id="today-earlier-todos">之前还有 ${earlierTodos} 件没做完 · 整理清单</button>` : ''}
        </div>
        <button type="button" class="bento-card-footer" id="new-todo"><span>新增今日待办</span><span class="material-symbols-outlined">add</span></button>
      </div>
    </div>
    <section class="today-life-stream-section">
      <div class="today-section-layer-header life-stream-heading"><span class="section-layer-title-wrap"><span class="section-layer-title">Life Stream / 当天活动</span></span><button type="button" class="section-layer-more" id="life-stream-more">更多 <span class="material-symbols-outlined">chevron_right</span></button></div>
      <div class="timeline" id="today-timeline-stream">${recent.length ? recent.map(timelineNode).join('') : `<div class="life-stream-empty"><span class="life-stream-empty-icon"><span class="life-stream-glyph material-symbols-outlined" aria-hidden="true">history_toggle_off</span></span><span><strong>今天还很安静</strong><small>完成一次专注、打卡或记录后，时光会在这里留下足迹</small></span></div>`}</div>
    </section>
    <div class="today-photo-feature"><div class="today-photo-feature-head"><span>Photo Story / 今日画页</span><small id="photo-stack-hint">轻触照片切换</small></div>${photoStackHtml(photoEntries)}<div class="stack-indicator"><span>PHOTO NOTES · ${photoEntries.length || 0}</span></div><div class="washi-tape-note"><div class="washi-quote" id="motto-track">“${esc(mottoText || '把今天认真地生活下来。')}”</div></div></div>
    <div class="today-section-layer-header quick-access-heading"><span class="section-layer-title-wrap"><span class="section-layer-title">Quick Access / 快捷入口</span></span><small class="section-layer-hint">核心工具</small></div>
    <div class="quick-access-grid">${quickFuncs.map(item => `<button class="qa-card" data-func-action="${item.action}"><span class="material-symbols-outlined" style="color:${item.color}">${item.icon}</span><span>${item.label}</span></button>`).join('')}</div>
    </div>
  </section>`;
}

// 拍立得照片堆叠（#photo-stack）
function photoStackHtml(entries) {
  if (!entries.length) return `<div class="photo-stack-container photo-stack-empty" id="photo-stack"><span class="material-symbols-outlined">photo_camera</span><small>还没有随手拍，拍下第一张吧</small></div>`;
  const count = entries.length;
  const showCount = Math.min(3, count);
  return `<div class="photo-stack-container" id="photo-stack"><div class="stack-stagger" style="transform:rotate(${photoStackIndex % 2 ? 1.2 : -1.2}deg)">${Array.from({ length: showCount }, (_, i) => {
    const entry = entries[(photoStackIndex + i) % count];
    const photo = entry.photos?.length ? entry.photos[0] : entry.photo;
    const time = entry.createdAt ? new Date(entry.createdAt) : null;
    const timeText = time ? `${time.getMonth() + 1}/${time.getDate()} ${pad(time.getHours())}:${pad(time.getMinutes())}` : '';
    return `<button type="button" class="stack-card card-pos-${i}" id="card-${i}" data-photo-stack-entry="${esc(entry.id)}"><span class="polaroid-frame">${photoStoryImage(photo, entry.text || '随手拍')}</span><span class="polaroid-meta"><span class="polaroid-time">${timeText}</span><span class="polaroid-caption">${handwrittenCaptionHtml(entry.text || '随手拍')}</span></span></button>`;
  }).join('')}</div><div class="stack-dots">${Array.from({ length: count }, (_, i) => `<span class="stack-dot ${i === photoStackIndex % count ? 'active' : ''}" data-stack-dot="${i}"></span>`).join('')}</div></div>`;
}

/* 与随手拍照片格同一套（见 snippets.js 的 snippetPhotoImage）：
   不论横竖，都进同一个相框。底层同一张图放大虚化铺满，上层 contain 完整居中。
   两层同地址，浏览器只下载一次。不再按横图、竖图分两套留白。 */
function photoStoryImage(source, alt = '') {
  const url = imgSrc(source);
  return `<img class="polaroid-blur" src="${url}" alt="" aria-hidden="true"><img class="polaroid-img" src="${url}" alt="${esc(alt)}">`;
}

function handwrittenCaptionHtml(text) {
  return esc(String(text || ''));
}

function switchPhotoStack(nextIndex, preferredDirection = '') {
  if (!photoStackCount) return;
  const stack = $('#photo-stack');
  if (!stack) return;
  const previousIndex = photoStackIndex;
  photoStackIndex = (Number(nextIndex) + photoStackCount) % photoStackCount;
  const direction = preferredDirection || (photoStackIndex >= previousIndex ? 'next' : 'previous');
  const entries = state.snippets.filter(entry => entry.type === 'photo' && (entry.photos?.length || entry.photo)).slice(-3);
  const temp = document.createElement('div');
  temp.innerHTML = photoStackHtml(entries);
  const wrap = temp.querySelector('.stack-stagger');
  const dots = temp.querySelector('.stack-dots');
  if (wrap && dots) {
    stack.classList.remove('switch-next', 'switch-previous');
    stack.innerHTML = wrap.outerHTML + dots.outerHTML;
    void stack.offsetWidth;
    stack.classList.add(direction === 'next' ? 'switch-next' : 'switch-previous');
    setTimeout(() => stack.classList.remove('switch-next', 'switch-previous'), 520);
  }
  const hint = $('#photo-stack-hint');
  if (hint) hint.textContent = `第 ${photoStackIndex + 1}/${photoStackCount} 张 · 轻触继续切换`;
}

function cyclePhotoStack() {
  switchPhotoStack(photoStackIndex + 1, 'next');
}

// 时光动态轴（#today-timeline-stream）
function timelineNode(item) {
  // 版本更新动态：自带说明和演示图，走专属卡片，点了打开版本说明（不跳日历）。
  if (item.type === '更新' && item.release) return releaseNode(item);
  const typeAliases = { focus: 'focus', 专注: 'focus', habit: 'habit', 习惯: 'habit', journal: 'journal', 日记: 'journal', note: 'note', 随手记: 'note', photo: 'photo', 随手拍: 'photo', todo: 'todo', 待办: 'todo', book: 'book', 书籍: 'book', movie: 'movie', 电影: 'movie', media: 'media', 书影音: 'media', expense: 'expense', 支出: 'expense', income: 'income', 收入: 'income' };
  const type = typeAliases[item.type] || 'neutral';
  const meta = {
    focus: ['timer', '专注', 'sage'], habit: ['task_alt', '习惯', 'sage'],
    journal: ['auto_stories', '日记', 'terracotta'], note: ['edit_note', '随手记', 'terracotta'], photo: ['photo_camera', '随手拍', 'ochre'],
    todo: ['checklist', '待办', 'gold'], book: ['menu_book', '书籍', 'brown'], movie: ['movie', '电影', 'brown'], media: ['collections_bookmark', '书影音', 'brown'], expense: ['currency_yen', '支出', 'sage'], income: ['payments', '收入', 'sage'],
    neutral: ['history', '记录', 'neutral']
  }[type];
  const time = item.time ? new Date(item.time) : new Date();
  const timeText = `${pad(time.getHours())}:${pad(time.getMinutes())}`;
  const prefix = `${meta[1]} · `;
  const title = String(item.text || meta[1]).startsWith(prefix) ? String(item.text).slice(prefix.length) : item.text;
  return `<div class="timeline-node life-stream-node tone-${meta[2]}"><button type="button" class="life-stream-card" data-timeline-day="${item.date}" aria-label="查看${esc(meta[1])}记录：${esc(title)}"><span class="life-stream-icon"><span class="life-stream-glyph material-symbols-outlined" aria-hidden="true">${meta[0]}</span></span><span class="life-stream-copy"><strong>${esc(title)}</strong><small>${meta[1]} · ${item.date.slice(5)}</small></span><time class="life-stream-time" datetime="${item.date}T${timeText}">${timeText}</time><span class="life-stream-chevron material-symbols-outlined" aria-hidden="true">chevron_right</span></button></div>`;
}

// 版本更新动态卡片：标题 + 一句摘要 + 首张演示图缩略，点开看完整说明。
function releaseNode(item) {
  const release = item.release;
  const timeText = formatShanghaiClock(item.time) || '--:--';
  const dateTime = timeText === '--:--' ? item.date : `${item.date}T${timeText}+08:00`;
  const shot = release.screenshots?.[0] || '';
  return `<div class="timeline-node life-stream-node tone-sage life-stream-release"><button type="button" class="life-stream-card life-stream-release-card${shot ? ' has-shot' : ''}" data-release-code="${Number(release.code) || ''}" aria-label="查看 ${esc(release.versionName)} 更新说明：${esc(release.title)}"><span class="life-stream-icon"><span class="life-stream-glyph material-symbols-outlined" aria-hidden="true">new_releases</span></span><span class="life-stream-copy"><strong>${esc(release.title)}</strong><small>更新到 ${esc(release.versionName)} · ${esc(release.summary)}</small></span>${shot ? `<img class="life-stream-release-shot" src="${imgSrc(shot)}" alt="" loading="lazy">` : ''}<time class="life-stream-time" datetime="${dateTime}">${timeText}</time><span class="life-stream-chevron material-symbols-outlined" aria-hidden="true">chevron_right</span></button></div>`;
}

async function updateTodayCover(file) {
  if (!file) return;
  if (!isSupportedJournalPhoto(file)) return show('请选择 JPG、PNG 或 WebP 图片');
  if (file.size > 20 * 1024 * 1024) return show('封面照片不能超过 20MB');
  const image = new Image();
  image.src = URL.createObjectURL(file);
  try { await image.decode(); }
  catch { URL.revokeObjectURL(image.src); throw new Error('无法读取这张照片'); }
  const frame = $('#today-cover-photo')?.getBoundingClientRect();
  const ratio = frame?.width > 20 && frame?.height > 20 ? frame.width / frame.height : 1.08;
  todayCoverCropState = { image, source: image.src, ratio, zoom: 1, x: 0, y: 0, dragging: false, pointerX: 0, pointerY: 0 };
  openTodayCoverCrop();
}

function openTodayCoverCrop() {
  const ratio = todayCoverCropState?.ratio || 1.08;
  const width = 320;
  const height = Math.round(width / ratio);
  modal(`<div class="today-cover-crop-modal"><span class="eyebrow">COVER FRAME</span><h2>框选首页封面范围</h2><p class="subtle">拖动照片选择画面，使用滑杆缩放。框内区域就是首页固定封面，不会随原图长宽改变。</p><div class="today-cover-crop-stage" style="--cover-crop-ratio:${ratio}"><canvas id="today-cover-crop-canvas" width="${width}" height="${height}" aria-label="首页封面裁切预览"></canvas><span class="today-cover-crop-guide" aria-hidden="true"></span></div><label class="today-cover-zoom"><span class="material-symbols-outlined">image</span><input id="today-cover-zoom" type="range" min="1" max="4" step="0.01" value="1" aria-label="封面照片缩放"><span class="material-symbols-outlined">zoom_in</span></label><button type="button" id="today-cover-center" class="today-cover-center"><span class="material-symbols-outlined">center_focus_strong</span>恢复居中</button><div class="modal-actions"><button type="button" id="today-cover-crop-cancel">取消</button><button type="button" class="save" id="today-cover-crop-apply">使用框选区域</button></div></div>`, 'today-cover-crop-dialog');
  bindTodayCoverCrop();
}

function todayCoverCropGeometry(width, height) {
  const crop = todayCoverCropState;
  const previewWidth = 320;
  const previewHeight = previewWidth / crop.ratio;
  const base = Math.max(previewWidth / crop.image.naturalWidth, previewHeight / crop.image.naturalHeight);
  const imageWidth = crop.image.naturalWidth * base * crop.zoom;
  const imageHeight = crop.image.naturalHeight * base * crop.zoom;
  const maxX = Math.max(0, (imageWidth - previewWidth) / 2);
  const maxY = Math.max(0, (imageHeight - previewHeight) / 2);
  crop.x = Math.max(-maxX, Math.min(maxX, crop.x));
  crop.y = Math.max(-maxY, Math.min(maxY, crop.y));
  return { width: imageWidth * width / previewWidth, height: imageHeight * height / previewHeight, left: (width - imageWidth * width / previewWidth) / 2 + crop.x * width / previewWidth, top: (height - imageHeight * height / previewHeight) / 2 + crop.y * height / previewHeight };
}

function drawTodayCoverCrop() {
  const canvas = $('#today-cover-crop-canvas');
  if (!canvas || !todayCoverCropState) return;
  const geometry = todayCoverCropGeometry(canvas.width, canvas.height);
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(todayCoverCropState.image, geometry.left, geometry.top, geometry.width, geometry.height);
}

function bindTodayCoverCrop() {
  const canvas = $('#today-cover-crop-canvas');
  drawTodayCoverCrop();
  canvas.onpointerdown = event => {
    todayCoverCropState.dragging = true;
    todayCoverCropState.pointerX = event.clientX;
    todayCoverCropState.pointerY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = event => {
    if (!todayCoverCropState?.dragging) return;
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    todayCoverCropState.x += (event.clientX - todayCoverCropState.pointerX) * scale;
    todayCoverCropState.y += (event.clientY - todayCoverCropState.pointerY) * scale;
    todayCoverCropState.pointerX = event.clientX;
    todayCoverCropState.pointerY = event.clientY;
    drawTodayCoverCrop();
  };
  canvas.onpointerup = canvas.onpointercancel = () => { if (todayCoverCropState) todayCoverCropState.dragging = false; };
  $('#today-cover-zoom').oninput = event => { todayCoverCropState.zoom = Number(event.target.value); drawTodayCoverCrop(); };
  $('#today-cover-center').onclick = () => { todayCoverCropState.zoom = 1; todayCoverCropState.x = 0; todayCoverCropState.y = 0; $('#today-cover-zoom').value = '1'; drawTodayCoverCrop(); };
  $('#today-cover-crop-cancel').onclick = () => finishTodayCoverCrop(false);
  $('#today-cover-crop-apply').onclick = () => finishTodayCoverCrop(true).catch(error => show(error.message));
}

async function finishTodayCoverCrop(apply) {
  const crop = todayCoverCropState;
  if (!crop) return;
  if (apply) {
    const output = document.createElement('canvas');
    output.width = 1200;
    output.height = Math.round(output.width / crop.ratio);
    const geometry = todayCoverCropGeometry(output.width, output.height);
    output.getContext('2d').drawImage(crop.image, geometry.left, geometry.top, geometry.width, geometry.height);
    state.settings.todayCoverImage = output.toDataURL('image/jpeg', .88);
    await save();
  }
  URL.revokeObjectURL(crop.source);
  todayCoverCropState = null;
  closeModal();
  render();
  if (apply) show('首页封面已按框选区域更新');
}

// 今日鼓励小字溢出滚动（marquee：溢出时双份无缝循环，短文本保持静态）
// 容器是 .washi-tape-note 里的 .washi-quote；旧实现抓的是不存在的 #today-motto，
// 所以滚动动画与 AI 每日鼓励都从未生效过（AI 文案拿到后被静默丢弃）。
function syncMottoMarquee() {
  const p = $('#motto-track');
  if (!p) return;
  const first = p.querySelector('.marquee-track span');
  const plain = first ? first.textContent : p.textContent;
  if (!plain) return;
  p.classList.remove('marquee');
  p.style.removeProperty('--marquee-duration');
  p.textContent = plain;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
  if (p.scrollWidth <= p.clientWidth + 1) return;
  const duration = Math.max(10, Math.min(16, Math.round(plain.length * 0.35)));
  p.classList.add('marquee');
  p.style.setProperty('--marquee-duration', `${duration}s`);
  p.innerHTML = `<span class="marquee-track"><span>${esc(plain)}</span><span aria-hidden="true">${esc(plain)}</span></span>`;
}

// Today 只负责选择真实习惯并交给岗位①的公开详情 helper。
function todayHabitDetailTarget() {
  const day = dateKey();
  const activeHabits = state.habits.filter(habit => !habit.archived);
  const checks = state.checks?.[day] || {};
  const checked = activeHabits
    .map((habit, index) => ({ habit, index, progress: Number(checks[habit.id] || 0) }))
    .filter(item => Number.isFinite(item.progress) && item.progress > 0)
    .sort((left, right) => right.progress - left.progress || left.index - right.index);
  if (checked.length) return checked[0].habit;
  const scheduled = new Set(habitsForDate(state, day).map(habit => habit.id));
  return activeHabits.find(habit => scheduled.has(habit.id)) || activeHabits[0] || null;
}

// ---- 绑定 ----
function bindToday() {
  bindPrivateVaultDateHold();
  $('#refresh-weather')?.addEventListener('click', () => callHelper('refreshWeather')?.catch(error => show(error.message)));
  $('#open-timetable')?.addEventListener('click', () => callHelper('openTimetable'));
  $('#btn-snap')?.addEventListener('click', () => callHelper('openQuickPhotoModal'));
  $('#btn-memo')?.addEventListener('click', () => callHelper('openQuickMemoModal'));
  $('#btn-ai')?.addEventListener('click', () => go('ai'));
  $('#today-cover-photo')?.addEventListener('click', () => $('#today-cover-input')?.click());
  $('#today-cover-input')?.addEventListener('change', event => updateTodayCover(event.target.files?.[0]).catch(error => show(error.message)));
  $('#open-habit-detail-today')?.addEventListener('click', () => {
    const habit = todayHabitDetailTarget();
    if (!habit) return show('请先创建习惯');
    callHelper('openHabitDetail', habit.id);
  });
  $('#open-countdown-banner')?.addEventListener('click', () => { pushBackState(); go('countdown'); });
  // 今日页待办卡片：新增 + 查看全部（这两个按钮此前都渲染了但从未绑定，点了没反应）。
  $('#new-todo')?.addEventListener('click', () => callHelper('openTodoForm'));
  $('#open-todo-manager')?.addEventListener('click', () => callHelper('openTodoManager'));
  $('#today-earlier-todos')?.addEventListener('click', () => callHelper('openTodoManager'));
  $('#life-stream-more')?.addEventListener('click', () => go('calendar'));
  $('#today-avatar')?.addEventListener('click', () => go('mine'));
  $('#photo-stack')?.addEventListener('click', event => {
    // Today 的照片区只负责切图；放大查看由 Moments/Library 等专属入口提供。
    // 圆点有自己的精确索引操作，避免冒泡后又额外切换一次。
    if (event.target.closest('[data-stack-dot]')) return;
    cyclePhotoStack();
  });
  $$('[data-stack-dot]').forEach(dot => dot.onclick = event => { event.stopPropagation(); switchPhotoStack(Number(dot.dataset.stackDot)); });
  $$('[data-timeline-day]').forEach(button => button.onclick = () => go('calendar', button.dataset.timelineDay));
  // 版本更新动态：点卡片打开版本说明（不跳日历）。
  $$('[data-release-code]').forEach(button => button.onclick = () => openReleaseNotes(button.dataset.releaseCode));
  // AI 每日鼓励：只读当天已生成的缓存（生成侧由用户显式触发，不在渲染时联网），
  // 无缓存时保留用户自己写的格言。
  callHelper('aiDailyEncouragement')?.then(text => {
    if (!text) return;
    const p = $('#motto-track');
    if (!p) return;
    p.textContent = text;
    syncMottoMarquee();
  }).catch(() => {});
  $$('[data-func-action]').forEach(button => button.onclick = () => {
    const action = button.dataset.funcAction;
    if (action === 'library' || action === 'documents' || action === 'countdown' || action === 'snippets') pushBackState();
    go(action);
  });
  syncMottoMarquee();
}

function bindPrivateVaultDateHold() {
  const target = $('#today-date-secret');
  if (!target) return;
  let hold = null;
  const cancel = () => {
    if (hold?.timer) clearTimeout(hold.timer);
    hold = null;
  };
  target.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    cancel();
    hold = { x: event.clientX, y: event.clientY, timer: setTimeout(() => {
      hold = null;
      navigator.vibrate?.(35);
      pushBackState();
      go('private-vault');
    }, PRIVATE_VAULT_HOLD_MS) };
  });
  target.addEventListener('pointermove', event => {
    if (!hold) return;
    if (Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > PRIVATE_VAULT_MOVE_TOLERANCE) cancel();
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) target.addEventListener(type, cancel);
  target.addEventListener('contextmenu', event => event.preventDefault());
}

registerView('today', todayView);
registerBinder(bindToday);
