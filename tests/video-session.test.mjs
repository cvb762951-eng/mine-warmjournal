import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { makeSnippet } from '../model.js';

const visibilityListeners = [];
const pagehideListeners = [];
globalThis.document = {
  documentElement: { classList: { toggle() {}, add() {}, remove() {} } },
  body: { classList: { add() {}, remove() {} } },
  addEventListener(type, fn) { if (type === 'visibilitychange') visibilityListeners.push(fn); },
  getElementById() { return null; },
  visibilityState: 'visible',
  querySelector() { return null; },
  querySelectorAll() { return []; }
};
globalThis.addEventListener = (type, fn) => { if (type === 'pagehide') pagehideListeners.push(fn); };

const { registerHelper } = await import('../core.js');
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
  assert.match(sessionSource, /onClose: async \(\{ handoff \} = \{\}\) => \{[\s\S]*?if \(handoff \|\| !needsFlush\) return/);
  assert.match(sessionSource, /await options\.flush\(\)/);
  assert.match(snippets, /stopActiveVideoPlayer\(\{ handoff: true \}\)/);
  assert.match(snippets, /remember: rememberSnippetVideo/);
  assert.match(snippets, /flush: flushSnippetPlayback/);
  const memory = snippets.slice(snippets.indexOf('function rememberSnippetVideo'), snippets.indexOf('async function flushSnippetPlayback'));
  assert.doesNotMatch(memory, /save\(/);
  assert.doesNotMatch(memory, /video\.video\s*=|patch\.video|patch\.source/);
  assert.match(snippets.slice(snippets.indexOf('async function flushSnippetPlayback'), snippets.indexOf('function openSnippetVideos')), /await save\(\)/);
  assert.match(sessionSource, /callHelper\('playSnippetVideo'/);
  assert.match(snippets, /attachVideoSource\(player, video\.video/);
  const hidden = sessionSource.slice(sessionSource.indexOf("visibilityState === 'hidden'"), sessionSource.indexOf('pagehide'));
  assert.match(hidden, /pausePlainPlayback\(\)/);
  assert.doesNotMatch(hidden, /closeModal/);
  const route = sessionSource.slice(sessionSource.indexOf('registerOnRender'), sessionSource.indexOf('function sourceLabelFor'));
  assert.match(route, /state\.route !== playback\.route/);
  assert.match(route, /closePlainPlayback\(\)/);
  assert.match(sessionSource, /if \(!playback \|\| playback\.private\) return/);
  assert.match(snippets, /sourceCache: plainVideoCache/);
  assert.match(snippets, /openPendingSnippetVideo\(/);
  assert.match(vault, /sourceCache: privateVideoCache/);
  assert.match(sessionSource, /cache === privateVideoCache\) \{[\s\S]*?cache\.retain\(keep\)/);
  assert.doesNotMatch(sessionSource, /vault-photo-image|photo-viewer-image/);
  assert.match(common, /id="photo-viewer-image"/);
  assert.match(vault, /id="vault-photo-image"/);
});

test('swipes remember playback in memory and flush once when the modal closes', async () => {
  const plays = [];
  registerHelper('playSnippetVideo', (_video, _entry, _index, options) => { plays.push(options); });
  const remembered = [];
  let flushes = 0;
  const cache = createVideoSourceCache();
  await openVideoSession({
    items: ['a', 'b'].map(id => ({ id, resolveSource: async () => `mine-media://${id}`, watchHistory: [] })),
    startIndex: 0,
    sourceCache: cache,
    remember: (item, patch) => remembered.push({ id: item.id, position: patch.position, history: patch.watchHistory.length }),
    flush: async () => { flushes += 1; }
  });
  const first = plays.at(-1);
  first.onProgress({ position: 12, duration: 40 });
  first.onWatchSession({ id: 's1', watchedSeconds: 4 });
  await first.onClose({ handoff: true });
  assert.equal(flushes, 0);
  assert.deepEqual(remembered, [{ id: 'a', position: 12, history: 1 }]);
  await first.onNavigate(1, 'up');
  const second = plays.at(-1);
  second.onProgress({ position: 4, duration: 20 });
  await second.onClose({ handoff: false });
  assert.equal(flushes, 1);
  assert.deepEqual(remembered.map(entry => entry.id), ['a', 'b']);
  await second.onClose({ handoff: false });
  assert.equal(flushes, 1);
});

test('hiding the page pauses a plain video and leaves the modal open', async () => {
  const paused = [];
  document.getElementById = id => id === 'warm-video-element' ? { pause() { paused.push(id); } } : id === 'warm-video-player' ? { id } : null;
  registerHelper('playSnippetVideo', () => {});
  const cache = createVideoSourceCache();
  await openVideoSession({
    items: [{ id: 'plain', resolveSource: async () => 'mine-media://plain' }],
    startIndex: 0,
    sourceCache: cache
  });
  document.visibilityState = 'hidden';
  for (const fn of visibilityListeners) fn();
  for (const fn of pagehideListeners) fn();
  assert.deepEqual(paused, ['warm-video-element', 'warm-video-element']);
  document.visibilityState = 'visible';

  paused.length = 0;
  await openVideoSession({
    items: [{ id: 'secret', resolveSource: async () => 'blob:http://unit/secret' }],
    startIndex: 0,
    sourceCache: privateVideoCache
  });
  document.visibilityState = 'hidden';
  for (const fn of visibilityListeners) fn();
  assert.deepEqual(paused, []);
  document.visibilityState = 'visible';
  privateVideoCache.release();
});

test('the private cache keeps only the current video and the next one', async () => {
  const tracker = trackRevokes();
  try {
    const cache = createVideoSourceCache();
    await cache.resolve({ id: '0', resolveSource: async () => 'blob:http://unit/0' });
    await cache.resolve({ id: '1', resolveSource: async () => 'blob:http://unit/1' });
    let releaseLate;
    const lateGate = new Promise(resolve => { releaseLate = resolve; });
    const late = cache.resolve({ id: '2', resolveSource: () => lateGate.then(() => 'blob:http://unit/2') });
    cache.retain(['0', '1']);
    releaseLate();
    await assert.rejects(late, error => error?.code === 'video-cache-released');
    assert.equal(cache.has('0'), true);
    assert.equal(cache.has('1'), true);
    assert.equal(cache.has('2'), false);
    assert.deepEqual(tracker.revoked, ['blob:http://unit/2']);

    registerHelper('playSnippetVideo', () => {});
    await privateVideoCache.resolve({ id: 'kept', resolveSource: async () => 'blob:http://unit/kept' });
    await privateVideoCache.resolve({ id: 'next', resolveSource: async () => 'blob:http://unit/next' });
    await privateVideoCache.resolve({ id: 'old', resolveSource: async () => 'blob:http://unit/old' });
    await openVideoSession({
      items: ['kept', 'next', 'old'].map(id => ({ id, resolveSource: async () => privateVideoCache.get(id) || `blob:http://unit/${id}` })),
      startIndex: 0,
      sourceCache: privateVideoCache
    });
    assert.equal(privateVideoCache.has('kept'), true);
    assert.equal(privateVideoCache.has('next'), true);
    assert.equal(privateVideoCache.has('old'), false);
    assert.ok(tracker.revoked.includes('blob:http://unit/old'));
    assert.ok(!tracker.revoked.includes('blob:http://unit/kept'));
  } finally {
    privateVideoCache.release();
    tracker.restore();
  }
});
