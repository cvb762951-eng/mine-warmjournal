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
 */
export function morphFrom(trigger, panel, { duration = DURATION.morph } = {}) {
  if (!canAnimate() || !trigger || !panel) return null;
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

    let surface = null;
    if (!transparentPanel) {
      surface = document.createElement('div');
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
    }

    const scaleX = from.width / to.width;
    const scaleY = from.height / to.height;
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    const dy = (from.top + from.height / 2) - (to.top + to.height / 2);

    // 面板先藏起来，等面长到位置再淡入 —— 否则会看到"面板已经在、面又盖上来"
    panel.animate(
      [{ opacity: 0 }, { opacity: 0, offset: 0.55 }, { opacity: 1 }],
      { duration, easing: EASE.fluid, fill: 'backwards' }
    ).finished.catch(() => {});

    if (!surface) return null;

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

export function withSharedTransition(sourceEl, update, { targetSelector = '', duration = DURATION.shared, fallbackTargetSelector = '' } = {}) {
  const supported = typeof document !== 'undefined' && typeof document.startViewTransition === 'function';
  if (!canAnimate() || !supported || !sourceEl || !update) {
    // 没有 View Transitions：用两段式 FLIP 顶上
    if (!canAnimate() || !sourceEl) { update?.(); return null; }
    const handoff = beginSharedElement(sourceEl, { duration });
    const result = update();
    Promise.resolve(result).then(() => requestAnimationFrame(() => handoff(fallbackTargetSelector ? document.querySelector(fallbackTargetSelector) : null))).catch(() => {});
    return null;
  }
  return safely(() => {
    const name = nextShareName();
    const cleanup = [];
    sourceEl.style.viewTransitionName = name;
    cleanup.push(() => { sourceEl.style.viewTransitionName = ''; });

    const transition = document.startViewTransition(() => {
      const done = update();
      // update 可能是异步的（比如要先解密）；返回 Promise 时浏览器会等它
      return Promise.resolve(done).then(async () => {
        const target = targetSelector ? document.querySelector(targetSelector) : null;
        if (!target) return;
        /* ⚠️ 等图片解码完再让浏览器拍"新状态"快照。
           不等的话，快照里的图还是空白 —— 观感就是"打开大图时闪一下"。
           这是 View Transitions 配大图时的标准做法（update 回调支持 await，就是为这个）。 */
        if (target.tagName === 'IMG' && !target.complete) {
          await target.decode?.().catch(() => {});
        }
        target.style.viewTransitionName = name;
        cleanup.push(() => { target.style.viewTransitionName = ''; });
      });
    });
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

  return targetEl => {
    if (!targetEl) return;
    safely(() => {
      const to = targetEl.getBoundingClientRect();
      if (!to.width || !to.height) return;
      const from = captured.rect;
      const ghost = captured.node;
      ghost.classList.add('shared-element-ghost');
      ghost.style.cssText = [
        'position:fixed',
        `left:${from.left}px`,
        `top:${from.top}px`,
        `width:${from.width}px`,
        `height:${from.height}px`,
        `border-radius:${captured.radius}`,
        'margin:0',
      ].join(';');
      document.body.appendChild(ghost);

      // 目标先隐形，等幽灵落位再显形 —— 交接处不会闪
      const previousOpacity = targetEl.style.opacity;
      targetEl.style.opacity = '0';

      const targetRadius = getComputedStyle(targetEl).borderRadius;
      ghost.animate(
        [
          { transform: 'none', borderRadius: captured.radius },
          {
            transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`,
            borderRadius: targetRadius,
          },
        ],
        { duration, easing: EASE.fluid, fill: 'forwards' }
      ).finished
        .catch(() => {})
        .then(() => {
          ghost.remove();
          targetEl.style.transition = `opacity 180ms ${EASE.settle}`;
          targetEl.style.opacity = previousOpacity || '1';
          setTimeout(() => { targetEl.style.transition = ''; }, 240);
        });

      // 源卡片淡出，避免"一份变成两份"
      sourceEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration * 0.5, easing: EASE.settle, fill: 'forwards' });
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
  '.ledger-add-btn', '.habit-switch-chip', '.subpage-back-btn', '.profile-edit-pill',
  '.modal-actions button', '.vault-item-menu-actions > button', '.bento-card-footer',
].join(',');

const PRESS_LIGHT = [
  '.qa-card', '.stack-card', '.bento-item-mini',
  '.stats-habit-row', '.snippet-item-card', '.snippet-media-card', '.snippet-photo-tile',
  '.ledger-row', '.account-mini-card', '.day-photo-thumb',
  '.vault-item-open', '.countdown-card', '.course-row', '.setting-item-row',
].join(',');

export const PRESS_SELECTOR = `${PRESS_SOLID},${PRESS_LIGHT}`;

let pressInstalled = false;

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
