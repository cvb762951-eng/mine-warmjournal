import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const analytics = await readFile(new URL('../analytics.js', import.meta.url), 'utf8');
const statsView = await readFile(new URL('../views/stats.js', import.meta.url), 'utf8');

/**
 * 习惯统计重做（2026-10-20）
 *
 * 用户反馈「习惯功能用起来很难受」。诊断出三个真实逻辑缺陷：
 *   1. 周目标习惯被按天算分母 → 设「每周 3 次」，做满 3 次仍显示 43% 未达标
 *   2. 连续天数要求所有习惯同时达标 → 漏一次喝水就让运动归零，长期显示「连续 0 天」
 *   3. 主动标的休息日计入分母 → 明明休息了分数反而变差
 *
 * 这些断言锁住修复后的口径，防止重构时改回去。
 */

test('周目标习惯按周统计，不按天', () => {
  // habitArchiveMetrics 必须区分 isWeekly，周目标的分母是「周数」不是「天数」
  assert.match(analytics, /const isWeekly = habit\.goalPeriod === 'weekly'/, '必须识别周目标习惯');
  assert.match(analytics, /rateDenominator = isWeekly \? weeks : plannedForRate\.length/, '周目标的分母应为周数');
  assert.match(analytics, /rateNumerator = isWeekly \? metWeeks : completedForRate\.length/, '周目标的分子应为达标周数');
  assert.match(analytics, /const weekKeyOf = day =>/, '需要按自然周折叠');

  // warmWeeklyLifeMetrics 的 perHabit 也要按周
  assert.match(analytics, /if \(habit\.goalPeriod === 'weekly'\) \{[\s\S]{0,320}?rate: weekProgress\?\.met \? 100 : 0/, '周报里周目标应为 0/100 而不是按天累加');
});

test('连续天数按单个习惯独立计算', () => {
  // 必须提供单习惯的连续天数函数
  assert.match(analytics, /export function habitStreak/, '需要单习惯连续天数函数');
  // 周报取「各习惯里最好的那个」，而不是要求全部习惯同时达标
  assert.match(analytics, /currentStreak = perHabit\.reduce\(\(best, item\) => Math\.max\(best, item\.streak\.current\), 0\)/,
    '连续天数应取各习惯最好成绩，而不是全部达标');
  assert.match(analytics, /longestStreak = perHabit\.reduce\(\(best, item\) => Math\.max\(best, item\.streak\.longest\), 0\)/,
    '最长连续应取各习惯最好成绩');
  // 旧的「done === total 才算连续」逻辑必须消失
  assert.doesNotMatch(analytics, /item\.done === item\.total \? run \+ 1 : 0/, '旧的绑定式连续逻辑应已移除');
});

test('休息日不进分母', () => {
  assert.match(analytics, /export function habitRestDay/, '需要休息日判定函数');
  assert.match(analytics, /const plannedForRate = isWeekly \? planned : planned\.filter\(item => !habitRestDay/, '休息日必须从分母中剔除');
  // 连续天数里休息日既不累加也不打断
  assert.match(analytics, /if \(habitRestDay\(state, habitId, day\)\) continue;/, '休息日应跳过，不打断连续');
});

test('界面不再显示混合所有习惯的单一百分比', () => {
  // KPI 卡改为「几个习惯达标」+ 逐个列出
  assert.match(statsView, /const habitMetCount = habitList\.filter\(item => item\.met\)\.length/, '应统计达标的习惯个数');
  assert.match(statsView, /habitMetCount === habitList\.length \? '全部达标'/, '徽章应说「全部达标」这类人话');
  assert.doesNotMatch(statsView, /<strong>\$\{habits\.completionRate\}%<\/strong>/, '不应再把混合百分比当主数字');
  // 习惯档案页：周目标显示「本周 n/target 次」，日目标显示「做到/计划 天」
  assert.match(statsView, /metrics\.isWeekly/, '档案页应区分周/日目标');
  assert.match(statsView, /'本周次数'/, '周目标应显示本周次数');
  assert.match(statsView, /`做到 \/ 计划（天）/, '日目标应显示做到/计划天数');
});

test('原始每日判定语义未被破坏', () => {
  // habitGoalMet 是「今天做没做到」的语义，今日页/日历/日记都在用，不能动。
  assert.doesNotMatch(analytics, /export function habitGoalMet/, '判定函数必须留在 model.js');
  // 新增函数不应写 state（统计必须是纯读取）
  assert.doesNotMatch(analytics, /export function habitStreak[\s\S]{0,900}?state\.[a-zA-Z]+ =/, '统计函数不得修改 state');
  assert.doesNotMatch(analytics, /export function habitWeekProgress[\s\S]{0,600}?state\.[a-zA-Z]+ =/, '统计函数不得修改 state');
});