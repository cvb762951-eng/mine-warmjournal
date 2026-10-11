import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { makeDefaultState, migrateState, SCHEMA_VERSION } from '../model.js';
import { setupPrivateVault, unlockPrivateVault, unlockPrivateVaultWithKey, privateVaultKeyBase64, privateVaultContent, privateVaultUnlocked, persistPrivateVault, lockPrivateVault, vaultPlayableDuration, vaultItemEdited, vaultItemOrientation, vaultFrameSize } from '../private-vault.js';

const view = await readFile(new URL('../views/private-vault.js', import.meta.url), 'utf8');
const vaultCore = await readFile(new URL('../private-vault.js', import.meta.url), 'utf8');
const store = await readFile(new URL('../vault-media-store.js', import.meta.url), 'utf8');
const native = await readFile(new URL('../android/app/src/main/java/com/mine/focus/NativeMediaStorePlugin.java', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const editor = await readFile(new URL('../video-editor.js', import.meta.url), 'utf8');
const themes = await readFile(new URL('../themes.css', import.meta.url), 'utf8');
const core = await readFile(new URL('../core.js', import.meta.url), 'utf8');
const storage = await readFile(new URL('../storage.js', import.meta.url), 'utf8');
const nativeMedia = await readFile(new URL('../android/app/src/main/java/com/mine/focus/NativeMediaStorePlugin.java', import.meta.url), 'utf8');
const deleteActivity = await readFile(new URL('../android/app/src/main/java/com/mine/focus/OriginalMediaDeleteActivity.java', import.meta.url), 'utf8');
const manifest = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');

test('private vault metadata remains encrypted until the correct password is supplied', async () => {
  const state = makeDefaultState();
  await setupPrivateVault(state, '246810');
  privateVaultContent().folders.push({ id: 'secret-folder', name: '不会公开的相册', coverItemId: 'cover-1', createdAt: 1, updatedAt: 1 });
  await persistPrivateVault(state);
  assert.equal(JSON.stringify(state.privateVault).includes('不会公开的相册'), false);
  await lockPrivateVault();
  assert.equal(privateVaultUnlocked(), false);
  await assert.rejects(() => unlockPrivateVault(state, '000000'), /私密密码错误/);
  await unlockPrivateVault(state, '246810');
  assert.equal(privateVaultContent().folders[0].name, '不会公开的相册');
  assert.equal(privateVaultContent().folders[0].coverItemId, 'cover-1');
  await lockPrivateVault();
});

test('private vault persistence preserves a held content reference across sequential imports', async () => {
  const state = makeDefaultState();
  await setupPrivateVault(state, '246810');
  const held = privateVaultContent();
  held.items.push({ id: 'batch-1', type: 'video', name: 'one.mp4', assetRef: 'mine-media://one.mp4' });
  await persistPrivateVault(state);
  held.items.push({ id: 'batch-2', type: 'video', name: 'two.mp4', assetRef: 'mine-media://two.mp4' });
  await persistPrivateVault(state);
  assert.strictEqual(privateVaultContent(), held);
  assert.deepEqual(privateVaultContent().items.map(item => item.id), ['batch-1', 'batch-2']);
  await lockPrivateVault();
  await unlockPrivateVault(state, '246810');
  assert.deepEqual(privateVaultContent().items.map(item => item.id), ['batch-1', 'batch-2']);
  await lockPrivateVault();
});

test('vault saves keep the item the player is holding so a later watch is not dropped', async () => {
  const state = makeDefaultState();
  await setupPrivateVault(state, '246810');
  const content = privateVaultContent();
  content.items.push(
    { id: 'video-a', type: 'video', name: 'a.mp4', assetRef: 'mine-media://a.mp4', position: 0, watchHistory: [{ id: 's1', startedAt: 1_000, endedAt: 9_000, watchedSeconds: 8, startPosition: 0, endPosition: 8, completion: 0.2 }] },
    { id: 'video-b', type: 'video', name: 'b.mp4', assetRef: 'mine-media://b.mp4', position: 0, watchHistory: [] }
  );
  const heldA = content.items[0];
  const heldB = content.items[1];
  await persistPrivateVault(state);
  assert.strictEqual(privateVaultContent().items.find(item => item.id === 'video-a'), heldA);
  assert.strictEqual(privateVaultContent().items.find(item => item.id === 'video-b'), heldB);
  heldB.watchHistory = [{ id: 's2', startedAt: 3_000, endedAt: 9_000, watchedSeconds: 6, startPosition: 1, endPosition: 7, completion: 0.4 }];
  heldA.position = 12;
  const first = persistPrivateVault(state);
  heldB.watchHistory = [...heldB.watchHistory, { id: 's3', startedAt: 10_000, endedAt: 16_000, watchedSeconds: 5, startPosition: 7, endPosition: 12, completion: 0.6 }];
  const second = persistPrivateVault(state);
  await first;
  await second;
  await lockPrivateVault();
  await unlockPrivateVault(state, '246810');
  const savedA = privateVaultContent().items.find(item => item.id === 'video-a');
  const savedB = privateVaultContent().items.find(item => item.id === 'video-b');
  assert.equal(savedA.position, 12);
  assert.equal(savedA.watchHistory[0].id, 's1');
  assert.deepEqual(savedB.watchHistory.map(session => session.id), ['s2', 's3']);
  await lockPrivateVault();
});

test('private vault can unlock from its wrapped data key without changing encrypted content', async () => {
  const state = makeDefaultState();
  await setupPrivateVault(state, '246810');
  privateVaultContent().folders.push({ id: 'fingerprint-folder', name: '指纹相册', createdAt: 1, updatedAt: 1 });
  await persistPrivateVault(state);
  const secret = privateVaultKeyBase64();
  const encrypted = JSON.stringify(state.privateVault);
  await lockPrivateVault();
  await unlockPrivateVaultWithKey(state, secret);
  assert.equal(privateVaultContent().folders[0].name, '指纹相册');
  assert.equal(JSON.stringify(state.privateVault), encrypted);
  await lockPrivateVault();
  await assert.rejects(() => unlockPrivateVaultWithKey(state, 'AAAA'), /指纹密钥失效/);
});

test('private video watch history stays encrypted normalized and bounded', async () => {
  const state = makeDefaultState();
  await setupPrivateVault(state, '246810');
  privateVaultContent().items.push({
    id: 'watched-video', type: 'video', name: 'watched.mp4', assetRef: 'mine-media://watched.mp4',
    watchHistory: Array.from({ length: 105 }, (_, index) => ({ id: `watch-${index}`, startedAt: 1000 + index, endedAt: 2000 + index, watchedSeconds: index === 0 ? 2 : 8, startPosition: index, endPosition: index + 8, completion: 1.4 }))
  });
  await persistPrivateVault(state);
  assert.equal(JSON.stringify(state.privateVault).includes('watch-104'), false);
  assert.equal(privateVaultContent().items[0].watchHistory.length, 100);
  assert.equal(privateVaultContent().items[0].watchHistory.at(-1).completion, 1);
  await lockPrivateVault();
  await unlockPrivateVault(state, '246810');
  assert.equal(privateVaultContent().items[0].watchHistory.length, 100);
  await lockPrivateVault();
});

test('private vault opens on an album home with unfiled sorting covers and bulk organization', () => {
  assert.match(view, /let vaultBrowseMode = 'folders'/);
  assert.match(view, /全部内容/);
  assert.match(view, /未分类/);
  assert.match(view, /vault-folder-grid/);
  assert.match(view, /vault-folder-sort/);
  assert.match(view, /data-vault-cover-item/);
  assert.match(view, /vault-folder-cover-picker/);
  assert.match(view, /vaultSelectionMode/);
  assert.match(view, /vault-bulk-move-form/);
  assert.match(view, /deleteSelectedVaultItems/);
  assert.match(view, /已经有同名文件夹/);
  assert.match(css, /\.vault-folder-grid\{[^}]*grid-template-columns:repeat\(2/);
  assert.match(css, /\.vault-folder-copy\{[^}]*min-height:58px[^}]*editorial-torn-paper-strip\.png/);
  // 封面已是「统一比例 + 虚化铺底 + 内容完整」两层结构，
  // 详见 tests/vault-cover-display.test.mjs（那里逐条守着这对矛盾的调和）。
  assert.match(view, /const cover = cached \? vaultCoverImage\(cached, folder\.name\)/);
  assert.match(css, /\.vault-cover-main\{[^}]*object-fit:contain/);
  assert.match(css, /\.vault-bulk-bar\{[^}]*position:sticky/);
});

test('each private collection can filter all photos or videos without changing folder ownership', () => {
  assert.match(view, /let vaultMediaFilter = 'all'/);
  assert.match(view, /data-vault-media-filter="all"/);
  assert.match(view, /data-vault-media-filter="photo"/);
  assert.match(view, /data-vault-media-filter="video"/);
  // 筛选值现在是一组互斥选项：全部 / 照片 / 视频 / 竖屏 / 横屏
  // （方向筛选的细节见 tests/vault-orientation-filter.test.mjs）
  assert.match(view, /const scoped = vaultItemsForBrowseScope\(content\)/);
  assert.match(view, /vaultMediaFilter === 'all' \|\| item\.type === vaultMediaFilter/);
  assert.match(view, /vaultBrowseMode = button\.dataset\.vaultFolderMode; activeFolderId = button\.dataset\.vaultFolderId \|\| ''; vaultMediaFilter = 'all'/);
  assert.match(view, /vaultMediaFilter = button\.dataset\.vaultMediaFilter; vaultSelectionMode = false/);
  assert.match(css, /\.vault-media-filter\{[^}]*grid-template-columns:repeat\(5/);
});

test('private vault batch import processes up to 100 files sequentially and preserves partial success', () => {
  const importer = view.slice(view.indexOf('async function importVaultMedia'), view.indexOf('async function verifyImportedVaultItems'));
  assert.match(view, /批量导入照片 \/ 视频/);
  assert.match(view, /NativeMediaStore\.pickPrivateMedia\(\)/);
  assert.match(view, /import \{ NativeMediaStore \} from '\.\.\/native-media-store\.js'/);
  assert.doesNotMatch(view, /import \{ FilePicker \}/);
  assert.match(view, /const files = result\.files \|\| \[\];[\s\S]*files\.length > 100/);
  assert.match(view, /一次最多导入 100 个私密文件/);
  assert.match(importer, /for \(let index = 0; index < picked\.length; index \+= 1\)/);
  assert.match(importer, /openVaultImportProgress\(picked\.length\);[\s\S]*await waitForVaultPaint\(\)/);
  assert.match(importer, /maxSide: VAULT_POSTER_MAX_SIDE, quality: \.84/);
  assert.match(importer, /await waitForVaultPaint\(\);[\s\S]*try \{/);
  assert.match(importer, /await persistPrivateVault\(state\);[\s\S]*await save\(\);/);
  assert.match(importer, /failures\.push/);
  assert.match(importer, /const current = privateVaultContent\(\);[\s\S]*current\.items = current\.items\.filter\(item => item\.id !== addedItem\.id\)/);
  assert.match(importer, /poster\?\.posterRef/);
  assert.doesNotMatch(importer, /Promise\.all/);
  assert.match(view, /vault-import-progress-meter/);
  assert.match(view, /showVaultImportResult/);
  assert.match(css, /\.modal\.vault-import-progress-modal/);
});

test('moving gallery media deletes originals only after the complete batch is persisted and verified', () => {
  assert.match(view, /复制到私密空间/);
  assert.match(view, /移入私密空间/);
  assert.match(view, /deleteOriginals: true/);
  assert.match(view, /originalUris\.push\(input\.path\)/);
  assert.match(view, /if \(deleteOriginals && failures\.length\)/);
  assert.match(view, /本批次没有删除任何相册视频/);
  assert.match(view, /await verifyImportedVaultItems\(importedItems\);[\s\S]*await persistPrivateVault\(state\);[\s\S]*await save\(\);[\s\S]*NativeMediaStore\.deleteOriginalMedia/);
  assert.match(view, /mediaReferenceSize\(ref\) <= 0/);
  assert.match(view, /NativeMediaStore\.deleteOriginalMedia\(\{ uris: originalUris \}\)/);
  assert.match(nativeMedia, /deleteOriginalMedia/);
  assert.match(nativeMedia, /pickPrivateMedia/);
  assert.match(nativeMedia, /Intent\.EXTRA_ALLOW_MULTIPLE, true/);
  assert.match(nativeMedia, /FILE_EXECUTOR\.execute\(\(\) -> resolvePickedMedia/);
  assert.doesNotMatch(nativeMedia.slice(nativeMedia.indexOf('private void resolvePickedMedia'), nativeMedia.indexOf('private void encryptMediaInBackground')), /MediaMetadataRetriever|readData|Base64/);
  assert.match(deleteActivity, /MediaStore\.createDeleteRequest/);
  assert.match(deleteActivity, /你取消了系统删除确认，相册原件已保留/);
  assert.match(manifest, /android:name="\.OriginalMediaDeleteActivity"/);
  assert.doesNotMatch(view, /deleteOriginalMedia\(\{ uris: picked/);
});

test('private vault opens on the library and enters the immersive feed only after a video choice', () => {
  assert.match(view, /let vaultExperienceMode = 'library'/);
  assert.match(view, /if \(!vaultRouteWasActive\) \{[\s\S]*vaultBrowseMode = 'folders'/);
  assert.match(view, /vaultBrowseMode = 'folders'; activeFolderId = ''; vaultSelectionMode = false; vaultSelectedIds\.clear\(\); vaultExperienceMode = 'library'/);
  assert.doesNotMatch(view, /queueMicrotask\(\(\) => startVaultFeed\(0\)\)/);
  assert.match(view, /if \(item\.type === 'video'\) return openVaultVideo/);
  assert.match(view, /startVaultFeed/);
  assert.match(view, /immersiveFeed: true/);
  assert.match(view, /folders: vaultFeedFolders\(\)/);
  assert.match(view, /onFolderNavigate/);
  assert.match(view, /onOpenLibrary/);
  assert.match(view, /autoAdvance: false/);
  assert.match(view, /function shuffledVaultVideos/);
  assert.match(view, /crypto\.getRandomValues\(new Uint32Array\(1\)\)/);
  assert.match(view, /const videos = shuffledVaultVideos\(\)/);
  assert.match(view, /openVaultVideo\([^\n]+, '', true\)/);
  assert.match(view, /resetFeedAudio/);
  assert.match(view, /providedItems \|\| shuffledVaultVideos/);
});

test('legacy state gains a locked empty vault without changing ordinary media', () => {
  const state = migrateState({ snippets: [], media: [] });
  assert.equal(state.meta.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(state.privateVault.assetRefs, []);
  assert.equal(state.privateVault.payload, '');
});

test('locked UI contains no private item markup and unlock is password-triggered', () => {
  assert.match(view, /指纹解锁私密空间/);
  assert.match(view, /vault-unlock-form/);
  assert.match(view, /document\.visibilityState === 'hidden'/);
  assert.match(view, /const routeActive = state\.route === 'private-vault'/);
  assert.match(view, /data-open-vault-item/);
  assert.match(view, /withAuthorizedExternalUi\(pickPrivateFiles\)/);
  assert.match(view, /externalUiDepth > 0 \|\| vaultFullscreenActive/);
  assert.match(view, /webkitbeginfullscreen/);
  assert.match(view, /vault-photo-viewer/);
});

test('private vault attempts its isolated system fingerprint first and falls back to password', () => {
  assert.match(view, /import \{ PasswordVaultNative \}/);
  assert.match(view, /指纹解锁私密空间/);
  assert.match(view, /vault-unlock-form[^\n]+\$\{setup \? '' : 'hidden'\}/);
  assert.match(view, /PasswordVaultNative\.capability\(\{ scope: 'private' \}\)/);
  assert.match(view, /PasswordVaultNative\.unlockWithFingerprint\(\{ scope: 'private' \}\)/);
  assert.match(view, /await unlockPrivateVaultWithKey\(state, result\.secret\)/);
  assert.match(view, /showVaultPasswordFallback/);
  assert.match(view, /form\.hidden = false/);
  assert.match(view, /PasswordVaultNative\.enableFingerprint\(\{ scope: 'private', secret \}\)/);
  assert.match(view, /PasswordVaultNative\.disableFingerprint\(\{ scope: 'private' \}\)/);
  assert.match(view, /resetVaultFingerprintAttempt/);
  assert.match(css, /\.vault-lock-paper form\[hidden\]\{display:none!important\}/);
});

test('private photos open in a full-screen swipe and zoom viewer without the old white dialog', () => {
  assert.match(view, /function vaultPhotosForCurrentFolder/);
  assert.match(view, /vaultItemsForBrowseScope\(\)\.filter\(item => item\.type === 'photo'\)/);
  assert.match(view, /function bindVaultPhotoGestures/);
  assert.match(view, /scale = Math\.max\(1, Math\.min\(5/);
  assert.match(view, /Math\.abs\(totalX\) > 58/);
  assert.match(view, /setTimeout\(\(\) => \{ if \(chrome\.isConnected\) chrome\.classList\.add\('hidden'\); \}, 1100\)/);
  assert.match(view, /\[items\[index - 1\], items\[index \+ 1\]\]/);
  assert.doesNotMatch(view, /vault-image-fullscreen/);
  assert.match(css, /\.modal-layer:has\(\.vault-photo-modal\)\{padding:0;background:#020504/);
  assert.match(css, /\.modal\.vault-photo-modal\{width:100%;max-width:none;height:100dvh/);
  assert.match(css, /\.vault-photo-stage img\{[^}]*object-fit:contain/);
});

test('private folder browsing switches between thumbnail and full-photo cards without changing stored media', () => {
  assert.match(view, /let vaultGridView = 'thumb'/);
  assert.match(view, /switcher\.setAttribute\('aria-label', '文件夹浏览视角'\)/);
  assert.match(view, /data-vault-grid-view="thumb"/);
  assert.match(view, /data-vault-grid-view="large"/);
  assert.match(view, /vaultGrid\.classList\.toggle\('vault-grid-large'/);
  assert.match(css, /\.vault-grid\.vault-grid-large\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.vault-grid\.vault-grid-large \.vault-item:not\(\.vault-video-item\) \.vault-media-box>img\{[^}]*object-fit:contain/);
  assert.doesNotMatch(view, /state\.(?:settings|privateVault)\.vaultGridView/);
});

test('private photo and immersive video browsing wrap at both ends', () => {
  assert.match(view, /\(next \+ items\.length\) % items\.length/);
  assert.match(view, /items\[\(index - 1 \+ items\.length\) % items\.length\]/);
  assert.match(view, /items\[\(index \+ 1\) % items\.length\]/);
  assert.match(view, /loopNavigation: true/);
});

test('passwordless mode is process-memory only and manual lock always clears it', () => {
  assert.match(view, /let passwordlessForThisRun = false/);
  assert.doesNotMatch(view, /state\.(?:settings|privateVault)\.passwordlessForThisRun/);
  assert.match(view, /结束 App 后自动失效/);
  assert.match(view, /vault-lock[^\n]+passwordlessForThisRun = false/);
  assert.match(view, /if \(!passwordlessForThisRun\) \{ resetVaultFingerprintAttempt\(\); decryptedVideoUrls\.clear\(\); decryptingVideoUrls\.clear\(\); lockPrivateVault\(\); \}/);
});

test('entry password keeps metadata encrypted while media uses fast app-private references', () => {
  assert.match(store, /saveNativeMediaSource/);
  assert.match(store, /saveMediaFile/);
  assert.match(store, /persistImageData/);
  assert.match(store, /if \(isMediaRef\(ref\)\) return resolveMediaReference\(ref\)/);
  assert.match(store, /migrateVaultMediaToPrivate/);
  assert.match(native, /decryptMedia/);
});

test('Moments media can be copied or transactionally moved into the password-gated vault', () => {
  assert.match(view, /id="vault-import-moments"/);
  assert.match(view, /复制到私密空间/);
  assert.match(view, /移入并隐藏/);
  assert.match(view, /const previousSnippets = structuredClone\(state\.snippets\)/);
  assert.match(view, /removeTransferredMomentMedia\(chosen\)/);
  assert.match(view, /redactSnapshotMediaReferences/);
  assert.match(view, /sourceModule: 'moments'/);
  assert.match(view, /sourceSnippetId: candidate\.entry\.id/);
  assert.match(storage, /export async function redactSnapshotMediaReferences/);
  assert.match(view, /await deleteVaultAssets\(createdRefs, \{ force: true \}\)/);
  assert.match(store, /encryptExistingVaultMedia/);
});

test('private videos can be transactionally restored to Moments without copying or deleting media', () => {
  assert.match(view, /恢复到随手拍/);
  assert.match(view, /restoreVaultVideoPrompt/);
  assert.match(view, /restoreVaultVideoToMoments/);
  assert.match(view, /makeSnippet\(\{ type: 'photo'/);
  assert.match(view, /existing\.video === source/);
  assert.match(view, /content\.items = content\.items\.filter\(record => record\.id !== item\.id\)/);
  assert.doesNotMatch(view.slice(view.indexOf('async function restoreVaultVideoToMoments'), view.indexOf('function deleteVaultItem')), /deleteVaultAssets/);
  assert.match(vaultCore, /sourceSnippetId/);
  assert.match(css, /\.modal\.vault-restore-moment-modal/);
});

test('private local videos can choose a cover from the video timeline', () => {
  assert.match(view, /data-vault-video-cover/);
  assert.match(view, /showVideoFramePicker\(source/);
  assert.match(view, /item\.coverTime = time/);
});

test('private videos use compact complete covers and keep encrypted editing in a menu', () => {
  assert.match(view, /vault-video-item/);
  assert.match(view, /data-edit-vault-video/);
  assert.match(view, /vault-video-edit-form/);
  assert.match(view, /item\.note = String\(data\.get\('note'\)/);
  assert.match(view, /正在准备/);
  assert.match(core, /layer\.innerHTML = ''/);
  assert.match(css, /vault-video-item \.[^{]*vault-media-box\{[^}]*aspect-ratio:16\/9/);
  assert.match(css, /vault-video-item \.[^{]*vault-media-box>img\{object-fit:contain/);
  assert.match(view, /video-contain-cover/);
  assert.match(css, /vault-video-item \.video-contain-cover\{[^}]*aspect-ratio:16\/9/);
  assert.match(css, /video-contain-cover>img[^}]*object-fit:contain!important[^}]*object-position:center center/);
  assert.match(view, /is-portrait-video-cover/);
  assert.match(css, /vault-media-box\.is-portrait-video-cover\{[^}]*aspect-ratio:16\/9/);
  assert.match(css, /vault-media-box\.is-portrait-video-cover>img\{[^}]*object-fit:contain/);
  assert.match(css, /vault-video-item \.vault-media-box>i\{[^}]*bottom:8px[^}]*width:27px/);
  assert.match(css, /vault-video-item\{[^}]*border:1px solid rgba\(49,72,60,\.22\)/);
  assert.match(view, /target\?\.classList\.toggle\('is-portrait-video-cover'/);
  assert.match(view, /data-vault-item-menu/);
  assert.doesNotMatch(view, /vault-video-copy-paper/);
  assert.match(css, /vault-video-item\{[^}]*grid-column:auto!important/);
});

test('private playback caches decrypted legacy sources, preloads neighbors and supports swipe continuation', () => {
  assert.match(view, /const decryptedVideoUrls = new Map\(\)/);
  assert.match(view, /items\[index - 1\], items\[index \+ 1\]/);
  assert.match(view, /autoAdvance: false/);
  assert.match(view, /onNavigate: \(next, direction\) => openVaultVideo/);
  assert.match(view, /onProgress: \(\{ position, duration \}\)/);
  assert.match(view, /sourceType: current\.sourceType/);
  assert.match(view, /currentVaultVideoScopeLabel/);
  assert.match(view, /episodeTitle: currentVaultVideoScopeLabel\(\)/);
  assert.match(view, /date: entry\.date/);
  assert.match(view, /watchHistory: current\.watchHistory \|\| \[\]/);
  assert.match(view, /onWatchSession: session/);
  assert.match(view, /record\.watchHistory = \[\.\.\.\(record\.watchHistory \|\| \[\]\), session\]/);
  assert.match(view, /const closing = Promise\.resolve\(callHelper\('closeVideoPlayer'\)\)/);
  assert.match(view, /closing\.finally\(\(\) => \{[\s\S]*?lockPrivateVault\(\)/);
  assert.match(view, /onDeleteCurrent: \(\) => deleteVaultVideoFromFeed/);
  assert.match(view, /async function deleteVaultVideoFromFeed/);
  assert.match(vaultCore, /watchHistory: Array\.isArray/);
  assert.match(vaultCore, /watchedSeconds >= 3/);
});

test('password-valid unlock renders immediately and never waits for legacy media migration', () => {
  const handler = view.slice(view.indexOf("registerSubmitHandler('vault-unlock-form'"), view.indexOf("registerSubmitHandler('vault-folder-form'"));
  assert.match(handler, /await unlockPrivateVault/);
  assert.match(handler, /render\(\);[\s\S]*?show\('私密空间已解锁'\)/);
  assert.doesNotMatch(handler, /migrateVaultMediaToPrivate/);
  assert.match(handler, /正在验证密码/);
});

test('private vault uses one faded canvas accent over a seamless repeating paper texture', () => {
  assert.match(css, /#app>\.private-vault-view\{[^}]*background-image:url\('assets\/today-paper-texture\.png'\)/);
  assert.match(css, /#app>\.private-vault-view::before\{[^}]*secondary-page-canvas-v1\.png[^}]*no-repeat/);
});

/* ── 视频剪辑（2026-10-10 新增）────────────────────────────────────
   非破坏性剪辑：只记"要播哪一段、要框哪一块"。这里锁住两件事：
   ① 这些字段必须能穿过加密存取（否则一刷新就丢）；
   ② 剪辑器 / 播放器的接线还在（防止以后重构时被摘掉）。 */

test('video trim and crop survive the encrypted round trip', async () => {
  const state = makeDefaultState();
  await setupPrivateVault(state, '246810');
  privateVaultContent().items.push({
    id: 'clip-1', type: 'video', name: '剪辑前的原片.mp4', assetRef: 'mine-media://clip.mp4',
    duration: 42, trim: { start: 3, end: 12 }, crop: { x: 0.1, y: 0.2, w: 0.6, h: 0.5 }
  });
  await persistPrivateVault(state);
  assert.equal(JSON.stringify(state.privateVault).includes('剪辑前的原片.mp4'), false, '剪辑元数据同样要加密');
  await lockPrivateVault();
  await unlockPrivateVault(state, '246810');
  const item = privateVaultContent().items.find(entry => entry.id === 'clip-1');
  assert.deepEqual(item.trim, { start: 3, end: 12 });
  assert.deepEqual(item.crop, { x: 0.1, y: 0.2, w: 0.6, h: 0.5 });
  await lockPrivateVault();
});

test('an untrimmed video and a full-frame crop are stored as null instead of fake values', async () => {
  const state = makeDefaultState();
  await setupPrivateVault(state, '246810');
  privateVaultContent().items.push({
    id: 'clip-2', type: 'video', name: 'whole.mp4', assetRef: 'mine-media://whole.mp4',
    duration: 42, trim: { start: 0, end: 42 }, crop: { x: 0, y: 0, w: 1, h: 1 }
  });
  await persistPrivateVault(state);
  const item = privateVaultContent().items.find(entry => entry.id === 'clip-2');
  assert.equal(item.trim, null, '整段播放不该留下剪辑记录');
  assert.equal(item.crop, null, '整幅画面不该留下裁剪记录');
  await lockPrivateVault();
});

test('the vault video editor is wired from menu to player', () => {
  assert.match(view, /id="vault-menu-trim"/, '私密视频菜单要有「剪辑视频」入口');
  assert.match(view, /showVideoEditor\(/, '菜单要真的打开剪辑器');
  assert.match(view, /trim: item\.trim \|\| null, crop: item\.crop \|\| null/, '剪辑元数据要交给播放器');
  assert.match(vaultCore, /trim: normalizeTrim\(item\)/, 'trim 必须进持久化白名单');
  assert.match(vaultCore, /crop: normalizeCrop\(item\?\.crop\)/, 'crop 必须进持久化白名单');
  assert.match(css, /\.video-editor-crop-handle/, '剪辑器的手柄样式要在');
  assert.match(css, /\.modal\.video-editor-modal\{[^}]*position:fixed/, '剪辑器是全屏工作台');
  // 剪辑器是"全屏深色工作台"，必须在清简主题的白底规则排除名单里，否则一打开就是一整屏白。
  // 这里把两侧钉在一起：改名会让这条挂掉，而不是默默白屏。
  assert.match(editor, /'video-editor-modal'\)/, '剪辑器弹窗的类名要叫 video-editor-modal');
  assert.match(themes, /:not\(\.video-editor-modal\)/, '清简主题的白底规则要排除剪辑器');
});

/* 「只剪开头」这个姿势必须能存下来（2026-10-10 修）
   终点手柄的 state.trimEnd 初始是 0，表示"没动过、终点就是片尾"。
   保存时拿这个 0 去判"是不是整段没剪"，只拖了起点（想保留后半段）的剪辑会被判成没剪，
   存进去的照样是 null —— 拖了半天白剪。判定必须用算出来的终点。 */
test('a cut that only moves the start handle is still saved', () => {
  const save = editor.slice(editor.indexOf("$('#video-editor-save').onclick"), editor.indexOf('/* ── 标签页 ── */'));
  assert.ok(save, '应能提取剪辑器的保存处理');
  assert.match(save, /const end = trimEnd\(\)/, '保存时要先算出真正的终点');
  assert.match(save, /const wholeTrim = !\(end > start \+ \.05\)/, '整段判定要用算出来的终点');
  assert.doesNotMatch(save, /state\.trimEnd > state\.trimStart/, '不能拿"终点手柄没动过"的 0 去判整段');
  assert.match(save, /trim: wholeTrim \? null : \{ start: Math\.round\(start \* 100\) \/ 100, end: Math\.round\(end \* 100\) \/ 100 \}/, '存进去的起止点都用算出来的值');
});

test('the trim editor trusts the decoded duration instead of the whole-second listing value', () => {
  const meta = editor.slice(editor.indexOf("video.addEventListener('loadedmetadata'"), editor.indexOf("video.addEventListener('error'"));
  assert.ok(meta, '应能提取剪辑器读取元数据的处理');
  // 列表里存的时长是"向下取整到秒"的近似值（12.7 秒存成 12）。
  // 拿它当时间轴总长，片尾那一小截永远拖不到，终点还会被截短。
  assert.match(meta, /const realDuration = Number\(video\.duration\) \|\| 0/, '要读解码出来的真实时长');
  assert.match(meta, /if \(realDuration\) state\.duration = realDuration/, '真实时长要覆盖掉传进来的近似值');
});

test('a trim end past the whole-second duration survives the encrypted round trip', async () => {
  const state = makeDefaultState();
  await setupPrivateVault(state, '246810');
  // duration 是 12（整秒近似），但用户实际把终点拖到了 12.7 —— 不能被截成 12。
  privateVaultContent().items.push({
    id: 'clip-3', type: 'video', name: '长片.mp4', assetRef: 'mine-media://long.mp4',
    duration: 12, trim: { start: 6, end: 12.7 }
  });
  await persistPrivateVault(state);
  assert.deepEqual(privateVaultContent().items.find(entry => entry.id === 'clip-3').trim, { start: 6, end: 12.7 });
  await lockPrivateVault();
  await unlockPrivateVault(state, '246810');
  assert.deepEqual(privateVaultContent().items.find(entry => entry.id === 'clip-3').trim, { start: 6, end: 12.7 }, '刷新后仍要保留');
  await lockPrivateVault();
});

/* 取景框外的压暗（2026-10-10 修）
   原来用一个超大扩散的阴影来压暗框外，但承载取景框的那一层是 overflow:hidden
   （画面不能溢出到下面的面板上），阴影的溢出部分正好被裁掉 —— 框外该暗的地方还是亮的。
   改成四块矩形拼，全部落在层内，尺寸直接用归一化百分比，与取景框天然对齐。 */
test('the crop mask is built from four rectangles that layer clipping cannot cut away', () => {
  assert.match(editor, /function syncShade\(/, '要有单独更新压暗块的函数');
  assert.match(editor, /data-shade="top"[\s\S]*data-shade="bottom"[\s\S]*data-shade="left"[\s\S]*data-shade="right"/, '上下左右四块都要在');
  assert.match(editor, /syncShade\(c\)/, '取景框每次重排都要同步压暗块');
  assert.match(css, /\.video-editor-crop-shade span\{[^}]*background:rgba\(3,7,6,\.62\)/, '压暗块要有底色');
  assert.match(css, /\.video-editor-crop-shade\{[^}]*pointer-events:none/, '压暗块不能挡住拖拽手势');
  assert.doesNotMatch(css, /\.video-editor-crop-box\{[^}]*box-shadow:0 0 0 9999px/, '不能再用会被裁掉的阴影扩散');
});

/* 裁画面时要能拖进度条换画面（2026-10-10 用户反馈）
   「裁画面」这一页原来只能盯着当前那一帧，想对着别的画面对框得切回「剪时长」再切回来。
   现在这一页自己有进度条，而且**只在剪短之后真正会播的那一段**里走 ——
   能拖到已经剪掉的画面上再框一遍，框出来的东西保存后根本看不到，纯属白干。 */
test('the crop tab can scrub through the video, but only inside the kept range', () => {
  assert.match(editor, /id="video-editor-scrub"/, '裁画面这页要有进度条');
  assert.match(editor, /function setScrubRange\(/, '进度条范围要单独收口成一个函数');
  assert.match(editor, /scrub\.min = String\(start\)/, '进度条起点跟着剪辑区间走');
  assert.match(editor, /scrub\.max = String\(Math\.max\(start \+ \.01, end\)\)/, '进度条终点跟着剪辑区间走');
  assert.match(editor, /scrubInput\.addEventListener\('input'[\s\S]{0,120}?seekTo\(event\.target\.value\)/, '拖动进度条要真的换帧');
  assert.match(editor, /setScrubRange\(\);\s*\n\s*\}/, '剪短之后进度条范围要立刻重算');
  assert.match(css, /\.video-editor-scrub\{/, '进度条要有样式');
  // 剪辑器是常驻深色工作台，滑杆要沿用金色；被主题绿顶掉会在深底上看不清。
  assert.match(css, /#video-editor-scrub[^{]*\{[^}]*accent-color:#e0c391/, '滑杆颜色不能被主题色顶掉');
});

/* 「习惯裁掉开头 N 秒」（2026-10-10 用户提的）
   ⚠️ 用户当次定的口径：**打开剪辑时绝不自己动手**，点「砍掉开头 N 秒」才砍。
      第一版做成"打开就按记过的长度自动砍"，用户看到的是"默认开启剪开头"，要求改掉。
      所以三个控件各管一件事，测试要盯住它们别又粘在一起：
        滑块 → 只改「这次砍多长」，不动画面、不写设置
        按钮 → 唯一改时间轴的地方
        「记住」→ 唯一写设置的地方
   ⚠️ 另外：只有这次真的动过「记住」才回写设置 —— 否则用户只是打开剪辑器随手一存，
      就会把原先存好的长度悄悄清成 0，表现成"记住的功能自己失效了"。 */
test('the remembered head-trim is only applied when the button is tapped', () => {
  assert.match(editor, /trimHead = 0/, '剪辑器要接收记过的长度');
  // 打开时不许自动砍：必须没有"按记过的长度直接改 trimStart"的那段代码。
  assert.ok(
    !/if \(!hasTrim && state\.headSeconds > 0\)/.test(editor),
    '打开剪辑时不许按记过的长度自动砍 —— 用户要求"点了我才砍"'
  );
  assert.match(editor, /要砍得点面板里那个「砍掉开头 N 秒」/, '要在代码里写清"打开不砍"这件事，免得以后被"优化"回去');
  // 滑块只改数字。
  assert.match(editor, /headRange\.addEventListener\('input', event => \{\s*\n\s*state\.headPick = /, '滑块只负责改"这次砍多长"');
  // 按钮才是唯一动时间轴的地方，而且不碰"记住"的那两个状态。
  assert.match(editor, /\$\('#video-editor-head-apply'\)\?\.addEventListener\('click', applyHeadNow\)/, '要有一个点了才砍的按钮');
  const applyBody = (editor.match(/function applyHeadNow\(\) \{[\s\S]*?\n  \}/) || [''])[0];
  assert.ok(applyBody, '要有 applyHeadNow 这个函数');
  assert.match(applyBody, /state\.trimStart = /, '它要真的改起点');
  assert.ok(!/state\.headSeconds\s*=/.test(applyBody), '它不许改"记住"的长度');
  assert.ok(!/headDirty/.test(applyBody), '它也不许打脏标记 —— 打了保存时就会把记住的长度覆盖掉');
  // 「记住」是唯一写设置的地方，且只认滑块上的数字（那才是"每次砍多长"）。
  const rememberBody = (editor.match(/headRemember\.addEventListener\('click', \(\) => \{[\s\S]*?\n  \}/) || [''])[0];
  assert.ok(rememberBody, '要有「记住」的处理');
  assert.match(rememberBody, /state\.headSeconds = value/, '记住的是滑块上的长度');
  assert.ok(!/state\.trimStart\s*=/.test(rememberBody), '点「记住」不该顺手动画面');
  // ⚠️ 「记住」不能是"关了再开"式开关：想把记住的 1 秒改成 20 秒时，
  //    用户应该是拖一下滑块再点一下，而不是先点掉、再点一次。
  assert.match(editor, /const isCurrent = remembered && pick === state\.headSeconds/, '按钮亮不亮看"滑块上这个数是不是记住的那个"');
  assert.match(editor, /if \(state\.headRemembered && value === state\.headSeconds\)/, '只有"亮着再点"才算取消记住');
  assert.match(editor, /state\.headSeconds = value;\s*\n\s*state\.headRemembered = value > 0;/, '灭着点就是把当前数字存成默认');
  assert.match(editor, /trimHeadSeconds: state\.headDirty \?/, '这次没动过「记住」就不要回写');
  assert.match(editor, /state\.headRemembered && state\.headSeconds > 0/, '记 0 秒等于没记');
  assert.match(view, /trimHead: Number\(state\.settings\?\.vaultTrimHeadSeconds\) \|\| 0/, '入口要把记过的长度传进去');
  assert.match(view, /state\.settings\.vaultTrimHeadSeconds = Math\.max\(0, Math\.min\(HABIT_HEAD_MAX_SECONDS/, '保存时把它写回设置，且引用同一处上限');
  // 上限（2026-10-10 由 10 提到 20）原来散在四处：滑块 max、可达上限、落库校验、读回校验。
  // 漏改任一处就是「界面能拖到 20 秒、存进去还是 10」这种不报错的错位 —— 现在一律引用 model.js 的常量。
  assert.match(editor, /import \{ HABIT_HEAD_MAX_SECONDS, habitHeadLimit \} from '\.\/model\.js'/, '剪辑器从 model.js 取上限，别自己写死');
  assert.match(editor, /id="video-editor-head-range" min="0" max="\$\{HABIT_HEAD_MAX_SECONDS\}"/, '滑块上限跟着常量走');
  assert.match(editor, /const headLimit = \(\) => habitHeadLimit\(effectiveDuration\(\)\)/, '可达上限也走同一个纯函数');
  assert.match(view, /import \{ makeSnippet, HABIT_HEAD_MAX_SECONDS \} from '\.\.\/model\.js'/, '入口也从同一处取上限');
  // 短片最多砍一半 → 够不到记住的那个长度。上限提到 20 之后这很常见
  //（要 40 秒以上的片子才够得到 20），得单独说清。
  assert.match(editor, /const clipped = remembered && state\.headSeconds > limit/, '够不到时要说清原因，别让用户以为记住的长度丢了');
  assert.match(editor, /这段视频只有 \$\{formatVideoDuration\(effectiveDuration\(\), '0:00'\)\}，这次最多能砍 \$\{limit\} 秒/, '要说清"这次最多砍几秒"');
  // ⚠️ 读数、按钮、滑块必须是**同一个数**（这次会砍掉多少）。
  //    别把"记住的那个长度"塞进读数：短片够不到 20 秒时会出现
  //    「按钮写着砍 20 秒、其实只砍得动 1 秒」这种不老实的东西。
  assert.match(editor, /read\.textContent = pick > 0 \? `\$\{pick\} 秒` : '关'/, '读数说这次砍多少');
  assert.match(editor, /applyLabel\.textContent = pick > 0 \? `砍掉开头 \$\{pick\} 秒` : '砍掉开头'/, '按钮上的数字跟读数是同一个');
  assert.match(editor, /const pick = Math\.min\(limit, Math\.max\(0, Math\.round\(state\.headPick\)\)\)/, '这次的数要被上限夹住');
  assert.match(editor, /apply\.disabled = pick <= 0/, '长度为 0 时按钮不能点');
  // ⚠️ 真机验证抓到的回归：null 是"这次没动过它"的哨兵，但 Number(null) === 0 是有限数，
  //    只写 Number.isFinite(Number(...)) 的话，点「还原整段」会被当成"把长度改成 0 秒"，
  //    记过的长度被静默抹掉（用户会说"记住的功能自己失效了"）。必须先显式挡掉 null。
  assert.match(view, /trimHeadSeconds !== null && trimHeadSeconds !== undefined/, '先显式挡掉 null 哨兵，再做数字校验');
  assert.match(css, /\.video-editor-head\{/, '习惯长度控件要有样式');
  assert.match(css, /\.video-editor-head-apply\{/, '那个"点了才砍"的按钮要有样式');
  assert.match(css, /\.video-editor-head-apply:disabled\{/, '按钮不能点的时候要看得出来');
});

/* 剪辑之后列表上不能还说原片时长（2026-10-10 补）
   12 分钟的片子剪成 45 秒，列表上仍写着 12:34 的话，用户根本对不上，
   也看不出自己到底剪过哪些片子 —— 所以时长戳和"已剪辑"标记都得跟上。 */
test('the listing shows how long a trimmed video plays now, not its original length', () => {
  assert.equal(vaultPlayableDuration({ duration: 754, trim: { start: 120, end: 165 } }), 45, '剪完剩 45 秒就显示 45 秒');
  assert.equal(vaultPlayableDuration({ duration: 754 }), 754, '没剪的照原片算');
  assert.equal(vaultPlayableDuration({ duration: 754, trim: null }), 754);
  assert.equal(vaultPlayableDuration({ duration: 42, trim: { start: 0, end: 42 } }), 42, '整段按原片算');
  assert.equal(vaultPlayableDuration({ duration: 2, trim: { start: 0.8, end: 1.6 } }), 1, '不足一秒也要显示成 1 秒，不能变成"还没读到"');
  assert.equal(vaultPlayableDuration({}), 0);
});

test('only genuinely edited videos get the edited mark', () => {
  assert.equal(vaultItemEdited({ duration: 42 }), false);
  assert.equal(vaultItemEdited({ duration: 42, trim: { start: 0, end: 42 } }), false, '整段不算剪过');
  assert.equal(vaultItemEdited({ duration: 42, trim: { start: 3, end: 12 } }), true);
  assert.equal(vaultItemEdited({ duration: 42, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }), true, '只裁画面也算改过');
  assert.equal(vaultItemEdited({ duration: 42, crop: { x: 0, y: 0, w: 1, h: 1 } }), false, '整幅不算裁过');
});

test('the vault tile uses the trimmed length and marks edited videos', () => {
  assert.match(view, /formatVideoDuration\(vaultPlayableDuration\(item\)\)/, '列表时长要按剪辑后的算');
  assert.match(view, /vaultItemEdited\(item\)/, '要用统一的"是否剪过"判断');
  assert.match(view, /class="video-edited-stamp"/, '剪过的视频要有标记');
  assert.match(css, /\.video-edited-stamp\{[^}]*position:absolute/, '标记要压在封面上');
});

/* ---------------------------------------------------------------------------
   裁剪会改变画面方向（2026-10-10 用户要求）
   「如果画面裁剪后由横屏变成竖屏或者竖屏变成横屏的话，应该重新归类到竖屏和横屏视频中」
   裁剪是非破坏性的 —— 文件没变，所以不能拿文件尺寸去判方向，得看取景框。
   --------------------------------------------------------------------------- */

test('裁剪后方向以取景框为准：横屏裁成竖条就归竖屏', () => {
  // 1920×1080 横屏素材，框成 9:16 的竖条（归一化 w ≈ 0.3164，h = 1）
  const landscape = { width: 1920, height: 1080, displayOrientation: 'landscape' };
  assert.equal(vaultItemOrientation(landscape), 'landscape', '没裁之前是横屏');

  const toPortrait = { ...landscape, crop: { x: 0.3418, y: 0, w: 0.3164, h: 1 } };
  assert.equal(vaultItemOrientation(toPortrait), 'portrait', '裁成竖条之后要归到竖屏');
  const portraitFrame = vaultFrameSize(toPortrait);
  assert.ok(portraitFrame.height > portraitFrame.width, `${portraitFrame.width}×${portraitFrame.height} 应该是竖的`);

  // 反过来：1080×1920 竖屏素材框成 16:9 的横条（归一化 w = 1，h ≈ 0.3164）
  const portrait = { width: 1080, height: 1920, displayOrientation: 'portrait' };
  assert.equal(vaultItemOrientation(portrait), 'portrait');
  const toLandscape = { ...portrait, crop: { x: 0, y: 0.3418, w: 1, h: 0.3164 } };
  assert.equal(vaultItemOrientation(toLandscape), 'landscape', '裁成横条之后要归到横屏');
  assert.ok(vaultFrameSize(toLandscape).width > vaultFrameSize(toLandscape).height);
});

test('裁剪之前仍按导入时的分析结果判方向（不能被裁剪分支带偏）', () => {
  // 横屏文件里放着竖屏内容（左右黑边）—— 导入分析已经纠正成 portrait，没裁过就要听它的
  assert.equal(vaultItemOrientation({ width: 1920, height: 1080, displayOrientation: 'portrait' }), 'portrait');
  assert.equal(vaultItemOrientation({ width: 1920, height: 1080, displayOrientation: 'landscape' }), 'landscape');
  assert.equal(vaultItemOrientation({ width: 1920, height: 1080 }), 'landscape', '没有分析结果时按宽高比');
  assert.equal(vaultItemOrientation({ width: 0, height: 0 }), '', '尺寸未知就不归类，不猜');
  assert.equal(vaultItemOrientation({ width: 0, height: 0, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } }), '', '裁过但尺寸未知同样不猜');
});

test('裁剪后的封面样式也跟着重判（竖版卡片）', () => {
  assert.match(view, /vaultItemOrientation\(item\) === 'portrait'/,
    '卡片是不是竖版要按裁剪后的方向决定，不能只看导入时的结论');
  assert.doesNotMatch(view, /item\.displayOrientation === 'portrait' \|\| \(item\.height > item\.width/,
    '旧的"元数据或原始宽高比"判断要彻底换掉，留着会和裁剪后的结论打架');
});

test('方向被裁反了要当场告诉用户（否则列表上会以为视频不见了）', () => {
  const trim = view.slice(view.indexOf('async function trimVaultVideo('), view.indexOf('async function refreshVaultPosterForCrop('));
  assert.ok(trim.length > 0, '要能定位到剪辑保存流程');
  assert.match(trim, /const orientationBefore = vaultItemOrientation\(item\);/, '保存前先记下原来的方向');
  assert.match(trim, /const orientationAfter = vaultItemOrientation\(item\);/, '保存后再算一次');
  assert.match(trim, /const flipped = orientationBefore && orientationAfter && orientationBefore !== orientationAfter/, '只有真的翻转了才提示');
  assert.match(trim, /已归到「/, '要明确告诉用户它被归到哪一类了');
  // 用户正停在方向筛选里时，条目会当场从列表消失，这句话更要说
  assert.match(trim, /ORIENTATION_FILTERS\.has\(vaultMediaFilter\)/);
});

