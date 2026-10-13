package com.mine.focus;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Locale;

/**
 * 语音输入（Android SpeechRecognizer，系统引擎，免 Key）。
 * - startListening()：开始识别（zh-CN），onResults 把最佳文本返回 JS；
 *   权限拒绝/无引擎等返回明确错误码。
 * - cancelListening()：取消当前识别。
 * - isAvailable()：设备是否有语音识别引擎。
 * 生命周期 onPause/onDestroy 取消识别，避免残留。
 * 识别结果/错误经 notifyListeners（startListening 是长任务，结果异步回传）。
 */
@CapacitorPlugin(name = "VoiceInput")
public class VoiceInputPlugin extends Plugin implements RecognitionListener {

    public static final String EVENT_RESULT = "voiceResult";
    public static final String EVENT_ERROR = "voiceError";

    private SpeechRecognizer recognizer = null;
    private Intent recognitionIntent = null;
    private boolean listening = false;
    private PluginCall pendingPermissionCall = null;
    private static final int PERMISSION_REQUEST_CODE = 6101;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void startListening(PluginCall call) {
        if (listening) {
            call.reject("busy", "识别正在进行中");
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("no_engine", "设备没有语音识别引擎");
            return;
        }
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingPermissionCall = call;
            ActivityCompat.requestPermissions(getActivity(), new String[]{Manifest.permission.RECORD_AUDIO}, PERMISSION_REQUEST_CODE);
            return;
        }
        startRecognizer(call);
    }

    @Override
    public void handleRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.handleRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != PERMISSION_REQUEST_CODE || pendingPermissionCall == null) return;
        PluginCall call = pendingPermissionCall;
        pendingPermissionCall = null;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startRecognizer(call);
        } else {
            call.reject("permission_denied", "麦克风权限被拒绝");
        }
    }

    @PluginMethod
    public void cancelListening(PluginCall call) {
        stopRecognizer();
        call.resolve();
    }

    private void startRecognizer(PluginCall call) {
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(this);
        }
        if (recognitionIntent == null) {
            recognitionIntent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            recognitionIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            recognitionIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.SIMPLIFIED_CHINESE.toLanguageTag());
            recognitionIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "zh-CN");
            recognitionIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
            recognitionIntent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
        }
        try {
            listening = true;
            call.resolve();
            recognizer.startListening(recognitionIntent);
        } catch (SecurityException e) {
            listening = false;
            call.reject("permission_denied", "麦克风权限被拒绝");
        } catch (Exception e) {
            listening = false;
            call.reject("recognizer_error", "语音识别启动失败");
        }
    }

    private void stopRecognizer() {
        if (recognizer != null) {
            try {
                recognizer.stopListening();
                recognizer.cancel();
            } catch (Exception ignored) {
            }
        }
        listening = false;
    }

    private void destroyRecognizer() {
        if (recognizer != null) {
            try {
                recognizer.destroy();
            } catch (Exception ignored) {
            }
            recognizer = null;
        }
        listening = false;
        pendingPermissionCall = null;
    }

    // ---- RecognitionListener ----
    @Override
    public void onReadyForSpeech(Bundle params) {
        JSObject result = new JSObject();
        result.put("status", "listening");
        notifyListeners(EVENT_RESULT, result, false);
    }

    @Override
    public void onBeginningOfSpeech() {
    }

    @Override
    public void onRmsChanged(float rmsdB) {
        JSObject result = new JSObject();
        result.put("status", "level");
        result.put("rms", rmsdB);
        notifyListeners(EVENT_RESULT, result, false);
    }

    @Override
    public void onBufferReceived(byte[] buffer) {
    }

    @Override
    public void onEndOfSpeech() {
        JSObject result = new JSObject();
        result.put("status", "end");
        notifyListeners(EVENT_RESULT, result, false);
    }

    @Override
    public void onError(int error) {
        listening = false;
        String code;
        switch (error) {
            case SpeechRecognizer.ERROR_NO_MATCH:
                code = "no_match";
                break;
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                code = "speech_timeout";
                break;
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                code = "permission_denied";
                break;
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                code = "network";
                break;
            case SpeechRecognizer.ERROR_CLIENT:
                code = "client";
                break;
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                code = "busy";
                break;
            case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED:
                code = "language_not_supported";
                break;
            default:
                code = "recognizer_error";
                break;
        }
        JSObject result = new JSObject();
        result.put("status", "error");
        result.put("code", code);
        notifyListeners(EVENT_ERROR, result, false);
    }

    @Override
    public void onResults(Bundle results) {
        listening = false;
        ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        JSObject result = new JSObject();
        result.put("status", "result");
        result.put("text", (matches != null && !matches.isEmpty()) ? matches.get(0) : "");
        result.put("alternatives", matches != null ? matches : new ArrayList<String>());
        notifyListeners(EVENT_RESULT, result, false);
    }

    @Override
    public void onPartialResults(Bundle partialResults) {
    }

    @Override
    public void onEvent(int eventType, Bundle params) {
    }

    @Override
    protected void handleOnPause() {
        stopRecognizer();
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        destroyRecognizer();
        super.handleOnDestroy();
    }
}
