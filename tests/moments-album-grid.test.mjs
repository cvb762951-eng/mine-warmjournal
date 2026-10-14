import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const snippetsSrc = readFileSync(new URL('../views/snippets.js', import.meta.url), 'utf8');
const stylesCss = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const appSrc = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('#snippet-album opens grid not photoViewer directly', () => {
  // #snippet-album click handler in bindSnippets calls openSnippetAlbumGrid
  assert.match(snippetsSrc, /#snippet-album['"]\)\?\.(?:addEventListener\('click'|onclick)[\s\S]*?openSnippetAlbumGrid/);
  assert.doesNotMatch(snippetsSrc, /#snippet-album['"]\)\?\.(?:addEventListener\('click'|onclick)\s*=\s*\(\)\s*=>\s*openSnippetAlbum\(\)/);

  // openSnippetAlbumGrid function exists and opens snippet-album-grid layer
  assert.match(snippetsSrc, /function openSnippetAlbumGrid\(/);
  assert.match(snippetsSrc, /ensureSnippetAlbumGridLayer\(\)/);
  assert.match(snippetsSrc, /id="snippet-album-grid"|ensureSnippetAlbumGridLayer/);
  assert.match(snippetsSrc, /snippet-album-grid-header/);
  assert.match(snippetsSrc, /相册/);
});

test('grid reuses snippetPhotoImage/snippetCoverImage display helpers and watches thumbs', () => {
  // Thumb lookup goes through the shared 随手拍 helper (photoFrameLayersHtml + thumbRef)
  assert.match(snippetsSrc, /import\s*\{[^}]*watchThumbImages[^}]*\}\s*from\s*['"]\.\.\/photo-thumbs\.js['"]/);
  assert.match(snippetsSrc, /import\s*\{[^}]*thumbSource[^}]*\}\s*from\s*['"]\.\.\/photo-thumbs\.js['"]/);
  assert.match(snippetsSrc, /import\s*\{[^}]*thumbKeyFor[^}]*\}\s*from\s*['"]\.\.\/photo-thumbs\.js['"]/);
  assert.match(snippetsSrc, /import\s*\{[^}]*watchThumbImages[^}]*\}\s*from\s*['"]\.\.\/photo-thumbs\.js['"]/);

  // Grid cell rendering logic: reuses snippetPhotoImage and snippetCoverImage with photo-blur-frame
  assert.match(snippetsSrc, /function snippetGridMediaHtml\(/);
  assert.match(snippetsSrc, /snippetPhotoImage\(/);
  assert.match(snippetsSrc, /snippetCoverImage\(/);
  assert.match(snippetsSrc, /photo-blur-frame/);
  assert.match(snippetsSrc, /snippet-album-grid-frame/);

  // Calls watchThumbImages after mounting
  assert.match(snippetsSrc, /watchThumbImages\(layer\)/);
});

test('grid builds 2-column (or 3-column when width >= 600px) masonry layout in JS', () => {
  // JS masonry column distribution by shortest-column height
  assert.match(snippetsSrc, /snippet-album-grid-column/);
  assert.match(snippetsSrc, /600\s*\?\s*3\s*:\s*2/);
  assert.match(snippetsSrc, /colHeights/);
  assert.doesNotMatch(snippetsSrc, /column-count/);

  // CSS defines flex columns and 6px gap
  assert.match(stylesCss, /\.snippet-album-grid-body\s*\{[^}]*gap:\s*6px/);
  assert.match(stylesCss, /\.snippet-album-grid-column\s*\{[^}]*gap:\s*6px/);
  assert.doesNotMatch(stylesCss, /\.snippet-album-grid-body\s*\{[^}]*grid-template-columns/);
});

test('aspect-ratio reservation logic with snippetGridAspect and naturalWidth', () => {
  // Module-level snippetGridAspect Map
  assert.match(snippetsSrc, /snippetGridAspect\s*=\s*new Map\(\)/);
  // Neutral default aspect-ratio 3 / 4
  assert.match(snippetsSrc, /aspect-ratio:\s*3\s*\/\s*4/);
  // Delegated load listener in capture phase reading naturalWidth on photo-blur-still
  assert.match(snippetsSrc, /photo-blur-still/);
  assert.match(snippetsSrc, /naturalWidth/);
  assert.match(snippetsSrc, /naturalHeight/);
  assert.match(snippetsSrc, /addEventListener\(['"]load['"],[\s\S]*?,?\s*true\)/);
  // Compares string before writing style
  assert.match(snippetsSrc, /cell\.style\.aspectRatio !==/);
});

test('object-fit: contain (not cover) and border-radius: 8px in CSS for grid cells', () => {
  assert.match(stylesCss, /\.snippet-album-grid-cell\s*\{[^}]*content-visibility:\s*auto/);
  assert.match(stylesCss, /\.snippet-album-grid-cell\s*\{[^}]*contain-intrinsic-size:\s*auto\s*200px/);
  assert.match(stylesCss, /\.snippet-album-grid-cell\s*\{[^}]*border-radius:\s*8px/);
  assert.doesNotMatch(stylesCss, /\.snippet-album-grid-cell\s*\{[^}]*aspect-ratio:\s*1/);
  // 不另写 img 规则：完整显示由共享的 photo-blur-still（contain）负责，网格不覆盖它
  assert.doesNotMatch(stylesCss, /\.snippet-album-grid-cell\s+img\s*\{/);
  assert.match(stylesCss, /\.photo-blur-still[^{]*\{[^}]*object-fit:\s*contain/);
});

test('grid layer integrates with back handling via isSnippetAlbumGridOpen and closeSnippetAlbumGrid', () => {
  assert.match(snippetsSrc, /function isSnippetAlbumGridOpen\(/);
  assert.match(snippetsSrc, /function closeSnippetAlbumGrid\(/);
  assert.match(snippetsSrc, /registerHelper\('isSnippetAlbumGridOpen'/);
  assert.match(snippetsSrc, /registerHelper\('closeSnippetAlbumGrid'/);

  // app.js wires both back consumption and system back
  assert.match(appSrc, /callHelper\('isSnippetAlbumGridOpen'\)/);
  assert.match(appSrc, /callHelper\('closeSnippetAlbumGrid'\)/);
});

test('tapping a cell calls openSnippetAlbum(index) to open photoViewer', () => {
  assert.match(snippetsSrc, /cell\.onclick\s*=\s*\(\)\s*=>\s*\{[\s\S]*?openSnippetAlbum\(index\)/);
});
