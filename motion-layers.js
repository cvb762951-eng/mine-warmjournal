/* ============================================================================
 * motion-layers.js · 二级页与弹层的共用动效底座（清简主题）
 *
 * 方案出处：PR #36 docs/design-upgrade-plan.md 第 9 节（Z1–Z4）与第 8 节 S2 / S3。
 *   Z1 原位展开：二级页从被点的行 / 卡原位展开，标题飞到导航栏；返回时原路收回。
 *   Z2 右滑返回：左缘 24px 或左侧 60% 区域右拖，松手按速度交给弹簧。
 *   Z3 弹层下拉：按住面板往下拉，背后页面同进度缩小、遮罩变淡；按速度关闭或弹回。
 *   Z4 内容依次浮现：二级页 / 弹层里的前几项依次浮出来。
 *
 * 约定（与 motion.js 一致）：
 *   - 只动 transform / opacity；每帧最多写 3 个元素，不往祖先写 CSS 变量。
 *   - 不改 core.js 的 openSubpage / closeSubpage / modal / closeModal：
 *     打开靠观察 .subpage-layer.active / #modal-layer.open，关闭靠点现有返回按钮或遮罩。
 *   - 三档：rich / lite / none（none = 系统「减弱动态效果」）。
 *     手势本身三档都跟手；none 松手直接到终点，lite 去掉背景缩放 / 视差。
 *   - 不碰照片：幽灵是空白色块，标题只做等比缩放，照片不参与任何非等比变换。
 *   - 任何一步出错都只退化成"没有动画"，不影响返回和关闭本身。
 * ========================================================================== */
import { SpringODE, prefersReducedMotion } from './motion.js';
import { installVaultMotion, noteLongFrame } from './motion-vault.js';
import { installDialogMotion } from './motion-dialogs.js';
import { installMomentsMotion } from './motion-moments.js';

/* ── 参数（照抄方案 9.1）──────────────────────────────────────────── */
export const LAYER_MOTION = {
  swipe: { edge: 24, edgeSlop: 8, pageRatio: 0.6, pageSlop: 12, doneV: 520, doneP: 0.35, keepV: -160, stiffness: 360, damping: 38, parallax: 20, dim: 0.12 },
  sheet: { slop: 6, head: 56, rubberMax: 40, rubberK: 120, project: 0.18, closeV: 900, closeMin: 110, closeRatio: 0.28, stiffness: 520, damping: 40, minMs: 140, maxMs: 260, lift: 10, shrink: 0.06, medium: 0.52, large: 0.92 },
  expand: { ms: 440, ease: 'cubic-bezier(.32,.72,0,1)', fadeMs: 200, fadeDelay: 220, backMs: 360, backDelay: 80, outMs: 160, waitMs: 400, maxArea: 0.6 },
  cascade: { sheet: { start: 60, step: 24, max: 5 }, push: { start: 140, step: 28, max: 6 }, expand: { start: 200, step: 28, max: 6 } },
};

/* ── 纯函数（tests/motion-layers.test.mjs 锁定）───────────────────── */

/** 三档：显式写在 <html data-pl-motion> 上的优先；用户选了"完整"再优先；减弱动态效果 → none；
   会话降档 → lite；低端机 → lite。
   ⚠️ 顺序很重要：`override === 'rich'` 必须排在 `reduced` **前面** —— 那是用户在 App 里
   明确选的「完整动效」（设置 → 外观与偏好 → 动效），要压过系统的「减弱动态效果」。
   2026-10-15：cvb 手机开着"减弱动态效果"导致 App 里动画全没了，而他手写的预览页没读这个开关、
   一直很好看，于是给 App 加了用户可选的开关（默认仍跟随系统）。 */
export function motionTier({ override = '', reduced = false, deviceMemory = 0, cores = 0, sessionLite = false } = {}) {
  if (['none', 'lite'].includes(override)) return override;
  if (override === 'rich') return override;
  if (reduced) return 'none';
  if (sessionLite) return 'lite';
  if ((deviceMemory && deviceMemory <= 3) || (cores && cores <= 4)) return 'lite';
  return 'rich';
}

/** 1s 窗内 >3 次 dt>32ms 降到 sessionLite。不写存储，不改 vault 语义。 */
export function sampleSessionJank({
  animating = false,
  sessionLite = false,
  state = { windowStart: 0, long: 0, tier: 'rich' },
  dt = 0,
  now = 0,
} = {}) {
  if (sessionLite || !animating) {
    return { sessionLite: Boolean(sessionLite), state, watching: false };
  }
  const next = noteLongFrame({
    windowStart: state?.windowStart ?? now,
    long: state?.long || 0,
    tier: 'rich',
  }, dt, now);
  const isLite = next.tier === 'lite';
  return { sessionLite: isLite, state: next, watching: !isLite };
}

/** 右滑时底页插值：从 -parallax% 插值到 0。与 Opus「底页 −20%×(1−p)」一致。 */
export function swipeUnderTransform(p, parallax = LAYER_MOTION.swipe.parallax) {
  return `translate3d(${(-parallax * (1 - p)).toFixed(2)}%, 0, 0)`;
}

/** 最近 100ms 的平均速度（px/s）。samples: [[timeStamp, value], ...] */
export function velocityOf(samples = []) {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const first = samples.find(s => last[0] - s[0] <= 100) || samples[0];
  const dt = last[0] - first[0];
  return dt > 0 ? ((last[1] - first[1]) / dt) * 1000 : 0;
}

/** 橡皮筋：超出范围时阻力越来越大，最多 40px。 */
export const rubber = d => (d <= 0 ? 0 : LAYER_MOTION.sheet.rubberMax * (1 - 1 / (1 + d / LAYER_MOTION.sheet.rubberK)));

/** 右滑返回起手区：'edge'（x ≤ 24）/ 'page'（x < 60% 屏宽）/ null。 */
export function swipeZone(x, width) {
  const s = LAYER_MOTION.swipe;
  if (x <= s.edge) return 'edge';
  if (x < width * s.pageRatio) return 'page';
  return null;
}

/** 起手后是否接管：'wait' 还没到判定距离；'lock' 接管；'abort' 交还给滚动。 */
export function swipeIntent({ dx = 0, dy = 0, zone = 'edge' } = {}) {
  const s = LAYER_MOTION.swipe;
  if (Math.hypot(dx, dy) < (zone === 'edge' ? s.edgeSlop : s.pageSlop)) return 'wait';
  const horizontal = dx > 0 && (zone === 'edge' ? dx > Math.abs(dy) : dx > 2 * Math.abs(dy));
  return horizontal ? 'lock' : 'abort';
}

/** 松手：v > 520px/s，或拖过 35% 且没有明显往回甩（v > −160），就完成返回。 */
export function swipeShouldComplete({ x = 0, width = 1, velocity = 0 } = {}) {
  const s = LAYER_MOTION.swipe;
  const p = x / Math.max(1, width);
  return velocity > s.doneV || (p > s.doneP && velocity > s.keepV);
}

/** 弹层分档几何（translateY 坐标，0 = 完全展开）。没声明分档时只有一档。 */
export function sheetGeometry({ height = 0, viewport = 0, detents = false } = {}) {
  const s = LAYER_MOTION.sheet;
  const large = detents ? Math.max(0, height - viewport * s.large) : 0;
  const medium = detents ? Math.max(0, height - viewport * s.medium) : 0;
  return { h: height, large, medium, closed: height };
}

/** 下拉进度 p：中档及以上为 1，完全关掉为 0。 */
export function sheetProgress(y, geo) {
  const span = Math.max(1, geo.closed - geo.medium);
  return Math.min(1, Math.max(0, 1 - (y - geo.medium) / span));
}

/** 跟手位置：高于最高档时走橡皮筋。 */
export function sheetFollow(base, dy, geo) {
  const y = base + dy;
  return y < geo.large ? geo.large - rubber(geo.large - y) : y;
}

/** 松手去哪：投影 y + v × 0.18s，取最近一档；关闭还要 v > 900 或下拉 > max(110, 可见高 × 28%)。 */
export function sheetRelease({ y = 0, velocity = 0, geo }) {
  const s = LAYER_MOTION.sheet;
  const proj = y + velocity * s.project;
  const { large, medium, closed } = geo;
  let target = [large, medium, closed].reduce((a, b) => (Math.abs(b - proj) < Math.abs(a - proj) ? b : a));
  const pulled = y - medium;
  if (target === closed && !(velocity > s.closeV || pulled > Math.max(s.closeMin, (closed - medium) * s.closeRatio))) target = medium;
  return { target, close: target === closed };
}

/**
 * 右滑返回进行中又按下：飞出阶段不接手（返回照常做完）；
 * 只在往回弹时才停掉弹簧，改由新手势接管。
 */
export function swipePointerDownAction({ flyingOut = false, settling = false } = {}) {
  if (flyingOut) return 'ignore';
  if (settling) return 'retake';
  return 'begin';
}

/** 从面板的 inline transform 读出当前 translateY。回弹中途接手时用它，而不是跳回档位。 */
export function translateYOf(transform = '') {
  const text = String(transform || '');
  const d3 = /translate3d\(\s*[^,]+,\s*(-?[\d.]+)px/i.exec(text);
  if (d3) return Number(d3[1]);
  const y = /translateY\(\s*(-?[\d.]+)px/i.exec(text);
  return y ? Number(y[1]) : 0;
}

/**
 * 弹层关闭一开始就拒绝起手；回弹中途按下则从 currentY 接着拖，不清掉当前位置。
 */
export function sheetPointerDownAction({ closing = false, settling = false, currentY = 0 } = {}) {
  if (closing) return { kind: 'ignore' };
  if (settling) return { kind: 'resume', y: currentY };
  return { kind: 'begin' };
}

/** 关闭补间时长：clamp(4 × 剩余 / v, 140, 260)ms —— 起始斜率 4 的曲线刚好接住手指速度。 */
export function sheetCloseMs(remaining, velocity) {
  const s = LAYER_MOTION.sheet;
  return Math.round(Math.min(s.maxMs, Math.max(s.minMs, ((4 * Math.max(0, remaining)) / Math.max(velocity, 1)) * 1000)));
}

/** Z1 放弃条件：来源不完全在视口里，或面积超过屏幕 60%。 */
export function canExpandFrom(rect, viewport) {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return false;
  if (rect.left < 0 || rect.top < 0 || rect.right > viewport.width + 0.5 || rect.bottom > viewport.height + 0.5) return false;
  return rect.width * rect.height <= viewport.width * viewport.height * LAYER_MOTION.expand.maxArea;
}

/** 空白幽灵从 from 摆到 to 的 transform（transform-origin: 0 0）。幽灵里没有内容，非等比缩放不会拉伸任何东西。 */
export function ghostTransform(from, to) {
  const sx = from.width / to.width, sy = from.height / to.height;
  return `translate(${(from.left - to.left).toFixed(2)}px, ${(from.top - to.top).toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
}

/* ── 运行时 ─────────────────────────────────────────────────────── */
const hasDom = typeof document !== 'undefined';
const root = hasDom ? document.documentElement : null;
const on = () => root?.dataset.theme === 'plain';
const tier = () => (sessionLite && root?.dataset.plMotion !== 'none' ? 'lite' : (root?.dataset.plMotion || 'rich'));
const rich = () => on() && tier() === 'rich';
const moving = () => on() && tier() !== 'none' && !prefersReducedMotion();

let tierOwned = false;
let sessionLite = false;
let sessionJankState = { windowStart: 0, long: 0, tier: 'rich' };
let jankWatchDepth = 0;
let jankRaf = 0;
let jankLastTime = 0;

export function isSessionLite() { return sessionLite; }
export function resetSessionJank() {
  sessionLite = false;
  sessionJankState = { windowStart: 0, long: 0, tier: 'rich' };
  if (tierOwned && root) syncTier();
}

function jankLoop(now) {
  if (jankWatchDepth <= 0 || sessionLite || !rich()) {
    jankRaf = 0;
    jankLastTime = 0;
    return;
  }
  if (jankLastTime > 0) {
    const dt = now - jankLastTime;
    const res = sampleSessionJank({
      animating: true,
      sessionLite,
      state: sessionJankState,
      dt,
      now,
    });
    sessionJankState = res.state;
    if (res.sessionLite) {
      sessionLite = true;
      if (root) root.dataset.plMotion = 'lite';
      jankRaf = 0;
      jankLastTime = 0;
      return;
    }
  }
  jankLastTime = now;
  jankRaf = requestAnimationFrame(jankLoop);
}

export function beginJankWatch() {
  if (sessionLite || !rich()) return;
  jankWatchDepth += 1;
  if (jankWatchDepth === 1 && !jankRaf) {
    jankLastTime = 0;
    jankRaf = requestAnimationFrame(jankLoop);
  }
}

export function endJankWatch() {
  jankWatchDepth = Math.max(0, jankWatchDepth - 1);
  if (jankWatchDepth === 0 && jankRaf) {
    cancelAnimationFrame(jankRaf);
    jankRaf = 0;
    jankLastTime = 0;
  }
}

function syncTier() {
  if (!root) return;
  if (root.dataset.plMotion && !tierOwned) return;           // 预览页或别的模块显式指定时不覆盖
  tierOwned = true;
  root.dataset.plMotion = motionTier({
    override: root.dataset.plMotionExplicit || '',
    reduced: prefersReducedMotion(),
    deviceMemory: Number(navigator.deviceMemory) || 0,
    cores: Number(navigator.hardwareConcurrency) || 0,
    sessionLite,
  });
}

/** 用户在 App 里选的动效偏好（设置 → 外观与偏好 → 动效）：
    '' → 跟随系统（默认）；'full' → 始终完整（压过系统的"减弱动态效果"）；'off' → 关闭（最省电）。
    ⚠️ 写的是 `data-pl-motion-explicit` —— motion.js 的 canAnimate() 也认这一个口子，
      所以"完整"是真的完整，不只是 CSS 那边不关。 */
let motionPreferenceWatch = false;
export function applyMotionPreference(preference = '') {
  if (!root) return;
  const value = ['full', 'off'].includes(preference) ? preference : '';
  if (value === 'full') root.dataset.plMotionExplicit = 'rich';
  else if (value === 'off') root.dataset.plMotionExplicit = 'none';
  else delete root.dataset.plMotionExplicit;
  tierOwned = true;      // 用户的显式选择由我们来写，不许被后面的自动判定盖掉
  syncTier();
  /* 兜底：切回前台时再确认一次档位没被别的东西写回去（安卓 WebView 上宁可多写一次）。 */
  if (!motionPreferenceWatch && typeof document !== 'undefined') {
    motionPreferenceWatch = true;
    document.addEventListener('visibilitychange', () => { if (!document.hidden) syncTier(); });
  }
}

/** 当前真实生效的档位（设置界面里显示给人看，也方便排查"点了没生效"）。 */
export function describeMotionState() {
  const tier = root?.dataset?.plMotion || '';
  const explicit = root?.dataset?.plMotionExplicit || '';
  let reduced = false;
  try { reduced = root?.ownerDocument?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true; } catch { /* 忽略 */ }
  if (tier === 'rich') return explicit === 'rich' ? '现在：动画已全部打开（已压过手机的「减弱动态效果」）' : '现在：动画已全部打开';
  if (tier === 'none') return reduced ? '现在：被手机的「减弱动态效果」关着' : '现在：动画已关闭';
  if (tier === 'lite') return '现在：轻量动效（设备或会话降档）';
  return '现在：动画已全部打开';
}

/** 测试与调试用：现在到底是哪一档。 */
export function currentMotionTier() { return root?.dataset?.plMotion || ''; }

/** 用手指速度驱动一段弹簧；none 档直接到终点。返回取消函数。 */
function springTo(from, to, velocity, { stiffness, damping }, onUpdate, onDone) {
  if (!moving()) { onUpdate(to); onDone?.(); return () => {}; }
  const spring = new SpringODE({ mass: 1, stiffness, damping, precision: 0.5 });
  spring.onUpdate = value => onUpdate(value);
  spring.set(from);
  spring.onSettle = () => { onUpdate(to); onDone?.(); };
  spring.to(to, velocity);
  return () => spring.stop();
}

const safe = run => { try { return run(); } catch { return null; } };
const shell = () => document.querySelector('.phone-shell');
const appEl = () => document.getElementById('app');
const topLayer = () => [...document.querySelectorAll('.subpage-layer.active')].at(-1) || null;

export function setClass(el, name, on) {
  if (!el?.classList) return;
  if (typeof el.classList.contains === 'function') {
    const has = el.classList.contains(name);
    if (on && !has) el.classList.add(name);
    else if (!on && has) el.classList.remove(name);
  } else {
    if (on) el.classList.add?.(name);
    else el.classList.remove?.(name);
  }
}

export function removeClass(el, ...names) {
  if (!el?.classList) return;
  names.forEach(name => {
    if (typeof el.classList.contains === 'function') {
      if (el.classList.contains(name)) el.classList.remove(name);
    } else {
      el.classList.remove?.(name);
    }
  });
}

export function addClass(el, ...names) {
  if (!el?.classList) return;
  names.forEach(name => {
    if (typeof el.classList.contains === 'function') {
      if (!el.classList.contains(name)) el.classList.add(name);
    } else {
      el.classList.add?.(name);
    }
  });
}

function dimNode() {
  const host = shell();
  if (!host) return null;
  let dim = host.querySelector(':scope > .pl-subpage-dim');
  if (!dim) {
    dim = document.createElement('div');
    dim.className = 'pl-subpage-dim';
    dim.setAttribute('aria-hidden', 'true');
    host.append(dim);
  }
  return dim;
}

/* ── Z4 内容依次浮现 ───────────────────────────────────────────── */
function cascadeItems(container) {
  if (!container) return [];
  if (container.classList.contains('modal')) return [...container.children];
  const kids = [...container.children].filter(el => !el.matches('.subpage-nav-bar, nav, script, style'));
  // 二级页通常是「导航 + 一个内容容器」：浮现的是容器里的子项。
  if (kids.length === 1 && kids[0].children.length) return [...kids[0].children];
  return kids;
}

function cascade(container, kind) {
  if (!moving() || !container) return;
  const cfg = LAYER_MOTION.cascade[kind];
  const items = cascadeItems(container).slice(0, cfg.max);
  if (!items.length) return;
  items.forEach((el, i) => {
    addClass(el, 'pl-rise-item');
    el.style.setProperty('--pl-ci', i);
  });
  container.style.setProperty('--pl-c0', `${cfg.start}ms`);
  addClass(container, 'pl-cascade', `pl-cascade-${kind}`);
  setTimeout(() => {
    removeClass(container, 'pl-cascade', `pl-cascade-${kind}`);
    container.style.removeProperty('--pl-c0');
    items.forEach(el => { removeClass(el, 'pl-rise-item'); el.style.removeProperty('--pl-ci'); });
  }, cfg.start + cfg.step * cfg.max + 300);
}

/* ── Z1 原位展开 + 标题飞行 ────────────────────────────────────── */
const SOURCE = 'button, a, [role="button"], [data-action], .settings-row, .card, li';
const NO_EXPAND = '[data-habit-detail], .floating-dock, .subpage-layer, #modal-layer, [data-no-expand]';
const TITLE_IN = ':scope b, :scope strong, :scope .entry-title, :scope .row-title, :scope h3, :scope h2';
const NAV_TITLE = '.subpage-nav-title';
const EXPAND_TO = layer => {
  const body = layer.querySelector(':scope > .subpage-body, :scope > main, :scope > .course-page');
  const first = body ? body.firstElementChild : [...layer.children].find(el => !el.matches('.subpage-nav-bar, nav'));
  return first && first.getBoundingClientRect().height > 0 ? first : null;
};

let pendingSource = null;           // { el, rect, at }
const expanded = new WeakMap();      // layer → { source, title }
const running = new WeakMap();       // layer → { anims, nodes }：还在跑的展开动画，收回时先停掉

function stopExpand(layer) {
  const r = running.get(layer);
  if (!r) return;
  running.delete(layer);
  r.anims.forEach(a => safe(() => a.cancel()));
  r.nodes.forEach(n => n.remove());
  removeClass(layer, 'pl-expand-in', 'pl-title-pending');
  endJankWatch();
}

function markZ1Pending() { const s = shell(); if (s) addClass(s, 'pl-z1-pending'); }
function clearZ1Pending() { const s = shell(); if (s) removeClass(s, 'pl-z1-pending'); }
function markZ1Open() { const s = shell(); if (!s) return; addClass(s, 'pl-z1-open'); removeClass(s, 'pl-z1-pending'); }
function clearZ1() { const s = shell(); if (s) removeClass(s, 'pl-z1-open', 'pl-z1-pending'); }

function rememberSource(event) {
  if (!on() || tier() === 'none') return;
  const el = event.target.closest?.(SOURCE);
  if (!el || el.closest(NO_EXPAND) || !el.closest('#app')) return;
  // 按下时只记元素，位置在 click 时才量（按下不一定是点击，省一次强制布局）。
  pendingSource = { el, rect: event.type === 'click' ? el.getBoundingClientRect() : null, at: performance.now() };
  // 先挂 pending：随后 .active 出现时不要让 #app 先左移 20%，否则 Z1 收回时又弹回会卡一下。
  markZ1Pending();
  clearTimeout(rememberSource._t);
  rememberSource._t = setTimeout(() => {
    if (pendingSource && performance.now() - pendingSource.at >= LAYER_MOTION.expand.waitMs) {
      pendingSource = null;
      clearZ1Pending();
    }
  }, LAYER_MOTION.expand.waitMs + 50);
}

function textRect(el) {
  const node = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
  if (!node) return null;
  const range = document.createRange();
  range.selectNodeContents(node);
  const rect = range.getBoundingClientRect();
  return rect.width ? { rect, text: node.textContent.trim() } : null;
}

function flyTitle(fromEl, layer, reverse = false) {
  return safe(() => {
    const from = fromEl.querySelector(TITLE_IN) || fromEl;
    const nav = layer.querySelector(NAV_TITLE);
    const navText = nav && (nav.querySelector('b') || nav);
    const t = textRect(from);
    if (!navText || !t) return null;
    const cs = getComputedStyle(from);
    const scale = parseFloat(getComputedStyle(navText).fontSize) / parseFloat(cs.fontSize);
    if (!(scale > 0.5 && scale < 2)) return null;
    const n = navText.getBoundingClientRect();
    const fly = document.createElement('span');
    fly.className = 'pl-fly-title';
    fly.textContent = t.text;
    Object.assign(fly.style, { left: `${t.rect.left}px`, top: `${t.rect.top}px`, font: cs.font, color: cs.color, letterSpacing: cs.letterSpacing });
    document.body.append(fly);
    const to = `translate(${(n.left + n.width / 2 - (t.rect.left + t.rect.width / 2)).toFixed(1)}px, ${(n.top + n.height / 2 - (t.rect.top + t.rect.height / 2)).toFixed(1)}px) scale(${scale.toFixed(3)})`;
    const E = LAYER_MOTION.expand;
    const frames = reverse ? [{ transform: to }, { transform: 'none' }] : [{ transform: 'none' }, { transform: to }];
    if (!reverse) addClass(layer, 'pl-title-pending');
    const anim = fly.animate(frames, { duration: reverse ? E.backMs : E.ms, delay: reverse ? E.backDelay : 0, easing: E.ease, fill: 'both' });
    anim.finished.catch(() => {}).then(() => {
      removeClass(layer, 'pl-title-pending');
      return fly.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 80, fill: 'forwards' }).finished;
    }).catch(() => {}).then(() => fly.remove());
    return anim;
  });
}

function makeGhost(rect, source) {
  const ghost = document.createElement('div');
  ghost.className = 'pl-expand-ghost';
  const bg = getComputedStyle(source).backgroundColor;
  const transparent = !bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)';
  Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  if (!transparent) ghost.style.backgroundColor = bg;
  document.body.append(ghost);
  return ghost;
}

export function clearCollapse(layer) {
  if (!layer) return;
  if (typeof layer.classList?.contains === 'function') {
    if (layer.classList.contains('pl-collapse-out')) layer.classList.remove('pl-collapse-out');
  } else {
    layer.classList?.remove?.('pl-collapse-out');
  }
  if (layer.style) layer.style.opacity = '';
  safe(() => {
    layer.getAnimations?.().forEach(a => a.cancel());
  });
}

function playExpand(layer) {
  clearCollapse(layer);
  const src = pendingSource;
  pendingSource = null;
  if (!src || performance.now() - src.at > LAYER_MOTION.expand.waitMs || !moving()) { clearZ1Pending(); return false; }
  const viewport = { width: innerWidth, height: innerHeight };
  if (!src.el.isConnected) { clearZ1Pending(); return false; }
  src.rect = src.rect || src.el.getBoundingClientRect();
  if (!canExpandFrom(src.rect, viewport)) { clearZ1Pending(); return false; }
  const target = EXPAND_TO(layer);
  if (!target) { clearZ1Pending(); return false; }
  const ok = Boolean(safe(() => {
    beginJankWatch();
    const E = LAYER_MOTION.expand;
    addClass(layer, 'pl-expand-in');
    const to = target.getBoundingClientRect();
    const ghost = makeGhost(to, src.el);
    addClass(src.el, 'pl-expand-source');
    const title = flyTitle(src.el, layer);
    const g1 = ghost.animate([{ transform: ghostTransform(src.rect, to) }, { transform: 'none' }], { duration: E.ms, easing: E.ease, fill: 'both' });
    const f1 = layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: E.fadeMs, delay: E.fadeDelay, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'backwards' });
    const rec = { anims: [g1, f1, title].filter(Boolean), nodes: [ghost] };
    running.set(layer, rec);
    g1.finished.then(() => {
      ghost.style.willChange = 'auto';
      return ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100, fill: 'forwards' }).finished;
    }).catch(() => {}).then(() => ghost.remove());
    f1.finished.catch(() => {}).then(() => {
      if (running.get(layer) === rec) running.delete(layer);
      removeClass(layer, 'pl-expand-in');
      endJankWatch();
    });
    expanded.set(layer, { source: src.el });
    markZ1Open();                                                 // 原位展开：底页不走推入左移
    return true;
  }));
  if (!ok) { clearZ1Pending(); endJankWatch(); }
  return ok;
}

function playCollapse(layer, info) {
  const E = LAYER_MOTION.expand;
  const source = info.source;
  stopExpand(layer);                                              // 展开还没跑完就返回：先停掉，避免两个影子块
  // Z1 打开时底页没左移；这里清标记，避免之后普通推入被挡住。
  clearZ1();
  const revealSource = () => { removeClass(source, 'pl-expand-source'); };
  const clearLayer = () => {
    removeClass(layer, 'pl-collapse-out');
    if (layer.style.opacity) layer.style.opacity = '';
  };
  // 收尾：先钉住 opacity:0 再撤 WAAPI fill，避免 fade.cancel() 把二级页闪回一帧。
  const endCollapse = fade => {
    layer.style.opacity = '0';
    try { fade?.cancel(); } catch { /* ignore */ }
    clearLayer();
  };
  if (!moving() || !source.isConnected || layer.classList.contains('pl-swiped')) {
    // 右滑出去的页面不再缩回原卡：原卡 160ms 淡入。
    if (source.isConnected && moving()) source.animate([{ opacity: 0 }, { opacity: 1 }], { duration: E.outMs, fill: 'backwards' });
    revealSource();
    clearLayer();
    return;
  }
  safe(() => {
    const from = source.getBoundingClientRect();
    if (!canExpandFrom(from, { width: innerWidth, height: innerHeight })) { revealSource(); clearLayer(); return; }
    const target = EXPAND_TO(layer);
    const to = target ? target.getBoundingClientRect() : null;
    addClass(layer, 'pl-collapse-out');                       // 原地淡出，不再右滑出去
    const fade = layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: E.outMs, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    flyTitle(source, layer, true);

    let ghost = null;
    let done = false;
    let fallbackTimer = null;
    const cleanup = () => {
      if (done) return;
      done = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      revealSource();
      if (ghost) safe(() => ghost.remove());
      endCollapse(fade);
    };

    fallbackTimer = setTimeout(cleanup, E.outMs + E.backMs + 500);

    if (!to || !to.width) {
      fade.finished.catch(() => {}).then(cleanup);
      return;
    }
    const createdGhost = makeGhost(to, source);
    ghost = createdGhost;
    // 时序照方案：幽灵缩回 → 原卡复现 → 撤 will-change → 幽灵淡出 → 清层。
    // 不在幽灵位移结束的同一帧 cancel fade + 拆 ghost，避免收完回主页那一下卡顿。
    createdGhost.animate([{ transform: 'none' }, { transform: ghostTransform(from, to) }], { duration: E.backMs, delay: E.backDelay, easing: E.ease, fill: 'both' })
      .finished.catch(() => {}).then(() => {
        revealSource();
        createdGhost.style.willChange = 'auto';
        return createdGhost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100, fill: 'forwards' }).finished;
      })
      .catch(() => {})
      .then(cleanup);
  }) ?? (revealSource(), clearLayer());
}

/* 观察二级页的 active 切换：打开 → 展开 / 浮现；关闭 → 收回。 */
function watchSubpages() {
  const seen = new WeakSet();
  const handle = layer => {
    const active = layer.classList.contains('active');
    if (active && layer.classList.contains('pl-collapse-out')) {
      clearCollapse(layer);
    }
    if (active && !seen.has(layer)) {
      seen.add(layer);
      dimNode();
      const expandedIn = playExpand(layer);
      cascade(layer, expandedIn ? 'expand' : 'push');
    } else if (!active && seen.has(layer)) {
      seen.delete(layer);
      if (!swipeActive) tidySwipe();
      const info = expanded.get(layer);
      expanded.delete(layer);
      if (info) playCollapse(layer, info);
    }
  };
  // 只盯 .subpage-layer 自己的 class；body 只看增删节点，不再监听全页所有元素的 class 变化。
  const watched = new WeakSet();
  const classes = new MutationObserver(records => { if (on()) records.forEach(r => handle(r.target)); });
  const track = layer => {
    if (watched.has(layer)) return;
    watched.add(layer);
    classes.observe(layer, { attributes: true, attributeFilter: ['class'] });
    if (on()) handle(layer);
  };
  const scan = n => {
    if (n.nodeType !== 1) return;
    if (n.classList.contains('subpage-layer')) track(n);
    n.querySelectorAll?.('.subpage-layer').forEach(track);
  };
  document.querySelectorAll('.subpage-layer').forEach(track);
  new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(scan)))
    .observe(document.body, { subtree: true, childList: true });
}

/* ── Z2 右滑返回 ─────────────────────────────────────────────── */
const BACK_BUTTON = '.subpage-back-btn, [data-subpage-close]';
const NO_SWIPE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-no-swipe-back], #background-preview, [data-nav-drag], .journal-deck, .moment-album-stack, #moment-album-layer, video, canvas, img';

export let swipeActive = false;
export function isSwipeActive() { return swipeActive; }

function scrollsX(el, stop) {
  for (let n = el; n && n !== stop; n = n.parentElement) {
    const ox = getComputedStyle(n).overflowX;
    if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 1) return true;
  }
  return false;
}

function paintSwipe(s, x) {
  const p = Math.min(1, Math.max(0, x / s.W));
  s.layer.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`;
  if (rich() && s.under) {
    s.under.style.transform = swipeUnderTransform(p, LAYER_MOTION.swipe.parallax);
    if (s.underIsSubpage) s.under.style.setProperty('--pl-dim', (1 - p).toFixed(3));
  }
  if (s.dim) s.dim.style.opacity = (1 - p).toFixed(3);
}

export function tidySwipe(s = null) {
  if (typeof document === 'undefined') return;
  if (s?.jankWatched) {
    s.jankWatched = false;
    endJankWatch();
  }
  document.querySelectorAll('.pl-swipe-under').forEach(el => {
    el.classList.remove('pl-swipe-under');
    el.style.transform = '';
    el.style.opacity = '';
    el.style.removeProperty?.('--pl-dim');
    el.style.willChange = '';
  });
  const targets = [s?.layer, s?.under, s?.dim, appEl()].filter(Boolean);
  targets.forEach(el => {
    el.style.transform = '';
    el.style.opacity = '';
    el.style.removeProperty?.('--pl-dim');
    el.style.willChange = '';
  });
  s?.layer?.classList.remove('pl-swiping', 'pl-swiped');
  if (s) s.under?.classList.remove('pl-swipe-under');
  document.querySelectorAll('.subpage-layer:is(.pl-swiping, .pl-swiped)').forEach(el => {
    el.classList.remove('pl-swiping', 'pl-swiped');
  });
  shell()?.classList.remove('pl-swiping');
}

function installSwipeBack() {
  const INTERACTIVE = 'button, a[href], [role="button"], label, summary, select, [onclick], [data-action], .subpage-back-btn, [tabindex]:not([tabindex="-1"])';
  let g = null;
  let settle = null;                                              // 还在跑的回弹：{ stop, s, flyingOut }
  const tidy = s => tidySwipe(s);
  const stopSettle = () => {
    if (!settle) return;
    const p = settle;
    settle = null;
    p.stop();
    tidy(p.s);
  };
  document.addEventListener('pointerdown', e => {
    if (!on() || e.button > 0) return;
    if (g) {
      const s = g;
      g = null;
      tidy(s);
      swipeActive = false;
    }
    const action = swipePointerDownAction({ flyingOut: Boolean(settle?.flyingOut), settling: Boolean(settle) });
    if (action === 'ignore') return;                                    // 飞出阶段不接受新手势，返回会做完
    if (action === 'retake' && settle) {
      stopSettle();
    }
    const layer = e.target.closest?.('.subpage-layer.active');
    if (!layer || layer !== topLayer() || document.querySelector('#modal-layer.open')) return;
    if (e.target.closest(NO_SWIPE) || scrollsX(e.target, layer)) return;
    const box = layer.getBoundingClientRect();
    const zone = swipeZone(e.clientX - box.left, box.width);
    if (!zone) return;
    const ctrl = e.target.closest?.(INTERACTIVE);
    const inCtrl = Boolean(ctrl && layer.contains(ctrl));
    if (inCtrl && zone === 'page') return;
    g = { layer, W: box.width, zone, x0: e.clientX, y0: e.clientY, id: e.pointerId, locked: false, samples: [[e.timeStamp, 0]], x: 0, raf: 0 };
    if (inCtrl && zone === 'edge') g.onControl = true;
  }, { capture: true, passive: true });

  document.addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (!g.locked) {
      if (g.onControl && (dx < 24 || dx <= 2 * Math.abs(dy))) return;
      const intent = swipeIntent({ dx, dy, zone: g.zone });
      if (intent === 'wait') return;
      if (intent === 'abort') {
        const s = g;
        g = null;
        tidy(s);
        swipeActive = false;
        return;
      }
      g.locked = true;
      swipeActive = true;
      safe(() => g.layer.setPointerCapture?.(e.pointerId));
      const activeLayers = [...document.querySelectorAll('.subpage-layer.active')];
      const currIndex = activeLayers.indexOf(g.layer);
      const underSubpage = currIndex > 0 ? activeLayers[currIndex - 1] : null;
      g.under = underSubpage || appEl();
      g.underIsSubpage = Boolean(underSubpage);
      g.under?.classList.add('pl-swipe-under');
      g.dim = underSubpage ? null : dimNode();
      g.layer.classList.add('pl-swiping');
      shell()?.classList.add('pl-swiping');
      g.jankWatched = true;
      beginJankWatch();
    }
    g.x = Math.max(0, dx);
    g.samples.push([e.timeStamp, g.x]);
    if (g.samples.length > 12) g.samples.shift();
    if (!g.raf) g.raf = requestAnimationFrame(() => { if (g) { g.raf = 0; paintSwipe(g, g.x); } });
  }, { passive: true });

  const end = e => {
    if (!g || e.pointerId !== g.id) return;
    const s = g;
    g = null;
    if (s.raf) cancelAnimationFrame(s.raf);
    if (!s.locked) {
      tidy(s);
      swipeActive = false;
      return;
    }
    swallowNextClick();
    const isCancel = e.type === 'pointercancel';
    if (isCancel) {
      tidy(s);
      swipeActive = false;
      return;
    }
    const v = velocityOf(s.samples);
    const done = swipeShouldComplete({ x: s.x, width: s.W, velocity: v });
    const S = LAYER_MOTION.swipe;
    let stopped = false;
    const stopSpring = springTo(s.x, done ? s.W : 0, v, { stiffness: S.stiffness, damping: S.damping }, x => {
      if (!stopped) paintSwipe(s, x);
    }, () => {
      if (settle !== job || stopped) return;                                 // 已被新手势停掉
      settle = null;
      // 回弹期间可能已被实体返回键 / 点返回关掉：这一层不再是最上层就不再点返回，免得多关一层。
      if (done) {
        if (s.layer.classList.contains('active') && s.layer === topLayer()) {
          s.layer.classList.add('pl-swiped');                         // 跳过默认推出动画
          const back = s.layer.querySelector(BACK_BUTTON);
          if (back) back.click();
          else if (typeof globalThis.Mine?.closeSubpage === 'function') globalThis.Mine.closeSubpage();
        }
        requestAnimationFrame(() => requestAnimationFrame(() => {
          tidy(s);
          swipeActive = false;
        }));
      } else {
        tidy(s);
        swipeActive = false;
      }
    });
    const job = {
      s,
      stop: () => {
        stopped = true;
        stopSpring();
        tidy(s);
        swipeActive = false;
      },
      flyingOut: done,
    };
    settle = job;
  };
  document.addEventListener('pointerup', end, { passive: true });
  document.addEventListener('pointercancel', end, { passive: true });
  window.addEventListener?.('mine-system-back', () => {
    stopSettle();
    if (g) { const s = g; g = null; tidy(s); }
    else { tidy(); }
    swipeActive = false;
  });
}

let swallowTimer = null;
let currentSwallow = null;

export function swallowNextClick(targetDoc = (typeof document !== 'undefined' ? document : null), timeoutMs = 350) {
  if (!targetDoc) return;
  if (currentSwallow) {
    targetDoc.removeEventListener('click', currentSwallow, { capture: true });
    clearTimeout(swallowTimer);
    currentSwallow = null;
    swallowTimer = null;
  }
  const expiry = Date.now() + timeoutMs;
  const stop = ev => {
    if (Date.now() > expiry) {
      targetDoc.removeEventListener('click', stop, { capture: true });
      if (currentSwallow === stop) currentSwallow = null;
      return;
    }
    if (ev && ev.isTrusted === false) return;   // 只吞手指松开那一下，脚本触发的返回 / 关闭照常
    ev.stopPropagation?.();
    ev.preventDefault?.();
    targetDoc.removeEventListener('click', stop, { capture: true });
    clearTimeout(swallowTimer);
    if (currentSwallow === stop) currentSwallow = null;
  };
  currentSwallow = stop;
  targetDoc.addEventListener('click', stop, { capture: true });
  swallowTimer = setTimeout(() => {
    targetDoc.removeEventListener('click', stop, { capture: true });
    if (currentSwallow === stop) {
      currentSwallow = null;
      swallowTimer = null;
    }
  }, timeoutMs);
}

/* ── Z3 弹层下拉 + S3 景深后退 ─────────────────────────────────── */
const SHEET_LAYER = '#modal-layer';
const NO_DRAG = '.alarm-modal, .confirm-sheet, .vault-feed-modal, .vault-photo-modal, .vault-video-preparing, .snippet-video-modal, [data-no-sheet-drag]';
const NO_DRAG_TARGET = 'input[type="range"], textarea, [contenteditable=""], [contenteditable="true"], canvas, video, [data-no-sheet-drag]';

let sheetMoveHook = () => {};

/** 从触点往上查到 stop（含）：任何一层已经往下滚过就返回 true。 */
export function scrolledWithin(el, stop) {
  for (let n = el; n; n = n.parentElement) {
    if (n.scrollTop > 0) return true;
    if (n === stop) break;
  }
  return false;
}

function watchSheets() {
  let lastSheet = null;
  const resetSheet = s => {
    if (!s) return;
    s.style.transform = '';
    delete s.dataset.plDetent;
  };
  new MutationObserver(() => {
    const layer = document.querySelector(SHEET_LAYER);
    const isOpen = Boolean(layer?.classList.contains('open'));
    if (!on() || !isOpen) {
      if (root?.classList.contains('pl-sheet-open')) root?.classList.remove('pl-sheet-open');
      if (layer?.classList.contains('pl-sheet')) layer?.classList.remove('pl-sheet');
      sheetMoveHook(null);
      if (lastSheet) {
        resetSheet(lastSheet);
        lastSheet = null;
      }
      return;
    }
    // 等这一帧布局完再判断是不是贴底弹层（打开动画从 translateY(100%) 起步，用 offset 而不是 rect）。
    requestAnimationFrame(() => {
      const curLayer = document.querySelector(SHEET_LAYER);
      const curOpen = Boolean(curLayer?.classList.contains('open'));
      const sheet = curOpen ? curLayer.querySelector(':scope > .modal') : null;
      if (!curOpen || !sheet) {
        if (root?.classList.contains('pl-sheet-open')) root?.classList.remove('pl-sheet-open');
        if (curLayer?.classList.contains('pl-sheet')) curLayer?.classList.remove('pl-sheet');
        sheetMoveHook(null);
        if (lastSheet) {
          resetSheet(lastSheet);
          lastSheet = null;
        }
        return;
      }
      if (lastSheet && lastSheet !== sheet) {
        resetSheet(lastSheet);
      }
      const bottom = Boolean(sheet && !sheet.matches(NO_DRAG) && (getComputedStyle(curLayer).alignItems === 'flex-end' || Boolean(sheet.dataset.plDetents)) && sheet.offsetHeight < innerHeight * 0.97);
      if (root && root.classList.contains('pl-sheet-open') !== bottom) root.classList.toggle('pl-sheet-open', bottom);
      if (curLayer && curLayer.classList.contains('pl-sheet') !== bottom) curLayer.classList.toggle('pl-sheet', bottom);
      sheetMoveHook(bottom ? curLayer : null);
      if (sheet && sheet.dataset.plDetents && !sheet.dataset.plDetent) {
        sheet.dataset.plDetent = 'medium';
        const geo = sheetGeometry({ height: sheet.offsetHeight, viewport: innerHeight, detents: true });
        sheet.style.transform = `translate3d(0, ${geo.medium.toFixed(1)}px, 0)`;
        if (moving()) {
          sheet.animate(
            [{ transform: `translate3d(0, ${geo.closed}px, 0)` }, { transform: `translate3d(0, ${geo.medium.toFixed(1)}px, 0)` }],
            { duration: 320, easing: 'cubic-bezier(.32, .72, 0, 1)' }
          );
        }
      }
      if (sheet && sheet !== lastSheet) cascade(sheet, 'sheet');
      lastSheet = sheet;
    });
  }).observe(document.querySelector(SHEET_LAYER) || document.body, { attributes: true, attributeFilter: ['class'], childList: true });
}

function paintSheet(s, y) {
  const S = LAYER_MOTION.sheet;
  const p = sheetProgress(y, s.geo);
  s.sheet.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
  if (rich() && s.app) s.app.style.transform = `translateY(${(S.lift * p).toFixed(2)}px) scale(${(1 - S.shrink * p).toFixed(4)})`;
  if (s.scrim) s.scrim.style.opacity = p.toFixed(3);
}

function clearSheet(s) {
  [s.sheet, s.app].forEach(el => { if (el) el.style.transform = ''; });
  if (s.sheet) delete s.sheet.dataset.plDetent;
  s.scrim?.remove();
  if (s.layer?.classList.contains('pl-dragging')) s.layer.classList.remove('pl-dragging');
  if (root?.classList.contains('pl-sheet-dragging')) root.classList.remove('pl-sheet-dragging');
}

function closeSheetLikeScrim(layer) {
  // 和点遮罩走同一条路径（app.js 的委托会处理分享取消 / 普通关闭）。
  layer.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

let sheetSettle = null;                                           // 还在跑的弹层回弹：{ stop, s }
let sheetClosing = false;                                          // 关闭补间全程为真：这段时间 start 不起手
let sheetCloseToken = 0;

function stopSheetSettle() {
  if (!sheetSettle) return;
  const p = sheetSettle;
  sheetSettle = null;
  p.stop();
  clearSheet(p.s);
}

/** restore=true 表示手势被取消（多指 / 系统打断）：不关闭，回到起手时的位置。 */
function releaseSheet(s, y, v, restore = false) {
  const S = LAYER_MOTION.sheet;
  const { target, close } = restore ? { target: s.base, close: false } : sheetRelease({ y, velocity: v, geo: s.geo });
  if (close) {
    const token = ++sheetCloseToken;
    sheetClosing = true;                                               // 关闭一开始就锁住拖动，start 直接不起手
    const ms = moving() ? sheetCloseMs(s.geo.closed - y, v) : 0;
    const opts = { duration: ms, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' };
    const p0 = sheetProgress(y, s.geo);
    const anims = [
      s.sheet.animate([{ transform: `translate3d(0, ${y}px, 0)` }, { transform: `translate3d(0, ${s.geo.closed}px, 0)` }], opts),
      s.scrim && s.scrim.animate([{ opacity: p0 }, { opacity: 0 }], opts),
      rich() && s.app && s.app.animate([{ transform: s.app.style.transform || 'none' }, { transform: 'none' }], opts),
    ].filter(Boolean);
    const releaseClose = () => { if (token === sheetCloseToken) sheetClosing = false; };
    setTimeout(releaseClose, ms + 480);                              // 动画被拆掉时也不要把拖动永久锁死
    Promise.all(anims.map(a => a.finished.catch(() => {}))).then(() => {
      try {
        endJankWatch();
        if (!s.layer.classList.contains('pl-dragged')) s.layer.classList.add('pl-dragged');                          // 跳过默认关闭过渡
        if (root.classList.contains('pl-sheet-open')) root.classList.remove('pl-sheet-open');
        closeSheetLikeScrim(s.layer);
        requestAnimationFrame(() => {
          anims.forEach(a => a.cancel());
          clearSheet(s);
          if (s.layer.classList.contains('pl-dragged')) s.layer.classList.remove('pl-dragged');
          releaseClose();
        });
      } catch { releaseClose(); endJankWatch(); }
    });
    return;
  }
  const job = { s, stop: () => {} };
  sheetSettle = job;
  job.stop = springTo(y, target, v, { stiffness: S.stiffness, damping: S.damping }, yy => paintSheet(s, yy), () => {
    if (sheetSettle !== job) return;
    sheetSettle = null;
    endJankWatch();
    if (s.geo.large !== s.geo.medium) s.sheet.dataset.plDetent = target === s.geo.large ? 'large' : 'medium';
    if (target === 0) clearSheet(s);
    else {
      s.scrim?.remove();
      if (s.layer.classList.contains('pl-dragging')) s.layer.classList.remove('pl-dragging');
      if (root.classList.contains('pl-sheet-dragging')) root.classList.remove('pl-sheet-dragging');
    }
  });
}

function installSheetDrag() {
  let g = null;
  const start = (x, y, target, id, t) => {
    if (!on() || g) return;
    const layer = target.closest?.(`${SHEET_LAYER}.open.pl-sheet`);
    const sheet = layer && target.closest('.modal');
    const settling = Boolean(sheet && sheetSettle?.s.sheet === sheet);
    const decision = sheetPointerDownAction({
      closing: sheetClosing,
      settling,
      currentY: settling ? translateYOf(sheet.style.transform) : 0,
    });
    if (decision.kind === 'ignore') return;                     // 关闭补间中：不起手
    if (!sheet || sheet.parentElement !== layer || target.closest(NO_DRAG_TARGET)) return;
    const r = sheet.getBoundingClientRect();
    const inHead = y - r.top <= LAYER_MOTION.sheet.head;
    if (!inHead && !settling && scrolledWithin(target, sheet)) return;      // 面板或里面任何一层列表没滚到顶，先让它滚
    const geo = sheetGeometry({ height: sheet.offsetHeight, viewport: innerHeight, detents: Boolean(sheet.dataset.plDetents) });
    let base = sheet.dataset.plDetent === 'medium' ? geo.medium : geo.large;
    let carried = null;
    if (decision.kind === 'resume' && sheetSettle) {
      const p = sheetSettle;
      sheetSettle = null;
      p.stop();                                                   // 停弹簧，但保留当前位置的 transform
      base = decision.y;
      carried = p.s;
    }
    g = {
      layer, sheet, geo, base, inHead: decision.kind === 'resume' || inHead, x0: x, y0: y, id,
      locked: decision.kind === 'resume', samples: [[t, base]], y: base, raf: 0,
      app: carried?.app, scrim: carried?.scrim,
    };
  };
  const move = (x, y, t, prevent) => {
    if (!g) return;
    const dx = x - g.x0, dy = y - g.y0;
    if (!g.locked) {
      if (Math.hypot(dx, dy) < LAYER_MOTION.sheet.slop) {
        if (dy > 0 && dy >= Math.abs(dx)) prevent?.();               // 先挡住内容区在顶端的过度滚动
        return;
      }
      if (!(Math.abs(dy) > Math.abs(dx)) || (!g.inHead && dy < 0)) { g = null; return; }
      g.locked = true;
      beginJankWatch();
      g.app = appEl();
      const bg = getComputedStyle(g.layer).backgroundColor;
      g.scrim = document.createElement('div');
      g.scrim.className = 'pl-sheet-scrim';
      if (bg && bg !== 'rgba(0, 0, 0, 0)') g.scrim.style.backgroundColor = bg;
      g.layer.prepend(g.scrim);
      g.layer.classList.add('pl-dragging');
      root.classList.add('pl-sheet-dragging');
    }
    prevent?.();
    g.y = Math.min(g.geo.closed, sheetFollow(g.base, dy, g.geo));
    g.samples.push([t, g.y]);
    if (g.samples.length > 12) g.samples.shift();
    if (!g.raf) g.raf = requestAnimationFrame(() => { if (g) { g.raf = 0; paintSheet(g, g.y); } });
  };
  const end = cancelled => {
    if (!g) return;
    const s = g;
    g = null;
    if (s.raf) cancelAnimationFrame(s.raf);
    if (!s.locked) return;
    swallowNextClick();
    releaseSheet(s, s.y, cancelled ? 0 : velocityOf(s.samples), cancelled);
  };
  const ownTouch = e => g && [...e.changedTouches].some(tt => tt.identifier === g.id);

  // 触摸走 touch 事件：只有它能在接管时 preventDefault 掉面板自己的滚动。
  document.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { if (g) end(true); return; }   // 第二根手指：按取消收回遮罩和位移
    const t = e.touches[0];
    start(t.clientX, t.clientY, e.target, t.identifier, e.timeStamp);
  }, { capture: true, passive: true });
  // 非 passive 的 touchmove 只在贴底弹层打开时挂在 #modal-layer 上，平时不拖慢页面滚动。
  const onMove = e => {
    if (!g) return;
    const t = [...e.changedTouches].find(tt => tt.identifier === g.id);
    if (t) move(t.clientX, t.clientY, e.timeStamp, () => e.cancelable && e.preventDefault());
  };
  let host = null;
  sheetMoveHook = layer => {
    if (layer === host) return;
    host?.removeEventListener('touchmove', onMove, { capture: true });
    host = layer;
    host?.addEventListener('touchmove', onMove, { capture: true, passive: false });
  };
  document.addEventListener('touchend', e => { if (ownTouch(e)) end(false); }, { capture: true, passive: true });   // 只在最早那根手指抬起时结束
  document.addEventListener('touchcancel', e => { if (ownTouch(e)) end(true); }, { capture: true, passive: true });

  // 鼠标（电脑上看预览页）走 pointer。
  document.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button === 0) start(e.clientX, e.clientY, e.target, 'mouse', e.timeStamp); }, { capture: true, passive: true });
  document.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && g?.id === 'mouse') move(e.clientX, e.clientY, e.timeStamp); }, { passive: true });
  document.addEventListener('pointerup', e => { if (e.pointerType === 'mouse' && g?.id === 'mouse') end(false); }, { passive: true });
  document.addEventListener('pointercancel', e => { if (e.pointerType === 'mouse' && g?.id === 'mouse') end(true); }, { passive: true });
}

/* ── 入口 ─────────────────────────────────────────────────────── */
let installed = false;
export function installLayerMotion() {
  if (!hasDom || installed) return;
  installed = true;
  safe(() => {
    syncTier();
    matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', syncTier);
    document.addEventListener('pointerdown', rememberSource, { capture: true, passive: true });
    document.addEventListener('click', rememberSource, { capture: true, passive: true });
    watchSubpages();
    watchSheets();
    installSwipeBack();
    installSheetDrag();
    installVaultMotion();
    installDialogMotion();
    installMomentsMotion();
  });
}

