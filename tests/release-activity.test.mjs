// 版本更新动态（release-activity）回归：
// - 补发：登记表里 ≤ 当前版本、还没写过的条目，启动时各补一条，落在登记表的真实发布日；
// - 归位：已写过的条目按登记表同步文案、纠正日期（早期误写到更新当天的会归回去）；
// - 幂等：以 state.releases 里是否已有该 code 为准，同一版本绝不写第二次；
// - 字段完整性：字符串字段过一遍 normalize 后不许损坏（启动链路多道迁移）；
// - 登记表纪律：当前 versionCode 必须有说明条目，引用的演示图必须真实存在。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { makeRelease, migrateState, defaults } = await import(pathToFileURL(join(root, 'model.js')));
const { RELEASE_NOTES } = await import(pathToFileURL(join(root, 'release-notes.js')));
const { ensureReleaseActivities } = await import(pathToFileURL(join(root, 'release-activity.js')));
const storage = await import(pathToFileURL(join(root, 'storage.js')));

const registryCodes = () => Object.keys(RELEASE_NOTES).map(Number).sort((a, b) => a - b);

test('releases 分区进了持久化白名单（第一大坑）', () => {
  assert.ok(storage.SECTIONS.includes('releases'));
});

test('登记表条目齐全：每个版本都有名称、日期、标题、摘要和清单', () => {
  const codes = registryCodes();
  assert.ok(codes.length >= 10, '历史版本说明应该已经批量登记');
  for (const code of codes) {
    const notes = RELEASE_NOTES[code];
    assert.ok(notes.name, `${code} 缺 versionName`);
    assert.match(notes.date || '', /^\d{4}-\d{2}-\d{2}$/, `${code} 缺真实发布日（YYYY-MM-DD）`);
    assert.ok(notes.title && notes.summary, `${code} 缺标题或摘要`);
    assert.ok(Array.isArray(notes.bullets) && notes.bullets.length >= 1, `${code} 缺改动清单`);
  }
});

test('登记表的日期随版本号单调不减（动态按天归位的前提）', () => {
  const codes = registryCodes();
  for (let i = 1; i < codes.length; i += 1) {
    const previous = RELEASE_NOTES[codes[i - 1]].date;
    const current = RELEASE_NOTES[codes[i]].date;
    assert.ok(previous <= current, `${codes[i]} 的日期（${current}）早于 ${codes[i - 1]}（${previous}）`);
  }
});

test('当前 versionCode 必须有说明条目（发版漏登记 = 更新后当天活动没内容）', () => {
  const gradle = readFileSync(join(root, 'android/app/build.gradle'), 'utf8');
  const match = gradle.match(/versionCode\s+(\d+)/);
  assert.ok(match, 'build.gradle 里能读到 versionCode');
  const current = Number(match[1]);
  assert.ok(RELEASE_NOTES[current], `RELEASE_NOTES 缺少当前版本 ${current} 的条目`);
});

test('说明里引用的演示图必须真实存在且单张 ≤250KB', () => {
  for (const [code, notes] of Object.entries(RELEASE_NOTES)) {
    for (const shot of notes.screenshots || []) {
      const stat = readFileSync(join(root, shot));
      assert.ok(stat.length > 1000, `${code} 的演示图 ${shot} 是空文件？`);
      assert.ok(stat.length <= 250 * 1024, `${code} 的演示图 ${shot} 超过 250KB（${stat.length} 字节）`);
    }
  }
});

test('启动链路（migrateState）不许损坏版本说明的字符串字段', () => {
  const raw = {
    releases: [{ code: 105, versionName: '1.1.4', title: '更新动态上线', summary: '测试摘要', bullets: ['第一条'], screenshots: ['assets/x.png'], date: '2026-10-10', createdAt: 123 }]
  };
  const once = migrateState(raw, defaults);
  assert.equal(once.releases[0].title, '更新动态上线');
  assert.equal(once.releases[0].versionName, '1.1.4');
  assert.equal(once.releases[0].summary, '测试摘要');
  assert.equal(once.releases[0].date, '2026-10-10');
  // 二次迁移（每次启动都会发生）也不许变
  const twice = migrateState({ releases: once.releases, settings: once.settings }, defaults);
  assert.equal(twice.releases[0].title, '更新动态上线');
});

test('全新用户：一次补齐登记表里所有 ≤ 当前版本的说明，各落在真实发布日', () => {
  const codes = registryCodes();
  const newest = codes[codes.length - 1];
  const state = { settings: {}, releases: [] };
  const created = ensureReleaseActivities(state, newest, Date.parse('2026-10-11T00:30:00'));
  assert.equal(created, codes.length);
  assert.deepEqual(state.releases.map(release => release.code), codes);
  for (const release of state.releases) {
    assert.equal(release.date, RELEASE_NOTES[release.code].date, `${release.code} 没落在登记表的日期上`);
  }
  // 早于今天发布的版本，时间戳取当天中午（展示时间稳定），不许跑到发布日之外
  for (const release of state.releases) {
    if (release.date < '2026-10-11') {
      assert.equal(release.createdAt, Date.parse(`${release.date}T12:00:00`));
    }
  }
  assert.equal(state.settings.lastSeenReleaseCode, newest);
});

test('老用户：只补缺的；误写的日期归位回登记表；文案按登记表同步', () => {
  const codes = registryCodes();
  const newest = codes[codes.length - 1];
  const state = {
    settings: { lastSeenReleaseCode: newest },
    releases: [
      // 103 是早期误写到「更新当天」的：日期错、标题旧 —— 都应被登记表纠正
      { code: 103, versionName: '1.1.2', title: '旧标题', summary: '旧摘要', bullets: [], screenshots: [], date: '2026-10-11', createdAt: Date.parse('2026-10-11T00:20:00') },
      // 105 日期本来就对：createdAt（真实时间）必须保留
      { code: 105, versionName: '1.1.4', title: '更新动态上线', summary: 's', bullets: [], screenshots: [], date: '2026-10-10', createdAt: 1791650000000 }
    ]
  };
  const created = ensureReleaseActivities(state, newest, Date.parse('2026-10-11T00:30:00'));
  assert.equal(created, codes.length - 2, '只补缺的版本');
  const entry103 = state.releases.find(release => release.code === 103);
  assert.equal(entry103.date, RELEASE_NOTES[103].date, '误写的日期归位');
  assert.equal(entry103.createdAt, Date.parse(`${RELEASE_NOTES[103].date}T12:00:00`), '归位时时间戳也落到当天');
  assert.equal(entry103.title, RELEASE_NOTES[103].title, '文案按登记表同步');
  const entry105 = state.releases.find(release => release.code === 105);
  assert.equal(entry105.createdAt, 1791650000000, '日期本来就对的条目不动时间戳');
  // 再跑一遍：一条都不多，日期不再变化
  assert.equal(ensureReleaseActivities(state, newest, Date.parse('2026-10-11T00:40:00')), 0);
  assert.equal(state.releases.length, codes.length);
});

test('低版本只补到该版本为止（登记表里更新的条目不出现）', () => {
  const state = { settings: {}, releases: [] };
  const oldest = registryCodes()[0];
  ensureReleaseActivities(state, oldest, 4000000);
  assert.deepEqual(state.releases.map(release => release.code), [oldest]);
  assert.equal(state.releases[0].date, RELEASE_NOTES[oldest].date);
});

test('makeRelease 会拦下脏数据：超长截断、非法日期清空、数组封顶', () => {
  const dirty = makeRelease({
    code: 1.9,
    versionName: 'x'.repeat(50),
    title: 'y'.repeat(100),
    bullets: Array.from({ length: 30 }, (_, i) => `b${i}`),
    screenshots: ['a', 'b', 'c', 'd', 'e'],
    date: 'not-a-date'
  });
  assert.equal(dirty.code, 1);
  assert.equal(dirty.versionName.length, 20);
  assert.equal(dirty.title.length, 60);
  assert.equal(dirty.bullets.length, 12);
  assert.equal(dirty.screenshots.length, 4);
  assert.equal(dirty.date, '');
});
