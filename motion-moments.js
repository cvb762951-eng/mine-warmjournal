/* ============================================================================
 * motion-moments.js · 随手拍动效 M1–M4（清简主题）
 *
 * 方案出处：PR #36 docs/design-upgrade-plan.md §10.0 / 10.5–10.8。
 *   M1 快门 / 相册飞入表单网格
 *   M2 保存后第一张飞到列表新卡（编辑不飞；不做「收成一叠」）
 *   M3 首屏外卡片分层淡入
 *   M4 长按卡片浮起
 *
 * 约定：
 *   - 只旁听 DOM / 捕获阶段事件，不改 views/snippets.js 的拍照、选图、保存与 100 张上限。
 *   - 照片飞行：独立 <img> 克隆，摆在 contain 显示框上，只做 translate + 单一 scale；
 *     比例误差 > 0.5% 则放弃飞行、只淡入。
 *   - 三档 rich / lite / none（none = 减弱动态效果）。
 *   - 不 import storage / notifications / private-vault / model。
 * ========================================================================== */
import { prefersReducedMotion } from './motion.js';

export const MOMENTS_MOTION = {
  aspectTolerance: 0.005,
  shotMs: 520,
  shotStagger: 40,
  shotMaxFly: 6,
  shotWaitMs: 8000,
  shotFromSize: 44,
  saveMs: 480,
  saveEase: 'cubic-bezier(.32,.72,0,1)',
  saveWaitMs: 3000,
  flipMs: 360,
  flipMax: 6,
  arriveMs: 220,
  arriveDelay: 100,
  holdMs: 380,
  holdSlop: 8,
  liftMs: 180,
  releaseMs: 420,
};

const EMPH = MOMENTS_MOTION.saveEase;
const EASE_OUT = 'cubic-bezier(.22,.61,.36,1)';

/* ── 纯函数（tests/motion-moments.test.mjs 锁定）─────────────────── */

/** contain 显示框：img 元素框内按原始宽高比实际画出的那块（视口坐标）。 */
export function containRect(img) {
  if (!img) return null;
  const r = typeof img.getBoundingClientRect === 'function' ? img.getBoundingClientRect() : img;
  const nw = img.naturalWidth || img.nw || 0;
  const nh = img.naturalHeight || img.nh || 0;
  if (!(r?.width > 0) || !(r?.height > 0)) return null;
  if (!(nw > 0) || !(nh > 0)) {
    return { left: r.left, top: r.top, width: r.width, height: r.height, ratio: r.width / r.height };
  }
  const s = Math.min(r.width / nw, r.height / nh);
  const w = nw * s;
  const h = nh * s;
  return {
    left: r.left + (r.width - w) / 2,
    top: r.top + (r.height - h) / 2,
    width: w,
    height: h,
    ratio: nw / nh,
  };
}

/** cover 绘制框：object-fit: cover 时整张图实际铺开的矩形（比框大，多出的被框裁掉）。
 *  返回 { rect: 原图比例的绘制框, clip: 相对绘制框的裁切 inset(px) }。 */
export function coverRect(img) {
  if (!img) return null;
  const box = typeof img.getBoundingClientRect === 'function' ? img.getBoundingClientRect() : img;
  const nw = img.naturalWidth || img.nw || 0;
  const nh = img.naturalHeight || img.nh || 0;
  if (!(box?.width > 0) || !(box?.height > 0) || !(nw > 0) || !(nh > 0)) return null;
  const s = Math.max(box.width / nw, box.height / nh);
  const w = nw * s;
  const h = nh * s;
  const left = box.left + (box.width - w) / 2;
  const top = box.top + (box.height - h) / 2;
  return {
    rect: { left, top, width: w, height: h, ratio: nw / nh },
    clip: { top: box.top - top, left: box.left - left, bottom: top + h - (box.top + box.height), right: left + w - (box.left + box.width) },
  };
}

/** 两端显示框宽高比误差 ≤ 0.5% 才允许飞行。 */
export function sameRatio(a, b, tolerance = MOMENTS_MOTION.aspectTolerance) {
  if (!(a?.width > 0) || !(a?.height > 0) || !(b?.width > 0) || !(b?.height > 0)) return false;
  return Math.abs(a.width / a.height / (b.width / b.height) - 1) <= tolerance;
}

/** 等比飞行变换：translate + 单一 scale。比例不合返回 null。 */
export function flightTransform(from, to) {
  if (!sameRatio(from, to)) return null;
  const s = to.width / from.width;
  return `translate(${(to.left - from.left).toFixed(2)}px, ${(to.top - from.top).toFixed(2)}px) scale(${s.toFixed(4)})`;
}

/** M1：本批里哪些格子飞入、哪些只淡入。 */
export function shotPlan(beforeCount, afterCount, maxFly = MOMENTS_MOTION.shotMaxFly) {
  const start = Math.max(0, beforeCount);
  const total = Math.max(0, afterCount - start);
  return {
    fly: Math.min(maxFly, total),
    fade: Math.max(0, total - maxFly),
    start,
  };
}

/** M2：编辑已有记录不飞；找不到新卡也不飞。 */
export function saveShouldFly({ editing = false, hasFreshCard = false } = {}) {
  return !editing && hasFreshCard;
}

/** 列表卡身份：用照片 / 视频按钮上的 snippet id。 */
export function cardKey(card) {
  if (!card) return '';
  const node = card.querySelector?.('[data-view-snippet-photo], [data-play-snippet-video]');
  return node?.dataset?.viewSnippetPhoto || node?.dataset?.playSnippetVideo || '';
}

/* ── 运行时 ─────────────────────────────────────────────────────── */
const hasDom = typeof document !== 'undefined';
const root = hasDom ? document.documentElement : null;
const on = () => root?.dataset.theme === 'plain';
const tier = () => root?.dataset.plMotion || 'rich';
const rich = () => on() && tier() === 'rich';
const moving = () => on() && tier() !== 'none' && !prefersReducedMotion();
const safe = run => { try { return run(); } catch { return null; } };

function springMagnet() {
  const raw = root ? getComputedStyle(root).getPropertyValue('--pl-spring-magnet').trim() : '';
  return raw || EMPH;
}

function flyPhoto(src, from, to, { duration = MOMENTS_MOTION.saveMs, easing = EMPH, radius = 12, clip = null } = {}) {
  const transform = flightTransform(from, to);
  if (!transform || !src || !moving()) return null;
  const img = new Image();
  img.src = src;
  img.alt = '';
  img.draggable = false;
  img.className = 'pl-fly-photo';
  Object.assign(img.style, {
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    borderRadius: `${radius}px`,
  });
  /* 起点是 cover 封面时：克隆按原图比例摆在 cover 绘制框上，再用 clip-path 裁成封面框，
     第一帧与封面一模一样；飞行中裁切放开到 inset(0)，落成新卡里的完整 contain 图。
     照片本身只有 translate + 单一 scale，不会被拉伸。 */
  const clipFrom = clip ? `inset(${clip.top}px ${clip.right}px ${clip.bottom}px ${clip.left}px round ${radius}px)` : null;
  if (clipFrom) { img.style.borderRadius = '0'; img.style.clipPath = clipFrom; }
  document.body.append(img);
  const anim = img.animate(
    clipFrom
      ? [{ transform: 'none', clipPath: clipFrom }, { transform, clipPath: `inset(0px round ${radius}px)` }]
      : [{ transform: 'none' }, { transform }],
    { duration, easing, fill: 'forwards' },
  );
  anim.finished
    .catch(() => {})
    .then(() => {
      img.style.willChange = 'auto';
      return img.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 80, fill: 'forwards' }).finished;
    })
    .catch(() => {})
    .then(() => img.remove());
  return anim;
}

function waitImage(img, ms = 300) {
  if (!img) return Promise.resolve(false);
  if (img.complete && img.naturalWidth) return Promise.resolve(true);
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (done) return; done = true; resolve(ok); };
    const t = setTimeout(() => finish(Boolean(img.complete && img.naturalWidth)), ms);
    img.addEventListener('load', () => { clearTimeout(t); finish(true); }, { once: true });
    img.addEventListener('error', () => { clearTimeout(t); finish(false); }, { once: true });
  });
}

/* ── M1 快门 / 相册飞入 ─────────────────────────────────────────── */
let shotFrom = null;
const SHOT_BUTTONS = '#capture-snippet-photo, #pick-snippet-photo, #quick-capture-snap, #quick-pick-snap, #quick-photo-preview';
const quickSig = () => {
  const p = document.getElementById('quick-photo-preview');
  return p ? `${p.querySelector('img')?.getAttribute('src') || ''}|${p.textContent.trim()}` : '';
};

function rememberShot(event) {
  if (!on()) return;
  const button = event.target.closest?.(SHOT_BUTTONS);
  if (!button) return;
  const r = button.getBoundingClientRect();
  shotFrom = {
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
    t: performance.now(),
    before: document.querySelectorAll('.snippet-photo-cell').length,
    quick: quickSig(),
  };
}

/* Opus #36 snapShot()：新格子从按钮中心 44px 处飞入，520ms × --spring-magnet，每张 +40ms。 */
function shotIn(el, x, y, i, easing) {
  const r = el.getBoundingClientRect();
  if (!(r.width > 0) || !(r.height > 0)) return;
  const s = MOMENTS_MOTION.shotFromSize / Math.max(r.width, r.height);
  el.animate([
    { transform: `translate(${x - (r.left + r.width / 2)}px, ${y - (r.top + r.height / 2)}px) scale(${s})`, opacity: 0 },
    { opacity: 1, offset: 0.3 },
    { transform: 'none', opacity: 1 },
  ], { duration: MOMENTS_MOTION.shotMs, delay: i * MOMENTS_MOTION.shotStagger, easing, fill: 'backwards' });
}

function playShotIn() {
  if (!shotFrom || !moving() || performance.now() - shotFrom.t > MOMENTS_MOTION.shotWaitMs) return;
  const easing = springMagnet();
  const { x, y } = shotFrom;
  /* 真实「新增随手拍」走的是快捷弹窗 #quick-photo-preview（只显示封面 + 张数），
     不是 #snippet-form 的网格；封面或张数变了就让封面从按钮飞进来。 */
  const quickImg = document.querySelector('#quick-photo-preview > img');
  if (quickImg && quickSig() !== shotFrom.quick) {
    shotFrom = null;
    shotIn(quickImg, x, y, 0, easing);
    const overlay = document.querySelector('#quick-photo-preview .quick-photo-overlay');
    overlay?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 260, easing: EASE_OUT, fill: 'backwards' });
    return;
  }
  const cells = [...document.querySelectorAll('#snippet-photo-grid .snippet-photo-cell')];
  const plan = shotPlan(shotFrom.before, cells.length);
  if (plan.fly + plan.fade <= 0) return;
  shotFrom = null;
  cells.slice(plan.start).forEach((cell, i) => {
    const thumb = cell.querySelector('.snippet-photo-thumb') || cell;
    if (i >= MOMENTS_MOTION.shotMaxFly) {
      thumb.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: MOMENTS_MOTION.shotMaxFly * MOMENTS_MOTION.shotStagger, easing: EASE_OUT, fill: 'backwards' });
      return;
    }
    shotIn(thumb, x, y, i, easing);
  });
}

/* ── M2 保存飞到列表顶部 ───────────────────────────────────────── */
let saved = null;

function rememberQuickSave(event) {
  if (!event.target.closest?.('#quick-save-snap') || !on() || !moving()) return;
  const card = document.getElementById('quick-photo-modal');
  if (card) rememberSave({ target: card, quick: true });
}

function rememberSave(event) {
  const form = event.target;
  if (!event.quick && form?.id !== 'snippet-form') return;
  if (!on() || !moving()) return;
  const still = form.querySelector('#quick-photo-preview > img, .snippet-photo-thumb .photo-blur-still, .snippet-photo-thumb img.photo-blur-still');
  const ready = Boolean(still?.complete && still.naturalWidth);
  const isCover = ready && getComputedStyle(still).objectFit === 'cover';
  const cover = isCover ? coverRect(still) : null;
  const photo = ready ? (cover ? cover.rect : containRect(still)) : null;
  saved = {
    t: performance.now(),
    editing: Boolean(form.querySelector('input[name="id"]')?.value),
    photo,
    clip: cover ? cover.clip : null,
    src: still?.currentSrc || still?.src || '',
    before: new Map(
      [...document.querySelectorAll('.snippet-item-card')].map(card => [cardKey(card), card.getBoundingClientRect().top]),
    ),
  };
}

async function playSaveToTop() {
  const s = saved;
  if (!s || performance.now() - s.t > MOMENTS_MOTION.saveWaitMs) return;
  const cards = [...document.querySelectorAll('.snippet-item-card')];
  const fresh = cards.find(card => !s.before.has(cardKey(card)));
  if (!saveShouldFly({ editing: s.editing, hasFreshCard: Boolean(fresh) })) {
    if (s.editing) saved = null;
    return;
  }
  saved = null;
  const still = fresh.querySelector('.snippet-photo-tile .photo-blur-still, .snippet-visual-wrap .photo-blur-still, .photo-blur-still');
  await waitImage(still, 300);
  const to = still?.complete && still.naturalWidth ? containRect(still) : null;
  const visible = Boolean(to && to.top < innerHeight && to.top + to.height > 0);
  fresh.classList.add('pl-arrive');
  const clearArrive = () => fresh.classList.remove('pl-arrive');
  fresh.addEventListener('animationend', clearArrive, { once: true });
  setTimeout(clearArrive, MOMENTS_MOTION.arriveDelay + MOMENTS_MOTION.arriveMs + 40);

  if (visible && s.photo && s.src) {
    still.style.opacity = '0';
    const anim = flyPhoto(s.src, s.photo, to, { duration: MOMENTS_MOTION.saveMs, easing: EMPH, clip: s.clip });
    const show = () => { still.style.opacity = ''; };
    if (anim) {
      anim.finished.catch(() => {}).then(() => {
        still.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 80, fill: 'backwards' });
        show();
      });
    } else {
      still.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: EASE_OUT, fill: 'backwards' });
      show();
    }
  }

  if (rich()) {
    cards.filter(card => card !== fresh).slice(0, MOMENTS_MOTION.flipMax).forEach(card => {
      const old = s.before.get(cardKey(card));
      if (old == null) return;
      const dy = old - card.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) {
        card.animate(
          [{ transform: `translate3d(0, ${dy}px, 0)` }, { transform: 'none' }],
          { duration: MOMENTS_MOTION.flipMs, easing: EMPH },
        );
      }
    });
  }
}

/* ── M3 滚动分层淡入 ───────────────────────────────────────────── */
let layerIo = null;

function ensureLayerIo() {
  if (layerIo || typeof IntersectionObserver === 'undefined') return layerIo;
  layerIo = new IntersectionObserver(entries => {
    let batch = 0;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const card = entry.target;
      layerIo.unobserve(card);
      const still = card.querySelector('.photo-blur-still');
      const go = () => {
        card.style.setProperty('--pl-lag', `${Math.min(batch++, 3) * 40}ms`);
        card.classList.add('pl-in');
        const done = () => {
          card.classList.remove('pl-pre', 'pl-in', 'pl-layers', 'pl-flat');
          card.style.removeProperty('--pl-lag');
        };
        card.addEventListener('transitionend', done, { once: true });
        setTimeout(done, 520);
      };
      if (still && !still.complete) still.addEventListener('load', go, { once: true });
      else go();
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 });
  return layerIo;
}

function prepareLayers(scope = document) {
  if (!moving()) return;
  const io = ensureLayerIo();
  if (!io) return;
  const vh = innerHeight;
  scope.querySelectorAll?.('.snippet-item-card:not(.pl-pre):not(.pl-in)').forEach(card => {
    if (card.closest('#moment-album-layer')) return;
    if (card.getBoundingClientRect().top < vh) return;
    card.classList.add('pl-pre', rich() ? 'pl-layers' : 'pl-flat');
    io.observe(card);
  });
}

/* ── M4 长按浮起 ───────────────────────────────────────────────── */
const LIFT_SKIP = 'button:not(.snippet-photo-tile), a, input, textarea, .snippet-video-segments, #moment-album-layer, .moment-album-stack';
let hold = null;
let swallow = false;

function dropHold() {
  if (!hold) return;
  clearTimeout(hold.timer);
  if (hold.lifted) {
    swallow = true;
    hold.card.classList.remove('pl-lifted');
    setTimeout(() => { swallow = false; }, 400);
  }
  hold = null;
}

function onLiftDown(event) {
  if (!on() || event.button > 0) return;
  const card = event.target.closest?.('.snippet-item-card');
  if (!card || event.target.closest(LIFT_SKIP)) return;
  if (card.closest('#moment-album-layer')) return;
  hold = {
    card,
    x: event.clientX,
    y: event.clientY,
    lifted: false,
    timer: setTimeout(() => {
      if (!hold || hold.card !== card) return;
      hold.lifted = true;
      if (tier() === 'none') {
        card.classList.add('pl-lifted');
        return;
      }
      card.classList.add('pl-lifted');
    }, MOMENTS_MOTION.holdMs),
  };
}

function onLiftMove(event) {
  if (!hold || hold.lifted) return;
  if (Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > MOMENTS_MOTION.holdSlop) dropHold();
}

function onLiftClick(event) {
  if (!swallow) return;
  if (!event.target.closest?.('.snippet-item-card')) return;
  event.preventDefault();
  event.stopPropagation();
  swallow = false;
}

function onLiftMenu(event) {
  if (hold?.lifted) event.preventDefault();
}

/* ── DOM 旁听 ───────────────────────────────────────────────────── */
function watchDom() {
  let raf = 0;
  let needShot = false;
  let needSave = false;
  let needLayers = false;
  const kick = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (needShot) { needShot = false; safe(playShotIn); }
      if (needSave) { needSave = false; safe(playSaveToTop); }
      if (needLayers) { needLayers = false; safe(() => prepareLayers(document.getElementById('screen-snippets') || document)); }
    });
  };
  new MutationObserver(records => {
    if (!on()) return;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (
          node.matches?.('.snippet-photo-cell, #snippet-photo-grid, .snippet-photo-grid-inner, #quick-photo-preview > img')
          || node.querySelector?.('.snippet-photo-cell')
        ) needShot = true;
        if (
          node.matches?.('.snippet-item-card, #screen-snippets, .snippets-stream-sheet, .snippet-day-section')
          || node.querySelector?.('.snippet-item-card')
        ) {
          needSave = true;
          needLayers = true;
        }
      }
    }
    if (needShot || needSave || needLayers) kick();
  }).observe(document.body, { childList: true, subtree: true });
}

let installed = false;
export function installMomentsMotion() {
  if (!hasDom || installed) return;
  installed = true;
  safe(() => {
    document.addEventListener('click', rememberShot, true);
    document.addEventListener('submit', rememberSave, true);
    document.addEventListener('click', rememberQuickSave, true);
    document.addEventListener('pointerdown', onLiftDown, { passive: true });
    document.addEventListener('pointermove', onLiftMove, { passive: true });
    document.addEventListener('pointerup', dropHold, { passive: true });
    document.addEventListener('pointercancel', dropHold, { passive: true });
    document.addEventListener('click', onLiftClick, true);
    document.addEventListener('contextmenu', onLiftMenu);
    watchDom();
    prepareLayers(document.getElementById('screen-snippets') || document);
  });
}
