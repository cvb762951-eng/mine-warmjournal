import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { daysUntil, makeCountdown } from '../model.js';
import {
  civilFromDays,
  countdownDaysUntil,
  countdownWidgetCopy,
  countdownWidgetSnapshot,
  countdownWidgetTheme,
  daysFromCivil,
  leapMonth,
  lunarToSolar,
  nearestCountdown,
  resolveCountdownDate,
  solarToLunar
} from '../countdown-days.js';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const today = new Date(2026, 9, 14, 12, 0, 0);

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} … ${end} 应该成对出现`);
  return source.slice(from, to);
}

test('plain dates stay identical to daysUntil, including invalid overflow', () => {
  const samples = ['2026-10-14', '2026-10-15', '2026-10-13', '2026-12-25', '2027-01-01', '2024-02-29', '2023-02-29', '2020-01-01', '1999-12-31'];
  for (const date of samples) {
    assert.equal(countdownDaysUntil({ date }, today), daysUntil(date, today), date);
    assert.equal(countdownDaysUntil(date, today), daysUntil(date, today), date);
  }
  assert.equal(daysFromCivil(1970, 1, 1), 0);
  assert.equal(daysFromCivil(2026, 10, 14), 20740);
  assert.equal(daysFromCivil(1900, 1, 31), -25537);
  assert.deepEqual(civilFromDays(0), { y: 1970, m: 1, d: 1 });
  assert.equal(countdownDaysUntil({ date: '2023-13-01' }, today), 0);
  assert.equal(countdownDaysUntil({ date: '2023-13-01', repeat: 'yearly' }, today), 0);
  assert.equal(countdownDaysUntil({ date: '' }, today), 0);
});

test('yearly solar, lunar and leap anniversaries match the shared vectors', () => {
  assert.equal(resolveCountdownDate({ date: '2000-12-25', repeat: 'yearly' }, today), '2026-12-25');
  assert.equal(countdownDaysUntil({ date: '2000-12-25', repeat: 'yearly' }, today), 72);
  assert.equal(countdownDaysUntil({ date: '2000-01-01', repeat: 'yearly' }, today), 79);
  assert.equal(countdownDaysUntil({ date: '2000-10-14', repeat: 'yearly' }, today), 0);
  assert.equal(countdownDaysUntil({ date: '2000-10-13', repeat: 'yearly' }, today), 364);
  assert.equal(resolveCountdownDate({ date: '2024-02-29', repeat: 'yearly' }, today), '2027-02-28');
  assert.equal(countdownDaysUntil({ date: '2024-02-29', repeat: 'yearly' }, today), 137);
  assert.equal(resolveCountdownDate({ date: '2024-02-10', repeat: 'yearly', lunar: true }, today), '2027-02-06');
  assert.equal(countdownDaysUntil({ date: '2024-02-10', repeat: 'yearly', lunar: true }, today), 115);
  assert.equal(countdownDaysUntil({ date: '2024-02-10', lunar: true }, today), daysUntil('2024-02-10', today));
  assert.equal(countdownDaysUntil({ date: '1995-06-18', repeat: 'yearly', lunar: true, lunarMonth: 5, lunarDay: 1 }, today), 234);
  assert.equal(resolveCountdownDate({ date: '2020-05-23', repeat: 'yearly', lunar: true, lunarMonth: 4, lunarDay: 1, lunarLeap: true }, today), '2058-05-22');
  assert.equal(countdownDaysUntil({ date: '2020-05-23', repeat: 'yearly', lunar: true, lunarMonth: 4, lunarDay: 1, lunarLeap: true }, today), 11543);
});

test('lunar new years and leap months round-trip back to the solar date', () => {
  const known = [
    [2024, 2, 10, 2024, 1, 1, false],
    [2025, 1, 29, 2025, 1, 1, false],
    [2026, 2, 17, 2026, 1, 1, false],
    [2023, 1, 22, 2023, 1, 1, false],
    [1987, 11, 1, 1987, 9, 10, false]
  ];
  for (const [year, month, day, lunarYear, lunarMonth, lunarDay, leap] of known) {
    const lunar = solarToLunar(year, month, day);
    assert.deepEqual([lunar.year, lunar.month, lunar.day, lunar.isLeap], [lunarYear, lunarMonth, lunarDay, leap]);
  }
  assert.equal(leapMonth(2020), 4);
  assert.equal(leapMonth(2023), 2);
  assert.equal(leapMonth(2025), 6);
  assert.equal(leapMonth(1987), 6);
  for (let year = 2020; year <= 2032; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const length = new Date(year, month, 0).getDate();
      for (let day = 1; day <= length; day += 5) {
        const lunar = solarToLunar(year, month, day);
        const back = lunarToSolar(lunar.year, lunar.month, lunar.day, lunar.isLeap);
        assert.deepEqual(back, { y: year, m: month, d: day });
      }
    }
  }
});

test('widget snapshot keeps only title, date and day-calculation fields', () => {
  const snapshot = countdownWidgetSnapshot([
    {
      id: 'c1',
      title: '考研',
      date: '2027-12-18',
      note: '不能进小组件的备注',
      image: 'data:image/png;base64,SECRET',
      showOnHome: false,
      repeat: 'yearly',
      lunar: true,
      lunarMonth: 1,
      lunarDay: 1,
      lunarLeap: false
    },
    { id: '', title: '没 id', date: '2026-10-01' },
    { id: 'blank', title: '   ', date: '2026-10-01' }
  ], 'plain');
  assert.equal(snapshot.theme, 'plain');
  assert.equal(snapshot.items.length, 1);
  assert.deepEqual(snapshot.items[0], {
    id: 'c1',
    title: '考研',
    date: '2027-12-18',
    repeat: 'yearly',
    lunar: true,
    lunarMonth: 1,
    lunarDay: 1
  });
  const packed = JSON.stringify(snapshot);
  assert.equal(packed.includes('不能进小组件的备注'), false);
  assert.equal(packed.includes('SECRET'), false);
  assert.equal(packed.includes('showOnHome'), false);
  assert.equal(Object.hasOwn(snapshot, 'days'), false);
  assert.equal(Object.hasOwn(snapshot.items[0], 'days'), false);
  assert.equal(countdownWidgetTheme('nope'), 'classic');
  assert.equal(countdownWidgetTheme('dark'), 'dark');
});

test('existing countdowns do not grow repeat or lunar keys', () => {
  const plain = makeCountdown({ title: '旅行', date: '2026-11-01', note: '只留在 App 里' });
  assert.equal(Object.hasOwn(plain, 'repeat'), false);
  assert.equal(Object.hasOwn(plain, 'lunar'), false);
  assert.equal(plain.note, '只留在 App 里');
  const kept = makeCountdown({ title: '生日', date: '2024-02-10', repeat: 'yearly', lunar: true, lunarMonth: 1, lunarDay: 1, lunarLeap: true });
  assert.equal(kept.repeat, 'yearly');
  assert.equal(kept.lunar, true);
  assert.equal(kept.lunarMonth, 1);
  assert.equal(kept.lunarLeap, true);
});

test('nearest countdown prefers the soonest upcoming, then the closest past', () => {
  const items = [
    { id: 'later', title: '后', date: '2026-12-25' },
    { id: 'sooner', title: '近', date: '2026-10-20' },
    { id: 'past', title: '过', date: '2026-01-01' }
  ];
  assert.equal(nearestCountdown(items, today).id, 'sooner');
  assert.equal(nearestCountdown([
    { id: 'a', title: '甲', date: '2026-11-01' },
    { id: 'b', title: '乙', date: '2026-11-01' }
  ], today).id, 'a');
  assert.equal(nearestCountdown([
    { id: 'older', title: '更早', date: '2020-01-01' },
    { id: 'recent', title: '刚过', date: '2026-10-01' }
  ], today).id, 'recent');
  assert.equal(nearestCountdown([], today), null);
});

test('widget copy uses the same words the native side renders', () => {
  assert.deepEqual(countdownWidgetCopy(0), { number: '0', unit: '就是今天', label: '今天' });
  assert.deepEqual(countdownWidgetCopy(3), { number: '3', unit: '天后', label: '倒数日' });
  assert.deepEqual(countdownWidgetCopy(-2), { number: '2', unit: '天前', label: '已经过去' });
});

test('native day table, midnight alarm and widget contract stay aligned', async () => {
  const js = await read('countdown-days.js');
  const java = await read('android/app/src/main/java/com/mine/focus/CountdownDays.java');
  const jsTable = between(js, 'LUNAR_INFO_BEGIN', 'LUNAR_INFO_END').match(/0x[0-9a-f]+/g);
  const javaTable = between(java, 'LUNAR_INFO_BEGIN', 'LUNAR_INFO_END').match(/0x[0-9a-f]+/g);
  assert.deepEqual(javaTable, jsTable);
  assert.equal(jsTable.length, 201);

  const scheduler = await read('android/app/src/main/java/com/mine/focus/CountdownWidgetScheduler.java');
  assert.match(scheduler, /setAndAllowWhileIdle\(AlarmManager\.RTC_WAKEUP/);
  assert.doesNotMatch(scheduler, /setExact/);
  assert.match(scheduler, /Calendar\.SECOND, 5/);
  assert.match(scheduler, /Calendar\.HOUR_OF_DAY, 0/);
  assert.match(scheduler, /Calendar\.MINUTE, 0/);

  const info = await read('android/app/src/main/res/xml/countdown_widget_info.xml');
  assert.match(info, /android:updatePeriodMillis="0"/);
  assert.doesNotMatch(info, /1800000/);
  assert.match(info, /android:configure="com\.mine\.focus\.CountdownWidgetConfigActivity"/);
  assert.match(info, /android:widgetFeatures="reconfigurable"/);

  const manifest = await read('android/app/src/main/AndroidManifest.xml');
  for (const action of ['DATE_CHANGED', 'TIME_SET', 'TIMEZONE_CHANGED', 'BOOT_COMPLETED', 'COUNTDOWN_WIDGET_MIDNIGHT']) {
    assert.match(manifest, new RegExp(action));
  }

  const provider = await read('android/app/src/main/java/com/mine/focus/CountdownWidgetProvider.java');
  assert.match(provider, /putExtra\("route", "countdown"\)/);
  assert.match(provider, /putExtra\("id", countdownId\)/);
  assert.match(provider, /route=countdown&id=/);
  assert.match(provider, /CountdownWidgetTheme\.of/);

  const store = await read('android/app/src/main/java/com/mine/focus/CountdownWidgetStore.java');
  for (const key of ['"id"', '"title"', '"date"', '"repeat"', '"lunar"', '"lunarMonth"', '"lunarDay"', '"lunarLeap"']) {
    assert.match(store, new RegExp(key));
  }
  assert.doesNotMatch(store, /"note"/);
  assert.doesNotMatch(store, /"image"/);
  assert.doesNotMatch(store, /put\("days"/);

  const plugin = await read('android/app/src/main/java/com/mine/focus/TimerAlarmPlugin.java');
  assert.match(plugin, /consumeWidgetRoute/);
  assert.match(plugin, /CountdownWidgetStore\.sanitize/);
  assert.doesNotMatch(plugin, /putInt\("days"/);

  const activity = await read('android/app/src/main/java/com/mine/focus/MainActivity.java');
  assert.match(activity, /mine-widget-route/);
  assert.match(activity, /onNewIntent/);

  const countdown = await read('views/countdown.js');
  assert.match(countdown, /countdownWidgetSnapshot\(state\.countdowns, state\.settings\?\.theme\)/);
  assert.doesNotMatch(countdown, /days: Math\.abs/);
  assert.match(countdown, /export function openCountdownDetail/);

  const app = await read('app.js');
  assert.match(app, /mine-widget-route/);
  assert.match(app, /openCountdownDetail\(pending\.id \|\| ''\)/);

  const theme = await read('android/app/src/main/java/com/mine/focus/CountdownWidgetTheme.java');
  for (const name of ['classic', 'sunny', 'plain', 'dark']) {
    assert.match(theme, new RegExp(`countdown_widget_bg_${name}`));
    assert.match(theme, new RegExp(`countdown_widget_${name}_title`));
  }
  const colors = await read('android/app/src/main/res/values/colors.xml');
  assert.match(colors, /classic = 暖色纸/);
  assert.match(colors, /plain\s+= 清简/);
  assert.match(colors, /dark\s+= 深色/);
});
