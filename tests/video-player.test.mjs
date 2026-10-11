import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { formatVideoDuration, isHlsAddress, normalizeHlsAddress, presentWatchSession, summarizeWatchSession } from '../video-player.js';
import { detectPillarboxFromImageData, selectPillarboxConsensus, posterFrameTimes } from '../video-poster.js';

const snippets = await readFile(new URL('../views/snippets.js', import.meta.url), 'utf8');
const common = await readFile(new URL('../views/common.js', import.meta.url), 'utf8');
const core = await readFile(new URL('../core.js', import.meta.url), 'utf8');
const mediaStore = await readFile(new URL('../media-store.js', import.meta.url), 'utf8');
const storage = await readFile(new URL('../storage.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const calendar = await readFile(new URL('../views/calendar.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const performanceCss = await readFile(new URL('../performance.css', import.meta.url), 'utf8');
const photoUtils = await readFile(new URL('../video-poster.js', import.meta.url), 'utf8');
const videoPlayer = await readFile(new URL('../video-player.js', import.meta.url), 'utf8');
const framePicker = await readFile(new URL('../video-frame-picker.js', import.meta.url), 'utf8');
const privateVault = await readFile(new URL('../views/private-vault.js', import.meta.url), 'utf8');
const backup = await readFile(new URL('../backup.js', import.meta.url), 'utf8');
const mainActivity = await readFile(new URL('../android/app/src/main/java/com/mine/focus/MainActivity.java', import.meta.url), 'utf8');
const nativeMedia = await readFile(new URL('../android/app/src/main/java/com/mine/focus/NativeMediaStorePlugin.java', import.meta.url), 'utf8');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('watch sessions drop glances, keep a looped ending, and score a trimmed span', () => {
  assert.equal(summarizeWatchSession({ startedAt: 1, watchedMilliseconds: 2_900, startPosition: 0, endPosition: 2, furthest: 2, duration: 30 }), null);
  const looped = summarizeWatchSession({
    id: 'loop', startedAt: 1_000, endedAt: 31_000,
    watchedMilliseconds: 30_800, startPosition: 0, endPosition: 1.2, furthest: 59.8, duration: 60
  });
  assert.equal(looped.watchedSeconds, 30);
  assert.equal(looped.startPosition, 0);
  assert.equal(looped.endPosition, 59);
  assert.equal(looped.completion, 59.8 / 60);
  const trimmed = summarizeWatchSession({
    id: 'trim', startedAt: 1, endedAt: 2,
    watchedMilliseconds: 20_000, startPosition: 30, endPosition: 32, furthest: 74, duration: 600,
    trim: { start: 30, end: 75 }
  });
  assert.equal(trimmed.endPosition, 74);
  assert.ok(Math.abs(trimmed.completion - (44 / 45)) < 1e-9);
  const shown = presentWatchSession(trimmed, { start: 30, end: 75 });
  assert.equal(shown.startPosition, 0);
  assert.equal(shown.endPosition, 44);
  assert.equal(shown.completion, trimmed.completion);
  assert.equal(presentWatchSession(looped, null), looped);
});

test('HLS addresses accept only explicit HTTP m3u8 sources', () => {
  assert.equal(normalizeHlsAddress('https://media.example.test/live/master.m3u8?token=abc'), 'https://media.example.test/live/master.m3u8?token=abc');
  assert.equal(isHlsAddress('http://127.0.0.1/video.m3u8'), true);
  assert.equal(normalizeHlsAddress('https://media.example.test/play?id=42', { allowDynamicPath: true }), 'https://media.example.test/play?id=42');
  for (const invalid of ['javascript:alert(1)', 'file:///video.m3u8', 'https://user:pass@example.test/a.m3u8', 'https://example.test/video.mp4', 'not a url']) {
    assert.equal(normalizeHlsAddress(invalid), '');
  }
});

test('Moments large albums use a looping fullscreen viewer with a lazy filmstrip', () => {
  assert.match(snippets, /photoViewer\(photos, index,[\s\S]*?\{\s*loop: true,\s*filmstrip: true,\s*onVerticalNavigate:/);
  assert.match(common, /class="photo-viewer-filmstrip"/);
  assert.match(common, /photo-viewer \$\{strip \? 'has-filmstrip'/);
  assert.match(common, /data-photo-strip/);
  assert.match(common, /loading="lazy"/);
  assert.match(common, /options\.loop && photos\.length/);
  assert.match(common, /bindPhotoViewerGestures\(photos, meta, active, options\)/);
  assert.match(css, /\.photo-viewer-filmstrip\{/);
  assert.match(css, /\.photo-viewer\.has-filmstrip \.photo-viewer-meta\{[^}]*bottom:max\(158px/);
});

test('Moments fullscreen photos swipe down to the next photo entry without changing horizontal or zoom gestures', () => {
  assert.match(snippets, /function visibleMomentPhotoEntries\(\)[\s\S]*snippetEntries\(state, \{ type: 'photo', search: snippetSearch \}\)/);
  assert.match(snippets, /\.sort\(\(a, b\) => b\.date\.localeCompare\(a\.date\) \|\| b\.createdAt - a\.createdAt\)/);
  assert.match(snippets, /onVerticalNavigate: entries\.length > 1 && entryIndex >= 0/);
  assert.match(snippets, /entries\[\(entryIndex \+ direction \+ entries\.length\) % entries\.length\]/);
  assert.match(snippets, /entryIds = \[\.\.\.new Set\(stream\.map\(item => item\.entryId\)\)\]/);
  assert.match(common, /options\.onVerticalNavigate\(totalDy > 0 \? 1 : -1\)/);
  assert.match(common, /Math\.abs\(totalDx\) > Math\.abs\(totalDy\) && Math\.abs\(totalDx\) > 60/);
  assert.match(common, /else if \(!switched && !multiTouch\)/);
  assert.match(common, /else if \(scale > 1\) \{ x \+= dx; y \+= dy; \}/);
});

test('photo metadata hides with the viewer controls and has no full-width gradient edge', () => {
  assert.match(common, /id="photo-viewer-stage">\$\{mediaHtml\}<\/div><div class="photo-viewer-chrome">[\s\S]*\$\{strip\}\$\{metaLayer\}<footer>/);
  assert.match(common, /chrome\.classList\.toggle\('hidden'\)/);
  assert.match(performanceCss, /\.photo-viewer-meta \{[^}]*background: none;/);
  assert.match(css, /\.photo-viewer\.has-filmstrip \.photo-viewer-meta\{[^}]*background:none/);
  assert.match(css, /\.photo-viewer-chrome\.hidden \.photo-viewer-filmstrip\{pointer-events:none\}/);
});

test('video player is bundled locally and cleans up through every modal close path', () => {
  assert.equal(pkg.dependencies['hls.js'], '1.7.2');
  assert.match(core, /callHelper\('closeVideoPlayer'\)/);
  assert.match(snippets, /registerHelper\('closeVideoPlayer', stopActiveVideoPlayer\)/);
  assert.match(snippets, /activeVideoController\?\.destroy\(\)/);
  assert.match(snippets, /data-video-rate/);
  assert.match(snippets, /warm-video-fullscreen/);
  assert.match(snippets, /video\.position = position/);
  assert.match(snippets, /sourceType: video\.sourceType/);
  assert.match(videoPlayer, /recoverMediaError\(\)/);
  assert.match(css, /Private Screening|私人放映室/);
});

test('Moments exposes local import, m3u8 input and a real play action', () => {
  assert.match(snippets, /id="pick-snippet-video"/);
  assert.match(snippets, /id="snippet-hls-url"/);
  assert.match(snippets, /id="add-snippet-hls"/);
  assert.match(snippets, /id="quick-pick-video"/);
  assert.match(snippets, /id="quick-hls-url"/);
  assert.match(snippets, /id="quick-add-hls"/);
  assert.match(snippets, /data-play-snippet-video/);
  assert.match(snippets, /HLS 在线视频/);
  assert.match(snippets, /播放时才会联网/);
});

test('browser media uses IndexedDB references instead of localStorage data URLs', () => {
  assert.match(mediaStore, /mine-browser-media:\/\//);
  assert.match(mediaStore, /indexedDB\.open\(BROWSER_DB, 1\)/);
  assert.match(mediaStore, /writeBrowserBlob\(file, extension/);
  assert.match(mediaStore, /ensureBrowserUrl/);
  assert.match(mediaStore, /readBrowserData/);
  assert.match(mediaStore, /browserDelete/);
  assert.doesNotMatch(storage, /localStorage\.setItem\(LEGACY_KEY, JSON\.stringify\(migrated\)\)/);
  assert.match(app, /externalizeStateMedia\(state\)[\s\S]*?await persistState\(state\)/);
});

test('video covers retry decoded frames and can be replaced manually', () => {
  assert.match(photoUtils, /requestVideoFrameCallback/);
  assert.match(photoUtils, /isNearlyBlankFrame/);
  // 候选时间点已抽成 posterFrameTimes（导入与"裁剪后重抓封面"共用同一套），所以断言改成这套
  assert.match(photoUtils, /span \* \.45/, '候选时间点里要有约 45% 处的一帧');
  assert.match(photoUtils, /export function posterFrameTimes\(duration, range = null\)/);
  assert.match(photoUtils, /releaseVideoElement\(video\)/);
  assert.match(photoUtils, /video\.removeAttribute\('src'\)/);
  assert.match(photoUtils, /releaseCanvas\(canvas\)/);
  assert.match(snippets, /data-change-video-poster/);
  assert.match(snippets, /data-recapture-video-poster/);
  assert.match(snippets, /data-refresh-video-poster/);
  assert.match(snippets, /showVideoFramePicker\(source/);
  assert.match(framePicker, /video-frame-range/);
  // 选封面必须站在「裁剪后」的视角上（2026-10-10 用户反馈）：
  //   预览按取景框裁好显示、时间轴只在保留区间里走动、抓帧只抓取景框里那一块。
  //   只改一处（比如只裁预览不裁抓帧）就会重新出现"挑了半天封面却是另一张图"。
  assert.match(framePicker, /crop = null, range = null/);
  assert.match(framePicker, /applyVideoCrop\(video, framed\)/);
  assert.match(framePicker, /captureCurrentFrame\(video, hasCrop \? framed : null\)/);
  assert.match(framePicker, /rangeInput\.min = String\(start\)/);
  assert.match(framePicker, /drawImage\(\s*video,\s*rect\.x \* video\.videoWidth/);
  // 私密空间换封面时要把当前的裁剪与剪短一起传进去，否则上面那套都用不上。
  assert.match(privateVault, /crop: item\.crop \|\| null,\s*range: item\.trim \|\| null/);
  assert.match(snippets, /视频封面已更换/);
  assert.match(css, /snippet-cover-main\{[^}]*object-fit:contain/);
});

test('Android video imports stream through a native private-media copier', () => {
  assert.match(mainActivity, /registerPlugin\(NativeMediaStorePlugin\.class\)/);
  assert.match(nativeMedia, /ContentResolver\(\)|getContentResolver\(\)\.openInputStream/);
  assert.match(nativeMedia, /byte\[1024 \* 1024\]/);
  assert.match(snippets, /saveNativeMediaSource/);
  assert.match(mediaStore, /NativeMediaStore\.copyVideo/);
});

test('snapshots protect referenced videos and oversized portable backups fail safely', () => {
  assert.match(storage, /protectedSnapshotMediaReferences/);
  assert.match(core, /removeUnusedMedia\(savedState, \[\.\.\.await protectedSnapshotMediaReferences\(\), \.\.\.stateMediaReferences\(state\), \.\.\.\(state\.privateVault\?\.assetRefs \|\| \[\]\)\]\)/);
  assert.match(backup, /MAX_PORTABLE_MEDIA_BYTES/);
  assert.match(backup, /health\.bytes \+ vaultHealth\.bytes > MAX_PORTABLE_MEDIA_BYTES/);
});

test('multiple videos expose an individual segment entry', () => {
  assert.match(snippets, /snippet-video-segments/);
  assert.match(snippets, /data-video-index="\$\{index\}"/);
});

test('video player supports swipe navigation, descriptions and session callbacks', () => {
  assert.match(snippets, /warm-video-description/);
  assert.match(snippets, /左右滑动切换视频/);
  assert.match(snippets, /Math\.abs\(dx\) > 58/);
  assert.match(snippets, /options\.onProgress/);
  assert.match(snippets, /options\.autoAdvance/);
  assert.match(snippets, /vault-feed-info/);
  assert.match(snippets, /vault-feed-current-time/);
  assert.match(snippets, /vault-feed-total-time/);
  assert.match(snippets, /观看记录/);
  assert.match(snippets, /createWatchSessionTracker/);
  assert.match(snippets, /watchedSeconds < 3/);
  assert.match(snippets, /document\.visibilityState !== 'hidden'/);
  assert.match(css, /\.vault-feed-info\{[^}]*bottom:max\(28px/);
  assert.match(css, /\.vault-feed-modal \.vault-feed-progress\{[^}]*position:static/);
  assert.match(css, /\.vault-feed-copy>strong\{[^}]*-webkit-line-clamp:2/);
  assert.match(css, /\.vault-feed-history-panel\{/);
  assert.match(snippets, /feed-chrome-hidden/);
  assert.match(snippets, /2000/);
  assert.match(snippets, /anyFeedPanelOpen/);
  // 2026-10-20 用户要求「不要每次划视频都弹出标题和工具栏一下再消失」。
  // 改为：默认保持隐藏（chromeUnlocked=false），只有用户点一下屏幕后才显示。
  assert.match(snippets, /let chromeUnlocked = false/, '控件默认应为「未解锁」状态');
  assert.match(snippets, /if \(!chromeUnlocked && !anyFeedPanelOpen\(\)\)[\s\S]{0,120}?classList\.add\('feed-chrome-hidden'\)/,
    '未解锁时 revealFeedChrome 必须保持隐藏，不能显示控件');
  assert.match(snippets, /classList\.contains\('feed-chrome-hidden'\)\) \{[\s\S]{0,160}?chromeUnlocked = true;[\s\S]{0,120}?revealFeedChrome\(\);[\s\S]{0,60}?return;/,
    '首次点按应先解锁并显示控件，且不同时触发播放/暂停');
  const pointerDown = snippets.slice(snippets.indexOf("stage?.addEventListener('pointerdown'"), snippets.indexOf("stage?.addEventListener('pointermove'"));
  assert.doesNotMatch(pointerDown, /revealFeedChrome\(\)/);
  const horizontalSeek = snippets.slice(snippets.indexOf("if (swipeStart.axis === 'horizontal')"), snippets.indexOf("if (swipeStart.axis !== 'vertical')"));
  assert.doesNotMatch(horizontalSeek, /showFeedGestureStatus/);
  // 2026-10-10 起进度条按「剪辑后区间」显示：拖动要换算回原片时间再算样式。
  assert.match(horizontalSeek, /updateFeedProgressStyle\(progress, toDisplayTime\(target\), toDisplayDuration\(duration\)\)/);
  assert.match(css, /\.feed-chrome-hidden \.vault-feed-info/);
  assert.match(snippets, /updateFeedVideoBounds/);
  assert.match(snippets, /Math\.min\(viewportWidth \/ videoWidth, viewportHeight \/ videoHeight\)/);
  assert.match(snippets, /--vault-feed-video-bottom/);
  assert.match(snippets, /--vault-feed-video-bottom-edge/);
  assert.match(snippets, /--vault-feed-video-top-edge/);
  assert.match(snippets, /--vault-feed-video-width/);
  // 2026-10-20 用户反馈「刷视频时工具栏和标题挡住画面」。
  // 修复方式：把控件外移的门槛从 104px 降到 56px —— 104px 要求视频明显偏扁，
  // 竖屏视频永远达不到，导致控件始终压在画面上；56px 让横屏/宽银幕视频普遍生效。
  // 注意：这段只改「是否外移」的判定，绝不设置 video 的宽高，
  // 因此画面尺寸不会变化、不会突然变大。
  assert.match(snippets, /classList\.toggle\('feed-info-below', bottomInset >= 56\)/);
  // 视频尺寸只能通过 CSS 变量被读取和记录，不得被 JS 写入
  assert.doesNotMatch(snippets, /video\.style\.(width|height)\s*=/, '不得用 JS 改视频宽高，否则会导致画面突变');

  // 同批修复：自动隐藏延迟 2000ms → 1200ms，顶栏遮罩 .68 → .28
  assert.match(snippets, /\}, 1200\);/, '自动隐藏延迟应为 1.2 秒，让画面更快干净');
  assert.doesNotMatch(snippets, /\}, 2000\);/, '旧的 2 秒延迟应已移除');
  assert.match(css, /\.warm-video-player>header\.vault-feed-topbar\{[^}]*rgba\(3,7,5,\.28\)/, '顶栏遮罩应变轻，避免压着画面');
  assert.doesNotMatch(css, /\.warm-video-player>header\.vault-feed-topbar\{[^}]*rgba\(3,7,5,\.68\)/, '旧的浓重遮罩应已移除');

  assert.match(snippets, /updateFeedProgressStyle/);
  assert.match(css, /\.vault-feed-timeline>\.vault-feed-progress\{[^}]*border:0!important[^}]*background:transparent!important/);
  assert.match(css, /--vault-feed-progress/);
  assert.match(css, /white-space:nowrap[^}]*text-overflow:ellipsis/);
  assert.match(css, /\.feed-info-below \.vault-feed-info\{[^}]*top:calc\(var\(--vault-feed-video-bottom-edge\) \+ 14px\)[^}]*bottom:auto/);
  assert.match(css, /width:min\(var\(--vault-feed-video-width\),calc\(100% - 40px\)\)/);
  assert.match(css, /\.vault-feed-modal \.vault-feed-gesture-status\{[^}]*left:max\(14px,var\(--vault-feed-video-left,14px\)\)[^}]*top:max\([^}]*--vault-feed-video-top-edge[^}]*background:rgba\(9,18,14,\.34\)[^}]*opacity:\.68/);
});

test('horizontal fullscreen rotates Android and always restores portrait on exit', () => {
  assert.match(snippets, /Number\(player\.videoWidth\) > Number\(player\.videoHeight\)/);
  assert.match(snippets, /callHelper\('setTimerOrientation', 'landscape'\)/);
  assert.match(snippets, /callHelper\('restoreTimerOrientation'\)/);
  assert.match(snippets, /fullscreenchange/);
  assert.match(snippets, /webkitbeginfullscreen/);
  assert.match(snippets, /webkitendfullscreen/);
  assert.match(css, /#warm-video-element:fullscreen\{[^}]*width:100vw!important[^}]*height:100vh!important/);
  assert.match(snippets, /fullscreenTarget\.requestFullscreen/);
  assert.match(snippets, /Number\(player\.videoWidth\) > Number\(player\.videoHeight\)/);
  assert.match(snippets, /controlslist="nofullscreen noremoteplayback"/);
  assert.match(snippets, /warm-video-exit-fullscreen/);
  assert.match(snippets, /data-video-fullscreen-page/);
  assert.match(snippets, /warm-video-episode-panel/);
  assert.match(snippets, /data-video-episode-page/);
  assert.match(snippets, /options\.episodes/);
  assert.match(snippets, /scopeTitle/);
  assert.match(snippets, /document\.exitFullscreen/);
  assert.match(css, /video::-webkit-media-controls-fullscreen-button\{display:none!important/);
  assert.match(css, /warm-video-viewport:fullscreen \.warm-video-fullscreen-tools/);
  assert.match(css, /warm-video-viewport:fullscreen \.warm-video-episode-panel:not\(\[hidden\]\)/);
  assert.match(css, /grid-auto-rows:max-content/);
  assert.match(css, /@media\(orientation:landscape\)/);
  assert.match(css, /@media\(orientation:landscape\)\{\.vault-feed-bottom-tools\{display:none!important\}\}/);
  assert.match(snippets, /if \(folderPanel\) folderPanel\.hidden = true/);
  assert.match(snippets, /if \(historyPanel\) historyPanel\.hidden = true/);
  assert.doesNotMatch(snippets, /toolsDrawer/);
  assert.doesNotMatch(snippets, /toolsToggle/);
  assert.match(snippets, /closeEpisodesInLandscape\(\{ matches: true \}\)/);
});

test('video duration is captured, preserved and rendered over every cover', () => {
  assert.equal(formatVideoDuration(65), '1:05');
  assert.equal(formatVideoDuration(3661), '1:01:01');
  assert.equal(formatVideoDuration(0, '待读取'), '待读取');
  assert.match(photoUtils, /onMetadata/);
  assert.match(snippets, /video-duration-stamp/);
  assert.match(snippets, /metadata = value/);
  assert.match(calendar, /formatVideoDuration\(item\.video\.duration/);
  assert.match(css, /\.video-duration-stamp\{[^}]*position:absolute!important/);
  assert.match(css, /\.snippet-item-card>div:first-child>\.video-duration-stamp\{[^}]*top:auto!important[^}]*bottom:8px!important/);
});

test('video playback never crops or stretches the original frame', () => {
  const width = 160;
  const height = 90;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 52; x < 108; x += 1) {
    const offset = (y * width + x) * 4;
    pixels[offset] = 150; pixels[offset + 1] = 110; pixels[offset + 2] = 80; pixels[offset + 3] = 255;
  }
  const detected = detectPillarboxFromImageData({ data: pixels }, width, height);
  assert.equal(detected.displayOrientation, 'portrait');
  assert.ok(detected.contentLeft > .3 && detected.contentRight > .3);
  assert.ok(detected.contentAspect < 1.08);
  for (let y = 0; y < 10; y += 1) for (let x = 130; x < width; x += 1) {
    const offset = (y * width + x) * 4; pixels[offset] = 240; pixels[offset + 1] = 240; pixels[offset + 2] = 240;
  }
  const watermarked = detectPillarboxFromImageData({ data: pixels }, width, height);
  assert.equal(watermarked.displayOrientation, 'portrait');
  assert.deepEqual(selectPillarboxConsensus([{}, watermarked, detected]), { ...detected });
  assert.deepEqual(selectPillarboxConsensus([{}, detected]), {});
  const dark = new Uint8ClampedArray(width * height * 4).fill(8);
  assert.deepEqual(detectPillarboxFromImageData({ data: dark }, width, height), {});
  const fullFrame = new Uint8ClampedArray(width * height * 4).fill(120);
  assert.deepEqual(detectPillarboxFromImageData({ data: fullFrame }, width, height), {});
  assert.doesNotMatch(snippets, /applyVideoDisplayCrop|is-pillarboxed-portrait|analyzeVideoElementContent/);
  assert.doesNotMatch(css, /\.warm-video-viewport\.is-pillarboxed-portrait/);
  assert.match(css, /\.warm-video-canvas>video\{[^}]*object-fit:contain/);
});

test('private immersive feed exposes folder and scoped episode navigation', () => {
  assert.match(snippets, /vault-feed-modal/);
  assert.match(snippets, /上下滑动切换视频/);
  assert.match(snippets, /vault-feed-folders/);
  assert.match(snippets, /vault-feed-episodes/);
  assert.match(snippets, /img class="video-contain-cover"/);
  assert.match(snippets, /vault-feed-landscape/);
  assert.match(snippets, /closeEpisodesInLandscape/);
  assert.match(snippets, /episodePanel\.hidden = true/);
  assert.match(snippets, /!landscapeQuery\?\.matches/);
  assert.doesNotMatch(snippets, /vault-feed-tools-toggle/);
  assert.doesNotMatch(snippets, /vault-feed-tools-drawer/);
  assert.match(snippets, /id="vault-feed-delete"/);
  assert.match(snippets, /id="vault-feed-rate"/);
  assert.match(snippets, /onDeleteCurrent/);
  // 删除确认文案可配置：私密视频删的是 App 内副本，本机视频删的是系统相册原文件，
  // 两者的后果不同，不能共用一句文案（2026-10-09 本机相册对齐时改为可配）。
  assert.match(snippets, /options\.deleteConfirmText \|\| /);
  assert.match(snippets, /id="vault-feed-rate" aria-label="切换播放速度"/);
  const rail = snippets.slice(snippets.indexOf('function feedRailHtml'), snippets.indexOf('function feedInfoHtml'));
  assert.doesNotMatch(rail, /<small>/);
  assert.doesNotMatch(snippets, /setFeedToolsOpen/);
  assert.match(css, /\.modal\.vault-feed-modal\{/);
  assert.match(css, /\.modal\.vault-feed-modal\{[^}]*transform:none!important[^}]*transition:none!important/);
  assert.match(css, /\.vault-feed-bottom-tools\{/);
  assert.match(css, /\.vault-feed-bottom-tools button\{[^}]*width:40px/);
  assert.match(css, /\.vault-feed-bottom-tools \.vault-feed-delete-button/);
  assert.match(css, /@keyframes vaultFeedToolsReveal/);
  assert.match(css, /@media\(orientation:landscape\)\{\.vault-feed-modal #vault-feed-episodes/);
  assert.match(css, /warm-video-fullscreen-tools #warm-video-episodes/);
  assert.match(css, /\.vault-feed-folder-panel\{/);
  assert.match(snippets, /vault-feed-toggle-play/);
  assert.match(snippets, /vault-feed-progress/);
  // 沉浸式视频流默认**有声**（2026-10-20 用户要求取消私密空间默认静音）。
  // 用户仍可在播放器里点按钮静音，开关状态由 immersiveFeedSoundEnabled 记住并在翻页时保持。
  assert.match(snippets, /let immersiveFeedSoundEnabled = true/);
  assert.match(snippets, /options\.resetFeedAudio/);
  assert.match(snippets, /player\.muted = !immersiveFeedSoundEnabled/);
  // 声音按钮初始态必须与实际播放状态一致，不能写死成静音图标
  assert.match(snippets, /id="vault-feed-sound-icon">volume_up/);
  assert.match(snippets, /syncSoundButton\(\);\s*\n\s*if \(!player\.muted/, '初始化时应同步声音按钮，避免图标与实际状态错位');
  assert.match(snippets, /id="vault-feed-sound"/);
  assert.match(mainActivity, /setVolumeControlStream\(AudioManager\.STREAM_MUSIC\)/);
  assert.match(app, /registerHelper\('setVideoGestureExclusion'/);
  assert.match(snippets, /callHelper\('setVideoGestureExclusion', Boolean\(options\.immersiveFeed\)\)/);
  assert.match(snippets, /callHelper\('setVideoGestureExclusion', false\)/);
  assert.match(mainActivity, /setSystemGestureExclusionRects/);
  assert.match(mainActivity, /200f \* getResources\(\)\.getDisplayMetrics\(\)\.density/);
  assert.match(mainActivity, /removeOnLayoutChangeListener\(videoGestureLayoutListener\)/);
  assert.doesNotMatch(snippets, /type="range"[^>]*volume/);
  assert.match(snippets, /vault-feed-topbar/);
  assert.match(snippets, /feedInfoHtml\(title, description, sourceLabel/);
  assert.doesNotMatch(snippets, /descriptionBlock\.insertAdjacentHTML/);
  assert.match(snippets, /vault-feed-active-poster/);
  assert.match(snippets, /function showFeedHandoff/);
  assert.match(snippets, /document\.body\.append\(handoff\)/);
  assert.match(snippets, /showFeedHandoff\(episodeItems\[next\]\?\.poster \|\| ''\)/);
  assert.match(snippets, /player\.addEventListener\('playing'[\s\S]*requestAnimationFrame\(\(\) => requestAnimationFrame[\s\S]*activeFeedPoster\.hidden = true[\s\S]*clearFeedHandoff\(\)/);
  assert.match(css, /\.vault-feed-handoff\{[^}]*position:fixed[^}]*z-index:260[^}]*background:#050807/);
  assert.match(snippets, /player\.addEventListener\('playing'[\s\S]*activeFeedPoster\.hidden = true/);
  assert.doesNotMatch(snippets, /classList\.add.*feed-exit-/);
  assert.doesNotMatch(css, /@keyframes vaultFeedExitUp\{[^}]*opacity/);
  assert.match(snippets, /feedTransitionPreviewHtml/);
  assert.match(snippets, /options\.loopNavigation && totalVideos > 1/);
  assert.match(snippets, /\(next \+ totalVideos\) % totalVideos/);
  assert.match(snippets, /items\[\(activeIndex - 1 \+ items\.length\) % items\.length\]/);
  assert.match(snippets, /items\[\(activeIndex \+ 1\) % items\.length\]/);
  assert.match(snippets, /data-feed-preview/);
  assert.match(snippets, /velocity > \.55/);
  assert.match(snippets, /swipeStart\.axis = 'horizontal'/);
  assert.match(snippets, /swipeStart\.axis = 'vertical'/);
  assert.match(snippets, /const seekSpan = Math\.min\(120, Math\.max\(15, duration \* \.35\)\)/);
  assert.match(snippets, /player\.currentTime = target/);
  assert.match(snippets, /2× 快进中/);
  assert.match(snippets, /activeVideoController\?\.setRate\(2\)/);
  assert.match(snippets, /activeVideoController\?\.setRate\(longPressPreviousRate\)/);
  assert.match(snippets, /}, 420\)/);
  assert.match(snippets, /vault-feed-gesture-status/);
  assert.match(css, /\.vault-feed-gesture-status\{/);
  assert.match(snippets, /pointermove/);
  assert.match(snippets, /translate3d\(0,\$\{offset\}px,0\)/);
  assert.match(css, /\.vault-feed-transition-preview\{/);
  assert.match(css, /touch-action:none/);
  assert.match(css, /@keyframes vaultFeedHint/);
  assert.match(css, /object-fit:contain/);
  assert.match(css, /@keyframes vaultFeedEnterUp/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test('Calendar media strip and activity records open videos in the real player', () => {
  assert.match(calendar, /data-view-day-media/);
  assert.match(calendar, /callHelper\('playSnippetVideo', item\.video, entry, item\.index\)/);
  assert.match(app, /if \(snippet\?\.videos\?\.length\) return callHelper\('playSnippetVideo'/);
});

test('沉浸式视频流播完后循环重播当前视频，而不是停在最后一帧', () => {
  // 私密空间与随手拍的沉浸式视频流都用 autoAdvance:false（见 private-vault.js 的
  // playSnippetVideo 选项），原实现在播完后把图标无条件写成 play_arrow 并停住，
  // 用户 2026-10-08 要求改为循环播放当前视频。
  const block = snippets.match(/onEnded: \(\) => \{[\s\S]*?\n    \},/)?.[0] || '';
  assert.ok(block, '应能提取 playSnippetVideo 的 onEnded 处理块');
  assert.match(block, /player\.currentTime = 0/, '播完应把播放位置归零');
  assert.match(block, /player\.play\(\)/, '播完应重新开始播放（循环）');
  assert.match(block, /player\.paused \? 'play_arrow' : 'pause'/, '播放图标必须跟随真实播放状态');
  assert.doesNotMatch(block, /icon\.textContent = 'play_arrow'/, '不得再无条件把图标写成暂停态');
  // 有下一段可切时保留原有的自动续播行为
  assert.match(block, /options\.autoAdvance && index < totalVideos - 1/, '应保留自动续播分支');
  assert.match(block, /navigateVideo\(index \+ 1\)/, '自动续播应切到下一段');
  // 自动播放被系统拦截时不能让异常冒泡（移动端普遍限制自动播放）
  assert.match(block, /replay\?\.catch|\.catch\(/, '重新播放的 Promise 必须有兜底');
});

/* 时长剪辑的回放边界（2026-10-10 新增）
   剪辑过的视频最容易出错的是"进播放器时的定位"：不做任何处理的话，视频从 0 秒开始放，
   用户剪掉的开头会被原样放一遍 —— 在短片、或者剪得很短的片子上必然发生。
   原来的实现有一条"离片尾不足 2 秒就不定位"的保护，正好会把这种短片全部挡掉。 */
test('a trimmed video seeks into its range before playing instead of replaying the cut-away opening', () => {
  const restore = videoPlayer.slice(videoPlayer.indexOf('const restorePosition = ()'), videoPlayer.indexOf('const reportError'));
  assert.ok(restore, '应能提取播放器的 restorePosition');
  assert.match(restore, /if \(trimmed\) \{/, '有剪辑区间时要走专门的分支');
  assert.match(restore, /if \(trimmed\) \{[\s\S]*?video\.currentTime = next/, '有剪辑区间时必须先定位进区间');
  assert.doesNotMatch(restore, /Number\.isFinite\(video\.duration\) && next < video\.duration - 2/, '不能再让"离片尾不足 2 秒"的保护挡住定位');
  assert.match(videoPlayer, /const trimmed = trimEndRaw > trimStart \+ \.05/, '是否剪过由区间决定');
  assert.match(videoPlayer, /const boundPosition = \(\) => \{[\s\S]*?Math\.max\(next, trimStart\)/, '定位要先夹进区间');
});

/* 封面抓帧的时间点（2026-10-10 修）
   画图裁剪之后封面要重抓，第一版默认抓第 0 秒 —— 大量视频开头是黑场或淡入，
   结果用户一裁画面，导入时挑好的封面就被换成一张空白帧（真踩过）。
   现在两条路径共用同一套候选时间点，并且默认是"挑一张有内容的"。 */
test('cover capture never falls back to the very first frame', () => {
  const times = posterFrameTimes(30);
  assert.ok(times.length >= 3, '要有多个候选时间点');
  assert.equal(times[0], 0.12, '第一个候选点要稍微避开第 0 秒');
  assert.ok(times.some(value => value > 5), '要有明显靠后的候选点');
  assert.ok(times.every(value => value >= 0 && value <= 30), JSON.stringify(times));

  // 剪过时长的视频：只在"现在还会播的那一段"里取帧，不能取自已经剪掉的part
  const inside = posterFrameTimes(30, { start: 20, end: 30 });
  assert.ok(inside.every(value => value >= 19.9 && value <= 30), JSON.stringify(inside));
  assert.ok(inside.some(value => value > 26), '要在区间内靠后处也取一帧');

  // 超短视频不能算出负数或越过片尾
  const tiny = posterFrameTimes(1.6);
  assert.ok(tiny.every(value => value >= 0 && value <= 1.6), JSON.stringify(tiny));
});

test('re-capturing the cover after a crop keeps picking a frame with content', async () => {
  assert.match(photoUtils, /export async function captureVideoCropFrame\(fileOrSource, \{ time = null,/, '没指定时间点时不能默认第 0 秒');
  assert.match(photoUtils, /Number\.isFinite\(wanted\) && wanted > 0 \? \[wanted\] : posterFrameTimes\(duration, range\)/, '要沿用"挑有内容的帧"策略');
  assert.match(photoUtils, /if \(!isNearlyBlankFrame\(context, canvas\.width, canvas\.height\)\) \{ selected = result; break; \}/, '抓到第一张有内容的就停（既避免空白帧，也不白等后面几次定位）');
  assert.doesNotMatch(photoUtils, /Number\(time\) \|\| 0/, '不能再回退到第 0 秒');
  const vaultView = await readFile(new URL('../views/private-vault.js', import.meta.url), 'utf8');
  assert.match(vaultView, /captureVideoCropFrame\(source, \{[^}]*range: item\.trim \|\| null \}/, '重抓封面要限制在剪辑区间内');
});
