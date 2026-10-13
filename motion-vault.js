/* ============================================================================
 * motion-vault.js · 私密空间动效（清简主题）
 *
 * 方案：docs/private-space-motion.md。只旁听 DOM，不改加密、锁定时机、观看记录。
 * 私密空间是 #app 里的整页路由，不是二级页。
 * 只动 transform / opacity。三档 rich / lite / none（none = 减弱动态效果）。
 * 文件夹进入不做景深（背后页面不缩小）。照片飞行只用一个 scale。
 * ========================================================================== */
import { prefersReducedMotion } from './motion.js';

export const VAULT_MOTION = {
  folderDepth: false,
  aspectTolerance: 0.005,
  unlockMs: 420,
  fadeMs: 160,
  openMs: 420,
  backMs: 340,
  liteOpenMs: 320,
  liteBackMs: 240,
  bulkMs: 220,
  shieldMs: 260,
  p0Ms: 240,
  staggerStep: 24,
  staggerCap: 320,
};

/** 背后文件夹页不缩小。返回 1，调用处不再写 scale。 */
export function folderBackgroundScale() {
  return VAULT_MOTION.folderDepth ? 0.96 : 1;
}

/** rich = 缝隙分开 + 景深 + 弹性；lite = 淡入；none / 减弱动态 = 直接切换。 */
export function unlockMode(tierName) {
  if (tierName === 'none') return 'cut';
  if (tierName === 'lite') return 'fade';
  return 'split';
}

/** 两端显示框比例差超过 0.5% 时返回 null，调用方改为淡入，避免把照片拉开。 */
export function uniformFlightScale(from, to, tolerance = VAULT_MOTION.aspectTolerance) {
  if (!(from?.width > 0) || !(from?.height > 0) || !(to?.width > 0) || !(to?.height > 0)) return null;
  const a = from.width / from.height;
  const b = to.width / to.height;
  const drift = Math.abs(a - b) / Math.max(a, b);
  if (!(drift <= tolerance)) return null;
  return to.width / from.width;
}

/** 照片飞行：平移 + 单一 scale。比例不合就放弃。 */
export function flightTransform(from, to) {
  const scale = uniformFlightScale(from, to);
  if (scale == null) return null;
  const dx = to.left - from.left;
  const dy = to.top - from.top;
  return `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${scale.toFixed(4)})`;
}

/** 空白幽灵框可以非等比（里面没有照片）。 */
export function ghostFrameTransform(from, to) {
  if (!(from?.width > 0) || !(to?.width > 0)) return null;
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return `translate(${(to.left - from.left).toFixed(2)}px, ${(to.top - from.top).toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
}

/** (行 + 列) × step，首批不超过 cap。 */
export function cellDelay(index, cols = 2, step = VAULT_MOTION.staggerStep, start = 0, cap = VAULT_MOTION.staggerCap) {
  const width = Math.max(1, cols);
  const row = Math.floor(index / width);
  const col = index % width;
  return Math.min(cap, start + (row + col) * step);
}

/** 1 秒内超过 3 次长帧（>32ms）把 rich 降到 lite。不写存储，也不写全局属性。 */
export function noteLongFrame(state, dt, now) {
  const next = {
    windowStart: state?.windowStart ?? now,
    long: state?.long || 0,
    tier: state?.tier === 'lite' ? 'lite' : 'rich',
  };
  if (now - next.windowStart > 1000) {
    next.windowStart = now;
    next.long = 0;
  }
  if (dt > 32) next.long += 1;
  if (next.tier === 'rich' && next.long > 3) next.tier = 'lite';
  return next;
}

/**
 * 私密空间自己的档位。全局 lite / none 照旧；
 * 长帧降级只在还停在私密空间时生效，离开后本地降级作废。
 * 绝不改 <html data-pl-motion>。
 */
export function vaultMotionTier({ globalTier = 'rich', localTier = 'rich', inVault = true } = {}) {
  if (globalTier === 'none' || globalTier === 'lite') return globalTier;
  if (!inVault) return 'rich';
  return localTier === 'lite' ? 'lite' : 'rich';
}

/**
 * 只在私密空间动画播放期间采样。空闲帧不计数。
 * writeGlobal 永远是 false：降级留在 localTier。
 */
export function sampleVaultJank({
  inVault = false,
  animating = false,
  localTier = 'rich',
  state = { windowStart: 0, long: 0, tier: 'rich' },
  dt = 0,
  now = 0,
} = {}) {
  if (!inVault) {
    return {
      localTier: 'rich',
      state: { windowStart: now, long: 0, tier: 'rich' },
      watching: false,
      writeGlobal: false,
    };
  }
  if (!animating || localTier === 'lite') {
    return { localTier: localTier === 'lite' ? 'lite' : 'rich', state, watching: false, writeGlobal: false };
  }
  const next = noteLongFrame({
    windowStart: state?.windowStart ?? now,
    long: state?.long || 0,
    tier: 'rich',
  }, dt, now);
  return { localTier: next.tier, state: next, watching: next.tier !== 'lite', writeGlobal: false };
}

/**
 * 切走超过 lockAfter 且锁屏还没出现时，遮罩先留着，最多 maxWait。
 * 本次运行免密不会上锁，遮罩不用干等这段超时。
 */
export function shieldShouldHold({
  hiddenMs = 0,
  locked = false,
  waitedMs = 0,
  lockAfter = 300,
  maxWait = 600,
  passwordless = false,
} = {}) {
  if (passwordless) return false;
  if (!(hiddenMs >= lockAfter)) return false;
  if (locked) return false;
  return waitedMs < maxWait;
}

/** 筛选过渡最多带走视口里的前 cap 格，不克隆整张网格。 */
export function visibleItemIndexes(rects, viewportHeight, cap = 12) {
  const picked = [];
  for (let index = 0; index < rects.length; index += 1) {
    if (picked.length >= cap) break;
    const rect = rects[index];
    if (!rect) continue;
    if (rect.bottom > 0 && rect.top < viewportHeight) picked.push(index);
  }
  return picked;
}

/** 锁定过渡盖的是纯色块，不复制已解锁页面。 */
export function lockGhostSpec() {
  return { cloneContent: false, kind: 'plain-block' };
}

const hasDom = typeof document !== 'undefined';
const root = hasDom ? document.documentElement : null;
const plain = () => root?.dataset.theme === 'plain';
const globalTier = () => {
  if (prefersReducedMotion()) return 'none';
  const value = root?.dataset.plMotion;
  return value === 'lite' || value === 'none' ? value : 'rich';
};
const tier = () => vaultMotionTier({
  globalTier: globalTier(),
  localTier: localLite ? 'lite' : 'rich',
  inVault: hasDom && Boolean(document.querySelector('.private-vault-view')),
});
const SPRING = 'cubic-bezier(.34, 1.56, .64, 1)';
const EMPH = 'cubic-bezier(.32, .72, 0, 1)';
const OUT = 'cubic-bezier(.16, 1, .3, 1)';

const box = rect => rect && rect.width > 1 && rect.height > 1
  ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  : null;

function modeOf(view) {
  if (!view) return 'absent';
  if (view.classList.contains('vault-locked-view')) return 'locked';
  if (view.querySelector('#vault-back-folders')) return 'content';
  if (view.querySelector('.vault-folder-grid')) return 'folders';
  return 'other';
}

function snap(view) {
  if (!view?.classList?.contains('private-vault-view')) {
    return { mode: 'absent', filter: '', bulk: false, empty: false, title: '', cards: 0, items: 0, selected: [] };
  }
  return {
    mode: modeOf(view),
    filter: view.querySelector('[data-vault-media-filter][aria-pressed="true"]')?.getAttribute('data-vault-media-filter') || '',
    bulk: Boolean(view.querySelector('.vault-bulk-bar')),
    empty: Boolean(view.querySelector('.vault-empty')),
    title: view.querySelector('.vault-content-head strong')?.textContent || '',
    cards: view.querySelectorAll('.vault-folder-card').length,
    items: view.querySelectorAll('.vault-item').length,
    selected: [...view.querySelectorAll('.vault-item.selected [data-select-vault-item]')].map(el => el.dataset.selectVaultItem),
  };
}

function sameSnap(a, b) {
  if (!a || !b) return false;
  return a.mode === b.mode && a.filter === b.filter && a.bulk === b.bulk && a.empty === b.empty
    && a.title === b.title && a.cards === b.cards && a.items === b.items && a.selected.join('\n') === b.selected.join('\n');
}

let prev = null;
let prevView = null;
let lockRect = null;
let pendingOpen = null;
let pendingBack = null;
let pendingFilter = null;
let stack = [];
let statusWatch = null;
let lockPaperAt = 0;
let shield = null;
let localLite = false;
let jankOn = false;
let jankRaf = 0;
let jankUntil = 0;
let jankLast = 0;
let jankState = { windowStart: 0, long: 0, tier: 'rich' };
let hiddenAt = 0;
let shieldWait = 0;

function fresh(entry) {
  if (!entry) return null;
  if (performance.now() - entry.at > 1200) {
    entry.clone?.remove();
    return null;
  }
  return entry;
}

function stagger(nodes, { start = 0, step = VAULT_MOTION.staggerStep, cols = 2 } = {}) {
  const list = [...nodes || []].filter(Boolean);
  if (!list.length || tier() === 'none') return;
  noteVaultAnimation(tier() === 'lite' ? VAULT_MOTION.fadeMs : start + VAULT_MOTION.staggerCap + 220);
  if (tier() === 'lite') {
    list[0].parentElement?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: VAULT_MOTION.fadeMs, easing: 'ease', fill: 'backwards' });
    return;
  }
  list.forEach((el, index) => {
    el.classList.add('pv-rise');
    el.style.setProperty('--pv-d', `${cellDelay(index, cols, step, start)}ms`);
    el.addEventListener('animationend', () => {
      el.classList.remove('pv-rise');
      el.style.removeProperty('--pv-d');
    }, { once: true });
  });
}

function rememberLock(view) {
  const paper = view?.querySelector?.('.vault-lock-paper');
  const rect = box(paper?.getBoundingClientRect?.());
  if (rect) lockRect = rect;
}

function watchStatus(view) {
  statusWatch?.disconnect();
  statusWatch = null;
  const status = view?.querySelector?.('#vault-unlock-status');
  if (!status || !plain() || tier() === 'none') return;
  let last = status.textContent || '';
  statusWatch = new MutationObserver(() => {
    const text = status.textContent || '';
    if (text !== last && /验证指纹/.test(last) && /密码|未|失败|无法/.test(text)) {
      const paper = status.closest('.vault-lock-paper');
      paper?.classList.remove('pv-nudge');
      requestAnimationFrame(() => paper?.classList.add('pv-nudge'));
    }
    last = text;
  });
  statusWatch.observe(status, { subtree: true, characterData: true, childList: true });
}

function playEnter(view) {
  rememberLock(view);
  watchStatus(view);
  const paper = view.querySelector('.vault-lock-paper');
  const mark = view.querySelector('.vault-lock-mark');
  const mode = unlockMode(tier());
  if (mode === 'cut' || !paper) return;
  noteVaultAnimation(mode === 'fade' ? VAULT_MOTION.fadeMs : VAULT_MOTION.p0Ms + 420);
  if (mode === 'fade') {
    paper.animate([{ opacity: 0 }, { opacity: 1 }], { duration: VAULT_MOTION.fadeMs, easing: 'ease', fill: 'backwards' });
    return;
  }
  paper.animate(
    [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }],
    { duration: VAULT_MOTION.p0Ms, easing: OUT, fill: 'backwards' },
  );
  mark?.classList.add('pv-mark-once');
  mark?.addEventListener('animationend', () => {
    mark.classList.remove('pv-mark-once');
    if (tier() === 'rich' && mark.isConnected) mark.classList.add('pv-breath');
  }, { once: true });
}

function paperHost(paper, rect, split) {
  if (!paper || !rect) return null;
  const host = document.createElement('div');
  host.className = split ? 'pv-unlock' : 'pv-unlock pv-unlock-flat';
  host.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
  const put = parent => {
    const inner = document.createElement('div');
    inner.className = 'pv-half-inner';
    const clone = paper.cloneNode(true);
    clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    clone.style.margin = '0';
    clone.style.width = '100%';
    clone.style.height = '100%';
    inner.append(clone);
    parent.append(inner);
    return parent;
  };
  if (!split) {
    put(host);
    document.body.append(host);
    return host;
  }
  const top = document.createElement('div');
  top.className = 'pv-half pv-half-top';
  const bottom = document.createElement('div');
  bottom.className = 'pv-half pv-half-bottom';
  put(top);
  put(bottom);
  const seam = document.createElement('i');
  seam.className = 'pv-seam';
  host.append(top, bottom, seam);
  document.body.append(host);
  const ease = 'cubic-bezier(.34, 1.45, .64, 1)';
  top.animate(
    [{ transform: 'none', opacity: 1 }, { transform: 'translate3d(0,-32px,0) scale(1.03)', opacity: 0 }],
    { duration: VAULT_MOTION.unlockMs, easing: ease, fill: 'forwards' },
  );
  bottom.animate(
    [{ transform: 'none', opacity: 1 }, { transform: 'translate3d(0,32px,0) scale(1.03)', opacity: 0 }],
    { duration: VAULT_MOTION.unlockMs, easing: ease, fill: 'forwards' },
  );
  seam.animate(
    [{ transform: 'scaleX(.2)', opacity: 0 }, { transform: 'none', opacity: 1, offset: 0.35 }, { transform: 'none', opacity: 0 }],
    { duration: VAULT_MOTION.unlockMs, easing: 'ease', fill: 'forwards' },
  );
  return host;
}

function playUnlock(removed, view) {
  const mode = unlockMode(tier());
  const paper = removed?.querySelector?.('.vault-lock-paper');
  if (mode === 'cut') return;
  noteVaultAnimation(mode === 'split' ? VAULT_MOTION.unlockMs + VAULT_MOTION.staggerCap : VAULT_MOTION.fadeMs);
  if (mode === 'split') {
    const host = paperHost(paper, lockRect, true);
    view?.animate(
      [{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }],
      { duration: VAULT_MOTION.unlockMs, easing: SPRING, fill: 'backwards' },
    );
    setTimeout(() => host?.remove(), VAULT_MOTION.unlockMs + 40);
    stagger(view?.querySelectorAll('.vault-folder-card, .vault-security-note, .vault-toolbar, .vault-folder-home-head'), { start: 90, step: 24, cols: 2 });
    return;
  }
  if (mode === 'fade') {
    const host = paperHost(paper, lockRect, false);
    view?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: VAULT_MOTION.fadeMs, easing: 'ease', fill: 'backwards' });
    if (host) {
      host.animate([{ opacity: 1 }, { opacity: 0 }], { duration: VAULT_MOTION.fadeMs, easing: 'ease', fill: 'forwards' })
        .finished.catch(() => {}).then(() => host.remove());
    }
  }
}

function playLock(view) {
  watchStatus(view);
  if (tier() !== 'rich') return;
  noteVaultAnimation(260);
  const paper = view.querySelector('.vault-lock-paper');
  const mark = view.querySelector('.vault-lock-mark');
  if (!paper) return;
  lockPaperAt = performance.now();
  paper.animate(
    [{ opacity: 0, transform: 'scale(.98)' }, { opacity: 1, transform: 'none' }],
    { duration: 220, delay: 40, easing: OUT, fill: 'backwards' },
  );
  mark?.classList.add('pv-breath');
}

function armLockGhost() {
  if (!plain() || tier() === 'none' || lockGhostSpec().cloneContent) return;
  const view = document.querySelector('.private-vault-view:not(.vault-locked-view)');
  if (!view) return;
  const rect = view.getBoundingClientRect();
  const block = document.createElement('div');
  block.className = 'pv-lock-ghost';
  block.setAttribute('aria-hidden', 'true');
  block.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;margin:0;z-index:210;pointer-events:none;background:var(--plain-canvas)`;
  document.body.append(block);
  noteVaultAnimation(tier() === 'rich' ? 160 : 120);
  const rich = tier() === 'rich';
  block.animate(
    [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: rich ? 'translate3d(0,6px,0)' : 'none' }],
    { duration: rich ? 160 : 120, easing: 'ease', fill: 'forwards' },
  ).finished.catch(() => {}).then(() => block.remove());
}

function hideImages(still) {
  const frame = still?.closest?.('.photo-blur-frame') || still;
  const imgs = frame ? [...frame.querySelectorAll('img')] : [];
  imgs.forEach(img => { img.style.opacity = '0'; });
  return () => imgs.forEach(img => { img.style.opacity = ''; });
}

function flyPhoto(from, to, src, ms) {
  const transform = flightTransform(from, to);
  if (!transform || !src) return false;
  const fly = document.createElement('div');
  fly.className = 'pv-fly';
  fly.style.cssText = `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px`;
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  img.src = src;
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block';
  fly.append(img);
  document.body.append(fly);
  fly.animate([{ transform: 'none' }, { transform }], { duration: ms, easing: EMPH, fill: 'forwards' })
    .finished.catch(() => {})
    .then(() => fly.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 80, fill: 'forwards' }).finished)
    .catch(() => {})
    .then(() => fly.remove());
  return true;
}

function flyGhost(from, to, ms) {
  const transform = ghostFrameTransform(from, to);
  if (!transform || tier() !== 'rich') return;
  const ghost = document.createElement('div');
  ghost.className = 'pv-ghost';
  ghost.style.cssText = `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px`;
  document.body.append(ghost);
  ghost.animate([{ transform: 'none', opacity: 1 }, { transform, opacity: 1 }], { duration: ms, easing: EMPH, fill: 'forwards' })
    .finished.catch(() => {})
    .then(() => ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100, fill: 'forwards' }).finished)
    .catch(() => {})
    .then(() => ghost.remove());
}

function findStill(view, coverId) {
  const buttons = [...view.querySelectorAll('[data-open-vault-item], [data-select-vault-item]')];
  const match = coverId ? buttons.find(button => (button.dataset.openVaultItem || button.dataset.selectVaultItem) === coverId) : null;
  const host = match || buttons[0];
  return host?.querySelector('.photo-blur-still') || null;
}

function findFolderCover(view, place) {
  if (!place) return null;
  const button = [...view.querySelectorAll('.vault-folder-open')].find(item => item.dataset.vaultFolderMode === place.mode && (item.dataset.vaultFolderId || '') === (place.id || ''));
  return button?.querySelector('.vault-folder-cover') || null;
}

function playOpen(view, info) {
  // 进入文件夹时背后页面不缩小（folderBackgroundScale 恒为 1）。
  noteVaultAnimation(tier() === 'lite' ? VAULT_MOTION.liteOpenMs : VAULT_MOTION.openMs + VAULT_MOTION.staggerCap);
  stack.push({ mode: info.mode, id: info.id, coverId: info.coverId, src: info.src });
  const still = findStill(view, info.coverId);
  const to = box(still?.getBoundingClientRect());
  const ms = tier() === 'lite' ? VAULT_MOTION.liteOpenMs : VAULT_MOTION.openMs;
  let flew = false;
  if (tier() !== 'none' && info.still && to) {
    const show = hideImages(still);
    flew = flyPhoto(info.still, to, info.src, ms);
    if (flew) {
      flyGhost(info.frame || info.still, box(still.closest('.photo-blur-frame')?.getBoundingClientRect()) || to, ms);
      setTimeout(show, ms + 90);
    } else {
      show();
      still.animate([{ opacity: 0 }, { opacity: 1 }], { duration: VAULT_MOTION.fadeMs, fill: 'backwards' });
    }
  }
  const cards = [...view.querySelectorAll('.vault-item')];
  stagger(flew ? cards.slice(1) : cards, { start: 120, step: 20, cols: 2 });
  if (view.querySelector('.vault-empty')) playEmpty(view);
}

function playBack(view) {
  noteVaultAnimation(tier() === 'lite' ? VAULT_MOTION.liteBackMs : VAULT_MOTION.backMs + VAULT_MOTION.staggerCap);
  const back = fresh(pendingBack);
  pendingBack = null;
  const place = stack.pop() || null;
  const cover = findFolderCover(view, place);
  const to = box(cover?.querySelector('.photo-blur-still')?.getBoundingClientRect() || cover?.getBoundingClientRect());
  const ms = tier() === 'lite' ? VAULT_MOTION.liteBackMs : VAULT_MOTION.backMs;
  if (tier() !== 'none' && back?.rect && to) {
    const flew = flyPhoto(back.rect, to, back.src || place?.src || '', ms);
    if (!flew) cover?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: VAULT_MOTION.fadeMs, fill: 'backwards' });
    else if (tier() === 'rich') flyGhost(back.rect, to, ms);
  }
  stagger(view.querySelectorAll('.vault-folder-card'), { start: 60, step: 24, cols: 2 });
}

function playFilter(view) {
  noteVaultAnimation(160);
  const entry = fresh(pendingFilter);
  pendingFilter = null;
  if (tier() === 'none') {
    entry?.clone?.remove();
    return;
  }
  const grid = view.querySelector('.vault-grid');
  if (entry?.clone && entry.rect) {
    const clone = entry.clone;
    clone.style.cssText = `position:fixed;left:${entry.rect.left}px;top:${entry.rect.top}px;width:${entry.rect.width}px;height:${entry.rect.height}px;margin:0;z-index:30;pointer-events:none`;
    document.body.append(clone);
    clone.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' }).finished.catch(() => {}).then(() => clone.remove());
  }
  grid?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease', fill: 'backwards' });
}

function playEmpty(view) {
  const boxEl = view.querySelector('.vault-empty');
  if (!boxEl || tier() === 'none') return;
  noteVaultAnimation(220);
  boxEl.classList.add(tier() === 'lite' ? 'pv-empty-lite' : 'pv-empty-in');
}

function popSelected(view, fromIds, toIds) {
  if (tier() !== 'rich') return;
  noteVaultAnimation(220);
  const seen = new Set(fromIds);
  toIds.filter(id => !seen.has(id)).forEach(id => {
    const button = [...view.querySelectorAll('[data-select-vault-item]')].find(item => item.dataset.selectVaultItem === id);
    const card = button?.closest('.vault-item');
    if (!card) return;
    card.classList.add('pv-pop');
    card.addEventListener('animationend', () => card.classList.remove('pv-pop'), { once: true });
  });
}

function stopJankLoop() {
  if (jankRaf) cancelAnimationFrame(jankRaf);
  jankRaf = 0;
  jankOn = false;
}

function resetVaultJank() {
  localLite = false;
  jankUntil = 0;
  jankLast = 0;
  jankState = { windowStart: 0, long: 0, tier: 'rich' };
  stopJankLoop();
}

/** 只在私密空间动画播放的这几毫秒里数长帧。降级写进 localLite，离开私密空间再复位。 */
function noteVaultAnimation(ms) {
  if (!plain() || globalTier() !== 'rich' || localLite) return;
  if (!document.querySelector('.private-vault-view')) return;
  const until = performance.now() + Math.max(0, ms);
  if (until > jankUntil) jankUntil = until;
  if (jankOn) return;
  jankOn = true;
  jankLast = 0;
  const step = now => {
    const inVault = Boolean(document.querySelector('.private-vault-view'));
    const sample = sampleVaultJank({
      inVault,
      animating: inVault && now <= jankUntil,
      localTier: localLite ? 'lite' : 'rich',
      state: jankState,
      dt: jankLast ? now - jankLast : 0,
      now,
    });
    jankState = sample.state;
    localLite = sample.localTier === 'lite';
    jankLast = now;
    if (!sample.watching) {
      stopJankLoop();
      if (!inVault) resetVaultJank();
      return;
    }
    jankRaf = requestAnimationFrame(step);
  };
  jankRaf = requestAnimationFrame(step);
}

function showShield() {
  if (!plain() || shield) return;
  shield = document.createElement('div');
  shield.className = 'pv-shield';
  shield.setAttribute('aria-hidden', 'true');
  const badge = document.createElement('i');
  badge.textContent = 'lock';
  shield.append(badge);
  document.body.append(shield);
}

function hideShield(instant = false) {
  const node = shield;
  if (!node) return;
  shield = null;
  if (!instant && tier() !== 'none') noteVaultAnimation(VAULT_MOTION.shieldMs);
  const remove = () => node.remove();
  if (instant || tier() === 'none') {
    remove();
    return;
  }
  node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: VAULT_MOTION.shieldMs, easing: 'ease', fill: 'forwards' })
    .finished.catch(() => {}).then(remove);
  if (tier() === 'rich' && performance.now() - lockPaperAt > 500) {
    const paper = document.querySelector('.vault-locked-view .vault-lock-paper');
    if (paper) {
      lockPaperAt = performance.now();
      paper.animate(
        [{ transform: 'scale(.98)' }, { transform: 'none' }],
        { duration: VAULT_MOTION.shieldMs, delay: 40, easing: OUT, fill: 'backwards' },
      );
    }
  }
}

function cancelShieldWait() {
  if (shieldWait) cancelAnimationFrame(shieldWait);
  shieldWait = 0;
}

/** 免密开关只在已解锁页面上，aria-pressed 为 true 表示这次运行不再上锁。 */
function passwordlessThisRun() {
  return document.getElementById('vault-passwordless')?.getAttribute('aria-pressed') === 'true';
}

function onVis() {
  if (!plain() || !document.querySelector('.private-vault-view')) {
    if (document.visibilityState === 'visible') {
      cancelShieldWait();
      hideShield(true);
    }
    return;
  }
  if (document.visibilityState === 'hidden') {
    cancelShieldWait();
    hiddenAt = performance.now();
    showShield();
    return;
  }
  const hiddenFor = hiddenAt ? performance.now() - hiddenAt : 0;
  hiddenAt = 0;
  const passwordless = passwordlessThisRun();
  const started = performance.now();
  const tick = () => {
    const locked = Boolean(document.querySelector('.vault-locked-view'));
    const waited = performance.now() - started;
    if (!shieldShouldHold({ hiddenMs: hiddenFor, locked, waitedMs: waited, passwordless })) {
      shieldWait = 0;
      hideShield(false);
      return;
    }
    shieldWait = requestAnimationFrame(tick);
  };
  cancelShieldWait();
  // 免密不会出现锁屏。同步揭开，避免空等 maxWait。
  if (passwordless) {
    hideShield(false);
    return;
  }
  shieldWait = requestAnimationFrame(tick);
}

function onDown(event) {
  if (!plain()) return;
  const paper = event.target.closest?.('.vault-locked-view .vault-lock-paper');
  if (paper) {
    rememberLock(paper.closest('.vault-locked-view'));
    const mark = paper.querySelector('.vault-lock-mark');
    mark?.classList.remove('pv-breath', 'pv-mark-once');
  }
}

function onUp() {
  if (!plain() || tier() !== 'rich') return;
  const mark = document.querySelector('.vault-locked-view .vault-lock-mark');
  if (mark && !mark.classList.contains('pv-mark-once')) mark.classList.add('pv-breath');
}

function onClick(event) {
  if (!plain()) return;
  const open = event.target.closest?.('.vault-folder-open');
  if (open) {
    const cover = open.querySelector('.vault-folder-cover');
    const still = cover?.querySelector('.photo-blur-still');
    pendingOpen = {
      at: performance.now(),
      mode: open.dataset.vaultFolderMode || '',
      id: open.dataset.vaultFolderId || '',
      coverId: cover?.dataset.vaultCoverItem || '',
      src: still?.currentSrc || still?.src || '',
      still: box(still?.getBoundingClientRect?.() || cover?.getBoundingClientRect?.()),
      frame: box(cover?.getBoundingClientRect?.()),
    };
    return;
  }
  if (event.target.closest?.('#vault-back-folders')) {
    const still = document.querySelector('.private-vault-view .vault-grid .photo-blur-still');
    pendingBack = {
      at: performance.now(),
      rect: box(still?.getBoundingClientRect?.()),
      src: still?.currentSrc || still?.src || '',
    };
    return;
  }
  const filter = event.target.closest?.('[data-vault-media-filter]');
  if (filter && filter.getAttribute('aria-pressed') !== 'true') {
    const grid = document.querySelector('.private-vault-view .vault-grid');
    const rect = box(grid?.getBoundingClientRect?.());
    if (grid && rect) {
      const items = [...grid.querySelectorAll('.vault-item')];
      const indexes = visibleItemIndexes(items.map(item => item.getBoundingClientRect()), window.innerHeight);
      const clone = document.createElement('div');
      clone.className = grid.className;
      indexes.forEach(index => {
        const copy = items[index].cloneNode(true);
        copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
        clone.append(copy);
      });
      pendingFilter?.clone?.remove();
      pendingFilter = { at: performance.now(), clone: indexes.length ? clone : null, rect };
    }
    return;
  }
  if (event.target.closest?.('#vault-lock')) armLockGhost();
}

function scan(removed) {
  const view = document.querySelector('#app > .private-vault-view');
  const next = snap(view);
  const viewChanged = view !== prevView;
  prevView = view;
  if (prev && sameSnap(prev, next)) {
    pendingFilter?.clone?.remove();
    pendingOpen = null;
    pendingBack = null;
    pendingFilter = null;
    if (viewChanged && next.mode === 'locked') watchStatus(view);
    return;
  }
  const from = prev;
  prev = next;
  if (view && next.mode === 'locked') rememberLock(view);
  if (!from) return;
  if (next.mode === 'absent') {
    hideShield(true);
    cancelShieldWait();
    resetVaultJank();
  }
  if (next.mode === 'absent' || next.mode === 'locked') stack = [];
  if (next.mode !== 'locked') statusWatch?.disconnect();
  if (!plain()) return;
  const open = fresh(pendingOpen);
  pendingOpen = null;
  if (from.mode === 'absent' && next.mode === 'locked') playEnter(view);
  else if (from.mode === 'locked' && next.mode !== 'locked') playUnlock(removed, view);
  else if (next.mode === 'locked' && from.mode !== 'locked') playLock(view);
  else if (open && next.mode === 'content' && (from.mode === 'folders' || from.mode === 'content')) playOpen(view, open);
  else if (pendingBack && from.mode === 'content' && (next.mode === 'folders' || next.mode === 'content') && (next.mode !== from.mode || from.title !== next.title)) playBack(view);
  else if (from.mode === 'content' && next.mode === 'content' && from.filter !== next.filter) playFilter(view);
  else if (pendingFilter) {
    pendingFilter.clone?.remove();
    pendingFilter = null;
  }
  if (pendingBack && from.title === next.title) pendingBack = null;
  if (next.bulk && !from.bulk && tier() !== 'none') {
    noteVaultAnimation(VAULT_MOTION.bulkMs);
    const bar = view?.querySelector('.vault-bulk-bar');
    bar?.classList.add('pv-bulk-in');
    bar?.addEventListener('animationend', () => bar.classList.remove('pv-bulk-in'), { once: true });
  }
  if (view && next.mode === from.mode && next.selected.join('\n') !== from.selected.join('\n')) popSelected(view, from.selected, next.selected);
  if (next.empty && !from.empty && !(open && next.mode === 'content')) playEmpty(view);
  else if (!open && from.mode !== 'content' && from.mode !== 'locked' && next.mode === 'folders' && from.mode !== 'folders') {
    stagger(view?.querySelectorAll('.vault-folder-card'));
  }
}

const seenChrome = new WeakSet();
function watchChrome() {
  const layer = document.getElementById('modal-layer');
  if (!layer) return;
  new MutationObserver(() => {
    if (!plain() || tier() === 'none') return;
    const modal = layer.querySelector('.modal.vault-photo-modal, .modal.vault-feed-modal');
    if (!modal || seenChrome.has(modal)) return;
    seenChrome.add(modal);
    const chrome = modal.querySelector('#vault-photo-chrome, .warm-video-player > header');
    chrome?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: tier() === 'lite' ? 120 : 180, easing: 'ease', fill: 'backwards' });
  }).observe(layer, { childList: true, subtree: true });
}

let installed = false;
export function installVaultMotion() {
  if (!hasDom || installed) return;
  installed = true;
  const app = document.getElementById('app');
  if (!app) return;
  let removedView = null;
  let frame = 0;
  new MutationObserver(records => {
    records.forEach(record => {
      record.removedNodes.forEach(node => {
        if (node.nodeType === 1 && node.classList?.contains('private-vault-view')) removedView = node;
      });
    });
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const removed = removedView;
      removedView = null;
      try { scan(removed); } catch { /* 动效失败时私密空间仍可用 */ }
    });
  }).observe(app, { childList: true, subtree: true });
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('visibilitychange', onVis);
  watchChrome();
  try { scan(null); } catch { /* 首帧量不到就当没有动效 */ }
}
