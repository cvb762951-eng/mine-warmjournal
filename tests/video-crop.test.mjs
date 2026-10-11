import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CROP_PRESETS, MIN_CROP, clampCrop, normalizeCrop, isFullFrame, sameCrop,
  containBox, cropRect, rectToCrop, cropStyle, fitPresetCrop, presetRatio
} from '../video-crop.js';

test('clampCrop keeps the rect inside the frame and above the minimum size', () => {
  assert.deepEqual(clampCrop({ x: -0.5, y: -1, w: 3, h: 3 }), { x: 0, y: 0, w: 1, h: 1 });
  const tiny = clampCrop({ x: 0.5, y: 0.5, w: 0.001, h: 0.001 });
  assert.equal(tiny.w, MIN_CROP);
  assert.equal(tiny.h, MIN_CROP);
  // 越界的起点必须被推回，保证 x + w <= 1
  const pushed = clampCrop({ x: 0.95, y: 0.95, w: 0.5, h: 0.5 });
  assert.ok(pushed.x + pushed.w <= 1.000001);
  assert.ok(pushed.y + pushed.h <= 1.000001);
});

test('a full-frame rect is treated as "no crop"', () => {
  assert.equal(normalizeCrop({ x: 0, y: 0, w: 1, h: 1 }), null);
  assert.equal(normalizeCrop(null), null);
  assert.equal(isFullFrame({ x: 0, y: 0, w: 1, h: 1 }), true);
  const real = normalizeCrop({ x: 0.1, y: 0.2, w: 0.6, h: 0.5 });
  assert.deepEqual(real, { x: 0.1, y: 0.2, w: 0.6, h: 0.5 });
  assert.equal(isFullFrame(real), false);
});

test('sameCrop ignores sub-pixel noise but catches real edits', () => {
  assert.equal(sameCrop({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, { x: 0.1005, y: 0.1, w: 0.5, h: 0.5 }), true);
  assert.equal(sameCrop({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, { x: 0.3, y: 0.1, w: 0.5, h: 0.5 }), false);
  assert.equal(sameCrop(null, null), true);
  assert.equal(sameCrop(null, { x: 0, y: 0, w: 0.5, h: 0.5 }), false);
});

test('containBox letterboxes a wide video inside a taller container', () => {
  // 1920x1080 塞进 400x400：按宽度贴边，上下留黑
  const box = containBox(400, 400, 1920, 1080);
  assert.equal(box.width, 400);
  assert.equal(box.height, 225);
  assert.equal(box.left, 0);
  assert.equal(box.top, 87.5);
});

test('cropRect and rectToCrop round trip', () => {
  const crop = { x: 0.25, y: 0.1, w: 0.5, h: 0.5 };
  const rect = cropRect(400, 400, 1920, 1080, crop);
  const back = rectToCrop(rect.left, rect.top, rect.width, rect.height, 400, 400, 1920, 1080);
  assert.ok(Math.abs(back.x - crop.x) < 0.0005);
  assert.ok(Math.abs(back.y - crop.y) < 0.0005);
  assert.ok(Math.abs(back.w - crop.w) < 0.0005);
  assert.ok(Math.abs(back.h - crop.h) < 0.0005);
});

test('cropStyle clips to the rect then scales it up about its own corner', () => {
  const style = cropStyle(400, 400, 1920, 1080, { x: 0.5, y: 0, w: 0.5, h: 1 });
  assert.ok(style, '半幅裁剪必须产生样式');
  assert.match(style.clipPath, /^inset\(/);
  // 取景框左边在 200px 处（400 宽的一半），所以 clip 的 left 分量是 200px
  assert.match(style.clipPath, /200px\)$/);
  assert.match(style.transformOrigin, /^200px 87\.5px$/);
  // 取景框高 225px 要铺满 400px 高，放大 400/225 = 1.7778 倍
  assert.match(style.transform, /scale\(1\.7778\)$/);
  // 整幅画面不产生任何样式（等于没裁）
  assert.equal(cropStyle(400, 400, 1920, 1080, null), null);
  assert.equal(cropStyle(400, 400, 1920, 1080, { x: 0, y: 0, w: 1, h: 1 }), null);
});

test('preset ratios are output aspects, not normalized box aspects', () => {
  assert.equal(presetRatio('1:1'), 1);
  assert.equal(presetRatio('free'), null);
  assert.ok(Math.abs(presetRatio('original', 1080, 1920) - 0.5625) < 0.0001);
  assert.ok(CROP_PRESETS.some(preset => preset.key === 'free'));
  assert.ok(CROP_PRESETS.some(preset => preset.key === '9:16'));
});

test('fitPresetCrop produces a square output on a widescreen source', () => {
  const frame = 16 / 9;
  const crop = fitPresetCrop(1, frame, { x: 0.5, y: 0.5 });
  // 归一化方框：w/h 要乘回原始画幅比例之后才等于 1
  const outputAspect = (crop.w * 16) / (crop.h * 9);
  assert.ok(Math.abs(outputAspect - 1) < 0.001, `期望 1:1，实得 ${outputAspect}`);
  assert.ok(Math.abs((crop.x + crop.w / 2) - 0.5) < 0.0001);
});

test('fitPresetCrop keeps a 9:16 output on a landscape source', () => {
  const crop = fitPresetCrop(9 / 16, 16 / 9, { x: 0.5, y: 0.5 });
  const outputAspect = (crop.w * 16) / (crop.h * 9);
  assert.ok(Math.abs(outputAspect - 9 / 16) < 0.001, `期望 9:16，实得 ${outputAspect}`);
  assert.ok(crop.w >= MIN_CROP && crop.h >= MIN_CROP);
});
