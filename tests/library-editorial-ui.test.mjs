import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../views/media.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const core = await readFile(new URL('../core.js', import.meta.url), 'utf8');

test('Private Collection keeps every real library interaction', () => {
  for (const id of ['media-search-form', 'new-media-empty']) assert.match(source, new RegExp(`id="${id}"`));
  assert.match(source, /\[\['all', '全部'\], \['movie', '电影'\], \['book', '书籍'\]\]/);
  assert.match(source, /data-media-type="\$\{value\}"/);
  assert.match(source, /data-media-status/);
  assert.match(source, /data-open-library-media/);
  assert.match(source, /data-edit-media/);
  assert.match(source, /data-delete-media/);
  assert.match(source, /data-media-focus/);
});

test('Private Collection is led by generated archive assets', async () => {
  const assets = ['library-page-canvas-v1.png', 'library-shelf-sheet-v1.png'];
  for (const asset of assets) {
    await access(new URL(`../assets/${asset}`, import.meta.url));
    assert.match(css, new RegExp(asset.replace('.', '\\.')));
  }
  const finalCss = css.slice(css.indexOf('/* Private Collection｜'));
  assert.match(finalCss, /library-hero-paper[\s\S]*?secondary-media-accent-v1\.png[\s\S]*?secondary-header-paper-v1\.png/);
  assert.match(finalCss, /library-controls-paper[\s\S]*?secondary-content-paper-v1\.png/);
  assert.match(finalCss, /media-statuses\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(finalCss, /media-statuses button\.active[\s\S]*?quick-control-sage-v1\.png[\s\S]*?color:#fff1d9/);
  assert.match(finalCss, /library-stream-sheet[\s\S]*?library-shelf-sheet-v1\.png/);
  assert.match(finalCss, /library-media-card\{[\s\S]*?background:transparent/);
  assert.match(core, /app\.scrollLeft = 0/);
  assert.match(core, /shell\.scrollLeft = 0/);
});
