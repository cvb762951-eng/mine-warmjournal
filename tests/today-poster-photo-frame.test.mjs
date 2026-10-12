import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('今日画页照片走共用 photo-blur-frame', async () => {
  const js = await readFile(new URL('../views/today.js', import.meta.url), 'utf8');
  assert.match(js, /import \{ photoFrameLayersHtml \} from '\.\.\/photo-frame\.js'/);
  assert.match(js, /class="polaroid-frame photo-blur-frame"/);
  assert.match(js, /photoFrameLayersHtml\(url, \{ alt, padClass: 'polaroid-blur', stillClass: 'polaroid-img' \}\)/);
  assert.doesNotMatch(js, /posterHaze|hazePosterPads|POSTER_HAZE|is-haze/);
});

test('今日画页清晰照片贴满相框：无内边距、无内缩', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.today-view \.polaroid-frame\.photo-blur-frame\{padding:0!important;border:0!important;border-radius:var\(--radius-soft-sm/);
  assert.match(css, /\.today-view \.polaroid-frame\.photo-blur-frame>img\.photo-blur-still\{inset:0!important;width:100%!important;height:100%!important/);
  assert.match(css, /\.today-view \.polaroid-frame\.photo-blur-frame>img\.photo-blur-pad\{filter:none!important\}/);
  assert.doesNotMatch(css, /is-haze|朦胧/);
});
