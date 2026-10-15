import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    documentElement: { classList: { toggle() {} }, dataset: {} },
    body: { classList: { add() {}, remove() {}, contains() { return false; } }, appendChild() {} },
    hidden: false,
    visibilityState: 'visible',
    activeElement: null,
    addEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: tag => {
      const classList = new Set();
      const dataset = {};
      const style = { setProperty(name, value) { style[name] = value; } };
      return {
        tagName: String(tag || 'div').toUpperCase(),
        dataset,
        style,
        classList: {
          add: name => classList.add(name),
          remove: name => classList.delete(name),
          contains: name => classList.has(name),
          toggle() {}
        },
        innerHTML: '',
        appendChild() {},
        setAttribute() {},
        addEventListener() {}
      };
    }
  };
}

const {
  momentSpreadHtml,
  momentAlbumFocusIndex,
  normalizeSnippetTags,
  snippetAfterVideoRemoval,
  snippetVideoDeletePrompt
} = await import('../views/snippets.js');

const snippets = await readFile(new URL('../views/snippets.js', import.meta.url), 'utf8');
const plainLight = await readFile(new URL('../themes-plain-light.css', import.meta.url), 'utf8');

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

test('多段视频或图加视频：点时间线视频卡先翻牌，封面只用图片', () => {
  const html = momentSpreadHtml([], {
    videos: [
      { poster: 'cover-a.jpg', video: 'a.mp4', duration: 3 },
      { poster: 'cover-b.jpg', video: 'b.mp4', duration: 4 }
    ],
    interactive: { mode: 'saved', entryId: 'multi' }
  });
  assert.match(html, /data-snippet-video-album="multi"[^>]*data-video-index="0"/);
  assert.match(html, /data-snippet-video-album="multi"[^>]*data-video-index="1"/);
  assert.doesNotMatch(html, /data-play-snippet-video/);
  assert.match(html, /src="cover-a\.jpg"/);
  assert.match(html, /src="cover-b\.jpg"/);
  assert.doesNotMatch(html, /src="[^"]*\.mp4/);
  assert.doesNotMatch(html, /<video/i);

  const mixed = momentSpreadHtml(['shot.jpg'], {
    videos: [{ poster: 'cover.jpg', video: 'clip.mp4', duration: 5 }],
    interactive: { mode: 'saved', entryId: 'mix' }
  });
  assert.match(mixed, /data-view-snippet-photo="mix"/);
  assert.match(mixed, /data-snippet-video-album="mix"/);
  assert.match(mixed, /data-video-index="0"/);
  assert.doesNotMatch(mixed, /data-play-snippet-video/);
  assert.doesNotMatch(mixed, /src="[^"]*clip\.mp4/);

  const badPoster = momentSpreadHtml([], {
    videos: [
      { poster: 'clip.mp4', video: 'clip.mp4', duration: 2 },
      { poster: 'ok.jpg', video: 'other.mp4', duration: 2 }
    ],
    interactive: { mode: 'saved', entryId: 'bad' }
  });
  assert.doesNotMatch(badPoster, /src="[^"]*clip\.mp4/);
  assert.doesNotMatch(badPoster, /src="[^"]*other\.mp4/);
  assert.match(badPoster, /moment-spread-empty/);
  assert.match(badPoster, /src="ok\.jpg"/);
  assert.match(badPoster, /data-snippet-video-album="bad"/);
});

test('只有一段视频时仍直接打开播放器；导入扇面不受影响', () => {
  const one = momentSpreadHtml([], {
    videos: [{ poster: 'only-cover.jpg', video: 'only.mp4', duration: 2 }],
    interactive: { mode: 'saved', entryId: 'one' }
  });
  assert.match(one, /data-play-snippet-video="one"/);
  assert.match(one, /data-video-index="0"/);
  assert.doesNotMatch(one, /data-snippet-video-album/);
  assert.doesNotMatch(one, /src="[^"]*only\.mp4/);
  assert.match(one, /src="only-cover\.jpg"/);

  const pending = momentSpreadHtml([], {
    videos: [
      { poster: 'p.jpg', video: 'p.mp4' },
      { poster: 'q.jpg', video: 'q.mp4' }
    ],
    interactive: { mode: 'pending' }
  });
  assert.match(pending, /data-fan-scope="pending"/);
  assert.match(pending, /data-play-pending-snippet-video="0"/);
  assert.match(pending, /data-play-pending-snippet-video="1"/);
  assert.doesNotMatch(pending, /data-snippet-video-album/);
  assert.doesNotMatch(pending, /data-play-snippet-video/);
});

test('翻牌从点开的那段视频开始，牌面点视频进播放器、点照片进大图', () => {
  const items = [
    { kind: 'photo', index: 0 },
    { kind: 'video', index: 0 },
    { kind: 'video', index: 1 }
  ];
  assert.equal(momentAlbumFocusIndex(items, { kind: 'video', index: 1 }), 2);
  assert.equal(momentAlbumFocusIndex(items, 0), 0);
  assert.equal(momentAlbumFocusIndex(items, { kind: 'video', index: 9 }), 0);

  const current = between(snippets, 'function openMomentAlbumCurrent()', 'function renderMomentAlbumStack(');
  assert.match(current, /openSavedSnippetVideo\(entry, item\.index\)/);
  assert.match(current, /photoLightbox\(entry, item\.index\)/);

  const card = between(snippets, 'function momentAlbumCardHtml(', 'function momentAlbumStackHtml(');
  assert.match(card, /momentCoverFace\(/);
  assert.doesNotMatch(card, /<video/i);
  assert.match(snippets, /id="moment-album-remove"/);
});

test('移除单段视频只改 entry.videos，空记录整条删除，不直接删文件', () => {
  const kept = snippetAfterVideoRemoval({
    id: 'e1',
    type: 'photo',
    date: '2026-10-15',
    text: '两段',
    photos: [],
    videos: [
      { video: 'mine-media://a.mp4', poster: 'mine-media://a.jpg', duration: 3 },
      { video: 'mine-media://b.mp4', poster: 'mine-media://b.jpg', duration: 4 }
    ],
    createdAt: 10
  }, 0);
  assert.equal(kept.dropped, false);
  assert.equal(kept.entry.id, 'e1');
  assert.equal(kept.entry.videos.length, 1);
  assert.equal(kept.entry.videos[0].video, 'mine-media://b.mp4');

  const mixed = snippetAfterVideoRemoval({
    id: 'e2',
    type: 'photo',
    date: '2026-10-15',
    photos: ['mine-media://shot.jpg'],
    videos: [{ video: 'mine-media://c.mp4', poster: 'mine-media://c.jpg' }],
    createdAt: 11
  }, 0);
  assert.equal(mixed.dropped, false);
  assert.deepEqual(mixed.entry.photos, ['mine-media://shot.jpg']);
  assert.equal(mixed.entry.videos.length, 0);

  const last = snippetAfterVideoRemoval({
    id: 'e3',
    type: 'photo',
    date: '2026-10-15',
    photos: [],
    videos: [{ video: 'mine-media://only.mp4', poster: 'mine-media://only.jpg' }],
    createdAt: 12
  }, 0);
  assert.equal(last.dropped, true);
  assert.equal(last.entry, null);
  assert.match(snippetVideoDeletePrompt({ id: 'e1', type: 'photo', date: '2026-10-15', photos: [], videos: [{ video: 'a.mp4' }, { video: 'b.mp4' }], createdAt: 1 }, 0), /从这条随手拍移除这段视频？/);
  assert.match(snippetVideoDeletePrompt({ id: 'e3', type: 'photo', date: '2026-10-15', photos: [], videos: [{ video: 'only.mp4' }], createdAt: 1 }, 0), /整条删除/);
  assert.doesNotMatch(snippetVideoDeletePrompt({ id: 'e1', type: 'photo', date: '2026-10-15', photos: [], videos: [{ video: 'a.mp4' }, { video: 'b.mp4' }], createdAt: 1 }, 0), /永久删除/);

  const removal = between(snippets, 'async function deleteSavedSnippetVideo(', 'function openSnippetVideos(');
  assert.doesNotMatch(removal, /deleteMediaReference/);
  assert.doesNotMatch(removal, /永久删除/);
  assert.match(removal, /makeSnippet|snippetAfterVideoRemoval/);
  const closeAt = removal.indexOf('closeVideoPlayer');
  const saveAt = removal.indexOf('await save()');
  const renderAt = removal.indexOf('render()');
  assert.ok(closeAt >= 0 && saveAt > closeAt && renderAt > saveAt, '先关播放器，再保存，再刷新');
  assert.ok(removal.indexOf('state.snippets') < closeAt, '先从记录里拿掉这段，再关播放器');
});

test('编辑随手拍可以手动加减标签，去掉井号、去重、限 8 个和 24 字，不删快捷标签', () => {
  assert.deepEqual(normalizeSnippetTags([' #旅行 ', '旅行', '###美食', '', '#']), ['旅行', '美食']);
  assert.equal(normalizeSnippetTags(['a'.repeat(40)])[0].length, 24);
  assert.equal(normalizeSnippetTags(Array.from({ length: 12 }, (_, index) => `tag${index}`)).length, 8);
  assert.deepEqual(normalizeSnippetTags(['夏', '夏', ' 秋 ']), ['夏', '秋']);

  const editor = between(snippets, 'function bindSnippetTagEditor(', 'function bindSnippetStructureActions(');
  assert.match(editor, /pendingSnippetStructure\.tags/);
  assert.match(editor, /normalizeSnippetTags/);
  assert.doesNotMatch(editor, /removeQuickTag/);
  assert.match(snippets, /snippetTagEditorHtml\(\)/);
  assert.match(snippets, /id="snippet-tag-editor"/);

  const cssStart = plainLight.indexOf('/* snippet-tag-editor start */');
  const cssEnd = plainLight.indexOf('/* snippet-tag-editor end */');
  assert.ok(cssStart >= 0 && cssEnd > cssStart);
  const css = plainLight.slice(cssStart, cssEnd);
  assert.match(css, /:root\[data-theme="plain"\] \.snippet-tag-chip/);
  assert.match(css, /:root\[data-theme="plain"\] \.moment-album-remove/);
  assert.doesNotMatch(css, /:has\(|:is\(|:where\(/);
  assert.doesNotMatch(css, /var\(--[a-z0-9-]+,\s*#/i);
});
