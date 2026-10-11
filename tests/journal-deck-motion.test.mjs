import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SpringODE, deckCutDecision } from '../motion.js';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('磁性切牌：没滑够就吸回，滑过或甩出才换篇', () => {
  assert.equal(deckCutDecision({ dx: -10, width: 300, velocity: 0 }), 'stay');
  assert.equal(deckCutDecision({ dx: -80, width: 300, velocity: 0 }), 'next');
  assert.equal(deckCutDecision({ dx: 80, width: 300, velocity: 0 }), 'prev');
  assert.equal(deckCutDecision({ dx: -20, width: 300, velocity: -900 }), 'next');
  assert.equal(deckCutDecision({ dx: 20, width: 300, velocity: 900 }), 'prev');
  assert.equal(deckCutDecision({ dx: -20, width: 300, velocity: 900 }), 'stay');
});

test('弹簧会落定，而不是一直漂着', () => {
  const spring = new SpringODE({ mass: 1, stiffness: 220, damping: 24, precision: 0.2 });
  spring.set(0);
  spring.target = 100;
  let now = 0;
  let settled = false;
  for (let step = 0; step < 180 && !settled; step += 1) {
    now += 16;
    settled = spring.advance(now);
  }
  assert.equal(settled, true);
  assert.ok(Math.abs(spring.current - 100) < 0.5);
});

test('日记浏览用牌组，照片仍交给原来的查看器', async () => {
  const journal = await read('views/journal.js');
  const common = await read('views/common.js');
  const motion = await read('motion.js');
  const styles = await read('styles.css');
  assert.match(journal, /mountJournalDeck/);
  assert.match(journal, /id="journal-past-deck"/);
  assert.match(journal, /id="journal-history-deck"/);
  assert.match(journal, /id="journal-reader-deck"/);
  assert.match(journal, /function openDeckPhoto/);
  assert.match(journal, /photoViewer\(photosWithLiveMotion\(entry\.photos, entry\.livePhotos\), 0\)/);
  assert.match(journal, /photoViewer\(photosWithLiveMotion\(photos, entry\.livePhotos\), Number\(button\.dataset\.viewJournalReaderPhoto\)\)/);
  assert.match(common, /export function bindPhotoViewerGestures/);
  assert.match(common, /未缩放时水平滑动切换/);
  assert.match(styles, /\.photo-viewer-stage\{[^}]*touch-action:none/);
  assert.doesNotMatch(motion, /is-long-image/);
  assert.doesNotMatch(motion, /boxShadow/);
});

test('牌组相框不拉伸，说明在照片下面，切页不靠模糊', async () => {
  const styles = await read('styles.css');
  const performance = await read('performance.css');
  const motion = await read('motion.js');
  assert.match(styles, /\.journal-deck-photo\{[^}]*aspect-ratio:16\/9/);
  assert.match(styles, /\.journal-deck-still\{[^}]*object-fit:contain/);
  assert.match(styles, /\.journal-deck-figure figcaption\{[^}]*position:static/);
  assert.match(styles, /\.journal-deck-stage\{[^}]*touch-action:pan-y/);
  assert.match(styles, /\.journal-deck-host\{[^}]*overflow:hidden/);
  assert.match(styles, /:root\[data-theme="plain"\] \.journal-deck-face\{[^}]*#F4F7FC/);
  assert.match(styles, /:root\[data-theme="plain"\] button\.journal-deck-cut[^}]*background:#E2EAF8/);
  assert.match(styles, /button\.journal-deck-cut:disabled\{[^}]*opacity:\.4/);
  assert.match(styles, /\.journal-deck-stage:focus-visible\{[^}]*outline:2px solid/);
  assert.match(motion, /setAttribute\('aria-live', 'polite'\)/);
  assert.match(motion, /card\.style\.opacity/);
  assert.match(motion, /pool\.get\(key\)/);
  assert.match(motion, /offset\.current = park/);
  assert.match(motion, /if \(event\.target !== stage\) return/);
  assert.match(motion, /card\.inert = true/);
  assert.match(motion, /button\.tabIndex = -1/);
  const dragTilt = motion.slice(motion.indexOf('offset.set(dx);'), motion.indexOf('const finish'));
  assert.match(dragTilt, /if \(!prefersReducedMotion\(\)\)/);
  const rise = performance.slice(performance.indexOf('@keyframes v3-masthead-rise'), performance.indexOf('.today-view .magazine-header > *'));
  assert.match(rise, /transform: translate3d/);
  assert.ok(!rise.includes('blur'));
  assert.ok(!rise.includes('background'));
});

test('统计数字和清简底栏接上弹簧，不新开样式表', async () => {
  const stats = await read('views/stats.js');
  const app = await read('app.js');
  const motion = await read('motion.js');
  const indexHtml = await read('index.html');
  const sheets = [...indexHtml.matchAll(/href="([a-z-]+\.css)/g)].map(match => match[1]);
  assert.match(stats, /data-roll="\$\{habitMetCount\}"/);
  assert.match(stats, /rollNumbers\(statsRoot\)/);
  assert.match(app, /installMagneticDock\(\)/);
  const dock = motion.slice(motion.indexOf('export function installMagneticDock'));
  assert.match(dock, /dataset\.theme !== 'plain' \|\| !canAnimate\(\)/);
  assert.match(dock, /if \(!near\) \{\s*restDock\(\);\s*return;/);
  assert.match(dock, /\.dock-btn\.active/);
  assert.doesNotMatch(dock, /querySelectorAll\('\.floating-dock \.dock-btn'\)/);
  assert.doesNotMatch(dock, /#[fF]{3,8}\b|white/);
  assert.deepEqual(sheets, ['fonts.css', 'performance.css', 'styles.css', 'themes.css', 'themes-plain.css']);
  assert.match(indexHtml, /html\[data-theme="plain"\][\s\S]*#EAF0F8/);
});
