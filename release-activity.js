// 版本更新动态：升级那天打开 App，「当天活动」（Life Stream）里自动出现一条带说明
// 和演示图的「更新」动态。数据写在 state.releases（持久化分区），时间轴由
// activity-log.js 的 rebuildActivityLog 统一吐出。
import { APP_VERSION_CODE } from './app-updater.js';
import { dateKey, makeRelease } from './model.js';
import { RELEASE_NOTES } from './release-notes.js';

// 登记表里的 date 是发布日，time 是同一时刻的北京时间（HH:mm 或 HH:mm:ss）。
// 时分按 Asia/Shanghai（固定 UTC+8）换成时间戳，不跟运行环境的本地时区走。
// 没写 time 的旧条目才退回当天 12:00（+08:00）。
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

export function releaseInstant(notes = {}) {
  const date = String(notes.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  const raw = String(notes.time || '').trim();
  const clock = CLOCK.test(raw) ? (raw.length === 5 ? `${raw}:00` : raw) : '12:00:00';
  return Date.parse(`${date}T${clock}+08:00`) || 0;
}

// 启动时调用：把登记表里 ≤ 当前版本、还没写过动态的版本各补一条（落在登记表给的
// 真实发布时刻）；已写过的条目按登记表同步文案，并把时间纠正到登记的时分（幂等）。
// settings.lastSeenReleaseCode 只作记录，不参与判断。
export function ensureReleaseActivities(state, currentCode = APP_VERSION_CODE, now = Date.now()) {
  state.settings = state.settings || {};
  state.releases = Array.isArray(state.releases) ? state.releases : [];
  const current = Math.max(1, Math.floor(Number(currentCode)) || 0);
  let created = 0;
  for (const key of Object.keys(RELEASE_NOTES)) {
    const code = Number(key);
    if (code > current) continue;
    const notes = RELEASE_NOTES[key];
    const existing = state.releases.find(release => Number(release.code) === code);
    if (existing) {
      const nextDate = notes.date || existing.date;
      const needsRelocate = Boolean(notes.date && existing.date !== notes.date);
      // 登记了时分就以它为准，连以前写成中午 12:00 的条目一起改掉。
      // 只有「日期已经对、又没登记时分」时，才保留设备上原来的 createdAt。
      const createdAt = notes.time
        ? releaseInstant({ date: nextDate, time: notes.time })
        : (needsRelocate ? releaseInstant({ date: nextDate }) : existing.createdAt);
      Object.assign(existing, makeRelease({
        ...notes,
        code,
        versionName: notes.name,
        date: nextDate,
        createdAt
      }));
      continue;
    }
    const fallbackDate = dateKey(new Date(now + created));
    const date = notes.date || fallbackDate;
    state.releases.push(makeRelease({
      code,
      versionName: notes.name,
      title: notes.title,
      summary: notes.summary,
      bullets: notes.bullets,
      screenshots: notes.screenshots,
      date,
      createdAt: notes.date ? releaseInstant(notes) : now + created
    }));
    created++;
  }
  state.releases.sort((a, b) => Number(a.code) - Number(b.code));
  state.settings.lastSeenReleaseCode = Math.max(Number(state.settings.lastSeenReleaseCode) || 0, current);
  return created;
}
