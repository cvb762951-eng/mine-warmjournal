import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { photoFrameLayersHtml } from '../photo-frame.js';
import {
  THUMB_MAX, THUMB_DB, THUMB_PLACEHOLDER, PROGRESSIVE_ROOT_MARGIN,
  progressiveSource, syncProgressiveImage, watchProgressiveImages, releaseProgressiveImages,
  _seedThumbForTest, _deliverThumbForTest, _setProgressiveDwellForTest, _resetThumbsForTest
} from '../photo-thumbs.js';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const REF = 'mine-media://shot.jpg';
const FULL = 'https://media.example/shot.jpg';
const THUMB = 'blob:thumb-shot';

function fakeImg(attrs) {
  const attributes = { ...attrs };
  const dataset = {};
  if (attributes['data-progressive']) dataset.progressive = attributes['data-progressive'];
  if (attributes['data-thumb-ref']) dataset.thumbRef = attributes['data-thumb-ref'];
  if (attributes['data-full-src']) dataset.fullSrc = attributes['data-full-src'];
  const img = {
    dataset,
    isConnected: true,
    decoding: '',
    srcLog: [],
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null; },
    removeAttribute(name) { delete attributes[name]; },
    set src(value) {
      attributes.src = String(value);
      img.srcLog.push(attributes.src);
    },
    get src() { return attributes.src || ''; }
  };
  return img;
}

function frame(src = THUMB_PLACEHOLDER) {
  const pad = fakeImg({ src, 'data-thumb-ref': REF });
  const still = fakeImg({ src, 'data-thumb-ref': REF, 'data-progressive': '1', 'data-full-src': FULL });
  const parent = {
    querySelectorAll(sel) {
      return sel === 'img[data-thumb-ref]' ? [pad, still] : [];
    }
  };
  pad.parentElement = parent;
  still.parentElement = parent;
  return { pad, still };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test.beforeEach(() => { _resetThumbsForTest(); _setProgressiveDwellForTest(0); });
test.afterEach(() => { _resetThumbsForTest(); delete globalThis.IntersectionObserver; delete globalThis.document; });

test('渐进首帧用 480 或占位，不把原图写进 src；缩略图缓存键不升版本', async () => {
  assert.equal(THUMB_MAX, 480);
  assert.equal(progressiveSource(REF), THUMB_PLACEHOLDER);
  _seedThumbForTest(REF, THUMB);
  assert.equal(progressiveSource(REF), THUMB);
  assert.equal(progressiveSource('data:image/png;base64,AA'), 'data:image/png;base64,AA');
  const thumbs = await read('photo-thumbs.js');
  assert.equal(THUMB_DB, 'mine_warmjournal_thumbs');
  assert.match(thumbs, /indexedDB\.open\(THUMB_DB, 1\)/);
  assert.match(thumbs, /quality = 0\.8/);
});

test('相框只在清晰层标记 data-progressive，铺底仍带同一条缩略图引用', () => {
  const html = photoFrameLayersHtml('thumb.jpg', { alt: '照片', lazy: true, thumbRef: REF, progressive: true });
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map(match => match[0]);
  assert.equal(imgs.length, 2);
  assert.match(imgs[0], /photo-blur-pad/);
  assert.doesNotMatch(imgs[0], /data-progressive/);
  assert.match(imgs[0], new RegExp(`data-thumb-ref="${REF.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(imgs[1], /photo-blur-still/);
  assert.match(imgs[1], /data-progressive="1"/);
  assert.match(imgs[1], /decoding="async"/);
  assert.doesNotMatch(photoFrameLayersHtml('thumb.jpg', { thumbRef: REF }), /data-progressive/);
  assert.doesNotMatch(photoFrameLayersHtml('full.jpg', { progressive: true }), /data-progressive/);
});

test('进入视口附近：一对图层都换成原图；离开后卸回缩略图，且不 revoke 原图地址', async () => {
  _seedThumbForTest(REF, THUMB);
  const { pad, still } = frame(THUMB);
  const revoked = [];
  const originalRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = url => { revoked.push(String(url)); };
  try {
    syncProgressiveImage(still, true);
    await settle();
    assert.equal(still.getAttribute('src'), FULL);
    assert.equal(pad.getAttribute('src'), FULL);
    assert.equal(still.dataset.fullActive, '1');
    assert.equal(pad.dataset.fullActive, '1');
    assert.equal(still.decoding, 'async');
    assert.equal(still.srcLog.includes(THUMB_PLACEHOLDER), false, '升级时直接换原图，不清成占位');

    syncProgressiveImage(still, false);
    assert.equal(still.dataset.fullActive, '0');
    assert.equal(pad.dataset.fullActive, '0');
    assert.equal(still.getAttribute('src'), THUMB);
    assert.equal(pad.getAttribute('src'), THUMB);
    assert.equal(still.srcLog.includes(THUMB_PLACEHOLDER), true, '卸原图时先离开全尺寸地址，再放回缩略图');
    assert.equal(revoked.includes(FULL), false);
    assert.equal(revoked.includes(THUMB), false);

    syncProgressiveImage(still, true);
    await settle();
    assert.equal(still.getAttribute('src'), FULL, '再次进入视口还会升回原图');
  } finally {
    URL.revokeObjectURL = originalRevoke;
  }
});

test('还没有缩略图时，离开视口卸回占位而不是继续占着原图', async () => {
  const { pad, still } = frame();
  syncProgressiveImage(still, true);
  await settle();
  assert.equal(still.getAttribute('src'), FULL);
  syncProgressiveImage(still, false);
  assert.equal(still.getAttribute('src'), THUMB_PLACEHOLDER);
  assert.equal(pad.getAttribute('src'), THUMB_PLACEHOLDER);
  assert.notEqual(still.getAttribute('src'), FULL);
});

test('快速划过只保持缩略图，停住才换原图', async () => {
  _seedThumbForTest(REF, THUMB);
  _setProgressiveDwellForTest(40);
  const { still } = frame(THUMB);
  syncProgressiveImage(still, true);
  syncProgressiveImage(still, false);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(still.getAttribute('src'), THUMB);
  assert.notEqual(still.dataset.fullActive, '1');
  syncProgressiveImage(still, true);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(still.getAttribute('src'), FULL);
});

test('胶卷这种没有 data-progressive 的图不会被升成原图', () => {
  const strip = fakeImg({ src: THUMB, 'data-thumb-ref': REF, 'data-full-src': FULL });
  syncProgressiveImage(strip, true);
  syncProgressiveImage(strip, false);
  assert.equal(strip.getAttribute('src'), THUMB);
  assert.equal(strip.dataset.fullActive, undefined);
});

test('缩略图生成完成时，不把正在显示的原图盖回 480', async () => {
  const { pad, still } = frame(THUMB_PLACEHOLDER);
  syncProgressiveImage(still, true);
  await settle();
  globalThis.document = { querySelectorAll: () => [pad, still] };
  _deliverThumbForTest(REF, THUMB);
  assert.equal(still.getAttribute('src'), FULL);
  assert.equal(pad.getAttribute('src'), FULL);
  assert.equal(still.dataset.thumbSrc, THUMB);
  assert.equal(pad.dataset.thumbSrc, THUMB);
  syncProgressiveImage(still, false);
  assert.equal(still.getAttribute('src'), THUMB);
  assert.equal(pad.getAttribute('src'), THUMB);
});

test('观察器在视口外一屏预加载，滚出回调会卸掉；脱离文档的原图也会卸', async () => {
  let callback;
  let options;
  const observed = [];
  globalThis.IntersectionObserver = class {
    constructor(fn, opts) { callback = fn; options = opts; }
    observe(node) { observed.push(node); }
    unobserve() {}
    disconnect() {}
  };
  const { still } = frame(THUMB);
  _seedThumbForTest(REF, THUMB);
  const scope = {
    querySelectorAll(sel) { return sel === 'img[data-progressive="1"]' ? [still] : []; }
  };
  watchProgressiveImages(scope);
  watchProgressiveImages(scope);
  assert.equal(options.rootMargin, PROGRESSIVE_ROOT_MARGIN);
  assert.equal(observed.length, 1, '同一张图不重复观察');
  callback([{ target: still, isIntersecting: true }]);
  await settle();
  assert.equal(still.getAttribute('src'), FULL);
  callback([{ target: still, isIntersecting: false }]);
  assert.equal(still.getAttribute('src'), THUMB);

  syncProgressiveImage(still, true);
  await settle();
  still.isConnected = false;
  watchProgressiveImages({ querySelectorAll: () => [] });
  assert.equal(still.getAttribute('src'), THUMB, '节点离开文档后卸掉原图');
});

test('关掉相册网格时，还在文档里的格子也卸回缩略图', async () => {
  _seedThumbForTest(REF, THUMB);
  const { pad, still } = frame(THUMB);
  syncProgressiveImage(still, true);
  await settle();
  releaseProgressiveImages({
    querySelectorAll(sel) { return sel === 'img[data-progressive="1"]' ? [still] : []; }
  });
  assert.equal(still.getAttribute('src'), THUMB);
  assert.equal(pad.getAttribute('src'), THUMB);
  assert.equal(still.dataset.fullActive, '0');
});

test('随手拍列表和相册网格升级，胶卷 / 图集牌 / 编辑器不升级', async () => {
  const [snippets, common, thumbs] = await Promise.all(['views/snippets.js', 'views/common.js', 'photo-thumbs.js'].map(read));
  assert.match(snippets, /snippetPhotoImage\(photo, entry\.text \|\| `随手拍 \$\{index \+ 1\}`, \{ thumb: true, lazy, progressive: true \}\)/);
  assert.match(snippets, /snippetPhotoImage\(ref, alt, \{ thumb: true, lazy: true, progressive: true \}\)/);
  assert.match(snippets, /progressiveSource\(source\)/);
  assert.match(snippets, /progressive: Boolean\(thumbRef\)/);
  assert.match(snippets, /watchProgressiveImages\(scope\)/);
  assert.match(snippets, /watchProgressiveImages\(layer\)/);
  assert.match(snippets, /releaseProgressiveImages\(layer\)/);
  assert.match(snippets, /state\.route !== 'snippets'\) \{ stopProgressiveImages\(\); return; \}/);
  const album = snippets.slice(snippets.indexOf('function momentAlbumCardHtml('), snippets.indexOf('function momentAlbumStackHtml('));
  assert.doesNotMatch(album, /progressive:\s*true/);
  const editor = snippets.slice(snippets.indexOf('function snippetPhotoGrid('), snippets.indexOf('function bindSnippetPhotoGrid('));
  assert.doesNotMatch(editor, /progressive:\s*true/);
  assert.doesNotMatch(common, /data-progressive/);
  assert.doesNotMatch(common, /watchProgressiveImages/);
  assert.match(common, /if\s*\(\s*strip\s*\)\s*watchThumbImages\(\s*\$\(['"]\.photo-viewer-filmstrip['"]\)\s*\)/);
  assert.match(common, /<img id="photo-viewer-image" src="\$\{imgSrc\(current\)\}"/);
  assert.match(thumbs, /resolveMediaReference\(ref\)\.then\(full => \{\s*if \(!stillCurrent\(img, ref\)\) return;/);
  // #85 审查：后台 decode 成功才换、铺底层不升、按显示宽度判断、isConnected/thumbRef 校验、离页断开
  assert.match(thumbs, /probe\.decode\(\)\.then\(\(\) => done\(true\), \(\) => done\(false\)\)/);
  assert.match(thumbs, /!node\.classList\?\.contains\('photo-blur-pad'\)/);
  assert.match(thumbs, /width \* dpr > THUMB_MAX/);
  assert.match(thumbs, /img\.isConnected && img\.dataset\?\.thumbRef === ref/);
  assert.match(thumbs, /if \(!img\.isConnected \|\| img\.dataset\?\.thumbRef !== ref\) return;/);
  assert.match(thumbs, /export function stopProgressiveImages\(\) \{[\s\S]*?progressiveSeen\.clear\(\);\s*progressiveIo\?\.disconnect\(\);/);
  assert.doesNotMatch(thumbs, /URL\.revokeObjectURL\(full|revokeObjectURL\(mediaSource/);
});
