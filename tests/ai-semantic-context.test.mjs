import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAiChatMessages, aiChat } from '../ai/generate.js';
import { buildSemanticRecords, parseJournalContent, retrieveSemanticContext, SEMANTIC_DEFAULT_CHAR_BUDGET, SEMANTIC_DEFAULT_LIMIT } from '../ai/semantic.js';
import { makeDefaultState } from '../model.js';

const NOW = new Date('2026-09-04T12:00:00+08:00');

function fixtureState() {
  const state = makeDefaultState(NOW);
  state.settings.aiProvider = 'custom';
  state.settings.aiBaseUrl = 'https://example.invalid/chat';
  state.settings.aiModel = 'semantic-test';
  state.settings.aiApiKey = 'fixture-key';
  state.settings.aiEmotionCare = true;
  state.profile = { name: '不应进入语义记录的姓名', motto: '不应进入普通聊天的座右铭', avatar: 'data:image/png;base64,PROFILE' };
  state.journals = {
    '2026-09-03': { content: '《压力夜》\n今天想到考试安排时有些焦虑，后来散步平静了一点。', mood: 'anxious', weather: 'cloudy', photos: ['data:image/png;base64,JOURNAL'], tags: ['备考'], summary: '', updatedAt: NOW.getTime() }
  };
  state.snippets = [
    { id: 'moment-1', type: 'photo', date: '2026-09-03', text: '晚饭后散步时仍有点焦虑。', photos: ['data:image/png;base64,MOMENT'], videos: [], tags: ['散步'], createdAt: NOW.getTime(), updatedAt: NOW.getTime() }
  ];
  state.todos = [
    { id: 'todo-1', date: '2026-09-05', title: '整理高数复习安排', completed: false, createdAt: NOW.getTime(), updatedAt: NOW.getTime() }
  ];
  state.habits = [
    { id: 'habit-1', name: '背单词', target: 30, targetMax: 30, unit: '个', tracking: 'quantity', goalType: 'quantity', goalPeriod: 'daily', repeatDays: [0, 1, 2, 3, 4, 5, 6], archived: false, createdAt: NOW.getTime() }
  ];
  state.checks = { '2026-09-04': { 'habit-1': 18 } };
  state.habitCompletions = {};
  state.habitSkips = {};
  state.focusProjects = [{ id: 'project-math', name: '高数复习', group: '备考', category: 'work', mediaId: 'media-1', archived: false }];
  state.focusCategories = [];
  state.sessions = [
    { id: 'focus-1', date: '2026-09-04', projectId: 'project-math', categoryId: '', habitId: '', mediaId: 'media-1', category: 'work', task: '高数错题第二章', mode: 'countdown', minutes: 45, durationSeconds: 2700, startedAt: NOW.getTime() }
  ];
  state.media = [
    { id: 'media-1', type: 'book', title: '深度工作', status: 'in_progress', completedDate: '', rating: 0, notes: '读到专注前先清空桌面，并记录干扰来源。', poster: 'data:image/png;base64,POSTER', createdAt: NOW.getTime(), updatedAt: NOW.getTime() }
  ];
  state.countdowns = [{ id: 'countdown-1', title: '考试日', date: '2026-09-20', note: '提前检查文具', image: 'data:image/png;base64,COUNTDOWN', createdAt: NOW.getTime(), updatedAt: NOW.getTime() }];
  state.settings.ledgerBudget = { total: 300, categories: {}, periods: [] };
  state.ledgerAccounts = [{ id: 'secret-account', name: '绝密储蓄卡', type: 'bank', initialBalance: 99999, archived: false }];
  state.transactions = [
    { id: 'tx-1', type: 'expense', category: 'restaurant', amount: 12.34, accountId: 'secret-account', date: '2026-09-02', note: '星巴克秘密备注', merchant: '秘密商户', photo: 'data:image/png;base64,RECEIPT' },
    { id: 'tx-2', type: 'expense', category: 'restaurant', amount: 56.78, accountId: 'secret-account', date: '2026-09-03', note: '逐笔交易备注', merchant: '第二商户' }
  ];
  state.aiMemory = [];
  state.aiHistory = [];
  return state;
}

test('SemanticRecord contract covers every module without media bytes, API keys or account names', () => {
  const state = fixtureState();
  const before = structuredClone(state);
  const records = buildSemanticRecords(state, { now: NOW });
  assert.deepEqual([...new Set(records.map(item => item.sourceType))].sort(), ['countdown', 'course', 'focus', 'habit', 'journal', 'ledger', 'media', 'moment', 'todo']);
  for (const item of records) {
    for (const key of ['stableKey', 'sourceType', 'date', 'title', 'summary', 'status', 'relationLabels', 'sensitivity', 'allowedScope']) assert.ok(Object.hasOwn(item, key), `${item.sourceType}.${key}`);
  }
  const serialized = JSON.stringify(records);
  assert.doesNotMatch(serialized, /base64|fixture-key|绝密储蓄卡|99999|星巴克秘密备注|秘密商户|逐笔交易备注/);
  assert.deepEqual(state, before);
});

test('anxiety query retrieves dated Journal and Moments excerpts', () => {
  const result = retrieveSemanticContext(fixtureState(), '我最近有点焦虑，之前记录过什么？', { now: NOW });
  const sources = new Set(result.records.map(item => item.sourceType));
  assert.ok(sources.has('journal'));
  assert.ok(sources.has('moment'));
  assert.match(result.text, /\[日记｜2026-09-03/);
  assert.match(result.text, /\[Moments｜2026-09-03/);
  assert.match(result.text, /文中的今天\/昨天以 2026-09-03 为准/);
});

test('study planning retrieves Todo Habit and Focus but excludes unrelated Ledger', () => {
  const result = retrieveSemanticContext(fixtureState(), '帮我安排接下来的学习复习计划', { now: NOW });
  const sources = new Set(result.records.map(item => item.sourceType));
  assert.ok(sources.has('todo'));
  assert.ok(sources.has('habit'));
  assert.ok(sources.has('focus'));
  assert.ok(!sources.has('ledger'));
  assert.doesNotMatch(result.text, /本期消费|预算|绝密储蓄卡/);
});

test('course questions retrieve only the relevant scheduled class occurrences', () => {
  const result = retrieveSemanticContext(fixtureState(), '我下周一有什么课？上午上课时间和教室是什么？', { now: NOW });
  assert.equal(result.records.length, 5);
  assert.ok(result.records.every(item => item.sourceType === 'course' && item.date === '2026-09-07'));
  assert.match(result.text, /智能制造技术基础/);
  assert.match(result.text, /08:00–09:40/);
  assert.match(result.text, /教三楼213/);
  assert.match(result.text, /科技文献检索/);
  assert.doesNotMatch(result.text, /压力夜|本期消费|绝密储蓄卡/);
});

test('media query includes real notes and linked focus', () => {
  const result = retrieveSemanticContext(fixtureState(), '我最近在读什么书，有哪些读书笔记和关联专注？', { now: NOW });
  assert.ok(result.records.some(item => item.sourceType === 'media'));
  assert.match(result.text, /深度工作/);
  assert.match(result.text, /清空桌面/);
  assert.match(result.text, /关联专注 45 分钟/);
});

test('budget query exposes aggregates only and strips accounts, transactions, merchants, notes and images', () => {
  const result = retrieveSemanticContext(fixtureState(), '本月预算和消费分类怎么样？', { now: NOW });
  assert.deepEqual([...new Set(result.records.map(item => item.sourceType))], ['ledger']);
  assert.match(result.text, /总支出 ¥69\.12/);
  assert.match(result.text, /餐饮 ¥69\.12/);
  assert.match(result.text, /预算剩余 ¥230\.88/);
  assert.doesNotMatch(result.text, /绝密储蓄卡|99999|12\.34|56\.78|星巴克|秘密商户|逐笔交易备注|base64|RECEIPT/);
});

test('generic context is stable, bounded and does not include Ledger without finance intent', () => {
  const state = fixtureState();
  for (let index = 0; index < 40; index += 1) state.todos.push({ id: `bulk-${index}`, date: '2026-09-04', title: `生活待办 ${index}`, completed: false, createdAt: NOW.getTime() + index, updatedAt: NOW.getTime() + index });
  const first = retrieveSemanticContext(state, '总结一下我最近的生活状态', { now: NOW });
  const second = retrieveSemanticContext(state, '总结一下我最近的生活状态', { now: NOW });
  assert.deepEqual(first, second);
  assert.ok(first.count <= SEMANTIC_DEFAULT_LIMIT);
  assert.ok(first.charCount <= SEMANTIC_DEFAULT_CHAR_BUDGET);
  assert.equal(first.truncated, true);
  assert.ok(!first.records.some(item => item.sourceType === 'ledger'));
  assert.doesNotMatch(first.text, /完整state|绝密储蓄卡|fixture-key/);
});

test('unrelated question returns no semantic filler', () => {
  const result = retrieveSemanticContext(fixtureState(), '量子纠缠的贝尔不等式如何推导？', { now: NOW });
  assert.equal(result.count, 0);
  assert.equal(result.text, '');
});

test('Provider switching does not change semantic depth or local AI data', () => {
  const state = fixtureState();
  state.aiMemory = [{ id: 'memory-1', text: '用户偏好安静环境', source: 'manual', createdAt: 1, updatedAt: 1 }];
  state.aiHistory = [{ role: 'user', content: '你好' }];
  const beforeData = structuredClone({ memory: state.aiMemory, history: state.aiHistory });
  const before = retrieveSemanticContext(state, '学习安排', { now: NOW });
  state.settings.aiProvider = 'openai';
  state.settings.aiModel = 'gpt-4o-mini';
  const after = retrieveSemanticContext(state, '学习安排', { now: NOW });
  assert.deepEqual(after, before);
  assert.deepEqual({ memory: state.aiMemory, history: state.aiHistory }, beforeData);
});

test('embedded journal title is parsed separately from its dated excerpt', () => {
  assert.deepEqual(parseJournalContent('《九月四日》\n今天完成了复盘。'), { title: '九月四日', body: '今天完成了复盘。' });
});

test('chat request injects only retrieved semantic context after one explicit call', async () => {
  const state = fixtureState();
  const built = buildAiChatMessages(state, [{ role: 'user', content: '帮我安排学习复习' }]);
  assert.match(built[0].content, /整理高数复习安排/);
  assert.match(built[0].content, /背单词/);
  assert.match(built[0].content, /高数错题第二章/);
  assert.doesNotMatch(built[0].content, /压力夜|本期消费|绝密储蓄卡|座右铭/);
  const courseChat = buildAiChatMessages(state, [{ role: 'user', content: '我下周一有什么课？' }], NOW);
  assert.match(courseChat[0].content, /智能制造技术基础/);
  assert.match(courseChat[0].content, /08:00–09:40/);
  const moodChat = buildAiChatMessages(state, [{ role: 'user', content: '我最近的焦虑记录有哪些？' }]);
  assert.match(moodChat[0].content, /\[Moments｜2026-09-03/);
  assert.match(moodChat[0].content, /晚饭后散步时仍有点焦虑/);
  let requests = 0;
  let body;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requests += 1;
    body = JSON.parse(options.body);
    return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '收到' } }] }) };
  };
  try {
    assert.equal(requests, 0);
    assert.equal(await aiChat(state, [{ role: 'user', content: '帮我安排学习复习' }]), '收到');
    assert.equal(requests, 1);
    assert.match(body.messages[0].content, /整理高数复习安排/);
    assert.doesNotMatch(JSON.stringify(body), /绝密储蓄卡|星巴克秘密备注|base64|fixture-key/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
