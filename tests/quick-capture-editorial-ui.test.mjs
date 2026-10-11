import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const snippets = await readFile(new URL('../views/snippets.js', import.meta.url), 'utf8');
const performanceCss = await readFile(new URL('../performance.css', import.meta.url), 'utf8');

test('V1.0.9 quick capture pages use real generated paper assets with live controls', () => {
  assert.match(snippets, /assets\/quick-photo-paper-v1\.png/);
  assert.match(snippets, /assets\/quick-memo-paper-v1\.png/);
  assert.match(snippets, /id="quick-capture-snap"/);
  assert.match(snippets, /id="quick-pick-snap"/);
  assert.match(snippets, /id="quick-snap-caption"/);
  assert.match(snippets, /id="quick-memo-input"/);
  assert.match(snippets, /id="quick-memo-mic-btn" data-mic/);
  assert.match(snippets, /id="quick-save-snap"/);
  assert.match(snippets, /id="quick-save-memo"/);
  assert.match(snippets, /class="quick-modal-close" aria-label="关闭随手拍"><span class="material-symbols-outlined" aria-hidden="true">close<\/span>/);
  assert.match(snippets, /class="quick-modal-close" aria-label="关闭随手记"><span class="material-symbols-outlined" aria-hidden="true">close<\/span>/);
  assert.match(snippets, /event\.key !== 'Enter' && event\.key !== ' '/);
  assert.match(snippets, /aria-label="随手记内容"/);
  assert.match(performanceCss, /\.quick-paper-art/);
  for (const asset of ['quick-control-ivory-v1.png', 'quick-control-kraft-v1.png', 'quick-control-sage-v1.png', 'quick-control-terracotta-v1.png', 'quick-photo-dropzone-v1.png', 'quick-memo-writing-sheet-v1.png']) {
    assert.match(performanceCss, new RegExp(asset.replace('.', '\\.')));
  }
  assert.match(snippets, /class="quick-paper-tag/);
  assert.doesNotMatch(snippets, /quick-tag-chip|snippet-filter-pill quick-paper-tag/);
  assert.doesNotMatch(performanceCss, /\.quick-paper-tag\s*\{[^}]*editorial-torn-paper-strip/s);
  assert.match(performanceCss, /\.quick-tag-row\s*\{[\s\S]*?background:\s*transparent/);
  assert.match(performanceCss, /\.quick-paper-tag\s*\{[\s\S]*?background:\s*transparent\s*!important/);
  assert.doesNotMatch(performanceCss, /\.quick-photo-actions button\s*\{[^}]*editorial-torn-paper-strip/s);
  assert.match(performanceCss, /\.modal\.quick-modal:focus-visible\s*\{\s*outline:\s*0/);
  assert.match(performanceCss, /\.modal\.quick-modal\s*\{[\s\S]*?backdrop-filter:\s*none;[\s\S]*?-webkit-backdrop-filter:\s*none;/);
  assert.match(performanceCss, /\.modal\.quick-modal\s*>\s*\.liquid-glass__bottom[\s\S]*\.liquid-glass__top\s*\{\s*display:\s*none\s*!important/);
  assert.doesNotMatch(performanceCss, /\.modal\.quick-modal \.quick-modal-card[^}]*clip-path/s);
});
