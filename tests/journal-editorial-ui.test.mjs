import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../views/journal.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const main = source.slice(source.indexOf('export function journalView'), source.indexOf('function bindJournalView'));

test('Journal reference page remains driven by real journal state and footprints', () => {
  assert.match(main, /const journalEntry = state\.journals\[day\]/);
  assert.match(main, /Object\.entries\(state\.journals\)/);
  assert.match(main, /journalFootprints\(day\)/);
  assert.match(main, /const currentPhotos = restoredDraft\?\.photos \|\| journalEntry\?\.photos \|\| \[\]/);
  assert.match(main, /journalPhotoWall\(currentPhotos, day, currentLive\)/);
  assert.doesNotMatch(main, /referenceFixture|demoJournal|previewJournal/);
});

test('Journal keeps all real editing controls and history routes', () => {
  for (const id of ['journal-date-input','journal-add-screen-photo','journal-format-btn','journal-ai-guide','journal-import-snippets','journal-title-input','journal-content-input','journal-screen-save','journal-history']) {
    assert.match(source, new RegExp(`id="${id}"|#${id}`));
  }
  assert.match(source, /data-draft-mood="\$\{key\}"/);
  assert.match(source, /data-draft-weather="\$\{key\}"/);
  assert.match(source, /data-open-journal="\$\{entry\.date\}"/);
});

test('Journal photo wall does not render redundant captions under photos', () => {
  const wall = source.slice(source.indexOf('function journalPhotoWall'), source.indexOf('function journalSnippetPicker'));
  assert.doesNotMatch(wall, /polaroid-mini-cap|Moment \$\{index/);
  assert.match(wall, /aria-label="查看第 \$\{index \+ 1\} 张日记照片"/);
});

test('past journal entries open the reader or editor instead of the calendar', () => {
  assert.match(source, /function openPastJournal\(day\)/);
  assert.match(source, /if \(state\.journals\[normalized\]\.content\?\.trim\(\)\) \{\s*openJournalReader\(normalized\);/s);
  assert.match(source, /setJournalEditingDay\(normalized\)/);
  assert.match(source, /go\('journal'\)/);
  assert.match(source, /registerHelper\('openPastJournal', openPastJournal\)/);
  assert.match(source, /button\.onclick = onPastJournalClick/);
  assert.match(app, /callHelper\('openPastJournal', openJournal\.dataset\.openJournal\)/);
  assert.doesNotMatch(app, /closest\('\[data-open-journal\]'\)[\s\S]{0,280}go\('calendar'/);
});

test('Journal can edit a selected past date across every write path', () => {
  assert.match(source, /let journalEditingDay = dateKey\(\)/);
  assert.match(source, /function setJournalEditingDay\(day\)/);
  assert.match(source, /id="journal-date-input"[^>]*max="\$\{dateKey\(\)\}"/);
  assert.match(source, /applyInlineSnippets\(journalEditingDay\)/);
  assert.match(source, /addPhotosToJournal\(journalEditingDay\)/);
  assert.match(source, /state\.journals\[day\] =/);
  assert.match(source, /registerHelper\('setJournalEditingDay', setJournalEditingDay\)/);
  assert.match(css, /\.journal-date-control\{/);
});

test('Journal history opens a bounded paper archive instead of an unbounded lead image', () => {
  assert.match(source, /large-modal journal-history-modal/);
  assert.match(css, /journal-history-modal \.journal-history img[^}]*width:72px[^}]*height:72px/);
  assert.match(css, /journal-archive-drawer-v1\.png/);
  assert.match(css, /modal\.journal-history-modal\{[^}]*display:flex[^}]*flex-direction:column/);
  assert.match(css, /journal-history-modal \.journal-history\{[^}]*flex:1 1 auto[^}]*min-height:0[^}]*overflow-y:auto/);
  assert.match(css, /scroll-padding-bottom:96px/);
});

test('Journal reader shows every photo uncropped and opens the full album', () => {
  assert.match(source, /photos\.map\(\(photo, index\) =>/);
  assert.match(source, /data-view-journal-reader-photo/);
  assert.match(source, /photoViewer\(photosWithLiveMotion\(photos, entry\.livePhotos\), Number\(button\.dataset\.viewJournalReaderPhoto\)\)/);
  assert.doesNotMatch(source, /imgSrc\(photos\[0\]\)/);
  assert.match(css, /journal-reader-gallery img\{[^}]*object-fit:contain/);
  assert.match(css, /\.modal\.photo-modal\{[^}]*height:100dvh[^}]*background:#05070b/);
  assert.match(css, /\.photo-viewer-stage img,[^{]*\{[^}]*object-fit:contain/);
});

test('Journal inputs are integrated into paper instead of nested modern cards', () => {
  const journalCss = css.slice(css.indexOf('/* Journal 1:1 画报复刻'));
  assert.match(journalCss, /journal-canvas-card #journal-title-input[^}]*border:0/);
  assert.match(journalCss, /journal-canvas-card #journal-content-input[^}]*border:0/);
  assert.match(journalCss, /journal-canvas-card #journal-content-input[^}]*background:transparent/);
  assert.match(journalCss, /journal-canvas-card[^}]*today-bento-paper-thick\.png/);
  assert.doesNotMatch(journalCss, /journal-(?:source|reference|fixture)\.(?:png|jpg|webp)/);
});

test('Journal typography icons paper sections and active Dock match the reference system', () => {
  assert.match(css, /Journal 1:1 画报复刻/);
  assert.match(css, /journal-view \.picker-section-label[^}]*background-color:#a93f28/);
  assert.match(css, /journal-view \.journal-photo-wall-head[^}]*background-color:#a93f28/);
  assert.match(css, /phone-shell:has\(\.journal-view\) \.dock-btn\.active/);
  assert.match(main, /material-symbols-outlined">location_on/);
  assert.match(main, /material-symbols-outlined">edit_document/);
});

test('Journal scales the annotated wide preview without restoring the bottom blank gap', () => {
  const journalCss = css.slice(css.indexOf('/* Journal 1:1 画报复刻'));
  assert.match(journalCss, /min-height:100dvh/);
  assert.match(journalCss, /picker-section-label>span/);
  assert.match(journalCss, /@media\(min-width:480px\)/);
  assert.match(journalCss, /journal-magazine-hero-box\{height:auto;min-height:420px/);
  assert.match(journalCss, /journal-canvas-card\{min-height:165px/);
  assert.match(journalCss, /journal-preview-row\{min-height:76px/);
  assert.match(journalCss, /journal-history-link\{width:73%;min-height:52px/);
  assert.match(journalCss, /journal-view#screen-journal::before/);
  assert.match(journalCss, /today-paper-texture\.png'\) center\/500px 500px repeat/);
  assert.doesNotMatch(journalCss, /journal-editorial-backdrop\.png/);
});
