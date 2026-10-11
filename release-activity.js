// 版本更新动态：升级那天打开 App，「当天活动」（Life Stream）里自动出现一条带说明
// 和演示图的「更新」动态。数据写在 state.releases（持久化分区），时间轴由
// activity-log.js 的 rebuildActivityLog 统一吐出。
import { APP_VERSION_CODE } from './app-updater.js';
import { dateKey, makeRelease } from './model.js';
import { RELEASE_NOTES } from './release-notes.js';

// 登记表里的 date 是该版本的真实发布日 —— 动态落位到那一天的 Life Stream。
const registryTimestamp = date => Date.parse(`${date}T12:00:00`) || 0;

// 启动时调用：把登记表里 ≤ 当前版本、还没写过动态的版本各补一条（落在登记表给的
// 真实发布日）；已写过的条目按登记表同步文案、纠正日期（幂等，随便跑）。
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
      // 登记表是唯一事实来源：文案同步；日期不一致（比如早期误写到更新当天）就归位。
      const needsRelocate = Boolean(notes.date && existing.date !== notes.date);
      Object.assign(existing, makeRelease({ ...notes, code, date: notes.date || existing.date, createdAt: existing.createdAt }));
      if (needsRelocate) existing.createdAt = registryTimestamp(notes.date);
      continue;
    }
    const fallbackDate = dateKey(new Date(now + created));
    state.releases.push(makeRelease({
      code,
      versionName: notes.name,
      title: notes.title,
      summary: notes.summary,
      bullets: notes.bullets,
      screenshots: notes.screenshots,
      date: notes.date || fallbackDate,
      createdAt: notes.date ? registryTimestamp(notes.date) : now + created
    }));
    created++;
  }
  state.releases.sort((a, b) => Number(a.code) - Number(b.code));
  state.settings.lastSeenReleaseCode = Math.max(Number(state.settings.lastSeenReleaseCode) || 0, current);
  return created;
}
