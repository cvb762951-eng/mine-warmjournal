import { JOURNAL_PHOTO_KEEP_MAX_PIXELS, JOURNAL_PHOTO_KEEP_MAX_SIDE, JOURNAL_PHOTO_MAX_PIXELS, JOURNAL_PHOTO_MAX_SIDE, JOURNAL_PHOTO_MEMORY_BYTES, JOURNAL_PHOTO_QUALITY, SUPPORTED_JOURNAL_PHOTO_TYPES, SNIPPET_PHOTO_MAX_BYTES, SNIPPET_PHOTO_MAX_SIDE, SNIPPET_PHOTO_QUALITY } from './core.js';
import { persistImageData, resolveMediaReference, saveMediaFile } from './media-store.js';
import { extractMotionVideoFromBlob } from './motion-photo.js';
import { captureDecodedVideoFrame } from './video-poster.js';

// 账本小票、倒数日背景、AI 看图仍走紧凑图。日记导入不再使用这个上限。
const COMPACT_PHOTO_MAX_BYTES = 480 * 1024;

// 加载并解码一张图，偶发 decode 失败（Android WebView 大图常见）时重试一次。
async function decodeImage(source) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const image = new Image(); image.src = source; await image.decode();
      return image;
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error('这张照片无法读取，可能已损坏');
}

function positiveSize(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (width > 100000 || height > 100000) return null;
  return { width, height };
}

function ascii(bytes, offset, length) {
  let text = '';
  for (let index = 0; index < length; index += 1) text += String.fromCharCode(bytes[offset + index] || 0);
  return text;
}

function pngSize(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!bytes || bytes.length < 24 || signature.some((value, index) => bytes[index] !== value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return positiveSize(view.getUint32(16), view.getUint32(20));
}

function jpegSize(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    let marker = bytes[offset + 1];
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1;
      marker = bytes[offset + 1];
    }
    offset += 2;
    if (marker === 0xd8) continue;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) return null;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2) return null;
    const startOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (startOfFrame) {
      if (offset + 6 >= bytes.length) return null;
      return positiveSize((bytes[offset + 5] << 8) | bytes[offset + 6], (bytes[offset + 3] << 8) | bytes[offset + 4]);
    }
    offset += length;
  }
  return null;
}

function webpSize(bytes) {
  if (!bytes || bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X') {
    return positiveSize(
      1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
    );
  }
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    return positiveSize(bytes[26] | ((bytes[27] & 0x3f) << 8), bytes[28] | ((bytes[29] & 0x3f) << 8));
  }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const width = 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]);
    const height = 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | ((bytes[22] & 0xc0) >> 6));
    return positiveSize(width, height);
  }
  return null;
}

function imageKind(type = '', name = '') {
  const mime = String(type || '').toLowerCase();
  const filename = String(name || '').toLowerCase();
  if (mime === 'image/png' || filename.endsWith('.png')) return 'png';
  if (mime === 'image/jpeg' || filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'jpeg';
  if (mime === 'image/webp' || filename.endsWith('.webp')) return 'webp';
  return '';
}

export function rasterSizeFromBytes(bytes, type = '', name = '') {
  const kind = imageKind(type, name);
  if (kind === 'png') return pngSize(bytes);
  if (kind === 'jpeg') return jpegSize(bytes);
  if (kind === 'webp') return webpSize(bytes);
  return pngSize(bytes) || jpegSize(bytes) || webpSize(bytes);
}

// 只读文件头，避免为了知道宽高就把一张长图完整解码进内存。
export async function readRasterSize(file) {
  if (!file || typeof file.slice !== 'function') return null;
  try {
    const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
    return rasterSizeFromBytes(head, file.type, file.name);
  } catch { return null; }
}

export function fitPhotoSize(width, height, maxSide, maxPixels = Infinity) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const sideScale = Math.min(1, maxSide / Math.max(safeWidth, safeHeight));
  const pixels = safeWidth * safeHeight;
  const pixelScale = Number.isFinite(maxPixels) && maxPixels > 0 ? Math.min(1, Math.sqrt(maxPixels / pixels)) : 1;
  const scale = Math.min(1, sideScale, pixelScale);
  return {
    scale,
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale))
  };
}

export function journalPhotoTargetSize(width, height) {
  return fitPhotoSize(width, height, JOURNAL_PHOTO_MAX_SIDE, JOURNAL_PHOTO_MAX_PIXELS);
}

// keep：原图交给 media-store 外置。reencode：边长或体积已经会把内存顶满，只做一次高画质缩小。
export function journalPhotoImportPlan({ fileSize = 0, width = 0, height = 0 } = {}) {
  const known = width > 0 && height > 0;
  const pixels = known ? width * height : 0;
  const withinKeep = known
    && Math.max(width, height) <= JOURNAL_PHOTO_KEEP_MAX_SIDE
    && pixels <= JOURNAL_PHOTO_KEEP_MAX_PIXELS
    && Number(fileSize) <= JOURNAL_PHOTO_MEMORY_BYTES;
  if (withinKeep || (!known && Number(fileSize) <= JOURNAL_PHOTO_MEMORY_BYTES)) return { action: 'keep' };
  const fitted = known ? journalPhotoTargetSize(width, height) : null;
  return {
    action: 'reencode',
    maxSide: fitted ? Math.max(fitted.width, fitted.height) : JOURNAL_PHOTO_MAX_SIDE,
    maxPixels: JOURNAL_PHOTO_MAX_PIXELS,
    quality: JOURNAL_PHOTO_QUALITY
  };
}

function imageMime(file) {
  const type = String(file?.type || '').toLowerCase();
  if (type === 'image/png' || type === 'image/webp' || type === 'image/jpeg') return type;
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x2000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function fileToImageDataUrl(file) {
  const mime = imageMime(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.byteLength) throw new Error('这张照片无法读取，可能已损坏');
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

// 明显高过屏幕的静图才进入纵向滚动。普通竖拍继续在画面里完整居中。
export function isLongStillImage(width, height, frameWidth, frameHeight) {
  if (!(width > 0) || !(height > 0) || !(frameWidth > 0) || !(frameHeight > 0)) return false;
  const imageRatio = height / width;
  const frameRatio = frameHeight / frameWidth;
  return imageRatio >= Math.max(frameRatio * 1.2, 2.2);
}

export function measureLongStill(image, frameWidth, frameHeight) {
  if (!image || image.tagName !== 'IMG') return { long: false, baseHeight: 0 };
  const long = isLongStillImage(image.naturalWidth, image.naturalHeight, frameWidth, frameHeight);
  return { long, baseHeight: long ? frameWidth * (image.naturalHeight / image.naturalWidth) : 0 };
}

export function clampStillTransform({ longMode = false, baseHeight = 0, scale = 1, x = 0, y = 0, width = 0, height = 0, maxScale = 5 } = {}) {
  let nextScale = scale;
  let nextX = x;
  let nextY = y;
  if (longMode && baseHeight > 0) {
    nextScale = Math.max(1, Math.min(maxScale, nextScale));
    const limitX = width * (nextScale - 1) / 2;
    nextX = Math.max(-limitX, Math.min(limitX, nextX));
    const minY = Math.min(0, height - baseHeight * nextScale);
    nextY = Math.max(minY, Math.min(0, nextY));
  } else if (nextScale <= 1) {
    nextScale = 1;
    nextX = 0;
    nextY = 0;
  } else {
    nextScale = Math.min(maxScale, nextScale);
    nextX = Math.max(-width * (nextScale - 1) / 2, Math.min(width * (nextScale - 1) / 2, nextX));
    nextY = Math.max(-height * (nextScale - 1) / 2, Math.min(height * (nextScale - 1) / 2, nextY));
  }
  return { scale: nextScale, x: nextX, y: nextY };
}

// 把用户选择的图片压缩到适合本机存储的尺寸/质量（返回 dataURL）。
// 随手拍、书影音封面、倒数日背景图、AI 看图仍可传入自己的上限。
// 日记导入走 compressJournalPhoto：默认保留原图，只有内存吃紧才缩小。
export async function compressPhoto(file, { maxSide = 1280, quality = .78, maxBytes = COMPACT_PHOTO_MAX_BYTES, maxPixels = Infinity } = {}) {
  const source = URL.createObjectURL(file);
  try {
    const image = await decodeImage(source);
    const fitted = fitPhotoSize(image.naturalWidth, image.naturalHeight, maxSide, maxPixels);
    const canvas = document.createElement('canvas');
    let width = fitted.width;
    let height = fitted.height;
    let currentQuality = quality;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#f7f7f7'; context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      const result = canvas.toDataURL('image/jpeg', currentQuality);
      if (dataUrlBytes(result) <= maxBytes) return result;
      if (currentQuality > .5) currentQuality = Math.max(.5, currentQuality - .08);
      else {
        width = Math.max(1, Math.round(width * .82));
        height = Math.max(1, Math.round(height * .82));
        currentQuality = .7;
      }
    }
    throw new Error('这张照片压缩后仍然过大，请换一张再试');
  } finally { URL.revokeObjectURL(source); }
}

// 日记照片：能留原图就留原图，经 importPhotoBatch → persistImageData 外置。
// 实况短视频仍由 importPhotoBatch 从原文件提取，不依赖这里的静帧编码。
export async function compressJournalPhoto(file) {
  const size = await readRasterSize(file);
  const plan = journalPhotoImportPlan({ fileSize: Number(file?.size) || 0, width: size?.width || 0, height: size?.height || 0 });
  if (plan.action === 'keep') return fileToImageDataUrl(file);
  return compressPhoto(file, { maxSide: plan.maxSide, maxPixels: plan.maxPixels, quality: plan.quality, maxBytes: Number.POSITIVE_INFINITY });
}

// 随手拍高清晰度压缩（最长边 1920 / 质量 .9 / 上限 2MB）。
export function compressSnippetPhoto(file) {
  return compressPhoto(file, { maxSide: SNIPPET_PHOTO_MAX_SIDE, quality: SNIPPET_PHOTO_QUALITY, maxBytes: SNIPPET_PHOTO_MAX_BYTES });
}

// 小并发批处理：一次可选很多照片，但不会让解码、Canvas 和内存峰值同时堆积。
//
// 稳定性设计（2026-10-09 真机踩坑后重写）：
// · 进度用独立计数器，只增不减 —— 旧实现上报的是「序号+1」，
//   两张并发时后完成的反而把进度拉回去，进度条来回跳，用户看着就像卡死。
// · 每张单独 try/catch，一张失败绝不打断其他张 —— 旧实现里 Promise.all
//   会在第一张失败时立刻 reject，但剩下的 worker 还在后台继续压缩落盘，
//   用户重试时两批并发，内存峰值直接翻倍。现在 worker 永不 reject，
//   失败项通过 onItemError 上报，全部跑完才返回。
// · 未传 onItemError 的调用方保持旧语义：有失败则抛出第一条错误。
// 先保存静帧，再从原文件切出动态视频。
// 日记能留原图就留原图；一旦走 Canvas 重编码，JPEG 末尾的 MP4 会被丢掉。
// 切不出来时仍按普通照片保存，不让整批失败。
async function saveExtractedMotion(blob) {
  const motion = await extractMotionVideoFromBlob(blob);
  if (!motion) return '';
  return saveMediaFile(new File([motion.bytes], motion.name, { type: motion.mime }));
}

// 从已经落入本机的原件里再切一次。相册选择器有时会给网页一份去掉视频的 JPEG，
// 而原生复制保留的是完整文件。
export async function saveMotionFromMediaRef(ref) {
  try {
    const source = await resolveMediaReference(ref);
    if (!source) return '';
    const response = await fetch(source);
    if (!response.ok) return '';
    return await saveExtractedMotion(await response.blob());
  } catch { return ''; }
}

async function keepLiveMotion(file, still, onLivePhoto) {
  if (!onLivePhoto) return;
  try {
    const video = await saveExtractedMotion(file);
    if (video) await onLivePhoto(still, video);
  } catch { /* 静帧已经落盘 */ }
}

export async function importPhotoBatch(files, compressor, { concurrency = 2, onProgress, onItemError, onLivePhoto } = {}) {
  const queue = [...files];
  const results = new Array(queue.length);
  let next = 0;
  let done = 0;
  const errors = [];
  const worker = async () => {
    while (next < queue.length) {
      const index = next++;
      try {
        const compressed = await compressor(queue[index]);
        results[index] = await persistImageData(compressed);
        await keepLiveMotion(queue[index], results[index], onLivePhoto);
      } catch (error) {
        if (onItemError) onItemError(queue[index], error);
        else errors.push(error);
      }
      done += 1;
      onProgress?.(done, queue.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  if (!onItemError && errors.length) throw errors[0];
  return onItemError ? results.filter(Boolean) : results;
}

// 视频首帧 → 主图 dataURL（供随手拍视频项 poster 使用）。
export const captureVideoFrame = (fileOrSource, options = {}) => captureDecodedVideoFrame(fileOrSource, {
  maxSide: SNIPPET_PHOTO_MAX_SIDE,
  quality: SNIPPET_PHOTO_QUALITY,
  ...options
});

export function isSupportedJournalPhoto(file) {
  return file.type ? SUPPORTED_JOURNAL_PHOTO_TYPES.has(file.type) : /\.(jpe?g|png|webp)$/i.test(file.name || '');
}

export function dataUrlBytes(dataUrl) {
  const body = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.ceil(body.length * .75);
}
