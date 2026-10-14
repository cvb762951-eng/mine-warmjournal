import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const classesOf = new WeakMap();
const attrsOf = new WeakMap();

function dataKey(name) {
  return name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function setConnected(node, connected) {
  node.isConnected = connected;
  for (const child of node.children) setConnected(child, connected);
}

function matchSimple(node, selector) {
  const nots = [];
  const source = selector.replace(/:not\(([^)]+)\)/g, (_, inner) => {
    nots.push(inner.trim());
    return '';
  }).trim();
  if (nots.some(inner => matchSimple(node, inner))) return false;
  if (!source) return nots.length > 0;
  const id = (source.match(/#([\w-]+)/) || [])[1] || '';
  const classes = [...source.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
  const attrs = [...source.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
  if (!id && !classes.length && !attrs.length) return false;
  if (id && node.id !== id) return false;
  const classList = node.classList;
  if (classes.some(name => !classList || !classList.contains(name))) return false;
  for (const [, name, value] of attrs) {
    const actual = node.getAttribute(name);
    if (value === undefined) {
      if (actual == null) return false;
    } else if (actual !== value) return false;
  }
  return true;
}

function matches(node, selector) {
  const parts = selector.trim().split(/\s+/).filter(Boolean);
  if (!parts.length || !matchSimple(node, parts[parts.length - 1])) return false;
  if (parts.length === 1) return true;
  const ancestor = parts.slice(0, -1).join(' ');
  let parent = node.parentNode;
  while (parent) {
    if (matches(parent, ancestor)) return true;
    parent = parent.parentNode;
  }
  return false;
}

function el(tag) {
  const classes = new Set();
  const attrs = new Map();
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    id: '',
    children: [],
    parentNode: null,
    dataset: {},
    hidden: false,
    isConnected: false,
    onclick: null,
    _html: '',
  };
  classesOf.set(node, classes);
  attrsOf.set(node, attrs);
  node.style = {
    setProperty(name, value) { this[name] = value; },
    getPropertyValue(name) { return this[name] || ''; },
  };
  node.classList = {
    add(...names) { names.forEach(name => name && classes.add(name)); },
    remove(...names) { names.forEach(name => classes.delete(name)); },
    contains: name => classes.has(name),
    toggle(name, force) {
      const next = force === undefined ? !classes.has(name) : Boolean(force);
      if (next) classes.add(name);
      else classes.delete(name);
      return next;
    },
  };
  node.setAttribute = (name, value) => {
    attrs.set(name, String(value));
    if (name === 'id') node.id = String(value);
    if (name === 'class') {
      classes.clear();
      String(value).split(/\s+/).filter(Boolean).forEach(item => classes.add(item));
    }
    if (name.startsWith('data-')) node.dataset[dataKey(name)] = String(value);
  };
  node.getAttribute = name => (attrs.has(name) ? attrs.get(name) : null);
  node.removeAttribute = name => {
    attrs.delete(name);
    if (name.startsWith('data-')) delete node.dataset[dataKey(name)];
  };
  node.hasAttribute = name => attrs.has(name);
  node.appendChild = child => {
    if (!child) return child;
    if (child.parentNode) {
      const index = child.parentNode.children.indexOf(child);
      if (index >= 0) child.parentNode.children.splice(index, 1);
    }
    child.parentNode = node;
    node.children.push(child);
    setConnected(child, Boolean(node.isConnected));
    return child;
  };
  node.remove = () => {
    const parent = node.parentNode;
    if (parent) {
      const index = parent.children.indexOf(node);
      if (index >= 0) parent.children.splice(index, 1);
    }
    node.parentNode = null;
    setConnected(node, false);
  };
  node.contains = other => {
    let current = other;
    while (current) {
      if (current === node) return true;
      current = current.parentNode;
    }
    return false;
  };
  node.querySelectorAll = selector => {
    const found = [];
    const visit = current => {
      for (const child of current.children) {
        if (matches(child, selector)) found.push(child);
        visit(child);
      }
    };
    visit(node);
    return found;
  };
  node.querySelector = selector => node.querySelectorAll(selector)[0] || null;
  node.addEventListener = () => {};
  Object.defineProperty(node, 'firstElementChild', { get: () => node.children[0] || null });
  Object.defineProperty(node, 'innerHTML', {
    get: () => node._html,
    set: value => {
      node._html = String(value ?? '');
      for (const child of [...node.children]) child.remove();
    },
  });
  return node;
}

const body = el('body');
body.isConnected = true;
const documentElement = el('html');
documentElement.dataset.theme = 'plain';
documentElement.dataset.plMotion = 'none';

globalThis.document = {
  documentElement,
  body,
  hidden: false,
  visibilityState: 'visible',
  activeElement: null,
  addEventListener() {},
  createElement: tag => el(tag),
  querySelector: selector => body.querySelector(selector),
  querySelectorAll: selector => body.querySelectorAll(selector),
  getElementById: id => body.querySelector(`#${id}`),
};

const {
  momentSpreadHtml,
  momentSpreadSignature,
  syncOpenMomentFans,
  finishSnippetPhotoImport,
  _setPendingSnippetMediaForTest,
} = await import('../views/snippets.js');

function keptFan(src) {
  let hits = 0;
  const onClick = () => { hits += 1; };
  const spread = el('div');
  spread.classList.add('moment-spread');
  spread.dataset.spreadSig = `kept:${src}`;
  const card = el('span');
  card.classList.add('moment-spread-card');
  card.dataset.fanKey = `p:${src}`;
  card.setAttribute('data-fan-key', `p:${src}`);
  card.dataset.face = src;
  const img = el('img');
  img.setAttribute('src', src);
  const button = el('button');
  button.onclick = onClick;
  button.setAttribute('data-view-snippet-photo', 'saved-entry');
  card.appendChild(img);
  card.appendChild(button);
  spread.appendChild(card);
  return { spread, card, img, button, onClick, hits: () => hits, src };
}

function assertKept(fan, label) {
  assert.equal(fan.spread.isConnected, true, `${label}仍在文档里`);
  assert.equal(fan.card.isConnected, true, `${label}的卡片还在`);
  assert.equal(fan.img.isConnected, true, `${label}的图片还在`);
  assert.equal(fan.card.contains(fan.img), true, `${label}的图片没有被换掉`);
  assert.equal(fan.img.getAttribute('src'), fan.src, `${label}的图片地址还是原来的`);
  assert.equal(fan.button.isConnected, true, `${label}的点击目标还在`);
  assert.equal(fan.button.onclick, fan.onClick, `${label}的点击处理函数没有被改写`);
  assert.equal(fan.button.getAttribute('data-view-snippet-photo'), 'saved-entry', `${label}的点击仍指向已保存记录`);
  const before = fan.hits();
  fan.button.onclick();
  assert.equal(fan.hits(), before + 1, `${label}的点击处理函数还能调用`);
}

test('待保存扇面带 data-fan-scope，导入不再全局扫描 .moment-spread', async () => {
  const pending = momentSpreadHtml(['shot.jpg'], { interactive: { mode: 'pending' } });
  assert.match(pending, /data-fan-scope="pending"/);
  const saved = momentSpreadHtml(['shot.jpg'], {
    videos: [{ poster: 'cover.jpg', video: 'clip.mp4', duration: 4 }],
    interactive: { mode: 'saved', entryId: 'saved-entry' },
  });
  assert.doesNotMatch(saved, /data-fan-scope/);
  assert.match(saved, /data-view-snippet-photo="saved-entry"/);
  assert.match(saved, /data-play-snippet-video="saved-entry"/);

  const source = await readFile(new URL('../views/snippets.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /document\.querySelectorAll\(\s*['"]\.moment-spread['"]\s*\)/);
  assert.match(source, /#snippet-photo-grid/);
  assert.match(source, /#quick-photo-preview/);
  assert.match(source, /data-fan-scope="pending"/);
});

test('页面上已保存的扇面在导入和整批失败后仍保留图片、点击和节点', () => {
  const timeline = el('section');
  timeline.id = 'screen-snippets';
  timeline.setAttribute('id', 'screen-snippets');
  const saved = keptFan('saved-keep.jpg');
  const outside = keptFan('outside-keep.jpg');
  outside.spread.setAttribute('data-fan-scope', 'pending');
  timeline.appendChild(saved.spread);
  timeline.appendChild(outside.spread);

  const grid = el('div');
  grid.id = 'snippet-photo-grid';
  grid.setAttribute('id', 'snippet-photo-grid');
  const gridFan = el('div');
  gridFan.classList.add('moment-spread');
  gridFan.setAttribute('data-fan-scope', 'pending');
  grid.appendChild(gridFan);

  const preview = el('div');
  preview.id = 'quick-photo-preview';
  preview.setAttribute('id', 'quick-photo-preview');
  const previewFan = el('div');
  previewFan.classList.add('moment-spread');
  previewFan.setAttribute('data-fan-scope', 'pending');
  const overlay = el('span');
  overlay.classList.add('quick-photo-overlay');
  preview.appendChild(previewFan);
  preview.appendChild(overlay);

  body.appendChild(timeline);
  body.appendChild(grid);
  body.appendChild(preview);

  assert.equal(grid.querySelectorAll('.moment-spread[data-fan-scope="pending"]').length, 1);
  assert.equal(preview.querySelectorAll('.moment-spread[data-fan-scope="pending"]').length, 1);
  assert.equal(grid.contains(saved.spread), false);
  assert.equal(preview.contains(outside.spread), false);

  const imported = ['imported-new.jpg'];
  const sig = momentSpreadSignature(imported, []);
  _setPendingSnippetMediaForTest(imported, []);
  syncOpenMomentFans('p:imported-new.jpg', { importing: true, animate: true });
  assertKept(saved, '导入过程中，已保存扇面');
  assertKept(outside, '导入过程中，表单外的扇面');
  assert.equal(gridFan.dataset.spreadSig, sig, '表单网格里的待保存扇面要跟上这批照片');
  assert.equal(previewFan.dataset.spreadSig, sig, '快捷弹窗里的待保存扇面要跟上这批照片');
  assert.equal(saved.spread.dataset.spreadSig, 'kept:saved-keep.jpg');

  finishSnippetPhotoImport();
  assertKept(saved, '导入结束后，已保存扇面');
  assertKept(outside, '导入结束后，表单外的扇面');
  assert.equal(timeline.contains(saved.spread), true);
  assert.equal(saved.img.getAttribute('src'), 'saved-keep.jpg');

  if (!gridFan.isConnected) grid.appendChild(gridFan);
  if (!previewFan.isConnected) preview.appendChild(previewFan);
  assert.equal(grid.contains(gridFan), true);
  assert.equal(preview.contains(previewFan), true);

  _setPendingSnippetMediaForTest([], []);
  finishSnippetPhotoImport();
  assertKept(saved, '整批失败后，已保存扇面');
  assertKept(outside, '整批失败后，表单外的扇面');
  assert.equal(timeline.contains(saved.spread), true, '整批失败后已保存扇面还在时间线上');
  assert.equal(saved.button.onclick, saved.onClick);
  assert.equal(saved.img.getAttribute('src'), 'saved-keep.jpg');
  assert.equal(grid.contains(gridFan), false, '整批失败后表单里的待保存扇面要撤掉');
  assert.equal(preview.contains(previewFan), false, '整批失败后快捷弹窗里的待保存扇面要撤掉');
  assert.equal(gridFan.isConnected, false);
  assert.equal(previewFan.isConnected, false);
});
