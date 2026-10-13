import assert from 'node:assert/strict';
import test from 'node:test';
import { readWorkingTreeVersions, versionsAgree } from '../scripts/check-versions.mjs';

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
