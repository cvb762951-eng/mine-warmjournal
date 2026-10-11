import { periodSummary, minutesOnDate, todayCompletion, todosForDate, dateKey, ledgerSummary, LEDGER_CATEGORIES } from '../model.js';
import { buildAiContext, buildMoodSummary, fmt } from './context.js';
import { chat, chatStream, vision } from './provider.js';
import { retrieveSemanticContext } from './semantic.js';

// 来源优先级：对话/数据提炼的记忆更贴近用户本人，照片观察次之
const MEMORY_SOURCE_PRIORITY = { conversation: 3, data: 3, sync: 2, manual: 2, photo: 1 };

// 统一记忆块助手：把长期记忆拼成可注入 system prompt 的文本块。
// 来源优先级高的排前，同优先级按更新时间倒序；limit 控制取多少条。空记忆返回空串。
export function buildMemoryBlock(state, limit = 20) {
  const memories = (state.aiMemory || []).slice();
  if (!memories.length) return '';
  memories.sort((a, b) => {
    const diff = (MEMORY_SOURCE_PRIORITY[b.source] || 1) - (MEMORY_SOURCE_PRIORITY[a.source] || 1);
    if (diff) return diff;
    return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
  });
  const lines = memories.slice(0, limit).map((item, i) => `${i + 1}. ${item.text}`);
  return `\n\n你对他已经积累了不少了解（这些是你长期记得的，自然地延续，别刻意复述）：\n${lines.join('\n')}`;
}

export async function aiDescribeImage(state, imageDataUrl, prompt) {
  const content = [
    { type: 'image_url', image_url: { url: imageDataUrl } },
    { type: 'text', text: prompt || '请描述这张图片的内容。' }
  ];
  return vision(state, content);
}

// R7：每日鼓励语——结合长期记忆/心情/学习状态/日记生成一句简短温暖的话（20-40 字）。
// 缓存：settings.aiDailyEncouragement = { date, text }，当天复用、隔天重生成；无 key / 生成失败返回 null（前端回退座右铭）。
export async function aiDailyEncouragement(state) {
  const settings = state?.settings || {};
  const today = dateKey();
  const cache = settings.aiDailyEncouragement || {};
  if (cache.date === today && cache.text) return cache.text;
  if (!settings.aiApiKey) return null;
  const context = buildAiContext(state);
  const memoryBlock = buildMemoryBlock(state, 12);
  const mood = buildMoodSummary(state);
  const moodHint = mood.enabled && mood.lowStreak >= 1
    ? `他最近心情不太好（连续 ${mood.lowStreak} 天低落）：这句鼓励要更温柔——先接住他的情绪，再轻轻给一点力量，别提压力。`
    : '如果他有低落或疲惫的迹象，语气就温柔些；今天状态不错的话，可以顺着他的状态轻轻推一把。';
  const system = `你是「Mine」App 里陪伴他的朋友。请根据你对他的了解（长期记忆、近期心情、学习状态、最近日记），写一句「今天」给他的鼓励话——像朋友随口说的、独一无二的一句，不是套话。要求：
- 一句话，20～40 字，口语化、有温度
- 不要罗列数据、不要提具体数字、不要说教
- 不要用"加油！""你可以的！"这类通用套话
- ${moodHint}
- 直接给文案本身，不要加引号`;

  const reply = await chat(state, [
    { role: 'system', content: system },
    { role: 'user', content: `他的当前数据：\n${context}${memoryBlock}\n\n给我今天的一句鼓励。` }
  ], { temperature: 0.9, maxTokens: 120 });

  const text = String(reply || '').replace(/^["「『]+|["」』]+$/g, '').trim().slice(0, 40);
  if (!text) return null;
  settings.aiDailyEncouragement = { date: today, text };
  return text;
}

// R4-2：记账专用视觉提示词——一次视觉调用返回「是否账单 + 账单结构化信息 / 普通描述」。
// 判定标准克制：只把明显的账单/小票/支付截图判为账单，拿不准宁可 isBill:false（避免日常照片弹记账卡片）。
const VISION_LEDGER_PROMPT = `你是「Mine」App 的图片识别助手。请判断这张图片是否是一张账单（小票、收据、支付/订单截图、外卖或购物清单等），是则提取信息，否则给出普通描述。
要求：
- isBill：只有明显的账单、小票、收据、支付/订单截图才算账单；笔记、照片、随手拍、截图、书籍封面等一律 false。拿不准时宁可 false，不要打扰用户
- bill（isBill 为 true 时输出）：
  - type：'expense' 支出 | 'income' 收入；转账、外借、归还一律 type:'transfer'，绝不算收支
  - category：餐饮 restaurant、交通 transport、学习 study、娱乐 entertainment、AI ai、游戏 game、其他 other；AI 公司产品/模型/API/订阅归 ai，麻将馆/KTV/电影/桌游归 entertainment，游戏币/充值/道具/会员归 game；不确定一律 other，禁止猜测
  - accountId：只有图片有明确付款账户证据才输出账户名或 id；否则空字符串，绝不猜测支付宝/微信/银行卡
  - amount：账单主金额（数字，单位元，正数，最多两位小数；小票有多行金额时取合计/实付金额）
  - note：简短备注（商户名、项目名等），没有则空字符串
  - date：账单上的日期，用 YYYY-MM-DD；提取不到则空字符串（表示今天）
- description：无论是否账单，都用一两句话描述这张图片的内容（账单图也附带一句，供放弃记账时回退普通聊天）
只返回 JSON：{"isBill":true,"bill":{"type":"expense","category":"restaurant","amount":25,"note":"某餐厅","date":""},"description":"一张餐饮小票"} 或 {"isBill":false,"description":"一张教室的照片"}，不要其他文字`;

// R4-2：一次视觉调用完成「是否账单判定 + 账单提取 / 普通描述」两件事（硬性要求：每张图只调一次 vision）。
export async function aiReadImageWithLedger(state, imageDataUrl) {
  const content = [
    { type: 'image_url', image_url: { url: imageDataUrl } },
    { type: 'text', text: VISION_LEDGER_PROMPT }
  ];
  const reply = await vision(state, content, { maxTokens: 400 });
  return parseVisionLedgerReply(reply, state);
}

const cleanLedgerText = (value, limit) => String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
const validIsoDate = value => {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const date = new Date(`${text}T12:00:00`);
  return Number.isFinite(date.getTime()) && dateKey(date) === text ? text : '';
};

function specialLedgerCategory(text, categories) {
  const value = String(text || '').toLowerCase();
  if (categories.ai && /(?:openai|chatgpt|deepseek|claude|gemini|人工智能|模型订阅|api\s*(?:调用|接口|订阅)|(?:^|[^a-z])ai(?:[^a-z]|$))/i.test(value)) return 'ai';
  if (categories.entertainment && /麻将馆|麻将|ktv|电影|桌游/i.test(value)) return 'entertainment';
  if (categories.game && /游戏币|游戏道具|道具|游戏充值/i.test(value)) return 'game';
  return '';
}

export function parseLedgerImageRecognitionReply(text, state) {
  const source = String(text || '').trim();
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  let payload;
  try {
    payload = JSON.parse(fenced ? fenced[1] : source);
  } catch {
    throw new Error('AI 小票识别返回的 JSON 无法解析');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('AI 小票识别返回格式无效');
  const rawAmount = payload.amount;
  const numericAmount = rawAmount === null || rawAmount === '' || rawAmount === undefined ? NaN : Number(rawAmount);
  const amount = Number.isFinite(numericAmount) && numericAmount > 0 ? round2(numericAmount) : null;
  const merchant = cleanLedgerText(payload.merchant, 80);
  const note = cleanLedgerText(payload.note, 160);
  const categories = activeLedgerCategories(state);
  const special = specialLedgerCategory(`${merchant} ${note}`, categories);
  const requested = String(payload.category || '');
  const category = special || (categories[requested] ? requested : (categories.other ? 'other' : Object.keys(categories)[0] || ''));
  return {
    amount,
    merchant,
    date: validIsoDate(payload.date),
    category,
    note,
    confidence: Math.max(0, Math.min(1, Number(payload.confidence) || 0))
  };
}

export async function aiRecognizeLedgerImage(state, image) {
  const imageData = String(image || '').trim();
  if (!imageData) throw new Error('请先选择要识别的小票图片');
  const categories = activeLedgerCategories(state);
  const categoryOptions = Object.entries(categories).map(([id, item]) => `${id}(${item.name || item.label || id})`).join('、');
  const prompt = `你是「Mine」App 的小票识别助手。请只从用户主动提交的这张图片中提取记账表单建议，不要推测看不清的信息。
只返回严格 JSON：{"amount":null,"merchant":"","date":"","category":"other","note":"","confidence":0}
要求：
- amount 为正数且最多两位小数；无法确认必须为 null
- date 仅在图片明确显示时返回 YYYY-MM-DD，否则空字符串
- category 只能选：${categoryOptions}；AI 产品/API/模型订阅归 ai，麻将馆/KTV/电影/桌游归 entertainment，游戏币/道具/充值归 game，不确定归 other
- merchant 和 note 简短；confidence 为 0～1
- 只提取建议，不表示已经入账`;
  const reply = await vision(state, [
    { type: 'image_url', image_url: { url: imageData } },
    { type: 'text', text: prompt }
  ], { maxTokens: 400 });
  return parseLedgerImageRecognitionReply(reply, state);
}

export function activeLedgerCategories(state) {
  return { ...LEDGER_CATEGORIES, ...Object.fromEntries((state?.ledgerCategories || []).filter(item => !item.archived).map(item => [item.id, item])) };
}

export function matchMerchantCategoryRule(state, note) {
  const normalized = String(note || '').toLowerCase();
  const categories = activeLedgerCategories(state);
  return (state?.merchantCategoryRules || []).find(rule => rule.enabled && categories[rule.categoryId] && rule.keyword && normalized.includes(String(rule.keyword).toLowerCase())) || null;
}

function normalizeLedgerDraft(state, draft) {
  const categories = activeLedgerCategories(state);
  const note = String(draft.note || '').trim().slice(0, 100);
  const rule = matchMerchantCategoryRule(state, note);
  const type = ['income', 'transfer'].includes(draft.type) ? draft.type : 'expense';
  return { type, category: type === 'transfer' ? '' : (rule?.categoryId || (categories[draft.category] ? draft.category : 'other')), amount: round2(draft.amount), note, date: /^\d{4}-\d{2}-\d{2}$/.test(draft.date || '') ? draft.date : '', accountId: String(draft.accountId || ''), sourceAccountId: String(draft.sourceAccountId || ''), targetAccountId: String(draft.targetAccountId || ''), ruleKeyword: rule?.keyword || '' };
}

// 解析视觉返回 JSON（独立导出便于测试）：字段清洗、非法值降级。
// 非 JSON 纯文本 / 解析失败 → { isBill: false, description: 原文 }（与原 aiDescribeImage 行为等价）。
export function parseVisionLedgerReply(text, state) {
  let obj;
  try {
    const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    obj = JSON.parse(cleaned);
  } catch {
    return { isBill: false, description: String(text || '').trim() };
  }
  if (!obj || typeof obj !== 'object') return { isBill: false, description: String(text || '').trim() };
  const description = String(obj.description || '').trim().slice(0, 200);
  if (obj.isBill === true) {
    const bill = obj.bill && typeof obj.bill === 'object' ? obj.bill : {};
    const amount = Number(bill.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { isBill: false, description: description || String(text || '').trim() };
    }
    return {
      isBill: true,
      bill: normalizeLedgerDraft(state, { ...bill, amount }),
      description
    };
  }
  return { isBill: false, description: description || String(text || '').trim() };
}

// ---------------------------------------------------------------------------
// 时间感知（2026-10-20）
//
// 用户反馈「AI 没有时间观念」。诊断出两个缺口：
//   1. 系统提示只给了日期，没有时刻 → 不知道现在是几点、什么时段
//   2. 对话历史每条都不存时间 → AI 无法区分「刚说的」和「三天前说的」，
//      于是把很久以前的消息当成刚刚发生
// 两个都已修：消息入库带 at（views/ai.js pushHistory + model.js 归一化兜底），
// 这里负责把时刻翻译成模型能理解的中文描述。
// ---------------------------------------------------------------------------

/** 时段说法，模型据此调整语气（深夜不该说「早安」）。 */
export function dayPartOf(date) {
  const hour = Number(date?.getHours?.() ?? date?.getHours) || 0;
  if (hour < 5) return '凌晨';
  if (hour < 8) return '早上';
  if (hour < 11) return '上午';
  if (hour < 13) return '中午';
  if (hour < 17) return '下午';
  if (hour < 19) return '傍晚';
  if (hour < 22) return '晚上';
  return '深夜';
}

const two = value => String(value).padStart(2, '0');

/** 给模型看的完整时间描述：几点几分几秒 + 今天是今年第几天 + 距周末几天。 */
export function describeNow(now = new Date()) {
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  // 秒级精度：用户直接问「几点了」时，模型不该答一个还在跳动的近似值。
  const clock = `${two(hours)}:${two(minutes)}:${two(seconds)}`;
  const minuteOfDay = hours * 60 + minutes;
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((now - yearStart) / 86400000) + 1;
  const yearDays = Math.round((new Date(now.getFullYear(), 11, 31) - yearStart) / 86400000) + 1;
  // 周一为一周之首（与项目内 habitStreak / habitWeekProgress 口径一致）
  const weekdayIndex = (now.getDay() + 6) % 7;
  const weekDay = weekdayIndex + 1;
  // 周末判定必须直接看 getDay()，不能用「距周六还有几天」反推：
  // getDay()=6 是周六、0 是周日，反推会错位一天（周六说「明天就是周末」）。
  const dayOfWeek = now.getDay();
  const weekendText = dayOfWeek === 6 ? '今天就是周末'
    : dayOfWeek === 0 ? '今天已经是周末的最后一天'
      : dayOfWeek === 5 ? '明天就是周末'
        : `距周末还有 ${6 - dayOfWeek} 天`;
  const part = dayPartOf(now);
  const gaps = [
    `现在是 ${clock}（${part}）`,
    `今天是今年第 ${dayOfYear} 天（全年 ${yearDays} 天，已过 ${Math.round(dayOfYear / yearDays * 100)}%），本月第 ${now.getMonth() + 1} 月`,
    `本周第 ${weekDay} 天，${weekendText}`,
    `按一天 24 小时算，此刻已过去 ${Math.round(minuteOfDay / 1440 * 100)}%`
  ];
  return gaps.join('；');
}

/** 单条消息相对现在的时间标签（用于给历史消息打时间戳）。 */
export function describeMessageTime(at, now = new Date()) {
  // 防御：at 可能是字符串（ISO）或毫秒数。解析失败时宁可不给标签，
  // 也不能让模型看到「20733 天前」这种明显错误的信息。
  const parsed = typeof at === 'number' ? at : Date.parse(at);
  const stamp = new Date(Number.isFinite(parsed) ? parsed : NaN);
  if (!Number.isFinite(stamp.getTime())) return '';
  const diffMinutes = Math.round((now - stamp) / 60000);
  if (diffMinutes < 1) return '刚刚';
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  const sameDay = dateKey(stamp) === dateKey(now);
  if (sameDay) return `今天 ${two(stamp.getHours())}:${two(stamp.getMinutes())}`;
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey(stamp) === dateKey(yesterday)) return `昨天 ${two(stamp.getHours())}:${two(stamp.getMinutes())}`;
  const diffDays = Math.round((new Date(`${dateKey(now)}T12:00:00`) - new Date(`${dateKey(stamp)}T12:00:00`)) / 86400000);
  return `${dateKey(stamp).slice(5)} ${two(stamp.getHours())}:${two(stamp.getMinutes())}（${diffDays} 天前）`;
}

export function buildAiChatMessages(state, messages, now = new Date()) {
  const latestUserQuestion = [...(messages || [])].reverse().find(message => message?.role === 'user')?.content || '';
  // now 必须与检索层共用同一个时间，否则会出现「上下文说 10 月、检索按 9 月取数」的不一致。
  const semantic = retrieveSemanticContext(state, latestUserQuestion, { now });
  const memoryBlock = buildMemoryBlock(state, 24);
  const semanticBlock = semantic.text
    ? `\n\n与本轮问题相关的本地记录：\n${semantic.text}`
    : '\n\n本轮没有检索到相关本地记录，请勿引用无关数据。';

  // 2026-10-20：给每条历史消息加时间前缀，并把它们转成可读文本放进系统提示。
  // 关键点：不能只在 system 里"提到"时间，必须让每条消息本身带上时间标记，
  // 否则模型看不到新旧差异，仍会把三天前的消息当成刚刚说的。
  const visibleMessages = messages.filter(message => String(message?.content || '').trim() || message?.image);
  const stampedMessages = visibleMessages.map(message => {
    const label = describeMessageTime(message?.at, now) || '历史消息，时间未知';
    return {
      ...message,
      content: label && message?.role === 'user'
        ? `[${label}] ${message.content}`
        : label
          ? `[${label}] ${message.content}`
          : message.content
    };
  });
  const stampedHistory = stampedMessages.length
    ? stampedMessages.map(message => `${message.role === 'user' ? '用户' : '我'}：${message.content}`).join('\n')
    : '（暂无历史对话）';

  let system = `你是「Mine」App 里陪伴用户的学习伙伴，也是越来越懂他的朋友。

你要像一位老朋友那样自然地和他聊天：口语化、真诚、有温度，别端着，别用"首先/其次/综上所述"这类书面套话，别一上来就罗列一大堆条目。该共情时共情，该给实在建议时给建议，偶尔可以温柔地调侃或鼓励一句。话不要太长，两三句说清楚就很好。

不要编造数据里没有的内容。默认用简体中文。

【现在是】${describeNow(now)}。
用户可以直接问你几点、今天星期几、这周还剩几天——按上面的数字如实回答，不要含糊说「我不知道时间」。
被问到时刻时，请直接报出上面的 时:分:秒；不要只说「现在下午」这种含糊说法。
「今天/昨天/刚才/最近」这类词一律以上面的真实时间为准，不要假设任何别的时点。

日记中的今天、昨天、前天等时间词，一律以该条记录标注的日期为准；提及历史事件时使用记录的实际日期。

下面这段对话历史里，每条消息前面都标了它发出的时间（形如「3 天前」「昨天 21:30」「刚才」）：
- 标为「时间未知」的历史消息不能推断为刚发生，也不能猜测具体日期
- 必须据此判断消息的新旧。**几天前说的事情不是刚发生的**，回答时要体现时间差
  （比如「你上次说的那件事，后来怎么样了」而不是「你刚说的」）
- 不要把旧消息当成用户此刻的意图；用户当前的意图以最后一条消息为准

${stampedHistory}

只使用上面规则、长期记忆和本轮检索结果，不要推断未提供的数据。${semanticBlock}${memoryBlock}`;

  // R2：聊天中自然关心（aiEmotionCare 关闭时不注入）
  const mood = buildMoodSummary(state);
  const moodIsRelevant = semantic.records.some(item => item.sourceType === 'journal' || item.sourceType === 'moment');
  if (moodIsRelevant && mood.enabled && mood.lowStreak >= 1) {
    system += mood.lowStreak >= 3
      ? '\n\n他最近连续好几天心情不太好。像朋友那样在合适的时机温柔地关心一句（比如「昨天记的心情不太好，今天怎么样？」），今天主动多问一句他的状态，但别反复追问、别显得过度紧张，真诚一次就好。'
      : '\n\n他最近几天有点低落。聊天时如果有合适的机会，自然地关心一句，轻轻问问他今天怎么样，但不要每轮都提、不要重复啰嗦。';
  }

  return [{ role: 'system', content: system }, ...stampedMessages];
}

export async function aiChat(state, messages, { signal } = {}) {
  return chat(state, buildAiChatMessages(state, messages), { signal });
}

export async function* aiChatStream(state, messages, { signal } = {}) {
  yield* chatStream(state, buildAiChatMessages(state, messages), { signal });
}

// 普通文字聊天的终端状态机：流中不持久化，只在完成、取消或错误后持久化一次。
export async function runAiStreamLifecycle(history, stream, { id = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, signal, onUpdate, persist } = {}) {
  const assistant = { id, role: 'assistant', content: '', streaming: true };
  history.push(assistant);
  onUpdate?.('start', assistant);
  let status = 'complete';
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) throw Object.assign(new Error('请求已取消'), { name: 'AbortError' });
      assistant.content += String(chunk || '');
      if (chunk) onUpdate?.('chunk', assistant);
    }
    if (!assistant.content) throw new Error('AI 返回为空，请稍后重试。');
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') {
      status = 'cancelled';
      assistant.streaming = false;
      assistant.cancelled = true;
      if (!assistant.content) {
        const index = history.indexOf(assistant);
        if (index >= 0) history.splice(index, 1);
      }
    } else if (assistant.content) {
      status = 'interrupted';
      assistant.streaming = false;
      assistant.interrupted = true;
      assistant.errorMessage = error?.message || '生成中断';
    } else {
      status = 'failed';
      assistant.streaming = false;
      assistant.failed = true;
      assistant.content = error?.message || '请求失败，请稍后重试。';
    }
  }
  assistant.streaming = false;
  await persist?.(status, assistant);
  onUpdate?.('terminal', assistant);
  return { status, assistant: history.includes(assistant) ? assistant : null };
}

export function buildPeriodContext(state, start, end) {
  const inRange = item => item?.date >= start && item.date <= end;
  const sessions = (state.sessions || []).filter(inRange);
  const journals = Object.entries(state.journals || {}).filter(([day]) => day >= start && day <= end).map(([day, item]) => `${day}：${String(item.content || '').slice(0, 160)}`).filter(Boolean);
  const todos = (state.todos || []).filter(inRange).map(item => item.title).filter(Boolean);
  const transactions = (state.transactions || []).filter(item => item.type !== 'transfer' && inRange(item));
  return `统计范围：${start} 至 ${end}\n专注记录：${sessions.map(item => `${item.date} ${item.minutes} 分钟`).join('；') || '无'}\n日记：${journals.join('；') || '无'}\n待办：${todos.join('、') || '无'}\n收支记录：${transactions.map(item => `${item.date} ${item.type} ${item.amount}`).join('；') || '无'}`;
}

export async function aiPeriodSummary(state, period = 'week', now = new Date()) {
  const summary = periodSummary(state, period, now);
  const context = buildPeriodContext(state, summary.start, summary.end);
  const profile = state.profile || {};
  const memoryBlock = buildMemoryBlock(state, 20);
  const trend = summary.difference === 0 ? '和上周持平' : `比上周${summary.difference > 0 ? '多' : '少'}了 ${fmt(Math.abs(summary.difference))}`;

  const system = `你是「Mine」App 里陪伴他的学习伙伴，也是懂他的朋友${profile.name ? `，他叫「${profile.name}」` : ''}。请根据下面的数据，用自然、有温度的口语，写一段"本周小结"——像朋友那样，肯定他的付出、轻轻点出值得注意的地方、再给一句贴心的鼓励或小建议。你记得他长期的习惯、目标和偏好，可以自然地呼应——比如他坚持了很久的事、他之前立过的目标或说过的话，让小结显得你一直记得他，但别生硬复述。不要罗列数据表格，不要用"首先/其次"，一两段话、150 字左右即可。${memoryBlock}

本周概览：总专注 ${fmt(summary.totalMinutes)}，共 ${summary.sessions.length} 次，日均 ${fmt(summary.averageMinutes)}，${trend}。

他的数据：\n${context}`;

  return chat(state, [
    { role: 'system', content: system },
    { role: 'user', content: '帮我写写这周的小结吧。' }
  ], { temperature: 0.85, maxTokens: 450 });
}

const WEEKLY_TRACK_KEYS = ['study', 'wellbeing', 'finance', 'media'];
const NO_WEEKLY_TRACK_RECORD = '本周暂无对应记录';

function weeklyTrackAvailability(metrics = {}) {
  return {
    study: Number(metrics.focus?.sessions || 0) > 0,
    wellbeing: Number(metrics.habits?.targets || 0) > 0 || Number(metrics.journals?.count || 0) > 0,
    finance: Number(metrics.ledger?.transactionCount || 0) > 0 || Number(metrics.ledger?.budgetTotal || 0) > 0,
    media: Number(metrics.media?.completed || 0) > 0 || Number(metrics.media?.inProgress || 0) > 0
  };
}

function weeklyNarrativeSignals(metrics = {}) {
  const difference = Number(metrics.focus?.differenceMinutes || 0);
  const budgetTotal = Number(metrics.ledger?.budgetTotal || 0);
  const remainingBudget = Number(metrics.ledger?.remainingBudget || 0);
  return {
    tracksWithRecords: weeklyTrackAvailability(metrics),
    focusTrend: difference > 0 ? '较前周上升' : difference < 0 ? '较前周下降' : '与前周持平',
    hasPeakFocusDay: Boolean(metrics.peakFocusDay),
    budgetState: budgetTotal <= 0 ? '未设置预算' : remainingBudget > 0 ? '预算有剩余' : remainingBudget < 0 ? '预算已超出' : '预算持平',
    hasJournalRecord: Number(metrics.journals?.count || 0) > 0,
    hasMediaRecord: Number(metrics.media?.completed || 0) > 0 || Number(metrics.media?.inProgress || 0) > 0
  };
}

export function findReadyWeeklyInsightReport(reports, metrics = {}) {
  const start = String(metrics.dateRange?.start || '');
  const end = String(metrics.dateRange?.end || '');
  return (Array.isArray(reports) ? reports : []).find(report => report?.weekStart === start && report?.weekEnd === end && report?.status === 'ready') || null;
}

export function upsertWeeklyInsightReport(reports, report) {
  const source = Array.isArray(reports) ? reports : [];
  return [...source.filter(item => item?.weekStart !== report.weekStart || item?.weekEnd !== report.weekEnd), report]
    .sort((a, b) => String(a.weekStart || '').localeCompare(String(b.weekStart || '')))
    .slice(-12);
}

export function calculateWeeklyFlowScore(state, metrics = {}, fallback = () => 0) {
  const start = String(metrics.dateRange?.start || '');
  const end = String(metrics.dateRange?.end || '');
  const sessions = (state?.sessions || []).filter(session => session?.date >= start && session.date <= end);
  let weighted = 0;
  let totalSeconds = 0;
  sessions.forEach(session => {
    const durationSeconds = Math.max(0, Number(session.durationSeconds) || Number(session.minutes || 0) * 60);
    if (!durationSeconds) return;
    const raw = Number.isFinite(Number(session.flowScore)) ? Number(session.flowScore) : fallback(session);
    const score = Math.max(0, Math.min(100, Number(raw) || 0));
    weighted += score * durationSeconds;
    totalSeconds += durationSeconds;
  });
  return totalSeconds ? Math.max(0, Math.min(100, Math.round(weighted / totalSeconds))) : 0;
}

export function parseWeeklyInsightReply(text, metrics = {}) {
  const source = String(text || '').trim();
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  let payload;
  try {
    payload = JSON.parse(fenced ? fenced[1] : source);
  } catch {
    throw new Error('AI 周报返回的 JSON 无法解析');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('AI 周报返回格式无效');
  if (!payload.tracks || typeof payload.tracks !== 'object' || WEEKLY_TRACK_KEYS.some(key => !Object.prototype.hasOwnProperty.call(payload.tracks, key))) {
    throw new Error('AI 周报缺少四轨复盘');
  }
  if (!Array.isArray(payload.nextWeekActionAdvice)) throw new Error('AI 周报建议格式无效');
  const advice = payload.nextWeekActionAdvice.map(item => String(item ?? '').trim()).filter(Boolean);
  if (advice.length !== 3 || payload.nextWeekActionAdvice.length !== 3) throw new Error('AI 周报必须包含正好 3 条非空建议');
  const availability = weeklyTrackAvailability(metrics);
  const tracks = {};
  WEEKLY_TRACK_KEYS.forEach(key => {
    const value = String(payload.tracks[key] ?? '').trim();
    if (availability[key] && !value) throw new Error('AI 周报四轨复盘不可为空');
    tracks[key] = availability[key] ? value : NO_WEEKLY_TRACK_RECORD;
  });
  const themeTitle = String(payload.themeTitle ?? '').trim();
  const summaryNarrative = String(payload.summaryNarrative ?? '').trim();
  if (!themeTitle || !summaryNarrative) throw new Error('AI 周报主题或摘要为空');
  // 只返回叙事白名单；模型夹带的 kpis、金额、比例、时长、flowScore 等字段一律丢弃。
  return { themeTitle, summaryNarrative, tracks, nextWeekActionAdvice: advice };
}

export async function aiGenerateWeeklyInsight(state, metrics) {
  const signals = weeklyNarrativeSignals(metrics);
  const system = `你是「暖色生活志」的每周生活周报叙事助手。所有 KPI、金额、比例、时长、日期、心流分和图表都由本地代码计算，你不得生成或返回这些字段。你只能依据给定的定性信号写叙事，不得编造没有出现的具体行为、任务、交易、书影音或日记内容。

只返回 JSON，不要解释，结构必须严格为：
{"themeTitle":"","summaryNarrative":"","tracks":{"study":"","wellbeing":"","finance":"","media":""},"nextWeekActionAdvice":["","",""]}

要求：
- tracks 四项必须全部存在；没有数据的轨道必须写“${NO_WEEKLY_TRACK_RECORD}”
- nextWeekActionAdvice 必须正好 3 条、每条非空且可执行
- 文案不得复述具体 KPI、金额、比例、时长、日期或 flowScore
- 不得增加 kpis、dailyFocusChart、flowScore 等字段`;
  const reply = await chat(state, [
    { role: 'system', content: system },
    { role: 'user', content: `本周仅允许使用的定性信号：\n${JSON.stringify(signals)}` }
  ], { temperature: 0.7, maxTokens: 900 });
  return parseWeeklyInsightReply(reply, metrics);
}

// 按天过滤，构建某一天的数据摘要（供每日小结使用；buildAiContext 是全量摘要，这里只看某天）
function buildDayContext(state, date) {
  const lines = [];
  const daySessions = (state.sessions || []).filter(session => session.date === date);
  const dayMinutes = minutesOnDate(state, date);
  if (dayMinutes) {
    const byGroup = new Map();
    daySessions.forEach(session => {
      const project = (state.focusProjects || []).find(item => item.id === session.projectId);
      const key = project?.group || '其他';
      byGroup.set(key, (byGroup.get(key) || 0) + session.minutes);
    });
    lines.push(`专注：${fmt(dayMinutes)}（${[...byGroup.entries()].map(([name, minutes]) => `${name} ${fmt(minutes)}`).join('，')}）`);
  } else {
    lines.push('专注：没有学习记录');
  }
  const completion = todayCompletion(state, date);
  if (completion.total) lines.push(`习惯打卡：${completion.done}/${completion.total} 完成`);
  const todos = todosForDate(state, date);
  if (todos.length) {
    const done = todos.filter(todo => todo.completed).length;
    const open = todos.filter(todo => !todo.completed).map(todo => todo.title);
    lines.push(`待办：${done}/${todos.length} 完成${open.length ? `，未完成：${open.join('、')}` : ''}`);
  }
  const snippets = (state.snippets || []).filter(snippet => snippet.date === date);
  if (snippets.length) {
    const notes = snippets.filter(snippet => snippet.type === 'text' && snippet.text).map(snippet => snippet.text.slice(0, 40));
    const photoCount = snippets.filter(snippet => snippet.type === 'photo').length;
    if (notes.length) lines.push(`随手记：${notes.map(note => `「${note}」`).join('、')}`);
    if (photoCount) lines.push(`随手拍：${photoCount} 张照片`);
  }
  const journal = state.journals?.[date];
  if (journal) {
    const content = String(journal.content || '').replace(/\s+/g, ' ').trim();
    if (content) {
      lines.push(`日记${journal.mood ? `（心情：${journal.mood}）` : ''}：${content.slice(0, 120)}${content.length > 120 ? '…' : ''}`);
    }
  }
  return lines.length ? lines.join('\n') : '这一天没有留下什么记录。';
}

export async function aiDailySummary(state, date) {
  const settings = state?.settings || {};
  if (!settings.aiApiKey) return '';
  const profile = state.profile || {};
  const memoryBlock = buildMemoryBlock(state, 10);
  const dayContext = buildDayContext(state, date);
  let system = `你是「Mine」App 里陪伴他的朋友${profile.name ? `，他叫「${profile.name}」` : ''}。请根据下面他「${date}」这一天的记录，用自然、有温度的口语写一小段"每日小结"——像朋友在帮他记住这一天：轻轻回顾他做了什么、状态怎么样，再给一句温柔的肯定或鼓励。不要罗列数据、不要用"首先/其次"、不要像统计报告，80～150 字即可。${memoryBlock}

他这一天的记录：
${dayContext}`;

  // R2：低落期每日小结用温柔版语气（陪伴场景；aiEmotionCare 关闭时不注入）
  const mood = buildMoodSummary(state);
  if (mood.enabled && mood.lowStreak >= 1) {
    system += '\n\n他最近心情不太好。这段小结语气要更温柔：先照顾他的感受、肯定他坚持记录这件事本身，不要提学习进度或压力之类可能加重负担的内容。';
  }

  // R4：每日小结「关键时提」花费——仅预算超支/接近上限（≥80%）或今日单笔大额（≥200 元）时顺带一句，其余时候完全不提（不唠叨）
  const ledger = ledgerSummary(state);
  if (ledger.budgetProgress.total > 0 && ledger.budgetProgress.percent >= 80) {
    system += `\n\n他本月支出已用预算 ${ledger.budgetProgress.percent}%（${ledger.budgetProgress.percent >= 100 ? '已超支' : '接近上限'}）。可以在小结里自然地提一句、轻轻提醒一下，点到为止，一句话就好，不要唠叨。`;
  }
  const bigSpending = (state.transactions || [])
    .filter(item => item.type === 'expense' && item.date === dateKey())
    .sort((a, b) => b.amount - a.amount)[0];
  if (bigSpending && bigSpending.amount >= 200) {
    system += `\n\n他今天有一笔 ${bigSpending.amount} 元的支出${bigSpending.note ? `（${bigSpending.note}）` : ''}。可以像朋友一样在小结里自然提一句，简单提醒即可，不要评价太多。`;
  }

  const reply = await chat(state, [
    { role: 'system', content: system },
    { role: 'user', content: `帮我写写 ${date} 这一天的总结吧。` }
  ], { temperature: 0.8, maxTokens: 400 });

  return String(reply || '').trim();
}

export async function aiJournalGuide(state) {
  const context = buildAiContext(state);
  const memoryBlock = buildMemoryBlock(state, 10);
  const memoryGuide = memoryBlock
    ? `你对他有一些长期了解，可以让问题更贴合他（比如他正在备考，就问问今天的备考状态），但别生硬地复述记忆。${memoryBlock}`
    : '你没有他的长期记忆，就纯粹基于今天的数据提问。';
  const system = `你是「Mine」App 里的贴心记录助手。用户想写今天的日记，请基于用户今天的数据，用温柔、口语化的简体中文，提出 3～4 个简短的小问题，帮用户回忆起今天值得记录的事。每个问题一行，不要评价、不要长篇大论，也不要替用户回答。${memoryGuide}\n\n用户今天的数据：\n${context}`;

  return chat(state, [
    { role: 'system', content: system },
    { role: 'user', content: '帮我起个头，我想记录今天。' }
  ], { temperature: 0.8, maxTokens: 400 });
}

function parseAiCopy(text) {
  try {
    const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const obj = JSON.parse(cleaned);
    const clean = list => Array.isArray(list) ? list.map(item => String(item).trim()).filter(Boolean) : [];
    return { photo: clean(obj.photo).slice(0, 10), journal: clean(obj.journal).slice(0, 10) };
  } catch {
    return { photo: [], journal: [] };
  }
}

export async function aiReminderCopy(state) {
  const context = buildAiContext(state);
  const memoryBlock = buildMemoryBlock(state, 8);
  const memoryGuide = memoryBlock
    ? `你记得他的一些习惯和愿望，可以偶尔自然地呼应（比如他提过想早睡，就轻轻提醒"今晚早点放下手机"），但每条仍要短小、随机、有温度，别生硬复述。${memoryBlock}`
    : '';
  const system = `你是「Mine」App 里一位温柔、真诚的陪伴者。你要写的是「邀请用户记录生活」的短文案，而不是冷冰冰的通知。语气像一位关心他的朋友，轻轻地、带着邀请感地提醒他停下来，记录此刻。不要命令式、不要说教、不要套话。${memoryGuide}`;

  const user = `请写两组提醒文案，每组 3 条：
- "photo" 组：邀请他随手拍一张照片，捕捉此刻的画面、光影或心情；
- "journal" 组：邀请他花一分钟，写下今天的一点念头或心情。
要求：每条 18 字以内，口语化、有温度、每句都不一样、不重复。只返回 JSON，格式：{"photo":["...","...","..."],"journal":["...","...","..."]}\n\n用户的数据：\n${context}`;

  const reply = await chat(state, [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ], { temperature: 1.2, maxTokens: 400 });

  return parseAiCopy(reply);
}

// R1：倒数日节点（30/7/1 天及当天）的一句话提醒 + 建议，结合 countdown 标题/备注。
// 无 key 或生成失败时由调用方回退模板文案。
export async function aiCountdownNodeCopy(state, countdown, daysLeft) {
  const settings = state?.settings || {};
  if (!settings.aiApiKey) return '';
  const profile = state.profile || {};
  const memoryBlock = buildMemoryBlock(state, 8);
  const context = buildAiContext(state);
  const dayLabel = daysLeft === 0 ? '就是今天' : `还剩 ${daysLeft} 天`;
  const system = `你是「Mine」App 里陪伴他的朋友${profile.name ? `，他叫「${profile.name}」` : ''}。请为一个"倒数日节点"写一句提醒 + 一句建议，像朋友那样自然、有温度，简体中文。要求：一两句话，别太长；结合倒数日的标题、备注和他当前的学习状态给出贴心建议；不要罗列数据、不要说教。${memoryBlock}`;

  const user = `倒计时「${countdown.title}」${dayLabel}${countdown.note ? `，备注：${countdown.note}` : ''}。

他当前的数据：
${context}`;

  const reply = await chat(state, [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ], { temperature: 0.8, maxTokens: 200 });

  return String(reply || '').trim().slice(0, 120);
}

const EMPTY_SUGGESTION = () => ({ tags: [], todos: [], summary: '' });

// R3：为一段随手记/日记内容生成三类建议（标签/待办/一句话摘要）。
// 输出结构化 JSON，解析失败安全降级为空建议。
export async function aiSuggestStructure(state, { source = '', content = '' } = {}) {
  const settings = state?.settings || {};
  if (!settings.aiApiKey) return EMPTY_SUGGESTION();
  const text = String(content || '').trim();
  if (!text) return EMPTY_SUGGESTION();
  const sourceLabel = source === 'journal' ? '日记' : source === 'snippet' ? '随手记' : '记录';
  const system = `你是「Mine」App 的记录整理助手。用户有一段${sourceLabel}内容，请帮他整理出三类建议：
1. tags：3～5 个短标签（2～6 字，概括内容的主题、情绪或场景）；
2. todos：如果内容里有可执行的事项，提取最多 3 条待办（动词开头，如"完成数学第三章习题"）；没有可执行事项就返回空数组；
3. summary：一句话摘要（30 字以内，概括核心内容）。
只返回 JSON，格式 {"tags":["..."],"todos":["..."],"summary":"..."}，不要其他文字。`;

  const reply = await chat(state, [
    { role: 'system', content: system },
    { role: 'user', content: text }
  ], { temperature: 0.3, maxTokens: 400 });

  return parseStructureReply(reply);
}

function parseStructureReply(text) {
  try {
    const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const obj = JSON.parse(cleaned);
    const clean = list => Array.isArray(list) ? list.map(item => String(item).trim().slice(0, 30)).filter(Boolean) : [];
    return {
      tags: clean(obj.tags).slice(0, 5),
      todos: clean(obj.todos).slice(0, 3),
      summary: String(obj.summary || '').trim().slice(0, 60)
    };
  } catch {
    return EMPTY_SUGGESTION();
  }
}

// R7：批量随机提醒文案（2-4 条，每条不同；结合增强后的 context/心情/倒计时/账单等场景，早/午/晚语气有差异）。
// 无 key 或解析失败 → 降级通用文案（不打扰、不报错）。
const FALLBACK_REMINDER_COPIES = [
  '今天过得怎么样？记下来吧',
  '刚看到你今天还没记点什么，晚饭吃了啥？记一笔吧',
  '睡前两分钟，写下今天最想留住的一刻',
  '随手拍张照，留住此刻的光',
  '今天有什么想说的？写进日记吧',
  '别忘了把今天的开心存下来'
];
function fallbackRandomCopies(count) {
  return FALLBACK_REMINDER_COPIES.slice(0, Math.max(2, Math.min(count, FALLBACK_REMINDER_COPIES.length)));
}
function parseCopies(text) {
  try {
    const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const arr = JSON.parse(cleaned);
    return Array.isArray(arr) ? arr.map(item => String(item).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}
export async function aiRandomReminderCopies(state, count = 3) {
  const settings = state?.settings || {};
  const n = Math.max(2, Math.min(6, Math.floor(count) || 3));
  if (!settings.aiApiKey) return fallbackRandomCopies(n);
  const context = buildAiContext(state);
  const memoryBlock = buildMemoryBlock(state, 8);
  const mood = buildMoodSummary(state);
  const moodHint = mood.enabled && mood.lowStreak >= 1 ? `他最近心情不太好（连续 ${mood.lowStreak} 天低落），语气再温柔些、少提压力。` : '';
  const system = `你是「Mine」App 里一位温柔真诚的陪伴者，负责写「邀请用户随手记录」的短文案——像朋友喊他记录此刻，而不是冷冰冰的通知。要求：
- 生成 ${n} 条，每条都必须不同（内容、角度、句式都要不一样）
- 结合他的真实生活场景（最近日记、心情、倒计时、账本、习惯、学习等）自然地融入，不要编造数据里没有的内容
- 时间感有差异：至少 1 条适合早上、1 条适合下午、1 条适合晚上（早上的短而轻，晚上更温和）
- 每条 1～2 句，简体中文，口语化有温度，不要命令式、不要说教、不要套话
- ${moodHint}只返回 JSON 数组，如 ["早上好呀，今天的打算是什么？写下来吧","晚饭吃了啥？记一笔吧","睡前两分钟，把今天最想留住的时刻写进日记"]，不要其他文字`;

  const reply = await chat(state, [
    { role: 'system', content: system },
    { role: 'user', content: `他的近期状态：\n${context}${memoryBlock}\n\n请生成 ${n} 条记录邀请文案。` }
  ], { temperature: 1.1, maxTokens: 500 });

  const copies = parseCopies(reply);
  return copies.length >= 2 ? copies.slice(0, n) : fallbackRandomCopies(n);
}

// ---- R4：账本 AI ----

const round2 = value => Math.round((Number(value) || 0) * 100) / 100;

// R4-1：记账意图规则预检（命中才触发 AI 解析，省 API 且避免把普通聊天误当记账）。
// 识别带金额的句子：「午饭 25 元」「花了 30 坐车」「今天赚了 200」等。
export function detectLedgerIntent(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return /(\d+(?:\.\d+)?)\s*(?:元|块|块钱|¥)/.test(t)
    || /(?:花了|花掉|支出|买了|消费|收入|赚了|收到|记|充值|缴费|转账|转给|外借|归还)[^，。？！]{0,12}?\d+(?:\.\d+)?/.test(t);
}

// R4-1：AI 把记账话语解析为结构化账目。category 映射 LEDGER_CATEGORIES，无法归类用 other；date 空表示今天。
// 无 key / 解析失败 / 非记账意图 → { isLedger: false }（调用方回退普通聊天）。
export async function aiParseLedger(state, text) {
  const settings = state?.settings || {};
  if (!settings.aiApiKey) return { isLedger: false };
  const categories = activeLedgerCategories(state);
  const categoryHint = Object.entries(categories)
    .map(([key, item]) => `${key}(${item.name || item.label})`)
    .join('、');
  const system = `你是「Mine」App 的记账助手。用户可能想记一笔账。请判断这句话是否表达了记账意图（提到具体金额的花销或收入），是则解析，否则 isLedger 返回 false。
要求：
- type：'expense' 支出 | 'income' 收入 | 'transfer' 转账；转账、外借、归还必须是 transfer，绝不算 expense/income
- category 只能从以下选择：${categoryHint}，无法归类用 other。AI 产品/模型/API/订阅→ai；麻将馆/KTV/电影/桌游→entertainment；游戏币/充值/道具/会员→game；不确定→other，禁止猜测
- amount：数字金额（单位元），必须是正数，最多两位小数
- accountId：普通收支仅在原话明确账户时填写，否则空字符串；不得猜测支付宝/微信/银行卡。transfer 需 sourceAccountId/targetAccountId（未知则空，交给确认卡选择）
- note：简短备注（原话里的描述），没有则空字符串
- date：明确提到某一天时用 YYYY-MM-DD，否则空字符串（表示今天）
只返回 JSON：{"isLedger":true,"type":"expense","category":"restaurant","amount":25,"note":"午饭","date":""} 或 {"isLedger":false}，不要其他文字`;

  const reply = await chat(state, [
    { role: 'system', content: system },
    { role: 'user', content: String(text || '').trim() }
  ], { temperature: 0.2, maxTokens: 300 });

  return parseLedgerReply(reply, state);
}

// 解析记账返回的 JSON（独立导出便于测试）
export function parseLedgerReply(text, state) {
  try {
    const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const obj = JSON.parse(cleaned);
    if (!obj || obj.isLedger !== true) return { isLedger: false };
    const amount = Number(obj.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { isLedger: false };
    return { isLedger: true, ...normalizeLedgerDraft(state, { ...obj, amount }) };
  } catch {
    return { isLedger: false };
  }
}

function normalizeLedgerAnalysisPayload(state, payload = {}) {
  const start = validIsoDate(payload.start);
  const end = validIsoDate(payload.end);
  if (!start || !end || start > end) throw new Error('消费分析周期无效');
  const categories = activeLedgerCategories(state);
  const expenses = (Array.isArray(payload.expenses) ? payload.expenses : [])
    .filter(item => item?.type === 'expense' && item.date >= start && item.date <= end && Number(item.amount) > 0);
  const totalExpense = round2(expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const byCategory = expenses.reduce((map, item) => {
    const id = categories[item.category] ? item.category : 'other';
    map[id] = round2((map[id] || 0) + Number(item.amount || 0));
    return map;
  }, {});
  const startDate = new Date(`${start}T12:00:00`);
  const endDate = new Date(`${end}T12:00:00`);
  const days = Math.round((endDate - startDate) / 86400000) + 1;
  const previousEndDate = new Date(startDate);
  previousEndDate.setDate(previousEndDate.getDate() - 1);
  const previousStartDate = new Date(previousEndDate);
  previousStartDate.setDate(previousStartDate.getDate() - days + 1);
  const previousStart = dateKey(previousStartDate);
  const previousEnd = dateKey(previousEndDate);
  const previousExpense = round2((state?.transactions || [])
    .filter(item => item?.type === 'expense' && item.date >= previousStart && item.date <= previousEnd)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const budgetSummary = ledgerSummary(state, endDate);
  const budget = budgetSummary.period?.start === start && budgetSummary.period?.end === end ? (budgetSummary.budgetProgress || {}) : {};
  const budgetTotal = Math.max(0, round2(budget.total));
  const budgetUsed = Math.max(0, round2(budget.spent));
  return {
    period: { start, end },
    totalExpense,
    categoryTotals: Object.entries(byCategory).map(([id, amount]) => ({ category: categories[id]?.name || categories[id]?.label || categories.other?.label || '其他', amount })),
    budget: { total: budgetTotal, used: budgetUsed, remaining: round2(budgetTotal - budgetUsed) },
    previousPeriod: { totalExpense: previousExpense, difference: round2(totalExpense - previousExpense) }
  };
}

// 指定周期消费分析：只把本地聚合后的最小允许字段发送给文字模型。
export async function aiLedgerAnalysis(state, payload) {
  const data = normalizeLedgerAnalysisPayload(state, payload);
  const system = `你是「Mine」App 的消费分析助手。请只根据给定汇总写 100～220 字简体中文分析：说明消费结构、与上一同长度周期的真实变化，并给 1～2 条可执行建议。不得编造商户、用途、具体单笔消费或用户行为，不得推测未提供的原因。只输出分析正文。`;
  const reply = await chat(state, [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(data) }
  ], { temperature: 0.6, maxTokens: 500 });
  const text = String(reply || '').trim();
  const length = Array.from(text).length;
  if (!text) throw new Error('AI 消费分析返回为空');
  if (length < 100 || length > 220) throw new Error('AI 消费分析长度不符合 100～220 字要求');
  return text;
}

function focusCoachPayload(session) {
  if (!session || typeof session !== 'object' || !Object.keys(session).length) throw new Error('缺少可分析的专注记录');
  const ambientTracks = Array.isArray(session.ambientSoundsUsed) ? session.ambientSoundsUsed : [];
  return {
    mode: String(session.mode || 'unknown').slice(0, 24),
    durationSeconds: Math.max(0, Math.round(Number(session.durationSeconds) || Number(session.minutes || 0) * 60)),
    targetDurationSeconds: Math.max(0, Math.round(Number(session.targetDurationSeconds) || 0)),
    interruptionsCount: Math.max(0, Math.round(Number(session.interruptionsCount) || 0)),
    flowScore: Math.max(0, Math.min(100, Math.round(Number(session.flowScore) || 0))),
    usedAmbientSounds: ambientTracks.length > 0,
    ambientTrackCount: ambientTracks.length
  };
}

export async function aiFocusCoach(state, session) {
  const data = focusCoachPayload(session);
  const system = `你是「Mine」App 的专注复盘教练。只根据本次专注的结构化指标，写 80～160 字简体中文点评，必须包含：一句真实评价、一条休息建议、一条下次改进建议。不得猜测专注任务、学习内容或分类；心流分较低时保持尊重，不羞辱、不夸张。只输出点评正文。`;
  const reply = await chat(state, [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(data) }
  ], { temperature: 0.6, maxTokens: 360 });
  const text = String(reply || '').trim();
  const length = Array.from(text).length;
  if (!text) throw new Error('AI 专注点评返回为空');
  if (length < 80 || length > 160) throw new Error('AI 专注点评长度不符合 80～160 字要求');
  return text;
}
