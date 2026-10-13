package com.mine.focus;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.Rect;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;

import java.io.File;
import java.util.Collections;

import androidx.core.view.WindowCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static boolean autoSummaryLaunch = false;
    private static boolean activityForeground = false;
    private boolean aiChatSystemBackActive = false;
    private boolean subpageSystemBackActive = false;
    private boolean videoGestureExclusionActive = false;
    private final View.OnLayoutChangeListener videoGestureLayoutListener = (view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> updateVideoGestureExclusion(view);

    public static boolean isAutoSummaryLaunch() {
        return autoSummaryLaunch;
    }

    public static boolean isActivityForeground() {
        return activityForeground;
    }

    public static void clearAutoSummaryLaunch() {
        autoSummaryLaunch = false;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TimerAlarmPlugin.class);
        registerPlugin(OrientationPlugin.class);
        registerPlugin(VoiceInputPlugin.class);
        registerPlugin(DailySummaryPlugin.class);
        registerPlugin(SystemBackPlugin.class);
        registerPlugin(AiStreamPlugin.class);
        registerPlugin(NativeMediaStorePlugin.class);
        registerPlugin(LocalGalleryPlugin.class);
        registerPlugin(StreamingBackupPlugin.class);
        registerPlugin(IncomingSharePlugin.class);
        registerPlugin(PasswordVaultNativePlugin.class);
        // 2026-10-08 修复：此前遗漏注册，导致 ai-key-vault.js 调用 SecureKeyStore 时
        // 原生侧找不到插件而必定抛错；加密失败会让 storage.js 的 sectionsForWrite 整份放弃落库，
        // 于是「填过 API Key 之后的所有数据都存不进数据库」。插件本身一直是完整可用的。
        registerPlugin(SecureKeyStorePlugin.class);
        // 2026-10-09 新增：应用内更新（下载更新包 + 拉起系统安装器）。
        // 注意：插件必须在 MainActivity 里注册，漏注册的表现是
        // JS 侧调用时「找不到插件」而静默失败（上一次的教训见上）。
        registerPlugin(AppUpdaterPlugin.class);
        // 2026-10-10 新增：私密空间视频的"真剪文件"（剪时长 + 裁画面后重新编码，替换原件）。
        // 同样必须在这里注册，漏注册的表现是 JS 调用时"找不到插件"而静默失败。
        registerPlugin(VideoReencodePlugin.class);
        super.onCreate(savedInstanceState);

        // 2026-10-09：热更新资源的加载。
        // 页面资源优先从 filesDir/hot 读，那里没有才走 WebView 内置资源 ——
        // 于是「只下载变化的文件」成为可能，不必每次重下整包。
        // 必须放在 super.onCreate 之后：此时 Bridge 与 WebView 才存在。
        installHotAssetClient();

        // App 内的视频不维护第二套音量；实体音量键始终调节系统媒体音量。
        setVolumeControlStream(AudioManager.STREAM_MUSIC);

        // 内容延伸到状态栏后（edge-to-edge），避免状态栏区域露出窗口背景形成白条；
        // WebView 页面侧用 env(safe-area-inset-top) 自行让位状态栏。
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // 凌晨定时器拉起 → 静默模式（只执行后台逻辑，不打扰用户）
        Intent intent = getIntent();
        autoSummaryLaunch = intent != null
            && DailySummaryReceiver.ACTION_DAILY_SUMMARY.equals(intent.getAction())
            && intent.getIntExtra(DailySummaryReceiver.EXTRA_AUTO_SUMMARY, 0) == 1;
        // 原生启动即重排，避免 WebView 或存储初始化失败时首次任务未登记。
        DailySummaryScheduler.scheduleNext(this);

        // WebView 全窗口不透明渲染页面背景与自定义壁纸，此兜底色仅在加载/空白期可见，不会遮挡壁纸。
        View content = findViewById(android.R.id.content);
        content.setBackgroundColor(Color.rgb(245, 241, 232));
    }

    /**
     * 挂上热更新资源加载器（2026-10-09）。
     *
     * 装上之后，页面资源会优先从 filesDir/hot 读；那里没有的，照旧走装机自带的资源。
     * 于是更新只需下载变化的文件，不必重下整包。
     *
     * 这里刻意吞掉所有异常：挂载失败最多是没有热更新能力，
     * 内置资源仍然完好 —— 绝不能让这个可选功能影响启动。
     */
    private void installHotAssetClient() {
        try {
            Bridge bridge = getBridge();
            if (bridge == null) return;
            File hotDir = new File(getFilesDir(), "hot");
            discardStaleHotAssets(hotDir);
            bridge.setWebViewClient(new HotAssetWebViewClient(bridge, hotDir));
        } catch (Exception ignored) {
        }
    }

    /**
     * 装机包换新后，上一版留下的热更新资源必须作废（2026-10-09）。
     *
     * 起因是用户实测：装到 1.0.72，界面却仍显示 1.0.71。
     * 因为热更新目录优先于装机资源，而里面的文件属于上一个装机版本 ——
     * **装了新包反而被旧缓存盖住**，界面永远停在旧版。
     *
     * 判据：热更新目录里记录的「应用时的装机 versionCode」与当前装机版本不一致，
     * 就整个丢弃。丢弃是安全的：新装机包自带完整资源，没有任何东西会缺失。
     */
    private void discardStaleHotAssets(File hotDir) {
        try {
            if (!hotDir.exists()) return;
            int currentVersionCode = 0;
            try {
                android.content.pm.PackageInfo info = getPackageManager()
                        .getPackageInfo(getPackageName(), 0);
                currentVersionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                        ? (int) info.getLongVersionCode()
                        : info.versionCode;
            } catch (Exception ignored) {
                return; // 读不到装机版本就别乱删
            }

            File stamp = new File(hotDir, ".apk-version");
            int appliedVersionCode = 0;
            if (stamp.isFile()) {
                try (java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.FileReader(stamp))) {
                    appliedVersionCode = Integer.parseInt(reader.readLine().trim());
                } catch (Exception ignored) {
                }
            }

            // 记录缺失（老版本装的）或与新装机版本不符 → 一律丢弃
            if (appliedVersionCode != currentVersionCode) {
                deleteRecursively(hotDir);
                if (!hotDir.mkdirs() && !hotDir.isDirectory()) return;
                try (java.io.FileWriter writer = new java.io.FileWriter(stamp)) {
                    writer.write(String.valueOf(currentVersionCode));
                } catch (Exception ignored) {
                }
            }
        } catch (Exception ignored) {
        }
    }

    /** 递归删除目录内容。只用于丢弃失效的热更新资源，失败也无所谓（下次还会再试）。 */
    private static void deleteRecursively(File target) {
        try {
            File[] children = target.listFiles();
            if (children != null) {
                for (File child : children) deleteRecursively(child);
            }
            // noinspection ResultOfMethodCallIgnored
            target.delete();
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // 用户正用 App 时定时器触发（singleTask 复用实例）：不进入静默模式，避免与用户操作冲突
        autoSummaryLaunch = intent != null
            && DailySummaryReceiver.ACTION_DAILY_SUMMARY.equals(intent.getAction())
            && intent.getIntExtra(DailySummaryReceiver.EXTRA_AUTO_SUMMARY, 0) == 1
            && !activityForeground;
        if (intent != null && (Intent.ACTION_SEND.equals(intent.getAction()) || Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction()))) {
            getBridge().triggerJSEvent("mine-incoming-share", "window");
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // 用焦点变化维护前台状态（BridgeActivity 的 onStart/onStop 是 final 不可覆写）
        activityForeground = hasFocus;
    }

    public void setAiChatSystemBackActive(boolean active) {
        aiChatSystemBackActive = active;
    }

    public void setSubpageSystemBackActive(boolean active) {
        subpageSystemBackActive = active;
    }

    public void setVideoGestureExclusionActive(boolean active) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || videoGestureExclusionActive == active) return;
        videoGestureExclusionActive = active;
        runOnUiThread(() -> {
            View webView = getBridge() == null ? null : getBridge().getWebView();
            if (webView == null) return;
            webView.removeOnLayoutChangeListener(videoGestureLayoutListener);
            if (active) webView.addOnLayoutChangeListener(videoGestureLayoutListener);
            updateVideoGestureExclusion(webView);
        });
    }

    private void updateVideoGestureExclusion(View view) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || view == null) return;
        if (!videoGestureExclusionActive || view.getWidth() <= 0 || view.getHeight() <= 0) {
            view.setSystemGestureExclusionRects(Collections.emptyList());
            return;
        }
        int maximumHeight = Math.round(200f * getResources().getDisplayMetrics().density);
        int protectedHeight = Math.min(view.getHeight(), maximumHeight);
        int protectedTop = Math.max(0, (view.getHeight() - protectedHeight) / 2);
        view.setSystemGestureExclusionRects(Collections.singletonList(new Rect(0, protectedTop, view.getWidth(), protectedTop + protectedHeight)));
    }

    @Override
    public void onBackPressed() {
        if (aiChatSystemBackActive || subpageSystemBackActive) {
            // JS 按弹窗 → 二级页 → AI 聊天优先级处理；不退出 Activity。
            getBridge().triggerJSEvent("mine-system-back", "window");
            return;
        }
        super.onBackPressed();
    }
}
