import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../views/stats.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('Statistics renders every active habit instead of selecting one preferred habit', () => {
  // 统计页 V1.0.54 重做后变量名从 archiveHabits 改为 habits（功能拆成 habitSheet），
  // 但行为契约不变：所有未归档习惯都要出现在统计页，且都可点进各自档案。
  assert.match(source, /const habits = \(state\.habits \|\| \[\]\)\.filter\(habit => !habit\.archived\)/);
  assert.match(source, /habitSheet\(habits, metrics\)/);
  assert.match(source, /habits\.map\(habit => \{[\s\S]{0,900}?data-habit-detail=/, '每个习惯都应可点进各自档案');
  // 2026-10-20 重做：习惯行右侧新增本周期进度条
  assert.match(source, /stats-habit-progress/, '习惯行应显示本周期进度');
  assert.match(source, /`\$\{stat\.done\}\/\$\{stat\.target\} 次`/, '周目标应显示「做了几次/要几次」');
  assert.doesNotMatch(source, /function preferredHabit/);
});

test('Habit detail provides an in-page switch for every non-archived habit', () => {
  assert.match(source, /class="habit-detail-switcher"/);
  assert.match(source, /data-habit-switch="\$\{item\.id\}"/);
  // 切换态同时用 class 和 aria-pressed 表达（V1.0.54 补上 aria-pressed，兼顾可访问性）
  assert.match(source, /class="habit-switch-chip \$\{item\.id === habit\.id \? 'active' : ''\}"/);
  assert.match(source, /aria-pressed="\$\{item\.id === habit\.id\}"/);
  assert.match(source, /\$\$\('\[data-habit-switch\]'\)\.forEach/);
  assert.match(styles, /\.habit-detail-switcher\{[^}]*overflow-x:auto[^}]*scrollbar-width:none/);
  assert.match(styles, /\.habit-detail-switcher>button\.active\{[^}]*quick-control-sage-v1\.png/);
});

test('Each archive still derives independent heatmap and archive metrics from its habit id', () => {
  assert.match(source, /callHelper\('habitHeatmapData', habit\.id, habitHeatmapYear\)/);
  assert.match(source, /habitArchiveMetrics\(state, habit\.id, habitHeatmapYear, heatmap\)/);
  assert.match(source, /if \(activeHabitId\) openHabitDetail\(activeHabitId\)/);
});
