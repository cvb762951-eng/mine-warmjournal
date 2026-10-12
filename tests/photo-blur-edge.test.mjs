import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

test('共用 is-edge：无 6px 纸边，清晰照片 inset:0 contain', async () => {
  const css = await read('styles.css');
  // 共用规则（不要匹配到 .vault-folder-cover.photo-blur-frame.is-edge 那种更长选择器）
  assert.match(css, /(?<![-\w])\.photo-blur-frame\.is-edge\{padding:0!important;border:0!important;border-radius:var\(--radius-soft-sm/);
  assert.match(css, /(?<![-\w])\.photo-blur-frame\.is-edge>img\.photo-blur-still\{inset:0!important;width:100%!important;height:100%!important[^}]*object-fit:contain!important/);
  assert.match(css, /(?<![-\w])\.photo-blur-frame\.is-edge>img\.photo-blur-pad\{filter:none!important\}/);
});

test('今日画页 / 随手拍 / 私密封面与照片项都挂 is-edge', async () => {
  const today = await read('views/today.js');
  const snippets = await read('views/snippets.js');
  const vault = await read('views/private-vault.js');
  assert.match(today, /polaroid-frame photo-blur-frame is-edge/);
  assert.match(snippets, /photo-blur-frame is-edge snippet-photo-tile/);
  assert.match(snippets, /snippet-cover-frame is-video-cover photo-blur-frame is-edge/);
  assert.match(vault, /vault-folder-cover photo-blur-frame is-edge/);
  assert.match(vault, /vault-media-box photo-blur-frame is-edge/);
  // 照片项不再用单层 img + object-fit:cover
  assert.doesNotMatch(vault, /item\.type === 'video' \? photoFrameLayersHtml\(esc\(cached\)[\s\S]*?`<img src=/);
});

test('私密空间照片异步补齐也走两层，不插单层 cover 图', async () => {
  const vault = await read('views/private-vault.js');
  assert.match(vault, /insertAdjacentHTML\('afterbegin', photoFrameLayersHtml\(esc\(url\)/);
  assert.doesNotMatch(vault, /insertAdjacentHTML\('afterbegin', item\.type === 'video'/);
});
