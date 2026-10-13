import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MOMENTS_MOTION, containRect, sameRatio, flightTransform, shotPlan, saveShouldFly, cardKey,
} from '../motion-moments.js';

const moments = readFileSync(new URL('../motion-moments.js', import.meta.url), 'utf8');
const layers = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');
const snippets = readFileSync(new URL('../views/snippets.js', import.meta.url), 'utf8');
const light = readFileSync(new URL('../themes-plain-light.css', import.meta.url), 'utf8');

test('照片飞行：contain 框 + 单一 scale，比例差超过 0.5% 放弃', () => {
  const from = containRect({ left: 10, top: 20, width: 200, height: 100, naturalWidth: 400, naturalHeight: 200 });
  assert.deepEqual(from, { left: 10, top: 20, width: 200, height: 100, ratio: 2 });
  const letterbox = containRect({ left: 0, top: 0, width: 200, height: 200, naturalWidth: 400, naturalHeight: 200 });
  assert.equal(letterbox.width, 200);
  assert.equal(letterbox.height, 100);
  assert.equal(letterbox.top, 50);
  assert.equal(sameRatio({ width: 400, height: 300 }, { width: 200, height: 150 }), true);
  assert.equal(sameRatio({ width: 400, height: 300 }, { width: 160, height: 90 }), false);
  assert.equal(flightTransform({ left: 10, top: 20, width: 100, height: 75 }, { left: 30, top: 40, width: 200, height: 150 }), 'translate(20.00px, 20.00px) scale(2.0000)');
  assert.equal(flightTransform({ left: 0, top: 0, width: 400, height: 300 }, { left: 0, top: 0, width: 160, height: 90 }), null);
  assert.match(moments, /object-fit: contain|object-fit:contain|className = 'pl-fly-photo'/);
});

test('M1：最多 6 张依次飞入，其余淡入；参数照抄方案', () => {
  assert.deepEqual(shotPlan(0, 4), { fly: 4, fade: 0, start: 0 });
  assert.deepEqual(shotPlan(2, 12), { fly: 6, fade: 4, start: 2 });
  assert.deepEqual(shotPlan(10, 10), { fly: 0, fade: 0, start: 10 });
  assert.equal(MOMENTS_MOTION.shotMs, 520);
  assert.equal(MOMENTS_MOTION.shotStagger, 40);
  assert.equal(MOMENTS_MOTION.shotMaxFly, 6);
  assert.match(moments, /#capture-snippet-photo, #pick-snippet-photo/);
  assert.match(moments, /--pl-spring-magnet/);
});

test('M2：新建飞、编辑不飞；不做收成一叠；100 张上限仍在 snippets', () => {
  assert.equal(saveShouldFly({ editing: false, hasFreshCard: true }), true);
  assert.equal(saveShouldFly({ editing: true, hasFreshCard: true }), false);
  assert.equal(saveShouldFly({ editing: false, hasFreshCard: false }), false);
  assert.equal(MOMENTS_MOTION.saveMs, 480);
  assert.match(moments, /不做「收成一叠」|不做收成一叠/);
  assert.doesNotMatch(moments, /deck-stack|fanIn\(|maxFly:\s*4/);
  assert.match(snippets, /SNIPPET_PHOTO_LIMIT = 100/);
  assert.match(moments, /snippet-form/);
  assert.match(moments, /editing: Boolean/);
});

test('cardKey 用照片 / 视频按钮上的 snippet id', () => {
  const card = {
    querySelector(sel) {
      assert.match(sel, /data-view-snippet-photo/);
      return { dataset: { viewSnippetPhoto: 'abc', playSnippetVideo: '' } };
    },
  };
  assert.equal(cardKey(card), 'abc');
  assert.equal(cardKey(null), '');
});

test('接线：installLayerMotion 安装；不碰 storage / 通知 / 加密；CSS 有 M3/M4', () => {
  assert.match(layers, /installMomentsMotion\(\)/);
  assert.doesNotMatch(moments, /from '\.\/(core|storage|notifications|private-vault|model)\.js'/);
  assert.match(light, /三十二 · 随手拍动效/);
  assert.match(light, /\.pl-fly-photo/);
  assert.match(light, /\.pl-lifted/);
  assert.match(light, /\.pl-pre\.pl-layers/);
  assert.match(moments, /rootMargin: '0px 0px -8% 0px'/);
  assert.match(moments, /holdMs: 380/);
  assert.match(moments, /#moment-album-layer/);
});

test('不改 snippets 保存与图集一叠牌流程', () => {
  assert.match(snippets, /registerSubmitHandler\('snippet-form'/);
  assert.match(snippets, /moment-album-stack/);
  assert.doesNotMatch(moments, /closeMomentAlbum|openMomentAlbum|pendingSnippetPhotos\s*=/);
});

test('M1/M2 挂在真实「新增随手拍」快捷弹窗上（#quick-*），不只是编辑表单', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../motion-moments.js', import.meta.url), 'utf8');
  const view = await readFile(new URL('../views/snippets.js', import.meta.url), 'utf8');
  for (const id of ['quick-pick-snap', 'quick-capture-snap', 'quick-save-snap', 'quick-photo-preview']) {
    assert.ok(src.includes(`#${id}`), `motion-moments 应监听 #${id}`);
    assert.ok(view.includes(`id="${id}"`), `views/snippets.js 仍应有 #${id}`);
  }
});

test('coverRect：cover 封面按原图比例铺开，裁切 inset 对得上封面框', async () => {
  const { coverRect, sameRatio, containRect } = await import('../motion-moments.js');
  const cover = { left: 10, top: 20, width: 300, height: 170, naturalWidth: 1200, naturalHeight: 1600 };
  const c = coverRect(cover);
  assert.ok(Math.abs(c.rect.width / c.rect.height - 0.75) < 1e-9, '绘制框保持原图比例');
  assert.ok(Math.abs(c.clip.left) < 1e-9 && Math.abs(c.clip.right) < 1e-9);
  assert.ok(Math.abs(c.clip.top + c.clip.bottom + 170 - c.rect.height) < 1e-6, '上下裁掉的正好是多出来的部分');
  const card = { left: 0, top: 400, width: 336, height: 190, naturalWidth: 1200, naturalHeight: 1600 };
  assert.ok(sameRatio(c.rect, containRect(card)), '与新卡 contain 框比例一致 → 飞行而不是只淡入');
});
