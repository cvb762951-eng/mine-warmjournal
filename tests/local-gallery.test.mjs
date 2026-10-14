import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const view = await readFile(new URL('../views/local-gallery.js', import.meta.url), 'utf8');
const native = await readFile(new URL('../android/app/src/main/java/com/mine/focus/LocalGalleryPlugin.java', import.meta.url), 'utf8');
const manifest = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const player = await readFile(new URL('../views/snippets.js', import.meta.url), 'utf8');
const videoSession = await readFile(new URL('../video-session.js', import.meta.url), 'utf8');
const mine = await readFile(new URL('../views/mine.js', import.meta.url), 'utf8');
const storage = await readFile(new URL('../storage.js', import.meta.url), 'utf8');

test('local gallery has a separate Mine entry and browses both media kinds by album', () => {
  assert.match(mine, /id="open-local-gallery"/);
  assert.match(view, /registerView\('local-gallery', galleryView\)/);
  assert.match(view, /\['all','全部'\],\['video','视频'\],\['photo','照片'\]/);
  assert.match(view, /Gallery\.listAlbums\(\{ kind \}\)/);
  assert.match(view, /Gallery\.listMedia\(\{ kind, albumId, offset: 0, limit: PAGE_SIZE \}\)/);
  assert.match(view, /Gallery\.listMedia\(\{ kind, albumId, offset, limit: PAGE_SIZE \}\)/);
  assert.match(view, /while \(more && token === requestId/);
  assert.match(view, /new IntersectionObserver\(entries =>/);
  assert.match(view, /await scanPromise/);
  assert.doesNotMatch(view, /id="gallery-more"|>加载更多<\/button>/);
});

test('gallery requests Android media access and reports partial access honestly', () => {
  for (const permission of ['READ_EXTERNAL_STORAGE', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_MEDIA_VISUAL_USER_SELECTED']) assert.match(manifest, new RegExp(permission));
  assert.match(native, /requestPermissionForAliases\(new String\[\] \{ "images", "videos", "selected" \}/);
  assert.match(native, /result\.put\("partial", selected && \(!images \|\| !videos\)\)/);
  assert.match(view, /目前仅能看到系统允许的部分照片或视频/);
});

test('本机相册复用沉浸式视频流，并与私密空间功能对齐', () => {
  assert.match(view, /galleryMode: true/);
  assert.match(view, /openVideoSession\(/);
  assert.match(view, /plainVideoCache/);
  assert.match(videoSession, /transientMedia: true/);
  assert.match(videoSession, /const next = items\?\.\[index \+ 1\]/);
  assert.match(view, /photoViewer\(photos\.map\(source\)/);
  assert.match(view, /const photos = items\.filter\(entry => entry\.kind === 'photo'\)/);
  assert.match(view, /const videos = items\.filter\(entry => entry\.kind === 'video'\)/);
  // 播放器本身仍不会因为 transientMedia 在每次进度回调里 save()；续播由会话在关闭时写入。
  assert.match(player, /activeVideoDirty && !activeVideoOptions\?\.transientMedia/);
  assert.match(view, /localGalleryProgress/);
  assert.match(view, /persistGalleryPlayback/);
  const persist = view.slice(view.indexOf('async function persistGalleryPlayback'), view.indexOf('async function deleteGalleryVideo'));
  assert.match(persist, /await save\(\)/);
  assert.doesNotMatch(view.slice(view.indexOf('function gallerySessionItem'), view.indexOf('async function persistGalleryPlayback')), /save\(/);
  // 2026-10-09 用户要求「全部功能对标」：删除 / 选集 / 观看记录三项已与私密空间一致。
  // 旧断言（galleryMode 时隐藏删除、禁用选集）已按新要求移除。
  assert.match(player, /id="vault-feed-delete"/);
  assert.match(player, /id="vault-feed-history"/);
  assert.match(view, /onDelete:/, '本机相册要提供删除回调');
  assert.match(view, /watchHistory: galleryWatchHistory\(item\)/, '本机相册要接上观看记录');
  assert.match(view, /state\.localGalleryWatchHistory = \[\.\.\.history/, '观看会话在关闭时并入历史');
  // 删除走系统相册原件（content://），由原生插件拉起系统删除授权页
  assert.match(view, /NativeMediaStore\.deleteOriginalMedia/);
  assert.match(view, /startsWith\('content:\/\/'\)/, '只接受 content:// 的相册原件');
  // 观看历史是新的 state 顶层字段，必须登记进 SECTIONS，否则真机不落库
  assert.match(storage, /'localGalleryWatchHistory'/, '观看历史必须进 SECTIONS 白名单');
  assert.match(storage, /'localGalleryProgress'/, '续播进度必须进 SECTIONS 白名单');
  assert.match(view, /if \(thumbnails\.size > 180\)/);
  // 读取插件本身仍不含删除能力（删除由 NativeMediaStorePlugin 负责）
  assert.doesNotMatch(native, /delete\(|createDeleteRequest|openOutputStream|FileOutputStream/);
});
