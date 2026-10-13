import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { NativeMediaStore } from './native-media-store.js';

const PREFIX = 'mine-media://';
const BROWSER_PREFIX = 'mine-browser-media://';
// 独立 App 媒体目录：不复用旧 Mine 的附件命名空间。
const ROOT = 'MineWarmJournalMedia';
// 回收站：未引用的媒体先移到这里而不是直接删除，保留 TRASH_RETENTION_MS 后才真正清掉。
// 直接 deleteFile 一旦判断失误就是永久丢失，这里给出一个可人工找回的窗口。
const TRASH_DIR = '.trash';
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const BROWSER_DB = 'mine_warmjournal_media';
const BROWSER_STORE = 'media';
const STORAGE_RESERVE_BYTES = 48 * 1024 * 1024;
const urls = new Map();
const dataPattern = /^data:image\/(jpeg|png|webp);base64,(.+)$/s;
const videoDataPattern = /^data:video\/([a-z0-9.+-]+);base64,(.+)$/s;

export const isMediaRef = value => {
  const source = String(value || '');
  return source.startsWith(PREFIX) || source.startsWith(BROWSER_PREFIX);
};
const isNativeRef = value => String(value || '').startsWith(PREFIX);
const isBrowserRef = value => String(value || '').startsWith(BROWSER_PREFIX);
export const mediaSource = value => isMediaRef(value) ? (urls.get(value) || '') : String(value || '');
/**
 * 取出存在本机私有目录里的文件名（给"保存到相册"这类需要原生按名取文件的场景用）。
 * 浏览器存法的引用（mine-browser-media://）没有对应的本机文件，返回空串。
 */
export const storedMediaName = value => isNativeRef(value) ? String(value).slice(PREFIX.length) : '';

/**
 * 把一段「已经在 App 私有目录里」的视频登记成媒体引用（2026-10-10 新增）。
 *
 * 用于私密空间的"真剪文件"：原生重新编码之后，新文件已经直接落在目标目录里，
 * **绝不能再走一次复制**（那会白花一份时间与空间）；这里只把它的访问地址登记进缓存，
 * 页面就能立刻播放、也更不会被"未引用媒体清理"误判成孤儿。
 */
export function adoptNativeMediaFile(name, uri) {
  const ref = `${PREFIX}${name}`;
  urls.set(ref, Capacitor.convertFileSrc(uri));
  return markFresh(ref);
}

export async function resolveMediaReference(ref) {
  if (!isMediaRef(ref)) return String(ref || '');
  if (urls.has(ref)) return urls.get(ref);
  return isBrowserRef(ref) ? ensureBrowserUrl(ref) : ensureUrl(ref);
}

export async function exportMediaReferenceData(ref, kind = 'video') {
  if (!isMediaRef(ref)) throw new Error('媒体引用无效');
  return isBrowserRef(ref) ? readBrowserData(ref) : readDataImage(ref, kind);
}

export async function restoreMediaReferenceData(ref, dataUrl) {
  if (!isMediaRef(ref)) throw new Error('媒体引用无效');
  const match = String(dataUrl || '').match(/^data:([a-z0-9.+/-]+);base64,(.+)$/is);
  if (!match) throw new Error('备份媒体内容无效');
  if (isBrowserRef(ref)) {
    const blob = await fetch(dataUrl).then(response => response.blob());
    await browserRequest('readwrite', store => store.put({ id: browserKey(ref), blob, mime: blob.type, updatedAt: Date.now() }));
    urls.set(ref, URL.createObjectURL(blob));
  } else {
    await Filesystem.writeFile({ path: pathFor(ref), data: match[2], directory: Directory.Data, recursive: true });
    await ensureUrl(ref);
  }
  return ref;
}

export async function deleteMediaReference(ref) {
  if (!isMediaRef(ref)) return;
  const source = urls.get(ref);
  if (source?.startsWith('blob:')) URL.revokeObjectURL(source);
  urls.delete(ref);
  if (isBrowserRef(ref)) await browserDelete(browserKey(ref)).catch(() => {});
  else await Filesystem.deleteFile({ path: pathFor(ref), directory: Directory.Data }).catch(() => {});
}

export async function mediaReferenceSize(ref) {
  if (!isMediaRef(ref)) return 0;
  if (isBrowserRef(ref)) return Number((await browserGet(browserKey(ref)))?.blob?.size) || 0;
  return Number((await Filesystem.stat({ path: pathFor(ref), directory: Directory.Data })).size) || 0;
}

// 批量导入图片时立即外置到 Android 私有目录，避免大量 dataURL 长时间停留在 SQLite 状态里。
export async function persistImageData(value) {
  if (!dataPattern.test(String(value || ''))) return value;
  return Capacitor.isNativePlatform() ? writeDataImage(value) : writeBrowserData(value, 'image');
}

/** 把内嵌 dataURL 外置成短引用；可选地给已有引用预热可显示的本地地址。
 *  warmExisting=false：启动时跳过「给每一张照片调 Filesystem.getUri」——那是冷启动最慢的一段；
 *  首屏需要的几张由 warmMediaRefs 单独预热，其余在第一帧之后再补。 */
export async function externalizeStateMedia(state, { warmExisting = true } = {}) {
  const native = Capacitor.isNativePlatform();
  let migrated = 0;
  for (const slot of mediaSlots(state)) {
    const value = slot.get();
    if (!value) continue;
    if (isMediaRef(value)) {
      if (!warmExisting) continue;
      const ensure = isBrowserRef(value) ? ensureBrowserUrl : native && isNativeRef(value) ? ensureUrl : null;
      if (ensure) await ensure(value).catch(() => urls.set(value, ''));
      continue;
    }
    if (slot.kind === 'video') {
      if (!videoDataPattern.test(value)) continue;
      slot.set(native ? await writeMediaData(value) : await writeBrowserData(value, 'video'));
      migrated += 1;
      continue;
    }
    if (!dataPattern.test(value)) continue;
    slot.set(native ? await writeDataImage(value) : await writeBrowserData(value, 'image'));
    migrated += 1;
  }
  return { migrated, state };
}

/** 只给指定引用解析可显示地址（原生 convertFileSrc / 浏览器 blob URL）。失败记空串，不抛。 */
export async function warmMediaRefs(refs = []) {
  const list = [...new Set((refs || []).filter(isMediaRef))];
  for (const ref of list) {
    if (urls.has(ref)) continue;
    try {
      if (isBrowserRef(ref)) await ensureBrowserUrl(ref);
      else if (isNativeRef(ref)) await ensureUrl(ref);
    } catch { urls.set(ref, ''); }
  }
  return list.length;
}

/** 今日页第一帧真正会用到的媒体：封面、最新 3 张随手拍封面、头像。其它等首屏后再补。 */
export function firstPaintMediaRefs(state) {
  const refs = [];
  const cover = state?.settings?.todayCoverImage;
  if (cover) refs.push(cover);
  const avatar = state?.profile?.avatar;
  if (avatar) refs.push(avatar);
  const photos = (state?.snippets || [])
    .filter(entry => entry?.type === 'photo' && (entry.photos?.length || entry.photo))
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    .slice(0, 3);
  for (const entry of photos) refs.push(entry.photos?.length ? entry.photos[0] : entry.photo);
  return refs;
}

export async function expandMediaReferences(state) {
  const clone = structuredClone(state);
  for (const slot of mediaSlots(clone)) {
    const value = slot.get();
    if (isMediaRef(value)) slot.set(isBrowserRef(value) ? await readBrowserData(value) : await readDataImage(value, slot.kind || 'image'));
  }
  return clone;
}

// 把相册/拍摄得到的视频写入媒体仓库：Android 私有目录或浏览器 IndexedDB。
// 状态数据只保存短引用，避免 SQLite/localStorage 被视频字节撑爆。
export async function saveMediaFile(file) {
  const extension = (file.name || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  if (!Capacitor.isNativePlatform()) {
    await ensureBrowserCapacity(Number(file.size) || 0);
    return writeBrowserBlob(file, extension, file.type || 'video/mp4');
  }
  const name = `${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}.${extension}`;
  const ref = `${PREFIX}${name}`;
  await Filesystem.writeFile({ path: `${ROOT}/${name}`, data: await fileToBase64(file), directory: Directory.Data, recursive: true });
  const uri = await Filesystem.getUri({ path: `${ROOT}/${name}`, directory: Directory.Data });
  urls.set(ref, Capacitor.convertFileSrc(uri.uri));
  return markFresh(ref);
}

export async function mediaHealth(state) {
  const refs = [...new Set(mediaSlots(state).map(slot => slot.get()).filter(isMediaRef))];
  let missing = 0;
  let bytes = 0;
  for (const ref of refs) {
    try {
      if (isBrowserRef(ref)) {
        const record = await browserGet(browserKey(ref));
        if (!record) throw new Error('missing');
        bytes += Number(record.blob?.size) || 0;
      } else {
        const stat = await Filesystem.stat({ path: pathFor(ref), directory: Directory.Data });
        bytes += Number(stat.size) || 0;
      }
    }
    catch { missing += 1; }
  }
  const embedded = mediaSlots(state).filter(slot => dataPattern.test(slot.get()) || videoDataPattern.test(slot.get())).length;
  const estimate = !Capacitor.isNativePlatform() && navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => ({})) : {};
  return { files: refs.length, embedded, missing, bytes, quota: Number(estimate.quota) || 0, usage: Number(estimate.usage) || bytes, healthy: missing === 0 };
}

export function stateMediaReferences(state) {
  return [...new Set(mediaSlots(state).map(slot => slot.get()).filter(isMediaRef))];
}


// 把文件移入回收站。移动失败时【保留原文件】—— 宁可不删，也不能误删。
/* 新落盘媒体的保护期：本次运行里写入的引用，或文件 mtime 在保护期内，都不当孤儿处理。 */
const FRESH_MEDIA_MS = 24 * 60 * 60 * 1000;
const freshNames = new Set();
const markFresh = ref => { if (isNativeRef(ref)) freshNames.add(String(ref).slice(PREFIX.length)); return ref; };
export function isFreshMedia(name, mtime, now = Date.now()) {
  if (freshNames.has(name)) return true;
  const time = Number(mtime);
  return Number.isFinite(time) && time > 0 && now - time < FRESH_MEDIA_MS;
}

/** 把被引用却躺在回收站里的媒体挪回原处。paths 形如 `${ROOT}/<name>`。 */
export async function recoverTrashedMedia(paths = []) {
  const wanted = new Map(paths.map(path => [path.slice(ROOT.length + 1), path]));
  if (!wanted.size) return 0;
  let recovered = 0;
  try {
    const listing = await Filesystem.readdir({ path: `${ROOT}/${TRASH_DIR}`, directory: Directory.Data });
    const entries = (listing.files || [])
      .filter(file => file.type !== 'directory')
      .map(file => ({ file, name: file.name.replace(/^\d{13}--/, '') }))
      .sort((a, b) => b.file.name.localeCompare(a.file.name));
    for (const { file, name } of entries) {
      if (!wanted.has(name)) continue;
      const ok = await Filesystem.rename({
        from: `${ROOT}/${TRASH_DIR}/${file.name}`, to: wanted.get(name),
        directory: Directory.Data, toDirectory: Directory.Data
      }).then(() => true, () => false);
      if (ok) { wanted.delete(name); markFresh(`${PREFIX}${name}`); urls.delete(`${PREFIX}${name}`); recovered += 1; }
    }
  } catch { /* 回收站不存在：没有可找回的 */ }
  return recovered;
}

async function moveToTrash(name) {
  try {
    await Filesystem.mkdir({ path: `${ROOT}/${TRASH_DIR}`, directory: Directory.Data, recursive: true }).catch(() => {});
    await Filesystem.rename({
      from: `${ROOT}/${name}`,
      // 入站时间写进文件名；rename 通常保留原文件 mtime，不能拿它计算保留期。
      to: `${ROOT}/${TRASH_DIR}/${Date.now()}--${name}`,
      directory: Directory.Data,
      toDirectory: Directory.Data
    });
    return true;
  } catch {
    return false;
  }
}

// 回收站只保留 TRASH_RETENTION_MS，过期才真正删除；读取失败一律不动。
async function purgeTrash() {
  try {
    const listing = await Filesystem.readdir({ path: `${ROOT}/${TRASH_DIR}`, directory: Directory.Data });
    const now = Date.now();
    for (const file of listing.files || []) {
      if (file.type === 'directory') continue;
      const path = `${ROOT}/${TRASH_DIR}/${file.name}`;
      const enteredAt = Number(file.name.match(/^(\d{13})--.+$/)?.[1]);
      if (!enteredAt) {
        // 旧版回收站没有入站时间。从首次观察起再保留七天，绝不按旧 mtime 删除。
        await Filesystem.rename({ from: path, to: `${ROOT}/${TRASH_DIR}/${now}--${file.name}`, directory: Directory.Data, toDirectory: Directory.Data }).catch(() => {});
        continue;
      }
      if (now - enteredAt >= TRASH_RETENTION_MS) await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => {});
    }
  } catch { /* 回收站不存在或不可读：忽略 */ }
}

export async function removeUnusedMedia(state, protectedRefs = []) {
  if (!Capacitor.isNativePlatform()) {
    const used = new Set([...mediaSlots(state).map(slot => slot.get()), ...protectedRefs].filter(isBrowserRef).map(browserKey));
    let removed = 0;
    for (const key of await browserKeys()) {
      const record = await browserGet(key);
      if (!record) continue;
      if (used.has(key)) {
        if (record.trashedAt) { delete record.trashedAt; await browserRequest('readwrite', store => store.put(record)); }
        continue;
      }
      // 刚写入、还没进任何记录的待保存媒体不清理（同原生端保护期）。
      if (Date.now() - (Number(record.updatedAt) || 0) < FRESH_MEDIA_MS) continue;
      const ref = `${BROWSER_PREFIX}${key}`;
      const source = urls.get(ref);
      if (source?.startsWith('blob:')) URL.revokeObjectURL(source);
      urls.delete(ref);
      if (!record.trashedAt) {
        await browserRequest('readwrite', store => store.put({ ...record, trashedAt: Date.now() }));
        removed += 1;
      } else if (Date.now() - record.trashedAt >= TRASH_RETENTION_MS) await browserDelete(key);
    }
    return removed;
  }
  const used = new Set([...mediaSlots(state).map(slot => slot.get()), ...protectedRefs].filter(isNativeRef).map(pathFor));
  let removed = 0;
  try {
    const directory = await Filesystem.readdir({ path: ROOT, directory: Directory.Data });
    const present = new Set((directory.files || []).map(file => `${ROOT}/${file.name}`));
    // 记录里引用着、本体却已在回收站的文件：先挪回原处（2026-10-13 随手拍拍照后不显示）。
    await recoverTrashedMedia([...used].filter(path => !present.has(path)));
    const now = Date.now();
    for (const file of directory.files || []) {
      // 回收站自身与子目录一律不处理
      if (file.name === TRASH_DIR || file.type === 'directory') continue;
      const path = `${ROOT}/${file.name}`;
      if (used.has(path)) continue;
      // 刚落盘、还没保存进任何记录的媒体（正在编辑的随手拍 / 日记 / 账本里待保存的照片）不清理：
      // 编辑过程中别处触发的一次 save() 会把它们误判成孤儿。
      if (isFreshMedia(file.name, file.mtime, now)) continue;
      if (await moveToTrash(file.name)) removed += 1;
    }
  } catch {}
  await purgeTrash();
  return removed;
}

async function writeDataImage(value) {
  const match = value.match(dataPattern);
  if (!match) return value;
  const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
  const name = `${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}.${extension}`;
  const ref = `${PREFIX}${name}`;
  await Filesystem.writeFile({ path: `${ROOT}/${name}`, data: match[2], directory: Directory.Data, recursive: true });
  const uri = await Filesystem.getUri({ path: `${ROOT}/${name}`, directory: Directory.Data });
  urls.set(ref, Capacitor.convertFileSrc(uri.uri));
  return markFresh(ref);
}

// 视频 dataURL → 媒体文件（mime 映射扩展名）。
async function writeMediaData(value) {
  const match = String(value).match(/^data:video\/([a-z0-9.+-]+);base64,(.+)$/s);
  if (!match) return value;
  const extension = { mp4: 'mp4', webm: 'webm', quicktime: 'mov', 'x-matroska': 'mkv' }[match[1]] || 'mp4';
  const name = `${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}.${extension}`;
  const ref = `${PREFIX}${name}`;
  await Filesystem.writeFile({ path: `${ROOT}/${name}`, data: match[2], directory: Directory.Data, recursive: true });
  const uri = await Filesystem.getUri({ path: `${ROOT}/${name}`, directory: Directory.Data });
  urls.set(ref, Capacitor.convertFileSrc(uri.uri));
  return markFresh(ref);
}

async function ensureUrl(ref) {
  if (urls.has(ref)) return urls.get(ref);
  const uri = await Filesystem.getUri({ path: pathFor(ref), directory: Directory.Data });
  const source = Capacitor.convertFileSrc(uri.uri);
  urls.set(ref, source);
  return source;
}

async function readDataImage(ref, kind = 'image') {
  const result = await Filesystem.readFile({ path: pathFor(ref), directory: Directory.Data });
  const extension = ref.split('.').pop().toLowerCase();
  const mime = kind === 'video'
    ? ({ mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska' }[extension] || 'video/mp4')
    : `image/${extension === 'jpg' ? 'jpeg' : extension}`;
  return `data:${mime};base64,${result.data}`;
}

function pathFor(ref) { return `${ROOT}/${String(ref).slice(PREFIX.length)}`; }
function browserKey(ref) { return String(ref).slice(BROWSER_PREFIX.length); }

let browserDatabasePromise = null;
function openBrowserDatabase() {
  if (browserDatabasePromise) return browserDatabasePromise;
  browserDatabasePromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('当前浏览器不支持 IndexedDB 媒体存储'));
    const request = indexedDB.open(BROWSER_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BROWSER_STORE)) request.result.createObjectStore(BROWSER_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开浏览器媒体仓库'));
  });
  return browserDatabasePromise;
}

async function browserRequest(mode, action) {
  const database = await openBrowserDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(BROWSER_STORE, mode);
    const store = transaction.objectStore(BROWSER_STORE);
    let request;
    try { request = action(store); }
    catch (error) { reject(error); return; }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('浏览器媒体仓库操作失败'));
  });
}

const browserGet = key => browserRequest('readonly', store => store.get(key));
const browserKeys = () => browserRequest('readonly', store => store.getAllKeys());
const browserDelete = key => browserRequest('readwrite', store => store.delete(key));

async function writeBrowserBlob(blob, extension = 'bin', mime = '') {
  const cleanExtension = String(extension || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const id = `${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}.${cleanExtension}`;
  const storedBlob = blob instanceof Blob && blob.type ? blob : new Blob([blob], { type: mime || 'application/octet-stream' });
  await browserRequest('readwrite', store => store.put({ id, blob: storedBlob, mime: storedBlob.type || mime, updatedAt: Date.now() }));
  const ref = `${BROWSER_PREFIX}${id}`;
  urls.set(ref, URL.createObjectURL(storedBlob));
  return ref;
}

// Android 直接把 Content URI / file URI 流式复制到 App 私有目录，避免整段视频进入 WebView 内存。
export async function saveNativeMediaSource(source, { name = 'video.mp4', size = 0 } = {}) {
  if (!Capacitor.isNativePlatform()) throw new Error('仅 Android 支持原生视频流式保存');
  const result = await NativeMediaStore.copyVideo({ source: String(source || ''), name, expectedBytes: Number(size) || 0 });
  if (!result?.name || !result?.uri) throw new Error('视频没有成功写入本机');
  const ref = `${PREFIX}${result.name}`;
  urls.set(ref, Capacitor.convertFileSrc(result.uri));
  markFresh(ref);
  return ref;
}

async function ensureBrowserCapacity(bytes) {
  if (!bytes || !navigator.storage?.estimate) return;
  await navigator.storage.persist?.().catch(() => false);
  const estimate = await navigator.storage.estimate();
  const available = Math.max(0, Number(estimate.quota || 0) - Number(estimate.usage || 0));
  if (estimate.quota && available < bytes + STORAGE_RESERVE_BYTES) {
    throw new Error(`本机媒体空间不足：视频需要 ${formatBytes(bytes)}，请至少保留 ${formatBytes(bytes + STORAGE_RESERVE_BYTES)} 可用空间`);
  }
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

async function writeBrowserData(value, kind = 'image') {
  const source = String(value || '');
  const match = source.match(/^data:(image|video)\/([a-z0-9.+-]+);base64,/i);
  if (!match) return value;
  const blob = await fetch(source).then(response => response.blob());
  const subtype = match[2].toLowerCase();
  const extension = subtype === 'jpeg' ? 'jpg' : ({ quicktime: 'mov', 'x-matroska': 'mkv' }[subtype] || subtype.split('+')[0]);
  return writeBrowserBlob(blob, extension || (kind === 'video' ? 'mp4' : 'png'), blob.type);
}

async function ensureBrowserUrl(ref) {
  if (urls.has(ref)) return urls.get(ref);
  const record = await browserGet(browserKey(ref));
  if (!record?.blob) throw new Error('浏览器媒体文件不存在');
  const source = URL.createObjectURL(record.blob);
  urls.set(ref, source);
  return source;
}

async function readBrowserData(ref) {
  const record = await browserGet(browserKey(ref));
  if (!record?.blob) throw new Error('浏览器媒体文件不存在');
  return fileToDataUrl(record.blob);
}

function retargetLiveStill(list, previous, value) {
  if (!previous || previous === value || !Array.isArray(list)) return;
  for (const item of list) if (item?.still === previous) item.still = value;
}

function addLiveVideoSlots(slots, list) {
  for (const item of list || []) {
    if (!item) continue;
    slots.push({ get: () => item.video, set: value => { item.video = value; }, kind: 'video' });
  }
}

function mediaSlots(state) {
  const slots = [];
  if (state?.profile) slots.push({ get: () => state.profile.avatar, set: value => { state.profile.avatar = value; } });
  if (state?.settings) {
    slots.push({ get: () => state.settings.backgroundImage, set: value => { state.settings.backgroundImage = value; } });
    slots.push({ get: () => state.settings.todayCoverImage, set: value => { state.settings.todayCoverImage = value; } });
    for (const draft of Object.values(state.settings.journalDrafts || {})) {
      if (!Array.isArray(draft?.photos)) continue;
      draft.photos.forEach((_, index) => slots.push({
        get: () => draft.photos[index],
        set: value => {
          const previous = draft.photos[index];
          draft.photos[index] = value;
          retargetLiveStill(draft.livePhotos, previous, value);
        }
      }));
      addLiveVideoSlots(slots, draft.livePhotos);
    }
  }
  for (const entry of state?.snippets || []) {
    // photos[] 为主（photo 是 photos[0] 的兼容镜像，同步更新）
    (entry.photos || []).forEach((_, index) => slots.push({
      get: () => entry.photos[index],
      set: value => {
        const previous = entry.photos[index];
        entry.photos[index] = value;
        if (index === 0) entry.photo = value;
        retargetLiveStill(entry.livePhotos, previous, value);
      }
    }));
    // 视频/实况图项：poster 走图片外部化，video 走视频文件引用（kind: video）。
    (entry.videos || []).forEach(item => {
      if (!item) return;
      slots.push({ get: () => item.poster, set: value => { item.poster = value; } });
      slots.push({ get: () => item.video, set: value => { item.video = value; }, kind: 'video' });
    });
    addLiveVideoSlots(slots, entry.livePhotos);
  }
  for (const entry of state?.media || []) slots.push({ get: () => entry.poster, set: value => { entry.poster = value; } });
  for (const entry of state?.tasteEntries || []) (entry.photos || []).forEach((_, index) => slots.push({ get: () => entry.photos[index], set: value => { entry.photos[index] = value; } }));
  for (const entry of state?.countdowns || []) slots.push({ get: () => entry.image, set: value => { entry.image = value; } });
  for (const entry of state?.transactions || []) slots.push({ get: () => entry.photo, set: value => { entry.photo = value; } });
  for (const journal of Object.values(state?.journals || {})) {
    (journal.photos || []).forEach((_, index) => slots.push({
      get: () => journal.photos[index],
      set: value => {
        const previous = journal.photos[index];
        journal.photos[index] = value;
        retargetLiveStill(journal.livePhotos, previous, value);
      }
    }));
    addLiveVideoSlots(slots, journal.livePhotos);
  }
  return slots;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('无法读取文件'));
    reader.readAsDataURL(file);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('无法读取视频文件'));
    reader.readAsDataURL(file);
  });
}

/** 启动时把记录引用着、却已进回收站的原生媒体找回来。 */
export async function recoverReferencedMedia(state, extraRefs = []) {
  if (!Capacitor.isNativePlatform()) return 0;
  const paths = [...new Set([...mediaSlots(state).map(slot => slot.get()), ...extraRefs].filter(isNativeRef).map(pathFor))];
  if (!paths.length) return 0;
  let present = new Set();
  try {
    const directory = await Filesystem.readdir({ path: ROOT, directory: Directory.Data });
    present = new Set((directory.files || []).map(file => `${ROOT}/${file.name}`));
  } catch { /* 目录不存在：全部按缺失处理 */ }
  return recoverTrashedMedia(paths.filter(path => !present.has(path)));
}
