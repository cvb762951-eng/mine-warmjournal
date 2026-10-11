import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../views/stats.js', import.meta.url), 'utf8');
const perf = await readFile(new URL('../performance.css', import.meta.url), 'utf8');

/**
 * 统计页 V1.0.54：重做为暖色纸张画报风格。
 * 行为契约用数据层断言（真正跑 analytics 计算），样式契约用素材引用断言。
 */

test('统计页使用中文标题，不再有英文页面名', () => {
  // 重做前是 'Mine Analytics' / 'Weekly Review & Insights'
  assert.match(source, /periodTitle\(\)/, '应有中文周期标题函数');
  assert.doesNotMatch(source, /Mine Analytics|Weekly Review|Annual/, '不应再出现英文页面标题');
  assert.match(source, /'本周回顾'/, '周维度标题应为中文');
  assert.match(source, /'本月回顾'/, '月维度标题应为中文');
  assert.match(source, /'年度回顾'/, '年维度标题应为中文');
});

test('周期总结弹窗已中文化', () => {
  assert.doesNotMatch(source, /Cycle Summary/, '周期总结弹窗不应再是英文');
  assert.match(source, /export function reportModal/, '周期总结弹窗应保留');
  assert.match(source, /report-rank/, '弹窗应含分类占比');
});

test('统计页补齐了此前缺失的三块内容', () => {
  // 1. 分类排行（重做前完全没有）
  assert.match(source, /function categoryRank/, '应有分类排行');
  assert.match(source, /data-stats-project/, '分类行应可点进专注明细');
  // 2. 时段分布（focusInsights 早已存在，页面没调用）
  assert.match(source, /function timeBuckets/, '应有时段分布');
  assert.match(source, /focusInsights\(state, summary\.sessions/, '时段分布应接 focusInsights');
  // 3. 生活侧写（日记字数 / 书影音）
  assert.match(source, /function reflectionSheet/, '应有生活侧写');
});

test('统计页视觉走纸张素材，不用 CSS 图形模拟装饰', () => {
  // CSS 里同一选择器可能有多条定义（新旧叠加），这里收集全部再判断，
  // 避免只看到第一条（可能是更早的短规则）就误判。
  const rulesOf = selector => {
    const out = [];
    let from = 0;
    for (;;) {
      const start = perf.indexOf(`${selector}{`, from);
      if (start < 0) break;
      const end = perf.indexOf('}', start);
      if (end < 0) break;
      out.push(perf.slice(start, end));
      from = end;
    }
    return out.join('\n');
  };
  assert.match(rulesOf('.stats-masthead'), /today-paper-texture\.png/, '报头应使用纸纹素材');
  assert.match(rulesOf('.stats-screen'), /secondary-page-canvas-v1\.png/, '整页应铺底纸');
  assert.match(rulesOf('.stats-sheet'), /secondary-content-paper-v1\.png/, '内容块应铺内容纸');
  // 暖色设计令牌
  assert.match(perf, /var\(--warm-ink\)/, '应使用暖色墨迹令牌');
  assert.match(perf, /var\(--warm-sage\)/, '应使用暖色鼠尾草令牌');
  // 旧抽屉式圆角已清除（与纸面体系冲突）
  assert.doesNotMatch(perf, /\.stats-sheet\{[^}]*border-radius:28px 28px 0 0/, '旧的抽屉式上圆角应已移除');
});

test('冷调玻璃胶囊已从统计页移除', () => {
  // 重做前习惯/账本两块用 capsule-pill（半透明胶囊）
  assert.doesNotMatch(source, /capsule-pill|pill-beige|pill-left|pill-icon-circle/, '不应再使用冷调胶囊');
  assert.doesNotMatch(source, /💰|🌱|✨|💪/, '不应再使用 emoji 图标（项目惯例用 Material Symbols）');
});

test('统计页渲染的数据全部来自真实聚合，不伪造', () => {
  assert.match(source, /periodSummary\(state, period\)/, '周期数据应来自 periodSummary');
  assert.match(source, /warmWeeklyLifeMetrics\(state, \{/, '生活数据应来自 warmWeeklyLifeMetrics');
  // 周维度必须走 completeStatsWeekSummary 对齐完整 7 天
  assert.match(source, /period === 'week' \? completeStatsWeekSummary/, '周维度应对齐完整自然周');
  // 空数据时给引导文案而不是画假图
  assert.match(source, /stats-sheet-empty/, '无数据时应显示空态文案');
});

test('热力图只读取 habitHeatmapData 真实产出的字段', () => {
  // habitHeatmapData 的 day 只有 { date, level, value }，没有 rest/future
  assert.match(source, /state\.habitSkips/, '休息日应从 habitSkips 判定');
  assert.match(source, /day\.date > dateKey\(\)/, '未来日应与今天比较');
  assert.doesNotMatch(source, /day\.rest\b/, '不得读取不存在的 day.rest');
  assert.doesNotMatch(source, /day\.future\b/, '不得读取不存在的 day.future');
});

test('周期成就徽章读取真实字段名', () => {
  // habitArchiveMetrics 的 achievements 项是 { label, icon, value, target, unit, unlocked, remaining }
  assert.match(source, /item\.unlocked/, '应使用 unlocked 字段');
  assert.match(source, /item\.label/, '应使用 label 字段');
  assert.doesNotMatch(source, /item\.earned/, '不得使用不存在的 earned 字段');
  assert.doesNotMatch(source, /metrics\.achievementRate/, '不得使用不存在的 achievementRate');
  assert.doesNotMatch(source, /metrics\.todayState/, '今日状态应读 metrics.today.status');
});
