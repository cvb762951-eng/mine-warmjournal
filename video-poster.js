// 从多个已解码时间点中选择第一张非纯黑画面，作为本地视频封面。
import { clampCrop } from './video-crop.js';

/**
 * 抓封面时要试的时间点：片头一点点、以及区间内 8% / 20% / 45% / 72% 处各采一帧，
 * 再从中挑第一张"不是近乎空白"的当封面。
 *
 * ⚠️ 千万别改成默认抓第 0 秒 —— 大量视频开头是黑场或淡入，抓出来就是一张空白封面。
 *    传入 range（剪辑区间）时只在"这段视频现在真正会播的范围"里取帧，
 *    免得封面取自用户已经剪掉的那一段。
 */
export function posterFrameTimes(duration, range = null) {
  const total = Math.max(.1, Number(duration) || .1);
  const start = Math.max(0, Number(range?.start) || 0);
  const end = Math.min(total, Math.max(start, Number(range?.end) || total));
  const span = Math.max(.1, end - start);
  return [...new Set([.12, span * .08, span * .2, span * .45, span * .72]
    .map(value => Math.max(0, Math.min(total - .05, start + value))))];
}

export async function readVideoMetadata(fileOrSource, { timeoutMs = 15000, analyzeContent = false } = {}) {
  const ownsSource = fileOrSource instanceof Blob;
  const source = ownsSource ? URL.createObjectURL(fileOrSource) : String(fileOrSource || '');
  if (!source) throw new Error('没有可读取的视频来源');
  let video = null;
  let canvas = null;
  try {
    video = document.createElement('video');
    video.src = source;
    video.muted = true;
    video.playsInline = true;
    video.preload = analyzeContent ? 'auto' : 'metadata';
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('视频信息读取超时')), timeoutMs);
      video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
      video.onerror = () => { clearTimeout(timer); reject(new Error('无法读取视频信息')); };
      video.load();
    });
    const metadata = {
      duration: Math.max(0, Math.floor(Number(video.duration) || 0)),
      width: Number(video.videoWidth) || 0,
      height: Number(video.videoHeight) || 0,
      displayOrientation: Number(video.videoWidth) > Number(video.videoHeight) ? 'landscape' : 'portrait',
      displayAnalysisVersion: 2
    };
    if (analyzeContent && metadata.width && metadata.height) {
      const duration = Math.max(.1, Number(video.duration) || .1);
      const scale = Math.min(1, 360 / Math.max(metadata.width, metadata.height));
      canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(metadata.width * scale));
      canvas.height = Math.max(1, Math.round(metadata.height * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const displays = [];
      for (const fraction of [.2, .45, .72]) {
        await seekVideoFrame(video, Math.min(Math.max(.12, duration * fraction), Math.max(.12, duration - .05)));
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        displays.push(detectPillarboxFromImageData(context.getImageData(0, 0, canvas.width, canvas.height), canvas.width, canvas.height));
      }
      Object.assign(metadata, selectPillarboxConsensus(displays));
    }
    return metadata;
  } finally {
    releaseVideoElement(video);
    releaseCanvas(canvas);
    if (ownsSource) URL.revokeObjectURL(source);
  }
}

export async function captureDecodedVideoFrame(fileOrSource, { maxSide = 1920, quality = .9, onMetadata } = {}) {
  const ownsSource = fileOrSource instanceof Blob;
  const source = ownsSource ? URL.createObjectURL(fileOrSource) : String(fileOrSource || '');
  if (!source) throw new Error('没有可读取的视频来源');
  let video = null;
  let canvas = null;
  try {
    video = document.createElement('video');
    video.src = source;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('视频读取超时或编码不受支持')), 20000);
      video.oncanplay = () => { clearTimeout(timer); resolve(); };
      video.onerror = () => { clearTimeout(timer); reject(new Error('无法读取视频')); };
      video.load();
    });
    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) throw new Error('视频没有可用画面或编码不受支持');
    const metadata = {
      duration: Math.max(0, Math.floor(Number(video.duration) || 0)),
      width: Number(video.videoWidth) || 0,
      height: Number(video.videoHeight) || 0,
      displayOrientation: Number(video.videoWidth) > Number(video.videoHeight) ? 'landscape' : 'portrait',
      displayAnalysisVersion: 2
    };
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const duration = Math.max(.1, Number(video.duration) || .1);
    const candidates = posterFrameTimes(duration);
    let fallback = '';
    let selectedPoster = '';
    const displays = [];
    for (const second of candidates) {
      await seekVideoFrame(video, second);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const result = canvas.toDataURL('image/jpeg', quality);
      fallback ||= result;
      const display = detectPillarboxFromImageData(context.getImageData(0, 0, canvas.width, canvas.height), canvas.width, canvas.height);
      displays.push(display);
      if (!selectedPoster && !isNearlyBlankFrame(context, canvas.width, canvas.height)) selectedPoster = result;
    }
    onMetadata?.({ ...metadata, ...selectPillarboxConsensus(displays) });
    return selectedPoster || fallback;
  } finally {
    releaseVideoElement(video);
    releaseCanvas(canvas);
    if (ownsSource) URL.revokeObjectURL(source);
  }
}

/**
 * 按取景框抓一帧（2026-10-10 新增）。
 * 画面裁剪之后封面要跟着变，否则列表里还是原来那张"没裁过"的图。
 * 只画取景框内那块，输出就是裁好的封面。
 *
 * ⚠️ 没给 time 的时候**不能默认抓第 0 秒**。第一版就是那么写的，结果用户一裁画面，
 *    辛苦挑好的封面被换成片头那张空白淡入帧（大量视频开头是黑场/淡入）。
 *    这里改为沿用导入时同一套策略：采几个时间点，挑第一张"不是近乎空白"的；
 *    而且因为画布只画取景框那块，"空不空白"是按裁完之后的画面判断的，更准。
 */
export async function captureVideoCropFrame(fileOrSource, { time = null, crop = null, range = null, maxSide = 720, quality = .86 } = {}) {
  const ownsSource = fileOrSource instanceof Blob;
  const source = ownsSource ? URL.createObjectURL(fileOrSource) : String(fileOrSource || '');
  if (!source) throw new Error('没有可读取的视频来源');
  let video = null;
  let canvas = null;
  try {
    video = document.createElement('video');
    video.src = source;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('视频读取超时或编码不受支持')), 20000);
      video.oncanplay = () => { clearTimeout(timer); resolve(); };
      video.onerror = () => { clearTimeout(timer); reject(new Error('无法读取视频')); };
      video.load();
    });
    const videoWidth = Number(video.videoWidth) || 0;
    const videoHeight = Number(video.videoHeight) || 0;
    if (!videoWidth || !videoHeight) throw new Error('视频没有可用画面或编码不受支持');
    const rect = crop ? clampCrop(crop) : { x: 0, y: 0, w: 1, h: 1 };
    const duration = Math.max(0, Number(video.duration) || 0);
    const sourceX = rect.x * videoWidth;
    const sourceY = rect.y * videoHeight;
    const sourceWidth = Math.max(1, rect.w * videoWidth);
    const sourceHeight = Math.max(1, rect.h * videoHeight);
    const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    // 用户明确指定了时间点（自己选过封面）就照办；否则沿用"挑一张有内容的"策略。
    const wanted = Number(time);
    const seconds = Number.isFinite(wanted) && wanted > 0 ? [wanted] : posterFrameTimes(duration, range);
    let fallback = '';
    let selected = '';
    for (const second of seconds) {
      await seekVideoFrame(video, Math.max(0, Math.min(Math.max(0, duration - .05), second)));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
      const result = canvas.toDataURL('image/jpeg', quality);
      fallback ||= result;
      if (!isNearlyBlankFrame(context, canvas.width, canvas.height)) { selected = result; break; }
    }
    return selected || fallback;
  } finally {
    releaseVideoElement(video);
    releaseCanvas(canvas);
    if (ownsSource) URL.revokeObjectURL(source);
  }
}

function releaseVideoElement(video) {
  if (!video) return;
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch {}
}

function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
}

export function detectPillarboxFromImageData(imageData, width, height) {
  const data = imageData?.data || imageData;
  if (!data || width < 40 || height < 40 || data.length < width * height * 4) return {};
  const rowStep = Math.max(1, Math.floor(height / 180));
  const darkColumns = new Uint8Array(width);
  const columnLight = new Float64Array(width);
  for (let x = 0; x < width; x += 1) {
    let dark = 0;
    let total = 0;
    let lightTotal = 0;
    for (let y = Math.floor(height * .14); y < height * .94; y += rowStep) {
      const offset = (Math.floor(y) * width + x) * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      const light = (red + green + blue) / 3;
      if (maximum <= 42 && maximum - minimum <= 18) dark += 1;
      lightTotal += light;
      total += 1;
    }
    darkColumns[x] = total && dark / total >= .8 ? 1 : 0;
    columnLight[x] = total ? lightTotal / total : 0;
  }
  let left = 0;
  while (left < width && darkColumns[left]) left += 1;
  let right = 0;
  while (right < width - left && darkColumns[width - 1 - right]) right += 1;
  const leftRatio = left / width;
  const rightRatio = right / width;
  const contentWidth = 1 - leftRatio - rightRatio;
  if (leftRatio < .14 || rightRatio < .14 || Math.abs(leftRatio - rightRatio) > .08 || contentWidth < .18) return {};
  const contentAspect = contentWidth * width / height;
  if (contentAspect > 1.08) return {};
  const edgeLight = (average(columnLight, 0, left) + average(columnLight, width - right, width)) / 2;
  const centerLight = average(columnLight, left, width - right);
  if (centerLight < edgeLight + 12) return {};
  return {
    contentLeft: Number(leftRatio.toFixed(4)),
    contentRight: Number(rightRatio.toFixed(4)),
    contentAspect: Number(contentAspect.toFixed(4)),
    displayOrientation: 'portrait',
    displayAnalysisVersion: 2
  };
}

export function selectPillarboxConsensus(displays = []) {
  const detected = displays.filter(item => item?.displayOrientation === 'portrait' && item.contentAspect > 0);
  if (detected.length < 2) return {};
  const median = key => [...detected].sort((a, b) => a[key] - b[key])[Math.floor(detected.length / 2)][key];
  return {
    contentLeft: median('contentLeft'),
    contentRight: median('contentRight'),
    contentAspect: median('contentAspect'),
    displayOrientation: 'portrait',
    displayAnalysisVersion: 2
  };
}

export async function analyzeVideoElementContent(video, maxSide = 360) {
  if (!video?.videoWidth || !video?.videoHeight) return {};
  if (typeof video.requestVideoFrameCallback === 'function') {
    await new Promise(resolve => { const timer = setTimeout(resolve, 700); video.requestVideoFrameCallback(() => { clearTimeout(timer); resolve(); }); });
  } else {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return detectPillarboxFromImageData(context.getImageData(0, 0, canvas.width, canvas.height), canvas.width, canvas.height);
}

function average(values, start, end) {
  if (end <= start) return 0;
  let total = 0;
  for (let index = start; index < end; index += 1) total += values[index];
  return total / (end - start);
}

async function seekVideoFrame(video, second) {
  if (Math.abs((Number(video.currentTime) || 0) - second) > .03) {
    await new Promise(resolve => {
      const finish = () => { clearTimeout(timer); video.removeEventListener('seeked', finish); resolve(); };
      const timer = setTimeout(finish, 3500);
      video.addEventListener('seeked', finish, { once: true });
      try { video.currentTime = second; } catch { finish(); }
    });
  }
  if (typeof video.requestVideoFrameCallback === 'function') {
    await new Promise(resolve => { const timer = setTimeout(resolve, 700); video.requestVideoFrameCallback(() => { clearTimeout(timer); resolve(); }); });
  } else await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function isNearlyBlankFrame(context, width, height) {
  const sample = context.getImageData(0, 0, width, height).data;
  const step = Math.max(4, Math.floor(sample.length / 1200 / 4) * 4);
  let total = 0;
  let spread = 0;
  let count = 0;
  for (let index = 0; index < sample.length; index += step) {
    const light = (sample[index] + sample[index + 1] + sample[index + 2]) / 3;
    total += light;
    spread += Math.abs(sample[index] - sample[index + 1]) + Math.abs(sample[index + 1] - sample[index + 2]);
    count += 1;
  }
  return count > 0 && total / count < 10 && spread / count < 8;
}
