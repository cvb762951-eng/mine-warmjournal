package com.mine.focus;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "IncomingShare")
public class IncomingSharePlugin extends Plugin {
    private static final String INBOX = ".mine-share-inbox";
    private static final String DOCUMENTS = "documents";
    private static final int MAX_FILES = 100;
    private static final long RESERVE_BYTES = 48L * 1024L * 1024L;
    private static final long STALE_MS = 6L * 60L * 60L * 1000L;
    private static final ExecutorService FILE_EXECUTOR = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        FILE_EXECUTOR.execute(this::clearStaleSessions);
    }

    @PluginMethod
    public void hasPending(PluginCall call) {
        Intent intent = getActivity().getIntent();
        String action = intent == null ? "" : intent.getAction();
        JSObject result = new JSObject();
        result.put("available", Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action));
        call.resolve(result);
    }

    @PluginMethod
    public void consumePending(PluginCall call) {
        Intent intent = getActivity().getIntent();
        String action = intent == null ? "" : intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            JSObject empty = new JSObject(); empty.put("available", false); call.resolve(empty); return;
        }
        getActivity().runOnUiThread(() -> {
            Intent clean = new Intent(getActivity(), MainActivity.class);
            clean.setAction(Intent.ACTION_MAIN);
            getActivity().setIntent(clean);
        });
        FILE_EXECUTOR.execute(() -> stageIntent(call, intent));
    }

    @PluginMethod
    public void discard(PluginCall call) {
        String session = safeToken(call.getString("session", ""));
        if (session.isEmpty()) { call.resolve(); return; }
        FILE_EXECUTOR.execute(() -> { deleteTree(new File(inboxRoot(), session)); call.resolve(); });
    }

    @PluginMethod
    public void commitDocument(PluginCall call) {
        String session = safeToken(call.getString("session", ""));
        String id = safeToken(call.getString("id", ""));
        String originalName = safeDisplayName(call.getString("name", "shared-file"));
        File source = new File(new File(inboxRoot(), session), id);
        if (session.isEmpty() || id.isEmpty() || !source.isFile()) { call.reject("分享文件已经失效，请重新分享"); return; }
        FILE_EXECUTOR.execute(() -> {
            File directory = new File(getContext().getFilesDir(), DOCUMENTS);
            if (!directory.exists() && !directory.mkdirs()) { call.reject("无法创建资料库存储目录"); return; }
            String extension = safeExtension(originalName);
            File target = new File(directory, UUID.randomUUID() + (extension.isEmpty() ? "" : "." + extension));
            try {
                copyFile(source, target);
                JSObject result = new JSObject();
                result.put("path", DOCUMENTS + "/" + target.getName());
                result.put("size", target.length());
                call.resolve(result);
            } catch (Exception error) {
                if (target.exists()) target.delete();
                call.reject(error.getMessage() == null ? "文件保存失败" : error.getMessage(), error);
            }
        });
    }

    private void stageIntent(PluginCall call, Intent intent) {
        String session = UUID.randomUUID().toString();
        File directory = new File(inboxRoot(), session);
        try {
            if (!directory.mkdirs()) throw new IllegalStateException("无法创建分享临时目录");
            ArrayList<Uri> uris = sharedUris(intent);
            if (uris.size() > MAX_FILES) throw new IllegalArgumentException("一次最多接收 100 个文件");
            ArrayList<JSObject> files = new ArrayList<>();
            ContentResolver resolver = getContext().getContentResolver();
            for (Uri uri : uris) {
                String name = sharedName(resolver, uri);
                String mime = resolver.getType(uri);
                long declaredSize = sharedSize(resolver, uri);
                String id = UUID.randomUUID().toString() + "." + safeExtension(name);
                File target = new File(directory, id);
                if (declaredSize > 0 && directory.getUsableSpace() < declaredSize + RESERVE_BYTES) throw new IllegalStateException("本机存储空间不足，无法接收分享文件");
                try (InputStream input = resolver.openInputStream(uri); FileOutputStream output = new FileOutputStream(target)) {
                    if (input == null) throw new IllegalStateException("来源应用没有提供可读取的文件");
                    byte[] buffer = new byte[1024 * 1024]; int read;
                    while ((read = input.read(buffer)) != -1) {
                        if (directory.getUsableSpace() < RESERVE_BYTES) throw new IllegalStateException("本机存储空间不足");
                        output.write(buffer, 0, read);
                    }
                    output.getFD().sync();
                }
                JSObject file = new JSObject();
                file.put("id", id); file.put("name", name); file.put("mimeType", mime == null ? "" : mime);
                file.put("size", target.length()); file.put("path", Uri.fromFile(target).toString());
                file.put("kind", mediaKind(mime, name));
                files.add(file);
            }
            JSObject result = new JSObject();
            result.put("available", true); result.put("session", session);
            result.put("text", limit(intent.getStringExtra(Intent.EXTRA_TEXT), 100000));
            result.put("subject", limit(intent.getStringExtra(Intent.EXTRA_SUBJECT), 500));
            result.put("files", JSArray.from(files.toArray()));
            call.resolve(result);
        } catch (Exception error) {
            deleteTree(directory);
            call.reject(error.getMessage() == null ? "无法接收分享内容" : error.getMessage(), error);
        }
    }

    private ArrayList<Uri> sharedUris(Intent intent) {
        ArrayList<Uri> result = new ArrayList<>(); Set<String> seen = new HashSet<>();
        ClipData clip = intent.getClipData();
        if (clip != null) for (int index = 0; index < clip.getItemCount(); index++) addUri(result, seen, clip.getItemAt(index).getUri());
        if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
            ArrayList<Uri> values = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (values != null) for (Uri uri : values) addUri(result, seen, uri);
        } else addUri(result, seen, intent.getParcelableExtra(Intent.EXTRA_STREAM));
        return result;
    }

    private void addUri(ArrayList<Uri> result, Set<String> seen, Uri uri) { if (uri != null && seen.add(uri.toString())) result.add(uri); }
    private String sharedName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) { int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME); if (column >= 0) return safeDisplayName(cursor.getString(column)); }
        } catch (Exception ignored) {}
        String tail = uri.getLastPathSegment(); return safeDisplayName(tail == null ? "shared-file" : tail);
    }
    private long sharedSize(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) { int column = cursor.getColumnIndex(OpenableColumns.SIZE); if (column >= 0 && !cursor.isNull(column)) return cursor.getLong(column); }
        } catch (Exception ignored) {} return 0;
    }
    private String mediaKind(String mime, String name) {
        String value = (mime == null ? "" : mime).toLowerCase(Locale.ROOT);
        String lower = name.toLowerCase(Locale.ROOT);
        if (value.startsWith("image/") || lower.matches(".*\\.(jpg|jpeg|png|webp|gif|heic)$")) return "photo";
        if (value.startsWith("video/") || lower.matches(".*\\.(mp4|mov|m4v|webm|mkv|3gp)$")) return "video";
        return "document";
    }
    private File inboxRoot() { return new File(getContext().getFilesDir(), INBOX); }
    private void clearStaleSessions() { File root = inboxRoot(); File[] sessions = root.listFiles(); if (sessions == null) return; long cutoff = System.currentTimeMillis() - STALE_MS; for (File session : sessions) if (session.lastModified() < cutoff) deleteTree(session); }
    private void copyFile(File source, File target) throws Exception { try (FileInputStream input = new FileInputStream(source); FileOutputStream output = new FileOutputStream(target)) { byte[] buffer = new byte[1024 * 1024]; int read; while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read); output.getFD().sync(); } }
    private void deleteTree(File file) { if (file == null || !file.exists()) return; File[] children = file.listFiles(); if (children != null) for (File child : children) deleteTree(child); file.delete(); }
    private String safeToken(String value) { return value != null && value.matches("[A-Za-z0-9._-]{1,160}") ? value : ""; }
    private String safeDisplayName(String value) { String safe = value == null ? "shared-file" : value.replaceAll("[\\r\\n\\u0000]", "").trim(); return safe.isEmpty() ? "shared-file" : safe.substring(0, Math.min(180, safe.length())); }
    private String safeExtension(String name) { String value = safeDisplayName(name); int dot = value.lastIndexOf('.'); String ext = dot >= 0 ? value.substring(dot + 1).toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "") : "bin"; return ext.isEmpty() ? "bin" : ext.substring(0, Math.min(12, ext.length())); }
    private String limit(String value, int max) { if (value == null) return ""; return value.substring(0, Math.min(max, value.length())); }
}
