package com.mine.focus;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.URL;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Android OpenAI-compatible SSE bridge.
 *
 * Request bodies, API keys and model output are never logged, persisted or cached.
 * Events intentionally forward the raw payload after the SSE "data:" prefix so the
 * JavaScript provider keeps responsibility for OpenAI-compatible JSON parsing.
 */
@CapacitorPlugin(name = "AiStream")
public class AiStreamPlugin extends Plugin {

    public static final String EVENT_CHUNK = "aiStreamChunk";
    public static final String EVENT_DONE = "aiStreamDone";
    public static final String EVENT_ERROR = "aiStreamError";

    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 90_000;
    private static final int MAX_ERROR_CHARS = 1_024;
    private static final AtomicInteger THREAD_SEQUENCE = new AtomicInteger(1);

    private final ConcurrentHashMap<String, StreamRequest> activeRequests = new ConcurrentHashMap<>();
    private final ExecutorService executor = Executors.newCachedThreadPool(new ThreadFactory() {
        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "mine-ai-sse-" + THREAD_SEQUENCE.getAndIncrement());
            thread.setDaemon(true);
            return thread;
        }
    });

    /**
     * Starts one isolated SSE request. Duplicate requestId values are rejected;
     * callers must cancel or wait for the existing request before reusing the ID.
     */
    @PluginMethod
    public void start(PluginCall call) {
        final String requestId = normalizeRequestId(call.getString("requestId"));
        final String urlValue = call.getString("url");
        final String apiKey = call.getString("apiKey");
        if (requestId == null) {
            call.reject("requestId 必填", "invalid_request_id");
            return;
        }
        if (urlValue == null || urlValue.trim().isEmpty()) {
            call.reject("url 必填", "invalid_url");
            return;
        }
        if (apiKey == null || apiKey.trim().isEmpty()) {
            call.reject("apiKey 必填", "invalid_api_key");
            return;
        }

        final URL endpoint;
        try {
            endpoint = new URL(urlValue.trim());
        } catch (MalformedURLException error) {
            call.reject("url 无效", "invalid_url");
            return;
        }
        if (!isAllowedEndpoint(endpoint)) {
            call.reject("仅支持 HTTPS AI 接口", "insecure_url");
            return;
        }

        final String body;
        try {
            JSONObject requestBody = readRequestBody(call);
            // Key 只允许由插件通过 Authorization header 发送，不能混入 OpenAI 请求体。
            requestBody.remove("apiKey");
            requestBody.remove("api_key");
            requestBody.remove("authorization");
            requestBody.remove("Authorization");
            requestBody.put("stream", true);
            body = requestBody.toString();
        } catch (JSONException error) {
            call.reject("body 必须是有效的 JSON 对象", "invalid_body");
            return;
        }

        final StreamRequest request = new StreamRequest(requestId);
        if (activeRequests.putIfAbsent(requestId, request) != null) {
            call.reject("requestId 已在传输中；请先取消或等待完成", "duplicate_request_id");
            return;
        }

        try {
            Future<?> future = executor.submit(new Runnable() {
                @Override
                public void run() {
                    readSse(request, endpoint, apiKey.trim(), body);
                }
            });
            request.setFuture(future);
            JSObject result = new JSObject();
            result.put("requestId", requestId);
            call.resolve(result);
        } catch (RejectedExecutionException error) {
            activeRequests.remove(requestId, request);
            call.reject("AI 流式传输当前不可用", "stream_unavailable");
        }
    }

    /** Cancels only the matching requestId and never affects other active streams. */
    @PluginMethod
    public void cancel(PluginCall call) {
        String requestId = normalizeRequestId(call.getString("requestId"));
        if (requestId == null) {
            call.reject("requestId 必填", "invalid_request_id");
            return;
        }
        StreamRequest request = activeRequests.remove(requestId);
        boolean cancelled = request != null;
        if (request != null) cancelRequest(request);
        JSObject result = new JSObject();
        result.put("requestId", requestId);
        result.put("cancelled", cancelled);
        call.resolve(result);
    }

    private void readSse(StreamRequest request, URL endpoint, String apiKey, String body) {
        HttpURLConnection connection = null;
        try {
            if (request.isCancelled() || !isActive(request)) return;
            connection = (HttpURLConnection) endpoint.openConnection();
            if (!request.setConnection(connection) || !isActive(request)) {
                connection.disconnect();
                return;
            }
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "text/event-stream");
            connection.setRequestProperty("Authorization", "Bearer " + apiKey);

            byte[] payload = body.getBytes(StandardCharsets.UTF_8);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(payload);
                output.flush();
            }
            if (request.isCancelled() || !isActive(request)) return;

            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                String detail = readLimited(connection.getErrorStream());
                emitError(request, httpErrorMessage(status, detail, apiKey));
                return;
            }

            boolean receivedDone = false;
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while (!request.isCancelled() && (line = reader.readLine()) != null) {
                    String trimmed = line.trim();
                    if (trimmed.isEmpty() || trimmed.startsWith(":")) continue;
                    if (!trimmed.startsWith("data:")) continue;
                    int marker = line.indexOf("data:");
                    String data = line.substring(marker + 5);
                    if (data.startsWith(" ")) data = data.substring(1);
                    if ("[DONE]".equals(data.trim())) {
                        receivedDone = emitDone(request);
                        break;
                    }
                    emitChunk(request, data);
                }
            }
            if (!request.isCancelled() && !receivedDone && isActive(request)) {
                emitError(request, "AI 流式响应在完成标记前结束");
            }
        } catch (SocketTimeoutException error) {
            if (!request.isCancelled()) emitError(request, "AI 流式请求超时");
        } catch (IOException error) {
            if (!request.isCancelled()) emitError(request, "AI 流式连接失败");
        } catch (Exception error) {
            if (!request.isCancelled()) emitError(request, "AI 流式传输失败");
        } finally {
            request.clearConnection(connection);
            if (connection != null) connection.disconnect();
            activeRequests.remove(request.requestId, request);
        }
    }

    private static JSONObject readRequestBody(PluginCall call) throws JSONException {
        Object raw = call.getData().opt("body");
        if (raw instanceof JSONObject) return new JSONObject(raw.toString());
        if (raw instanceof String) return new JSONObject((String) raw);
        throw new JSONException("body is not a JSON object");
    }

    private static boolean isAllowedEndpoint(URL endpoint) {
        return "https".equalsIgnoreCase(endpoint.getProtocol())
            && endpoint.getHost() != null
            && !endpoint.getHost().isEmpty()
            && endpoint.getUserInfo() == null;
    }

    private static String normalizeRequestId(String value) {
        if (value == null) return null;
        String requestId = value.trim();
        return requestId.isEmpty() || requestId.length() > 128 ? null : requestId;
    }

    private boolean isActive(StreamRequest request) {
        return activeRequests.get(request.requestId) == request;
    }

    private void emitChunk(StreamRequest request, String data) {
        synchronized (request) {
            if (request.cancelled || request.finished || !isActive(request)) return;
            JSObject payload = new JSObject();
            payload.put("requestId", request.requestId);
            payload.put("data", data);
            notifyListeners(EVENT_CHUNK, payload, false);
        }
    }

    private boolean emitDone(StreamRequest request) {
        synchronized (request) {
            if (request.cancelled || request.finished || !isActive(request)) return false;
            request.finished = true;
            activeRequests.remove(request.requestId, request);
            JSObject payload = new JSObject();
            payload.put("requestId", request.requestId);
            notifyListeners(EVENT_DONE, payload, false);
            return true;
        }
    }

    private void emitError(StreamRequest request, String message) {
        synchronized (request) {
            if (request.cancelled || request.finished || !isActive(request)) return;
            request.finished = true;
            activeRequests.remove(request.requestId, request);
            JSObject payload = new JSObject();
            payload.put("requestId", request.requestId);
            payload.put("message", message);
            notifyListeners(EVENT_ERROR, payload, false);
        }
    }

    private void cancelRequest(StreamRequest request) {
        HttpURLConnection connection;
        Future<?> future;
        synchronized (request) {
            request.cancelled = true;
            request.finished = true;
            connection = request.connection;
            future = request.future;
        }
        if (connection != null) connection.disconnect();
        if (future != null) future.cancel(true);
    }

    private static String readLimited(InputStream stream) {
        if (stream == null) return "";
        StringBuilder result = new StringBuilder();
        char[] buffer = new char[256];
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            while (result.length() < MAX_ERROR_CHARS) {
                int maxRead = Math.min(buffer.length, MAX_ERROR_CHARS - result.length());
                int count = reader.read(buffer, 0, maxRead);
                if (count < 0) break;
                result.append(buffer, 0, count);
            }
        } catch (IOException ignored) {
            // 错误详情不可读时只回传 HTTP 状态，不记录任何请求或响应内容。
        }
        return result.toString();
    }

    private static String httpErrorMessage(int status, String detail, String apiKey) {
        String safeDetail = detail == null ? "" : detail.replace(apiKey, "[redacted]").replaceAll("\\s+", " ").trim();
        if (safeDetail.isEmpty()) return "AI 请求失败（HTTP " + status + "）";
        return "AI 请求失败（HTTP " + status + "）：" + safeDetail;
    }

    @Override
    protected void handleOnDestroy() {
        for (StreamRequest request : new ArrayList<>(activeRequests.values())) {
            activeRequests.remove(request.requestId, request);
            cancelRequest(request);
        }
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private static final class StreamRequest {
        final String requestId;
        volatile HttpURLConnection connection;
        volatile Future<?> future;
        boolean cancelled = false;
        boolean finished = false;

        StreamRequest(String requestId) {
            this.requestId = requestId;
        }

        synchronized boolean setConnection(HttpURLConnection connection) {
            if (cancelled || finished) return false;
            this.connection = connection;
            return true;
        }

        synchronized void setFuture(Future<?> future) {
            this.future = future;
            if (cancelled) future.cancel(true);
        }

        synchronized boolean isCancelled() {
            return cancelled;
        }

        synchronized void clearConnection(HttpURLConnection candidate) {
            if (connection == candidate) connection = null;
        }
    }
}
