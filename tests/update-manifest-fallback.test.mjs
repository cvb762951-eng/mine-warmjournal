import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertApkSha256,
  DEFAULT_UPDATE_MANIFEST,
  DEFAULT_UPDATE_MANIFESTS,
  downloadUpdate,
  fetchUpdateManifest,
  manifestEndpoints,
  parseUpdateManifest
} from '../app-updater.js';

const SHA = 'ab'.repeat(32);
const GITHUB = 'https://github.com/cvb762951-eng/mine-warmjournal/releases/latest/download/version.json';
const WORKBUDDY = 'https://warm-journal-apk.app.workbuddy.host/version.json';

function body(overrides = {}) {
  return JSON.stringify({
    versionName: '1.1.29',
    versionCode: 130,
    apkUrl: 'https://github.com/cvb762951-eng/mine-warmjournal/releases/download/v1.1.29/warmjournal-1.1.29-130.apk',
    sizeBytes: 12,
    sha256: SHA,
    notes: '下一版',
    ...overrides
  });
}

async function withFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test('默认清单先 GitHub，再 workbuddy，且都是 https', () => {
  assert.deepEqual(DEFAULT_UPDATE_MANIFESTS, [GITHUB, WORKBUDDY]);
  assert.equal(DEFAULT_UPDATE_MANIFEST, GITHUB);
  for (const url of DEFAULT_UPDATE_MANIFESTS) assert.match(url, /^https:\/\//);
  assert.deepEqual(manifestEndpoints(''), DEFAULT_UPDATE_MANIFESTS);
  assert.deepEqual(manifestEndpoints('  '), DEFAULT_UPDATE_MANIFESTS);
  assert.deepEqual(manifestEndpoints(undefined), DEFAULT_UPDATE_MANIFESTS);
});

test('用户设置的更新地址优先，失败也不回落到默认列表', async () => {
  const seen = [];
  await assert.rejects(
    () => fetchUpdateManifest('https://updates.example/version.json', {
      fetchText: async url => {
        seen.push(url);
        const error = new Error('读取版本信息超时，请检查网络');
        error.name = 'AbortError';
        throw error;
      }
    }),
    /超时/
  );
  assert.deepEqual(seen, ['https://updates.example/version.json']);
});

test('不是 https 的清单地址直接拒绝，不会去请求', async () => {
  let called = false;
  await assert.rejects(
    () => fetchUpdateManifest('http://updates.example/version.json', {
      fetchText: async () => { called = true; return body(); }
    }),
    /更新地址必须是 https/
  );
  assert.equal(called, false);
});

test('超时、HTTP 错误、坏 JSON、缺 sha256、非 https 安装包都会换下一个源', async () => {
  const cases = [
    async () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    },
    async () => { throw new Error('读取版本信息失败（502）'); },
    async () => 'not-json',
    async () => body({ sha256: '' }),
    async () => body({ apkUrl: 'http://example.com/app.apk' }),
    async () => body({ resourceManifestUrl: 'http://example.com/resources.json' })
  ];
  for (const fail of cases) {
    const seen = [];
    const manifest = await fetchUpdateManifest(undefined, {
      fetchText: async url => {
        seen.push(url);
        if (url === GITHUB) return fail();
        if (url === WORKBUDDY) return body();
        throw new Error(`unexpected ${url}`);
      }
    });
    assert.deepEqual(seen, [GITHUB, WORKBUDDY], fail.name || 'case');
    assert.equal(manifest.versionCode, 130);
    assert.equal(manifest.sha256, SHA);
    assert.match(manifest.apkUrl, /^https:\/\//);
  }
});

test('第一个源可用时不会再请求后面的源', async () => {
  const seen = [];
  const manifest = await fetchUpdateManifest(undefined, {
    fetchText: async url => {
      seen.push(url);
      return body();
    }
  });
  assert.deepEqual(seen, [GITHUB]);
  assert.equal(manifest.versionName, '1.1.29');
});

test('默认源全部失败时说明更新源都不可用', async () => {
  await assert.rejects(
    () => fetchUpdateManifest(undefined, {
      fetchText: async () => { throw new Error('读取版本信息失败（404）'); }
    }),
    /更新源都不可用/
  );
});

test('真实 fetch：GitHub 超时或 HTTP 错误、内容损坏时落到 workbuddy', async () => {
  const manifest = await withFetch(async url => {
    const target = String(url);
    if (target === GITHUB) {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    }
    if (target === WORKBUDDY) return new Response(body(), { status: 200 });
    throw new Error(`unexpected ${target}`);
  }, () => fetchUpdateManifest());
  assert.equal(manifest.apkUrl.startsWith('https://'), true);
  assert.equal(manifest.sha256, SHA);

  const afterHttpError = await withFetch(async url => {
    if (String(url) === GITHUB) return new Response('nope', { status: 500 });
    return new Response(body({ versionCode: 131 }), { status: 200 });
  }, () => fetchUpdateManifest(''));
  assert.equal(afterHttpError.versionCode, 131);

  const afterGarbage = await withFetch(async url => {
    if (String(url) === GITHUB) return new Response('{', { status: 200 });
    return new Response(body(), { status: 200 });
  }, () => fetchUpdateManifest());
  assert.equal(afterGarbage.versionCode, 130);
});

test('清单解析：缺 sha256、坏 sha256、非 https apkUrl、坏 JSON 都是无效清单', () => {
  assert.throws(() => parseUpdateManifest(body({ sha256: '' })), /缺少安装包校验值/);
  assert.throws(() => parseUpdateManifest(body({ sha256: 'abc' })), /缺少安装包校验值/);
  assert.throws(() => parseUpdateManifest('{"versionCode":130}'), /缺少安装包校验值|不完整/);
  assert.throws(() => parseUpdateManifest(body({ apkUrl: 'http://example.com/a.apk' })), /https/);
  assert.throws(() => parseUpdateManifest('not json'), /格式不正确/);
  const parsed = parseUpdateManifest(body({ sha256: SHA.toUpperCase() }));
  assert.equal(parsed.sha256, SHA);
});

test('下载前就必须有 sha256，校验失败不能当成没填', async () => {
  await assert.rejects(
    () => downloadUpdate({ apkUrl: 'https://example.com/a.apk', versionCode: 130, versionName: '1.1.29' }),
    /缺少安装包校验值/
  );
  await assert.rejects(
    () => downloadUpdate({ apkUrl: 'http://example.com/a.apk', sha256: SHA }),
    /更新地址必须是 https/
  );
  assert.throws(() => assertApkSha256(SHA, ''), /校验不通过/);
  assert.throws(() => assertApkSha256('', SHA), /校验不通过/);
  assert.throws(() => assertApkSha256(SHA, 'cd'.repeat(32)), /校验不通过/);
  assert.doesNotThrow(() => assertApkSha256(SHA.toUpperCase(), SHA));
});
