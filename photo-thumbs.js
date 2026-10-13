/* 随手拍列表缩略图（只是缓存，不是数据）。
 * - 原图、媒体引用和 state 结构一律不动；缩略图按原图引用派生出独立的键。
 * - 原生：放在 Directory.Data 下独立目录 MineWarmJournalThumbs/，不在 MineWarmJournalMedia 里，
 *   所以未引用媒体清理 / 回收站完全看不到它们；备份、导出只遍历 state 里的媒体引用，也不会带上缩略图。
 * - 浏览器：独立的 IndexedDB 库 mine_warmjournal_thumbs，和媒体库分开。
 * - 任何一步失败都回退原图；生成只在空闲时、只给看得到的卡片、每次少量。
 * - 私密空间不用这里（不生成、不读取）。
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { mediaSource, isMediaRef, resolveMediaReference } from './media-store.js';

export const THUMB_ROOT = 'MineWarmJournalThumbs';
export const THUMB_DB = 'mine_warmjournal_thumbs';
export const THUMB_MAX = 480;
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

/** 同步：有缩略图用缩略图，否则原图。 */
export function thumbSource(ref) {
  return thumbUrls.get(String(ref || '')) || mediaSource(ref);
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

/** 确保某张原图有缩略图；失败返回 ''（调用方继续用原图）。从不修改原图。 */
export async function ensureThumb(ref) {
  const value = String(ref || '');
  if (thumbUrls.has(value)) return thumbUrls.get(value);
  const key = thumbKeyFor(value);
  if (!key || failed.has(value) || !isMediaRef(value)) return '';
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
    if (!thumb || thumb.size >= original.size) { failed.add(value); return ''; }   // 原图本来就小：直接用原图
    const url = await store(key, thumb);
    thumbUrls.set(value, url);
    return url;
  } catch {
    failed.add(value);
    return '';
  }
}

/* ── 空闲时给看得到的卡片补缩略图 ─────────────────── */
const queue = [];
const queued = new Set();
let running = false;
const BATCH = 2;
const idle = fn => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 200));

function swapInDom(ref, url) {
  if (typeof document === 'undefined' || !url) return;
  document.querySelectorAll('img[data-thumb-ref]').forEach(img => {
    if (img.dataset.thumbRef === ref && img.getAttribute('src') !== url) img.src = url;
  });
}

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
      requestThumb(entry.target.dataset.thumbRef);
    }), { rootMargin: '200px 0px' });
  }
  scope.querySelectorAll('img[data-thumb-ref]').forEach(img => {
    const ref = img.dataset.thumbRef;
    if (thumbUrls.has(ref)) { if (img.getAttribute('src') !== thumbUrls.get(ref)) img.src = thumbUrls.get(ref); return; }
    if (io) io.observe(img);
  });
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
export function _resetThumbsForTest() { thumbUrls.clear(); failed.clear(); queue.length = 0; queued.clear(); running = false; }
