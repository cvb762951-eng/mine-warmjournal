/* 私密视频剪辑器（2026-10-10 新增）
 *
 * 一个全屏的、非破坏性的剪辑界面，两个标签页：
 *   剪时长 —— 时间轴双手柄，预览只在选中区间内播放/循环；
 *   裁画面 —— 自由框选任意比例的矩形，也可以一键套用常用比例。
 *
 * 设计原则：
 *   1. 只返回"归一化结果"（秒 + 0~1 矩形），不碰原文件；
 *   2. 同一套数值交给 video-crop.js 换算，播放时看到的就是框出来的；
 *   3. 所有手势都走 Pointer Events，并处理 pointercancel，避免卡在拖动中。
 */

import { $, $$, esc, modal, closeModal, show } from './core.js';
import { formatVideoDuration } from './video-player.js';
import { HABIT_HEAD_MAX_SECONDS, habitHeadLimit } from './model.js';
import {
  CROP_PRESETS, MIN_CROP, clampCrop, normalizeCrop, presetRatio, fitPresetCrop, containBox
} from './video-crop.js';

const HANDLES = [
  { key: 'nw', x: 0, y: 0 }, { key: 'n', x: .5, y: 0 }, { key: 'ne', x: 1, y: 0 },
  { key: 'e', x: 1, y: .5 }, { key: 'se', x: 1, y: 1 }, { key: 's', x: .5, y: 1 },
  { key: 'sw', x: 0, y: 1 }, { key: 'w', x: 0, y: .5 }
];

export function showVideoEditor({
  source, poster = '', duration = 0, width = 0, height = 0,
  name = '私密视频', trim = null, crop = null, trimHead = 0, onApply
} = {}) {
  if (!source) throw new Error('视频文件不存在');

  const hasTrim = Boolean(trim && Number(trim.end) > Number(trim.start) + .05);
  const savedCrop = normalizeCrop(crop);
  const state = {
    duration: Math.max(0, Number(duration) || 0),
    width: Math.max(0, Number(width) || 0),
    height: Math.max(0, Number(height) || 0),
    trimStart: hasTrim ? Math.max(0, Number(trim.start) || 0) : 0,
    trimEnd: hasTrim ? Math.max(0, Number(trim.end) || 0) : 0,
    crop: savedCrop || { x: 0, y: 0, w: 1, h: 1 },
    ratioKey: 'free',
    tab: 'trim',
    // 「习惯裁掉开头 N 秒」（2026-10-10 新增，用户提的）。
    // ⚠️ 用户当次改的口径：**打开时绝不自己动手**，点了按钮才砍。
    //    （第一版是打开就自动砍，用户看到的是"默认开启剪开头"，要求改掉。）
    // 于是这里分成两个数、各管各的，绝不互相污染：
    //   headSeconds  = 长期**记住**的长度（只由「记住」按钮改，存在设置里，跨视频生效）
    //   headPick     = 这一次想砍多长（滑块的值，只影响这一段视频，绝不写进设置）
    //   headRemembered = 是否已经记住过（决定「记住」按钮的亮灭）；
    //   headDirty    = 这次有没有动过「记住」（没动过就别去覆盖设置里存的值）。
    headSeconds: Math.max(0, Math.round(Number(trimHead) || 0)),
    headPick: Math.max(0, Math.round(Number(trimHead) || 0)),
    headRemembered: Math.max(0, Math.round(Number(trimHead) || 0)) > 0,
    headDirty: false
  };

  modal(`<div class="video-editor" id="video-editor">
    <header class="video-editor-top">
      <button type="button" class="video-editor-icon" id="video-editor-close" aria-label="关闭剪辑"><span class="material-symbols-outlined">close</span></button>
      <span class="video-editor-title"><strong>剪辑视频</strong><small id="video-editor-subtitle">${esc(cleanTitle(name))}</small></span>
      <button type="button" class="video-editor-icon" id="video-editor-reset" aria-label="还原整段"><span class="material-symbols-outlined">restart_alt</span></button>
    </header>

    <div class="video-editor-stage" id="video-editor-stage">
      <video id="video-editor-video" src="${esc(source)}" ${poster ? `poster="${esc(poster)}"` : ''} playsinline preload="metadata"></video>
      <div class="video-editor-crop-layer" id="video-editor-crop-layer" hidden></div>
      <button type="button" class="video-editor-play" id="video-editor-play" aria-label="播放或暂停"><span class="material-symbols-outlined" id="video-editor-play-icon">play_arrow</span></button>
      <span class="video-editor-message" id="video-editor-message">正在读取视频…</span>
    </div>

    <div class="video-editor-panel">
      <div class="video-editor-tabs" role="tablist">
        <button type="button" role="tab" data-editor-tab="trim" class="active" aria-selected="true">剪时长</button>
        <button type="button" role="tab" data-editor-tab="crop" aria-selected="false">裁画面</button>
      </div>

      <div class="video-editor-pane" data-editor-pane="trim">
        <div class="video-editor-timeline" id="video-editor-timeline">
          <div class="video-editor-film" id="video-editor-film"></div>
          <div class="video-editor-range" id="video-editor-range"></div>
          <button type="button" class="video-editor-handle is-start" id="video-editor-handle-start" data-trim-handle="start" aria-label="拖拽调整起点"></button>
          <button type="button" class="video-editor-handle is-end" id="video-editor-handle-end" data-trim-handle="end" aria-label="拖拽调整终点"></button>
          <div class="video-editor-playhead" id="video-editor-playhead"></div>
        </div>
        <div class="video-editor-readout">
          <div><small>起点</small><strong id="video-editor-read-start">0:00</strong></div>
          <div><small>终点</small><strong id="video-editor-read-end">0:00</strong></div>
          <div><small>保留</small><strong id="video-editor-read-length">0:00</strong></div>
        </div>
        <div class="video-editor-quick">
          <button type="button" data-trim-quick="full"><span class="material-symbols-outlined">select_all</span>整段</button>
          <button type="button" data-trim-quick="from-play"><span class="material-symbols-outlined">content_cut</span>砍掉开头</button>
          <button type="button" data-trim-quick="to-play"><span class="material-symbols-outlined">content_cut</span>砍掉结尾</button>
        </div>
        <div class="video-editor-head">
          <div class="video-editor-head-top">
            <span>习惯裁掉开头</span>
            <b id="video-editor-head-read">关</b>
          </div>
          <div class="video-editor-head-row">
            <input type="range" id="video-editor-head-range" min="0" max="${HABIT_HEAD_MAX_SECONDS}" step="1" value="0" aria-label="要砍掉的开头长度">
            <button type="button" id="video-editor-head-remember" aria-pressed="false"><span class="material-symbols-outlined">bookmark</span><span id="video-editor-head-remember-label">记住</span></button>
          </div>
          <button type="button" class="video-editor-head-apply" id="video-editor-head-apply" disabled><span class="material-symbols-outlined">content_cut</span><span id="video-editor-head-apply-label">砍掉开头</span></button>
          <p class="video-editor-hint" id="video-editor-head-hint">拖到你要的长度，再点下面的按钮才动手。</p>
        </div>
      </div>

      <div class="video-editor-pane" data-editor-pane="crop" hidden>
        <div class="video-editor-ratios" id="video-editor-ratios">
          ${CROP_PRESETS.map(preset => `<button type="button" data-crop-preset="${preset.key}" class="${preset.key === 'free' ? 'active' : ''}">${preset.label}</button>`).join('')}
        </div>
        <div class="video-editor-scrub">
          <button type="button" class="video-editor-scrub-toggle" id="video-editor-scrub-toggle" aria-label="播放或暂停"><span class="material-symbols-outlined" id="video-editor-scrub-icon">play_arrow</span></button>
          <input type="range" id="video-editor-scrub" min="0" max="1" step="0.01" value="0" aria-label="拖动预览画面">
          <b id="video-editor-scrub-read">0:00</b>
        </div>
        <p class="video-editor-hint" id="video-editor-crop-hint">在画面上拖出一个框即可框选任意比例；拖动框体移动，拖角改变大小。拖动上面的进度条可以换一帧再看看。</p>
        <div class="video-editor-quick">
          <button type="button" data-crop-action="full"><span class="material-symbols-outlined">crop_free</span>铺满画面</button>
          <button type="button" data-crop-action="center"><span class="material-symbols-outlined">filter_center_focus</span>居中</button>
        </div>
      </div>

      <div class="video-editor-actions">
        <button type="button" class="video-editor-cancel" id="video-editor-cancel">取消</button>
        <button type="button" class="video-editor-save" id="video-editor-save">保存剪辑</button>
      </div>
    </div>
  </div>`, 'video-editor-modal');

  const video = $('#video-editor-video');
  const stage = $('#video-editor-stage');
  const layer = $('#video-editor-crop-layer');
  const message = $('#video-editor-message');
  const timeline = $('#video-editor-timeline');
  const range = $('#video-editor-range');
  const playhead = $('#video-editor-playhead');
  const handleStart = $('#video-editor-handle-start');
  const handleEnd = $('#video-editor-handle-end');
  let cropBox = null;
  let cleaned = false;

  const trimEnd = () => (state.trimEnd > state.trimStart ? Math.min(state.trimEnd, effectiveDuration()) : effectiveDuration());
  const effectiveDuration = () => state.duration || Number(video.duration) || 0;
  const frameAspect = () => {
    const w = state.width || video.videoWidth;
    const h = state.height || video.videoHeight;
    return w && h ? w / h : 1;
  };

  /* ── 清理：视频暂停、断源，避免关掉后还在后台出声 ── */
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    observer?.disconnect();
    resizeObserver?.disconnect();
    try { video.pause(); } catch { /* 忽略 */ }
    video.removeAttribute('src');
    try { video.load(); } catch { /* 忽略 */ }
  };

  // 用 MutationObserver 兜底：无论是点取消、点确定，还是系统返回键关掉的，都能收到清理信号。
  const observer = new MutationObserver(() => { if (!document.querySelector('#video-editor')) cleanup(); });
  observer.observe($('#modal-layer'), { childList: true });
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => layout()) : null;

  /* ── 读取元数据 ── */
  video.addEventListener('loadedmetadata', () => {
    // ⚠️ 优先用解码出来的真实时长/尺寸，别信外面传进来的。
    //    外面传的是列表里存的"整秒近似值"（12.7 秒的片子存成 12），
    //    拿它当时间轴总长，最后那 0.7 秒会永远拖不到，终点还会被截短。
    const realDuration = Number(video.duration) || 0;
    if (realDuration) state.duration = realDuration;
    if (Number(video.videoWidth)) state.width = Number(video.videoWidth);
    if (Number(video.videoHeight)) state.height = Number(video.videoHeight);
    if (message) message.hidden = true;
    if (!effectiveDuration()) { show('无法读取视频时长'); return; }
    if (state.trimStart >= effectiveDuration()) state.trimStart = 0;
    if (state.trimEnd > effectiveDuration()) state.trimEnd = effectiveDuration();
    // ⚠️ 这里**故意什么都不做**：以前会在打开时按记过的长度自动把开头砍掉，
    //    用户看到的却是"我还没点，它自己就剪了"（原话：不要默认开启剪开头，点了我才砍）。
    //    现在打开永远是完整的一段，要砍得点面板里那个「砍掉开头 N 秒」。
    video.currentTime = state.trimStart;
    resizeObserver?.observe(stage);
    resizeObserver?.observe(video);
    // 重开剪辑器时把"框住的比例"认回来 —— 上次锁的是 1:1，这次打开胶囊就该亮着 1:1，
    // 否则会出现"框明明是方的，胶囊却写着自由"的错位感。
    // 注意比例本身不存进数据里（存下来的只有那个矩形），所以只能按矩形反推。
    if (savedCrop) state.ratioKey = detectRatioKey(savedCrop, frameAspect());
    layout();
    syncTrim();
    syncRatios();
    syncPlayIcon();
    setScrubRange();
    syncHead();
    movePlayhead();
  }, { once: true });
  video.addEventListener('error', () => { if (message) { message.hidden = false; message.textContent = '这个视频无法在剪辑器里解码'; } });
  video.addEventListener('timeupdate', () => {
    const end = trimEnd();
    if (end > state.trimStart && video.currentTime >= end - .03) {
      try { video.currentTime = state.trimStart; } catch { /* 忽略 */ }
    } else if (video.currentTime < state.trimStart - .25) {
      try { video.currentTime = state.trimStart; } catch { /* 忽略 */ }
    }
    movePlayhead();
  });
  video.addEventListener('play', syncPlayIcon);
  video.addEventListener('pause', syncPlayIcon);
  video.addEventListener('seeked', movePlayhead);

  $('#video-editor-play').onclick = () => togglePlay();
  $('#video-editor-close').onclick = () => { cleanup(); closeModal(); };
  $('#video-editor-cancel').onclick = () => { cleanup(); closeModal(); };
  $('#video-editor-reset').onclick = () => {
    state.trimStart = 0; state.trimEnd = 0;
    state.crop = { x: 0, y: 0, w: 1, h: 1 };
    state.ratioKey = 'free';
    // 还原只针对这一条视频：把这次要砍的长度归零，但**不改**用户已经记住的习惯
    //（所以 headSeconds / headRemembered / headDirty 一律不动，保存时不会去覆盖设置里的值）。
    state.headPick = 0;
    syncTabs(); syncTrim(); layout(); syncRatios();
    syncHead(); setScrubRange(); movePlayhead();
    show('已还原为完整视频');
  };
  $('#video-editor-save').onclick = async () => {
    const button = $('#video-editor-save');
    const total = effectiveDuration();
    const start = Math.max(0, state.trimStart);
    const end = trimEnd();
    // ⚠️ 这里必须用算出来的 end，不能用 state.trimEnd。
    //    state.trimEnd 的 0 是"终点手柄还没动过"的哨兵值，真正的终点由 trimEnd() 补成片尾；
    //    拿哨兵值一比，只拖了起点（保留后半段）的剪辑会被判成"整段没剪"，存的还是 null —— 白剪。
    const wholeTrim = !(end > start + .05)
      || (total > 0 && start <= .05 && end >= total - .05);
    const payload = {
      trim: wholeTrim ? null : { start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 },
      crop: normalizeCrop(state.crop),
      // 只有这次真的动过「记住」才回写，否则会把用户原先存好的习惯悄悄清成 0。
      trimHeadSeconds: state.headDirty ? (state.headRemembered && state.headSeconds > 0 ? state.headSeconds : 0) : null
    };
    button.disabled = true;
    // 画面裁剪保存时要重抓一帧当封面（定位 + 解码，长片可能要一两秒），
    // 期间只说"按钮变灰"用户会以为没点上 —— 直接把文案换掉。
    const label = button.textContent;
    button.textContent = '正在保存…';
    try { await onApply?.(payload); cleanup(); closeModal(); }
    catch (error) { button.disabled = false; button.textContent = label; show(error?.message || '保存剪辑失败'); }
  };

  /* ── 标签页 ── */
  $$('[data-editor-tab]').forEach(tab => tab.onclick = () => { state.tab = tab.dataset.editorTab; syncTabs(); layout(); });
  function syncTabs() {
    $$('[data-editor-tab]').forEach(tab => {
      const active = tab.dataset.editorTab === state.tab;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    $$('[data-editor-pane]').forEach(pane => { pane.hidden = pane.dataset.editorPane !== state.tab; });
    if (layer) layer.hidden = state.tab !== 'crop';
  }

  /* ── 布局：把裁剪层对齐到视频画面的实际显示区域 ── */
  function layout() {
    const stageRect = stage.getBoundingClientRect();
    const box = containBox(stageRect.width, stageRect.height, state.width || video.videoWidth, state.height || video.videoHeight);
    if (!box) return;
    layer.style.left = `${box.left}px`;
    layer.style.top = `${box.top}px`;
    layer.style.width = `${box.width}px`;
    layer.style.height = `${box.height}px`;
    renderCropBox();
    movePlayhead();
  }

  /* ── 剪时长 ── */
  function syncTrim() {
    const total = effectiveDuration() || 1;
    const end = trimEnd();
    const startPercent = state.trimStart / total * 100;
    const endPercent = end / total * 100;
    range.style.left = `${startPercent}%`;
    range.style.width = `${Math.max(0, endPercent - startPercent)}%`;
    handleStart.style.left = `${startPercent}%`;
    handleEnd.style.left = `${endPercent}%`;
    $('#video-editor-read-start').textContent = formatVideoDuration(state.trimStart, '0:00');
    $('#video-editor-read-end').textContent = formatVideoDuration(end, '0:00');
    $('#video-editor-read-length').textContent = formatVideoDuration(Math.max(0, end - state.trimStart), '0:00');
    const subtitle = $('#video-editor-subtitle');
    if (subtitle) subtitle.textContent = `剪辑后 ${formatVideoDuration(Math.max(0, end - state.trimStart), '0:00')}`;
    // 剪短之后可预览的范围跟着变，进度条要立刻收窄，否则还能拖到已经剪掉的画面上。
    setScrubRange();
  }

  function movePlayhead() {
    const total = effectiveDuration() || 1;
    playhead.style.left = `${Math.min(100, Math.max(0, video.currentTime / total * 100))}%`;
    syncScrub();
  }

  /* ── 裁画面时的进度条（2026-10-10 新增，用户反馈「裁画面时没办法拖动进度条换画面」）──
     只在「剪辑之后真正会播的那一段」里走：能拖到已经剪掉的画面上再框一遍，
     框出来的东西保存后根本看不到，纯属白干。 */
  function scrubBounds() {
    const total = effectiveDuration();
    const start = Math.max(0, state.trimStart);
    const end = Math.min(total, trimEnd());
    return { start, end: end > start ? end : total, total };
  }

  function setScrubRange() {
    const scrub = $('#video-editor-scrub');
    if (!scrub) return;
    const { start, end } = scrubBounds();
    scrub.min = String(start);
    scrub.max = String(Math.max(start + .01, end));
  }

  function syncScrub() {
    const scrub = $('#video-editor-scrub');
    if (!scrub) return;
    const { start, end } = scrubBounds();
    const at = Math.min(end, Math.max(start, Number(video.currentTime) || 0));
    scrub.value = String(at);
    const read = $('#video-editor-scrub-read');
    if (read) read.textContent = formatVideoDuration(at, '0:00');
  }

  function seekTo(second) {
    const { start, end } = scrubBounds();
    const target = Math.min(end, Math.max(start, Number(second) || 0));
    try { video.currentTime = target; } catch { /* 忽略 */ }
    movePlayhead();
  }

  const scrubInput = $('#video-editor-scrub');
  if (scrubInput) {
    scrubInput.addEventListener('input', event => { video.pause(); seekTo(event.target.value); });
  }
  const scrubToggle = $('#video-editor-scrub-toggle');
  if (scrubToggle) scrubToggle.addEventListener('click', () => togglePlay());

  /* ── 习惯裁掉开头 N 秒（2026-10-10 新增，用户提的）──
     三个控件各管一件事，别混：
       滑块        → 定这次要砍多长（只改 headPick，不动画面）
       「砍掉开头 N 秒」按钮 → 动手砍（唯一会改时间轴的地方）
       「记住」     → 把滑块上的数字存成长期默认（唯一会写设置的地方）
     ⚠️ 打开剪辑**不会**自己砍（用户当次要求："不要默认开启剪开头，点了我才砍"）。
     上限规则收在 model.js：最多 20 秒，且不超过片长的一半。 */
  const headLimit = () => habitHeadLimit(effectiveDuration());

  function syncHead() {
    // ⚠️ 名字别叫 range —— 外层那个 range 是「剪时长」的时间轴元素，重名容易改错对象。
    const headInput = $('#video-editor-head-range');
    const read = $('#video-editor-head-read');
    const remember = $('#video-editor-head-remember');
    const label = $('#video-editor-head-remember-label');
    const apply = $('#video-editor-head-apply');
    const applyLabel = $('#video-editor-head-apply-label');
    const limit = headLimit();
    // 「已记住」只在真的记了非零长度时才算数 —— 记 0 秒等于没记。
    const remembered = state.headRemembered && state.headSeconds > 0;
    // 这次实际能砍多少：滑块的值，被"片长一半"的上限夹一下。
    const pick = Math.min(limit, Math.max(0, Math.round(state.headPick)));
    state.headPick = pick;
    // 「够不到」：记住的长度超过了这段视频能砍的上限（短片最多砍一半）。
    // 上限提到 20 秒之后这很常见：要 40 秒以上的片子才够得到 20 秒。
    const clipped = remembered && state.headSeconds > limit;
    if (headInput) {
      headInput.max = String(limit);
      headInput.value = String(pick);
      headInput.disabled = !effectiveDuration();
    }
    // ⚠️ 读数、按钮、滑块三者说的是**同一个数**（这次会砍掉多少）。
    //    别把"记住的那个长度"塞进读数：短片够不到 20 秒时，会出现
    //    「按钮写着砍 20 秒、实际只砍得动 1 秒」这种不老实的东西。
    //    记住的数字改由下面那句说明来讲。
    if (read) read.textContent = pick > 0 ? `${pick} 秒` : '关';
    if (apply) apply.disabled = pick <= 0 || !effectiveDuration();
    if (applyLabel) applyLabel.textContent = pick > 0 ? `砍掉开头 ${pick} 秒` : '砍掉开头';
    // 「记住」按钮亮着 = 滑块上这个数字就是记住的那个。
    // ⚠️ 这样才不用"先点一下关掉、再点一下开"——滑块一改它就自动灭掉，
    //    这时候点一下是把**新的**数字存成默认（把 1 秒改成 20 秒就靠这个）。
    const isCurrent = remembered && pick === state.headSeconds;
    if (remember) {
      remember.classList.toggle('active', isCurrent);
      remember.setAttribute('aria-pressed', String(isCurrent));
    }
    if (label) label.textContent = isCurrent ? '已记住' : '记住';
    const hint = $('#video-editor-head-hint');
    if (hint) {
      hint.textContent = clipped
        ? `记住的是 ${state.headSeconds} 秒；这段视频只有 ${formatVideoDuration(effectiveDuration(), '0:00')}，这次最多能砍 ${limit} 秒。长一点的视频会按 ${state.headSeconds} 秒来。`
        : remembered && pick !== state.headSeconds
          ? `已记住 ${state.headSeconds} 秒。这一段只想砍 ${pick} 秒？点「记住」就把它存成新的默认。`
          : remembered
            ? `已记住 ${state.headSeconds} 秒 —— 打开任一段视频，点一下「砍掉开头 ${state.headSeconds} 秒」就把开头砍掉。想还原就点顶上的「还原整段」。`
            : '拖到你要的长度，再点「砍掉开头」才动手。点「记住」之后，打开新视频默认就用这个长度。';
    }
  }

  /* 动手砍 —— **只有点按钮才会走到这里**。打开剪辑不会自己砍（用户当次要求）。
     只动这一段的起点，绝不碰记过的长度、也不打脏标记（保存时就不会覆盖设置里的值）。 */
  function applyHeadNow() {
    const value = Math.min(headLimit(), Math.max(0, Math.round(state.headPick)));
    if (value <= 0) return show('先把长度拖到 1 秒以上');
    const gap = Math.max(.2, (effectiveDuration() || 0) * .01);
    state.trimStart = Math.max(0, Math.min(value, Math.max(0, trimEnd() - gap)));
    state.headPick = value;
    try { video.currentTime = state.trimStart; } catch { /* 忽略 */ }
    syncTrim(); syncHead(); setScrubRange(); movePlayhead();
    show(`已砍掉开头 ${value} 秒`);
  }

  const headRange = $('#video-editor-head-range');
  if (headRange) {
    // ⚠️ 滑块**只定长度，不动画面**。以前是拖动就砍，用户看到的就是"我还没点它就剪了"。
    headRange.addEventListener('input', event => {
      state.headPick = Math.max(0, Math.min(headLimit(), Math.round(Number(event.target.value) || 0)));
      syncHead();
    });
  }
  $('#video-editor-head-apply')?.addEventListener('click', applyHeadNow);
  const headRemember = $('#video-editor-head-remember');
  if (headRemember) {
    headRemember.addEventListener('click', () => {
      const value = Math.min(headLimit(), Math.max(0, Math.round(state.headPick)));
      // 亮着再点 = 取消记住；灭着点 = 把滑块上这个数字存成默认。
      // 这样"把记住的 1 秒改成 20 秒"只要拖一下滑块再点一下，不用先关再开。
      if (state.headRemembered && value === state.headSeconds) {
        state.headRemembered = false;
        state.headSeconds = 0;
        state.headDirty = true;
        show('不再记住这个长度');
      } else {
        state.headSeconds = value;
        state.headRemembered = value > 0;
        state.headDirty = true;
        show(value > 0 ? `以后默认砍掉开头 ${value} 秒` : '不再默认砍开头');
      }
      syncHead();
    });
  }

  function bindTrimHandle(handle, which) {
    let dragging = false;
    const seekFromEvent = event => {
      const rect = timeline.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / (rect.width || 1)));
      return ratio * (effectiveDuration() || 0);
    };
    handle.addEventListener('pointerdown', event => {
      dragging = true;
      // 指针捕获让手指滑出条子也不丢事件；合成事件没有真实 pointerId 时会抛错，忽略即可。
      try { handle.setPointerCapture?.(event.pointerId); } catch { /* 忽略 */ }
      event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
      if (!dragging) return;
      const value = seekFromEvent(event);
      const minGap = Math.max(.2, (effectiveDuration() || 0) * .01);
      if (which === 'start') {
        state.trimStart = Math.min(Math.max(0, value), trimEnd() - minGap);
        if (state.trimStart < 0) state.trimStart = 0;
      } else {
        state.trimEnd = Math.max(Math.min(effectiveDuration(), value), state.trimStart + minGap);
      }
      try { video.currentTime = which === 'start' ? state.trimStart : state.trimEnd; } catch { /* 忽略 */ }
      syncTrim(); movePlayhead();
    });
    const stop = () => { dragging = false; };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }
  bindTrimHandle(handleStart, 'start');
  bindTrimHandle(handleEnd, 'end');

  $$('[data-trim-quick]').forEach(button => button.onclick = () => {
    const total = effectiveDuration();
    const action = button.dataset.trimQuick;
    if (action === 'full') { state.trimStart = 0; state.trimEnd = 0; }
    else if (action === 'from-play') { state.trimStart = Math.min(video.currentTime, trimEnd() - .2); }
    else if (action === 'to-play') { state.trimEnd = Math.max(video.currentTime, state.trimStart + .2); }
    if (state.trimStart < 0) state.trimStart = 0;
    if (state.trimEnd > total) state.trimEnd = total;
    syncTrim();
  });

  /* ── 裁画面 ── */
  function renderCropBox() {
    if (!cropBox || !layer.isConnected) return;
    const c = clampCrop(state.crop);
    cropBox.style.left = `${c.x * 100}%`;
    cropBox.style.top = `${c.y * 100}%`;
    cropBox.style.width = `${c.w * 100}%`;
    cropBox.style.height = `${c.h * 100}%`;
    syncShade(c);
    const label = cropBox.querySelector('.video-editor-crop-size');
    if (label) {
      const w = Math.round(c.w * (state.width || video.videoWidth || 0));
      const h = Math.round(c.h * (state.height || video.videoHeight || 0));
      label.textContent = w && h ? `${w} × ${h}` : '';
    }
    const ratioLocked = state.ratioKey !== 'free';
    cropBox.querySelectorAll('.video-editor-crop-handle').forEach(node => {
      const isCorner = node.dataset.handle.length === 2;
      node.hidden = ratioLocked && !isCorner;
    });
  }

  /* 取景框以外压暗：用「上/下/左/右」四块拼出来，不用 box-shadow 扩散。
     原因：承载取景框的这一层是 overflow:hidden（画面被框小时不能溢出到面板上），
     而阴影是靠"溢出到框外"生效的 —— 溢出部分正好会被这一层裁掉，
     不同内核上表现还不一致（实测过：框外该暗的地方还是亮的）。
     四块矩形全部落在层内，尺寸直接取归一化百分比，和取景框天然对齐。 */
  function syncShade(c) {
    const shade = layer.querySelector('.video-editor-crop-shade');
    if (!shade) return;
    const right = c.x + c.w;
    const bottom = c.y + c.h;
    const put = (key, left, top, width, height) => {
      const node = shade.querySelector(`[data-shade="${key}"]`);
      if (!node) return;
      node.style.left = left;
      node.style.top = top;
      node.style.width = width;
      node.style.height = height;
    };
    put('top', '0%', '0%', '100%', `${c.y * 100}%`);
    put('bottom', '0%', `${bottom * 100}%`, '100%', `${(1 - bottom) * 100}%`);
    put('left', '0%', `${c.y * 100}%`, `${c.x * 100}%`, `${c.h * 100}%`);
    put('right', `${right * 100}%`, `${c.y * 100}%`, `${(1 - right) * 100}%`, `${c.h * 100}%`);
  }

  function buildCropBox() {
    layer.innerHTML = `<div class="video-editor-crop-shade" aria-hidden="true">
        <span data-shade="top"></span><span data-shade="bottom"></span>
        <span data-shade="left"></span><span data-shade="right"></span>
      </div>
      <div class="video-editor-crop-box" id="video-editor-crop-box">
      <span class="video-editor-crop-grid" aria-hidden="true"></span>
      <span class="video-editor-crop-size"></span>
      ${HANDLES.map(handle => `<button type="button" class="video-editor-crop-handle is-${handle.key}" data-handle="${handle.key}" aria-label="调整取景框"></button>`).join('')}
    </div>`;
    cropBox = $('#video-editor-crop-box');
    renderCropBox();
    bindCropGestures();
  }

  function bindCropGestures() {
    let drag = null;

    const pointFromEvent = event => {
      const rect = layer.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (event.clientX - rect.left) / (rect.width || 1))),
        y: Math.min(1, Math.max(0, (event.clientY - rect.top) / (rect.height || 1)))
      };
    };

    layer.addEventListener('pointerdown', event => {
      const handleNode = event.target.closest('[data-handle]');
      const insideBox = event.target.closest('#video-editor-crop-box');
      const point = pointFromEvent(event);
      if (handleNode) {
        drag = { mode: 'resize', handle: handleNode.dataset.handle, start: { ...state.crop } };
      } else if (insideBox) {
        drag = { mode: 'move', grab: point, start: { ...state.crop } };
      } else {
        drag = { mode: 'draw', origin: point };
        state.crop = clampCrop({ x: point.x, y: point.y, w: MIN_CROP, h: MIN_CROP });
        renderCropBox();
      }
      try { layer.setPointerCapture?.(event.pointerId); } catch { /* 合成事件没有真实 pointerId，忽略 */ }
      event.preventDefault();
    });

    layer.addEventListener('pointermove', event => {
      if (!drag) return;
      const point = pointFromEvent(event);
      if (drag.mode === 'move') {
        const dx = point.x - drag.grab.x;
        const dy = point.y - drag.grab.y;
        state.crop = clampCrop({ x: drag.start.x + dx, y: drag.start.y + dy, w: drag.start.w, h: drag.start.h });
      } else if (drag.mode === 'draw') {
        const x = Math.min(drag.origin.x, point.x);
        const y = Math.min(drag.origin.y, point.y);
        const w = Math.abs(point.x - drag.origin.x);
        const h = Math.abs(point.y - drag.origin.y);
        let next = clampCrop({ x, y, w: Math.max(w, MIN_CROP), h: Math.max(h, MIN_CROP) });
        if (state.ratioKey !== 'free') {
          const ratio = state.ratioKey === 'original' ? frameAspect() : (presetRatio(state.ratioKey) || 1);
          next = fitPresetCrop(ratio, frameAspect(), { x: next.x + next.w / 2, y: next.y + next.h / 2 });
        }
        state.crop = next;
      } else if (drag.mode === 'resize') {
        const start = drag.start;
        const right = start.x + start.w;
        const bottom = start.y + start.h;
        let x = start.x, y = start.y, w = start.w, h = start.h;
        const key = drag.handle;
        if (key.includes('w')) { x = Math.min(point.x, right - MIN_CROP); w = right - x; }
        if (key.includes('e')) { w = Math.max(MIN_CROP, point.x - start.x); }
        if (key.includes('n')) { y = Math.min(point.y, bottom - MIN_CROP); h = bottom - y; }
        if (key.includes('s')) { h = Math.max(MIN_CROP, point.y - start.y); }
        let next = clampCrop({ x, y, w, h });
        if (state.ratioKey !== 'free') {
          // 由角手柄拖动时，以对角为锚点保持比例
          const ratio = state.ratioKey === 'original' ? frameAspect() : (presetRatio(state.ratioKey) || 1);
          const anchorX = key.includes('w') ? right : start.x;
          const anchorY = key.includes('n') ? bottom : start.y;
          const width = Math.max(MIN_CROP, Math.abs(point.x - anchorX));
          const height = width / (ratio / frameAspect());
          next = clampCrop({
            x: key.includes('w') ? anchorX - width : anchorX,
            y: key.includes('n') ? anchorY - height : anchorY,
            w: width,
            h: height
          });
        }
        state.crop = next;
      }
      renderCropBox();
    });

    const stop = () => { drag = null; };
    layer.addEventListener('pointerup', stop);
    layer.addEventListener('pointercancel', stop);
  }

  function syncRatios() {
    $$('[data-crop-preset]').forEach(button => button.classList.toggle('active', button.dataset.cropPreset === state.ratioKey));
    const hint = $('#video-editor-crop-hint');
    if (hint) hint.textContent = state.ratioKey === 'free'
      ? '在画面上拖出一个框即可框选任意比例；拖动框体移动，拖角改变大小。'
      : `已锁定 ${state.ratioKey === 'original' ? '原始比例' : state.ratioKey}，拖动四角调整大小；切回「自由」可任意框选。`;
  }

  $$('[data-crop-preset]').forEach(button => button.onclick = () => {
    const key = button.dataset.cropPreset;
    state.ratioKey = key;
    if (key !== 'free') {
      const center = { x: state.crop.x + state.crop.w / 2, y: state.crop.y + state.crop.h / 2 };
      const ratio = key === 'original' ? frameAspect() : (presetRatio(key) || 1);
      state.crop = fitPresetCrop(ratio, frameAspect(), center);
    }
    renderCropBox();
    syncRatios();
  });

  $$('[data-crop-action]').forEach(button => button.onclick = () => {
    if (button.dataset.cropAction === 'full') state.crop = { x: 0, y: 0, w: 1, h: 1 };
    else state.crop = fitPresetCrop(presetRatio(state.ratioKey) || frameAspect(), frameAspect(), { x: .5, y: .5 });
    renderCropBox();
  });

  /* ── 播放控制 ── */
  function togglePlay() {
    if (video.paused) video.play().catch(() => show('无法播放这个视频'));
    else video.pause();
  }
  function syncPlayIcon() {
    const icon = $('#video-editor-play-icon');
    if (icon) icon.textContent = video.paused ? 'play_arrow' : 'pause';
    const scrubIcon = $('#video-editor-scrub-icon');
    if (scrubIcon) scrubIcon.textContent = video.paused ? 'play_arrow' : 'pause';
  }

  buildCropBox();
  syncTabs();
  syncTrim();
  syncRatios();
  syncPlayIcon();
  setScrubRange();
  syncHead();
  syncScrub();
}

function cleanTitle(name) {
  return String(name || '私密视频').replace(/\.(?:mp4|webm|mov|mkv|m4v|3gp)$/i, '').trim().slice(0, 40) || '私密视频';
}

/** 按取景框反推它锁的是哪个常用比例；都对不上就返回「自由」。
 *  框出来的画面宽高比 = (归一化宽 / 归一化高) × 原始画幅宽高比。 */
function detectRatioKey(rect, frame) {
  const output = (Number(rect?.w) || 0) / (Number(rect?.h) || 1) * (Number(frame) || 1);
  if (!output) return 'free';
  for (const preset of CROP_PRESETS) {
    if (preset.key === 'free') continue;
    const target = preset.key === 'original' ? frame : preset.ratio;
    if (target && Math.abs(output - target) < target * .02) return preset.key;
  }
  return 'free';
}
