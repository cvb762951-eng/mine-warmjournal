import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 已装到手机上的发布证书 SHA-256 前缀。对不上就不能覆盖安装。 */
export const RELEASE_CERT_SHA256_PREFIX = '2f0da7fe';

export function parseApksignerSha256(output) {
  const match = String(output || '').match(/SHA-256 digest:\s*([0-9a-fA-F:]+)/);
  if (!match) return '';
  return match[1].replace(/:/g, '').toLowerCase();
}

export function certificateMatchesReleaseKey(fingerprint) {
  const hex = String(fingerprint || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  return hex.startsWith(RELEASE_CERT_SHA256_PREFIX);
}

export function findApksigner(sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '') {
  if (!sdkRoot) return '';
  const tools = join(sdkRoot, 'build-tools');
  if (!existsSync(tools)) return '';
  const versions = readdirSync(tools).filter(name => existsSync(join(tools, name, 'apksigner'))).sort();
  if (!versions.length) return '';
  return join(tools, versions[versions.length - 1], 'apksigner');
}

export function readApkCertSha256(apkPath, apksigner = findApksigner()) {
  if (!apksigner) throw new Error('找不到 apksigner，请先安装 Android build-tools');
  const result = spawnSync(apksigner, ['verify', '--print-certs', apkPath], { encoding: 'utf8' });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  return { status: result.status, fingerprint: parseApksignerSha256(output), output };
}

function isMain() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  const apkPath = process.argv[2];
  if (!apkPath) {
    console.error('用法: node scripts/apk-cert.mjs <apk>');
    process.exit(1);
  }
  const { fingerprint } = readApkCertSha256(apkPath);
  if (!certificateMatchesReleaseKey(fingerprint)) {
    console.error('发布证书不对，拒绝发布这个 APK。');
    console.error(`期望 SHA-256 以 ${RELEASE_CERT_SHA256_PREFIX} 开头`);
    console.error(`实际 SHA-256：${fingerprint || '（没有读到证书，可能未签名）'}`);
    process.exit(1);
  }
  console.log(`发布证书 SHA-256 以 ${RELEASE_CERT_SHA256_PREFIX} 开头（${fingerprint}）`);
}
