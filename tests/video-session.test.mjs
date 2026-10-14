import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { makeSnippet } from '../model.js';

globalThis.document = {
  documentElement: { classList: { toggle() {} } },
  addEventListener() {},
  getElementById() { return null; },
  visibilityState: 'visible',
  querySelector() { return null; },
  querySelectorAll() { return []; }
};

const { createVideoSourceCache, openVideoSession, plainVideoCache, preloadNextVideo, privateVideoCache } = await import('../video-session.js');

const sessionSource = await readFile(new URL('../video-session.js', import.meta.url), 'utf8');
const snippets = await readFile(new URL('../views/snippets.js', import.meta.url), 'utf8');
const vault = await readFile(new URL('../views/private-vault.js', import.meta.url), 'utf8');
const common = await readFile(new URL('../views/common.js', import.meta.url), 'utf8');

function trackRevokes() {
  const revoked = [];
  const original = URL.revokeObjectURL;
  URL.revokeObjectURL = url => { revoked.push(String(url)); };
  return {
    revoked,
    restore() { URL.revokeObjectURL = original; }
  };
}

test('a source cache decrypts each id once and keeps private bytes out of the plain cache', async () => {
  assert.notEqual(privateVideoCache, plainVideoCache);
  const cache = createVideoSourceCache();
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const item = { id: 'clip', resolveSource: () => { calls += 1; return gate.then(() => 'blob:http://unit/clip'); } };
  const first = cache.resolve(item);
  const second = cache.resolve(item);
  assert.equal(calls, 1);
  release();
  assert.equal(await first, 'blob:http://unit/clip');
  assert.equal(await second, 'blob:http://unit/clip');
  assert.equal(calls, 1);
  assert.equal(cache.has('clip'), true);

  const tracker = trackRevokes();
  try {
    await privateVideoCache.resolve({ id: 'same', resolveSource: async () => 'blob:http://unit/private' });
    assert.equal(plainVideoCache.has('same'), false);
    assert.equal(privateVideoCache.get('same'), 'blob:http://unit/private');
  } finally {
    privateVideoCache.release();
    tracker.restore();
  }
});

test('release and drop revoke every blob url and ignore ordinary addresses', async () => {
  const tracker = trackRevokes();
  try {
    const cache = createVideoSourceCache();
    await cache.resolve({ id: 'blob', resolveSource: async () => 'blob:http://unit/a' });
    await cache.resolve({ id: 'hls', resolveSource: async () => 'https://media.example.test/a.m3u8' });
    cache.drop('blob');
    assert.deepEqual(tracker.revoked, ['blob:http://unit/a']);
    assert.equal(cache.has('blob'), false);
    assert.equal(cache.has('hls'), true);
    cache.release();
    assert.deepEqual(tracker.revoked, ['blob:http://unit/a']);
    assert.equal(cache.has('hls'), false);

    let go;
    const gate = new Promise(resolve => { go = resolve; });
    const pending = cache.resolve({ id: 'late', resolveSource: () => gate.then(() => 'blob:http://unit/late') });
    cache.release();
    go();
    await assert.rejects(pending, error => error?.code === 'video-cache-released');
    assert.equal(tracker.revoked.at(-1), 'blob:http://unit/late');
    assert.equal(cache.has('late'), false);
  } finally {
    tracker.restore();
  }
});

test('openVideoSession resolves the current item and preloads only the next one', async () => {
  const cache = createVideoSourceCache();
  const calls = [];
  const items = [0, 1, 2].map(id => ({
    id: String(id),
    resolveSource: async () => { calls.push(id); return `mine-media://v${id}`; },
    watchHistory: undefined
  }));
  let persisted = 0;
  await openVideoSession({
    items,
    startIndex: 1,
    scopeLabel: '测试',
    sourceCache: cache,
    persist: () => { persisted += 1; }
  });
  assert.deepEqual(calls, [1, 2]);
  assert.equal(persisted, 0);
  assert.equal(cache.has('0'), false);
  assert.equal(preloadNextVideo(cache, items, 2), null);

  const vaultCalls = [];
  const privateCache = createVideoSourceCache();
  await openVideoSession({
    items: items.map(item => ({ ...item, id: `p${item.id}`, resolveSource: async () => { vaultCalls.push(item.id); return `blob:http://unit/p${item.id}`; } })),
    startIndex: 0,
    scopeLabel: '私密',
    sourceCache: privateCache
  });
  assert.deepEqual(vaultCalls, ['0', '1']);
  assert.equal(cache.has('p0'), false);
  const tracker = trackRevokes();
  try {
    privateCache.release();
    assert.deepEqual(tracker.revoked, ['blob:http://unit/p0', 'blob:http://unit/p1']);
  } finally {
    tracker.restore();
  }
});

test('snippet videos keep watch history and still play when the field is missing', () => {
  const legacy = makeSnippet({ type: 'photo', videos: [{ video: 'mine-media://clip.mp4' }] });
  assert.deepEqual(legacy.videos[0], { poster: '', video: 'mine-media://clip.mp4' });
  assert.deepEqual(legacy.videos[0].watchHistory || [], []);
  const entry = makeSnippet({
    type: 'photo',
    videos: [{
      video: 'mine-media://clip.mp4',
      watchHistory: [
        { id: 'glance', startedAt: 1, endedAt: 2, watchedSeconds: 1, startPosition: 0, endPosition: 1, completion: 0.1 },
        { id: 'kept', startedAt: 10, endedAt: 20, watchedSeconds: 8, startPosition: 1, endPosition: 9, completion: 1.4 }
      ]
    }]
  });
  assert.equal(entry.videos[0].watchHistory.length, 1);
  assert.equal(entry.videos[0].watchHistory[0].id, 'kept');
  assert.equal(entry.videos[0].watchHistory[0].completion, 1);
  assert.equal(entry.videos[0].video, 'mine-media://clip.mp4');
});

test('playback progress is persisted on close, and private sources stay on the private path', () => {
  const progress = sessionSource.slice(sessionSource.indexOf('onProgress:'), sessionSource.indexOf('onEnded:'));
  assert.doesNotMatch(progress, /persist\(|save\(/);
  assert.match(sessionSource, /onClose: async \(\) => \{[\s\S]*?await options\.persist\(liveItem, patch\)/);
  assert.match(sessionSource, /callHelper\('playSnippetVideo'/);
  assert.match(snippets, /attachVideoSource\(player, video\.video/);
  assert.match(sessionSource, /document\.visibilityState === 'hidden'/);
  assert.match(sessionSource, /state\.route !== playback\.route/);
  assert.match(sessionSource, /if \(!playback \|\| playback\.private\) return/);
  assert.match(snippets, /sourceCache: plainVideoCache/);
  assert.match(snippets, /openPendingSnippetVideo\(/);
  assert.match(vault, /sourceCache: privateVideoCache/);
  assert.doesNotMatch(sessionSource, /vault-photo-image|photo-viewer-image/);
  assert.match(common, /id="photo-viewer-image"/);
  assert.match(vault, /id="vault-photo-image"/);
  const persist = snippets.slice(snippets.indexOf('function persistSnippetVideo'), snippets.indexOf('function openSnippetVideos'));
  assert.doesNotMatch(persist, /video\.video\s*=|patch\.video|patch\.source/);
});
