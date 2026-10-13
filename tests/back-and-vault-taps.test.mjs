import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  tidySwipe, clearCollapse, swallowNextClick, LAYER_MOTION,
} from '../motion-layers.js';

const layersSrc = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');
const snippetsSrc = readFileSync(new URL('../views/snippets.js', import.meta.url), 'utf8');

test('quick sheets no longer set plDetents in snippets.js and motion-layers.js', () => {
  // 1. snippets.js: quickPhotoModal and quickMemoModal do not set dataset.plDetents
  assert.doesNotMatch(snippetsSrc, /photoModal\.dataset\.plDetents/);
  assert.doesNotMatch(snippetsSrc, /memoModal\.dataset\.plDetents/);
  assert.doesNotMatch(snippetsSrc, /dataset\.plDetents =/);

  // 2. motion-layers.js: watchSheets does not auto-add plDetents to quick sheets
  assert.doesNotMatch(layersSrc, /sheet\.dataset\.plDetents = 'medium large'/);
  assert.doesNotMatch(layersSrc, /#quick-photo-modal, #quick-memo-modal/);

  // 3. Opt-in path remains intact for sheets that explicitly declare plDetents
  assert.match(layersSrc, /if \(sheet && sheet\.dataset\.plDetents && !sheet\.dataset\.plDetent\)/);
  assert.match(layersSrc, /sheet\.dataset\.plDetent = 'medium'/);
  assert.match(layersSrc, /sheet\.style\.transform = `translate3d\(0, \$\{geo\.medium\.toFixed\(1\)\}px, 0\)`/);

  // 4. watchSheets removes pl-sheet-open and clears transform/data-pl-detent when closed or replaced
  assert.match(layersSrc, /s\.style\.transform = ''/);
  assert.match(layersSrc, /delete s\.dataset\.plDetent/);
  assert.match(layersSrc, /resetSheet\(lastSheet\)/);
  assert.match(layersSrc, /root\?\.classList\.remove\('pl-sheet-open'\)/);
});

test('tidy clears all .pl-swipe-under (class, inline transform, --pl-dim, will-change)', () => {
  const elements = [
    {
      classes: new Set(['subpage-layer', 'pl-swipe-under']),
      style: {
        transform: 'translate3d(-20%, 0, 0)',
        opacity: '0.8',
        willChange: 'transform',
        '--pl-dim': '0.5',
        removeProperty(p) { delete this[p]; },
      },
    },
    {
      classes: new Set(['view', 'pl-swipe-under']),
      style: {
        transform: 'translate3d(-10%, 0, 0)',
        opacity: '0.9',
        willChange: 'transform',
        '--pl-dim': '0.2',
        removeProperty(p) { delete this[p]; },
      },
    },
  ];

  const subpages = [
    {
      classes: new Set(['subpage-layer', 'pl-swiping']),
      style: {},
    },
    {
      classes: new Set(['subpage-layer', 'pl-swiped']),
      style: {},
    },
  ];

  const shellEl = {
    classes: new Set(['phone-shell', 'pl-swiping']),
  };

  const oldDoc = globalThis.document;
  globalThis.document = {
    querySelectorAll(selector) {
      if (selector === '.pl-swipe-under') {
        return elements.filter(el => el.classes.has('pl-swipe-under')).map(el => ({
          classList: {
            remove: c => el.classes.delete(c),
            contains: c => el.classes.has(c),
          },
          style: el.style,
        }));
      }
      if (selector.includes('pl-swiping') || selector.includes('pl-swiped')) {
        return subpages.filter(el => el.classes.has('pl-swiping') || el.classes.has('pl-swiped')).map(el => ({
          classList: {
            remove: (...cs) => cs.forEach(c => el.classes.delete(c)),
            contains: c => el.classes.has(c),
          },
        }));
      }
      return [];
    },
    querySelector(selector) {
      if (selector === '.phone-shell') {
        return {
          classList: {
            remove: c => shellEl.classes.delete(c),
            contains: c => shellEl.classes.has(c),
          },
        };
      }
      return null;
    },
    getElementById(id) {
      return null;
    },
  };

  try {
    tidySwipe();

    // Verify all matching elements have class, transform, opacity, --pl-dim, willChange cleared
    for (const el of elements) {
      assert.equal(el.classes.has('pl-swipe-under'), false, 'pl-swipe-under class must be removed');
      assert.equal(el.style.transform, '', 'transform must be empty');
      assert.equal(el.style.opacity, '', 'opacity must be empty');
      assert.equal(el.style.willChange, '', 'willChange must be empty');
      assert.equal(el.style['--pl-dim'], undefined, '--pl-dim must be removed');
    }

    // Verify subpages have swiping/swiped classes cleared
    for (const sp of subpages) {
      assert.equal(sp.classes.has('pl-swiping'), false);
      assert.equal(sp.classes.has('pl-swiped'), false);
    }

    // Verify shell has pl-swiping cleared
    assert.equal(shellEl.classes.has('pl-swiping'), false);
  } finally {
    globalThis.document = oldDoc;
  }

  // Source text checks: tidy clears all .pl-swipe-under and is called immediately on interrupt / settle stop / layer close
  assert.match(layersSrc, /document\.querySelectorAll\('\.pl-swipe-under'\)\.forEach/);
  assert.match(layersSrc, /el\.style\.removeProperty\?\.\('--pl-dim'\)/);
  assert.match(layersSrc, /el\.style\.willChange = ''/);
  assert.match(layersSrc, /const stopSettle = \(\) => \{\s*if \(!settle\) return;\s*const p = settle;\s*settle = null;\s*p\.stop\(\);\s*tidy\(p\.s\);/);
  assert.match(layersSrc, /window\.addEventListener\?\.\('mine-system-back'/);
});

test('playExpand removes pl-collapse-out and cancels lingering opacity animations', () => {
  let animationCancelled = false;
  const classes = new Set(['subpage-layer', 'pl-collapse-out']);
  const mockLayer = {
    classList: {
      contains: c => classes.has(c),
      remove: c => classes.delete(c),
    },
    style: { opacity: '0' },
    getAnimations() {
      return [{
        cancel() { animationCancelled = true; },
      }];
    },
  };

  clearCollapse(mockLayer);
  assert.equal(mockLayer.classList.contains('pl-collapse-out'), false);
  assert.equal(mockLayer.style.opacity, '');
  assert.equal(animationCancelled, true);

  // Source text checks: clearCollapse called at start of playExpand and on layer .active with pl-collapse-out
  assert.match(layersSrc, /function playExpand\(layer\) \{\s*clearCollapse\(layer\);/);
  assert.match(layersSrc, /if \(active && layer\.classList\.contains\('pl-collapse-out'\)\) \{\s*clearCollapse\(layer\);/);
});

test('playCollapse has a timeout fallback (outMs + backMs + 500ms)', () => {
  // Source text check: timeout fallback exists with formula E.outMs + E.backMs + 500
  assert.match(layersSrc, /fallbackTimer = setTimeout\(cleanup, E\.outMs \+ E\.backMs \+ 500\)/);
  assert.match(layersSrc, /clearTimeout\(fallbackTimer\)/);

  // Verify parameters
  const E = LAYER_MOTION.expand;
  const expectedFallback = E.outMs + E.backMs + 500;
  assert.equal(expectedFallback, 160 + 360 + 500); // 1020ms
});

test('swallowNextClick expires after timeout and only swallows one click within window', async () => {
  const listeners = new Map();
  const mockDoc = {
    addEventListener(type, fn, opts) {
      listeners.set(type, fn);
    },
    removeEventListener(type, fn, opts) {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
  };

  // Case 1: Click within window is swallowed and listener removed
  swallowNextClick(mockDoc, 350);
  assert.ok(listeners.has('click'), 'click listener registered');

  let prevented = false;
  let stopped = false;
  const earlyEvent = {
    isTrusted: true,
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; },
  };

  const handler = listeners.get('click');
  handler(earlyEvent);
  assert.equal(prevented, true, 'trusted click within window should be prevented');
  assert.equal(stopped, true, 'trusted click within window should be stopped');
  assert.equal(listeners.has('click'), false, 'listener removed immediately after swallowing');

  // Case 2: Untrusted click (script-triggered like back.click()) is not swallowed
  swallowNextClick(mockDoc, 350);
  let scriptPrevented = false;
  const scriptEvent = {
    isTrusted: false,
    preventDefault() { scriptPrevented = true; },
    stopPropagation() {},
  };
  const scriptHandler = listeners.get('click');
  scriptHandler(scriptEvent);
  assert.equal(scriptPrevented, false, 'synthetic click must not be swallowed');

  // Case 3: Self-expires when no click arrives
  swallowNextClick(mockDoc, 50);
  assert.ok(listeners.has('click'), 'listener registered for expiration test');
  await new Promise(r => setTimeout(r, 70));
  assert.equal(listeners.has('click'), false, 'listener expired and removed after timeout');

  // Case 4: Click arriving after expiry timestamp is ignored even if listener fired late
  swallowNextClick(mockDoc, 20);
  const lateHandler = listeners.get('click');
  await new Promise(r => setTimeout(r, 35));
  let latePrevented = false;
  const lateEvent = {
    isTrusted: true,
    preventDefault() { latePrevented = true; },
    stopPropagation() {},
  };
  lateHandler(lateEvent);
  assert.equal(latePrevented, false, 'event after expiry must not be prevented');
});
