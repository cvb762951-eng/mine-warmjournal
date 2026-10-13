package com.mine.focus;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import androidx.annotation.OptIn;
import androidx.media3.common.Effect;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.effect.Crop;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.ProgressHolder;
import androidx.media3.transformer.Transformer;

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
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.crypto.Cipher;
import javax.crypto.CipherInputStream;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * 私密空间视频「真剪文件」（2026-10-10 新增，用户在三个选项里选了"剪完直接替换原件"）。
 *
 * <p>和之前的非破坏性剪辑的区别：那一种只记下"播哪一段、框哪一块"，原文件一个字节没动；
 * 这一种把剪好的结果**重新编码成一个新文件**，可以替代原片。
 *
 * <p>实现要点（改之前先读）：
 * <ul>
 *   <li>剪时长走 {@link MediaItem.ClippingConfiguration}，起点/终点都是精确到毫秒的真裁切。
 *       Transformer 默认不做"只转封装"的优化，所以起点不会退回上一个关键帧。
 *   <li>裁画面走 {@code androidx.media3.effect.Crop}：它同时负责"裁哪一块"和"输出多大的画面"，
 *       两者是一体的 —— 这一点很关键，只设裁剪矩阵不改输出尺寸会把画面拉变形。
 *   <li>坐标换算：编辑器里量到的是归一化矩形（左上角为原点、y 向下），
 *       Crop 用的是 NDC（中心为原点、-1..1、y 向上），所以 x/y 各自要做一次映射，
 *       而 **y 必须翻转**。这里算错的表现是"裁的是上下相反的那一块"。
 *   <li>Media3 交给效果链的是**已经转正**的画面（手机竖拍视频的旋转元数据在此之前就处理掉了），
 *       所以在编辑器里量出来的框，和这里收到的画面对得上。
 *   <li>输出统一成 H.264 + AAC：这是兼容性最稳的组合，重编码后仍能在应用内直接播放。
 *   <li>这里是**新增文件**，不删原片。原片交给 JS 侧统一的"未引用媒体清理"处理，
 *       那一步是先移进回收站而不是直接抹掉，等于给这个不可逆操作留了一层兜底。
 * </ul>
 */
@OptIn(markerClass = UnstableApi.class)
@CapacitorPlugin(name = "VideoReencode")
public class VideoReencodePlugin extends Plugin {

    private static final String DIRECTORY = "MineWarmJournalMedia";
    private static final String VAULT_DIRECTORY = "MineWarmJournalVault";
    private static final String SCRATCH_DIRECTORY = "MineWarmJournalVaultPreview";
    private static final long RESERVE_BYTES = 48L * 1024L * 1024L;
    private static final long PROGRESS_INTERVAL_MS = 350L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private final AtomicBoolean settled = new AtomicBoolean(true);

    // 这两个字段会被后台线程（解老格式文件）和主线程同时读写，必须 volatile。
    private volatile Transformer transformer;
    private volatile File scratch;
    private PluginCall activeCall;
    private Runnable progressPoller;

    @PluginMethod
    public void reencode(PluginCall call) {
        if (!busy.compareAndSet(false, true)) {
            call.reject("上一段视频还在重新压缩，请等它完成");
            return;
        }
        settled.set(false);
        activeCall = call;
        scratch = null;

        final String storedName = safeStoredMediaName(call.getString("storedName", ""));
        final String vaultName = safeVaultName(call.getString("vaultName", ""));
        final String ivBase64 = call.getString("iv", "");
        final String keyBase64 = call.getString("key", "");
        final double trimStart = number(call, "trimStart", 0d);
        final double trimEnd = number(call, "trimEnd", 0d);
        final float cropX = (float) number(call, "cropX", 0d);
        final float cropY = (float) number(call, "cropY", 0d);
        final float cropW = (float) number(call, "cropW", 1d);
        final float cropH = (float) number(call, "cropH", 1d);

        // 解老格式的加密文件可能很慢，放到后台线程；Transformer 的 start/cancel/getProgress
        // 都必须在本插件自己的线程（主线程）上调用，所以准备完再切回来。
        worker.execute(() -> {
            File input;
            try {
                input = resolveInput(storedName, vaultName, ivBase64, keyBase64);
            } catch (Exception error) {
                finishWithError(messageOf(error, "无法读取这段视频"));
                return;
            }
            mainHandler.post(() -> startExport(input, trimStart, trimEnd, cropX, cropY, cropW, cropH));
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        mainHandler.post(() -> {
            Transformer current = transformer;
            transformer = null;
            if (current != null) {
                try {
                    current.cancel();
                } catch (Exception ignored) {
                }
            }
            finishWithError("已取消，原视频没有改动");
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        Transformer current = transformer;
        transformer = null;
        if (current != null) {
            try {
                current.cancel();
            } catch (Exception ignored) {
            }
        }
        stopProgressPolling();
        deleteScratch();
    }

    /* ------------------------------------------------------------------ *
     * 输入                                                               *
     * ------------------------------------------------------------------ */

    private File resolveInput(String storedName, String vaultName, String ivBase64, String keyBase64) throws Exception {
        if (!storedName.isEmpty()) {
            File file = new File(new File(getContext().getFilesDir(), DIRECTORY), storedName);
            if (!file.isFile()) throw new IllegalStateException("这段视频在本机找不到了");
            return file;
        }
        if (!vaultName.isEmpty() && !ivBase64.isEmpty() && !keyBase64.isEmpty()) {
            File source = new File(new File(getContext().getFilesDir(), VAULT_DIRECTORY), vaultName);
            if (!source.isFile()) throw new IllegalStateException("这段视频在本机找不到了");
            File directory = new File(getContext().getCacheDir(), SCRATCH_DIRECTORY);
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("无法创建临时目录");
            File target = new File(directory, UUID.randomUUID().toString() + ".mp4");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,
                    new SecretKeySpec(Base64.decode(keyBase64, Base64.NO_WRAP), "AES"),
                    new GCMParameterSpec(128, Base64.decode(ivBase64, Base64.NO_WRAP)));
            try (InputStream input = new CipherInputStream(new FileInputStream(source), cipher);
                 FileOutputStream output = new FileOutputStream(target)) {
                byte[] buffer = new byte[1024 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                output.getFD().sync();
            }
            scratch = target;
            return target;
        }
        throw new IllegalArgumentException("这段视频暂时不支持重新压缩");
    }

    /* ------------------------------------------------------------------ *
     * 重编码                                                             *
     * ------------------------------------------------------------------ */

    private void startExport(File input, double trimStart, double trimEnd,
                             float cropX, float cropY, float cropW, float cropH) {
        if (settled.get()) return; // 已经被取消/销毁
        File directory = new File(getContext().getFilesDir(), DIRECTORY);
        if (!directory.isDirectory() && !directory.mkdirs()) {
            finishWithError("无法写入本机存储目录");
            return;
        }
        // 重编码期间新旧两个文件会同时存在，所以要按"原文件 + 余量"预留空间。
        if (directory.getUsableSpace() < input.length() + RESERVE_BYTES) {
            finishWithError("本机存储空间不足，无法完成重新压缩");
            return;
        }
        File output = new File(directory, UUID.randomUUID().toString() + ".mp4");

        MediaItem.Builder mediaItem = new MediaItem.Builder().setUri(Uri.fromFile(input));
        long startMs = Math.max(0L, Math.round(trimStart * 1000d));
        long endMs = Math.round(trimEnd * 1000d);
        if (endMs > startMs + 50L) {
            mediaItem.setClippingConfiguration(new MediaItem.ClippingConfiguration.Builder()
                    .setStartPositionMs(startMs)
                    .setEndPositionMs(endMs)
                    .build());
        }

        ArrayList<Effect> videoEffects = new ArrayList<>();
        if (cropNeeded(cropX, cropY, cropW, cropH)) {
            float left = clamp01(cropX) * 2f - 1f;
            float right = clamp01(cropX + cropW) * 2f - 1f;
            float top = 1f - clamp01(cropY) * 2f;
            float bottom = 1f - clamp01(cropY + cropH) * 2f;
            if (right - left <= 0.001f || top - bottom <= 0.001f) {
                finishWithError("画面取景框无效，原视频没有改动");
                return;
            }
            videoEffects.add(new Crop(left, right, bottom, top));
        }

        EditedMediaItem edited = new EditedMediaItem.Builder(mediaItem.build())
                .setEffects(new Effects(new ArrayList<AudioProcessor>(), videoEffects))
                .build();

        try {
            transformer = new Transformer.Builder(getContext())
                    .setVideoMimeType(MimeTypes.VIDEO_H264)
                    .setAudioMimeType(MimeTypes.AUDIO_AAC)
                    .addListener(new Transformer.Listener() {
                        @Override
                        public void onCompleted(Composition composition, ExportResult result) {
                            finishWithSuccess(output, result);
                        }

                        @Override
                        public void onError(Composition composition, ExportResult result, ExportException exception) {
                            finishWithError(messageOf(exception, "重新压缩失败"));
                        }
                    })
                    .build();
            transformer.start(edited, output.getAbsolutePath());
            startProgressPolling();
        } catch (Exception error) {
            finishWithError(messageOf(error, "重新压缩失败"));
        }
    }

    private void startProgressPolling() {
        stopProgressPolling();
        final ProgressHolder holder = new ProgressHolder();
        progressPoller = new Runnable() {
            @Override
            public void run() {
                Transformer current = transformer;
                if (current == null) return;
                try {
                    if (current.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
                        JSObject payload = new JSObject();
                        payload.put("progress", holder.progress);
                        notifyListeners("progress", payload);
                    }
                } catch (Exception ignored) {
                }
                mainHandler.postDelayed(this, PROGRESS_INTERVAL_MS);
            }
        };
        mainHandler.postDelayed(progressPoller, PROGRESS_INTERVAL_MS);
    }

    private void stopProgressPolling() {
        if (progressPoller != null) {
            mainHandler.removeCallbacks(progressPoller);
            progressPoller = null;
        }
    }

    /* ------------------------------------------------------------------ *
     * 收尾                                                               *
     * ------------------------------------------------------------------ */

    private void finishWithSuccess(File output, ExportResult result) {
        if (!settled.compareAndSet(false, true)) return;
        PluginCall call = activeCall;
        boolean valid = output.isFile() && output.length() > 0;
        if (!valid && output.exists()) output.delete();
        settle();
        deleteScratch();
        if (call == null) return;
        if (!valid) {
            call.reject("重新压缩没有生成有效文件，原视频没有改动");
            return;
        }
        JSObject payload = new JSObject();
        payload.put("name", output.getName());
        payload.put("uri", Uri.fromFile(output).toString());
        payload.put("bytes", output.length());
        payload.put("durationMs", result == null ? 0L : result.durationMs);
        payload.put("width", result == null ? 0 : result.width);
        payload.put("height", result == null ? 0 : result.height);
        call.resolve(payload);
    }

    private void finishWithError(String message) {
        if (!settled.compareAndSet(false, true)) return;
        PluginCall call = activeCall;
        settle();
        deleteScratch();
        if (call != null) call.reject(message);
    }

    private void settle() {
        stopProgressPolling();
        transformer = null;
        activeCall = null;
        busy.set(false);
    }

    private void deleteScratch() {
        File target = scratch;
        scratch = null;
        if (target != null && target.exists()) target.delete();
    }

    /* ------------------------------------------------------------------ *
     * 小工具                                                             *
     * ------------------------------------------------------------------ */

    private static boolean cropNeeded(float x, float y, float w, float h) {
        if (!(w > 0.002f) || !(h > 0.002f)) return false;
        return x > 0.002f || y > 0.002f || w < 0.998f || h < 0.998f;
    }

    private static float clamp01(float value) {
        return Math.max(0f, Math.min(1f, value));
    }

    private static double number(PluginCall call, String key, double fallback) {
        Double value = call.getDouble(key);
        return value == null ? fallback : value;
    }

    private static String messageOf(Throwable error, String fallback) {
        String message = error == null ? null : error.getMessage();
        return message == null || message.isEmpty() ? fallback : fallback + "：" + message;
    }

    private String safeVaultName(String name) {
        String clean = name == null ? "" : name.replaceAll("[^a-zA-Z0-9.-]", "");
        return clean.endsWith(".vault") ? clean : "";
    }

    private String safeStoredMediaName(String name) {
        String clean = name == null ? "" : name.replaceAll("[^a-zA-Z0-9.-]", "");
        return clean.equals(name) && !clean.isEmpty() && !clean.contains("..") ? clean : "";
    }
}
