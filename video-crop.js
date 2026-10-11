/* 视频画面裁剪的纯计算（2026-10-10 新增）
 *
 * 取景框统一用「归一化矩形」表示：{ x, y, w, h }，取值 0~1，相对视频原始画幅。
 * 编辑器负责"user 拖动 → 归一化矩形"，播放器负责"归一化矩形 → 屏幕裁剪样式"，
 * 两边都从这里取公式 —— 唯一事实来源，避免"框出来的"和"播放时看到的"对不上。
 *
 * 播放时怎么把取景框铺满画面：先把视频裁到取景框，再等比放大到居中。
 * 用 clip-path 裁 + transform 放大，都是合成器属性，不触发布局，也不碰"绘制属性"。
 */

export const MIN_CROP = 0.08;

export const CROP_PRESETS = [
  { key: 'free', label: '自由', ratio: null },
  { key: 'original', label: '原始', ratio: 'original' },
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '9:16', label: '9:16', ratio: 9 / 16 },
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
  { key: '4:3', label: '4:3', ratio: 4 / 3 }
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round4 = value => Math.round((Number(value) || 0) * 10000) / 10000;
const px = value => `${Math.round((Number(value) || 0) * 100) / 100}px`;

/** 预设比例 → 目标「画面宽高比」；"自由"返回 null，"原始"回落到视频本身比例。 */
export function presetRatio(key, videoWidth = 1, videoHeight = 1) {
  const preset = CROP_PRESETS.find(entry => entry.key === key);
  if (!preset || preset.ratio === null) return null;
  if (preset.ratio === 'original') return (Number(videoWidth) || 1) / (Number(videoHeight) || 1);
  return preset.ratio;
}

/** 是否等于"整幅画面"（用于决定要不要真的记录一条裁剪）。 */
export function isFullFrame(crop, epsilon = 0.012) {
  if (!crop) return true;
  return Number(crop.x) <= epsilon
    && Number(crop.y) <= epsilon
    && Number(crop.w) >= 1 - epsilon
    && Number(crop.h) >= 1 - epsilon;
}

/** 把任意输入夹回合法取景框（最小 8%，且不越界）。 */
export function clampCrop(crop) {
  const w = round4(clamp(crop?.w ?? 1, MIN_CROP, 1));
  const h = round4(clamp(crop?.h ?? 1, MIN_CROP, 1));
  const x = round4(clamp(crop?.x ?? 0, 0, 1 - w));
  const y = round4(clamp(crop?.y ?? 0, 0, 1 - h));
  return { x, y, w, h };
}

/** 归一化：整幅画面返回 null（不记录裁剪），否则返回合法矩形。 */
export function normalizeCrop(crop) {
  if (!crop) return null;
  const next = clampCrop(crop);
  return isFullFrame(next) ? null : next;
}

/** 两个取景框是否实质相同（避免"没改也写一次"）。 */
export function sameCrop(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return ['x', 'y', 'w', 'h'].every(key => Math.abs(Number(a[key]) - Number(b[key])) < 0.002);
}

/**
 * 裁剪之后的「实际画面尺寸」（2026-10-10 新增）。
 *
 * 裁剪是非破坏性的：文件没变，变的只是"从这块画面里看出去"。
 * 所以凡是需要知道**看到的那块画面有多大**的地方 —— 竖屏/横屏归类、播放器控件排版 ——
 * 都必须经过这里换算；直接拿 videoWidth/videoHeight（文件原始尺寸）会得到裁之前的答案，
 * 表现就是"横屏裁成竖屏了，进度条还停在横屏的位置"。
 *
 * 注意算出的是**比例**才有意义：乘同一个系数不改变宽高比。
 */
export function croppedFrame(width, height, crop) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!w || !h) return { width: 0, height: 0 };
  const rect = normalizeCrop(crop);
  if (!rect) return { width: w, height: h };
  return { width: w * rect.w, height: h * rect.h };
}

/** 裁剪之后画面的方向：'portrait' / 'landscape' / ''（尺寸未知）。正方形归横屏。 */
export function frameOrientation(width, height, crop) {
  const frame = croppedFrame(width, height, crop);
  if (!frame.width || !frame.height) return '';
  return frame.height > frame.width ? 'portrait' : 'landscape';
}

/** contain 布局：视频画面在容器里等比缩放后的实际位置与尺寸。 */
export function containBox(containerWidth, containerHeight, videoWidth, videoHeight) {
  const cw = Number(containerWidth) || 0;
  const ch = Number(containerHeight) || 0;
  const vw = Number(videoWidth) || 0;
  const vh = Number(videoHeight) || 0;
  if (!cw || !ch || !vw || !vh) return null;
  const scale = Math.min(cw / vw, ch / vh);
  const width = vw * scale;
  const height = vh * scale;
  return { scale, width, height, left: (cw - width) / 2, top: (ch - height) / 2 };
}

/** 归一化取景框 → 容器内的像素矩形（编辑器画框用）。 */
export function cropRect(containerWidth, containerHeight, videoWidth, videoHeight, crop) {
  const box = containBox(containerWidth, containerHeight, videoWidth, videoHeight);
  if (!box) return null;
  const rect = clampCrop(crop || { x: 0, y: 0, w: 1, h: 1 });
  return {
    left: box.left + rect.x * box.width,
    top: box.top + rect.y * box.height,
    width: rect.w * box.width,
    height: rect.h * box.height,
    box
  };
}

/** 像素矩形 → 归一化取景框（编辑器拖动回写用）。 */
export function rectToCrop(left, top, width, height, containerWidth, containerHeight, videoWidth, videoHeight) {
  const box = containBox(containerWidth, containerHeight, videoWidth, videoHeight);
  if (!box) return null;
  return clampCrop({
    x: (left - box.left) / box.width,
    y: (top - box.top) / box.height,
    w: width / box.width,
    h: height / box.height
  });
}

/** 播放时用的裁剪样式：先裁到取景框，再等比放大到画面中央。整幅画面返回 null。 */
export function cropStyle(containerWidth, containerHeight, videoWidth, videoHeight, crop) {
  const rect = normalizeCrop(crop);
  if (!rect) return null;
  const framed = cropRect(containerWidth, containerHeight, videoWidth, videoHeight, rect);
  if (!framed) return null;
  const cw = Number(containerWidth) || 0;
  const ch = Number(containerHeight) || 0;
  const scale = Math.min(cw / framed.width, ch / framed.height);
  const targetLeft = (cw - framed.width * scale) / 2;
  const targetTop = (ch - framed.height * scale) / 2;
  return {
    clipPath: `inset(${px(framed.top)} ${px(cw - framed.left - framed.width)} ${px(ch - framed.top - framed.height)} ${px(framed.left)})`,
    transformOrigin: `${px(framed.left)} ${px(framed.top)}`,
    transform: `translate(${px(targetLeft - framed.left)}, ${px(targetTop - framed.top)}) scale(${round4(scale)})`
  };
}

/** 把裁剪应用到真实的 video 元素（按当前渲染尺寸计算，尺寸变了要重算）。 */
export function applyVideoCrop(video, crop) {
  if (!video) return false;
  const style = cropStyle(video.clientWidth, video.clientHeight, video.videoWidth, video.videoHeight, crop);
  if (!style) return clearVideoCrop(video);
  video.style.clipPath = style.clipPath;
  video.style.transformOrigin = style.transformOrigin;
  video.style.transform = style.transform;
  video.dataset.cropApplied = '1';
  return true;
}

export function clearVideoCrop(video) {
  if (!video) return;
  video.style.clipPath = '';
  video.style.transform = '';
  video.style.transformOrigin = '';
  delete video.dataset.cropApplied;
}

/** 以某个中心点为中心，生成一个指定「画面宽高比」的最大取景框（套用预设比例用）。
 *  ⚠️ targetAspect 是**输出画面的宽高比**（如 1:1 = 1），不是归一化方框的宽高比。
 *  归一化方框相对视频原始画幅，所以要先除以原始画幅比例换算。 */
export function fitPresetCrop(targetAspect, frameAspect, center = { x: 0.5, y: 0.5 }) {
  const output = Number(targetAspect);
  const frame = Number(frameAspect) || 1;
  if (!Number.isFinite(output) || output <= 0) return clampCrop({ x: 0, y: 0, w: 1, h: 1 });
  // 归一化宽高比 = 输出宽高比 / 原始画幅宽高比
  const normalizedRatio = output / frame;
  let w = 1;
  let h = w / normalizedRatio;
  if (h > 1) { h = 1; w = h * normalizedRatio; }
  const cx = clamp(center?.x ?? 0.5, 0, 1);
  const cy = clamp(center?.y ?? 0.5, 0, 1);
  return clampCrop({ x: cx - w / 2, y: cy - h / 2, w, h });
}
