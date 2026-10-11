import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('Journal title input owns an explicit unclipped line box', () => {
  const rule = css.match(/\.journal-canvas-card #journal-title-input\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(rule, /min-height:\s*var\(--control-min-height\)/);
  assert.match(rule, /padding:\s*8px 14px 9px/);
  assert.match(rule, /box-sizing:\s*border-box/);
  assert.match(rule, /line-height:\s*1\.35/);
});

test('Journal title and body use the same 14px text inset', () => {
  const title = css.match(/\.journal-canvas-card #journal-title-input\s*\{([^}]+)\}/)?.[1] || '';
  const body = css.match(/\.journal-canvas-card #journal-content-input\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(title, /padding:\s*8px 14px 9px/);
  assert.match(body, /padding-inline:\s*14px/);
});

test('Journal title typography remains the existing 19px editorial weight', () => {
  const base = css.match(/\.journal-title-input\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(base, /font-size:\s*19px/);
  assert.match(base, /font-weight:\s*800/);
  assert.match(base, /font-family:\s*'Newsreader',serif/);
});
