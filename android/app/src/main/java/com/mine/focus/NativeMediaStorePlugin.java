package com.mine.focus;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.UriPermission;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Parcelable;
import android.provider.OpenableColumns;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.SecureRandom;
import java.util.Locale;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.CipherInputStream;
import javax.crypto.CipherOutputStream;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

@CapacitorPlugin(name = "NativeMediaStore", permissions = {
    // ⚠️ 只有 Android 9 及以下才需要「写外部存储」权限。
    //    Android 10 起改用 MediaStore 插入 + IS_PENDING，属于应用自己的写入，不再需要权限。
    @Permission(alias = "legacyWrite", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
})
public class NativeMediaStorePlugin extends Plugin {
    private static final long RESERVE_BYTES = 48L * 1024L * 1024L;
    private static final String DIRECTORY = "MineWarmJournalMedia";
    private static final String VAULT_DIRECTORY = "MineWarmJournalVault";
    private static final String VAULT_PREVIEW_DIRECTORY = "MineWarmJournalVaultPreview";
    private static final ExecutorService FILE_EXECUTOR = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void copyVideo(PluginCall call) {
        String source = call.getString("source", "");
        String originalName = call.getString("name", "video.mp4");
        long expectedBytes = call.getLong("expectedBytes", 0L);
        if (source.isEmpty()) {
            call.reject("没有可读取的视频来源");
            return;
        }
        FILE_EXECUTOR.execute(() -> copyVideoInBackground(call, source, originalName, expectedBytes));
    }

    @PluginMethod
    public void encryptMedia(PluginCall call) {
        String source = call.getString("source", "");
        String originalName = call.getString("name", "private.bin");
        String key = call.getString("key", "");
        long expectedBytes = call.getLong("expectedBytes", 0L);
        if (source.isEmpty() || key.isEmpty()) { call.reject("私密媒体参数不完整"); return; }
        FILE_EXECUTOR.execute(() -> encryptMediaInBackground(call, source, originalName, key, expectedBytes));
    }

    @PluginMethod
    public void encryptStoredMedia(PluginCall call) {
        String sourceName = safeStoredMediaName(call.getString("sourceName", ""));
        String originalName = call.getString("name", "private.bin");
        String key = call.getString("key", "");
        long expectedBytes = call.getLong("expectedBytes", 0L);
        if (sourceName.isEmpty() || key.isEmpty()) { call.reject("原随手拍媒体参数不完整"); return; }
        File source = new File(new File(getContext().getFilesDir(), DIRECTORY), sourceName);
        if (!source.exists()) { call.reject("原随手拍媒体文件不存在"); return; }
        FILE_EXECUTOR.execute(() -> encryptMediaInBackground(call, source.getAbsolutePath(), originalName, key, expectedBytes));
    }

    @PluginMethod
    public void decryptMedia(PluginCall call) {
        String name = safeVaultName(call.getString("name", ""));
        String iv = call.getString("iv", "");
        String key = call.getString("key", "");
        String extension = safeExtension("file." + call.getString("extension", "mp4"));
        if (name.isEmpty() || iv.isEmpty() || key.isEmpty()) { call.reject("私密媒体解锁参数不完整"); return; }
        FILE_EXECUTOR.execute(() -> decryptMediaInBackground(call, name, iv, key, extension));
    }

    @PluginMethod
    public void clearVaultPreviews(PluginCall call) {
        FILE_EXECUTOR.execute(() -> {
            deleteChildren(new File(getContext().getCacheDir(), VAULT_PREVIEW_DIRECTORY));
            call.resolve();
        });
    }

    /**
     * 把私密内容写进系统相册（2026-10-10 新增，用户要求的「保存到相册」）。
     *
     * 两种来源：
     *   · storedName —— 存在 MineWarmJournalMedia 里的普通媒体（现在私密空间用的大多是这种）
     *   · vaultName + iv + key —— 老版本的加密文件，需要边解密边写
     *
     * 为什么解密和写盘放在一步里做：
     *   如果先解密到缓存再复制进相册，缓存里就会留下一份明文 —— 那正是私密空间要避免的事。
     *   这里用 CipherInputStream 直接接到相册的输出流，明文从头到尾不落盘。
     */
    @PluginMethod
    public void exportToGallery(PluginCall call) {
        String storedName = safeStoredMediaName(call.getString("storedName", ""));
        String vaultName = safeVaultName(call.getString("vaultName", ""));
        String iv = call.getString("iv", "");
        String key = call.getString("key", "");
        String displayName = call.getString("displayName", "");
        String mimeType = call.getString("mimeType", "video/mp4");
        String kind = "photo".equals(call.getString("kind", "video")) ? "photo" : "video";
        boolean hasStored = !storedName.isEmpty();
        boolean hasVault = !vaultName.isEmpty() && !iv.isEmpty() && !key.isEmpty();
        if (!hasStored && !hasVault) { call.reject("没有可导出的私密文件"); return; }
        if (displayName.isEmpty()) { call.reject("缺少导出文件名"); return; }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && getPermissionState("legacyWrite") != PermissionState.GRANTED) {
            requestPermissionForAlias("legacyWrite", call, "exportPermissionCallback");
            return;
        }
        final String finalStored = storedName;
        final String finalVault = vaultName;
        FILE_EXECUTOR.execute(() -> exportToGalleryInBackground(
                call, finalStored, finalVault, iv, key, displayName, mimeType, kind));
    }

    @PermissionCallback
    private void exportPermissionCallback(PluginCall call) {
        if (getPermissionState("legacyWrite") == PermissionState.GRANTED) exportToGallery(call);
        else call.reject("系统没有授予写入相册的权限");
    }

    private void exportToGalleryInBackground(PluginCall call, String storedName, String vaultName,
                                             String ivBase64, String keyBase64, String displayName,
                                             String mimeType, String kind) {
        final boolean video = !"photo".equals(kind);
        final Uri collection = video
                ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, displayName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // 落到 Movies/Mine、Pictures/Mine，相册里会成为一个独立目录，便于回找
            values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                    (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/Mine");
            // 写入期间标记为"待完成"，写完再置 0 —— 中途拔出/被杀不会在相册里留下半截文件
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        }
        ContentResolver resolver = getContext().getContentResolver();
        Uri target = null;
        try {
            target = resolver.insert(collection, values);
            if (target == null) throw new IllegalStateException("系统相册拒绝了写入");

            InputStream source;
            if (!storedName.isEmpty()) {
                File stored = new File(new File(getContext().getFilesDir(), DIRECTORY), storedName);
                if (!stored.exists()) throw new IllegalStateException("本机媒体文件不存在");
                source = new FileInputStream(stored);
            } else {
                File encrypted = new File(new File(getContext().getFilesDir(), VAULT_DIRECTORY), vaultName);
                if (!encrypted.exists()) throw new IllegalStateException("私密文件不存在");
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE,
                        new SecretKeySpec(Base64.decode(keyBase64, Base64.NO_WRAP), "AES"),
                        new GCMParameterSpec(128, Base64.decode(ivBase64, Base64.NO_WRAP)));
                source = new CipherInputStream(new FileInputStream(encrypted), cipher);
            }

            try (InputStream input = source; OutputStream output = resolver.openOutputStream(target)) {
                if (output == null) throw new IllegalStateException("无法写入相册文件");
                byte[] buffer = new byte[1024 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                output.flush();
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(target, done, null, null);
            }

            JSObject result = new JSObject();
            result.put("displayName", displayName);
            result.put("uri", target.toString());
            result.put("album", video ? "Movies/Mine" : "Pictures/Mine");
            call.resolve(result);
        } catch (Exception error) {
            // 失败就把刚插入的空壳删掉，别在相册里留下一条打不开的记录
            if (target != null) {
                try { resolver.delete(target, null, null); } catch (Exception ignored) { }
            }
            String reason = error.getMessage() == null ? "未知原因" : error.getMessage();
            call.reject("写入系统相册失败：" + reason, error);
        }
    }

    @PluginMethod
    public void pickPrivateMedia(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "video/*"});
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "pickPrivateMediaResult");
    }

    @PluginMethod
    public void listStoredMedia(PluginCall call) {
        FILE_EXECUTOR.execute(() -> {
            try {
                File directory = new File(getContext().getFilesDir(), DIRECTORY);
                File[] stored = directory.listFiles(File::isFile);
                if (stored == null) stored = new File[0];
                Arrays.sort(stored, Comparator.comparingLong(File::lastModified));
                ArrayList<JSObject> files = new ArrayList<>();
                for (File file : stored) {
                    String name = safeStoredMediaName(file.getName());
                    if (name.isEmpty()) continue;
                    JSObject item = new JSObject();
                    item.put("name", name);
                    item.put("size", file.length());
                    item.put("lastModified", file.lastModified());
                    item.put("mediaKind", detectMediaKind(file));
                    files.add(item);
                }
                JSObject response = new JSObject();
                response.put("files", JSArray.from(files.toArray()));
                response.put("storage", privateStorageBreakdown());
                response.put("restoreComparisons", restoreStagingComparisons(directory));
                response.put("persistedMedia", readablePersistedMedia());
                call.resolve(response);
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "无法扫描App媒体目录" : error.getMessage(), error);
            }
        });
    }

    @ActivityCallback
    private void pickPrivateMediaResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("已取消选择");
            return;
        }
        Intent data = result.getData();
        ArrayList<Uri> uris = selectedUris(data);
        if (uris.isEmpty()) {
            call.reject("没有选择照片或视频");
            return;
        }
        if (uris.size() > 100) {
            call.reject("一次最多导入 100 个私密文件");
            return;
        }
        int grantFlags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        FILE_EXECUTOR.execute(() -> resolvePickedMedia(call, uris, grantFlags));
    }

    @PluginMethod
    public void deleteOriginalMedia(PluginCall call) {
        JSArray values = call.getArray("uris");
        ArrayList<String> uris = new ArrayList<>();
        if (values != null) for (int index = 0; index < values.length(); index += 1) {
            String value = values.optString(index, "");
            if (value.startsWith("content://")) uris.add(value);
        }
        if (uris.isEmpty()) { call.reject("没有可删除的本机相册原件"); return; }
        Intent intent = new Intent(getContext(), OriginalMediaDeleteActivity.class);
        intent.putStringArrayListExtra(OriginalMediaDeleteActivity.EXTRA_URIS, uris);
        startActivityForResult(call, intent, "deleteOriginalMediaResult");
    }

    @ActivityCallback
    private void deleteOriginalMediaResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != android.app.Activity.RESULT_OK) {
            String message = result.getData() == null ? "系统未授权删除，相册原件已保留" : result.getData().getStringExtra(OriginalMediaDeleteActivity.EXTRA_ERROR);
            call.reject(message == null || message.isEmpty() ? "系统未授权删除，相册原件已保留" : message);
            return;
        }
        JSObject response = new JSObject();
        response.put("deleted", result.getData() == null ? 0 : result.getData().getIntExtra(OriginalMediaDeleteActivity.EXTRA_DELETED, 0));
        call.resolve(response);
    }

    private void copyVideoInBackground(PluginCall call, String source, String originalName, long expectedBytes) {
        File directory = new File(getContext().getFilesDir(), DIRECTORY);
        if (!directory.exists() && !directory.mkdirs()) {
            call.reject("无法创建视频存储目录");
            return;
        }
        if (expectedBytes > 0 && directory.getUsableSpace() < expectedBytes + RESERVE_BYTES) {
            call.reject("本机存储空间不足，无法保存这个视频");
            return;
        }
        String extension = safeExtension(originalName);
        String name = UUID.randomUUID().toString() + "." + extension;
        File target = new File(directory, name);
        long copied = 0;
        try (InputStream input = openSource(source); FileOutputStream output = new FileOutputStream(target)) {
            byte[] buffer = new byte[1024 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                copied += read;
                if (directory.getUsableSpace() < RESERVE_BYTES) throw new IllegalStateException("本机存储空间不足");
                output.write(buffer, 0, read);
            }
            output.getFD().sync();
            JSObject result = new JSObject();
            result.put("name", name);
            result.put("uri", Uri.fromFile(target).toString());
            result.put("bytes", copied);
            result.put("availableBytes", directory.getUsableSpace());
            call.resolve(result);
        } catch (Exception error) {
            if (target.exists()) target.delete();
            call.reject(error.getMessage() == null ? "视频保存失败" : error.getMessage(), error);
        }
    }

    private ArrayList<Uri> selectedUris(Intent data) {
        ArrayList<Uri> uris = new ArrayList<>();
        ClipData clipData = data.getClipData();
        if (clipData != null) {
            for (int index = 0; index < clipData.getItemCount(); index += 1) {
                Uri uri = clipData.getItemAt(index).getUri();
                if (uri != null) uris.add(uri);
            }
            return uris;
        }
        Uri single = data.getData();
        if (single != null) {
            uris.add(single);
            return uris;
        }
        Bundle extras = data.getExtras();
        if (extras == null) return uris;
        ArrayList<Parcelable> selected = extras.getParcelableArrayList("selectedItems");
        if (selected != null) for (Parcelable value : selected) if (value instanceof Uri) uris.add((Uri)value);
        return uris;
    }

    private void resolvePickedMedia(PluginCall call, ArrayList<Uri> uris, int grantFlags) {
        try {
            ArrayList<JSObject> files = new ArrayList<>();
            for (Uri uri : uris) {
                try {
                    if (grantFlags != 0) getContext().getContentResolver().takePersistableUriPermission(uri, grantFlags);
                } catch (Exception ignored) {}
                JSObject file = new JSObject();
                file.put("path", uri.toString());
                file.put("mimeType", getContext().getContentResolver().getType(uri));
                try (Cursor cursor = getContext().getContentResolver().query(
                    uri,
                    new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE},
                    null,
                    null,
                    null
                )) {
                    if (cursor != null && cursor.moveToFirst()) {
                        int nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                        int sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE);
                        if (nameColumn >= 0) file.put("name", cursor.getString(nameColumn));
                        if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) file.put("size", cursor.getLong(sizeColumn));
                    }
                }
                files.add(file);
            }
            JSObject response = new JSObject();
            response.put("files", JSArray.from(files.toArray()));
            call.resolve(response);
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "无法读取所选媒体信息" : error.getMessage(), error);
        }
    }

    private void encryptMediaInBackground(PluginCall call, String source, String originalName, String keyBase64, long expectedBytes) {
        File directory = new File(getContext().getFilesDir(), VAULT_DIRECTORY);
        if (!directory.exists() && !directory.mkdirs()) { call.reject("无法创建私密媒体目录"); return; }
        if (expectedBytes > 0 && directory.getUsableSpace() < expectedBytes + RESERVE_BYTES) { call.reject("本机存储空间不足"); return; }
        String name = UUID.randomUUID().toString() + ".vault";
        File target = new File(directory, name);
        byte[] iv = new byte[12];
        new SecureRandom().nextBytes(iv);
        long copied = 0;
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(Base64.decode(keyBase64, Base64.NO_WRAP), "AES"), new GCMParameterSpec(128, iv));
            try (InputStream input = openSource(source); OutputStream output = new CipherOutputStream(new FileOutputStream(target), cipher)) {
                byte[] buffer = new byte[1024 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    copied += read;
                    if (directory.getUsableSpace() < RESERVE_BYTES) throw new IllegalStateException("本机存储空间不足");
                    output.write(buffer, 0, read);
                }
            }
            JSObject result = new JSObject();
            result.put("name", name);
            result.put("iv", Base64.encodeToString(iv, Base64.NO_WRAP));
            result.put("bytes", copied);
            call.resolve(result);
        } catch (Exception error) {
            if (target.exists()) target.delete();
            call.reject(error.getMessage() == null ? "私密媒体加密失败" : error.getMessage(), error);
        }
    }

    private void decryptMediaInBackground(PluginCall call, String name, String ivBase64, String keyBase64, String extension) {
        File source = new File(new File(getContext().getFilesDir(), VAULT_DIRECTORY), name);
        File directory = new File(getContext().getCacheDir(), VAULT_PREVIEW_DIRECTORY);
        if (!source.exists()) { call.reject("私密视频文件不存在"); return; }
        if (!directory.exists() && !directory.mkdirs()) { call.reject("无法创建临时播放目录"); return; }
        File target = new File(directory, UUID.randomUUID().toString() + "." + extension);
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(Base64.decode(keyBase64, Base64.NO_WRAP), "AES"), new GCMParameterSpec(128, Base64.decode(ivBase64, Base64.NO_WRAP)));
            try (InputStream input = new CipherInputStream(new FileInputStream(source), cipher); FileOutputStream output = new FileOutputStream(target)) {
                byte[] buffer = new byte[1024 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                output.getFD().sync();
            }
            JSObject result = new JSObject();
            result.put("uri", Uri.fromFile(target).toString());
            call.resolve(result);
        } catch (Exception error) {
            if (target.exists()) target.delete();
            call.reject("私密密码错误或视频文件已损坏", error);
        }
    }

    private InputStream openSource(String source) throws Exception {
        Uri uri = Uri.parse(source);
        String scheme = uri.getScheme();
        if ("content".equalsIgnoreCase(scheme) || "android.resource".equalsIgnoreCase(scheme)) {
            InputStream stream = getContext().getContentResolver().openInputStream(uri);
            if (stream == null) throw new IllegalArgumentException("无法读取所选视频");
            return stream;
        }
        if ("file".equalsIgnoreCase(scheme)) return new FileInputStream(new File(uri.getPath()));
        return new FileInputStream(new File(source));
    }

    private String safeExtension(String name) {
        int dot = name.lastIndexOf('.');
        String extension = dot >= 0 ? name.substring(dot + 1) : "mp4";
        extension = extension.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        return extension.isEmpty() ? "mp4" : extension;
    }

    private String safeVaultName(String name) {
        String clean = name == null ? "" : name.replaceAll("[^a-zA-Z0-9.-]", "");
        return clean.endsWith(".vault") ? clean : "";
    }

    private String safeStoredMediaName(String name) {
        String clean = name == null ? "" : name.replaceAll("[^a-zA-Z0-9.-]", "");
        return clean.equals(name) && !clean.isEmpty() && !clean.contains("..") ? clean : "";
    }

    private String detectMediaKind(File file) {
        byte[] header = new byte[16];
        int length;
        try (FileInputStream input = new FileInputStream(file)) {
            length = input.read(header);
        } catch (Exception ignored) {
            return "";
        }
        if (length >= 12 && header[4] == 'f' && header[5] == 't' && header[6] == 'y' && header[7] == 'p') return "video";
        if (length >= 4 && (header[0] & 0xff) == 0x1a && (header[1] & 0xff) == 0x45 && (header[2] & 0xff) == 0xdf && (header[3] & 0xff) == 0xa3) return "video";
        if (length >= 12 && header[0] == 'R' && header[1] == 'I' && header[2] == 'F' && header[3] == 'F' && header[8] == 'A' && header[9] == 'V' && header[10] == 'I') return "video";
        if (length >= 4 && header[0] == 0 && header[1] == 0 && header[2] == 1 && ((header[3] & 0xff) == 0xba || (header[3] & 0xff) == 0xb3)) return "video";
        if (length >= 1 && (header[0] & 0xff) == 0x47) return "video";
        return "";
    }

    private JSArray privateStorageBreakdown() {
        ArrayList<JSObject> entries = new ArrayList<>();
        File[] roots = getContext().getDataDir().listFiles();
        if (roots != null) for (File root : roots) {
            appendUsage(entries, root.getName(), root);
            if (root.equals(getContext().getFilesDir())) {
                File[] children = root.listFiles();
                if (children != null) for (File child : children) appendUsage(entries, "files/" + child.getName(), child);
            }
        }
        return JSArray.from(entries.toArray());
    }

    private JSArray restoreStagingComparisons(File currentMedia) {
        ArrayList<JSObject> comparisons = new ArrayList<>();
        File[] roots = getContext().getFilesDir().listFiles(file -> file.isDirectory() && file.getName().startsWith(".mine-restore-"));
        if (roots == null) return JSArray.from(comparisons.toArray());
        for (File root : roots) {
            File stagedMedia = new File(root, "stage-media");
            File[] staged = stagedMedia.listFiles(File::isFile);
            if (staged == null) continue;
            long identicalBytes = 0L;
            long uniqueBytes = 0L;
            int identicalFiles = 0;
            int uniqueFiles = 0;
            int uniqueVideos = 0;
            for (File file : staged) {
                File current = new File(currentMedia, file.getName());
                if (current.isFile() && current.length() == file.length()) {
                    identicalFiles += 1;
                    identicalBytes += file.length();
                } else {
                    uniqueFiles += 1;
                    uniqueBytes += file.length();
                    if ("video".equals(detectMediaKind(file))) uniqueVideos += 1;
                }
            }
            JSObject result = new JSObject();
            result.put("name", root.getName());
            result.put("identicalFiles", identicalFiles);
            result.put("identicalBytes", identicalBytes);
            result.put("uniqueFiles", uniqueFiles);
            result.put("uniqueBytes", uniqueBytes);
            result.put("uniqueVideos", uniqueVideos);
            comparisons.add(result);
        }
        return JSArray.from(comparisons.toArray());
    }

    private JSArray readablePersistedMedia() {
        ArrayList<JSObject> files = new ArrayList<>();
        for (UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (!permission.isReadPermission()) continue;
            Uri uri = permission.getUri();
            String name = "";
            long size = 0L;
            try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
                if (cursor == null || !cursor.moveToFirst()) continue;
                int nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (nameColumn >= 0 && !cursor.isNull(nameColumn)) name = cursor.getString(nameColumn);
                if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) size = cursor.getLong(sizeColumn);
            } catch (Exception ignored) {
                continue;
            }
            try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                if (input == null || input.read() < 0) continue;
            } catch (Exception ignored) {
                continue;
            }
            JSObject file = new JSObject();
            file.put("path", uri.toString());
            file.put("name", name);
            file.put("size", size);
            file.put("mimeType", getContext().getContentResolver().getType(uri));
            file.put("persistedTime", permission.getPersistedTime());
            files.add(file);
        }
        return JSArray.from(files.toArray());
    }

    private void appendUsage(ArrayList<JSObject> entries, String name, File root) {
        long[] usage = measureTree(root, 0);
        JSObject entry = new JSObject();
        entry.put("name", name);
        entry.put("bytes", usage[0]);
        entry.put("files", usage[1]);
        entries.add(entry);
    }

    private long[] measureTree(File file, int depth) {
        if (file == null || depth > 24) return new long[]{0L, 0L};
        if (file.isFile()) return new long[]{Math.max(0L, file.length()), 1L};
        long bytes = 0L;
        long files = 0L;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) {
            long[] usage = measureTree(child, depth + 1);
            bytes += usage[0];
            files += usage[1];
        }
        return new long[]{bytes, files};
    }

    private void deleteChildren(File directory) {
        File[] files = directory.listFiles();
        if (files != null) for (File file : files) file.delete();
    }
}
