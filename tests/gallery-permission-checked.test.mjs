import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const view = await readFile(new URL('../views/local-gallery.js', import.meta.url), 'utf8');

test('permissionChecked is initialized before a mid-flight gallery exit can assign it', () => {
  const declaredAt = view.indexOf('let permissionChecked = false;');
  const refreshAt = view.indexOf('async function refreshPermissions');
  const leaveAt = view.indexOf("if (state.route !== 'local-gallery') { permissionChecked = false; return; }");
  assert.ok(declaredAt >= 0 && refreshAt > declaredAt && leaveAt > refreshAt);
  assert.equal(view.split('let permissionChecked').length, 2);
});
