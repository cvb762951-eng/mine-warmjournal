import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const aiSource = readFileSync(new URL('../views/ai.js', import.meta.url), 'utf8');
const todaySource = readFileSync(new URL('../views/today.js', import.meta.url), 'utf8');
const notificationsSource = readFileSync(new URL('../notifications.js', import.meta.url), 'utf8');

// 三个开关在用户勾选后曾经完全无效：
//  1. 倒数日 30/7/1 天节点提醒 —— helper 注册了但零调用方
//  2. AI 随机提醒 —— 开关把计划对象覆盖成布尔，且 item 形状与调度器不匹配
//  3. AI 每日鼓励语 —— 生成侧零调用，首页永远回退用户格言
// 这些测试锁定「接线真的在」，防止以后重构又断掉。

test('countdown node reminders are actually triggered on app foreground', () => {
  // 触发点：切回前台时调用 checkAiCountdowns（不是进 AI 页、不是 render）
  assert.match(aiSource, /visibilitychange[\s\S]{0,400}?checkAiCountdowns/, '切回前台应触发倒数日节点检查');
  // 不允许在页面渲染 / tab 切换时触发（那会造成自动联网）
  assert.doesNotMatch(aiSource, /registerOnRender\([\s\S]{0,400}?checkAiCountdowns/, '节点检查不得挂在 render 上');
  // 用户可当场验证链路
  assert.match(aiSource, /cd-node-check-now/, '设置页应提供「立即检查是否有节点」');
});

test('countdown node copy is only requested when the user enabled it', () => {
  const fn = aiSource.slice(aiSource.indexOf('async function checkCountdownNodes'));
  assert.match(fn.slice(0, 400), /!cfg\.nodeReminder/, '未开启节点提醒时必须直接返回');
  // 通知失败不能写已提醒标记，否则用户永远收不到
  assert.match(fn, /notifyNow[\s\S]{0,200}?delete notified\[key\]/, '通知发送失败时不应写入已提醒标记');
});

test('random reminder plan uses the same item shape the scheduler expects', () => {
  // 调度器只接受 { time: 'HH:MM', title, body }
  assert.match(notificationsSource, /item\?\.time/, '调度器按 item.time 过滤');
  // 生成侧必须产出 time 字段，而不是旧的 hour/minute
  const gen = aiSource.slice(aiSource.indexOf('async function scheduleTodayRandomReminders'));
  assert.match(gen, /time: `\$\{String\(hour\)/, '生成侧必须产出 HH:MM 的 time 字段');
  assert.doesNotMatch(gen, /\{ text, hour: Math\.floor/, '不应再产出旧的 { text, hour, minute } 形状');
});

test('random reminder switch and plan live in separate fields', () => {
  // 开关写 aiRandomRemindersEnabled，计划写 aiRandomReminders；两者不能互相覆盖
  assert.match(aiSource, /state\.settings\.aiRandomRemindersEnabled = \$\('#random-reminders-toggle'\)/, '开关应写入 aiRandomRemindersEnabled');
  assert.doesNotMatch(aiSource, /state\.settings\.aiRandomReminders = \$\('#random-reminders-toggle'\)/, '开关不得再写入计划字段 aiRandomReminders');
  // UI 勾选状态读同一个开关字段
  assert.match(aiSource, /random-reminders-toggle[^>]*aiRandomRemindersEnabled === true/, '开关只在明确开启时勾选');
});

test('daily encouragement has an explicit generation entry instead of silent autogen', () => {
  // 生成必须由用户点按钮触发
  assert.match(aiSource, /generateAiDailyEncouragement/, '应提供显式生成 helper');
  assert.match(aiSource, /gen-daily-encouragement/, '设置页应有生成按钮');
  // 渲染时只读缓存，绝不联网
  assert.match(todaySource, /callHelper\('aiDailyEncouragement'\)\?\.then/, '今日页应只读鼓励语缓存');
  assert.doesNotMatch(todaySource, /aiDailyEncouragement[\s\S]{0,80}?await aiDailyEncouragement/, '今日页不得直接调用生成函数');
});

test('daily encouragement writes to the element that actually exists', () => {
  // 旧实现抓的是不存在的元素（id 写作 today-motto），AI 文案拿到后被静默丢弃。
  // 只检查代码：注释里提到历史名称是允许的。
  const code = todaySource.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /today-motto/, '代码中不应再引用不存在的元素 id');
  assert.match(todaySource, /id="motto-track"/, '鼓励语容器必须有 id');
  assert.match(todaySource, /\$\('#motto-track'\)/, 'AI 鼓励语应写入真实存在的容器');
});

test('all three switches must not be wired to auto-network paths', () => {
  // 「零自动联网」底线：页面渲染 / tab 切换不得触发任何 AI 请求
  const renderBlock = aiSource.slice(aiSource.indexOf('registerOnRender(() =>'));
  assert.doesNotMatch(renderBlock.slice(0, 600), /scheduleTodayRandomReminders|checkCountdownNodes|generateAiDailyEncouragement/, 'render 回调里不得出现这三个功能的触发');
});
