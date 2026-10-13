import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const thumbs = await read('photo-thumbs.js');
const mediaStore = await read('media-store.js');
const snippets = await read('views/snippets.js');
const vault = await read('views/private-vault.js');
const frame = await read('photo-frame.js');

const { thumbKeyFor, thumbSize, thumbSource, THUMB_ROOT, THUMB_DB } = await import('../photo-thumbs.js');

test('缩略图键只从媒体引用派生，拒绝路径穿越和不支持的来源', () => {
  assert.equal(thumbKeyFor('mine-media://abc.jpg'), 'abc.thumb.jpg');
  assert.equal(thumbKeyFor('mine-browser-media://k1.png'), 'k1.thumb.jpg');
  assert.equal(thumbKeyFor('data:image/jpeg;base64,AAAA'), '');
  assert.equal(thumbKeyFor('https://x/y.jpg'), '');
  assert.equal(thumbKeyFor('mine-media://../evil.jpg'), '');
  assert.equal(thumbKeyFor('mine-media://.trash/x.jpg'), '');
  assert.equal(thumbKeyFor(''), '');
});

test('等比缩小、长边 480、不放大', () => {
  assert.deepEqual(thumbSize(4000, 3000), { width: 480, height: 360 });
  assert.deepEqual(thumbSize(3000, 4000), { width: 360, height: 480 });
  assert.deepEqual(thumbSize(200, 100), { width: 200, height: 100 });
});

test('没有缩略图时回退原图地址', () => {
  assert.equal(thumbSource('data:image/png;base64,AA'), 'data:image/png;base64,AA');
  assert.equal(thumbSource(''), '');
});

test('清理保护：缩略图存在媒体目录 / 媒体库之外，removeUnusedMedia 看不到', () => {
  const mediaRoot = mediaStore.match(/const ROOT = '([^']+)'/)[1];
  const mediaDb = mediaStore.match(/const BROWSER_DB = '([^']+)'/)[1];
  assert.notEqual(THUMB_ROOT, mediaRoot);
  assert.ok(!THUMB_ROOT.startsWith(`${mediaRoot}/`), '缩略图目录不能放在媒体目录里');
  assert.notEqual(THUMB_DB, mediaDb, '浏览器端缩略图必须用独立的 IndexedDB 库');
  const cleanup = mediaStore.match(/export async function removeUnusedMedia\([\s\S]*?\n\}/)[0];
  assert.match(cleanup, /readdir\(\{ path: ROOT,/, '原生清理只扫描媒体目录');
  assert.match(cleanup, /file\.type === 'directory'\) continue/, '子目录一律不处理');
  assert.doesNotMatch(cleanup, /Thumb/i);
});

test('缩略图模块从不修改、删除、移动原图', () => {
  assert.doesNotMatch(thumbs, /deleteFile|rename\(|deleteMediaReference|removeUnusedMedia|restoreMediaReferenceData|s\.delete\(|store\.delete\(/);
  assert.doesNotMatch(thumbs, /state\./, '不写 state');
  assert.match(thumbs, /writeFile\(\{ path, data, directory: Directory\.Data/);
  assert.match(thumbs, /const path = `\$\{THUMB_ROOT\}\/\$\{key\}`/);
});

test('EXIF 方向按原图转正', () => {
  assert.match(thumbs, /createImageBitmap\(blob, \{ imageOrientation: 'from-image' \}\)/);
});

test('私密空间不用缩略图；备份不经过缩略图', async () => {
  assert.doesNotMatch(vault, /photo-thumbs/);
  assert.doesNotMatch(await read('backup.js'), /thumb/i);
  assert.doesNotMatch(mediaStore, /thumb/i);
});

test('只有随手拍列表换成缩略图，大图层 / 编辑器仍用原图', () => {
  assert.match(snippets, /snippetPhotoImage\(photo, entry\.text \|\| `随手拍 \$\{index \+ 1\}`, \{ thumb: true \}\)/);
  assert.match(snippets, /snippetPhotoImage\(item\.photo, entry\.text \|\| `随手拍 \$\{item\.index \+ 1\}`\)/, '图集大牌仍用原图');
  assert.match(snippets, /snippetPhotoImage\(photo, `待保存照片 \$\{index \+ 1\}`\)/, '编辑器待保存照片仍用原图');
  assert.match(snippets, /watchThumbImages\(scope\)/);
  // 不传 thumbRef 时 photoFrameLayersHtml 输出和旧版一致
  assert.match(frame, /thumbRef \? ` data-thumb-ref=/);
});

const mine = await read('views/mine.js');

test('clearThumbCache 只删缩略图目录和缩略图库，永不抛错', async () => {
  const fn = thumbs.match(/export async function clearThumbCache\(\)[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(fn);
  assert.equal(THUMB_ROOT, 'MineWarmJournalThumbs');
  assert.equal(THUMB_DB, 'mine_warmjournal_thumbs');
  assert.match(fn, /rmdir\(\{ path: THUMB_ROOT, directory: Directory\.Data, recursive: true \}\)/);
  assert.match(fn, /deleteDatabase\(THUMB_DB\)/);
  assert.doesNotMatch(fn, /MineWarmJournalMedia|MineWarmJournalVault|deleteFile|BROWSER_DB|mine_warmjournal_media/);
  assert.match(fn, /catch \{/);
  const { clearThumbCache } = await import('../photo-thumbs.js');
  await assert.doesNotReject(clearThumbCache());
});

test('恢复成功路径在 finalize 之后清缩略图，且失败被吞掉', () => {
  const handler = mine.match(/registerSubmitHandler\('restore-form'[\s\S]*?\n\}\);/)?.[0] || '';
  assert.match(handler, /await finalizeImportedBackup\(\);[\s\S]*?await clearThumbCache\(\)\.catch\(\(\) => \{\}\);[\s\S]*?show\('数据恢复完成'\)/);
  const catchBlock = handler.slice(handler.indexOf('} catch (error)'));
  assert.doesNotMatch(catchBlock, /clearThumbCache/);
});
