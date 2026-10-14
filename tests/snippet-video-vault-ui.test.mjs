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
  assert.match(snippets, /openMomentMediaBrowse\(entry,\s*0,\s*button\)/);
  assert.match(snippets, /\$\$\('\[data-snippet-video-album\]'\)\.forEach\(button => button\.onclick = \(\) => \{ const entry = state\.snippets\.find\(item => item\.id === button\.dataset\.snippetVideoAlbum\); openMomentMediaBrowse\(entry, 0, button\); \}\);/);
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
