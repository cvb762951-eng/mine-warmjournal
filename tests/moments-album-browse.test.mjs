import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const snippets = await readFile(new URL('../views/snippets.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const common = await readFile(new URL('../views/common.js', import.meta.url), 'utf8');
const calendar = await readFile(new URL('../views/calendar.js', import.meta.url), 'utf8');
const journal = await readFile(new URL('../views/journal.js', import.meta.url), 'utf8');
const taste = await readFile(new URL('../views/taste.js', import.meta.url), 'utf8');
const gallery = await readFile(new URL('../views/local-gallery.js', import.meta.url), 'utf8');
const vault = await readFile(new URL('../views/private-vault.js', import.meta.url), 'utf8');

test('Moments multi-media opens album browse before fullscreen', () => {
  assert.match(snippets, /function openMomentAlbumBrowse/);
  assert.match(snippets, /function openMomentMediaBrowse/);
  assert.match(snippets, /momentAlbumItems/);
  assert.match(snippets, /openMomentMediaBrowse\(entry,/);
  assert.match(snippets, /items\.length > 1\) return openMomentAlbumBrowse/);
  assert.match(snippets, /moment-album-layer/);
  assert.doesNotMatch(snippets, /SECTIONS|SCHEMA_VERSION|state\.snippets\.push.*album/);
});

test('Moments album thumbs reuse shared photo-blur-frame is-edge contain path', () => {
  assert.match(snippets, /moment-album-tile photo-blur-frame is-edge/);
  assert.match(snippets, /snippetPhotoImage\(item\.photo/);
  assert.match(snippets, /photoFrameLayersHtml\(poster/);
  assert.match(css, /\.moment-album-tile/);
  assert.match(css, /\.moment-album-sheet/);
  assert.doesNotMatch(css, /\.moment-album-tile[^{]*\{[^}]*object-fit:\s*cover/);
});

test('Album layer is navigation-only and restores under modal viewer', () => {
  assert.match(snippets, /registerHelper\('isMomentAlbumOpen'/);
  assert.match(snippets, /registerHelper\('closeMomentAlbum'/);
  assert.match(app, /isMomentAlbumOpen/);
  assert.match(app, /closeMomentAlbum/);
  assert.match(snippets, /photoLightbox\(current, index\)/);
  assert.match(snippets, /playSnippetVideo\(video, current, index\)/);
});

test('Content photo surfaces migrated to shared photo-frame helper', () => {
  for (const [name, source] of [
    ['common', common],
    ['calendar', calendar],
    ['journal', journal],
    ['taste', taste],
    ['gallery', gallery],
    ['vault', vault],
    ['snippets', snippets],
  ]) {
    assert.match(source, /photoFrameLayersHtml|photo-blur-frame is-edge/, `${name} should use shared frame`);
  }
  assert.match(common, /activity-photo-thumb photo-blur-frame is-edge/);
  assert.match(common, /journalPhotos[\s\S]*photo-blur-frame is-edge/);
  assert.match(calendar, /day-photo-thumb photo-blur-frame is-edge/);
  assert.match(journal, /journal-polaroid-frame photo-blur-frame is-edge/);
  assert.match(journal, /journal-reader-gallery[\s\S]*photo-blur-frame is-edge/);
  assert.match(taste, /taste-entry-photo photo-blur-frame is-edge/);
  assert.match(gallery, /local-gallery-tile photo-blur-frame is-edge/);
  assert.match(vault, /vault-moment-preview photo-blur-frame is-edge/);
  assert.match(snippets, /snippet-photo-thumb photo-blur-frame is-edge/);
});
