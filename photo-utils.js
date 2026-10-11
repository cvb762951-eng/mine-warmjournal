import { JOURNAL_PHOTO_MAX_BYTES, SUPPORTED_JOURNAL_PHOTO_TYPES, SNIPPET_PHOTO_MAX_BYTES, SNIPPET_PHOTO_MAX_SIDE, SNIPPET_PHOTO_QUALITY } from './core.js';
import { persistImageData, resolveMediaReference, saveMediaFile } from './media-store.js';
import { extractMotionVideoFromBlob } from './motion-photo.js';
import { captureDecodedVideoFrame } from './video-poster.js';

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

// 把用户选择的图片压缩到适合本机存储的尺寸/质量（返回 dataURL）。
// 供日记、随手拍、书影音封面、倒数日背景图、AI 看图等模块共用。
// 参数化：maxSide 最长边 / quality 质量 / maxBytes 上限；journal 用 1280/.78/480KB，随手拍用 1920/.9/2MB。
export async function compressPhoto(file, { maxSide = 1280, quality = .78, maxBytes = JOURNAL_PHOTO_MAX_BYTES } = {}) {
  const source = URL.createObjectURL(file);
  try {
    const image = await decodeImage(source);
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    let width = Math.max(1, Math.round(image.naturalWidth * scale));
    let height = Math.max(1, Math.round(image.naturalHeight * scale));
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

export const compressJournalPhoto = file => compressPhoto(file);

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
// 先从原文件切出动态视频，再让 Canvas 压缩静帧。
// 压缩会丢掉 JPEG 末尾的 MP4；切不出来时仍按普通照片保存，不让整批失败。
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
