import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const snippets = await readFile(new URL('../views/snippets.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const common = await readFile(new URL('../views/common.js', import.meta.url), 'utf8');
const calendar = await readFile(new URL('../views/calendar.js', import.meta.url), 'utf8');
const journal = await readFile(new URL('../views/journal.js', import.meta.url), 'utf8');
const taste = await readFile(new URL('../views/taste.js', import.meta.url), 'utf8');
const gallery = await readFile(new URL('../views/local-gallery.js', import.meta.url), 'utf8');
const vault = await readFile(new URL('../views/private-vault.js', import.meta.url), 'utf8');

test('Moments multi-media opens album browse before fullscreen', () => {
  assert.match(snippets, /function openMomentAlbumBrowse/);
  assert.match(snippets, /function openMomentMediaBrowse/);
  assert.match(snippets, /momentAlbumItems/);
  assert.match(snippets, /openMomentMediaBrowse\(entry,/);
  assert.match(snippets, /items\.length > 1\) \{[\s\S]{0,400}?openMomentAlbumBrowse\(entry, photoIndex, originEl\)/);
  assert.match(snippets, /moment-album-layer/);
  assert.doesNotMatch(snippets, /SECTIONS|SCHEMA_VERSION|state\.snippets\.push.*album/);
});

test('Moments album is a card deck (journal-style flip), not a thumbnail grid', () => {
  // 2026-10-12 用户要求：图集照着日记翻牌的形式来 —— 一叠牌、点照片看大图、左右拖翻下一张。
  assert.match(snippets, /moment-album-card/);
  assert.match(snippets, /moment-album-frame photo-blur-frame is-edge/, '照片仍走共用相框（contain + 纸色兜底）');
  assert.match(snippets, /snippetPhotoImage\(item\.photo/);
  assert.match(snippets, /photoFrameLayersHtml\(poster/);
  assert.match(snippets, /data-depth="\$\{depth\}"/, '后两张靠 depth 定位');
  assert.match(snippets, /function bindMomentAlbumDeck/, '手势：左右拖翻页、轻触看大图');
  assert.match(snippets, /deckCutDecision\(\{ dx, width: stage\.clientWidth \|\| 1, velocity \}\)/, '阈值与日记牌组同一规则');
  assert.match(snippets, /if \(!moved\) \{ openMomentAlbumCurrent\(\); return; \}/, '没拖动就是轻触 → 看大图');
  assert.match(snippets, /function flipMomentAlbum\(step, \{ fromX = 0, velocity = 0 \} = \{\}\)/);
  assert.match(snippets, /prefersReducedMotion\(\)/);
  assert.match(css, /\.moment-album-stage/);
  assert.match(css, /\.moment-album-card\[data-depth="1"\] \{ z-index: 2; transform: translate3d\(0, -12px, -10px\) scale\(0\.972\); opacity: 0\.96; \}/,
    '深度位移沿用日记牌组数值，并带层级与透明度阶梯');
  // ⚠️ 必须按深度给层级：三张牌按 0/1/2 依次插入 DOM，不给 z-index 的话「最深那张」会盖在最上面
  assert.match(css, /\.moment-album-card\[data-depth="0"\] \{ z-index: 3; \}/);
  assert.match(css, /\.moment-album-card\[data-depth="2"\] \{ z-index: 1;/);
  assert.match(css, /\.moment-album-sheet/);
  assert.doesNotMatch(css, /\.moment-album-grid/, '旧的缩略网格已删除');
  assert.doesNotMatch(css, /\.moment-album-tile/, '旧的缩略格子已删除');
});

test('Album layer is navigation-only and restores under modal viewer', () => {
  assert.match(snippets, /registerHelper\('isMomentAlbumOpen'/);
  assert.match(snippets, /registerHelper\('closeMomentAlbum'/);
  assert.match(app, /isMomentAlbumOpen/);
  assert.match(app, /closeMomentAlbum/);
  // 轻触牌面 → 既有大图 / 播放器（2026-10-12 起集中在 openMomentAlbumCurrent 里）
  assert.match(snippets, /function openMomentAlbumCurrent\(\)/);
  assert.match(snippets, /photoLightbox\(entry, item\.index\)/);
  assert.match(snippets, /openSavedSnippetVideo\(entry, item\.index\)/);
});

test('Content photo surfaces migrated to shared photo-frame helper', () => {
  for (const [name, source] of [
    ['common', common],
    ['calendar', calendar],
    ['journal', journal],
    ['taste', taste],
    ['gallery', gallery],
    ['vault', vault],
    ['snippets', snippets],
  ]) {
    assert.match(source, /photoFrameLayersHtml|photo-blur-frame is-edge/, `${name} should use shared frame`);
  }
  assert.match(common, /activity-photo-thumb photo-blur-frame is-edge/);
  assert.match(common, /journalPhotos[\s\S]*photo-blur-frame is-edge/);
  assert.match(calendar, /day-photo-thumb photo-blur-frame is-edge/);
  assert.match(journal, /journal-polaroid-frame photo-blur-frame is-edge/);
  assert.match(journal, /journal-reader-gallery[\s\S]*photo-blur-frame is-edge/);
  assert.match(taste, /taste-entry-cover photo-blur-frame is-edge/);
  assert.match(gallery, /local-gallery-tile photo-blur-frame is-edge/);
  assert.match(vault, /vault-moment-preview photo-blur-frame is-edge/);
  assert.match(snippets, /snippet-photo-thumb photo-blur-frame is-edge/);
});

test('Album flip: throw continues from finger, no full re-render per flip, pre-decode, tiers', () => {
  assert.doesNotMatch(snippets, /resetTopCard/, '松手不再先弹回原位');
  assert.match(snippets, /flipMomentAlbum\(decision === 'next' \? 1 : -1, \{ fromX: dx, velocity \}\)/);
  const flip = snippets.slice(snippets.indexOf('function flipMomentAlbum('), snippets.indexOf('function bindMomentAlbumDeck'));
  assert.doesNotMatch(flip, /innerHTML|renderMomentAlbumStack/, '翻牌只换出一张，不整堆重画');
  assert.match(snippets, /img\.decode\?\.\(\)/, '新牌预解码');
  assert.match(snippets, /function momentAlbumTier\(\)/);
  assert.match(snippets, /prefersReducedMotion\(\)\) return 'none'/);
  assert.match(snippets, /momentAlbumOriginFrames/, '从点的缩略图位置展开/收回');
  assert.match(css, /\.moment-album-layer\.is-closing/);
});

test('Moments album deck plain theme visual polish and depth table', async () => {
  const plainCss = await readFile(new URL('../themes-plain.css', import.meta.url), 'utf8');
  const plainLightCss = await readFile(new URL('../themes-plain-light.css', import.meta.url), 'utf8');

  // 1. JS: warm depth preserved & plain depth table present
  assert.match(snippets, /const MOMENT_ALBUM_DEPTH = \[{\s*y:\s*0,\s*s:\s*1,\s*o:\s*1\s*},\s*{\s*y:\s*-12,\s*s:\s*0\.972,\s*o:\s*0\.96\s*},\s*{\s*y:\s*-24,\s*s:\s*0\.944,\s*o:\s*0\.9\s*}\];/);
  assert.match(snippets, /const MOMENT_ALBUM_DEPTH_PLAIN = \[{\s*y:\s*0,\s*s:\s*1,\s*o:\s*1\s*},\s*{\s*y:\s*-16,\s*s:\s*0\.955,\s*o:\s*0\.94\s*},\s*{\s*y:\s*-30,\s*s:\s*0\.915,\s*o:\s*0\.86\s*}\];/);
  assert.match(snippets, /function momentAlbumDepthTable\(\)/);
  assert.match(snippets, /dataset\?\.theme === 'plain'/);

  // 2. CSS: Both themes-plain.css and themes-plain-light.css have the plain rules
  for (const [name, fileCss] of [['themes-plain', plainCss], ['themes-plain-light', plainLightCss]]) {
    assert.match(fileCss, /:root\[data-theme="plain"\] \.moment-album-card\s*\{[^}]*border-radius:\s*18px !important;/, `${name} has card radius 18px`);
    assert.match(fileCss, /:root\[data-theme="plain"\] \.moment-album-frame\s*\{[^}]*border-radius:\s*10px !important;/, `${name} has frame radius 10px`);
    // 2026-10-15：深度值按"肉眼看到的露边间距"重新配平（两层各约 7px / 6.6px），
    // 与 JS 的 MOMENT_ALBUM_DEPTH_PLAIN 保持一致（那才是姿态真身，这两条只是首帧兜底）。
    assert.match(fileCss, /:root\[data-theme="plain"\] \.moment-album-card\[data-depth="1"\]\s*\{[^}]*transform:\s*translate3d\(0,\s*-16px,\s*0\)\s*scale\(0\.955\);/, `${name} has depth 1 transform`);
    assert.match(fileCss, /:root\[data-theme="plain"\] \.moment-album-card\[data-depth="2"\]\s*\{[^}]*transform:\s*translate3d\(0,\s*-30px,\s*0\)\s*scale\(0\.915\);/, `${name} has depth 2 transform`);
    assert.match(fileCss, /:root\[data-theme="plain"\] \.moment-album-card\s*\{[^}]*background-color:\s*var\(--plain-surface\) !important;/, `${name} has plain surface color`);
    assert.match(fileCss, /:root\[data-theme="plain"\] \.moment-album-card\s*\{[^}]*background-image:\s*none !important;/, `${name} removes paper texture`);
  }

  // 3. No warm cream forced on plain moment-album-card
  assert.doesNotMatch(plainCss, /:root\[data-theme="plain"\] \.moment-album-card\s*\{[^}]*#fdfcf9 !important;/);
});

test('Moments album centered dialog layout and scale/fade animation across themes', async () => {
  const plainCss = await readFile(new URL('../themes-plain.css', import.meta.url), 'utf8');
  const plainLightCss = await readFile(new URL('../themes-plain-light.css', import.meta.url), 'utf8');

  // 1. Layer layout: centered, not flex-end bottom sheet; padding 16px + safe-area
  assert.match(css, /\.moment-album-layer\s*\{[^}]*align-items:\s*center;/);
  assert.match(css, /\.moment-album-layer\s*\{[^}]*justify-content:\s*center;/);
  assert.doesNotMatch(css, /\.moment-album-layer\s*\{[^}]*align-items:\s*flex-end;/);
  assert.match(css, /\.moment-album-layer\s*\{[^}]*padding:\s*calc\(16px\s*\+\s*env\(safe-area-inset-top,\s*0px\)\)\s*calc\(16px\s*\+\s*env\(safe-area-inset-right,\s*0px\)\)\s*calc\(16px\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\)\s*calc\(16px\s*\+\s*env\(safe-area-inset-left,\s*0px\)\);/);

  // 2. Sheet dimensions: width min(100% - 32px, 440px), max-height min(86dvh, 760px)
  assert.match(css, /\.moment-album-sheet\s*\{[^}]*width:\s*min\(100%\s*-\s*32px,\s*440px\);/);
  assert.match(css, /\.moment-album-sheet\s*\{[^}]*max-height:\s*min\(86dvh,\s*760px\);/);

  // 3. Border radius on all four corners, no bottom-only radius, no safe-area in sheet padding
  assert.match(css, /\.moment-album-sheet\s*\{[^}]*border-radius:\s*var\(--radius-soft,\s*14px\);/);
  assert.doesNotMatch(css, /\.moment-album-sheet\s*\{[^}]*border-radius:[^;]*0\s*0\s*;/);
  assert.doesNotMatch(css, /\.moment-album-sheet\s*\{[^}]*safe-area-inset-bottom/);

  // Plain theme sheet: 20px radius on all four corners
  for (const [name, fileCss] of [['themes-plain', plainCss], ['themes-plain-light', plainLightCss]]) {
    assert.match(fileCss, /:root\[data-theme="plain"\] \.moment-album-sheet\s*\{[^}]*border-radius:\s*20px !important;/, `${name} has sheet radius 20px`);
    assert.doesNotMatch(fileCss, /:root\[data-theme="plain"\] \.moment-album-sheet\s*\{[^}]*border-radius:[^;]*0\s*0\s*!important;/, `${name} has no bottom-only radius`);
  }

  // 4. JS open/close animation: scale(.94)+opacity 0 -> none, no translateY(24px)
  assert.match(snippets, /transform:\s*'scale\(\.?94\)',\s*opacity:\s*0/);
  assert.doesNotMatch(snippets, /momentAlbumOriginFrames[\s\S]*?translateY\(24px\)/);
  assert.doesNotMatch(snippets, /momentAlbumOriginFrames[\s\S]*?translate3d\(0,24px,0\)/);
  assert.match(snippets, /const end = \{ transform: 'none', opacity: 1 \};/);

  // 5. Reduced motion: tier none = no animation
  assert.match(snippets, /if \(prefersReducedMotion\(\)\) return 'none';/);
  assert.match(snippets, /momentAlbumTier\(\) !== 'none'/);

  // 6. No :is/:has/:where in album rules
  const albumCssChunk = css.slice(css.indexOf('.moment-album-layer'), css.indexOf('.moment-album-card'));
  assert.doesNotMatch(albumCssChunk, /:(is|has|where)\(/);
});
