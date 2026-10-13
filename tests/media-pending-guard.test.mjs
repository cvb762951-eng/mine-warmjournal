import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

/* 2026-10-13：随手拍拍照后、保存前，别处的 save() 把待保存照片当孤儿挪进回收站，
   保存后记录引用断裂、图片显示不出来。这里锁住两层防护。 */
const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const media = await read('media-store.js');
const app = await read('app.js');

test('新落盘媒体有保护期，清理时跳过', () => {
  assert.match(media, /const FRESH_MEDIA_MS = 24 \* 60 \* 60 \* 1000;/);
  assert.match(media, /if \(isFreshMedia\(file\.name, file\.mtime, now\)\) continue;/);
  assert.match(media, /Date\.now\(\) - \(Number\(record\.updatedAt\) \|\| 0\) < FRESH_MEDIA_MS\) continue;/);
  assert.ok((media.match(/return markFresh\(ref\);/g) || []).length >= 4, '各写入出口都要登记为新媒体');
});

test('被引用却在回收站里的媒体会被挪回', () => {
  assert.match(media, /await recoverTrashedMedia\(\[\.\.\.used\]\.filter\(path => !present\.has\(path\)\)\);/);
  assert.match(media, /export async function recoverReferencedMedia\(state/);
  const boot = app.indexOf('await recoverReferencedMedia(state)');
  assert.ok(boot > 0 && boot < app.indexOf('const migratedMedia = await externalizeStateMedia(state);'), '启动时要先找回再解析地址');
});
