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
  const errors = versionsAgree(versions);
  if (errors.length) {
    for (const error of errors) console.error(`✗ ${error}`);
    process.exit(1);
  }
  const { versionName, versionCode } = versions.gradle;
  console.error(`版本一致：${versionName} (${versionCode})`);
  console.error(`  package.json      ${versions.pkg.versionName}`);
  console.error(`  app-updater.js    ${versions.updater.versionName} / ${versions.updater.versionCode}`);
  console.error(`  build.gradle      ${versions.gradle.versionName} / ${versions.gradle.versionCode}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version_name=${versionName}\nversion_code=${versionCode}\n`);
  }
}
