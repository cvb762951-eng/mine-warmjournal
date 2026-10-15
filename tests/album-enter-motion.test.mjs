import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const snippets = await readFile(new URL('../views/snippets.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const common = await readFile(new URL('../views/common.js', import.meta.url), 'utf8');

test('进入随手拍相册有进入动效：底板淡入 + 纸片托起，而且不碰牌的露边', () => {
  /* 2026-10-15 用户要「给进入随手拍相册加入个动效」。
     以前这一层是 display:none → flex，直接「啪」地出现，没有任何进场。 */
  assert.match(css, /@keyframes momentAlbumBackdropIn/, '底板淡入');
  assert.match(css, /@keyframes momentAlbumSheetIn/, '纸片托起');
  assert.match(css, /:root:not\(\[data-pl-motion="none"\]\) \.moment-album-layer\.open \{ animation: momentAlbumBackdropIn/);
  assert.match(css, /:root:not\(\[data-pl-motion="none"\]\) \.moment-album-layer\.open \.moment-album-sheet \{ animation: momentAlbumSheetIn/);

  /* 🔴 关键约束：后两张牌靠 depth 的 translate/scale 露出边角，
     给 .moment-album-card 加 transform 动画会把露边压平（z-index 也一样靠 depth 排）。 */
  const cardBlock = css.slice(css.indexOf('.moment-album-card {'), css.indexOf('.moment-album-frame {'));
  assert.doesNotMatch(cardBlock, /animation:/, '牌的进场不能动 transform —— 会压平 depth 露边');
  assert.match(css, /\.moment-album-card\[data-depth="1"\] \{ z-index: 2; transform:/, '露边的写法要留着');
  assert.match(css, /\.moment-album-card\[data-depth="2"\] \{ z-index: 1; transform:/, '露边的写法要留着');

  /* 减弱动效时整段关掉；但用户选「始终完整」要让路（否则开关只救得回部分动效）。 */
  const reduced = css.slice(css.indexOf('@keyframes momentAlbumSheetIn'));
  assert.match(reduced.slice(0, 1400), /prefers-reduced-motion[\s\S]{0,300}\.moment-album-layer\.open[\s\S]{0,200}animation: none !important/, '减弱动效时要关掉');
  assert.match(reduced.slice(0, 1400), /:root:not\(\[data-pl-motion-explicit="rich"\]\) \.moment-album-layer\.open/, '要给"始终完整"留出路');
});

test('相册那一层是脚本加 .open 驱动的（不用额外接线）', () => {
  // 进场动效挂在 .open 上：打开时加、收回时摘，所以每次打开都会重放，不需要再往 JS 里塞类
  assert.match(snippets, /layer\.classList\.add\('open'\)/, '打开时加 .open');
  assert.match(snippets, /classList\.remove\('open'\)/, '关闭时摘掉 .open');
});
