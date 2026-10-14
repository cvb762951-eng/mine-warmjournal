/* 随手拍列表缩略图（只是缓存，不是数据）。
 * - 原图、媒体引用和 state 结构一律不动；缩略图按原图引用派生出独立的键。
 * - 原生：放在 Directory.Data 下独立目录 MineWarmJournalThumbs/，不在 MineWarmJournalMedia 里，
 *   所以未引用媒体清理 / 回收站完全看不到它们；备份、导出只遍历 state 里的媒体引用，也不会带上缩略图。
 * - 浏览器：独立的 IndexedDB 库 mine_warmjournal_thumbs，和媒体库分开。
 * - 任何一步失败都回退原图；生成只在空闲时、只给看得到的卡片、每次少量。
 * - 私密空间不用这里（不生成、不读取）。
 * - 列表 / 相册网格带 data-progressive 的卡片：先画 480 缩略图（还没有就用 1×1 占位），
 *   进入视口附近再换成原图（约 1920，和全屏同一张）。滚出视口把 src 换回缩略图并清掉当前解码，
 *   长列表才不会把全尺寸位图越积越多。缩略图文件格式不变，不用升缓存版本。
 *   全屏底栏胶卷没有 data-progressive，继续只显示缩略图。
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { mediaSource, isMediaRef, resolveMediaReference } from './media-store.js';

export const THUMB_ROOT = 'MineWarmJournalThumbs';
export const THUMB_DB = 'mine_warmjournal_thumbs';
export const THUMB_MAX = 480;
/** 还没有 480 缩略图时先占位，避免列表一渲染就把原图塞进 src。1×1 透明 GIF，不发起网络请求。 */
export const THUMB_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** 视口上下各约一屏：卡片还没完全进入就先换原图，滚出这段距离再卸掉。 */
export const PROGRESSIVE_ROOT_MARGIN = '800px 0px';
/** 停在这段距离里超过这么久才真正换原图，快速划过的卡片不启动全尺寸解码。 */
export const PROGRESSIVE_DWELL_MS = 100;
const NATIVE_PREFIX = 'mine-media://';
const BROWSER_PREFIX = 'mine-browser-media://';
const thumbUrls = new Map();
const failed = new Set();

/** 原图引用 → 缩略图存储键；不支持的（data URL、网络地址、空）返回 ''。 */
export function thumbKeyFor(ref) {
  const value = String(ref || '');
  let name = '';
  if (value.startsWith(NATIVE_PREFIX)) name = value.slice(NATIVE_PREFIX.length);
  else if (value.startsWith(BROWSER_PREFIX)) name = value.slice(BROWSER_PREFIX.length);
  if (!name || /[\\/]/.test(name) || name.startsWith('.')) return '';
  return `${name.replace(/\.[a-z0-9]+$/i, '')}.thumb.jpg`;
}

/** 等比缩到长边不超过 max，不放大。 */
export function thumbSize(width, height, max = THUMB_MAX) {
  const w = Math.max(1, Number(width) || 1), h = Math.max(1, Number(height) || 1);
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** 同步：有缩略图用缩略图，否则原图。胶卷、编辑器等「只停在缩略图」的地方用这个。 */
export function thumbSource(ref) {
  return thumbUrls.get(String(ref || '')) || mediaSource(ref);
}

/** 渐进列表的第一帧：有 480 用 480，否则占位，不把原图写进首屏 src。没有缩略图键的地址仍回退原图。 */
export function progressiveSource(ref) {
  const value = String(ref || '');
  if (thumbUrls.has(value)) return thumbUrls.get(value);
  if (thumbKeyFor(value)) return THUMB_PLACEHOLDER;
  return mediaSource(value);
}

export function hasThumb(ref) { return thumbUrls.has(String(ref || '')); }

/* ── 存储 ─────────────────────────────────────────── */
let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(THUMB_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('thumbs');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => { dbPromise = null; throw error; });
  return dbPromise;
}
async function idb(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('thumbs', mode);
    const req = fn(tx.objectStore('thumbs'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

async function loadStored(key) {
  if (Capacitor.isNativePlatform()) {
    const path = `${THUMB_ROOT}/${key}`;
    await Filesystem.stat({ path, directory: Directory.Data });
    const uri = await Filesystem.getUri({ path, directory: Directory.Data });
    return Capacitor.convertFileSrc(uri.uri);
  }
  const blob = await idb('readonly', store => store.get(key));
  if (!blob) throw new Error('no thumb');
  return URL.createObjectURL(blob);
}

async function store(key, blob) {
  if (Capacitor.isNativePlatform()) {
    const data = await blobToBase64(blob);
    const path = `${THUMB_ROOT}/${key}`;
    await Filesystem.writeFile({ path, data, directory: Directory.Data, recursive: true });
    const uri = await Filesystem.getUri({ path, directory: Directory.Data });
    return Capacitor.convertFileSrc(uri.uri);
  }
  await idb('readwrite', s => s.put(blob, key));
  return URL.createObjectURL(blob);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/* ── 生成 ─────────────────────────────────────────── */
export async function makeThumbBlob(blob, { max = THUMB_MAX, quality = 0.8 } = {}) {
  // 按 EXIF 方向转正（竖拍照片不横倒）。
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const { width, height } = thumbSize(bitmap.width, bitmap.height, max);
    if (typeof OffscreenCanvas === 'function') {
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
      return await canvas.convertToBlob({ type: 'image/jpeg', quality });
    }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    return await new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', quality));
  } finally {
    bitmap.close?.();
  }
}

async function swapFallbackInDom(ref) {
  if (typeof document === 'undefined' || !ref) return;
  try {
    const source = mediaSource(ref) || await resolveMediaReference(ref).catch(() => '');
    if (!source) return;
    document.querySelectorAll('img[data-thumb-ref]').forEach(img => {
      const imgRef = img.dataset?.thumbRef || img.getAttribute?.('data-thumb-ref');
      if (imgRef !== ref) return;
      const current = img.getAttribute?.('src') || '';
      if (!current || current === THUMB_PLACEHOLDER) {
        img.src = source;
      }
    });
  } catch { /* ignore */ }
}

/** 确保某张原图有缩略图；失败返回 ''（调用方继续用原图）。从不修改原图。 */
export async function ensureThumb(ref) {
  const value = String(ref || '');
  if (thumbUrls.has(value)) return thumbUrls.get(value);
  const key = thumbKeyFor(value);
  if (!key || failed.has(value) || !isMediaRef(value)) {
    if (value) await swapFallbackInDom(value);
    return '';
  }
  try {
    const url = await loadStored(key);
    thumbUrls.set(value, url);
    return url;
  } catch { /* 还没有，生成 */ }
  try {
    const source = mediaSource(value) || await resolveMediaReference(value);
    if (!source) throw new Error('no source');
    const original = await (await fetch(source)).blob();          // 只读原图
    const thumb = await makeThumbBlob(original);
    if (!thumb || thumb.size >= original.size) {
      failed.add(value);
      await swapFallbackInDom(value);
      return '';
    }   // 原图本来就小：直接用原图
    const url = await store(key, thumb);
    thumbUrls.set(value, url);
    return url;
  } catch {
    failed.add(value);
    await swapFallbackInDom(value);
    return '';
  }
}

/* ── 空闲时给看得到的卡片补缩略图 ─────────────────── */
const queue = [];
const queued = new Set();
let running = false;
const BATCH = 2;
const idle = fn => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 200));

function assignThumbSrc(img, url) {
  if (!img || !url) return;
  if (url !== THUMB_PLACEHOLDER) img.dataset.thumbSrc = url;
  // 这张正在显示原图：只记住缩略图地址，等滚出视口再换回去。
  if (img.dataset.fullActive === '1') return;
  if ((img.getAttribute('src') || '') !== url) img.src = url;
}

function swapInDom(ref, url) {
  if (typeof document === 'undefined' || !url) return;
  document.querySelectorAll('img[data-thumb-ref]').forEach(img => {
    if (img.dataset.thumbRef === ref) assignThumbSrc(img, url);
  });
}

/** 测试用：缩略图生成完成后的那次 DOM 替换。 */
export function _deliverThumbForTest(ref, url) { swapInDom(ref, url); }
export function _fallbackThumbForTest(ref) { return swapFallbackInDom(ref); }

function pump() {
  if (running || !queue.length) return;
  running = true;
  idle(async () => {
    const batch = queue.splice(0, BATCH);
    for (const ref of batch) {
      queued.delete(ref);
      const url = await ensureThumb(ref);
      if (url) swapInDom(ref, url);
    }
    running = false;
    pump();
  });
}

export function requestThumb(ref) {
  const value = String(ref || '');
  if (!value || thumbUrls.has(value) || failed.has(value) || queued.has(value) || !thumbKeyFor(value)) return;
  queued.add(value);
  queue.push(value);
  pump();
}

let io = null;
/** 观察列表里带 data-thumb-ref 的图，进入视口（含一屏余量）才排队。 */
export function watchThumbImages(scope = typeof document !== 'undefined' ? document : null) {
  if (!scope?.querySelectorAll) return;
  if (!io && typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      io.unobserve(entry.target);
      requestThumb(entry.target.dataset?.thumbRef || entry.target.getAttribute?.('data-thumb-ref'));
    }), { rootMargin: '200px 0px' });
  }
  scope.querySelectorAll('img[data-thumb-ref]').forEach(img => {
    const current = img.getAttribute?.('src') || '';
    if (!current) img.src = THUMB_PLACEHOLDER;
    const ref = img.dataset?.thumbRef || img.getAttribute?.('data-thumb-ref');
    if (img.dataset?.fullActive === '1') return;
    if (thumbUrls.has(ref)) { if ((img.getAttribute?.('src') || '') !== thumbUrls.get(ref)) img.src = thumbUrls.get(ref); return; }
    if (failed.has(ref)) {
      swapFallbackInDom(ref);
      return;
    }
    if (io) io.observe(img);
  });
}

/* ── 列表 / 相册网格：缩略图 → 原图 → 离开再卸掉 ───────── */
const progressiveSeen = new Set();
const dwellTimerMap = new Map();
let progressiveIo = null;
let progressiveDwellMs = PROGRESSIVE_DWELL_MS;

function cancelDwell(img) {
  const timer = dwellTimerMap.get(img);
  if (!timer) return;
  clearTimeout(timer);
  dwellTimerMap.delete(img);
}

function scheduleUpgrade(img) {
  cancelDwell(img);
  const ref = img.dataset?.thumbRef || '';
  const timer = setTimeout(() => {
    dwellTimerMap.delete(img);
    if (!img.isConnected || img.dataset?.thumbRef !== ref) return;
    if (img.dataset?.wantsFull === '1') beginFullUpgrade(img);
  }, progressiveDwellMs);
  dwellTimerMap.set(img, timer);
}

function layersOf(img) {
  const parent = img?.parentElement;
  const ref = img?.dataset?.thumbRef || '';
  if (!parent?.querySelectorAll || !ref) return [img];
  // 只升清晰层：虚化铺底层（.photo-blur-pad）一律停在 480，省掉一份全尺寸解码。
  const nodes = [...parent.querySelectorAll('img[data-thumb-ref]')].filter(node => node.dataset?.thumbRef === ref && !node.classList?.contains('photo-blur-pad'));
  return nodes.length ? nodes : [img];
}

function fallbackSrc(img) {
  const ref = img?.dataset?.thumbRef || '';
  return thumbUrls.get(ref) || img?.dataset?.thumbSrc || (thumbKeyFor(ref) ? THUMB_PLACEHOLDER : (mediaSource(ref) || THUMB_PLACEHOLDER));
}

function commitFullUpgrade(img, full) {
  if (!full || img?.dataset?.wantsFull !== '1') return;
  for (const node of layersOf(img)) {
    node.dataset.wantsFull = '1';
    node.dataset.fullActive = '1';
    node.decoding = 'async';
    if ((node.getAttribute('src') || '') !== full) node.src = full;
  }
  // 原图显示着也要把 480 准备好，滚出去才有东西可换。不 revoke 媒体库的地址。
  if (typeof document !== 'undefined') requestThumb(img.dataset?.thumbRef || '');
}

/** 显示宽度 × dpr 不超过 480 时，480 缩略图已经够清楚，不升原图（拼图小格等）。量不到宽度时照常升。
    视频扇面封面带 data-full-cover：卡片虽窄，仍升原图（最多 4 张，离开视口再卸）。 */
export function needsFullResolution(img) {
  if (img?.dataset?.fullCover === '1' || img?.getAttribute?.('data-full-cover') === '1') return true;
  const rect = img?.getBoundingClientRect?.();
  const width = (rect && rect.width) || img?.clientWidth || 0;
  if (!width) return true;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  return width * dpr > THUMB_MAX;
}

function stillCurrent(img, ref) {
  return Boolean(img && img.isConnected && img.dataset?.thumbRef === ref && img.dataset?.wantsFull === '1');
}

/** 后台先加载并解码原图，成功才换 src；失败保留缩略图。用完把临时 Image 的引用清掉。 */
function preloadAndCommit(img, ref, full) {
  if (!full) return;
  if (typeof Image !== 'function') { commitFullUpgrade(img, full); return; }
  let probe = new Image();
  probe.decoding = 'async';
  const done = ok => {
    if (probe) { probe.onload = probe.onerror = null; probe = null; }
    if (ok && stillCurrent(img, ref)) commitFullUpgrade(img, full);
  };
  probe.src = full;
  if (typeof probe.decode === 'function') {
    probe.decode().then(() => done(true), () => done(false));
  } else {
    probe.onload = () => done(true);
    probe.onerror = () => done(false);
  }
}

function beginFullUpgrade(img) {
  const ref = img?.dataset?.thumbRef || '';
  if (!stillCurrent(img, ref) || !needsFullResolution(img)) return;
  const ready = (ref && mediaSource(ref)) || img?.dataset?.fullSrc || '';
  if (ready) { preloadAndCommit(img, ref, ready); return; }
  if (!ref || !isMediaRef(ref)) return;
  resolveMediaReference(ref).then(full => {
    if (!stillCurrent(img, ref)) return;
    preloadAndCommit(img, ref, full || '');
  }).catch(() => {});
}

/** 把已经换上的原图 src 卸掉，让这一对 <img> 不再占着全尺寸解码。媒体库的 blob / 文件地址不 revoke。 */
function unloadFull(img) {
  if (!img) return;
  cancelDwell(img);
  for (const node of layersOf(img)) {
    cancelDwell(node);
    node.dataset.wantsFull = '0';
    if (node.dataset?.fullActive !== '1') continue;
    const next = fallbackSrc(node);
    const current = node.getAttribute('src') || '';
    node.dataset.fullActive = '0';
    // 先换成 1×1，元素就不再引用全尺寸解码；再放上缩略图。不把 src 摘空，避免浏览器去请求当前页。
    if (current && current !== next && next !== THUMB_PLACEHOLDER) node.src = THUMB_PLACEHOLDER;
    if ((node.getAttribute('src') || '') !== next) node.src = next;
  }
}

/** intersecting：稍停后换原图。离开：立刻换回缩略图或占位，并取消还没开始的升级。没有 data-progressive 的图（胶卷）什么都不做。 */
export function syncProgressiveImage(img, intersecting) {
  if (!img || img.dataset?.progressive !== '1') return;
  if (intersecting) {
    img.dataset.wantsFull = '1';
    scheduleUpgrade(img);
    return;
  }
  cancelDwell(img);
  unloadFull(img);
}

function forgetProgressive(img) {
  progressiveIo?.unobserve(img);
  progressiveSeen.delete(img);
}

function pruneDisconnected() {
  for (const img of [...progressiveSeen]) {
    if (img.isConnected === false) {
      unloadFull(img);
      forgetProgressive(img);
    }
  }
}

/** 观察带 data-progressive 的清晰层。重复调用只补新节点，并卸掉已经离开文档的原图。 */
export function watchProgressiveImages(scope) {
  pruneDisconnected();
  if (!scope?.querySelectorAll) return;
  if (!progressiveIo && typeof IntersectionObserver === 'function') {
    progressiveIo = new IntersectionObserver(entries => {
      entries.forEach(entry => syncProgressiveImage(entry.target, entry.isIntersecting));
    }, { root: null, rootMargin: PROGRESSIVE_ROOT_MARGIN, threshold: 0 });
  }
  scope.querySelectorAll('img[data-progressive="1"]').forEach(img => {
    if (progressiveSeen.has(img)) return;
    progressiveSeen.add(img);
    progressiveIo?.observe(img);
  });
}

/** 相册网格关掉、或节点已不在文档里时，卸掉这一批原图。不传 scope 时只处理已经脱离文档的节点。 */
export function releaseProgressiveImages(scope) {
  if (scope?.querySelectorAll) {
    scope.querySelectorAll('img[data-progressive="1"]').forEach(img => {
      unloadFull(img);
      forgetProgressive(img);
    });
    return;
  }
  pruneDisconnected();
}

/** 离开随手拍页：卸掉所有原图，断开观察器，清空已登记节点。 */
export function stopProgressiveImages() {
  for (const img of [...progressiveSeen]) unloadFull(img);
  for (const timer of dwellTimerMap.values()) clearTimeout(timer);
  dwellTimerMap.clear();
  progressiveSeen.clear();
  progressiveIo?.disconnect();
  progressiveIo = null;
}

/** 恢复备份后清掉整个缩略图缓存（原图文件可能已被同名替换，旧缩略图会过期）。
 *  只删 Directory.Data/MineWarmJournalThumbs 和 IndexedDB mine_warmjournal_thumbs，绝不碰媒体 / 私密空间目录。
 *  永不抛错：清不掉也只是继续用旧缓存或原图，不能让恢复失败。 */
export async function clearThumbCache() {
  thumbUrls.forEach(url => { if (String(url).startsWith('blob:')) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } } });
  thumbUrls.clear(); failed.clear(); queue.length = 0; queued.clear();
  try {
    if (Capacitor.isNativePlatform()) {
      await Filesystem.rmdir({ path: THUMB_ROOT, directory: Directory.Data, recursive: true });
    } else if (typeof indexedDB !== 'undefined') {
      const db = await dbPromise?.catch(() => null);
      db?.close?.();
      dbPromise = null;
      await new Promise(resolve => {
        const req = indexedDB.deleteDatabase(THUMB_DB);
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });
    }
  } catch { /* 目录不存在或删不掉：忽略 */ }
}

/** 测试用 */
export function _seedThumbForTest(ref, url) { thumbUrls.set(String(ref || ''), url); }

export function _setProgressiveDwellForTest(ms) { progressiveDwellMs = ms; }

export function _resetThumbsForTest() {
  for (const timer of dwellTimerMap.values()) clearTimeout(timer);
  dwellTimerMap.clear();
  progressiveDwellMs = PROGRESSIVE_DWELL_MS;
  thumbUrls.clear(); failed.clear(); queue.length = 0; queued.clear(); running = false;
  progressiveSeen.clear();
  progressiveIo?.disconnect();
  progressiveIo = null;
}
