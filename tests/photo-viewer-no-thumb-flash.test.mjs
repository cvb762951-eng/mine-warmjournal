import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const [snippets, motion, common, vault, styles, calendar] = await Promise.all(
  ['views/snippets.js', 'motion.js', 'views/common.js', 'views/private-vault.js', 'styles.css', 'views/calendar.js'].map(read)
);

/* 2026-10-12 用户要求：点照片放大**不要动效**。
   之前随手拍/日历/私密空间三处的照片都走 withSharedTransition（缩略图 FLIP 长大 / View Transitions），
   现在统一改成直接打开大图。这里锁住「不再有转场」，同时保留两条老账：
   ① 共享元素时代修过的「点开先闪一张糊缩略图」不能回来；
   ② 大图仍要等解码完成再显示，避免画出半张图。 */

test('点照片放大不再走共享转场（三个入口都直接打开）', () => {
  // 随手拍：多图先相册浏览，大图仍直接 photoLightbox / 无 FLIP
  assert.doesNotMatch(snippets, /withSharedTransition\(/, '随手拍点照片不再用共享转场');
  assert.doesNotMatch(snippets, /preferFlip/, '不再有 FLIP 放大的分支');
  assert.doesNotMatch(snippets, /momentShareSource/, '为转场挑源图的那套已删除');
  assert.match(snippets, /openMomentMediaBrowse\(entry, Number\(button\.dataset\.photoIndex\) \|\| 0(, button)?\)/,
    '列表点图走相册导航（多图）或直接大图（单张）');
  // 相册层现在是一叠牌（2026-10-12）：轻触牌面走 openMomentAlbumCurrent → 既有大图，仍无转场
  assert.match(snippets, /photoLightbox\(entry, item\.index\)/, '相册轻触牌面仍直接大图、无转场');
  // 日历
  assert.doesNotMatch(calendar, /withSharedTransition\(/, '日历点照片也不再用共享转场');
  // 私密空间
  assert.doesNotMatch(vault, /withSharedTransition\(/, '私密空间点照片也不再用共享转场');
  assert.match(vault, /openItem\(item\)\.catch\(error => show\(error\.message\)\)/,
    '照片与视频统一直接打开');
});

test('共享转场的等待解码逻辑保留给其它转场用（卡片→详情）', () => {
  // 这条是给 stats / 其它还在用共享元素的调用方兜底的，别一起删掉
  assert.doesNotMatch(motion, /target\.tagName === 'IMG' && !target\.complete/);
  assert.match(motion, /Promise\.race\(\[target\.decode/);
  assert.match(motion, /classList\.remove\('is-decoding'\)/);
  assert.match(motion, /export function withSharedTransition/);
});

test('大图仍等解码完成才显示，但不再淡入', async () => {
  assert.match(common, /revealViewerImageWhenDecoded\(\$\('#photo-viewer-image'\)\)/);
  assert.match(vault, /revealViewerImageWhenDecoded\(\$\('#vault-photo-image'\)\)/);
  assert.match(styles, /\.photo-viewer-stage img\.is-decoding,\.vault-photo-stage img\.is-decoding\{opacity:0\}/,
    '解码完成前不显示');
  // 关键：viewer 上的 transition 只剩 transform（双指缩放要用），没有 opacity 淡入
  assert.match(styles, /\.photo-viewer-stage img,\.vault-photo-stage img\{transition:transform \.18s ease\}/,
    '不再有 opacity 过渡');
  assert.doesNotMatch(styles, /\.photo-viewer-stage img,\.vault-photo-stage img\{transition:transform \.18s ease,opacity/,
    '淡入已经去掉');
  assert.match(styles, /prefers-reduced-motion:reduce\)\{\.photo-viewer-stage img,\.vault-photo-stage img\{transition:none!important\}/);
});

test('revealViewerImageWhenDecoded reveals after decode and skips video', async () => {
  const { revealViewerImageWhenDecoded } = await import('../photo-frame.js');
  const classes = new Set();
  let resolve;
  const img = { tagName: 'IMG', complete: false, dataset: {}, classList: { add: c => classes.add(c), remove: c => classes.delete(c) }, decode: () => new Promise(r => { resolve = r; }) };
  revealViewerImageWhenDecoded(img);
  assert.ok(classes.has('is-decoding'));
  resolve(); await new Promise(r => setTimeout(r, 0));
  assert.ok(!classes.has('is-decoding'));
  assert.equal(img.dataset.decoded, '1');
  revealViewerImageWhenDecoded({ tagName: 'VIDEO' });
});
