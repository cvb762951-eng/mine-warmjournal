import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../views/snippets.js', import.meta.url), 'utf8');

test('Moments book and movie filter excludes photo and memo records', () => {
  assert.match(source, /const snippetList = mediaFilter\s*\?\s*\[\]\s*:/);
  assert.match(source, /mediaFilter \|\| snippetType === 'all'/);
});
