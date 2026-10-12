import { PHOTO_FRAME_CLASS, photoFrameLayers } from './photo-frame.js';
/**
 * 动效核心（2026-10-10 创建，同日按业界做法重构）
 *
 * 为什么要单独一层：动画最容易失控的地方不是"不会写"，而是**每个页面各写一套** ——
 * 曲线不一致、时长不一致、有的忘了照顾"减弱动效"偏好，最后整体感觉是散的。
 *
 * ── 三条性能红线（都是实测踩出来的，不是理论洁癖）────────────────
 *  1. **不许动画会触发布局的属性**（left/top/width/height）。
 *     实测：逐帧动画这些属性 = 每帧重新布局整页，手机上必卡。
 *     位移一律用 transform。
 *  2. **不许动画"绘制属性"**（box-shadow / filter:blur）。实测：补间内阴影等于每帧重绘整个元素。
 *     内阴影只做"瞬间切换"，不做补间。
 *  3. **持续动画不许逐帧重算样式**。实测：用 @property 驱动锥形渐变的角度，
 *     稳定触发 **60 次/秒的样式重算**（摘掉立刻归零），等于常驻一帧一次的全量重算。
 *     旋转一律用 transform: rotate（合成器）。
 *
 * ── 分工原则 ──────────────────────────────────────────────
 *   **JS 只切换状态（属性/类），动画本身交给 CSS** ——
 *   CSS 的 state transition 与 linear() 弹簧曲线比 JS 逐帧写内联样式更快也更稳。
 *   JS 只在两件 CSS 做不到的事上出场：需要测量的几何（容器变形、FLIP 回退）、
 *   以及需要浏览器原生快照的转场（View Transitions）。
 *
 * ── 可访问性 ──────────────────────────────────────────────
 *   全程尊重系统的「减弱动态效果」；任何一个效果出错都只退化成"没有动画"，不影响功能。
 */

/* ── 曲线令牌（JS 侧用；CSS 侧的弹簧曲线见 performance.css 的 --spring-*）── */
export const EASE = {
  fluid: 'cubic-bezier(0.22, 1, 0.36, 1)',
  overshoot: 'cubic-bezier(0.34, 1.42, 0.64, 1)',
  settle: 'cubic-bezier(0.4, 0, 0.2, 1)',
};

export const DURATION = {
  press: 90,
  morph: 460,
  shared: 420,
  staggerStep: 34,
};

/** 系统「减弱动态效果」偏好。开了就只保留状态切换，不做运动。 */
export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 页面不在前台时不做动画（省电，也避免回到前台时看到一堆补间）。 */
const canAnimate = () => !prefersReducedMotion() && typeof document !== 'undefined' && !document.hidden;

/** 统一的动画执行器：包一层 try/catch，动画永远不能拖垮功能。 */
function safely(run) {
  try {
    return run();
  } catch {
    return null;
  }
}

/* ── 1 · 容器变形（胶囊 / 按钮 → 弹窗面板）────────────────────────
 *
 * 做法是 Material 那套「容器变换」：不去缩放面板本身（那会把里面的文字拉变形），
 * 而是在触发点上放一块**纯色面**，让它从触发点的形状长成面板的形状，同时面板内容淡入。
 *
 * 实现要点：面**按目标尺寸摆好，只做 transform**。
 * 因为面是纯色、里面没有内容，缩放它不会把任何东西拉变形 —— 这正是可以用 transform 的前提。
 *
 * 浅纸 / 纯白不能垫这块面：它从点击处长出来，三个主题看起来都是白块。
 * 渐变纸面的 background-color 算出来是透明，同样不能垫，也不能把面板先藏起来。
 */

/** 不透明、又浅得像纸或白的颜色。这种颜色从点击处长出来就是白块。 */
function isNearWhite(color) {
  const match = String(color || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i);
  if (!match) return false;
  const red = Number(match[1]);
  const green = Number(match[2]);
  const blue = Number(match[3]);
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (!(alpha > 0.45)) return false;
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance >= 0.82;
}

export function morphFrom(trigger, panel, { duration = DURATION.morph } = {}) {
  if (!canAnimate() || !trigger || !panel) return null;
  // 私密视频的准备层和播放器都是深色全屏。垫一块取自弹窗背景的"面"会从点击处长出来，
  // 清简主题里那块面是纯白，经典/暖阳则是浅纸色 —— 观感都是"点的位置先冒白块"。
  if (panel.classList?.contains('vault-feed-modal') || panel.classList?.contains('vault-video-preparing')) return null;
  return safely(() => {
    const from = trigger.getBoundingClientRect();
    const to = panel.getBoundingClientRect();
    if (!from.width || !from.height || !to.width || !to.height) return null;
    // 尺寸差太小就不值得变形（避免"抖一下"）
    if (Math.abs(to.width - from.width) < 24 && Math.abs(to.height - from.height) < 24) return null;
    /* ⚠️ 两条守卫（2026-10-10 用户报"点进大图白屏闪一下"后加的）：
       ① 整屏弹窗不做变形 —— 从缩略图"长"成一整屏没有意义，
          而且垫的那块面会实打实盖住屏幕一下；沉浸式看图/看视频还各有自己的深色底。
       ② 背景透明的弹窗不垫面 —— 之前会回退成白色，等于凭空闪一下白。 */
    const viewportW = document.documentElement.clientWidth || window.innerWidth;
    const viewportH = document.documentElement.clientHeight || window.innerHeight;
    if (to.width >= viewportW * 0.88 && to.height >= viewportH * 0.88) return null;

    const styles = getComputedStyle(panel);
    const panelBackground = styles.backgroundColor;
    const transparentPanel = panelBackground === 'rgba(0, 0, 0, 0)' || panelBackground === 'transparent';
    /* ③ 透明或浅纸色都不垫面，也不要把面板先藏起来。
       渐变底读出来是透明；清简是纯白，经典/暖阳是浅纸。
       垫出来的那一块，以及"面板先消失"露出的底，在 WebView 里都是点击位置的白块。 */
    if (transparentPanel || isNearWhite(panelBackground)) return null;

    const surface = document.createElement('div');
    surface.className = 'morph-surface';
    surface.style.cssText = [
      'position:fixed',
      `left:${to.left}px`,
      `top:${to.top}px`,
      `width:${to.width}px`,
      `height:${to.height}px`,
      `border-radius:${styles.borderRadius}`,
      `background:${panelBackground}`,
    ].join(';');
    document.body.appendChild(surface);

    const scaleX = from.width / to.width;
    const scaleY = from.height / to.height;
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    const dy = (from.top + from.height / 2) - (to.top + to.height / 2);

    // 面板先藏起来，等面长到位置再淡入 —— 否则会看到"面板已经在、面又盖上来"
    panel.animate(
      [{ opacity: 0 }, { opacity: 0, offset: 0.55 }, { opacity: 1 }],
      { duration, easing: EASE.fluid, fill: 'backwards' }
    ).finished.catch(() => {});

    return surface.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`, borderRadius: `${Math.min(from.height / 2, 999)}px`, opacity: 0.6 },
        { transform: 'none', borderRadius: styles.borderRadius, opacity: 1 },
      ],
      { duration: duration * 0.82, easing: EASE.fluid, fill: 'forwards' }
    ).finished
      .catch(() => {})
      .then(() => {
        surface.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 130, easing: EASE.settle, fill: 'forwards' })
          .finished.catch(() => {}).then(() => surface.remove());
      });
  });
}

/* ── 2 · 共享元素（卡片 → 详情）────────────────────────────────
 *
 * 首选**浏览器原生的 View Transitions**：把旧状态与新状态各拍一张快照，
 * 对指定名字的元素做位置/尺寸插值，全程在合成器上、不触发布局 ——
 * 这是当前公认最好的做法，比手写 FLIP 更准（连圆角、裁剪都跟着插值）。
 *
 * 名字必须在同一份文档里唯一，所以每次转场生成一个随机名，结束后清掉 ——
 * 重名会让整次转场被静默跳过，是这套 API 最容易踩的坑。
 *
 * 不支持 View Transitions 的内核，退回手写 FLIP（beginSharedElement）。
 */
const nextShareName = () => `share-hero-${Math.random().toString(36).slice(2, 8)}`;

/* 每次转场的名字都是随机的，静态样式表里的 share-hero 选择器对不上。
   默认的 plus-lighter 会把两张浅色快照加在一起，重叠处直接爆成纯白 ——
   那就是点击位置的白块。这里按真实名字把混合模式钉成 normal。 */
function mountShareBlend(name, duration) {
  const style = document.createElement('style');
  style.setAttribute('data-share-transition', name);
  style.textContent = `::view-transition-group(${name}){animation-duration:${duration}ms;animation-timing-function:var(--spring-entrance,cubic-bezier(0.22,1,0.36,1))}::view-transition-old(${name}),::view-transition-new(${name}){animation-duration:${duration}ms;mix-blend-mode:normal}`;
  document.head.appendChild(style);
  return () => style.remove();
}

export function withSharedTransition(sourceEl, update, { targetSelector = '', duration = DURATION.shared, fallbackTargetSelector = '', preferFlip = false } = {}) {
  const supported = !preferFlip && typeof document !== 'undefined' && typeof document.startViewTransition === 'function';
  // <video> 在首帧前是原生白底。给它挂共享元素，抠走的就是一块白。
  if (sourceEl?.tagName === 'VIDEO') { update?.(); return null; }
  if (!canAnimate() || !supported || !sourceEl || !update) {
    // 没有 View Transitions，或调用方指定 preferFlip（随手拍点开放大）：用 transform+opacity 的 FLIP
    if (!canAnimate() || !sourceEl) { update?.(); return null; }
    const handoff = beginSharedElement(sourceEl, { duration });
    const result = update();
    Promise.resolve(result).then(() => requestAnimationFrame(() => handoff(fallbackTargetSelector ? document.querySelector(fallbackTargetSelector) : targetSelector ? document.querySelector(targetSelector) : null))).catch(() => {});
    return null;
  }
  return safely(() => {
    const name = nextShareName();
    const removeStyle = mountShareBlend(name, duration);
    const cleanup = [removeStyle];
    sourceEl.style.viewTransitionName = name;
    cleanup.push(() => { sourceEl.style.viewTransitionName = ''; });

    let transition;
    try {
      transition = document.startViewTransition(() => {
        const done = update();
        // update 可能是异步的（比如要先解密）；返回 Promise 时浏览器会等它
        return Promise.resolve(done).then(async () => {
          const target = targetSelector ? document.querySelector(targetSelector) : null;
          /* 没有落点，或落点是视频：旧快照里这个元素已经被抠走，
             Android WebView 的转场底是白的，抠空处就是点击位置的白块。
             清掉名字并跳过动画，照片落点仍然照常放大。 */
          if (!target || target.tagName === 'VIDEO') {
            sourceEl.style.viewTransitionName = '';
            transition?.skipTransition?.();
            return;
          }
          /* ⚠️ 等图片解码完再让浏览器拍"新状态"快照。
             不等的话，快照里的图还是空白 —— 观感就是"打开大图时闪一下"。
             这是 View Transitions 配大图时的标准做法（update 回调支持 await，就是为这个）。 */
          /* complete 只表示字节到了，不代表已解码：大图 data URL 在安卓上 complete 也可能还没解完。
             一律 decode（已解码时立即返回），最多等 600ms，避免拍到半解码的图。 */
          if (target.tagName === 'IMG') {
            await Promise.race([target.decode?.().catch(() => {}), new Promise(resolve => setTimeout(resolve, 600))]);
          }
          // 查看器自己的淡入交给转场：直接以最终状态拍快照，避免快照里是透明的
          target.classList.add('viewer-no-fade');
          target.classList.remove('is-decoding');
          target.style.viewTransitionName = name;
          cleanup.push(() => { target.style.viewTransitionName = ''; });
        });
      });
    } catch (error) {
      cleanup.forEach(fn => safely(fn));
      throw error;
    }
    transition.finished.catch(() => {}).then(() => cleanup.forEach(fn => safely(fn)));
    return transition;
  });
}

/* ── 2b · 手写 FLIP（View Transitions 不可用时的回退）────────────────
 *
 * 分两段是因为**详情是异步打开的**：点下去那一刻目标还不存在。
 * 用法：const handoff = beginSharedElement(源) → 打开 → handoff(目标)
 * ⚠️ 幽灵**按源尺寸放好，只做 transform**（经典 FLIP）；
 *    逐帧动画 left/top/width/height 会每帧重新布局 —— 点照片最卡就是那里。
 */
export function beginSharedElement(sourceEl, { duration = DURATION.shared } = {}) {
  if (!canAnimate() || !sourceEl) return () => {};
  const captured = safely(() => {
    const rect = sourceEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { rect, radius: getComputedStyle(sourceEl).borderRadius, node: sourceEl.cloneNode(true) };
  });
  if (!captured) return () => {};

  /* 目标可能还在解码：幽灵先按缩略图矩形飞到大图位（只动 transform），
     解码完成且落位后再显形 —— 不等解码才起飞，也不会先闪错缩略图。 */
  return targetEl => {
    if (!targetEl) return;
    safely(() => {
      const from = captured.rect;
      const ghost = captured.node;
      ghost.classList.add('shared-element-ghost');
      const fit = sourceEl.tagName === 'IMG' ? 'contain' : '';
      ghost.style.cssText = [
        'position:fixed',
        `left:${from.left}px`,
        `top:${from.top}px`,
        `width:${from.width}px`,
        `height:${from.height}px`,
        `border-radius:${captured.radius}`,
        'margin:0',
        fit ? `object-fit:${fit}` : '',
      ].filter(Boolean).join(';');
      document.body.appendChild(ghost);

      const previousOpacity = targetEl.style.opacity;
      targetEl.style.opacity = '0';
      targetEl.classList?.add?.('is-decoding');

      const decodeWait = targetEl.tagName === 'IMG' && typeof targetEl.decode === 'function'
        ? Promise.race([targetEl.decode().catch(() => {}), new Promise(resolve => setTimeout(resolve, 800))])
        : Promise.resolve();

      const to = targetEl.getBoundingClientRect();
      if (!to.width || !to.height) {
        decodeWait.then(() => {
          ghost.remove();
          targetEl.classList?.remove?.('is-decoding');
          targetEl.style.opacity = previousOpacity || '1';
        });
        return;
      }

      const targetRadius = getComputedStyle(targetEl).borderRadius;
      const flight = ghost.animate(
        [
          { transform: 'none', borderRadius: captured.radius, opacity: 1 },
          {
            transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`,
            borderRadius: targetRadius,
            opacity: 1,
          },
        ],
        { duration, easing: EASE.fluid, fill: 'forwards' }
      );

      sourceEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration * 0.5, easing: EASE.settle, fill: 'forwards' });

      const revealTarget = () => {
        ghost.remove();
        targetEl.classList?.remove?.('is-decoding');
        targetEl.classList?.add?.('viewer-no-fade');
        targetEl.style.transition = `opacity 160ms ${EASE.settle}`;
        targetEl.style.opacity = previousOpacity || '1';
        setTimeout(() => { targetEl.style.transition = ''; }, 220);
      };
      Promise.all([flight.finished.catch(() => {}), decodeWait]).then(() => {
        // 800ms 解码超时后若还没有像素，先留着幽灵，等 load/再短等，避免空图闪一下
        if (targetEl.tagName === 'IMG' && !targetEl.naturalWidth) {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            targetEl.removeEventListener('load', finish);
            targetEl.removeEventListener('error', finish);
            revealTarget();
          };
          targetEl.addEventListener('load', finish);
          targetEl.addEventListener('error', finish);
          setTimeout(finish, 400);
          return;
        }
        revealTarget();
      });
    });
  };
}

/* ── 3 · 列表交错入场 ─────────────────────────────────────────
 *
 * JS 只做一件事：给每一项写一个序号（--stagger-index）。
 * 动画本身是 CSS 的（[data-stagger] + cascade-in + 弹簧曲线）——
 * 比每项建一个 Web Animations 对象更省，也让"手感"集中在样式表里调。
 *
 * 不写死"哪个容器"，而是按**元素类型**找同类项再按父元素分组：
 * 各页容器类名五花八门，登记制既易漏、又会随改版失效。
 */
const CASCADE_ITEMS = [
  '.life-stream-card',
  '.ledger-row',
  '.snippet-item-card',
  '.snippet-media-card',
  '.vault-item',
  '.stats-habit-row',
  '.habit-card',
  '.detail-sheet-row',
  '.cal-activity-row',
  '.media-card',
  '.taste-card',
  '.course-row',
  '.setting-item-row',
].join(',');

export function autoStagger(root = document, { step = DURATION.staggerStep, max = 7 } = {}) {
  if (!canAnimate() || !root?.querySelectorAll) return;
  safely(() => {
    const groups = new Map();
    root.querySelectorAll(CASCADE_ITEMS).forEach(el => {
      if (el.hasAttribute('data-stagger')) return;
      const parent = el.parentElement;
      if (!parent) return;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(el);
    });
    groups.forEach(children => {
      if (children.length < 2 || children.length > 60) return;   // 超长列表不做，入场会变成等待
      children.forEach((child, index) => {
        child.style.setProperty('--stagger-index', String(Math.min(index, max)));
        child.setAttribute('data-stagger', '');
      });
    });
  });
}

/* ── 4 · 按压物理 ─────────────────────────────────────────────
 *
 * JS 只切换 data-pressed，动画（含弹簧回弹）全在 CSS 里。
 *
 * ⚠️ 两档，不是所有元素都该吃同一套：
 *   小控件（按钮、标签）：缩到 0.96 + 内阴影
 *   大块（卡片、列表行）：只做极轻微缩放，不碰内阴影
 *   —— 内阴影是绘制属性，大块上补间它等于每帧重绘整块，就是"点照片整页发涩"的直接原因。
 */
const PRESS_SOLID = [
  '.focus-mode-btn', '.duration-chip', '.timer-action-secondary', '.timer-action-screensaver',
  '.cal-tool-btn', '.creative-tool-btn', '.snippet-add-btn', '.snippet-filter-pill',
  '.journal-add-polaroid-btn', '.journal-save-btn', '.mood-pick-item', '.weather-pick-item',
  '.ledger-add-btn', '.habit-switch-chip', '.habit-check-btn', '.subpage-back-btn', '.profile-edit-pill',
  '.modal-actions button', '.vault-item-menu-actions > button', '.bento-card-footer',
  '.journal-deck-cut', '.journal-deck-open',
].join(',');

const PRESS_LIGHT = [
  '.qa-card', '.stack-card', '.bento-item-mini', '.habit-card-main',
  '.stats-habit-row', '.snippet-item-card', '.snippet-media-card', '.snippet-photo-tile',
  '.ledger-row', '.account-mini-card', '.day-photo-thumb',
  '.vault-item-open', '.countdown-card', '.course-row', '.setting-item-row',
].join(',');

export const PRESS_SELECTOR = `${PRESS_SOLID},${PRESS_LIGHT}`;

let pressInstalled = false;

/* <video> 在第一帧画出来之前，Android WebView 会铺一块原生白，而且盖在 CSS 背景上。
   新插入的视频先藏起来，有画面（或确定失败）再露出来。照片共享元素不走这里。 */
function revealVideoFrame(video) {
  video.classList.remove('is-awaiting-frame');
}

function armVideoFrame(video) {
  if (!video || video.localName !== 'video' || video.readyState >= 2) return;
  video.classList.add('is-awaiting-frame');
}

function installVideoFrameGuard() {
  const reveal = event => {
    const video = event.target;
    if (video?.localName === 'video') revealVideoFrame(video);
  };
  document.addEventListener('loadeddata', reveal, true);
  document.addEventListener('canplay', reveal, true);
  document.addEventListener('playing', reveal, true);
  document.addEventListener('error', reveal, true);

  const armTree = node => {
    if (!node || node.nodeType !== 1) return;
    if (node.localName === 'video') armVideoFrame(node);
    const videos = node.getElementsByTagName?.('video');
    if (!videos) return;
    for (let index = 0; index < videos.length; index += 1) armVideoFrame(videos[index]);
  };

  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) armTree(node);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  armTree(document.documentElement);
}

/** 给所有可按压元素打上标记。必须在"按下之前"完成，否则状态切换不会触发过渡。 */
export function markPressables(root = document) {
  if (!root?.querySelectorAll) return;
  safely(() => {
    root.querySelectorAll(PRESS_LIGHT).forEach(el => {
      el.setAttribute('data-pressable', '');
      el.setAttribute('data-press-light', '');
    });
    root.querySelectorAll(PRESS_SOLID).forEach(el => el.setAttribute('data-pressable', ''));
  });
}

export function installPressFeedback() {
  if (pressInstalled || typeof document === 'undefined') return;
  pressInstalled = true;
  installVideoFrameGuard();

  const findTarget = node => {
    const element = node instanceof Element ? node : null;
    return element?.closest?.(PRESS_SELECTOR) || null;
  };
  const clear = () => {
    document.querySelectorAll('[data-pressed]').forEach(el => el.removeAttribute('data-pressed'));
  };

  document.addEventListener('pointerdown', event => {
    if (event.button !== undefined && event.button !== 0) return;
    if (!canAnimate()) return;
    const target = findTarget(event.target);
    if (target) target.setAttribute('data-pressed', '');
  }, { passive: true });

  document.addEventListener('pointerup', clear, { passive: true });
  document.addEventListener('pointercancel', clear, { passive: true });
  // 指针移出后松手也要回弹（否则会卡在按下态）
  document.addEventListener('pointerleave', event => {
    const target = findTarget(event.target);
    if (target) target.removeAttribute('data-pressed');
  }, { passive: true, capture: true });
}

/* ── 5 · 弹簧 ODE、日记牌组、翻滚数字、底栏微磁吸 ───────────────
 *
 * 牌组只负责在日子 / 篇章之间做透视倾斜和磁性切牌。
 * 点开照片仍走原来的 photoViewer：长图的上下滑动留在那个查看器里，
 * 不在牌面上做纵向平移，避免和全屏长图查看抢手势。
 * 软阴影是单独一层的 transform，不逐帧改 box-shadow。
 */

export class SpringODE {
  constructor({ mass = 1, stiffness = 220, damping = 22, precision = 0.08 } = {}) {
    this.mass = mass;
    this.stiffness = stiffness;
    this.damping = damping;
    this.precision = precision;
    this.current = 0;
    this.target = 0;
    this.velocity = 0;
    this.onUpdate = null;
    this.onSettle = null;
    this._frame = 0;
    this._last = null;
  }

  set(value) {
    if (this._frame) cancelAnimationFrame(this._frame);
    this._frame = 0;
    this._last = null;
    this.current = value;
    this.target = value;
    this.velocity = 0;
    this.onUpdate?.(this.current, 0);
  }

  stop() {
    if (this._frame) cancelAnimationFrame(this._frame);
    this._frame = 0;
    this._last = null;
  }

  /** 手动推进一步。测试里不依赖 requestAnimationFrame。返回是否已经落定。 */
  advance(now) {
    if (this._last == null) {
      this._last = now;
      return false;
    }
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.05) dt = 0.05;
    if (!(dt > 0)) return false;
    const subDt = dt / 4;
    for (let step = 0; step < 4; step += 1) {
      const displacement = this.current - this.target;
      const acc = (-this.stiffness * displacement - this.damping * this.velocity) / this.mass;
      this.velocity += acc * subDt;
      this.current += this.velocity * subDt;
    }
    this.onUpdate?.(this.current, this.velocity);
    const near = Math.abs(this.current - this.target) < this.precision;
    const slow = Math.abs(this.velocity) < this.precision * 12;
    if (!near || !slow) return false;
    this.current = this.target;
    this.velocity = 0;
    this._last = null;
    this.onUpdate?.(this.current, 0);
    const settle = this.onSettle;
    this.onSettle = null;
    settle?.(this.current);
    return true;
  }

  to(target, initialVelocity = null) {
    this.target = target;
    if (initialVelocity != null && Number.isFinite(initialVelocity)) this.velocity = initialVelocity;
    if (!canAnimate() || typeof requestAnimationFrame !== 'function') {
      if (this._frame) cancelAnimationFrame(this._frame);
      this._frame = 0;
      this._last = null;
      this.current = target;
      this.velocity = 0;
      this.onUpdate?.(this.current, 0);
      const settle = this.onSettle;
      this.onSettle = null;
      settle?.(this.current);
      return;
    }
    if (this._frame) return;
    this._last = null;
    const step = now => {
      this._frame = 0;
      if (this.advance(now)) return;
      this._frame = requestAnimationFrame(step);
    };
    this._frame = requestAnimationFrame(step);
  }
}

/** 松手时决定吸回、切到下一篇（更早）还是上一篇（更新）。dx 向左为负。 */
export function deckCutDecision({ dx = 0, width = 1, velocity = 0 } = {}) {
  const span = Math.max(1, Number(width) || 1);
  const threshold = Math.max(48, span * 0.22);
  const flung = Math.abs(velocity) > 700;
  if (dx <= -threshold || (flung && velocity < 0 && dx < -12)) return 'next';
  if (dx >= threshold || (flung && velocity > 0 && dx > 12)) return 'prev';
  return 'stay';
}

/* ── 摊开：把牌组铺成按月分组的小卡网格，用来找某一篇 ──
   只动 transform/opacity（无 filter），小卡照片用共用照片框，进入视口才给 src（IntersectionObserver）。
   打开时一次性读取牌组和可见小卡的位置（一批读、一批写，不交替），之后只写 transform。
   点小卡 → 那张小卡飞回牌组位置，牌组跳到这一篇；「收起」原样收回。⋯ 菜单：打开 / 编辑 / 删除（调用方提供，复用原有路径）。 */
const SPREAD_EASE = 'var(--ease-spring, cubic-bezier(.34,1.56,.64,1))';
function createDeckSpread({ host, stage, controls, open, list, options, signal, toggleButton, searchButton, currentIndex, jumpTo }) {
  const cfg = options.spread || {};
  let panel = null;
  let observer = null;
  let opened = false;
  let busy = false;
  const monthOf = model => String(model.month || model.id || '').slice(0, 7);
  const monthLabel = key => /^\d{4}-\d{2}$/.test(key) ? `${key.slice(0, 4)} 年 ${Number(key.slice(5, 7))} 月` : '其他';
  const reduced = () => prefersReducedMotion();
  const setDeckHidden = hidden => {
    for (const el of [stage, controls, open]) {
      el.classList.toggle('is-spread-hidden', hidden);
      if (hidden) el.setAttribute('aria-hidden', 'true'); else el.removeAttribute('aria-hidden');
      el.inert = hidden;
    }
  };
  const build = () => {
    panel = document.createElement('section');
    panel.className = 'journal-deck-spread';
    panel.setAttribute('aria-label', '摊开的篇章');
    const bar = document.createElement('div');
    bar.className = 'journal-deck-spread-bar';
    const chips = document.createElement('div');
    chips.className = 'journal-deck-spread-months';
    chips.setAttribute('role', 'tablist');
    chips.setAttribute('aria-label', '按月份跳转');
    if (cfg.onSearch && searchButton) searchButton.addEventListener('click', () => cfg.onSearch(), { signal });
    bar.append(chips);
    // 不再套内层滚动框：网格随页面自然滚动
    const scroller = document.createElement('div');
    scroller.className = 'journal-deck-spread-body';
    const groups = new Map();
    list.forEach((model, at) => {
      const key = monthOf(model);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([model, at]);
    });
    const keys = [...groups.keys()].sort((a, b) => b.localeCompare(a));
    for (const key of keys) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'journal-deck-cut journal-deck-spread-chip';
      chip.textContent = /^\d{4}-\d{2}$/.test(key) ? `${Number(key.slice(5, 7))}月${key.slice(0, 4) !== String(new Date().getFullYear()) ? ` ${key.slice(2, 4)}` : ''}` : '其他';
      chip.dataset.month = key;
      chip.setAttribute('aria-label', `跳到${monthLabel(key)}`);
      chips.append(chip);
      const section = document.createElement('div');
      section.className = 'journal-deck-spread-month';
      section.dataset.month = key;
      const label = document.createElement('h4');
      label.className = 'journal-deck-heading journal-deck-spread-label';
      label.textContent = `${monthLabel(key)} · ${groups.get(key).length} 篇`;
      const grid = document.createElement('div');
      grid.className = 'journal-deck-spread-grid';
      for (const [model, at] of groups.get(key)) grid.append(miniCard(model, at));
      section.append(label, grid);
      scroller.append(section);
    }
    chips.addEventListener('click', event => {
      const chip = event.target.closest?.('[data-month]');
      if (!chip) return;
      const section = scroller.querySelector(`.journal-deck-spread-month[data-month="${chip.dataset.month}"]`);
      section?.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
      chips.querySelectorAll('.is-current').forEach(el => el.classList.remove('is-current'));
      chip.classList.add('is-current');
    }, { signal });
    panel.append(bar, scroller);
    observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(items => {
      for (const item of items) {
        if (!item.isIntersecting) continue;
        observer.unobserve(item.target);
        item.target.querySelectorAll('img[data-src]').forEach(img => { img.src = img.dataset.src; img.removeAttribute('data-src'); });
      }
    }, { rootMargin: '240px 0px' }) : null;
    panel.querySelectorAll('.journal-deck-mini').forEach(card => {
      if (observer) observer.observe(card);
      else card.querySelectorAll('img[data-src]').forEach(img => { img.src = img.dataset.src; });
    });
    host.append(panel);
  };
  const miniCard = (model, at) => {
    const card = document.createElement('article');
    card.className = 'journal-deck-face journal-deck-mini';
    card.dataset.deckIndex = String(at);
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'journal-deck-mini-pick';
    pick.setAttribute('aria-label', `${model.title || '这一篇'}，放回牌组并翻到这一篇`);
    const date = document.createElement('span');
    date.className = 'journal-deck-kicker journal-deck-mini-date';
    date.textContent = String(model.kicker || model.id || '');
    const title = document.createElement('strong');
    title.className = 'journal-deck-title journal-deck-mini-title';
    title.textContent = model.title || '未命名的一天';
    pick.append(date);
    if (model.photoSrc) {
      const frame = document.createElement('span');
      frame.className = `journal-deck-photo journal-deck-mini-photo ${PHOTO_FRAME_CLASS}`;
      const layers = photoFrameLayers('', {});
      layers.forEach(img => { img.removeAttribute('src'); img.dataset.src = model.photoSrc; img.loading = 'lazy'; img.decoding = 'async'; });
      frame.append(...layers);
      pick.append(frame);
    } else {
      // 没有照片也占同样高的照片位：纸色底 + 小图标，小卡一样高
      const blank = document.createElement('span');
      blank.className = `journal-deck-photo journal-deck-mini-photo ${PHOTO_FRAME_CLASS} is-empty`;
      blank.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">history_edu</span>';
      pick.append(blank);
    }
    const meta = document.createElement('small');
    meta.className = 'journal-deck-meta journal-deck-mini-meta';
    meta.textContent = model.meta || '';
    pick.append(title, meta);
    pick.addEventListener('click', () => collapse(at, card), { signal });
    card.append(pick);
    const actions = [['open', '打开', cfg.onOpen || options.onOpen], ['edit', '编辑', cfg.onEdit], ['delete', '删除', cfg.onDelete]].filter(([, , fn]) => typeof fn === 'function');
    if (actions.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'journal-deck-cut journal-deck-mini-more';
      more.setAttribute('aria-label', `${model.title || '这一篇'}的更多操作`);
      more.setAttribute('aria-expanded', 'false');
      more.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">more_horiz</span>';
      const menu = document.createElement('div');
      menu.className = 'journal-deck-face journal-deck-mini-menu';
      menu.hidden = true;
      for (const [kind, label, fn] of actions) {
        const item = document.createElement('button');
        item.type = 'button';
        item.dataset.miniAction = kind;
        item.className = kind === 'delete' ? 'journal-deck-cut journal-deck-mini-danger' : 'journal-deck-cut';
        item.textContent = label;
        item.addEventListener('click', () => { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); fn(model); }, { signal });
        menu.append(item);
      }
      more.addEventListener('click', () => {
        const show = menu.hidden;
        panel?.querySelectorAll('.journal-deck-mini-menu:not([hidden])').forEach(el => { el.hidden = true; });
        menu.hidden = !show;
        more.setAttribute('aria-expanded', String(show));
      }, { signal });
      card.append(more, menu);
    }
    return card;
  };
  // 一批读：牌组中心 + 视口内小卡位置；一批写：初始 transform；下一帧统一过渡回原位。
  const fanOut = deckRect => {
    if (reduced() || !deckRect?.width) return;
    const cards = [...panel.querySelectorAll('.journal-deck-mini')];
    const viewH = window.innerHeight || 800;
    const reads = [];
    for (const card of cards) {
      const r = card.getBoundingClientRect();
      if (r.top > viewH + 40) break;
      reads.push([card, r]);
    }
    const cx = deckRect.left + deckRect.width / 2;
    const cy = deckRect.top + deckRect.height / 2;
    reads.forEach(([card, r], i) => {
      card.style.transition = 'none';
      card.style.transform = `translate3d(${(cx - (r.left + r.width / 2)).toFixed(1)}px, ${(cy - (r.top + r.height / 2)).toFixed(1)}px, 0) rotate(${((i % 5) - 2) * 3}deg) scale(.6)`;
      card.style.opacity = '0';
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      reads.forEach(([card], i) => {
        const delay = Math.min(i, 14) * 28;
        card.style.transition = `transform 520ms ${SPREAD_EASE} ${delay}ms, opacity 260ms ease ${delay}ms`;
        card.style.transform = '';
        card.style.opacity = '';
      });
      setTimeout(() => reads.forEach(([card]) => { card.style.transition = ''; }), 520 + 14 * 28 + 60);
    }));
  };
  const setToggle = spreadOn => {
    if (toggleButton) {
      toggleButton.innerHTML = spreadOn
        ? '<span class="material-symbols-outlined" aria-hidden="true">unfold_less</span><span>收起</span>'
        : '<span class="material-symbols-outlined" aria-hidden="true">grid_view</span><span>摊开</span>';
      toggleButton.setAttribute('aria-label', spreadOn ? '收起，回到牌组' : '摊开全部篇章，按月份查找');
      toggleButton.setAttribute('aria-expanded', String(spreadOn));
    }
    if (searchButton) searchButton.hidden = !spreadOn || !cfg.onSearch;
  };
  const expand = () => {
    if (opened || busy) return;
    if (!panel) build();
    opened = true;
    setToggle(true);
    const deckRect = reduced() ? null : stage.getBoundingClientRect();
    host.classList.add('is-spread');
    panel.hidden = false;
    setDeckHidden(true);
    const current = panel.querySelector(`.journal-deck-mini[data-deck-index="${currentIndex()}"]`);
    current?.classList.add('is-current');
    fanOut(deckRect);
  };
  const collapse = (at, fromCard) => {
    if (!opened || busy) return;
    const settleSpread = () => {
      busy = false;
      opened = false;
      host.classList.remove('is-spread', 'is-spread-flying');
      setToggle(false);
      if (panel) panel.hidden = true;
      panel?.querySelectorAll('.is-current').forEach(el => el.classList.remove('is-current'));
      setDeckHidden(false);
      if (at >= 0) jumpTo(at);
      if (host.getBoundingClientRect().top < 0) host.scrollIntoView({ block: 'start', behavior: 'auto' });
      stage.focus?.({ preventScroll: true });
    };
    if (reduced() || !fromCard) { settleSpread(); return; }
    busy = true;
    // 读：小卡和牌组位置各一次；写：小卡飞向牌组，其余小卡淡出
    // 牌组收起时不占位，目标取摊开面板顶部牌组将出现的位置
    const from = fromCard.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const dx = box.left + box.width / 2 - (from.left + from.width / 2);
    const dy = Math.max(box.top, 0) + 215 - (from.top + from.height / 2);
    panel.classList.add('is-collapsing');
    host.classList.add('is-spread-flying');
    fromCard.classList.add('is-flying');
    fromCard.style.transition = `transform 420ms ${SPREAD_EASE}`;
    fromCard.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) scale(1.4)`;
    setTimeout(() => {
      fromCard.style.transition = '';
      fromCard.style.transform = '';
      fromCard.classList.remove('is-flying');
      panel.classList.remove('is-collapsing');
      settleSpread();
    }, 430);
  };
  return {
    toggle: () => (opened ? collapse(-1) : expand()),
    expand,
    collapse,
    destroy() { observer?.disconnect(); panel?.remove(); panel = null; }
  };
}

const journalDecks = new WeakMap();
const liveJournalDecks = new Set();

export function releaseDetachedJournalDecks() {
  for (const deck of [...liveJournalDecks]) {
    if (!deck.host?.isConnected) deck.destroy();
  }
}

/** 同一篇日记的照片地址列表（至少含封面那张）。 */
export function deckPhotoList(entry) {
  const list = Array.isArray(entry?.photos) ? entry.photos.filter(Boolean) : [];
  return list.length ? list : (entry?.photoSrc ? [entry.photoSrc] : []);
}

function deckPhotoIndex(entry) {
  const n = deckPhotoList(entry).length;
  return n ? ((Number(entry.photoIndex) || 0) % n + n) % n : 0;
}

/** 轻点判定：按下到松手不超过 250ms，位移不超过 8px，否则算拖动。 */
export function isDeckTap({ dx = 0, dy = 0, ms = 0 } = {}) {
  return Math.hypot(dx, dy) < 8 && ms <= 250;
}

/** 下一张的序号，最后一张之后回到第一张；单张返回 null（什么都不做）。 */
export function nextDeckPhotoIndex(current, total) {
  if (!(total > 1)) return null;
  return ((Number(current) || 0) + 1) % total;
}

/** 先在内存里把下一张载好（decode 完）再换 src，两层同时换，不闪白。只改内存里的牌面模型，不碰存储。 */
function cycleDeckPhoto(card, entry) {
  const photos = deckPhotoList(entry);
  const next = nextDeckPhotoIndex(deckPhotoIndex(entry), photos.length);
  if (next === null || !card) return;
  const frame = card.querySelector('[data-deck-photo]');
  if (!frame) return;
  const token = (frame._cycleToken || 0) + 1;
  frame._cycleToken = token;
  entry.photoIndex = next;
  const url = photos[next];
  const img = new Image();
  img.decoding = 'async';
  const apply = () => {
    if (frame._cycleToken !== token || !frame.isConnected) return;
    const swap = () => {
      frame.querySelectorAll('img').forEach(layer => { layer.src = url; });
      frame.querySelectorAll('.journal-deck-photo-dots i').forEach((dot, i) => dot.classList.toggle('is-on', i === next));
      frame.classList.remove('is-cycling');
    };
    if (prefersReducedMotion()) { swap(); return; }
    frame.classList.add('is-cycling');
    setTimeout(swap, 120);
  };
  img.onload = () => { (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(apply); };
  img.onerror = () => { if (frame._cycleToken === token) entry.photoIndex = next; };
  img.src = url;
}

/** 翻牌前把牌面照片 decode 好，避免切到下一篇时才解大图造成卡顿弹出。 */
function preloadDeckCard(card) {
  if (!card?.querySelectorAll) return;
  card.querySelectorAll('img').forEach(img => {
    if (!img?.src || typeof img.decode !== 'function') return;
    img.decode().catch(() => {});
  });
}

function deckCard(entry, depth) {
  const card = document.createElement('article');
  card.className = 'journal-deck-card';
  card.dataset.depth = String(depth);
  card.style.zIndex = String(3 - depth);
  if (depth) {
    card.style.pointerEvents = 'none';
    card.setAttribute('aria-hidden', 'true');
  }
  const shadow = document.createElement('span');
  shadow.className = 'journal-deck-shadow';
  shadow.setAttribute('aria-hidden', 'true');
  const face = document.createElement('div');
  face.className = 'journal-deck-face';
  const kicker = document.createElement('p');
  kicker.className = 'journal-deck-kicker';
  kicker.textContent = entry.kicker || '';
  const title = document.createElement('h3');
  title.className = 'journal-deck-title';
  title.textContent = entry.title || '未命名的一天';
  face.append(kicker, title);
  if (entry.photoSrc) {
    const figure = document.createElement('figure');
    figure.className = 'journal-deck-figure';
    const photo = document.createElement('button');
    photo.type = 'button';
    photo.className = 'journal-deck-photo';
    photo.dataset.deckPhoto = entry.id || '';
    photo.setAttribute('aria-label', entry.photoLabel || '查看照片');
    photo.classList.add(PHOTO_FRAME_CLASS);
    const photos = deckPhotoList(entry);
    const at = deckPhotoIndex(entry);
    photo.append(...photoFrameLayers(photos[at] || entry.photoSrc, { padClass: 'journal-deck-pad', stillClass: 'journal-deck-still' }));
    figure.append(photo);
    if (photos.length > 1) {
      const dots = document.createElement('span');
      dots.className = 'journal-deck-photo-dots';
      dots.setAttribute('aria-hidden', 'true');
      photos.forEach((_, i) => {
        const dot = document.createElement('i');
        if (i === at) dot.className = 'is-on';
        dots.append(dot);
      });
      photo.append(dots);
    }
    face.append(figure);
  }
  if (entry.excerpt) {
    const excerpt = document.createElement('p');
    excerpt.className = 'journal-deck-excerpt';
    excerpt.textContent = entry.excerpt;
    face.append(excerpt);
  }
  const meta = document.createElement('p');
  meta.className = 'journal-deck-meta';
  meta.textContent = entry.meta || '';
  face.append(meta);
  card.append(shadow, face);
  return card;
}

/**
 * 在 host 里挂一组可倾斜、可磁性切牌的日记卡。
 * onOpen 打开篇章；点照片在本篇几张之间轮换（放大查看留在阅读页）。
 */
export function mountJournalDeck(host, entries = [], options = {}) {
  return safely(() => {
    if (!host || typeof document === 'undefined') return { destroy() {} };
    journalDecks.get(host)?.destroy();
    const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
    host.replaceChildren();
    if (!list.length) return { destroy() {} };
    const abort = new AbortController();
    const { signal } = abort;
    let active = true;
    let index = Math.min(Math.max(0, Number(options.startIndex) || 0), list.length - 1);
    let cutting = false;
    let cutToken = 0;
    let tracking = false;
    let dragged = false;
    let vertical = false;
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    const trail = [];
    let downTarget = null;
    let downAt = 0;
    const offset = new SpringODE({ mass: 1, stiffness: 210, damping: 24, precision: 0.6 });
    const pitch = new SpringODE({ mass: 0.8, stiffness: 240, damping: 20, precision: 0.15 });
    const yaw = new SpringODE({ mass: 0.8, stiffness: 240, damping: 20, precision: 0.15 });
    let deckApi = null;

    let spreadButton = null;
    let spreadSearch = null;
    if (options.heading || options.hint || options.spread) {
      const head = document.createElement('div');
      head.className = 'journal-deck-head';
      if (options.heading) {
        const heading = document.createElement('h3');
        heading.className = 'journal-deck-heading';
        heading.textContent = options.heading;
        head.append(heading);
      }
      if (options.spread) {
        spreadButton = document.createElement('button');
        spreadButton.type = 'button';
        spreadButton.className = 'journal-deck-cut journal-deck-spread-toggle';
        spreadButton.setAttribute('aria-label', '摊开全部篇章，按月份查找');
        spreadButton.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">grid_view</span><span>摊开</span>';
        spreadSearch = document.createElement('button');
        spreadSearch.type = 'button';
        spreadSearch.className = 'journal-deck-cut journal-deck-spread-search';
        spreadSearch.hidden = true;
        spreadSearch.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">search</span><span>搜索</span>';
        const headTools = document.createElement('div');
        headTools.className = 'journal-deck-head-tools';
        headTools.append(spreadSearch, spreadButton);
        head.append(headTools);
      }
      if (options.hint) {
        const hint = document.createElement('p');
        hint.className = 'journal-deck-hint';
        hint.textContent = options.hint;
        head.append(hint);
      }
      host.append(head);
    }
    const stage = document.createElement('div');
    stage.className = 'journal-deck-stage';
    stage.tabIndex = 0;
    stage.setAttribute('role', 'group');
    stage.setAttribute('aria-roledescription', '日记牌组');
    const controls = document.createElement('div');
    controls.className = 'journal-deck-controls';
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'journal-deck-cut';
    prev.textContent = '上一篇';
    const count = document.createElement('span');
    count.className = 'journal-deck-count';
    const live = document.createElement('span');
    live.className = 'journal-deck-live';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'journal-deck-cut';
    next.textContent = '切下一篇';
    next.setAttribute('aria-label', '下一篇');
    prev.setAttribute('aria-label', '上一篇');
    controls.append(prev, count, next, live);
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'journal-deck-open';
    open.textContent = '阅读这篇';
    host.append(stage, controls, open);

    // 顶牌引用在 paint() 里缓存，拖动中不再 querySelector；姿态写入按 rAF 合并，一帧最多写一次 transform。
    let topCard = null;
    let poseFrame = 0;
    /* 顶牌姿态唯一来源：升牌终点与 paint/applyPose 落定必须同一套，否则交接会抖。 */
    const topCardPose = (x = 0, tiltX = 0, tiltY = 0) =>
      `translate3d(${Number(x).toFixed(2)}px, 0, 28px) rotateX(${(Number(tiltX) * 0.3).toFixed(2)}deg) rotateY(${(Number(tiltY) * 0.3).toFixed(2)}deg) rotateZ(${(Number(x) * 0.012).toFixed(2)}deg)`;
    const applyPose = () => {
      poseFrame = 0;
      if (!active || !host.isConnected) {
        deckApi?.destroy();
        return;
      }
      const card = topCard;
      if (!card) return;
      const x = offset.current;
      const tiltX = pitch.current;
      const tiltY = yaw.current;
      card.style.transform = topCardPose(x, tiltX, tiltY);
      const travel = Math.min(1, Math.abs(x) / stageWidth);
      const gone = travel < 0.35 ? 0 : (travel - 0.35) / 0.65;
      const nextOpacity = prefersReducedMotion() || gone < 0.02 ? '' : (1 - gone * 0.45).toFixed(3);
      if (card.style.opacity !== nextOpacity) card.style.opacity = nextOpacity;
      // 拖动中只动顶牌的 transform/opacity，阴影等松手后再跟上，避免每帧多一层写入
      if (dragged && tracking) return;
      const shadow = card.querySelector('.journal-deck-shadow');
      if (shadow) shadow.style.transform = `translate3d(${(-tiltY * 0.45).toFixed(2)}px, ${(12 - tiltX * 0.3).toFixed(2)}px, 0)`;
    };
    const schedulePose = () => {
      if (poseFrame) return;
      poseFrame = requestAnimationFrame(applyPose);
    };
    offset.onUpdate = schedulePose;
    pitch.onUpdate = schedulePose;
    yaw.onUpdate = schedulePose;
    const setActiveLayer = on => { topCard?.classList.toggle('is-active-drag', on); };

    const pool = new Map();
    let stageWidth = 1;
    let voiced = false;
    const measureStage = () => { stageWidth = Math.max(1, stage.clientWidth || 1); };
    const placeCard = (card, depth) => {
      card.dataset.depth = String(depth);
      card.style.zIndex = String(3 - depth);
      if (!depth) {
        card.inert = false;
        card.removeAttribute('aria-hidden');
        card.style.pointerEvents = '';
        card.querySelectorAll('button').forEach(button => { button.tabIndex = 0; });
        return;
      }
      card.inert = true;
      card.setAttribute('aria-hidden', 'true');
      card.style.pointerEvents = 'none';
      card.style.opacity = '';
      card.style.transform = '';
      card.querySelectorAll('button').forEach(button => { button.tabIndex = -1; });
    };
    const paint = () => {
      const total = list.length;
      const visible = Math.min(3, total);
      const keys = [];
      for (let depth = 0; depth < visible; depth += 1) {
        const at = (index + depth) % total;
        const entry = list[at];
        const key = entry.id || `i${at}`;
        keys.push(key);
        let card = pool.get(key);
        if (!card) {
          card = deckCard(entry, depth);
          pool.set(key, card);
        }
        placeCard(card, depth);
      }
      for (const [key, card] of [...pool]) {
        if (!keys.includes(key)) {
          card.remove();
          pool.delete(key);
        }
      }
      const nextOrder = keys.map(key => pool.get(key)).reverse();
      if (nextOrder.length !== stage.children.length || nextOrder.some((card, at) => stage.children[at] !== card)) stage.replaceChildren(...nextOrder);
      topCard?.classList.remove('is-active-drag');
      topCard = pool.get(keys[0]) || null;
      const entry = list[index];
      const label = entry ? `${entry.title || '这一篇'}，第 ${index + 1} 篇，共 ${total} 篇` : '';
      const indexLabel = `${index + 1} / ${total}`;
      if (count.textContent !== indexLabel) count.textContent = indexLabel;
      stage.setAttribute('aria-label', label);
      if (voiced && live.textContent !== label) live.textContent = label;
      voiced = true;
      prev.disabled = total < 2;
      next.disabled = total < 2;
      measureStage();
      if (poseFrame) cancelAnimationFrame(poseFrame);
      applyPose();
      // 下一张、再下一张预先 decode，翻牌过程中不再解大图
      for (let depth = 1; depth < visible; depth += 1) preloadDeckCard(pool.get(keys[depth]));
    };

    let riseAnim = null;
    let risingCard = null;
    const cancelRise = () => {
      riseAnim?.cancel?.();
      riseAnim = null;
      if (!risingCard) return;
      risingCard.classList.remove('is-deck-rising');
      risingCard.style.transform = '';
      risingCard.style.opacity = '';
      // 升牌时写过 zIndex；取消时一并清掉并按 depth 还原，避免 paint 未重写时叠放乱掉
      const depth = Number(risingCard.dataset.depth);
      risingCard.style.zIndex = Number.isFinite(depth) ? String(3 - depth) : '';
      risingCard = null;
    };
    const depthPoseOf = card => {
      if (!card) return { transform: 'translate3d(0,-18px,-10px) scale(0.975)', opacity: '0.96' };
      const cs = getComputedStyle(card);
      return {
        transform: cs.transform && cs.transform !== 'none' ? cs.transform : 'translate3d(0,-18px,-10px) scale(0.975)',
        opacity: cs.opacity && cs.opacity !== '1' ? cs.opacity : '0.96',
      };
    };

    const fly = (direction, velocity = 0) => {
      if (list.length < 2) {
        offset.to(0);
        yaw.to(0);
        pitch.to(0);
        return;
      }
      if (prefersReducedMotion()) {
        cancelRise();
        index = direction === 'next' ? (index + 1) % list.length : (index - 1 + list.length) % list.length;
        offset.set(0);
        yaw.set(0);
        pitch.set(0);
        paint();
        return;
      }
      if (cutting) return;
      cutting = true;
      cancelRise();
      measureStage();
      const dir = direction === 'next' ? -1 : 1;
      const travel = dir * (stageWidth + 72);
      const token = ++cutToken;
      const nextIndex = direction === 'next' ? (index + 1) % list.length : (index - 1 + list.length) % list.length;
      const nextEntry = list[nextIndex];
      const nextKey = nextEntry?.id || `i${nextIndex}`;
      const incoming = pool.get(nextKey);
      preloadDeckCard(incoming);
      // 顶牌飞出的同时，已就位的下一张从叠放位连续升到顶牌位（只动 transform/opacity，中途不 paint）
      if (incoming && incoming !== topCard) {
        const from = depthPoseOf(incoming);
        risingCard = incoming;
        incoming.classList.add('is-deck-rising');
        incoming.style.transform = from.transform;
        incoming.style.opacity = from.opacity;
        incoming.style.zIndex = '2';
        const rest = topCardPose(0, 0, 0);
        riseAnim = incoming.animate(
          [
            { transform: from.transform, opacity: Number(from.opacity) || 0.96 },
            { transform: rest, opacity: 1 },
          ],
          { duration: 480, easing: EASE.settle, fill: 'forwards' }
        );
      }
      const completeCut = () => {
        if (!active || token !== cutToken) {
          cutting = false;
          return;
        }
        index = nextIndex;
        offset.stop();
        offset.current = 0;
        offset.target = 0;
        offset.velocity = 0;
        yaw.stop();
        yaw.current = 0;
        yaw.target = 0;
        yaw.velocity = 0;
        pitch.stop();
        pitch.current = 0;
        pitch.target = 0;
        pitch.velocity = 0;
        cancelRise();
        paint();
        cutting = false;
      };
      offset.onSettle = () => {
        if (!active || token !== cutToken) {
          cutting = false;
          return;
        }
        const risen = riseAnim?.finished?.catch(() => {}) || Promise.resolve();
        Promise.resolve(risen).then(completeCut);
      };
      offset.to(travel, velocity || dir * 640);
      yaw.to(dir * -8);
      pitch.to(0);
    };

    const onDown = event => {
      if (event.button !== undefined && event.button > 0) return;
      cutToken += 1;
      cutting = false;
      offset.onSettle = null;
      cancelRise();
      offset.stop();
      tracking = true;
      dragged = false;
      vertical = false;
      stage.classList.remove('is-dragging');
      measureStage();
      pointerId = event.pointerId;
      downTarget = event.target;
      downAt = performance.now();
      try { stage.setPointerCapture?.(event.pointerId); } catch { /* 指针已失效时照常记录起点 */ }
      startX = event.clientX;
      startY = event.clientY;
      trail.length = 0;
      trail.push({ x: event.clientX, t: performance.now() });
    };
    const onMove = event => {
      if (!tracking || event.pointerId !== pointerId) {
        // 悬停倾斜只给鼠标；矩形在 pointerenter 时量一次，移动中不再读布局
        if (!tracking && event.pointerType === 'mouse' && hoverRect && !prefersReducedMotion()) {
          const rect = hoverRect;
          if (!rect.width || !rect.height) return;
          const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1;
          pitch.to(Math.max(-12, Math.min(12, -ny * 10)));
          yaw.to(Math.max(-14, Math.min(14, nx * 12)));
        }
        return;
      }
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      trail.push({ x: event.clientX, t: performance.now() });
      if (trail.length > 6) trail.shift();
      if (!dragged) {
        if (Math.hypot(dx, dy) < 8) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          vertical = true;
          tracking = false;
          if (stage.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture(event.pointerId);
          return;
        }
        dragged = true;
        stage.classList.add('is-dragging');
        setActiveLayer(true);
      }
      offset.set(dx);
      if (!prefersReducedMotion()) {
        yaw.set(Math.max(-18, Math.min(18, dx / 16)));
        pitch.set(Math.max(-8, Math.min(8, -dy / 36)));
      }
    };
    const finish = event => {
      if (event.pointerId !== pointerId) return;
      const wasDrag = dragged;
      const wasVertical = vertical;
      tracking = false;
      pointerId = null;
      stage.classList.remove('is-dragging');
      if (wasDrag) {
        // 松手后补一次阴影位置；will-change 等弹簧停下再撤
        schedulePose();
        setTimeout(() => { if (!tracking) setActiveLayer(false); }, 700);
      }
      if (wasVertical || !wasDrag) {
        offset.to(0);
        yaw.to(0);
        pitch.to(0);
        if (wasVertical || wasDrag) return;
        const entry = list[index];
        if (!entry) return;
        // 按下时就捕获了指针，pointerup 的 target 会变成 stage，所以用按下时记下的目标判断点了哪里
        const hit = downTarget || event.target;
        if (hit?.closest?.('[data-deck-photo]')) {
          // 牌组上点照片 = 换本篇下一张（单张不动），不再打开放大查看器
          if (isDeckTap({ dx: event.clientX - startX, dy: event.clientY - startY, ms: performance.now() - downAt })) {
            cycleDeckPhoto(hit.closest('.journal-deck-card'), entry);
          }
        }
        else if (hit?.closest?.('.journal-deck-face')) options.onOpen?.(entry);
        return;
      }
      let velocity = 0;
      if (trail.length >= 2) {
        const oldest = trail[0];
        const newest = trail[trail.length - 1];
        const dt = newest.t - oldest.t;
        if (dt > 8) velocity = ((newest.x - oldest.x) / dt) * 1000;
      }
      const decision = deckCutDecision({ dx: offset.current, width: stage.clientWidth || 1, velocity });
      if (decision === 'stay') {
        offset.to(0, velocity);
        yaw.to(0);
        pitch.to(0);
        return;
      }
      fly(decision, velocity);
    };

    stage.addEventListener('pointerdown', onDown, { signal });
    stage.addEventListener('pointermove', onMove, { signal });
    stage.addEventListener('pointerup', finish, { signal });
    stage.addEventListener('pointercancel', finish, { signal });
    let hoverRect = null;
    stage.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') hoverRect = stage.getBoundingClientRect(); }, { signal });
    stage.addEventListener('pointerleave', () => {
      hoverRect = null;
      if (!tracking) {
        pitch.to(0);
        yaw.to(0);
      }
    }, { signal });
    stage.addEventListener('keydown', event => {
      if (event.target !== stage) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); fly('prev'); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); fly('next'); }
      else if (event.key === 'Enter') { event.preventDefault(); options.onOpen?.(list[index]); }
    }, { signal });
    prev.addEventListener('click', () => fly('prev'), { signal });
    next.addEventListener('click', () => fly('next'), { signal });
    open.addEventListener('click', () => options.onOpen?.(list[index]), { signal });
    let spread = null;
    if (spreadButton) {
      spread = createDeckSpread({
        host, stage, controls, open, list, options, signal, toggleButton: spreadButton, searchButton: spreadSearch,
        currentIndex: () => index,
        jumpTo: at => {
          cutToken += 1;
          cutting = false;
          offset.onSettle = null;
          offset.set(0); yaw.set(0); pitch.set(0);
          index = Math.min(Math.max(0, at), list.length - 1);
          paint();
        }
      });
      spreadButton.addEventListener('click', () => spread.toggle(), { signal });
    }
    paint();
    markPressables(host);
    const api = {
      host,
      destroy() {
        if (!active) return;
        active = false;
        abort.abort();
        offset.stop();
        pitch.stop();
        yaw.stop();
        if (poseFrame) cancelAnimationFrame(poseFrame);
        cancelRise();
        spread?.destroy();
        liveJournalDecks.delete(api);
        if (journalDecks.get(host) === api) journalDecks.delete(host);
      }
    };
    deckApi = api;
    journalDecks.set(host, api);
    liveJournalDecks.add(api);
    releaseDetachedJournalDecks();
    return api;
  }) || { destroy() {} };
}

/**
 * 习惯打卡成功反馈：只动 transform / opacity。
 * 只在小圆勾上做轻缩放+淡入（不用 blur、不动画阴影）。
 * 减弱动效时只保留状态类，不做运动。
 */
export function celebrateHabitCheck(button) {
  if (!button) return;
  button.classList.add('is-done');
  button.closest('.habit-card')?.classList.add('is-done');
  if (!canAnimate()) return;
  safely(() => {
    button.classList.remove('is-pop');
    void button.offsetWidth;
    button.classList.add('is-pop');
    const clear = () => button.classList.remove('is-pop');
    button.querySelector('.habit-check-dot, .hs-tick-dot')?.addEventListener('animationend', clear, { once: true });
    setTimeout(clear, 480);
  });
}

/** 统计数字从 0 弹簧滚到 data-roll。减弱动效时保持原文。 */
export function rollNumbers(root = document) {
  safely(() => {
    if (!root?.querySelectorAll || !canAnimate()) return;
    root.querySelectorAll('[data-roll]').forEach(el => {
      const target = Number(el.dataset.roll);
      if (!Number.isFinite(target)) return;
      const spring = new SpringODE({ mass: 1, stiffness: 130, damping: 18, precision: 0.45 });
      spring.set(0);
      el.textContent = '0';
      spring.onUpdate = value => {
        if (!el.isConnected) { spring.stop(); return; }
        el.textContent = String(Math.round(value));
      };
      spring.to(target, Math.min(90, Math.abs(target) * 0.35));
    });
  });
}

/**
 * 清简主题底栏：指针靠近时，只把「当前页」那一格平移最多 5px。
 * 其余格子在清简主题里是透明底，提升图层会在 WebView 里垫出白块，所以不动。
 * 不另做白胶囊。指针远离、主题不是清简、或系统要求减弱动效时，直接停，不给每颗按钮建弹簧。
 */
let magneticDockInstalled = false;

export function installMagneticDock() {
  if (typeof document === 'undefined' || magneticDockInstalled) return;
  safely(() => {
    const springs = new WeakMap();
    let engaged = false;
    let dockRect = null;
    let dockRectAt = 0;
    let dockNode = null;
    const springFor = button => {
      let spring = springs.get(button);
      if (spring) return spring;
      spring = new SpringODE({ mass: 0.8, stiffness: 260, damping: 22, precision: 0.05 });
      spring.onUpdate = value => {
        if (!button.isConnected) { spring.stop(); return; }
        if (Math.abs(value) < 0.04) {
          if (button.style.translate) button.style.translate = '';
          return;
        }
        button.style.translate = `${value.toFixed(2)}px 0`;
      };
      springs.set(button, spring);
      return spring;
    };
    const restDock = () => {
      if (!engaged) return;
      engaged = false;
      document.querySelectorAll('.floating-dock .dock-btn.active').forEach(button => {
        springs.get(button)?.to(0);
      });
    };
    document.addEventListener('pointermove', event => {
      if (document.documentElement.dataset.theme !== 'plain' || !canAnimate()) {
        restDock();
        return;
      }
      const dock = document.querySelector('.floating-dock');
      if (!dock) {
        restDock();
        dockNode = null;
        dockRect = null;
        return;
      }
      const now = performance.now();
      if (dock !== dockNode || !dockRect || now - dockRectAt > 240) {
        dockNode = dock;
        dockRect = dock.getBoundingClientRect();
        dockRectAt = now;
      }
      const rect = dockRect;
      const near = event.clientY >= rect.top - 28 && event.clientY <= rect.bottom + 36
        && event.clientX >= rect.left - 24 && event.clientX <= rect.right + 24;
      if (!near) {
        restDock();
        return;
      }
      const button = dock.querySelector('.dock-btn.active');
      if (!button) return;
      const box = button.getBoundingClientRect();
      const dx = event.clientX - (box.left + box.width / 2);
      const pull = Math.abs(dx) < box.width ? Math.max(-5, Math.min(5, dx * 0.18)) : 0;
      const spring = springFor(button);
      if (Math.abs(spring.target - pull) < 0.05 && Math.abs(spring.current - pull) < spring.precision) return;
      engaged = true;
      spring.to(pull);
    }, { passive: true });
    magneticDockInstalled = true;
  });
}
