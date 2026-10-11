import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../views/timetable.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('Timetable subpage remains driven by the editable local semester schedule', () => {
  assert.match(source, /const timetable = \(\) => state\.settings\.timetable/);
  assert.match(source, /const entries = \(\) => timetable\(\)\.courses/);
  assert.match(source, /teachingWeek\(today, timetable\(\)\)/);
  assert.match(source, /coursesFor\(today, entries\(\), schedule\)/);
  assert.match(source, /weekDate\(week, activeDay, schedule\)/);
  assert.doesNotMatch(source, /referenceFixture|demoSchedule|previewCourse/);
});

test('Timetable preserves week day and course editing interactions', () => {
  for (const id of ['course-prev','course-next','course-edit','course-add','course-settings','course-periods','course-practice']) assert.match(source, new RegExp(`id="${id}"|#${id}`));
  assert.match(source, /data-course-day="\$\{day\}"/);
  assert.match(source, /data-course="\$\{item\.id\}"/);
  assert.match(source, /data-subpage-close/);
  assert.match(source, /async function replaceTimetable/);
  assert.match(source, /await save\(\); if \(close\) closeModal\(\); render\(\); paint\(\)/);
  assert.match(source, /state\.settings\.timetable = previous/);
});

test('Timetable can create delete and schedule courses periods semesters and practice weeks', () => {
  assert.match(source, /function courseForm/);
  assert.match(source, /function semesterForm/);
  assert.match(source, /function periodManager/);
  assert.match(source, /function practiceManager/);
  assert.match(source, /function weeksFromForm/);
  for (const mode of ['all','odd','even','range','custom']) assert.match(source, new RegExp(`value="${mode}"`));
  assert.match(source, /course-delete/);
  assert.match(source, /period-delete/);
  assert.match(source, /至少需要保留一个节次时间段/);
  assert.match(source, /practice-delete/);
  assert.match(source, /previousStart !== startPeriod/);
  assert.match(css, /course-day-tabs[^}]*grid-template-columns:repeat\(7/);
  assert.match(css, /course-manage-bar/);
});

test('Today course summary promotes the next course name and classroom', () => {
  assert.match(source, /class="course-home-name">\$\{esc\(featured\.name\)\}/);
  assert.match(source, /class="course-home-room">[\s\S]*?\$\{esc\(featured\.room \|\| '教室待定'\)\}/);
  assert.match(css, /\.today-view \.course-home-name\{[^}]*font-size:12\.5px/);
  assert.match(css, /\.today-view \.course-home-room\{[^}]*font-size:10px/);
});

test('Timetable uses live HTML on independent paper assets', () => {
  const courseCss = css.slice(css.indexOf('/* Timetable 二级页 1:1 画报复刻'));
  assert.match(source, /class="subpage-nav-title"><b>课程表<\/b><small>Class Schedule<\/small>/);
  assert.match(courseCss, /course-hero[^}]*background-color:#174536/);
  assert.match(courseCss, /course-day-tab[^}]*today-actions-paper-thick\.png/);
  assert.match(courseCss, /course-agenda[^}]*today-bento-paper-thick\.png/);
  assert.match(courseCss, /course-row[^}]*today-actions-paper-thick\.png/);
  assert.match(courseCss, /timetable-campus-collage\.png/);
  assert.doesNotMatch(courseCss, /timetable-(?:source|reference|fixture)\.(?:png|jpg|webp)/);
});

test('Timetable keeps the selected visual hierarchy at compact and wide phone sizes', () => {
  const courseCss = css.slice(css.indexOf('/* Timetable 二级页 1:1 画报复刻'));
  assert.match(courseCss, /#subpage-timetable\{\s*padding-top:var\(--app-safe-top\)/);
  assert.match(courseCss, /course-subpage-nav\{[^}]*height:86px/);
  assert.match(courseCss, /course-hero[^}]*min-height:132px/);
  assert.match(courseCss, /course-row[^}]*min-height:59px/);
  assert.match(courseCss, /@media\(min-width:480px\)/);
  assert.match(courseCss, /course-row\{min-height:79px/);
  assert.match(courseCss, /min-width:480px\)[\s\S]*?course-subpage-nav\{height:116px/);
});
