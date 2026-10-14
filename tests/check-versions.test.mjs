import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  indexCacheErrors,
  parseIndexCacheVersions,
  parseReleaseNoteName,
  readWorkingTreeVersions,
  releaseNoteErrors,
  versionsAgree
} from '../scripts/check-versions.mjs';

test('package.json、app-updater.js、build.gradle 版本一致', () => {
  const versions = readWorkingTreeVersions();
  assert.deepEqual(versionsAgree(versions), []);
  assert.equal(versions.pkg.versionName, versions.gradle.versionName);
  assert.equal(versions.updater.versionName, versions.gradle.versionName);
  assert.equal(versions.updater.versionCode, versions.gradle.versionCode);
});

test('三处不一致时给出具体差异', () => {
  const errors = versionsAgree({
    pkg: { versionName: '1.1.29' },
    updater: { versionName: '1.1.28', versionCode: 130 },
    gradle: { versionName: '1.1.28', versionCode: 129 }
  });
  assert.ok(errors.some(line => line.includes('versionName')));
  assert.ok(errors.some(line => line.includes('versionCode')));
});

test('index.html 的 ?v= 和 release-notes 当前条目与三处版本一致', () => {
  const versions = readWorkingTreeVersions();
  const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const notes = readFileSync(new URL('../release-notes.js', import.meta.url), 'utf8');
  const cacheVersions = parseIndexCacheVersions(indexHtml);
  assert.ok(cacheVersions.length >= 1);
  assert.deepEqual(indexCacheErrors(versions.gradle.versionName, cacheVersions), []);
  assert.equal(parseReleaseNoteName(notes, versions.gradle.versionCode), versions.gradle.versionName);
  assert.deepEqual(releaseNoteErrors(
    versions.gradle.versionName,
    versions.gradle.versionCode,
    parseReleaseNoteName(notes, versions.gradle.versionCode)
  ), []);
});

test('index.html 的 ?v= 落后于 versionName 时失败', () => {
  const html = '<script defer src="app.js?v=1.1.28"></script>\n<link href="styles.css?v=1.1.29">';
  const errors = indexCacheErrors('1.1.29', parseIndexCacheVersions(html));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /1\.1\.28/);
  assert.match(errors[0], /应为 1\.1\.29/);
});

test('index.html 没有 ?v= 时失败', () => {
  assert.deepEqual(indexCacheErrors('1.1.29', parseIndexCacheVersions('<script src="app.js"></script>')), [
    'index.html 没有 ?v= 缓存参数'
  ]);
});

test('release-notes 缺少当前 versionCode 或 name 不一致时失败', () => {
  const notes = `
  129: {
    name: '1.1.28', date: '2026-10-13', time: '23:45:00',
    title: '上一版'
  }
`;
  assert.equal(parseReleaseNoteName(notes, 130), '');
  assert.match(releaseNoteErrors('1.1.29', 130, '')[0], /缺少 versionCode 130/);
  assert.match(releaseNoteErrors('1.1.29', 130, '1.1.28')[0], /应为 1\.1\.29/);
  assert.deepEqual(releaseNoteErrors('1.1.29', 130, '1.1.29'), []);
});
