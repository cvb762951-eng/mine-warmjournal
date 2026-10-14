import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../views/snippets.js', import.meta.url), 'utf8');
test('多图打开前预热缩略图并预解码，最多等 120ms', () => {
  assert.match(src, /export function preloadMomentAlbumImages\(refs, ms = 120\)/);
  assert.match(src, /await ensureThumb\(ref\)/);
  assert.match(src, /img\.decode\?\.\(\)/);
  assert.match(src, /preloadMomentAlbumImages\(rotated\)\.then\(\(\) => openMomentAlbumBrowse/);
});
test('首图等待也走 decode()', () => {
  assert.match(src, /still\.decode\?\.\(\)\.then\(finish, finish\)/);
});
