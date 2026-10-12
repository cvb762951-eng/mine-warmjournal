import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

const vault = await read('views/private-vault.js');
const style = await read('styles.css');

/**
 * 私密相册封面（2026-10-09，第二次迭代）
 *
 * 需求演进过程值得记下来，因为它是一对矛盾的调和：
 *
 *   v1（最初）：卡片固定 4:3 横版，视频封面用 contain 完整显示。
 *              问题——竖屏视频被缩成中间一条、两侧大片深绿，用户说「显示不完整」。
 *
 *   v2（第一次修）：让卡片比例跟着封面内容走（竖的竖、横的横）。
 *              内容确实完整了，但竖屏与横屏的卡片高矮相差很大，
 *              2 列网格里排在一起很突兀，用户说「大小差异太大」。
 *
 *   v3（现在）：卡片回到统一 4:3；内容仍用 contain 完整显示；
 *              两侧留白由**同一张画面放大虚化**填住。
 *              三个目标同时成立：卡片整齐、内容完整、留白不是突兀的纯色块。
 *
 * 用户明确表示喜欢「竖屏封面体现得很好」，所以 v3 必须保住 contain 这一条。
 */

test('封面统一比例，不再随内容动态改尺寸', () => {
  // v2 的做法（按内容设 aspect-ratio）必须已经移除，否则卡片又会高矮不一
  assert.doesNotMatch(vault, /applyCoverRatio|COVER_RATIO_MIN|COVER_RATIO_MAX/);
  assert.doesNotMatch(vault, /cover\.style\.aspectRatio/);
  // 卡片比例由 CSS 统一给定
  assert.match(style, /\.private-vault-view \.vault-folder-cover\{[^}]*aspect-ratio:4\/3/,
    '卡片必须是统一比例，网格才整齐');
});

test('内容完整显示：主图层仍用 contain（用户明确说喜欢这一点）', () => {
  assert.match(vault, /function vaultCoverImage\(source, alt = ''\)/);
  assert.match(vault, /stillClass: 'vault-cover-main'/, '需要主图层（共用 photo-frame.js）');
  assert.match(style, /\.vault-folder-cover>\.vault-cover-main\{[^}]*object-fit:contain/,
    '主图层必须 contain —— 竖屏视频不能被裁');
  assert.match(style, /\.private-vault-view \.vault-folder-cover>\.vault-cover-main\{[^}]*object-fit:contain/,
    '私密空间生效的那条规则同样要 contain');
});

test('留白用同一张画面放大铺底（与日记牌组同一份实现），而不是纯色块', () => {
  // ⚠️ 别写死 import 列表：同一行之后可能再加别的符号（2026-10-12 就被
  //    「顺手多导入一个 revealViewerImageWhenDecoded」打挂过）。
  assert.match(vault, /import \{ [^}]*photoFrameLayersHtml[^}]*\} from '\.\.\/photo-frame\.js'/,
    '要复用共用的照片框实现');
  // 两层用同一个地址：浏览器只会下载一次
  assert.match(vault, /const url = esc\(source\);\s*return photoFrameLayersHtml\(url, \{[^}]*padClass: 'vault-cover-blur', stillClass: 'vault-cover-main'/);
  const pad = style.match(/\.photo-blur-frame>img\.photo-blur-pad\{([^}]*)\}/)?.[1] || '';
  assert.match(pad, /object-fit:cover/, '铺底层要 cover 才填得满');
  assert.match(pad, /transform:scale\(1\.08\)/);
  assert.match(pad, /opacity:\.5/);
  assert.match(pad, /inset:-12%/);
  assert.match(vault, /vault-folder-cover photo-blur-frame is-edge/);
});

test('虚化层不会盖住相框（靠 overflow:hidden 裁到 padding 区）', () => {
  // 模糊层是 absolute 且放大了，必须被父级裁掉，否则会糊到 border-image 相框上
  assert.match(style, /\.private-vault-view \.vault-folder-cover\{[^}]*overflow:hidden/,
    '封面容器必须 overflow:hidden');
  assert.match(style, /\.private-vault-view \.vault-folder-cover\{[^}]*border-image:url\('assets\/journal-photo-frame-v3\.png'\)/,
    '相框仍在（画报风格）');
});

test('三处渲染封面图的地方都走同一个函数', () => {
  // 文件夹卡片、封面选择弹窗、异步补齐封面 —— 换实现时容易漏掉后两处
  const calls = vault.match(/vaultCoverImage\(/g) || [];
  assert.ok(calls.length >= 3, `vaultCoverImage 应至少被调用 3 次（卡片 / 选择器 / 异步补齐），实际 ${calls.length}`);
  assert.match(vault, /cover\.innerHTML = vaultCoverImage\(source\)/, '异步补齐也要用它');
});


test('列表缩略图视频封面也走共用 photo-blur-frame，不用灰底填两侧', () => {
  assert.match(vault, /photo-blur-frame is-edge[^`]*video-contain-cover/);
  assert.match(vault, /photoFrameLayersHtml\(esc\(cached\)/);
  assert.match(vault, /new IntersectionObserver/);
  // 加载前纸色兜底，不再写死灰/深绿底（选择器可能与 is-portrait 写在同一条）
  assert.match(style, /vault-video-item \.vault-media-box(?:\.is-portrait-video-cover)?\.photo-blur-frame[^{]*\{[^}]*background:#efe7d6!important/);
  assert.match(style, /vault-video-item \.video-contain-cover\.photo-blur-frame\{[^}]*background:#efe7d6!important/);
  assert.doesNotMatch(style, /vault-video-item \.video-contain-cover>img[^{]*\{[^}]*transform:none!important/);
  const pad = style.match(/\.photo-blur-frame>img\.photo-blur-pad\{([^}]*)\}/)?.[1] || '';
  assert.match(pad, /object-fit:cover/);
  assert.match(pad, /opacity:\.5/);
  const still = style.match(/\.photo-blur-frame>img\.photo-blur-still\{([^}]*)\}/)?.[1] || '';
  assert.match(still, /object-fit:contain/);
});
