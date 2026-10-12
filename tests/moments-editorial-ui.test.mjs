import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../views/snippets.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const mainView = source.slice(source.indexOf('export function snippetsView'), source.indexOf('function dayGroupLabel'));

test('Moments overview remains derived from real snippets and media state', () => {
  assert.match(mainView, /state\.snippets\.filter\(entry => entry\.type === 'photo'\)/);
  assert.match(mainView, /state\.snippets\.filter\(entry => entry\.type === 'text'\)/);
  assert.match(mainView, /const mediaCount = state\.media\.length/);
  assert.match(mainView, /snippetEntries\(state,/);
  assert.match(mainView, /mediaFilter \|\| snippetType === 'all'/);
  assert.doesNotMatch(mainView, /referenceFixture|previewMoments|demoRecord/);
});

test('Moments keeps every real search filter create and record control', () => {
  for (const id of ['snippet-search-form', 'new-snippet']) assert.match(mainView, new RegExp(`id="${id}"`));
  for (const type of ['all', 'photo', 'text', 'media', 'live']) assert.match(mainView, new RegExp(`data-snippet-type="${type}"`));
  assert.match(source, /data-edit-snippet="\$\{entry\.id\}"/);
  assert.match(source, /data-delete-snippet="\$\{entry\.id\}"/);
  assert.match(source, /data-view-snippet-photo="\$\{entry\.id\}"/);
  assert.match(source, /data-open-media-detail="\$\{entry\.id\}"/);
});

test('Moments reference styling uses independent paper assets and live HTML', () => {
  assert.match(css, /Moments 1:1 画报复刻/);
  assert.match(css, /snippets-view \.snippets-stats-hero[^}]*today-bento-paper-thick\.png/);
  assert.match(css, /snippets-view \.snippet-day-header[^}]*background-color:#a93f28/);
  assert.match(css, /snippets-view \.snippet-day-header[^}]*moments-day-ribbon-v1\.png/);
  assert.match(css, /snippets-view \.snippet-filter-pill\.active/);
  assert.match(css, /phone-shell:has\(\.snippets-view\) \.dock-btn\.active/);
  assert.doesNotMatch(css, /moments-(?:source|reference|fixture)\.(?:png|jpg|webp)/);
});

test('Moments visible icons use the installed Material icon system', () => {
  assert.match(mainView, /material-symbols-outlined">local_fire_department/);
  assert.match(mainView, /material-symbols-outlined">photo_camera/);
  assert.match(mainView, /material-symbols-outlined">collections_bookmark/);
  assert.doesNotMatch(mainView, /📸|📝|📚|🎬|🔥/);
});

test('Moments annotated Chinese headings and record copy use the real local handwriting family', () => {
  const momentsStart = css.indexOf('/* Moments 1:1 画报复刻');
  const momentsEnd = css.indexOf('/* Journal 1:1 画报复刻', momentsStart);
  const momentsCss = css.slice(momentsStart, momentsEnd);
  assert.match(momentsCss, /stats-hero-title[^}]*LXGW WenKai Screen R/);
  assert.match(momentsCss, /snippet-day-title[^}]*LXGW WenKai Screen R/);
  assert.match(momentsCss, /snippet-item-text[^}]*LXGW WenKai Screen R/);
  assert.doesNotMatch(momentsCss, /font-family:'LXGW WenKai','Noto Serif SC'/);
});

test('Moments date ribbon has a substantial touch and reading height', () => {
  const finalCss = css.slice(css.indexOf('/* Browser comments final lock'));
  assert.match(finalCss, /\.snippets-view \.snippet-day-header\{[\s\S]*?height:76px[\s\S]*?grid-template-columns:minmax\(0,1fr\) max-content/);
  assert.match(finalCss, /\.snippets-view \.snippet-day-title\{[\s\S]*?white-space:nowrap/);
  assert.match(finalCss, /\.snippets-view \.snippet-day-count\{[\s\S]*?white-space:nowrap/);
  assert.match(source, /class="snippet-day-date"/);
  assert.match(source, /class="snippet-day-week"/);
});

test('Moments record actions stay inside each paper card without pills', () => {
  const finalCss = css.slice(css.indexOf('/* Calendar / Moments 卡片操作区'));
  assert.match(finalCss, /\.snippets-view \.snippet-item-actions\{[\s\S]*?max-width:100%[\s\S]*?flex-wrap:wrap[\s\S]*?overflow:hidden/);
  assert.match(finalCss, /\.snippets-view \.snippet-item-actions button\{[\s\S]*?border-radius:0[\s\S]*?background:transparent!important/);
  assert.match(finalCss, /button\.danger\{color:#9d3e2d/);
});

test('Moments portrait photos stay complete and large albums use a bounded mosaic', () => {
  assert.match(source, /function snippetPhotoMosaic/);
  assert.match(source, /photos\.slice\(0, 5\)/);
  assert.match(source, /data-photo-index="\$\{index\}"/);
  assert.match(source, /lazy: true/);
  assert.match(css, /\.snippet-photo-tile img\{[^}]*object-fit:contain/);
  // 2026-10-09 实测发现（核对「竖拍照片要完整显示」时）：格子是固定高度的网格单元，
  // 子图若只写 height:100%，在自动行里会退化成 auto，被按原图比例撑高后由 overflow:hidden
  // 从底部裁掉 —— 竖拍照片只显示上半、根本不是「完整」。必须绝对定位填满格子。
  assert.match(css, /\.snippet-photo-tile img\{[^}]*position:absolute[^}]*inset:0/,
    '照片必须绝对定位填满格子，否则 height:100% 失效、竖拍照片会被裁掉下半');
  assert.match(css, /\.snippet-photo-tile img\.snippet-photo-main\{[^}]*position:absolute[^}]*inset:0/,
    '主图同样要绝对定位');
  assert.doesNotMatch(css, /\.snippet-photo-tile\{[^}]*place-items:center/,
    '格子内的网格居中会让子图高度失去约束，必须去掉');
  // 2026-10-09：单张图曾用 height:auto + max-height:min(82dvh,760px)，
  // 竖拍大图会顶到六七百像素、占掉大半个屏幕（用户反馈「太大」）。
  // 现在改为固定高度（后又按「感觉不美观」下调一档 320→260，再按「更矮一档」→ 190）；
  // 但 **contain 保留** —— 竖拍照片要完整显示，左右留白由同照片虚化垫底，这是既定设计。
  assert.match(css, /\.snippet-photo-mosaic\.count-1\{[^}]*height:190px/);
  assert.match(css, /\.snippet-photo-mosaic\.count-1 \.snippet-photo-tile img\{[^}]*object-fit:contain/);
  assert.doesNotMatch(css, /max-height:min\(82dvh,760px\)/, '不能再允许无限拔高');
  assert.match(css, /\.snippet-photo-more\{/);

  // 2026-10-09：没占满的两条边由深色底换成「同一张照片放大虚化」
  // （用户要求「竖屏照片也按这个风格处理」，与视频封面同一套做法）。
  // 只换垫底 —— 照片格的高度与排布一律不动。
  assert.match(source, /function snippetPhotoImage/);
  assert.match(source, /photoFrameLayersHtml\(url, \{[^}]*padClass: 'snippet-photo-blur', stillClass: 'snippet-photo-main'/, '两层用同一张照片的地址（共用 photo-frame.js）');
  assert.match(source, /class="photo-blur-frame snippet-photo-tile"/);
  const photoBlur = css.match(/\.photo-blur-frame>img\.photo-blur-pad\{([^}]*)\}/)?.[1] || '';
  assert.match(photoBlur, /object-fit:cover/, '底层要铺满，不能留白');
  assert.match(photoBlur, /position:absolute/, '铺底层要脱离排版，不能影响格子尺寸');
  const photoMain = css.match(/\.photo-blur-frame>img\.photo-blur-still\{([^}]*)\}/)?.[1] || '';
  assert.match(photoMain, /object-fit:contain/, '照片要完整显示，不能裁切');
  assert.match(photoMain, /background:transparent/, '上层必须透明，否则底色会盖住铺底层');

  // 上层变成定位元素后，「+N」遮罩必须仍压在照片之上，否则角标被盖住
  assert.match(css, /\.snippets-view \.snippet-photo-more\{z-index:2\}/, '角标要抬到主图之上');
});
