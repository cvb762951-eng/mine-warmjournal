/**
 * 清简 · 签名动效（方案 #36 §8：S1、S4–S12）
 *
 * 原样照抄 docs/design-upgrade-plan.md §8.4，选择器换成真实 DOM（无头 Chrome 390px 核对过）。
 * - 不改任何 views/*.js；S1 / S5 / S7 / S8 用一个 MutationObserver 观察 #app，每帧最多跑一次 enhance()。
 * - S9 / S10 用 document 级事件委托。S4 / S6 / S11 / S12 纯 CSS（themes-plain-light.css 三十七节）。
 * - 档位沿用 motion-layers.js 写在 <html data-pl-motion> 上的 rich / lite / none，本模块只读不写。
 * - 只动 transform / opacity；不碰数据、存储、提醒、加密；不碰任何照片表面。
 */
import { beginJankWatch, endJankWatch } from './motion-layers.js';

const root = typeof document !== 'undefined' ? document.documentElement : null;
const tier = () => root?.dataset.plMotion || 'rich';
const plain = () => root?.dataset.theme === 'plain';
const rich = () => plain() && tier() === 'rich';
const moving = () => plain() && tier() !== 'none';

let installed = false;
export function installSignatureMotion() {
  if (installed || !root || typeof MutationObserver === 'undefined') return;
  const app = document.getElementById('app');
  if (!app) return;
  installed = true;
  let queued = false;
  const run = () => { queued = false; if (plain()) { try { enhance(app); } catch { /* 动效失败不影响页面 */ } } };
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
  }).observe(app, { childList: true, subtree: true });
  run();
  installTilt(); installInk();   // S9 / S10
}

function enhance(scope) {
  if (moving()) revealMasthead(scope);   // S1
  placeCalendarCursor(scope);            // S5（none 档瞬移，仍要放游标）
  rollDigits(scope);                     // S7（none 档 CSS 关过渡，直接显示）
  if (rich()) addSheen(scope);           // S8
}

/* ── S1 刊头晨光：五行从遮罩里升起，每次启动只播一次（内存变量，不写存储） ── */
let mastPlayedAt = 0;   // 启动时今日会连渲染两次（先骨架、读完数据再渲染），1.5s 内新出现的刊头接着播，之后只走普通入场
const MAST_LINES = ':scope > .magazine-brand-line, :scope > .magazine-title-date > .date-year, :scope > .magazine-title-date > .date-num, :scope > .magazine-title-date > .date-name, :scope > .editorial-cover-motto';
function revealMasthead(scope) {
  if (mastPlayedAt && performance.now() - mastPlayedAt > 1500) return;
  const mast = scope.querySelector('.today-view .magazine-header');
  if (!mast || mast.classList.contains('pl-mast-done')) return;
  if (!mastPlayedAt) mastPlayedAt = performance.now();
  mast.classList.add('pl-mast-done');
  mast.querySelectorAll(MAST_LINES).forEach((line, i) => {
    if (line.querySelector(':scope > .pl-rv')) return;
    const inner = document.createElement('span');
    inner.className = 'pl-rv-in';
    inner.style.setProperty('--ri', i);
    inner.append(...line.childNodes);
    const wrap = document.createElement('span');
    wrap.className = 'pl-rv';
    wrap.append(inner);
    line.append(wrap);
  });
  mast.classList.add('pl-mast-play');
  beginJankWatch();
  setTimeout(() => {
    mast.classList.remove('pl-mast-play');
    endJankWatch();
  }, 1400);
}

/* ── S5 磁吸游标：整个月网格只有一块蓝游标，点另一天带过冲滑过去 ── */
let lastCursor = null;   // { month, transform }：点日期时整网格会重绘，用旧位置当起点
function placeCalendarCursor(scope) {
  const grid = scope.querySelector('.calendar-view .calendar-full-grid');
  if (!grid) return;
  let cursor = grid.querySelector(':scope > .pl-cal-cursor');
  const fresh = !cursor;
  const month = grid.closest('.calendar-month-paper')?.querySelector('.month-nav-title')?.textContent || '';
  if (fresh) {
    cursor = Object.assign(document.createElement('i'), { className: 'pl-cal-cursor' });
    cursor.setAttribute('aria-hidden', 'true');
    grid.prepend(cursor);
    grid.classList.add('pl-has-cursor');
  }
  const day = grid.querySelector('.cal-cell.active');
  if (!day) { cursor.style.opacity = '0'; return; }
  const x = day.offsetLeft + (day.offsetWidth - 36) / 2;
  const y = day.offsetTop + (day.offsetHeight - 36) / 2;
  const to = `translate(${x}px, ${y}px)`;
  if (fresh) {
    const slide = moving() && lastCursor && lastCursor.month === month && lastCursor.transform !== to;
    cursor.classList.add('pl-cursor-jump');
    if (slide) {
      cursor.style.transform = lastCursor.transform;
      cursor.style.opacity = '1';
      grid.classList.add('pl-cursor-sliding');
      void cursor.offsetWidth;
      cursor.classList.remove('pl-cursor-jump');
      cursor.style.transform = to;
      setTimeout(() => grid.classList.remove('pl-cursor-sliding'), 140);
    } else {
      cursor.style.transform = to;
      cursor.style.opacity = '0';
      void cursor.offsetWidth;
      cursor.classList.add('pl-cursor-fade');
      cursor.classList.remove('pl-cursor-jump');
      cursor.style.opacity = '1';
    }
  } else if (cursor.style.transform !== to) {
    cursor.style.transform = to;
    cursor.style.opacity = '1';
  }
  lastCursor = { month, transform: to };
}

/* ── S7 数字翻牌：每位一条 0–9 转轮，个位先停，只动 transform ── */
const ROLL_TARGETS = '.ledger-view .ledger-total-amount, .snippets-stats-hero .snippet-kpi-val, .calendar-view .cal-kpi-cell > span > b';
function rollDigits(scope) {
  scope.querySelectorAll(ROLL_TARGETS).forEach(el => {
    if (el.closest('.pl-reel')) return;   // 转轮里的 <b> 也可能命中选择器，必须跳过，否则每帧翻倍
    if (el.children.length && !el.classList.contains('pl-reels')) return;   // 里面有别的节点就不动，免得吃掉结构
    const text = el.classList.contains('pl-reels') ? el.getAttribute('aria-label') : el.textContent.trim();
    if (el.dataset.plRolled === text) return;   // 防重入：自己写 innerHTML 会再触发一次观察，不能删
    el.dataset.plRolled = text;
    el.setAttribute('aria-label', text);
    el.classList.add('pl-reels');
    const chars = [...text];
    let digitIndex = chars.filter(c => /\d/.test(c)).length;
    el.innerHTML = chars.map(c => {
      if (!/\d/.test(c)) return `<span class="pl-reel-static" aria-hidden="true">${c.replace(/[&<>]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[s]))}</span>`;
      digitIndex -= 1;
      return `<span class="pl-reel" aria-hidden="true" style="--d:0;--di:${digitIndex}"><span>${'0123456789'.split('').map(n => `<b>${n}</b>`).join('')}</span></span>`;
    }).join('');
    const digits = chars.filter(c => /\d/.test(c));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.querySelectorAll('.pl-reel').forEach((reel, i) => reel.style.setProperty('--d', digits[i]));
    }));
  });
}

/* ── S8 主角卡微光：每张卡插一次空节点 .pl-sheen（动画完删掉）+ .pl-glare（S9 柔光） ── */
function addSheen(scope) {
  scope.querySelectorAll('.halo-card').forEach(card => {
    if (card.dataset.plSheen) return;
    card.dataset.plSheen = '1';
    const sheen = Object.assign(document.createElement('i'), { className: 'pl-sheen' });
    sheen.setAttribute('aria-hidden', 'true');
    const glare = Object.assign(document.createElement('i'), { className: 'pl-glare' });
    glare.setAttribute('aria-hidden', 'true');
    card.append(sheen, glare);
    startSheen(sheen);
  });
}

function startSheen(sheen) {
  // 关键帧写在 JS 里：主题样式表的测试要求每个 @keyframes 只有一段
  const play = sheen.animate?.([
    { opacity: 0, transform: 'translateX(-110%)', offset: 0 },
    { opacity: 1, offset: .15 },
    { opacity: 1, offset: .85 },
    { opacity: 0, transform: 'translateX(200%)', offset: 1 },
  ], { duration: 1100, delay: 900, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'both' });
  if (play) play.finished.then(() => sheen.remove(), () => sheen.remove());
}

/* ── S9 指尖倾斜 ── */
function installTilt() {
  let card = null, rect = null, start = null, raf = 0, px = .5, py = .5;
  const apply = () => {
    raf = 0;
    if (!card) return;
    card.style.setProperty('--pl-rx', `${((.5 - py) * 2 * 5).toFixed(2)}deg`);
    card.style.setProperty('--pl-ry', `${((px - .5) * 2 * 5).toFixed(2)}deg`);
    card.style.setProperty('--pl-gx', `${(px * rect.width - 80).toFixed(1)}px`);
    card.style.setProperty('--pl-gy', `${(py * rect.height - 80).toFixed(1)}px`);
  };
  const release = () => {
    if (!card) return;
    const done = card;
    done.classList.remove('pl-tilting');
    done.style.setProperty('--pl-rx', '0deg');
    done.style.setProperty('--pl-ry', '0deg');
    setTimeout(() => done.classList.remove('pl-tilt'), 540);
    card = null;
  };
  document.addEventListener('pointerdown', e => {
    if (!rich()) return;
    const c = e.target.closest?.('.halo-card');
    if (!c) return;
    card = c; rect = c.getBoundingClientRect(); start = { x: e.clientX, y: e.clientY, t: performance.now() };
    px = (e.clientX - rect.left) / rect.width; py = (e.clientY - rect.top) / rect.height;
    c.classList.add('pl-tilt', 'pl-tilting');
    apply();
  }, { passive: true });
  document.addEventListener('pointermove', e => {
    if (!card) return;
    if (performance.now() - start.t < 150 && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) { release(); return; }
    px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    if (!raf) raf = requestAnimationFrame(apply);
  }, { passive: true });
  ['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, release, { passive: true }));
}

/* ── S10 墨晕：白底卡片里的行和卡；不含提醒区、底栏、照片表面 ── */
const INK_ON = '.setting-item-row, .cal-tool-btn, .qa-card, .snippet-tool-btn, .subpage-layer .detail-sheet-row';
function installInk() {
  document.addEventListener('pointerdown', e => {
    if (!rich()) return;
    const host = e.target.closest?.(INK_ON);
    if (!host || host.closest('#settings-reminder-status, .setting-reminder-status, .floating-dock') || host.querySelector('img, video')) return;
    const r = host.getBoundingClientRect();
    const d = 2 * Math.hypot(r.width, r.height);
    const ink = document.createElement('i');
    ink.className = 'pl-ink';
    ink.setAttribute('aria-hidden', 'true');
    ink.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    host.append(ink);
    ink.addEventListener('animationend', () => ink.remove(), { once: true });
    setTimeout(() => ink.remove(), 900);
  }, { passive: true });
}
