import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const backup = await readFile(new URL('../backup.js', import.meta.url), 'utf8');
const mine = await readFile(new URL('../views/mine.js', import.meta.url), 'utf8');
const vaultView = await readFile(new URL('../views/private-vault.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const native = await readFile(new URL('../android/app/src/main/java/com/mine/focus/StreamingBackupPlugin.java', import.meta.url), 'utf8');
const activity = await readFile(new URL('../android/app/src/main/java/com/mine/focus/MainActivity.java', import.meta.url), 'utf8');
const service = await readFile(new URL('../android/app/src/main/java/com/mine/focus/BackupExportService.java', import.meta.url), 'utf8');
const manifest = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const chunkCrypto = await readFile(new URL('../android/app/src/main/java/com/mine/focus/BackupChunkCrypto.java', import.meta.url), 'utf8');
const chunkCryptoTest = await readFile(new URL('../android/app/src/test/java/com/mine/focus/BackupChunkCryptoTest.java', import.meta.url), 'utf8');

test('Android backup uses a native stream before the browser-only 256MB guard', () => {
  const nativeBranch = backup.indexOf('if (isNativeAndroid())');
  const portableGuard = backup.indexOf('health.bytes + vaultHealth.bytes > MAX_PORTABLE_MEDIA_BYTES');
  assert.ok(nativeBranch >= 0 && portableGuard > nativeBranch);
  assert.match(backup, /NativeStreamingBackup\.exportBackup\(\{ password, payload, filename, totalBytes \}\)/);
  assert.doesNotMatch(backup.slice(nativeBranch, portableGuard), /expandMediaReferences|expandVaultReferences|bytesToBase64/);
  assert.match(mine, /支持 100GB 级照片与视频/);
  assert.match(mine, /超过 4GB 请勿保存到 FAT32/);
  assert.match(mine, /文件内部按 8MB 分块/);
  assert.match(mine, /恢复时由 App 自动拼接/);
});

test('native archive keeps v2 restore compatibility and uses 64-bit byte counters', () => {
  assert.match(native, /ACTION_CREATE_DOCUMENT/);
  assert.match(native, /ACTION_OPEN_DOCUMENT/);
  assert.match(native, /writeFileRecord/);
  assert.match(native, /LEGACY_FORMAT_VERSION = 2/);
  assert.match(native, /extractV2Archive/);
  assert.match(native, /new BoundedInputStream\(input, plainSize \+ GCM_TAG_BYTES\)/);
  assert.match(native, /cipher\.updateAAD/);
  assert.match(native, /TYPE_END/);
  assert.match(native, /byte\[\] buffer = new byte\[BUFFER_BYTES\]/);
  assert.match(native, /long bytes;/);
  assert.match(native, /long remaining/);
  assert.match(native, /PBKDF2WithHmacSHA256/);
  assert.match(native, /AES\/GCM\/NoPadding/);
  assert.match(native, /commitRestore/);
  assert.match(native, /rollbackRestore/);
  assert.match(native, /restore\.root\.exists\(\).*无法清理恢复临时区/);
  assert.match(native, /safeEntryName/);
  assert.match(activity, /registerPlugin\(StreamingBackupPlugin\.class\)/);
  assert.doesNotMatch(native, /readData|Base64/);
});

test('backup verification fully prepares and validates without committing current data', () => {
  const verifyStart = backup.indexOf('export async function verifyEncryptedBackup');
  const verifyEnd = backup.indexOf('export async function finalizeImportedBackup');
  const verifyFlow = backup.slice(verifyStart, verifyEnd);
  const verifySubmitStart = mine.indexOf("registerSubmitHandler('verify-backup-form'");
  const verifySubmitEnd = mine.indexOf("registerSubmitHandler('restore-form'");
  const verifySubmit = mine.slice(verifySubmitStart, verifySubmitEnd);
  assert.ok(verifyStart >= 0 && verifyEnd > verifyStart);
  assert.match(verifyFlow, /NativeStreamingBackup\.prepareRestore\(\{ password, operation: 'verify' \}\)/);
  assert.match(verifyFlow, /validateBackupPayload\(payload\)/);
  assert.match(verifyFlow, /finally \{[\s\S]*NativeStreamingBackup\.rollbackRestore\(\{ token \}\)/);
  assert.doesNotMatch(verifyFlow, /commitRestore|pendingNativeRestoreToken/);
  assert.match(mine, /id="settings-verify-backup"/);
  assert.match(mine, /完整读取、解密并校验所选备份/);
  assert.match(mine, /当前数据未改变/);
  assert.doesNotMatch(verifySubmit, /createLocalSnapshot|setState|replaceState|commitRestore/);
});

test('restore and verification expose native read progress with foreground keep-alive notifications', () => {
  assert.match(backup, /addListener\('restoreProgress'/);
  assert.match(backup, /operation: 'restore'/);
  assert.match(backup, /operation: 'verify'/);
  assert.match(native, /CountingInputStream/);
  assert.match(native, /publishRestoreProgress\(stats, false\)/);
  assert.match(native, /notifyListeners\("restoreProgress", progress\)/);
  assert.match(native, /BackupExportService\.start\(getContext\(\), totalBytes, operation\)/);
  assert.match(service, /正在恢复加密备份/);
  assert.match(service, /正在验证加密备份/);
  assert.match(service, /PARTIAL_WAKE_LOCK/);
  assert.match(mine, /data-backup-read-progress/);
  assert.match(mine, /正在\$\{action\}：\$\{percent\}%/);
  assert.match(css, /\.backup-restore-status\{/);
});

test('stale uncommitted restore staging is removed without touching rollback data', () => {
  assert.match(native, /public void load\(\)/);
  assert.match(native, /cleanupStaleUncommittedRestoreDirectories\(\)/);
  assert.match(native, /file\.getName\(\)\.startsWith\("\.mine-restore-"\)/);
  assert.match(native, /new File\(root, "stage-media"\)\.isDirectory\(\)/);
  assert.match(native, /new File\(root, "previous-media"\)\.exists\(\)/);
  assert.match(native, /if \(!uncommittedStage \|\| hasRollbackData\) continue/);
  assert.match(native, /if \(!root\.exists\(\)\)/);
});

test('10GB-class exports use bounded encryption buffers and a foreground keep-alive service', () => {
  const fileWriter = native.slice(native.indexOf('private void writeFileRecord'), native.indexOf('private byte[] writeV3ChunkHeader'));
  assert.match(native, /FORMAT_VERSION = 3/);
  assert.match(native, /CHUNK_BYTES = 8 \* 1024 \* 1024/);
  assert.match(native, /状态数据异常过大，无法安全写入备份/);
  assert.match(fileWriter, /byte\[\] buffer = new byte\[CHUNK_BYTES\]/);
  assert.match(fileWriter, /writeV3Chunk/);
  assert.doesNotMatch(fileWriter, /new CipherOutputStream/);
  assert.match(native, /createV3ChunkCipher/);
  assert.match(chunkCrypto, /aad\.writeInt\(chunkIndex\)/);
  assert.match(chunkCrypto, /aad\.writeInt\(chunkCount\)/);
  assert.match(chunkCryptoTest, /eightMegabyteChunkRoundTripsWithFixedMemory/);
  assert.match(chunkCryptoTest, /encrypt\.doFinal\(plain, 0, plain\.length, encrypted, 0\)/);
  assert.match(chunkCryptoTest, /tamperOrChunkReorderingIsRejected/);
  assert.match(native, /extractV3Archive/);
  assert.match(native, /备份文件分块不连续/);
  assert.match(native, /expectedChunksLong > Integer\.MAX_VALUE/);
  assert.match(native, /RESTORE_RESERVE_BYTES/);
  assert.match(native, /root\.getUsableSpace\(\) < totalSize \+ RESTORE_RESERVE_BYTES/);
  assert.match(native, /AtomicBoolean EXPORT_RUNNING/);
  assert.match(native, /call\.setKeepAlive\(true\)/);
  assert.match(native, /BackupExportService\.start/);
  assert.match(service, /startForeground\(NOTIFICATION_ID/);
  assert.match(service, /PARTIAL_WAKE_LOCK/);
  assert.match(service, /setProgress\(100, percent, false\)/);
  assert.match(backup, /addListener\('backupProgress'/);
  assert.match(native, /notifyListeners\("backupProgress", progress\)/);
  assert.match(mine, /id="backup-export-progress"/);
  assert.match(mine, /id="backup-export-meter"/);
  assert.match(mine, /meter\.value = percent/);
  assert.match(css, /\.mine-backup-modal \.backup-export-status/);
  assert.match(mine, /正在导出：\$\{percent\}%/);
  assert.match(manifest, /FOREGROUND_SERVICE_DATA_SYNC/);
  assert.match(manifest, /android:name="\.BackupExportService"/);
});

test('private video browser removes copy papers and uses compact cover-only cards', () => {
  assert.doesNotMatch(vaultView, /vault-video-copy-paper|vault-item-actions-paper/);
  assert.match(vaultView, /data-vault-item-menu/);
  assert.match(vaultView, /vaultItemMenu/);
  assert.match(css, /\.private-vault-view \.vault-video-item\{[^}]*grid-column:auto!important/);
  assert.match(css, /\.vault-video-menu-trigger\{/);
});
