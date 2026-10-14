import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const snippets = readFileSync(new URL('../views/snippets.js', import.meta.url), 'utf8');
const moments = readFileSync(new URL('../motion-moments.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const plainThemes = readFileSync(new URL('../themes-plain.css', import.meta.url), 'utf8');

function extractSpreadCssBlock(source, fileName) {
  const startMarker = '/* moment-spread start */';
  const endMarker = '/* moment-spread end */';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `${fileName} 中应包含 /* moment-spread start */ 标记`);
  assert.ok(end > start, `${fileName} 中应包含 /* moment-spread end */ 标记`);
  return source.slice(start, end + endMarker.length);
}

test('momentSpreadHtml 函数存在，使用 photoFrameLayersHtml，最多展示 4 张并输出 moment-spread-more，rot 公式带 * 4', () => {
  assert.match(snippets, /function momentSpreadHtml\(/);
  const start = snippets.indexOf('function momentSpreadHtml(');
  const end = snippets.indexOf('function snippetPhotoGrid(');
  assert.ok(start >= 0 && end > start, 'momentSpreadHtml 函数定义块存在');
  const block = snippets.slice(start, end);

  assert.match(block, /photoFrameLayersHtml\(/, 'momentSpreadHtml 应调用 photoFrameLayersHtml');
  assert.match(block, /Math\.min\([^,]+,\s*4\)/, '最多展示 4 张');
  assert.match(block, /moment-spread-more/, '多于 4 张时包含 moment-spread-more 提示');
  assert.match(block, /\*\s*4/, '旋转公式使用 * 4');
  assert.match(block, /data-spread-sig/, '应输出 data-spread-sig 属性');
});

test('quickPhotoPreview 与 snippetPhotoGrid 均调用 momentSpreadHtml', () => {
  const quickStart = snippets.indexOf('function quickPhotoPreview(');
  const quickEnd = snippets.indexOf('function refreshQuickPhotoPreview(');
  assert.ok(quickStart >= 0 && quickEnd > quickStart, 'quickPhotoPreview 函数存在');
  const quickBlock = snippets.slice(quickStart, quickEnd);
  assert.match(quickBlock, /momentSpreadHtml\(/, 'quickPhotoPreview 应调用 momentSpreadHtml');

  const gridStart = snippets.indexOf('function snippetPhotoGrid(');
  const gridEnd = snippets.indexOf('function bindSnippetPhotoGrid(');
  assert.ok(gridStart >= 0 && gridEnd > gridStart, 'snippetPhotoGrid 函数存在');
  const gridBlock = snippets.slice(gridStart, gridEnd);
  assert.match(gridBlock, /momentSpreadHtml\(/, 'snippetPhotoGrid 应调用 momentSpreadHtml');
});

test('motion-moments.js 包含选图飞入、收叠与叠边延迟飞行逻辑', () => {
  assert.match(moments, /moment-spread-card/, '包含 moment-spread-card 选择器');
  assert.match(moments, /40/, '飞入包含 40ms stagger');
  assert.match(moments, /cubic-bezier\(\.34,\s*1\.56,\s*\.64,\s*1\)/, '包含弹性缓动 cubic-bezier(.34,1.56,.64,1)');
  assert.match(moments, /rotate\(\$\{\s*\(i\s*-\s*1\)\s*\*\s*2\}deg\)|rotate\(\$\{[^}]*\}\s*deg\)/, '保存时包含扇形叠合');
  assert.match(moments, /delay:\s*60|60ms|delay:\s*Math\.max\([^)]*,\s*[^)]*-\s*60\)/, '叠边飞行延迟 60ms');
  assert.match(moments, /import\s*\{\s*prefersReducedMotion\s*\}\s*from\s*'\.\/motion\.js'/, '导入 prefersReducedMotion');
  assert.doesNotMatch(moments, /不做「收成一叠」/, '已不再包含「不做「收成一叠」」说明');
});

test('openMomentAlbumBrowse 调用 waitMomentAlbumFirstImage 消除首帧白闪，且 helper 不调用 .decode(', () => {
  assert.match(snippets, /function waitMomentAlbumFirstImage\(/, '存在 waitMomentAlbumFirstImage 函数');
  const waitStart = snippets.indexOf('function waitMomentAlbumFirstImage(');
  const waitEnd = snippets.indexOf('function openMomentAlbumBrowse(');
  assert.ok(waitStart >= 0 && waitEnd > waitStart, 'waitMomentAlbumFirstImage 位于 openMomentAlbumBrowse 之前');
  const helperBlock = snippets.slice(waitStart, waitEnd);

  assert.doesNotMatch(helperBlock, /\.decode\(/, 'waitMomentAlbumFirstImage 不得调用 .decode(');

  const browseStart = snippets.indexOf('function openMomentAlbumBrowse(');
  const browseEnd = snippets.indexOf('function openMomentMediaBrowse(');
  assert.ok(browseStart >= 0 && browseEnd > browseStart, 'openMomentAlbumBrowse 函数存在');
  const browseBlock = snippets.slice(browseStart, browseEnd);

  assert.match(browseBlock, /waitMomentAlbumFirstImage\(/, 'openMomentAlbumBrowse 调用 waitMomentAlbumFirstImage');
  assert.match(browseBlock, /momentAlbumCloseToken/, '包含 closeToken 校验防止异步泄漏');
});

test('styles.css 与 themes-plain.css 中的 moment-spread 块内无 !important 且无 object-fit: cover', () => {
  const stylesBlock = extractSpreadCssBlock(styles, 'styles.css');
  const plainBlock = extractSpreadCssBlock(plainThemes, 'themes-plain.css');

  for (const [name, block] of [['styles.css', stylesBlock], ['themes-plain.css', plainBlock]]) {
    assert.doesNotMatch(block, /!important/, `${name} 的 moment-spread 块内不得包含 !important`);
    assert.doesNotMatch(block, /object-fit\s*:\s*cover/, `${name} 的 moment-spread 块内不得包含 object-fit: cover`);
    assert.match(block, /object-fit\s*:\s*contain/, `${name} 的 moment-spread 块应使用 object-fit: contain`);
  }
});
