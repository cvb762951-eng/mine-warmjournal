import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { makeSnippet } from '../model.js';

const core = await readFile(new URL('../core.js', import.meta.url), 'utf8');
const journal = await readFile(new URL('../views/journal.js', import.meta.url), 'utf8');
const snippets = await readFile(new URL('../views/snippets.js', import.meta.url), 'utf8');

test('high-capacity albums retain 100 local photos per photo record', () => {
  const photos = Array.from({ length: 101 }, (_, index) => `mine-media://photo-${index}.jpg`);
  assert.equal(makeSnippet({ type: 'photo', photos }).photos.length, 100);
  assert.match(core, /JOURNAL_PHOTO_LIMIT = 60/);
  assert.match(core, /PHOTO_IMPORT_BATCH_LIMIT = 100/);
});

test('journal and moment photo pickers accept multi-select batches and externalize imports', () => {
  assert.match(journal, /importPhotoBatch\(files, compressJournalPhoto\)/);
  assert.match(snippets, /input\.multiple = !useCamera/);
  // 2026-10-09 稳定性修复：进度只增不减（onProgress 接独立计数器），
  // 单张失败不废整批（onItemError 收集失败张数），详见 photo-utils.js importPhotoBatch。
  assert.match(snippets, /onProgress: \(done, total\) => showSnippetImportProgress\(done, total\)/);
  assert.match(snippets, /onItemError: \(\) => \{ failed \+= 1; \}/);
  assert.match(snippets, /SNIPPET_PHOTO_LIMIT = 100/);
});

test('moment photo import shows live progress and drops the per-file size gate', () => {
  assert.match(snippets, /showSnippetImportProgress\(0, files\.length\)/);
  assert.match(snippets, /snippetPhotoImporting/);
  // 进度节点必须挂在「当前真正打开的那个弹窗」上：随手拍有表单弹窗和快捷弹窗两个入口，
  // 写死单一锚点会导致另一个入口完全没有进度显示（2026-10-09 真机反馈二次复现）。
  assert.match(snippets, /function snippetImportAnchor\(\)/);
  assert.match(snippets, /\$\('#snippet-photo-grid'\) \|\| \$\('#quick-photo-preview'\)/);
  // 两个入口的按钮都要进入「处理中」并原样还原。
  assert.match(snippets, /'#quick-capture-snap', '#quick-pick-snap'/);
  assert.match(snippets, /snippetImportButtonIdleHtml/);
  // 快捷弹窗把进度铺在大预览区上。
  assert.match(snippets, /preview\.dataset\.importBusy = '1'/);
  // 20MB 单张门槛已撤：大图交给压缩管线（最长边 1920 / 2MB 内）统一处理。
  assert.doesNotMatch(snippets, /不能超过 20MB/);
});
