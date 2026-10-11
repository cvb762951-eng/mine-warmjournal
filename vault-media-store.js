import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { NativeMediaStore } from './native-media-store.js';
import { NativeVideoReencode, onReencodeProgress } from './native-video-reencode.js';
import { isMediaRef, saveMediaFile, saveNativeMediaSource, persistImageData, resolveMediaReference, exportMediaReferenceData, restoreMediaReferenceData, deleteMediaReference, mediaReferenceSize, storedMediaName, adoptNativeMediaFile } from './media-store.js';

const PREFIX = 'mine-vault-media://';
const ROOT = 'MineWarmJournalVault';
const DB_NAME = 'mine_warmjournal_private_media';
const STORE = 'encrypted_media';
const previewUrls = new Set();

export const isVaultMediaRef = value => isMediaRef(value) || /^mine-vault-media:\/\/[a-z0-9.-]+$/i.test(String(value || ''));
const isLegacyEncryptedRef = value => /^mine-vault-media:\/\/[a-z0-9.-]+$/i.test(String(value || ''));

export async function encryptVaultFile(input, keyBytes) {
  if (!keyBytes) throw new Error('私密空间已经锁定');
  const file = input instanceof File ? input : input?.file;
  const name = String(file?.name || input?.name || `private-${Date.now()}`).trim();
  const mime = String(file?.type || input?.mimeType || '').trim();
  const type = mime.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(name) ? 'video' : 'photo';
  const size = Number(file?.size || input?.size) || 0;
  const recognizedName = /\.(jpe?g|png|webp|mp4|webm|mov|mkv)$/i.test(name);
  if ((!mime.startsWith('image/') && !mime.startsWith('video/')) && !recognizedName) throw new Error('仅支持 JPG、PNG、WebP 或常见视频文件');
  if (Capacitor.isNativePlatform() && input?.path) return { type, name, mime, size, assetRef: await saveNativeMediaSource(input.path, { name, size }), assetIv: '' };
  if (!file) throw new Error('无法读取所选文件');
  if (file.size > 256 * 1024 * 1024) throw new Error('网页预览单个私密文件暂不支持超过 256MB');
  return { type, name, mime, size, assetRef: await saveMediaFile(file), assetIv: '' };
}

export async function encryptVaultPoster(dataUrl, keyBytes) {
  if (!keyBytes) throw new Error('私密空间已经锁定');
  return { posterRef: await persistImageData(dataUrl), posterIv: '' };
}

export async function encryptExistingVaultMedia(ref, { name = 'private-media', mime = '', type = 'photo', size = 0 } = {}, keyBytes) {
  if (!keyBytes) throw new Error('私密空间已经锁定');
  if (!isMediaRef(ref)) throw new Error('原随手拍文件不存在');
  await resolveMediaReference(ref);
  return { type, name, mime, size: Number(size) || await mediaReferenceSize(ref), assetRef: ref, assetIv: '', reused: true };
}

export async function encryptExistingVaultPoster(ref, keyBytes) {
  if (!ref) return {};
  const stored = await encryptExistingVaultMedia(ref, { name: 'private-poster.jpg', mime: 'image/jpeg', type: 'photo' }, keyBytes);
  return { posterRef: stored.assetRef, posterIv: '', reused: true };
}

export async function openVaultAsset(item, keyBytes, { poster = false } = {}) {
  if (!keyBytes) throw new Error('私密空间已经锁定');
  const ref = poster ? item.posterRef : item.assetRef;
  const iv = poster ? item.posterIv : item.assetIv;
  if (isMediaRef(ref)) return resolveMediaReference(ref);
  if (!isLegacyEncryptedRef(ref) || !iv) throw new Error('私密媒体文件不存在');
  if (Capacitor.isNativePlatform() && item.type === 'video' && !poster) {
    const extension = safeExtension(item.name, 'mp4');
    const result = await NativeMediaStore.decryptMedia({ name: keyOf(ref), iv, key: bytesToBase64(keyBytes), extension });
    return Capacitor.convertFileSrc(result.uri);
  }
  const encrypted = await readEncryptedBytes(ref);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, await importAesKey(keyBytes, 'decrypt'), encrypted);
  const mime = poster ? 'image/jpeg' : item.mime;
  const url = URL.createObjectURL(new Blob([plain], { type: mime || 'application/octet-stream' }));
  previewUrls.add(url);
  return url;
}

const GALLERY_MIME = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp'
};

/** 导出到相册时用的文件名：带上原名和日期，相册里一眼能认出是哪条 */
function galleryFileName(item, extension) {
  const stem = (String(item.name || '').replace(/\.[^.]+$/, '').trim() || (item.type === 'video' ? '私密视频' : '私密照片'))
    .replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 40);
  const date = String(item.date || '').replace(/[^0-9-]/g, '') || new Date().toISOString().slice(0, 10);
  return `${stem}-${date}.${extension}`;
}

/**
 * 调原生导出，并把"这个方法不存在"翻译成人话。
 *
 * ⚠️ 为什么需要这层：Capacitor 的插件是代理对象，**老装机包里没有这个方法时，
 *    调用不会立刻失败，而是异步 reject 一个 "not implemented"**。
 *    直接把这句话弹给用户毫无意义。这个功能是随装机包来的（热更新送不到原生），
 *    所以老包上要明确告诉用户"先更新安装包"。
 */
async function callNativeExport(payload) {
  try {
    return await NativeMediaStore.exportToGallery(payload);
  } catch (error) {
    const raw = String(error?.message || error || '');
    if (/not implemented|not available|未实现|undefined/i.test(raw)) {
      throw new Error('这个功能需要先安装最新的安装包（热更新送不到这里）');
    }
    throw error;
  }
}

/**
 * 把一条私密内容写进系统相册（2026-10-10 新增，用户要求的「保存到相册」）。
 *
 * ⚠️ 两个前提，调用方必须自己处理：
 *   1. 导出之后这条内容就不再受私密空间保护了 —— 必须先向用户明确确认；
 *   2. 私密空间要处于解锁状态（需要密钥解老格式的文件）。
 *
 * 明文不会在本机留下副本：解密和写盘在原生层一步完成，不走缓存中转。
 * 原件仍留在私密空间，这里是"另存一份"，不是"移走"。
 */
export async function exportVaultItemToGallery(item, keyBytes) {
  if (!item) throw new Error('找不到这条内容');
  if (!Capacitor.isNativePlatform()) throw new Error('网页预览不能写入系统相册，请在手机上操作');
  if (!keyBytes) throw new Error('私密空间已经锁定');
  const ref = String(item.assetRef || '');
  const kind = item.type === 'video' ? 'video' : 'photo';
  const extension = safeExtension(item.name, kind === 'video' ? 'mp4' : 'jpg');
  const mimeType = String(item.mime || '').startsWith(`${kind}/`)
    ? item.mime
    : (GALLERY_MIME[extension] || (kind === 'video' ? 'video/mp4' : 'image/jpeg'));
  const displayName = galleryFileName(item, extension);

  const stored = storedMediaName(ref);
  if (stored) {
    return callNativeExport({ storedName: stored, displayName, mimeType, kind });
  }
  if (isLegacyEncryptedRef(ref) && item.assetIv) {
    return callNativeExport({
      vaultName: keyOf(ref), iv: item.assetIv, key: bytesToBase64(keyBytes), displayName, mimeType, kind
    });
  }
  throw new Error('这条内容暂时不支持导出到相册');
}

/**
 * 把"剪辑"真正做进文件里（2026-10-10 新增，用户选的「剪完替换原件」）。
 *
 * ⚠️ 调用前必须已经向用户明确确认过：这一步会产出新文件并顶掉原片。
 *    这里只管把新文件做出来、把新引用交回去；**私密空间的元数据一个字段都不动**——
 *    替换由调用方在拿到结果之后完成。这样"压缩失败"时原片完好无损。
 *
 * @returns {Promise<{ref: string, bytes: number, durationMs: number, width: number, height: number}>}
 */
export async function reencodeVaultItem(item, { trim = null, crop = null } = {}, keyBytes, { onProgress } = {}) {
  if (!item) throw new Error('找不到这条内容');
  if (!Capacitor.isNativePlatform()) throw new Error('网页预览不能重新压缩视频，请在手机上操作');
  if (!keyBytes) throw new Error('私密空间已经锁定');
  const ref = String(item.assetRef || '');
  const stored = storedMediaName(ref);
  const legacy = isLegacyEncryptedRef(ref) && item.assetIv;
  if (!stored && !legacy) throw new Error('这段视频暂时不支持重新压缩');

  const stop = typeof onProgress === 'function' ? await onReencodeProgress(onProgress) : () => {};
  let result;
  try {
    result = await callNativeReencode({
      ...(stored
        ? { storedName: stored }
        : { vaultName: keyOf(ref), iv: item.assetIv, key: bytesToBase64(keyBytes) }),
      trimStart: Math.max(0, Number(trim?.start) || 0),
      trimEnd: Math.max(0, Number(trim?.end) || 0),
      cropX: Math.max(0, Number(crop?.x) || 0),
      cropY: Math.max(0, Number(crop?.y) || 0),
      cropW: crop ? Number(crop.w) : 1,
      cropH: crop ? Number(crop.h) : 1
    });
  } finally {
    stop();
  }
  if (!result?.name || !result?.uri) throw new Error('重新压缩没有生成文件');
  return {
    ref: adoptNativeMediaFile(result.name, result.uri),
    bytes: Number(result.bytes) || 0,
    durationMs: Number(result.durationMs) || 0,
    width: Number(result.width) || 0,
    height: Number(result.height) || 0
  };
}

/**
 * 用户中途放弃压缩时调用（2026-10-10 新增）。
 * 原生会把半成品丢掉，原片不受影响；正在等待的那次 reencode 调用会以"已取消"结束。
 */
export async function cancelVaultReencode() {
  if (!Capacitor.isNativePlatform()) return;
  await NativeVideoReencode.cancel().catch(() => {});
}

/**
 * 调原生重新压缩，并把"这个方法不存在"翻译成人话。
 * 和保存到相册同理：这个能力随装机包而来，热更新送不到，老包上要说明白。
 */
async function callNativeReencode(payload) {
  try {
    return await NativeVideoReencode.reencode(payload);
  } catch (error) {
    const raw = String(error?.message || error || '');
    if (/not implemented|not available|未实现|undefined/i.test(raw)) {
      throw new Error('这个功能需要先安装最新的安装包（热更新送不到这里）');
    }
    throw error;
  }
}

export async function deleteVaultAssets(refs = [], { force = false } = {}) {  for (const ref of [...new Set(refs.filter(isVaultMediaRef))]) {
    if (isMediaRef(ref)) { if (force) await deleteMediaReference(ref); continue; }
    if (Capacitor.isNativePlatform()) await Filesystem.deleteFile({ path: `${ROOT}/${keyOf(ref)}`, directory: Directory.Data }).catch(() => {});
    else await browserRequest('readwrite', store => store.delete(keyOf(ref))).catch(() => {});
  }
}

export async function clearVaultPreviewFiles() {
  for (const url of previewUrls) URL.revokeObjectURL(url);
  previewUrls.clear();
  if (Capacitor.isNativePlatform()) await NativeMediaStore.clearVaultPreviews().catch(() => {});
}

export async function vaultMediaHealth(vault) {
  let bytes = 0;
  let missing = 0;
  for (const ref of vault?.assetRefs || []) {
    try {
      if (isMediaRef(ref)) bytes += await mediaReferenceSize(ref);
      else if (Capacitor.isNativePlatform()) bytes += Number((await Filesystem.stat({ path: `${ROOT}/${keyOf(ref)}`, directory: Directory.Data })).size) || 0;
      else {
        const record = await browserRequest('readonly', store => store.get(keyOf(ref)));
        if (!record?.blob) throw new Error('missing');
        bytes += Number(record.blob.size) || 0;
      }
    } catch { missing += 1; }
  }
  return { files: vault?.assetRefs?.length || 0, bytes, missing, healthy: missing === 0 };
}

export async function expandVaultReferences(vault) {
  if (!vault?.assetRefs?.length) return vault;
  const clone = structuredClone(vault);
  clone.archivedAssets = [];
  for (const ref of vault.assetRefs) clone.archivedAssets.push(isMediaRef(ref) ? { ref, dataUrl: await exportMediaReferenceData(ref, /\.(?:jpg|jpeg|png|webp)$/i.test(ref) ? 'image' : 'video') } : { ref, data: bytesToBase64(new Uint8Array(await readEncryptedBytes(ref))) });
  return clone;
}

export async function restoreVaultReferences(vault) {
  if (!Array.isArray(vault?.archivedAssets)) return vault;
  for (const asset of vault.archivedAssets) {
    if (!isVaultMediaRef(asset?.ref)) continue;
    if (isMediaRef(asset.ref) && asset.dataUrl) { await restoreMediaReferenceData(asset.ref, asset.dataUrl); continue; }
    if (!asset?.data) continue;
    const bytes = base64ToBytes(asset.data);
    if (Capacitor.isNativePlatform()) await Filesystem.writeFile({ path: `${ROOT}/${keyOf(asset.ref)}`, data: asset.data, directory: Directory.Data, recursive: true });
    else await browserRequest('readwrite', store => store.put({ id: keyOf(asset.ref), blob: new Blob([bytes]), updatedAt: Date.now() }));
  }
  delete vault.archivedAssets;
  return vault;
}

export async function migrateVaultMediaToPrivate(content, keyBytes) {
  if (!keyBytes || !content?.items) return 0;
  const replacements = [];
  try {
    for (const item of content.items) {
      for (const slot of [{ ref: 'assetRef', iv: 'assetIv', poster: false }, { ref: 'posterRef', iv: 'posterIv', poster: true }]) {
        const oldRef = item[slot.ref];
        if (!isLegacyEncryptedRef(oldRef)) continue;
        const newRef = await migrateLegacyAsset(item, keyBytes, slot.poster);
        replacements.push({ item, slot, oldRef, newRef });
        item[slot.ref] = newRef;
        item[slot.iv] = '';
      }
    }
  } catch (error) {
    for (const replacement of replacements) { replacement.item[replacement.slot.ref] = replacement.oldRef; await deleteMediaReference(replacement.newRef); }
    throw new Error(`旧私密媒体迁移失败：${error.message}`);
  }
  for (const replacement of replacements) await deleteVaultAssets([replacement.oldRef]);
  return replacements.length;
}

async function migrateLegacyAsset(item, keyBytes, poster) {
  const ref = poster ? item.posterRef : item.assetRef;
  const iv = poster ? item.posterIv : item.assetIv;
  const mime = poster ? 'image/jpeg' : (item.mime || (item.type === 'video' ? 'video/mp4' : 'image/jpeg'));
  const name = poster ? 'private-poster.jpg' : item.name;
  if (Capacitor.isNativePlatform()) {
    const result = await NativeMediaStore.decryptMedia({ name: keyOf(ref), iv, key: bytesToBase64(keyBytes), extension: safeExtension(name, poster ? 'jpg' : 'bin') });
    return saveNativeMediaSource(result.uri, { name, size: poster ? 0 : item.size });
  }
  const encrypted = await readEncryptedBytes(ref);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, await importAesKey(keyBytes, 'decrypt'), encrypted);
  return saveMediaFile(new File([plain], name, { type: mime }));
}

async function encryptBlob(blob, keyBytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importAesKey(keyBytes, 'encrypt'), await blob.arrayBuffer());
  const id = `${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}.vault`;
  if (Capacitor.isNativePlatform()) await Filesystem.writeFile({ path: `${ROOT}/${id}`, data: bytesToBase64(new Uint8Array(cipher)), directory: Directory.Data, recursive: true });
  else await browserRequest('readwrite', store => store.put({ id, blob: new Blob([cipher]), updatedAt: Date.now() }));
  return { ref: `${PREFIX}${id}`, iv: bytesToBase64(iv) };
}

async function readEncryptedBytes(ref) {
  if (Capacitor.isNativePlatform()) return base64ToBytes((await Filesystem.readFile({ path: `${ROOT}/${keyOf(ref)}`, directory: Directory.Data })).data).buffer;
  const record = await browserRequest('readonly', store => store.get(keyOf(ref)));
  if (!record?.blob) throw new Error('私密媒体文件缺失');
  return record.blob.arrayBuffer();
}

const keyOf = ref => String(ref).slice(PREFIX.length);
const safeExtension = (name, fallback) => String(name || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || fallback;
const importAesKey = (bytes, usage) => crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [usage]);

let databasePromise;
function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开私密媒体仓库'));
  });
  return databasePromise;
}

async function browserRequest(mode, action) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('私密媒体存储失败'));
  });
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(String(base64 || ''));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
