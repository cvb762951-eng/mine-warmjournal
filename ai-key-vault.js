// AI API Key 保管：真机用 Android Keystore 加密后落库，浏览器预览用 Web Crypto 派生密钥加密。
//
// 设计要点：
// 1. 内存里始终是明文（50 处调用点同步读取，不能改成异步）。
// 2. 落库时只存密文 —— 落库前调用 sealStateSettings()，把明文换成密文。
// 3. Keystore 密钥是「免用户认证」的：这与密码库/私密空间的指纹密钥不同，
//    因为 AI Key 不能要求每次对话都按指纹（会彻底破坏体验）。
//    保护目标改为「设备被提取 / 数据库文件被拷走」场景。
// 4. Keystore 密钥失效（换机、系统安全更新、恢复备份到新设备）时明确报错让用户重填，
//    不做任何静默降级，也绝不伪造成功。
import { Capacitor, registerPlugin } from '@capacitor/core';

const SecureKeyStore = registerPlugin('SecureKeyStore');

const CIPHER = 'AES-256-GCM';
const CHECK_PREFIX = 'mine-ai-key-v1:';
const STORAGE_KEY = 'mine-ai-key-browser-v1';
const KEY_SLOT = 'aiApiKey';

// 浏览器预览：deviceSecret 存在 localStorage，用于派生加密密钥。
// 浏览器只用于开发预览，真机安全性由 Keystore 保证。
const hasWebCrypto = () => Boolean(globalThis.crypto?.subtle);
let deviceSecret = null;
let webCryptoKey = null;

// 刻意不 import storage.js 的 isNativeAndroid：storage.js 依赖本模块，
// 那样会形成循环依赖。此处独立判断，口径与 storage.js 保持一致。
const isNative = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
const bytesToBase64 = bytes => {
  let value = '';
  for (let index = 0; index < bytes.length; index += 0x8000) value += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(value);
};
const base64ToBytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const rawKey = (bytes, usage) => crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [usage]);

async function getDeviceSecret() {
  if (deviceSecret) return deviceSecret;
  let stored = '';
  try { stored = localStorage.getItem(STORAGE_KEY) || ''; } catch { stored = ''; }
  if (stored) {
    deviceSecret = base64ToBytes(stored);
    return deviceSecret;
  }
  deviceSecret = crypto.getRandomValues(new Uint8Array(32));
  try { localStorage.setItem(STORAGE_KEY, bytesToBase64(deviceSecret)); } catch { /* 隐私模式下写不进去也不影响单次会话 */ }
  return deviceSecret;
}

async function getWebKey() {
  if (webCryptoKey) return webCryptoKey;
  if (!hasWebCrypto()) throw new Error('浏览器预览不支持加密存储，API Key 不会被保存');
  const salt = new TextEncoder().encode('mine-ai-key-derive-v1');
  const material = await crypto.subtle.importKey('raw', await getDeviceSecret(), 'PBKDF2', false, ['deriveKey']);
  webCryptoKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  return webCryptoKey;
}

async function seal(plainText) {
  if (isNative()) {
    const result = await SecureKeyStore.seal({ value: plainText, slot: KEY_SLOT });
    return `${CHECK_PREFIX}${result.algorithm || CIPHER}:${result.iv}:${result.ciphertext}`;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(plainText);
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getWebKey(), payload);
  return `${CHECK_PREFIX}${CIPHER}:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(sealed))}`;
}

async function open(cipherText) {
  if (!isEncryptedKey(cipherText)) return '';
  const [, , iv, ciphertext] = cipherText.split(':');
  if (!iv || !ciphertext) return '';
  if (isNative()) {
    return SecureKeyStore.open({ slot: KEY_SLOT, iv, ciphertext }).then(result => result.value || '').catch(() => {
      throw new Error('系统密钥库中的 AI 密钥已失效，请在 AI 设置里重新填写');
    });
  }
  const payload = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, await getWebKey(), base64ToBytes(ciphertext));
  return new TextDecoder().decode(payload);
}

export const isEncryptedKey = value => typeof value === 'string' && value.startsWith(CHECK_PREFIX);

// 落库前调用：把明文 Key 换成密文。返回密文值，供调用方写回 settings。
export async function sealApiKey(plainKey) {
  const plain = String(plainKey || '').trim();
  if (!plain || isEncryptedKey(plain)) return plain;
  return seal(plain);
}

export async function openApiKey(storedValue) {
  const value = String(storedValue || '');
  if (!value) return '';
  if (!isEncryptedKey(value)) return value; // 迁移前的明文，原样返回，由 migrateState 负责加密
  return open(value);
}

export async function clearApiKey() {
  webCryptoKey = null;
  deviceSecret = null;
  if (!isNative()) {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    return;
  }
  await SecureKeyStore.clear({ slot: KEY_SLOT }).catch(() => {});
}

// 浏览器预览无 Keystore，用本地派生密钥兜底，保证开发者预览时也不落明文。
export const aiKeyStorageMode = () => (isNative() ? 'keystore' : hasWebCrypto() ? 'browser-derived' : 'none');
