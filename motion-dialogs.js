/* ============================================================================
 * motion-dialogs.js · 确认框与小弹窗 Z5–Z9（清简主题）
 *
 * 方案出处：PR #36 docs/design-upgrade-plan.md §9.7–9.11。
 *   Z5 确认框居中卡 + 轻缩放 + 静态模糊遮罩（点外不关）
 *   Z6 二级页叠层：下层 active 页 translateX(-20%)
 *   Z7 锚点弹出菜单（日记牌组 ⋯ 不改）
 *   Z8 防误关轻推（确认框 / 未保存表单点遮罩）
 *   Z9 返回箭头按下位移（选择器：.subpage-back-btn）
 *
 * 只旁听 DOM / 捕获阶段事件。不改 storage / notifications / vault 加密。
 * ========================================================================== */
import { prefersReducedMotion } from './motion.js';

export const DIALOG_MOTION = {
  confirmInMs: 200,
  confirmOutMs: 140,
  nudgeMs: 260,
  popInMs: 180,
  popOutMs: 120,
  backPressMs: 90,
  backReleaseMs: 420,
};

/** 点遮罩该不该关掉：确认框和未保存表单都不关，交给 Z8 轻推。 */
export function backdropAction({ confirm = false, unsaved = false, alarm = false } = {}) {
  if (alarm) return 'ignore';
  if (confirm || unsaved) return 'nudge';
  return 'close';
}

/** 表单是否像「有未保存内容」：有待保存照片格，或必填/说明 textarea 已有字。 */
export function formLooksUnsaved(modal) {
  if (!modal) return false;
  if (modal.classList?.contains('confirm-sheet')) return false;
  if (modal.querySelector?.('.snippet-photo-cell, .snippet-video-cell')) return true;
  const text = modal.querySelector?.('textarea[name="text"], textarea[required]');
  if (text && String(text.value || '').trim()) return true;
  if (modal.matches?.('[data-pl-no-dismiss], .snippet-form-modal')) {
    if (text && String(text.value || '').trim()) return true;
    if (modal.querySelector?.('.snippet-photo-cell')) return true;
  }
  return Boolean(modal.querySelector?.('[data-pl-no-dismiss]'));
}

/** 触发按钮相对菜单的角，写成 transform-origin。 */
export function popoverOrigin(triggerRect, menuRect) {
  if (!triggerRect || !menuRect) return '100% 0';
  const triggerCx = triggerRect.left + triggerRect.width / 2;
  const triggerCy = triggerRect.top + triggerRect.height / 2;
  const menuCx = menuRect.left + menuRect.width / 2;
  const menuCy = menuRect.top + menuRect.height / 2;
  const x = triggerCx <= menuCx ? '0' : '100%';
  const y = triggerCy <= menuCy ? '0' : '100%';
  return `${x} ${y}`;
}

/** 叠层：所有非最上层的 active 二级页应左移。 */
export function stackedSubpageIndexes(activeCount) {
  if (activeCount < 2) return [];
  return Array.from({ length: activeCount - 1 }, (_, i) => i);
}

/* ── 运行时 ─────────────────────────────────────────────────────── */
const hasDom = typeof document !== 'undefined';
const root = hasDom ? document.documentElement : null;
const on = () => root?.dataset.theme === 'plain';
const tier = () => root?.dataset.plMotion || 'rich';
const moving = () => on() && tier() !== 'none' && !prefersReducedMotion();
const safe = run => { try { return run(); } catch { return null; } };

function currentModal() {
  return document.querySelector('#modal-layer.open > .modal');
}

function isConfirmModal(modal) {
  return Boolean(modal?.classList?.contains('confirm-sheet') || modal?.querySelector?.('#confirm-delete'));
}

function nudge(modal) {
  if (!modal || !on()) return;
  if (modal.classList.contains('pl-nudge')) modal.classList.remove('pl-nudge');
  // 强制重启发
  void modal.offsetWidth;
  modal.classList.add('pl-nudge');
  const done = () => { if (modal.classList.contains('pl-nudge')) modal.classList.remove('pl-nudge'); };
  modal.addEventListener('animationend', done, { once: true });
  setTimeout(done, DIALOG_MOTION.nudgeMs + 40);
}

function markConfirmSheets() {
  const layer = document.querySelector('#modal-layer.open');
  if (!layer || !on()) return;
  const modal = layer.querySelector(':scope > .modal');
  if (!modal) return;
  if (modal.querySelector('#confirm-delete') && !modal.classList.contains('confirm-sheet')) {
    modal.classList.add('confirm-sheet');
  }
  const isConfirm = modal.classList.contains('confirm-sheet');
  // 打开期间给 layer 打标，方便 CSS :has 之外的兜底
  if (layer.classList.contains('pl-confirm-open') !== isConfirm) {
    layer.classList.toggle('pl-confirm-open', isConfirm);
  }
  if (isConfirm) {
    // 兜底：焦点落到 [data-close] 取消钮，绝不自动 focus 删除
    const cancel = modal.querySelector('[data-close]');
    if (cancel && document.activeElement !== cancel) {
      requestAnimationFrame(() => cancel.focus?.({ preventScroll: true }));
    }
  }
}

/* ── Z8 点遮罩轻推（捕获阶段拦住 app.js 的关闭）───────────────── */
function onBackdropClick(event) {
  if (!on()) return;
  if (event.target?.id !== 'modal-layer') return;
  const modal = currentModal();
  if (!modal) return;
  const alarm = Boolean(modal.classList.contains('alarm-modal') || document.querySelector('.alarm-modal'));
  const action = backdropAction({
    confirm: isConfirmModal(modal),
    unsaved: formLooksUnsaved(modal),
    alarm,
  });
  if (action === 'ignore') return;
  if (action === 'nudge') {
    event.preventDefault();
    event.stopPropagation();
    if (moving() || tier() === 'none') nudge(modal); // none 档仍给一次静态反馈（直接加类）
    return;
  }
}

/* ── Z7 锚点菜单：给 .pl-popover 写 origin；跳过日记牌组 ⋯ ───── */
function enhancePopover(menu, trigger) {
  if (!menu || !on() || !moving()) return;
  if (menu.closest?.('.journal-deck, .journal-deck-mini, .journal-deck-panel')) return;
  menu.classList.add('pl-popover');
  const origin = popoverOrigin(trigger?.getBoundingClientRect?.(), menu.getBoundingClientRect?.());
  menu.style.setProperty('--pl-origin', origin);
  [...menu.children].forEach((child, i) => child.style.setProperty('--pl-ci', String(i)));
  menu.classList.add('open');
}

function onMaybePopover(event) {
  if (!on()) return;
  const trigger = event.target.closest?.('[data-pl-popover], .subpage-nav-action, .course-nav-settings');
  if (!trigger) return;
  if (trigger.closest?.('.journal-deck, .journal-deck-mini')) return;
  // 下一帧找刚出现的菜单（由各页面自己打开）
  requestAnimationFrame(() => {
    const menu = document.querySelector('.pl-popover:not(.open), [data-pl-popover-menu]:not(.open)');
    if (menu) enhancePopover(menu, trigger);
  });
}

/* ── Z9 返回箭头 ─────────────────────────────────────────────── */
function onBackDown(event) {
  if (!on()) return;
  const back = event.target.closest?.('.subpage-back-btn');
  if (!back) return;
  back.dataset.pressed = '1';
}

function onBackUp() {
  document.querySelectorAll('.subpage-back-btn[data-pressed]').forEach(btn => {
    delete btn.dataset.pressed;
  });
}

/* ── 观察确认框出现 ───────────────────────────────────────────── */
function watchModals() {
  const layer = document.querySelector('#modal-layer');
  if (!layer) return;
  new MutationObserver(() => {
    safe(markConfirmSheets);
    if (!layer.classList.contains('open') && layer.classList.contains('pl-confirm-open')) {
      layer.classList.remove('pl-confirm-open');
    }
  }).observe(layer, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}

let installed = false;
export function installDialogMotion() {
  if (!hasDom || installed) return;
  installed = true;
  safe(() => {
    document.addEventListener('click', onBackdropClick, true);
    document.addEventListener('click', onMaybePopover, true);
    document.addEventListener('pointerdown', onBackDown, { capture: true, passive: true });
    document.addEventListener('pointerup', onBackUp, { capture: true, passive: true });
    document.addEventListener('pointercancel', onBackUp, { capture: true, passive: true });
    watchModals();
    markConfirmSheets();
  });
}
