import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAiContext } from '../ai/context.js';
import { makeDefaultState } from '../model.js';

// buildAiContext 会喂给几乎所有 AI 入口（鼓励语、每日问候、每日小结、随机提醒文案、
// 日记引导、对话记忆提炼、数据记忆提炼）。这些场景只需要「钱紧不紧」，
// 不需要知道用户花了多少钱、账户里有多少、别人欠他多少。
// 精确金额只能出现在用户主动问钱的那条通路（semantic 检索）里。
test('buildAiContext never leaks exact ledger amounts to the model', () => {
  const state = makeDefaultState(new Date('2026-09-04T12:00:00+08:00'));
  state.ledgerAccounts = [
    { id: 'acc-1', name: '绝密储蓄卡', type: 'bank', initialBalance: 88888.88, archived: false },
    { id: 'loan-1', name: '外借应收款', type: 'receivable', initialBalance: 0, archived: false }
  ];
  state.transactions = [
    { id: 'tx-1', type: 'expense', category: 'restaurant', amount: 1234.56, accountId: 'acc-1', date: '2026-09-02', note: '秘密商户备注' },
    { id: 'tx-2', type: 'income', category: 'salary', amount: 9999.99, accountId: 'acc-1', date: '2026-09-03', note: '' }
  ];
  state.settings.ledgerBudget = { total: 5000, categories: {}, periods: [] };

  const context = buildAiContext(state, new Date('2026-09-04T12:00:00+08:00'));
  assert.ok(context.length > 0, 'context 不应为空');
  // 精确金额一律不得出现
  assert.doesNotMatch(context, /1234\.56|9999\.99|88888\.88/, '通用上下文不得包含任何精确金额');
  // 账户名、备注、单笔商户也属于最小外发载荷之外
  assert.doesNotMatch(context, /绝密储蓄卡|秘密商户备注/, '通用上下文不得包含账户名或单笔备注');
  // 但要保留定性的钱况判断，AI 才讲得出「最近是不是花超了」
  assert.match(context, /账本：/, '仍需提供账本的定性描述');
  assert.match(context, /预算/, '仍需提供预算状态');
});

test('buildAiContext describes budget pressure qualitatively as over/under limit', () => {
  const state = makeDefaultState(new Date('2026-09-04T12:00:00+08:00'));
  state.ledgerAccounts = [{ id: 'acc-1', name: '卡', type: 'bank', initialBalance: 0, archived: false }];
  // 交易日期必须落在预算周期内，否则统计为 0（与既有 ledgerSummary 行为一致）。
  state.transactions = [
    { id: 'tx-1', type: 'expense', category: 'restaurant', amount: 800, accountId: 'acc-1', date: '2026-09-04', note: '' }
  ];
  state.settings.ledgerBudget = { total: 1000, categories: {}, periods: [] };
  const context = buildAiContext(state, new Date('2026-09-04T12:00:00+08:00'));
  assert.doesNotMatch(context, /800/, '不得外发精确金额');
  assert.match(context, /预算接近上限/, '预算用到 80% 应描述为接近上限');
});

test('buildAiContext stays silent about the ledger when there is no money activity', () => {
  const state = makeDefaultState(new Date('2026-09-04T12:00:00+08:00'));
  state.ledgerAccounts = [];
  state.transactions = [];
  const context = buildAiContext(state, new Date('2026-09-04T12:00:00+08:00'));
  assert.doesNotMatch(context, /账本：/, '没有任何账目活动时不应输出账本行');
});
