import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeDefaultState, migrateState } from '../model.js';
import { setupPasswordVault, unlockPasswordVault, passwordVaultContent, persistPasswordVault, lockPasswordVault, generatePassword } from '../password-vault.js';
const view = await readFile(new URL('../views/password-vault.js', import.meta.url), 'utf8');
const native = await readFile(new URL('../android/app/src/main/java/com/mine/focus/PasswordVaultNativePlugin.java', import.meta.url), 'utf8');
const mine = await readFile(new URL('../views/mine.js', import.meta.url), 'utf8');
const contract = await readFile(new URL('../WARM_APP_CONTRACT.md', import.meta.url), 'utf8');

test('password vault encrypts every credential field and rejects a wrong master password', async () => {
  const state = makeDefaultState(); await setupPasswordVault(state, 'correct horse battery staple');
  passwordVaultContent().entries.push({ id:'secret', title:'秘密网站', username:'private@example.com', password:'NeverPlain123!', url:'https://private.example', app:'', category:'其他', tags:['隐私'], notes:'不可明文', createdAt:1, updatedAt:1 });
  await persistPasswordVault(state); const serialized = JSON.stringify(state.passwordVault);
  for (const secret of ['秘密网站','private@example.com','NeverPlain123!','private.example','不可明文']) assert.equal(serialized.includes(secret), false);
  lockPasswordVault(); await assert.rejects(() => unlockPasswordVault(state, 'wrong password value'), /主密码错误/); await unlockPasswordVault(state, 'correct horse battery staple'); assert.equal(passwordVaultContent().entries[0].username, 'private@example.com');
});
test('password vault migration remains opaque and generator covers every group', () => { const state=migrateState({}); assert.equal(state.passwordVault.payload,''); const value=generatePassword(24); assert.equal(value.length,24); assert.match(value,/[A-Z]/); assert.match(value,/[a-z]/); assert.match(value,/[2-9]/); assert.match(value,/[!@#$%^&*_+=-]/); assert.match(contract,/passwordVault/); });
test('fingerprint is attempted first and master password stays hidden until fallback', () => { assert.match(view,/\$\{setup \? '' : 'hidden'\}/); assert.match(view,/正在检查本机系统指纹/); assert.match(view,/!fingerprintAttempted && !fingerprintInFlight/); assert.match(view,/await fingerprintUnlock\(true\)/); assert.match(view,/showMasterPasswordFallback/); assert.match(view,/form\.hidden = false/); assert.match(view,/重新使用系统指纹/); assert.match(view,/document\.visibilityState === 'visible'[\s\S]*render\(\)/); });
test('password UI locks on background and uses native secure fingerprint and clipboard controls', () => { assert.match(mine,/settings-password-vault/); assert.match(view,/document\.visibilityState === 'hidden'/); assert.match(view,/setSecureWindow/); assert.match(view,/copySecret\(\{ text: value, timeoutMs: 30000 \}\)/); assert.match(view,/系统指纹解锁/); assert.match(view,/不进入 AI/); assert.match(native,/AndroidKeyStore/); assert.match(native,/AUTH_BIOMETRIC_STRONG/); assert.match(native,/FLAG_SECURE/); assert.match(native,/IS_SENSITIVE/); assert.match(native,/clearPrimaryClip/); assert.match(native,/mine_password_vault_fingerprint_v1/); assert.match(native,/mine_private_vault_fingerprint_v1/); assert.match(native,/"private"\.equals\(scope\) \? PRIVATE_ALIAS : PASSWORD_ALIAS/); });
