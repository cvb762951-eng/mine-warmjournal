import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const journal = await readFile(new URL('../views/journal.js', import.meta.url), 'utf8');

test('V1.0.9 five secondary pages share paper foundations and keep unique material accents', () => {
  for (const id of ['subpage-journal-reader', 'subpage-ledger-detail', 'subpage-habit-detail', 'subpage-focus-detail', 'subpage-media-detail']) {
    assert.match(styles, new RegExp(`#${id}`));
  }
  for (const asset of ['secondary-page-canvas-v1.png', 'secondary-header-paper-v1.png', 'secondary-content-paper-v1.png', 'secondary-journal-accent-v1.png', 'secondary-ledger-accent-v1.png', 'secondary-habit-accent-v1.png', 'secondary-focus-accent-v1.png', 'secondary-media-accent-v1.png', 'journal-photo-frame-v2.png']) {
    assert.match(styles, new RegExp(asset.replace('.', '\\.')));
  }
});

test('journal reader uses normal lead typography and material photo framing', () => {
  assert.match(journal, /journal-reader-lead-mark/);
  assert.match(journal, /material-symbols-outlined[^>]*aria-hidden="true">edit_note/);
  assert.doesNotMatch(journal, /✏️/);
  assert.match(styles, /\.drop-cap-p:first-letter\{float:none/);
  // 相框：v3 素材（已裁掉透明边距）+ 九宫格边框。
  // 2026-10-08 修复：原写法把整张素材用 100% 100% 拉伸填满容器，
  // 素材比例 1.5 与容器（竖向）不符，镂空区被拉变形、位置与内容错位，
  // 照片会压到相框的纸上。九宫格让边框宽度固定、镂空区始终覆盖内容区，
  // 因此无论内容多高都不会跑偏。
  assert.match(styles, /\.journal-reader-figure\{[^}]*journal-photo-frame-v3\.png/);
  assert.match(styles, /\.journal-reader-gallery\{[^}]*border-image:url\('assets\/journal-photo-frame-v3\.png'\)/);
  assert.match(styles, /\.journal-reader-figure\{[^}]*border-image:url\('assets\/journal-photo-frame-v3\.png'\)/);
  assert.doesNotMatch(styles, /\.journal-reader-gallery\{[^}]*journal-photo-frame-v[0-9]\.png'\)[^;]*100% 100%/,
    '相册不得再用整图拉伸铺相框（会导致框与内容错位）');
  assert.doesNotMatch(styles, /\.journal-reader-figure\{[^}]*journal-photo-frame-v[0-9]\.png'\)[^;]*100% 100%/,
    '配图不得再用整图拉伸铺相框（会导致框与内容错位）');
  // 注：.vault-item（私密空间小卡片）仍用整图拉伸，属同类问题但卡片尺寸不同，
  // 未在本次一并处理，故此处只约束日记阅读页的两处。
});

test('AI canvas covers the app behind every panel without a bottom split', () => {
  assert.match(styles, /body:has\(\.ai-companion-screen\) #app\{[^}]*ai-companion-canvas-v1\.png/);
  assert.match(styles, /\.ai-companion-screen\{min-height:calc\(100dvh - var\(--dock-clearance\)\)/);
});
