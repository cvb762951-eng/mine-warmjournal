import { callHelper, closeModal, registerOnRender, show, state } from './core.js';

/**
 * 视频播放会话。
 * 各入口只负责把「当前范围里的视频」装成 items，真正的播放仍走
 * playSnippetVideo → attachVideoSource。滑动时进度和观看记录只改内存，
 * 整个播放弹层关闭、或私密空间上锁前，再统一保存一次。
 *
 * 源缓存按条存放，同一条并发 resolve 只解密一次。
 * 私密和普通各用各的缓存。私密缓存只留上一条、当前条和下一条；
 * 开了循环切换时，第一条的上一条是最后一条，最后一条的下一条是第一条。
 * 名单之外的条目先 URL.revokeObjectURL，再从缓存丢掉；正在播的那条不 revoke。
 * 快速连滑时，已经不在名单里的解密结果，解完就 revoke，不留在缓存里。
 * 普通视频只轻量解析下一条地址，不做相邻重量预载。
 * release() / drop() 会把涉及到的 blob: 地址都 URL.revokeObjectURL。
 */

function revokeBlobUrl(url) {
  if (typeof url === 'string' && url.startsWith('blob:')) {
    try { URL.revokeObjectURL(url); } catch { /* 已经收回 */ }
  }
}

export function createVideoSourceCache() {
  const ready = new Map();
  const pending = new Map();
  let generation = 0;

  return {
    has(id) { return ready.has(String(id || '')); },
    get(id) { return ready.get(String(id || '')); },
    inflight(id) { return pending.has(String(id || '')); },
    resolve(item) {
      const id = String(item?.id || '');
      if (!id) return Promise.reject(new Error('视频没有标识'));
      if (ready.has(id)) return Promise.resolve(ready.get(id));
      const existing = pending.get(id);
      if (existing) {
        existing.discarded = false;
        return existing.promise;
      }
      const gen = generation;
      let started;
      try { started = Promise.resolve(item.resolveSource()); }
      catch (error) { started = Promise.reject(error); }
      const task = started
        .then(source => {
          const current = pending.get(id);
          if (gen !== generation || current?.task !== task || current?.discarded) {
            revokeBlobUrl(source);
            const error = new Error('视频缓存已释放');
            error.code = 'video-cache-released';
            throw error;
          }
          ready.set(id, source);
          return source;
        })
        .finally(() => {
          if (pending.get(id)?.task === task) pending.delete(id);
        });
      pending.set(id, { task, promise: task, discarded: false });
      return task;
    },
    drop(id) {
      const key = String(id || '');
      revokeBlobUrl(ready.get(key));
      ready.delete(key);
      const inflight = pending.get(key);
      if (inflight) inflight.discarded = true;
    },
    /**
     * 只留下这些 id。其余已解密的先 revoke 再丢掉。
     * 还在解密、而且已经不在名单里的，解完再 revoke。
     * playingId 是正在播的那条，即使不在名单里也不能 revoke。
     */
    retain(ids, playingId = '') {
      const keep = new Set((Array.isArray(ids) ? ids : []).map(id => String(id || '')).filter(Boolean));
      const playing = String(playingId || '');
      for (const id of new Set([...ready.keys(), ...pending.keys()])) {
        if (playing && id === playing) continue;
        if (!keep.has(id)) this.drop(id);
      }
    },
    release() {
      generation += 1;
      for (const url of ready.values()) revokeBlobUrl(url);
      ready.clear();
      pending.clear();
    }
  };
}

export const privateVideoCache = createVideoSourceCache();
export const plainVideoCache = createVideoSourceCache();

export function videoSourceCache(sourceCache) {
  if (sourceCache === 'private' || sourceCache === privateVideoCache) return privateVideoCache;
  if (sourceCache && typeof sourceCache.resolve === 'function' && typeof sourceCache.release === 'function') return sourceCache;
  return plainVideoCache;
}

function adjacentIndexes(count, index, loop) {
  if (!Number.isInteger(index) || index < 0 || index >= count || count < 2) return [];
  const found = [];
  const push = offset => {
    const at = loop ? (index + offset + count) % count : index + offset;
    if (at < 0 || at >= count || at === index || found.includes(at)) return;
    found.push(at);
  };
  push(-1);
  push(1);
  return found;
}

function privateRetentionIds(items, index, loop) {
  const list = Array.isArray(items) ? items : [];
  const ids = adjacentIndexes(list.length, index, loop).map(at => String(list[at]?.id || ''));
  ids.push(String(list[index]?.id || ''));
  return ids.filter(Boolean);
}

/** 私密视频预载上一条和下一条。loop 为真时首尾回绕；同一条并发解密仍只做一次。 */
export function preloadAdjacentVideos(cache, items, index, { loop = false } = {}) {
  const list = Array.isArray(items) ? items : [];
  const targets = adjacentIndexes(list.length, index, loop).map(at => list[at]).filter(Boolean);
  if (!targets.length) return null;
  return Promise.all(targets.map(item => Promise.resolve(cache.resolve(item)).catch(() => null)));
}

/** 普通视频只轻量预解析下一条地址，不预载上一条，也不做私密解密那种重量预载。 */
export function preloadNextVideo(cache, items, index) {
  const next = items?.[index + 1];
  if (!next) return null;
  return Promise.resolve(cache.resolve(next)).catch(() => null);
}

let playback = null;
let privatePlaybackId = '';

const releasePrivateVideoCache = privateVideoCache.release.bind(privateVideoCache);
privateVideoCache.release = () => {
  privatePlaybackId = '';
  releasePrivateVideoCache();
};

function rememberPlayback(cache) {
  playback = { route: state.route, private: cache === privateVideoCache };
}

function pausePlainPlayback() {
  if (!playback || playback.private) return;
  const player = typeof document !== 'undefined' ? document.getElementById('warm-video-element') : null;
  player?.pause?.();
}

function closePlainPlayback() {
  if (!playback || playback.private) return;
  const open = typeof document !== 'undefined' && document.getElementById('warm-video-player');
  playback = null;
  if (!open) return;
  closeModal();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pausePlainPlayback();
  });
  globalThis.addEventListener?.('pagehide', () => pausePlainPlayback());
}

registerOnRender(() => {
  if (!playback || playback.private) return;
  if (state.route !== playback.route) closePlainPlayback();
});

function sourceLabelFor(item, sourceLabel) {
  if (typeof sourceLabel === 'function') return sourceLabel(item);
  if (item?.sourceLabel) return item.sourceLabel;
  if (typeof sourceLabel === 'string' && sourceLabel) return sourceLabel;
  return item?.sourceType === 'hls' ? 'HLS 在线视频' : '本地离线视频';
}

function quietCacheError(error) {
  return error?.code === 'video-cache-released';
}

/**
 * @param {object} options
 * @param {Array} options.items 每条 { id, resolveSource(), poster, label, date, note, position, duration, trim, crop, watchHistory, sourceType }
 * @param {number} options.startIndex
 * @param {string} options.scopeLabel
 * @param {boolean} [options.showFolders] 默认 true；false 时不显示文件夹按钮。不传 onDelete 则不显示删除按钮
 * @param {Array} [options.folders]
 * @param {Function} [options.onFolderNavigate]
 * @param {Function} [options.remember] (item, patch) => void，滑动时只改内存
 * @param {Function} [options.flush] () => void，整个弹层关闭时调用一次
 * @param {Function} [options.persist] (item, patch) => void，没有 remember/flush 时，在弹层关闭时按条调用
 * @param {Function} [options.onDelete]
 * @param {object|string} [options.sourceCache] privateVideoCache / plainVideoCache，或 'private'
 */
export async function openVideoSession(options = {}) {
  const items = Array.isArray(options.items) ? options.items : [];
  const cache = videoSourceCache(options.sourceCache);
  const scopeLabel = options.scopeLabel || options.episodeTitle || '';
  const loopNavigation = Boolean(options.loopNavigation);
  const privateCache = cache === privateVideoCache;
  if (!items.length) return null;
  let playing = false;
  let needsFlush = false;
  let navTicket = 0;
  const staged = [];

  const holdPrivateWindow = (index, currentId = '') => {
    if (!privateCache) return;
    const keep = privateRetentionIds(items, index, loopNavigation);
    const id = String(currentId || '');
    if (id && !keep.includes(id)) keep.push(id);
    if (keep.length) cache.retain(keep, privatePlaybackId);
  };

  const present = async (index, { feedDirection = '', resetFeedAudio = false } = {}) => {
    if (index < 0 || index >= items.length) return null;
    const seed = items[index];
    const liveItem = typeof options.currentItem === 'function' ? (options.currentItem(seed) || seed) : seed;
    if (typeof options.accept === 'function' && !options.accept()) {
      closeModal();
      return null;
    }
    const ticket = ++navTicket;
    // 先按目标位置收窗口。正在播的还没换源，不能在这里被 revoke。
    holdPrivateWindow(index, liveItem?.id);
    let source;
    try { source = await cache.resolve(liveItem); }
    catch (error) {
      if (quietCacheError(error)) return null;
      throw error;
    }
    if (ticket !== navTicket) return null;
    if (!source) throw new Error('视频文件不存在或尚未恢复');
    if (typeof options.accept === 'function' && !options.accept()) {
      closeModal();
      return null;
    }
    const watchHistory = Array.isArray(liveItem.watchHistory) ? liveItem.watchHistory.slice() : [];
    let position = Math.max(0, Math.floor(Number(liveItem.position) || 0));
    let duration = Math.max(0, Math.floor(Number(liveItem.duration) || 0));
    let width = Math.max(0, Math.floor(Number(liveItem.width) || 0));
    let height = Math.max(0, Math.floor(Number(liveItem.height) || 0));
    let dirty = false;
    rememberPlayback(cache);
    playing = true;
    // transientMedia：这一层自己在关闭时 persist，播放器不要按 onProgress 去 save()。
    callHelper('playSnippetVideo', {
      video: source,
      poster: liveItem.poster || '',
      label: liveItem.label || '',
      sourceType: liveItem.sourceType || '',
      position,
      duration,
      trim: liveItem.trim || null,
      crop: liveItem.crop || null
    }, null, index, {
      count: items.length,
      immersiveFeed: Boolean(options.immersiveFeed),
      galleryMode: Boolean(options.galleryMode),
      loopNavigation,
      resetFeedAudio: Boolean(resetFeedAudio),
      feedDirection,
      folders: options.folders || [],
      showFolders: options.showFolders !== false,
      episodeTitle: scopeLabel,
      episodes: items.map(entry => ({
        name: entry.label || '视频',
        label: entry.label || '视频',
        poster: entry.poster || '',
        duration: entry.duration || 0,
        date: entry.date || ''
      })),
      description: liveItem.note || '',
      date: liveItem.date || '',
      sourceLabel: sourceLabelFor(liveItem, options.sourceLabel),
      watchHistory,
      autoAdvance: options.autoAdvance === true,
      transientMedia: true,
      deleteConfirmText: typeof options.deleteConfirmText === 'function' ? options.deleteConfirmText(liveItem, index) : (options.deleteConfirmText || ''),
      onReady: info => {
        const seconds = Math.max(0, Math.floor(Number(info?.duration) || 0));
        if (seconds && seconds !== duration) { duration = seconds; dirty = true; }
        if (info?.width && info?.height) {
          const nextWidth = Math.floor(info.width);
          const nextHeight = Math.floor(info.height);
          if (nextWidth !== width || nextHeight !== height) dirty = true;
          width = nextWidth;
          height = nextHeight;
        }
        options.onMediaReady?.({ item: liveItem, ...info, duration, width, height });
      },
      onProgress: ({ position: nextPosition, duration: nextDuration }) => {
        const seconds = Math.max(0, Math.floor(Number(nextPosition) || 0));
        const length = Math.max(0, Math.floor(Number(nextDuration) || 0));
        if (position !== seconds) { position = seconds; dirty = true; }
        if (length && duration !== length) { duration = length; dirty = true; }
      },
      onEnded: () => { position = 0; dirty = true; },
      onWatchSession: session => {
        if (!session) return;
        watchHistory.push(session);
        if (watchHistory.length > 100) watchHistory.splice(0, watchHistory.length - 100);
        dirty = true;
      },
      onClose: async ({ handoff } = {}) => {
        if (dirty) {
          dirty = false;
          const patch = { position, duration, watchHistory: watchHistory.slice() };
          if (width && height) { patch.width = width; patch.height = height; }
          if (typeof options.remember === 'function') options.remember(liveItem, patch);
          else staged.push({ item: liveItem, patch });
          needsFlush = true;
        }
        // 滑到下一条时 handoff 为真：先记在内存，不要在这里 save()。
        if (handoff || !needsFlush) return;
        needsFlush = false;
        if (typeof options.flush === 'function') {
          await options.flush();
          return;
        }
        if (typeof options.persist !== 'function') return;
        const batch = staged.splice(0);
        for (const entry of batch) await options.persist(entry.item, entry.patch);
      },
      onDeleteCurrent: typeof options.onDelete === 'function' ? async () => { await options.onDelete(liveItem, index, items); } : undefined,
      onOpenLibrary: () => options.onOpenLibrary?.(),
      onFolderNavigate: (mode, id) => options.onFolderNavigate?.(mode, id),
      onNavigate: (next, direction) => {
        return present(next, { feedDirection: direction }).catch(error => show(error?.message || '视频无法播放'));
      }
    });
    options.onPresented?.();
    if (privateCache) {
      privatePlaybackId = String(liveItem?.id || '');
      holdPrivateWindow(index, liveItem?.id);
      preloadAdjacentVideos(cache, items, index, { loop: loopNavigation });
    } else {
      preloadNextVideo(cache, items, index);
    }
    return true;
  };

  const start = Math.max(0, Math.min(items.length - 1, Number(options.startIndex) || 0));
  const opened = await present(start, { feedDirection: options.feedDirection || '', resetFeedAudio: options.resetFeedAudio });
  if (!opened || !playing) return null;
  return {
    release() {
      if (privateCache) privatePlaybackId = '';
      cache.release();
    }
  };
}
