import { $, $$, esc, uid, state, save, render, modal, closeModal, show, confirmDelete, imgSrc, emptyState, go, registerView, registerBinder, registerOnRender, registerSubmitHandler, registerHelper, callHelper } from '../core.js';
import { aiChat, aiChatStream, runAiStreamLifecycle, aiDescribeImage, aiExtractFromData, aiExtractMemories, aiRememberPhoto, aiReminderCopy, aiDailyInsight, aiGenerateWeeklyInsight, calculateWeeklyFlowScore, findReadyWeeklyInsightReport, upsertWeeklyInsightReport, aiDailySummary, aiSuggestStructure, applySuggestion, aiParseLedger, aiLedgerAnalysis, aiRecognizeLedgerImage, aiFocusCoach, detectLedgerIntent, aiReadImageWithLedger, aiRandomReminderCopies, genericRandomReminderCopies, aiDailyEncouragement } from '../ai.js';
import { insightDataFingerprint } from '../ai/context.js';
import { addMemories, exportMemories, importMemories, isDuplicate } from '../ai/memory.js';
import { PROVIDERS } from '../ai/provider.js';
import { retrieveSemanticContext, semanticRecordLabel } from '../ai/semantic.js';
import { dateKey, makeDailySummary, todayCompletion, daysUntil, makeTransaction, LEDGER_CATEGORIES, ledgerSummary, upsertMerchantCategoryRule } from '../model.js';
import { micButtonHtml, bindVoiceInput } from './common.js';
import { mediaSource } from '../media-store.js';
import { scheduleDailyReminders, cancelDailyReminders, sendTestNotification, cancelRandomReminders, scheduleRandomReminders, restoreRandomReminders } from '../notifications.js';
import { futureRandomMinutes, pickCopy } from '../reminder-plan.js';
import { compressPhoto, isSupportedJournalPhoto } from '../photo-utils.js';
import { isNativeAndroid } from '../storage.js';
import { aiKeyStorageMode, clearApiKey } from '../ai-key-vault.js';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FilePicker } from '@capawesome/capacitor-file-picker';

// ---- 本地状态 ----
let aiHistory = [];
let aiBusy = false;
let aiPendingImage = '';
let reminderDraft = [];
let aiTab = 'chat';                // 三面板：chat | report | memory
let aiDraft = '';

// 2026-10-20：所有入历史的消息都补上发出时刻 `at`。
// 不改动原有的 push 调用形态，用包装函数统一补时间，避免漏掉某个入口。
function pushHistory(entry) {
  aiHistory.push({ at: Date.now(), ...entry });
}
let aiStickToBottom = true;
let aiHasUnread = false;
let aiInsightCache = { date: '', text: '' };
let aiInsightGenerating = false;
let weekGenerating = false;
let weekGenerationError = '';
let voiceBinding = null;           // R5：语音输入绑定实例（render 重建前先 destroy，防重复绑定）
let aiStreamController = null;
let aiStreamFrame = 0;
let aiChatExpanded = false;
let aiRouteWasActive = false;
let aiSemanticPreviewOpen = false;
let aiLastSemanticPreview = null;

export function aiMd(text) {
  return String(text || '').split('```').map((block, index) => {
    if (index % 2) return `<pre class="ai-code-block"><code>${esc(block.replace(/^\w+\n/, ''))}</code></pre>`;
    return aiTextBlock(block);
  }).join('');
}

function aiTextBlock(text) {
  let html = esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const lines = html.split('\n');
  let out = '';
  let inList = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[-•]\s+/.test(trimmed)) {
      if (!inList) { out += '<ul>'; inList = true; }
      out += `<li>${trimmed.replace(/^[-•]\s+/, '')}</li>`;
    } else {
      if (inList) { out += '</ul>'; inList = false; }
      if (trimmed) out += `<p>${trimmed}</p>`;
    }
  }
  if (inList) out += '</ul>';
  return out;
}

function ledgerAccountOptions(selected = '') {
  return `<option value="">请选择付款账户</option>${(state.ledgerAccounts || []).filter(account => !account.archived).map(account => `<option value="${esc(account.id)}" ${selected === account.id ? 'selected' : ''}>${esc(account.name)}</option>`).join('')}`;
}

function activeLedgerCategories() {
  return { ...LEDGER_CATEGORIES, ...Object.fromEntries((state.ledgerCategories || []).filter(category => !category.archived).map(category => [category.id, category])) };
}

function ledgerAccountPickerHtml(item, prefix) {
  if (item.type === 'transfer') return `<label style="display:block;font-size:12px;margin-top:8px">转出账户<select data-${prefix}-source style="width:100%;margin-top:3px">${ledgerAccountOptions(item.sourceAccountId)}</select></label><label style="display:block;font-size:12px;margin-top:6px">转入账户<select data-${prefix}-target style="width:100%;margin-top:3px">${ledgerAccountOptions(item.targetAccountId)}</select></label>`;
  return `<label style="display:block;font-size:12px;margin-top:8px">付款/收款账户<select data-${prefix}-account style="width:100%;margin-top:3px">${ledgerAccountOptions(item.accountId)}</select></label>`;
}

function assistantMessageHtml(message, showAuthor = false) {
  if (message.failed) return `<div class="ai-send-failed">发送失败，原消息和附件已保留。<button data-ai-retry="${esc(message.id)}">重试</button><button data-ai-edit-failed="${esc(message.id)}">编辑后重发</button><button data-ai-cancel-failed="${esc(message.id)}">取消</button></div>`;
  if (message.imageBill) return imageBillCardHtml(message);
  if (message.ledger) return ledgerCardHtml(message);
  if (message.streaming && !message.content) return '<span class="ai-typing"><i></i><i></i><i></i></span>';
  const author = showAuthor ? '<strong class="ai-message-author"><span>Mine AI 伴侣</span><span class="material-symbols-outlined" aria-hidden="true">smart_toy</span></strong>' : '';
  const content = `${author}${aiMd(message.content)}`;
  if (message.streaming) return `${content}<span class="ai-stream-cursor" aria-label="正在生成"></span>`;
  if (message.interrupted) return `${content}<div class="ai-stream-interrupted"><span>生成中断</span><button data-ai-retry="${esc(message.id)}">重试</button></div>`;
  if (message.cancelled) return `${content}<small class="ai-stream-cancelled">已停止生成</small>`;
  return content;
}

function localTodayInsight() {
  const today = dateKey();
  const sessions = (state.sessions || []).filter(item => item.date === today);
  const minutes = sessions.reduce((sum, item) => sum + Math.max(0, Number(item.minutes) || Math.round((Number(item.durationSeconds) || 0) / 60)), 0);
  const habitCount = Object.keys(state.habitCompletions?.[today] || {}).length;
  const journal = state.journals?.[today];
  const todoCount = (state.todos || []).filter(item => item.date === today && item.completed).length;
  const parts = [];
  if (minutes) parts.push(`完成了 ${minutes} 分钟专注`);
  if (habitCount) parts.push(`达成 ${habitCount} 项习惯`);
  if (todoCount) parts.push(`完成 ${todoCount} 项待办`);
  if (journal) parts.push('写下了今天的生活志');
  return parts.length ? `今天你已经${parts.join('，')}。` : '今天还没有新的生活记录。';
}

function greetingText() {
  const hour = new Date().getHours();
  return hour < 11 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
}

function aiMessagesHtml() {
  const key = state.settings.aiApiKey;
  if (!aiHistory.length) {
    const insight = (state.settings.aiDailyInsight || {}).date === dateKey() ? state.settings.aiDailyInsight : aiInsightCache;
    const narrative = insight?.text || localTodayInsight();
    return `<div class="ai-welcome"><div class="ai-welcome-hand">Hi, ${esc(state.profile.name || '朋友')} ✦</div><div class="ai-companion-bubble"><strong><span>Mine AI 伴侣</span><span class="material-symbols-outlined" aria-hidden="true">smart_toy</span></strong><p>${esc(greetingText())}，${esc(state.profile.name || '朋友')}！${esc(narrative)} 有什么想和我聊聊的吗？</p>${insight?.generatedAt ? `<small>${aiGeneratedTimeLabel(insight.generatedAt)}</small>` : ''}${key ? '<button type="button" id="ai-regenerate-insight" class="ai-insight-action">生成今日洞察</button>' : '<button type="button" id="ai-open-settings" class="ai-greet-setup">配置 AI 后开始对话</button>'}</div></div>`;
  }
  const firstAssistantIndex = aiHistory.findIndex(message => message.role === 'assistant');
  const items = aiHistory.map((m, index) => {
    const image = m.image ? `<img class="ai-msg-img" src="${m.image}" alt="发送的图片">` : '';
    const bubble = m.role === 'user' ? `${image}${esc(m.content)}` : assistantMessageHtml(m, index === firstAssistantIndex);
    const avatar = m.role === 'user' ? (state.profile?.avatar ? `<span class="ai-user-avatar"><img src="${imgSrc(state.profile.avatar)}" alt="用户头像"></span>` : '<span class="ai-user-avatar material-symbols-outlined" aria-label="用户">person</span>') : '';
    return `<div class="ai-msg ${m.role}"><div class="ai-bubble">${bubble}</div>${avatar}</div>`;
  }).join('');
  const typing = aiBusy && !aiHistory.some(message => message.streaming) ? '<div class="ai-msg assistant"><div class="ai-bubble ai-typing"><i></i><i></i><i></i></div></div>' : '';
  return items + typing;
}

// R4-2：图片账单确认卡片——每项可改（类型/金额/分类/日期/备注）+ 确认/取消 + 「这不是账单」放弃回退
function imageBillCardHtml(message) {
  const bill = message.imageBill;
  const category = LEDGER_CATEGORIES[bill.category] || LEDGER_CATEGORIES.other;
  const typeLabel = bill.type === 'income' ? '收入' : '支出';
  if (bill.status === 'saved') {
    return `<div class="ai-ledger-card" style="background:rgba(122,138,124,.1);border-radius:12px;padding:12px;display:flex;gap:10px;align-items:center"><span class="material-symbols-outlined" style="color:#5a6b5d">check_circle</span><div style="min-width:0"><strong style="font-size:13px">已记入账本</strong><p style="font-size:12px;color:#857d70;margin:2px 0 0">${typeLabel} · ${category.label} · ¥${bill.amount}${bill.note ? ` · ${esc(bill.note)}` : ''}</p></div></div>`;
  }
  if (bill.status === 'rejected') {
    return `<div class="ai-ledger-card" style="background:rgba(122,138,124,.08);border-radius:12px;padding:12px;display:flex;gap:10px;align-items:center"><span class="material-symbols-outlined" style="color:#857d70">close</span><div><strong style="font-size:13px">已取消</strong><p style="font-size:12px;color:#857d70;margin:2px 0 0">这笔没有写入账本。</p></div></div>`;
  }
  const labelStyle = 'display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;padding:3px 0;color:#3d3935';
  const inputStyle = 'flex:1;min-width:0;font-size:13px;padding:6px 8px;border:1px solid rgba(122,138,124,.35);border-radius:8px;background:#fff;color:#3d3935';
  if (bill.editing) {
    const categoryOptions = Object.entries(activeLedgerCategories()).map(([key, item]) => `<option value="${key}" ${bill.category === key ? 'selected' : ''}>${item.name || item.label}</option>`).join('');
    return `<div class="ai-ledger-card" style="background:#f7f5f0;border:1px solid rgba(122,138,124,.25);border-radius:12px;padding:12px;margin:6px 0">
      <div style="display:flex;align-items:center;gap:6px;font-weight:600;font-size:13px;margin-bottom:8px"><span class="material-symbols-outlined" style="font-size:18px;color:#5a6b5d">receipt_long</span>账单确认 · 修改</div>
      <label style="${labelStyle}">类型<select data-bill-field="type" style="${inputStyle}"><option value="expense" ${bill.type !== 'income' ? 'selected' : ''}>支出</option><option value="income" ${bill.type === 'income' ? 'selected' : ''}>收入</option></select></label>
      <label style="${labelStyle}">分类<select data-bill-field="category" style="${inputStyle}">${categoryOptions}</select></label>
      <label style="${labelStyle}">金额<input data-bill-field="amount" type="number" step="0.01" min="0.01" value="${bill.amount}" style="${inputStyle}"></label>
      <label style="${labelStyle}">日期<input data-bill-field="date" type="date" value="${bill.date}" style="${inputStyle}"></label>
      <label style="${labelStyle}">备注<input data-bill-field="note" type="text" value="${esc(bill.note)}" placeholder="商户/项目名" style="${inputStyle}"></label>
      <div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="save" data-bill-save="${esc(message.id)}" style="flex:1">保存修改</button><button type="button" data-bill-edit-cancel="${esc(message.id)}" style="flex:1">取消</button></div>
    </div>`;
  }
  const rows = [
    ['类型', typeLabel],
    ['分类', category.label],
    ['金额', `¥${bill.amount}`],
    ['日期', bill.date || '今天'],
    ...(bill.note ? [['备注', bill.note]] : [])
  ].map(([label, value]) => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0"><span style="color:#857d70">${label}</span><b>${esc(value)}</b></div>`).join('');
  return `<div class="ai-ledger-card" style="background:#f7f5f0;border:1px solid rgba(122,138,124,.25);border-radius:12px;padding:12px;margin:6px 0">
    <div style="display:flex;align-items:center;gap:6px;font-weight:600;font-size:13px;margin-bottom:8px"><span class="material-symbols-outlined" style="font-size:18px;color:#5a6b5d">receipt_long</span>账单确认</div>
    ${rows}${ledgerAccountPickerHtml(bill, 'bill')}<label style="display:flex;gap:6px;align-items:center;font-size:12px;margin-top:8px"><input type="checkbox" data-bill-remember>记住此商户归类</label>${bill.ruleKeyword ? `<p style="font-size:12px;color:#857d70">已按商户规则「${esc(bill.ruleKeyword)}」归类，可修改。</p>` : ''}
    <div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="save" data-bill-confirm="${esc(message.id)}" style="flex:1">确认记账</button><button type="button" data-bill-edit="${esc(message.id)}">修改</button></div>
    <div style="display:flex;gap:8px;margin-top:8px"><button type="button" data-bill-notbill="${esc(message.id)}" style="flex:1;color:#857d70">这不是账单</button><button type="button" data-bill-reject="${esc(message.id)}" style="flex:1">取消</button></div>
  </div>`;
}

// R4：记账确认卡片（pending 可确认/取消；saved/rejected 为结果态）
function ledgerCardHtml(message) {
  const ledger = message.ledger;
  const category = LEDGER_CATEGORIES[ledger.category] || LEDGER_CATEGORIES.other;
  const typeLabel = ledger.type === 'income' ? '收入' : '支出';
  if (ledger.status === 'saved') {
    return `<div class="ai-ledger-card" style="background:rgba(122,138,124,.1);border-radius:12px;padding:12px;display:flex;gap:10px;align-items:center"><span class="material-symbols-outlined" style="color:#5a6b5d">check_circle</span><div style="min-width:0"><strong style="font-size:13px">已记入账本</strong><p style="font-size:12px;color:#857d70;margin:2px 0 0">${typeLabel} · ${category.label} · ¥${ledger.amount}${ledger.note ? ` · ${esc(ledger.note)}` : ''}</p></div></div>`;
  }
  if (ledger.status === 'rejected') {
    return `<div class="ai-ledger-card" style="background:rgba(122,138,124,.08);border-radius:12px;padding:12px;display:flex;gap:10px;align-items:center"><span class="material-symbols-outlined" style="color:#857d70">close</span><div><strong style="font-size:13px">已取消</strong><p style="font-size:12px;color:#857d70;margin:2px 0 0">这笔没有写入账本。</p></div></div>`;
  }
  const dateLabel = ledger.date || '今天';
  const rows = [
    ['类型', typeLabel],
    ['分类', category.label],
    ['金额', `¥${ledger.amount}`],
    ...(ledger.note ? [['备注', ledger.note]] : []),
    ['日期', dateLabel]
  ].map(([label, value]) => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0"><span style="color:#857d70">${label}</span><b>${esc(value)}</b></div>`).join('');
  return `<div class="ai-ledger-card" style="background:#f7f5f0;border:1px solid rgba(122,138,124,.25);border-radius:12px;padding:12px;margin:6px 0">
    <div style="display:flex;align-items:center;gap:6px;font-weight:600;font-size:13px;margin-bottom:8px"><span class="material-symbols-outlined" style="font-size:18px;color:#5a6b5d">receipt_long</span>记账确认</div>
    ${rows}${ledgerAccountPickerHtml(ledger, 'ledger')}<label style="display:flex;gap:6px;align-items:center;font-size:12px;margin-top:8px"><input type="checkbox" data-ledger-remember>记住此商户归类</label>${ledger.ruleKeyword ? `<p style="font-size:12px;color:#857d70">已按商户规则「${esc(ledger.ruleKeyword)}」归类，可修改。</p>` : ''}
    <div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="save" data-ledger-confirm="${esc(message.id)}" style="flex:1">确认记账</button><button type="button" data-ledger-reject="${esc(message.id)}" style="flex:1">取消</button></div>
  </div>`;
}

function bindLedgerCards() {
  const saveMerchantRule = (item, remember) => {
    const keyword = String(item.note || '').trim().toLowerCase().slice(0, 80);
    if (!remember || !keyword || item.type === 'transfer') return;
    state.merchantCategoryRules = state.merchantCategoryRules || [];
    const existing = state.merchantCategoryRules.find(rule => rule.keyword === keyword);
    upsertMerchantCategoryRule(state, { id: existing?.id, keyword, categoryId: item.category, enabled: true });
  };
  const transactionFromCard = (item, prefix, button, photo = '') => {
    const sourceAccountId = button.closest('.ai-bubble')?.querySelector(`[data-${prefix}-source]`)?.value || '';
    const targetAccountId = button.closest('.ai-bubble')?.querySelector(`[data-${prefix}-target]`)?.value || '';
    const accountId = button.closest('.ai-bubble')?.querySelector(`[data-${prefix}-account]`)?.value || 'unassigned';
    if (item.type === 'transfer' && (!sourceAccountId || !targetAccountId || sourceAccountId === targetAccountId)) { show('请分别选择转出和转入账户'); return null; }
    return makeTransaction({ ...item, accountId, sourceAccountId, targetAccountId, photo, date: item.date || dateKey() });
  };
  $$('[data-ledger-confirm]').forEach(button => button.onclick = async () => {
    const message = aiHistory.find(item => item.id === button.dataset.ledgerConfirm);
    if (!message?.ledger || message.ledger.status !== 'pending') return;
    const ledger = message.ledger;
    state.transactions = state.transactions || [];
    const transaction = transactionFromCard(ledger, 'ledger', button);
    if (!transaction) return;
    state.transactions.push(transaction);
    saveMerchantRule(ledger, button.closest('.ai-bubble')?.querySelector('[data-ledger-remember]')?.checked);
    message.ledger.status = 'saved';
    await save();
    renderAiMessages();
    show('已记入账本');
  });
  $$('[data-ledger-reject]').forEach(button => button.onclick = () => {
    const message = aiHistory.find(item => item.id === button.dataset.ledgerReject);
    if (!message?.ledger || message.ledger.status !== 'pending') return;
    message.ledger.status = 'rejected';
    renderAiMessages();
  });
  // R4-2：图片账单卡片
  $$('[data-bill-confirm]').forEach(button => button.onclick = async () => {
    const message = aiHistory.find(item => item.id === button.dataset.billConfirm);
    if (!message?.imageBill || message.imageBill.status !== 'pending') return;
    const bill = message.imageBill;
    // 账单图片：取该卡片上一条 user 消息的 image（调用方传入，makeTransaction 已支持 photo）
    const messageIndex = aiHistory.indexOf(message);
    const userMessage = messageIndex > 0 ? aiHistory[messageIndex - 1] : null;
    const photo = userMessage?.role === 'user' ? String(userMessage.image || '') : '';
    state.transactions = state.transactions || [];
    const transaction = transactionFromCard(bill, 'bill', button, photo);
    if (!transaction) return;
    state.transactions.push(transaction);
    saveMerchantRule(bill, button.closest('.ai-bubble')?.querySelector('[data-bill-remember]')?.checked);
    bill.status = 'saved';
    await save();
    renderAiMessages();
    show('已记入账本');
  });
  $$('[data-bill-reject]').forEach(button => button.onclick = () => {
    const message = aiHistory.find(item => item.id === button.dataset.billReject);
    if (!message?.imageBill || message.imageBill.status !== 'pending') return;
    message.imageBill.status = 'rejected';
    renderAiMessages();
  });
  $$('[data-bill-edit]').forEach(button => button.onclick = () => {
    const message = aiHistory.find(item => item.id === button.dataset.billEdit);
    if (!message?.imageBill || message.imageBill.status !== 'pending') return;
    message.imageBill.editing = true;
    renderAiMessages();
  });
  $$('[data-bill-edit-cancel]').forEach(button => button.onclick = () => {
    const message = aiHistory.find(item => item.id === button.dataset.billEditCancel);
    if (!message?.imageBill) return;
    message.imageBill.editing = false;
    renderAiMessages();
  });
  $$('[data-bill-save]').forEach(button => button.onclick = () => {
    const message = aiHistory.find(item => item.id === button.dataset.billSave);
    if (!message?.imageBill) return;
    const bill = message.imageBill;
    const card = button.closest('[data-bill-save]')?.parentElement?.parentElement;
    const field = name => card?.querySelector(`[data-bill-field="${name}"]`)?.value ?? '';
    const amount = Number(field('amount'));
    if (!Number.isFinite(amount) || amount <= 0) { show('金额无效，请输入大于 0 的数字'); return; }
    bill.type = field('type') === 'income' ? 'income' : 'expense';
    bill.category = activeLedgerCategories()[field('category')] ? field('category') : 'other';
    bill.amount = Math.round(amount * 100) / 100;
    bill.date = /^\d{4}-\d{2}-\d{2}$/.test(field('date')) ? field('date') : '';
    bill.note = String(field('note') || '').trim().slice(0, 100);
    bill.editing = false;
    renderAiMessages();
    show('已修改');
  });
  // R4-2：「这不是账单」——丢弃记账解读，将该图按普通图片聊天处理（图片+描述入聊天）
  $$('[data-bill-notbill]').forEach(button => button.onclick = async () => {
    const message = aiHistory.find(item => item.id === button.dataset.billNotbill);
    if (!message?.imageBill || message.imageBill.status !== 'pending') return;
    const desc = message.imageBill.description || '一张图片';
    const idx = aiHistory.indexOf(message);
    if (idx > 0 && aiHistory[idx - 1].role === 'user') aiHistory[idx - 1].imageDesc = desc;
    aiHistory.splice(idx, 1);
    aiBusy = true;
    renderAiMessages();
    try {
      const reply = await aiChat(state, aiMessagesForModel(aiHistory.slice(-12)));
      pushHistory({ role: 'assistant', content: reply });
      persistAiHistory();
      updateAiMemory().catch(() => {});
    } catch (error) {
      pushHistory({ role: 'assistant', content: error.message || '请求失败，请稍后重试。' });
      persistAiHistory();
    } finally {
      aiBusy = false;
      renderAiMessages();
    }
  });
}

function renderAiMessages() {
  const box = $('#ai-messages');
  if (!box) return;
  if (!aiStickToBottom) aiHasUnread = true;
  box.innerHTML = aiMessagesHtml();
  bindLedgerCards();
  bindAiMessageActions();
  bindAiWelcomeActions();
  scrollMessagesToBottom(box);
  box.onscroll = () => { aiStickToBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40; if (aiStickToBottom) aiHasUnread = false; };
  syncNewMessageButton(box);
}

function syncNewMessageButton(box) {
  const old = $('#ai-new-message');
  if (aiHasUnread && !old) {
    const button = document.createElement('button');
    button.type = 'button'; button.id = 'ai-new-message'; button.className = 'ai-new-message'; button.textContent = '有新消息 · 回到最新';
    button.onclick = () => { aiStickToBottom = true; aiHasUnread = false; box.scrollTop = box.scrollHeight; syncNewMessageButton(box); };
    box.parentElement?.appendChild(button);
  } else if ((!aiHasUnread || aiStickToBottom) && old) old.remove();
}

// 滚底 + 图片加载完成后的跟随兜底（base64 图片立即渲染，但仍处理 onload 异步场景）
function scrollMessagesToBottom(box) {
  if (aiStickToBottom) box.scrollTop = box.scrollHeight;
  box.querySelectorAll('img').forEach(img => {
    img.onload = () => {
      if (aiStickToBottom) box.scrollTop = box.scrollHeight;
    };
  });
}

function bindAiWelcomeActions() {
  $('#ai-open-settings')?.addEventListener('click', aiSettingsForm);
  $('#ai-regenerate-insight')?.addEventListener('click', () => {
    const btn = $('#ai-regenerate-insight');
    if (aiInsightGenerating || !btn) return;
    btn.disabled = true;
    maybeGenerateInsight(true).finally(() => {
      const next = $('#ai-regenerate-insight');
      if (next) next.disabled = false;
    });
  });
}

function bindAiMessageActions() {
  $$('[data-ai-retry]').forEach(button => button.onclick = async () => {
    const index = aiHistory.findIndex(item => item.id === button.dataset.aiRetry);
    if (index < 1 || aiBusy) return;
    const user = aiHistory[index - 1];
    aiHistory.splice(index, 1);
    aiStickToBottom = true;
    aiHasUnread = false;
    aiBusy = true;
    renderAiMessages();
    try {
      if (user.image) await retryImageMessage(user);
      else await replyAsAssistant();
    } catch (error) {
      pushHistory({ role: 'assistant', id: uid(), content: error.message || '处理失败，请稍后重试。', failed: true });
      persistAiHistory();
    } finally {
      aiBusy = false;
      renderAiMessages();
    }
  });
  $$('[data-ai-edit-failed]').forEach(button => button.onclick = () => {
    const index = aiHistory.findIndex(item => item.id === button.dataset.aiEditFailed);
    const user = aiHistory[index - 1];
    if (!user) return;
    aiHistory.splice(index - 1, 2);
    aiDraft = user.content || '';
    aiPendingImage = user.image || '';
    render();
  });
  $$('[data-ai-cancel-failed]').forEach(button => button.onclick = () => {
    const index = aiHistory.findIndex(item => item.id === button.dataset.aiCancelFailed);
    if (index > 0) aiHistory.splice(index - 1, 2);
    persistAiHistory();
    renderAiMessages();
  });
}

function aiComposerActionHtml(key) {
  return aiStreamController
    ? '<button id="ai-stop-stream" aria-label="停止生成"><span class="material-symbols-outlined">stop</span></button>'
    : `<button id="ai-send" aria-label="发送" ${key ? '' : 'disabled'}><span class="material-symbols-outlined">send</span></button>`;
}

export function aiSemanticPreview(stateValue, query) {
  return retrieveSemanticContext(stateValue, query);
}

function semanticScopeHtml(query = '') {
  const draft = String(query || '').trim();
  const preview = draft ? aiSemanticPreview(state, draft) : aiLastSemanticPreview;
  if (!preview?.count) return '<div class="ai-semantic-scope is-empty" id="ai-semantic-scope"><span class="material-symbols-outlined">database</span><small>输入问题后，可在本机预览背景范围</small></div>';
  const prefix = draft ? '本次将参考' : '上一轮参考了';
  const details = aiSemanticPreviewOpen
    ? `<div class="ai-semantic-scope-list">${preview.records.map(item => `<span>${esc(semanticRecordLabel(item))}</span>`).join('')}${preview.truncated ? '<em>更多记录已按字符预算截断</em>' : ''}</div>`
    : '';
  return `<div class="ai-semantic-scope" id="ai-semantic-scope"><button type="button" id="ai-semantic-scope-toggle" aria-expanded="${aiSemanticPreviewOpen}"><span class="material-symbols-outlined">database</span><small>${prefix} ${preview.count} 条本地记录</small><span class="material-symbols-outlined">${aiSemanticPreviewOpen ? 'expand_less' : 'expand_more'}</span></button>${details}</div>`;
}

function bindSemanticScopePreview() {
  $('#ai-semantic-scope-toggle')?.addEventListener('click', () => {
    aiSemanticPreviewOpen = !aiSemanticPreviewOpen;
    const container = $('#ai-semantic-scope');
    if (container) container.outerHTML = semanticScopeHtml($('#ai-input')?.value || aiDraft);
    bindSemanticScopePreview();
  });
}

function updateSemanticScopePreview(query) {
  aiSemanticPreviewOpen = false;
  const container = $('#ai-semantic-scope');
  if (container) container.outerHTML = semanticScopeHtml(query);
  bindSemanticScopePreview();
}

export function aiView() {
  const key = state.settings.aiApiKey;
  const imagePreview = aiPendingImage ? `<div class="ai-image-preview"><img src="${aiPendingImage}" alt="待发送图片"><button type="button" id="ai-remove-image" aria-label="移除图片">×</button></div>` : '';
  const chatHtml = `<section class="ai-chat-page ${aiChatExpanded ? 'is-immersive' : ''}"><header class="ai-chat-header"><button type="button" id="ai-back-overview" aria-label="返回 AI 总览"><span class="material-symbols-outlined">arrow_back</span></button><div><b>暖色生活志 AI 伴侣</b><small>Mind & Reflection</small></div><button type="button" id="ai-clear" aria-label="清空聊天"><span class="material-symbols-outlined">more_horiz</span></button></header><div class="ai-chat"><div class="ai-messages" id="ai-messages">${aiMessagesHtml()}</div>${aiHasUnread ? '<button type="button" class="ai-new-message" id="ai-new-message">有新消息 · 回到最新</button>' : ''}${semanticScopeHtml(aiDraft)}${imagePreview}<div class="ai-composer"><button id="ai-add-image" aria-label="添加图片" ${key ? '' : 'disabled'}><span class="material-symbols-outlined">image</span></button><textarea id="ai-input" rows="1" placeholder="${key ? '输入消息…' : '请先配置 API Key'}" ${key ? '' : 'disabled'} autocomplete="off">${esc(aiDraft)}</textarea>${micButtonHtml()}${aiComposerActionHtml(key)}</div></div></section>`;
  return `<section class="view ai-view ai-companion-screen">
    <header class="subpage-header ai-companion-page-header"><div class="subpage-title">暖色生活志 AI 伴侣</div><div class="subpage-subtitle">DeepSeek-V3 · Mind & Reflection</div></header>
    <div class="stream-sheet ai-stream-sheet"><div class="sheet-handle"></div>
      <div class="segmented-control ai-tabs"><button type="button" class="segment-btn ${aiTab === 'chat' ? 'active' : ''}" data-ai-tab="chat"><span class="material-symbols-outlined">forum</span>伴侣对话</button><button type="button" class="segment-btn ${aiTab === 'report' ? 'active' : ''}" data-ai-tab="report"><span class="material-symbols-outlined">bar_chart</span>每周生活小结</button><button type="button" class="segment-btn ${aiTab === 'memory' ? 'active' : ''}" data-ai-tab="memory"><span class="material-symbols-outlined">psychology</span>长期记忆库</button></div>
      <div class="ai-panel ai-chat-panel" id="ai-panel-chat" ${aiTab === 'chat' ? '' : 'hidden'}>${chatHtml}</div>
      <div class="ai-panel ai-report-panel" id="ai-panel-report" ${aiTab === 'report' ? '' : 'hidden'}>${reportPanelHtml()}</div>
      <div class="ai-panel ai-memory-panel" id="ai-panel-memory" ${aiTab === 'memory' ? '' : 'hidden'}>${memoryPanelHtml()}</div>
    </div>
  </section>`;
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const WEEKLY_TRACKS = [
  { key: 'study', icon: '🎓', title: '学习备考' },
  { key: 'wellbeing', icon: '🌿', title: '身心作息' },
  { key: 'finance', icon: '💰', title: '生活财务' },
  { key: 'media', icon: '📚', title: '书影音' }
];

function weeklyMetrics(now = new Date()) {
  return callHelper('warmWeeklyLifeMetrics', now) || { dateRange: { start: '', end: '' }, dailyFocus: [], focus: {}, habits: {}, ledger: {}, journals: {}, media: {} };
}

function weeklyDateRange(metrics) {
  const display = value => String(value || '').replaceAll('-', '.');
  return `${display(metrics.dateRange?.start)} - ${display(metrics.dateRange?.end)}`;
}

function hasWeeklyLifeData(metrics) {
  return Number(metrics.focus?.sessions || 0) > 0
    || Number(metrics.habits?.completed || 0) > 0
    || Number(metrics.ledger?.transactionCount || 0) > 0
    || Number(metrics.ledger?.budgetTotal || 0) > 0
    || Number(metrics.journals?.count || 0) > 0
    || Number(metrics.media?.completed || 0) > 0
    || Number(metrics.media?.inProgress || 0) > 0;
}

function weeklyFlowScore(metrics) {
  return calculateWeeklyFlowScore(state, metrics, session => callHelper('calculateFlowScore', session));
}

function buildLocalWeeklyReport(metrics) {
  const peakMinutes = Math.max(0, ...((metrics.dailyFocus || []).map(item => Number(item.minutes) || 0)));
  const dailyFocusChart = (metrics.dailyFocus || []).slice(0, 7).map((item, index) => ({
    dayName: WEEKDAY_LABELS[index],
    hours: Math.max(0, Number(item.hours) || 0),
    isPeak: peakMinutes > 0 && Number(item.minutes) === peakMinutes
  }));
  return {
    weekStart: metrics.dateRange?.start || '',
    weekEnd: metrics.dateRange?.end || '',
    dateRange: weeklyDateRange(metrics),
    weekNumber: Number(metrics.weekNumber) || 0,
    kpis: {
      focusTotalMinutes: Math.max(0, Number(metrics.focus?.totalMinutes) || 0),
      focusDifferenceMinutes: Number(metrics.focus?.differenceMinutes) || 0,
      habitCompletionRate: Math.max(0, Math.min(100, Number(metrics.habits?.completionRate) || 0)),
      habitStreak: Math.max(0, Number(metrics.habits?.currentStreak) || 0),
      weeklyExpense: Math.max(0, Number(metrics.ledger?.totalExpense) || 0),
      remainingBudget: Number(metrics.ledger?.remainingBudget) || 0,
      journalCount: Math.max(0, Number(metrics.journals?.count) || 0),
      journalWordCount: Math.max(0, Number(metrics.journals?.wordCount) || 0),
      mediaCount: Math.max(0, Number(metrics.media?.completed) || 0),
      flowScore: weeklyFlowScore(metrics)
    },
    dailyFocusChart
  };
}

function currentWeeklyCache(metrics) {
  const reports = Array.isArray(state.weeklyInsightReports) ? state.weeklyInsightReports : [];
  for (let index = reports.length - 1; index >= 0; index -= 1) {
    const report = reports[index];
    if (report.weekStart === metrics.dateRange?.start && report.weekEnd === metrics.dateRange?.end) return report;
  }
  return null;
}

function minutesLabel(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return hours ? `${hours}h${rest ? ` ${rest}m` : ''}` : `${rest}m`;
}

function signedMinutesLabel(minutes) {
  const value = Math.round(Number(minutes) || 0);
  if (!value) return '与前周持平';
  return `${value > 0 ? '+' : '-'}${minutesLabel(Math.abs(value))} 较前周`;
}

function reportNarrativeHtml(report, key, hasData) {
  if (weekGenerating) return '<h3 class="ai-report-theme ai-report-theme-empty">正在生成周报…</h3><p class="ai-report-status is-loading">正在等待 AI 返回叙事，请勿重复点击。</p>';
  if (weekGenerationError) return `<h3 class="ai-report-theme ai-report-theme-empty">周报叙事生成失败</h3><p class="ai-report-status is-error">${esc(weekGenerationError)}。不会自动重试，请再次点击生成。</p>`;
  if (report?.status === 'ready') return `<h3 class="ai-report-theme">「${esc(report.themeTitle)}」</h3><p class="ai-report-summary">${esc(report.summaryNarrative)}</p>`;
  if (report?.status === 'failed') return '<h3 class="ai-report-theme ai-report-theme-empty">周报叙事生成失败</h3><p class="ai-report-status is-error">本地指标已保留。不会自动重试，请再次点击生成。</p>';
  if (!hasData) return '<h3 class="ai-report-theme ai-report-theme-empty">上一完整周暂无记录</h3><p class="ai-report-status">先记录专注、习惯、账本、日记或书影音，下周即可生成复盘。</p>';
  if (!key) return '<h3 class="ai-report-theme ai-report-theme-empty">AI 文案尚未生成</h3><p class="ai-report-status">未配置 AI Key；本地 KPI 与图表仍可正常查看。</p>';
  return '<h3 class="ai-report-theme ai-report-theme-empty">AI 文案尚未生成</h3><p class="ai-report-status">点击下方“生成周报”后，才会发送获授权的定性信号。</p>';
}

// ---- 每周生活小结：上一完整自然周，本地 KPI + AI 叙事 ----
function reportPanelHtml() {
  const metrics = weeklyMetrics();
  const local = buildLocalWeeklyReport(metrics);
  const cached = currentWeeklyCache(metrics);
  const report = cached ? { ...local, ...cached, kpis: cached.kpis || local.kpis, dailyFocusChart: cached.dailyFocusChart?.length === 7 ? cached.dailyFocusChart : local.dailyFocusChart } : local;
  const key = state.settings.aiApiKey;
  const hasData = hasWeeklyLifeData(metrics);
  const k = report.kpis;
  const kpis = [
    { val: minutesLabel(k.focusTotalMinutes), lbl: '专注总时长', sub: signedMinutesLabel(k.focusDifferenceMinutes) },
    { val: `${k.habitCompletionRate}%`, lbl: '习惯完成率', sub: `${k.habitStreak} 天 Streak` },
    { val: `¥${Number(k.weeklyExpense).toFixed(2)}`, lbl: '周支出', sub: `剩余预算 ¥${Number(k.remainingBudget).toFixed(2)}` },
    { val: `${k.journalCount} 篇`, lbl: '生活志日记', sub: `${k.journalWordCount} 字 · 书影音 ${k.mediaCount}` }
  ];
  const maxHours = Math.max(0, ...report.dailyFocusChart.map(item => Number(item.hours) || 0));
  const chart = `<div class="ai-report-chart">${report.dailyFocusChart.map(item => {
    const hours = Number(item.hours) || 0;
    const height = hours && maxHours ? Math.max(8, Math.round(hours / maxHours * 100)) : 4;
    return `<div class="ai-chart-col"><div class="ai-chart-bar ${item.isPeak ? 'active' : ''}" style="height:${height}%"></div><span class="ai-chart-label ${item.isPeak ? 'peak' : ''}">${esc(String(item.dayName || '').replace(/^周/, ''))}</span></div>`;
  }).join('')}</div>`;
  const peak = report.dailyFocusChart.find(item => item.isPeak);
  const ready = report.status === 'ready';
  const tracks = WEEKLY_TRACKS.map(item => ({ ...item, desc: ready ? report.tracks?.[item.key] : (hasData ? 'AI 定性复盘尚未生成' : '本周暂无对应记录') }));
  const advice = ready ? report.nextWeekActionAdvice : [];
  const actionId = ready ? 'regenerate-weekly-report' : 'generate-weekly-report';
  const actionLabel = weekGenerating ? '生成中…' : ready ? '重新生成' : '生成周报';
  const actionDisabled = weekGenerating || !key || !hasData;
  return `<div class="ai-report">
    <article class="ai-report-card">
      <div class="ai-report-head"><div><span class="ai-report-badge">第 ${report.weekNumber} 周生活志洞察${ready ? ' · AI 生成' : ''}</span>${reportNarrativeHtml(report, key, hasData)}<small class="ai-report-range">${esc(report.dateRange)}${report.generatedAt ? ` · ${aiGeneratedTimeLabel(report.generatedAt)}` : ''}</small></div><span class="ai-report-flow">综合心流 <b>${k.flowScore}</b> 分</span></div>
      <div class="ai-report-kpis">${kpis.map(item => `<div class="ai-report-kpi"><div class="ai-report-kpi-val">${esc(item.val)}</div><div class="ai-report-kpi-lbl">${esc(item.lbl)}</div><small>${esc(item.sub)}</small></div>`).join('')}</div>
      <div class="ai-report-section"><div class="ai-report-section-head"><strong>周一至周日专注分布</strong></div>${chart}${peak ? `<small class="ai-chart-note">峰值：${esc(peak.dayName)} ${esc(minutesLabel(Math.round(Number(peak.hours) * 60)))}</small>` : '<small class="ai-chart-note">本周无专注峰值</small>'}</div>
      <div class="ai-report-section"><div class="ai-report-section-head"><strong>四轨深度复盘</strong></div><div class="ai-report-tracks">${tracks.map(t => `<div class="ai-report-track"><span>${t.icon}</span><div><strong>${esc(t.title)}</strong><p>${esc(t.desc)}</p></div></div>`).join('')}</div></div>
      <div class="ai-report-section ai-report-advice"><div class="ai-report-section-head"><span class="material-symbols-outlined">tips_and_updates</span><strong>下周三条行动建议</strong></div>${advice.length ? `<ul>${advice.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : '<p class="ai-report-advice-empty">AI 叙事生成后显示三条建议。</p>'}</div>
      <div class="ai-report-actions"><button type="button" id="${actionId}" ${actionDisabled ? 'disabled' : ''}>${actionLabel}</button><button type="button" id="ai-report-chat" ${ready ? '' : 'disabled'}>💬 与 AI 深入探讨</button></div>
    </article>
  </div>`;
}

// ---- 长期记忆库面板：目标/偏好/生活三组胶囊（阶段 1 简单规则分组）----
const MEMORY_GROUPS = [
  { key: 'goal', title: '目标档案', icon: 'flag', hint: '目标、计划与备考', match: /目标|考研|考|计划|冲刺|要完成|想/ },
  { key: 'pref', title: '偏好习惯', icon: 'favorite', hint: '喜欢、偏好与日常习惯', match: /喜欢|偏好|习惯|爱|常|平时/ },
  { key: 'life', title: '生活点滴', icon: 'auto_stories', hint: '其余的日常了解', match: null }
];

function memoryPanelHtml() {
  const buckets = { goal: [], pref: [], life: [] };
  (state.aiMemory || []).forEach(item => {
    const group = MEMORY_GROUPS.find(g => g.match && g.match.test(item.text)) || MEMORY_GROUPS[2];
    buckets[group.key].push(item);
  });
  const sections = MEMORY_GROUPS.map(group => {
    const items = buckets[group.key];
    const body = items.length
      ? items.map(item => `<div class="ai-capsule"><span class="ai-capsule-icon material-symbols-outlined">${group.icon}</span><div class="ai-capsule-main"><p>${esc(item.text)}</p><small>${memorySourceLabel(item.source)}</small></div></div>`).join('')
      : `<p class="ai-card-empty">还没有${group.title}，多和 AI 聊聊它会慢慢懂你。</p>`;
    return `<div class="ai-memory-group"><div class="ai-memory-group-head"><span class="material-symbols-outlined">${group.icon}</span><strong>${group.title}</strong><small>${group.hint}${items.length ? ` · ${items.length} 条` : ''}</small></div><div class="ai-memory-capsules">${body}</div></div>`;
  }).join('');
  return `<div class="ai-memory-panel-content"><div class="ai-memory-intro"><span class="eyebrow">LONG-TERM MEMORY</span><h3>它记得的关于你</h3><p>目标、偏好与日常点滴——记忆只存本机，可随时编辑、删除、导出。</p></div>${sections}<button type="button" id="ai-memory-entry" class="ai-card-action">查看全部记忆</button></div>`;
}

// 生成时间小字：当日只显示 HH:MM:SS，跨日带 MM-DD；无时间戳（旧数据）返回空串不显示
function aiGeneratedTimeLabel(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? `生成于 ${time}` : `生成于 ${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

export function switchAiTab(tab) {
  if (aiTab === tab && !aiChatExpanded) return;
  if (aiChatExpanded) stopAiStream();
  aiDraft = $('#ai-input')?.value ?? aiDraft;
  aiChatExpanded = false;
  aiTab = tab;
  callHelper('syncAiChatChrome', false);
  render();
}

function enterAiChat() {
  if (aiChatExpanded || aiTab !== 'chat') return;
  aiChatExpanded = true;
  $('.ai-chat-page')?.classList.add('is-immersive');
  callHelper('syncAiChatChrome', true);
}

function returnToAiOverview() {
  if (!aiChatExpanded) return false;
  aiDraft = $('#ai-input')?.value ?? aiDraft;
  stopAiStream();
  aiChatExpanded = false;
  callHelper('syncAiChatChrome', false);
  render();
  return true;
}

function insightFingerprint() {
  return insightDataFingerprint(state);
}

async function maybeGenerateInsight(force = false) {
  const day = dateKey(); const fingerprint = insightFingerprint();
  const cache = state.settings.aiDailyInsight || {};
  if (cache.date === day && cache.text) aiInsightCache = cache;
  if (aiInsightGenerating || document.visibilityState !== 'visible') return;
  if (!force && aiInsightCache.date === day && aiInsightCache.fingerprint === fingerprint && aiInsightCache.text) return;
  if (!force) return;
  aiInsightGenerating = true;
  try {
    const text = await aiDailyInsight(state);
    if (!text) return;
    aiInsightCache = { date: day, text, fingerprint, generatedAt: Date.now() };
    state.settings.aiDailyInsight = aiInsightCache;
    await save();
    fillInsightSlot(text, aiInsightCache.generatedAt);
  } catch { /* 保留最近成功洞察，下次可见时补试 */ } finally {
    aiInsightGenerating = false;
  }
}

function fillInsightSlot(text) {
  // 洞察已写入缓存（settings.aiDailyInsight / aiInsightCache）；聊天欢迎区无历史时重渲染展示
  if (!text) return;
  if (!aiHistory.length) renderAiMessages();
}

async function generateWeeklyReport(force = false, now = new Date()) {
  const metrics = weeklyMetrics(now);
  if (weekGenerating || !state.settings.aiApiKey || !hasWeeklyLifeData(metrics)) return;
  if (!force && findReadyWeeklyInsightReport(state.weeklyInsightReports, metrics)) return;
  const local = buildLocalWeeklyReport(metrics);
  weekGenerationError = '';
  weekGenerating = true;
  render();
  try {
    const narrative = await aiGenerateWeeklyInsight(state, metrics);
    const report = { id: uid(), ...local, ...narrative, generatedAt: Date.now(), status: 'ready' };
    state.weeklyInsightReports = upsertWeeklyInsightReport(state.weeklyInsightReports, report);
    await save();
  } catch (error) {
    weekGenerationError = error.message || '周报生成失败';
    show(error.message || '周报生成失败，请稍后手动重试');
  } finally {
    weekGenerating = false;
    render();
  }
}

function discussWeeklyReport() {
  const report = findReadyWeeklyInsightReport(state.weeklyInsightReports, weeklyMetrics());
  if (!report) return;
  aiDraft = `我想深入探讨上一周的生活周报「${report.themeTitle}」。周报摘要：${report.summaryNarrative}`;
  aiStickToBottom = true;
  switchAiTab('chat');
}

async function runAiLedgerAnalysis(payload) {
  show('正在生成消费分析…');
  try {
    const text = await aiLedgerAnalysis(state, payload);
    modal(`<div class="modal-head"><div><span class="eyebrow">SPENDING REVIEW</span><h2>AI 消费分析</h2></div></div><p class="ai-ledger-analysis-copy">${esc(text)}</p><div class="modal-actions"><button type="button" data-close>关闭</button></div>`, 'ai-ledger-analysis-modal');
    return text;
  } catch (error) {
    show(error.message || 'AI 消费分析失败，请稍后手动重试');
    return null;
  }
}

function currentLedgerAnalysisPayload() {
  const summary = ledgerSummary(state);
  const start = summary.period?.start || '';
  const end = summary.period?.end || '';
  const expenses = (state.transactions || []).filter(item => item.type === 'expense' && item.date >= start && item.date <= end);
  return { start, end, expenses };
}

const runAiRecognizeLedgerImage = image => aiRecognizeLedgerImage(state, image);
const runAiFocusCoach = session => aiFocusCoach(state, session);

export function dailySummaryRequestState(source, targetDate) {
  const settings = source?.settings || {};
  const groupMinutes = new Map();
  (source?.sessions || []).filter(item => item.date === targetDate).forEach(item => {
    const project = (source?.focusProjects || []).find(entry => entry.id === item.projectId);
    const group = String(project?.group || '其他').slice(0, 40);
    const minutes = Math.max(0, Number(item.minutes) || Math.round((Number(item.durationSeconds) || 0) / 60));
    groupMinutes.set(group, (groupMinutes.get(group) || 0) + minutes);
  });
  const grouped = [...groupMinutes.entries()];
  const sessions = grouped.map(([group, minutes], index) => ({ date: targetDate, minutes, projectId: `group-${index}` }));
  const focusProjects = grouped.map(([group], index) => ({ id: `group-${index}`, group }));
  const completion = todayCompletion(source, targetDate);
  const weekDay = new Date(`${targetDate}T12:00:00`).getDay();
  const habits = Array.from({ length: completion.total }, (_, index) => ({ id: `habit-${index}`, archived: false, goalPeriod: 'daily', repeatDays: [weekDay], goalType: 'minimum', target: 1 }));
  const checks = Object.fromEntries(habits.map((habit, index) => [habit.id, index < completion.done ? 1 : 0]));
  const todos = (source?.todos || []).filter(item => item.date === targetDate).map(item => ({ date: targetDate, title: String(item.title || '').slice(0, 80), completed: Boolean(item.completed) }));
  const snippets = (source?.snippets || []).filter(item => item.date === targetDate).map(item => ({ date: targetDate, type: item.type === 'photo' ? 'photo' : 'text', text: item.type === 'text' ? String(item.text || '').slice(0, 40) : '' }));
  const journal = source?.journals?.[targetDate];
  return {
    settings: { aiProvider: settings.aiProvider, aiBaseUrl: settings.aiBaseUrl, aiModel: settings.aiModel, aiApiKey: settings.aiApiKey, aiEmotionCare: false, ledgerBudget: { total: 0, categories: {} } },
    profile: {},
    aiMemory: [],
    sessions,
    focusProjects,
    habits,
    checks: { [targetDate]: checks },
    habitSkips: { [targetDate]: [] },
    todos,
    snippets,
    journals: journal ? { [targetDate]: { content: String(journal.content || '').slice(0, 120), mood: String(journal.mood || '') } } : {},
    transactions: [],
    ledgerAccounts: [],
    ledgerCategories: []
  };
}

// 无参数只兼容 Calendar 进入时的缓存读取；scheduled 与 explicit 才允许联网。
export async function ensureDailySummary(options = {}, dependencies = {}) {
  const targetState = dependencies.state || state;
  const generate = dependencies.generate || aiDailySummary;
  const persist = dependencies.persist || save;
  const now = dependencies.now instanceof Date ? new Date(dependencies.now) : new Date();
  const request = typeof options === 'string' ? { explicit: true, date: options } : (options && typeof options === 'object' ? options : {});
  const scheduled = request.scheduled === true;
  const explicit = request.explicit === true;
  const force = explicit && request.force === true;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const scheduledDate = dateKey(yesterday);
  const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(request.date || '')) ? String(request.date) : scheduledDate;
  const targetDate = scheduled ? scheduledDate : requestedDate;
  const existing = targetState.dailySummaries?.[targetDate];
  if (existing?.text && !force) return existing;
  if ((!scheduled && !explicit) || !targetState.settings?.aiApiKey) return null;
  const text = await generate(dailySummaryRequestState(targetState, targetDate), targetDate);
  if (!String(text || '').trim()) throw new Error('AI 每日小结返回为空');
  const summary = makeDailySummary(text);
  targetState.dailySummaries = targetState.dailySummaries || {};
  targetState.dailySummaries[targetDate] = summary;
  try {
    await persist();
  } catch (error) {
    if (existing) targetState.dailySummaries[targetDate] = existing;
    else delete targetState.dailySummaries[targetDate];
    throw error;
  }
  return summary;
}

export function runScheduledAutoSummary(dependencies) {
  return ensureDailySummary({ scheduled: true }, dependencies);
}

const COMPOSER_MIN_HEIGHT = 40;  // 1 行（line-height 24 + padding 16）
const COMPOSER_MAX_HEIGHT = 136; // 约 5 行后内部滚动

// textarea 高度自适应：内容增高自动长高，超过 5 行后内部滚动
function autosizeComposer() {
  const box = $('#ai-input');
  if (!box) return;
  box.style.height = 'auto';
  const height = Math.max(COMPOSER_MIN_HEIGHT, Math.min(box.scrollHeight, COMPOSER_MAX_HEIGHT));
  box.style.height = `${height}px`;
  box.style.overflowY = box.scrollHeight > COMPOSER_MAX_HEIGHT ? 'auto' : 'hidden';
}

// 发送后清空并复位高度（1 行）
function resetComposerHeight() {
  const box = $('#ai-input');
  if (!box) return;
  box.style.height = '';
  box.style.overflowY = 'hidden';
}

function stopAiStream() {
  aiStreamController?.abort();
}

function bindStreamActionButton() {
  $('#ai-send')?.addEventListener('click', () => aiSend());
  $('#ai-stop-stream')?.addEventListener('click', stopAiStream);
}

function syncStreamActionButton() {
  const current = $('#ai-send') || $('#ai-stop-stream');
  if (!current) return;
  current.outerHTML = aiComposerActionHtml(state.settings.aiApiKey);
  bindStreamActionButton();
}

function scheduleStreamMessageRender() {
  if (aiStreamFrame) return;
  const schedule = globalThis.requestAnimationFrame || (callback => queueMicrotask(callback));
  aiStreamFrame = schedule(() => {
    aiStreamFrame = 0;
    renderAiMessages();
  });
}

function flushStreamMessageRender() {
  if (aiStreamFrame && globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame(aiStreamFrame);
  aiStreamFrame = 0;
  renderAiMessages();
}

async function aiSend(text) {
  if (aiBusy) return;
  const content = (text ?? '').trim() || ($('#ai-input')?.value.trim() ?? '');
  const image = aiPendingImage;
  if (!content && !image) return;
  if (content && !image) {
    aiLastSemanticPreview = aiSemanticPreview(state, content);
    aiSemanticPreviewOpen = false;
  }
  const input = $('#ai-input');
  if (input) { input.value = ''; aiDraft = ''; resetComposerHeight(); }
  aiStickToBottom = true;

  if (image) {
    if (!state.settings.aiApiKey) { show('请先到「设置与数据 → AI 助手」配置多模态 AI 模型'); return; }
    enterAiChat();
    aiPendingImage = '';
    // 发送后立即移除预览 DOM（它在 aiView 的 chatHtml 里，renderAiMessages 不重渲染它）
    $$('.ai-image-preview').forEach(element => element.remove());
    pushHistory({ role: 'user', content: content || '帮我看看这张图', image });
    aiBusy = true;
    renderAiMessages();
    try {
      // R4-2：一次视觉调用完成「是否账单 + 结构化信息 / 普通描述」两件事（每张图只调一次 vision）
      const result = await aiReadImageWithLedger(state, image);
      if (result.isBill) {
        const bill = result.bill;
        pushHistory({ role: 'assistant', id: uid(), content: '', imageBill: { ...bill, description: result.description, status: 'pending', editing: false } });
        persistAiHistory();
      } else {
        // 非账单：行为与原来完全一致（描述文本入聊天）
        aiHistory[aiHistory.length - 1].imageDesc = result.description;
        const reply = await aiChat(state, aiMessagesForModel(aiHistory.slice(-12)));
        pushHistory({ role: 'assistant', content: reply });
        persistAiHistory();
        updateAiMemory().catch(() => {});
      }
    } catch (error) {
      pushHistory({ role: 'assistant', id: uid(), content: error.message || '处理失败，请稍后重试。', failed: true });
      persistAiHistory();
    } finally {
      aiBusy = false;
      renderAiMessages();
    }
    return;
  }

  if (!state.settings.aiApiKey) { show('请先到「设置与数据 → AI 助手」配置 API Key'); return; }
  enterAiChat();
  pushHistory({ role: 'user', content });
  aiBusy = true;
  renderAiMessages();

  // R4：对话记账——规则预检命中才触发 AI 解析；非记账意图/解析失败回退普通聊天
  if (detectLedgerIntent(content)) {
    try {
      const parsed = await aiParseLedger(state, content);
      if (parsed.isLedger) {
        pushHistory({ role: 'assistant', id: uid(), content: '', ledger: { type: parsed.type, category: parsed.category, amount: parsed.amount, note: parsed.note, date: parsed.date, status: 'pending' } });
        persistAiHistory();
      } else {
        await replyAsAssistant();
      }
    } catch {
      await replyAsAssistant();
    } finally {
      aiBusy = false;
      renderAiMessages();
    }
    return;
  }

  try {
    await replyAsAssistant();
  } finally {
    aiBusy = false;
    renderAiMessages();
  }
}

// 普通文字聊天走真实流；图片描述等兼容路径显式传 stream:false，继续完整响应。
async function replyAsAssistant({ stream = true } = {}) {
  const messages = aiMessagesForModel(aiHistory.slice(-12));
  if (!stream) {
    try {
      const reply = await aiChat(state, messages);
      pushHistory({ role: 'assistant', content: reply });
      persistAiHistory();
      updateAiMemory().catch(() => {});
    } catch (error) {
      pushHistory({ role: 'assistant', id: uid(), content: error.message || '请求失败，请稍后重试。', failed: true });
      persistAiHistory();
    }
    return;
  }
  if (aiStreamController) return;
  const controller = new AbortController();
  aiStreamController = controller;
  syncStreamActionButton();
  try {
    const result = await runAiStreamLifecycle(aiHistory, aiChatStream(state, messages, { signal: controller.signal }), {
      signal: controller.signal,
      onUpdate: phase => phase === 'chunk' ? scheduleStreamMessageRender() : flushStreamMessageRender(),
      persist: () => persistAiHistory()
    });
    if (result.status === 'complete') updateAiMemory().catch(() => {});
  } finally {
    if (aiStreamController === controller) aiStreamController = null;
    syncStreamActionButton();
    flushStreamMessageRender();
  }
}

async function retryImageMessage(user) {
  const result = await aiReadImageWithLedger(state, user.image);
  if (result.isBill) pushHistory({ role: 'assistant', id: uid(), content: '', imageBill: { ...result.bill, description: result.description, status: 'pending', editing: false } });
  else {
    user.imageDesc = result.description;
    await replyAsAssistant({ stream: false });
    return;
  }
  persistAiHistory();
}

export function aiMessagesForModel(messages) {
  return messages.map(m => {
    const content = m.imageDesc ? `${m.content}\n（用户附了一张图片，图片内容：${m.imageDesc}）` : m.content;
    return { role: m.role, content, at: m.at || 0 };
  });
}

// 持久化完整消息字段（含 id/image/imageDesc/ledger/imageBill），重启后可继续交互（确认卡片/图片消息）
export function persistAiHistory() {
  state.aiHistory = aiHistory.slice(-40).map(m => ({
    role: m.role,
    content: m.content,
    at: m.at || 0,
    ...(m.id ? { id: m.id } : {}),
    ...(m.image ? { image: m.image } : {}),
    ...(m.imageDesc ? { imageDesc: m.imageDesc } : {}),
    ...(m.ledger ? { ledger: { ...m.ledger } } : {}),
    ...(m.imageBill ? { imageBill: { ...m.imageBill } } : {})
    , ...(m.failed ? { failed: true } : {})
    , ...(m.cancelled ? { cancelled: true } : {})
    , ...(m.interrupted ? { interrupted: true, errorMessage: m.errorMessage || '' } : {})
  }));
  save().catch(() => {});
}

function pickAiImage() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.onchange = async () => {
    try {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过 20MB');
      if (!isSupportedJournalPhoto(file)) throw new Error('仅支持 JPG、PNG 或 WebP 图片');
      aiPendingImage = await compressPhoto(file);
      render();
    } catch (error) {
      show(error.message);
    }
  };
  input.click();
}

let memoryUpdateInFlight = false;
export async function updateAiMemory({ manual = false } = {}, { extract = aiExtractMemories, persist = save } = {}) {
  if (!manual && state.settings.aiConversationMemoryEnabled !== true) return { status: 'disabled' };
  if (!state.settings.aiApiKey) return { status: 'no-key' };
  if (aiHistory.length < 2) return { status: 'no-history' };
  if (memoryUpdateInFlight) return { status: 'busy' };
  const sourceState = state;
  memoryUpdateInFlight = true;
  try {
    const conversation = aiHistory.filter(message => !message.failed && !message.interrupted && !message.cancelled && !message.streaming).slice(-6).map(m => {
      const text = String(m.content || '').slice(0, 1000);
      const c = m.imageDesc ? `${text}\n（图片：${String(m.imageDesc).slice(0, 200)}）` : text;
      return `${m.role === 'user' ? '用户' : 'AI'}：${c}`;
    }).join('\n');
    if (!conversation.trim()) return { status: 'no-history' };
    const { add, remove } = await extract({ settings: { ...sourceState.settings }, aiMemory: sourceState.aiMemory.slice(-24).map(item => ({ text: item.text.slice(0, 80) })) }, conversation);
    // 请求期间关闭开关或恢复了其他状态时，不能再把结果写进当前档案。
    if (state !== sourceState || (!manual && state.settings.aiConversationMemoryEnabled !== true)) return { status: 'discarded' };
    const previous = structuredClone(state.aiMemory);
    let changed = false;
    // 先删被纠正的旧记忆，再写入新认知（避免新记忆被误删）
    for (const text of remove) {
      const idx = state.aiMemory.findIndex(item => isDuplicate(item.text, text));
      if (idx >= 0) {
        state.aiMemory.splice(idx, 1);
        changed = true;
      }
    }
    if (add.length && addMemories(state, add, 'conversation')) changed = true;
    if (changed) {
      try { await persist(); }
      catch (error) { state.aiMemory = previous; throw error; }
    }
    return { status: changed ? 'updated' : 'unchanged' };
  } finally { memoryUpdateInFlight = false; }
}

async function updateAiMemoryFromData() {
  const photoDescriptions = await describeRecentPhotos();
  const facts = await aiExtractFromData(state, photoDescriptions);
  if (!facts.length) return;
  if (addMemories(state, facts, 'data')) await save();
}

async function describeRecentPhotos() {
  if (!state.settings.aiApiKey) return [];
  const photos = collectRecentPhotos();
  if (!photos.length) return [];
  const descriptions = [];
  for (const photo of photos.slice(0, 3)) {
    try {
      const dataUrl = await photoToDataUrl(photo);
      if (!dataUrl) continue;
      const desc = await aiDescribeImage(state, dataUrl, '简要描述这张照片的内容，一两句话即可。');
      if (desc) descriptions.push(desc);
    } catch (error) { /* 忽略单张失败 */ }
  }
  return descriptions;
}

function collectRecentPhotos() {
  const photos = [];
  const journalDays = Object.keys(state.journals || {}).sort().slice(-10);
  for (const day of journalDays) {
    for (const photo of (state.journals[day].photos || [])) photos.push(photo);
  }
  const snippetPhotos = (state.snippets || []).filter(s => s.type === 'photo' && s.photo).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  for (const s of snippetPhotos.slice(0, 10)) photos.push(s.photo);
  return photos;
}

async function photoToDataUrl(value) {
  const src = mediaSource(value);
  if (!src) return '';
  if (src.startsWith('data:')) return src;
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch { return ''; }
}

async function rememberPhoto(photoValue) {
  if (!state.settings.aiApiKey) return;
  try {
    const dataUrl = await photoToDataUrl(photoValue);
    if (!dataUrl) return;
    const desc = await aiDescribeImage(state, dataUrl, '简要描述这张照片的内容，一两句话即可。');
    if (!desc) return;
    const facts = await aiRememberPhoto(state, desc);
    if (!facts.length) return;
    if (addMemories(state, facts, 'photo')) await save();
  } catch (error) { /* 静默失败，不打扰用户 */ }
}

export function scheduleAiRefresh() {
  // 兼容其他页面现有调用；保存普通记录后不自动提炼或联网。
  return null;
}

const MEMORY_SOURCE_LABELS = { conversation: '来自对话', data: '来自数据', photo: '来自照片', sync: '同步提炼', manual: '手动添加', suggestion: '来自建议采纳' };

// ---- R1：倒数日节点（30/7/1 天及当天）提醒 ----
// 节点日算出后由本地闹钟在当天 9 点响。同一次前台会话只检查一次。
let countdownCheckRun = false;

// force=true 时忽略「本次会话已检查」标记，供设置页「立即检查」按钮验证链路是否通。
async function checkCountdownNodes(force = false) {
  const settings = state?.settings || {};
  const cfg = settings.countdownAiReminders || {};
  if (!cfg.nodeReminder || (countdownCheckRun && !force)) return { checked: false, notified: 0, reason: cfg.nodeReminder ? 'already-checked' : 'disabled' };
  countdownCheckRun = true;
  const due = (state.countdowns || [])
    .map(c => ({ c, d: daysUntil(c.date) }))
    .filter(x => x.c.date && [0, 1, 7, 30].includes(x.d));
  // 节点日算出后交给本地闹钟。调度失败不在这里写已提醒标记。
  const result = await callHelper('syncCountdownNodeAlarms', force
    ? { requestPermission: true, userInitiated: true }
    : { requestPermission: false });
  const scheduled = result?.ok !== false && cfg.nodeNotify !== false && due.length > 0 && (result?.scheduledCount || 0) > 0;
  return {
    checked: true,
    notified: scheduled ? due.length : 0,
    candidates: due.length,
    scheduledCount: result?.scheduledCount || 0,
    reason: result?.ok === false ? (result.lastError || 'schedule-failed') : ''
  };
}

// R7：当天随机提醒计划——生成 2-4 条不同文案 + 8:00-22:00 随机不重叠时段，交给岗位②调度。
// 幂等：当天已计划则跳过；无 key 降级通用文案；scheduleRandomReminders helper 未交付时安全跳过。
// 数据结构契约（与 notifications.js 的 scheduleRandomReminders 严格一致）：
//   { time: 'HH:MM', title: string, body: string }
// 旧实现产出的是 { text, hour, minute }，与调度器期待的 { time, title, body } 不匹配，
// 导致生成出的文案一条都排不出去。这里统一为调度器的形状。
// 单一数据源：启用开关只存在 aiRandomRemindersEnabled，计划只存在 aiRandomReminders。
// 旧版本把同一个字段 aiRandomReminders 同时当布尔开关和计划对象用，保存开关会把计划清空。
async function scheduleTodayRandomReminders(options = {}) {
  const settings = state?.settings || {};
  if (settings.aiRandomRemindersEnabled !== true) return { ok: true, scheduledCount: 0, lastError: null };
  const today = dateKey();
  const planned = settings.aiRandomReminders;
  if (planned?.date === today && !options.force) return restoreRandomReminders(options);
  const count = 2 + Math.floor(Math.random() * 3); // 2-4 条
  let copies = [];
  try {
    copies = await Promise.race([
      aiRandomReminderCopies(state, count),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), 12000))
    ]);
  } catch (error) {
    if (error?.code !== 'timeout') {
      return { ok: false, scheduledCount: 0, lastError: error?.message || '随机提醒文案没有生成' };
    }
    copies = genericRandomReminderCopies(count, new Date());
  }
  const now = new Date();
  const minutes = futureRandomMinutes(copies.length || count, now);
  const pool = copies.length ? copies : genericRandomReminderCopies(count, now);
  const items = minutes.map((minute, i) => {
    const hour = Math.floor(minute / 60);
    const minuteOfHour = minute % 60;
    return {
      time: `${String(hour).padStart(2, '0')}:${String(minuteOfHour).padStart(2, '0')}`,
      title: '随手记一下',
      body: pickCopy(pool, i, now)
    };
  });
  // 权限失败时 scheduleRandomReminders 不会把计划写成「已排」。
  return scheduleRandomReminders(items, options);
}

async function ensureTodayRandomReminders(options = {}) {
  const settings = state?.settings || {};
  if (settings.aiRandomRemindersEnabled !== true) return cancelRandomReminders();
  return scheduleTodayRandomReminders(options);
}

// 仅维护 AI 页面层级。render 和进入页面不生成提醒、不联网。
registerOnRender(() => {
  const routeActive = state.route === 'ai';
  if (!routeActive && aiRouteWasActive) {
    stopAiStream();
    aiChatExpanded = false;
    aiTab = 'chat';
  }
  aiRouteWasActive = routeActive;
});
// 切回前台时再对一次倒数日闹钟。文案用本地句子，不在这里请求模型。
// 这一步只排本地闹钟，和上面的页面层级回调无关。
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  countdownCheckRun = false;
  callHelper('checkAiCountdowns');
});

function memorySourceLabel(source) {
  return MEMORY_SOURCE_LABELS[source] || '早期记忆';
}

function memoryTimeStr(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日${sameYear ? '' : ` ${date.getFullYear()}`}`;
}

function memoryItemHtml(item) {
  const meta = item.createdAt ? `<span class="ai-memory-time">${memoryTimeStr(item.createdAt)}</span>` : '';
  return `<div class="ai-memory-item" data-memory-id="${esc(item.id)}"><div class="ai-memory-item-main"><p>${esc(item.text)}</p><div class="ai-memory-meta"><span class="ai-memory-source">${memorySourceLabel(item.source)}</span>${meta}</div></div><div class="ai-memory-actions"><button type="button" data-edit-memory="${esc(item.id)}" aria-label="编辑"><span class="material-symbols-outlined">edit</span></button><button type="button" data-delete-memory="${esc(item.id)}" aria-label="删除"><span class="material-symbols-outlined">close</span></button></div></div>`;
}

function aiMemoryModal() {
  const memories = [...state.aiMemory].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const list = memories.length
    ? `<div class="ai-memory-list">${memories.map(memoryItemHtml).join('')}</div>`
    : '<div class="ai-memory-empty">还没有记忆，可以手动添加或主动提炼。</div>';
  modal(`<div class="modal-head ai-memory-head"><span class="material-symbols-outlined">psychology</span><div><span class="eyebrow">WHAT I KNOW ABOUT YOU</span><h2>AI 眼中的我</h2><p>记忆保存在本机；聊天时会发送相关记忆给模型。自动提炼默认关闭，可在 AI 设置中开启。</p></div></div><div class="ai-memory-add-row"><input id="ai-memory-new" type="text" placeholder="手动告诉它一件关于你的事…" autocomplete="off"><button type="button" id="ai-memory-add-btn" class="save">添加</button></div>${list}<p class="field-help">提炼最近对话会发送最近最多 6 条成功消息与最多 24 条已有记忆；从数据刷新会发送文字记录及最近最多 3 张照片。</p><div class="modal-actions ai-memory-modal-actions"><button type="button" id="remember-recent-chat" ${state.settings.aiApiKey ? '' : 'disabled'}>提炼最近对话</button><button type="button" id="export-memories">导出记忆</button><button type="button" id="import-memories">导入记忆</button><button type="button" id="refresh-from-data" ${state.settings.aiApiKey ? '' : 'disabled'}>从我的数据刷新了解</button><button type="button" data-close>关闭</button></div>`, 'large-modal ai-memory-modal');
  bindAiMemoryModal();
}

function bindAiMemoryModal() {
  $('#remember-recent-chat')?.addEventListener('click', async () => {
    const button = $('#remember-recent-chat');
    button.disabled = true;
    button.textContent = '正在提炼…';
    try {
      const result = await updateAiMemory({ manual: true });
      const message = { updated: '已更新对你的了解', unchanged: '没有需要新增或修正的记忆', 'no-key': '请先配置 AI Key', 'no-history': '还没有可提炼的成功对话', busy: '已有记忆提炼正在进行', discarded: '当前档案已变化，这次结果未保存' }[result.status];
      aiMemoryModal();
      show(message || '这次没有更新记忆');
    } catch (error) {
      button.disabled = false;
      button.textContent = '提炼最近对话';
      show(error.message || '提炼失败，请稍后手动重试');
    }
  });
  $('#ai-memory-add-btn')?.addEventListener('click', async () => {
    const input = $('#ai-memory-new');
    const value = (input?.value || '').trim();
    if (!value) { show('先写点什么再添加'); return; }
    if (!addMemories(state, [value], 'manual')) show('这条已经记住了');
    else show('已记住');
    await save();
    aiMemoryModal();
  });
  $('#ai-memory-new')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); $('#ai-memory-add-btn')?.click(); }
  });
  $$('[data-edit-memory]').forEach(button => button.onclick = () => {
    const item = state.aiMemory.find(memory => memory.id === button.dataset.editMemory);
    const wrapper = button.closest('.ai-memory-item');
    if (!item || !wrapper) return;
    wrapper.innerHTML = `<input type="text" value="${esc(item.text)}" autocomplete="off" style="flex:1;min-width:0;font-size:13px;padding:8px 10px;border:1px solid var(--border-cool);border-radius:8px;background:var(--surface-cool);color:var(--text-primary)"><div style="display:flex;gap:6px;flex:none;align-items:center"><button type="button" data-save-edit="${esc(item.id)}" style="width:auto;height:auto;border-radius:8px;padding:7px 12px;font-size:12px;background:var(--primary);color:#fff">保存</button><button type="button" data-cancel-edit style="width:auto;height:auto;border-radius:8px;padding:7px 12px">取消</button></div>`;
    const input = wrapper.querySelector('input');
    input.focus();
    input.onkeydown = event => { if (event.key === 'Enter') wrapper.querySelector('[data-save-edit]')?.click(); };
    wrapper.querySelector('[data-save-edit]').onclick = async () => {
      const value = input.value.trim();
      if (!value) { show('内容不能为空'); return; }
      item.text = value;
      item.updatedAt = Date.now();
      await save();
      aiMemoryModal();
    };
    wrapper.querySelector('[data-cancel-edit]').onclick = () => aiMemoryModal();
  });
  $$('[data-delete-memory]').forEach(button => button.onclick = () => {
    confirmDelete('删除这条记忆？它对你会少一点了解。', async () => {
      state.aiMemory = state.aiMemory.filter(item => item.id !== button.dataset.deleteMemory);
      await save();
      aiMemoryModal();
    });
  });
  $('#export-memories')?.addEventListener('click', async () => {
    if (!state.aiMemory.length) { show('还没有记忆可导出'); return; }
    try {
      await downloadMemoryFile(exportMemories(state));
    } catch (error) {
      show(error.message || '导出失败');
    }
  });
  $('#import-memories')?.addEventListener('click', showImportMemoryModal);
  $('#refresh-from-data')?.addEventListener('click', async () => {
    const btn = $('#refresh-from-data');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '正在读取你的记录…';
    try {
      await updateAiMemoryFromData();
      state.settings.aiLastDataScanAt = Date.now();
      await save();
      show('已更新对你的了解');
      aiMemoryModal();
    } catch (error) {
      btn.disabled = false;
      btn.textContent = '从我的数据刷新了解';
      show(error.message || '更新失败');
    }
  });
}

function showImportMemoryModal() {
  modal(`<div class="modal-head"><div><span class="eyebrow">IMPORT MEMORIES</span><h2>导入记忆</h2><p>从之前导出的记忆文件恢复 AI 对你的了解，重复的记忆会自动合并。</p></div></div><textarea id="import-memory-json" rows="6" placeholder="把 JSON 粘贴到这里，或点下面按钮从文件读取…" style="width:100%;box-sizing:border-box;margin-bottom:12px"></textarea><div class="modal-actions"><button type="button" id="import-memory-file">从文件读取</button><button type="button" id="import-memory-confirm" class="save">确认导入</button><button type="button" data-close>取消</button></div>`, 'ai-memory-import-modal');
  $('#import-memory-file')?.addEventListener('click', async () => {
    try {
      const text = await pickMemoryFile();
      if (!text) return;
      const box = $('#import-memory-json');
      if (box) box.value = text;
    } catch (error) {
      show(error.message || '读取文件失败');
    }
  });
  $('#import-memory-confirm')?.addEventListener('click', async () => {
    const json = $('#import-memory-json')?.value.trim();
    if (!json) { show('先粘贴 JSON 或从文件读取'); return; }
    try {
      const imported = importMemories(state, json);
      await save();
      show(imported ? `成功导入 ${imported} 条记忆` : '没有新记忆（可能都与现有记忆重复）');
      aiMemoryModal();
    } catch (error) {
      show(error.message || '导入失败');
    }
  });
}

async function downloadMemoryFile(json) {
  const filename = `mine-memories-${new Date().toISOString().slice(0, 10)}.json`;
  if (!isNativeAndroid()) {
    const blob = new Blob([json], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
    show('记忆已导出为 JSON 文件');
    return;
  }
  const result = await Filesystem.writeFile({
    path: `Mine/${filename}`,
    data: json,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true
  });
  await Share.share({ title: 'Mine AI 记忆', text: '这是 AI 对你的记忆，可保存或发送到其他设备导入。', url: result.uri, dialogTitle: '保存或发送记忆' });
}

async function pickMemoryFile() {
  if (isNativeAndroid()) {
    const picked = await FilePicker.pickFiles({ types: ['application/json'], limit: 1, readData: true });
    const file = picked.files[0];
    if (!file?.data) throw new Error('未能读取所选文件');
    return new TextDecoder().decode(base64ToBytes(file.data));
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        resolve(file ? await file.text() : '');
      } catch (error) { reject(error); }
    };
    input.click();
  });
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

// 密钥存储说明必须如实告知用户当前保护级别，不能只说「保存在本机」。
function keyStorageHint(s) {
  if (s.aiApiKeyInvalid) return '上次保存的密钥已无法解密（换机或系统安全更新会导致），请重新填写一次。';
  const mode = aiKeyStorageMode();
  const base = mode === 'keystore'
    ? '密钥经手机系统密钥库加密后保存，数据库文件被拷走也无法直接读出。'
    : mode === 'browser-derived'
      ? '浏览器预览会用本机派生密钥加密；正式 App 内由系统密钥库保护。'
      : '当前环境不支持加密保存，密钥不会写入数据库。';
  return `${base}同一模型用于文字、图片、周报和记忆；切换模型不会删除本机已有记忆或聊天记录。`;
}

function encouragementHint(s) {
  const cache = s.aiDailyEncouragement;
  if (cache?.date === dateKey() && cache.text) return `今天已生成：${cache.text}`;
  if (!s.aiApiKey) return '需要先配置 AI Key。';
  return '每天可以生成一句给你的鼓励，会显示在首页照片下方。App 不会自己联网去生成。';
}

function aiSettingsForm() {
  const s = state.settings;
  const key = s.aiApiKey;
  const providerOptions = Object.entries(PROVIDERS).map(([id, p]) => `<option value="${id}" ${s.aiProvider === id ? 'selected' : ''}>${p.label}</option>`).join('');
  modal(`<form id="ai-settings-form"><span class="eyebrow">MULTIMODAL AI</span><h2>AI 助手</h2><p class="subtle">只需配置一套多模态模型：同一模型负责文字对话、图片理解、周报、每日小结与记忆提炼。所选模型必须支持 OpenAI 兼容的图片输入格式。</p><label class="confirm-line"><input name="aiEnabled" type="checkbox" ${s.aiEnabled ? 'checked' : ''}> 启用 AI 助手</label><label>多模态模型</label><div class="ai-model-row"><select name="aiProvider" aria-label="AI 模型提供商">${providerOptions}</select><input name="aiModel" type="text" autocomplete="off" value="${esc(s.aiModel)}" placeholder="模型名，如 ${esc(PROVIDERS[s.aiProvider]?.defaultModel || 'deepseek-chat')}"></div><div id="ai-base-url-wrap" ${s.aiProvider === 'custom' ? '' : 'hidden'}><label>AI 模型接口地址（Base URL）</label><input name="aiBaseUrl" type="text" autocomplete="off" value="${esc(s.aiBaseUrl)}" placeholder="https://…/v1/chat/completions"><small class="field-help">自定义提供商时必填，需为支持图片输入的 OpenAI 兼容 /chat/completions 端点。</small></div><label>AI 模型 API Key</label><input name="aiApiKey" type="password" autocomplete="off" value="${esc(key)}" placeholder="sk-…"><small class="field-help">${keyStorageHint(s)}</small><div class="ai-care-block"><div class="ai-care-title"><strong>AI 陪伴</strong><small>让它更懂你的状态</small></div><label class="confirm-line"><input name="aiEmotionCare" type="checkbox" ${s.aiEmotionCare !== false ? 'checked' : ''}> 情绪陪伴</label><small class="field-help">AI 会感知日记中的心情，在聊天和问候时温柔关心你。心情数据只用于陪伴，不参与打卡或统计。</small><label class="confirm-line"><input name="aiConversationMemoryEnabled" type="checkbox" ${s.aiConversationMemoryEnabled === true ? 'checked' : ''}> 聊天后自动提炼记忆</label><small class="field-help">默认关闭。开启后，每次成功回复会额外发送最近最多 6 条消息与最多 24 条已有记忆给模型；关闭后仍可在记忆页手动提炼。</small><div class="ai-care-title"><strong>倒数日 AI 联动</strong><small>关键节点主动陪着你</small></div><label class="confirm-line"><input name="cdNodeReminder" type="checkbox" ${s.countdownAiReminders?.nodeReminder ? 'checked' : ''}> 节点提醒（倒计时 30/7/1 天及当天）</label><small class="field-help">在倒计时到 30 / 7 / 1 天以及当天早上 9 点，手机会自己响一声。</small><label class="confirm-line"><input name="cdNodeNotify" type="checkbox" ${s.countdownAiReminders?.nodeNotify ? 'checked' : ''}> 节点提醒发系统通知</label><button type="button" id="cd-node-check-now" class="reminder-add">立即检查是否有节点</button><label class="confirm-line"><input name="cdDailyMention" type="checkbox" ${s.countdownAiReminders?.dailyMention ? 'checked' : ''}> 每日问候顺带提最近倒计时</label><label class="confirm-line"><input name="cdAnniversaryBlessing" type="checkbox" ${s.countdownAiReminders?.anniversaryBlessing ? 'checked' : ''}> 纪念日「写给今天」祝福</label><div><button type="button" id="gen-daily-encouragement" class="reminder-add" ${s.aiApiKey ? '' : 'disabled'}>${s.aiApiKey ? '生成今日鼓励' : '配置 Key 后可生成'}</button><small class="field-help">${encouragementHint(s)}</small></div></div><div class="modal-actions"><button type="button" data-close>取消</button><button class="save">保存</button></div></form>`, 'ai-settings-modal');
  bindAiSettingsForm();
}

function bindAiSettingsForm() {
  const form = $('#ai-settings-form');
  if (!form) return;
  const providerSelect = form.querySelector('[name="aiProvider"]');
  const modelInput = form.querySelector('[name="aiModel"]');
  const baseWrap = form.querySelector('#ai-base-url-wrap');
  providerSelect?.addEventListener('change', () => {
    const provider = PROVIDERS[providerSelect.value];
    if (provider && modelInput) modelInput.value = provider.defaultModel;
    if (baseWrap) baseWrap.hidden = providerSelect.value !== 'custom';
  });
  // 「立即检查」让用户当场验证节点提醒链路是否真的通，而不是等 30 天。
  // 只读取当前表单上的开关值，不提前保存 —— 用户取消时设置不会被改。
  $('#cd-node-check-now')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = '检查中…';
    try {
      const cfg = state.settings.countdownAiReminders || {};
      const preview = { ...cfg, nodeReminder: form.querySelector('[name="cdNodeReminder"]')?.checked === true, nodeNotify: form.querySelector('[name="cdNodeNotify"]')?.checked === true };
      if (!preview.nodeReminder) { show('请先勾选「节点提醒」'); return; }
      if (!preview.nodeNotify) { show('勾选「节点提醒发系统通知」后，才会排进手机闹钟'); return; }
      const previous = state.settings.countdownAiReminders;
      state.settings.countdownAiReminders = preview;
      let result;
      try {
        result = await callHelper('checkAiCountdowns', true);
      } finally {
        state.settings.countdownAiReminders = previous;
      }
      if (!result?.candidates) show(result?.scheduledCount ? `今天没有正好到期的节点，之后的 ${result.scheduledCount} 个节点已排进闹钟` : '目前没有倒数日正好在 30 / 7 / 1 天或当天，稍后再来看');
      else if (!preview.nodeNotify) show(`找到 ${result.candidates} 个节点，点上面的「节点提醒发系统通知」可让它发到手机通知栏`);
      else if (result.notified) show(`已排上 ${result.notified} 条节点提醒`);
      else show(result.reason || '节点提醒没有排上，请检查通知权限');
    } finally {
      button.disabled = false;
      button.textContent = '立即检查是否有节点';
    }
  });
  // 「生成今日鼓励」：这是 AI 每日鼓励唯一的联网入口 —— 用户点了才会外发请求。
  $('#gen-daily-encouragement')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = '生成中…';
    try {
      const result = await callHelper('generateAiDailyEncouragement');
      if (result?.ok) show(result.cached ? '今天已经生成过了' : '已生成，去首页看看');
      else if (result?.reason === 'no-key') show('请先配置 AI Key');
      else show('这次没生成出来，可以稍后再试');
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });
}

function timeStr(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// 让用户看到随机提醒「今天真的排上了几条、几点」，否则这个开关等于黑盒。
function randomReminderPlanHint() {
  const plan = state.settings?.aiRandomReminders;
  if (plan?.date === dateKey() && plan.armed === true && Array.isArray(plan.items) && !plan.items.length) return '今天没有可排的时段';
  if (!plan || plan.date !== dateKey() || !Array.isArray(plan.items) || !plan.items.length) return '尚未生成';
  if (plan.armed !== true) return '还没排进系统闹钟';
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const pending = plan.items.filter(item => {
    if (item.pushed) return false;
    const [hour, minute] = String(item.time || '').split(':').map(Number);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false;
    return hour * 60 + minute > nowMinutes;
  });
  if (!pending.length) return `${plan.items.length} 条已全部提醒`;
  return `今天已排 ${plan.items.length} 条（${pending.map(item => item.time).join('、')}）`;
}

function dailyReminderSettingsForm() {
  // 从未保存过就是空列表。不要预填三条，否则用户一点保存就会把一整天排满。
  reminderDraft = (Array.isArray(state.settings.dailyReminders) ? state.settings.dailyReminders : []).map(reminder => ({ ...reminder }));
  modal(`<div class="modal-head"><div><h2>日常记录提醒</h2><p>一天多次，随手拍和记录日常交替提醒。</p></div></div><div class="reminder-list" id="reminder-list">${reminderRowsHtml()}</div><button type="button" class="reminder-add" id="add-reminder"><span class="material-symbols-outlined">add</span>添加提醒</button><div class="reminder-ai-box"><button type="button" id="gen-ai-copy" ${state.settings.aiApiKey ? '' : 'disabled'}><span class="material-symbols-outlined">auto_awesome</span>AI 生成提醒文案</button><small id="ai-copy-status">${aiCopyStatus()}</small></div><div class="reminder-random-box"><label class="confirm-line"><input id="random-reminders-toggle" type="checkbox" ${state.settings.aiRandomRemindersEnabled === true ? 'checked' : ''}> AI 随机提醒</label><small class="field-help">每天生成 2-4 条不同的记录邀请，在 8:00-22:00 随机时段提醒（配 AI Key 时结合你的近况生成，未配置时用通用文案）。今天已安排：${randomReminderPlanHint()}</small></div><div class="reminder-test-box"><button type="button" id="send-test-notification" class="reminder-add"><span class="material-symbols-outlined">notifications</span>发送测试通知</button><small class="field-help">立即发一条测试通知，用于排查真机通知链路。</small></div><p class="reminder-hint">「随机」类型会在随手拍和记录日常之间切换，文案每次也不同。点通知会直接跳到对应的拍照或写日记页面。</p><div class="modal-actions"><button type="button" data-close>取消</button><button class="save" id="save-reminders">保存</button></div>`, 'large-modal reminder-modal');
  bindReminderList();
}

function aiCopyStatus() {
  const copy = state.settings.reminderAiCopy;
  const n = (copy?.photo?.length || 0) + (copy?.journal?.length || 0);
  if (n) return `已生成 ${n} 条个性化文案`;
  return state.settings.aiApiKey ? '未生成，将用默认文案' : '配置 AI Key 后可生成个性化文案';
}

function reminderRowsHtml() {
  if (!reminderDraft.length) return '<div class="reminder-empty">还没有提醒，点下方「添加提醒」。</div>';
  return reminderDraft.map(reminder => `
    <div class="reminder-row" data-reminder-id="${reminder.id}">
      <input type="time" value="${timeStr(reminder.hour, reminder.minute)}" data-reminder-time aria-label="提醒时间">
      <select data-reminder-type aria-label="提醒类型">
        <option value="photo" ${reminder.type === 'photo' ? 'selected' : ''}>随手拍</option>
        <option value="journal" ${reminder.type === 'journal' ? 'selected' : ''}>记录日常</option>
        <option value="random" ${reminder.type === 'random' ? 'selected' : ''}>随机</option>
      </select>
      <button type="button" class="reminder-remove" data-remove-reminder="${reminder.id}" aria-label="删除这条提醒"><span class="material-symbols-outlined">close</span></button>
    </div>`).join('');
}

function collectReminderDraft() {
  const rows = $$('#reminder-list .reminder-row');
  reminderDraft = rows.map(row => {
    const id = row.dataset.reminderId;
    const time = row.querySelector('[data-reminder-time]').value || '12:00';
    const [hour, minute] = time.split(':').map(Number);
    const type = row.querySelector('[data-reminder-type]').value;
    return { id, hour: Number.isInteger(hour) ? hour : 12, minute: Number.isInteger(minute) ? minute : 0, type };
  });
}

function bindReminderList() {
  $('#add-reminder')?.addEventListener('click', () => {
    reminderDraft.push({ id: uid(), hour: 12, minute: 0, type: 'random' });
    $('#reminder-list').innerHTML = reminderRowsHtml();
    bindReminderList();
  });
  $$('[data-remove-reminder]').forEach(button => button.onclick = () => {
    collectReminderDraft();
    reminderDraft = reminderDraft.filter(reminder => reminder.id !== button.dataset.removeReminder);
    $('#reminder-list').innerHTML = reminderRowsHtml();
    bindReminderList();
  });
  $('#save-reminders')?.addEventListener('click', async () => {
    collectReminderDraft();
    state.settings.dailyReminders = reminderDraft;
    // 开关只写 aiRandomRemindersEnabled；计划对象 aiRandomReminders 由调度器独占维护。
    // 未勾选、或开关不在页面上，都写成 false，避免缺省被当成开启。
    state.settings.aiRandomRemindersEnabled = $('#random-reminders-toggle')?.checked === true;
    try { await save(); }
    catch (error) { show(error.message || '提醒设置没有保存'); return; }
    const ask = { requestPermission: true, userInitiated: true };
    const follow = { requestPermission: true, userInitiated: false };
    const daily = reminderDraft.length
      ? await scheduleDailyReminders(reminderDraft, state.settings.reminderAiCopy, ask)
      : await cancelDailyReminders();
    const random = state.settings.aiRandomRemindersEnabled === true
      ? await scheduleTodayRandomReminders(reminderDraft.length ? follow : ask)
      : await cancelRandomReminders();
    closeModal(); render();
    const base = reminderDraft.length ? `已设置 ${reminderDraft.length} 个每日提醒` : '已关闭每日提醒';
    if (daily?.permission === 'unsupported') {
      show(`${base}。当前环境排不了系统闹钟，装到手机上才会响`);
      return;
    }
    if (daily?.ok === false || random?.ok === false) {
      const reason = daily?.lastError || random?.lastError || '系统没有收下这次提醒';
      show(reminderDraft.length ? `提醒已保存在设置里，但闹钟没排上：${reason}` : `每日提醒已关闭。${reason}`);
      return;
    }
    const warnings = [];
    if (daily?.exactAlarm === 'denied' || random?.exactAlarm === 'denied') warnings.push('系统还没允许精确闹钟，到点可能推迟');
    if (daily?.lastError) warnings.push(daily.lastError);
    if (random?.lastError) warnings.push(random.lastError);
    show(warnings.length ? `${base}。${warnings.join('；')}` : base);
  });
  $('#gen-ai-copy')?.addEventListener('click', async () => {
    const btn = $('#gen-ai-copy');
    const status = $('#ai-copy-status');
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined">auto_awesome</span>生成中…';
    try {
      const copy = await aiReminderCopy(state);
      state.settings.reminderAiCopy = copy;
      await save();
      const n = copy.photo.length + copy.journal.length;
      if (status) status.textContent = n ? `已生成 ${n} 条个性化文案` : '生成结果为空，将用默认文案';
      show(n ? '个性化文案已更新' : '生成结果为空，已回退默认文案');
    } catch (error) {
      show(error.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined">auto_awesome</span>AI 生成提醒文案';
    }
  });
  $('#send-test-notification')?.addEventListener('click', async () => {
    const btn = $('#send-test-notification');
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined">notifications</span>发送中…';
    try {
      const result = await sendTestNotification();
      if (result === 'scheduled') show('测试通知已发送，请查看通知栏');
      else if (result === 'browser') show('浏览器预览不支持通知，请在安装后的 App 内测试');
      else if (String(result).startsWith('权限未授予') || String(result).includes('denied')) show('通知权限未开启：请到系统设置 → 应用管理 → Mine → 通知 → 允许通知，再试');
      else show(String(result || '通知发送失败'));
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined">notifications</span>发送测试通知';
    }
  });
}

// R5：销毁语音绑定（render 重建前调用，避免监听重复叠加）
function destroyVoiceBinding() {
  if (voiceBinding) {
    voiceBinding.destroy();
    voiceBinding = null;
  }
}

// ---- 绑定 ----
function bindAi() {
  destroyVoiceBinding(); // 每次 render 先清理旧实例（含停止识别、移除事件监听）
  // R5：语音输入——识别文本由共享组件填入 #ai-input 并触发 input（textarea 自适应），不自动发送；无引擎/浏览器自动隐藏
  const voicePanel = $('.ai-chat-page');
  if (voicePanel) voiceBinding = bindVoiceInput(voicePanel, { input: () => $('#ai-input') });
  $('#ai-clear')?.addEventListener('click', () => { stopAiStream(); aiHistory = []; state.aiHistory = []; aiLastSemanticPreview = null; aiSemanticPreviewOpen = false; save().catch(() => {}); render(); });
  $$('[data-ai-tab]').forEach(button => button.onclick = () => switchAiTab(button.dataset.aiTab));
  $('#ai-back-overview')?.addEventListener('click', returnToAiOverview);
  $('#ai-report-chat')?.addEventListener('click', discussWeeklyReport);
  $('#ai-new-message')?.addEventListener('click', () => { aiStickToBottom = true; aiHasUnread = false; render(); });
  $('#ai-memory-entry')?.addEventListener('click', aiMemoryModal);
  bindAiWelcomeActions();
  $('#generate-weekly-report')?.addEventListener('click', () => generateWeeklyReport(false));
  $('#regenerate-weekly-report')?.addEventListener('click', () => generateWeeklyReport(true));
  bindStreamActionButton();
  $('#ai-add-image')?.addEventListener('click', pickAiImage);
  $('#ai-remove-image')?.addEventListener('click', () => { aiPendingImage = ''; render(); });
  bindSemanticScopePreview();
  // 多行输入：Enter（无 Shift）发送；Shift+Enter 换行；输入时自动增高
  $('#ai-input')?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); aiSend(); }
  });
  $('#ai-input')?.addEventListener('focus', enterAiChat);
  $('#ai-input')?.addEventListener('input', () => { aiDraft = $('#ai-input')?.value || ''; autosizeComposer(); updateSemanticScopePreview(aiDraft); });
  $$('[data-ai-prompt]').forEach(button => button.onclick = () => aiSend(button.dataset.aiPrompt));
  // R4：月度消费分析入口
  $('#gen-ledger-analysis')?.addEventListener('click', async () => {
    const btn = $('#gen-ledger-analysis');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '正在分析…';
    try {
      await runAiLedgerAnalysis(currentLedgerAnalysisPayload());
    } finally {
      btn.disabled = false;
      btn.textContent = 'AI 消费分析';
    }
  });
  // 全页 render() 后消息 DOM 是重建的：重新渲染消息区（内含卡片绑定 + 滚底），保证任何渲染路径后卡片按钮都可点、界面不滞留顶端
  renderAiMessages();
}

// ---- 表单提交 ----
registerSubmitHandler('ai-settings-form', async data => {
  const aiProvider = data.get('aiProvider').trim();
  state.settings.aiEnabled = data.get('aiEnabled') === 'on';
  state.settings.aiProvider = aiProvider;
  state.settings.aiBaseUrl = data.get('aiBaseUrl').trim();
  state.settings.aiModel = data.get('aiModel').trim() || PROVIDERS[aiProvider]?.defaultModel || 'deepseek-chat';
  state.settings.aiApiKey = data.get('aiApiKey').trim();
  // 重新填写即视为已修复，清掉「密钥失效」标记。
  if (state.settings.aiApiKey) state.settings.aiApiKeyInvalid = false;
  else await clearApiKey().catch(() => {});
  // R2/R1：AI 陪伴 + 倒数日联动开关
  state.settings.aiEmotionCare = data.get('aiEmotionCare') === 'on';
  state.settings.aiConversationMemoryEnabled = data.get('aiConversationMemoryEnabled') === 'on';
  const countdownCfg = state.settings.countdownAiReminders || {};
  countdownCfg.nodeReminder = data.get('cdNodeReminder') === 'on';
  countdownCfg.nodeNotify = data.get('cdNodeNotify') === 'on';
  countdownCfg.dailyMention = data.get('cdDailyMention') === 'on';
  countdownCfg.anniversaryBlessing = data.get('cdAnniversaryBlessing') === 'on';
  state.settings.countdownAiReminders = countdownCfg;
  const alarm = await callHelper('syncCountdownNodeAlarms', { requestPermission: true, userInitiated: true });
  if (alarm?.ok === false && alarm.lastError) return `设置已保存，倒数日提醒没排上：${alarm.lastError}`;
});

// ---- 注册 ----
registerView('ai', aiView);
registerBinder(bindAi);
registerHelper('aiMd', aiMd);
registerHelper('aiSettingsForm', aiSettingsForm);
registerHelper('dailyReminderSettingsForm', dailyReminderSettingsForm);
registerHelper('scheduleAiRefresh', scheduleAiRefresh);
registerHelper('rememberPhoto', rememberPhoto);
registerHelper('aiMemoryModal', aiMemoryModal);
registerHelper('ensureDailySummary', ensureDailySummary);
// 仅 app.js 已有 autoSummaryLaunch 分支调用；固定走 scheduled 边界，失败交给 app.js 收尾。
registerHelper('generateAutoSummary', runScheduledAutoSummary);
registerHelper('setAiHistory', history => { aiHistory = history; });
registerHelper('getAiHistory', () => aiHistory);
registerHelper('isAiChatActive', () => aiChatExpanded);
registerHelper('returnToAiOverview', returnToAiOverview);
registerHelper('checkAiCountdowns', (force = false) => checkCountdownNodes(force));
registerHelper('aiSuggestStructure', aiSuggestStructure);
registerHelper('applySuggestion', applySuggestion);
registerHelper('aiLedgerAnalysis', runAiLedgerAnalysis);
registerHelper('aiRecognizeLedgerImage', runAiRecognizeLedgerImage);
registerHelper('aiFocusCoach', runAiFocusCoach);
registerHelper('aiRandomReminderCopies', aiRandomReminderCopies);
registerHelper('scheduleTodayRandomReminders', scheduleTodayRandomReminders);
registerHelper('ensureTodayRandomReminders', ensureTodayRandomReminders);
// 每日鼓励语（供今日页读取）：只读当天已生成的缓存。
// 生成侧不自动触发 —— 打开 App / 进首页 / 切 tab 都不会联网。
// 想生成必须在 AI 设置里点「生成今日鼓励」，属用户显式操作。
registerHelper('aiDailyEncouragement', async () => {
  const cache = state.settings?.aiDailyEncouragement;
  return cache?.date === dateKey() ? cache.text || null : null;
});
// 显式生成入口：失败不写缓存、不写占位（保持「不伪造成功」）。
registerHelper('generateAiDailyEncouragement', async () => {
  const cache = state.settings?.aiDailyEncouragement;
  if (cache?.date === dateKey() && cache.text) return { ok: true, text: cache.text, cached: true };
  if (!state.settings?.aiApiKey) return { ok: false, text: '', reason: 'no-key' };
  const text = await aiDailyEncouragement(state).catch(() => '');
  if (!text) return { ok: false, text: '', reason: 'empty' };
  state.settings.aiDailyEncouragement = { date: dateKey(), text, generatedAt: Date.now() };
  await save();
  return { ok: true, text, cached: false };
});
