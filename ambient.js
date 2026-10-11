// 环境音模块：播放真实录音素材（树叶/海浪/雨声/翻书），支持循环、音量、淡入淡出。

export const AMBIENT_SOUNDS = {
  none: { label: '关闭', icon: 'volume_off' },
  leaves: { label: '树叶沙沙', icon: 'forest', file: 'assets/sounds/leaves.mp3' },
  ocean: { label: '海浪', icon: 'waves', file: 'assets/sounds/ocean.mp3' },
  rain: { label: '雨声', icon: 'rainy', file: 'assets/sounds/rain.mp3' },
  library: { label: '图书馆', icon: 'local_library', file: 'assets/sounds/library.mp3' },
  cafe: { label: '咖啡馆', icon: 'local_cafe', file: 'assets/sounds/library.mp3' },
  forest: { label: '森林微风', icon: 'forest', file: 'assets/sounds/leaves.mp3' }
};

let context = null;
let masterGain = null;
let voiceGain = null;
let source = null;
let currentType = 'none';
let currentVolume = 0.5;
let loadingToken = 0;       // 防止异步加载竞态：旧加载结果作废
const bufferCache = new Map();
const mixTracks = new Map();
let mixPaused = false;

const clampVolume = value => Math.max(0, Math.min(1, Number(value) || 0));

function ensureContext() {
  if (!context) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    context = new AudioContextClass();
    masterGain = context.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(context.destination);
  }
  if (context.state === 'suspended') context.resume().catch(() => {});
  return context;
}

async function loadBuffer(ctx, url) {
  if (bufferCache.has(url)) return bufferCache.get(url);
  const response = await fetch(url);
  if (!response.ok) throw new Error('加载音频失败: ' + url);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  bufferCache.set(url, buffer);
  return buffer;
}

function rampTo(param, value, time) {
  if (!context) return;
  param.cancelScheduledValues(context.currentTime);
  param.setTargetAtTime(value, context.currentTime, time);
}

function teardownSource() {
  if (source) { try { source.stop(); source.disconnect(); } catch (e) {} source = null; }
  if (voiceGain) { try { voiceGain.disconnect(); } catch (e) {} voiceGain = null; }
}

function stopMixTrack(soundId) {
  const track = mixTracks.get(soundId);
  if (!track) return;
  track.token += 1;
  mixTracks.delete(soundId);
  if (track.gain && context) rampTo(track.gain.gain, 0.0001, 0.12);
  if (track.source && context) {
    try { track.source.stop(context.currentTime + 0.25); } catch (error) {}
    setTimeout(() => {
      try { track.source.disconnect(); } catch (error) {}
      track.nodes.forEach(node => { try { node.disconnect(); } catch (error) {} });
      try { track.gain.disconnect(); } catch (error) {}
    }, 300);
  }
}

function stopSingleForMix() {
  loadingToken += 1;
  currentType = 'none';
  stopCurrent();
}

function createFireSource(ctx, gain) {
  if (!ctx.createBuffer || !ctx.createBiquadFilter) return null;
  const seconds = 4;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let low = 0;
  for (let index = 0; index < data.length; index += 1) {
    const noise = Math.random() * 2 - 1;
    low = low * 0.985 + noise * 0.015;
    const crackle = Math.random() > 0.9975 ? (Math.random() * 2 - 1) * 0.22 : 0;
    data[index] = low * 0.28 + crackle;
  }
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  source.buffer = buffer;
  source.loop = true;
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  filter.Q.value = 0.35;
  source.connect(filter);
  filter.connect(gain);
  return { source, nodes: [filter] };
}

function startMixFileTrack(soundId, buffer, track) {
  const ctx = context;
  if (!ctx || mixTracks.get(soundId) !== track || !track.enabled) return;
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  source.buffer = buffer;
  source.loop = true;
  source.connect(gain);
  gain.connect(masterGain);
  track.source = source;
  track.gain = gain;
  track.nodes = [];
  source.start();
  rampTo(gain.gain, mixPaused ? 0.0001 : track.volume, 0.22);
}

function stopCurrent() {
  if (voiceGain && context && source) {
    rampTo(voiceGain.gain, 0.0001, 0.12);
    const oldSource = source;
    const oldGain = voiceGain;
    const stopAt = context.currentTime + 0.25;
    try { oldSource.stop(stopAt); } catch (e) {}
    setTimeout(() => { try { oldGain.disconnect(); } catch (e) {} }, 300);
  }
  teardownSource();
}

export function setAmbient(type, volume) {
  if (typeof volume === 'number') currentVolume = clampVolume(volume);
  stopAmbientMix();

  // 同类型且已在播放：只更新音量，避免重建造成断音
  if (type && type === currentType && source) {
    if (voiceGain) rampTo(voiceGain.gain, currentVolume, 0.05);
    return;
  }

  if (!type || type === 'none') {
    currentType = 'none';
    stopCurrent();
    if (context) context.suspend().catch(() => {});
    return;
  }

  const item = AMBIENT_SOUNDS[type];
  if (!item || !item.file) { currentType = 'none'; return; }

  const token = ++loadingToken;
  stopCurrent();
  currentType = type;
  const ctx = ensureContext();
  if (!ctx) return;

  loadBuffer(ctx, item.file).then(buffer => {
    if (token !== loadingToken || currentType !== type) return;
    teardownSource();
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    voiceGain = ctx.createGain();
    voiceGain.gain.value = 0.0001;
    source.connect(voiceGain);
    voiceGain.connect(masterGain);
    source.start();
    rampTo(voiceGain.gain, currentVolume, 0.4);
  }).catch(error => console.warn('环境音加载失败', error));
}

export function setAmbientVolume(volume) {
  currentVolume = clampVolume(volume);
  if (voiceGain && context) rampTo(voiceGain.gain, currentVolume, 0.05);
}

// ---- 三轨混音 API：rain 使用雨声、forest 使用 leaves.mp3、fire 使用程序化壁炉底噪 ----
export function setAmbientMixTrack(soundId, enabled, volume = 0.5) {
  if (!['rain', 'fire', 'forest'].includes(soundId)) return false;
  if (!enabled) { stopMixTrack(soundId); return true; }
  const ctx = ensureContext();
  if (!ctx || !masterGain) return false;
  stopSingleForMix();
  const existing = mixTracks.get(soundId);
  if (existing) {
    existing.enabled = true;
    existing.volume = clampVolume(volume);
    if (existing.gain) rampTo(existing.gain.gain, mixPaused ? 0.0001 : existing.volume, 0.05);
    return true;
  }
  const track = { enabled: true, volume: clampVolume(volume), token: 1, source: null, gain: null, nodes: [] };
  mixTracks.set(soundId, track);
  if (soundId === 'fire') {
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    const fire = createFireSource(ctx, gain);
    if (!fire) { mixTracks.delete(soundId); return false; }
    gain.connect(masterGain);
    track.source = fire.source;
    track.gain = gain;
    track.nodes = fire.nodes;
    fire.source.start();
    rampTo(gain.gain, mixPaused ? 0.0001 : track.volume, 0.24);
    return true;
  }
  const file = soundId === 'forest' ? AMBIENT_SOUNDS.forest.file : AMBIENT_SOUNDS.rain.file;
  const token = track.token;
  loadBuffer(ctx, file).then(buffer => {
    if (mixTracks.get(soundId) !== track || track.token !== token || !track.enabled) return;
    startMixFileTrack(soundId, buffer, track);
  }).catch(error => {
    if (mixTracks.get(soundId) === track) mixTracks.delete(soundId);
    console.warn('混音轨加载失败', soundId, error);
  });
  return true;
}

export function setAmbientMixVolume(soundId, volume) {
  const track = mixTracks.get(soundId);
  if (!track?.enabled) return false;
  track.volume = clampVolume(volume);
  if (track.gain) rampTo(track.gain.gain, mixPaused ? 0.0001 : track.volume, 0.05);
  return true;
}

export function currentAmbientMix() {
  return [...mixTracks.entries()]
    .filter(([, track]) => track.enabled && track.volume > 0)
    .map(([soundId, track]) => ({ soundId, volume: track.volume }));
}

export function pauseAmbientMix() {
  if (!currentAmbientMix().length) return;
  mixPaused = true;
  mixTracks.forEach(track => { if (track.gain) rampTo(track.gain.gain, 0.0001, 0.16); });
}

export function resumeAmbientMix() {
  if (!currentAmbientMix().length) return;
  if (!ensureContext()) return;
  mixPaused = false;
  mixTracks.forEach(track => { if (track.gain) rampTo(track.gain.gain, track.volume, 0.2); });
}

export function stopAmbientMix() {
  [...mixTracks.keys()].forEach(stopMixTrack);
  mixPaused = false;
}

export function stopAmbient() {
  if (voiceGain && context && source) {
    rampTo(voiceGain.gain, 0.0001, 0.12);
    const stopAt = context.currentTime + 0.25;
    try { source.stop(stopAt); } catch (e) {}
    setTimeout(() => { try { voiceGain.disconnect(); } catch (e) {} }, 300);
  }
  teardownSource();
  currentType = 'none';
  stopAmbientMix();
  if (context) context.suspend().catch(() => {});
}

export function currentAmbient() {
  return currentType;
}
