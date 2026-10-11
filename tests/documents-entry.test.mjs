import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mine = await readFile(new URL('../views/mine.js', import.meta.url), 'utf8');
const documents = await readFile(new URL('../views/documents.js', import.meta.url), 'utf8');
const share = await readFile(new URL('../views/incoming-share.js', import.meta.url), 'utf8');

test('我的生活里有资料库入口，并打开已有的 documents 路由', () => {
  assert.match(mine, /id="open-documents"/);
  assert.match(mine, /资料库/);
  assert.match(mine, /Word、PDF，以及分享进来的文件/);
  const binder = mine.slice(mine.indexOf('function bindMine'), mine.indexOf('// ---- 表单提交'));
  assert.match(binder, /\$\('#open-documents'\)\?\.addEventListener\('click', \(\) => \{ pushBackState\(\); go\('documents'\); \}\)/);
  assert.match(documents, /registerView\('documents', documentsView\)/);
});

test('分享写入资料库的路径保留', () => {
  assert.match(share, /state\.documents\.push\(doc\)/);
  assert.match(share, /IncomingShare\.commitDocument/);
});
