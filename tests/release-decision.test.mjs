import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldCreateRelease } from '../scripts/release-decision.mjs';

const ready = {
  eventName: 'push',
  ref: 'refs/heads/main',
  signed: true,
  certOk: true,
  tagExists: false,
  latestReleaseKnown: true
};

test('合并仍是 1.1.28 (129) 的提交不会发 Release', () => {
  const decision = shouldCreateRelease({
    ...ready,
    versionName: '1.1.28',
    versionCode: 129,
    previousVersionName: '1.1.28',
    previousVersionCode: 129,
    tagExists: true,
    latestReleaseVersionCode: 129
  });
  assert.equal(decision.create, false);
  assert.match(decision.reason, /没有改版本/);
});

test('没有标签、也没有旧 Release 时，版本没变仍然不发', () => {
  const decision = shouldCreateRelease({
    ...ready,
    versionName: '1.1.28',
    versionCode: 129,
    previousVersionName: '1.1.28',
    previousVersionCode: 129,
    tagExists: false,
    latestReleaseKnown: false,
    latestReleaseVersionCode: null
  });
  assert.equal(decision.create, false);
});

test('下一次真发布 1.1.29 (130) 才会创建 Release', () => {
  const decision = shouldCreateRelease({
    ...ready,
    versionName: '1.1.29',
    versionCode: 130,
    previousVersionName: '1.1.28',
    previousVersionCode: 129,
    latestReleaseVersionCode: 129
  });
  assert.equal(decision.create, true);
  assert.match(decision.reason, /1\.1\.29/);
});

test('versionCode 没有高于最新 Release 时不发', () => {
  const decision = shouldCreateRelease({
    ...ready,
    versionName: '1.1.29',
    versionCode: 129,
    previousVersionName: '1.1.28',
    previousVersionCode: 128,
    latestReleaseVersionCode: 129
  });
  assert.equal(decision.create, false);
  assert.match(decision.reason, /没有高于/);
});

test('标签已存在就只留产物', () => {
  const decision = shouldCreateRelease({
    ...ready,
    versionName: '1.1.29',
    versionCode: 130,
    previousVersionName: '1.1.28',
    previousVersionCode: 129,
    tagExists: true,
    latestReleaseVersionCode: 129
  });
  assert.equal(decision.create, false);
  assert.match(decision.reason, /已存在/);
});

test('pull_request 和手动触发都不发 Release', () => {
  const bumped = {
    ...ready,
    versionName: '1.1.29',
    versionCode: 130,
    previousVersionName: '1.1.28',
    previousVersionCode: 129,
    latestReleaseVersionCode: 129
  };
  assert.equal(shouldCreateRelease({ ...bumped, eventName: 'pull_request' }).create, false);
  assert.equal(shouldCreateRelease({ ...bumped, eventName: 'workflow_dispatch' }).create, false);
});

test('签名或证书不对时，即使升了版本也不发', () => {
  const bumped = {
    ...ready,
    versionName: '1.1.29',
    versionCode: 130,
    previousVersionName: '1.1.28',
    previousVersionCode: 129,
    latestReleaseVersionCode: 129
  };
  assert.equal(shouldCreateRelease({ ...bumped, signed: false }).create, false);
  assert.equal(shouldCreateRelease({ ...bumped, certOk: false }).create, false);
});

test('读不到已有 Release 的 versionCode 时拒绝发布', () => {
  const decision = shouldCreateRelease({
    ...ready,
    versionName: '1.1.29',
    versionCode: 130,
    previousVersionName: '1.1.28',
    previousVersionCode: 129,
    latestReleaseKnown: true,
    latestReleaseVersionCode: null
  });
  assert.equal(decision.create, false);
});
