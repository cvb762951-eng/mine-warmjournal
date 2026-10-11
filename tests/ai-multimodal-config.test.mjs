import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

const { vision } = await import('../ai/provider.js');
const { makeDefaultState, migrateState } = await import('../model.js');
const { createBackupPayload, validateBackupPayload, SECTIONS } = await import('../storage.js');
const { encryptBackupEnvelope, decryptBackupEnvelope } = await import('../backup.js');
const { getSubmitHandler, setState } = await import('../core.js');
const { aiView } = await import('../views/ai.js');
const viewSource = await readFile(new URL('../views/ai.js', import.meta.url), 'utf8');
const providerSource = await readFile(new URL('../ai/provider.js', import.meta.url), 'utf8');

function stateWithMemory() {
  const state = makeDefaultState(new Date('2026-09-04T12:00:00'));
  state.settings.aiEnabled = true;
  state.settings.aiProvider = 'deepseek';
  state.settings.aiBaseUrl = '';
  state.settings.aiModel = 'deepseek-chat';
  state.settings.aiApiKey = 'old-ai-key';
  state.settings.visionProvider = 'legacy-vision-provider';
  state.settings.visionBaseUrl = 'https://legacy.invalid/vision';
  state.settings.visionModel = 'legacy-vision-model';
  state.settings.visionApiKey = 'legacy-vision-key';
  state.aiMemory = [{ id: 'memory-1', text: '偏好安静环境', source: 'manual', createdAt: 1, updatedAt: 1 }];
  state.aiHistory = [{ id: 'user-1', role: 'user', content: '记住我的目标' }, { id: 'assistant-1', role: 'assistant', content: '好的' }];
  state.weeklyInsightReports = [{ id: 'week-1', weekStart: '2026-08-24', weekEnd: '2026-08-30', status: 'ready' }];
  state.dailySummaries = { '2026-09-03': { id: 'daily-1', text: '昨天的小结', createdAt: 1, updatedAt: 1 } };
  return state;
}

test('vision uses only ai connection fields and ignores every legacy vision field', async () => {
  const state = stateWithMemory();
  state.settings.aiProvider = 'custom';
  state.settings.aiBaseUrl = 'https://unified.invalid/chat';
  state.settings.aiModel = 'multimodal-model';
  state.settings.aiApiKey = 'unified-key';
  let requestUrl = '';
  let requestHeaders;
  let requestBody;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requestUrl = String(url);
    requestHeaders = options.headers;
    requestBody = JSON.parse(options.body);
    return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '图片内容' } }] }) };
  };
  try {
    const content = [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }, { type: 'text', text: '描述图片' }];
    assert.equal(await vision(state, content), '图片内容');
    assert.equal(requestUrl, 'https://unified.invalid/chat');
    assert.equal(requestHeaders.Authorization, 'Bearer unified-key');
    assert.equal(requestBody.model, 'multimodal-model');
    assert.deepEqual(requestBody.messages, [{ role: 'user', content }]);
    assert.doesNotMatch(JSON.stringify({ requestUrl, requestHeaders, requestBody }), /legacy-vision/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('image request failure explains that the current model may not support images', async () => {
  const state = stateWithMemory();
  state.settings.aiProvider = 'custom';
  state.settings.aiBaseUrl = 'https://unified.invalid/chat';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 400, text: async () => JSON.stringify({ error: { message: 'unsupported content' } }) });
  try {
    await assert.rejects(() => vision(state, []), /当前模型可能不支持图片，请检查模型能力或配置/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('saving a new provider changes only unified connection and companion settings', async () => {
  const state = stateWithMemory();
  setState(state);
  const preserved = structuredClone({
    aiMemory: state.aiMemory,
    aiHistory: state.aiHistory,
    weeklyInsightReports: state.weeklyInsightReports,
    dailySummaries: state.dailySummaries,
    legacyVision: {
      provider: state.settings.visionProvider,
      baseUrl: state.settings.visionBaseUrl,
      model: state.settings.visionModel,
      key: state.settings.visionApiKey
    }
  });
  const data = new FormData();
  for (const [key, value] of Object.entries({ aiEnabled: 'on', aiProvider: 'custom', aiBaseUrl: 'https://new.invalid/chat', aiModel: 'new-multimodal-model', aiApiKey: 'new-ai-key', aiEmotionCare: 'on', cdNodeReminder: 'on' })) data.set(key, value);
  let requests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { requests += 1; throw new Error('unexpected request'); };
  try {
    await getSubmitHandler('ai-settings-form')(data);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(requests, 0);
  assert.deepEqual(state.aiMemory, preserved.aiMemory);
  assert.deepEqual(state.aiHistory, preserved.aiHistory);
  assert.deepEqual(state.weeklyInsightReports, preserved.weeklyInsightReports);
  assert.deepEqual(state.dailySummaries, preserved.dailySummaries);
  assert.deepEqual({ provider: state.settings.visionProvider, baseUrl: state.settings.visionBaseUrl, model: state.settings.visionModel, key: state.settings.visionApiKey }, preserved.legacyVision);
  assert.deepEqual({ provider: state.settings.aiProvider, baseUrl: state.settings.aiBaseUrl, model: state.settings.aiModel, key: state.settings.aiApiKey }, { provider: 'custom', baseUrl: 'https://new.invalid/chat', model: 'new-multimodal-model', key: 'new-ai-key' });
});

test('settings UI exposes exactly one multimodal provider, model, base URL and key', () => {
  for (const [tag, name] of [['select', 'aiProvider'], ['input', 'aiModel'], ['input', 'aiBaseUrl'], ['input', 'aiApiKey']]) assert.equal((viewSource.match(new RegExp(`<${tag} name="${name}"`, 'g')) || []).length, 1, name);
  assert.doesNotMatch(viewSource, /name="vision(?:Provider|Model|BaseUrl|ApiKey)"|文字模型|视觉模型/);
  assert.match(viewSource, /多模态模型/);
  assert.match(viewSource, /同一模型负责文字对话、图片理解、周报、每日小结与记忆提炼/);
});

test('only aiApiKey enables the image button and image runtime validation', () => {
  const state = stateWithMemory();
  state.settings.aiApiKey = 'only-unified-key';
  state.settings.visionApiKey = '';
  setState(state);
  const html = aiView();
  assert.match(html, /id="ai-add-image" aria-label="添加图片" ><span/);
  assert.match(html, /placeholder="输入消息…"/);
  assert.doesNotMatch(html, /复盘本周学习|问我任何关于生活的事，或附上图片/);
  assert.doesNotMatch(providerSource + viewSource, /settings\.vision(?:Provider|BaseUrl|Model|ApiKey)/);
});

test('page render and provider change make zero network requests', async () => {
  const state = stateWithMemory();
  setState(state);
  let requests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { requests += 1; throw new Error('unexpected request'); };
  try {
    aiView();
    const data = new FormData();
    data.set('aiEnabled', 'on');
    data.set('aiProvider', 'openai');
    data.set('aiBaseUrl', '');
    data.set('aiModel', 'gpt-4o');
    data.set('aiApiKey', 'new-key');
    await getSubmitHandler('ai-settings-form')(data);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('memory and history survive migration, section backup and encrypted round-trip', async () => {
  const state = stateWithMemory();
  // 2026-10-20：aiHistory 每条现在带 at（发出时刻），用于给 AI 判断消息新旧。
  // 因此这里比对内容字段而不是整条深等 —— at 会在归一化时被补齐/保留。
  const contentOnly = list => (list || []).map(item => ({ role: item.role, content: item.content, id: item.id, image: item.image }));
  const migrated = migrateState(structuredClone(state));
  assert.deepEqual(migrated.aiMemory, state.aiMemory);
  assert.deepEqual(contentOnly(migrated.aiHistory), contentOnly(state.aiHistory));
  // 这些旧记录原本没有时间，迁移不能伪造发送时刻。
  (migrated.aiHistory || []).forEach(item => assert.equal(item.at, 0, '旧消息保持时间未知'));
  assert.ok(SECTIONS.includes('aiMemory') && SECTIONS.includes('aiHistory'));
  const payload = await createBackupPayload(state);
  const restored = await validateBackupPayload(payload);
  assert.deepEqual(restored.aiMemory, state.aiMemory);
  assert.deepEqual(contentOnly(restored.aiHistory), contentOnly(state.aiHistory));
  const encrypted = await encryptBackupEnvelope(JSON.stringify(payload), 'multimodal-memory-test');
  const decrypted = JSON.parse(await decryptBackupEnvelope(encrypted, 'multimodal-memory-test'));
  assert.deepEqual(decrypted.data.aiMemory, state.aiMemory);
  assert.deepEqual(contentOnly(decrypted.data.aiHistory), contentOnly(state.aiHistory));
});

test('failed, cancelled and interrupted messages remain excluded from memory extraction', () => {
  assert.match(viewSource, /filter\(message => !message\.failed && !message\.interrupted && !message\.cancelled && !message\.streaming\)/);
});
