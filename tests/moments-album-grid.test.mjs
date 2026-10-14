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

test('grid uses data-thumb-ref/hasThumb and no original src when thumbKeyFor works', () => {
  // Imports hasThumb from photo-thumbs.js
  assert.match(snippetsSrc, /import\s*\{[^}]*hasThumb[^}]*\}\s*from\s*['"]\.\.\/photo-thumbs\.js['"]/);
  assert.match(snippetsSrc, /import\s*\{[^}]*thumbSource[^}]*\}\s*from\s*['"]\.\.\/photo-thumbs\.js['"]/);
  assert.match(snippetsSrc, /import\s*\{[^}]*thumbKeyFor[^}]*\}\s*from\s*['"]\.\.\/photo-thumbs\.js['"]/);
  assert.match(snippetsSrc, /import\s*\{[^}]*watchThumbImages[^}]*\}\s*from\s*['"]\.\.\/photo-thumbs\.js['"]/);

  // Grid cell rendering logic: checks hasThumb and thumbKeyFor, sets data-thumb-ref
  assert.match(snippetsSrc, /function snippetGridMediaHtml\(/);
  assert.match(snippetsSrc, /hasThumb\(/);
  assert.match(snippetsSrc, /thumbKeyFor\(/);
  assert.match(snippetsSrc, /data-thumb-ref=/);

  // Uses transparent 1x1 placeholder and never puts original src when thumbKeyFor works
  assert.match(snippetsSrc, /data:image\/(?:gif;base64|svg\+xml)/);

  // Calls watchThumbImages after mounting
  assert.match(snippetsSrc, /watchThumbImages\(layer\)/);
});

test('grid imgs declare loading="lazy" and decoding="async"', () => {
  const cellFn = snippetsSrc.slice(snippetsSrc.indexOf('function snippetGridMediaHtml('), snippetsSrc.indexOf('let snippetAlbumGridCloseToken'));
  assert.match(cellFn, /loading="lazy"/);
  assert.match(cellFn, /decoding="async"/);
});

test('object-fit: cover and aspect-ratio:1 in CSS for grid cells', () => {
  assert.match(stylesCss, /\.snippet-album-grid-cell\s*\{[^}]*aspect-ratio:\s*1/);
  assert.match(stylesCss, /\.snippet-album-grid-cell\s*\{[^}]*content-visibility:\s*auto/);
  assert.match(stylesCss, /\.snippet-album-grid-cell\s*\{[^}]*contain-intrinsic-size:\s*auto\s*120px/);
  assert.match(stylesCss, /\.snippet-album-grid-cell\s+img\s*\{[^}]*object-fit:\s*cover/);
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
