import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mine = await readFile(new URL('../views/mine.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('Mine uses the shared editorial paper hierarchy and four product groups', () => {
  assert.match(mine, /mine-editorial-header/);
  assert.match(mine, /我的生活/);
  assert.match(mine, /智能与提醒/);
  assert.match(mine, /外观与偏好/);
  assert.match(mine, /数据与安全/);
  assert.match(styles, /Mine first-stage hierarchy/);
  assert.match(styles, /secondary-page-canvas-v1\.png/);
  assert.match(styles, /secondary-header-paper-v1\.png/);
  assert.match(styles, /secondary-content-paper-v1\.png/);
  assert.match(styles, /body:has\(\.mine-view\) #app\{[\s\S]*today-paper-texture\.png[\s\S]*background-repeat:repeat!important/);
  assert.match(styles, /\.mine-view::before\{[\s\S]*secondary-page-canvas-v1\.png[\s\S]*no-repeat/);
  assert.doesNotMatch(styles, /body:has\(\.mine-view\) #app\{[^}]*secondary-page-canvas-v1\.png[^}]*repeat-y/);
});

test('Mine keeps every existing entry once and removes the duplicate settings menu', () => {
  for (const id of ['open-taste-archive', 'open-media-detail-mine', 'open-habit-detail-mine', 'settings-ai', 'settings-reminder', 'settings-background', 'settings-password-vault', 'settings-data', 'settings-snapshot', 'settings-snapshot-list', 'settings-backup', 'settings-verify-backup', 'settings-restore']) {
    assert.equal(mine.match(new RegExp(`id="${id}"`, 'g'))?.length, 1, id);
  }
  const health = mine.slice(mine.indexOf('function showSettingsAndData'), mine.indexOf('async function createLocalSnapshot'));
  assert.doesNotMatch(health, /settings-modal-list|settings-ai|settings-backup|settings-restore/);
  assert.match(health, /不会上传照片、视频、密码或日记内容/);
});

test('Mine taste counters are derived inside the view before the template uses them', () => {
  const viewBody = mine.slice(mine.indexOf('export function mineView'), mine.indexOf('function profileForm'));
  assert.match(viewBody, /const tasteCount = \(state\.tasteEntries \|\| \[\]\)\.length/);
  assert.match(viewBody, /const tasteAgainCount/);
  const binder = mine.slice(mine.indexOf('function bindMine'), mine.indexOf('// ---- 表单提交'));
  assert.doesNotMatch(binder, /const tasteCount|const tasteAgainCount/);
});

test('new routes disable scroll anchoring while navigation history still owns restoration', () => {
  assert.match(styles, /#app\{scroll-behavior:auto;overflow-anchor:none\}/);
});
