import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const [snippets, motion, common, vault, styles] = await Promise.all(['views/snippets.js', 'motion.js', 'views/common.js', 'views/private-vault.js', 'styles.css'].map(read));

test('moments share transition starts from the clear still layer, not the blurred pad', () => {
  assert.match(snippets, /withSharedTransition\(momentShareSource\(button\)/);
  assert.match(snippets, /img\.photo-blur-still/);
  assert.doesNotMatch(snippets, /withSharedTransition\(button\.querySelector\('img'\)/);
});

test('shared transition always waits for decode (bounded) before the new snapshot', () => {
  assert.doesNotMatch(motion, /target\.tagName === 'IMG' && !target\.complete/);
  assert.match(motion, /Promise\.race\(\[target\.decode/);
  assert.match(motion, /classList\.remove\('is-decoding'\)/);
});

test('viewers hide until decoded and fade in with opacity only, honoring reduced motion', () => {
  assert.match(common, /revealViewerImageWhenDecoded\(\$\('#photo-viewer-image'\)\)/);
  assert.match(vault, /revealViewerImageWhenDecoded\(\$\('#vault-photo-image'\)\)/);
  assert.match(styles, /\.photo-viewer-stage img\.is-decoding,\.vault-photo-stage img\.is-decoding\{opacity:0\}/);
  assert.match(styles, /prefers-reduced-motion:reduce\)\{\.photo-viewer-stage img,\.vault-photo-stage img\{transition:none!important\}/);
});

test('revealViewerImageWhenDecoded reveals after decode and skips video', async () => {
  const { revealViewerImageWhenDecoded } = await import('../photo-frame.js');
  const classes = new Set();
  let resolve;
  const img = { tagName: 'IMG', complete: false, dataset: {}, classList: { add: c => classes.add(c), remove: c => classes.delete(c) }, decode: () => new Promise(r => { resolve = r; }) };
  revealViewerImageWhenDecoded(img);
  assert.ok(classes.has('is-decoding'));
  resolve(); await new Promise(r => setTimeout(r, 0));
  assert.ok(!classes.has('is-decoding'));
  assert.equal(img.dataset.decoded, '1');
  revealViewerImageWhenDecoded({ tagName: 'VIDEO' });
});

test('moments open uses FLIP enlarge from sharp still, decode before reveal', () => {
  assert.match(snippets, /preferFlip:\s*true/);
  assert.match(snippets, /momentShareSource\(button\)/);
  const shared = motion.slice(motion.indexOf('export function beginSharedElement'), motion.indexOf('export function staggerIn'));
  assert.match(shared, /decodeWait/);
  assert.match(shared, /object-fit:\$\{fit\}/);
  assert.match(shared, /Promise\.all\(\[flight\.finished/);
  assert.match(shared, /opacity: 1/);
  assert.match(motion, /preferFlip/);
});
