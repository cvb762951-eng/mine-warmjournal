#!/usr/bin/env node
/**
 * 生成热更新用的资源清单 resources.json + 资源文件目录（2026-10-09）
 *
 * 用法：
 *   node scripts/make-resource-manifest.mjs --out <发布目录> --base-url <网址>
 *
 * 产出：
 *   <发布目录>/resources.json   —— 每个文件的路径、大小、sha256
 *   <发布目录>/resources/…      —— 资源本体（保持 www/ 下的相对结构）
 *
 * 客户端拿到清单后，与本地已应用的文件逐个比对哈希，
 * **只下载真的变了的那些文件** —— 这就是「只更新新部分」的落点：
 * 改一个 CSS 就只下那个 CSS，不必重下整包。
 *
 * 版本号从 build.gradle 现读，与 APK、version.json 保持同一口径。
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[key] = value;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const sourceDir = resolve(args.src || join(root, 'www'));
const outputDir = resolve(args.out || join(root, 'releases'));
const baseUrl = String(args['base-url'] || '').replace(/\/+$/, '');
if (!baseUrl.startsWith('https://')) {
  console.error('✗ --base-url 必须是 https 地址');
  process.exit(1);
}

const gradle = await readFile(join(root, 'android/app/build.gradle'), 'utf8');
const versionName = gradle.match(/versionName\s+"([^"]+)"/)?.[1] || '';
const versionCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1] || 0);
if (!versionName || !versionCode) {
  console.error('✗ 无法从 build.gradle 读到版本号');
  process.exit(1);
}

// 这些文件不需要进热更新：
// · source map 体积大且与运行无关
// · service worker 单独处理
// · resource-manifest.json 是「装机自带指纹」，App 拿它当比对基线，
//   一旦被热更新覆盖，基线就失真了 —— 必须排除
//
// ⚠️ service-worker.js 被排除是**故意的**，不要为了「让它也能热更」而放开：
//    浏览器只会对 service worker 做字节比对后整份替换，运行中的页面还握着旧的实例；
//    半路换 SW 是经典的自伤操作。所以 SW 的修复只能随装机包走。
//    历史教训（2026-10-10）：旧版 SW 里写死了一份 1.0.53 的预缓存清单，
//    它既不在热更新清单里、又永远不被换掉，于是可能一直 serve 旧副本，
//    表现为「一部分界面用着用着变回旧样子」。那次的修法就是发新装机包。
const EXCLUDED = new Set(['app.js.map', 'service-worker.js', 'resource-manifest.json', '.DS_Store']);

async function walk(dir, base = dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, base, out);
      continue;
    }
    const rel = relative(base, full).split(sep).join('/');
    if (EXCLUDED.has(rel) || rel.endsWith('.map')) continue;
    const info = await stat(full);
    const sha256 = await new Promise((ok, fail) => {
      const hash = createHash('sha256');
      createReadStream(full).on('data', c => hash.update(c)).on('end', () => ok(hash.digest('hex'))).on('error', fail);
    });
    out.push({ path: rel, size: info.size, sha256 });
  }
  return out;
}

const files = (await walk(sourceDir)).sort((a, b) => a.path.localeCompare(b.path));
const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

const resourcesDir = join(outputDir, 'resources');
await rm(resourcesDir, { recursive: true, force: true });
await mkdir(resourcesDir, { recursive: true });
for (const file of files) {
  const target = join(resourcesDir, file.path);
  await mkdir(join(target, '..'), { recursive: true });
  await cp(join(sourceDir, file.path), target);
}

const manifest = {
  versionName,
  versionCode,
  baseUrl: `${baseUrl}/resources`,
  generatedAt: new Date().toISOString().slice(0, 10),
  fileCount: files.length,
  totalBytes,
  files
};
await writeFile(join(outputDir, 'resources.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`✓ 已生成 ${join(outputDir, 'resources.json')}`);
console.log(`  版本    ${versionName} (${versionCode})`);
console.log(`  文件数  ${files.length}`);
console.log(`  总体积  ${(totalBytes / 1048576).toFixed(1)} MB`);
console.log(`  资源已复制到 ${resourcesDir}`);
console.log('');
console.log('  客户端会比对哈希，只下载变化的文件 —— 改一个 CSS 就只下那个 CSS。');
