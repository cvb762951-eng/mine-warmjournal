package com.mine.focus;

import android.app.Activity;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.net.Uri;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.crypto.Cipher;
import javax.crypto.CipherInputStream;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

@CapacitorPlugin(name = "NativeStreamingBackup")
public class StreamingBackupPlugin extends Plugin {
    private static final byte[] MAGIC = "MINEBK2\n".getBytes(StandardCharsets.US_ASCII);
    private static final int FORMAT_VERSION = 3;
    private static final int LEGACY_FORMAT_VERSION = 2;
    private static final int PBKDF2_ITERATIONS = 210000;
    private static final int BUFFER_BYTES = 1024 * 1024;
    private static final int MAX_STATE_BYTES = 64 * 1024 * 1024;
    private static final int MAX_ENTRY_NAME_BYTES = 4096;
    private static final int GCM_TAG_BYTES = 16;
    private static final int CHUNK_BYTES = 8 * 1024 * 1024;
    private static final long RESTORE_RESERVE_BYTES = 128L * 1024L * 1024L;
    private static final long PROGRESS_INTERVAL_BYTES = 64L * 1024L * 1024L;
    private static final int TYPE_STATE = 1;
    private static final int TYPE_MEDIA = 2;
    private static final int TYPE_VAULT = 3;
    private static final int TYPE_END = 127;
    private static final String MEDIA_DIRECTORY = "MineWarmJournalMedia";
    private static final String VAULT_DIRECTORY = "MineWarmJournalVault";
    private static final ExecutorService BACKUP_EXECUTOR = Executors.newSingleThreadExecutor();
    private static final AtomicBoolean EXPORT_RUNNING = new AtomicBoolean(false);

    private PendingRestore pendingRestore;

    @Override
    public void load() {
        super.load();
        BACKUP_EXECUTOR.execute(() -> {
            CleanupStats cleaned = cleanupStaleUncommittedRestoreDirectories();
            if (cleaned.directories > 0) Log.i("MineBackup", "removed stale restore staging directories=" + cleaned.directories + " bytes=" + cleaned.bytes);
        });
    }

    @PluginMethod
    public void exportBackup(PluginCall call) {
        String password = call.getString("password", "");
        String payload = call.getString("payload", "");
        String filename = call.getString("filename", "mine-warmjournal-backup.minebackup");
        if (password.length() < 8 || payload.isEmpty()) {
            call.reject("备份参数不完整");
            return;
        }
        if (!EXPORT_RUNNING.compareAndSet(false, true)) {
            call.reject("已有备份正在导出，请等待完成");
            return;
        }
        call.setKeepAlive(true);
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/octet-stream");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        try {
            startActivityForResult(call, intent, "exportTargetSelected");
        } catch (Exception error) {
            EXPORT_RUNNING.set(false);
            call.setKeepAlive(false);
            call.reject(message(error, "无法打开备份保存位置"), error);
        }
    }

    @ActivityCallback
    private void exportTargetSelected(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            EXPORT_RUNNING.set(false);
            call.setKeepAlive(false);
            call.reject("已取消导出", "cancelled");
            return;
        }
        Uri target = result.getData().getData();
        String password = call.getString("password", "");
        String payload = call.getString("payload", "");
        String filename = call.getString("filename", "mine-warmjournal-backup.minebackup");
        long totalBytes = call.getLong("totalBytes", 0L);
        try {
            BackupExportService.start(getContext(), totalBytes);
            BACKUP_EXECUTOR.execute(() -> writeBackup(call, target, filename, payload, password, totalBytes));
        } catch (Exception error) {
            EXPORT_RUNNING.set(false);
            call.setKeepAlive(false);
            call.reject(message(error, "无法启动大容量备份任务"), error);
        }
    }

    @PluginMethod
    public void prepareRestore(PluginCall call) {
        String password = call.getString("password", "");
        if (password.length() < 8) {
            call.reject("备份密码至少需要 8 个字符");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/octet-stream", "application/json"});
        startActivityForResult(call, intent, "restoreSourceSelected");
    }

    @ActivityCallback
    private void restoreSourceSelected(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("已取消恢复", "cancelled");
            return;
        }
        Uri source = result.getData().getData();
        String password = call.getString("password", "");
        String operation = "verify".equals(call.getString("operation", "")) ? "verify" : "restore";
        long totalBytes = sourceLength(source);
        call.setKeepAlive(true);
        try {
            BackupExportService.start(getContext(), totalBytes, operation);
            BACKUP_EXECUTOR.execute(() -> prepareRestoreInBackground(call, source, password, operation, totalBytes));
        } catch (Exception error) {
            call.setKeepAlive(false);
            BackupExportService.stop(getContext());
            call.reject(message(error, "无法启动备份读取任务"), error);
        }
    }

    @PluginMethod
    public void commitRestore(PluginCall call) {
        String token = call.getString("token", "");
        BACKUP_EXECUTOR.execute(() -> {
            try {
                PendingRestore restore = requirePending(token);
                if (!restore.committed) commitDirectories(restore);
                JSObject result = new JSObject();
                result.put("committed", true);
                call.resolve(result);
            } catch (Exception error) {
                call.reject(message(error, "恢复媒体提交失败"), error);
            }
        });
    }

    @PluginMethod
    public void finalizeRestore(PluginCall call) {
        String token = call.getString("token", "");
        BACKUP_EXECUTOR.execute(() -> {
            try {
                PendingRestore restore = requirePending(token);
                deleteRecursively(restore.root);
                pendingRestore = null;
                call.resolve();
            } catch (Exception error) {
                call.reject(message(error, "无法完成恢复清理"), error);
            }
        });
    }

    @PluginMethod
    public void rollbackRestore(PluginCall call) {
        String token = call.getString("token", "");
        BACKUP_EXECUTOR.execute(() -> {
            try {
                PendingRestore restore = requirePending(token);
                rollbackDirectories(restore);
                deleteRecursively(restore.root);
                if (restore.root.exists()) throw new IllegalStateException("无法清理恢复临时区");
                pendingRestore = null;
                call.resolve();
            } catch (Exception error) {
                call.reject(message(error, "无法回滚恢复内容"), error);
            }
        });
    }

    private void writeBackup(PluginCall call, Uri target, String filename, String payload, String password, long totalBytes) {
        try (OutputStream raw = getContext().getContentResolver().openOutputStream(target, "w")) {
            if (raw == null) throw new IllegalStateException("无法写入所选位置");
            byte[] salt = randomBytes(16);
            SecretKeySpec key = deriveAesKey(password, salt, PBKDF2_ITERATIONS);
            ArchiveStats stats = new ArchiveStats();
            byte[] stateBytes = payload.getBytes(StandardCharsets.UTF_8);
            stats.totalBytes = Math.max(1L, totalBytes + stateBytes.length);
            publishProgress(stats, 0);
            try (DataOutputStream output = new DataOutputStream(new BufferedOutputStream(raw, BUFFER_BYTES))) {
                output.write(MAGIC);
                output.writeInt(FORMAT_VERSION);
                output.writeInt(PBKDF2_ITERATIONS);
                output.writeInt(salt.length);
                output.write(salt);
                writeV3BytesRecord(output, key, stats, TYPE_STATE, "state.json", stateBytes);
                writeDirectory(output, key, stats, new File(getContext().getFilesDir(), MEDIA_DIRECTORY), TYPE_MEDIA);
                writeDirectory(output, key, stats, new File(getContext().getFilesDir(), VAULT_DIRECTORY), TYPE_VAULT);
                byte[] manifest = (stats.records + ":" + stats.bytes).getBytes(StandardCharsets.US_ASCII);
                writeV3BytesRecord(output, key, stats, TYPE_END, "manifest", manifest);
                output.flush();
            }
            publishProgress(stats, stats.bytes);
            JSObject result = new JSObject();
            result.put("filename", filename);
            result.put("bytes", stats.bytes);
            result.put("formatVersion", FORMAT_VERSION);
            call.setKeepAlive(false);
            call.resolve(result);
        } catch (Exception error) {
            try { getContext().getContentResolver().delete(target, null, null); } catch (Exception ignored) {}
            call.setKeepAlive(false);
            call.reject(message(error, "大容量备份导出失败"), error);
        } finally {
            EXPORT_RUNNING.set(false);
            BackupExportService.stop(getContext());
        }
    }

    private void prepareRestoreInBackground(PluginCall call, Uri source, String password, String operation, long totalBytes) {
        File root = new File(getContext().getFilesDir(), ".mine-restore-" + UUID.randomUUID());
        File stageMedia = new File(root, "stage-media");
        File stageVault = new File(root, "stage-vault");
        RestoreStats stats = new RestoreStats(operation, totalBytes);
        try {
            discardPendingRestore();
            cleanupStaleUncommittedRestoreDirectories();
            if (!stageMedia.mkdirs() || !stageVault.mkdirs()) throw new IllegalStateException("无法创建安全恢复区");
            ArchiveExtraction extraction = extractArchive(source, password, stageMedia, stageVault, stats);
            String token = UUID.randomUUID().toString();
            pendingRestore = new PendingRestore(token, root, stageMedia, stageVault);
            JSObject result = new JSObject();
            result.put("token", token);
            result.put("payload", extraction.payload);
            result.put("formatVersion", extraction.version);
            call.resolve(result);
        } catch (Exception error) {
            deleteRecursively(root);
            call.reject(message(error, "备份密码错误，或文件已经损坏"), error);
        } finally {
            call.setKeepAlive(false);
            BackupExportService.stop(getContext());
        }
    }

    private ArchiveExtraction extractArchive(Uri source, String password, File stageMedia, File stageVault, RestoreStats stats) throws Exception {
        try (InputStream raw = getContext().getContentResolver().openInputStream(source)) {
            if (raw == null) throw new IllegalStateException("无法读取所选备份文件");
            CountingInputStream counted = new CountingInputStream(raw);
            stats.input = counted;
            DataInputStream input = new DataInputStream(new BufferedInputStream(counted, BUFFER_BYTES));
            publishRestoreProgress(stats, false);
            byte[] magic = new byte[MAGIC.length];
            input.readFully(magic);
            if (!java.util.Arrays.equals(magic, MAGIC)) throw new IllegalArgumentException("不是大容量备份文件");
            int version = input.readInt();
            int iterations = input.readInt();
            byte[] salt = readSizedBytes(input, 16, 64);
            if ((version != LEGACY_FORMAT_VERSION && version != FORMAT_VERSION) || iterations < 100000 || iterations > 1000000) throw new IllegalArgumentException("备份版本不受支持");
            SecretKeySpec key = deriveAesKey(password, salt, iterations);
            String payload = version == LEGACY_FORMAT_VERSION
                ? extractV2Archive(input, key, stageMedia, stageVault, stats)
                : extractV3Archive(input, key, stageMedia, stageVault, stats);
            publishRestoreProgress(stats, true);
            return new ArchiveExtraction(payload, version);
        }
    }

    private String extractV2Archive(DataInputStream input, SecretKeySpec key, File stageMedia, File stageVault, RestoreStats stats) throws Exception {
            String payload = null;
            long expectedSequence = 0;
            long restoredRecords = 0;
            long restoredBytes = 0;
            boolean complete = false;
            while (!complete) {
                long sequence = input.readLong();
                int type = input.readUnsignedByte();
                String name = readEntryName(input);
                long plainSize = input.readLong();
                if (sequence != expectedSequence++ || plainSize < 0 || plainSize > Long.MAX_VALUE - GCM_TAG_BYTES) throw new IllegalArgumentException("备份记录顺序或长度无效");
                byte[] iv = new byte[12];
                input.readFully(iv);
                BoundedInputStream encrypted = new BoundedInputStream(input, plainSize + GCM_TAG_BYTES);
                Cipher cipher = createV2EntryCipher(Cipher.DECRYPT_MODE, key, iv, sequence, type, name, plainSize);
                try (CipherInputStream plain = new CipherInputStream(encrypted, cipher)) {
                    if (type == TYPE_STATE) {
                        if (!"state.json".equals(name) || plainSize > MAX_STATE_BYTES) throw new IllegalArgumentException("状态数据无效");
                        payload = readText(plain, plainSize);
                    } else if (type == TYPE_MEDIA) {
                        writeRestoredFile(plain, stageMedia, name, plainSize);
                    } else if (type == TYPE_VAULT) {
                        writeRestoredFile(plain, stageVault, name, plainSize);
                    } else if (type == TYPE_END) {
                        String manifest = readText(plain, plainSize);
                        if (!manifest.equals(restoredRecords + ":" + restoredBytes)) throw new IllegalArgumentException("备份完整性校验失败");
                        complete = true;
                    } else {
                        throw new IllegalArgumentException("备份包含未知记录");
                    }
                    drainToEnd(plain);
                }
                if (encrypted.remaining != 0) throw new IllegalArgumentException("备份记录不完整");
                if (type != TYPE_END) {
                    restoredRecords += 1;
                    restoredBytes += plainSize;
                }
                publishRestoreProgress(stats, false);
            }
            if (input.read() != -1) throw new IllegalArgumentException("备份末尾包含异常数据");
            if (payload == null || payload.isEmpty()) throw new IllegalArgumentException("备份缺少状态数据");
            return payload;
    }

    private String extractV3Archive(DataInputStream input, SecretKeySpec key, File stageMedia, File stageVault, RestoreStats stats) throws Exception {
        String payload = null;
        long expectedSequence = 0;
        long restoredRecords = 0;
        long restoredBytes = 0;
        V3RestoreFile activeFile = null;
        boolean complete = false;
        try {
            while (!complete) {
                long sequence = input.readLong();
                int type = input.readUnsignedByte();
                String name = readEntryName(input);
                long totalSize = input.readLong();
                int chunkIndex = input.readInt();
                int chunkCount = input.readInt();
                int plainSize = input.readInt();
                if (sequence != expectedSequence++ || totalSize < 0 || chunkCount <= 0 || chunkIndex < 0 || chunkIndex >= chunkCount || plainSize < 0 || plainSize > CHUNK_BYTES) throw new IllegalArgumentException("备份分块顺序或长度无效");
                long expectedChunksLong = Math.max(1L, (totalSize + CHUNK_BYTES - 1L) / CHUNK_BYTES);
                if (expectedChunksLong > Integer.MAX_VALUE) throw new IllegalArgumentException("备份中的单个媒体文件过大");
                int expectedChunks = (int)expectedChunksLong;
                long expectedChunkSize = chunkIndex == chunkCount - 1 ? totalSize - (long)chunkIndex * CHUNK_BYTES : CHUNK_BYTES;
                if (chunkCount != expectedChunks || plainSize != expectedChunkSize) throw new IllegalArgumentException("备份分块清单无效");
                byte[] iv = new byte[12];
                input.readFully(iv);
                byte[] encrypted = new byte[plainSize + GCM_TAG_BYTES];
                input.readFully(encrypted);
                Cipher cipher = createV3ChunkCipher(Cipher.DECRYPT_MODE, key, iv, sequence, type, name, totalSize, chunkIndex, chunkCount, plainSize);
                byte[] plain = cipher.doFinal(encrypted);
                if (plain.length != plainSize) throw new IllegalArgumentException("备份分块长度不一致");
                if (type == TYPE_STATE || type == TYPE_END) {
                    if (activeFile != null) { activeFile.finish(); activeFile = null; }
                    if (chunkCount != 1 || chunkIndex != 0 || plainSize > MAX_STATE_BYTES) throw new IllegalArgumentException("备份文字记录无效");
                    String text = new String(plain, StandardCharsets.UTF_8);
                    if (type == TYPE_STATE) {
                        if (!"state.json".equals(name)) throw new IllegalArgumentException("状态数据无效");
                        payload = text;
                    } else {
                        if (!"manifest".equals(name) || !text.equals(restoredRecords + ":" + restoredBytes)) throw new IllegalArgumentException("备份完整性校验失败");
                        complete = true;
                    }
                } else if (type == TYPE_MEDIA || type == TYPE_VAULT) {
                    File root = type == TYPE_MEDIA ? stageMedia : stageVault;
                    if (chunkIndex == 0) {
                        if (activeFile != null) activeFile.finish();
                        activeFile = openV3RestoreFile(root, name, totalSize, chunkCount, type);
                    }
                    if (activeFile == null || !activeFile.matches(name, totalSize, chunkCount, type) || activeFile.nextChunk != chunkIndex) throw new IllegalArgumentException("备份文件分块不连续");
                    activeFile.write(plain);
                    if (chunkIndex == chunkCount - 1) { activeFile.finish(); activeFile = null; }
                } else {
                    throw new IllegalArgumentException("备份包含未知记录");
                }
                if (type != TYPE_END) { restoredRecords += 1; restoredBytes += plainSize; }
                publishRestoreProgress(stats, false);
            }
        } finally {
            if (activeFile != null) activeFile.closeQuietly();
        }
        if (input.read() != -1) throw new IllegalArgumentException("备份末尾包含异常数据");
        if (payload == null || payload.isEmpty()) throw new IllegalArgumentException("备份缺少状态数据");
        return payload;
    }

    private void commitDirectories(PendingRestore restore) throws Exception {
        File files = getContext().getFilesDir();
        restore.currentMedia = new File(files, MEDIA_DIRECTORY);
        restore.currentVault = new File(files, VAULT_DIRECTORY);
        restore.previousMedia = new File(restore.root, "previous-media");
        restore.previousVault = new File(restore.root, "previous-vault");
        try {
            restore.mediaTouched = true;
            moveIfExists(restore.currentMedia, restore.previousMedia);
            moveRequired(restore.stageMedia, restore.currentMedia);
            restore.vaultTouched = true;
            moveIfExists(restore.currentVault, restore.previousVault);
            moveRequired(restore.stageVault, restore.currentVault);
            restore.committed = true;
        } catch (Exception error) {
            rollbackDirectories(restore);
            throw error;
        }
    }

    private void rollbackDirectories(PendingRestore restore) throws Exception {
        if (restore.mediaTouched) {
            if (restore.currentMedia != null && restore.currentMedia.exists()) deleteRecursively(restore.currentMedia);
            if (restore.previousMedia != null && restore.previousMedia.exists()) moveRequired(restore.previousMedia, restore.currentMedia);
            restore.mediaTouched = false;
        }
        if (restore.vaultTouched) {
            if (restore.currentVault != null && restore.currentVault.exists()) deleteRecursively(restore.currentVault);
            if (restore.previousVault != null && restore.previousVault.exists()) moveRequired(restore.previousVault, restore.currentVault);
            restore.vaultTouched = false;
        }
        restore.committed = false;
    }

    private void writeDirectory(DataOutputStream output, SecretKeySpec key, ArchiveStats stats, File directory, int type) throws Exception {
        if (!directory.exists()) return;
        writeDirectoryChildren(output, key, stats, directory, directory, type);
    }

    private void writeDirectoryChildren(DataOutputStream output, SecretKeySpec key, ArchiveStats stats, File root, File current, int type) throws Exception {
        File[] files = current.listFiles();
        if (files == null) return;
        for (File file : files) {
            if (file.isDirectory()) {
                writeDirectoryChildren(output, key, stats, root, file, type);
                continue;
            }
            String relative = safeEntryName(root.toURI().relativize(file.toURI()).getPath());
            writeFileRecord(output, key, stats, type, relative, file);
        }
    }

    private void writeV3BytesRecord(DataOutputStream output, SecretKeySpec key, ArchiveStats stats, int type, String name, byte[] bytes) throws Exception {
        if (bytes.length > CHUNK_BYTES) throw new IllegalArgumentException("状态数据异常过大，无法安全写入备份");
        writeV3Chunk(output, key, stats.records, type, name, bytes.length, 0, 1, bytes, bytes.length);
        if (type != TYPE_END) { stats.records += 1; stats.bytes += bytes.length; }
    }

    private void writeFileRecord(DataOutputStream output, SecretKeySpec key, ArchiveStats stats, int type, String name, File file) throws Exception {
        long size = file.length();
        long chunks = Math.max(1L, (size + CHUNK_BYTES - 1L) / CHUNK_BYTES);
        if (chunks > Integer.MAX_VALUE) throw new IllegalArgumentException("单个媒体文件过大");
        int chunkCount = (int)chunks;
        long remaining = size;
        byte[] buffer = new byte[CHUNK_BYTES];
        try (InputStream source = new BufferedInputStream(new FileInputStream(file), BUFFER_BYTES)) {
            for (int chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
                int expected = (int)Math.min(CHUNK_BYTES, remaining);
                int read = readExactly(source, buffer, expected);
                if (read != expected) throw new IllegalStateException("备份期间媒体文件发生变化");
                writeV3Chunk(output, key, stats.records, type, name, size, chunkIndex, chunkCount, buffer, read);
                remaining -= read;
                stats.records += 1;
                stats.bytes += read;
                if (stats.bytes - stats.lastNotifiedBytes >= PROGRESS_INTERVAL_BYTES) {
                    output.flush();
                    stats.lastNotifiedBytes = stats.bytes;
                    publishProgress(stats, stats.bytes);
                }
            }
            if (source.read() != -1) throw new IllegalStateException("备份期间媒体文件发生变化");
        }
    }

    private void writeV3Chunk(DataOutputStream output, SecretKeySpec key, long sequence, int type, String name, long totalSize, int chunkIndex, int chunkCount, byte[] plain, int plainSize) throws Exception {
        byte[] iv = writeV3ChunkHeader(output, sequence, type, name, totalSize, chunkIndex, chunkCount, plainSize);
        Cipher cipher = createV3ChunkCipher(Cipher.ENCRYPT_MODE, key, iv, sequence, type, name, totalSize, chunkIndex, chunkCount, plainSize);
        byte[] encrypted = new byte[plainSize + GCM_TAG_BYTES];
        int encryptedSize = cipher.doFinal(plain, 0, plainSize, encrypted, 0);
        if (encryptedSize != encrypted.length) throw new IllegalStateException("加密分块长度异常");
        output.write(encrypted, 0, encryptedSize);
    }

    private byte[] writeV3ChunkHeader(DataOutputStream output, long sequence, int type, String name, long totalSize, int chunkIndex, int chunkCount, int plainSize) throws Exception {
        String safeName = safeEntryName(name);
        byte[] nameBytes = safeName.getBytes(StandardCharsets.UTF_8);
        if (nameBytes.length == 0 || nameBytes.length > MAX_ENTRY_NAME_BYTES) throw new IllegalArgumentException("备份文件名无效");
        byte[] iv = randomBytes(12);
        output.writeLong(sequence);
        output.writeByte(type);
        output.writeInt(nameBytes.length);
        output.write(nameBytes);
        output.writeLong(totalSize);
        output.writeInt(chunkIndex);
        output.writeInt(chunkCount);
        output.writeInt(plainSize);
        output.write(iv);
        return iv;
    }

    private void publishProgress(ArchiveStats stats, long completedBytes) {
        long completed = Math.max(0L, completedBytes);
        BackupExportService.update(completed, stats.totalBytes);
        JSObject progress = new JSObject();
        progress.put("completedBytes", completed);
        progress.put("totalBytes", stats.totalBytes);
        progress.put("percent", stats.totalBytes > 0 ? Math.min(100L, completed * 100L / stats.totalBytes) : 0L);
        notifyListeners("backupProgress", progress);
    }

    private void publishRestoreProgress(RestoreStats stats, boolean complete) {
        if (stats == null) return; // Archive integrity tests run without an Android progress observer.
        long completed = stats.input == null ? 0L : stats.input.count;
        if (!complete && completed > 0 && completed - stats.lastNotifiedBytes < PROGRESS_INTERVAL_BYTES) return;
        if (complete && stats.totalBytes > 0) completed = stats.totalBytes;
        stats.lastNotifiedBytes = completed;
        BackupExportService.update(completed, stats.totalBytes);
        JSObject progress = new JSObject();
        progress.put("operation", stats.operation);
        progress.put("completedBytes", completed);
        progress.put("totalBytes", stats.totalBytes);
        notifyListeners("restoreProgress", progress);
    }

    private long sourceLength(Uri source) {
        try (AssetFileDescriptor descriptor = getContext().getContentResolver().openAssetFileDescriptor(source, "r")) {
            return descriptor == null ? 0L : Math.max(0L, descriptor.getLength());
        } catch (Exception ignored) {
            return 0L;
        }
    }

    private String readEntryName(DataInputStream input) throws Exception {
        int length = input.readInt();
        if (length <= 0 || length > MAX_ENTRY_NAME_BYTES) throw new IllegalArgumentException("备份文件名无效");
        byte[] bytes = new byte[length];
        input.readFully(bytes);
        return safeEntryName(new String(bytes, StandardCharsets.UTF_8));
    }

    private String readText(InputStream input, long expectedSize) throws Exception {
        if (expectedSize > MAX_STATE_BYTES) throw new IllegalArgumentException("状态数据异常过大");
        ByteArrayOutputStream output = new ByteArrayOutputStream((int)expectedSize);
        byte[] buffer = new byte[Math.min(BUFFER_BYTES, Math.max(1, (int)expectedSize))];
        long copied = copyExactly(input, output, expectedSize, buffer);
        if (copied != expectedSize) throw new IllegalArgumentException("备份文字记录不完整");
        return output.toString(StandardCharsets.UTF_8.name());
    }

    private void writeRestoredFile(InputStream input, File root, String relative, long expectedSize) throws Exception {
        if (relative.isEmpty()) return;
        File target = new File(root, relative);
        String rootPath = root.getCanonicalPath() + File.separator;
        if (!target.getCanonicalPath().startsWith(rootPath)) throw new IllegalArgumentException("备份包含非法文件路径");
        File parent = target.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) throw new IllegalStateException("无法创建恢复目录");
        try (OutputStream output = new BufferedOutputStream(new FileOutputStream(target), BUFFER_BYTES)) {
            byte[] buffer = new byte[BUFFER_BYTES];
            if (copyExactly(input, output, expectedSize, buffer) != expectedSize) throw new IllegalArgumentException("备份媒体记录不完整");
        }
    }

    private long copyExactly(InputStream input, OutputStream output, long expectedSize, byte[] buffer) throws Exception {
        long remaining = expectedSize;
        while (remaining > 0) {
            int read = input.read(buffer, 0, (int)Math.min(buffer.length, remaining));
            if (read < 0) break;
            output.write(buffer, 0, read);
            remaining -= read;
        }
        return expectedSize - remaining;
    }

    private void drainToEnd(InputStream input) throws Exception {
        byte[] buffer = new byte[8192];
        while (input.read(buffer) != -1) { }
    }

    private String safeEntryName(String name) {
        String clean = name == null ? "" : name.replace('\\', '/');
        if (clean.startsWith("/") || clean.contains("../") || clean.contains(":") || clean.indexOf('\0') >= 0) {
            throw new IllegalArgumentException("备份包含非法文件路径");
        }
        return clean;
    }

    private SecretKeySpec deriveAesKey(String password, byte[] salt, int iterations) throws Exception {
        PBEKeySpec keySpec = new PBEKeySpec(password.toCharArray(), salt, iterations, 256);
        SecretKey key = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(keySpec);
        keySpec.clearPassword();
        return new SecretKeySpec(key.getEncoded(), "AES");
    }

    private Cipher createV2EntryCipher(int mode, SecretKeySpec key, byte[] iv, long sequence, int type, String name, long size) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, key, new GCMParameterSpec(128, iv));
        ByteArrayOutputStream aadBytes = new ByteArrayOutputStream();
        DataOutputStream aad = new DataOutputStream(aadBytes);
        aad.write(MAGIC);
        aad.writeInt(LEGACY_FORMAT_VERSION);
        aad.writeLong(sequence);
        aad.writeByte(type);
        byte[] nameBytes = name.getBytes(StandardCharsets.UTF_8);
        aad.writeInt(nameBytes.length);
        aad.write(nameBytes);
        aad.writeLong(size);
        aad.flush();
        cipher.updateAAD(aadBytes.toByteArray());
        return cipher;
    }

    private Cipher createV3ChunkCipher(int mode, SecretKeySpec key, byte[] iv, long sequence, int type, String name, long totalSize, int chunkIndex, int chunkCount, int plainSize) throws Exception {
        return BackupChunkCrypto.cipher(mode, key, iv, MAGIC, FORMAT_VERSION, sequence, type, name, totalSize, chunkIndex, chunkCount, plainSize);
    }

    private int readExactly(InputStream input, byte[] buffer, int expected) throws Exception {
        int total = 0;
        while (total < expected) {
            int read = input.read(buffer, total, expected - total);
            if (read < 0) break;
            total += read;
        }
        return total;
    }

    private V3RestoreFile openV3RestoreFile(File root, String relative, long totalSize, int chunkCount, int type) throws Exception {
        if (root.getUsableSpace() < totalSize + RESTORE_RESERVE_BYTES) throw new IllegalStateException("恢复临时空间不足，需要至少 " + formatRequiredBytes(totalSize + RESTORE_RESERVE_BYTES));
        File target = safeRestoreTarget(root, relative);
        File parent = target.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) throw new IllegalStateException("无法创建恢复目录");
        return new V3RestoreFile(target, relative, totalSize, chunkCount, type);
    }

    private File safeRestoreTarget(File root, String relative) throws Exception {
        if (relative.isEmpty()) throw new IllegalArgumentException("备份文件名无效");
        File target = new File(root, relative);
        String rootPath = root.getCanonicalPath() + File.separator;
        if (!target.getCanonicalPath().startsWith(rootPath)) throw new IllegalArgumentException("备份包含非法文件路径");
        return target;
    }

    private String formatRequiredBytes(long bytes) {
        double gib = bytes / (1024d * 1024d * 1024d);
        return String.format(java.util.Locale.US, "%.1f GB", gib);
    }

    private byte[] readSizedBytes(DataInputStream input, int expected, int maximum) throws Exception {
        int length = input.readInt();
        if (length != expected || length > maximum) throw new IllegalArgumentException("备份加密头无效");
        byte[] bytes = new byte[length];
        input.readFully(bytes);
        return bytes;
    }

    private byte[] randomBytes(int length) {
        byte[] bytes = new byte[length];
        new SecureRandom().nextBytes(bytes);
        return bytes;
    }

    private PendingRestore requirePending(String token) {
        if (pendingRestore == null || !pendingRestore.token.equals(token)) throw new IllegalStateException("恢复会话已失效，请重新选择备份");
        return pendingRestore;
    }

    private void discardPendingRestore() throws Exception {
        if (pendingRestore == null) return;
        rollbackDirectories(pendingRestore);
        deleteRecursively(pendingRestore.root);
        if (pendingRestore.root.exists()) throw new IllegalStateException("无法清理恢复临时区");
        pendingRestore = null;
    }

    private CleanupStats cleanupStaleUncommittedRestoreDirectories() {
        CleanupStats stats = new CleanupStats();
        File[] roots = getContext().getFilesDir().listFiles(file -> file.isDirectory() && file.getName().startsWith(".mine-restore-"));
        if (roots == null) return stats;
        for (File root : roots) {
            boolean uncommittedStage = new File(root, "stage-media").isDirectory() || new File(root, "stage-vault").isDirectory();
            boolean hasRollbackData = new File(root, "previous-media").exists() || new File(root, "previous-vault").exists();
            if (!uncommittedStage || hasRollbackData) continue;
            long bytes = treeBytes(root);
            deleteRecursively(root);
            if (!root.exists()) { stats.directories += 1; stats.bytes += bytes; }
            else Log.w("MineBackup", "unable to remove stale restore staging " + root.getName());
        }
        return stats;
    }

    private long treeBytes(File file) {
        if (file == null || !file.exists()) return 0L;
        if (file.isFile()) return Math.max(0L, file.length());
        long bytes = 0L;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) bytes += treeBytes(child);
        return bytes;
    }

    private void moveIfExists(File source, File target) throws Exception {
        if (source.exists()) moveRequired(source, target);
    }

    private void moveRequired(File source, File target) throws Exception {
        if (target.exists()) deleteRecursively(target);
        if (!source.renameTo(target)) throw new IllegalStateException("无法安全切换恢复目录");
    }

    private void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        file.delete();
    }

    private String message(Exception error, String fallback) {
        return error.getMessage() == null || error.getMessage().isEmpty() ? fallback : error.getMessage();
    }

    private static class ArchiveStats {
        long records;
        long bytes;
        long totalBytes;
        long lastNotifiedBytes;
    }

    private static class CleanupStats {
        int directories;
        long bytes;
    }

    private static class RestoreStats {
        final String operation;
        final long totalBytes;
        CountingInputStream input;
        long lastNotifiedBytes;

        RestoreStats(String operation, long totalBytes) {
            this.operation = operation;
            this.totalBytes = totalBytes;
        }
    }

    private static class CountingInputStream extends InputStream {
        private final InputStream input;
        long count;

        CountingInputStream(InputStream input) { this.input = input; }

        @Override public int read() throws java.io.IOException {
            int value = input.read();
            if (value >= 0) count += 1;
            return value;
        }

        @Override public int read(byte[] bytes, int offset, int length) throws java.io.IOException {
            int read = input.read(bytes, offset, length);
            if (read > 0) count += read;
            return read;
        }
    }

    private static class BoundedInputStream extends InputStream {
        private final InputStream input;
        long remaining;

        BoundedInputStream(InputStream input, long remaining) {
            this.input = input;
            this.remaining = remaining;
        }

        @Override public int read() throws java.io.IOException {
            if (remaining <= 0) return -1;
            int value = input.read();
            if (value < 0) throw new java.io.EOFException("加密记录不完整");
            remaining -= 1;
            return value;
        }

        @Override public int read(byte[] bytes, int offset, int length) throws java.io.IOException {
            if (remaining <= 0) return -1;
            int allowed = (int)Math.min(length, remaining);
            int read = input.read(bytes, offset, allowed);
            if (read < 0) throw new java.io.EOFException("加密记录不完整");
            remaining -= read;
            return read;
        }

        @Override public void close() { /* record stream must not close the archive stream */ }
    }

    private static class ArchiveExtraction {
        final String payload;
        final int version;

        ArchiveExtraction(String payload, int version) {
            this.payload = payload;
            this.version = version;
        }
    }

    private static class V3RestoreFile {
        final File target;
        final String name;
        final long totalSize;
        final int chunkCount;
        final int type;
        final FileOutputStream output;
        long written;
        int nextChunk;
        boolean closed;

        V3RestoreFile(File target, String name, long totalSize, int chunkCount, int type) throws Exception {
            this.target = target;
            this.name = name;
            this.totalSize = totalSize;
            this.chunkCount = chunkCount;
            this.type = type;
            this.output = new FileOutputStream(target, false);
        }

        boolean matches(String otherName, long otherSize, int otherCount, int otherType) {
            return name.equals(otherName) && totalSize == otherSize && chunkCount == otherCount && type == otherType;
        }

        void write(byte[] bytes) throws Exception {
            output.write(bytes);
            written += bytes.length;
            nextChunk += 1;
        }

        void finish() throws Exception {
            if (closed) return;
            if (nextChunk != chunkCount || written != totalSize) throw new IllegalArgumentException("备份文件分块不完整");
            output.flush();
            output.getFD().sync();
            output.close();
            closed = true;
        }

        void closeQuietly() {
            if (closed) return;
            try { output.close(); } catch (Exception ignored) {}
            if (target.exists()) target.delete();
            closed = true;
        }
    }

    private static class PendingRestore {
        final String token;
        final File root;
        final File stageMedia;
        final File stageVault;
        File currentMedia;
        File currentVault;
        File previousMedia;
        File previousVault;
        boolean committed;
        boolean mediaTouched;
        boolean vaultTouched;

        PendingRestore(String token, File root, File stageMedia, File stageVault) {
            this.token = token;
            this.root = root;
            this.stageMedia = stageMedia;
            this.stageVault = stageVault;
        }
    }
}
