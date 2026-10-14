import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../views/calendar.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

test('Calendar keeps the real archive controls and state-derived content', () => {
  for (const id of ['journal-history', 'new-session', 'prev', 'next', 'write', 'gen-day-summary', 'day-ledger-go']) {
    assert.match(source, new RegExp(`id="${id}"|#${id}`));
  }
  assert.match(source, /data-day="\$\{day\}"/);
  assert.match(source, /activityForDate\(state, day\)/);
  assert.match(source, /photosForDay\(day\)/);
  assert.match(source, /mediaForDay\(day\)/);
  assert.match(source, /data-view-day-media/);
  assert.match(source, /callHelper\('openSnippetVideos'/);
  assert.match(source, /day-video-thumb/);
  assert.match(source, /todayCompletion\(state, day\)/);
});

test('Calendar keeps a user-triggered regenerate action after a daily summary exists', () => {
  assert.match(source, /class="day-summary-card"/);
  assert.match(source, /id="gen-day-summary" data-regenerate="true"/);
  assert.match(source, /\{ explicit: true, date: selected, force \}/);
  assert.match(css, /\.calendar-view \.day-summary-card\{/);
  assert.match(css, /calendar-ai-summary-paper-v1\.png/);
});

test('Calendar activity chronicle includes real quick photos and opens all photos in that record', () => {
  assert.match(source, /filter\(event => !\['journal', 'habit'\]\.includes\(event\.kind\)\)/);
  assert.match(source, /photo: \{ icon: 'photo_camera', tone: 'ochre', label: '随手拍' \}/);
  assert.match(appSource, /snippet\?\.photos\?\.length \? snippet\.photos/);
  assert.match(appSource, /return photoViewer\(photos, 0\)/);
  assert.match(css, /calendar-view \.cal-photo-paper\{min-height:118px/);
  assert.match(css, /calendar-view \.day-photo-thumb\{width:112px;height:90px/);
});

test('Calendar follows the reference paper hierarchy without a screenshot fixture', () => {
  assert.match(source, /class="calendar-month-paper"/);
  assert.match(source, /class="stream-sheet cal-day-sheet"/);
  assert.match(source, /class="cal-photo-paper"/);
  assert.match(css, /Calendar reference lock/);
  assert.match(css, /calendar-view\.cal-screen \.cal-detail-head[^}]*min-height:59px/);
  assert.match(css, /calendar-view\.cal-screen \.cal-cell\.active/);
  assert.match(css, /today-bento-paper-thick\.png/);
  assert.match(css, /today-actions-paper-thick\.png/);
  assert.doesNotMatch(source, /calendar-(?:source|reference|fixture)|previewCalendar/);
  assert.doesNotMatch(css, /calendar-(?:source|reference|fixture)\.(?:png|jpg|webp)/);
});

test('Calendar write action uses a real icon and preserves Journal routing', () => {
  assert.match(source, /class="material-symbols-outlined">edit_note<\/span>/);
  assert.match(source, /function openJournalForSelectedDay/);
  assert.match(source, /callHelper\('setJournalEditingDay', day\)/);
  assert.match(source, /go\('journal'\)/);
  assert.match(source, /#write.*openJournalForSelectedDay/s);
  assert.doesNotMatch(source, /✏️|📅|📷/);
});

test('Calendar Dock selected paper follows the actual active route', () => {
  assert.match(css, /phone-shell:has\(\.calendar-view\) \.dock-btn\.active/);
  assert.match(css, /today-dock-active-paper\.png/);
  assert.match(css, /phone-shell:has\(\.calendar-view\) \.floating-dock/);
});

test('Calendar journal actions stay inside the paper as a quiet text toolbar', () => {
  const finalCss = css.slice(css.indexOf('/* Calendar / Moments 卡片操作区'));
  assert.match(finalCss, /\.calendar-view \.cal-journal-card\{[\s\S]*?overflow:hidden/);
  assert.match(finalCss, /\.calendar-view \.cal-journal-card \.row-actions\{[\s\S]*?max-width:100%[\s\S]*?border-top:1px dashed/);
  assert.match(finalCss, /\.calendar-view \.cal-journal-card \.row-actions button\{[\s\S]*?border-radius:0[\s\S]*?background:transparent/);
});
