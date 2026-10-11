import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  aiFocusCoach,
  aiLedgerAnalysis,
  aiRecognizeLedgerImage,
  parseLedgerImageRecognitionReply
} from '../ai/generate.js';
import { makeDefaultState } from '../model.js';

const textSettings = {
  aiApiKey: 'text-key',
  aiProvider: 'custom',
  aiBaseUrl: 'https://example.invalid/text',
  aiModel: 'test-text'
};
const visionSettings = {
  aiApiKey: 'multimodal-key',
  aiProvider: 'custom',
  aiBaseUrl: 'https://example.invalid/multimodal',
  aiModel: 'test-multimodal',
  visionApiKey: 'legacy-vision-key',
  visionProvider: 'qwen',
  visionBaseUrl: 'https://legacy.invalid/vision',
  visionModel: 'legacy-vision-model'
};

async function withMockFetch(content, run) {
  const originalFetch = globalThis.fetch;
  let requestBody = '';
  globalThis.fetch = async (_url, options) => {
    requestBody = String(options.body || '');
    return {
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content } }] })
    };
  };
  try {
    const result = await run(() => requestBody);
    return { result, requestBody };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const ledgerAnalysisText = '本期支出主要集中在餐饮分类，其他分类占比较低，整体结构相对集中。与上一同长度周期相比，本期支出有所增加，但现有汇总不能说明具体原因。下个周期可以先给餐饮设置一个可执行上限，并在周期中点核对一次预算；同时保留必要支出空间，避免为了压低数字影响正常生活。';
const focusCoachText = '这次专注基本完成了预定投入，整体节奏较稳，但中途仍有少量打断，说明环境控制还有提升空间。现在先离开屏幕活动肩颈并补充水分，让注意力自然恢复。下次开始前可提前处理通知，并把目标拆成一个更清晰的阶段节点。';

test('ledger analysis uses only in-range expenses and sends the authorized aggregate', async () => {
  const state = makeDefaultState(new Date('2026-08-20T12:00:00'));
  state.settings = { ...state.settings, ...textSettings, ledgerBudget: { start: '2026-08-01', end: '2026-08-31', total: 500, categories: {} } };
  state.profile = { name: 'PRIVATE-PROFILE' };
  state.ledgerAccounts[0].name = 'PRIVATE-ACCOUNT';
  state.transactions = [
    { type: 'expense', amount: 40, category: 'restaurant', date: '2026-07-25', note: 'PRIVATE-PREVIOUS', accountId: 'cmb' },
    { type: 'expense', amount: 60, category: 'restaurant', date: '2026-08-05', note: 'PRIVATE-CURRENT', accountId: 'cmb' },
    { type: 'transfer', amount: 999, date: '2026-08-06', note: 'PRIVATE-TRANSFER' },
    { type: 'calibrate', amount: 888, date: '2026-08-07', note: 'PRIVATE-CALIBRATE' },
    { type: 'income', amount: 777, date: '2026-08-08', note: 'PRIVATE-INCOME' }
  ];
  const payload = {
    start: '2026-08-01',
    end: '2026-08-10',
    expenses: [
      ...state.transactions,
      { type: 'expense', amount: 123, category: 'study', date: '2026-08-11', note: 'PRIVATE-OUTSIDE' }
    ]
  };
  const { result, requestBody } = await withMockFetch(ledgerAnalysisText, () => aiLedgerAnalysis(state, payload));
  assert.equal(result, ledgerAnalysisText);
  const request = JSON.parse(requestBody);
  const sent = JSON.parse(request.messages.at(-1).content);
  assert.deepEqual(sent.period, { start: '2026-08-01', end: '2026-08-10' });
  assert.equal(sent.totalExpense, 60);
  assert.equal(sent.previousPeriod.totalExpense, 40);
  assert.deepEqual(sent.categoryTotals, [{ category: '餐饮', amount: 60 }]);
  assert.doesNotMatch(requestBody, /999|888|777|123|PRIVATE-|account|merchant|note|profile/i);
});

test('ledger image parser accepts valid plain JSON', () => {
  const result = parseLedgerImageRecognitionReply(JSON.stringify({ amount: 25.5, merchant: '咖啡店', date: '2026-08-19', category: 'restaurant', note: '饮品', confidence: 0.92 }), makeDefaultState());
  assert.deepEqual(result, { amount: 25.5, merchant: '咖啡店', date: '2026-08-19', category: 'restaurant', note: '饮品', confidence: 0.92 });
});

test('ledger image parser accepts JSON code fences', () => {
  const text = '```json\n{"amount":10,"merchant":"书店","date":"2026-08-18","category":"study","note":"书籍","confidence":0.8}\n```';
  assert.equal(parseLedgerImageRecognitionReply(text, makeDefaultState()).category, 'study');
});

test('ledger image parser returns null for an invalid amount and never fabricates it', () => {
  const result = parseLedgerImageRecognitionReply('{"amount":"看不清","merchant":"","date":"","category":"other","note":"","confidence":0.2}', makeDefaultState());
  assert.equal(result.amount, null);
});

test('ledger image parser clears an invalid calendar date', () => {
  const result = parseLedgerImageRecognitionReply('{"amount":20,"merchant":"","date":"2026-99-99","category":"other","note":"","confidence":0.2}', makeDefaultState());
  assert.equal(result.date, '');
});

test('ledger image category is restricted and special mappings take priority', () => {
  const state = makeDefaultState();
  assert.equal(parseLedgerImageRecognitionReply('{"amount":20,"merchant":"OpenAI API","category":"restaurant"}', state).category, 'ai');
  assert.equal(parseLedgerImageRecognitionReply('{"amount":20,"merchant":"未知店铺","category":"not-allowed"}', state).category, 'other');
});

test('ledger image confidence is clamped to zero through one', () => {
  const state = makeDefaultState();
  assert.equal(parseLedgerImageRecognitionReply('{"amount":20,"confidence":9}', state).confidence, 1);
  assert.equal(parseLedgerImageRecognitionReply('{"amount":20,"confidence":-2}', state).confidence, 0);
});

test('ledger image recognition returns a suggestion without mutating state', async () => {
  const state = makeDefaultState();
  state.settings = { ...state.settings, ...visionSettings };
  const before = structuredClone(state);
  const response = JSON.stringify({ amount: 18, merchant: '测试店', date: '2026-08-20', category: 'restaurant', note: '测试', confidence: 0.7 });
  const { result } = await withMockFetch(response, () => aiRecognizeLedgerImage(state, 'data:image/png;base64,TEST'));
  assert.equal(result.amount, 18);
  assert.deepEqual(state, before);
});

test('focus coach request contains only authorized session fields', async () => {
  const state = makeDefaultState();
  state.settings = { ...state.settings, ...textSettings };
  const session = {
    mode: 'countdown', durationSeconds: 1500, targetDurationSeconds: 1800,
    interruptionsCount: 2, flowScore: 82,
    ambientSoundsUsed: [{ soundId: 'PRIVATE-RAIN', volume: 0.5 }],
    task: 'PRIVATE-TASK', category: 'PRIVATE-CATEGORY', detail: 'PRIVATE-DETAIL'
  };
  const { result, requestBody } = await withMockFetch(focusCoachText, () => aiFocusCoach(state, session));
  assert.equal(result, focusCoachText);
  const request = JSON.parse(requestBody);
  const sent = JSON.parse(request.messages.at(-1).content);
  assert.deepEqual(Object.keys(sent).sort(), ['ambientTrackCount', 'durationSeconds', 'flowScore', 'interruptionsCount', 'mode', 'targetDurationSeconds', 'usedAmbientSounds']);
  assert.deepEqual(sent, { mode: 'countdown', durationSeconds: 1500, targetDurationSeconds: 1800, interruptionsCount: 2, flowScore: 82, usedAmbientSounds: true, ambientTrackCount: 1 });
  assert.doesNotMatch(requestBody, /PRIVATE-|task|category|detail|soundId/i);
});

test('focus coach rejects a missing session before any request', async () => {
  await assert.rejects(() => aiFocusCoach({ settings: textSettings }, null), /缺少可分析的专注记录/);
});

test('focus coach rejects an empty model response', async () => {
  await assert.rejects(() => withMockFetch('   ', () => aiFocusCoach({ settings: textSettings }, { mode: 'pomo' })), /返回为空/);
});

test('three cross-module helpers are registered as lazy function references', async () => {
  const source = await readFile(new URL('../views/ai.js', import.meta.url), 'utf8');
  for (const [name, handler] of [
    ['aiLedgerAnalysis', 'runAiLedgerAnalysis'],
    ['aiRecognizeLedgerImage', 'runAiRecognizeLedgerImage'],
    ['aiFocusCoach', 'runAiFocusCoach']
  ]) {
    assert.match(source, new RegExp(`registerHelper\\('${name}',\\s*${handler}\\)`));
    assert.doesNotMatch(source, new RegExp(`registerHelper\\('${name}',\\s*${handler}\\(\\)`));
  }
});
