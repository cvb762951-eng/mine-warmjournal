import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const styles = await readFile(new URL('../performance.css', import.meta.url), 'utf8');

test('habit detail navigation preserves the Android status-bar safe area', () => {
  assert.match(styles, /#subpage-habit-detail \.habit-detail-nav\{[^}]*padding:calc\(12px \+ var\(--app-safe-top\)\) var\(--space-page-inline\) 12px/);
});
