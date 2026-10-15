import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LAYER_MOTION, motionTier, velocityOf, rubber, swipeZone, swipeIntent, swipeShouldComplete,
  sheetGeometry, sheetProgress, sheetFollow, sheetRelease, sheetCloseMs, canExpandFrom, ghostTransform, scrolledWithin,
  swipePointerDownAction, sheetPointerDownAction, translateYOf,
  swipeUnderTransform, sampleSessionJank,
  tidySwipe, clearCollapse, swallowNextClick,
} from '../motion-layers.js';

test('三档：减弱动态效果 → none，低端机 → lite，显式指定优先', () => {
  assert.equal(motionTier({ reduced: true, cores: 8 }), 'none');
  assert.equal(motionTier({ deviceMemory: 2, cores: 8 }), 'lite');
  assert.equal(motionTier({ deviceMemory: 8, cores: 4 }), 'lite');
  assert.equal(motionTier({ deviceMemory: 8, cores: 8 }), 'rich');
  assert.equal(motionTier({ override: 'lite', reduced: true }), 'lite');
});

test('速度取最近 100ms 平均', () => {
  assert.equal(velocityOf([[0, 0], [50, 10], [100, 60]]), 600);
  assert.equal(velocityOf([[0, 0], [200, 0], [250, 50]]), 1000);
  assert.equal(velocityOf([[0, 0]]), 0);
});

test('橡皮筋最多 40px 且单调', () => {
  assert.equal(rubber(0), 0);
  assert.ok(rubber(120) === 20);
  assert.ok(rubber(10000) < 40 && rubber(10000) > 39);
});

test('右滑起手区：左缘 24px / 左侧 60%', () => {
  assert.equal(swipeZone(10, 400), 'edge');
  assert.equal(swipeZone(24, 400), 'edge');
  assert.equal(swipeZone(200, 400), 'page');
  assert.equal(swipeZone(240, 400), null);
});

test('右滑判定：边缘 8px 且 dx>|dy|；全页 12px 且 dx>2|dy|', () => {
  assert.equal(swipeIntent({ dx: 5, dy: 0, zone: 'edge' }), 'wait');
  assert.equal(swipeIntent({ dx: 8, dy: 6, zone: 'edge' }), 'lock');
  assert.equal(swipeIntent({ dx: 8, dy: 6, zone: 'page' }), 'wait');
  assert.equal(swipeIntent({ dx: 12, dy: 8, zone: 'page' }), 'abort');
  assert.equal(swipeIntent({ dx: 20, dy: 5, zone: 'page' }), 'lock');
  assert.equal(swipeIntent({ dx: -20, dy: 0, zone: 'edge' }), 'abort');
});

test('右滑松手：快甩完成、慢拖过半完成、30% 回弹、拖出后往回拉回弹', () => {
  assert.equal(swipeShouldComplete({ x: 40, width: 400, velocity: 800 }), true);
  assert.equal(swipeShouldComplete({ x: 220, width: 400, velocity: 30 }), true);
  assert.equal(swipeShouldComplete({ x: 120, width: 400, velocity: 30 }), false);
  assert.equal(swipeShouldComplete({ x: 220, width: 400, velocity: -300 }), false);
});

test('弹层：慢拉 100px 回弹，慢拉 140px 关闭，快甩关闭', () => {
  const geo = sheetGeometry({ height: 400, viewport: 800 });
  assert.deepEqual(sheetRelease({ y: 100, velocity: 50, geo }), { target: 0, close: false });
  assert.equal(sheetRelease({ y: 140, velocity: 50, geo }).target, 0);   // 投影仍离 0 近
  assert.equal(sheetRelease({ y: 230, velocity: 50, geo }).close, true);
  assert.equal(sheetRelease({ y: 60, velocity: 1800, geo }).close, true);
  // 关闭线：可见高的 28%（大面板）
  const tall = sheetGeometry({ height: 700, viewport: 800 });
  assert.equal(sheetRelease({ y: 380, velocity: 0, geo: tall }).close, true);
});

test('弹层分档：高档快速下甩到中档而不是直接关闭', () => {
  const geo = sheetGeometry({ height: 736, viewport: 800, detents: true });
  assert.equal(geo.large, 0);
  assert.equal(Math.round(geo.medium), 320);
  const r = sheetRelease({ y: 40, velocity: 1500, geo });
  assert.equal(r.target, geo.medium);
  assert.equal(sheetRelease({ y: 300, velocity: -1500, geo }).target, geo.large);
});

test('弹层进度、跟手橡皮筋与关闭时长', () => {
  const geo = sheetGeometry({ height: 400, viewport: 800 });
  assert.equal(sheetProgress(0, geo), 1);
  assert.equal(sheetProgress(200, geo), 0.5);
  assert.equal(sheetProgress(400, geo), 0);
  assert.ok(sheetFollow(0, -100, geo) > -40);
  assert.equal(sheetCloseMs(300, 4000), 260);
  assert.equal(sheetCloseMs(200, 4000), 200);
  assert.equal(sheetCloseMs(10, 2000), 140);
  assert.equal(sheetCloseMs(300, 0), 260);
});

test('原位展开放弃条件与幽灵变换', () => {
  const vp = { width: 400, height: 800 };
  assert.equal(canExpandFrom({ left: 0, top: 100, right: 400, bottom: 160, width: 400, height: 60 }, vp), true);
  assert.equal(canExpandFrom({ left: 0, top: -10, right: 400, bottom: 50, width: 400, height: 60 }, vp), false);
  assert.equal(canExpandFrom({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600 }, vp), false);
  assert.equal(ghostTransform({ left: 10, top: 20, width: 100, height: 50 }, { left: 0, top: 0, width: 200, height: 100 }), 'translate(10.00px, 20.00px) scale(0.5000, 0.5000)');
});

test('参数照抄方案 9.1', () => {
  assert.equal(LAYER_MOTION.swipe.stiffness, 360);
  assert.equal(LAYER_MOTION.swipe.damping, 38);
  assert.equal(LAYER_MOTION.sheet.stiffness, 520);
  assert.equal(LAYER_MOTION.sheet.damping, 40);
  assert.equal(LAYER_MOTION.expand.ms, 440);
});

test('接线：app.js 启动时安装；不碰 core / snippets / 通知', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /import \{ installLayerMotion, applyMotionPreference \} from '\.\/motion-layers\.js'/);
  assert.match(app, /installLayerMotion\(\);/);
  // 动效偏好要在读完设置之后立刻应用一次（2026-10-15 加：用户可在设置里选"始终完整"）
  assert.match(app, /setState\(await initializeStorage\(defaults\)\);[\s\S]{0,400}applyMotionPreference\(state\.settings\?\.motionPreference\)/);
  const src = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from '\.\/(core|storage|notifications|private-vault)\.js'/);
  assert.doesNotMatch(src, /views\/snippets/);
});

test('弹层下拉：触点到面板之间任何一层滚过就不接管', () => {
  const modal = { scrollTop: 0, parentElement: { scrollTop: 50, parentElement: null } };
  const list = { scrollTop: 30, parentElement: modal };
  const item = { scrollTop: 0, parentElement: list };
  assert.equal(scrolledWithin(item, modal), true);
  list.scrollTop = 0;
  assert.equal(scrolledWithin(item, modal), false);   // 面板外层滚动不算
  modal.scrollTop = 5;
  assert.equal(scrolledWithin(item, modal), true);
});

test('复查修复：多指取消 / touchmove 只挂弹层 / 打断保护 / 免右滑区', () => {
  const src = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');
  assert.ok(!/document\.addEventListener\('touchmove'/.test(src), 'document 上不应再有 touchmove');
  assert.match(src, /e\.touches\.length !== 1\) \{ if \(g\) end\(true\)/);
  assert.match(src, /releaseSheet\(s, s\.y, cancelled \? 0 : velocityOf\(s\.samples\), cancelled\)/);
  assert.match(src, /s\.layer === topLayer\(\)/);
  assert.match(src, /stopExpand\(layer\);/);
  assert.match(src, /#background-preview, \[data-nav-drag\]/);
  assert.ok(!/attributes: true, attributeFilter: \['class'\], childList: true \}\);\n\}\n\n\/\* ── Z2/.test(src));
  const mine = readFileSync(new URL('../views/mine.js', import.meta.url), 'utf8');
  assert.match(mine, /id="background-preview" data-no-swipe-back/);
  assert.match(mine, /data-nav-drag data-no-swipe-back/);
});

test('右滑飞出不再被第二次按下弹回', () => {
  assert.equal(swipePointerDownAction({ flyingOut: true, settling: true }), 'ignore');
  assert.equal(swipePointerDownAction({ flyingOut: false, settling: true }), 'retake');
  assert.equal(swipePointerDownAction({}), 'begin');
  const src = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');
  assert.match(src, /flyingOut: Boolean\(settle\?\.flyingOut\)/);
  assert.match(src, /if \(action === 'ignore'\) return/);
  assert.match(src, /flyingOut: done/);
});

test('弹层关闭锁拖动，回弹中途从当前位置接着拖', () => {
  assert.deepEqual(sheetPointerDownAction({ closing: true, settling: true, currentY: 80 }), { kind: 'ignore' });
  assert.deepEqual(sheetPointerDownAction({ settling: true, currentY: 80 }), { kind: 'resume', y: 80 });
  assert.deepEqual(sheetPointerDownAction({}), { kind: 'begin' });
  assert.equal(translateYOf('translate3d(0, 42.5px, 0)'), 42.5);
  assert.equal(translateYOf('translateY(-3px)'), -3);
  assert.equal(translateYOf(''), 0);
  const src = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');
  assert.match(src, /sheetClosing = true/);
  assert.match(src, /translateYOf\(sheet\.style\.transform\)/);
  assert.match(src, /decision\.kind === 'resume'/);
  assert.match(src, /base = decision\.y/);
  assert.doesNotMatch(src, /const start = \(x, y, target, id, t\) => \{\n    if \(!on\(\) \|\| g\) return;\n    stopSheetSettle\(\);/);
});

test('Z1 收回不让 #app 左移回弹：pending/open 标记与收尾顺序', () => {
  const src = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../themes-plain-light.css', import.meta.url), 'utf8');
  assert.match(src, /markZ1Pending\(\)/);
  assert.match(src, /markZ1Open\(\)/);
  assert.match(src, /clearZ1\(\)/);
  assert.match(src, /ghost\.style\.willChange = 'auto'/);
  assert.match(src, /layer\.style\.opacity = '0'/);
  assert.match(src, /revealSource\(\)/);
  // 左移 / 遮罩只给普通推入，Z1 打开时排除
  assert.match(css, /:has\(\.subpage-layer\.active\):not\(\.pl-z1-open\):not\(\.pl-z1-pending\) > \.pl-subpage-dim/);
  assert.match(css, /:has\(\.subpage-layer\.active\):not\(\.pl-z1-open\):not\(\.pl-z1-pending\) > #app/);
  // 旧的「凡 active 就左移」写法不能再出现，否则收回仍会卡
  assert.doesNotMatch(css, /\.phone-shell:has\(\.subpage-layer\.active\) > #app \{ transform: translate3d\(-20%/);
});

test('弹层分档几何、默认 medium、从 medium 下甩关闭与上拉到 large', () => {
  const vp = 800;
  const h = vp * LAYER_MOTION.sheet.large; // 736px
  const geo = sheetGeometry({ height: h, viewport: vp, detents: true });
  assert.equal(geo.large, 0); // 92vh 顶部对齐
  assert.equal(Math.round(geo.medium), Math.round(vp * (LAYER_MOTION.sheet.large - LAYER_MOTION.sheet.medium))); // 736 - 416 = 320px
  assert.equal(geo.closed, h);

  // 从 medium (y=320) 下甩关闭：快甩 (velocity > 900)
  const flingClose = sheetRelease({ y: geo.medium + 40, velocity: 1200, geo });
  assert.equal(flingClose.close, true);
  assert.equal(flingClose.target, geo.closed);

  // 从 medium (y=320) 慢拖不足阈值回弹 medium
  const slowSettle = sheetRelease({ y: geo.medium + 30, velocity: 50, geo });
  assert.equal(slowSettle.close, false);
  assert.equal(slowSettle.target, geo.medium);

  // 从 medium (y=320) 慢拖：不够远仍回 medium / 超过中点才关闭
  const notFarEnough = sheetRelease({ y: geo.medium + 150, velocity: 0, geo });
  assert.equal(notFarEnough.close, false);
  assert.equal(notFarEnough.target, geo.medium);

  const slowClose = sheetRelease({ y: geo.medium + (geo.closed - geo.medium) * 0.5 + 2, velocity: 0, geo });
  assert.equal(slowClose.close, true);
  assert.equal(slowClose.target, geo.closed);

  // 从 medium (y=320) 上拉到 large
  const pullLarge = sheetRelease({ y: 160, velocity: -800, geo });
  assert.equal(pullLarge.close, false);
  assert.equal(pullLarge.target, geo.large);

  // 代码静态检查：识别到带 data-pl-detents 的新 sheet 默认设为 medium 并写 transform
  const src = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');
  assert.match(src, /sheet\.dataset\.plDetent = 'medium'/);
  assert.match(src, /sheet\.style\.transform = `translate3d\(0, \$\{geo\.medium\.toFixed\(1\)\}px, 0\)`/);
  assert.match(src, /\[\{ transform: `translate3d\(0, \$\{geo\.closed\}px, 0\)` \}, \{ transform: `translate3d\(0, \$\{geo\.medium\.toFixed\(1\)\}px, 0\)` \}\]/);

  // CSS 静态检查：92vh、贴底与照片 contain
  const css = readFileSync(new URL('../themes-plain-light.css', import.meta.url), 'utf8');
  assert.match(css, /:root\[data-theme="plain"\] \.modal\[data-pl-detents\] \{\s*height: 92vh;/);
  assert.match(css, /:root\[data-theme="plain"\] #modal-layer:has\(\.modal\[data-pl-detents\]\) \{\s*align-items: flex-end !important;/);
  assert.match(css, /:root\[data-theme="plain"\] \.quick-photo-preview img \{\s*object-fit: contain !important;/);
});

test('右滑时下层跟手：底页 −20%×(1−p) 进度公式与叠层 class', () => {
  assert.equal(swipeUnderTransform(0), 'translate3d(-20.00%, 0, 0)');
  assert.equal(swipeUnderTransform(0.5), 'translate3d(-10.00%, 0, 0)');
  assert.equal(swipeUnderTransform(1), 'translate3d(0.00%, 0, 0)');
  assert.equal(swipeUnderTransform(0.35), 'translate3d(-13.00%, 0, 0)');

  const src = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');
  assert.match(src, /currIndex > 0 \? activeLayers\[currIndex - 1\] : null/);
  assert.match(src, /g\.under\?\.classList\.add\('pl-swipe-under'\)/);
  assert.match(src, /s\.under\?\.classList\.remove\('pl-swipe-under'\)/);

  const light = readFileSync(new URL('../themes-plain-light.css', import.meta.url), 'utf8');
  assert.match(light, /\.subpage-layer\.pl-swipe-under \{ transition: none !important;/);
});

test('S3 深色桌面：rich + pl-sheet-open 时 .phone-shell 背景为深色', () => {
  const light = readFileSync(new URL('../themes-plain-light.css', import.meta.url), 'utf8');
  assert.match(light, /:root\[data-theme="plain"\]\[data-pl-motion="rich"\]\.pl-sheet-open \.phone-shell \{\s*background-color: #12100e !important;/);
  assert.match(light, /:root\[data-theme="plain"\] \.phone-shell \{\s*transition: background-color 320ms/);
});

test('画布质感底纹：非 none 档叠加 feTurbulence 静态细噪点，none / 减弱动效关闭', () => {
  const light = readFileSync(new URL('../themes-plain-light.css', import.meta.url), 'utf8');
  assert.match(light, /feTurbulence type='fractalNoise'/);
  assert.match(light, /:root\[data-theme="plain"\]:not\(\[data-pl-motion="none"\]\) \.view,\s*:root\[data-theme="plain"\]:not\(\[data-pl-motion="none"\]\) #app/);
  assert.match(light, /:root\[data-theme="plain"\]\[data-pl-motion="none"\] \.view/);
});

test('watchJank：1s 窗内 >3 次 dt>32ms 降到 sessionLite，显式优先且不改 storage', () => {
  let state = { windowStart: 0, long: 0, tier: 'rich' };
  // 动画未启动时不采样
  const idle = sampleSessionJank({ animating: false, sessionLite: false, state, dt: 50, now: 10 });
  assert.equal(idle.watching, false);
  assert.equal(idle.sessionLite, false);
  assert.equal(idle.state.long, 0);

  // 动画中采样长帧
  let s = sampleSessionJank({ animating: true, sessionLite: false, state, dt: 40, now: 10 });
  assert.equal(s.sessionLite, false);
  assert.equal(s.watching, true);
  assert.equal(s.state.long, 1);

  s = sampleSessionJank({ animating: true, sessionLite: false, state: s.state, dt: 40, now: 100 });
  s = sampleSessionJank({ animating: true, sessionLite: false, state: s.state, dt: 40, now: 200 });
  assert.equal(s.sessionLite, false);
  assert.equal(s.state.long, 3);

  // 第 4 次长帧 (>3 次) 触发降档
  s = sampleSessionJank({ animating: true, sessionLite: false, state: s.state, dt: 40, now: 300 });
  assert.equal(s.sessionLite, true);
  assert.equal(s.watching, false);

  // 降级后档位测试
  assert.equal(motionTier({ sessionLite: true }), 'lite');
  assert.equal(motionTier({ override: 'none', sessionLite: true }), 'none');
  assert.equal(motionTier({ override: 'lite', sessionLite: true }), 'lite');
  assert.equal(motionTier({ reduced: true, sessionLite: true }), 'none');

  // 超出 1s 窗重置计数
  const reset = sampleSessionJank({ animating: true, sessionLite: false, state: { windowStart: 0, long: 3, tier: 'rich' }, dt: 16, now: 1200 });
  assert.equal(reset.state.long, 0);
  assert.equal(reset.sessionLite, false);

  const src = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/);
});

test('随手拍快捷弹层不再设置 plDetents，watchSheets 也不自动赋 medium large', () => {
  const snippets = readFileSync(new URL('../views/snippets.js', import.meta.url), 'utf8');
  assert.doesNotMatch(snippets, /dataset\.plDetents =/);
  const src = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /sheet\.dataset\.plDetents = 'medium large'/);
  assert.doesNotMatch(src, /#quick-photo-modal, #quick-memo-modal/);
  assert.match(src, /root\?\.classList\.remove\('pl-sheet-open'\)/);
});

test('tidy 清理所有 .pl-swipe-under 元素（class、transform、--pl-dim、will-change）', () => {
  const src = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');
  assert.match(src, /document\.querySelectorAll\('\.pl-swipe-under'\)\.forEach/);
  assert.match(src, /el\.style\.removeProperty\?\.\('--pl-dim'\)/);
  assert.match(src, /el\.style\.willChange = ''/);
});

test('playExpand 移除 pl-collapse-out 并取消未完成的 opacity 动画', () => {
  let cancelled = false;
  const mock = {
    classList: { remove: () => {} },
    style: { opacity: '0' },
    getAnimations: () => [{ cancel: () => { cancelled = true; } }],
  };
  clearCollapse(mock);
  assert.equal(mock.style.opacity, '');
  assert.equal(cancelled, true);
  const src = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');
  assert.match(src, /function playExpand\(layer\) \{\s*clearCollapse\(layer\);/);
});

test('playCollapse 包含 timeout fallback (outMs + backMs + 500ms) 兜底移除 pl-collapse-out', () => {
  const src = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');
  assert.match(src, /fallbackTimer = setTimeout\(cleanup, E\.outMs \+ E\.backMs \+ 500\)/);
  assert.match(src, /clearTimeout\(fallbackTimer\)/);
});

test('swallowNextClick 在窗口期后自动失效，不吞后续正常点击', async () => {
  const listeners = new Map();
  const mockDoc = {
    addEventListener: (t, fn) => listeners.set(t, fn),
    removeEventListener: (t, fn) => { if (listeners.get(t) === fn) listeners.delete(t); },
  };
  swallowNextClick(mockDoc, 40);
  assert.ok(listeners.has('click'));
  await new Promise(r => setTimeout(r, 60));
  assert.equal(listeners.has('click'), false);
});

test('动效开关：选「始终完整」要压过系统的减弱动效，并且覆盖所有降级块', () => {
  const src = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');
  const mine = readFileSync(new URL('../views/mine.js', import.meta.url), 'utf8');
  const motion = readFileSync(new URL('../motion.js', import.meta.url), 'utf8');

  // ① 档位判定：显式 rich 必须排在 reduced 之前 —— 否则用户选了“完整”也没用
  const richAt = src.indexOf("if (override === 'rich') return override;");
  const reducedAt = src.indexOf("if (reduced) return 'none';");
  assert.ok(richAt > 0 && reducedAt > 0, '两处判定都要在');
  assert.ok(richAt < reducedAt, '显式“完整”要排在“减弱动态效果”之前');

  // ② 写这个显式偏好的只有一个地方
  assert.match(src, /export function applyMotionPreference/);
  assert.match(src, /root\.dataset\.plMotionExplicit = 'rich'/);
  assert.match(src, /root\.dataset\.plMotionExplicit = 'none'/);

  // ③ JS 那层也要认（筛选 FLIP、✕ 退场、扫动/弹层物理全看 canAnimate）
  assert.match(motion, /explicit === 'rich'[\s\S]{0,120}!document\.hidden/, 'canAnimate 要认“完整”');
  assert.match(motion, /explicit === 'none'[\s\S]{0,80}return false/, 'canAnimate 要认“关闭”');

  // ④ 设置界面里能选到（我的 → 外观与偏好 → 动效）
  assert.match(mine, /id="settings-motion"/, '「我的」里要有这一行');
  assert.match(mine, /MOTION_CHOICES = \['', 'full', 'off'\]/, '三个选项：跟随系统 / 始终完整 / 关闭');
  assert.match(mine, /applyMotionPreference\(input\.value\)/, '选了要立刻生效');

  /* ⑤ 最关键的一条：CSS 里的降级块是**纯 CSS** 关动画的（animation: none !important），
     JS 的 canAnimate 管不到。所以每个降级块里的选择器都得带上
     :root:not([data-pl-motion-explicit="rich"]) 这道闸，否则就成了“开关只救得回几个动效”。 */
  const files = ['styles.css', 'performance.css', 'themes-plain-light.css', 'themes-plain.css'];
  let blocks = 0;
  let guards = 0;
  for (const name of files) {
    const css = readFileSync(new URL('../' + name, import.meta.url), 'utf8');
    blocks += (css.match(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/g) || []).length;
    guards += (css.match(/data-pl-motion-explicit="rich"/g) || []).length;
  }
  assert.ok(blocks >= 30, '降级块数量不对（' + blocks + '），检查扫描');
  assert.ok(guards >= blocks, '有降级块没带守卫：块 ' + blocks + ' 处，守卫 ' + guards + ' 处');
});
