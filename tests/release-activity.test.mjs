// 版本更新动态（release-activity）回归：
// - 入库：登记表里 ≤ 当前版本、还没存过的条目，启动时各存一条，落在登记表的真实发布时刻（北京时间，含时分）；
// - 归位：已写过的条目按登记表同步文案、纠正日期和时分（早期误写到更新当天、或写成中午 12:00 的会改回去）；
// - 幂等：以 state.releases 里是否已有该 code 为准，同一版本绝不写第二次，已有记录不删；
// - 生活流：只钉 lastSeen 落后时「刚升级到的当前版本」，历史发布日不再各刷一张卡；
// - 字段完整性：字符串字段过一遍 normalize 后不许损坏（启动链路多道迁移）；
// - 登记表纪律：当前 versionCode 必须有说明条目，引用的演示图必须真实存在。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { makeRelease, migrateState, defaults, formatShanghaiClock, formatShanghaiDateTime } = await import(pathToFileURL(join(root, 'model.js')));
const { RELEASE_NOTES } = await import(pathToFileURL(join(root, 'release-notes.js')));
const { ensureReleaseActivities, releaseInstant } = await import(pathToFileURL(join(root, 'release-activity.js')));
const { activityForDate } = await import(pathToFileURL(join(root, 'activity-log.js')));
const storage = await import(pathToFileURL(join(root, 'storage.js')));

const releaseEvents = (state, date) => activityForDate(state, date).filter(event => event.kind === 'release');

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
    assert.match(notes.time || '', /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/, `${code} 缺真实发布时间（HH:mm:ss，北京时间）`);
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

test('登记的时分是北京时间，并且随版本严格变晚', () => {
  const codes = registryCodes();
  let previous = 0;
  for (const code of codes) {
    const notes = RELEASE_NOTES[code];
    const instant = releaseInstant(notes);
    const shifted = new Date(instant + 8 * 3600000);
    const pad = value => String(value).padStart(2, '0');
    const day = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
    assert.equal(day, notes.date, `${code} 的时分换回北京时间后不在发布日上`);
    assert.equal(formatShanghaiClock(instant), notes.time.slice(0, 5), `${code} 展示时分和登记不一致`);
    assert.ok(instant > previous, `${code} 的更新时间没有晚于上一版`);
    previous = instant;
  }
  assert.equal(formatShanghaiDateTime(releaseInstant(RELEASE_NOTES[108])), '2026年10月11日 · 19:06');
  assert.equal(formatShanghaiClock(releaseInstant(RELEASE_NOTES[106])), '00:04');
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
    settings: { timelineReleaseCode: 110, timelineReleaseDate: '2026-10-11', timelineReleaseAt: 123 },
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
  assert.equal(twice.settings.timelineReleaseCode, 110);
  assert.equal(twice.settings.timelineReleaseDate, '2026-10-11');
  assert.equal(twice.settings.timelineReleaseAt, 123);
});

test('全新用户：一次补齐登记表里所有 ≤ 当前版本的说明，各落在真实发布日', () => {
  const codes = registryCodes();
  const newest = codes[codes.length - 1];
  const state = { settings: {}, releases: [] };
  const created = ensureReleaseActivities(state, newest, Date.parse('2026-10-11T00:30:00'));
  assert.equal(created, codes.length);
  assert.deepEqual(state.releases.map(release => release.code), codes);
  for (const release of state.releases) {
    const notes = RELEASE_NOTES[release.code];
    assert.equal(release.date, notes.date, `${release.code} 没落在登记表的日期上`);
    assert.equal(release.createdAt, releaseInstant(notes), `${release.code} 的时间戳不是登记的时分`);
    assert.equal(release.versionName, notes.name);
  }
  assert.equal(state.settings.lastSeenReleaseCode, newest);
  assert.equal(state.settings.timelineReleaseCode, newest);
  assert.equal(state.settings.timelineReleaseDate, '2026-10-11');
  assert.equal(releaseEvents(state, '2026-10-11').map(event => event.sourceId).join(','), String(newest));
  assert.equal(releaseEvents(state, '2026-10-09').length, 0, '历史发布日不再刷出更新卡片');
  assert.equal(releaseEvents(state, '2026-10-10').length, 0);
});

test('老用户：只补缺的；误写的日期归位回登记表；文案按登记表同步', () => {
  const codes = registryCodes();
  const newest = codes[codes.length - 1];
  const state = {
    settings: { lastSeenReleaseCode: newest },
    releases: [
      // 103 是早期误写到「更新当天」的：日期错、标题旧 —— 都应被登记表纠正
      { code: 103, versionName: '1.1.2', title: '旧标题', summary: '旧摘要', bullets: [], screenshots: [], date: '2026-10-11', createdAt: Date.parse('2026-10-11T00:20:00') },
      // 105 日期对，但时间被写成了中午：要改成登记表里的真实时分
      { code: 105, versionName: '1.1.4', title: '更新动态上线', summary: 's', bullets: [], screenshots: [], date: '2026-10-10', createdAt: Date.parse('2026-10-10T12:00:00') }
    ]
  };
  const created = ensureReleaseActivities(state, newest, Date.parse('2026-10-11T00:30:00'));
  assert.equal(created, codes.length - 2, '只补缺的版本');
  const entry103 = state.releases.find(release => release.code === 103);
  assert.equal(entry103.date, RELEASE_NOTES[103].date, '误写的日期归位');
  assert.equal(entry103.createdAt, releaseInstant(RELEASE_NOTES[103]), '归位时时间戳落到登记的时分');
  assert.equal(entry103.title, RELEASE_NOTES[103].title, '文案按登记表同步');
  assert.equal(entry103.versionName, RELEASE_NOTES[103].name, '版本号不能在同步时被清空');
  const entry105 = state.releases.find(release => release.code === 105);
  assert.equal(entry105.createdAt, releaseInstant(RELEASE_NOTES[105]), '日期没变也要把中午 12:00 改成真实时分');
  assert.notEqual(entry105.createdAt, Date.parse('2026-10-10T12:00:00+08:00'));
  // 再跑一遍：一条都不多，日期不再变化
  assert.equal(ensureReleaseActivities(state, newest, Date.parse('2026-10-11T00:40:00')), 0);
  assert.equal(state.releases.length, codes.length);
  assert.equal(state.settings.timelineReleaseDate || '', '', '已经看过当前版本时，不再往生活流补历史卡');
  assert.equal(releaseEvents(state, '2026-10-09').length, 0);
  assert.equal(releaseEvents(state, '2026-10-10').length, 0);
  assert.equal(releaseEvents(state, '2026-10-11').length, 0);
});

test('低版本只补到该版本为止（登记表里更新的条目不出现）', () => {
  const state = { settings: {}, releases: [] };
  const oldest = registryCodes()[0];
  ensureReleaseActivities(state, oldest, 4000000);
  assert.deepEqual(state.releases.map(release => release.code), [oldest]);
  assert.equal(state.releases[0].date, RELEASE_NOTES[oldest].date);
});

test('更新清单记下北京时间的时分，检查更新弹层能显示出来', () => {
  const script = readFileSync(join(root, 'scripts/make-update-manifest.mjs'), 'utf8');
  const mine = readFileSync(join(root, 'views/mine.js'), 'utf8');
  const today = readFileSync(join(root, 'views/today.js'), 'utf8');
  const common = readFileSync(join(root, 'views/common.js'), 'utf8');
  assert.match(script, /function shanghaiPublishedAt/);
  assert.match(script, /\+08:00/);
  assert.doesNotMatch(script, /toISOString\(\)\.slice\(0,\s*10\)/);
  assert.match(mine, /formatShanghaiDateTime\(parsed\)/);
  assert.match(common, /formatShanghaiDateTime\(release\.createdAt\)/);
  assert.match(today, /formatShanghaiClock\(item\.time\)/);
});

test('跨版本升级只把当前版本钉进升级当天，历史说明仍全部保留', () => {
  const codes = registryCodes();
  const oldest = codes[0];
  const newest = codes[codes.length - 1];
  const now = Date.parse('2026-10-12T09:30:00');
  const state = {
    settings: { lastSeenReleaseCode: oldest },
    releases: [{ code: 999, versionName: 'keep', title: '用户侧保留条目', summary: '不要删', bullets: [], screenshots: [], date: '2026-01-01', createdAt: 1 }]
  };
  const created = ensureReleaseActivities(state, newest, now);
  assert.equal(created, codes.length, '登记表里缺的版本全部入库；999 不在登记表里，不占用这次计数');
  assert.ok(state.releases.some(release => release.code === 999 && release.title === '用户侧保留条目'));
  assert.equal(state.releases.filter(release => codes.includes(release.code)).length, codes.length);
  assert.equal(state.settings.timelineReleaseCode, newest);
  assert.equal(state.settings.timelineReleaseDate, '2026-10-12');
  assert.equal(state.settings.timelineReleaseAt, now);
  assert.deepEqual(releaseEvents(state, '2026-10-12').map(event => Number(event.sourceId)), [newest]);
  assert.equal(releaseEvents(state, RELEASE_NOTES[oldest].date).length, 0);
  const pinnedAt = state.settings.timelineReleaseAt;
  assert.equal(ensureReleaseActivities(state, newest, Date.parse('2026-10-13T08:00:00')), 0);
  assert.equal(state.settings.timelineReleaseAt, pinnedAt, '再次打开不把钉选挪到新的一天');
  assert.equal(state.settings.timelineReleaseDate, '2026-10-12');
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
