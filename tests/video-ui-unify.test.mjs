import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const common = await read('views/common.js');
const snippets = await read('views/snippets.js');
const motion = await read('motion.js');
const motionVault = await read('motion-vault.js');
const css = await read('styles.css');
const unifyCss = css.slice(css.indexOf('统一视频：大图里的普通视频'));

test('大图里的普通视频不再内嵌 <video controls>，改走公共播放会话', () => {
  assert.doesNotMatch(common, /<video id="photo-viewer-image"[^>]*\scontrols/);
  assert.match(common, /import \{ openVideoSession \} from '\.\.\/video-session\.js'/);
  assert.match(common, /export function openPhotoViewerVideo[\s\S]*?openVideoSession\(\{[\s\S]*?sourceCache: viewerVideoCache/);
  assert.doesNotMatch(common, /sourceCache: plainVideoCache/);
  assert.doesNotMatch(common, /viewer-video-\$\{/);
  assert.match(common, /photo-viewer-play-btn/);
  // 页面自己的会话优先（随手拍相册要写回续播进度）
  assert.match(common, /typeof options\.onOpenVideo === 'function'\) return options\.onOpenVideo\(active, current\)/);
  assert.match(snippets, /onOpenVideo: index => \{[\s\S]*?openSavedSnippetVideo\(entry, videoIndex\)/);
  // 只读打开时把续播位置、裁剪带给播放器，但大图层不提供 remember/persist，不写数据
  const fn = common.slice(common.indexOf('export function openPhotoViewerVideo'), common.indexOf('export function photoViewer('));
  assert.doesNotMatch(fn, /remember|persist|flush|save\(/);
  assert.match(common, /position: item\.position \|\| 0/);
});

test('实况照片在大图里静音循环、无原生控件，点「实况」进公共播放器', () => {
  assert.match(common, /<video id="photo-viewer-image" class="is-live-photo"[^>]*autoplay loop muted playsinline/);
  assert.match(common, /\$\('\.photo-viewer-live-badge'\)\?\.addEventListener\('click'[\s\S]*?openPhotoViewerVideo\(photos, active, meta, options\)/);
  assert.doesNotMatch(common, /控件里可以开声音/);
});

test('视频封面和实况都只等比缩放，不拉伸', () => {
  assert.match(unifyCss, /\.photo-viewer-video-container>img\{[^}]*object-fit:contain/);
  assert.match(unifyCss, /video\.is-live-photo\{[^}]*object-fit:contain/);
  assert.doesNotMatch(unifyCss, /object-fit:\s*(fill|cover)/);
});

test('进入播放器的动效和私密空间一致：不做白块变形，只淡入顶栏', () => {
  assert.match(motion, /if \(panel\.classList\?\.contains\('snippet-video-modal'\) \|\|[^\n]*\) return null;/);
  assert.match(motionVault, /'\.modal\.vault-photo-modal, \.modal\.vault-feed-modal, \.modal\.snippet-video-modal'/);
  // 顶栏淡入仍受档位控制：none 不动，lite 缩短
  assert.match(motionVault, /if \(!plain\(\) \|\| tier\(\) === 'none'\) return;/);
  assert.match(motionVault, /seenChrome\.has\(modal\)/);
});

test('全屏键统一成私密空间视频流样式，不加模糊', () => {
  assert.match(snippets, /id="warm-video-exit-fullscreen" class="warm-fullscreen-btn"/);
  assert.match(snippets, /id="warm-video-fullscreen" class="warm-fullscreen-btn"/);
  assert.match(snippets, /id="vault-feed-landscape" class="warm-fullscreen-btn"/);
  assert.match(unifyCss, /button\.warm-fullscreen-btn[^{]*\{[^}]*border-radius:8px/);
  assert.doesNotMatch(unifyCss, /backdrop-filter|blur\(/);
});

test('新代码没有新增 MutationObserver', () => {
  const added = [common, snippets].join('\n');
  const before = (added.match(/new MutationObserver/g) || []).length;
  assert.equal(before, 0, `common/snippets 里的 MutationObserver 数量异常：${before}`);
});

// 从源码里取出 viewerVideoId / viewerVideoCache 单独执行（common.js 依赖 DOM，不能直接 import）。
function loadViewerHelpers() {
  const start = common.indexOf('export function viewerVideoId');
  const end = common.indexOf('function viewerSessionItem');
  const code = common.slice(start, end).replace(/export /g, '');
  return new Function(`${code}; return { viewerVideoId, viewerVideoCache };`)();
}

test('没有 id 的两条视频地址不同，就不会共用缓存条目，也不会越积越多', async () => {
  const { viewerVideoId, viewerVideoCache } = loadViewerHelpers();
  const diaryA = { poster: 'a.jpg', video: 'file:///diary-a/1.mp4' };
  const diaryB = { poster: 'b.jpg', video: 'file:///diary-b/1.mp4' };
  assert.notEqual(viewerVideoId(diaryA), viewerVideoId(diaryB));
  assert.equal(viewerVideoId({ ...diaryA }), viewerVideoId(diaryA));
  const a = await viewerVideoCache.resolve({ id: viewerVideoId(diaryA), resolveSource: () => diaryA.video });
  const b = await viewerVideoCache.resolve({ id: viewerVideoId(diaryB), resolveSource: () => diaryB.video });
  assert.equal(a, diaryA.video);
  assert.equal(b, diaryB.video);
  assert.equal(viewerVideoCache.has(viewerVideoId(diaryA)), false, '大图视频不留缓存');
  // 就算同一个位置号，也拿到各自的地址（以前都是 viewer-video-0，B 会播出 A）
  const again = await viewerVideoCache.resolve({ id: viewerVideoId(diaryB), resolveSource: () => diaryB.video });
  assert.equal(again, diaryB.video);
});

test('大图视频缓存不 revoke 页面自己的 blob 地址', () => {
  const { viewerVideoCache } = loadViewerHelpers();
  const original = globalThis.URL.revokeObjectURL;
  let revoked = 0;
  globalThis.URL.revokeObjectURL = () => { revoked += 1; };
  try {
    viewerVideoCache.drop('viewer:blob:x');
    viewerVideoCache.retain([]);
    viewerVideoCache.release();
  } finally { globalThis.URL.revokeObjectURL = original; }
  assert.equal(revoked, 0);
});
