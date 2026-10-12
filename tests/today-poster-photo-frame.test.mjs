import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('今日画页照片走共用 photo-blur-frame', async () => {
  const js = await readFile(new URL('../views/today.js', import.meta.url), 'utf8');
  assert.match(js, /import \{ photoFrameLayersHtml \} from '\.\.\/photo-frame\.js'/);
  assert.match(js, /class="polaroid-frame photo-blur-frame"/);
  assert.match(js, /photoFrameLayersHtml\(url, \{ alt, padClass: haze \? 'polaroid-blur is-haze' : 'polaroid-blur is-haze-pending', stillClass: 'polaroid-img' \}\)/);
});

test('今日画页清晰照片贴满相框：无内边距、无内缩', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.today-view \.polaroid-frame\.photo-blur-frame\{padding:0!important;border:0!important;border-radius:var\(--radius-soft-sm/);
  assert.match(css, /\.today-view \.polaroid-frame\.photo-blur-frame>img\.photo-blur-still\{inset:0!important;width:100%!important;height:100%!important/);
});

test('今日画页铺底用缩小图做朦胧，不用 CSS filter，按照片 id 缓存并有回退', async () => {
  const js = await readFile(new URL('../views/today.js', import.meta.url), 'utf8');
  assert.match(js, /const POSTER_HAZE_SIDE = 120;/);
  assert.match(js, /const posterHazeCache = new Map\(\)/);
  assert.match(js, /function posterHazeKey\(id, url\)/);
  assert.match(js, /return `id:\$\{stable\}`/);
  assert.match(js, /return src \? `url:\$\{src\}` : ''/);
  assert.match(js, /posterHazeRemember\(id, src, haze\)/);
  assert.doesNotMatch(js, /posterHazeCache\.size > 30/);
  assert.doesNotMatch(js, /IndexedDB|localStorage|sessionStorage/);
  assert.match(js, /canvas\.toDataURL\('image\/jpeg'/);
  assert.match(js, /try \{ haze = posterHazeDataUrl\(still\); \} catch \{ haze = ''; \}/);
  assert.match(js, /photoStoryImage\(photo, entry\.text \|\| '随手拍', entry\.id\)/);
  assert.match(js, /data-haze-id/);
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const haze = css.slice(css.lastIndexOf('/* 今日画页铺底朦胧'));
  assert.doesNotMatch(haze, /filter:\s*blur/);
  assert.match(haze, /img\.photo-blur-pad\.is-haze-pending\{opacity:0!important\}/);
});
