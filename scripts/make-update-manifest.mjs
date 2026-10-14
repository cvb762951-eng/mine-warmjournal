#!/usr/bin/env node
/**
 * 生成应用内更新用的版本清单 version.json（2026-10-09）
 *
 * 用法：
 *   node scripts/make-update-manifest.mjs \
 *     --apk <APK 路径> --out <输出目录> --base-url <安装包所在网址> [--notes <说明文件>]
 *
 * 生成的 version.json 要和 APK 放在同一目录下，App 才能读到。
 * 版本号从 android/app/build.gradle 现读，避免与构建产物不一致；
 * 发布文件名默认按 Mine-<版本>.apk 生成，可用 --name 覆盖。
 *
 * 例：
 *   node scripts/make-update-manifest.mjs \
 *     --apk android/app/build/outputs/apk/debug/app-debug.apk \
 *     --out ../apk-share-1054 \
 *     --base-url https://warm-journal-apk.app.workbuddy.host \
 *     --notes update-notes.txt
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : 'true';
    out[key] = value;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const apkPath = resolve(args.apk || join(root, 'android/app/build/outputs/apk/debug/app-debug.apk'));
const outputDir = resolve(args.out || join(root, 'releases'));
const baseUrl = String(args['base-url'] || '').replace(/\/+$/, '');

if (!baseUrl.startsWith('https://')) {
  console.error('✗ --base-url 必须是 https 地址（App 侧只接受 https）');
  process.exit(1);
}

// 版本号以 build.gradle 为准 —— 这里不接收参数，从根上杜绝「清单版本 ≠ 包内版本」
const gradle = await readFile(join(root, 'android/app/build.gradle'), 'utf8');
const versionCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1] || 0);
const versionName = gradle.match(/versionName\s+"([^"]+)"/)?.[1] || '';
if (!versionCode || !versionName) {
  console.error('✗ 无法从 build.gradle 读到 versionCode / versionName');
  process.exit(1);
}

const apkStats = await stat(apkPath);
// 流式计算：安装包上百 MB，不能整个读进内存
const sha256 = await new Promise((resolveHash, rejectHash) => {
  const hash = createHash('sha256');
  createReadStream(apkPath)
    .on('data', chunk => hash.update(chunk))
    .on('end', () => resolveHash(hash.digest('hex')))
    .on('error', rejectHash);
});
const fileName = String(args.name || `Mine-${versionName}.apk`).replace(/^\/+/, '');
if (fileName.includes('/') || fileName.includes('..')) {
  console.error('✗ --name 只能是文件名，不能包含路径');
  process.exit(1);
}

let notes = '';
if (args.notes) {
  try {
    notes = (await readFile(resolve(args.notes), 'utf8')).trim();
  } catch {
    console.warn('⚠ 说明文件读取失败，本次不含更新说明');
  }
}

/* 是否声明支持资源热更新 —— **默认不支持**，必须显式传 --hot 才开。
 *
 * 理由：热更新只能替换 www/ 下的网页资源，**换不了原生代码**。
 * 只要这一版动过 Java/Kotlin 或原生配置，就必须走完整安装包；
 * 若此时仍声明支持热更新，用户会热更新完却拿不到真正的修复 ——
 * 表面上「更新成功」，实际问题依旧。默认关掉是更安全的取向。 */
const hotEnabled = args.hot === 'true';

// 北京时间全年 UTC+8。toISOString() 是 UTC 日期，凌晨发布会被记成前一天，而且丢掉时分。
function shanghaiPublishedAt(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 3600000);
  const pad = number => String(number).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}+08:00`;
}

const manifest = {
  versionName,
  versionCode,
  apkUrl: `${baseUrl}/${fileName}`,
  fileName,
  sizeBytes: apkStats.size,
  sha256,
  publishedAt: shanghaiPublishedAt(new Date()),
  // 有它才走「只下载变化的文件」；没有则一律走完整安装包
  ...(hotEnabled ? { resourceManifestUrl: `${baseUrl}/resources.json` } : {}),
  notes
};

const target = join(outputDir, 'version.json');

/* 版本号必须递增 —— 这道检查是拿一次真实失误换来的（2026-10-09）：
   那天给 1.0.65 加了「应用内更新」功能却没升版本，于是两个内容不同的包
   共用同一个版本号。后果是：装了旧包的人点「检查更新」永远显示「已是最新」，
   再也拿不到新功能 —— 而且从界面上完全看不出来哪里不对。

   规则：只要安装包内容（sha256）变了，版本号就必须比上次发布的高。 */
const recordPath = join(outputDir, '.published.json');
let previous = null;
try {
  previous = JSON.parse(await readFile(recordPath, 'utf8'));
} catch { /* 首次发布，没有记录 */ }

if (previous && Number(previous.versionCode) >= versionCode && previous.sha256 !== sha256) {
  console.error('✗ 版本号没有递增，但安装包内容已经变了。');
  console.error(`  上次发布：${previous.versionName} (${previous.versionCode})  sha256 ${String(previous.sha256).slice(0, 12)}…`);
  console.error(`  本次发布：${versionName} (${versionCode})  sha256 ${sha256.slice(0, 12)}…`);
  console.error('  内容和版本号必须一起变，否则老用户点「检查更新」会永远显示「已是最新」。');
  console.error('  请先把 versionCode +1、versionName 递增（package.json、app-updater.js、build.gradle、index.html 的 ?v=、release-notes.js），重新打包后再来。');
  process.exit(1);
}

await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await writeFile(recordPath, `${JSON.stringify({
  versionName,
  versionCode,
  sha256,
  sizeBytes: apkStats.size,
  publishedAt: manifest.publishedAt
}, null, 2)}\n`, 'utf8');

console.log(`✓ 已生成 ${target}`);
console.log(`  版本      ${versionName} (${versionCode})`);
console.log(`  安装包    ${fileName}  ${(apkStats.size / 1024 / 1024).toFixed(1)} MB`);
console.log(`  sha256    ${sha256}`);
console.log(`  下载地址  ${manifest.apkUrl}`);
console.log(`  热更新    ${hotEnabled ? '已声明支持（客户端只下变化文件）' : '未声明（本次走完整安装包）'}`);
if (!hotEnabled) {
  console.log('            —— 若本次只改了 www/ 资源（无 Java/Kotlin 改动），可加 --hot 让用户少下流量');
  console.log('            —— 改动涉及原生代码时必须保持关闭，否则用户热更新后拿不到真修复');
}
if (!notes) console.log('  （未提供更新说明，App 里会只显示版本号）');
