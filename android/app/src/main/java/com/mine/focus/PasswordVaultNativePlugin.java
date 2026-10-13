package com.mine.focus;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.PersistableBundle;
import android.os.CancellationSignal;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyStore;
import java.util.Arrays;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "PasswordVaultNative")
public class PasswordVaultNativePlugin extends Plugin {
    private static final String PASSWORD_ALIAS = "mine_password_vault_fingerprint_v1";
    private static final String PRIVATE_ALIAS = "mine_private_vault_fingerprint_v1";
    private static final String PASSWORD_PREFS = "mine_password_vault_native";
    private static final String PRIVATE_PREFS = "mine_private_vault_native";
    private static final String WRAPPED = "wrapped";
    private static final String IV = "iv";

    @PluginMethod
    public void capability(PluginCall call) {
        String scope = scope(call);
        JSObject result = new JSObject();
        boolean available = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            BiometricManager manager = (BiometricManager) getContext().getSystemService(Context.BIOMETRIC_SERVICE);
            available = manager != null && manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS;
        }
        result.put("available", available);
        result.put("enrolled", available && prefs(scope).contains(WRAPPED) && hasKey(scope));
        call.resolve(result);
    }

    @PluginMethod
    public void enableFingerprint(PluginCall call) {
        String scope = scope(call);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) { call.reject("当前系统不支持强指纹解锁"); return; }
        String secret = call.getString("secret", "");
        if (secret.isEmpty()) { call.reject("加密密钥不存在"); return; }
        try {
            SecretKey key = createKey(scope);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
            authenticate(call, cipher, true, Base64.decode(secret, Base64.NO_WRAP), scope);
        } catch (Exception error) { call.reject("无法启用系统指纹：" + safeMessage(error), error); }
    }

    @PluginMethod
    public void unlockWithFingerprint(PluginCall call) {
        String scope = scope(call);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) { call.reject("当前系统不支持强指纹解锁"); return; }
        try {
            String wrapped = prefs(scope).getString(WRAPPED, "");
            String iv = prefs(scope).getString(IV, "");
            SecretKey key = loadKey(scope);
            if (wrapped.isEmpty() || iv.isEmpty() || key == null) { disableInternal(scope); call.reject("请先使用密码并重新启用指纹"); return; }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            authenticate(call, cipher, false, Base64.decode(wrapped, Base64.NO_WRAP), scope);
        } catch (KeyPermanentlyInvalidatedException error) { disableInternal(scope); call.reject("系统指纹发生变化，请使用密码重新启用"); }
        catch (Exception error) { call.reject("无法使用系统指纹：" + safeMessage(error), error); }
    }

    @PluginMethod
    public void disableFingerprint(PluginCall call) { disableInternal(scope(call)); call.resolve(); }

    @PluginMethod
    public void setSecureWindow(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        getActivity().runOnUiThread(() -> {
            if (active) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve();
        });
    }

    @PluginMethod
    public void copySecret(PluginCall call) {
        String secret = call.getString("text", "");
        int timeout = Math.max(1000, Math.min(60000, call.getInt("timeoutMs", 30000)));
        ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null) { call.reject("系统剪贴板不可用"); return; }
        ClipData clip = ClipData.newPlainText("密码", secret);
        PersistableBundle extras = new PersistableBundle(); extras.putBoolean("android.content.extra.IS_SENSITIVE", true); clip.getDescription().setExtras(extras);
        clipboard.setPrimaryClip(clip);
        getActivity().getWindow().getDecorView().postDelayed(() -> {
            try {
                ClipData current = clipboard.getPrimaryClip();
                CharSequence value = current != null && current.getItemCount() > 0 ? current.getItemAt(0).coerceToText(getContext()) : "";
                if (secret.contentEquals(value)) clipboard.clearPrimaryClip();
            } catch (Exception ignored) {}
        }, timeout);
        JSObject result = new JSObject(); result.put("clearsInMs", timeout); call.resolve(result);
    }

    private void authenticate(PluginCall call, Cipher cipher, boolean enrolling, byte[] secret, String scope) {
        Executor executor = getContext().getMainExecutor();
        AtomicBoolean completed = new AtomicBoolean(false);
        BiometricPrompt prompt = new BiometricPrompt.Builder(getContext())
            .setTitle(enrolling ? ("private".equals(scope) ? "启用私密空间指纹" : "启用密码本指纹") : ("private".equals(scope) ? "指纹解锁私密空间" : "指纹解锁密码本"))
            .setSubtitle("使用手机系统已录入的强指纹")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setConfirmationRequired(true)
            .setNegativeButton("使用主密码", executor, (dialog, which) -> { if (completed.compareAndSet(false, true)) call.reject("已改用主密码"); })
            .build();
        prompt.authenticate(new BiometricPrompt.CryptoObject(cipher), new CancellationSignal(), executor, new BiometricPrompt.AuthenticationCallback() {
            @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                if (!completed.compareAndSet(false, true)) return;
                try {
                    byte[] output = cipher.doFinal(secret);
                    if (enrolling) {
                        prefs(scope).edit().putString(WRAPPED, Base64.encodeToString(output, Base64.NO_WRAP)).putString(IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).apply();
                        Arrays.fill(secret, (byte) 0); call.resolve();
                    } else {
                        JSObject response = new JSObject(); response.put("secret", Base64.encodeToString(output, Base64.NO_WRAP)); Arrays.fill(output, (byte) 0); call.resolve(response);
                    }
                } catch (Exception error) { call.reject("指纹密钥处理失败", error); }
            }
            @Override public void onAuthenticationError(int code, CharSequence message) { if (completed.compareAndSet(false, true)) call.reject(message == null ? "指纹验证已取消" : message.toString()); }
        });
    }

    private SecretKey createKey(String scope) throws Exception {
        disableInternal(scope);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(alias(scope), KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(true).setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
            .setInvalidatedByBiometricEnrollment(true).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    private String scope(PluginCall call) { return "private".equals(call.getString("scope", "password")) ? "private" : "password"; }
    private String alias(String scope) { return "private".equals(scope) ? PRIVATE_ALIAS : PASSWORD_ALIAS; }
    private SecretKey loadKey(String scope) throws Exception { KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null); return (SecretKey) store.getKey(alias(scope), null); }
    private boolean hasKey(String scope) { try { return loadKey(scope) != null; } catch (Exception ignored) { return false; } }
    private SharedPreferences prefs(String scope) { return getContext().getSharedPreferences("private".equals(scope) ? PRIVATE_PREFS : PASSWORD_PREFS, Context.MODE_PRIVATE); }
    private void disableInternal(String scope) { prefs(scope).edit().clear().apply(); try { KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null); String alias = alias(scope); if (store.containsAlias(alias)) store.deleteEntry(alias); } catch (Exception ignored) {} }
    private String safeMessage(Exception error) { return error.getMessage() == null ? "未知错误" : error.getMessage(); }
}
