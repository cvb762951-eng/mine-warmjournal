import { $, $$, state, save, render, go, show, modal, confirmDelete, imgSrc, esc, uid, pushBackState, registerView, registerBinder, registerSubmitHandler, registerHelper, callHelper } from '../core.js';
import { daysUntil, makeCountdown } from '../model.js';
import { countdownWidgetSnapshot } from '../countdown-days.js';
import { updateCountdownWidget } from '../notifications.js';
import { compressPhoto, isSupportedJournalPhoto } from '../photo-utils.js';

// ---- 倒数日模块本地状态 ----
let pendingCountdownImage = '';

// ---- 视图 ----
export function countdownView() {
  const items = [...state.countdowns].sort((a, b) => {
    const da = daysUntil(a.date), db = daysUntil(b.date);
    if (da >= 0 && db >= 0) return da - db;
    if (da < 0 && db < 0) return db - da;
    return db - da;
  });
  return `<section class="view countdown-view"><div class="countdown-intro"><span class="eyebrow">COUNTDOWN</span><h2>重要的日子<br>值得倒数</h2><p>为考试、纪念日、旅行设定倒数，配上照片让期待更有画面感。</p></div>${items.length ? `<div class="countdown-grid">${items.map(countdownCard).join('')}</div>` : `<div class="countdown-empty"><span class="material-symbols-outlined">event</span><strong>还没有倒数日</strong><p>点击右上角 + 添加第一个值得期待的日子。</p></div>`}</section>`;
}

function countdownCard(entry) {
  const days = daysUntil(entry.date);
  const date = new Date(`${entry.date}T12:00:00`);
  const dateLabel = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  const past = days < 0;
  const isToday = days === 0;
  const number = Math.abs(days);
  const unitLabel = isToday ? '就是今天' : (past ? '天前' : '天后');
  const flag = isToday ? '今天' : (past ? '已过去' : '倒数中');
  const image = entry.image ? `<img src="${imgSrc(entry.image)}" alt="${esc(entry.title)}背景图">` : '';
  const pinned = entry.showOnHome !== false;
  return `<article class="countdown-card ${past ? 'past' : ''} ${entry.image ? 'has-image' : ''}" data-edit-countdown="${entry.id}">${image}<div class="countdown-shade"></div><div class="countdown-card-body"><div class="countdown-card-top"><strong class="countdown-title">${esc(entry.title)}</strong><span class="countdown-card-badges"><button class="countdown-pin ${pinned ? 'pinned' : ''}" data-toggle-home-countdown="${entry.id}" aria-label="${pinned ? '已展示到首页，点击取消' : '未展示到首页，点击展示'}"><span class="material-symbols-outlined">push_pin</span></button><span class="countdown-flag">${flag}</span></span></div><div class="countdown-number"><b>${number}</b><small>${unitLabel}</small></div><div class="countdown-card-bottom"><time>${dateLabel}</time>${entry.note ? `<p>${esc(entry.note)}</p>` : ''}</div></div></article>`;
}

// ---- 表单与图片选择 ----
export function countdownForm(entry = null) {
  const item = entry || makeCountdown({});
  pendingCountdownImage = item.image || '';
  modal(`<form id="countdown-form"><input type="hidden" name="id" value="${item.id}"><h2>${entry ? '编辑倒数日' : '新建倒数日'}</h2><label>标题</label><input name="title" maxlength="40" required value="${esc(item.title)}" placeholder="例如：考研、生日、旅行"><label>目标日期</label><input name="date" type="date" required value="${item.date}"><label>备注（可选）</label><input name="note" maxlength="200" value="${esc(item.note)}" placeholder="一句话说说这个日子的意义"><label class="confirm-line"><input name="showOnHome" type="checkbox" ${item.showOnHome !== false ? 'checked' : ''}> 展示到首页</label><div class="countdown-image-picker"><div><strong>背景图</strong><small>让倒数日更有画面感</small></div><button type="button" id="pick-countdown-image"><span class="material-symbols-outlined">photo_library</span>${pendingCountdownImage ? '更换图片' : '选择图片'}</button></div><div id="countdown-image-preview">${countdownImagePreview()}</div><div class="modal-actions"><button type="button" data-close>取消</button>${entry ? '<button type="button" class="danger" id="delete-countdown">删除</button>' : ''}<button class="save">保存</button></div></form>`, 'countdown-form-modal');
  $('#pick-countdown-image')?.addEventListener('click', () => pickCountdownImage().catch(error => show(error.message)));
  $('#delete-countdown')?.addEventListener('click', () => confirmDelete('删除这个倒数日？', async () => {
    state.countdowns = state.countdowns.filter(item => item.id !== entry.id);
    await save();
    syncCountdownWidget();
    const alarm = await callHelper('syncCountdownNodeAlarms', { requestPermission: false });
    render();
    callHelper('scheduleAiRefresh');
    if (alarm?.ok === false && alarm.lastError) show(`已删除。${alarm.lastError}`);
  }));
}

function countdownImagePreview() {
  return pendingCountdownImage
    ? `<div class="countdown-image-preview has-image"><img src="${imgSrc(pendingCountdownImage)}" alt="背景图预览"><button type="button" id="remove-countdown-image">移除</button></div>`
    : '<div class="countdown-image-preview"><span class="material-symbols-outlined">image</span><small>还没有背景图</small></div>';
}

function refreshCountdownImagePreview() {
  const preview = $('#countdown-image-preview');
  if (preview) preview.innerHTML = countdownImagePreview();
  $('#remove-countdown-image')?.addEventListener('click', () => { pendingCountdownImage = ''; refreshCountdownImagePreview(); });
}

function pickCountdownImage() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) return resolve();
        if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过 20MB');
        if (!isSupportedJournalPhoto(file)) throw new Error('仅支持 JPG、PNG 或 WebP 图片');
        pendingCountdownImage = await compressPhoto(file);
        refreshCountdownImagePreview();
        resolve();
      } catch (error) { reject(error); }
    };
    input.click();
  });
}

// ---- 表单提交（供 app.js 的统一 submit 处理器调用）----
export function saveCountdownForm(data) {
  const existing = state.countdowns.find(entry => entry.id === data.get('id'));
  const next = makeCountdown({ ...existing, id: existing?.id || uid(), title: data.get('title'), date: data.get('date'), note: data.get('note'), image: pendingCountdownImage, showOnHome: data.get('showOnHome') === 'on', createdAt: existing?.createdAt, updatedAt: Date.now() });
  existing ? Object.assign(existing, next) : state.countdowns.push(next);
}

export function resetCountdownImage() { pendingCountdownImage = ''; }

// ---- 首页横幅与桌面 Widget ----
export function countdownBanner() {
  const visible = state.countdowns.filter(entry => entry.showOnHome !== false);
  const upcoming = visible.filter(entry => daysUntil(entry.date) >= 0).sort((a, b) => daysUntil(a.date) - daysUntil(b.date)).slice(0, 3);
  const past = visible.filter(entry => daysUntil(entry.date) < 0).sort((a, b) => daysUntil(b.date) - daysUntil(a.date)).slice(0, 1);
  const cards = [...upcoming, ...past];
  if (!cards.length) return '';
  return `<div class="countdown-banner-strip">${cards.map(entry => {
    const days = daysUntil(entry.date);
    const pastFlag = days < 0;
    const isToday = days === 0;
    const number = Math.abs(days);
    const image = entry.image ? `<img src="${imgSrc(entry.image)}" alt="${esc(entry.title)}">` : '';
    const eyebrow = isToday ? 'COUNTDOWN · 今天' : (pastFlag ? '已经过去' : 'COUNTDOWN · 距离');
    return `<button class="countdown-banner ${pastFlag ? 'past' : ''} ${entry.image ? 'has-image' : ''}" data-open-countdown>${image}<div class="countdown-banner-shade"></div><div class="countdown-banner-copy"><span class="eyebrow">${eyebrow}</span><strong>${esc(entry.title)}</strong></div><div class="countdown-banner-days">${isToday ? '<b>今天</b>' : `<b>${number}</b><small>天</small>`}</div></button>`;
  }).join('')}</div>`;
}

export function syncCountdownWidget() {
  // 只推标题、日期和算天数需要的字段，天数由原生按当天自己算。
  updateCountdownWidget(countdownWidgetSnapshot(state.countdowns, state.settings?.theme)).catch(() => {});
}

export function openCountdownDetail(id = '') {
  const entry = id ? state.countdowns.find(item => item.id === id) : null;
  pushBackState();
  go('countdown');
  if (entry) countdownForm(entry);
}

// ---- 绑定 ----
function bindCountdown() {
  $('#new-countdown-head')?.addEventListener('click', () => countdownForm());
  $$('[data-edit-countdown]').forEach(button => button.onclick = () => countdownForm(state.countdowns.find(entry => entry.id === button.dataset.editCountdown)));
  $$('[data-open-countdown]').forEach(button => button.onclick = () => { pushBackState(); go('countdown'); });
  $$('[data-toggle-home-countdown]').forEach(button => button.onclick = async () => {
    const entry = state.countdowns.find(item => item.id === button.dataset.toggleHomeCountdown);
    if (!entry) return;
    entry.showOnHome = entry.showOnHome === false;
    await save();
    render();
    show(entry.showOnHome ? '已展示到首页' : '已从首页隐藏');
  });
}

// ---- 注册视图 ----
registerView('countdown', countdownView);
registerBinder(bindCountdown);
registerHelper('syncCountdownWidget', syncCountdownWidget);
registerHelper('openCountdownDetail', openCountdownDetail);

// ---- 表单提交 ----
registerSubmitHandler('countdown-form', async data => {
  saveCountdownForm(data);
  resetCountdownImage();
  syncCountdownWidget();
  callHelper('scheduleAiRefresh');
  const alarm = await callHelper('syncCountdownNodeAlarms', { requestPermission: true, userInitiated: true });
  if (alarm?.ok === false && alarm.lastError) return `倒数日已保存，节点提醒没排上：${alarm.lastError}`;
});
