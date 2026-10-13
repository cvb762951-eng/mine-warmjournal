import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LAYER_MOTION, motionTier, velocityOf, rubber, swipeZone, swipeIntent, swipeShouldComplete,
  sheetGeometry, sheetProgress, sheetFollow, sheetRelease, sheetCloseMs, canExpandFrom, ghostTransform,
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
  assert.match(app, /import \{ installLayerMotion \} from '\.\/motion-layers\.js'/);
  assert.match(app, /installLayerMotion\(\);/);
  const src = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from '\.\/(core|storage|notifications|private-vault)\.js'/);
  assert.doesNotMatch(src, /views\/snippets/);
});
