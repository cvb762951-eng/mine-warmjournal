package com.mine.focus;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ContentUris;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.provider.MediaStore;

import java.util.ArrayList;

// 仅承载Android系统的媒体删除确认页；没有用户确认时不会删除任何相册原件。
public class OriginalMediaDeleteActivity extends Activity {
    static final String EXTRA_URIS = "mine.deleteOriginal.uris";
    static final String EXTRA_DELETED = "mine.deleteOriginal.deleted";
    static final String EXTRA_ERROR = "mine.deleteOriginal.error";
    private static final int REQUEST_DELETE = 52012;

    private int requestedCount;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) {
            requestedCount = savedInstanceState.getInt("requestedCount", 0);
            return;
        }
        ArrayList<String> raw = getIntent().getStringArrayListExtra(EXTRA_URIS);
        ArrayList<Uri> mediaUris = new ArrayList<>();
        if (raw != null) for (String value : raw) {
            Uri normalized = normalizeMediaUri(Uri.parse(value));
            if (normalized != null && !mediaUris.contains(normalized)) mediaUris.add(normalized);
        }
        if (mediaUris.isEmpty()) {
            finishWithError("所选文件不是可删除的本机系统相册媒体，原件已保留");
            return;
        }
        requestedCount = mediaUris.size();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            finishWithError("当前Android版本不支持批量删除相册原件，私密副本已保留");
            return;
        }
        try {
            PendingIntent request = MediaStore.createDeleteRequest(getContentResolver(), mediaUris);
            startIntentSenderForResult(request.getIntentSender(), REQUEST_DELETE, null, 0, 0, 0);
        } catch (Exception error) {
            finishWithError(error.getMessage() == null ? "无法打开系统删除确认页，原件已保留" : error.getMessage());
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        state.putInt("requestedCount", requestedCount);
        super.onSaveInstanceState(state);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_DELETE) return;
        if (resultCode == RESULT_OK) {
            Intent result = new Intent().putExtra(EXTRA_DELETED, requestedCount);
            setResult(RESULT_OK, result);
            finish();
        } else {
            finishWithError("你取消了系统删除确认，相册原件已保留");
        }
    }

    private Uri normalizeMediaUri(Uri uri) {
        if (uri == null || !"content".equalsIgnoreCase(uri.getScheme())) return null;
        if ("media".equals(uri.getAuthority())) return uri;
        if (!"com.android.providers.media.documents".equals(uri.getAuthority()) || !DocumentsContract.isDocumentUri(this, uri)) return null;
        String[] parts = DocumentsContract.getDocumentId(uri).split(":", 2);
        if (parts.length != 2) return null;
        long id;
        try { id = Long.parseLong(parts[1]); } catch (NumberFormatException error) { return null; }
        if ("video".equals(parts[0])) return ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id);
        if ("image".equals(parts[0])) return ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id);
        return null;
    }

    private void finishWithError(String message) {
        setResult(RESULT_CANCELED, new Intent().putExtra(EXTRA_ERROR, message));
        finish();
    }
}
