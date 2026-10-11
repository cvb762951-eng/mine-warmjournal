import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';

// 向后兼容的旧导出（deepseek 默认值）
export const AI_BASE_URL = 'https://api.deepseek.com/chat/completions';
export const AI_MODEL = 'deepseek-chat';

// Provider 表：均为 OpenAI 兼容的 /chat/completions 端点
export const PROVIDERS = {
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/chat/completions', defaultModel: 'deepseek-chat' },
  qwen:     { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', defaultModel: 'qwen-plus' },
  moonshot: { label: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1/chat/completions', defaultModel: 'moonshot-v1-8k' },
  zhipu:    { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', defaultModel: 'glm-4-plus' },
  openai:   { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1/chat/completions', defaultModel: 'gpt-4o-mini' },
  gemini:   { label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', defaultModel: 'gemini-2.0-flash' },
  custom:   { label: '自定义', baseUrl: '', defaultModel: '' }
};

const resolve = (name, fallback) => PROVIDERS[name] ? name : fallback;
const STREAMING_PROVIDERS = new Set(['deepseek', 'qwen', 'moonshot', 'zhipu', 'openai', 'gemini']);
let aiStreamPlugin = null;

const getAiStreamPlugin = () => aiStreamPlugin || (aiStreamPlugin = registerPlugin('AiStream'));
const abortError = () => {
  if (typeof DOMException === 'function') return new DOMException('请求已取消', 'AbortError');
  const error = new Error('请求已取消');
  error.name = 'AbortError';
  return error;
};
const throwIfAborted = signal => { if (signal?.aborted) throw abortError(); };
const withAbort = (promise, signal) => {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise((resolvePromise, rejectPromise) => {
    const onAbort = () => rejectPromise(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(resolvePromise, rejectPromise).finally(() => signal.removeEventListener('abort', onAbort));
  });
};

export function resolveAiRequestConfig(state) {
  const settings = state?.settings || {};
  const provider = resolve(settings.aiProvider, 'deepseek');
  const url = settings.aiBaseUrl || PROVIDERS[provider].baseUrl;
  const model = settings.aiModel || PROVIDERS[provider].defaultModel;
  if (!settings.aiApiKey) throw new Error('尚未配置 AI API Key，请到「设置与数据 → AI 助手」填写。');
  if (!url) throw new Error('尚未配置 AI 接口地址，请到「设置与数据 → AI 助手」填写（选择「自定义」提供商时必填）。');
  return { settings, provider, url, model, key: settings.aiApiKey };
}

async function postJson(url, headers, body, signal) {
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.post({ url, headers, data: body });
    return { status: res.status, data: res.data };
  }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { status: res.status, data };
}

async function requestJson(url, key, body, emptyMsg, signal) {
  let res;
  try {
    res = await postJson(url, {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    }, body, signal);
  } catch (error) {
    if (!Capacitor.isNativePlatform()) {
      throw new Error('浏览器预览可能因跨域限制无法直接调用 AI，请在安装后的 App 内使用。');
    }
    throw new Error(`网络请求失败：${error.message || error}`);
  }

  if (res.status !== 200) {
    const msg = res.data?.error?.message || res.data?.error || `请求失败（${res.status}）`;
    throw new Error(msg);
  }
  const content = res.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(emptyMsg);
  return content;
}

export async function chat(state, messages, { temperature = 0.7, maxTokens = 1200, signal } = {}) {
  const { url, model, key } = resolveAiRequestConfig(state);
  return requestJson(url, key, { model, messages, temperature, max_tokens: maxTokens }, 'AI 返回为空，请稍后重试。', signal);
}

function streamDelta(data) {
  let payload;
  try { payload = JSON.parse(data); }
  catch { throw new Error('流式响应 JSON 解析失败'); }
  if (payload?.error) throw new Error(payload.error?.message || String(payload.error));
  const content = payload?.choices?.[0]?.delta?.content;
  return typeof content === 'string' ? content : '';
}

function completeResponseContent(text) {
  let payload;
  try { payload = JSON.parse(text); }
  catch { throw new Error('完整响应 JSON 解析失败'); }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content) throw new Error('AI 返回为空，请稍后重试。');
  return content;
}

export async function* chatStreamBrowser({ url, key, body, signal, fetchImpl = fetch }) {
  throwIfAborted(signal);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'Accept': 'text/event-stream' },
      body: JSON.stringify({ ...body, stream: true }),
      signal
    });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw abortError();
    throw new Error(`网络请求失败：${error?.message || error}`);
  }
  const status = Number(response.status) || 0;
  if (!(status >= 200 && status < 300)) {
    const detail = await response.text().catch(() => '');
    let message = detail;
    try { const parsed = JSON.parse(detail); message = parsed?.error?.message || parsed?.error || detail; } catch { /* keep raw detail */ }
    throw new Error(message || `请求失败（${status}）`);
  }
  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    throwIfAborted(signal);
    yield completeResponseContent(await response.text());
    return;
  }
  if (!response.body?.getReader) throw new Error('浏览器未返回可读取的流式响应');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  const parseLine = line => {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!normalized.startsWith('data:')) return null;
    return normalized.slice(5).trimStart();
  };
  try {
    while (!completed) {
      throwIfAborted(signal);
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const data = parseLine(line);
        if (data === null || data === '') continue;
        if (data === '[DONE]') { completed = true; break; }
        const content = streamDelta(data);
        if (content) yield content;
      }
    }
    if (!completed) {
      buffer += decoder.decode();
      const data = parseLine(buffer);
      if (data === '[DONE]') completed = true;
      else if (data) {
        const content = streamDelta(data);
        if (content) yield content;
      }
    }
    if (!completed) throw new Error('流式响应未正常结束');
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw abortError();
    throw error;
  } finally {
    try { reader.releaseLock?.(); } catch { /* already released */ }
  }
}

export async function* chatStreamAndroid({ plugin = getAiStreamPlugin(), requestId, url, key, body, signal }) {
  throwIfAborted(signal);
  const queue = [];
  let resume = null;
  let completed = false;
  let started = false;
  const listeners = [];
  const push = event => {
    if (resume) { const resolveNext = resume; resume = null; resolveNext(event); }
    else queue.push(event);
  };
  const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolveNext => { resume = resolveNext; });
  const onAbort = () => push({ type: 'abort' });
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    listeners.push(await plugin.addListener('aiStreamChunk', payload => { if (payload?.requestId === requestId) push({ type: 'chunk', data: payload.data }); }));
    listeners.push(await plugin.addListener('aiStreamDone', payload => { if (payload?.requestId === requestId) push({ type: 'done' }); }));
    listeners.push(await plugin.addListener('aiStreamError', payload => { if (payload?.requestId === requestId) push({ type: 'error', message: payload.message }); }));
    throwIfAborted(signal);
    started = true;
    await plugin.start({ requestId, url, apiKey: key, body: { ...body, stream: true } });
    while (!completed) {
      const event = await next();
      if (event.type === 'abort') throw abortError();
      if (event.type === 'error') throw new Error(event.message || 'Android 流式请求失败');
      if (event.type === 'done') { completed = true; break; }
      if (event.type === 'chunk') {
        if (event.data === '[DONE]') { completed = true; break; }
        const content = streamDelta(String(event.data || ''));
        if (content) yield content;
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (started && !completed) await plugin.cancel({ requestId }).catch(() => {});
    await Promise.allSettled(listeners.map(listener => listener?.remove?.()));
  }
}

export async function* chatStream(state, messages, { temperature = 0.7, maxTokens = 1200, signal, customStreamSupported = false } = {}) {
  const { provider, url, model, key } = resolveAiRequestConfig(state);
  throwIfAborted(signal);
  if (provider === 'custom' && !customStreamSupported) {
    const content = await withAbort(chat(state, messages, { temperature, maxTokens, signal }), signal);
    throwIfAborted(signal);
    yield content;
    return;
  }
  if (!STREAMING_PROVIDERS.has(provider) && !customStreamSupported) throw new Error('当前 AI 模型不支持流式聊天');
  const body = { model, messages, temperature, max_tokens: maxTokens, stream: true };
  if (Capacitor.isNativePlatform()) {
    const requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    yield* chatStreamAndroid({ requestId, url, key, body, signal });
  } else {
    yield* chatStreamBrowser({ url, key, body, signal });
  }
}

export async function vision(state, content, { maxTokens = 600 } = {}) {
  const { url, model, key } = resolveAiRequestConfig(state);
  try {
    return await requestJson(url, key, { model, messages: [{ role: 'user', content }], max_tokens: maxTokens }, 'AI 图片响应为空，请稍后重试。');
  } catch (error) {
    throw new Error(`图片请求失败：${error.message || error}。当前模型可能不支持图片，请检查模型能力或配置。`);
  }
}
