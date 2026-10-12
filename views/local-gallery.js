import { Capacitor, registerPlugin } from '@capacitor/core';
import { $, $$, esc, goBack, render, show, closeModal, callHelper, registerView, registerBinder, state, save } from '../core.js';
import { photoViewer } from './common.js';
import { NativeMediaStore } from '../native-media-store.js';
import { photoFrameLayersHtml } from '../photo-frame.js';

const Gallery = registerPlugin('LocalGallery');
const PAGE_SIZE = 48;
const thumbnails = new Map();
const thumbnailQueue = [];
const queuedThumbnails = new Set();
let permission = null;
let kind = 'all';
let albumId = '';
let albums = [];
let items = [];
let more = false;
let loading = false;
let error = '';
let requestId = 0;
let inGallery = false;
let visibleCount = PAGE_SIZE;
let scanPromise = null;
let opening = false;
let permissionChecked = false;
let activeThumbnailLoads = 0;
let thumbnailObserver = null;
let scrollObserver = null;

function source(item) { return Capacitor.convertFileSrc(item.uri); }
function thumbnail(item) { return thumbnails.get(item.id) || ''; }

function tile(item, index) {
  const cover = thumbnail(item);
  return `<button class="local-gallery-tile photo-blur-frame is-edge" data-gallery-item="${index}" aria-label="查看${item.kind === 'video' ? '视频' : '照片'}：${esc(item.name)}">${cover ? photoFrameLayersHtml(esc(cover), { alt: '', lazy: true }) : `<span class="material-symbols-outlined">${item.kind === 'video' ? 'movie' : 'image'}</span>`}${item.kind === 'video' ? '<i class="material-symbols-outlined">play_arrow</i>' : ''}</button>`;
}

function galleryView() {
  const android = Capacitor.getPlatform() === 'android';
  const allowed = permission?.images || permission?.videos;
  const currentAlbum = albums.find(item => item.id === albumId);
  return `<section class="view local-gallery-view"><header class="local-gallery-header"><button id="gallery-back" aria-label="返回上一步"><span class="material-symbols-outlined">arrow_back</span></button><span><small>LOCAL GALLERY</small><strong>本机相册播放器</strong><em>浏览手机相册，不复制或删除原件</em></span></header>${!android ? '<div class="local-gallery-notice">网页预览无法读取手机相册，请在 Android 安装包中验收。</div>' : !permission ? '<div class="local-gallery-notice">正在检查相册访问权限…</div>' : !allowed ? '<div class="local-gallery-notice"><span class="material-symbols-outlined">perm_media</span><strong>允许访问照片和视频</strong><p>授权后可直接浏览本机相册。仅供查看，文件不会导入私密空间。</p><button id="gallery-permission">允许访问相册</button></div>' : `<div class="local-gallery-body">${permission.partial ? '<div class="local-gallery-partial">目前仅能看到系统允许的部分照片或视频。<button id="gallery-permission">选择更多 / 授权全部</button></div>' : ''}<div class="local-gallery-filters">${[['all','全部'],['video','视频'],['photo','照片']].map(([value,label])=>`<button data-gallery-kind="${value}" class="${kind === value ? 'active' : ''}" aria-pressed="${kind === value}">${label}</button>`).join('')}</div><label class="local-gallery-albums"><span class="material-symbols-outlined">folder_open</span><select id="gallery-album"><option value="">全部相册</option>${albums.map(album => `<option value="${esc(album.id)}" ${album.id === albumId ? 'selected' : ''}>${esc(album.name || '未命名文件夹')}（${album.count}）</option>`).join('')}</select></label><div class="local-gallery-scope"><strong>${esc(currentAlbum?.name || '全部相册')}</strong><small id="gallery-count">${loading ? `正在整理完整相册 · 已找到 ${items.length} 项` : `共 ${items.length} 项 · 全部可浏览`}</small></div>${error ? `<div class="local-gallery-error">${esc(error)} <button id="gallery-retry">重试</button></div>` : ''}<div class="local-gallery-grid" id="gallery-grid">${items.slice(0, visibleCount).map(tile).join('')}</div><div class="local-gallery-loading" id="gallery-sentinel" ${!loading && visibleCount >= items.length ? 'hidden' : ''}>${loading ? '正在读取完整相册…' : '继续滑动浏览'}</div>${!loading && !items.length && !error ? '<div class="local-gallery-empty">此范围暂时没有可见的照片或视频</div>' : ''}</div>`}</section>`;
}

async function refreshPermissions() {
  if (Capacitor.getPlatform() !== 'android') return;
  try { permission = await Gallery.permissionStatus(); error = ''; }
  catch (cause) { error = cause?.message || '无法检查相册权限'; permission = { images: false, videos: false }; }
  if (state.route !== 'local-gallery') { permissionChecked = false; return; }
  render();
  if (permission.images || permission.videos) await loadScope();
}

function updateStatus() {
  const count = $('#gallery-count');
  if (count) count.textContent = error ? `读取中断 · 已找到 ${items.length} 项` : loading ? `正在整理完整相册 · 已找到 ${items.length} 项` : `共 ${items.length} 项 · 全部可浏览`;
  const sentinel = $('#gallery-sentinel');
  if (sentinel) {
    sentinel.hidden = !loading && visibleCount >= items.length;
    sentinel.textContent = loading ? '正在读取完整相册…' : '继续滑动浏览';
    if (!sentinel.hidden) scrollObserver?.observe(sentinel);
  }
}

function observeTiles(tiles) {
  for (const tile of tiles) {
    tile.onclick = () => openGalleryItem(Number(tile.dataset.galleryItem));
    thumbnailObserver?.observe(tile);
  }
}

function revealMore() {
  if (visibleCount >= items.length) return;
  const grid = $('#gallery-grid');
  if (!grid) return;
  const start = visibleCount;
  visibleCount = Math.min(items.length, start + PAGE_SIZE);
  grid.insertAdjacentHTML('beforeend', items.slice(start, visibleCount).map((item, index) => tile(item, start + index)).join(''));
  observeTiles([...grid.querySelectorAll('[data-gallery-item]')].filter(button => Number(button.dataset.galleryItem) >= start));
  updateStatus();
}

function revealIfNearBottom() {
  const sentinel = $('#gallery-sentinel');
  const app = $('#app');
  if (!sentinel || !app) return;
  for (let i = 0; i < 8 && visibleCount < items.length; i++) {
    if (sentinel.getBoundingClientRect().top > app.getBoundingClientRect().bottom + 320) break;
    revealMore();
  }
}

function loadScope() {
  const token = ++requestId;
  items = []; albums = []; more = false; error = ''; loading = true; visibleCount = PAGE_SIZE;
  thumbnailQueue.length = 0; queuedThumbnails.clear();
  render();
  scanPromise = (async () => {
    try {
      const [albumResult, first] = await Promise.all([
        Gallery.listAlbums({ kind }), Gallery.listMedia({ kind, albumId, offset: 0, limit: PAGE_SIZE })
      ]);
      if (token !== requestId || state.route !== 'local-gallery') return;
      albums = albumResult.albums || [];
      items = first.items || [];
      more = !!first.hasMore;
      let offset = items.length;
      render();
      const seen = new Set(items.map(item => item.id));
      while (more && token === requestId && state.route === 'local-gallery') {
        const result = await Gallery.listMedia({ kind, albumId, offset, limit: PAGE_SIZE });
        if (token !== requestId || state.route !== 'local-gallery') return;
        const batch = result.items || [];
        offset += batch.length;
        const unique = batch.filter(item => !seen.has(item.id));
        unique.forEach(item => seen.add(item.id));
        if (batch.length && !unique.length) throw new Error('相册索引没有继续前进，请重试');
        items.push(...unique);
        more = !!result.hasMore && batch.length > 0;
        updateStatus();
        revealIfNearBottom();
      }
    } catch (cause) {
      if (token === requestId) error = cause?.message || '读取相册失败';
    } finally {
      if (token === requestId && state.route === 'local-gallery') {
        loading = false;
        if (error || !items.length) { render(); updateStatus(); }
        else { updateStatus(); revealIfNearBottom(); }
      }
    }
  })();
  return scanPromise;
}

function queueThumbnail(item) {
  if (!item || thumbnails.has(item.id) || queuedThumbnails.has(item.id)) return;
  queuedThumbnails.add(item.id);
  thumbnailQueue.push({ item, token: requestId });
  pumpThumbnails();
}

function pumpThumbnails() {
  while (activeThumbnailLoads < 3 && thumbnailQueue.length) {
    const { item, token } = thumbnailQueue.shift();
    if (token !== requestId || state.route !== 'local-gallery') { queuedThumbnails.delete(item.id); continue; }
    activeThumbnailLoads++;
    Gallery.thumbnail({ uri: item.uri }).then(result => {
      if (token !== requestId || state.route !== 'local-gallery') return;
      const preview = `data:image/jpeg;base64,${result.data}`;
      thumbnails.set(item.id, preview);
      if (thumbnails.size > 180) thumbnails.delete(thumbnails.keys().next().value);
      const index = items.findIndex(candidate => candidate.id === item.id);
      const tileElement = $(`[data-gallery-item="${index}"]`);
      if (tileElement) tileElement.insertAdjacentHTML('afterbegin', photoFrameLayersHtml(preview, { alt: '', lazy: true }));
    }).catch(() => { /* A missing thumbnail must not hide the original file. */ }).finally(() => {
      if (token === requestId) queuedThumbnails.delete(item.id);
      activeThumbnailLoads--;
      pumpThumbnails();
    });
  }
}

async function openGalleryItem(index) {
  if (opening) return;
  const item = items[index];
  if (!item) return;
  const token = requestId;
  opening = true;
  try {
    if (loading) { show('正在整理完整相册，请稍候…'); await scanPromise; }
    if (token !== requestId || state.route !== 'local-gallery') return;
    if (error) { show('相册尚未完整读取，请先重试'); return; }
    if (item.kind === 'photo') {
      const photos = items.filter(entry => entry.kind === 'photo');
      const active = photos.findIndex(entry => entry.id === item.id);
      photoViewer(photos.map(source), active, photos.map(entry => ({ text: entry.name, time: entry.albumName || '' })), { loop: true, filmstrip: false });
      return;
    }
    const videos = items.filter(entry => entry.kind === 'video');
    const active = videos.findIndex(entry => entry.id === item.id);
    openGalleryVideo(videos, active);
  } finally {
    opening = false;
  }
}

/* ---------------------------------------------------------------------------
   本机相册视频流：与私密空间对齐（2026-10-09 用户要求「全部功能对标」）

   工具条按钮（选集 / 观看记录 / 删除）已统一渲染，这里补上对应的数据与回调：
   · 观看历史 —— 存在 state.localGalleryWatchHistory（顶层字段，已在 SECTIONS 登记）。
     本机视频的「播放进度」刻意不保存：它们是系统相册的原文件，App 不去改它们，
     所以只记「看过、看了多久」，不记「看到第几秒」。
   · 删除 —— 调用原生 deleteOriginalMedia。它只接受 content:// 开头的 URI，
     并且会拉起 Android 系统自己的删除授权页，用户必须在系统弹窗里再确认一次。
   --------------------------------------------------------------------------- */

// 当前正在播放的下标，删除按钮据此定位「当前这一个」。
let activeGalleryIndex = -1;

function galleryWatchHistory(item) {
  const id = item?.id || '';
  const all = Array.isArray(state.localGalleryWatchHistory) ? state.localGalleryWatchHistory : [];
  return id ? all.filter(entry => entry.id === id) : [];
}

function recordGalleryWatch(item, session) {
  if (!item?.id || !session) return;
  const entry = {
    id: String(item.id),
    name: String(item.name || '').slice(0, 120),
    watchedSeconds: Math.max(0, Math.floor(Number(session.watchedSeconds) || 0)),
    startedAt: Number(session.startedAt) || Date.now(),
    endedAt: Number(session.endedAt) || Date.now()
  };
  const history = Array.isArray(state.localGalleryWatchHistory) ? state.localGalleryWatchHistory : [];
  state.localGalleryWatchHistory = [...history, entry].slice(-200);
  save().catch(() => { /* 观看历史写失败不影响播放 */ });
}

async function deleteGalleryVideo(item) {
  if (!item) throw new Error('找不到当前视频');
  const uri = String(item.uri || '');
  if (!uri.startsWith('content://')) throw new Error('这个视频不支持从 App 内删除');
  await NativeMediaStore.deleteOriginalMedia({ uris: [uri] });
  show('已从相册删除');
  closeModal();
  await loadScope().catch(() => {});
  render();
}

function openGalleryVideo(videos, active, feedDirection = '', playlist = null) {
  const item = videos[active];
  if (!item || state.route !== 'local-gallery') return;
  activeGalleryIndex = active;
  const episodes = playlist || videos.map(entry => ({ label: entry.name, poster: thumbnail(entry) }));
  callHelper('playSnippetVideo', { video: source(item), poster: thumbnail(item), label: item.name }, null, active, {
    count: videos.length, immersiveFeed: true, loopNavigation: true, galleryMode: true, transientMedia: true,
    feedDirection, episodeTitle: '本机相册', sourceLabel: item.albumName || '本机视频',
    episodes,
    // —— 与私密空间对齐的三项 ——
    watchHistory: galleryWatchHistory(item),
    onWatchSession: session => recordGalleryWatch(item, session),
    onDeleteCurrent: async () => deleteGalleryVideo(videos[activeGalleryIndex] || item),
    deleteConfirmText: `删除手机相册里的「${item.name}」？\n\n这一步会删掉手机中的原文件，之后系统还会再让你确认一次。`,
    folders: [{ mode: 'all', id: '', name: '全部相册', count: videos.length }, ...albums.map(album => ({ mode: 'album', id: album.id, name: album.name, count: album.count }))],
    onNavigate: (next, direction) => openGalleryVideo(videos, next, direction, episodes),
    onOpenLibrary: () => closeModal(),
    onFolderNavigate: (mode, id) => { closeModal(); kind = 'video'; albumId = mode === 'all' ? '' : id; loadScope(); }
  });
}

function bindGallery() {
  if (state.route !== 'local-gallery') {
    if (inGallery) {
      ++requestId; permission = null; items = []; albums = []; thumbnails.clear();
      thumbnailQueue.length = 0; queuedThumbnails.clear();
      thumbnailObserver?.disconnect(); scrollObserver?.disconnect();
      thumbnailObserver = null; scrollObserver = null; scanPromise = null; inGallery = false;
    }
    permissionChecked = false;
    return;
  }
  inGallery = true;
  thumbnailObserver?.disconnect(); scrollObserver?.disconnect();
  const root = $('#app');
  if (typeof IntersectionObserver === 'function') {
    thumbnailObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        const item = items[Number(entry.target.dataset.galleryItem)];
        queueThumbnail(item);
        thumbnailObserver?.unobserve(entry.target);
      }
    }, { root, rootMargin: '320px' });
    scrollObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        revealMore();
        requestAnimationFrame(revealIfNearBottom);
      }
    }, { root, rootMargin: '320px' });
  } else { thumbnailObserver = null; scrollObserver = null; }
  $('#gallery-back')?.addEventListener('click', goBack);
  $('#gallery-permission')?.addEventListener('click', async () => {
    try { permission = await Gallery.requestAccess(); render(); if (permission.images || permission.videos) await loadScope(); }
    catch (cause) { show(cause?.message || '未取得相册权限'); }
  });
  $$('[data-gallery-kind]').forEach(button => button.onclick = () => { kind = button.dataset.galleryKind; albumId = ''; loadScope(); });
  $('#gallery-album')?.addEventListener('change', event => { albumId = event.target.value; loadScope(); });
  observeTiles($$('[data-gallery-item]'));
  const sentinel = $('#gallery-sentinel');
  if (sentinel && !sentinel.hidden) scrollObserver?.observe(sentinel);
  $('#gallery-retry')?.addEventListener('click', loadScope);
  if (!permissionChecked && Capacitor.getPlatform() === 'android') { permissionChecked = true; refreshPermissions(); }
}

registerView('local-gallery', galleryView);
registerBinder(bindGallery);
