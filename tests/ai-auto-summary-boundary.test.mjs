import assert from 'node:assert/strict';
import test from 'node:test';

const classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
const appNode = { classList, innerHTML: '', scrollTop: 0 };
globalThis.document = {
  querySelector: selector => selector === '#app' ? appNode : null,
  querySelectorAll: () => [],
  addEventListener() {},
  documentElement: { classList },
  body: { classList },
  visibilityState: 'visible',
  createElement: () => ({})
};
globalThis.window = { addEventListener() {}, innerWidth: 395 };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { makeDefaultState } = await import('../model.js');
const { setState } = await import('../core.js');
const { aiDailySummary } = await import('../ai/generate.js');
const {
  aiView,
  dailySummaryRequestState,
  ensureDailySummary,
  runScheduledAutoSummary,
  scheduleAiRefresh,
  switchAiTab
} = await import('../views/ai.js');

function boundaryState({ key = 'configured' } = {}) {
  const state = makeDefaultState(new Date('2026-09-03T12:00:00'));
  state.settings.aiApiKey = key;
  state.settings.aiProvider = 'custom';
  state.settings.aiBaseUrl = 'https://provider.example/chat';
  state.settings.aiModel = 'model';
  state.settings.aiLastDataScanAt = 0;
  state.dailySummaries = {};
  state.focusProjects = [{ id: 'private-project-id', group: '备考', name: '不应外发的项目名' }];
  state.sessions = [{ date: '2026-09-02', minutes: 45, projectId: 'private-project-id', task: '不应外发的任务正文' }];
  state.habits = [{ id: 'private-habit-id', name: '不应外发的习惯名', archived: false, goalPeriod: 'daily', repeatDays: [3], goalType: 'minimum', target: 1 }];
  state.checks = { '2026-09-02': { 'private-habit-id': 1 } };
  state.habitSkips = {};
  state.todos = [{ date: '2026-09-02', title: '整理复习材料', completed: false, createdAt: 1 }];
  state.snippets = [{ date: '2026-09-02', type: 'text', text: '这是一条超过四十字时应被截断的随手记内容，用于验证凌晨日结最小载荷不会继续携带更多原始内容。' }, { date: '2026-09-02', type: 'photo', photo: 'private-image-data' }];
  state.journals = { '2026-09-02': { content: '日记正文'.repeat(50), mood: 'calm', photos: ['private-image-data'] } };
  state.profile = { name: '不应外发的姓名' };
  state.aiMemory = [{ text: '不应外发的长期记忆' }];
  state.transactions = [{ type: 'expense', amount: 999, note: '不应外发的交易' }];
  return state;
}

const scheduledNow = new Date('2026-09-03T02:00:00');

test('aiView with configured key and expired scan performs zero requests', () => {
  const state = boundaryState();
  state.route = 'ai';
  setState(state);
  let requests = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { requests += 1; throw new Error('unexpected request'); };
  try {
    const html = aiView();
    assert.match(html, /暖色生活志 AI 伴侣/);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('panel switching performs zero requests', () => {
  const state = boundaryState();
  state.route = 'ai';
  setState(state);
  let requests = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { requests += 1; throw new Error('unexpected request'); };
  try {
    switchAiTab('report');
    switchAiTab('memory');
    switchAiTab('chat');
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('ensureDailySummary without options is a cache-only Calendar-compatible call', async () => {
  const state = boundaryState();
  let requests = 0;
  const result = await ensureDailySummary(undefined, { state, now: scheduledNow, generate: async () => { requests += 1; return 'unexpected'; }, persist: async () => {} });
  assert.equal(result, null);
  assert.equal(requests, 0);
  assert.deepEqual(state.dailySummaries, {});
});

test('scheduled daily summary requests once for yesterday and saves only success', async () => {
  const state = boundaryState();
  let requests = 0;
  let saves = 0;
  let sentState;
  let sentDate;
  const result = await ensureDailySummary({ scheduled: true }, {
    state,
    now: scheduledNow,
    generate: async (requestState, date) => { requests += 1; sentState = requestState; sentDate = date; return '前一天的真实 AI 小结'; },
    persist: async () => { saves += 1; }
  });
  assert.equal(requests, 1);
  assert.equal(saves, 1);
  assert.equal(sentDate, '2026-09-02');
  assert.equal(result.text, '前一天的真实 AI 小结');
  assert.equal(state.dailySummaries['2026-09-02'].text, '前一天的真实 AI 小结');
  assert.deepEqual(sentState.profile, {});
  assert.deepEqual(sentState.aiMemory, []);
  assert.deepEqual(sentState.transactions, []);
  assert.deepEqual(sentState.ledgerAccounts, []);
  assert.deepEqual(sentState.sessions, [{ date: '2026-09-02', minutes: 45, projectId: 'group-0' }]);
  assert.deepEqual(sentState.focusProjects, [{ id: 'group-0', group: '备考' }]);
  assert.equal(sentState.habits[0].id, 'habit-0');
  assert.equal('name' in sentState.habits[0], false);
  assert.equal(sentState.snippets[0].text.length, 40);
  assert.equal('photo' in sentState.snippets[1], false);
  assert.equal(sentState.journals['2026-09-02'].content.length, 120);
});

test('scheduled path sends the approved minimized payload through the real generator once', async () => {
  const state = boundaryState();
  let requests = 0;
  let requestBody = '';
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requests += 1;
    requestBody = String(options.body || '');
    return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '真实请求链路生成的小结' } }] }) };
  };
  try {
    await ensureDailySummary({ scheduled: true }, { state, now: scheduledNow, generate: aiDailySummary, persist: async () => {} });
    assert.equal(requests, 1);
    assert.equal(state.dailySummaries['2026-09-02'].text, '真实请求链路生成的小结');
    assert.match(requestBody, /2026-09-02|45 分钟|备考|整理复习材料|随手记|1 张照片|calm/);
    assert.doesNotMatch(requestBody, /private-project-id|private-habit-id|不应外发|999|private-image-data/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('cached yesterday summary makes zero requests', async () => {
  const state = boundaryState();
  state.dailySummaries['2026-09-02'] = { text: '已有小结' };
  let requests = 0;
  const result = await ensureDailySummary({ scheduled: true }, { state, now: scheduledNow, generate: async () => { requests += 1; }, persist: async () => {} });
  assert.equal(result.text, '已有小结');
  assert.equal(requests, 0);
});

test('scheduled summary without key makes zero requests', async () => {
  const state = boundaryState({ key: '' });
  let requests = 0;
  const result = await ensureDailySummary({ scheduled: true }, { state, now: scheduledNow, generate: async () => { requests += 1; }, persist: async () => {} });
  assert.equal(result, null);
  assert.equal(requests, 0);
});

test('generation failure writes no daily summary and never retries', async () => {
  const state = boundaryState();
  let requests = 0;
  await assert.rejects(() => ensureDailySummary({ scheduled: true }, {
    state,
    now: scheduledNow,
    generate: async () => { requests += 1; throw new Error('provider failed'); },
    persist: async () => { throw new Error('must not save'); }
  }), /provider failed/);
  assert.equal(requests, 1);
  assert.equal(state.dailySummaries['2026-09-02'], undefined);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(requests, 1);
});

test('persist failure rolls back a generated summary', async () => {
  const state = boundaryState();
  await assert.rejects(() => ensureDailySummary({ scheduled: true }, { state, now: scheduledNow, generate: async () => '生成完成', persist: async () => { throw new Error('disk failed'); } }), /disk failed/);
  assert.equal(state.dailySummaries['2026-09-02'], undefined);
});

test('generateAutoSummary uses only the scheduled yesterday path', async () => {
  const state = boundaryState();
  let requests = 0;
  let date = '';
  await runScheduledAutoSummary({ state, now: scheduledNow, generate: async (_requestState, targetDate) => { requests += 1; date = targetDate; return '凌晨任务小结'; }, persist: async () => {} });
  assert.equal(requests, 1);
  assert.equal(date, '2026-09-02');
});

test('Calendar explicit date string remains a user-triggered compatible request', async () => {
  const state = boundaryState();
  let requests = 0;
  await ensureDailySummary('2026-09-02', { state, now: scheduledNow, generate: async () => { requests += 1; return '用户点击生成'; }, persist: async () => {} });
  assert.equal(requests, 1);
  assert.equal(state.dailySummaries['2026-09-02'].text, '用户点击生成');
});

test('explicit force regeneration replaces a cached summary and rolls back on persist failure', async () => {
  const state = boundaryState();
  state.dailySummaries['2026-09-02'] = { text: '旧小结', updatedAt: 1 };
  let requests = 0;
  await ensureDailySummary({ explicit: true, force: true, date: '2026-09-02' }, { state, now: scheduledNow, generate: async () => { requests += 1; return '更新后的小结'; }, persist: async () => {} });
  assert.equal(requests, 1);
  assert.equal(state.dailySummaries['2026-09-02'].text, '更新后的小结');

  const previous = state.dailySummaries['2026-09-02'];
  await assert.rejects(() => ensureDailySummary({ explicit: true, force: true, date: '2026-09-02' }, { state, now: scheduledNow, generate: async () => '不应保留', persist: async () => { throw new Error('disk failed'); } }), /disk failed/);
  assert.equal(state.dailySummaries['2026-09-02'], previous);
});

test('scheduleAiRefresh remains a no-network compatibility helper', () => {
  let requests = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { requests += 1; };
  try {
    assert.equal(scheduleAiRefresh(), null);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('dailySummaryRequestState strips raw identifiers, names, memory, finance and images', () => {
  const requestState = dailySummaryRequestState(boundaryState(), '2026-09-02');
  const serialized = JSON.stringify(requestState);
  assert.doesNotMatch(serialized, /private-project-id|private-habit-id|不应外发|999|private-image-data/);
  assert.match(serialized, /整理复习材料|备考|calm/);
});
