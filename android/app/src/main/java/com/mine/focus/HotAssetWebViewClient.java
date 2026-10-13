package com.mine.focus;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * 热更新资源的加载（2026-10-09）
 *
 * 思路：页面资源优先从应用私有目录里的热更新目录读取，没有才走 Capacitor 的内置资源。
 *
 *   https://localhost/app.js
 *     → 若 <filesDir>/hot/app.js 存在，就用它（热更新过的版本）
 *     → 否则交给 Capacitor 从 assets/public 读（装机自带的版本）
 *
 * 这样做的价值：用户更新时只需下载**变化的文件**，不必重下整包。
 *
 * 安全与兜底（两条都不可省）：
 * 1. 只接受 https://localhost 下的路径，且拒绝 ".." 等越权写法，
 *    再用 canonical path 二次确认文件确实落在热更新目录内；
 * 2. **任何异常都返回 null**，交由上层走内置资源 ——
 *    宁可用户看到旧版本，也绝不能白屏。
 */
public class HotAssetWebViewClient extends BridgeWebViewClient {

    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("js", "application/javascript");
        MIME.put("mjs", "application/javascript");
        MIME.put("css", "text/css");
        MIME.put("html", "text/html");
        MIME.put("json", "application/json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("webp", "image/webp");
        MIME.put("gif", "image/gif");
        MIME.put("ico", "image/x-icon");
        MIME.put("woff", "font/woff");
        MIME.put("woff2", "font/woff2");
        MIME.put("ttf", "font/ttf");
        MIME.put("mp3", "audio/mpeg");
        MIME.put("mp4", "video/mp4");
        MIME.put("webm", "video/webm");
        MIME.put("txt", "text/plain");
    }

    private final File hotRoot;

    public HotAssetWebViewClient(Bridge bridge, File hotRoot) {
        super(bridge);
        this.hotRoot = hotRoot;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        WebResourceResponse hit = hotResponse(request);
        if (hit != null) return hit;
        return super.shouldInterceptRequest(view, request);
    }

    /** 命中热更新目录则返回该文件，否则返回 null 表示「交给内置资源」。 */
    private WebResourceResponse hotResponse(WebResourceRequest request) {
        try {
            Uri url = request.getUrl();
            if (url == null || !"localhost".equals(url.getHost())) return null;
            String path = url.getPath();
            if (path == null || path.isEmpty()) return null;
            if (path.contains("..") || path.contains("//")) return null;

            // 根路径要映射到 index.html —— 原先这里按路径长度直接放行，
            // 导致入口页永远不会被热更新；而 index.html 里写着 app.js?v=版本号，
            // 它不更新，引用就还是旧的，浏览器很可能直接用缓存的旧脚本 ——
            // 表现就是「更新完了却没变化」（2026-10-09 用户反馈）。
            String relative = path.startsWith("/") ? path.substring(1) : path;
            if (relative.isEmpty()) relative = "index.html";

            File file = new File(hotRoot, relative);
            if (!file.isFile()) return null;
            // 二次确认：规范化后的路径必须仍在热更新目录内
            if (!file.getCanonicalPath().startsWith(hotRoot.getCanonicalPath() + File.separator)) return null;

            InputStream stream = new FileInputStream(file);
            // 明确禁止缓存：热更新靠的就是「同一个 URL 拿到新内容」，
            // 若被 WebView 缓存住，用户重启多少次都还是旧界面。
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store, no-cache, must-revalidate");
            headers.put("Pragma", "no-cache");
            return new WebResourceResponse(mimeOf(relative), null, 200, "OK", headers, stream);
        } catch (Exception ignored) {
            // 任何异常都退回内置资源 —— 这是不白屏的最后一道保险
            return null;
        }
    }

    private static String mimeOf(String path) {
        int dot = path.lastIndexOf('.');
        if (dot < 0) return "application/octet-stream";
        return MIME.getOrDefault(path.substring(dot + 1).toLowerCase(), "application/octet-stream");
    }
}
