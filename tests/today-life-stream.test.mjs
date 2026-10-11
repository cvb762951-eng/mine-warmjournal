import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../views/today.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const nodeSource = source.match(/function timelineNode\(item\)\s*\{[\s\S]*?\r?\n\}/)?.[0] || '';

test('Today Life Stream uses event semantics instead of index rotation', () => {
  assert.match(nodeSource, /专注: 'focus'/);
  assert.match(nodeSource, /习惯: 'habit'/);
  assert.match(nodeSource, /随手记: 'note'/);
  assert.match(nodeSource, /随手拍: 'photo'/);
  assert.match(nodeSource, /书籍: 'book'/);
  assert.doesNotMatch(nodeSource, /index|pill-green|pill-beige|pill-taupe/);
});

test('Today Life Stream preserves Calendar navigation contract', () => {
  assert.match(nodeSource, /data-timeline-day="\$\{item\.date\}"/);
  assert.match(source, /\$\$\('\[data-timeline-day\]'\)\.forEach\(button => button\.onclick = \(\) => go\('calendar', button\.dataset\.timelineDay\)\)/);
});

test('Today Life Stream owns scoped warm editorial cards and empty state', () => {
  assert.match(source, /class="life-stream-empty"/);
  assert.match(source, /class="life-stream-icon"><span class="life-stream-glyph material-symbols-outlined"/);
  assert.match(source, /class="life-stream-empty-icon"><span class="life-stream-glyph material-symbols-outlined"/);
  assert.match(css, /#today-timeline-stream \.life-stream-card\s*\{[^}]*min-height:64px/);
  assert.match(css, /#today-timeline-stream \.tone-sage/);
  assert.match(css, /#today-timeline-stream \.tone-terracotta/);
  assert.match(css, /#today-timeline-stream \.tone-brown/);
  assert.match(css, /#today-timeline-stream \.life-stream-card:focus-visible/);
});

test('Today Life Stream Material glyphs own a centered independent line box', () => {
  const glyph = css.match(/#today-timeline-stream \.life-stream-glyph\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(glyph, /width:20px/);
  assert.match(glyph, /height:20px/);
  assert.match(glyph, /display:block/);
  assert.match(glyph, /line-height:1/);
  assert.match(glyph, /letter-spacing:normal/);
  assert.match(glyph, /text-indent:0/);
  assert.match(glyph, /text-align:center/);
  assert.match(glyph, /font-feature-settings:'liga'/);
  assert.match(glyph, /font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 20/);
});
