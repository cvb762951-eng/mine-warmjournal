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

const { state, registerHelper } = await import('../core.js');
const {
  momentSpreadHtml,
  momentAlbumFocusIndex,
  normalizeSnippetTags,
  snippetAfterVideoRemoval,
  snippetVideoDeletePrompt,
  deleteSavedSnippetVideo,
  syncArchivedSnippetTags,
  _setSnippetPersistForTest,
  _resetSnippetEntryTagsForTest,
  commitSnippetEntryTag,
  dropSnippetEntryTag
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
  const saveAt = removal.indexOf('snippetPersistForTest || save');
  const renderAt = removal.indexOf('render()');
  assert.ok(closeAt >= 0 && saveAt > closeAt && renderAt > saveAt, '先关播放器，再保存，再刷新');
  assert.ok(removal.indexOf('state.snippets') < closeAt, '先从记录里拿掉这段，再关播放器');
});

test('编辑随手拍和拍摄共用快捷标签池与芯片，加上记一次，拿掉只改这条', () => {
  assert.deepEqual(normalizeSnippetTags([' #旅行 ', '旅行', '###美食', '', '#']), ['旅行', '美食']);
  assert.equal(normalizeSnippetTags(['a'.repeat(40)])[0].length, 24);
  assert.equal(normalizeSnippetTags(Array.from({ length: 12 }, (_, index) => `tag${index}`)).length, 8);
  assert.deepEqual(normalizeSnippetTags(['夏', '夏', ' 秋 ']), ['夏', '秋']);

  const editor = between(snippets, 'function bindSnippetTagEditor(', 'function bindSnippetStructureActions(');
  assert.match(editor, /mountQuickTagRow/);
  assert.match(editor, /snippetQuickTagChoices/);
  assert.match(editor, /pendingSnippetStructure\.tags/);
  assert.match(editor, /normalizeSnippetTags/);
  const toggle = editor.slice(editor.indexOf('onToggle(tag)'), editor.indexOf('onHide(tag)'));
  assert.match(toggle, /dropSnippetEntryTag/);
  assert.match(toggle, /commitSnippetEntryTag/);
  assert.doesNotMatch(toggle, /removeQuickTag/);
  const hide = editor.slice(editor.indexOf('onHide(tag)'), editor.indexOf('onCreate(norm)'));
  assert.match(hide, /removeQuickTag/);
  assert.doesNotMatch(hide, /dropSnippetEntryTag/);
  assert.match(editor, /addQuickTag/);

  const row = between(snippets, 'function mountQuickTagRow(', 'function bindSnippetTagEditor(');
  assert.match(row, /class="quick-paper-tag/);
  assert.match(row, /data-quick-tag-add>＋ 自定义/);
  assert.match(row, /quick-tag-confirm-bar/);
  const capture = between(snippets, 'function quickPhotoModal(', 'function quickPhotoPreview(');
  assert.match(capture, /mountQuickTagRow\(\$\('#quick-photo-modal \.quick-tag-row'\)/);
  assert.match(capture, /quickTagList/);
  assert.match(capture, /removeQuickTag/);
  assert.match(capture, /addQuickTag/);
  assert.doesNotMatch(capture, /commitSnippetEntryTag|dropSnippetEntryTag|recordQuickTag/);
  assert.match(between(snippets, 'async function saveQuickSnap(', 'function quickMemoModal('), /recordQuickTag/);

  assert.match(snippets, /snippetTagEditorHtml\(\)/);
  assert.match(snippets, /id="snippet-quick-tags"/);
  assert.match(snippets, /class="quick-tag-row"/);
  assert.doesNotMatch(snippets, /id="snippet-tag-editor"|snippet-tag-chip/);

  const commit = between(snippets, 'function commitSnippetEntryTag(', '/* 从这条记录拿掉标签');
  assert.match(commit, /recordQuickTag/);
  assert.doesNotMatch(commit, /removeQuickTag\(/);
  const drop = between(snippets, 'function dropSnippetEntryTag(', 'function snippetQuickTagChoices(');
  assert.doesNotMatch(drop, /removeQuickTag|quickTags|recordQuickTag/);

  const cssStart = plainLight.indexOf('/* snippet-tag-editor start */');
  const cssEnd = plainLight.indexOf('/* snippet-tag-editor end */');
  assert.ok(cssStart >= 0 && cssEnd > cssStart);
  const css = plainLight.slice(cssStart, cssEnd);
  assert.match(css, /:root\[data-theme="plain"\] \.moment-album-remove/);
  assert.doesNotMatch(css, /\.snippet-tag-chip/);
  assert.doesNotMatch(css, /:has\(|:is\(|:where\(/);
  assert.doesNotMatch(css, /var\(--[a-z0-9-]+,\s*#/i);
  assert.match(plainLight, /#quick-photo-modal \.quick-paper-tag,\n:root\[data-theme="plain"\] #snippet-form \.quick-paper-tag \{/);
  assert.match(plainLight, /#snippet-form \.quick-tag-row/);

  const previous = state.settings.quickTags;
  try {
    state.settings.quickTags = { items: [{ tag: '海边', count: 2, lastUsed: 1 }], hidden: [] };
    _resetSnippetEntryTagsForTest([]);
    const added = commitSnippetEntryTag(' #海边 ');
    assert.equal(added.added, true);
    assert.deepEqual(added.tags, ['海边']);
    assert.equal(state.settings.quickTags.items.find(item => item.tag === '海边').count, 3);

    const again = commitSnippetEntryTag('海边');
    assert.equal(again.added, false);
    assert.equal(state.settings.quickTags.items.find(item => item.tag === '海边').count, 3);

    const custom = commitSnippetEntryTag('##晚风');
    assert.deepEqual(custom.tags, ['海边', '晚风']);
    assert.equal(state.settings.quickTags.items.find(item => item.tag === '晚风').count, 1);

    const dropped = dropSnippetEntryTag('#海边');
    assert.deepEqual(dropped.tags, ['晚风']);
    assert.equal(state.settings.quickTags.items.find(item => item.tag === '海边').count, 3);
    assert.equal(state.settings.quickTags.items.some(item => item.tag === '海边'), true);

    const long = '长'.repeat(24);
    _resetSnippetEntryTagsForTest([long]);
    const pool = structuredClone(state.settings.quickTags);
    assert.deepEqual(dropSnippetEntryTag(long).tags, []);
    assert.deepEqual(state.settings.quickTags, pool);

    _resetSnippetEntryTagsForTest(['1', '2', '3', '4', '5', '6', '7', '8']);
    const beforeLimit = structuredClone(state.settings.quickTags);
    const limited = commitSnippetEntryTag('第九个');
    assert.equal(limited.ok, false);
    assert.equal(limited.reason, 'limit');
    assert.equal(limited.tags.length, 8);
    assert.deepEqual(state.settings.quickTags, beforeLimit);
  } finally {
    state.settings.quickTags = previous;
    _resetSnippetEntryTagsForTest([]);
  }
});

function installSnippetDom() {
  const toast = { textContent: '', classList: { add() {}, remove() {} } };
  const app = {
    className: '',
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    innerHTML: '',
    querySelectorAll() { return []; }
  };
  const modal = {
    className: '',
    classList: { add() {}, remove() {}, contains() { return false; } },
    innerHTML: ''
  };
  const nodes = { '#toast': toast, '#app': app, '#modal-layer': modal };
  const previous = {
    querySelector: document.querySelector,
    querySelectorAll: document.querySelectorAll,
    classList: document.documentElement.classList
  };
  document.documentElement.classList = { toggle() {}, add() {}, remove() {}, contains() { return false; } };
  document.querySelector = selector => nodes[selector] || null;
  document.querySelectorAll = () => [];
  return {
    toast,
    app,
    restore() {
      // show() 的淡出定时器还会再读 #toast。恢复后仍把这个节点交回去，避免定时器打到空节点。
      document.querySelector = selector => selector === '#toast' ? toast : previous.querySelector(selector);
      document.querySelectorAll = previous.querySelectorAll;
      document.documentElement.classList = previous.classList;
    }
  };
}

test('翻牌移除视频时 save 失败会还原快照并重新渲染，不留下未处理的拒绝', async () => {
  const removal = between(snippets, 'export async function deleteSavedSnippetVideo(', 'function openSnippetVideos(');
  const snap = removal.indexOf('structuredClone(state.snippets)');
  const mutate = removal.search(/state\.snippets = state\.snippets\.filter|Object\.assign\(target, plan\.entry\)/);
  const caught = removal.indexOf('catch (error)');
  assert.ok(snap >= 0 && mutate > snap, '改内存之前先快照 entry/state.snippets');
  assert.match(removal.slice(caught), /state\.snippets = previousSnippets/);
  assert.match(removal.slice(caught), /render\(\)/);
  assert.match(removal.slice(caught), /if \(\$\('#toast'\)\) show\(error\?\.message \|\| '删除失败'\)/);
  assert.match(removal.slice(caught), /return;/);
  assert.doesNotMatch(removal.slice(caught, removal.indexOf('return;', caught)), /throw /);

  const videos = [
    { video: 'mine-media://a.mp4', poster: 'mine-media://a.jpg', duration: 3 },
    { video: 'mine-media://b.mp4', poster: 'mine-media://b.jpg', duration: 4 }
  ];
  const previousSnippets = state.snippets;
  const previousRoute = state.route;
  state.route = 'snippets';
  state.snippets = [
    { id: 'keep-me', type: 'photo', date: '2026-10-15', text: '两段', photos: [], videos, tags: [], createdAt: 10 },
    { id: 'other', type: 'text', date: '2026-10-15', text: '留着', createdAt: 9 }
  ];
  const dom = installSnippetDom();
  let refreshes = 0;
  registerHelper('scheduleAiRefresh', () => { refreshes += 1; });
  let seenDuringSave = null;
  _setSnippetPersistForTest(async () => {
    seenDuringSave = state.snippets[0].videos.map(item => item.video);
    throw new Error('磁盘满了');
  });
  try {
    await deleteSavedSnippetVideo({ entryId: 'keep-me', videoIndex: 0 });
    assert.deepEqual(seenDuringSave, ['mine-media://b.mp4']);
    assert.equal(state.snippets.length, 2);
    assert.deepEqual(state.snippets[0].videos.map(item => item.video), ['mine-media://a.mp4', 'mine-media://b.mp4']);
    assert.equal(state.snippets[1].id, 'other');
    assert.equal(dom.toast.textContent, '磁盘满了');
    assert.equal(refreshes, 0);
    assert.match(dom.app.innerHTML, /keep-me/);

    state.snippets = [{ id: 'only', type: 'photo', date: '2026-10-15', text: '一段', photos: [], videos: [{ video: 'mine-media://only.mp4' }], createdAt: 4 }];
    _setSnippetPersistForTest(async () => {
      seenDuringSave = state.snippets.map(item => item.id);
      throw new Error('磁盘满了');
    });
    await deleteSavedSnippetVideo({ entryId: 'only', videoIndex: 0 });
    assert.deepEqual(seenDuringSave, []);
    assert.equal(state.snippets[0].id, 'only');
    assert.equal(state.snippets[0].videos[0].video, 'mine-media://only.mp4');
    assert.equal(refreshes, 0);
  } finally {
    _setSnippetPersistForTest(null);
    state.snippets = previousSnippets;
    state.route = previousRoute;
    dom.restore();
  }
});

test('整条删除后会 scheduleAiRefresh，确认文案沿用日记内容不受影响', async () => {
  const only = { id: 'last-one', type: 'photo', date: '2026-10-15', text: '只剩一段', photos: [], videos: [{ video: 'mine-media://only.mp4', poster: 'mine-media://only.jpg' }], createdAt: 12 };
  assert.equal(
    snippetVideoDeletePrompt(only, 0),
    '这条随手拍只剩这段视频，继续会整条删除。已经加入日记的内容不会受影响。'
  );
  assert.equal(
    snippetVideoDeletePrompt({ id: 'e1', type: 'photo', date: '2026-10-15', photos: [], videos: [{ video: 'a.mp4' }, { video: 'b.mp4' }], createdAt: 1 }, 0),
    '从这条随手拍移除这段视频？'
  );
  assert.match(snippets, /const SNIPPET_DELETE_UNAFFECTED = '已经加入日记的内容不会受影响。'/);
  assert.match(snippets, /confirmDelete\(`删除这条随手记素材？\$\{SNIPPET_DELETE_UNAFFECTED\}`/);

  const removal = between(snippets, 'export async function deleteSavedSnippetVideo(', 'function openSnippetVideos(');
  const caught = removal.indexOf('catch (error)');
  const refreshAt = removal.indexOf("callHelper('scheduleAiRefresh')");
  assert.ok(refreshAt > removal.indexOf('return;', caught), '保存成功之后才刷新 AI');
  assert.match(removal.slice(refreshAt - 30, refreshAt), /plan\.dropped/);

  const previousSnippets = state.snippets;
  const previousRoute = state.route;
  state.route = 'snippets';
  const dom = installSnippetDom();
  let refreshes = 0;
  registerHelper('scheduleAiRefresh', () => { refreshes += 1; });
  _setSnippetPersistForTest(async () => {});
  try {
    state.snippets = [only, { id: 'stay', type: 'text', date: '2026-10-15', text: '另一条', createdAt: 8 }];
    await deleteSavedSnippetVideo({ entryId: 'last-one', videoIndex: 0 });
    assert.equal(state.snippets.some(item => item.id === 'last-one'), false);
    assert.equal(refreshes, 1);
    assert.equal(dom.toast.textContent, '已整条删除这条随手拍');

    refreshes = 0;
    state.snippets = [{
      id: 'keep-two',
      type: 'photo',
      date: '2026-10-15',
      text: '两段',
      photos: [],
      videos: [
        { video: 'mine-media://a.mp4', poster: 'mine-media://a.jpg' },
        { video: 'mine-media://b.mp4', poster: 'mine-media://b.jpg' }
      ],
      createdAt: 11
    }];
    await deleteSavedSnippetVideo({ entryId: 'keep-two', videoIndex: 0 });
    assert.equal(state.snippets[0].videos.length, 1);
    assert.equal(refreshes, 0);
  } finally {
    _setSnippetPersistForTest(null);
    state.snippets = previousSnippets;
    state.route = previousRoute;
    dom.restore();
  }
});

function tagCard() {
  const node = {
    className: '',
    innerHTML: '',
    children: [],
    appendChild(child) { node.children.push(child); return child; },
    insertBefore(child, ref) {
      const index = node.children.indexOf(ref);
      if (index < 0) node.children.push(child);
      else node.children.splice(index, 0, child);
      return child;
    },
    querySelector(selector) {
      const className = selector.startsWith('.') ? selector.slice(1) : '';
      const walk = current => {
        for (const child of current.children || []) {
          if (className && String(child.className || '').split(/\s+/).includes(className)) return child;
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      return walk(node);
    }
  };
  return node;
}

test('归档卡原来没有标签节点时，手动添加会立刻补上并显示', () => {
  const chips = between(snippets, 'function renderSnippetTagChips(', 'function bindSnippetTagEditor(');
  assert.match(chips, /syncArchivedSnippetTags\(/);
  assert.match(snippets, /archived\.className = 'ai-structure-tags'/);

  const card = tagCard();
  card.className = 'ai-structure-card accepted';
  const summary = tagCard();
  summary.className = 'ai-structure-summary-text';
  card.appendChild(summary);
  syncArchivedSnippetTags(card, []);
  assert.equal(card.querySelector('.ai-structure-tags'), null);

  syncArchivedSnippetTags(card, ['海边', 'a<b']);
  const tags = card.querySelector('.ai-structure-tags');
  assert.ok(tags);
  assert.equal(card.children[0], tags);
  assert.equal(card.children[1], summary);
  assert.match(tags.innerHTML, /class="ai-tag-chip read-only"/);
  assert.match(tags.innerHTML, /#海边/);
  assert.match(tags.innerHTML, /#a&lt;b/);
  assert.doesNotMatch(tags.innerHTML, /#a<b/);

  syncArchivedSnippetTags(card, ['晚风']);
  assert.equal(card.children.filter(child => String(child.className).includes('ai-structure-tags')).length, 1);
  assert.match(card.querySelector('.ai-structure-tags').innerHTML, /#晚风/);
  assert.doesNotMatch(card.querySelector('.ai-structure-tags').innerHTML, /#海边/);
});
