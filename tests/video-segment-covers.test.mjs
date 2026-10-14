import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    documentElement: { classList: { toggle() {} } },
    body: { classList: { add() {}, remove() {}, contains() { return false; } } },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: tag => {
      const classList = new Set();
      const dataset = {};
      const style = { setProperty(k, v) { style[k] = v; } };
      return {
        tagName: tag.toUpperCase(),
        dataset,
        style,
        classList: {
          add: c => classList.add(c),
          remove: c => classList.delete(c),
          contains: c => classList.has(c)
        },
        innerHTML: '',
        appendChild() {},
        animate: () => {}
      };
    }
  };
}

const { snippetSegmentPoster } = await import('../views/snippets.js');
import {
  THUMB_PLACEHOLDER,
  progressiveSource,
  watchThumbImages,
  ensureThumb,
  _deliverThumbForTest,
  _seedThumbForTest,
  _resetThumbsForTest
} from '../photo-thumbs.js';
import { adoptNativeMediaFile, mediaSource } from '../media-store.js';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

const REF = 'mine-media://video-seg-cover.jpg';
const FULL = 'https://media.example/video-seg-cover.jpg';
const THUMB = 'blob:thumb-seg-cover';

function fakeImg(attrs) {
  const attributes = { ...attrs };
  const dataset = {};
  if (attributes['data-progressive']) dataset.progressive = attributes['data-progressive'];
  if (attributes['data-thumb-ref']) dataset.thumbRef = attributes['data-thumb-ref'];
  if (attributes['data-full-src']) dataset.fullSrc = attributes['data-full-src'];
  const img = {
    dataset,
    isConnected: true,
    decoding: '',
    srcLog: [],
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null; },
    removeAttribute(name) { delete attributes[name]; },
    set src(value) {
      attributes.src = String(value);
      img.srcLog.push(attributes.src);
    },
    get src() { return attributes.src || ''; }
  };
  return img;
}

test.beforeEach(() => {
  _resetThumbsForTest();
});

test.afterEach(() => {
  _resetThumbsForTest();
});

test('分段视频封面 markup 带 data-thumb-ref，绝不带 data-progressive，且 initial src 不为 ""', () => {
  // 未暖出的 media-ref，必须使用 progressiveSource(REF) 占位，避免 src="" 裂图
  const htmlUnseeded = snippetSegmentPoster(REF, '第 1 段视频封面', true);
  assert.match(htmlUnseeded, new RegExp(`data-thumb-ref="${REF.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), '带 data-thumb-ref');
  assert.doesNotMatch(htmlUnseeded, /data-progressive/, '分段封面绝不带 data-progressive');
  assert.doesNotMatch(htmlUnseeded, /src=""/, '绝不能输出空 src');
  assert.match(htmlUnseeded, new RegExp(`src="${THUMB_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), '初始占位为 THUMB_PLACEHOLDER');

  // 已有缩略图缓存时直接使用 480 缩略图
  _seedThumbForTest(REF, THUMB);
  const htmlSeeded = snippetSegmentPoster(REF, '第 1 段视频封面', true);
  assert.match(htmlSeeded, new RegExp(`src="${THUMB}"`));
  assert.match(htmlSeeded, /data-thumb-ref=/);
  assert.doesNotMatch(htmlSeeded, /data-progressive/);
  assert.doesNotMatch(htmlSeeded, /src=""/);

  // 非缩略图引用（如 data URL 或 https URL）使用 imgSrc，不带 data-thumb-ref 也无 data-progressive
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const htmlData = snippetSegmentPoster(dataUrl, '外链封面');
  assert.match(htmlData, new RegExp(`src="${dataUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.doesNotMatch(htmlData, /data-thumb-ref/);
  assert.doesNotMatch(htmlData, /data-progressive/);
  assert.doesNotMatch(htmlData, /src=""/);
});

test('watchThumbImages 遇到空 src 的 img[data-thumb-ref] 立即填入 THUMB_PLACEHOLDER', () => {
  const blankImg = fakeImg({ src: '', 'data-thumb-ref': REF });
  const scope = { querySelectorAll: sel => (sel === 'img[data-thumb-ref]' ? [blankImg] : []) };
  watchThumbImages(scope);
  assert.equal(blankImg.getAttribute('src'), THUMB_PLACEHOLDER, '空 src 立即被替换为占位图');
  assert.notEqual(blankImg.getAttribute('src'), '', '不再为空串');
});

test('ensureThumb 失败时回退已解析的原图，绝不设置 src 为空串', async () => {
  adoptNativeMediaFile('video-seg-cover.jpg', FULL);
  assert.equal(mediaSource(REF), FULL);

  const img = fakeImg({ src: THUMB_PLACEHOLDER, 'data-thumb-ref': REF });
  const prevDoc = globalThis.document;
  globalThis.document = {
    querySelectorAll: sel => (sel === 'img[data-thumb-ref]' ? [img] : [])
  };

  try {
    // ensureThumb 尝试加载存储缩略图和生成，在没有 IndexedDB / Filesystem 时失败并返回 ''
    const result = await ensureThumb(REF);
    assert.equal(result, '', 'ensureThumb 返回失败空串');

    // 回退必须将 img 替换为已解析的原图 FULL
    assert.equal(img.getAttribute('src'), FULL, '回退成功换成原图地址');
    assert.notEqual(img.getAttribute('src'), '', 'src 绝不为 ""');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('原图亦无法解析时，回退绝不把 src 设为空串', async () => {
  const unknownRef = 'mine-media://completely-unknown.jpg';
  const img = fakeImg({ src: THUMB_PLACEHOLDER, 'data-thumb-ref': unknownRef });
  const prevDoc = globalThis.document;
  globalThis.document = {
    querySelectorAll: sel => (sel === 'img[data-thumb-ref]' ? [img] : [])
  };

  try {
    const result = await ensureThumb(unknownRef);
    assert.equal(result, '');
    assert.equal(img.getAttribute('src'), THUMB_PLACEHOLDER, '无法解析时保持占位图，绝不设置为空串');
    assert.notEqual(img.getAttribute('src'), '');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('源码审查：分段封面使用 snippetSegmentPoster 且 progressive 为 false；photo-thumbs 失败回退', async () => {
  const [snippets, thumbs] = await Promise.all(['views/snippets.js', 'photo-thumbs.js'].map(read));

  // snippets.js: 必须有 snippetSegmentPoster 辅助函数
  assert.match(snippets, /export function snippetSegmentPoster\(/);
  assert.match(snippets, /thumbKeyFor\(poster\)\s*\?\s*poster\s*:\s*''/);
  assert.match(snippets, /progressiveSource\(poster\)/);
  assert.match(snippets, /progressive:\s*false/);

  // snippetStreamCard: 必须调用 snippetSegmentPoster
  assert.match(snippets, /snippet-video-segments[\s\S]*?snippetSegmentPoster\(item\.poster/);
  // .snippet-video-segments 内部绝不能出现 progressive: true
  const segmentCardPart = snippets.slice(snippets.indexOf('const segments = videos.length > 1'), snippets.indexOf('const localVideoIndex'));
  assert.doesNotMatch(segmentCardPart, /progressive:\s*true/);

  // photo-thumbs.js: 包含 swapFallbackInDom 并在失败时换成原图且不置空
  assert.match(thumbs, /swapFallbackInDom/);
  assert.match(thumbs, /mediaSource\(ref\)\s*\|\|\s*await resolveMediaReference\(ref\)/);
  assert.match(thumbs, /if \(!source\) return;/);
  assert.match(thumbs, /if \(!current \|\| current === THUMB_PLACEHOLDER\)/);
  assert.match(thumbs, /if \(!current\) img\.src = THUMB_PLACEHOLDER/);
});

test('动效锁定：样式与脚本中彻底移除 snippetCellEnter 与 snippet-photo-cell--enter', async () => {
  const [styles, snippets, preview] = await Promise.all(['styles.css', 'views/snippets.js', 'previews/snippet-import-pop.html'].map(read));
  assert.doesNotMatch(styles, /snippetCellEnter/);
  assert.doesNotMatch(styles, /snippet-photo-cell--enter/);
  assert.doesNotMatch(snippets, /snippetCellEnter/);
  assert.doesNotMatch(snippets, /snippet-photo-cell--enter/);
  assert.doesNotMatch(snippets, /newlyAddedRefs/);
  assert.doesNotMatch(preview, /snippetCellEnter/);
  assert.doesNotMatch(preview, /snippet-photo-cell--enter/);
});

test('动效锁定：MOMENTS_MOTION 导出 spreadMs/spreadEase 常量，snippets 导入复用', async () => {
  const { MOMENTS_MOTION, isMomentsMoving, isMomentsRich } = await import('../motion-moments.js');
  assert.equal(MOMENTS_MOTION.spreadMs, 320);
  assert.equal(MOMENTS_MOTION.spreadLiteMs, 180);
  assert.equal(MOMENTS_MOTION.spreadEase, 'cubic-bezier(.34,1.56,.64,1)');
  assert.equal(MOMENTS_MOTION.spreadLiteEase, 'ease-out');
  assert.equal(typeof isMomentsMoving, 'function');
  assert.equal(typeof isMomentsRich, 'function');

  const [momentsSrc, snippetsSrc] = await Promise.all(['motion-moments.js', 'views/snippets.js'].map(read));
  assert.match(snippetsSrc, /import\s*\{[^}]*MOMENTS_MOTION[^}]*\}\s*from\s*'\.\.\/motion-moments\.js'/);
  assert.match(snippetsSrc, /MOMENTS_MOTION\.spreadMs/);
  assert.match(snippetsSrc, /MOMENTS_MOTION\.spreadEase/);
  assert.match(momentsSrc, /MOMENTS_MOTION\.spreadMs/);
  assert.match(momentsSrc, /MOMENTS_MOTION\.spreadEase/);
});

test('动效锁定：playSpreadFlyIn 跳过导入态容器，避免整组重飞', async () => {
  const { playSpreadFlyIn } = await import('../motion-moments.js');
  let animated = 0;
  const mockCard = {
    animate() { animated++; }
  };
  const prevDoc = globalThis.document;
  try {
    globalThis.document = {
      documentElement: { dataset: { theme: 'plain', plMotion: 'rich' } },
      querySelectorAll(sel) {
        if (sel === '.moment-spread') {
          return [
            {
              dataset: { spreadImporting: '1', spreadSig: 'sig-1' },
              hasAttribute: attr => attr === 'data-spread-importing',
              classList: { contains: cls => cls === 'is-importing' },
              querySelectorAll: () => [mockCard]
            }
          ];
        }
        return [];
      }
    };
    globalThis.getComputedStyle = () => ({
      getPropertyValue: prop => prop === '--rot' ? '0deg' : '0px'
    });

    playSpreadFlyIn();
    assert.equal(animated, 0, '导入态下的 spread 必须被跳过，不得播放 playSpreadFlyIn');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('叠牌渲染：momentImportStackHtml 与 pushCardToImportStack 锁定朝观众变大淡出与递增 z-index', async () => {
  const { momentImportStackHtml, pushCardToImportStack } = await import('../views/snippets.js');
  const html = momentImportStackHtml(['photoA.jpg', 'photoB.jpg']);
  assert.match(html, /class="moment-spread is-importing"/);
  assert.match(html, /data-spread-importing="1"/);
  assert.match(html, /data-depth="0"/);
  assert.match(html, /data-depth="1"/);
  assert.match(html, /style="z-index:\s*10"/);
  assert.match(html, /style="z-index:\s*11"/);

  // 校验 styles.css 中朝观众变大淡出阶梯（scale > 1，out/exiting 达 1.28 且 opacity 0）
  const styles = await read('styles.css');
  assert.match(styles, /\.moment-spread\.is-importing \.moment-spread-card\[data-depth="out"\],\s*\.moment-spread\.is-importing \.moment-spread-card\.is-exiting\s*\{[^}]*scale\(1\.[^}]*opacity:\s*0/);
  assert.match(styles, /\.moment-spread\.is-importing \.moment-spread-card\[data-depth="1"\]\s*\{[^}]*scale\(1\./);
  assert.doesNotMatch(styles, /\.moment-spread\.is-importing \.moment-spread-card\[data-depth="1"\]\s*\{[^}]*scale\(0\./);

  // 测试 pushCardToImportStack 增量添加新卡与旧卡深度推移
  const cards = [];
  const spreadEl = {
    style: { setProperty() {} },
    querySelectorAll: () => cards.filter(c => !c.classList.contains('is-exiting')),
    appendChild(el) { cards.push(el); }
  };

  function makeCard(depth) {
    const classList = new Set();
    return {
      dataset: { depth: String(depth) },
      style: { zIndex: String(10 + depth) },
      classList: {
        add: cls => classList.add(cls),
        remove: cls => classList.delete(cls),
        contains: cls => classList.has(cls)
      },
      remove() {
        const idx = cards.indexOf(this);
        if (idx >= 0) cards.splice(idx, 1);
      }
    };
  }

  // 初始 1 张卡片
  cards.push(makeCard(0));
  pushCardToImportStack(spreadEl, 'photoNew.jpg');

  assert.equal(cards.length, 2);
  assert.equal(cards[0].dataset.depth, '1', '旧卡深度从 0 递增到 1');
  assert.equal(cards[0].style.zIndex, '11', '旧卡 z-index 递增为 11（飘在新卡前面）');
  assert.equal(cards[1].dataset.depth, '0', '新卡深度设为 0 (最顶层新卡)');
  assert.equal(cards[1].style.zIndex, '10', '新卡 z-index 为 10');

  // 测试 depth >= 4 卡片设为 out / exiting，z-index 升至最高 14
  const oldCard = cards[0];
  oldCard.dataset.depth = '3';
  pushCardToImportStack(spreadEl, 'photoNext.jpg');
  assert.equal(oldCard.dataset.depth, 'out');
  assert.equal(oldCard.style.zIndex, '14', 'exiting 卡设为最高 z-index 14');
  assert.ok(oldCard.classList.contains('is-exiting'));
});

