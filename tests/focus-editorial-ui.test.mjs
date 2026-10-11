import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../views/focus.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('Focus Atelier keeps every real timer and sound interaction', () => {
  for (const id of ['fmode-pomo', 'fmode-countdown', 'fmode-stopwatch', 'category-change', 'play', 'reset', 'finish', 'screensaver-trigger', 'ambient-change', 'task-change', 'custom-duration', 'focus-settings-open', 'focus-report-open']) {
    assert.match(source, new RegExp(`id="${id}"`));
  }
  assert.match(source, /data-sound-toggle/);
  assert.match(source, /data-sound-volume/);
  assert.match(source, /data-focus-preference/);
});

test('Focus Atelier is led by generated paper assets instead of modern white cards', async () => {
  const assets = ['focus-page-canvas-v1.png', 'focus-control-strip-v1.png', 'focus-timer-dial-v1.png', 'focus-settings-sheet-v1.png'];
  for (const asset of assets) {
    await access(new URL(`../assets/${asset}`, import.meta.url));
    assert.match(css, new RegExp(asset.replace('.', '\\.')));
  }
  const finalCss = css.slice(css.indexOf('/* Focus Atelier｜'));
  assert.match(finalCss, /focus-mode-selector[\s\S]*?focus-control-strip-v1\.png/);
  assert.match(finalCss, /timer-svg-wrap[\s\S]*?focus-timer-dial-v1\.png/);
  assert.match(finalCss, /focus-stream-sheet[\s\S]*?focus-settings-sheet-v1\.png/);
  assert.doesNotMatch(source, /🍅|⏳|⏱️|💡|🔔|☕|✨/);
});
