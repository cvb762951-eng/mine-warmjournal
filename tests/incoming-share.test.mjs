import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const native = await readFile(new URL('../android/app/src/main/java/com/mine/focus/IncomingSharePlugin.java', import.meta.url), 'utf8');
const main = await readFile(new URL('../android/app/src/main/java/com/mine/focus/MainActivity.java', import.meta.url), 'utf8');
const view = await readFile(new URL('../views/incoming-share.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('Android advertises single and multiple share targets and stages streams outside WebView memory', () => {
  assert.match(manifest, /android\.intent\.action\.SEND/);
  assert.match(manifest, /android\.intent\.action\.SEND_MULTIPLE/);
  assert.match(manifest, /android:mimeType="\*\/\*"/);
  assert.match(main, /registerPlugin\(IncomingSharePlugin\.class\)/);
  assert.match(main, /mine-incoming-share/);
  assert.match(native, /\.mine-share-inbox/);
  assert.match(native, /byte\[1024 \* 1024\]/);
  assert.match(native, /MAX_FILES = 100/);
  assert.match(native, /clearStaleSessions/);
});

test('incoming shares require confirmation and expose destination choices before formal persistence', () => {
  assert.match(view, /保存到暖色生活志/);
  assert.match(view, /随手记/);
  assert.match(view, /今天的日记/);
  assert.match(view, /随手拍/);
  assert.match(view, /私密空间/);
  assert.match(view, /资料库保存路径/);
  assert.match(view, /documentFolderId/);
  assert.match(view, /vaultFolderId/);
  assert.match(view, /验证并选择文件夹/);
  assert.match(view, /await unlockPrivateVault/);
  assert.match(view, /await IncomingShare\.discard/);
  assert.match(view, /createdVaultRefs\.push\(\.\.\.\[/);
  assert.match(view, /if \(!previousVault\) previousVault = structuredClone\(content\)/);
  assert.match(view, /start \+= 60/);
  assert.match(view, /savedItems\.slice\(start, start \+ 60\)/);
  assert.match(app, /checkIncomingShare/);
  assert.match(app, /isIncomingShareOpen/);
  assert.match(css, /incoming-share-modal/);
  assert.match(css, /incoming-vault-folder\[hidden\]\{display:none!important\}/);
});

test('incoming share save rolls back records and copied files after a failure', () => {
  assert.match(view, /previousSnippets = structuredClone/);
  assert.match(view, /previousJournals = structuredClone/);
  assert.match(view, /previousDocuments = structuredClone/);
  assert.match(view, /deleteMediaReference/);
  assert.match(view, /deleteDocument/);
  assert.match(view, /deleteVaultAssets/);
  assert.match(view, /await save\(\);[\s\S]*await IncomingShare\.discard/);
});
