import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { photoFrameLayersHtml } from '../photo-frame.js';
import { swipeActive, isSwipeActive } from '../motion-layers.js';

const momentsSrc = readFileSync(new URL('../motion-moments.js', import.meta.url), 'utf8');
const layersSrc = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');
const snippetsSrc = readFileSync(new URL('../views/snippets.js', import.meta.url), 'utf8');
const stylesCss = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('prepareLayers does not interleave getBoundingClientRect and classList.add in the same loop', () => {
  // 1. Source-text validation: getBoundingClientRect and classList.add are separated into distinct loops
  const prepareLayersSrc = momentsSrc.slice(momentsSrc.indexOf('function prepareLayers('), momentsSrc.indexOf('/* ── M4'));
  const loops = [...prepareLayersSrc.matchAll(/for\s*\([^)]*\)\s*\{([^}]*)\}/g)];
  assert.equal(loops.length, 2, 'prepareLayers must have exactly 2 separate loops: one for reading rects, one for writing classes');
  assert.match(loops[0][1], /getBoundingClientRect/, 'first loop reads rects');
  assert.doesNotMatch(loops[0][1], /classList\.add/, 'first loop must NOT write classList');
  assert.match(loops[1][1], /classList\.add/, 'second loop writes classList');
  assert.doesNotMatch(loops[1][1], /getBoundingClientRect/, 'second loop must NOT read getBoundingClientRect');

  // 2. Pure-function validation of the batching pattern
  const events = [];
  const cards = [1, 2, 3].map(id => ({
    id,
    getBoundingClientRect: () => { events.push(`read:${id}`); return { top: 900 }; },
    classList: { add: (...cls) => events.push(`write:${id}:${cls.join(' ')}`) },
  }));
  const vh = 800;
  const observed = [];
  const io = { observe: c => observed.push(c.id) };

  // Phase 1: reads
  const belowFold = [];
  for (const card of cards) {
    if (card.getBoundingClientRect().top >= vh) {
      belowFold.push(card);
    }
  }
  // Phase 2: writes
  for (const card of belowFold) {
    card.classList.add('pl-pre', 'pl-layers');
    io.observe(card);
  }

  const reads = events.map((e, idx) => e.startsWith('read:') ? idx : -1).filter(idx => idx >= 0);
  const writes = events.map((e, idx) => e.startsWith('write:') ? idx : -1).filter(idx => idx >= 0);
  assert.equal(reads.length, 3);
  assert.equal(writes.length, 3);
  assert.ok(Math.max(...reads) < Math.min(...writes), 'all rect reads must occur before any class writes');
});

test('photo-frame imgs have decoding="async"', () => {
  const html = photoFrameLayersHtml('/test.jpg', { alt: 'photo', lazy: true });
  const matches = [...html.matchAll(/<img\b([^>]*)>/g)];
  assert.equal(matches.length, 2, 'both pad and still images must be rendered');
  for (const m of matches) {
    assert.match(m[1], /decoding="async"/, 'each photo-frame img tag must declare decoding="async"');
  }

  // Moments list passes lazy for offscreen cards, first screen (first 4 cards) eager
  assert.match(snippetsSrc, /cardIndex\+\+\s*>=\s*4/, 'first 4 cards should be eager, remaining cards lazy');
  assert.match(snippetsSrc, /snippetStreamCard\(item,\s*lazy\s*=\s*true\)/);
  assert.match(snippetsSrc, /function snippetPhotoImage\(source,\s*alt\s*=\s*'',\s*opts\s*=\s*\{\}\)/);
  assert.match(snippetsSrc, /snippetPhotoImage\(photo, entry\.text \|\| `随手拍 \$\{index \+ 1\}`, \{ thumb: true, lazy, progressive: true \}\)/);
  assert.match(snippetsSrc, /snippetCoverImage\(source,\s*alt\s*=\s*'',\s*lazy\s*=\s*true\)/);
});

test('swipe done path defers tidy by two frames', () => {
  // Done path defers tidy by two frames via requestAnimationFrame
  assert.match(layersSrc, /if\s*\(done\)\s*\{[\s\S]*?requestAnimationFrame\(\(\)\s*=>\s*requestAnimationFrame\(\(\)\s*=>\s*\{[\s\S]*?tidy\(s\);/);

  // Bounce back / interruption path tidies immediately
  assert.match(layersSrc, /\} else \{\s*tidy\(s\);\s*swipeActive = false;\s*\}/);
  assert.match(layersSrc, /stop:\s*\(\)\s*=>\s*\{[\s\S]*?tidy\(s\);\s*swipeActive = false;\s*\}/);

  // swipeActive flag exposed at module level
  assert.equal(typeof swipeActive, 'boolean');
  assert.equal(typeof isSwipeActive, 'function');
});

test('watchSubpages and tidySwipe review fixes: balanced endJankWatch and no animation cancellation on class change', () => {
  // Only call clearCollapse when active AND has pl-collapse-out
  assert.match(layersSrc, /if \(active && layer\.classList\.contains\('pl-collapse-out'\)\) \{\s*clearCollapse\(layer\);/);

  // Deactivation only calls tidySwipe if no swipe is active
  assert.match(layersSrc, /if \(!swipeActive\) tidySwipe\(\);/);

  // endJankWatch only called if this gesture started one
  assert.match(layersSrc, /if \(s\?\.jankWatched\) \{\s*s\.jankWatched = false;\s*endJankWatch\(\);\s*\}/);
});

test('styles.css contains content-visibility and reduced blur cost for moments', () => {
  assert.match(stylesCss, /\.snippets-view \.snippet-day-section:nth-of-type\(n\+2\)\{content-visibility:auto;contain-intrinsic-size:auto 600px\}/);
  assert.match(stylesCss, /\.snippets-view \.snippet-cover-blur\{[^}]*filter:blur\(14px\)[^}]*transform:scale\(1\.12\)[^}]*will-change:auto\}/);
});
