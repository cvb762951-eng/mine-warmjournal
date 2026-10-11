import Hls from 'hls.js';
import { mediaSource } from './media-store.js';

export function normalizeHlsAddress(value, { allowDynamicPath = false } = {}) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (url.username || url.password) return '';
    if (!allowDynamicPath && !/\.m3u8$/i.test(url.pathname)) return '';
    return url.href;
  } catch {
    return '';
  }
}

export function isHlsAddress(value) {
  return Boolean(normalizeHlsAddress(value));
}

export function formatVideoDuration(seconds, fallback = '') {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!safe) return fallback;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const tail = String(safe % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${tail}` : `${minutes}:${tail}`;
}

export function attachVideoSource(video, source, {
  sourceType = '',
  position = 0,
  trim = null,
  onProgress,
  onError,
  onReady,
  onEnded
} = {}) {
  if (!video) throw new Error('播放器没有准备好');
  const resolved = mediaSource(source);
  if (!resolved) throw new Error('视频文件不存在或尚未恢复');
  let hls = null;
  let destroyed = false;
  let lastProgressSecond = -1;
  let loopFrame = 0;

  // 时长裁剪：只在 [start, end] 内播放，到终点回到起点。
  // ⚠️ 用 rAF 而不是只靠 timeupdate —— timeupdate 约 250ms 才来一次，
  //    1 倍速下会冲出终点将近 0.25 秒，观感上"多放了一小截"。
  const trimStart = Math.max(0, Number(trim?.start) || 0);
  const trimEndRaw = Math.max(0, Number(trim?.end) || 0);
  const trimmed = trimEndRaw > trimStart + .05;
  const boundPosition = () => {
    let next = Math.max(0, Number(position) || 0);
    if (trimmed) {
      next = Math.min(Math.max(next, trimStart), Math.max(trimStart, trimEndRaw - .2));
      if (next < trimStart) next = trimStart;
    }
    return next;
  };
  const rewindToStart = () => { try { video.currentTime = trimStart; } catch { /* 部分流媒体不允许定位 */ } };
  const enforceTrim = () => {
    loopFrame = 0;
    if (destroyed || !trimmed) return;
    if (!video.paused && video.currentTime >= trimEndRaw - .02) rewindToStart();
    if (!video.paused) loopFrame = requestAnimationFrame(enforceTrim);
  };
  const startTrimLoop = () => { if (trimmed && !loopFrame) loopFrame = requestAnimationFrame(enforceTrim); };
  const stopTrimLoop = () => { if (loopFrame) { cancelAnimationFrame(loopFrame); loopFrame = 0; } };
  video.addEventListener('play', startTrimLoop);
  video.addEventListener('pause', stopTrimLoop);

  const restorePosition = () => {
    const next = boundPosition();
    if (Number.isFinite(video.duration)) {
      if (trimmed) {
        // 有剪辑区间时无条件先定位进区间。原来那条"离片尾不足 2 秒就不定位"的保护，
        // 在短片/剪短过的片子上会直接把画面留在 0 秒 —— 用户剪掉的开头又原样放了一遍。
        try { video.currentTime = next; } catch { /* 部分流媒体不允许定位 */ }
      } else if (next > 0 && next < video.duration - 2) {
        try { video.currentTime = next; } catch {}
      }
    }
    onReady?.({
      duration: Number(video.duration) || 0,
      width: Number(video.videoWidth) || 0,
      height: Number(video.videoHeight) || 0,
      landscape: Number(video.videoWidth) > Number(video.videoHeight)
    });
  };
  const reportError = message => {
    if (!destroyed) onError?.(message);
  };
  const timeUpdate = () => {
    const second = Math.max(0, Math.floor(Number(video.currentTime) || 0));
    if (second === lastProgressSecond) return;
    lastProgressSecond = second;
    onProgress?.({ position: second, duration: Number(video.duration) || 0 });
  };
  const ended = () => {
    // 有剪辑区间时，整段播完不算"播完"——回到剪辑起点继续循环。
    if (trimmed) {
      rewindToStart();
      const replay = video.play();
      if (replay?.catch) replay.catch(() => { /* 自动播放被拦截时保持暂停态 */ });
      return;
    }
    onEnded?.();
  };
  video.addEventListener('loadedmetadata', restorePosition, { once: true });
  video.addEventListener('timeupdate', timeUpdate);
  video.addEventListener('ended', ended);
  video.addEventListener('error', () => reportError('视频文件无法解码，可能是格式不受设备支持'), { once: true });

  if (sourceType === 'hls' || isHlsAddress(source)) {
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = source;
    } else if (Hls.isSupported()) {
      let networkRecoveries = 0;
      let mediaRecoveries = 0;
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        manifestLoadingMaxRetry: 3,
        levelLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 800,
        fragLoadingRetryDelay: 800
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRecoveries < 3) {
          networkRecoveries += 1;
          hls?.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 1) {
          mediaRecoveries += 1;
          hls?.recoverMediaError();
          return;
        }
        const message = data.type === Hls.ErrorTypes.NETWORK_ERROR
          ? '无法读取 m3u8 地址，请检查网络、链接有效期或跨域权限'
          : data.type === Hls.ErrorTypes.MEDIA_ERROR
            ? 'HLS 视频流无法解码，可能是编码格式不受支持'
            : 'HLS 播放失败';
        reportError(message);
        hls?.destroy();
        hls = null;
      });
      hls.loadSource(source);
      hls.attachMedia(video);
    } else {
      reportError('当前设备不支持 HLS/m3u8 播放');
    }
  } else {
    video.src = resolved;
  }

  return {
    setRate(rate) {
      const next = Math.min(2, Math.max(.5, Number(rate) || 1));
      video.playbackRate = next;
      return next;
    },
    play() { return video.play(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopTrimLoop();
      video.removeEventListener('play', startTrimLoop);
      video.removeEventListener('pause', stopTrimLoop);
      video.removeEventListener('timeupdate', timeUpdate);
      video.removeEventListener('ended', ended);
      hls?.destroy();
      hls = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  };
}
