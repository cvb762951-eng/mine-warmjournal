const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ITERATIONS = 600000;
const CHECK = 'MINE_PASSWORD_VAULT_V1';

let dataKey = null;
let content = null;

export const passwordVaultConfigured = state => Boolean(state?.passwordVault?.salt && state.passwordVault.wrappedKey && state.passwordVault.payload);
export const passwordVaultUnlocked = () => Boolean(dataKey && content);
export const passwordVaultContent = () => content;
export const passwordVaultKeyBase64 = () => dataKey ? bytesToBase64(dataKey) : '';

export function normalizePasswordVault(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    version: Number(source.version) === 1 ? 1 : 1,
    algorithm: source.algorithm === 'AES-256-GCM' ? source.algorithm : 'AES-256-GCM',
    kdf: source.kdf === 'PBKDF2-SHA-256' ? source.kdf : 'PBKDF2-SHA-256',
    iterations: Math.max(600000, Number(source.iterations) || ITERATIONS),
    salt: String(source.salt || ''),
    wrappedKeyIv: String(source.wrappedKeyIv || ''),
    wrappedKey: String(source.wrappedKey || ''),
    payloadIv: String(source.payloadIv || ''),
    payload: String(source.payload || ''),
    biometricEnabled: source.biometricEnabled === true,
    updatedAt: Math.max(0, Number(source.updatedAt) || 0)
  };
}

export async function setupPasswordVault(state, masterPassword) {
  validateMasterPassword(masterPassword);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = crypto.getRandomValues(new Uint8Array(32));
  const masterKey = await deriveMasterKey(masterPassword, salt, ITERATIONS);
  const wrapped = await encryptBytes(key, masterKey);
  dataKey = key;
  content = { check: CHECK, entries: [] };
  const payload = await encryptText(JSON.stringify(content), dataKey);
  state.passwordVault = { version: 1, algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA-256', iterations: ITERATIONS, salt: bytesToBase64(salt), wrappedKeyIv: wrapped.iv, wrappedKey: wrapped.ciphertext, payloadIv: payload.iv, payload: payload.ciphertext, biometricEnabled: false, updatedAt: Date.now() };
}

export async function unlockPasswordVault(state, masterPassword) {
  if (!passwordVaultConfigured(state)) throw new Error('密码本尚未设置');
  try {
    const vault = state.passwordVault;
    const masterKey = await deriveMasterKey(masterPassword, base64ToBytes(vault.salt), vault.iterations);
    const key = await decryptBytes(vault.wrappedKey, vault.wrappedKeyIv, masterKey);
    await unlockPasswordVaultWithKey(state, key);
  } catch {
    lockPasswordVault();
    throw new Error('主密码错误，或密码本数据已经损坏');
  }
}

export async function unlockPasswordVaultWithKey(state, key) {
  const bytes = key instanceof Uint8Array ? key : base64ToBytes(key);
  const parsed = JSON.parse(await decryptText(state.passwordVault.payload, state.passwordVault.payloadIv, bytes));
  if (parsed?.check !== CHECK) throw new Error('密码本密钥无效');
  dataKey = new Uint8Array(bytes);
  content = normalizeContent(parsed);
}

export async function persistPasswordVault(state) {
  if (!passwordVaultUnlocked()) throw new Error('密码本已经锁定');
  content = normalizeContent(content);
  const payload = await encryptText(JSON.stringify(content), dataKey);
  state.passwordVault.payloadIv = payload.iv;
  state.passwordVault.payload = payload.ciphertext;
  state.passwordVault.updatedAt = Date.now();
}

export async function changePasswordVaultMaster(state, oldPassword, nextPassword) {
  validateMasterPassword(nextPassword);
  if (!passwordVaultUnlocked()) await unlockPasswordVault(state, oldPassword);
  else if (oldPassword) {
    const masterKey = await deriveMasterKey(oldPassword, base64ToBytes(state.passwordVault.salt), state.passwordVault.iterations);
    const candidate = await decryptBytes(state.passwordVault.wrappedKey, state.passwordVault.wrappedKeyIv, masterKey).catch(() => null);
    if (!candidate || !constantEqual(candidate, dataKey)) throw new Error('当前主密码错误');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const masterKey = await deriveMasterKey(nextPassword, salt, ITERATIONS);
  const wrapped = await encryptBytes(dataKey, masterKey);
  Object.assign(state.passwordVault, { iterations: ITERATIONS, salt: bytesToBase64(salt), wrappedKeyIv: wrapped.iv, wrappedKey: wrapped.ciphertext, updatedAt: Date.now() });
}

export function lockPasswordVault() {
  if (dataKey) dataKey.fill(0);
  dataKey = null;
  content = null;
}

export function generatePassword(length = 20) {
  const size = Math.max(12, Math.min(64, Number(length) || 20));
  const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*_-+='];
  const all = groups.join('');
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  const chars = groups.map((group, index) => group[bytes[index] % group.length]);
  for (let index = groups.length; index < size; index++) chars.push(all[bytes[index] % all.length]);
  for (let index = chars.length - 1; index > 0; index--) { const swap = bytes[index] % (index + 1); [chars[index], chars[swap]] = [chars[swap], chars[index]]; }
  return chars.join('');
}

function normalizeContent(input) {
  const entries = Array.isArray(input?.entries) ? input.entries.map(entry => ({
    id: String(entry?.id || crypto.randomUUID()),
    title: String(entry?.title || '').trim().slice(0, 100),
    username: String(entry?.username || '').trim().slice(0, 200),
    password: String(entry?.password || '').slice(0, 1000),
    url: String(entry?.url || '').trim().slice(0, 2000),
    app: String(entry?.app || '').trim().slice(0, 120),
    category: String(entry?.category || '其他').trim().slice(0, 40) || '其他',
    tags: [...new Set((Array.isArray(entry?.tags) ? entry.tags : []).map(value => String(value).trim().slice(0, 30)).filter(Boolean))].slice(0, 12),
    notes: String(entry?.notes || '').slice(0, 4000),
    createdAt: Math.max(0, Number(entry?.createdAt) || Date.now()),
    updatedAt: Math.max(0, Number(entry?.updatedAt) || Number(entry?.createdAt) || Date.now())
  })).filter(entry => entry.title && entry.password).filter((entry, index, list) => list.findIndex(item => item.id === entry.id) === index).slice(0, 5000) : [];
  return { check: CHECK, entries };
}

function validateMasterPassword(value) { if (String(value || '').length < 10) throw new Error('主密码至少需要 10 个字符'); }
async function deriveMasterKey(password, salt, iterations) { const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']); return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: Math.max(600000, Number(iterations) || ITERATIONS) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
async function rawKey(bytes, usage) { return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [usage]); }
async function encryptBytes(bytes, key) { const iv = crypto.getRandomValues(new Uint8Array(12)); const value = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes); return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(value)) }; }
async function decryptBytes(ciphertext, iv, key) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, key, base64ToBytes(ciphertext))); }
async function encryptText(text, keyBytes) { return encryptBytes(encoder.encode(text), await rawKey(keyBytes, 'encrypt')); }
async function decryptText(ciphertext, iv, keyBytes) { return decoder.decode(await decryptBytes(ciphertext, iv, await rawKey(keyBytes, 'decrypt'))); }
function constantEqual(a, b) { if (a.length !== b.length) return false; let result = 0; for (let index = 0; index < a.length; index++) result |= a[index] ^ b[index]; return result === 0; }
function bytesToBase64(bytes) { let value = ''; for (let index = 0; index < bytes.length; index += 0x8000) value += String.fromCharCode(...bytes.subarray(index, index + 0x8000)); return btoa(value); }
function base64ToBytes(value) { const raw = atob(value); return Uint8Array.from(raw, char => char.charCodeAt(0)); }
