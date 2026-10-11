import { uid } from '../core.js';
import { buildAiContext } from './context.js';
import { chat } from './provider.js';

const MEMORY_LIMIT = 200;
export const MEMORY_SOURCES = ['conversation', 'data', 'photo', 'sync', 'manual', 'suggestion'];

function parseMemories(text) {
  try {
    const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const arr = JSON.parse(cleaned);
    return Array.isArray(arr) ? arr.map(item => String(item).trim()).filter(Boolean).slice(0, 10) : [];
  } catch {
    return [];
  }
}

// ---- 统一写入 / 去重 / 导出导入（任务 2A）----

// 两条文本是否视为重复：完全相等，或最长公共子串比例 > 0.85（高重叠）
export function isDuplicate(existing, incoming) {
  const a = String(existing || '').trim();
  const b = String(incoming || '').trim();
  if (!a || !b) return false;
  if (a === b) return true;
  return lcsRatio(a, b) > 0.85;
}

function lcsRatio(a, b) {
  const m = a.length, n = b.length;
  const shorter = Math.min(m, n);
  if (!shorter) return 0;
  let prev = new Array(n + 1).fill(0);
  let max = 0;
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > max) max = cur[j];
      }
    }
    prev = cur;
  }
  return max / shorter;
}

// 统一写入助手：逐条去重后写入，带 source 标签，超上限删最旧的。返回实际新增条数。
export function addMemories(state, texts, source = 'manual') {
  const memories = state.aiMemory || [];
  let added = 0;
  for (const raw of texts) {
    const text = String(raw || '').trim();
    if (!text) continue;
    const duplicate = memories.find(item => isDuplicate(item.text, text));
    if (duplicate) {
      duplicate.updatedAt = Date.now();
      continue;
    }
    memories.push({
      id: uid(),
      text,
      source: String(source || 'manual'),
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    added++;
  }
  if (memories.length > MEMORY_LIMIT) {
    state.aiMemory = memories
      .slice()
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .slice(memories.length - MEMORY_LIMIT);
  } else {
    state.aiMemory = memories;
  }
  return added;
}

// 导出：把记忆序列化为 JSON 字符串，由调用方触发文件下载
export function exportMemories(state) {
  const payload = {
    format: 'mine-ai-memory',
    version: 1,
    exportedAt: new Date().toISOString(),
    memories: (state.aiMemory || []).map(item => ({
      id: String(item.id || ''),
      text: String(item.text || ''),
      source: String(item.source || ''),
      createdAt: Number(item.createdAt) || 0,
      updatedAt: Number(item.updatedAt) || Number(item.createdAt) || 0
    }))
  };
  return JSON.stringify(payload, null, 2);
}

// R3：用户确认采纳建议后回写长期记忆（摘要/待办），来源标注为 'suggestion'。
// 走现有 addMemories 去重体系；返回实际新增条数。
export function applySuggestion(state, { summary = '', todos = [] } = {}) {
  const texts = [];
  const summaryText = String(summary || '').trim();
  if (summaryText) texts.push(`用户记录摘要：${summaryText}`);
  for (const todo of (todos || [])) {
    const text = String(todo || '').trim();
    if (text) texts.push(`用户待办事项：${text}`);
  }
  if (!texts.length) return 0;
  return addMemories(state, texts, 'suggestion');
}

// 导入：解析 JSON（数组或 {memories:[...]} 信封），逐条 addMemories 去重合并，返回实际导入条数
export function importMemories(state, json) {  let parsed;
  try {
    parsed = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    throw new Error('记忆文件不是有效的 JSON');
  }
  const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.memories) ? parsed.memories : null);
  if (!list) throw new Error('记忆文件格式不正确：找不到记忆列表');
  let imported = 0;
  for (const item of list) {
    const text = String(item?.text || '').trim();
    if (!text) continue;
    const source = MEMORY_SOURCES.includes(item?.source) ? item.source : 'manual';
    imported += addMemories(state, [text], source);
  }
  return imported;
}

export async function aiExtractMemories(state, conversation) {
  const key = state.settings.aiApiKey;
  if (!key) return { add: [], remove: [] };
  const existing = (state.aiMemory || []).map(item => item.text);
  const system = `你是「Mine」App 的记忆提炼器。请从下面的对话中，提炼出关于用户的、值得长期记住的新认知（偏好、习惯、目标、性格、重要事件等），让 AI 越来越了解用户。规则：
- 只提炼新信息，不要重复「已有记忆」里已经有的
- 每条用简洁的中文陈述，30 字以内，第三人称（如"用户在备考考研"）
- 当用户在对话中明确否定或纠正你之前的理解（如"不是X，是Y""你记错了""我其实…"）时：把被纠正的旧记忆原文（尽量用「已有记忆」里的原话）放进 remove，把正确的新认知放进 add
- 没有值得记的、也没有纠正，就返回 {"add":[],"remove":[]}
- 只返回 JSON 对象，格式 {"add":["..."],"remove":["..."]}，两者都可以是空数组，不要其他文字
已有记忆：${existing.join('；') || '（无）'}`;

  const reply = await chat(state, [
    { role: 'system', content: system },
    { role: 'user', content: conversation }
  ], { temperature: 0.4, maxTokens: 500 });

  return parseSyncResult(reply);
}

export async function aiExtractFromData(state, photoDescriptions = []) {
  const key = state.settings.aiApiKey;
  if (!key) return [];
  const context = buildAiContext(state);
  const photoBlock = photoDescriptions.length
    ? `\n用户最近的照片：\n${photoDescriptions.map((desc, i) => `${i + 1}. ${desc}`).join('\n')}`
    : '';
  const existing = (state.aiMemory || []).map(item => item.text);
  const system = `你是「Mine」App 的观察者。下面是用户记录的真实数据（学习时长、各科投入、日记、习惯、书影音、待办、倒数日，以及照片内容等）。请从这些数据中，提炼出关于用户的、值得长期记住的认知——比如他的目标、生活方式、偏好、情绪变化、学习习惯、兴趣等。规则：
- 只提炼数据中真实反映的信息，不要臆测、不要编造
- 只提炼新信息，不要重复「已有记忆」里已经有的
- 每条用简洁的中文陈述，30 字以内，第三人称（如"用户近期数学投入明显增加"）
- 提炼 3～6 条最有价值的即可，没有值得记的就返回空数组 []
- 只返回 JSON 数组，不要其他文字
已有记忆：${existing.join('；') || '（无）'}

用户的数据：
${context}${photoBlock}`;

  const reply = await chat(state, [
    { role: 'system', content: system },
    { role: 'user', content: '请根据以上数据，提炼你对用户的了解。' }
  ], { temperature: 0.5, maxTokens: 600 });

  return parseMemories(reply);
}

export async function aiRememberPhoto(state, imageDesc) {
  const key = state.settings.aiApiKey;
  if (!key) return [];
  const existing = (state.aiMemory || []).map(item => item.text);
  const system = `你是「Mine」App 的观察者。用户刚记录了一张照片，画面内容是：${imageDesc}。请从这个画面里，提炼出关于用户生活方式的、值得记住的认知（比如学习环境、兴趣爱好、生活习惯、当下状态等）。只提炼真实反映的信息，不要臆测。没有值得记的就返回空数组 []。只返回 JSON 数组，不要其他文字。已有记忆：${existing.join('；') || '（无）'}`;

  const reply = await chat(state, [
    { role: 'system', content: system },
    { role: 'user', content: '从这张照片里，你能了解用户什么？' }
  ], { temperature: 0.4, maxTokens: 300 });

  return parseMemories(reply);
}

function parseSyncResult(text) {
  try {
    const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const obj = JSON.parse(cleaned);
    const clean = list => Array.isArray(list) ? list.map(item => String(item).trim()).filter(Boolean) : [];
    return { add: clean(obj.add), remove: clean(obj.remove) };
  } catch {
    return { add: [], remove: [] };
  }
}

export async function aiSyncMemory(state) {
  const key = state.settings.aiApiKey;
  if (!key) return { add: [], remove: [] };
  const context = buildAiContext(state);
  const existing = (state.aiMemory || []).map(item => item.text);
  const system = `你是「Mine」App 的记忆管理员。用户刚刚增加或删除了某些记录，请对比「用户当前的数据」和「现有记忆」，做两件事：
1. add：从当前数据里提炼出新的、值得记住的认知（现有记忆里没有的）；
2. remove：找出「现有记忆」里已经与当前数据明显矛盾、或已完全失去依据的记忆（比如记忆里提到的内容，用户已经删掉了）。
规则：
- 只返回 JSON，格式 {"add":["..."],"remove":["..."]}，两者都可以是空数组
- remove 要谨慎：只有明显矛盾或无依据才移除，拿不准的保留
- 每条 30 字以内，第三人称
现有记忆：${existing.join('；') || '（无）'}

用户当前的数据：
${context}`;

  const reply = await chat(state, [
    { role: 'system', content: system },
    { role: 'user', content: '请同步一下你对用户的记忆。' }
  ], { temperature: 0.4, maxTokens: 700 });

  return parseSyncResult(reply);
}
