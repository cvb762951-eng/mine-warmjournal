// 版本更新动态。登记表里的说明整份保存在 state.releases（「我的 → 更新记录」），
// 不删除、不回放历史版本。当天活动 / 日历只钉用户刚升级到的当前版本，落在升级当天。
// 时间轴由 activity-log.js 按 settings.timelineRelease* 吐出这一条。
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

// 启动时调用：登记表里 ≤ 当前版本、还没入库的说明仍各存一条（真实发布时刻），
// 已有条目按登记表同步文案和时分。这些记录只给「更新记录」列表，不进生活流。
// 生活流只在 lastSeenReleaseCode 落后于当前版本时，钉上刚升级到的这一版（升级当天）。
// 已看过当前版本的老数据不会被改写成一串历史卡片，已有 releases 一条都不删。
export function ensureReleaseActivities(state, currentCode = APP_VERSION_CODE, now = Date.now()) {
  state.settings = state.settings || {};
  state.releases = Array.isArray(state.releases) ? state.releases : [];
  const current = Math.max(1, Math.floor(Number(currentCode)) || 0);
  const previous = Math.max(0, Math.floor(Number(state.settings.lastSeenReleaseCode)) || 0);
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
  if (previous < current && RELEASE_NOTES[current]) {
    state.settings.timelineReleaseCode = current;
    state.settings.timelineReleaseDate = dateKey(new Date(now));
    state.settings.timelineReleaseAt = now;
  }
  state.settings.lastSeenReleaseCode = Math.max(previous, current);
  return created;
}
