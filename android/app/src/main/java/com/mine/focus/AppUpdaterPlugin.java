package com.mine.focus;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * 应用内更新（2026-10-09 新增）
 *
 * 只提供「下载」与「拉起系统安装器」两个动作，不做任何自动检查 ——
 * 是否检查更新完全由用户点击决定（与项目「零自动联网」的原则一致）。
 *
 * 安全约束：
 * · 只接受 https 地址；
 * · 更新包下载到应用缓存目录（file_paths.xml 的 cache-path 已覆盖），
 *   通过 FileProvider 授予临时读权限，不落公共存储；
 * · 安装动作交给 Android 系统自己的安装器，App 无法静默安装 ——
 *   系统会弹确认页，用户必须亲自点「安装」。
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int READ_TIMEOUT_MS = 30000;
    private static final int BUFFER_BYTES = 64 * 1024;
    // 版本清单只有几百字节；给个上限避免被投喂超大响应
    private static final int MAX_TEXT_BYTES = 256 * 1024;
    // 进度事件节流：太密集会把 WebView 噎住
    private static final long PROGRESS_INTERVAL_MS = 400;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    /** 旧版把每个版本都写进同一个文件名，系统安装器会一直看到上次的 1.1.30。 */
    private static final String LEGACY_UPDATE_APK = "warmjournal-update.apk";

    /**
     * 读取一个 https 文本资源（版本清单用）。
     *
     * 为什么不在 JS 里直接 fetch：App 内的页面 origin 是 https://localhost，
     * 请求外部域名属于跨域；服务器没给 CORS 头时浏览器会直接拦下，
     * JS 侧只会收到一个没有信息量的 "Failed to fetch"（2026-10-09 用户实际撞到）。
     * 原生 HTTP 请求不受同源策略约束，因此版本清单改由这里读取。
     */
    @PluginMethod
    public void fetchText(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || !url.startsWith("https://")) {
            call.reject("地址必须是 https");
            return;
        }
        final String target = url;
        executor.execute(() -> {
            HttpURLConnection connection = null;
            InputStream input = null;
            try {
                connection = (HttpURLConnection) new URL(target).openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
                connection.setReadTimeout(READ_TIMEOUT_MS);
                connection.setRequestProperty("Accept", "application/json");

                int status = connection.getResponseCode();
                if (status != HttpURLConnection.HTTP_OK) {
                    throw new IllegalStateException("服务器返回 " + status);
                }
                input = connection.getInputStream();
                java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int read;
                int total = 0;
                while ((read = input.read(chunk)) != -1) {
                    total += read;
                    // 版本清单只有几百字节；加个上限，避免被投喂超大响应撑爆内存
                    if (total > MAX_TEXT_BYTES) throw new IllegalStateException("返回内容过大");
                    buffer.write(chunk, 0, read);
                }
                JSObject result = new JSObject();
                result.put("text", buffer.toString("UTF-8"));
                call.resolve(result);
            } catch (Exception error) {
                String message = error.getMessage();
                call.reject(message == null || message.isEmpty() ? "读取更新信息失败" : message);
            } finally {
                try { if (input != null) input.close(); } catch (Exception ignored) { }
                if (connection != null) connection.disconnect();
            }
        });
    }

    /**
     * 把一批资源文件同步到热更新目录（2026-10-09）。
     *
     * 调用方（JS）先比对本清单与本地已应用的清单，只把**真正变化的文件**传进来 ——
     * 这就是「只更新新部分」的落点：改一个 CSS 就只下那个 CSS。
     *
     * 每个文件单独校验 sha256，校验不过就丢弃该文件、保留旧版本，
     * 并把失败项回报给调用方；调用方据此决定要不要写新的清单（不写就等于没更新）。
     *
     * path 是相对 www/ 的路径（如 assets/xxx.png），会被限制在 filesDir/hot 之内。
     */
    @PluginMethod
    public void syncResources(PluginCall call) {
        JSArray entries = call.getArray("files");
        if (entries == null || entries.length() == 0) {
            JSObject empty = new JSObject();
            empty.put("downloaded", 0);
            empty.put("failed", 0);
            call.resolve(empty);
            return;
        }

        final List<String[]> pending = new ArrayList<>();
        for (int index = 0; index < entries.length(); index += 1) {
            // JSArray.optJSONObject 返回的是 org.json.JSONObject，不是 JSObject
            org.json.JSONObject entry = entries.optJSONObject(index);
            if (entry == null) continue;
            String path = entry.optString("path", "");
            String url = entry.optString("url", "");
            String sha256 = entry.optString("sha256", "");
            if (path.isEmpty() || !url.startsWith("https://")) continue;
            if (path.contains("..") || path.startsWith("/")) continue;
            pending.add(new String[]{ path, url, sha256 });
        }

        final File hotRoot = new File(getContext().getFilesDir(), "hot");
        executor.execute(() -> {
            int downloaded = 0;
            int failed = 0;
            JSArray failedPaths = new JSArray();
            long total = pending.size();

            for (int index = 0; index < pending.size(); index += 1) {
                String[] item = pending.get(index);
                String path = item[0];
                try {
                    File target = new File(hotRoot, path);
                    if (!target.getCanonicalPath().startsWith(hotRoot.getCanonicalPath() + File.separator)) {
                        throw new IllegalStateException("路径越界");
                    }
                    File parent = target.getParentFile();
                    if (parent != null && !parent.exists() && !parent.mkdirs()) {
                        throw new IllegalStateException("无法创建目录");
                    }

                    File temp = new File(target.getAbsolutePath() + ".tmp");
                    downloadTo(item[1], temp);
                    if (!item[2].isEmpty() && !item[2].equalsIgnoreCase(sha256Of(temp))) {
                        // 校验不过就整个丢弃 —— 宁可保持旧版本，也不能用坏文件覆盖
                        if (!temp.delete()) temp.deleteOnExit();
                        throw new IllegalStateException("校验不通过");
                    }
                    // ⚠️ 绝不能"先 delete 旧文件再 rename"：
                    //    那两行之间文件是不存在的，而 HotAssetWebViewClient 一旦发现
                    //    热更新目录里没有这个文件，就回落到装机自带的旧版本 ——
                    //    用户在更新过程中就会看到"一部分界面突然变回旧样子"
                    //    （2026-10-10 用户实测：清简主题用着用着一部分素材回去了）。
                    //    改成 ATOMIC_MOVE：同一文件系统内是原子替换，
                    //    读取方只会看到旧内容或新内容，绝不会看到"没有文件"或半截文件。
                    try {
                        java.nio.file.Files.move(
                                temp.toPath(),
                                target.toPath(),
                                java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                                java.nio.file.StandardCopyOption.ATOMIC_MOVE);
                    } catch (java.nio.file.AtomicMoveNotSupportedException unsupported) {
                        // 极少数文件系统不支持原子移动，退回归名（仍然不删旧文件）
                        if (!temp.renameTo(target)) throw new IllegalStateException("无法写入目标文件");
                    }
                    downloaded += 1;
                } catch (Exception error) {
                    failed += 1;
                    failedPaths.put(path);
                }

                JSObject progress = new JSObject();
                progress.put("done", index + 1);
                progress.put("total", total);
                progress.put("downloaded", downloaded);
                progress.put("failed", failed);
                notifyListeners("resourceProgress", progress);
            }

            JSObject result = new JSObject();
            result.put("downloaded", downloaded);
            result.put("failed", failed);
            result.put("failedPaths", failedPaths);
            call.resolve(result);
        });
    }

    /** 下载到指定文件，失败时清理残留。 */
    private void downloadTo(String url, File target) throws Exception {
        HttpURLConnection connection = null;
        InputStream input = null;
        FileOutputStream output = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new IllegalStateException("服务器返回 " + connection.getResponseCode());
            }
            input = connection.getInputStream();
            output = new FileOutputStream(target);
            byte[] buffer = new byte[BUFFER_BYTES];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            output.flush();
        } catch (Exception error) {
            if (target.exists() && !target.delete()) target.deleteOnExit();
            throw error;
        } finally {
            try { if (output != null) output.close(); } catch (Exception ignored) { }
            try { if (input != null) input.close(); } catch (Exception ignored) { }
            if (connection != null) connection.disconnect();
        }
    }

    /** 读取当前安装包的版本号。以系统记录为准，避免前端常量与构建产物不同步。 */
    @PluginMethod
    public void getVersion(PluginCall call) {
        try {
            android.content.pm.PackageInfo info = getContext().getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("versionName", info.versionName == null ? "" : info.versionName);
            result.put("versionCode", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? (int) info.getLongVersionCode()
                    : info.versionCode);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法读取应用版本");
        }
    }

    /** 是否允许安装未知来源应用（Android 8 起需要用户显式授权）。 */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        boolean allowed = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            allowed = getContext().getPackageManager().canRequestPackageInstalls();
        }
        result.put("allowed", allowed);
        call.resolve(result);
    }

    /** 跳到系统「安装未知应用」授权页，让用户自己决定。 */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivity(intent);
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("无法打开系统授权页");
        }
    }

    /** 下载更新包到应用缓存目录，过程中以 downloadProgress 事件回报进度。 */
    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url", "");
        String fileName = call.getString("fileName", "");
        if (url == null || !url.startsWith("https://")) {
            call.reject("更新地址必须是 https");
            return;
        }
        if (fileName == null || fileName.isEmpty() || fileName.contains("/") || fileName.contains("..")
                || LEGACY_UPDATE_APK.equals(fileName) || !isUpdateApkName(fileName)) {
            call.reject("更新包文件名不合法");
            return;
        }
        final String targetUrl = url;
        final String targetName = fileName;

        executor.execute(() -> {
            HttpURLConnection connection = null;
            InputStream input = null;
            FileOutputStream output = null;
            File target = null;
            boolean failed = false;
            try {
                // 先清掉其他版本的安装包（含旧的固定文件名），避免安装器再打开 1.1.30。
                purgeOtherUpdateApks(targetName);
                target = new File(getContext().getCacheDir(), targetName);
                if (target.exists() && !target.delete()) throw new IllegalStateException("无法清理上一次的更新包");

                connection = (HttpURLConnection) new URL(targetUrl).openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setUseCaches(false);
                connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
                connection.setReadTimeout(READ_TIMEOUT_MS);
                connection.setRequestProperty("Accept", "application/octet-stream");
                connection.setRequestProperty("Cache-Control", "no-cache");
                connection.setRequestProperty("Pragma", "no-cache");

                int status = connection.getResponseCode();
                if (status != HttpURLConnection.HTTP_OK) {
                    throw new IllegalStateException("下载失败：服务器返回 " + status);
                }
                long total = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
                        ? connection.getContentLengthLong()
                        : connection.getContentLength();

                input = connection.getInputStream();
                output = new FileOutputStream(target);
                byte[] buffer = new byte[BUFFER_BYTES];
                long received = 0;
                long lastReport = 0;
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                    received += read;
                    long now = System.currentTimeMillis();
                    if (now - lastReport >= PROGRESS_INTERVAL_MS) {
                        lastReport = now;
                        JSObject payload = new JSObject();
                        payload.put("received", received);
                        payload.put("total", total);
                        notifyListeners("downloadProgress", payload);
                    }
                }
                output.flush();

                // 收尾时补一次满进度，避免前端停在小数点后
                JSObject payload = new JSObject();
                payload.put("received", received);
                payload.put("total", total > 0 ? total : received);
                notifyListeners("downloadProgress", payload);

                JSObject result = new JSObject();
                result.put("path", target.getAbsolutePath());
                result.put("size", target.length());
                call.resolve(result);
            } catch (Exception error) {
                failed = true;
                String message = error.getMessage();
                call.reject(message == null || message.isEmpty() ? "下载更新包失败" : message);
            } finally {
                try { if (output != null) output.close(); } catch (Exception ignored) { }
                try { if (input != null) input.close(); } catch (Exception ignored) { }
                if (connection != null) connection.disconnect();
                if (failed && target != null && target.exists()) target.delete();
            }
        });
    }

    /** 拉起系统安装器。App 不能静默安装，用户必须在系统页面上确认。 */
    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path", "");
        if (path == null || path.isEmpty()) {
            call.reject("缺少安装包路径");
            return;
        }
        File file = new File(path);
        if (!file.exists()) {
            call.reject("安装包已不存在，请重新下载");
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            String message = error.getMessage();
            call.reject("无法启动系统安装器：" + (message == null ? "未知原因" : message));
        }
    }

    /** 计算已下载文件的 sha256。放在原生侧算，避免把上百 MB 读进 WebView 内存。 */
    @PluginMethod
    public void sha256(PluginCall call) {
        String path = call.getString("path", "");
        if (path == null || path.isEmpty()) {
            call.reject("缺少文件路径");
            return;
        }
        final String target = path;
        executor.execute(() -> {
            try {
                File file = new File(target);
                if (!file.exists()) throw new IllegalStateException("文件不存在");
                JSObject result = new JSObject();
                result.put("sha256", sha256Of(file));
                call.resolve(result);
            } catch (Exception error) {
                String message = error.getMessage();
                call.reject(message == null || message.isEmpty() ? "校验值计算失败" : message);
            }
        });
    }

    /**
     * 核对缓存里的安装包：体积、sha256，以及包内的 versionCode / versionName。
     * 对不上就由调用方删掉重下，不能把上一版的文件交给系统安装器。
     */
    @PluginMethod
    public void inspectCachedApk(PluginCall call) {
        String fileName = call.getString("fileName", "");
        if (!isUpdateApkName(fileName)) {
            call.reject("更新包文件名不合法");
            return;
        }
        final String targetName = fileName;
        executor.execute(() -> {
            try {
                File target = new File(getContext().getCacheDir(), targetName);
                JSObject result = new JSObject();
                if (!target.isFile()) {
                    result.put("exists", false);
                    call.resolve(result);
                    return;
                }
                PackageInfo info = getContext().getPackageManager().getPackageArchiveInfo(target.getAbsolutePath(), 0);
                result.put("exists", true);
                result.put("path", target.getAbsolutePath());
                result.put("size", target.length());
                result.put("sha256", sha256Of(target));
                result.put("versionCode", versionCodeOf(info));
                result.put("versionName", info == null || info.versionName == null ? "" : info.versionName);
                call.resolve(result);
            } catch (Exception error) {
                String message = error.getMessage();
                call.reject(message == null || message.isEmpty() ? "无法核对已下载的安装包" : message);
            }
        });
    }

    /** 删掉缓存里其他版本的更新包。keep 是这次要留下的文件名，空字符串表示全清。 */
    @PluginMethod
    public void purgeUpdateApks(PluginCall call) {
        String keep = call.getString("keep", "");
        try {
            int removed = purgeOtherUpdateApks(keep);
            JSObject result = new JSObject();
            result.put("removed", removed);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("清理旧安装包失败");
        }
    }

    /** 删除已下载的更新包（用户取消更新或安装完成后调用）。 */
    @PluginMethod
    public void clearDownload(PluginCall call) {
        String fileName = call.getString("fileName", "");
        try {
            if (isUpdateApkName(fileName)) {
                File target = new File(getContext().getCacheDir(), fileName);
                if (target.exists()) target.delete();
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("清理更新包失败");
        }
    }

    private static boolean isUpdateApkName(String name) {
        if (name == null || name.isEmpty() || name.indexOf('/') >= 0 || name.indexOf('\\') >= 0 || name.contains("..")) {
            return false;
        }
        if (LEGACY_UPDATE_APK.equals(name)) return true;
        return name.matches("warmjournal-update-\\d+\\.apk");
    }

    /** 只删缓存目录里的更新包，不动别的文件。keep 与本次文件名相同则留下。 */
    private int purgeOtherUpdateApks(String keep) throws Exception {
        File cache = getContext().getCacheDir();
        String cachePath = cache.getCanonicalPath();
        File[] files = cache.listFiles();
        int removed = 0;
        if (files == null) return 0;
        for (File file : files) {
            if (file == null || !file.isFile()) continue;
            String name = file.getName();
            if (keep != null && !keep.isEmpty() && keep.equals(name)) continue;
            if (!isUpdateApkName(name)) continue;
            String path = file.getCanonicalPath();
            if (!path.startsWith(cachePath + File.separator)) continue;
            if (file.delete()) removed += 1;
        }
        return removed;
    }

    @SuppressWarnings("deprecation")
    private static long versionCodeOf(PackageInfo info) {
        if (info == null) return 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return info.getLongVersionCode();
        return info.versionCode;
    }

    /** 计算文件的 sha256（十六进制小写）。下载校验与对外查询共用同一实现。 */
    private static String sha256Of(File file) throws Exception {
        java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
        InputStream input = null;
        try {
            input = new java.io.FileInputStream(file);
            byte[] buffer = new byte[BUFFER_BYTES];
            int read;
            while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
        } finally {
            try { if (input != null) input.close(); } catch (Exception ignored) { }
        }
        StringBuilder hex = new StringBuilder();
        for (byte value : digest.digest()) hex.append(String.format("%02x", value));
        return hex.toString();
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        try { executor.awaitTermination(1, TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
        super.handleOnDestroy();
    }
}
