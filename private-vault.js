import { clearVaultPreviewFiles } from './vault-media-store.js';
import { normalizeCrop, croppedFrame } from './video-crop.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CHECK_TEXT = 'MINE_PRIVATE_VAULT_V1';
const ITERATIONS = 310000;

let keyBytes = null;
let content = null;

export const privateVaultConfigured = state => Boolean(state?.privateVault?.salt && state.privateVault.verifier && state.privateVault.payload);
export const privateVaultUnlocked = () => Boolean(keyBytes && content);
export const privateVaultContent = () => content;
export const privateVaultKey = () => keyBytes;
export const privateVaultKeyBase64 = () => keyBytes ? bytesToBase64(keyBytes) : '';

export async function setupPrivateVault(state, password) {
  validatePassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await deriveBytes(password, salt);
  const verifier = await encryptText(CHECK_TEXT, derived);
  keyBytes = derived;
  content = { folders: [], items: [] };
  const payload = await encryptText(JSON.stringify(content), derived);
  state.privateVault = {
    version: 1,
    salt: bytesToBase64(salt),
    verifierIv: verifier.iv,
    verifier: verifier.ciphertext,
    payloadIv: payload.iv,
    payload: payload.ciphertext,
    assetRefs: [],
    updatedAt: Date.now()
  };
  return content;
}

export async function unlockPrivateVault(state, password) {
  if (!privateVaultConfigured(state)) throw new Error('私密空间尚未设置');
  let derived = null;
  try {
    derived = await deriveBytes(password, base64ToBytes(state.privateVault.salt));
    return await unlockPrivateVaultWithKey(state, derived);
  } catch {
    keyBytes = null;
    content = null;
    throw new Error('私密密码错误');
  } finally { derived?.fill(0); }
}

export async function unlockPrivateVaultWithKey(state, key) {
  if (!privateVaultConfigured(state)) throw new Error('私密空间尚未设置');
  const derived = typeof key === 'string' ? base64ToBytes(key) : new Uint8Array(key || []);
  if (derived.length !== 32) throw new Error('私密空间指纹密钥失效，请使用密码');
  try {
    const vault = state.privateVault;
    const check = await decryptText(vault.verifier, vault.verifierIv, derived);
    if (check !== CHECK_TEXT) throw new Error('wrong');
    const parsed = JSON.parse(await decryptText(vault.payload, vault.payloadIv, derived));
    if (keyBytes) keyBytes.fill(0);
    keyBytes = new Uint8Array(derived);
    content = normalizeContent(parsed);
    return content;
  } catch {
    derived.fill(0);
    keyBytes = null;
    content = null;
    throw new Error('私密空间指纹密钥失效，请使用密码');
  }
}

// 播放器会一直拿着某一条 item 的引用（上下滑动切视频时尤其如此）。
// 保存若换成新对象，这次之后写入的观看记录和播放进度就落到已经不在 content 里的旧对象上，下一次保存会把它们丢掉。
function adoptNormalizedEntries(currentEntries, normalizedEntries) {
  const existing = new Map((Array.isArray(currentEntries) ? currentEntries : []).filter(entry => entry?.id).map(entry => [entry.id, entry]));
  return normalizedEntries.map(entry => {
    const current = existing.get(entry.id);
    if (!current || current === entry) return entry;
    for (const field of Object.keys(current)) {
      if (!Object.prototype.hasOwnProperty.call(entry, field)) delete current[field];
    }
    return Object.assign(current, entry);
  });
}

let vaultPersistQueue = Promise.resolve();

export function persistPrivateVault(state) {
  const job = vaultPersistQueue.then(() => writePrivateVault(state));
  // 失败不能卡住后面的保存；调用方仍然能从返回的 promise 上看到这次错误。
  vaultPersistQueue = job.then(() => {}, () => {});
  return job;
}

async function writePrivateVault(state) {
  if (!privateVaultUnlocked()) throw new Error('私密空间已经锁定');
  // 保持已交给视图层的 content 对象身份稳定。批量导入会在异步保存之间继续
  // 使用同一个引用；条目本身也不能换成新对象，否则播放器拿着的旧引用会写丢。
  const normalized = normalizeContent(content);
  content.folders = adoptNormalizedEntries(content.folders, normalized.folders);
  content.items = adoptNormalizedEntries(content.items, normalized.items);
  const encrypted = await encryptText(JSON.stringify(content), keyBytes);
  state.privateVault.payloadIv = encrypted.iv;
  state.privateVault.payload = encrypted.ciphertext;
  state.privateVault.assetRefs = [...new Set(content.items.flatMap(item => [item.assetRef, item.posterRef]).filter(Boolean))];
  state.privateVault.updatedAt = Date.now();
}

export async function lockPrivateVault() {
  if (keyBytes) keyBytes.fill(0);
  keyBytes = null;
  content = null;
  await clearVaultPreviewFiles();
}

function normalizeContent(input) {
  const folders = Array.isArray(input?.folders) ? input.folders.map(folder => ({
    id: String(folder?.id || ''),
    name: String(folder?.name || '').trim().slice(0, 40),
    createdAt: Number(folder?.createdAt) || Date.now(),
    updatedAt: Number(folder?.updatedAt) || Number(folder?.createdAt) || Date.now(),
    coverItemId: String(folder?.coverItemId || '')
  })).filter(folder => folder.id && folder.name).slice(0, 200) : [];
  const folderIds = new Set(folders.map(folder => folder.id));
  const items = Array.isArray(input?.items) ? input.items.map(item => ({
    id: String(item?.id || ''),
    folderId: folderIds.has(String(item?.folderId || '')) ? String(item.folderId) : '',
    type: item?.type === 'video' ? 'video' : 'photo',
    name: String(item?.name || '').trim().slice(0, 120),
    mime: String(item?.mime || '').trim().slice(0, 100),
    size: Math.max(0, Number(item?.size) || 0),
    assetRef: String(item?.assetRef || ''),
    assetIv: String(item?.assetIv || ''),
    posterRef: String(item?.posterRef || ''),
    posterIv: String(item?.posterIv || ''),
    sourceType: item?.sourceType === 'hls' ? 'hls' : '',
    remoteUrl: item?.sourceType === 'hls' ? String(item?.remoteUrl || '').slice(0, 4096) : '',
    date: /^\d{4}-\d{2}-\d{2}$/.test(item?.date || '') ? item.date : '',
    note: String(item?.note || '').trim().slice(0, 300),
    coverTime: Math.max(0, Number(item?.coverTime) || 0),
    // 非破坏性剪辑（2026-10-10 新增）：只记"要播哪一段、要框哪一块"，不改原文件。
    // ⚠️ 必须在这个白名单里出现，否则 persistPrivateVault 一读一写就把它抹掉。
    trim: normalizeTrim(item),
    crop: normalizeCrop(item?.crop),
    position: Math.max(0, Math.floor(Number(item?.position) || 0)),
    duration: Math.max(0, Math.floor(Number(item?.duration) || 0)),
    width: Math.max(0, Math.floor(Number(item?.width) || 0)),
    height: Math.max(0, Math.floor(Number(item?.height) || 0)),
    contentLeft: Math.min(.45, Math.max(0, Number(item?.contentLeft) || 0)),
    contentRight: Math.min(.45, Math.max(0, Number(item?.contentRight) || 0)),
    contentAspect: Math.max(0, Number(item?.contentAspect) || 0),
    displayOrientation: item?.displayOrientation === 'portrait' ? 'portrait' : item?.displayOrientation === 'landscape' ? 'landscape' : '',
    displayAnalysisVersion: Math.max(0, Math.floor(Number(item?.displayAnalysisVersion) || 0)),
    sourceModule: item?.sourceModule === 'moments' ? 'moments' : '',
    sourceSnippetId: String(item?.sourceSnippetId || '').slice(0, 120),
    sourceVideoIndex: Math.max(0, Math.floor(Number(item?.sourceVideoIndex) || 0)),
    watchHistory: Array.isArray(item?.watchHistory) ? item.watchHistory.map(session => ({
      id: String(session?.id || ''),
      startedAt: Math.max(0, Number(session?.startedAt) || 0),
      endedAt: Math.max(0, Number(session?.endedAt) || 0),
      watchedSeconds: Math.max(0, Math.floor(Number(session?.watchedSeconds) || 0)),
      startPosition: Math.max(0, Math.floor(Number(session?.startPosition) || 0)),
      endPosition: Math.max(0, Math.floor(Number(session?.endPosition) || 0)),
      completion: Math.min(1, Math.max(0, Number(session?.completion) || 0))
    })).filter(session => session.id && session.startedAt && session.watchedSeconds >= 3).slice(-100) : [],
    createdAt: Number(item?.createdAt) || Date.now()
  })).filter(item => item.id && (item.sourceType === 'hls' ? /^https?:\/\//.test(item.remoteUrl) : /^mine-(?:vault-media|media|browser-media):\/\//.test(item.assetRef))).slice(0, 2000) : [];
  return { folders, items };
}

/** 剪辑后的实际可播放时长（秒）。
 *  ⚠️ 列表上的时长戳必须用它，不能直接用 item.duration ——
 *    否则一段 12 分钟的片子剪成 45 秒，列表上还写着 12:34，和实际播放对不上。 */
export function vaultPlayableDuration(item) {
  const full = Math.max(0, Math.floor(Number(item?.duration) || 0));
  const start = Math.max(0, Number(item?.trim?.start) || 0);
  const end = Math.max(0, Number(item?.trim?.end) || 0);
  if (!(end > start + .05)) return full;
  // 和全 App 一致按整秒算，但至少显示 1 秒（否则半秒的片段会被当成"还没读到"）
  return Math.max(1, Math.floor(end - start));
}

/** 这段视频是否被剪辑过（剪过时长 或 裁过画面），列表上据此标记。 */
export function vaultItemEdited(item) {
  return Boolean(normalizeTrim(item) || normalizeCrop(item?.crop));
}

/**
 * 「看到的画面」有多大（2026-10-10 新增）。
 * 裁过画面之后，文件尺寸和实际看到的画面尺寸就不是一回事了：一段 16:9 的视频
 * 框成竖长条，它在观感上已经是竖屏内容。所有"按画面比例做判断"的地方都走这里。
 */
export function vaultFrameSize(item) {
  return croppedFrame(item?.width, item?.height, item?.crop);
}

/**
 * 这条内容算竖屏还是横屏（列表的「竖屏 / 横屏」筛选与卡片样式都靠它）。
 *
 * ⚠️ 顺序不能颠倒：**裁过画面时先看取景框**。
 *    导入时那套「画面里有没有黑边」的分析结论（displayOrientation）在裁剪之后就作废了 ——
 *    用户亲手框出来的那块就是他要的画面的全部，再去套旧结论只会把方向判反，
 *    表现就是"我把横屏裁成了竖屏，它却还待在横屏分类里"。
 *
 * 尺寸完全拿不到时返回空串（**不归入任何方向**）—— 宁可筛不出来，也不要猜错了把内容归错类。
 */
export function vaultItemOrientation(item) {
  if (!item) return '';
  const frame = vaultFrameSize(item);
  if (item.crop) {
    if (!frame.width || !frame.height) return '';
    return frame.height > frame.width ? 'portrait' : 'landscape';
  }
  if (item.displayOrientation === 'portrait') return 'portrait';
  if (item.displayOrientation === 'landscape') return 'landscape';
  if (!frame.width || !frame.height) return '';
  return frame.height > frame.width ? 'portrait' : 'landscape';
}

/** 时长剪辑：合法（终点比起点至少多 0.05 秒）才记录，否则视为"整段"。 */
function normalizeTrim(item) {
  const start = Math.max(0, Number(item?.trim?.start) || 0);
  let end = Math.max(0, Number(item?.trim?.end) || 0);
  const duration = Math.max(0, Number(item?.duration) || 0);
  // ⚠️ item.duration 是"向下取整到整秒"的近似值（12.7 秒的片子存成 12）。
  //    这里把上限放宽 1 秒，否则用户真正拖到片尾选的 12.7 会被截成 12，白丢一截尾巴。
  if (duration) end = Math.min(end, duration + 1);
  if (!(end > start + .05)) return null;
  // 起点在片头、终点到片尾 —— 等于没剪，不留记录，免得列表上误显示"已剪辑"。
  if (duration && start <= .05 && end >= duration - .05) return null;
  return { start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 };
}

async function deriveBytes(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, material, 256);
  return new Uint8Array(bits);
}

async function aesKey(bytes, usage) {
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [usage]);
}

async function encryptText(text, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(bytes, 'encrypt'), encoder.encode(text));
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(cipher)) };
}

async function decryptText(ciphertext, iv, bytes) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, await aesKey(bytes, 'decrypt'), base64ToBytes(ciphertext));
  return decoder.decode(plain);
}

function validatePassword(password) {
  if (String(password || '').length < 6) throw new Error('私密密码至少需要 6 位');
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(base64) {
  const binary = atob(String(base64 || ''));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
