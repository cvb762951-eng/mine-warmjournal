import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const motion = readFileSync(new URL('../motion.js', import.meta.url), 'utf8');
const journal = readFileSync(new URL('../views/journal.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function load(name) {
  const m = motion.match(new RegExp(`export function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(m, name);
  return new Function(`${m[0].replace('export ', '')}; return ${name};`)();
}

test('点照片换下一张，最后一张回到第一张，单张不动', () => {
  const next = load('nextDeckPhotoIndex');
  assert.equal(next(0, 4), 1);
  assert.equal(next(3, 4), 0);
  assert.equal(next(0, 1), null);
  assert.equal(next(0, 0), null);
});

test('只有短按且几乎没动才算轻点，不和拖动冲突', () => {
  const tap = load('isDeckTap');
  assert.equal(tap({ dx: 2, dy: 3, ms: 120 }), true);
  assert.equal(tap({ dx: 12, dy: 0, ms: 100 }), false);
  assert.equal(tap({ dx: 1, dy: 1, ms: 400 }), false);
});

test('牌组不再打开放大查看器，阅读页的放大和长图查看器保留', () => {
  assert.doesNotMatch(journal, /openDeckPhoto/);
  assert.doesNotMatch(motion, /options\.onPhoto/);
  assert.match(journal, /data-view-journal-reader-photo[\s\S]*photoViewer\(/);
  assert.match(journal, /data-view-journal-screen-photo|viewJournalScreenPhoto/);
  assert.match(journal, /photos: \(entry\.photos \|\| \[\]\)\.map/);
});

test('换图先预载再换、多张才显示圆点、尊重减少动态', () => {
  assert.match(motion, /new Image\(\)[\s\S]*img\.onload/);
  assert.match(motion, /photos\.length > 1[\s\S]*journal-deck-photo-dots/);
  assert.match(motion, /prefersReducedMotion\(\)\) \{ swap\(\)/);
  assert.match(styles, /prefers-reduced-motion:reduce\)\{\.journal-deck-photo \.photo-blur-still/);
});
