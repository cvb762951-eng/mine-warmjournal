import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const todaySource = await readFile(new URL('../views/today.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('Today countdown fallback is an accessible add button', () => {
  assert.match(todaySource, /<button type="button" class="countdown-empty-ticket" id="open-countdown-banner" aria-label="添加倒数日">/);
  assert.match(todaySource, /添加倒数日，记录值得期待的日子/);
  assert.match(todaySource, /countdown-empty-chevron material-symbols-outlined/);
});

test('Today countdown fallback reuses the existing back-stack navigation', () => {
  assert.match(todaySource, /#open-countdown-banner'\)\?\.addEventListener\('click', \(\) => \{ pushBackState\(\); go\('countdown'\); \}\)/);
  assert.equal((todaySource.match(/id="open-countdown-banner"/g) || []).length, 1);
});

test('Today countdown fallback preserves touch and keyboard affordances', () => {
  const rule = css.match(/\.countdown-empty-ticket\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(rule, /width:\s*100%/);
  assert.match(rule, /min-height:\s*66px/);
  assert.match(rule, /appearance:\s*none/);
  assert.match(css, /\.countdown-empty-ticket:focus-visible\s*\{[^}]*outline:/);
});

test('Today photo stack only cycles and never opens the photo lightbox', () => {
  assert.doesNotMatch(todaySource, /openPhotoLightbox/);
  assert.match(todaySource, /#photo-stack'\)\?\.addEventListener\('click', event => \{[\s\S]{0,260}cyclePhotoStack\(\);/);
  assert.match(todaySource, /data-photo-stack-entry/);
});
