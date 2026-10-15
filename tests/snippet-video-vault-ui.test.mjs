import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const snippets = fs.readFileSync(new URL('../views/snippets.js', import.meta.url), 'utf8');

test('openSnippetVideos 配置统一的沉浸式视频播放会话', () => {
  const start = snippets.indexOf('function openSnippetVideos(');
  const end = snippets.indexOf('function openSavedSnippetVideo(');
  assert.ok(start >= 0 && end > start, 'openSnippetVideos 函数定义存在');
  const openSnippetVideosBlock = snippets.slice(start, end);
  assert.match(openSnippetVideosBlock, /openVideoSession\(/);
  assert.match(openSnippetVideosBlock, /immersiveFeed:\s*true/);
  assert.match(openSnippetVideosBlock, /sourceCache:\s*plainVideoCache/);
  assert.match(openSnippetVideosBlock, /loopNavigation:\s*true/);
  assert.match(openSnippetVideosBlock, /autoAdvance:\s*false/);
  assert.match(openSnippetVideosBlock, /episodeTitle:\s*scopeLabel/);
});

test('snippetStreamCard 源码包含 data-snippet-video-album 封面按钮', () => {
  const start = snippets.indexOf('function snippetStreamCard(');
  const end = snippets.indexOf('function snippetCoverImage(');
  assert.ok(start >= 0 && end > start, 'snippetStreamCard 函数定义存在');
  const snippetStreamCardBlock = snippets.slice(start, end);
  assert.match(snippetStreamCardBlock, /data-snippet-video-album/);
});

test('事件绑定中调用 openMomentMediaBrowse 处理 data-snippet-video-album', () => {
  assert.match(snippets, /\$\$\('\[data-snippet-video-album\]'\)/);
  assert.match(snippets, /openMomentMediaBrowse\(entry,\s*focus,\s*button\)/);
  assert.match(snippets, /button\.hasAttribute\('data-video-index'\)/);
  assert.match(snippets, /kind: 'video'/);
});

test('snippetStreamCard 与 momentAlbumCard 渲染函数体中不包含 <video 标签', () => {
  const streamCardStart = snippets.indexOf('function snippetStreamCard(');
  const streamCardEnd = snippets.indexOf('function snippetCoverImage(');
  assert.ok(streamCardStart >= 0 && streamCardEnd > streamCardStart, 'snippetStreamCard 函数定义存在');
  const snippetStreamCardBlock = snippets.slice(streamCardStart, streamCardEnd);
  assert.doesNotMatch(snippetStreamCardBlock, /<video/i);

  const albumCardStart = snippets.indexOf('function momentAlbumCardHtml(');
  const albumCardEnd = snippets.indexOf('function momentAlbumStackHtml(');
  assert.ok(albumCardStart >= 0 && albumCardEnd > albumCardStart, 'momentAlbumCardHtml 函数定义存在');
  const momentAlbumCardBlock = snippets.slice(albumCardStart, albumCardEnd);
  assert.doesNotMatch(momentAlbumCardBlock, /<video/i);
});

test('flipMomentAlbum 翻牌阻尼与阈值 / 56 依然保留', () => {
  assert.match(snippets, /\/\s*56/);
});

test('随手拍播放器可以移除单段视频，文件夹按钮仍然隐藏', () => {
  const block = (src, a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
  const snippetOpen = block(snippets, 'function openSnippetVideos(', 'function openSavedSnippetVideo(');
  assert.match(snippetOpen, /showFolders:\s*false/);
  assert.match(snippetOpen, /onDelete:/);
  assert.match(snippetOpen, /deleteConfirmText:/);
  assert.match(snippetOpen, /snippetVideoDeletePrompt\(/);
  assert.doesNotMatch(snippetOpen, /永久删除/);
  assert.doesNotMatch(snippetOpen, /deleteMediaReference/);
  const prompt = block(snippets, 'export function snippetVideoDeletePrompt(', 'async function deleteSavedSnippetVideo(');
  assert.match(prompt, /从这条随手拍移除这段视频？/);
  assert.match(prompt, /整条删除/);
  assert.doesNotMatch(prompt, /永久删除/);
  const rail = block(snippets, 'function feedRailHtml(', 'function feedInfoHtml(');
  assert.match(rail, /options\.showFolders !== false \? '<button id="vault-feed-folders"/);
  assert.match(rail, /typeof options\.onDeleteCurrent === 'function' \? '<button id="vault-feed-delete"/);
  assert.doesNotMatch(rail, /!important/);
  const session = fs.readFileSync(new URL('../video-session.js', import.meta.url), 'utf8');
  assert.match(session, /showFolders: options\.showFolders !== false/);
  assert.match(session, /onDeleteCurrent: typeof options\.onDelete === 'function' \?/);
  const vault = block(fs.readFileSync(new URL('../views/private-vault.js', import.meta.url), 'utf8'), 'async function openVaultVideo(', '\n}\n');
  const gallery = block(fs.readFileSync(new URL('../views/local-gallery.js', import.meta.url), 'utf8'), 'function openGalleryVideo(', '\n}\n');
  for (const src of [vault, gallery]) { assert.match(src, /onDelete:/); assert.doesNotMatch(src, /showFolders:\s*false/); }
});
