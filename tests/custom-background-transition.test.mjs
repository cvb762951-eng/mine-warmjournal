import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../performance.css', import.meta.url), 'utf8');

test('custom background transition works without :has support', () => {
  assert.match(css, /\.phone-shell\.has-custom-background #app\s*\{/);
  assert.match(css, /\.phone-shell\.has-custom-background #app > \.view\s*\{\s*background: transparent !important;/);
});
