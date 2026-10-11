import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { describeNow, describeMessageTime, dayPartOf } from '../ai/generate.js';

const model = await readFile(new URL('../model.js', import.meta.url), 'utf8');
const aiView = await readFile(new URL('../views/ai.js', import.meta.url), 'utf8');
const generate = await readFile(new URL('../ai/generate.js', import.meta.url), 'utf8');

/**
 * AI 时间感知（2026-10-20）
 *
 * 用户反馈两条：
 *   1. 对话时 AI 不知道现在是几点
 *   2. 很久以前发的消息被当成刚发生
 *
 * 根因：系统提示只给日期不给时刻；且对话历史每条都不存时间戳
 * （normalizeAiHistory 只返回 role/content），模型无法区分新旧。
 */

test('时段判断覆盖一天全部 24 小时', () => {
  assert.equal(dayPartOf(new Date('2026-10-07T03:00:00')), '凌晨');
  assert.equal(dayPartOf(new Date('2026-10-07T07:00:00')), '早上');
  assert.equal(dayPartOf(new Date('2026-10-07T10:00:00')), '上午');
  assert.equal(dayPartOf(new Date('2026-10-07T12:00:00')), '中午');
  assert.equal(dayPartOf(new Date('2026-10-07T15:00:00')), '下午');
  assert.equal(dayPartOf(new Date('2026-10-07T18:00:00')), '傍晚');
  assert.equal(dayPartOf(new Date('2026-10-07T21:00:00')), '晚上');
  assert.equal(dayPartOf(new Date('2026-10-07T23:30:00')), '深夜');
});

test('现在的时间描述包含时刻、时段与第几天', () => {
  const text = describeNow(new Date('2026-10-07T08:05:00'));
  assert.match(text, /现在是 08:05:\d{2}（上午）/u, '必须给出精确时刻（补零）+ 中文时段');
  assert.match(text, /今年第 280 天（全年 \d+ 天/u, '必须给出今年第几天与全年总天数');
  assert.match(text, /本周第 3 天/u, '周口径需与项目内habitStreak 一致（周一为一周之首）');
  assert.match(text, /距周末还有 3 天/u, '必须给出距周末天数');
});

test('周末与周末前一天的说法正确', () => {
  // 2026-10-10 是周六，10-11 是周日，10-09 是周五
  assert.match(describeNow(new Date('2026-10-09T10:00:00')), /明天就是周末/u);
  assert.match(describeNow(new Date('2026-10-10T10:00:00')), /今天就是周末/u,
    '周六必须说「今天就是周末」（曾经因用 toWeekend 反推而错位一天）');
  assert.match(describeNow(new Date('2026-10-11T10:00:00')), /今天已经是周末的最后一天/u);
});

test('消息时间标签能区分新旧', () => {
  const now = new Date('2026-10-07T23:20:00');
  assert.equal(describeMessageTime(now.getTime() - 20 * 1000, now), '刚刚');
  assert.equal(describeMessageTime(now.getTime() - 5 * 60 * 1000, now), '5 分钟前');
  assert.equal(describeMessageTime(new Date('2026-10-07T21:30:00').getTime(), now), '今天 21:30');
  assert.equal(describeMessageTime(new Date('2026-10-06T20:00:00').getTime(), now), '昨天 20:00');
  assert.match(describeMessageTime(new Date('2026-10-04T08:00:00').getTime(), now), /^10-04 08:00（3 天前）$/u);
});

test('时间戳异常时不产生荒谬标签', () => {
  const now = new Date('2026-10-07T23:20:00');
  // 曾经因为 Number(NaN)||0 = 0 而输出「20733 天前」，必须挡住
  assert.equal(describeMessageTime(undefined, now), '');
  assert.equal(describeMessageTime(null, now), '');
  assert.equal(describeMessageTime('not-a-date', now), '');
  for (const label of ['', undefined, null, 'bad', NaN]) {
    assert.ok(!describeMessageTime(label, now).includes('天前'), `非法 at 不得产生「天前」标签：${label}`);
  }
});

test('新对话记录时刻，旧对话不伪造时间', async () => {
  // 入库统一走 pushHistory 补 at，不能有裸 push 绕过
  assert.match(aiView, /function pushHistory\(entry\)\s*\{\s*aiHistory\.push\(\{ at: Date\.now\(\), \.\.\.entry \}\)/,
    '必须有统一补时间的包装函数');
  const bare = aiView.match(/aiHistory\.push\(\{/g) || [];
  assert.equal(bare.length, 1, `只允许包装函数内部使用裸 push，实际发现 ${bare.length} 处`);
  const { makeDefaultState, migrateState } = await import('../model.js');
  const legacy = makeDefaultState();
  legacy.aiHistory = [{ role: 'user', content: '很久以前的消息' }];
  assert.equal(migrateState(legacy).aiHistory[0].at, 0, '未知发送时间必须保留未知，不得伪造为现在');
});

test('系统提示注入时刻与带时间戳的历史', () => {
  assert.match(generate, /【现在是】\$\{describeNow\(now\)\}/, '系统提示必须含完整时间描述');
  assert.match(generate, /stampedHistory/, '系统提示必须含带时间戳的历史文本');
  assert.match(generate, /几天前说的事情不是刚发生的/, '必须明确要求模型体现时间差');
  assert.match(generate, /return \[\{ role: 'system', content: system \}, \.\.\.stampedMessages\]/,
    '传给模型的必须是打过时间戳的消息，而不只是提示里提一句');
  assert.match(generate, /\[\$\{label\}\] \$\{message\.content\}/, '每条消息内容前要加时间标签');
});