package com.mine.focus;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Size;

import androidx.core.content.ContextCompat;
import android.content.pm.PackageManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.util.LinkedHashMap;
import java.util.Map;

@CapacitorPlugin(name = "LocalGallery", permissions = {
    @Permission(alias = "images", strings = { Manifest.permission.READ_MEDIA_IMAGES }),
    @Permission(alias = "videos", strings = { Manifest.permission.READ_MEDIA_VIDEO }),
    @Permission(alias = "selected", strings = { Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED }),
    @Permission(alias = "legacy", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
})
public class LocalGalleryPlugin extends Plugin {
    private static final String[] COLUMNS = {
        MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.MEDIA_TYPE,
        MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.MIME_TYPE,
        MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.DATE_ADDED,
        MediaStore.MediaColumns.BUCKET_ID, MediaStore.MediaColumns.BUCKET_DISPLAY_NAME
    };

    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    private JSObject access() {
        boolean images = Build.VERSION.SDK_INT < 33 ? granted(Manifest.permission.READ_EXTERNAL_STORAGE) : granted(Manifest.permission.READ_MEDIA_IMAGES);
        boolean videos = Build.VERSION.SDK_INT < 33 ? granted(Manifest.permission.READ_EXTERNAL_STORAGE) : granted(Manifest.permission.READ_MEDIA_VIDEO);
        boolean selected = Build.VERSION.SDK_INT >= 34 && granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED);
        JSObject result = new JSObject();
        result.put("images", images || selected);
        result.put("videos", videos || selected);
        result.put("partial", selected && (!images || !videos));
        result.put("full", images && videos);
        return result;
    }

    @PluginMethod
    public void permissionStatus(PluginCall call) { call.resolve(access()); }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 34) requestPermissionForAliases(new String[] { "images", "videos", "selected" }, call, "accessRequested");
        else if (Build.VERSION.SDK_INT >= 33) requestPermissionForAliases(new String[] { "images", "videos" }, call, "accessRequested");
        else requestPermissionForAliases(new String[] { "legacy" }, call, "accessRequested");
    }

    @PermissionCallback
    private void accessRequested(PluginCall call) { call.resolve(access()); }

    private String selection(String kind, String albumId) {
        String mediaType = MediaStore.Files.FileColumns.MEDIA_TYPE;
        String type = "video".equals(kind) ? mediaType + "=" + MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO
            : "photo".equals(kind) ? mediaType + "=" + MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE
            : mediaType + " IN (" + MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO + "," + MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE + ")";
        return albumId.isEmpty() ? type : type + " AND " + MediaStore.MediaColumns.BUCKET_ID + "=?";
    }

    private Cursor query(String kind, String albumId, int limit, int offset) {
        ContentResolver resolver = getContext().getContentResolver();
        Uri uri = MediaStore.Files.getContentUri("external");
        String where = selection(kind, albumId);
        String[] args = albumId.isEmpty() ? null : new String[] { albumId };
        if (Build.VERSION.SDK_INT >= 26) {
            Bundle query = new Bundle();
            query.putString(ContentResolver.QUERY_ARG_SQL_SELECTION, where);
            if (args != null) query.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, args);
            query.putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, MediaStore.MediaColumns.DATE_ADDED + " DESC, " + MediaStore.Files.FileColumns._ID + " DESC");
            if (limit > 0) { query.putInt(ContentResolver.QUERY_ARG_LIMIT, limit); query.putInt(ContentResolver.QUERY_ARG_OFFSET, offset); }
            return resolver.query(uri, COLUMNS, query, null);
        }
        String order = MediaStore.MediaColumns.DATE_ADDED + " DESC, " + MediaStore.Files.FileColumns._ID + " DESC";
        if (limit > 0) order += " LIMIT " + limit + " OFFSET " + offset;
        return resolver.query(uri, COLUMNS, where, args, order);
    }

    private String value(Cursor cursor, String column) {
        int index = cursor.getColumnIndex(column);
        return index < 0 || cursor.isNull(index) ? "" : cursor.getString(index);
    }

    private JSObject item(Cursor cursor) {
        long id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID));
        int type = cursor.getInt(cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MEDIA_TYPE));
        String kind = type == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO ? "video" : "photo";
        Uri uri = ContentUris.withAppendedId("video".equals(kind) ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id);
        JSObject result = new JSObject();
        result.put("id", kind + ":" + id);
        result.put("uri", uri.toString());
        result.put("kind", kind);
        result.put("name", value(cursor, MediaStore.MediaColumns.DISPLAY_NAME));
        result.put("mime", value(cursor, MediaStore.MediaColumns.MIME_TYPE));
        result.put("size", cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)));
        result.put("date", cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED)));
        result.put("albumId", value(cursor, MediaStore.MediaColumns.BUCKET_ID));
        result.put("albumName", value(cursor, MediaStore.MediaColumns.BUCKET_DISPLAY_NAME));
        return result;
    }

    @PluginMethod
    public void listMedia(PluginCall call) {
        String kind = call.getString("kind", "all");
        String albumId = call.getString("albumId", "");
        if (!kind.equals("all") && !kind.equals("video") && !kind.equals("photo")) { call.reject("无效的媒体类型"); return; }
        int limit = Math.max(1, Math.min(80, call.getInt("limit", 48)));
        int offset = Math.max(0, call.getInt("offset", 0));
        if (!access().getBool("images") && !access().getBool("videos")) { call.reject("相册权限未授予"); return; }
        getBridge().execute(() -> {
            try (Cursor cursor = query(kind, albumId, limit, offset)) {
                JSArray items = new JSArray();
                if (cursor != null) while (items.length() < limit && cursor.moveToNext()) items.put(item(cursor));
                JSObject result = new JSObject(); result.put("items", items); result.put("hasMore", items.length() == limit);
                call.resolve(result);
            } catch (Exception error) { call.reject("读取相册失败", error); }
        });
    }

    @PluginMethod
    public void listAlbums(PluginCall call) {
        String kind = call.getString("kind", "all");
        if (!kind.equals("all") && !kind.equals("video") && !kind.equals("photo")) { call.reject("无效的媒体类型"); return; }
        getBridge().execute(() -> {
            try (Cursor cursor = query(kind, "", 0, 0)) {
                Map<String, JSObject> albums = new LinkedHashMap<>();
                if (cursor != null) while (cursor.moveToNext()) {
                    String id = value(cursor, MediaStore.MediaColumns.BUCKET_ID);
                    if (id.isEmpty()) continue;
                    JSObject album = albums.get(id);
                    if (album == null) {
                        album = new JSObject(); album.put("id", id);
                        album.put("name", value(cursor, MediaStore.MediaColumns.BUCKET_DISPLAY_NAME));
                        album.put("count", 0); albums.put(id, album);
                    }
                    album.put("count", album.getInt("count") + 1);
                }
                JSArray result = new JSArray(); for (JSObject album : albums.values()) result.put(album);
                JSObject response = new JSObject(); response.put("albums", result); call.resolve(response);
            } catch (Exception error) { call.reject("读取相册文件夹失败", error); }
        });
    }

    @PluginMethod
    public void thumbnail(PluginCall call) {
        String source = call.getString("uri", "");
        Uri uri = Uri.parse(source);
        if (!"content".equals(uri.getScheme()) || !"media".equals(uri.getAuthority())) { call.reject("无效的相册文件"); return; }
        getBridge().execute(() -> {
            try {
                Bitmap image;
                if (Build.VERSION.SDK_INT >= 29) image = getContext().getContentResolver().loadThumbnail(uri, new Size(240, 240), null);
                else {
                    long id = ContentUris.parseId(uri);
                    image = uri.getPath().contains("/video/")
                        ? MediaStore.Video.Thumbnails.getThumbnail(getContext().getContentResolver(), id, MediaStore.Video.Thumbnails.MINI_KIND, null)
                        : MediaStore.Images.Thumbnails.getThumbnail(getContext().getContentResolver(), id, MediaStore.Images.Thumbnails.MINI_KIND, null);
                }
                if (image == null) { call.reject("无法预览此文件"); return; }
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                image.compress(Bitmap.CompressFormat.JPEG, 72, bytes);
                image.recycle();
                JSObject result = new JSObject();
                result.put("data", android.util.Base64.encodeToString(bytes.toByteArray(), android.util.Base64.NO_WRAP));
                call.resolve(result);
            } catch (Exception error) { call.reject("缩略图不可用", error); }
        });
    }
}
