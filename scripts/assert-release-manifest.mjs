import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseUpdateManifest } from '../app-updater.js';

const manifestPath = process.argv[2];
const apkPath = process.argv[3];
if (!manifestPath || !apkPath) {
  console.error('用法: node scripts/assert-release-manifest.mjs <version.json> <apk>');
  process.exit(1);
}

const manifest = parseUpdateManifest(await readFile(manifestPath, 'utf8'));
const sha256 = await new Promise((resolveHash, rejectHash) => {
  const hash = createHash('sha256');
  createReadStream(apkPath)
    .on('data', chunk => hash.update(chunk))
    .on('end', () => resolveHash(hash.digest('hex')))
    .on('error', rejectHash);
});
const fileName = basename(apkPath);
if (manifest.sha256 !== sha256) {
  console.error('version.json 里的 sha256 和 APK 文件不一致');
  process.exit(1);
}
if (!manifest.apkUrl.startsWith('https://') || !manifest.apkUrl.endsWith(`/${fileName}`)) {
  console.error(`apkUrl 必须是这个 APK 的 https 地址，实际是 ${manifest.apkUrl}`);
  process.exit(1);
}
console.log(`${manifest.versionName} (${manifest.versionCode})`);
console.log(manifest.apkUrl);
console.log(`sha256 ${manifest.sha256}`);
console.log(`sizeBytes ${manifest.sizeBytes}`);
