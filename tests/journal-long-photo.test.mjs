import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const [coreSource, photoSource, journalSource, commonSource, vaultSource, styleSource, todaySource, snippetsSource] = await Promise.all([
  read('core.js'), read('photo-utils.js'), read('views/journal.js'), read('views/common.js'),
  read('views/private-vault.js'), read('styles.css'), read('views/today.js'), read('views/snippets.js')
]);

test('journal photo import drops the hard byte gate and keeps the count limit', () => {
  assert.match(coreSource, /JOURNAL_PHOTO_LIMIT = 60/);
  assert.doesNotMatch(coreSource, /JOURNAL_PHOTO_MAX_BYTES/);
  assert.doesNotMatch(journalSource, /不能超过 20MB/);
  assert.match(journalSource, /importPhotoBatch\(files, compressJournalPhoto, \{ onLivePhoto:/);
  assert.match(photoSource, /maxBytes: Number\.POSITIVE_INFINITY/);
  assert.match(photoSource, /action: 'keep'/);
  assert.doesNotMatch(photoSource.slice(photoSource.indexOf('export async function compressJournalPhoto'), photoSource.indexOf('export function compressSnippetPhoto')), /480 \* 1024/);
});

test('today photo story and moment frames stay in the shared contain frame', () => {
  assert.match(todaySource, /function photoStoryImage/);
  assert.doesNotMatch(todaySource, /is-long-image/);
  assert.doesNotMatch(snippetsSource, /is-long-image/);
  assert.match(styleSource, /\.snippet-photo-tile img\{[^}]*object-fit:contain/);
  assert.match(styleSource, /\.photo-viewer-stage img,[^{]*\{[^}]*object-fit:contain/);
  assert.match(styleSource, /\.photo-viewer-stage\.is-long-image img\{[^}]*height:auto/);
  assert.match(styleSource, /\.vault-photo-stage\.is-long-image img\{[^}]*height:auto/);
  assert.match(styleSource, /\.vault-photo-stage img\{[^}]*object-fit:contain/);
});

const elements = new Map();
globalThis.document = {
  documentElement: { classList: { toggle() {} }, style: {} },
  body: { classList: { add() {}, remove() {} } },
  querySelector(selector) { return elements.get(selector) || null; },
  querySelectorAll() { return []; },
  addEventListener() {}
};
globalThis.window = { addEventListener() {} };

const { JOURNAL_PHOTO_MAX_SIDE, JOURNAL_PHOTO_KEEP_MAX_SIDE } = await import('../core.js');
const { journalPhotoImportPlan, rasterSizeFromBytes, isLongStillImage, clampStillTransform, compressJournalPhoto, readRasterSize } = await import('../photo-utils.js');
const { bindPhotoViewerGestures } = await import('../views/common.js');

test('journal keeps a normal photo and only reencodes when memory is tight', () => {
  assert.ok(JOURNAL_PHOTO_MAX_SIDE >= 1920);
  assert.ok(JOURNAL_PHOTO_KEEP_MAX_SIDE >= JOURNAL_PHOTO_MAX_SIDE);
  const kept = journalPhotoImportPlan({ fileSize: 8 * 1024 * 1024, width: 4032, height: 3024 });
  assert.equal(kept.action, 'keep');
  const longShot = journalPhotoImportPlan({ fileSize: 6 * 1024 * 1024, width: 1080, height: 15000 });
  assert.equal(longShot.action, 'keep');
  const huge = journalPhotoImportPlan({ fileSize: 10 * 1024 * 1024, width: 8000, height: 6000 });
  assert.equal(huge.action, 'reencode');
  assert.ok(huge.maxSide >= 1920);
  assert.ok(huge.maxSide < 8000);
  assert.equal(huge.quality, 0.92);
  const heavyFile = journalPhotoImportPlan({ fileSize: 60 * 1024 * 1024, width: 2000, height: 3000 });
  assert.equal(heavyFile.action, 'reencode');
});

test('a modest journal photo is stored as its original data url', async () => {
  const png = new Uint8Array(32);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer);
  view.setUint32(16, 1080);
  view.setUint32(20, 4200);
  const file = new File([png], 'long.png', { type: 'image/png' });
  assert.deepEqual(await readRasterSize(file), { width: 1080, height: 4200 });
  const stored = await compressJournalPhoto(file);
  assert.match(stored, /^data:image\/png;base64,/);
  assert.equal(stored.length > 20, true);
});

test('raster headers report png and jpeg sizes without decoding pixels', () => {
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer);
  view.setUint32(16, 1080);
  view.setUint32(20, 6400);
  assert.deepEqual(rasterSizeFromBytes(png, 'image/png'), { width: 1080, height: 6400 });
  const jpeg = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x17, 0x70, 0x04, 0x38, 0x01, 0x11, 0x00
  ]);
  assert.deepEqual(rasterSizeFromBytes(jpeg, 'image/jpeg'), { width: 1080, height: 6000 });
});

test('long stills scroll vertically while ordinary portraits keep entry swipes', () => {
  const frame = { width: 390, height: 800 };
  assert.equal(isLongStillImage(1080, 6400, frame.width, frame.height), true);
  assert.equal(isLongStillImage(1080, 1440, frame.width, frame.height), false);
  assert.equal(isLongStillImage(0, 6400, frame.width, frame.height), false);
  const baseHeight = frame.width * (6400 / 1080);
  const top = clampStillTransform({ longMode: true, baseHeight, scale: 1, x: 30, y: 40, width: frame.width, height: frame.height });
  assert.equal(top.y, 0);
  assert.equal(top.x, 0);
  const bottom = clampStillTransform({ longMode: true, baseHeight, scale: 1, x: 0, y: -99999, width: frame.width, height: frame.height });
  assert.equal(bottom.y, frame.height - baseHeight);
  const portrait = clampStillTransform({ longMode: false, baseHeight: 0, scale: 1, x: 12, y: -20, width: frame.width, height: frame.height });
  assert.deepEqual({ scale: portrait.scale, x: portrait.x, y: portrait.y }, { scale: 1, x: 0, y: 0 });
});

function stageFor(image, options = {}) {
  const stage = {
    className: '',
    classList: { toggle(name, on) { stage.className = on ? name : ''; } },
    setPointerCapture() {},
    getBoundingClientRect() { return { width: 390, height: 800 }; }
  };
  const chrome = { classList: { toggle() {} } };
  elements.set('#photo-viewer-stage', stage);
  elements.set('#photo-viewer-image', image);
  elements.set('.photo-viewer-chrome', chrome);
  elements.set('.photo-viewer-chrome footer small', { textContent: '' });
  bindPhotoViewerGestures(['one', 'two'], null, 0, options);
  return stage;
}

test('a loaded long image pans vertically and does not switch moment entries', () => {
  const directions = [];
  const image = {
    tagName: 'IMG',
    naturalWidth: 1080,
    naturalHeight: 6400,
    complete: true,
    style: {},
    classList: { toggle() {} },
    addEventListener() {}
  };
  const stage = stageFor(image, { onVerticalNavigate: direction => directions.push(direction) });
  assert.equal(stage.className, 'is-long-image');
  stage.onpointerdown({ pointerId: 1, clientX: 120, clientY: 400 });
  stage.onpointermove({ pointerId: 1, clientX: 124, clientY: 220 });
  assert.deepEqual(directions, []);
  assert.match(image.style.transform, /translate3d\(0px,-180px,0\) scale\(1\)/);
  assert.match(elements.get('.photo-viewer-chrome footer small').textContent, /上下滑动浏览长图/);
});

test('ordinary portrait photos still switch entries on a vertical swipe', () => {
  const directions = [];
  const image = {
    tagName: 'IMG',
    naturalWidth: 1080,
    naturalHeight: 1440,
    complete: true,
    style: {},
    classList: { toggle() {} },
    addEventListener() {}
  };
  const stage = stageFor(image, { onVerticalNavigate: direction => directions.push(direction) });
  assert.equal(stage.className, '');
  stage.onpointerdown({ pointerId: 1, clientX: 120, clientY: 200 });
  stage.onpointermove({ pointerId: 1, clientX: 126, clientY: 290 });
  assert.deepEqual(directions, [1]);
});

test('vault still images use the same long-image viewer', () => {
  assert.match(vaultSource, /measureLongStill/);
  assert.match(vaultSource, /is-long-image/);
  assert.match(commonSource, /上下滑动浏览长图/);
  assert.match(commonSource, /options\.onVerticalNavigate\(totalDy > 0 \? 1 : -1\)/);
});
