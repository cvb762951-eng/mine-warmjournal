// 发版时这五处要一起改，本脚本在打包前核对，不一致直接失败：
// package.json、app-updater.js、android/app/build.gradle、
// index.html 的 ?v=、release-notes.js 里当前 versionCode 的条目。
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');

export function parseGradleVersions(text) {
  const versionName = text.match(/versionName\s+"([^"]+)"/)?.[1] ?? '';
  const versionCode = Number(text.match(/versionCode\s+(\d+)/)?.[1] ?? 0);
  return { versionName, versionCode };
}

export function parseUpdaterVersions(text) {
  const versionName = text.match(/export const APP_VERSION_NAME = '([^']+)'/)?.[1] ?? '';
  const versionCode = Number(text.match(/export const APP_VERSION_CODE = (\d+)/)?.[1] ?? 0);
  return { versionName, versionCode };
}

export function parsePackageVersion(text) {
  const versionName = String(JSON.parse(text)?.version ?? '');
  return { versionName };
}

export function versionsAgree({ pkg, updater, gradle }) {
  const errors = [];
  if (!pkg?.versionName || !updater?.versionName || !gradle?.versionName) {
    errors.push('有一处版本号是空的');
  }
  if (!updater?.versionCode || !gradle?.versionCode) {
    errors.push('有一处 versionCode 是空的');
  }
  const names = [pkg?.versionName, updater?.versionName, gradle?.versionName];
  if (new Set(names).size !== 1) {
    errors.push(`versionName 不一致：package.json=${pkg?.versionName} app-updater.js=${updater?.versionName} build.gradle=${gradle?.versionName}`);
  }
  if (updater?.versionCode !== gradle?.versionCode) {
    errors.push(`versionCode 不一致：app-updater.js=${updater?.versionCode} build.gradle=${gradle?.versionCode}`);
  }
  return errors;
}

export function parseIndexCacheVersions(text) {
  return [...String(text || '').matchAll(/\?v=([^"'&\s>#]+)/g)].map(match => match[1]);
}

export function indexCacheErrors(versionName, cacheVersions) {
  const versions = Array.isArray(cacheVersions) ? cacheVersions : [];
  if (!versions.length) return ['index.html 没有 ?v= 缓存参数'];
  const mismatched = [...new Set(versions.filter(value => value !== versionName))];
  if (!mismatched.length) return [];
  return [`index.html ?v= 与 versionName 不一致：${mismatched.join(', ')}，应为 ${versionName}`];
}

export function parseReleaseNoteName(text, versionCode) {
  const code = Number(versionCode);
  if (!Number.isInteger(code) || code <= 0) return '';
  const match = String(text || '').match(new RegExp(
    `(?:^|\\n)\\s*${code}\\s*:\\s*\\{[\\s\\S]*?name:\\s*['"]([^'"]*)['"]`
  ));
  return match?.[1] ?? '';
}

export function releaseNoteErrors(versionName, versionCode, noteName) {
  if (!noteName) return [`release-notes.js 缺少 versionCode ${versionCode} 的条目`];
  if (noteName !== versionName) {
    return [`release-notes.js[${versionCode}].name=${noteName}，应为 ${versionName}`];
  }
  return [];
}

export function readWorkingTreeVersions(dir = root) {
  const pkg = parsePackageVersion(readFileSync(resolve(dir, 'package.json'), 'utf8'));
  const updater = parseUpdaterVersions(readFileSync(resolve(dir, 'app-updater.js'), 'utf8'));
  const gradle = parseGradleVersions(readFileSync(resolve(dir, 'android/app/build.gradle'), 'utf8'));
  return { pkg, updater, gradle };
}

function isMain() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  const versions = readWorkingTreeVersions();
  const indexHtml = readFileSync(resolve(root, 'index.html'), 'utf8');
  const notesText = readFileSync(resolve(root, 'release-notes.js'), 'utf8');
  const { versionName, versionCode } = versions.gradle;
  const errors = [
    ...versionsAgree(versions),
    ...indexCacheErrors(versionName, parseIndexCacheVersions(indexHtml)),
    ...releaseNoteErrors(versionName, versionCode, parseReleaseNoteName(notesText, versionCode))
  ];
  if (errors.length) {
    for (const error of errors) console.error(`✗ ${error}`);
    process.exit(1);
  }
  console.error(`版本一致：${versionName} (${versionCode})`);
  console.error(`  package.json      ${versions.pkg.versionName}`);
  console.error(`  app-updater.js    ${versions.updater.versionName} / ${versions.updater.versionCode}`);
  console.error(`  build.gradle      ${versions.gradle.versionName} / ${versions.gradle.versionCode}`);
  console.error(`  index.html        ?v=${versionName}`);
  console.error(`  release-notes.js  ${versionCode} / ${versionName}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version_name=${versionName}\nversion_code=${versionCode}\n`);
  }
}
