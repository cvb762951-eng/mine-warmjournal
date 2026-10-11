import { FilePicker } from '@capawesome/capacitor-file-picker';
import { createBackupPayload, isNativeAndroid, validateBackupPayload } from './storage.js';
import { expandMediaReferences, mediaHealth } from './media-store.js';
import { expandVaultReferences, restoreVaultReferences, vaultMediaHealth } from './vault-media-store.js';
import { NativeStreamingBackup } from './native-streaming-backup.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_PORTABLE_MEDIA_BYTES = 256 * 1024 * 1024;
let pendingNativeRestoreToken = '';

export async function exportEncryptedBackup(state, password, options = {}) {
  requirePassword(password);
  const health = await mediaHealth(state);
  const vaultHealth = await vaultMediaHealth(state.privateVault);
  if (!health.healthy || !vaultHealth.healthy) throw new Error('存在缺失的照片或视频，请先在数据状态中处理后再备份');
  const filename = `mine-warmjournal-backup-${new Date().toISOString().slice(0, 10)}.minebackup`;
  if (isNativeAndroid()) {
    const payload = JSON.stringify(await createBackupPayload(state));
    const totalBytes = health.bytes + vaultHealth.bytes;
    const progressListener = await NativeStreamingBackup.addListener('backupProgress', progress => options.onProgress?.(progress)).catch(() => null);
    try {
      const result = await NativeStreamingBackup.exportBackup({ password, payload, filename, totalBytes });
      return result?.filename || filename;
    } finally {
      await progressListener?.remove?.().catch(() => {});
    }
  }
  if (health.bytes + vaultHealth.bytes > MAX_PORTABLE_MEDIA_BYTES) {
    throw new Error('网页兼容备份的照片和视频合计不能超过 256MB；Android App 请使用流式大容量备份');
  }
  const portableState = await expandMediaReferences(state);
  portableState.privateVault = await expandVaultReferences(state.privateVault);
  const encrypted = await encryptBackupEnvelope(JSON.stringify(await createBackupPayload(portableState)), password);
  const blob = new Blob([JSON.stringify(encrypted)], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
  return filename;
}

export async function importEncryptedBackup(password, options = {}) {
  requirePassword(password);
  if (isNativeAndroid()) {
    let token = '';
    const progressListener = await NativeStreamingBackup.addListener('restoreProgress', progress => {
      if (progress?.operation === 'restore') options.onProgress?.(progress);
    }).catch(() => null);
    try {
      const prepared = await NativeStreamingBackup.prepareRestore({ password, operation: 'restore' });
      token = String(prepared?.token || '');
      if (!token || !prepared?.payload) throw new Error('没有读到可恢复的数据');
      const restored = await validateBackupPayload(JSON.parse(prepared.payload));
      await NativeStreamingBackup.commitRestore({ token });
      pendingNativeRestoreToken = token;
      return restored;
    } catch (error) {
      if (token) await NativeStreamingBackup.rollbackRestore({ token }).catch(() => {});
      if (!token && /不是大容量备份文件/.test(String(error?.message || ''))) return importLegacyNativeBackup(password);
      throw error;
    } finally {
      await progressListener?.remove?.().catch(() => {});
    }
  }
  let text;
  text = await pickBrowserFile();
  const payload = JSON.parse(await decryptBackupEnvelope(JSON.parse(text), password));
  const restored = await validateBackupPayload(payload);
  if (payload?.data?.privateVault) await restoreVaultReferences(payload.data.privateVault);
  return restored;
}

export async function verifyEncryptedBackup(password, options = {}) {
  requirePassword(password);
  if (isNativeAndroid()) {
    let token = '';
    const progressListener = await NativeStreamingBackup.addListener('restoreProgress', progress => {
      if (progress?.operation === 'verify') options.onProgress?.(progress);
    }).catch(() => null);
    try {
      const prepared = await NativeStreamingBackup.prepareRestore({ password, operation: 'verify' });
      token = String(prepared?.token || '');
      if (!token || !prepared?.payload) throw new Error('没有读到可验证的数据');
      const payload = JSON.parse(prepared.payload);
      await validateBackupPayload(payload);
      return backupVerificationSummary(payload, prepared?.formatVersion);
    } finally {
      if (token) await NativeStreamingBackup.rollbackRestore({ token });
      await progressListener?.remove?.().catch(() => {});
    }
  }
  const text = await pickBrowserFile();
  const payload = JSON.parse(await decryptBackupEnvelope(JSON.parse(text), password));
  await validateBackupPayload(payload);
  return backupVerificationSummary(payload, 1);
}

export async function finalizeImportedBackup() {
  if (!pendingNativeRestoreToken) return;
  const token = pendingNativeRestoreToken;
  try { await NativeStreamingBackup.finalizeRestore({ token }); }
  finally { pendingNativeRestoreToken = ''; }
}

export async function rollbackImportedBackup() {
  if (!pendingNativeRestoreToken) return;
  const token = pendingNativeRestoreToken;
  await NativeStreamingBackup.rollbackRestore({ token });
  pendingNativeRestoreToken = '';
}

export async function encryptBackupEnvelope(plainText, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plainText));
  return { format: 'mine-encrypted-backup', version: 1, algorithm: 'AES-GCM', kdf: 'PBKDF2-SHA-256', iterations: 210000, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

export async function decryptBackupEnvelope(envelope, password) {
  if (envelope?.format !== 'mine-encrypted-backup' || envelope.version !== 1) throw new Error('备份文件格式不受支持');
  try {
    const salt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    const key = await deriveKey(password, salt, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(envelope.ciphertext));
    return decoder.decode(plain);
  } catch {
    throw new Error('备份密码错误，或文件已经损坏');
  }
}

async function deriveKey(password, salt, usages) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210000 }, material, { name: 'AES-GCM', length: 256 }, false, usages);
}

function requirePassword(password) {
  if (!password || password.length < 8) throw new Error('备份密码至少需要 8 个字符');
}
function backupVerificationSummary(payload, archiveFormatVersion) {
  return {
    archiveFormatVersion: Number(archiveFormatVersion) || null,
    schemaVersion: Number(payload?.schemaVersion) || null,
    exportedAt: typeof payload?.exportedAt === 'string' ? payload.exportedAt : ''
  };
}
async function importLegacyNativeBackup(password) {
  const picked = await FilePicker.pickFiles({ types: ['application/json', 'application/octet-stream'], limit: 1, readData: true });
  const file = picked.files[0];
  if (!file?.data) throw new Error('未能读取所选旧版备份文件');
  const text = decoder.decode(base64ToBytes(file.data));
  const payload = JSON.parse(await decryptBackupEnvelope(JSON.parse(text), password));
  const restored = await validateBackupPayload(payload);
  if (payload?.data?.privateVault) await restoreVaultReferences(payload.data.privateVault);
  return restored;
}
function bytesToBase64(bytes) { let binary=''; for(const byte of bytes) binary+=String.fromCharCode(byte); return btoa(binary); }
function base64ToBytes(base64) { const binary=atob(base64); return Uint8Array.from(binary, c=>c.charCodeAt(0)); }
function pickBrowserFile() { return new Promise((resolve,reject)=>{ const input=document.createElement('input'); input.type='file'; input.accept='.minebackup,application/json'; input.onchange=async()=>{try{resolve(await input.files[0].text())}catch(error){reject(error)}}; input.click(); }); }
