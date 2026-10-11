import { $, esc, modal, closeModal, show } from './core.js';
import { clampCrop, clearVideoCrop, applyVideoCrop } from './video-crop.js';

/* 在真实视频时间轴上选择当前帧；不会改动原视频，只返回 JPEG 封面。
 *
 * 2026-10-10 补：视频被「剪短 / 裁画面」之后，选封面必须站在**裁剪后的视角**上。
 *   此前这里拿的是原始文件：预览放的是没裁过的整幅画面、时间轴能拖到已经剪掉的那一段、
 *   抓出来的封面也是没裁过的 —— 用户选了半天，回到列表却是另一张图。
 *   现在 crop/range 一并传进来：
 *     · 预览按取景框裁好后显示（和播放器同一套换算，见 video-crop.js）；
 *     · 时间轴只在「现在真正会播的那一段」里走动；
 *     · 抓帧只抓取景框内那块，产出与自动重抓的封面同一种构图。
 */
export function showVideoFramePicker(source, {
  title = '从视频选择封面', initialTime = 0, crop = null, range = null, onApply
} = {}) {
  if (!source) throw new Error('视频文件不存在');
  const framed = clampCrop(crop || { x: 0, y: 0, w: 1, h: 1 });
  const hasCrop = Boolean(crop);
  modal(`<div class="video-frame-picker"><span class="eyebrow">VIDEO COVER FRAME</span><h2>${esc(title)}</h2><p class="subtle" id="video-frame-subtle">拖动时间滑杆找到想要的画面，再保存当前帧。</p><div class="video-frame-stage"><video id="video-frame-source" src="${esc(source)}" muted playsinline preload="auto"></video><span id="video-frame-time">正在读取视频…</span></div><label class="video-frame-timeline"><span id="video-frame-floor">0:00</span><input id="video-frame-range" type="range" min="0" max="1" step="0.01" value="0" disabled aria-label="选择视频时间"><span id="video-frame-duration">0:00</span></label><div class="video-frame-actions"><button type="button" id="video-frame-preview"><span class="material-symbols-outlined">play_arrow</span>预览</button><button type="button" id="video-frame-center"><span class="material-symbols-outlined">center_focus_strong</span>推荐画面</button></div><div class="modal-actions"><button type="button" id="video-frame-cancel">取消</button><button type="button" class="save" id="video-frame-apply" disabled>使用当前画面</button></div></div>`, 'video-frame-picker-modal');
  const video = $('#video-frame-source');
  const rangeInput = $('#video-frame-range');
  const label = $('#video-frame-time');
  const floorLabel = $('#video-frame-floor');
  const durationLabel = $('#video-frame-duration');
  const apply = $('#video-frame-apply');
  const cleanup = () => { video.pause(); clearVideoCrop(video); video.removeAttribute('src'); video.load(); };

  /* 保留区间：没剪过就是整段；剪过就只在这段里选。 */
  const keptWindow = () => {
    const total = Math.max(0, Number(video.duration) || 0);
    const start = Math.max(0, Math.min(total, Number(range?.start) || 0));
    const end = Math.min(total, Math.max(start + .05, Number(range?.end) || total));
    return { start, end: end > start ? end : total, total };
  };

  const paintCrop = () => {
    if (hasCrop) applyVideoCrop(video, framed);
    else clearVideoCrop(video);
  };

  const seek = second => {
    const { start, end } = keptWindow();
    const target = Math.max(start, Math.min(end, Number(second) || 0));
    video.currentTime = target;
    rangeInput.value = String(target);
    label.textContent = formatVideoTime(target);
  };
  video.onloadedmetadata = () => {
    const { start, end } = keptWindow();
    if (!end) return show('无法读取视频时长');
    rangeInput.min = String(start);
    rangeInput.max = String(Math.max(start + .01, end));
    rangeInput.disabled = false;
    apply.disabled = false;
    floorLabel.textContent = formatVideoTime(start);
    durationLabel.textContent = formatVideoTime(end);
    const subtle = $('#video-frame-subtle');
    if (subtle && (hasCrop || start > 0)) {
      const span = Math.max(.1, end - start);
      subtle.textContent = `只在这段保留的画面里选（共 ${formatVideoTime(span, '0:00')}）。`;
    }
    // 裁剪过的画面要按取景框显示：等这一帧的布局稳定后再套，否则算出来的容器尺寸是 0。
    requestAnimationFrame(() => { paintCrop(); });
    const { start: s, end: e } = keptWindow();
    const preferred = initialTime > 0 && initialTime >= s && initialTime <= e
      ? initialTime
      : s + Math.max(.1, (e - s) * .2);
    seek(preferred);
  };
  video.onerror = () => { label.textContent = '无法解码这个视频'; apply.disabled = true; };
  video.ontimeupdate = () => { label.textContent = formatVideoTime(video.currentTime); rangeInput.value = String(video.currentTime); };
  rangeInput.oninput = event => { video.pause(); seek(event.target.value); };
  $('#video-frame-preview').onclick = () => video.paused ? video.play().catch(() => show('无法预览视频')) : video.pause();
  $('#video-frame-center').onclick = () => { video.pause(); const { start, end } = keptWindow(); seek(start + Math.max(.1, (end - start) * .2)); };
  $('#video-frame-cancel').onclick = () => { cleanup(); closeModal(); };
  apply.onclick = async () => {
    try {
      apply.disabled = true;
      const poster = captureCurrentFrame(video, hasCrop ? framed : null);
      const selectedTime = Number(video.currentTime) || Number(rangeInput.value) || 0;
      cleanup();
      closeModal();
      await onApply?.(poster, selectedTime);
    } catch (error) { apply.disabled = false; show(error.message || '无法保存当前帧'); }
  };

  // 转屏 / 键盘弹出时画面尺寸会变，裁剪样式必须跟着重算，否则构图会歪。
  const onResize = () => paintCrop();
  window.addEventListener('resize', onResize);
  const cancelObserver = new MutationObserver(() => {
    if (!document.querySelector('.video-frame-picker')) { window.removeEventListener('resize', onResize); cancelObserver.disconnect(); }
  });
  cancelObserver.observe($('#modal-layer'), { childList: true });
}

function captureCurrentFrame(video, crop) {
  if (!video.videoWidth || !video.videoHeight) throw new Error('当前画面尚未准备好');
  const rect = crop ? clampCrop(crop) : { x: 0, y: 0, w: 1, h: 1 };
  const sourceWidth = Math.max(1, rect.w * video.videoWidth);
  const sourceHeight = Math.max(1, rect.h * video.videoHeight);
  const scale = Math.min(1, 1200 / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  // ⚠️ 只画取景框那一块。整幅 drawImage 会把裁掉的边缘又带回来 ——
  //    自动重抓封面走的是 captureVideoCropFrame，两边构图必须一致。
  canvas.getContext('2d').drawImage(
    video,
    rect.x * video.videoWidth, rect.y * video.videoHeight, sourceWidth, sourceHeight,
    0, 0, canvas.width, canvas.height
  );
  return canvas.toDataURL('image/jpeg', .9);
}

function formatVideoTime(seconds, fallback = '0:00') {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!Number.isFinite(Number(seconds))) return fallback;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
