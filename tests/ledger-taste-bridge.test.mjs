import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const focusSource = readFileSync(new URL('../views/focus.js', import.meta.url), 'utf8');
const modelSource = readFileSync(new URL('../model.js', import.meta.url), 'utf8');
const ledgerSource = readFileSync(new URL('../views/ledger.js', import.meta.url), 'utf8');
const bridgeSource = readFileSync(new URL('../ledger-taste-bridge.js', import.meta.url), 'utf8');

// 专注 ↔ 习惯：completeTimer 里曾硬编码 habitId:'' / habitMinutes:0，
// 导致用户在计时器里跑完的专注永远不会加到习惯上（只有日历补录路径有效）。
test('focus sessions no longer carry a habit link', () => {
  // 2026-10-17 切割：专注记录不再带 habitId / habitMinutes，也不再把分钟累加进习惯。
  const f = readFileSync(new URL('../views/focus.js', import.meta.url), 'utf8');
  assert.match(f, /const linkedHabitId = \(\(\) => \{/, '仍保留 linkedHabitId 占位');
  assert.doesNotMatch(f, /adjustHabitMinutes\(session\.date/, '结算时不应再累加习惯分钟');
});

test('linked habit is only allowed for minute-based quantity habits', () => {
  assert.match(focusSource, /tracking === 'quantity' && \/分钟\//, '联动习惯必须是按分钟计量的数量型习惯');
  // 结算时也要再兜一次底，防止设置被绕过
  assert.match(focusSource, /habit && !habit\.archived && habit\.tracking === 'quantity'/, '结算时应再次校验习惯有效性');
});

test('habits are decoupled from focus (no linked-habit picker)', () => {
  // 2026-10-17 用户要求：习惯与专注彻底切割。谁把联动加回来，这里就红。
  const f = readFileSync(new URL('../views/focus.js', import.meta.url), 'utf8');
  assert.match(f, /id="timer-settings-form"/, '计时设置表单应保留');
  assert.doesNotMatch(f, /name="focusLinkedHabit"/, '不应再有习惯选择字段');
  assert.match(f, /const linkableHabits = \[\];/, '联动候选应为空数组');
  assert.doesNotMatch(f, /adjustHabitMinutes\(session\.date/, '结算时不应再累加习惯分钟');
});

test('migrating state drops a link pointing at a deleted or mismatched habit', () => {
  const migration = modelSource.slice(modelSource.indexOf('state.settings.focusLinkedHabitId ='));
  assert.match(migration, /!linkedHabit\.archived/, '指向已归档习惯的联动应被断开');
  assert.match(migration, /tracking === 'quantity'/, '指向类型不匹配习惯的联动应被断开');
  assert.match(migration, /单位|分钟|\/分钟\//, '指向非分钟计量的联动应被断开');
});

// 账本 ↔ 味觉：模型层早有 ledgerTransactionId 字段，但 UI 完全没接通，
// 「吃一顿饭 → 生成味觉档案」一直是未实现的产品意图。
test('ledger taste bridge asks instead of auto-creating taste entries', () => {
  assert.match(bridgeSource, /export function offerTasteArchive/, '应导出询问入口');
  assert.match(bridgeSource, /modal\(/, '必须通过弹窗询问用户');
  assert.doesNotMatch(bridgeSource.slice(0, 1500), /state\.tasteEntries\.(unshift|push)\(\{/, '弹窗渲染前不得直接创建记录');
  // 写 state 只能发生在用户提交表单的处理函数里
  assert.match(bridgeSource, /addEventListener\('submit'/, '只有用户提交才写入');
  assert.match(bridgeSource, /state\.tasteEntries\.unshift\(entry\)/, '提交后写入味觉档案');
  assert.match(bridgeSource, /ledgerTransactionId: transaction\.id/, '必须关联到原账目');
});

test('taste bridge never asks twice for the same transaction', () => {
  assert.match(bridgeSource, /existingTasteFor = transactionId =>[\s\S]{0,120}?ledgerTransactionId === transactionId/, '应按 ledgerTransactionId 判重');
  assert.match(bridgeSource, /if \(!transaction\.id \|\| existingTasteFor\(transaction\.id\)\) return false/, '已有味觉档案时应直接返回、不再打扰');
});

test('taste bridge only offers for food expenses and refuses to invent data', () => {
  assert.match(bridgeSource, /transaction\.type !== 'expense'\) return false/, '非支出不询问');
  // 猜不出吃了什么时留空让用户自己填，不编造菜名或店名
  assert.match(bridgeSource, /const suggestedName = guessNames\(transaction\)/, '名字只从备注里取，取不到就留空');
  assert.match(bridgeSource, /if \(!note\) return '';/, '备注为空时不猜');
  assert.doesNotMatch(bridgeSource, /guess[\s\S]{0,400}?placeName: ['"][^'"]+['"]\s*[,}]/, '不得凭空生成店名');
  // 用户没填名字时不写入
  assert.match(bridgeSource, /if \(!entry \|\| !entry\.name\) \{/, '必须填了吃了什么才写入');
});

test('taste bridge 只问吃了什么/哪一顿/什么态度；金额不问但带过来', () => {
  assert.match(bridgeSource, /class="taste-meal-picker"/, '弹窗里应有餐次选择');
  assert.match(bridgeSource, /class="taste-verdict-picker"/, '弹窗里应有态度选择');
  assert.match(bridgeSource, /MEAL_KEYS\.map/, '餐次来自模型的枚举，不写死');
  assert.match(bridgeSource, /VERDICT_KEYS\.map/, '态度来自模型的枚举，不写死');
  assert.doesNotMatch(bridgeSource, /taste-star|name="rating"/, '星级选择器已随升级移除');
  /* 金额：弹窗里**不问**（还是只问吃了什么 / 哪一顿 / 态度），但要从这笔账带过去 ——
     用户已经在账本里填过一次，不该为了吃喝记录再填一遍（2026-10-15 用户要求记录金额）。 */
  assert.match(bridgeSource, /price:\s*transaction\.amount/, '金额从账目带进记录');
  assert.doesNotMatch(bridgeSource, /name="price"/, '弹窗里不额外再问一遍金额');
  assert.doesNotMatch(bridgeSource, /placeName:\s*transaction/, '不再从账目里编店名');
});

test('both ledger save paths offer the taste archive for new food expenses', () => {
  // 快捷记账
  assert.match(ledgerSource, /if \(ledgerQuickType === 'expense'\) offerTasteArchive\(next\)/, '快捷记账后应询问');
  // 完整表单：仅新建时询问，编辑旧账不打扰
  assert.match(ledgerSource, /if \(!existing && pendingLedgerType === 'expense'\) offerTasteArchive\(next\)/, '完整表单新建餐饮支出后应询问');
  assert.match(ledgerSource, /from '\.\.\/ledger-taste-bridge\.js'/, '应从根目录的 bridge 模块导入');
});
