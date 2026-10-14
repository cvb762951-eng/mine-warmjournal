import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const common = await read('views/common.js');

test('views/common.js 从 ../photo-thumbs.js 引入 thumbSource、thumbKeyFor 和 watchThumbImages', () => {
  assert.match(common, /import\s*\{[^}]*thumbSource[^}]*\}\s*from\s*['"]\.\.\/photo-thumbs\.js['"]/);
  assert.match(common, /import\s*\{[^}]*thumbKeyFor[^}]*\}\s*from\s*['"]\.\.\/photo-thumbs\.js['"]/);
  assert.match(common, /import\s*\{[^}]*watchThumbImages[^}]*\}\s*from\s*['"]\.\.\/photo-thumbs\.js['"]/);
});

test('photoViewer 底栏胶卷缩略图使用 thumbKeyFor 与 thumbSource，仅在 thumbRef 存在时添加 data-thumb-ref', () => {
  const stripMatch = common.match(/const strip = options\.filmstrip[\s\S]*?<\/nav>`/);
  assert.ok(stripMatch, '应该在 photoViewer 中定义 strip');
  const stripSnippet = stripMatch[0];

  assert.match(stripSnippet, /const thumbRef = thumbKeyFor\(source\) \? source : ''/);
  assert.match(stripSnippet, /const src = thumbRef \? esc\(thumbSource\(source\)\) : imgSrc\(source\)/);
  assert.match(stripSnippet, /data-thumb-ref="\$\{esc\(thumbRef\)\}"/);
  assert.match(stripSnippet, /thumbRef \? ` data-thumb-ref=/);
});

test('photoViewer 底栏胶卷 img 保持 loading="lazy" 并添加 decoding="async"', () => {
  const stripMatch = common.match(/const strip = options\.filmstrip[\s\S]*?<\/nav>`/);
  assert.ok(stripMatch, '应该在 photoViewer 中定义 strip');
  const stripSnippet = stripMatch[0];

  assert.match(stripSnippet, /loading="lazy"/);
  assert.match(stripSnippet, /decoding="async"/);
  assert.match(stripSnippet, /<img src="\$\{src\}" alt="" loading="lazy" decoding="async"/);
});

test('弹窗挂载后且仅在 strip 存在时调用 watchThumbImages($(".photo-viewer-filmstrip"))', () => {
  assert.match(common, /if\s*\(\s*strip\s*\)\s*watchThumbImages\(\s*\$\(['"]\.photo-viewer-filmstrip['"]\)\s*\)/);
});

test('大图层 #photo-viewer-image 保持使用 imgSrc(current)，不使用缩略图或 data-thumb-ref', () => {
  assert.match(common, /<img id="photo-viewer-image" src="\$\{imgSrc\(current\)\}"/);
  const mainImageSnippet = common.match(/id="photo-viewer-image"[\s\S]*?>/)?.[0] || '';
  assert.ok(mainImageSnippet);
  assert.doesNotMatch(mainImageSnippet, /thumbSource/);
  assert.doesNotMatch(mainImageSnippet, /data-thumb-ref/);
});
