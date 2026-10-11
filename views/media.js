import { $, $$, esc, uid, state, save, render, modal, closeModal, show, confirmDelete, imgSrc, emptyState, formatMinutes, go, registerView, registerBinder, registerSubmitHandler, registerHelper, callHelper, openSubpage } from '../core.js';
import { makeMediaEntry, mediaEntries, dateKey } from '../model.js';
import { mediaStatusLabel, sessionCard, bindRecordActions } from './common.js';
import { mediaFocusSummary } from '../analytics.js';

// ---- 本地状态 ----
let mediaType = 'all';
let mediaStatus = 'all';
let mediaSearch = '';
let pendingPoster = '';
let openMediaDetailId = '';
const isCurrentMediaDetailOpen = id => openMediaDetailId === id && document.getElementById('subpage-media-detail')?.classList.contains('active');

export function libraryView() {
  const entries = mediaEntries(state, { type: mediaType, status: mediaStatus, search: mediaSearch });
  const movieCount = state.media.filter(entry => entry.type === 'movie' && entry.status === 'completed').length;
  const bookCount = state.media.filter(entry => entry.type === 'book' && entry.status === 'completed').length;
  return `<section class="view library-view" id="screen-library">
    <section class="library-intro library-hero-paper">
      <span class="eyebrow">PRIVATE COLLECTION · 私人馆藏</span>
      <h2>书影音档案册</h2>
      <p>把读过与看过的故事，收进自己的纸上书架。</p>
      <div class="library-counts" aria-label="已完成作品统计">
        <span><b>${movieCount}</b><small>部电影看过</small></span>
        <i aria-hidden="true"></i>
        <span><b>${bookCount}</b><small>本书读过</small></span>
      </div>
    </section>
    <section class="media-toolbar library-controls-paper" aria-label="书影音筛选与搜索">
      <div class="media-tabs" role="group" aria-label="作品类型">${[['all', '全部'], ['movie', '电影'], ['book', '书籍']].map(([value, label]) => `<button type="button" data-media-type="${value}" class="${mediaType === value ? 'active' : ''}" aria-pressed="${mediaType === value}">${label}</button>`).join('')}</div>
      <form id="media-search-form" class="media-search" role="search">
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input name="search" value="${esc(mediaSearch)}" placeholder="搜索名称或笔记" aria-label="搜索名称或笔记">
        <button type="submit">查找</button>
      </form>
      <div class="media-statuses" aria-label="作品状态">${[['all', '全部状态'], ['planned', '想看 / 想读'], ['in_progress', '正在进行'], ['completed', '已经完成']].map(([value, label]) => `<button type="button" data-media-status="${value}" class="${mediaStatus === value ? 'active' : ''}" aria-pressed="${mediaStatus === value}">${label}</button>`).join('')}</div>
    </section>
    <section class="stream-sheet library-stream-sheet">
      <div class="sheet-handle" aria-hidden="true"></div>
      <header class="library-stream-head"><div><span class="eyebrow">ARCHIVE SHELF · 馆藏书架</span><h2>我的作品档案</h2></div><small>${entries.length} / ${state.media.length} 条</small></header>
      <div class="media-grid">${entries.length ? entries.map(libraryMediaCard).join('') : `<div class="media-empty"><span class="media-empty-icon material-symbols-outlined">collections_bookmark</span><strong>${state.media.length ? '没有符合条件的记录' : '你的书架还是空的'}</strong><p>${state.media.length ? '换一个筛选条件或关键词试试。' : '添加一部电影或一本书，封面可以稍后再补。'}</p><button type="button" id="new-media-empty"><span class="material-symbols-outlined">add</span>${state.media.length ? '添加新记录' : '添加第一条记录'}</button></div>`}</div>
      <p class="library-local-note"><span class="material-symbols-outlined">lock</span>封面、评分与笔记只保存在本机</p>
    </section>
  </section>`;
}

function libraryMediaCard(entry) {
  const typeLabel = entry.type === 'movie' ? '电影' : '书籍';
  const statusLabel = mediaStatusLabel(entry);
  const cover = entry.poster
    ? `<img src="${imgSrc(entry.poster)}" alt="${esc(entry.title)}封面">`
    : `<div class="media-placeholder"><span class="material-symbols-outlined">${entry.type === 'movie' ? 'movie' : 'menu_book'}</span><small>${typeLabel}</small></div>`;
  const stars = entry.rating
    ? `<span class="media-stars" aria-label="${entry.rating} 星">${'★'.repeat(entry.rating)}${'☆'.repeat(5 - entry.rating)}</span>`
    : '<span class="media-stars muted-stars">尚未评分</span>';
  const focus = mediaFocusSummary(state, entry.id);
  return `<article class="media-card library-media-card" data-open-library-media="${entry.id}" role="button" tabindex="0" aria-label="打开《${esc(entry.title)}》作品档案">
    <div class="media-cover">${cover}<span class="media-type">${typeLabel}</span></div>
    <div class="media-card-copy">
      <div class="media-card-meta"><span class="media-state ${entry.status}">${statusLabel}</span>${entry.completedDate ? `<time datetime="${entry.completedDate}">${entry.completedDate}</time>` : '<time>日期未记录</time>'}</div>
      <h3>《${esc(entry.title)}》</h3>
      ${stars}
      <p>${esc(entry.notes || '还没有写下感受。')}</p>
      ${focus.sessions.length ? `<button type="button" class="media-focus-link" data-media-focus="${entry.id}"><span class="material-symbols-outlined">timer</span>${formatMinutes(focus.minutes)} · ${focus.sessions.length} 次关联专注</button>` : '<small class="media-focus-empty">暂无关联专注</small>'}
      <div class="media-card-actions"><button type="button" data-edit-media="${entry.id}"><span class="material-symbols-outlined">edit</span>编辑</button><button type="button" class="danger" data-delete-media="${entry.id}"><span class="material-symbols-outlined">delete</span>删除</button></div>
    </div>
  </article>`;
}

export function mediaFocusHistory(mediaId) {
  const item = state.media.find(entry => entry.id === mediaId), focus = mediaFocusSummary(state, mediaId);
  modal(`<div class="modal-head"><div><h2>《${esc(item?.title || '书籍')}》</h2><p>累计阅读 ${formatMinutes(focus.minutes)} · ${focus.sessions.length} 次</p></div></div><div class="record-list">${focus.sessions.map(sessionCard).join('') || emptyState('暂无阅读专注', '关联此书的专注记录会归档在这里。')}</div><div class="modal-actions"><button type="button" data-close>关闭</button></div>`, 'large-modal media-history-modal');
  bindRecordActions();
}

export function mediaForm(entry = null) {
  const item = entry || makeMediaEntry({ title: '', type: mediaType === 'book' ? 'book' : 'movie', status: 'planned' });
  pendingPoster = item.poster;
  modal(`<form id="media-form"><input type="hidden" name="id" value="${entry ? item.id : ''}"><div class="modal-head"><div><span class="eyebrow">SHELF ENTRY</span><h2>${entry ? '编辑记录' : '添加到书架'}</h2><p>封面可选，之后随时可以补充或更换。</p></div></div><div class="poster-picker"><button type="button" id="pick-poster" class="poster-preview" aria-label="选择封面">${posterPreview(pendingPoster, item.type)}</button><div><strong>海报 / 封面</strong><small>建议选择竖版图片，保存时会自动压缩。</small><button type="button" id="pick-poster-text" class="text-button">${pendingPoster ? '更换图片' : '从手机选择'}</button>${pendingPoster ? '<button type="button" id="remove-poster" class="text-button danger-text">移除</button>' : ''}</div></div><div class="form-grid"><div><label>类型</label><select name="type" id="media-type-select"><option value="movie" ${item.type === 'movie' ? 'selected' : ''}>电影</option><option value="book" ${item.type === 'book' ? 'selected' : ''}>书籍</option></select></div><div><label>状态</label><select name="status" id="media-status-select"><option value="planned" ${item.status === 'planned' ? 'selected' : ''}>想看 / 想读</option><option value="in_progress" ${item.status === 'in_progress' ? 'selected' : ''}>正在进行</option><option value="completed" ${item.status === 'completed' ? 'selected' : ''}>已经完成</option></select></div></div><label>名称</label><input name="title" maxlength="80" required value="${esc(item.title)}" placeholder="电影名或书名"><div id="media-completed-fields" class="${item.status === 'completed' ? '' : 'form-hidden'}"><div class="form-grid"><div><label>完成日期</label><input name="completedDate" type="date" value="${item.completedDate || dateKey()}"></div><div><label>评分</label><select name="rating">${[[0, '暂不评分'], [1, '★'], [2, '★★'], [3, '★★★'], [4, '★★★★'], [5, '★★★★★']].map(([value, label]) => `<option value="${value}" ${item.rating === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div></div></div><label>笔记</label><textarea name="notes" maxlength="1200" placeholder="写下喜欢的片段、读后感，或为什么想看……">${esc(item.notes)}</textarea><div class="modal-actions"><button type="button" data-close>取消</button><button class="save">保存</button></div></form>`, 'media-form-modal');
  bindMediaForm();
}

async function saveMediaForm(form) {
  const data = new FormData(form);
  const existing = state.media.find(entry => entry.id === data.get('id'));
  const next = makeMediaEntry({ ...existing, id: existing?.id || uid(), type: data.get('type'), title: data.get('title'), status: data.get('status'), completedDate: data.get('completedDate'), rating: data.get('rating'), notes: data.get('notes'), poster: pendingPoster, createdAt: existing?.createdAt, updatedAt: Date.now() });
  existing ? Object.assign(existing, next) : state.media.push(next);
  pendingPoster = '';
  const shouldRefreshDetail = isCurrentMediaDetailOpen(next.id);
  await save(); closeModal(); render(); show('已保存');
  if (shouldRefreshDetail) openMediaDetail(next);
  callHelper('scheduleAiRefresh');
}

async function deleteMediaEntry(id) {
  const shouldCloseDetail = isCurrentMediaDetailOpen(id);
  state.media = state.media.filter(entry => entry.id !== id);
  await save();
  render();
  if (shouldCloseDetail) callHelper('closeSubpage');
  if (openMediaDetailId === id) openMediaDetailId = '';
  callHelper('scheduleAiRefresh');
}

function posterPreview(poster, type = 'movie') {
  return poster ? `<img src="${imgSrc(poster)}" alt="所选封面预览">` : `<span class="material-symbols-outlined">${type === 'book' ? 'menu_book' : 'movie'}</span><small>选择图片</small>`;
}

function bindMediaForm() {
  $('#media-form')?.addEventListener('submit', event => { event.preventDefault(); event.stopPropagation(); saveMediaForm(event.currentTarget).catch(error => show(error.message)); });
  const pick = () => pickPoster().catch(error => show(error.message));
  $('#pick-poster')?.addEventListener('click', pick);
  $('#pick-poster-text')?.addEventListener('click', pick);
  $('#remove-poster')?.addEventListener('click', () => { pendingPoster = ''; refreshPosterPreview(); });
  $('#media-status-select')?.addEventListener('change', event => $('#media-completed-fields').classList.toggle('form-hidden', event.target.value !== 'completed'));
  $('#media-type-select')?.addEventListener('change', event => { if (!pendingPoster) $('#pick-poster').innerHTML = posterPreview('', event.target.value); });
}

function refreshPosterPreview() {
  const form = $('#media-form');
  if (!form) return;
  $('#pick-poster').innerHTML = posterPreview(pendingPoster, new FormData(form).get('type'));
  $('#pick-poster-text').textContent = pendingPoster ? '更换图片' : '从手机选择';
  $('#remove-poster')?.remove();
  if (pendingPoster) $('#pick-poster-text').insertAdjacentHTML('afterend', '<button type="button" id="remove-poster" class="text-button danger-text">移除</button>');
  $('#remove-poster')?.addEventListener('click', () => { pendingPoster = ''; refreshPosterPreview(); });
}

function pickPoster() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) return resolve();
        if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过 20MB');
        pendingPoster = await compressPoster(file);
        refreshPosterPreview();
        resolve();
      } catch (error) { reject(error); }
    };
    input.click();
  });
}

async function compressPoster(file) {
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const maxWidth = 600, maxHeight = 900;
    const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .78);
  } finally { URL.revokeObjectURL(source); }
}

// ---- 绑定 ----
function bindMedia() {
  $('#new-media-head')?.addEventListener('click', () => mediaForm());
  $('#new-media-empty')?.addEventListener('click', () => mediaForm());
  $$('[data-media-type]').forEach(button => button.onclick = () => { mediaType = button.dataset.mediaType; render(); });
  $$('[data-media-status]').forEach(button => button.onclick = () => { mediaStatus = button.dataset.mediaStatus; render(); });
  $$('[data-edit-media]').forEach(button => button.onclick = () => mediaForm(state.media.find(entry => entry.id === button.dataset.editMedia)));
  $$('[data-media-focus]').forEach(button => button.onclick = event => { event.stopPropagation(); mediaFocusHistory(button.dataset.mediaFocus); });
  $$('[data-delete-media]').forEach(button => button.onclick = () => confirmDelete('删除这条书影音记录和本地封面？', () => deleteMediaEntry(button.dataset.deleteMedia)));
  $$('[data-open-library-media]').forEach(card => {
    const open = event => {
      if (event?.target?.closest('button')) return;
      const entry = state.media.find(item => item.id === card.dataset.openLibraryMedia);
      if (entry) openMediaDetail(entry);
    };
    card.onclick = open;
    card.onkeydown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open(event);
    };
  });
}

registerSubmitHandler('media-search-form', async data => {
  mediaSearch = data.get('search').trim(); render();
  return false;
});


function quoteFromNotes(notes) {
  const text = String(notes || '');
  const match = [/“([^”]{2,180})”/, /"([^"\r\n]{2,180})"/, /‘([^’]{2,180})’/, /'([^'\r\n]{2,180})'/]
    .map(pattern => text.match(pattern))
    .find(Boolean);
  return match?.[1]?.trim() || '';
}

function reflectionFromNotes(notes, quote) {
  let reflection = String(notes || '');
  if (quote) {
    for (const wrapped of [`“${quote}”`, `"${quote}"`, `‘${quote}’`, `'${quote}'`]) {
      if (reflection.includes(wrapped)) {
        reflection = reflection.replace(wrapped, '');
        break;
      }
    }
  }
  return reflection.trim();
}

// ---- 书影音档案二级页（原型 #subpage-media-detail；沿用核心 openSubpage 返回栈）----
export function openMediaDetail(entry) {
  if (!entry?.id || !state.media.some(item => item.id === entry.id)) {
    show('没有找到这条书影音记录');
    return false;
  }
  openMediaDetailId = entry.id;
  const typeLabel = entry.type === 'movie' ? '电影' : '书籍';
  const statusLabel = mediaStatusLabel(entry);
  const progress = entry.status === 'completed'
    ? `<div class="media-detail-progress completed"><div class="media-detail-progress-head"><span>作品进度</span><b>已完成 · 100%</b></div><div class="media-detail-progress-track" aria-label="完成进度 100%"><i style="width:100%"></i></div></div>`
    : `<div class="media-detail-progress ${entry.status}"><div class="media-detail-progress-head"><span>作品进度</span><b>${entry.status === 'in_progress' ? `${entry.type === 'movie' ? '观看中' : '阅读中'} · 进度未记录` : '计划中'}</b></div><small>${entry.status === 'in_progress' ? '当前数据契约未记录数字进度' : '开始后再记录真实进度'}</small></div>`;
  const stars = entry.rating ? `<span class="media-detail-stars" aria-label="${entry.rating} 星">${'★'.repeat(entry.rating)}${'☆'.repeat(5 - entry.rating)} <b>${entry.rating}.0</b></span>` : '<span class="media-detail-stars muted">尚未评分</span>';
  const cover = entry.poster ? `<img src="${imgSrc(entry.poster)}" alt="${esc(entry.title)}封面">` : '<div class="media-detail-cover-ph"><span class="material-symbols-outlined">' + (entry.type === 'movie' ? 'movie' : 'menu_book') + '</span><small>' + typeLabel + '</small></div>';
  const focus = mediaFocusSummary(state, entry.id);
  const quote = quoteFromNotes(entry.notes);
  const reflection = reflectionFromNotes(entry.notes, quote);
  const focusLabel = entry.type === 'book' ? '阅读专注' : '观看专注';
  openSubpage('subpage-media-detail', `<nav class="subpage-nav-bar media-detail-nav">
    <button type="button" class="subpage-back-btn" data-subpage-close><span class="material-symbols-outlined">arrow_back</span><span>返回</span></button>
    <span class="subpage-nav-title">作品档案 ·《${esc(entry.title)}》</span>
    <button type="button" class="subpage-nav-action" id="media-detail-edit" aria-label="编辑${esc(entry.title)}"><span class="material-symbols-outlined">edit</span></button>
  </nav><div class="media-detail-page">
    <section class="media-detail-hero-card">
      <div class="media-detail-cover">${cover}</div>
      <div class="media-detail-hero-copy">
        <div class="media-detail-title-row"><h2>《${esc(entry.title)}》</h2>${stars}</div>
        <small class="media-detail-meta">${typeLabel} · ${statusLabel}</small>
        ${entry.completedDate ? `<time class="media-detail-date" datetime="${entry.completedDate}">完成于 ${entry.completedDate}</time>` : '<small class="media-detail-date muted">尚无完成日期</small>'}
        ${progress}
      </div>
    </section>
    <section class="washi-tape-note media-detail-quote-card">
      <h3>金句摘录 <span class="material-symbols-outlined">push_pin</span></h3>
      ${quote ? `<blockquote class="washi-quote">“${esc(quote)}”</blockquote>` : '<p class="media-detail-empty">尚未摘录金句</p>'}
    </section>
    <section class="media-detail-note-card">
      <h3>${entry.type === 'book' ? '读书' : '观影'}手记与反思</h3>
      ${reflection ? `<p>${esc(reflection)}</p>` : `<p class="media-detail-empty">${quote ? '还没有写下额外手记。' : '还没有写下感受。'}</p>`}
    </section>
    <section class="media-detail-focus-card ${focus.sessions.length ? '' : 'empty'}">
      <div class="media-detail-section-head"><span><i class="material-symbols-outlined">timer</i><b>关联专注</b></span>${focus.sessions.length ? `<button type="button" id="media-detail-focus-history">查看记录</button>` : ''}</div>
      ${focus.sessions.length ? `<div class="media-detail-focus-stats"><span><strong>${formatMinutes(focus.minutes)}</strong><small>累计${focusLabel}</small></span><span><strong>${focus.sessions.length} 次</strong><small>专注次数</small></span></div>` : '<p class="media-detail-empty">暂无关联专注记录</p>'}
    </section>
    <div class="media-detail-actions">
      <button type="button" class="media-detail-btn" id="media-detail-edit-row"><span class="material-symbols-outlined">edit</span>编辑记录</button>
      <button type="button" class="media-detail-delete" id="media-detail-delete"><span class="material-symbols-outlined">delete</span>删除记录</button>
    </div>
  </div>`);
  $('#media-detail-edit')?.addEventListener('click', () => mediaForm(entry));
  $('#media-detail-edit-row')?.addEventListener('click', () => mediaForm(entry));
  $('#media-detail-focus-history')?.addEventListener('click', () => mediaFocusHistory(entry.id));
  $('#media-detail-delete')?.addEventListener('click', () => confirmDelete('删除这条书影音记录和本地封面？', () => deleteMediaEntry(entry.id)));
  return true;
}

function openMediaDetailById(mediaId) {
  const entry = state.media.find(item => item.id === mediaId);
  if (!entry) {
    show('没有找到这条书影音记录');
    return false;
  }
  return openMediaDetail(entry);
}

registerView('library', libraryView);
registerBinder(bindMedia);
registerHelper('openMediaDetail', openMediaDetailById);
