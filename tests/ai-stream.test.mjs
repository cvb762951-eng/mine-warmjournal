import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chatStream, chatStreamAndroid, chatStreamBrowser } from '../ai/provider.js';
import { runAiStreamLifecycle } from '../ai/generate.js';

const encoder = new TextEncoder();
const delta = content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`;

function streamResponse(chunks, { status = 200, contentType = 'text/event-stream', text = '' } = {}) {
  let index = 0;
  return {
    status,
    headers: { get: name => name.toLowerCase() === 'content-type' ? contentType : '' },
    body: {
      getReader: () => ({
        read: async () => index < chunks.length ? { value: encoder.encode(chunks[index++]), done: false } : { value: undefined, done: true },
        releaseLock() {}
      })
    },
    text: async () => text
  };
}

async function collect(stream) {
  const parts = [];
  for await (const part of stream) parts.push(part);
  return parts;
}

const browserArgs = fetchImpl => ({
  url: 'https://example.invalid/chat', key: 'key',
  body: { model: 'test', messages: [] }, fetchImpl
});

test('browser SSE yields one complete data chunk', async () => {
  let sentBody;
  const fetchImpl = async (_url, options) => { sentBody = JSON.parse(options.body); return streamResponse([`${delta('你好')}data: [DONE]\n`]); };
  assert.deepEqual(await collect(chatStreamBrowser(browserArgs(fetchImpl))), ['你好']);
  assert.equal(sentBody.stream, true);
});

test('browser SSE reassembles JSON split across network chunks', async () => {
  const line = delta('拆包正常');
  const fetchImpl = async () => streamResponse([line.slice(0, 17), line.slice(17, 31), `${line.slice(31)}data: [DONE]\n`]);
  assert.deepEqual(await collect(chatStreamBrowser(browserArgs(fetchImpl))), ['拆包正常']);
});

test('browser SSE handles multiple data lines glued in one network chunk', async () => {
  const fetchImpl = async () => streamResponse([`${delta('甲')}${delta('乙')}data: [DONE]\n`]);
  assert.deepEqual(await collect(chatStreamBrowser(browserArgs(fetchImpl))), ['甲', '乙']);
});

test('browser SSE stops at DONE and does not parse trailing bytes', async () => {
  const fetchImpl = async () => streamResponse([`${delta('完成')}data: [DONE]\ndata: not-json\n`]);
  assert.deepEqual(await collect(chatStreamBrowser(browserArgs(fetchImpl))), ['完成']);
});

test('browser SSE ignores empty delta content', async () => {
  const fetchImpl = async () => streamResponse([`${delta('')}data: [DONE]\n`]);
  assert.deepEqual(await collect(chatStreamBrowser(browserArgs(fetchImpl))), []);
});

test('browser SSE throws a clear HTTP error', async () => {
  const fetchImpl = async () => streamResponse([], { status: 429, contentType: 'application/json', text: '{"error":{"message":"rate limited"}}' });
  await assert.rejects(() => collect(chatStreamBrowser(browserArgs(fetchImpl))), /rate limited/);
});

test('browser SSE throws on invalid JSON', async () => {
  const fetchImpl = async () => streamResponse(['data: not-json\n']);
  await assert.rejects(() => collect(chatStreamBrowser(browserArgs(fetchImpl))), /流式响应 JSON 解析失败/);
});

test('browser SSE respects an AbortSignal before sending', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return streamResponse([]); };
  await assert.rejects(() => collect(chatStreamBrowser({ ...browserArgs(fetchImpl), signal: controller.signal })), error => error.name === 'AbortError');
  assert.equal(calls, 0);
});

test('browser stream falls back once to a complete application/json response', async () => {
  const text = JSON.stringify({ choices: [{ message: { content: '完整回复' } }] });
  const fetchImpl = async () => streamResponse([], { contentType: 'application/json; charset=utf-8', text });
  assert.deepEqual(await collect(chatStreamBrowser(browserArgs(fetchImpl))), ['完整回复']);
});

test('custom provider uses one non-stream request and never retries as SSE', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let requestBody = '';
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    requestBody = String(options.body || '');
    return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'custom 完整回复' } }] }) };
  };
  try {
    const state = { settings: { aiProvider: 'custom', aiBaseUrl: 'https://example.invalid/custom', aiApiKey: 'key', aiModel: 'model' } };
    assert.deepEqual(await collect(chatStream(state, [{ role: 'user', content: 'hi' }])), ['custom 完整回复']);
    assert.equal(calls, 1);
    assert.equal(JSON.parse(requestBody).stream, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Android stream registers before start, filters requestId and removes every listener', async () => {
  const callbacks = new Map();
  const removed = [];
  let cancelCalls = 0;
  const plugin = {
    addListener: async (name, callback) => {
      callbacks.set(name, callback);
      return { remove: async () => { removed.push(name); } };
    },
    start: async ({ requestId }) => {
      assert.equal(callbacks.size, 3);
      callbacks.get('aiStreamChunk')({ requestId: 'other', data: JSON.stringify({ choices: [{ delta: { content: '忽略' } }] }) });
      callbacks.get('aiStreamChunk')({ requestId, data: JSON.stringify({ choices: [{ delta: { content: '原生流' } }] }) });
      callbacks.get('aiStreamDone')({ requestId });
    },
    cancel: async () => { cancelCalls += 1; }
  };
  const parts = await collect(chatStreamAndroid({ plugin, requestId: 'req-1', url: 'https://example.invalid', key: 'key', body: { model: 'm' } }));
  assert.deepEqual(parts, ['原生流']);
  assert.deepEqual(removed.sort(), ['aiStreamChunk', 'aiStreamDone', 'aiStreamError']);
  assert.equal(cancelCalls, 0);
});

test('Android stream errors cancel the request and still remove all listeners', async () => {
  const callbacks = new Map();
  let removed = 0;
  let cancelled = 0;
  const plugin = {
    addListener: async (name, callback) => { callbacks.set(name, callback); return { remove: async () => { removed += 1; } }; },
    start: async ({ requestId }) => { callbacks.get('aiStreamError')({ requestId, message: 'native failed' }); },
    cancel: async ({ requestId }) => { assert.equal(requestId, 'req-error'); cancelled += 1; }
  };
  await assert.rejects(() => collect(chatStreamAndroid({ plugin, requestId: 'req-error', url: 'https://example.invalid', key: 'key', body: {} })), /native failed/);
  assert.equal(cancelled, 1);
  assert.equal(removed, 3);
});

test('Android abort cancels the matching request and removes listeners', async () => {
  let removed = 0;
  let cancelled = '';
  const plugin = {
    addListener: async () => ({ remove: async () => { removed += 1; } }),
    start: async () => {},
    cancel: async ({ requestId }) => { cancelled = requestId; }
  };
  const controller = new AbortController();
  const iterator = chatStreamAndroid({ plugin, requestId: 'req-abort', url: 'https://example.invalid', key: 'key', body: {}, signal: controller.signal });
  const pending = iterator.next();
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(() => pending, error => error.name === 'AbortError');
  assert.equal(cancelled, 'req-abort');
  assert.equal(removed, 3);
});

test('stream lifecycle appends chunks and persists exactly once after completion', async () => {
  const history = [{ role: 'user', content: '问题' }];
  let persistCount = 0;
  async function* source() { yield '第一段'; yield '第二段'; }
  const result = await runAiStreamLifecycle(history, source(), { persist: () => { persistCount += 1; } });
  assert.equal(result.status, 'complete');
  assert.equal(history[1].content, '第一段第二段');
  assert.equal(history[1].streaming, false);
  assert.equal(persistCount, 1);
});

test('stopping after a partial reply keeps the text and marks it cancelled', async () => {
  const history = [{ role: 'user', content: '问题' }];
  const controller = new AbortController();
  async function* source() { yield '已经收到'; if (controller.signal.aborted) throw Object.assign(new Error('stop'), { name: 'AbortError' }); await new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('stop'), { name: 'AbortError' })), { once: true })); }
  const result = await runAiStreamLifecycle(history, source(), { signal: controller.signal, onUpdate: phase => { if (phase === 'chunk') controller.abort(); }, persist() {} });
  assert.equal(result.status, 'cancelled');
  assert.equal(history[1].content, '已经收到');
  assert.equal(history[1].cancelled, true);
});

test('stopping with no partial reply removes only the assistant placeholder', async () => {
  const history = [{ role: 'user', content: '问题' }];
  const controller = new AbortController();
  controller.abort();
  async function* source() { throw Object.assign(new Error('stop'), { name: 'AbortError' }); }
  const result = await runAiStreamLifecycle(history, source(), { signal: controller.signal, persist() {} });
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(history, [{ role: 'user', content: '问题' }]);
});

test('network error keeps the user message and creates the existing failure state', async () => {
  const history = [{ role: 'user', content: '不能丢失' }];
  async function* source() { throw new Error('network down'); }
  const result = await runAiStreamLifecycle(history, source(), { persist() {} });
  assert.equal(result.status, 'failed');
  assert.equal(history[0].content, '不能丢失');
  assert.equal(history[1].failed, true);
});

test('partial network error retains text as interrupted and retryable', async () => {
  const history = [{ role: 'user', content: '问题' }];
  async function* source() { yield '部分回复'; throw new Error('socket closed'); }
  const result = await runAiStreamLifecycle(history, source(), { persist() {} });
  assert.equal(result.status, 'interrupted');
  assert.equal(history[1].content, '部分回复');
  assert.equal(history[1].interrupted, true);
});

test('view keeps image paths non-streaming and cancels when leaving chat', async () => {
  const source = await readFile(new URL('../views/ai.js', import.meta.url), 'utf8');
  assert.match(source, /const reply = await aiChat\(state, aiMessagesForModel\(aiHistory\.slice\(-12\)\)\)/);
  assert.match(source, /await replyAsAssistant\(\{ stream: false \}\)/);
  assert.match(source, /if \(aiChatExpanded\) stopAiStream\(\)/);
  assert.match(source, /registerHelper\('isAiChatActive', \(\) => aiChatExpanded\)/);
  assert.match(source, /box\.innerHTML = aiMessagesHtml\(\);[\s\S]*?bindAiMessageActions\(\)/);
  assert.match(source, /filter\(message => !message\.failed && !message\.interrupted && !message\.cancelled && !message\.streaming\)/);
  assert.doesNotMatch(source, /setInterval\([^)]*(?:chunk|content|reply)/s);
});
