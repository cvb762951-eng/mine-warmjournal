import { photoFrameLayersHtml } from '../photo-frame.js';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraDirection, EncodingType } from '@capacitor/camera';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { $, $$, esc, uid, state, save, render, modal, closeModal, show, confirmDelete, imgSrc, emptyState, go, registerView, registerBinder, registerSubmitHandler, registerHelper, registerOnRender, callHelper, PHOTO_IMPORT_BATCH_LIMIT } from '../core.js';
import { makeSnippet, makeTodo, snippetEntries, dateKey, WEEK_DAYS, activeStreak, formatShanghaiStamp } from '../model.js';
import { photoViewer, micButtonHtml, bindVoiceInput } from './common.js';
import { compressSnippetPhoto, captureVideoFrame, importPhotoBatch, isSupportedJournalPhoto } from '../photo-utils.js';
import { livePhotoMarkHtml, photosWithLiveMotion } from '../motion-photo.js';
import { thumbSource, thumbKeyFor, watchThumbImages } from '../photo-thumbs.js';
import { mediaSource, saveMediaFile, saveNativeMediaSource } from '../media-store.js';
import { attachVideoSource, formatVideoDuration, isHlsAddress, normalizeHlsAddress, presentWatchSession, summarizeWatchSession } from '../video-player.js';
import { openVideoSession, plainVideoCache } from '../video-session.js';
import { showVideoFramePicker } from '../video-frame-picker.js';
import { applyVideoCrop, croppedFrame } from '../video-crop.js';
import { aiSuggestStructure, applySuggestion } from '../ai.js';
import { deckCutDecision, prefersReducedMotion } from '../motion.js';
import { openMediaDetail } from './media.js';
import { normalizeQuickTag, quickTagList, recordQuickTag, addQuickTag, removeQuickTag } from '../quick-tags.js';

// ---- 本地状态 ----
let snippetType = 'all';
let snippetSearch = '';
let pendingSnippetPhotos = [];
let pendingSnippetLive = [];
let pendingSnippetVideos = [];
let pendingSnippetStructure = { tags: [], summary: '' };
let snippetSuggestion = null;
let snippetVoice = null;
let activeVideoController = null;
let activeVideoRecord = null;
let activeVideoDirty = false;
let activeVideoOptions = null;
let activeVideoFullscreenCleanup = null;
let activeVideoLandscapeFullscreen = false;
// 沉浸式视频流（私密空间 / 本机相册 / 全屏浏览）默认**有声**播放。
// 用户在播放器里可以随时点按钮静音，开关状态由这个变量记住，翻页时保持一致。
let immersiveFeedSoundEnabled = true;
let feedHandoffTimer = null;

const SNIPPET_PHOTO_LIMIT = 100;
let pendingQuickTag = '';
let pendingQuickCaption = '';
let quickMemoVoice = null;

// ---- 跨天相册流：照片 + 视频/实况混合，按日期/时间倒序，每项附带说明与时刻 ----
function snippetPhotoStream() {
  const stream = [];
  (state.snippets || [])
    .filter(entry => entry.type === 'photo')
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    .forEach(entry => {
      const photos = entry.photos?.length ? entry.photos : (entry.photo ? [entry.photo] : []);
      const d = new Date(entry.createdAt);
      const clock = Number.isFinite(d.getTime()) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
      const meta = { text: entry.text || '', time: `${entry.date}${clock ? ' ' + clock : ''}` };
      photos.forEach(photo => stream.push({ item: photo, meta, entryId: entry.id }));
      (entry.videos || []).filter(video => video.sourceType !== 'hls' && !isHlsAddress(video.video)).forEach(video => stream.push({ item: video, meta, entryId: entry.id }));
    });
  return stream;
}

function openSnippetAlbum(startIndex = 0) {
  const stream = snippetPhotoStream();
  if (!stream.length) return;
  const start = Math.max(0, Math.min(stream.length - 1, Number(startIndex) || 0));
  const entryIds = [...new Set(stream.map(item => item.entryId))];
  const entryIndex = entryIds.indexOf(stream[start].entryId);
  photoViewer(stream.map(item => item.item), start, stream.map(item => item.meta), {
    // 相册里的视频交给随手拍自己的播放会话：续播进度、观看记录照常写回。
    onOpenVideo: index => {
      const record = stream[index];
      const entry = state.snippets.find(item => item.id === record?.entryId);
      const videoIndex = entry?.videos?.indexOf(record.item) ?? -1;
      if (videoIndex < 0) return null;
      return openSavedSnippetVideo(entry, videoIndex)?.catch?.(error => show(error?.message || '视频无法播放'));
    },
    onVerticalNavigate: entryIds.length > 1 ? direction => {
      const nextId = entryIds[(entryIndex + direction + entryIds.length) % entryIds.length];
      openSnippetAlbum(stream.findIndex(item => item.entryId === nextId));
    } : null
  });
}

// ---- 全屏相册缩略图网格层（#snippet-album-grid）----
export const snippetGridAspect = new Map();

function onSnippetGridImgLoad(event) {
  const img = event.target;
  if (!img || img.tagName !== 'IMG' || !img.classList.contains('photo-blur-still')) return;
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (nw > 1 && nh > 1) {
    const cell = img.closest('.snippet-album-grid-cell');
    if (!cell) return;
    const ref = cell.dataset.ref || img.dataset.thumbRef || '';
    if (ref) {
      snippetGridAspect.set(ref, { width: nw, height: nh });
    }
    const nextRatio = `${nw} / ${nh}`;
    if (cell.style.aspectRatio !== nextRatio) {
      cell.style.aspectRatio = nextRatio;
    }
  }
}

function snippetGridMediaHtml(item, index) {
  const isVideo = item && typeof item === 'object' && item.video;
  if (isVideo) {
    const poster = item.poster;
    const alt = `视频 ${index + 1} 封面`;
    const visual = poster
      ? `<span class="photo-blur-frame is-edge snippet-album-grid-frame">${snippetCoverImage(poster, alt, true)}</span>`
      : `<span class="snippet-grid-video-placeholder"><span class="material-symbols-outlined">movie</span></span>`;
    return `${visual}<span class="snippet-grid-play-badge" aria-hidden="true"><span class="material-symbols-outlined">play_arrow</span></span>${videoDurationStamp(item)}`;
  }

  const ref = item;
  const alt = `照片 ${index + 1}`;
  return `<span class="photo-blur-frame is-edge snippet-album-grid-frame">${snippetPhotoImage(ref, alt, { thumb: true, lazy: true })}</span>`;
}

let snippetAlbumGridCloseToken = 0;

function ensureSnippetAlbumGridLayer() {
  let layer = $('#snippet-album-grid');
  if (layer) {
    if (!layer._hasAspectLoadListener) {
      layer.addEventListener('load', onSnippetGridImgLoad, true);
      layer._hasAspectLoadListener = true;
    }
    return layer;
  }
  layer = document.createElement('div');
  layer.id = 'snippet-album-grid';
  layer.className = 'snippet-album-grid';
  layer.hidden = true;
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.addEventListener('load', onSnippetGridImgLoad, true);
  layer._hasAspectLoadListener = true;
  const host = $('.phone-shell') || document.body;
  host.appendChild(layer);
  return layer;
}

export function isSnippetAlbumGridOpen() {
  const layer = $('#snippet-album-grid');
  return Boolean(layer && layer.classList.contains('open') && !layer.classList.contains('is-closing'));
}

export function closeSnippetAlbumGrid() {
  const layer = $('#snippet-album-grid');
  if (!layer) return false;
  const wasOpen = layer.classList.contains('open');
  if (!wasOpen) return false;
  const token = ++snippetAlbumGridCloseToken;
  const finish = () => {
    if (token !== snippetAlbumGridCloseToken) return;
    if (layer.classList.contains('is-closing')) layer.classList.remove('is-closing');
    if (layer.classList.contains('open')) layer.classList.remove('open');
    layer.hidden = true;
    callHelper('syncSystemBackConsumption');
  };
  const tier = momentAlbumTier();
  if (tier === 'rich' && layer.animate) {
    if (!layer.classList.contains('is-closing')) layer.classList.add('is-closing');
    try {
      const anim = layer.animate([
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translate3d(0, 16px, 0)' }
      ], { duration: 180, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'forwards' });
      anim.onfinish = finish;
      setTimeout(finish, 300);
    } catch {
      finish();
    }
  } else {
    finish();
  }
  callHelper('syncSystemBackConsumption');
  return wasOpen;
}

export function openSnippetAlbumGrid() {
  const stream = snippetPhotoStream();
  if (!stream.length) return;
  const layer = ensureSnippetAlbumGridLayer();
  snippetAlbumGridCloseToken += 1;
  if (layer.classList.contains('is-closing')) layer.classList.remove('is-closing');
  layer.getAnimations?.().forEach(anim => anim.cancel());

  const host = layer.parentElement || document.body;
  const layerWidth = layer.clientWidth || host.clientWidth || window.innerWidth;
  const colCount = layerWidth >= 600 ? 3 : 2;
  const colHeights = new Array(colCount).fill(0);
  const columns = Array.from({ length: colCount }, () => []);

  stream.forEach((entry, index) => {
    const isVideo = entry.item && typeof entry.item === 'object' && entry.item.video;
    const ref = isVideo ? (entry.item.poster || '') : (typeof entry.item === 'string' ? entry.item : '');
    const aspect = ref ? snippetGridAspect.get(ref) : null;
    const aspectStyle = aspect ? `aspect-ratio: ${aspect.width} / ${aspect.height}` : 'aspect-ratio: 3 / 4';
    const itemHeight = (aspect && aspect.width > 0 && aspect.height > 0)
      ? (aspect.height / aspect.width)
      : 1;

    let shortest = 0;
    for (let c = 1; c < colCount; c++) {
      if (colHeights[c] < colHeights[shortest]) shortest = c;
    }

    const cellHtml = `<button type="button" class="snippet-album-grid-cell" data-grid-index="${index}" data-ref="${esc(ref)}" style="${aspectStyle}" aria-label="第 ${index + 1} 项">${snippetGridMediaHtml(entry.item, index)}</button>`;

    columns[shortest].push(cellHtml);
    colHeights[shortest] += itemHeight;
  });

  const columnsHtml = columns.map(col => `<div class="snippet-album-grid-column">${col.join('')}</div>`).join('');

  layer.innerHTML = `<header class="snippet-album-grid-header">
    <button type="button" class="snippet-album-grid-back" id="snippet-album-grid-back" aria-label="返回">
      <span class="material-symbols-outlined">arrow_back</span>
    </button>
    <div class="snippet-album-grid-title-wrap">
      <h2 class="snippet-album-grid-title">相册</h2>
      <span class="snippet-album-grid-count">${stream.length} 张</span>
    </div>
    <div class="snippet-album-grid-actions"></div>
  </header>
  <div class="snippet-album-grid-body">
    ${columnsHtml}
  </div>`;

  layer.querySelector('#snippet-album-grid-back')?.addEventListener('click', () => closeSnippetAlbumGrid());
  layer.querySelectorAll('[data-grid-index]').forEach(cell => {
    cell.onclick = () => {
      const index = Number(cell.dataset.gridIndex);
      openSnippetAlbum(index);
    };
  });

  layer.hidden = false;
  if (!layer.classList.contains('open')) layer.classList.add('open');

  const tier = momentAlbumTier();
  if (tier === 'rich' && layer.animate) {
    try {
      layer.animate([
        { opacity: 0, transform: 'translate3d(0, 20px, 0)' },
        { opacity: 1, transform: 'none' }
      ], { duration: 220, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    } catch {}
  }

  watchThumbImages(layer);
  callHelper('syncSystemBackConsumption');
}

export function snippetsView() {
  const streak = activeStreak(state, dateKey());
  const photoCount = state.snippets.filter(entry => entry.type === 'photo').length;
  const noteCount = state.snippets.filter(entry => entry.type === 'text').length;
  const mediaCount = state.media.length;
  const liveCount = state.snippets.filter(snippetHasLive).length;
  const photoFilter = snippetType === 'photo';
  const textFilter = snippetType === 'text';
  const mediaFilter = snippetType === 'media';
  const liveFilter = snippetType === 'live';
  const hasAlbum = snippetPhotoStream().length > 0;
  const snippetList = mediaFilter
    ? []
    : snippetEntries(state, { type: photoFilter || liveFilter ? 'photo' : textFilter ? 'text' : 'all', search: snippetSearch }).filter(entry => !liveFilter || snippetHasLive(entry));
  const mediaList = (state.media || []).filter(entry => !snippetSearch || entry.title.toLowerCase().includes(snippetSearch.toLowerCase()) || entry.notes.toLowerCase().includes(snippetSearch.toLowerCase()));
  const stream = [
    ...snippetList.map(entry => ({ date: entry.date, kind: entry.type === 'photo' ? 'photo' : 'note', entry })),
    ...(mediaFilter || snippetType === 'all' ? mediaList.map(entry => ({ date: String(entry.completedDate || dateKey(new Date(entry.updatedAt))), kind: 'media', entry })) : [])
  ].sort((a, b) => b.date.localeCompare(a.date));
  const groups = [];
  stream.forEach(item => {
    const group = groups.find(g => g.date === item.date);
    if (group) group.items.push(item);
    else groups.push({ date: item.date, items: [item] });
  });
  return `<section class="view snippets-view" id="screen-snippets">
    <header class="subpage-header"><div class="subpage-title">Mine Moments & Stats</div><div class="subpage-subtitle">Historical Archive · 随手拍 · 随手记 · 书影音统计</div><span class="moments-corner-note" aria-hidden="true">Collect<br>Ordinary<br>Moments.</span></header>
    <div class="snippets-stats-hero">
      <div class="stats-hero-top"><span class="stats-hero-title">全景生活记忆库统计</span><span class="stats-streak-badge"><span class="material-symbols-outlined">local_fire_department</span>连续记录 ${streak} 天</span></div>
      <div class="snippets-kpi-grid">
        <button class="snippet-kpi-item" data-snippet-type="photo"><span class="snippet-kpi-val" style="color:var(--sage-green)">${photoCount} 张</span><span class="snippet-kpi-lbl"><span class="material-symbols-outlined">photo_camera</span>随手拍</span></button>
        <button class="snippet-kpi-item" data-snippet-type="text"><span class="snippet-kpi-val" style="color:#b54a32">${noteCount} 条</span><span class="snippet-kpi-lbl"><span class="material-symbols-outlined">edit_note</span>灵感速记</span></button>
        <button class="snippet-kpi-item" data-snippet-type="media"><span class="snippet-kpi-val" style="color:#3e3a34">${mediaCount} 部</span><span class="snippet-kpi-lbl"><span class="material-symbols-outlined">menu_book</span>书影音</span></button>
        <button class="snippet-kpi-item" data-snippet-type="live"><span class="snippet-kpi-val" style="color:var(--terracotta)">${liveCount} 条</span><span class="snippet-kpi-lbl"><span class="material-symbols-outlined">play_circle</span>实况 Live</span></button>
      </div>
    </div>
    <div class="snippet-search-box"><label class="snippet-search-paper"><span class="material-symbols-outlined">search</span><form id="snippet-search-form" class="snippet-search-inline"><input class="snippet-search-input" name="search" value="${esc(snippetSearch)}" placeholder="搜索照片、灵感便签、书籍或电影..."></form></label>${hasAlbum ? '<button id="snippet-album" class="snippet-tool-btn" aria-label="跨天相册"><span class="material-symbols-outlined">photo_library</span></button>' : ''}<button id="new-snippet" class="snippet-add-btn"><span class="material-symbols-outlined">add</span><span>记录</span></button></div>
    <div class="snippet-tabs-filter">
      <button class="snippet-filter-pill ${snippetType === 'all' ? 'active' : ''}" data-snippet-type="all">全部记录 (${photoCount + noteCount + mediaCount})</button>
      <button class="snippet-filter-pill ${photoFilter ? 'active' : ''}" data-snippet-type="photo"><span class="material-symbols-outlined">photo_camera</span>随手拍 (${photoCount})</button>
      <button class="snippet-filter-pill ${textFilter ? 'active' : ''}" data-snippet-type="text"><span class="material-symbols-outlined">edit_note</span>灵感速记 (${noteCount})</button>
      <button class="snippet-filter-pill ${mediaFilter ? 'active' : ''}" data-snippet-type="media"><span class="material-symbols-outlined">collections_bookmark</span>书影音 (${mediaCount})</button>
      <button class="snippet-filter-pill ${liveFilter ? 'active' : ''}" data-snippet-type="live"><span class="material-symbols-outlined">movie</span>实况影像 (${liveCount})</button>
    </div>
    <div class="stream-sheet snippets-stream-sheet">
      <div class="sheet-handle"></div>
      ${groups.length ? (() => {
        let cardIndex = 0;
        return groups.map(group => `<section class="snippet-day-section"><div class="snippet-day-header"><div class="snippet-day-title">${dayGroupLabel(group.date)}</div><div class="snippet-day-count">${group.items.length} 条记录</div></div>${group.items.map(item => snippetStreamCard(item, cardIndex++ >= 4)).join('')}</section>`).join('');
      })() : emptyState('还没有记录', snippetType === 'all' ? '点击「＋ 记录」记下第一张照片或一句话。' : '这个分类还没有记录。')}
    </div>
  </section>`;
}

function dayGroupLabel(day) {
  const date = new Date(`${day}T12:00:00`);
  const label = `${date.getMonth() + 1}月${date.getDate()}日`;
  const today = day === dateKey();
  return `<span class="snippet-day-date">${label}</span>${today ? '<span class="snippet-day-separator" aria-hidden="true">·</span><span class="snippet-day-relative">今天</span>' : ''}<span class="snippet-day-separator" aria-hidden="true">·</span><span class="snippet-day-week">星期${WEEK_DAYS[date.getDay()]}</span>`;
}

function snippetStreamCard(item, lazy = true) {
  if (item.kind === 'photo') {
    const entry = item.entry;
    const photos = entry.photos?.length ? entry.photos : (entry.photo ? [entry.photo] : []);
    const videos = entry.videos || [];
    const cover = photos[0] || videos[0]?.poster || '';
    const time = entry.createdAt ? new Date(entry.createdAt) : null;
    const tag = (entry.tags || [])[0];
    const liveStills = (entry.livePhotos || []).length;
    const badge = videos.length ? `<span class="snippet-photo-badge"><span class="material-symbols-outlined">movie</span>${videos.length > 1 ? videos.length + ' 段' : '视频'}</span>` : liveStills ? `<span class="snippet-photo-badge"><span class="material-symbols-outlined">motion_photos_on</span>${liveStills > 1 ? liveStills + ' 张实况' : '实况'}</span>` : photos.length > 1 ? `<span class="snippet-photo-badge"><span class="material-symbols-outlined">photo_camera</span>${photos.length} 张</span>` : '<span class="snippet-photo-badge"><span class="material-symbols-outlined">photo_camera</span>拍立得</span>';
    const visual = photos.length
      ? snippetPhotoMosaic(entry, photos, lazy)
      : cover ? `${videos.length > 1
          ? `<button type="button" class="snippet-cover-frame is-video-cover photo-blur-frame is-edge" data-snippet-video-album="${entry.id}" aria-label="浏览 ${videos.length} 段视频">${snippetCoverImage(cover, entry.text || '随手拍', lazy)}</button>`
          : `<div class="snippet-cover-frame is-video-cover photo-blur-frame is-edge">${snippetCoverImage(cover, entry.text || '随手拍', lazy)}</div>`}${videoDurationStamp(videos[0])}`
        : videos.length ? `<div class="snippet-video-stream-placeholder"><span class="material-symbols-outlined">live_tv</span><small>在线视频</small></div>${videoDurationStamp(videos[0])}` : '';
    const segments = videos.length > 1 ? `<div class="snippet-video-segments" aria-label="这条记录中的视频">${videos.map((item, index) => `<button type="button" class="photo-blur-frame is-edge" data-play-snippet-video="${entry.id}" data-video-index="${index}">${item.poster ? photoFrameLayersHtml(imgSrc(item.poster), { alt: `第 ${index + 1} 段视频封面`, padClass: 'snippet-cover-blur', stillClass: 'snippet-cover-main', lazy }) : '<span class="material-symbols-outlined">stream</span>'}<small>${index + 1}</small>${videoDurationStamp(item)}</button>`).join('')}</div>` : '';
    const localVideoIndex = videos.findIndex(item => item.sourceType !== 'hls' && !isHlsAddress(item.video));
    return `<article class="snippet-item-card"><div class="snippet-visual-wrap">${visual}${badge}</div>${segments}<div class="snippet-item-meta"><span>${time ? `${pad2(time.getHours())}:${pad2(time.getMinutes())} · 随手拍` : '随手拍'}</span>${tag ? `<span style="color:var(--sage-green);font-weight:700">#${esc(tag)}</span>` : ''}</div>${entry.text ? `<p class="snippet-item-text">${esc(entry.text)}</p>` : ''}<div class="snippet-item-actions"><button data-edit-snippet="${entry.id}">编辑</button><button class="danger" data-delete-snippet="${entry.id}">删除</button>${videos.length ? `<button class="view" data-play-snippet-video="${entry.id}" data-video-index="0"><span class="material-symbols-outlined">play_circle</span>播放视频</button>` : ''}${localVideoIndex >= 0 ? `<button class="view" data-refresh-video-poster="${entry.id}" data-video-index="${localVideoIndex}"><span class="material-symbols-outlined">image</span>选择封面</button>` : ''}${photos.length ? `<button class="view" data-view-snippet-photo="${entry.id}" data-photo-index="0">查看照片</button>` : ''}</div></article>`;
  }
  if (item.kind === 'note') {
    const entry = item.entry;
    const tag = (entry.tags || [])[0];
    const time = entry.createdAt ? new Date(entry.createdAt) : null;
    return `<article class="snippet-memo-card"><div class="snippet-item-meta"><span>${time ? `${pad2(time.getHours())}:${pad2(time.getMinutes())} · 随手记` : '随手记'}</span>${tag ? `<span style="color:#d48b47;font-weight:700">#${esc(tag)}</span>` : ''}</div><p class="snippet-item-text">${esc(entry.text)}</p><div class="snippet-item-actions"><button data-edit-snippet="${entry.id}">编辑</button><button class="danger" data-delete-snippet="${entry.id}">删除</button></div></article>`;
  }
  const entry = item.entry;
  const statusLabel = { completed: entry.type === 'movie' ? '已看' : '已读', in_progress: entry.type === 'movie' ? '在看' : '在读', planned: entry.type === 'movie' ? '想看' : '想读' }[entry.status] || '';
  const progress = entry.status === 'completed' ? '<div class="media-progress-bar-wrap"><div class="media-progress-bar-fill" style="width:100%"></div></div>' : '';
  return `<article class="snippet-media-card" data-open-media-detail="${entry.id}"><div class="media-card-head"><span class="media-type-badge"><span class="material-symbols-outlined">${entry.type === 'movie' ? 'movie' : 'menu_book'}</span>${entry.type === 'movie' ? '电影' : '读书'} · ${statusLabel}</span><span class="snippet-rating">${entry.rating ? Array.from({ length: entry.rating }, () => '<span class="material-symbols-outlined">star</span>').join('') : '未评分'}</span></div><div class="media-card-title-row"><strong>《${esc(entry.title)}》</strong><small class="media-detail-link">详情 ›</small></div>${progress}<p>${esc(entry.notes || '还没有写下感受。')}</p></article>`;
}

/* 视频封面分两层：底层是同一画面放大虚化后铺满，上层完整显示不裁切。
   卡片高度统一（就是横屏画面的高度），所以竖屏视频不会把卡片撑高，列表始终等高；
   竖屏画面完整居中显示，左右没占满的那两条由虚化层兜住 ——
   既有横条的整齐，又没有原先那两条突兀的深色留白。
   横向视频里虚化层被主图完全盖住、看不见，只有竖屏两侧才会显出虚化。
   两层用同一个地址，浏览器只下载一次 —— 不额外占存储，也不用重新处理图片。
   （与私密相册封面的做法一致，见 private-vault.js 的 vaultCoverImage。） */
function snippetCoverImage(source, alt = '', lazy = true) {
  // 列表封面：有缩略图用缩略图，没有回退原图（大图浏览 / 导出仍用原图）。
  const thumbRef = thumbKeyFor(source) ? source : '';
  const url = thumbRef ? esc(thumbSource(source)) : imgSrc(source);
  return photoFrameLayersHtml(url, { alt, padClass: 'snippet-cover-blur', stillClass: 'snippet-cover-main', lazy, thumbRef });
}

/* 照片格用同一套做法（2026-10-09 用户要求「竖屏照片也按这个风格处理」）：
   底层同一张图放大虚化铺满，上层完整居中显示。
   照片格的**高度和排布完全没动**（仍是原来的固定高度、contain 不裁），
   改的只是「没占满的那部分」——从深色底换成同画面的虚化。
   两层同地址，浏览器只下载一次，不额外占存储。
   注意：上层用 position 但不给 z-index，靠 DOM 顺序压住虚化层，
   这样后面那个「+N」遮罩（同样是定位元素、且排在更后）才能正常盖在最上面。 */
function snippetPhotoImage(source, alt = '', opts = {}) {
  const { lazy = true, thumb = true } = typeof opts === 'boolean' ? { lazy: opts } : (opts || {});
  const thumbRef = thumb && thumbKeyFor(source) ? source : '';
  const url = thumbRef ? esc(thumbSource(source)) : imgSrc(source);
  return photoFrameLayersHtml(url, { alt, padClass: 'snippet-photo-blur', stillClass: 'snippet-photo-main', lazy, thumbRef });
}

function snippetHasLive(entry) {
  return entry?.type === 'photo' && Boolean((entry.videos || []).length || (entry.livePhotos || []).length);
}

function snippetPhotoMosaic(entry, photos, lazy = true) {
  const visible = photos.slice(0, 5);
  return `<div class="snippet-photo-mosaic count-${Math.min(visible.length, 5)}" aria-label="${photos.length} 张照片">${visible.map((photo, index) => `<button type="button" class="photo-blur-frame is-edge snippet-photo-tile" data-view-snippet-photo="${entry.id}" data-photo-index="${index}" aria-label="查看第 ${index + 1} 张照片">${snippetPhotoImage(photo, entry.text || `随手拍 ${index + 1}`, { thumb: true, lazy })}${photoHasLiveMark(photo, entry.livePhotos)}${index === visible.length - 1 && photos.length > visible.length ? `<span class="snippet-photo-more">+${photos.length - visible.length}</span>` : ''}</button>`).join('')}</div>`;
}

function photoHasLiveMark(still, livePhotos) {
  return (livePhotos || []).some(item => item?.still === still && item?.video) ? livePhotoMarkHtml() : '';
}

export function snippetForm(entry = null, requestedType = 'text', openCamera = false) {
  snippetVoice?.destroy();
  snippetVoice = null;
  const item = entry || makeSnippet({ type: requestedType, date: dateKey(), text: '', createdAt: Date.now() });
  pendingSnippetPhotos = [...(item.photos?.length ? item.photos : (item.photo ? [item.photo] : []))];
  pendingSnippetLive = [...(item.livePhotos || [])];
  pendingSnippetVideos = [...(item.videos || [])];
  pendingSnippetStructure = { tags: [...(item.tags || [])], summary: item.summary || '' };
  snippetSuggestion = null;
  modal(`<form id="snippet-form"><input type="hidden" name="id" value="${entry ? item.id : ''}"><input type="hidden" name="type" value="${item.type}"><span class="eyebrow">QUICK CAPTURE</span><h2>${entry ? '编辑' : '新增'}${item.type === 'photo' ? '随手拍' : '随手记'}</h2><label>日期</label><input name="date" type="date" required value="${item.date}">${item.type === 'photo' ? `<div class="snippet-photo-stage"><div id="snippet-photo-grid" class="snippet-photo-grid">${snippetPhotoGrid()}</div></div><label class="snippet-caption-label" for="snippet-photo-caption">图说</label><textarea id="snippet-photo-caption" name="text" maxlength="300" placeholder="写一句图说">${esc(item.text)}</textarea><div class="snippet-capture-bar" role="toolbar" aria-label="照片与视频"><div class="snippet-photo-actions"><button type="button" id="capture-snippet-photo" ${pendingSnippetPhotos.length >= SNIPPET_PHOTO_LIMIT ? 'disabled' : ''}><span class="material-symbols-outlined">photo_camera</span>${pendingSnippetPhotos.length ? '再拍' : '拍照'}</button><button type="button" id="pick-snippet-photo" ${pendingSnippetPhotos.length >= SNIPPET_PHOTO_LIMIT ? 'disabled' : ''}><span class="material-symbols-outlined">photo_library</span>${pendingSnippetPhotos.length ? '再选' : '选图'}</button></div><div class="snippet-photo-actions snippet-video-actions"><button type="button" id="capture-snippet-video" ${pendingSnippetVideos.length >= SNIPPET_PHOTO_LIMIT ? 'disabled' : ''}><span class="material-symbols-outlined">videocam</span>${pendingSnippetVideos.length ? '再拍视频' : '拍视频'}</button><button type="button" id="pick-snippet-video" ${pendingSnippetVideos.length >= SNIPPET_PHOTO_LIMIT ? 'disabled' : ''}><span class="material-symbols-outlined">video_library</span>导入视频</button></div></div><small class="field-help">一次最多 ${PHOTO_IMPORT_BATCH_LIMIT} 张，每条最多 ${SNIPPET_PHOTO_LIMIT} 张。</small><div class="snippet-video-head"><div><strong>视频</strong><small>已导入的片段</small></div></div><div id="snippet-video-grid" class="snippet-photo-grid">${snippetVideoGrid()}</div><div class="snippet-hls-paper"><label for="snippet-hls-url"><span class="material-symbols-outlined" aria-hidden="true">stream</span>添加 m3u8 在线视频</label><div><input type="url" id="snippet-hls-url" maxlength="4096" placeholder="https://example.com/video/master.m3u8" autocomplete="off" inputmode="url"><button type="button" id="add-snippet-hls">添加地址</button></div><small>仅在你点击播放时联网；不支持 DRM，鉴权或跨域限制可能导致播放失败。</small></div>` : `<div class="snippet-write-head"><label>记录内容</label>${micButtonHtml()}</div><textarea name="text" maxlength="2000" required placeholder="记下一句话、一个想法或稍后想写进日记的内容……">${esc(item.text)}</textarea>`}${aiStructureCard(item)}<div class="modal-actions"><button type="button" data-close>取消</button><button class="save">保存素材</button></div></form>`, 'snippet-form-modal');
  $('#capture-snippet-photo')?.addEventListener('click', () => pickSnippetPhoto(true).catch(error => show(error.message)));
  $('#pick-snippet-photo')?.addEventListener('click', () => pickSnippetPhoto(false).catch(error => show(error.message)));
  $('#capture-snippet-video')?.addEventListener('click', () => pickSnippetVideo(true).catch(error => show(error.message)));
  $('#pick-snippet-video')?.addEventListener('click', () => pickSnippetVideo(false).catch(error => show(error.message)));
  $('#add-snippet-hls')?.addEventListener('click', addSnippetHlsAddress);
  bindSnippetPhotoGrid();
  bindSnippetVideoGrid();
  bindSnippetStructureActions(item);
  snippetVoice = bindVoiceInput($('#snippet-form'), { input: () => $('textarea[name="text"]', $('#snippet-form')), onText: () => {} });
  $('#snippet-form [data-close]')?.addEventListener('click', () => { snippetVoice?.destroy(); snippetVoice = null; });
  if (openCamera && !entry) pickSnippetPhoto(true).catch(error => {
    if (!isCameraCancellation(error)) show(`无法打开相机：${error.message}`);
  });
}

function aiStructureCard(item) {
  const hasAccepted = (pendingSnippetStructure.tags.length || pendingSnippetStructure.summary) || (item.tags?.length || item.summary);
  if (hasAccepted) {
    return `<div class="ai-structure-card accepted"><div class="ai-structure-head"><span class="material-symbols-outlined">auto_awesome</span><div><strong>AI 整理已归档</strong><small>标签与摘要已保存，之后可随时编辑。</small></div></div>${pendingSnippetStructure.tags.length ? `<div class="ai-structure-tags">${pendingSnippetStructure.tags.map(tag => `<span class="ai-tag-chip read-only">#${esc(tag)}</span>`).join('')}</div>` : ''}${pendingSnippetStructure.summary ? `<p class="ai-structure-summary-text">${esc(pendingSnippetStructure.summary)}</p>` : ''}</div>`;
  }
  if (!state.settings.aiApiKey) {
    return `<div class="ai-structure-card off"><div class="ai-structure-head"><span class="material-symbols-outlined">auto_awesome</span><div><strong>AI 整理</strong><small>配置 AI 后可自动整理</small></div></div></div>`;
  }
  return `<div class="ai-structure-card"><div class="ai-structure-head"><span class="material-symbols-outlined">auto_awesome</span><div><strong>AI 整理</strong><small>标签 · 待办 · 一句话摘要</small></div></div><button type="button" id="ai-structure-run"><span class="material-symbols-outlined">auto_awesome</span>整理内容</button><div id="ai-structure-result"></div></div>`;
}

export function momentSpreadHtml(photos) {
  if (!photos || !photos.length) return '';
  const total = photos.length;
  const n = Math.min(total, 4);
  const first4 = photos.slice(0, n);
  const sig = `${total}:${first4.map(p => typeof p === 'string' ? p : (p?.still || p?.src || '')).join(',')}`;
  const cards = first4.map((photo, i) => {
    const rot = n === 1 ? 0 : (i - (n - 1) / 2) * 4;
    const lift = n === 1 ? 0 : (i % 2 ? 10 : -6);
    const more = (total > 4 && i === n - 1) ? `<button type="button" class="moment-spread-more" data-moment-spread-all aria-label="查看全部 ${total} 张照片">+${total - 4}</button>` : '';
    const frame = `<span class="moment-spread-frame photo-blur-frame is-edge">${photoFrameLayersHtml(imgSrc(photo), { alt: `待保存照片 ${i + 1}`, padClass: 'moment-spread-blur', stillClass: 'moment-spread-still' })}</span>`;
    return `<span class="moment-spread-card" style="--i:${i};--rot:${rot}deg;--lift:${lift}px">${frame}${more}</span>`;
  }).join('');
  return `<div class="moment-spread count-${n}" data-spread-sig="${esc(sig)}">${cards}</div>`;
}

function snippetPhotoGrid() {
  if (!pendingSnippetPhotos.length) return '<div class="snippet-photo-empty"><span class="material-symbols-outlined">photo_camera</span><strong>拍下此刻</strong><small>也可以从相册选择，可连续添加</small></div>';
  const spread = momentSpreadHtml(pendingSnippetPhotos);
  const manage = `<div class="moment-spread-manage"><button type="button" class="moment-spread-manage-btn" data-moment-spread-all><span class="moment-spread-manage-open">查看全部</span><span class="moment-spread-manage-close">收起</span></button></div>`;
  const grid = `<div class="snippet-photo-grid-inner">${pendingSnippetPhotos.map((photo, index) => `<div class="snippet-photo-cell"><button type="button" class="snippet-photo-thumb photo-blur-frame is-edge" data-view-pending-snippet-photo="${index}" aria-label="查看第 ${index + 1} 张">${snippetPhotoImage(photo, `待保存照片 ${index + 1}`)}${photoHasLiveMark(photo, pendingSnippetLive)}</button><button type="button" class="snippet-photo-remove" data-remove-pending-snippet-photo="${index}" aria-label="删除第 ${index + 1} 张"><span class="material-symbols-outlined">close</span></button></div>`).join('')}</div>`;
  return `${spread}${manage}${grid}`;
}

function bindSnippetPhotoGrid() {
  $$('#snippet-photo-grid [data-moment-spread-all]').forEach(button => button.onclick = event => {
    event.stopPropagation();
    $('#snippet-photo-grid')?.classList.toggle('is-managing');
  });
  $$('[data-remove-pending-snippet-photo]').forEach(button => button.onclick = () => {
    const index = Number(button.dataset.removePendingSnippetPhoto);
    const removed = pendingSnippetPhotos[index];
    pendingSnippetPhotos.splice(index, 1);
    pendingSnippetLive = pendingSnippetLive.filter(item => item.still !== removed);
    refreshSnippetPhotoGrid();
  });
  $$('[data-view-pending-snippet-photo]').forEach(button => button.onclick = () => photoViewer(photosWithLiveMotion(pendingSnippetPhotos, pendingSnippetLive), Number(button.dataset.viewPendingSnippetPhoto)));
}

async function pickSnippetPhoto(useCamera = false) {
  if (snippetPhotoImporting) return show('照片还在处理中，稍等一下');
  if (pendingSnippetPhotos.length >= SNIPPET_PHOTO_LIMIT) return show(`最多 ${SNIPPET_PHOTO_LIMIT} 张照片`);
  if (useCamera && Capacitor.isNativePlatform()) {
    try {
      const photo = await Camera.takePhoto({
        quality: 86,
        targetWidth: 1600,
        targetHeight: 1600,
        correctOrientation: true,
        encodingType: EncodingType.JPEG,
        saveToGallery: false,
        cameraDirection: CameraDirection.Rear,
        editable: 'no',
        includeMetadata: true
      });
      if (!photo.webPath) throw new Error('相机没有返回照片');
      const response = await fetch(photo.webPath);
      if (!response.ok) throw new Error('无法读取刚拍摄的照片');
      const blob = await response.blob();
      const file = new File([blob], `capture-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
      const [compressed] = await importPhotoBatch([file], compressSnippetPhoto, { onLivePhoto: (still, video) => pendingSnippetLive.push({ still, video }) });
      pendingSnippetPhotos.push(compressed);
      refreshSnippetPhotoGrid();
      return;
    } catch (error) {
      if (isCameraCancellation(error)) return;
      throw error;
    }
  }
  return pickSnippetPhotoWithInput(useCamera);
}

function isCameraCancellation(error) {
  return error?.code === 'OS-PLUG-CAMR-0006' || error?.code === 'OS-PLUG-CAMR-0017' || /cancel|取消/i.test(error?.message || '');
}

function refreshSnippetPhotoGrid() {
  const grid = $('#snippet-photo-grid');
  if (grid) {
    const wasManaging = grid.classList.contains('is-managing');
    grid.innerHTML = snippetPhotoGrid();
    if (wasManaging) grid.classList.add('is-managing');
    bindSnippetPhotoGrid();
  }
  const full = pendingSnippetPhotos.length >= SNIPPET_PHOTO_LIMIT;
  const captureButton = $('#capture-snippet-photo');
  if (captureButton) {
    captureButton.disabled = full;
    captureButton.innerHTML = `<span class="material-symbols-outlined">photo_camera</span>${pendingSnippetPhotos.length ? '再拍' : '拍照'}`;
  }
  const pickButton = $('#pick-snippet-photo');
  if (pickButton) {
    pickButton.disabled = full;
    pickButton.innerHTML = `<span class="material-symbols-outlined">photo_library</span>${pendingSnippetPhotos.length ? '再选' : '选图'}`;
  }
}

function pickSnippetPhotoWithInput(useCamera = false) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp'; input.multiple = !useCamera;
    if (useCamera) input.setAttribute('capture', 'environment');
    input.onchange = async () => {
      try {
        const files = [...(input.files || [])];
        if (!files.length) return resolve();
        if (files.length > PHOTO_IMPORT_BATCH_LIMIT) throw new Error(`一次最多选择 ${PHOTO_IMPORT_BATCH_LIMIT} 张照片，请分批添加`);
        if (pendingSnippetPhotos.length + files.length > SNIPPET_PHOTO_LIMIT) throw new Error(`每条随手拍最多 ${SNIPPET_PHOTO_LIMIT} 张照片`);
        if (files.some(file => !isSupportedJournalPhoto(file))) throw new Error('仅支持 JPG、PNG 或 WebP 图片');
        const { compressed, failed, liveAdded } = await importSnippetPhotos(files);
        pendingSnippetPhotos.push(...compressed);
        refreshSnippetPhotoGrid();
        show(compressed.length ? `已加入 ${compressed.length} 张照片${liveAdded ? `，${liveAdded} 张实况仍可播放` : ''}${failed ? `，${failed} 张无法读取已跳过` : ''}` : `这批照片都未能读取，请换一批试试`);
        resolve();
      } catch (error) { reject(error); }
    };
    input.click();
  });
}

/* 批量导入进度（2026-10-09 用户要求）：一次可能上百张，边压缩边落盘边显示进度，
   进行中锁住拍摄/相册按钮，避免两批并发把内存顶爆。

   ⚠️ 随手拍有**两个入口**，必须同时照顾，否则必然出现「加了进度条用户还是看不见」：
     ① 表单弹窗（#snippet-photo-grid + #capture/pick-snippet-photo）
     ② 快捷弹窗（#quick-photo-preview + #quick-capture/pick-snap）← 首页随手拍走的是这个
   进度节点不能写死锚在某一套 ID 上：谁在页面上就挂谁，两个都没有才退回弹窗卡片本身。 */
let snippetPhotoImporting = false;

/* 按钮原始文案的暂存：首次进入「处理中」时记下，结束原样还回去，
   这样以后再加新入口也不用逐条维护「空闲态长什么样」。 */
const snippetImportButtonIdleHtml = new Map();
const SNIPPET_IMPORT_BUSY_BUTTONS = [
  '#capture-snippet-photo', '#pick-snippet-photo',   // 表单弹窗
  '#quick-capture-snap', '#quick-pick-snap'          // 快捷弹窗
];

function snippetImportAnchor() {
  return $('#snippet-photo-grid') || $('#quick-photo-preview') || $('.quick-modal-card') || $('.modal-card') || null;
}

function snippetImportProgressNode() {
  let node = $('#snippet-photo-import-progress');
  const anchor = snippetImportAnchor();
  // 弹窗每次都是重建的，节点可能被甩出 DOM，这里补挂一次。
  if (node && !node.isConnected && anchor) anchor.before(node);
  if (!node) {
    node = document.createElement('div');
    node.id = 'snippet-photo-import-progress';
    node.className = 'snippet-import-progress';
    node.hidden = true;
    // 一律插在锚点**前面**：照片越加越多，插在后面会被顶出屏幕。
    if (anchor) anchor.before(node);
    else document.body.appendChild(node);
  }
  return node;
}

function markSnippetImportButtons(done, total) {
  SNIPPET_IMPORT_BUSY_BUTTONS.forEach(selector => {
    const button = $(selector);
    if (!button) return;
    if (!snippetImportButtonIdleHtml.has(selector)) snippetImportButtonIdleHtml.set(selector, button.innerHTML);
    button.disabled = true;
    // 进度直接写进按钮：用户刚点过这里，视线就在这。
    button.innerHTML = `<span class="material-symbols-outlined">hourglass_top</span>正在添加 ${done}/${total}…`;
  });
}

function restoreSnippetImportButtons() {
  snippetImportButtonIdleHtml.forEach((html, selector) => {
    const button = $(selector);
    if (!button) return;
    button.innerHTML = html;
    button.disabled = false;
  });
  snippetImportButtonIdleHtml.clear();
}

function showSnippetImportProgress(done, total) {
  const node = snippetImportProgressNode();
  node.hidden = false;
  const percent = total > 0 ? Math.min(100, Math.floor(done * 100 / total)) : 0;
  node.innerHTML = `<div class="snippet-import-progress-text"><span class="material-symbols-outlined">downloading</span>正在添加照片 ${done}/${total} 张<small>处理中，可以松手等它跑完</small></div><div class="media-progress-bar-wrap"><div class="media-progress-bar-fill" style="width:${percent}%"></div></div>`;
  node.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  markSnippetImportButtons(done, total);
  // 快捷弹窗里最显眼的就是那块大预览，直接把进度铺上去。
  const preview = $('#quick-photo-preview');
  if (preview) {
    preview.dataset.importBusy = '1';
    preview.innerHTML = `<span class="quick-photo-empty-icon material-symbols-outlined">hourglass_top</span><strong>正在添加 ${done}/${total} 张</strong><small>正在压缩保存，松手等它跑完就好</small>`;
  }
}

function hideSnippetImportProgress() {
  const node = $('#snippet-photo-import-progress');
  if (node) node.hidden = true;
  restoreSnippetImportButtons();
  const preview = $('#quick-photo-preview');
  if (preview?.dataset.importBusy) {
    delete preview.dataset.importBusy;
    refreshQuickPhotoPreview();
  }
  refreshSnippetPhotoGrid();
}

async function importSnippetPhotos(files) {
  if (snippetPhotoImporting) throw new Error('照片还在处理中，稍等一下');
  snippetPhotoImporting = true;
  showSnippetImportProgress(0, files.length);
  let failed = 0;
  try {
    // 单张失败不再废掉整批：失败的张数单独统计，跑完一起汇报。
    let liveAdded = 0;
    const compressed = await importPhotoBatch(files, compressSnippetPhoto, {
      concurrency: 2,
      onProgress: (done, total) => showSnippetImportProgress(done, total),
      onItemError: () => { failed += 1; },
      onLivePhoto: (still, video) => { pendingSnippetLive.push({ still, video }); liveAdded += 1; }
    });
    return { compressed, failed, liveAdded };
  } finally {
    snippetPhotoImporting = false;
    hideSnippetImportProgress();
  }
}

// ---- 视频/实况：预览网格、拍摄/相册导入、播放与保存 ----
function snippetVideoGrid() {
  if (!pendingSnippetVideos.length) return '<div class="snippet-photo-empty"><span class="material-symbols-outlined">movie</span><strong>还没有视频</strong><small>拍一段，或从相册选实况/视频</small></div>';
  return `<div class="snippet-photo-grid-inner">${pendingSnippetVideos.map((video, index) => { const hls = video.sourceType === 'hls' || isHlsAddress(video.video); const preview = video.poster ? photoFrameLayersHtml(imgSrc(video.poster), { alt: `视频 ${index + 1}`, padClass: 'snippet-cover-blur', stillClass: 'snippet-video-poster-preview', lazy: true }) : `<span class="snippet-video-hls-placeholder"><span class="material-symbols-outlined">${hls ? 'stream' : 'image'}</span><small>${hls ? 'm3u8' : '等待封面'}</small></span>`; return `<div class="snippet-photo-cell snippet-video-cell"><button type="button" class="snippet-photo-thumb photo-blur-frame is-edge" data-play-pending-snippet-video="${index}" aria-label="预览第 ${index + 1} 个${hls ? '在线' : '本地'}视频">${preview}<span class="snippet-video-cell-play"><span class="material-symbols-outlined">play_arrow</span></span><span class="snippet-video-source">${hls ? '在线' : '本地'}</span>${videoDurationStamp(video)}</button>${!hls ? `<div class="snippet-video-poster-actions"><button type="button" data-recapture-video-poster="${index}">视频选帧</button><button type="button" data-change-video-poster="${index}">自选图片</button></div>` : ''}<button type="button" class="snippet-photo-remove" data-remove-pending-snippet-video="${index}" aria-label="删除第 ${index + 1} 个视频"><span class="material-symbols-outlined">close</span></button></div>`; }).join('')}</div>`;
}

function videoDurationStamp(video) {
  const label = formatVideoDuration(video?.duration, video?.sourceType === 'hls' ? '在线' : '待读取');
  return `<span class="video-duration-stamp" aria-label="视频时长 ${label}">${label}</span>`;
}

function snippetScopeLabel() {
  if (snippetType === 'photo') return '随手拍';
  if (snippetType === 'live') return '实况影像';
  if (snippetType === 'text') return '灵感速记';
  return '随手拍';
}

function snippetSessionItem(video, entry, index, pending = false) {
  return {
    id: pending ? `pending:${index}` : `${entry?.id || 'snippet'}:${index}`,
    entryId: entry?.id || '',
    videoIndex: index,
    pending,
    resolveSource: () => video?.video || '',
    poster: video?.poster || '',
    label: video?.label || entry?.text || (video?.sourceType === 'hls' ? 'HLS 在线视频' : '本地离线视频'),
    date: entry?.date || '',
    note: '',
    position: Number(video?.position) || 0,
    duration: Number(video?.duration) || 0,
    trim: video?.trim || null,
    crop: video?.crop || null,
    watchHistory: Array.isArray(video?.watchHistory) ? video.watchHistory : [],
    sourceType: video?.sourceType || '',
    width: Number(video?.width) || 0,
    height: Number(video?.height) || 0
  };
}

function scopedSnippetVideoRecords() {
  const photoFilter = snippetType === 'photo';
  const textFilter = snippetType === 'text';
  const mediaFilter = snippetType === 'media';
  const liveFilter = snippetType === 'live';
  if (mediaFilter || textFilter) return [];
  return snippetEntries(state, { type: photoFilter || liveFilter ? 'photo' : 'all', search: snippetSearch })
    .filter(entry => !liveFilter || snippetHasLive(entry))
    .flatMap(entry => (entry.videos || []).map((video, index) => ({ video, entry, index })).filter(item => item.video?.video))
    .sort((a, b) => String(b.entry?.date || '').localeCompare(String(a.entry?.date || '')) || (b.entry?.createdAt || 0) - (a.entry?.createdAt || 0) || a.index - b.index);
}

let snippetPlaybackNeedsSave = false;

function rememberSnippetVideo(item, patch) {
  const video = item?.pending
    ? pendingSnippetVideos[item.videoIndex]
    : state.snippets.find(entry => entry.id === item?.entryId)?.videos?.[item.videoIndex];
  if (!video) return;
  // 只写进度和观看记录。播放地址（尤其是私密空间解密出来的 blob）不能进随手拍。
  const position = Math.max(0, Math.floor(Number(patch?.position) || 0));
  const duration = Math.max(0, Math.floor(Number(patch?.duration) || 0));
  if (position) video.position = position;
  else delete video.position;
  if (duration) video.duration = duration;
  if (patch?.width && patch?.height) { video.width = Math.floor(patch.width); video.height = Math.floor(patch.height); }
  const history = Array.isArray(patch?.watchHistory) ? patch.watchHistory.slice(-100) : [];
  if (history.length) video.watchHistory = history;
  else delete video.watchHistory;
  // 未保存草稿只留在 pending 数组里，等表单真正保存时再入库。
  if (!item.pending) snippetPlaybackNeedsSave = true;
}

async function flushSnippetPlayback() {
  if (!snippetPlaybackNeedsSave) return;
  snippetPlaybackNeedsSave = false;
  await save();
}

function openSnippetVideos(records, startIndex = 0, scopeLabel = '随手拍') {
  const list = (records || []).filter(item => item?.video?.video);
  if (!list.length) return Promise.resolve(null);
  return openVideoSession({
    items: list.map(item => snippetSessionItem(item.video, item.entry, item.index, Boolean(item.pending))),
    startIndex,
    scopeLabel,
    episodeTitle: scopeLabel,
    immersiveFeed: true,
    showFolders: false,
    loopNavigation: true,
    autoAdvance: false,
    onOpenLibrary: () => closeModal(),
    sourceCache: plainVideoCache,
    remember: rememberSnippetVideo,
    flush: flushSnippetPlayback,
    currentItem: sessionItem => {
      if (sessionItem.pending) {
        const video = pendingSnippetVideos[sessionItem.videoIndex];
        return video ? snippetSessionItem(video, null, sessionItem.videoIndex, true) : sessionItem;
      }
      const entry = state.snippets.find(record => record.id === sessionItem.entryId);
      const video = entry?.videos?.[sessionItem.videoIndex];
      return video ? snippetSessionItem(video, entry, sessionItem.videoIndex, false) : sessionItem;
    }
  });
}

function openSavedSnippetVideo(entry, index = 0) {
  if (!entry) return;
  let records = scopedSnippetVideoRecords();
  let start = records.findIndex(item => item.entry?.id === entry.id && item.index === index);
  if (start < 0) {
    records = (entry.videos || []).map((video, videoIndex) => ({ video, entry, index: videoIndex })).filter(item => item.video?.video);
    start = Math.max(0, records.findIndex(item => item.index === index));
  }
  return openSnippetVideos(records, start, snippetScopeLabel());
}

function openPendingSnippetVideo(index = 0) {
  const records = pendingSnippetVideos.map((video, videoIndex) => ({ video, entry: null, index: videoIndex, pending: true }));
  return openSnippetVideos(records, index, '未保存的视频');
}

function bindSnippetVideoGrid() {
  $$('[data-remove-pending-snippet-video]').forEach(button => button.onclick = () => {
    pendingSnippetVideos.splice(Number(button.dataset.removePendingSnippetVideo), 1);
    refreshSnippetVideoGrid();
  });
  $$('[data-play-pending-snippet-video]').forEach(button => button.onclick = () => openPendingSnippetVideo(Number(button.dataset.playPendingSnippetVideo)));
  $$('[data-change-video-poster]').forEach(button => button.onclick = () => pickVideoPoster(Number(button.dataset.changeVideoPoster)).catch(error => show(error.message)));
  $$('[data-recapture-video-poster]').forEach(button => button.onclick = () => recapturePendingVideoPoster(Number(button.dataset.recaptureVideoPoster)).catch(error => show(error.message)));
}

function refreshSnippetVideoGrid() {
  const grid = $('#snippet-video-grid');
  if (grid) {
    grid.innerHTML = snippetVideoGrid();
    bindSnippetVideoGrid();
  }
  const full = pendingSnippetVideos.length >= SNIPPET_PHOTO_LIMIT;
  const captureButton = $('#capture-snippet-video');
  if (captureButton) {
    captureButton.disabled = full;
    captureButton.innerHTML = `<span class="material-symbols-outlined">videocam</span>${pendingSnippetVideos.length ? '再拍视频' : '拍视频'}`;
  }
  const pickButton = $('#pick-snippet-video');
  if (pickButton) {
    pickButton.disabled = full;
    pickButton.innerHTML = `<span class="material-symbols-outlined">video_library</span>导入视频`;
  }
}

function addSnippetHlsAddress(inputSelector = '#snippet-hls-url') {
  if (pendingSnippetVideos.length >= SNIPPET_PHOTO_LIMIT) { show(`最多 ${SNIPPET_PHOTO_LIMIT} 个视频`); return false; }
  const input = $(inputSelector);
  const address = normalizeHlsAddress(input?.value, { allowDynamicPath: true });
  if (!address) { show('请输入有效的 http/https 播放地址'); return false; }
  if (pendingSnippetVideos.some(item => item.video === address)) { show('这个 m3u8 地址已经添加'); return false; }
  const host = new URL(address).hostname;
  pendingSnippetVideos.push({ poster: '', video: address, sourceType: 'hls', label: host || 'HLS 在线视频' });
  if (input) input.value = '';
  refreshSnippetVideoGrid();
  show('已保存 m3u8 地址，播放时才会联网');
  return true;
}

function stopActiveVideoPlayer({ persist = true, handoff = false } = {}) {
  const shouldSave = persist && activeVideoDirty && !activeVideoOptions?.transientMedia;
  const sessionOptions = activeVideoOptions;
  const watchSession = sessionOptions?.finishWatchSession?.();
  if (watchSession) sessionOptions?.onWatchSession?.(watchSession);
  sessionOptions?.cleanupFeedLayout?.();
  activeVideoController?.destroy();
  activeVideoController = null;
  activeVideoRecord = null;
  activeVideoDirty = false;
  activeVideoOptions = null;
  activeVideoFullscreenCleanup?.();
  activeVideoFullscreenCleanup = null;
  callHelper('setVideoGestureExclusion', false);
  if (shouldSave) save().catch(error => console.warn('视频进度保存失败', error));
  if (!persist) return Promise.resolve();
  // handoff：还在同一会话里换下一条，onClose 只改内存。
  // 弹层真正关掉、或上锁前这次关闭，调用方会等 onClose 把整段会话保存完再清密钥。
  return Promise.resolve(sessionOptions?.onClose?.({ handoff })).catch(error => console.warn('播放器会话保存失败', error));
}

function showFeedHandoff(poster = '') {
  clearTimeout(feedHandoffTimer);
  $('#vault-feed-handoff')?.remove();
  const handoff = document.createElement('div');
  handoff.id = 'vault-feed-handoff';
  handoff.className = 'vault-feed-handoff';
  handoff.setAttribute('aria-hidden', 'true');
  handoff.innerHTML = poster ? `<img src="${imgSrc(poster)}" alt="">` : '';
  document.body.append(handoff);
  feedHandoffTimer = setTimeout(clearFeedHandoff, 10000);
}

function clearFeedHandoff() {
  clearTimeout(feedHandoffTimer);
  feedHandoffTimer = null;
  $('#vault-feed-handoff')?.remove();
}

function playSnippetVideo(video, entry = null, index = 0, options = {}) {
  if (!video?.video) return;
  // 新开一次播放会结束上一段会话。同一会话里滑动已经用 handoff 停过，这里是空操作。
  stopActiveVideoPlayer();
  // 进入新的沉浸式视频流时恢复为「有声」默认值；
  // 用户若已在播放器里手动静音，则尊重该选择，不强制改回有声。
  if (options.immersiveFeed && options.resetFeedAudio) immersiveFeedSoundEnabled = true;
  callHelper('setVideoGestureExclusion', Boolean(options.immersiveFeed));
  const hls = video.sourceType === 'hls' || isHlsAddress(video.video);
  const videos = entry?.videos || [];
  const totalVideos = Math.max(1, Number(options.count) || videos.length || 1);
  const episodeItems = (Array.isArray(options.episodes) && options.episodes.length ? options.episodes : videos).slice(0, totalVideos);
  const sourceLabel = options.sourceLabel || (hls ? 'HLS 在线视频' : '本地离线视频');
  const title = video.label || entry?.text || sourceLabel;
  const description = String(options.description || '').trim();
  feedRailOptions = options;
  modal(`${options.immersiveFeed ? feedTransitionPreviewHtml(episodeItems, index) : ''}<div class="warm-video-player ${options.feedDirection ? `feed-enter-${options.feedDirection}` : ''}" id="warm-video-player"><header><div><span>PRIVATE SCREENING · 私人放映</span><h2>${esc(title)}</h2><small>${sourceLabel}${totalVideos > 1 ? ` · ${index + 1}/${totalVideos}` : ''}</small></div><button type="button" data-close aria-label="关闭播放器"><span class="material-symbols-outlined">close</span></button></header><div class="warm-video-stage"><div class="warm-video-viewport" id="warm-video-viewport"><div class="warm-video-canvas" id="warm-video-canvas"><video id="warm-video-element" class="is-awaiting-frame" ${video.poster ? `poster="${imgSrc(video.poster)}"` : ''} ${options.immersiveFeed ? '' : 'controls controlslist="nofullscreen noremoteplayback" disablepictureinpicture'} playsinline preload="metadata"></video></div><div class="warm-video-fullscreen-tools"><button type="button" id="warm-video-exit-fullscreen" class="warm-fullscreen-btn" aria-label="退出全屏"><span class="material-symbols-outlined">fullscreen_exit</span>退出</button>${totalVideos > 1 ? `<div><button type="button" data-video-fullscreen-page="${index - 1}" ${index <= 0 ? 'disabled' : ''} aria-label="上一段"><span class="material-symbols-outlined">skip_previous</span></button><span>${index + 1} / ${totalVideos}</span><button type="button" data-video-fullscreen-page="${index + 1}" ${index >= totalVideos - 1 ? 'disabled' : ''} aria-label="下一段"><span class="material-symbols-outlined">skip_next</span></button><button type="button" id="warm-video-episodes"><span class="material-symbols-outlined">video_library</span>选集</button></div>` : ''}</div>${totalVideos > 1 ? episodePickerHtml(episodeItems, index, options.episodeTitle) : ''}${options.immersiveFeed ? feedRailHtml(totalVideos) + feedFolderPanelHtml(options.folders || []) + feedWatchHistoryPanelHtml(options.watchHistory || []) + feedPlaybackControlsHtml() : ''}</div><div class="warm-video-message" id="warm-video-message">正在准备视频…</div>${totalVideos > 1 ? `<span class="warm-video-swipe-hint">${options.immersiveFeed ? '上下滑动切换视频' : '左右滑动切换视频'}</span>` : ''}</div>${options.immersiveFeed ? feedInfoHtml(title, description, sourceLabel, options.date || '', video.position || 0, video.duration || 0) : description ? `<section class="warm-video-description"><small>${esc(options.date || '')}</small><p>${esc(description)}</p></section>` : ''}<div class="warm-video-controls"><div class="warm-video-rates" aria-label="播放速度">${[.75, 1, 1.25, 1.5, 2].map(rate => `<button type="button" data-video-rate="${rate}" class="${rate === 1 ? 'active' : ''}">${rate}×</button>`).join('')}</div><button type="button" id="warm-video-fullscreen" class="warm-fullscreen-btn"><span class="material-symbols-outlined">fullscreen</span>全屏</button></div><div class="warm-video-foot"><small id="warm-video-resume">${video.position ? `从 ${clockText(video.position)} 继续` : '从头播放'}</small>${totalVideos > 1 ? `<div><button type="button" data-video-page="${index - 1}" ${index <= 0 ? 'disabled' : ''}>上一段</button><button type="button" data-video-page="${index + 1}" ${index >= totalVideos - 1 ? 'disabled' : ''}>下一段</button></div>` : ''}</div></div>`, options.immersiveFeed ? 'snippet-video-modal vault-feed-modal' : 'snippet-video-modal');
  if (options.galleryMode) $('#warm-video-player')?.classList.add('gallery-feed-player');
  const player = $('#warm-video-element');
  // Android WebView 的 <video> 在首帧/封面就绪前会铺一块原生白底，而且盖在 CSS 背景之上。
  // 先藏起来，深色舞台或封面顶着，有画面再露出来。
  const revealVideoFrame = () => player?.classList.remove('is-awaiting-frame');
  player?.addEventListener('loadeddata', revealVideoFrame, { once: true });
  player?.addEventListener('playing', revealVideoFrame, { once: true });
  if ((player?.readyState || 0) >= 2) revealVideoFrame();
  // 非破坏性剪辑（2026-10-10 新增）：只影响"怎么播"，不动文件。
  // 时长剪辑：进度条只代表剪辑后这一段（0 → 剪辑后时长），拖动时再换算回原片时间。
  const trimRange = video.trim && Number(video.trim.end) > Number(video.trim.start) + .05
    ? { start: Number(video.trim.start), end: Number(video.trim.end) }
    : null;
  const trimLength = trimRange ? Math.max(.1, trimRange.end - trimRange.start) : 0;
  const toDisplayTime = value => trimRange ? Math.max(0, Math.min(trimLength, (Number(value) || 0) - trimRange.start)) : Math.max(0, Number(value) || 0);
  const toDisplayDuration = value => trimRange ? trimLength : Math.max(0, Number(value) || 0);
  const videoCrop = video.crop || null;
  const playerStage = player?.closest('.warm-video-stage');
  if (options.immersiveFeed && video.poster && playerStage) {
    playerStage.insertAdjacentHTML('afterbegin', `<div class="vault-feed-active-poster" id="vault-feed-active-poster" aria-hidden="true"><img src="${imgSrc(video.poster)}" alt=""></div>`);
  }
  const activeFeedPoster = $('#vault-feed-active-poster');
  const viewport = $('#warm-video-viewport');
  const message = $('#warm-video-message');
  if (options.immersiveFeed) {
    player.muted = !immersiveFeedSoundEnabled;
    player.defaultMuted = !immersiveFeedSoundEnabled;
    player.addEventListener('playing', () => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (activeFeedPoster?.isConnected) activeFeedPoster.hidden = true;
        clearFeedHandoff();
      }));
    }, { once: true });
  }
  if (options.immersiveFeed) {
    const header = $('#warm-video-player > header');
    if (header) {
      header.className = 'vault-feed-topbar';
      header.innerHTML = `<button type="button" data-close aria-label="退出视频流"><span class="material-symbols-outlined">arrow_back</span></button><span><strong>${esc(options.episodeTitle || '私密视频')}</strong><small>${index + 1} / ${totalVideos}</small></span>`;
    }
  }
  activeVideoRecord = video;
  // 画面裁剪：按当前渲染尺寸算裁剪样式，尺寸一变（转屏 / 全屏 / 分屏）要重算。
  const applyPlayerCrop = () => { if (videoCrop) applyVideoCrop(player, videoCrop); };
  const cropObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(applyPlayerCrop) : null;
  if (cropObserver) cropObserver.observe(player);
  window.addEventListener('resize', applyPlayerCrop);
  document.addEventListener('fullscreenchange', applyPlayerCrop);
  /* 画面裁过之后，"文件本身的画面比例"和"你实际看到的那块画面"不是一回事。
     进度条、底部工具栏、说明文字的位置全都按**看到的画面**算 ——
     否则把横屏裁成竖屏之后，控件还留在横屏该在的地方，整屏都是错位的。 */
  const shownFrame = (width, height) => croppedFrame(width, height, videoCrop);
  const shownLandscape = (width, height) => {
    const frame = shownFrame(width, height);
    return frame.width > 0 && frame.height > 0 ? frame.width > frame.height : false;
  };
  activeVideoController = attachVideoSource(player, video.video, {
    sourceType: video.sourceType,
    position: video.position || 0,
    trim: trimRange,
    onReady: ({ duration, width, height, landscape }) => {
      if (message) message.hidden = true;
      if (duration > 0 && Number(video.duration) !== Math.floor(duration)) {
        video.duration = Math.floor(duration);
        activeVideoDirty = true;
      }
      video.width = width;
      video.height = height;
      // 裁过画面就用裁剪后的比例判断横竖，否则"横屏裁成竖屏"后这个按钮还会按横屏显示。
      const shown = shownFrame(width, height);
      const shownIsLandscape = shown.width > 0 && shown.height > 0 ? shown.width > shown.height : landscape;
      const landscapeButton = $('#vault-feed-landscape');
      if (landscapeButton) landscapeButton.hidden = !shownIsLandscape;
      const shownDuration = toDisplayDuration(duration);
      const progress = $('#vault-feed-progress');
      if (progress) { progress.max = String(Math.max(1, shownDuration || 1)); updateFeedProgressStyle(progress, toDisplayTime(Number(player.currentTime) || 0), shownDuration); }
      const totalTime = $('#vault-feed-total-time');
      if (totalTime) totalTime.textContent = clockText(shownDuration);
      if (options.immersiveFeed) updateFeedVideoBounds($('#warm-video-player'), viewport, shown.width, shown.height);
      applyPlayerCrop();
      options.onReady?.({ duration, width, height, landscape: shownIsLandscape });
    },
    onProgress: ({ position, duration }) => {
      if (activeVideoRecord !== video) return;
      if (video.position !== position) { video.position = position; activeVideoDirty = true; }
      if (duration > 0) video.duration = Math.floor(duration);
      options.onProgress?.({ position, duration });
      const resume = $('#warm-video-resume');
      if (resume) resume.textContent = position ? `已播放至 ${clockText(position)}` : '从头播放';
      const shownPosition = toDisplayTime(position);
      const shownDuration = toDisplayDuration(duration);
      const progress = $('#vault-feed-progress');
      if (progress && !progress.matches(':active')) progress.value = String(shownPosition);
      if (progress) updateFeedProgressStyle(progress, shownPosition, shownDuration);
      const currentTime = $('#vault-feed-current-time');
      if (currentTime) currentTime.textContent = clockText(shownPosition);
    },
    onEnded: () => {
      video.position = 0;
      activeVideoDirty = true;
      options.onEnded?.();
      // 有下一段可切时：保持原有的自动续播
      if (options.autoAdvance && index < totalVideos - 1) {
        setTimeout(() => navigateVideo(index + 1), 280);
        return;
      }
      // 没有下一段可切时：循环重播当前视频，而不是停在最后一帧（2026-10-08 用户要求）
      try { player.currentTime = 0; } catch { /* 部分流媒体不允许定位，忽略 */ }
      const replay = player.play();
      if (replay?.catch) replay.catch(() => { /* 自动播放被系统拦截时保持暂停态即可 */ });
      // 图标与按钮可见性跟随真实播放状态。
      // 不复用下方的 syncPlayIcon：那是本函数后半段才定义的 const，
      // 这里显式写死更能抵御后续重构（例如在前面插入提前 return）。
      const icon = $('#vault-feed-play-icon');
      if (icon) icon.textContent = player.paused ? 'play_arrow' : 'pause';
      $('#vault-feed-toggle-play')?.classList.toggle('visible', player.paused);
    },
    onError: error => {
      clearFeedHandoff();
      if (message) { message.hidden = false; message.textContent = error; message.classList.add('error'); }
    }
  });
  const watchTracker = createWatchSessionTracker(player, options.onWatchSession, trimRange);
  const feedBoundsObserver = options.immersiveFeed && typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    const frame = shownFrame(player.videoWidth, player.videoHeight);
    updateFeedVideoBounds($('#warm-video-player'), viewport, frame.width, frame.height);
  }) : null;
  if (feedBoundsObserver && viewport) feedBoundsObserver.observe(viewport);
  activeVideoOptions = {
    ...options,
    finishWatchSession: watchTracker?.finish,
    cleanupFeedLayout: () => {
      feedBoundsObserver?.disconnect();
      cropObserver?.disconnect();
      window.removeEventListener('resize', applyPlayerCrop);
      document.removeEventListener('fullscreenchange', applyPlayerCrop);
    }
  };
  $$('[data-video-rate]').forEach(button => button.onclick = () => {
    const rate = activeVideoController?.setRate(button.dataset.videoRate) || 1;
    $$('[data-video-rate]').forEach(item => item.classList.toggle('active', Number(item.dataset.videoRate) === rate));
  });
  let feedTransitioning = false;
  const navigateVideo = (next, transition = {}) => {
    const requestedNext = next;
    if (options.loopNavigation && totalVideos > 1) next = (next + totalVideos) % totalVideos;
    if (next < 0 || next >= totalVideos) return;
    const direction = requestedNext > index ? 'up' : 'down';
    const perform = (feedDirection = '') => { stopActiveVideoPlayer({ handoff: true }); if (options.immersiveFeed) showFeedHandoff(episodeItems[next]?.poster || ''); if (typeof options.onNavigate === 'function') return options.onNavigate(next, feedDirection); playSnippetVideo(videos[next], entry, next, { ...options, feedDirection }); };
    if (!options.immersiveFeed) return perform();
    if (feedTransitioning) return;
    feedTransitioning = true;
    if (transition.gesture && transition.preview) {
      const shell = $('#warm-video-player');
      const offset = direction === 'up' ? '-100%' : '100%';
      shell?.classList.add('is-feed-settling');
      transition.preview.classList.add('is-feed-settling');
      if (shell) shell.style.transform = `translate3d(0,${offset},0)`;
      transition.preview.style.transform = 'translate3d(0,0,0)';
      return setTimeout(() => perform(''), 230);
    }
    perform(direction);
  };
  activeVideoFullscreenCleanup = bindVideoFullscreen(player, viewport, video, navigateVideo);
  let suppressFeedClick = false;
  let revealFeedChrome = () => {};
  if (options.immersiveFeed) {
    const playerShell = $('#warm-video-player');
    const episodePanel = $('#warm-video-episode-panel');
    const folderPanel = $('#vault-feed-folder-panel');
    const historyPanel = $('#vault-feed-history-panel');
    let chromeTimer = null;
    const anyFeedPanelOpen = () => !episodePanel?.hidden || !folderPanel?.hidden || !historyPanel?.hidden;
    // 用户主动操作过之后才认为「可以显示控件」。
    // 初始为 false：刚打开/划到下一个视频时不弹标题和工具栏，画面保持干净；
    // 用户点一下屏幕后才变为 true，之后按正常节奏显示再淡出。
    let chromeUnlocked = false;
    revealFeedChrome = (keep = false) => {
      if (!chromeUnlocked && !anyFeedPanelOpen()) {
        playerShell?.classList.add('feed-chrome-hidden');
        return;
      }
      clearTimeout(chromeTimer);
      playerShell?.classList.remove('feed-chrome-hidden');
      if (!keep && !player.paused && !anyFeedPanelOpen()) chromeTimer = setTimeout(() => {
        if (playerShell?.isConnected && !player.paused && !anyFeedPanelOpen()) playerShell.classList.add('feed-chrome-hidden');
      // 1.2 秒：刷视频时画面应该尽快干净（原本 2 秒，标题和工具栏在画面上停留太久）
      }, 1200);
    };
    $('#vault-feed-library')?.addEventListener('click', () => options.onOpenLibrary?.());
    $('#vault-feed-episodes')?.addEventListener('click', () => { chromeUnlocked = true; if (episodePanel) episodePanel.hidden = !episodePanel.hidden; if (folderPanel) folderPanel.hidden = true; if (historyPanel) historyPanel.hidden = true; revealFeedChrome(!episodePanel?.hidden); });
    $('#vault-feed-folders')?.addEventListener('click', () => { chromeUnlocked = true; if (folderPanel) folderPanel.hidden = !folderPanel.hidden; if (episodePanel) episodePanel.hidden = true; if (historyPanel) historyPanel.hidden = true; revealFeedChrome(!folderPanel?.hidden); });
     $('#vault-feed-history')?.addEventListener('click', () => {
       chromeUnlocked = true;
       if (historyPanel?.hidden) {
         const live = watchTracker?.peek?.();
         const history = Array.isArray(options.watchHistory) ? options.watchHistory : [];
         paintFeedWatchHistory(live ? [...history, live] : history, trimRange);
       }
       if (historyPanel) historyPanel.hidden = !historyPanel.hidden;
       if (episodePanel) episodePanel.hidden = true;
       if (folderPanel) folderPanel.hidden = true;
       revealFeedChrome(!historyPanel?.hidden);
     });
     $('#vault-feed-delete')?.addEventListener('click', async event => {
       event.stopPropagation();
       const deleteCurrent = options.onDeleteCurrent;
       if (typeof deleteCurrent !== 'function') return;
       // 文案可配：私密视频删的是 App 内部副本，本机视频删的是系统相册原文件，影响不同。
       const accepted = window.confirm(options.deleteConfirmText || '永久删除当前视频？此操作无法撤销。');
       if (!accepted) { chromeUnlocked = true; revealFeedChrome(true); return; }
       try { await deleteCurrent(); } catch (error) { show(error.message || '删除失败'); }
     });
    $('#vault-feed-close-folders')?.addEventListener('click', () => { if (folderPanel) folderPanel.hidden = true; revealFeedChrome(); });
    $('#vault-feed-close-history')?.addEventListener('click', () => { if (historyPanel) historyPanel.hidden = true; revealFeedChrome(); });
    $('#vault-feed-landscape')?.addEventListener('click', () => $('#warm-video-fullscreen')?.click());
    $$('[data-video-folder-mode]').forEach(button => button.onclick = () => options.onFolderNavigate?.(button.dataset.videoFolderMode, button.dataset.videoFolderId || ''));
    const playButton = $('#vault-feed-toggle-play');
    const playIcon = $('#vault-feed-play-icon');
    const soundButton = $('#vault-feed-sound');
    const soundIcon = $('#vault-feed-sound-icon');
    const soundLabel = $('#vault-feed-sound-label');
    const syncSoundButton = () => {
       if (soundIcon) soundIcon.textContent = player.muted ? 'volume_off' : 'volume_up';
       if (soundLabel) soundLabel.textContent = player.muted ? '开启声音' : '静音';
       soundButton?.setAttribute('aria-label', player.muted ? '开启声音' : '静音');
      soundButton?.setAttribute('aria-pressed', String(!player.muted));
    };
    soundButton?.addEventListener('click', event => {
      event.stopPropagation();
      immersiveFeedSoundEnabled = player.muted;
      player.muted = !immersiveFeedSoundEnabled;
      player.defaultMuted = player.muted;
     syncSoundButton();
     const rateButton = $('#vault-feed-rate');
     const feedRates = [.75, 1, 1.25, 1.5, 2];
     const syncFeedRate = () => { if (rateButton) rateButton.setAttribute('aria-label', `切换播放速度，当前 ${Number(player.playbackRate || 1)} 倍`); };
     rateButton?.addEventListener('click', event => {
       event.stopPropagation();
       const current = feedRates.findIndex(rate => Math.abs(rate - (Number(player.playbackRate) || 1)) < .01);
       player.playbackRate = feedRates[(current + 1 + feedRates.length) % feedRates.length];
       syncFeedRate();
       revealFeedChrome();
     });
     syncFeedRate();
     // 初始化时就同步声音按钮，避免按钮显示「静音」但实际有声（或反之）的错位。
     syncSoundButton();
      if (!player.muted && player.paused) player.play().catch(() => {});
    });
    syncSoundButton();
    const syncPlayIcon = () => { if (playIcon) playIcon.textContent = player.paused ? 'play_arrow' : 'pause'; playButton?.classList.toggle('visible', player.paused); };
    const togglePlayback = event => {
      event?.stopPropagation?.();
      if (suppressFeedClick) { suppressFeedClick = false; return; }
      if (playerShell?.classList.contains('feed-chrome-hidden')) {
        // 首次点按：只解锁并显示控件，不同时触发播放/暂停 —— 避免误操作打断观看
        chromeUnlocked = true;
        revealFeedChrome();
        return;
      }
      player.paused ? player.play().catch(() => {}) : player.pause();
      syncPlayIcon();
    };
    playButton?.addEventListener('click', togglePlayback);
    player.addEventListener('click', togglePlayback);
    player.addEventListener('play', () => { syncPlayIcon(); revealFeedChrome(); });
    player.addEventListener('pause', () => { syncPlayIcon(); revealFeedChrome(true); });
    $('#vault-feed-progress')?.addEventListener('input', event => { revealFeedChrome(); const shown = Number(event.target.value) || 0; const second = shown + (trimRange ? trimRange.start : 0); if (Number.isFinite(player.duration)) player.currentTime = Math.min(player.duration, second); updateFeedProgressStyle(event.target, toDisplayTime(second), toDisplayDuration(player.duration)); });
  }
  $$('[data-video-page]:not(:disabled)').forEach(button => button.onclick = () => {
    const next = Number(button.dataset.videoPage);
    navigateVideo(next);
  });
  const stage = $('.warm-video-stage');
  let swipeStart = null;
  let longPressTimer = null;
  let longPressActive = false;
  let longPressPreviousRate = 1;
  let gestureStatusTimer = null;
  const showFeedGestureStatus = (icon, text) => {
    const status = $('#vault-feed-gesture-status');
    const glyph = $('#vault-feed-gesture-icon');
    const copy = $('#vault-feed-gesture-copy');
    clearTimeout(gestureStatusTimer);
    if (glyph) glyph.textContent = icon;
    if (copy) copy.textContent = text;
    if (status) status.hidden = false;
  };
  const hideFeedGestureStatus = (delay = 180) => {
    clearTimeout(gestureStatusTimer);
    const status = $('#vault-feed-gesture-status');
    gestureStatusTimer = setTimeout(() => { if (status?.isConnected) status.hidden = true; }, delay);
  };
  const stopFeedLongPress = () => {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    if (!longPressActive) return false;
    longPressActive = false;
    activeVideoController?.setRate(longPressPreviousRate);
    hideFeedGestureStatus();
    return true;
  };
  const resetFeedDrag = () => {
    const shell = $('#warm-video-player');
    if (shell) { shell.classList.add('is-feed-settling'); shell.style.transform = ''; }
    $$('[data-feed-preview]').forEach(preview => { preview.classList.remove('is-active'); preview.classList.add('is-feed-settling'); preview.style.transform = ''; });
    setTimeout(() => { shell?.classList.remove('is-feed-settling'); $$('[data-feed-preview]').forEach(preview => preview.classList.remove('is-feed-settling')); }, 230);
  };
  stage?.addEventListener('pointerdown', event => {
    if (event.target.closest('button,input,.warm-video-episode-panel,.vault-feed-folder-panel')) return;
    swipeStart = { x: event.clientX, y: event.clientY, at: performance.now(), pointerId: event.pointerId, axis: '', seekStart: Number(player.currentTime) || 0 };
    stage.setPointerCapture?.(event.pointerId);
    if (options.immersiveFeed && !player.paused) longPressTimer = setTimeout(() => {
      if (!swipeStart || swipeStart.axis) return;
      longPressActive = true;
      longPressPreviousRate = Number(player.playbackRate) || 1;
      activeVideoController?.setRate(2);
      showFeedGestureStatus('speed', '2× 快进中');
    }, 420);
  });
  stage?.addEventListener('pointermove', event => {
    if (!swipeStart || !options.immersiveFeed || event.target.closest('button,input,.warm-video-episode-panel,.vault-feed-folder-panel')) return;
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    if (longPressActive) return;
    if (!swipeStart.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 9) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      if (Math.abs(dx) > Math.abs(dy) * 1.15) swipeStart.axis = 'horizontal';
      else if (Math.abs(dy) > Math.abs(dx) * 1.15) swipeStart.axis = 'vertical';
    }
    if (swipeStart.axis === 'horizontal') {
      suppressFeedClick = true;
      const duration = Number(player.duration) || 0;
      if (duration > 0) {
        const seekSpan = Math.min(120, Math.max(15, duration * .35));
        const width = Math.max(1, stage.clientWidth || window.innerWidth);
        const target = Math.max(0, Math.min(duration, swipeStart.seekStart + dx / width * seekSpan));
        player.currentTime = target;
        const progress = $('#vault-feed-progress');
        if (progress) { progress.value = String(toDisplayTime(target)); updateFeedProgressStyle(progress, toDisplayTime(target), toDisplayDuration(duration)); }
      }
      return;
    }
    if (swipeStart.axis !== 'vertical') return;
    const shell = $('#warm-video-player');
    const preview = $(`[data-feed-preview="${dy < 0 ? 'next' : 'previous'}"]`);
    const offset = preview ? dy : dy * .16;
    if (shell) { shell.classList.remove('is-feed-settling'); shell.style.transform = `translate3d(0,${offset}px,0)`; }
    $$('[data-feed-preview]').forEach(item => {
      item.classList.toggle('is-active', item === preview);
      item.classList.remove('is-feed-settling');
      item.style.transform = item === preview ? `translate3d(0,calc(${dy < 0 ? '100%' : '-100%'} + ${dy}px),0)` : '';
    });
  });
  stage?.addEventListener('pointerup', event => {
    if (!swipeStart) return;
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    const velocity = Math.abs(dy) / Math.max(1, performance.now() - swipeStart.at);
    const axis = swipeStart.axis;
    swipeStart = null;
    if (stopFeedLongPress()) { suppressFeedClick = true; resetFeedDrag(); return; }
    clearTimeout(longPressTimer);
    longPressTimer = null;
    if (options.immersiveFeed && axis === 'horizontal') { suppressFeedClick = true; resetFeedDrag(); return; }
    if (options.immersiveFeed && Math.abs(dy) > 16) suppressFeedClick = true;
    const verticalIntent = axis === 'vertical' && Math.abs(dy) > Math.abs(dx) * 1.2;
    const shouldSwitch = Math.abs(dy) > 64 || (Math.abs(dy) > 24 && velocity > .55);
    const next = index + (dy < 0 ? 1 : -1);
    const preview = $(`[data-feed-preview="${dy < 0 ? 'next' : 'previous'}"]`);
    if (options.immersiveFeed && totalVideos > 1 && verticalIntent && shouldSwitch && preview) navigateVideo(next, { gesture: true, preview });
    else {
      resetFeedDrag();
      if (!options.immersiveFeed && Math.abs(dx) > 58 && Math.abs(dx) > Math.abs(dy) * 1.25) navigateVideo(index + (dx < 0 ? 1 : -1));
    }
  });
  stage?.addEventListener('pointercancel', () => { swipeStart = null; stopFeedLongPress(); hideFeedGestureStatus(); resetFeedDrag(); });
  if (options.immersiveFeed) stage?.addEventListener('contextmenu', event => event.preventDefault());
  activeVideoController.play().catch(() => { if (message) { message.hidden = false; message.textContent = '轻触视频画面开始播放'; } });
}

function episodePickerHtml(items, activeIndex, scopeTitle = '') {
  // 本机相册同样提供选集（2026-10-09 起与私密空间对齐）。
  return `<section class="warm-video-episode-panel" id="warm-video-episode-panel" hidden><header><span><strong>${esc(scopeTitle || '当前选集')}</strong><small>共 ${items.length} 段</small></span><button type="button" id="warm-video-close-episodes" aria-label="关闭选集"><span class="material-symbols-outlined">close</span></button></header><div>${items.map((item, itemIndex) => `<button type="button" class="${itemIndex === activeIndex ? 'active' : ''}" data-video-episode-page="${itemIndex}"><em>${String(itemIndex + 1).padStart(2, '0')}</em>${item.poster ? `<img class="video-contain-cover" src="${imgSrc(item.poster)}" alt="">` : '<span class="material-symbols-outlined">movie</span>'}<span><strong>${esc(item.label || item.name || `视频 ${itemIndex + 1}`)}</strong><small>${item.date ? `${esc(item.date)} · ` : ''}${formatVideoDuration(item.duration, '时长待读取')}</small></span></button>`).join('')}</div></section>`;
}

let feedRailOptions = {};
function feedRailHtml(totalVideos, options = feedRailOptions) {
  // 本机相册与私密空间共用同一套工具条（2026-10-09 用户要求「全部功能对标」）。
  // 删除按钮只在调用方提供 onDeleteCurrent（即传了 onDelete）时出现；文件夹按钮 showFolders:false 时隐藏（随手拍两者都不显示）。
  return `<nav class="vault-feed-bottom-tools" aria-label="视频工具"><button id="vault-feed-sound" aria-label="静音" aria-pressed="true"><span class="material-symbols-outlined" id="vault-feed-sound-icon">volume_up</span></button><button id="vault-feed-rate" aria-label="切换播放速度"><span class="material-symbols-outlined">speed</span></button><button id="vault-feed-history" aria-label="观看记录"><span class="material-symbols-outlined">history</span></button><button id="vault-feed-library" aria-label="资料库"><span class="material-symbols-outlined">collections</span></button>${options.showFolders !== false ? '<button id="vault-feed-folders" aria-label="文件夹"><span class="material-symbols-outlined">folder</span></button>' : ''}${totalVideos > 1 ? '<button id="vault-feed-episodes" aria-label="视频选集"><span class="material-symbols-outlined">video_library</span></button>' : ''}${typeof options.onDeleteCurrent === 'function' ? '<button id="vault-feed-delete" class="vault-feed-delete-button" aria-label="删除当前视频"><span class="material-symbols-outlined">delete</span></button>' : ''}<button id="vault-feed-landscape" class="warm-fullscreen-btn" hidden aria-label="横屏"><span class="material-symbols-outlined">screen_rotation</span></button></nav>`;
}

function feedInfoHtml(title, description, sourceLabel, date, position, duration) {
  return `<section class="vault-feed-info"><div class="vault-feed-copy"><strong>${esc(title)}</strong><small>${date ? `${esc(date)} · ` : ''}${esc(sourceLabel)}</small>${description ? `<p>${esc(description)}</p>` : ''}</div><div class="vault-feed-timeline"><time id="vault-feed-current-time">${clockText(position)}</time><input class="vault-feed-progress" id="vault-feed-progress" type="range" min="0" max="${Math.max(1, Number(duration) || 1)}" step="0.1" value="${Math.max(0, Number(position) || 0)}" aria-label="视频播放进度"><time id="vault-feed-total-time">${clockText(duration)}</time></div></section>`;
}

function updateFeedVideoBounds(shell, viewport, width, height) {
  const viewportWidth = Number(viewport?.clientWidth) || 0;
  const viewportHeight = Number(viewport?.clientHeight) || 0;
  const videoWidth = Number(width) || 0;
  const videoHeight = Number(height) || 0;
  if (!shell || !viewportWidth || !viewportHeight || !videoWidth || !videoHeight) return;
  const scale = Math.min(viewportWidth / videoWidth, viewportHeight / videoHeight);
  const displayedWidth = videoWidth * scale;
  const displayedHeight = videoHeight * scale;
  const leftInset = Math.max(0, (viewportWidth - displayedWidth) / 2);
  const bottomInset = Math.max(0, (viewportHeight - displayedHeight) / 2);
  const bottomEdge = viewportHeight - bottomInset;
  shell.style.setProperty('--vault-feed-video-bottom', `${Math.round(bottomInset)}px`);
  shell.style.setProperty('--vault-feed-video-top-edge', `${Math.round(bottomInset)}px`);
  shell.style.setProperty('--vault-feed-video-left', `${Math.round(leftInset)}px`);
  shell.style.setProperty('--vault-feed-video-width', `${Math.round(displayedWidth)}px`);
  shell.style.setProperty('--vault-feed-video-bottom-edge', `${Math.round(bottomEdge)}px`);
  // 控件外移门槛：下方黑边够宽时，把说明文字移到画面之外。
  // 原为 104px，等于要求视频明显偏扁，竖屏视频永远达不到 → 控件一直压在画面上。
  // 降到 56px 让横屏/宽银幕视频普遍能享受「画面零遮挡」；竖屏仍走自动淡出。
  shell.classList.toggle('feed-info-below', bottomInset >= 56);
}

function updateFeedProgressStyle(progress, position, duration) {
  if (!progress) return;
  const total = Math.max(0, Number(duration) || 0);
  const percent = total ? Math.min(100, Math.max(0, Number(position) || 0) * 100 / total) : 0;
  progress.style.setProperty('--vault-feed-progress', `${percent.toFixed(3)}%`);
}

function orderedWatchSessions(history, trim) {
  return [...(history || [])].map(session => presentWatchSession(session, trim)).sort((a, b) => Number(b.startedAt) - Number(a.startedAt));
}

function watchSessionArticle(session) {
  return `<article><time>${formatWatchDate(session.startedAt)}</time><strong>观看 ${formatWatchDuration(session.watchedSeconds)}</strong><small>${clockText(session.startPosition)} → ${clockText(session.endPosition)} · ${Math.round((Number(session.completion) || 0) * 100)}%</small></article>`;
}

function watchHistoryEmptyCopy() {
  return '播放满 3 秒后，会在这里留下这一次观看。点开或很快划走不会记。';
}

function feedWatchHistoryPanelHtml(history, trim = null) {
  const sessions = orderedWatchSessions(history, trim);
  const total = sessions.reduce((sum, session) => sum + (Number(session.watchedSeconds) || 0), 0);
  return `<section class="vault-feed-history-panel" id="vault-feed-history-panel" hidden><header><span><strong>观看记录</strong><small>${sessions.length} 次 · 累计 ${formatWatchDuration(total)}</small></span><button id="vault-feed-close-history" aria-label="关闭观看记录"><span class="material-symbols-outlined">close</span></button></header><div>${sessions.length ? sessions.map(watchSessionArticle).join('') : `<p>${watchHistoryEmptyCopy()}</p>`}</div></section>`;
}

function paintFeedWatchHistory(history, trim = null) {
  const panel = $('#vault-feed-history-panel');
  if (!panel) return;
  const sessions = orderedWatchSessions(history, trim);
  const total = sessions.reduce((sum, session) => sum + (Number(session.watchedSeconds) || 0), 0);
  const summary = panel.querySelector('header small');
  if (summary) summary.textContent = `${sessions.length} 次 · 累计 ${formatWatchDuration(total)}`;
  const list = panel.querySelector('header + div');
  if (list) list.innerHTML = sessions.length ? sessions.map(watchSessionArticle).join('') : `<p>${watchHistoryEmptyCopy()}</p>`;
}

function feedFolderPanelHtml(folders) {
  return `<section class="vault-feed-folder-panel" id="vault-feed-folder-panel" hidden><header><strong>选择文件夹</strong><button id="vault-feed-close-folders"><span class="material-symbols-outlined">close</span></button></header><div>${folders.map(folder => `<button data-video-folder-mode="${folder.mode}" data-video-folder-id="${folder.id || ''}"><span class="material-symbols-outlined">${folder.mode === 'all' ? 'collections' : folder.mode === 'unfiled' ? 'inbox' : 'folder'}</span><span><strong>${esc(folder.name)}</strong><small>${folder.count} ${feedRailOptions.galleryMode ? '项素材' : '段视频'}</small></span></button>`).join('')}</div></section>`;
}

function feedPlaybackControlsHtml() {
  return `<output class="vault-feed-gesture-status" id="vault-feed-gesture-status" hidden><span class="material-symbols-outlined" id="vault-feed-gesture-icon">speed</span><strong id="vault-feed-gesture-copy"></strong></output><button type="button" class="vault-feed-play" id="vault-feed-toggle-play" aria-label="暂停或继续播放"><span class="material-symbols-outlined" id="vault-feed-play-icon">pause</span></button>`;
}

function createWatchSessionTracker(player, enabled, trim = null) {
  if (!enabled) return null;
  let startedAt = 0;
  let startPosition = 0;
  let watchedMilliseconds = 0;
  let furthest = 0;
  let sliceStartedAt = 0;
  let sliceRate = 1;
  const mediaRate = rate => Math.min(4, Math.max(0.25, Number(rate) || 1));
  const pendingMs = () => {
    if (!sliceStartedAt) return watchedMilliseconds;
    return watchedMilliseconds + Math.max(0, performance.now() - sliceStartedAt) * mediaRate(sliceRate);
  };
  const flush = () => {
    if (!sliceStartedAt) return;
    watchedMilliseconds = pendingMs();
    sliceStartedAt = 0;
  };
  const mark = () => {
    const time = Math.max(0, Number(player.currentTime) || 0);
    if (time > furthest) furthest = time;
  };
  const arm = () => {
    if (!player.paused && document.visibilityState !== 'hidden' && !sliceStartedAt) {
      sliceStartedAt = performance.now();
      sliceRate = Number(player.playbackRate) || 1;
    }
  };
  const begin = () => {
    const time = Math.max(0, Number(player.currentTime) || 0);
    if (!startedAt) { startedAt = Date.now(); startPosition = time; furthest = time; }
    mark();
    arm();
  };
  const pause = () => flush();
  const visibility = () => document.visibilityState === 'hidden' ? flush() : begin();
  // 倍速变化时先按旧速度结清这一段，再按新速度接着计。ratechange 触发时 playbackRate 已经是新值。
  const onRate = () => { flush(); arm(); };
  const detach = () => {
    player.removeEventListener('play', begin);
    player.removeEventListener('pause', pause);
    player.removeEventListener('timeupdate', mark);
    player.removeEventListener('seeked', mark);
    player.removeEventListener('ended', mark, true);
    player.removeEventListener('ratechange', onRate);
    document.removeEventListener('visibilitychange', visibility);
  };
  const snapshot = endedAt => summarizeWatchSession({
    startedAt,
    endedAt,
    watchedMilliseconds: pendingMs(),
    startPosition,
    endPosition: Number(player.currentTime) || 0,
    furthest,
    duration: Number(player.duration) || 0,
    trim
  });
  player.addEventListener('play', begin);
  player.addEventListener('pause', pause);
  player.addEventListener('timeupdate', mark);
  player.addEventListener('seeked', mark);
  // 捕获阶段赶在播放器把进度拉回片头之前，记下「已经放到结尾」。
  player.addEventListener('ended', mark, true);
  player.addEventListener('ratechange', onRate);
  document.addEventListener('visibilitychange', visibility);
  return {
    peek() { mark(); return snapshot(Date.now()); },
    finish() {
      flush();
      mark();
      detach();
      const watchedSeconds = Math.floor(watchedMilliseconds / 1000);
      if (!startedAt || watchedSeconds < 3) return null;
      return snapshot(Date.now());
    }
  };
}

function formatWatchDuration(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  if (safe < 60) return `${safe}秒`;
  const minutes = Math.floor(safe / 60);
  return minutes < 60 ? `${minutes}分钟` : `${Math.floor(minutes / 60)}小时${minutes % 60 ? `${minutes % 60}分` : ''}`;
}

function formatWatchDate(timestamp) {
  // 固定北京时间，不跟 WebView 本地时区走。手机在中国时和原来的本地显示一致。
  return formatShanghaiStamp(timestamp) || '未知时间';
}

function feedTransitionPreviewHtml(items, activeIndex) {
  if (items.length <= 1) return '';
  return [
    { key: 'previous', item: items[(activeIndex - 1 + items.length) % items.length] },
    { key: 'next', item: items[(activeIndex + 1) % items.length] }
  ].filter(entry => entry.item).map(({ key, item }) => `<div class="vault-feed-transition-preview is-${key}" data-feed-preview="${key}" aria-hidden="true">${item.poster ? `<img src="${imgSrc(item.poster)}" alt="">` : '<span class="material-symbols-outlined">movie</span>'}</div>`).join('');
}

function bindVideoFullscreen(player, fullscreenTarget, video, navigateVideo) {
  const fullscreenButton = $('#warm-video-fullscreen');
  const exitButton = $('#warm-video-exit-fullscreen');
  const episodesButton = $('#warm-video-episodes');
  const episodePanel = $('#warm-video-episode-panel');
  const folderPanel = $('#vault-feed-folder-panel');
  const historyPanel = $('#vault-feed-history-panel');
  const closeEpisodesButton = $('#warm-video-close-episodes');
  const landscapeQuery = window.matchMedia?.('(orientation: landscape)');
  const closeEpisodesInLandscape = event => {
    if (!(event?.matches ?? landscapeQuery?.matches)) return;
    if (episodePanel) episodePanel.hidden = true;
    if (folderPanel) folderPanel.hidden = true;
    if (historyPanel) historyPanel.hidden = true;
  };
  if (landscapeQuery?.addEventListener) landscapeQuery.addEventListener('change', closeEpisodesInLandscape);
  else landscapeQuery?.addListener?.(closeEpisodesInLandscape);
  const isLandscape = () => Number(player.videoWidth) > Number(player.videoHeight);
  const restore = () => {
    document.body.classList.remove('video-landscape-fullscreen');
    if (activeVideoLandscapeFullscreen) callHelper('restoreTimerOrientation');
    activeVideoLandscapeFullscreen = false;
  };
  const begin = () => {
    if (!isLandscape()) return;
    closeEpisodesInLandscape({ matches: true });
    activeVideoLandscapeFullscreen = true;
    document.body.classList.add('video-landscape-fullscreen');
    callHelper('setTimerOrientation', 'landscape');
  };
  const changed = () => { if (!document.fullscreenElement && !player.webkitDisplayingFullscreen) restore(); };
  const enter = () => {
    begin();
    if (fullscreenTarget?.requestFullscreen) fullscreenTarget.requestFullscreen().catch(() => { restore(); show('当前设备无法进入全屏'); });
    else if (player.webkitEnterFullscreen) player.webkitEnterFullscreen();
    else { restore(); show('当前设备不支持视频全屏'); }
  };
  const exitFullscreen = () => {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    else if (player.webkitDisplayingFullscreen && player.webkitExitFullscreen) player.webkitExitFullscreen();
    restore();
  };
  fullscreenButton?.addEventListener('click', enter);
  exitButton?.addEventListener('click', exitFullscreen);
  const toggleEpisodes = () => { if (episodePanel && !landscapeQuery?.matches) episodePanel.hidden = !episodePanel.hidden; };
  episodesButton?.addEventListener('click', toggleEpisodes);
  closeEpisodesButton?.addEventListener('click', toggleEpisodes);
  const pageButtons = $$('[data-video-fullscreen-page]:not(:disabled)');
  pageButtons.forEach(button => button.onclick = () => { exitFullscreen(); navigateVideo(Number(button.dataset.videoFullscreenPage)); });
  const episodeButtons = $$('[data-video-episode-page]');
  episodeButtons.forEach(button => button.onclick = () => { exitFullscreen(); navigateVideo(Number(button.dataset.videoEpisodePage)); });
  document.addEventListener('fullscreenchange', changed);
  player.addEventListener('webkitbeginfullscreen', begin);
  player.addEventListener('webkitendfullscreen', restore);
  return () => {
    fullscreenButton?.removeEventListener('click', enter);
    exitButton?.removeEventListener('click', exitFullscreen);
    episodesButton?.removeEventListener('click', toggleEpisodes);
    closeEpisodesButton?.removeEventListener('click', toggleEpisodes);
    pageButtons.forEach(button => { button.onclick = null; });
    episodeButtons.forEach(button => { button.onclick = null; });
    document.removeEventListener('fullscreenchange', changed);
    player.removeEventListener('webkitbeginfullscreen', begin);
    player.removeEventListener('webkitendfullscreen', restore);
    if (landscapeQuery?.removeEventListener) landscapeQuery.removeEventListener('change', closeEpisodesInLandscape);
    else landscapeQuery?.removeListener?.(closeEpisodesInLandscape);
    restore();
  };
}

function clockText(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, '0')}`;
}

async function addSnippetVideo(input) {
  if (pendingSnippetVideos.length >= SNIPPET_PHOTO_LIMIT) return show(`最多 ${SNIPPET_PHOTO_LIMIT} 个视频`);
  show('正在读取视频并生成封面…');
  let metadata = {};
  const poster = await captureVideoFrame(input.previewSource || input, { onMetadata: value => { metadata = value; } });
  const video = input.nativeSource
    ? await saveNativeMediaSource(input.nativeSource, { name: input.name, size: input.size })
    : await saveMediaFile(input);
  pendingSnippetVideos.push({ poster, video, ...metadata });
  refreshSnippetVideoGrid();
  show('视频已保存到本机');
}

async function fileFromCameraVideo() {
  const result = await Camera.recordVideo({ saveToGallery: false, includeMetadata: true, isPersistent: true });
  if (result.type !== 'Video' || (!result.uri && !result.webPath)) throw new Error('相机没有返回视频');
  const source = result.uri || result.webPath;
  return { nativeSource: source, previewSource: Capacitor.convertFileSrc(source), name: `capture-${Date.now()}.mp4`, size: 0 };
}

async function fileFromPickedVideo() {
  const picked = await FilePicker.pickVideos({ limit: 1 });
  const item = picked.files?.[0];
  if (!item) return null;
  if (Capacitor.isNativePlatform() && item.path) {
    return { nativeSource: item.path, previewSource: Capacitor.convertFileSrc(item.path), name: item.name || `picked-${Date.now()}.mp4`, size: Number(item.size) || 0 };
  }
  if (item.blob) return new File([item.blob], item.name || `picked-${Date.now()}.mp4`, { type: item.mimeType || item.blob.type || 'video/mp4' });
  throw new Error('无法读取所选视频');
}

async function pickSnippetVideo(useCamera = false) {
  if (pendingSnippetVideos.length >= SNIPPET_PHOTO_LIMIT) return show(`最多 ${SNIPPET_PHOTO_LIMIT} 个视频`);
  if (useCamera && Capacitor.isNativePlatform()) {
    try {
      await addSnippetVideo(await fileFromCameraVideo());
    } catch (error) {
      if (isCameraCancellation(error)) return;
      throw error;
    }
    return;
  }
  if (!Capacitor.isNativePlatform()) return pickSnippetVideoWithInput(useCamera);
  const file = await fileFromPickedVideo();
  if (file) await addSnippetVideo(file);
}

function pickSnippetVideoWithInput(useCamera = false) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'video/*';
    if (useCamera) input.setAttribute('capture', 'environment');
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) return resolve();
        await addSnippetVideo(file);
        resolve();
      } catch (error) { reject(error); }
    };
    input.click();
  });
}

// ---- AI 结构化建议 ----
function bindSnippetStructureActions(item) {
  $('#ai-structure-run')?.addEventListener('click', () => runSnippetStructure(item).catch(error => show(error.message)));
  $('#ai-structure-result')?.addEventListener('click', event => bindSnippetStructureApply(item, event));
}

async function runSnippetStructure(item) {
  const content = ($('textarea[name="text"]', $('#snippet-form'))?.value || '').trim();
  if (!content) return show('先写点内容，AI 才能帮你整理');
  const button = $('#ai-structure-run');
  button.disabled = true;
  button.innerHTML = '<span class="material-symbols-outlined">auto_awesome</span>整理中…';
  try {
    snippetSuggestion = await aiSuggestStructure(state, { source: 'snippet', content });
    const result = $('#ai-structure-result');
    const suggestion = snippetSuggestion;
    if (!suggestion || (!suggestion.tags.length && !suggestion.todos.length && !suggestion.summary)) {
      result.innerHTML = '<p class="ai-structure-fail">暂时没有可以整理的内容。</p>';
      return;
    }
    result.innerHTML = `<div class="ai-structure-group">${suggestion.tags.length ? `<div class="ai-structure-group-head"><span class="material-symbols-outlined">sell</span><div><strong>标签建议</strong><small>点击选择要采纳的标签</small></div></div><div class="ai-structure-tags">${suggestion.tags.map(tag => `<button type="button" class="ai-tag-chip active" data-ai-tag="${esc(tag)}">#${esc(tag)}</button>`).join('')}</div><div class="ai-structure-actions"><button type="button" class="ai-structure-apply" data-ai-apply-tags>采纳选中</button></div>` : ''}</div>${suggestion.todos.length ? `<div class="ai-structure-group">${suggestion.todos.map(todo => `<label class="ai-todo-row"><input type="checkbox" value="${esc(todo)}" checked><span><b>${esc(todo)}</b><small>会加入待办清单</small></span></label>`).join('')}<div class="ai-structure-actions"><button type="button" class="ai-structure-apply" data-ai-apply-todos>创建待办</button></div></div>` : ''}${suggestion.summary ? `<div class="ai-structure-group"><div class="ai-structure-group-head"><span class="material-symbols-outlined">notes</span><div><strong>一句话摘要</strong><small>保存到这条记录</small></div></div><p class="ai-structure-summary-text">${esc(suggestion.summary)}</p><div class="ai-structure-actions"><button type="button" class="ai-structure-apply" data-ai-apply-summary>采纳摘要</button></div></div>` : ''}<div class="ai-structure-footer"><button type="button" id="ai-structure-all">全部采纳</button></div>`;
  } catch {
    snippetSuggestion = null;
    const result = $('#ai-structure-result');
    if (result) result.innerHTML = '<p class="ai-structure-fail">整理失败，稍后再试。</p>';
  } finally {
    button.disabled = false;
    button.innerHTML = '<span class="material-symbols-outlined">auto_awesome</span>整理内容';
  }
}

function bindSnippetStructureApply(item, event) {
  const target = event.target;
  const result = $('#ai-structure-result');
  if (!result) return;
  const suggestion = snippetSuggestion || {};
  const toggle = tag => {
    const chip = $(`[data-ai-tag="${tag}"]`, result);
    if (chip) chip.classList.toggle('active');
  };
  if (target.dataset.aiTag !== undefined) toggle(target.dataset.aiTag);
  if (target.id === 'ai-structure-all' || target.dataset.aiApplyTags !== undefined || target.dataset.aiApplyTodos !== undefined || target.dataset.aiApplySummary !== undefined) {
    adoptSnippetStructure(item, {
      tags: target.dataset.aiApplyTags !== undefined || target.id === 'ai-structure-all' ? [...$$('[data-ai-tag].active', result)].map(chip => chip.dataset.aiTag) : [],
      todos: target.dataset.aiApplyTodos !== undefined || target.id === 'ai-structure-all' ? [...$$('.ai-todo-row input:checked', result)].map(input => input.value) : [],
      summary: target.dataset.aiApplySummary !== undefined || target.id === 'ai-structure-all' ? suggestion.summary || '' : ''
    });
  }
}

async function adoptSnippetStructure(item, { tags = [], todos = [], summary = '' } = {}) {
  const accepted = { summary: '' };
  if (tags.length) {
    pendingSnippetStructure.tags = [...new Set([...pendingSnippetStructure.tags, ...tags])].slice(0, 8);
    const existing = state.snippets.find(entry => entry.id === item.id);
    if (existing) existing.tags = pendingSnippetStructure.tags;
    show(`已采纳 ${tags.length} 个标签`);
  }
  if (summary) {
    pendingSnippetStructure.summary = String(summary).trim().slice(0, 120);
    const existing = state.snippets.find(entry => entry.id === item.id);
    if (existing) existing.summary = pendingSnippetStructure.summary;
    accepted.summary = pendingSnippetStructure.summary;
    show('已采纳摘要');
  }
  let created = 0;
  if (todos.length) {
    for (const title of todos) {
      const clean = String(title).trim().slice(0, 80);
      if (!clean) continue;
      if (state.todos.some(todo => !todo.completed && todo.title === clean)) continue;
      state.todos.push(makeTodo({ title: clean, date: item.date, createdAt: Date.now() }));
      created += 1;
    }
    if (created) show(`已创建 ${created} 条待办`);
  }
  const memorySummary = accepted.summary;
  const memoryTodos = [...todos];
  if (memorySummary || memoryTodos.length) applySuggestion(state, { summary: memorySummary, todos: memoryTodos });
  await save();
  const result = $('#ai-structure-result');
  if (result) {
    $$('[data-ai-tag].active', result).forEach(chip => chip.classList.add('taken'));
    $$('[data-ai-tag]', result).forEach(chip => chip.classList.remove('active'));
    if (tags.length) {
      const group = result.querySelector('.ai-structure-group');
      const apply = result.querySelector('[data-ai-apply-tags]');
      if (apply) { apply.disabled = true; apply.textContent = '已采纳'; }
    }
    if (todos.length) {
      const apply = result.querySelector('[data-ai-apply-todos]');
      if (apply) { apply.disabled = true; apply.textContent = '已创建'; }
    }
    if (summary) {
      const apply = result.querySelector('[data-ai-apply-summary]');
      if (apply) { apply.disabled = true; apply.textContent = '已采纳'; }
    }
    const all = $('#ai-structure-all', result);
    if (all) {
      all.disabled = !result.querySelector('.ai-structure-apply:not([disabled])');
      all.textContent = '已全部采纳';
    }
  }
}

// ---- 绑定 ----

// ---- 原型弹窗补齐：随手拍发布 / 速记便签 / 照片大图查看器 ----
// quick-photo-modal：拍照预览（复用现有拍照能力）+ 标签胶囊 + 手写体图说
function quickPhotoModal() {
  pendingSnippetPhotos = [];
  pendingSnippetLive = [];
  pendingSnippetVideos = [];
  pendingQuickTag = '';
  pendingQuickCaption = '';
  let isAddingTag = false;
  let confirmingTag = null;
  let suppressClickUntil = 0;

  modal(`<div class="quick-modal-card" id="quick-photo-modal">
    <img class="quick-paper-art" src="assets/quick-photo-paper-v1.png" alt="" aria-hidden="true">
    <div class="quick-modal-head"><div class="quick-modal-heading"><span class="quick-modal-title-mark material-symbols-outlined" aria-hidden="true">photo_camera</span><span><small class="quick-modal-kicker">VISUAL MOMENT</small><h2 class="quick-modal-title">随手拍 <em>留住此刻</em></h2></span></div><button type="button" data-close class="quick-modal-close" aria-label="关闭随手拍"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></div>
    <div class="quick-photo-preview" id="quick-photo-preview" role="button" tabindex="0" aria-label="拍摄或选择照片">${quickPhotoPreview()}</div>
    <div class="quick-photo-meta">
      <label class="quick-field-label" for="quick-snap-caption">图说</label>
      <input class="quick-input-field caveat-caption" id="quick-snap-caption" maxlength="40" placeholder="写一句图说" value="${esc(pendingQuickCaption)}">
      <div class="quick-tag-row" aria-label="选择标签"></div>
    </div>
    <div class="quick-capture-bar" role="toolbar" aria-label="随手拍操作">
      <div class="quick-photo-actions">
        <button type="button" id="quick-capture-snap" class="plain-moment-btn"><span class="material-symbols-outlined" aria-hidden="true">photo_camera</span><span>拍照</span></button>
        <button type="button" id="quick-pick-snap" class="plain-moment-btn"><span class="material-symbols-outlined" aria-hidden="true">photo_library</span><span>选图</span></button>
      </div>
      <div class="quick-video-actions">
        <button type="button" id="quick-pick-video" class="plain-moment-btn"><span class="material-symbols-outlined" aria-hidden="true">video_library</span><span>导入视频</span></button>
      </div>
      <button type="button" class="quick-publish-btn snap" id="quick-save-snap" aria-label="收进今日生活相册"><span class="material-symbols-outlined" aria-hidden="true">check</span><span>保存</span></button>
    </div>
    <div class="quick-modal-switch"><button type="button" id="quick-switch-memo">或写一条灵感速记 ›</button></div>
  </div>`, 'quick-modal quick-photo-sheet');

  function renderQuickTagRow() {
    const row = $('#quick-photo-modal .quick-tag-row');
    if (!row) return;

    state.settings = state.settings || {};
    const tags = quickTagList(state.settings.quickTags);

    let html = '';
    for (const tag of tags) {
      const fullTag = '#' + tag;
      if (confirmingTag === tag) {
        html += `<span class="quick-tag-confirm-bar">删除 #${esc(tag)} ？ <button type="button" class="quick-tag-confirm-del" data-del-tag="${esc(tag)}">删除</button> / <button type="button" class="quick-tag-confirm-cancel">取消</button></span>`;
      } else {
        html += `<button type="button" class="quick-paper-tag ${pendingQuickTag === fullTag ? 'active' : ''}" data-quick-tag="${esc(fullTag)}">${esc(fullTag)}</button>`;
      }
    }

    if (isAddingTag) {
      html += `<span class="quick-tag-input-wrap"><input class="quick-tag-input" maxlength="20" placeholder="新标签"><button type="button" class="quick-tag-btn-add">添加</button></span>`;
    } else {
      html += `<button type="button" class="quick-paper-tag quick-tag-add" data-quick-tag-add>＋ 自定义</button>`;
    }

    row.innerHTML = html;

    row.querySelectorAll('button[data-quick-tag]').forEach(chip => {
      let pressTimer = null;
      let startX = 0;
      let startY = 0;
      let didLongPress = false;

      const cancelPress = () => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
      };

      chip.addEventListener('pointerdown', e => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        cancelPress();
        didLongPress = false;
        startX = e.clientX;
        startY = e.clientY;
        const tag = chip.dataset.quickTag?.replace(/^[#＃]+/, '');
        pressTimer = setTimeout(() => {
          pressTimer = null;
          didLongPress = true;
          suppressClickUntil = Date.now() + 450;
          confirmingTag = tag;
          isAddingTag = false;
          renderQuickTagRow();
        }, 550);
      });

      chip.addEventListener('pointermove', e => {
        if (pressTimer) {
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          if (Math.hypot(dx, dy) > 8) {
            cancelPress();
          }
        }
      });

      chip.addEventListener('pointerup', cancelPress);
      chip.addEventListener('pointercancel', cancelPress);

      chip.addEventListener('contextmenu', e => {
        e.preventDefault();
        cancelPress();
        didLongPress = true;
        suppressClickUntil = Date.now() + 450;
        const tag = chip.dataset.quickTag?.replace(/^[#＃]+/, '');
        confirmingTag = tag;
        isAddingTag = false;
        renderQuickTagRow();
      });

      chip.addEventListener('click', e => {
        if (didLongPress || Date.now() < suppressClickUntil) {
          didLongPress = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const tag = chip.dataset.quickTag;
        pendingQuickTag = pendingQuickTag === tag ? '' : tag;
        row.querySelectorAll('button[data-quick-tag]').forEach(b => {
          b.classList.toggle('active', b.dataset.quickTag === pendingQuickTag);
        });
      });
    });

    const delBtn = row.querySelector('.quick-tag-confirm-del');
    if (delBtn) {
      delBtn.addEventListener('click', async e => {
        e.preventDefault();
        e.stopPropagation();
        const tag = delBtn.dataset.delTag;
        state.settings = state.settings || {};
        state.settings.quickTags = removeQuickTag(state.settings.quickTags, tag);
        if (pendingQuickTag === '#' + tag) {
          pendingQuickTag = '';
        }
        confirmingTag = null;
        await save();
        renderQuickTagRow();
      });
    }

    const cancelBtn = row.querySelector('.quick-tag-confirm-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        confirmingTag = null;
        renderQuickTagRow();
      });
    }

    const addBtn = row.querySelector('[data-quick-tag-add]');
    if (addBtn) {
      addBtn.addEventListener('click', e => {
        e.preventDefault();
        confirmingTag = null;
        isAddingTag = true;
        renderQuickTagRow();
      });
    }

    const input = row.querySelector('.quick-tag-input');
    const submitBtn = row.querySelector('.quick-tag-btn-add');

    const commitAdd = async () => {
      const val = input ? input.value : '';
      const norm = normalizeQuickTag(val);
      if (norm) {
        state.settings = state.settings || {};
        state.settings.quickTags = addQuickTag(state.settings.quickTags, norm);
        pendingQuickTag = '#' + norm;
        isAddingTag = false;
        await save();
        renderQuickTagRow();
      } else {
        isAddingTag = false;
        renderQuickTagRow();
      }
    };

    if (input) {
      input.focus();
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitAdd();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          isAddingTag = false;
          renderQuickTagRow();
        }
      });

      input.addEventListener('blur', () => {
        setTimeout(() => {
          if (isAddingTag && input && !normalizeQuickTag(input.value)) {
            isAddingTag = false;
            renderQuickTagRow();
          }
        }, 120);
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener('pointerdown', e => e.preventDefault());
      submitBtn.addEventListener('mousedown', e => e.preventDefault());
      submitBtn.addEventListener('click', e => {
        e.preventDefault();
        commitAdd();
      });
    }
  }

  renderQuickTagRow();

  $('#quick-photo-preview')?.addEventListener('click', event => {
    const allBtn = event.target.closest('[data-moment-spread-all]');
    if (allBtn) {
      event.stopPropagation();
      event.preventDefault();
      if (pendingSnippetPhotos.length) {
        photoViewer(photosWithLiveMotion(pendingSnippetPhotos, pendingSnippetLive), Math.min(3, pendingSnippetPhotos.length - 1));
      }
      return;
    }
    pickSnippetPhoto(true).catch(error => show(error.message)).then(refreshQuickPhotoPreview);
  });
  $('#quick-photo-preview')?.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('[data-moment-spread-all]')) return;
    event.preventDefault();
    pickSnippetPhoto(true).catch(error => show(error.message)).then(refreshQuickPhotoPreview);
  });
  $('#quick-capture-snap')?.addEventListener('click', () => pickSnippetPhoto(true).catch(error => show(error.message)).then(refreshQuickPhotoPreview));
  $('#quick-pick-snap')?.addEventListener('click', () => pickSnippetPhoto(false).catch(error => show(error.message)).then(refreshQuickPhotoPreview));
  $('#quick-pick-video')?.addEventListener('click', () => pickSnippetVideo(false).then(refreshQuickPhotoPreview).catch(error => show(error.message)));
  $('#quick-snap-caption')?.addEventListener('input', event => { pendingQuickCaption = event.target.value; });
  $('#quick-switch-memo')?.addEventListener('click', () => quickMemoModal());
  $('#quick-save-snap')?.addEventListener('click', () => saveQuickSnap().catch(error => show(error.message)));
}

function quickPhotoPreview() {
  const photos = [...pendingSnippetPhotos];
  const videos = [...pendingSnippetVideos];
  if (!photos.length && !videos.length) return '<span class="quick-photo-empty-icon material-symbols-outlined">photo_camera</span><strong>把这一刻留在这里</strong><small>轻触拍摄 · 或从相册选择</small>';
  let visual = '';
  if (photos.length) {
    visual = momentSpreadHtml(photos);
  } else {
    const cover = videos[0]?.poster || '';
    visual = cover ? `<img src="${imgSrc(cover)}" alt="预览画面">` : '<span class="quick-video-preview-placeholder"><span class="material-symbols-outlined">live_tv</span><strong>视频</strong></span>';
  }
  const liveCount = pendingSnippetLive.filter(item => photos.includes(item.still)).length;
  const viewAllBtn = photos.length > 0 ? '<button type="button" class="quick-photo-view-all plain-moment-btn" data-moment-spread-all>查看全部</button>' : '';
  const bits = [];
  if (photos.length) bits.push(`${photos.length} 张照片`);
  if (liveCount) bits.push(`${liveCount} 张实况`);
  if (videos.length) bits.push(`${videos.length} 段视频`);
  return `${visual}<span class="quick-photo-overlay"><small>${bits.join(' · ')}</small>${viewAllBtn}</span>`;
}

function refreshQuickPhotoPreview() {
  const preview = $('#quick-photo-preview');
  if (preview) preview.innerHTML = quickPhotoPreview();
}

async function saveQuickSnap() {
  const text = pendingQuickCaption.trim();
  if (!pendingSnippetPhotos.length && !pendingSnippetVideos.length) return show('请先拍一张或选择一张照片');
  if (pendingQuickTag) {
    state.settings = state.settings || {};
    state.settings.quickTags = recordQuickTag(state.settings.quickTags, pendingQuickTag);
  }
  const next = makeSnippet({ type: 'photo', date: dateKey(), text, photos: pendingSnippetPhotos, livePhotos: pendingSnippetLive, videos: pendingSnippetVideos, tags: pendingQuickTag ? [pendingQuickTag.slice(1)] : [], createdAt: Date.now(), updatedAt: Date.now() });
  state.snippets.push(next);
  pendingSnippetPhotos = [];
  pendingSnippetLive = [];
  pendingSnippetVideos = [];
  pendingQuickTag = '';
  pendingQuickCaption = '';
  await save(); closeModal(); render(); show('已发布随手拍');
  if (next.photo) callHelper('rememberPhoto', next.photo).catch(() => {});
}

// quick-memo-modal：文本 + 语音 mic + 标签
function quickMemoModal() {
  quickMemoVoice?.destroy();
  quickMemoVoice = null;
  pendingQuickTag = '';
  modal(`<div class="quick-modal-card" id="quick-memo-modal">
    <img class="quick-paper-art" src="assets/quick-memo-paper-v1.png" alt="" aria-hidden="true">
    <div class="quick-modal-head"><div class="quick-modal-heading"><span class="quick-modal-title-mark material-symbols-outlined" aria-hidden="true">edit_note</span><span><small class="quick-modal-kicker">DAILY NOTE</small><h2 class="quick-modal-title">灵感速记 <em>随手记</em></h2></span></div><button type="button" data-close class="quick-modal-close" aria-label="关闭随手记"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></div>
    <div class="quick-memo-wrap">
      <textarea class="quick-input-field quick-memo-text" id="quick-memo-input" maxlength="500" aria-label="随手记内容" placeholder="记下浮现的想法、金句或复习心得..."></textarea>
      <button type="button" class="quick-memo-mic" id="quick-memo-mic-btn" data-mic aria-label="语音速记"><span class="material-symbols-outlined">mic</span></button>
    </div>
    <div class="quick-tag-row" aria-label="选择标签">${['#灵感便签', '#考研复盘', '#生活随笔'].map(tag => `<button type="button" class="quick-paper-tag ${pendingQuickTag === tag ? 'active' : ''}" data-quick-tag="${tag}">${tag}</button>`).join('')}</div>
    <div class="quick-modal-switch"><button type="button" id="quick-switch-snap">或发布一张随手拍 ›</button></div>
    <button type="button" class="quick-publish-btn memo" id="quick-save-memo"><span>贴在今日心流便签</span><span class="material-symbols-outlined" aria-hidden="true">push_pin</span></button>
  </div>`, 'quick-modal');
  $$('.quick-paper-tag').forEach(chip => chip.onclick = () => {
    pendingQuickTag = pendingQuickTag === chip.dataset.quickTag ? '' : chip.dataset.quickTag;
    $$('.quick-paper-tag').forEach(b => b.classList.toggle('active', b.dataset.quickTag === pendingQuickTag));
  });
  $('#quick-switch-snap')?.addEventListener('click', () => quickPhotoModal());
  $('#quick-save-memo')?.addEventListener('click', () => saveQuickMemo().catch(error => show(error.message)));
  quickMemoVoice = bindVoiceInput($('#quick-memo-modal'), { input: () => $('#quick-memo-input'), onText: () => {} });
}

function pickVideoPoster(index) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) return resolve();
        if (file.size > 20 * 1024 * 1024 || !isSupportedJournalPhoto(file)) throw new Error('封面仅支持 20MB 以内的 JPG、PNG 或 WebP');
        pendingSnippetVideos[index].poster = await compressSnippetPhoto(file);
        refreshSnippetVideoGrid();
        show('视频封面已更换');
        resolve();
      } catch (error) { reject(error); }
    };
    input.click();
  });
}

async function recapturePendingVideoPoster(index) {
  const item = pendingSnippetVideos[index];
  const source = mediaSource(item?.video);
  if (!source) throw new Error('原视频文件不存在，无法重新生成封面');
  showVideoFramePicker(source, { title: '从视频选择封面', initialTime: item.coverTime || 0, onApply: async (poster, time) => { item.poster = poster; item.coverTime = time; refreshSnippetVideoGrid(); show('视频封面已更新'); } });
}

async function refreshStoredVideoPoster(entryId, index) {
  const entry = state.snippets.find(item => item.id === entryId);
  const video = entry?.videos?.[index];
  const source = mediaSource(video?.video);
  if (!source) throw new Error('原视频文件不存在，无法重新生成封面');
  showVideoFramePicker(source, { title: '从视频选择封面', initialTime: video.coverTime || 0, onApply: async (poster, time) => { video.poster = poster; video.coverTime = time; await save(); render(); show('视频封面已更新'); } });
}

async function saveQuickMemo() {
  const text = ($('#quick-memo-input')?.value || '').trim();
  if (!text) return show('写点什么再贴上去吧');
  const next = makeSnippet({ type: 'text', date: dateKey(), text, tags: pendingQuickTag ? [pendingQuickTag.slice(1)] : [], createdAt: Date.now(), updatedAt: Date.now() });
  state.snippets.push(next);
  quickMemoVoice?.destroy();
  quickMemoVoice = null;
  pendingQuickTag = '';
  await save(); closeModal(); render(); show('已贴入速记');
  callHelper('scheduleAiRefresh');
}

function visibleMomentPhotoEntries() {
  return snippetEntries(state, { type: 'photo', search: snippetSearch })
    .filter(item => (item.photos?.length || item.photo) && (snippetType !== 'live' || snippetHasLive(item)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}


// ---- 单条随手拍相册浏览层：图集 → 一叠牌（轻触看大图、左右拖翻下一张）→ 既有大图/播放器 ----
// 2026-10-12 用户要求：把图集「照着日记翻牌的形式来」——
// 一屏一张大卡（后两张露边），点照片开大图，左右拖动翻下一张（对应日记牌组的深度与拖拽手感）。
// 仍是纯导航层，不写存储。
let momentAlbumEntryId = '';
let momentAlbumIndex = 0;

function momentAlbumItems(entry) {
  if (!entry) return [];
  const photos = entry.photos?.length ? entry.photos : (entry.photo ? [entry.photo] : []);
  const videos = entry.videos || [];
  const items = [];
  photos.forEach((photo, index) => items.push({ kind: 'photo', index, photo }));
  videos.forEach((video, index) => items.push({ kind: 'video', index, video }));
  return items;
}

/** 动效档位：none = 系统减弱动态；lite = 低端机（只留位移，不跟手推后牌、不倾斜）；rich = 完整。 */
function momentAlbumTier() {
  if (prefersReducedMotion()) return 'none';
  const nav = typeof navigator === 'object' ? navigator : {};
  if ((nav.deviceMemory && nav.deviceMemory <= 3) || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4)) return 'lite';
  return 'rich';
}
// 深度 0/1/2 的静止姿态（与 CSS 一致），拖动时后牌按进度在相邻两档之间插值
const MOMENT_ALBUM_DEPTH = [{ y: 0, s: 1, o: 1 }, { y: -12, s: 0.972, o: 0.96 }, { y: -24, s: 0.944, o: 0.9 }];
const MOMENT_ALBUM_THROW_MS = 300;
const MOMENT_ALBUM_SPRING = 'cubic-bezier(.34,1.56,.64,1)';
const MOMENT_ALBUM_OUT = 'cubic-bezier(.2,.8,.2,1)';
let momentAlbumOrigin = null;
let momentAlbumCloseToken = 0;

function momentAlbumDepthTransform(depth) {
  const d = MOMENT_ALBUM_DEPTH[Math.max(0, Math.min(2, depth))];
  return { transform: `translate3d(0,${d.y}px,0) scale(${d.s})`, opacity: d.o };
}

function isMomentAlbumOpen() {
  return Boolean($('#moment-album-layer')?.classList.contains('open'));
}

function closeMomentAlbum() {
  const layer = $('#moment-album-layer');
  if (!layer) return false;
  const wasOpen = layer.classList.contains('open');
  const token = ++momentAlbumCloseToken;
  const finish = () => {
    if (token !== momentAlbumCloseToken) return;
    layer.classList.remove('is-closing');
    layer.innerHTML = '';
    layer.hidden = true;
    layer.style.opacity = '';
  };
  const sheet = layer.querySelector('.moment-album-sheet');
  const origin = momentAlbumOrigin;
  momentAlbumOrigin = null;
  layer.style.opacity = '';
  layer.classList.remove('open');
  momentAlbumEntryId = '';
  // 收回：缩回到当初点的那张缩略图（还在页面上才做），只动 transform / opacity
  if (wasOpen && sheet && momentAlbumTier() !== 'none' && sheet.animate) {
    layer.classList.add('is-closing');
    const frames = momentAlbumOriginFrames(sheet, origin);
    try {
      const anim = sheet.animate(frames.reverse(), { duration: momentAlbumTier() === 'lite' ? 160 : 240, easing: MOMENT_ALBUM_OUT, fill: 'forwards' });
      layer.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
      anim.onfinish = finish;
      setTimeout(finish, 400);
    } catch { finish(); }
  } else {
    finish();
  }
  callHelper('syncSystemBackConsumption');
  return wasOpen;
}

/** 从缩略图位置长出来的关键帧；缩略图不在了就退成轻微上浮。 */
function momentAlbumOriginFrames(sheet, origin) {
  const end = { transform: 'none', opacity: 1 };
  if (origin?.isConnected && momentAlbumTier() === 'rich') {
    const from = origin.getBoundingClientRect();
    const to = sheet.getBoundingClientRect();
    if (from.width && to.width) {
      const s = Math.max(0.2, Math.min(1, from.width / to.width));
      const x = (from.left + from.width / 2) - (to.left + to.width / 2);
      const y = (from.top + from.height / 2) - (to.top + to.height / 2);
      return [{ transform: `translate3d(${x}px,${y}px,0) scale(${s})`, opacity: 0.2 }, end];
    }
  }
  return [{ transform: 'translate3d(0,24px,0)', opacity: 0 }, end];
}

function ensureMomentAlbumLayer() {
  let layer = $('#moment-album-layer');
  if (layer) return layer;
  layer = document.createElement('div');
  layer.id = 'moment-album-layer';
  layer.className = 'moment-album-layer';
  layer.hidden = true;
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  document.body.appendChild(layer);
  return layer;
}

function momentAlbumCardHtml(item, entry, depth) {
  const label = item.kind === 'video' ? `播放第 ${item.index + 1} 个视频` : `查看第 ${item.index + 1} 张照片`;
  const kindClass = item.kind === 'video' ? ' is-video' : '';
  let media = '';
  if (item.kind === 'video') {
    const video = item.video;
    const hls = video.sourceType === 'hls' || isHlsAddress(video.video);
    const poster = video.poster ? imgSrc(video.poster) : '';
    media = poster
      ? photoFrameLayersHtml(poster, { alt: entry.text || `视频 ${item.index + 1}`, padClass: 'moment-album-blur', stillClass: 'moment-album-still' })
      : `<span class="moment-album-empty material-symbols-outlined">${hls ? 'stream' : 'movie'}</span>`;
    media += `<span class="moment-album-play" aria-hidden="true"><span class="material-symbols-outlined">play_arrow</span></span>${videoDurationStamp(video)}`;
  } else {
    media = `${snippetPhotoImage(item.photo, entry.text || `随手拍 ${item.index + 1}`)}${photoHasLiveMark(item.photo, entry.livePhotos)}`;
  }
  // 牌面是一张纸卡，照片在里面的共用相框里（contain/纸色兜底），与日记牌组同一种「牌」的感觉
  return `<button type="button" class="moment-album-card${kindClass}" data-depth="${depth}" data-moment-album-kind="${item.kind}" data-moment-album-index="${item.index}" aria-label="${label}"><span class="moment-album-frame photo-blur-frame is-edge">${media}</span></button>`;
}

function momentAlbumStackHtml(items, entry, index) {
  const count = items.length;
  const depthCount = Math.min(3, count);
  return Array.from({ length: depthCount }, (_, depth) => momentAlbumCardHtml(items[(index + depth) % count], entry, depth)).join('');
}

/** 轻触牌面：看大图（视频则播放）。牌堆不动。 */
function openMomentAlbumCurrent() {
  const entry = state.snippets.find(item => item.id === momentAlbumEntryId);
  if (!entry) return;
  const item = momentAlbumItems(entry)[momentAlbumIndex];
  if (!item) return;
  if (item.kind === 'video') {
    if (item.video) openSavedSnippetVideo(entry, item.index);
    return;
  }
  // 走既有 photoLightbox（含实况照片的无闪路径）；牌堆留在下面，关掉大图还在原处
  photoLightbox(entry, item.index);
}

/** 首次铺牌（打开时一次）。之后翻牌只换出那一张，不再整堆重画。 */
function renderMomentAlbumStack(entry) {
  const layer = $('#moment-album-layer');
  const stack = layer?.querySelector('#moment-album-stack');
  if (!stack) return;
  const items = momentAlbumItems(entry);
  const count = items.length || 1;
  momentAlbumIndex = ((momentAlbumIndex % count) + count) % count;
  stack.innerHTML = momentAlbumStackHtml(items, entry, momentAlbumIndex);
  momentAlbumUpdateCounter(count);
}

function momentAlbumUpdateCounter(count) {
  const counter = $('#moment-album-layer')?.querySelector('#moment-album-counter');
  if (counter) counter.textContent = `${momentAlbumIndex + 1} / ${count}`;
}

function momentAlbumCardNode(item, entry, depth) {
  const holder = document.createElement('div');
  holder.innerHTML = momentAlbumCardHtml(item, entry, depth);
  const card = holder.firstElementChild;
  // 预解码：新牌进场前把图片解好，翻牌时不卡在 decode 上
  card?.querySelectorAll('img').forEach(img => { try { img.decoding = 'async'; img.decode?.().catch(() => {}); } catch { /* 忽略 */ } });
  return card;
}

/** 把牌放回它 data-depth 的静止位（清掉拖动时的内联样式，交给 CSS 过渡）。 */
function settleMomentAlbumCards(stack, ms, easing = MOMENT_ALBUM_OUT) {
  stack.querySelectorAll('.moment-album-card').forEach(card => {
    card.style.transition = ms ? `transform ${ms}ms ${easing}, opacity ${ms}ms ${easing}` : 'none';
    card.style.transform = '';
    card.style.opacity = '';
  });
}

/**
 * 翻一张。step=1 下一张：顶牌顺着手指方向甩出去，后两张各上前一档，牌底补一张；
 * step=-1 上一张：上一张从左侧滑回顶上，原顶牌退一档，最深那张撤掉。
 * fromX = 松手时顶牌已经在的位置（从那里接着甩，不先弹回原位）。
 */
function flipMomentAlbum(step, { fromX = 0, velocity = 0 } = {}) {
  const entry = state.snippets.find(item => item.id === momentAlbumEntryId);
  const stack = $('#moment-album-stack');
  if (!entry || !stack) return;
  const items = momentAlbumItems(entry);
  if (items.length < 2) return;
  const count = items.length;
  const tier = momentAlbumTier();
  const ms = tier === 'none' ? 0 : tier === 'lite' ? 200 : MOMENT_ALBUM_THROW_MS;
  momentAlbumIndex = ((momentAlbumIndex + step) % count + count) % count;
  const cards = [...stack.querySelectorAll('.moment-album-card')].sort((a, b) => a.dataset.depth - b.dataset.depth);
  const width = stack.clientWidth || 320;
  const depthCount = Math.min(3, count);

  if (step > 0) {
    const out = cards.shift();
    cards.forEach((card, i) => { card.dataset.depth = String(i); });
    if (depthCount > cards.length) {
      const fresh = momentAlbumCardNode(items[(momentAlbumIndex + cards.length) % count], entry, cards.length);
      if (fresh) { stack.appendChild(fresh); cards.push(fresh); }
    }
    if (out) {
      out.dataset.depth = 'out';
      if (!ms) out.remove();
      else {
        // 甩出：方向跟手；速度越快飞得越远，但时长固定，保证手感一致
        const dir = fromX > 0 || (fromX === 0 && velocity > 0) ? 1 : -1;
        const tilt = tier === 'rich' ? dir * 10 : 0;
        out.style.transition = 'none';
        out.style.transform = `translate3d(${fromX}px,0,0) rotate(${tier === 'rich' ? Math.max(-6, Math.min(6, fromX / 30)) : 0}deg)`;
        void out.offsetWidth;
        out.style.transition = `transform ${ms}ms ${MOMENT_ALBUM_OUT}, opacity ${ms}ms ${MOMENT_ALBUM_OUT}`;
        out.style.transform = `translate3d(${dir * width * 1.15}px,0,0) rotate(${tilt}deg)`;
        out.style.opacity = '0';
        setTimeout(() => out.remove(), ms + 40);
      }
    }
  } else {
    const fresh = momentAlbumCardNode(items[momentAlbumIndex], entry, 0);
    cards.forEach((card, i) => { card.dataset.depth = String(i + 1); });
    if (cards.length >= depthCount) {
      const drop = cards.pop();
      drop?.remove();
    }
    if (fresh) {
      stack.insertBefore(fresh, stack.firstChild);
      if (ms) {
        fresh.style.transition = 'none';
        fresh.style.transform = `translate3d(${-width * 1.1}px,0,0) rotate(${tier === 'rich' ? -8 : 0}deg)`;
        fresh.style.opacity = '0';
        void fresh.offsetWidth;
      }
    }
  }
  // 其余牌从当前（可能被拖动带着走了一半）的位置过渡到新深度
  [...stack.querySelectorAll('.moment-album-card')].forEach(card => {
    if (card.dataset.depth === 'out') return;
    card.style.transition = ms ? `transform ${ms}ms ${MOMENT_ALBUM_OUT}, opacity ${ms}ms ${MOMENT_ALBUM_OUT}` : 'none';
    card.style.transform = '';
    card.style.opacity = '';
  });
  momentAlbumUpdateCounter(count);
  // 再往后一张也先解码好，下一次翻也不卡
  const ahead = items[(momentAlbumIndex + 3) % count];
  if (ahead?.kind === 'photo' && typeof Image === 'function') {
    try { const img = new Image(); img.src = imgSrc(ahead.photo); img.decode?.().catch(() => {}); } catch { /* 忽略 */ }
  }
}

/** 牌堆手势：左右拖 = 翻下一张 / 上一张；没拖动（轻触）= 看大图。阈值与日记牌组同一条规则（deckCutDecision）。 */
function bindMomentAlbumDeck(layer) {
  const stage = layer.querySelector('#moment-album-stage');
  const stack = layer.querySelector('#moment-album-stack');
  if (!stage || !stack) return;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dragging = false;
  let moved = false;
  let samples = [];
  const topCard = () => stack.querySelector('.moment-album-card[data-depth="0"]');
  const backCards = () => [1, 2].map(d => stack.querySelector(`.moment-album-card[data-depth="${d}"]`));

  const paint = () => {
    const tier = momentAlbumTier();
    const card = topCard();
    if (!card || tier === 'none') return;
    const tilt = tier === 'rich' ? Math.max(-6, Math.min(6, dx / 30)) : 0;
    card.style.transition = 'none';
    card.style.transform = `translate3d(${dx}px,0,0) rotate(${tilt}deg)`;
    if (tier !== 'rich') return;
    // 后牌跟着拖动进度往前挪一档（只往左拖 = 下一张时；往右是「上一张」，后牌不动）
    const p = dx < 0 ? Math.min(1, -dx / 56) : 0;
    backCards().forEach((back, i) => {
      if (!back) return;
      const a = MOMENT_ALBUM_DEPTH[i + 1];
      const b = MOMENT_ALBUM_DEPTH[i];
      back.style.transition = 'none';
      back.style.transform = `translate3d(0,${a.y + (b.y - a.y) * p}px,0) scale(${a.s + (b.s - a.s) * p})`;
      back.style.opacity = String(a.o + (b.o - a.o) * p);
    });
  };
  const velocityNow = () => {
    const now = performance.now();
    const recent = samples.filter(s => now - s.t < 100);
    if (recent.length < 2) return 0;
    const first = recent[0];
    const last = recent[recent.length - 1];
    const dt = last.t - first.t;
    return dt > 0 ? ((last.x - first.x) / dt) * 1000 : 0;
  };

  stage.addEventListener('pointerdown', event => {
    if (pointerId !== null) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    dx = 0;
    dragging = true;
    moved = false;
    samples = [{ x: event.clientX, t: performance.now() }];
    try { stage.setPointerCapture(pointerId); } catch { /* 捕获失败也能靠 pointerup 收尾 */ }
  });
  stage.addEventListener('pointermove', event => {
    if (!dragging || event.pointerId !== pointerId) return;
    dx = event.clientX - startX;
    const dy = event.clientY - startY;
    samples.push({ x: event.clientX, t: performance.now() });
    if (samples.length > 8) samples.shift();
    // 还没判定方向：竖向为主的滑动不抢（留给页面/其它手势）
    if (!moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    if (!moved && Math.abs(dy) > Math.abs(dx)) { dragging = false; pointerId = null; return; }
    moved = true;
    paint();
  });
  const finish = event => {
    if (!dragging || (event && event.pointerId !== pointerId)) return;
    dragging = false;
    if (pointerId !== null) { try { stage.releasePointerCapture(pointerId); } catch { /* 忽略 */ } }
    pointerId = null;
    if (!moved) { openMomentAlbumCurrent(); return; }
    const velocity = velocityNow();
    const decision = deckCutDecision({ dx, width: stage.clientWidth || 1, velocity });
    if (decision === 'stay') {
      // 没过阈值：带一点回弹弹回原位
      const tier = momentAlbumTier();
      settleMomentAlbumCards(stack, tier === 'none' ? 0 : tier === 'lite' ? 180 : 320, tier === 'rich' ? MOMENT_ALBUM_SPRING : MOMENT_ALBUM_OUT);
      return;
    }
    flipMomentAlbum(decision === 'next' ? 1 : -1, { fromX: dx, velocity });
  };
  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', () => { dragging = false; pointerId = null; settleMomentAlbumCards(stack, momentAlbumTier() === 'none' ? 0 : 200); });
  // 键盘/无障碍：左右方向键也能翻，回车/空格由按钮自身触发轻触
  stage.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight') { event.preventDefault(); flipMomentAlbum(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); flipMomentAlbum(-1); }
  });
}

function waitMomentAlbumFirstImage(layer, ms = 180) {
  const still = layer?.querySelector?.('.moment-album-card[data-depth="0"] .photo-blur-still');
  if (!still || (still.complete && still.naturalWidth)) return Promise.resolve(true);
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      still.removeEventListener('load', finish);
      still.removeEventListener('error', finish);
      resolve(true);
    };
    const timer = setTimeout(finish, ms);
    still.addEventListener('load', finish, { once: true });
    still.addEventListener('error', finish, { once: true });
  });
}

function openMomentAlbumBrowse(entry, focusPhotoIndex = 0, originEl = null) {
  if (!entry) return;
  const items = momentAlbumItems(entry);
  if (!items.length) return;
  if (items.length === 1) {
    const only = items[0];
    if (only.kind === 'video') return openSavedSnippetVideo(entry, only.index);
    return photoLightbox(entry, only.index);
  }

  const layer = ensureMomentAlbumLayer();
  const token = ++momentAlbumCloseToken; // 上一次收回动画还没走完时重新打开：作废它的清场
  layer.classList.remove('is-closing');
  layer.getAnimations?.().forEach(anim => anim.cancel());
  momentAlbumEntryId = entry.id;
  const active = typeof document === 'object' ? document.activeElement : null;
  momentAlbumOrigin = originEl || (active?.closest?.('[data-view-snippet-photo]') ? active : null);
  const focusPos = items.findIndex(item => item.kind === 'photo' && item.index === (Number(focusPhotoIndex) || 0));
  momentAlbumIndex = focusPos >= 0 ? focusPos : 0;
  const time = entry.createdAt ? new Date(entry.createdAt) : null;
  const timeText = time ? `${time.getFullYear()}年${time.getMonth() + 1}月${time.getDate()}日 · ${pad2(time.getHours())}:${pad2(time.getMinutes())}` : (entry.date || '');
  const tag = (entry.tags || [])[0];
  const countLabel = `${items.filter(item => item.kind === 'photo').length} 张照片` + (items.some(item => item.kind === 'video') ? ` · ${items.filter(item => item.kind === 'video').length} 段视频` : '');
  layer.hidden = false;
  layer.classList.add('open');
  layer.innerHTML = `<div class="moment-album-sheet" role="document">
    <header class="moment-album-head">
      <button type="button" class="moment-album-close" data-moment-album-close aria-label="关闭相册"><span class="material-symbols-outlined">close</span></button>
      <div class="moment-album-title">
        <span class="moment-album-kicker">ALBUM</span>
        <strong>图集浏览</strong>
        <small>${esc([timeText, tag ? '#' + tag : '', countLabel].filter(Boolean).join(' · '))}</small>
      </div>
    </header>
    ${entry.text ? `<p class="moment-album-caption">${esc(entry.text)}</p>` : ''}
    <div class="moment-album-stage" id="moment-album-stage"><div class="moment-album-stack" id="moment-album-stack"></div></div>
    <div class="moment-album-foot"><span class="moment-album-hint">轻触看大图 · 左右拖动翻下一张</span><small class="moment-album-counter" id="moment-album-counter"></small></div>
  </div>`;
  layer.onclick = event => { if (event.target === layer || event.target.closest?.('[data-moment-album-close]')) closeMomentAlbum(); };
  renderMomentAlbumStack(entry);
  bindMomentAlbumDeck(layer);

  const startReveal = () => {
    if (token !== momentAlbumCloseToken) return;
    layer.style.opacity = '';
    // 打开：从点的那张缩略图位置长出来（rich）；lite 轻微上浮；减弱动态直接出现
    const sheet = layer.querySelector('.moment-album-sheet');
    if (sheet?.animate && momentAlbumTier() !== 'none') {
      try {
        sheet.animate(momentAlbumOriginFrames(sheet, momentAlbumOrigin), { duration: momentAlbumTier() === 'lite' ? 180 : 320, easing: MOMENT_ALBUM_OUT });
        layer.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      } catch { /* 动画失败不影响打开 */ }
    }
    requestAnimationFrame(() => layer.querySelector('.moment-album-card[data-depth="0"]')?.focus?.({ preventScroll: true }));
    callHelper('syncSystemBackConsumption');
  };

  const topStill = layer.querySelector('.moment-album-card[data-depth="0"] .photo-blur-still');
  if (topStill && !topStill.complete) {
    layer.style.opacity = '0';
    waitMomentAlbumFirstImage(layer, 180).then(startReveal);
  } else {
    startReveal();
  }
}

/** 多图/图+视频：先开相册；单张照片仍直接大图。 */
function openMomentMediaBrowse(entry, photoIndex = 0, originEl = null) {
  if (!entry) return;
  const items = momentAlbumItems(entry);
  if (items.length > 1) return openMomentAlbumBrowse(entry, photoIndex, originEl);
  if (items[0]?.kind === 'video') return openSavedSnippetVideo(entry, items[0].index);
  return photoLightbox(entry, photoIndex);
}

// photo-lightbox：左右切换本条照片，上下切换相邻随手拍。
function photoLightbox(entry, active = 0) {
  if (!entry) return;
  const photos = entry.photos?.length ? entry.photos : (entry.photo ? [entry.photo] : []);
  const video = (entry.videos || [])[0];
  if (!photos.length && video) return openSavedSnippetVideo(entry, 0);
  const index = Math.max(0, Math.min(active, Math.max(photos.length - 1, 0)));
  const cover = photos[index] || video?.poster || '';
  if (!cover) return;
  const time = entry.createdAt ? new Date(entry.createdAt) : null;
  const timeText = time ? `${time.getFullYear()}年${time.getMonth() + 1}月${time.getDate()}日 · ${pad2(time.getHours())}:${pad2(time.getMinutes())}` : '';
  const tag = (entry.tags || [])[0];
  const meta = [timeText, tag ? '#' + tag : ''].filter(Boolean).join(' · ');
  const entries = visibleMomentPhotoEntries();
  const entryIndex = entries.findIndex(item => item.id === entry.id);
  photoViewer(photosWithLiveMotion(photos, entry.livePhotos), index, photos.map(() => ({ text: entry.text || '随手拍', time: meta || '未记录时间' })), {
    loop: true,
    filmstrip: true,
    onVerticalNavigate: entries.length > 1 && entryIndex >= 0 ? direction => {
      const next = entries[(entryIndex + direction + entries.length) % entries.length];
      photoLightbox(next, 0);
    } : null
  });
}

/* 2026-10-12：点照片放大不再做转场，原先「挑出完整显示的主图层当转场源」的那个函数已删除。
   大图的清晰度由 photo-viewer 的「解码完成前不显示」保证，不再依赖转场源。 */

function bindSnippets() {
  $('#new-snippet')?.addEventListener('click', () => quickPhotoModal());
  $('#snippet-album')?.addEventListener('click', () => openSnippetAlbumGrid());
  $$('[data-snippet-type]').forEach(button => button.onclick = () => { snippetType = button.dataset.snippetType; render(); });
  $$('[data-edit-snippet]').forEach(button => button.onclick = () => snippetForm(state.snippets.find(entry => entry.id === button.dataset.editSnippet)));
  $$('[data-delete-snippet]').forEach(button => button.onclick = () => confirmDelete('删除这条随手记素材？已经加入日记的内容不会受影响。', async () => { state.snippets = state.snippets.filter(entry => entry.id !== button.dataset.deleteSnippet); await save(); render(); callHelper('scheduleAiRefresh'); }));
  $$('[data-view-snippet-photo]').forEach(button => button.onclick = () => {
    // 多图/图+视频先进入相册浏览层；单张仍直接大图。大图本身不做进入 FLIP（2026-10-12）。
    const entry = state.snippets.find(item => item.id === button.dataset.viewSnippetPhoto);
    openMomentMediaBrowse(entry, Number(button.dataset.photoIndex) || 0, button);
  });
  $$('[data-snippet-video-album]').forEach(button => button.onclick = () => { const entry = state.snippets.find(item => item.id === button.dataset.snippetVideoAlbum); openMomentMediaBrowse(entry, 0, button); });
  $$('[data-play-snippet-video]').forEach(button => button.onclick = () => {
    const entry = state.snippets.find(item => item.id === button.dataset.playSnippetVideo);
    const index = Number(button.dataset.videoIndex) || 0;
    if (entry?.videos?.[index]) openSavedSnippetVideo(entry, index);
  });
  $$('[data-refresh-video-poster]').forEach(button => button.onclick = () => refreshStoredVideoPoster(button.dataset.refreshVideoPoster, Number(button.dataset.videoIndex) || 0).catch(error => show(error.message)));
  $$('[data-open-media-detail]').forEach(button => button.onclick = () => { const entry = state.media.find(item => item.id === button.dataset.openMediaDetail); if (entry) openMediaDetail(entry); });
}

// ---- 表单提交 ----
registerSubmitHandler('snippet-form', async data => {
  const existing = state.snippets.find(entry => entry.id === data.get('id'));
  const type = data.get('type');
  if (type === 'photo' && !pendingSnippetPhotos.length && !pendingSnippetVideos.length) throw new Error('请至少选择一张照片或一个视频');
  const next = makeSnippet({ ...existing, id: existing?.id || uid(), type, date: data.get('date'), text: data.get('text'), photos: pendingSnippetPhotos, livePhotos: pendingSnippetLive, videos: pendingSnippetVideos, tags: pendingSnippetStructure.tags, summary: pendingSnippetStructure.summary, createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now() });
  existing ? Object.assign(existing, next) : state.snippets.push(next);
  const justSavedPhoto = type === 'photo' && next.photo ? next.photo : '';
  snippetVoice?.destroy();
  snippetVoice = null;
  pendingSnippetPhotos = [];
  pendingSnippetLive = [];
  pendingSnippetVideos = [];
  await save();
  if (justSavedPhoto) callHelper('rememberPhoto', justSavedPhoto).catch(() => {});
  closeModal(); render(); show('已保存');
  return false;
});

registerSubmitHandler('snippet-search-form', async data => {
  snippetSearch = data.get('search').trim(); render();
  return false;
});

registerView('snippets', snippetsView);
registerBinder(bindSnippets);

const pad2 = value => String(value).padStart(2, '0');

registerOnRender(() => {
  if (state.route !== 'snippets' && isMomentAlbumOpen()) closeMomentAlbum();
  if (state.route !== 'snippets' && isSnippetAlbumGridOpen()) closeSnippetAlbumGrid();
});

registerHelper('snippetForm', snippetForm);
registerHelper('openQuickPhotoModal', quickPhotoModal);
registerHelper('openQuickMemoModal', quickMemoModal);
registerHelper('openPhotoLightbox', photoLightbox);
registerHelper('openMomentAlbumBrowse', openMomentAlbumBrowse);
registerHelper('isMomentAlbumOpen', isMomentAlbumOpen);
registerHelper('closeMomentAlbum', closeMomentAlbum);
registerHelper('openSnippetAlbumGrid', openSnippetAlbumGrid);
registerHelper('isSnippetAlbumGridOpen', isSnippetAlbumGridOpen);
registerHelper('closeSnippetAlbumGrid', closeSnippetAlbumGrid);
registerHelper('closeVideoPlayer', stopActiveVideoPlayer);
registerHelper('playSnippetVideo', playSnippetVideo);
registerHelper('openSnippetVideos', openSnippetVideos);
registerHelper('openSavedSnippetVideo', openSavedSnippetVideo);

// 列表缩略图：进页面后只给看得到的卡片在空闲时补，不在渲染这一帧做任何解码。
registerOnRender(() => {
  if (state.route !== 'snippets') return;
  const scope = document.getElementById('screen-snippets');
  if (scope) watchThumbImages(scope);
});
