package com.mine.focus;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 免用户认证的 Keystore 通道，供 AI API Key 等「需要后台静默使用、不能每次按指纹」的密钥使用。
 *
 * 与 PasswordVaultNative 的区别：
 * - PasswordVaultNative：setUserAuthenticationRequired(true)，每次使用都要指纹/密码，适合私密空间与密码本。
 * - 本插件：不需要任何用户认证，换取 AI 对话等场景的静默可用性。
 *
 * 保护目标不是「设备被别人拿着解锁 App」，而是「数据库文件 / SharedPreferences 被拷走后无法直接读出密钥」。
 * 换机或系统安全更新导致密钥失效时，open() 会明确报错，由上层提示用户重新填写，不做静默降级。
 */
@CapacitorPlugin(name = "SecureKeyStore")
public class SecureKeyStorePlugin extends Plugin {
    private static final String PREFS = "mine_secure_keystore";
    private static final String ALIAS = "mine_secure_ai_key_v1";
    private static final String PREFIX = "wr:";
    private static final int GCM_TAG_BITS = 128;

    @PluginMethod
    public void capability(PluginCall call) {
        JSObject result = new JSObject();
        boolean available = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M;
        result.put("available", available);
        result.put("hasKey", available && store().contains(slot(call)));
        result.put("algorithm", "AES-256-GCM");
        call.resolve(result);
    }

    /** 明文进，密文出（iv + ciphertext 都由 Keystore 密钥加密，调用方只需持久化这两段）。 */
    @PluginMethod
    public void seal(PluginCall call) {
        String value = call.getString("value", "");
        String slot = slot(call);
        if (value.isEmpty()) { call.reject("没有需要保存的密钥"); return; }
        try {
            SecretKey key = ensureKey(slot);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
            byte[] output = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            store().edit().putString(slot, PREFIX + encode(cipher.getIV()) + ":" + encode(output)).apply();
            JSObject result = new JSObject();
            result.put("iv", encode(cipher.getIV()));
            result.put("ciphertext", encode(output));
            result.put("algorithm", "AES-256-GCM");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("系统密钥库写入失败：" + safeMessage(error), error);
        }
    }

    /** 密文进，明文出。密钥失效时明确 reject，绝不返回空串冒充成功。 */
    @PluginMethod
    public void open(PluginCall call) {
        String iv = call.getString("iv", "");
        String ciphertext = call.getString("ciphertext", "");
        if (iv.isEmpty() || ciphertext.isEmpty()) { call.reject("密文不完整"); return; }
        try {
            SecretKey key = loadKey(slot(call));
            if (key == null) { call.reject("系统密钥库中没有可用密钥，请重新填写"); return; }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, decode(iv)));
            byte[] output = cipher.doFinal(decode(ciphertext));
            JSObject result = new JSObject();
            result.put("value", new String(output, StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("系统密钥库中的密钥已失效，请在 AI 设置里重新填写", error);
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        String slot = slot(call);
        store().edit().remove(slot).apply();
        try {
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if (store.containsAlias(alias(slot))) store.deleteEntry(alias(slot));
        } catch (Exception ignored) { /* 密钥本来就拿不到时无需处理 */ }
        call.resolve();
    }

    private String slot(PluginCall call) {
        String value = call.getString("slot", "default");
        return "default".equals(value) ? "default" : value.replaceAll("[^a-zA-Z0-9_]", "");
    }
    private String alias(String slot) { return "default".equals(slot) ? ALIAS : ALIAS + "_" + slot; }
    private SharedPreferences store() { return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    private String encode(byte[] value) { return Base64.encodeToString(value, Base64.NO_WRAP); }
    private byte[] decode(String value) { return Base64.decode(value, Base64.NO_WRAP); }

    private SecretKey ensureKey(String slot) throws Exception {
        SecretKey existing = loadKey(slot);
        if (existing != null) return existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(alias(slot), KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(false)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }

    private SecretKey loadKey(String slot) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        String alias = alias(slot);
        return store.containsAlias(alias) ? (SecretKey) store.getKey(alias, null) : null;
    }

    private String safeMessage(Exception error) { return error.getMessage() == null ? "未知错误" : error.getMessage(); }
}
