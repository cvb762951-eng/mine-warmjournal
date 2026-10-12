import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../views/today.js', import.meta.url), 'utf8');
const mineSource = await readFile(new URL('../views/mine.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('Today renders only real state and contains no screenshot-fixture branch', () => {
  assert.doesNotMatch(source, /referencePreview|is-reference-fixture|today-1to1|preview-water|preview-countdown/);
  assert.match(source, /const habits = habitsForDate\(state, day\)/);
  assert.match(source, /const todos = todosForDate\(state, day\)/);
  assert.match(source, /const recent = recentActivity\(\)\.filter\(item => item\.date === day\)/);
  assert.match(source, /const countdownHtml = countdownBanner\(\)/);
});

test('Today keeps semantic controls for every reference affordance', () => {
  for (const id of ['refresh-weather','btn-snap','btn-memo','btn-ai','open-habit-detail-today','new-todo','life-stream-more','photo-stack','today-cover-photo','today-cover-input']) {
    assert.match(source, new RegExp(`id="${id}"|#${id}`));
  }
  assert.match(source, /data-habit="\$\{habit\.id\}"/);
  assert.match(source, /data-toggle-todo="\$\{todo\.id\}"/);
  assert.match(source, /data-timeline-day="\$\{item\.date\}"/);
  assert.match(source, /data-func-action="\$\{item\.action\}"/);
});

test('private vault uses an unlabelled long hold on the Today date instead of a visible Mine entry', () => {
  assert.match(source, /id="today-date-secret"/);
  assert.match(source, /PRIVATE_VAULT_HOLD_MS = 1500/);
  assert.match(source, /PRIVATE_VAULT_MOVE_TOLERANCE = 12/);
  assert.match(source, /bindPrivateVaultDateHold\(\)/);
  assert.match(source, /Math\.hypot\([\s\S]*PRIVATE_VAULT_MOVE_TOLERANCE/);
  assert.match(source, /pushBackState\(\);[\s\S]*go\('private-vault'\)/);
  assert.doesNotMatch(mineSource, /open-private-vault|private-vault-entry|私密照片与视频/);
  assert.match(css, /magazine-title-date#today-date-secret\{[^}]*touch-action:pan-y[^}]*user-select:none/);
});

test('paper assets are decorative and contain no baked section screenshots', () => {
  assert.match(css, /today-weather-paper-thick\.png/);
  assert.match(css, /today-actions-paper-thick\.png/);
  assert.match(css, /today-course-paper-thick\.png/);
  assert.match(css, /today-bento-paper-thick\.png/);
  assert.doesNotMatch(css, /today-(?:course|countdown|bento|stream|story|quick|dock)-source-fixture\.png/);
  assert.doesNotMatch(css, /today-utility-strip-source/);
});

test('current route exclusively controls the Dock selected paper', () => {
  assert.match(css, /\.dock-btn\.active\s*\{[^}]*today-dock-active-paper\.png/);
  assert.match(css, /\.floating-dock\s*\{[^}]*today-dock-paper\.png/);
  assert.match(css, /#dock-btn-today \.material-symbols-outlined\s*\{[^}]*today-dock-feather\.png/);
  assert.doesNotMatch(css, /dock-source-fixture/);
  assert.match(source, /registerView\('today', todayView\)/);
});

test('Today photo story keeps the kraft frame and shows each photo complete, like Moments', () => {
  const photoCss = css.slice(css.lastIndexOf('/* Today 今日画页'));
  const blurBlocks = [...photoCss.matchAll(/\.today-view \.polaroid-frame > img\.polaroid-blur\{([^}]*)\}/g)];
  const mainBlocks = [...photoCss.matchAll(/\.today-view \.polaroid-frame > img\.polaroid-img\{([^}]*)\}/g)];
  const blur = blurBlocks.at(-1)?.[1] || '';
  const main = mainBlocks.at(-1)?.[1] || '';
  assert.ok(blur, '今日画页应有虚化垫底层');
  assert.match(blur, /object-fit:cover/);
  assert.match(blur, /filter:blur\(18px\)/);
  assert.match(blur, /position:absolute/);
  assert.ok(main, '今日画页应有完整显示的主图');
  assert.match(main, /object-fit:contain/);
  assert.match(main, /background:transparent/);
  assert.doesNotMatch(photoCss, /object-fit:\s*fill/);
  assert.match(source, /function photoStoryImage/);
  // 两层改由共用 photo-frame.js 生成（photo-blur-pad polaroid-blur / photo-blur-still polaroid-img）
  assert.match(source, /photoFrameLayersHtml\(url, \{ alt, padClass: haze \? 'polaroid-blur is-haze' : 'polaroid-blur is-haze-pending', stillClass: 'polaroid-img' \}\)/);
  assert.match(photoCss, /aspect-ratio:16\/9/);
  assert.doesNotMatch(photoCss, /@media[^{]*orientation/);
  assert.doesNotMatch(photoCss, /portrait|landscape/);
  assert.match(css, /height:clamp\(280px,64vw,350px\)/);
  assert.match(css, /today-photo-kraft-frame\.png/);
  assert.match(source, /cyclePhotoStack\(\)/);
  assert.doesNotMatch(source, /openPhotoLightbox/);
});

test('Today photo caption sits on the paper under the picture, like Moments', () => {
  const photoCss = css.slice(css.lastIndexOf('/* Today 今日画页'));
  assert.match(source, /function handwrittenCaptionHtml\(text\)/);
  assert.match(source, /handwrittenCaptionHtml\(entry\.text \|\| '随手拍'\)/);
  assert.match(source, /<\/span><span class="polaroid-meta"><span class="polaroid-time">/);
  assert.match(photoCss, /\.today-view \.stack-card \.polaroid-meta\{[\s\S]*?background:transparent/);
  assert.match(photoCss, /\.today-view \.stack-card \.polaroid-caption\{[\s\S]*?writing-mode:horizontal-tb/);
  assert.match(photoCss, /-webkit-line-clamp:2/);
  assert.match(photoCss, /font-family:'LXGW WenKai Screen R','Noto Serif SC',serif/);
  assert.doesNotMatch(photoCss, /writing-mode:vertical-rl/);
  assert.doesNotMatch(photoCss, /translateX\(-22px\)/);
  assert.doesNotMatch(photoCss, /rgba\(255,247,232,\.94\)/);
});

test('Today photo switching has directional motion and visible position feedback', () => {
  assert.match(source, /function switchPhotoStack\(nextIndex, preferredDirection = ''\)/);
  assert.match(source, /switchPhotoStack\(photoStackIndex \+ 1, 'next'\)/);
  assert.match(source, /stack\.classList\.add\(direction === 'next' \? 'switch-next' : 'switch-previous'\)/);
  assert.match(source, /第 \$\{photoStackIndex \+ 1\}\/\$\{photoStackCount\} 张/);
  assert.match(css, /@keyframes photoStackNext/);
  assert.match(css, /@keyframes photoStackPrevious/);
  assert.match(css, /\.today-view \.stack-dot\.active\{width:20px/);
});

test('Today live date content stays above the unified paper without covering it', () => {
  const finalCss = css.slice(css.indexOf('/* 顶部层级修复'));
  assert.match(finalCss, /\.today-editorial-cover \.magazine-header\{[\s\S]*?z-index:7[\s\S]*?background:transparent!important/);
  assert.match(finalCss, /\.today-editorial-cover::before\{z-index:6\}/);
});

test('Today photo caption stays compact instead of scrolling sideways', () => {
  const photoCss = css.slice(css.lastIndexOf('/* Today 今日画页'));
  assert.match(photoCss, /-webkit-line-clamp:2/);
  assert.match(photoCss, /\.today-view \.stack-card \.polaroid-caption\{[\s\S]*?overflow:hidden/);
  assert.doesNotMatch(photoCss, /touch-action:pan-x/);
  assert.doesNotMatch(photoCss, /writing-mode:vertical-rl/);
});

test('Today shows every activity for the current day and removes unexplained habit dots', () => {
  assert.match(source, /recentActivity\(\)\.filter\(item => item\.date === day\)/);
  assert.doesNotMatch(source, /habitDotsHtml|habit-mini-dots/);
});

test('Today custom cover uses real local persistence and an image input', () => {
  assert.match(source, /state\.settings\.todayCoverImage/);
  assert.match(source, /框选首页封面范围/);
  assert.match(source, /todayCoverCropGeometry/);
  assert.match(source, /today-cover-crop-canvas/);
  assert.match(source, /output\.width = 1200/);
  assert.match(source, /await save\(\)/);
  assert.match(css, /editorial-hero-image\.has-custom-cover/);
  assert.match(css, /today-cover-single-tear-v3\.png/);
  assert.match(css, /\.today-editorial-cover::before\{[\s\S]*?z-index:5[\s\S]*?inset:0/);
  assert.match(css, /\.today-editorial-cover \.magazine-header\{position:relative;z-index:6\}/);
  assert.doesNotMatch(source, /today-cover-edit/);
  assert.match(css, /today-editorial-cover\{height:clamp\(195px,52vw,240px\);min-height:0/);
  assert.match(css, /editorial-hero-image>img\{position:absolute;inset:0;width:100%;height:100%;object-fit:cover/);
});

test('Today restores the native custom cover and renders every scheduled habit and todo', async () => {
  const mediaStore = await readFile(new URL('../media-store.js', import.meta.url), 'utf8');
  assert.match(mediaStore, /state\.settings\.todayCoverImage/);
  assert.match(source, /\$\{habits\.length \? habits\.map\(habit =>/);
  assert.match(source, /\$\{todos\.length \? todos\.map\(todo =>/);
  assert.doesNotMatch(source, /habits\.slice\(0,\s*3\)/);
  assert.doesNotMatch(source, /todos\.slice\(0,\s*4\)/);
  assert.match(css, /#countdown-banner \+ \.today-bento-grid[\s\S]*?height:185px/);
  assert.match(css, /#habits-bento-list,[\s\S]*?#todos-bento-list\{[\s\S]*?overflow-y:auto/);
});

test('Today Life Stream uses one warm-paper section with breathable semantic rows', () => {
  assert.match(source, /<section class="today-life-stream-section">/);
  assert.match(source, /id="life-stream-more"/);
  assert.match(css, /\.today-view \.today-life-stream-section\s*\{[^}]*today-bento-paper-thick\.png/);
  assert.match(css, /\.today-view \.today-life-stream-section #today-timeline-stream \.life-stream-card\s*\{[^}]*min-height:54px/);
  assert.match(css, /\.today-view \.today-life-stream-section #today-timeline-stream \.life-stream-copy strong\s*\{[^}]*text-overflow:ellipsis/);
});
