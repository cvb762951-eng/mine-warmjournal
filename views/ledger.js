// 账本页（views/ledger.js）——归岗位③·记录与成长。
// R4：账本记账（生活费管理）：月汇总/预算进度/按日分组列表/分类筛选/记账表单（含小票照片）/预算设置。
import { Capacitor } from '@capacitor/core';
import { Camera, CameraDirection, EncodingType } from '@capacitor/camera';
import { $, $$, esc, uid, state, save, render, modal, closeModal, show, confirmDelete, emptyState, imgSrc, registerView, registerBinder, registerSubmitHandler, callHelper, openSubpage, subpageHeader } from '../core.js';
import { makeTransaction, makeLedgerAccount, makeLedgerCategory, LEDGER_CATEGORIES, ledgerCategoryMap, ledgerSummary, archiveLedgerAccount, upsertMerchantCategoryRule, dateKey, WEEK_DAYS } from '../model.js';
import { photoViewer, micButtonHtml, bindVoiceInput } from './common.js';
import { compressJournalPhoto, isSupportedJournalPhoto } from '../photo-utils.js';
import { offerTasteArchive } from '../ledger-taste-bridge.js';

// ---- 本地状态 ----
let ledgerFilter = 'all';
let ledgerAccountsExpanded = true;
let ledgerQuickType = 'expense';
let ledgerQuickCategory = 'restaurant';
let pendingLedgerType = 'expense';
let pendingLedgerCategory = 'restaurant';
let pendingTransactionPhoto = '';
let ledgerVoice = null;

const money = value => Number(value || 0).toFixed(2);
const budgetTone = percent => percent >= 100 ? 'red' : percent >= 80 ? 'orange' : 'green';
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const addDays = (day, days) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + days); return dateKey(d); };
const accountIcon = type => ({ wallet: 'account_balance_wallet', bank: 'account_balance', cash: 'payments', receivable: 'handshake' }[type] || 'account_balance_wallet');
const accountTypeLabel = type => ({ wallet: '电子钱包', bank: '银行卡', cash: '现金', receivable: '外借应收款' }[type] || '账户');
const activeAccounts = ({ includeReceivable = true } = {}) => (state.ledgerAccounts || []).filter(account => !account.archived && (includeReceivable || account.type !== 'receivable')).sort((a, b) => a.sortOrder - b.sortOrder);
const accountOptions = (accounts, selected, placeholder) => `<option value="" ${selected ? '' : 'selected'} disabled>${placeholder}</option>${accounts.map(account => `<option value="${esc(account.id)}" ${account.id === selected ? 'selected' : ''}>${esc(account.name)}${account.type === 'receivable' ? '（应收）' : ''}</option>`).join('')}`;
const usableCategories = type => Object.entries(ledgerCategoryMap(state)).filter(([, category]) => !category.archived && (!category.scope || category.scope === 'both' || category.scope === type));

// 快捷记账条：金额 + 常用分类 + 记一笔（默认取上次使用的类型/分类/账户）
function ledgerQuickCard(accounts, lastAccountId) {
  const accountId = accounts.some(account => account.id === lastAccountId) ? lastAccountId : (accounts[0]?.id || '');
  const cats = usableCategories(ledgerQuickType).slice(0, 6);
  return `<section class="ledger-quick-card" aria-labelledby="ledger-quick-title">
    <header class="ledger-quick-head">
      <span id="ledger-quick-title">QUICK ENTRY</span>
      <small>快速记账，不打断生活</small>
    </header>
    <div class="ledger-quick-strip">
      <label class="ledger-quick-amount-main" for="quick-strip-amount">
        <span>¥</span>
        <input id="quick-strip-amount" type="number" inputmode="decimal" min="0.01" max="999999" step="0.01" placeholder="0.00" aria-label="金额">
      </label>
      <button type="button" id="ledger-quick-save" class="ledger-quick-save">记下这笔</button>
    </div>
    <div class="ledger-quick-secondary">
      <label class="ledger-quick-account-wrap">
        <span class="material-symbols-outlined" aria-hidden="true">account_balance_wallet</span>
        <select id="ledger-quick-account" aria-label="账户">${accountOptions(accounts,accountId,accounts.length?'选择账户':'请先新建账户')}</select>
      </label>
      <div class="ledger-quick-type" aria-label="记账类型">${[['expense','支出'],['income','收入']].map(([value,label])=>`<button type="button" id="strip-btn-${value}" data-quick-type="${value}" class="${ledgerQuickType===value?'active':''}">${label}</button>`).join('')}</div>
    </div>
    <label class="ledger-quick-note-wrap" for="quick-strip-note"><span class="material-symbols-outlined" aria-hidden="true">edit_note</span><input id="quick-strip-note" maxlength="100" placeholder="备注（可选），例如：午餐、地铁……" aria-label="备注"></label>
    <div class="ledger-quick-cats" id="quick-cat-strip">${cats.map(([id,category])=>`<button type="button" data-quick-category="${esc(id)}" class="${id===ledgerQuickCategory?'active':''}" style="--ledger-cat-color:${category.color}"><span class="material-symbols-outlined">${esc(category.icon)}</span>${esc(category.label)}</button>`).join('')||'<small class="field-help">暂无分类</small>'}</div>
  </section>`;
}

// 账户余额折叠头：默认一行汇总，展开显示账户列表
function ledgerAccountsHead(count, total) {
  return `<div class="ledger-accounts-head">
    <span class="ledger-accounts-mark material-symbols-outlined" aria-hidden="true">currency_yen</span>
    <span class="ledger-accounts-heading"><strong>我的账户</strong><small id="ledger-total-accounts-sub">${count}个账户 · 总余额 ¥${money(total)}</small></span>
    <button type="button" class="soft-button" id="manage-ledger-accounts-list">管理</button>
  </div>`;
}

function budgetRow(summary) {
  const budget = summary.budgetProgress;
  const setting = state.settings.ledgerBudget || {};
  const hasPeriod = isDate(setting.start) && isDate(setting.end) && String(setting.start) <= String(setting.end);
  const periodLabel = hasPeriod ? `${setting.start.slice(5).replace('-', '.')} – ${setting.end.slice(5).replace('-', '.')}` : '';
  const tone = budgetTone(budget.percent);
  const currentMonth = `${Number(summary.period.start.slice(5, 7))}月生活预算`;
  if (!budget.total) {
    return `<div class="ledger-budget-head"><button type="button" id="ledger-budget-analysis" class="ledger-budget-copy"><strong>${currentMonth}</strong><small>${hasPeriod ? `周期 ${periodLabel} · 还没有设置预算` : '还没有设置预算 · 设置后显示使用进度'}</small></button><button type="button" id="ledger-budget-set">设置预算</button></div><div class="level-bar" aria-label="尚未设置预算"><i class="green" style="width:0%"></i></div>`;
  }
  const delta = budget.total - budget.spent;
  const stateText = summary.periodEnded
    ? `周期已结束${hasPeriod ? ` · ${periodLabel}` : ''}`
    : delta < 0
      ? `已用 ¥${money(budget.spent)} · 超支 ¥${money(Math.abs(delta))}`
      : `已用 ¥${money(budget.spent)} · 剩余 ¥${money(delta)}${hasPeriod ? ` · 剩 ${summary.daysLeft} 天` : ''}`;
  const action = summary.periodEnded ? '设置下一周期' : '调整';
  return `<div class="ledger-budget-head"><button type="button" id="ledger-budget-analysis" class="ledger-budget-copy"><strong>${currentMonth}</strong><small>${stateText}</small></button><span class="ledger-budget-percent ${tone}">已用 ${budget.percent}%</span><button type="button" id="ledger-budget-set">${action}</button></div><div class="level-bar" aria-label="预算已用 ${budget.percent}%"><i class="${tone}" style="width:${Math.min(100, budget.percent)}%"></i></div>`;
}

function ledgerDayGroup(group) {
  const date = new Date(`${group.date}T12:00:00`);
  const dayExpense = group.items.filter(item => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0);
  const transfers = group.items.filter(item => item.type === 'transfer').length;
  const calibrations = group.items.filter(item => item.type === 'calibrate').length;
  const label = group.date === dateKey() ? '今天' : `${date.getMonth() + 1}月${date.getDate()}日`;
  return `<section class="ledger-day"><header><div><strong>${label}</strong><small>${group.date.slice(0, 4)}-${group.date.slice(5)} · 星期${WEEK_DAYS[date.getDay()]}</small></div><span>支出 ${money(dayExpense)}${transfers ? ` · 转账 ${transfers}` : ''}${calibrations ? ` · 平账 ${calibrations}` : ''}</span></header><div>${group.items.map(ledgerRow).join('')}</div></section>`;
}

export function ledgerView() {
  const summary = ledgerSummary(state);
  const categories = ledgerCategoryMap(state);
  const accounts = summary.accounts.filter(account => !account.archived);
  const normalAccounts = activeAccounts({ includeReceivable: false });
  const last = state.settings?.ledgerLastUsed || {};
  ledgerQuickType = last.type === 'income' ? 'income' : 'expense';
  const quickCats = usableCategories(ledgerQuickType);
  ledgerQuickCategory = quickCats.some(([id]) => id === last.category) ? last.category : (quickCats[0]?.[0] || 'other');
  const list = [...(state.transactions || [])].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const filtered = ledgerFilter === 'all'
    ? list
    : ledgerFilter === 'special'
      ? list.filter(item => item.type === 'transfer' || item.type === 'calibrate')
      : list.filter(item => item.category === ledgerFilter);
  const groups = [];
  filtered.forEach(item => {
    const group = groups.find(entry => entry.date === item.date);
    group ? group.items.push(item) : groups.push({ date:item.date, items:[item] });
  });
  const categoryRows = Object.entries(summary.categoryExpense || {}).filter(([, amount]) => amount > 0);
  const liquidNetAssets = summary.totalAssets - summary.receivableBalance;
  const breakdown = summary.monthExpense
    ? `<div class="expense-breakdown-bar" aria-label="本期支出分类占比">${categoryRows.map(([id, amount]) => `<i style="width:${amount / summary.monthExpense * 100}%;background:${(categories[id] || LEDGER_CATEGORIES.other).color}"></i>`).join('')}</div>`
    : '';
  const accountCards = accounts.map((account, index) => `<article class="account-mini-card${index === 0 ? ' featured' : ''}">
    <button type="button" class="account-mini-name" data-edit-ledger-account="${account.id}" aria-label="编辑${esc(account.name)}">
      <span class="account-icon-badge material-symbols-outlined" aria-hidden="true">${accountIcon(account.type)}</span>
      <span><strong>${esc(account.name)}</strong><small>${accountTypeLabel(account.type)}</small></span>
    </button>
    <button type="button" class="account-mini-balance" data-calibrate-ledger-account="${account.id}" aria-label="校准${esc(account.name)}余额">
      <b id="acc-display-${esc(account.id)}">¥${money(account.balance)}</b>
      <span class="material-symbols-outlined" aria-hidden="true">tune</span>
    </button>
  </article>`).join('');

  return `<section class="view ledger-view" id="screen-ledger">
    <header class="ledger-page-header">
      <div class="ledger-page-title">Mine Ledger</div>
      <div class="ledger-page-subtitle">PERSONAL FINANCE · ${summary.period.start.slice(0, 7)}</div>
      <span class="ledger-corner-note" aria-hidden="true">Better<br>Money<br>A Brighter<br>Tomorrow.</span>
    </header>

    <article class="ledger-overview-card">
      <div class="ledger-total-head">
        <div><small>NET TOTAL ASSETS</small><div class="ledger-total-amount" id="ledger-total-display">¥${money(liquidNetAssets)}</div></div>
        <button type="button" id="new-transaction-head" class="ledger-add-btn"><span class="material-symbols-outlined" aria-hidden="true">add</span>记一笔</button>
      </div>
      <div class="ledger-sub-stats">
        <span><i class="material-symbols-outlined">paid</i><span><small>本期收入</small><strong class="pos">+¥${money(summary.monthIncome)}</strong></span></span>
        <span><i class="material-symbols-outlined">south</i><span><small>本期支出</small><strong class="neg">-¥${money(summary.monthExpense)}</strong></span></span>
        <span><i class="material-symbols-outlined">handshake</i><span><small>外借应收</small><strong class="loan">¥${money(summary.receivableBalance)}</strong></span></span>
      </div>
      <div class="ledger-budget-box">${budgetRow(summary)}</div>
    </article>

    ${ledgerQuickCard(normalAccounts, last.accountId)}

    <section class="ledger-accounts-section" id="ledger-accounts-list">
      <div class="accounts-header-row">${ledgerAccountsHead(accounts.length, summary.totalAssets)}</div>
      ${accounts.length
        ? `<div class="ledger-accounts-track">${accountCards}</div><button type="button" id="toggle-ledger-accounts" class="ledger-accounts-all">查看全部账户与余额校准 <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></button>`
        : `<div class="ledger-accounts-empty">${emptyState('还没有账户', '添加账户后即可记录收支。')}<button type="button" id="ledger-empty-account-add" class="ledger-accounts-all">添加第一个账户 <span class="material-symbols-outlined" aria-hidden="true">add</span></button></div>`}
    </section>

    <div class="stream-sheet ledger-stream-sheet">
      <div class="sheet-handle"></div>
      <div class="expense-stream-head"><h2 class="sheet-title">Expense Streams</h2><span>本期总支出 ¥${money(summary.monthExpense)}</span></div>
      ${breakdown}
      <div class="ledger-toolbar">
        <div class="snippet-tabs-filter ledger-tabs">${[['all', '全部', ''], ['special', '转账/平账', 'swap_horiz'], ...Object.entries(categories).filter(([, cat]) => !cat.archived).map(([id, cat]) => [id, cat.label, cat.icon])].map(([id, label, icon]) => `<button data-ledger-filter="${id}" class="snippet-filter-pill ${ledgerFilter === id ? 'active' : ''}">${icon ? `<span class="material-symbols-outlined">${icon}</span>` : ''}${esc(label)}</button>`).join('')}</div>
      </div>
      <div class="ledger-groups">${groups.length ? groups.map(ledgerDayGroup).join('') : emptyState('还没有账目', ledgerFilter === 'all' ? '点「记一笔」记录今天的花销。' : '这个分类还没有记录。')}</div>
      <p class="ledger-local-note"><span class="material-symbols-outlined">lock</span>本地加密储存 · 账目仅保存在此设备</p>
    </div>
  </section>`;
}

function ledgerRow(item) {
  const categories = ledgerCategoryMap(state);
  const accounts = new Map((state.ledgerAccounts || []).map(account => [account.id, account]));
  const cat = categories[item.category] || LEDGER_CATEGORIES.other;
  const isExpense = item.type === 'expense';
  const isIncome = item.type === 'income';
  const isTransfer = item.type === 'transfer';
  const isCalibrate = item.type === 'calibrate';
  const sign = isIncome ? '+' : isTransfer ? '↔' : isCalibrate ? (Number(item.adjustment ?? item.difference) >= 0 ? '+' : '-') : '-';
  const source = accounts.get(item.sourceAccountId);
  const target = accounts.get(item.targetAccountId);
  const account = accounts.get(item.accountId);
  const title = isTransfer ? `${source?.name || '已归档账户'} → ${target?.name || '已归档账户'}` : isCalibrate ? String(item.reasonTag || '账户平账').replace(/^#+/, '') : (item.note || cat.label);
  const subtitle = isTransfer ? '账户转账 · 不计入预算' : isCalibrate ? `${account?.name || '已归档账户'} · 不计收支与预算` : (item.accountId === 'unassigned' ? '未归属旧账 · 请补全账户' : `${cat.label} · ${account?.name || '已归档账户'}`);
  const icon = isTransfer ? 'swap_horiz' : isCalibrate ? 'balance' : cat.icon;
  const color = isTransfer ? 'var(--sage-green-dark)' : isCalibrate ? 'var(--gold-accent)' : cat.color;
  const thumb = item.photo ? `<button class="ledger-thumb" data-view-transaction-photo="${item.id}" aria-label="查看小票"><img src="${imgSrc(item.photo)}" alt="小票"></button>` : '';
  const amount = isCalibrate ? Math.abs(Number(item.adjustment ?? item.difference ?? 0)) : item.amount;
  const directionClass = isCalibrate ? (Number(item.adjustment ?? item.difference) >= 0 ? ' reconcile-increase' : ' reconcile-decrease') : '';
  const reconcileKicker = isCalibrate ? '<span class="ledger-reconcile-kicker">BALANCE RECONCILIATION · 平账核销</span>' : '';
  const deleteLabel = isCalibrate ? '撤销' : '删除';
  return `<article class="ledger-row ${item.type}${directionClass}${item.photo ? ' has-photo' : ''}"><span class="ledger-cat-icon" style="--ledger-cat-color:${color}"><span class="material-symbols-outlined">${icon}</span></span>${thumb}<div class="ledger-row-copy">${reconcileKicker}<strong>${esc(title)}</strong><small>${esc(subtitle)}</small></div><b class="ledger-amount">${sign}¥${money(amount)}</b><div class="row-actions ledger-row-actions">${isCalibrate ? '' : '<button data-edit-transaction="' + item.id + '">编辑</button>'}<button class="danger" data-delete-transaction="${item.id}" aria-label="${isCalibrate ? `撤销平账记录：${esc(title)}` : `删除账目：${esc(title)}`}">${deleteLabel}</button></div></article>`;
}

// ---- 记账表单（新建/编辑复用）----
function ledgerForm(entry = null) {
  ledgerVoice?.destroy();
  ledgerVoice = null;
  const normalAccounts = activeAccounts({ includeReceivable: false });
  const transferAccounts = activeAccounts();
  const last = state.settings?.ledgerLastUsed || {};
  const defaultType = ['expense', 'income', 'transfer'].includes(last.type) ? last.type : 'expense';
  const defaultCategory = usableCategories(defaultType).some(([id]) => id === last.category) ? last.category : (usableCategories(defaultType)[0]?.[0] || 'other');
  const defaultAccount = normalAccounts.some(account => account.id === last.accountId) ? last.accountId : (normalAccounts[0]?.id || 'unassigned');
  const item = entry || makeTransaction({ type: defaultType, category: defaultCategory, accountId: defaultAccount, amount: 0, date: dateKey(), createdAt: Date.now() });
  pendingLedgerType = item.type;
  pendingLedgerCategory = item.category;
  pendingTransactionPhoto = item.photo || '';
  const summary = ledgerSummary(state);
  const budget = summary.budgetProgress;
  const budgetLine = budget.total ? `<div class="ledger-form-budget ${budgetTone(budget.percent)}">\
<span class="material-symbols-outlined">savings</span>\
<span>本月预算剩余 ¥${money(Math.max(0, budget.total - budget.spent))}</span>\
<small>已用 ${budget.percent}%</small>\
</div>` : '';
  const categoryButtons = type => usableCategories(type).map(([id, category]) => `<button type="button" data-ledger-category="${esc(id)}" class="${id === pendingLedgerCategory ? 'active' : ''}" style="--ledger-cat-color:${category.color}">\
<span class="material-symbols-outlined">${esc(category.icon)}</span>\
<small>${esc(category.label)}</small>\
</button>`).join('');
modal(`<form id="full-ledger-modal">\
<input type="hidden" name="id" value="${entry ? item.id : ''}">\
<span class="eyebrow">LEDGER ENTRY</span>\
<h2>${entry ? '编辑账目' : '记一笔'}</h2>${budgetLine}<div class="ledger-type-toggle">${[['expense', '支出'], ['income', '收入'], ['transfer', '转账']].map(([value, label]) => `<button type="button" id="modal-type-${value}" data-ledger-type="${value}" class="${item.type === value ? 'active' : ''}">${label}</button>`).join('')}</div>\
<label>金额</label>\
<div class="ledger-amount-main">\
<span>¥</span>\
<input id="modal-amount-input" name="amount" type="number" inputmode="decimal" min="0.01" max="999999" step="0.01" required value="${item.amount || ''}" placeholder="0.00" autofocus>\
</div>\
<div id="ledger-normal-fields" class="${item.type === 'transfer' ? 'form-hidden' : ''}">\
<label>账户</label>\
<select id="modal-account-select" name="accountId">${accountOptions(normalAccounts, item.accountId, normalAccounts.length ? '选择账户' : '请先新建账户')}</select>\
<label>消费分类</label>\
<div id="ledger-category-grid" class="ledger-category-grid">${item.type === 'transfer' ? '' : categoryButtons(item.type)}</div>\
<button type="button" class="text-button" id="manage-ledger-categories">管理自定义分类</button>\
</div>\
<div id="ledger-transfer-fields" class="${item.type === 'transfer' ? '' : 'form-hidden'}">\
<div class="ledger-transfer-intro"><span class="material-symbols-outlined" aria-hidden="true">swap_horiz</span><span><strong>账户内部转账</strong><small>把余额从一个自己的账户移到另一个账户；不会记作收入或支出，也不会占用预算。</small></span></div>\
<label>钱从哪里转出</label>\
<select id="modal-source-account-select" name="sourceAccountId">${accountOptions(transferAccounts, item.sourceAccountId, '选择转出账户')}</select>\
<label>钱转到哪里</label>\
<select id="modal-target-account-select" name="targetAccountId">${accountOptions(transferAccounts, item.targetAccountId, '选择转入账户')}</select>\
<p class="ledger-transfer-help">如果是把钱借给别人，请把“外借应收款”选作转入账户；对方还款时再从“外借应收款”转回实际收款账户。</p>\
</div>\
<div class="ledger-photo-head">\
<div>\
<strong>小票 / 照片</strong>\
<small>可选，保存后可在账单里点开查看</small>\
</div>\
</div>\
<div id="ledger-photo-preview" class="ledger-photo-picker">${ledgerPhotoPreview()}</div>\
<div class="snippet-photo-actions ledger-photo-actions" id="ledger-photo-actions">\
<button type="button" id="capture-ledger-photo">\
<span class="material-symbols-outlined">photo_camera</span>${pendingTransactionPhoto ? '重新拍摄' : '打开相机'}</button>\
<button type="button" id="pick-ledger-photo">\
<span class="material-symbols-outlined">photo_library</span>从相册选择</button>\
<button type="button" id="recognize-ledger-photo" ${pendingTransactionPhoto ? '' : 'hidden disabled'}>AI 识别小票</button>\
<small class="ledger-recognize-note" ${pendingTransactionPhoto ? '' : 'hidden'}>小票可能包含敏感财务信息；点击后将发送到你配置的AI模型，仅用于生成记账建议。</small>\
</div>\
<label>日期</label>\
<input id="modal-date-input" name="date" type="date" required value="${item.date}">\
<label>备注（可选）</label>\
<div class="ledger-note-row">\
<input id="modal-note-input" name="note" maxlength="100" value="${esc(item.note)}" placeholder="${item.type === 'transfer' ? '例如：借给小王' : '这笔钱花在了哪里……'}">${micButtonHtml()}</div>\
<div class="modal-actions">\
<button type="button" data-close>取消</button>\
<button class="save">保存</button>\
</div>\
</form>`, 'ledger-form-modal');
  bindLedgerForm();
}

function ledgerPhotoPreview() {
  return pendingTransactionPhoto ? `<img src="${imgSrc(pendingTransactionPhoto)}" alt="小票预览">` : '<span class="material-symbols-outlined">receipt_long</span><strong>拍下小票</strong><small>也可以从相册选择</small>';
}

function bindLedgerForm() {
  $$('[data-ledger-type]').forEach(button => button.onclick = () => {
    pendingLedgerType = button.dataset.ledgerType;
    $$('[data-ledger-type]').forEach(b => b.classList.toggle('active', b === button));
    $('#ledger-normal-fields')?.classList.toggle('form-hidden', pendingLedgerType === 'transfer');
    $('#ledger-transfer-fields')?.classList.toggle('form-hidden', pendingLedgerType !== 'transfer');
    const grid = $('#ledger-category-grid');
    if (grid && pendingLedgerType !== 'transfer') {
      const entries = usableCategories(pendingLedgerType);
      if (!entries.some(([id]) => id === pendingLedgerCategory)) pendingLedgerCategory = entries[0]?.[0] || 'other';
      grid.innerHTML = entries.map(([id, category]) => `<button type="button" data-ledger-category="${esc(id)}" class="${id === pendingLedgerCategory ? 'active' : ''}" style="--ledger-cat-color:${category.color}"><span class="material-symbols-outlined">${esc(category.icon)}</span><small>${esc(category.label)}</small></button>`).join('');
      bindLedgerCategories();
    }
  });
  bindLedgerCategories();
  $('#capture-ledger-photo')?.addEventListener('click', () => pickLedgerPhoto(true).catch(error => show(error.message)));
  $('#pick-ledger-photo')?.addEventListener('click', () => pickLedgerPhoto(false).catch(error => show(error.message)));
  $('#recognize-ledger-photo')?.addEventListener('click', () => recognizeLedgerPhoto().catch(error => show(error.message)));
  $('#manage-ledger-categories')?.addEventListener('click', ledgerCategoryManager);
  refreshLedgerPhotoPreview();
  ledgerVoice = bindVoiceInput($('#full-ledger-modal'), { input: () => $('#modal-note-input'), onText: () => {} });
  $('#full-ledger-modal [data-close]')?.addEventListener('click', () => { ledgerVoice?.destroy(); ledgerVoice = null; });
}

function bindLedgerCategories() {
  $$('[data-ledger-category]').forEach(button => button.onclick = () => {
    pendingLedgerCategory = button.dataset.ledgerCategory;
    $$('[data-ledger-category]').forEach(b => b.classList.toggle('active', b === button));
  });
}

async function pickLedgerPhoto(useCamera = false) {
  if (useCamera && Capacitor.isNativePlatform()) {
    try {
      const photo = await Camera.takePhoto({
        quality: 86,
        targetWidth: 1600,
        targetHeight: 1600,
        correctOrientation: true,
        encodingType: EncodingType.JPEG,
        saveToGallery: false,
        cameraDirection: CameraDirection.Rear,
        editable: 'no',
        includeMetadata: true
      });
      if (!photo.webPath) throw new Error('相机没有返回照片');
      const response = await fetch(photo.webPath);
      if (!response.ok) throw new Error('无法读取刚拍摄的照片');
      const blob = await response.blob();
      const file = new File([blob], `ledger-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
      pendingTransactionPhoto = await compressJournalPhoto(file);
      refreshLedgerPhotoPreview();
      return;
    } catch (error) {
      if (/cancel|取消/i.test(error?.message || '')) return;
      throw error;
    }
  }
  return pickLedgerPhotoWithInput(useCamera);
}

function pickLedgerPhotoWithInput(useCamera = false) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
    if (useCamera) input.setAttribute('capture', 'environment');
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) return resolve();
        if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过 20MB');
        if (!isSupportedJournalPhoto(file)) throw new Error('仅支持 JPG、PNG 或 WebP 图片');
        pendingTransactionPhoto = await compressJournalPhoto(file);
        refreshLedgerPhotoPreview();
        resolve();
      } catch (error) { reject(error); }
    };
    input.click();
  });
}

function refreshLedgerPhotoPreview() {
  const preview = $('#ledger-photo-preview');
  if (preview) preview.innerHTML = ledgerPhotoPreview();
  const capture = $('#capture-ledger-photo');
  if (capture) capture.innerHTML = `<span class="material-symbols-outlined">photo_camera</span>${pendingTransactionPhoto ? '重新拍摄' : '打开相机'}`;
  const actions = $('#ledger-photo-actions');
  if (actions) {
    const recognize = $('#recognize-ledger-photo');
    const recognizeNote = $('.ledger-recognize-note', actions);
    if (recognize) { recognize.hidden = !pendingTransactionPhoto; recognize.disabled = !pendingTransactionPhoto; }
    if (recognizeNote) recognizeNote.hidden = !pendingTransactionPhoto;
    if (!pendingTransactionPhoto) $$('.ledger-recognize-result', actions).forEach(item => item.remove());
    const existingRemove = $('#remove-ledger-photo', actions);
    if (pendingTransactionPhoto && !existingRemove) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.id = 'remove-ledger-photo';
      remove.className = 'danger-text';
      remove.textContent = '移除';
      remove.onclick = () => { pendingTransactionPhoto = ''; refreshLedgerPhotoPreview(); };
      actions.appendChild(remove);
    } else if (!pendingTransactionPhoto && existingRemove) {
      existingRemove.remove();
    }
  }
}

// ---- 账户 / 自定义分类 ----
function ledgerAccountManager() {
  const summary = ledgerSummary(state);
  modal(`<div class="modal-head"><div><span class="eyebrow">ACCOUNTS</span><h2>账户管理</h2><p>默认账户也可以改名、调整余额或归档；历史账目会保留原账户名称。</p></div><button id="new-ledger-account" class="icon-button" aria-label="新增账户"><span class="material-symbols-outlined">add</span></button></div><div class="manage-list ledger-account-manage-list">${summary.accounts.map(account => `<button data-edit-ledger-account="${account.id}" class="ledger-account-manage-row${account.archived ? ' done' : ''}"><span class="round-icon material-symbols-outlined">${accountIcon(account.type)}</span><span class="ledger-account-manage-copy"><strong>${esc(account.name)}</strong><small>${accountTypeLabel(account.type)}${account.archived ? ' · 已归档' : ''}</small></span><b class="ledger-account-manage-balance">¥${money(account.balance)}</b></button>`).join('') || emptyState('还没有账户', '添加账户后即可按账户记录收支。')}</div><div class="modal-actions"><button type="button" id="manage-ledger-categories-from-accounts">自定义分类</button><button type="button" id="manage-ledger-merchant-rules">商户分类规则</button><button type="button" data-close>完成</button></div>`, 'large-modal');
  $('#new-ledger-account')?.addEventListener('click', () => ledgerAccountForm());
  $$('[data-edit-ledger-account]').forEach(button => button.onclick = () => ledgerAccountForm(state.ledgerAccounts.find(account => account.id === button.dataset.editLedgerAccount)));
  $$('[data-calibrate-ledger-account]').forEach(button => button.onclick = () => ledgerAccountBalanceForm(state.ledgerAccounts.find(account => account.id === button.dataset.calibrateLedgerAccount)));
  $('#manage-ledger-categories-from-accounts')?.addEventListener('click', ledgerCategoryManager);
  $('#manage-ledger-merchant-rules')?.addEventListener('click', ledgerMerchantRuleManager);
}

export function ledgerMerchantRuleManager() {
  const categories = ledgerCategoryMap(state);
  const rules = state.merchantCategoryRules || [];
  modal(`<div class="modal-head"><div><span class="eyebrow">MERCHANT RULES</span><h2>商户分类规则</h2><p>关键词匹配账目备注，只建议分类；入账前仍可修改。</p></div><button type="button" id="new-merchant-rule" class="icon-button" aria-label="新增规则"><span class="material-symbols-outlined">add</span></button></div><div class="manage-list merchant-rule-list">${rules.map(rule => `<div class="merchant-rule-row"><button type="button" data-edit-merchant-rule="${esc(rule.id)}"><strong>${esc(rule.keyword)}</strong><small>${esc(categories[rule.categoryId]?.name || categories[rule.categoryId]?.label || '分类不可用')}${categories[rule.categoryId]?.archived ? ' · 已归档，不再匹配' : ''}</small></button><button type="button" data-toggle-merchant-rule="${esc(rule.id)}" aria-label="${rule.enabled ? '停用' : '启用'}规则">${rule.enabled ? '已启用' : '已停用'}</button><button type="button" data-delete-merchant-rule="${esc(rule.id)}" class="danger-text" aria-label="删除规则">删除</button></div>`).join('') || emptyState('还没有规则', '可以手动新增，也可在 AI 记账确认时记住商户归类。')}</div><div class="modal-actions"><button type="button" id="merchant-rules-back">返回账户管理</button><button type="button" data-close>完成</button></div>`, 'large-modal ledger-merchant-rules-modal');
  $('#new-merchant-rule').onclick = () => merchantRuleForm();
  $('#merchant-rules-back').onclick = ledgerAccountManager;
  $$('[data-edit-merchant-rule]').forEach(button => button.onclick = () => merchantRuleForm(rules.find(rule => rule.id === button.dataset.editMerchantRule)));
  $$('[data-toggle-merchant-rule]').forEach(button => button.onclick = async () => {
    const rule = rules.find(item => item.id === button.dataset.toggleMerchantRule);
    const previous = rule.enabled;
    try { rule.enabled = !previous; await save(); ledgerMerchantRuleManager(); }
    catch (error) { rule.enabled = previous; show(error.message); }
  });
  $$('[data-delete-merchant-rule]').forEach(button => button.onclick = () => confirmDelete('删除这条商户规则？已有账目不会改变。', async () => {
    const previous = state.merchantCategoryRules;
    try { state.merchantCategoryRules = previous.filter(rule => rule.id !== button.dataset.deleteMerchantRule); await save(); ledgerMerchantRuleManager(); }
    catch (error) { state.merchantCategoryRules = previous; show(error.message); ledgerMerchantRuleManager(); }
  }));
}

function merchantRuleForm(rule = null) {
  const categories = Object.entries(ledgerCategoryMap(state)).filter(([, category]) => !category.archived);
  modal(`<form id="merchant-rule-form"><span class="eyebrow">MERCHANT RULE</span><h2>${rule ? '编辑' : '新增'}商户规则</h2><input type="hidden" name="id" value="${esc(rule?.id || '')}"><label>商户关键词</label><input name="keyword" required maxlength="80" value="${esc(rule?.keyword || '')}" placeholder="例如：便利店"><label>建议分类</label><select name="categoryId">${categories.map(([id, category]) => `<option value="${esc(id)}" ${rule?.categoryId === id ? 'selected' : ''}>${esc(category.name || category.label)}</option>`).join('')}</select><label class="confirm-line"><input type="checkbox" name="enabled" ${rule?.enabled !== false ? 'checked' : ''}> 启用规则</label><div class="modal-actions"><button type="button" id="cancel-merchant-rule">取消</button><button class="save">保存</button></div></form>`, 'ledger-merchant-rule-form-modal');
  $('#cancel-merchant-rule').onclick = ledgerMerchantRuleManager;
}

function ledgerAccountForm(account = null) {
  const item = account || makeLedgerAccount({ sortOrder: (state.ledgerAccounts || []).length });
  modal(`<form id="ledger-account-form"><input type="hidden" name="id" value="${account ? esc(item.id) : ''}"><span class="eyebrow">ACCOUNT</span><h2>${account ? '编辑账户' : '新增账户'}</h2><label>账户名称</label><input name="name" maxlength="24" required value="${esc(item.name)}" placeholder="例如：招商银行卡"><div class="form-grid"><div><label>类型</label><select name="type">${[['wallet', '电子钱包'], ['bank', '银行卡'], ['cash', '现金'], ['receivable', '外借应收款']].map(([value, label]) => `<option value="${value}" ${item.type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div><label>初始余额</label><input name="initialBalance" type="number" inputmode="decimal" min="-9999999" max="9999999" step="0.01" value="${item.initialBalance || ''}" placeholder="0.00"></div></div><p class="subtle">初始余额是开始使用 Mine 时的余额；已有账目会在此基础上累计。</p><div class="modal-actions">${account ? `<button type="button" class="${item.archived ? '' : 'danger'}" id="archive-ledger-account">${item.archived ? '恢复账户' : '归档账户'}</button>` : ''}<button type="button" data-close>取消</button><button class="save">保存账户</button></div></form>`, 'ledger-account-modal');
  $('#archive-ledger-account')?.addEventListener('click', async () => {
    const archived = !item.archived;
    const balance = ledgerSummary(state).accounts.find(entry => entry.id === item.id)?.balance || 0;
    if (archived && Math.abs(balance) >= 0.005) { show('账户余额尚未归零，请先转出余额或校准后再归档。'); return; }
    const apply = async () => {
      const previous = { ...item };
      try { archiveLedgerAccount(state, item.id, archived); await save(); ledgerAccountManager(); render(); }
      catch (error) { Object.assign(item, previous); show(error.message); }
    };
    if (archived) confirmDelete(`归档「${item.name}」？历史账目保留，之后可在账户管理中恢复。`, apply);
    else await apply();
  });
}


// ---- 余额校准弹窗（原型 #account-balance-modal；阶段 1 结构+视觉+基准校准，平账流水阶段 2 接）----
function ledgerAccountBalanceForm(account) {
  const current = ledgerSummary(state).accounts.find(a => a.id === account.id)?.balance ?? 0;
  const shown = Math.abs(current) < 0.005 ? '' : money(current);
  const accounts = activeAccounts();
  const reasons = ['平账核销', '收到还款', '利息收益', '遗忘补录', '初始设账'];
  modal(`<form id="account-balance-modal">\
<input type="hidden" name="id" value="${account.id}">\
<input type="hidden" name="reasonTag" value="#平账核销">\
<span class="eyebrow">CALIBRATE BALANCE</span>\
<h2>校准余额 · ${esc(account.name)}</h2>\
<div class="balance-account-pills">${accounts.map(item => `<button type="button" id="acc-pill-${esc(item.id)}" data-balance-account="${esc(item.id)}" class="${item.id === account.id ? 'active' : ''}">${esc(item.name)}</button>`).join('')}</div>\
<div class="balance-current-row">\
<span>当前余额</span>\
<b id="edit-acc-curr-val">¥${money(current)}</b>\
</div>\
<label>新实际余额</label>\
<div class="ledger-amount-main">\
<span>¥</span>\
<input id="edit-acc-target-input" name="newBalance" type="number" inputmode="decimal" min="-9999999" max="9999999" step="0.01" value="${shown}" placeholder="0.00">\
</div>\
<div class="balance-diff-badge" id="balance-diff-badge">差额 ¥0.00</div>\
<label>原因</label><div class="balance-reason-chips">${reasons.map(reason => `<button type="button" id="${esc('#' + reason)}" data-balance-reason="#${reason}" class="${reason === '平账核销' ? 'active' : ''}">#${reason}</button>`).join('')}</div>\
<label>备注</label>\
<input id="edit-acc-note-input" name="note" maxlength="100" placeholder="可选">\
<label class="confirm-line">\
<input id="edit-acc-sync-check" name="editAccSync" type="checkbox" checked> 生成平账流水</label>\
<p class="subtle">零差额不会生成流水；平账不计收入、支出或预算。</p>\
<div class="modal-actions">\
<button type="button" data-close>取消</button>\
<button class="save">保存校准</button>\
</div>\
</form>`, 'ledger-account-balance-modal');
  const input = $('#edit-acc-target-input');
  const badge = $('#balance-diff-badge');
  input?.addEventListener('input', () => {
    if (!input.value.trim()) { badge.textContent = '请输入新余额'; badge.className = 'balance-diff-badge zero'; return; }
    const diff = Number(input.value) - current;
    badge.textContent = Math.abs(diff) < 0.005 ? '无变化' : `差额 ${diff > 0 ? '+' : '-'}¥${money(Math.abs(diff))}`;
    badge.className = `balance-diff-badge ${Math.abs(diff) < 0.005 ? 'zero' : diff > 0 ? 'positive' : 'negative'}`;
  });
  $$('[data-balance-account]').forEach(button => button.onclick = () => ledgerAccountBalanceForm(state.ledgerAccounts.find(item => item.id === button.dataset.balanceAccount)));
  $$('[data-balance-reason]').forEach(button => button.onclick = () => { $('[name=reasonTag]', $('#account-balance-modal')).value = button.dataset.balanceReason; $$('[data-balance-reason]').forEach(item => item.classList.toggle('active', item === button)); });
}

async function recognizeLedgerPhoto() {
  if (!pendingTransactionPhoto) return;
  if (pendingLedgerType !== 'expense') return show('小票识别仅适用于支出，请先切换到支出');
  if (!state.settings.aiApiKey) { show('请先配置支持图片的AI模型'); return callHelper('aiSettingsForm'); }
  const button = $('#recognize-ledger-photo');
  if (!button || button.disabled) return;
  $$('.ledger-recognize-result').forEach(item => item.remove());
  button.disabled = true; button.textContent = '正在识别…';
  try {
    const result = await callHelper('aiRecognizeLedgerImage', pendingTransactionPhoto);
    if (!result) throw new Error('AI 小票识别能力尚未接入');
    if (result.amount != null) $('#modal-amount-input').value = result.amount;
    if (/^\d{4}-\d{2}-\d{2}$/.test(result.date || '')) $('#modal-date-input').value = result.date;
    if (result.category && usableCategories('expense').some(([id]) => id === result.category)) { pendingLedgerCategory = result.category; $$('[data-ledger-category]').forEach(item => item.classList.toggle('active', item.dataset.ledgerCategory === result.category)); }
    const note = [result.merchant, result.note].filter(Boolean).join(' · ');
    if (note) $('#modal-note-input').value = note;
    const confidence = Number(result.confidence); const label = confidence >= .8 ? '高' : confidence >= .5 ? '中' : '低';
    button.insertAdjacentHTML('afterend', `<small class="ledger-recognize-result">${label}可信度，仅已填入表单建议</small>`);
  } finally { if (button.isConnected) { button.disabled = false; button.textContent = 'AI 识别小票'; } }
}

function ledgerCategoryManager() {
  const categories = (state.ledgerCategories || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  modal(`<div class="modal-head"><div><span class="eyebrow">CUSTOM CATEGORIES</span><h2>自定义分类</h2><p>系统分类固定保留；这里创建的分类可用于收入或支出。</p></div><button id="new-ledger-category" class="icon-button" aria-label="新增分类"><span class="material-symbols-outlined">add</span></button></div><div class="manage-list">${categories.filter(category => !category.archived).map(category => `<button data-edit-ledger-category="${category.id}"><span class="round-icon material-symbols-outlined">${esc(category.icon)}</span><span><strong>${esc(category.name)}</strong><small>${category.scope === 'both' ? '收入和支出' : category.scope === 'income' ? '仅收入' : '仅支出'}</small></span><span class="material-symbols-outlined">edit</span></button>`).join('') || emptyState('还没有自定义分类', '点击右上角添加分类。')}</div><div class="modal-actions"><button type="button" data-close>完成</button></div>`, 'large-modal');
  $('#new-ledger-category')?.addEventListener('click', () => ledgerCategoryForm());
  $$('[data-edit-ledger-category]').forEach(button => button.onclick = () => ledgerCategoryForm(state.ledgerCategories.find(category => category.id === button.dataset.editLedgerCategory)));
}

function ledgerCategoryForm(category = null) {
  const item = category || makeLedgerCategory({ sortOrder: (state.ledgerCategories || []).length });
  modal(`<form id="ledger-category-form"><input type="hidden" name="id" value="${category ? esc(item.id) : ''}"><span class="eyebrow">CUSTOM CATEGORY</span><h2>${category ? '编辑分类' : '新增分类'}</h2><label>分类名称</label><input name="name" maxlength="24" required value="${esc(item.name)}" placeholder="例如：宠物"><div class="form-grid"><div><label>图标名称</label><input name="icon" maxlength="48" value="${esc(item.icon)}" placeholder="category"></div><div><label>适用账目</label><select name="scope">${[['both', '收入和支出'], ['expense', '仅支出'], ['income', '仅收入']].map(([value, label]) => `<option value="${value}" ${item.scope === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div></div><label>颜色</label><input name="color" type="color" value="${esc(item.color)}"><div class="modal-actions">${category && !item.archived ? '<button type="button" class="danger" id="archive-ledger-category">归档分类</button>' : ''}<button type="button" data-close>取消</button><button class="save">保存分类</button></div></form>`, 'ledger-category-modal');
  $('#archive-ledger-category')?.addEventListener('click', () => confirmDelete(`归档「${item.name}」？历史账目会保留此分类。`, async () => {
    item.archived = true; item.updatedAt = Date.now(); await save(); ledgerCategoryManager(); render();
  }));
}

function unassignedTransactionsModal() {
  const entries = (state.transactions || []).filter(item => item.type !== 'transfer' && item.accountId === 'unassigned').sort((a, b) => b.date.localeCompare(a.date));
  modal(`<div class="modal-head"><div><span class="eyebrow">LEGACY RECORDS</span><h2>补全旧账账户</h2><p>旧版账目没有账户信息，Mine 不会猜测扣减来源。逐笔选择实际账户即可。</p></div></div><div class="manage-list">${entries.map(item => `<button data-complete-unassigned="${item.id}"><span class="round-icon material-symbols-outlined">warning</span><span><strong>${esc(item.note || (ledgerCategoryMap(state)[item.category]?.label || '旧账'))}</strong><small>${item.date} · ¥${money(item.amount)}</small></span><span class="material-symbols-outlined">chevron_right</span></button>`).join('') || emptyState('已全部补全', '没有需要补全账户的旧账。')}</div><div class="modal-actions"><button type="button" data-close>完成</button></div>`, 'large-modal');
  $$('[data-complete-unassigned]').forEach(button => button.onclick = () => ledgerForm(state.transactions.find(item => item.id === button.dataset.completeUnassigned)));
}

// ---- 预算设置 ----
function ledgerBudgetForm() {
  const budget = state.settings.ledgerBudget || { total: 0, categories: {} };
  const summary = ledgerSummary(state);
  const budgetCategories = usableCategories('expense');
  const nextPeriodTitle = summary.periodEnded ? '设置下一周期' : '预算设置';
  let defaultStart = budget.start || '';
  let defaultEnd = budget.end || '';
  if (summary.periodEnded && isDate(budget.start) && isDate(budget.end)) {
    defaultStart = addDays(budget.end, 1);
    defaultEnd = addDays(budget.end, summary.daysTotal);
  }
  modal(`<form id="ledger-budget-form"><span class="eyebrow">MONTHLY BUDGET</span><h2>${nextPeriodTitle}</h2><p class="subtle">${summary.periodEnded ? '上一周期已结束，为下一周期设置预算。' : '按你的生活费发放日自定义周期，每期可设不同预算；不设则按自然月。'}</p><div class="ledger-period-head"><div><strong>预算周期</strong><small>开始与结束日期，留空按自然月</small></div></div><div class="ledger-period-fields"><div><label>开始</label><input name="start" type="date" value="${defaultStart}"></div><i>–</i><div><label>结束</label><input name="end" type="date" value="${defaultEnd}"></div></div><label>月度总预算（元）</label><input name="total" type="number" inputmode="decimal" min="0" max="9999999" step="0.01" value="${budget.total || ''}" placeholder="0 表示不设总预算"><div class="ledger-budget-cats">${budgetCategories.map(([key, cat]) => `<label class="ledger-budget-row"><span class="ledger-budget-row-icon" style="--ledger-cat-color:${cat.color}"><i class="material-symbols-outlined">${esc(cat.icon)}</i><b>${esc(cat.label)}限额</b></span><input name="cat-${esc(key)}" type="number" inputmode="decimal" min="0" max="9999999" step="0.01" value="${Number(budget.categories?.[key]) || ''}" placeholder="不限"></label>`).join('')}</div><div class="modal-actions"><button type="button" data-close>取消</button><button class="save">保存预算</button></div></form>`, 'ledger-budget-modal');
}

// ---- 快捷记账：分类切换与直接记账 ----
function bindQuickCategories() {
  $$('[data-quick-category]').forEach(button => button.onclick = () => {
    ledgerQuickCategory = button.dataset.quickCategory;
    $$('[data-quick-category]').forEach(b => b.classList.toggle('active', b === button));
  });
}

function refreshQuickCategories() {
  $$('[data-quick-type]').forEach(b => b.classList.toggle('active', b.dataset.quickType === ledgerQuickType));
  const cats = usableCategories(ledgerQuickType).slice(0, 6);
  if (!cats.some(([id]) => id === ledgerQuickCategory)) ledgerQuickCategory = cats[0]?.[0] || 'other';
  const bar = $('.ledger-quick-cats');
  if (bar) {
    bar.innerHTML = cats.map(([id, category]) => `<button type="button" data-quick-category="${esc(id)}" class="${id === ledgerQuickCategory ? 'active' : ''}" style="--ledger-cat-color:${category.color}"><span class="material-symbols-outlined">${esc(category.icon)}</span>${esc(category.label)}</button>`).join('') || '<small class="field-help">暂无分类</small>';
    bindQuickCategories();
  }
}

async function saveQuickTransaction() {
  const amount = Number($('#quick-strip-amount')?.value);
  if (!Number.isFinite(amount) || amount <= 0) return show('请输入有效金额');
  if (amount > 999999) return show('金额不能超过 999999');
  const accountId = $('#ledger-quick-account')?.value || '';
  if (!accountId) return show('请先选择账户');
  const note = ($('#quick-strip-note')?.value || '').trim();
  const next = makeTransaction({ type: ledgerQuickType, category: ledgerQuickCategory, accountId, amount, note, photo: '', date: dateKey(), createdAt: Date.now(), updatedAt: Date.now() });
  if (!next) return show('账户无效');
  state.transactions.push(next);
  state.settings.ledgerLastUsed = { accountId, category: ledgerQuickCategory, type: ledgerQuickType };
  await save();
  const amountInput = $('#quick-strip-amount');
  if (amountInput) amountInput.value = '';
  const noteInput = $('#quick-strip-note');
  if (noteInput) noteInput.value = '';
  render();
  // 餐饮类支出：顺手问一句要不要记味觉档案（用户确认才写，不自动创建）。
  if (ledgerQuickType === 'expense') offerTasteArchive(next);
  else show('已记一笔');
}

function openLedgerAnalysis() {
  const summary = ledgerSummary(state), { start, end } = summary.period, today = dateKey();
  const expenses = state.transactions.filter(item => item.type === 'expense' && item.date >= start && item.date <= end);
  const currentExpense = expenses.reduce((sum, item) => sum + item.amount, 0);
  const previousEndDate = new Date(`${start}T12:00:00`); previousEndDate.setDate(previousEndDate.getDate() - 1);
  const previousStartDate = new Date(previousEndDate); previousStartDate.setDate(previousStartDate.getDate() - summary.daysTotal + 1);
  const previousStart = dateKey(previousStartDate), previousEnd = dateKey(previousEndDate);
  const previousExpense = state.transactions.filter(item => item.type === 'expense' && item.date >= previousStart && item.date <= previousEnd).reduce((sum, item) => sum + item.amount, 0);
  const difference = currentExpense - previousExpense;
  const percentChange = previousExpense > 0 ? Math.round(difference / previousExpense * 100) : null;
  const effectiveEnd = today < start ? '' : today < end ? today : end;
  const elapsed = effectiveEnd ? Math.round((new Date(`${effectiveEnd}T12:00:00`) - new Date(`${start}T12:00:00`)) / 86400000) + 1 : 0;
  const elapsedDays = Math.min(summary.daysTotal, Math.max(0, elapsed));
  const daily = elapsedDays ? currentExpense / elapsedDays : 0, budget = summary.budgetProgress;
  const categories = Object.entries(expenses.reduce((map, item) => (map[item.category] = (map[item.category] || 0) + item.amount, map), {})).sort((a,b) => b[1] - a[1]);
  const categoryCounts = expenses.reduce((map,item)=>(map[item.category]=(map[item.category]||0)+1,map),{});
  const accountMap = new Map((state.ledgerAccounts || []).map(account=>[account.id,account]));
  const accountExpenses = Object.entries(expenses.reduce((map,item)=>(map[item.accountId]=(map[item.accountId]||0)+item.amount,map),{})).sort((a,b)=>b[1]-a[1]);
  const top = [...expenses].sort((a,b) => b.amount - a.amount).slice(0, 3);
  const compare = percentChange === null ? (currentExpense ? '上期无支出' : '暂无变化') : `${difference >= 0 ? '+' : ''}¥${money(difference)} · ${percentChange >= 0 ? '+' : ''}${percentChange}%`;
  const budgetText = !budget.total ? '尚未设置预算' : budget.spent > budget.total ? `超支 ¥${money(budget.spent - budget.total)}` : `剩余 ¥${money(budget.total - budget.spent)}`;
  const setting = state.settings.ledgerBudget || {};
  const hasCustomPeriod = isDate(setting.start) && isDate(setting.end) && setting.start === start && setting.end === end;
  const title = hasCustomPeriod ? `${start.slice(5).replace('-', '.')} – ${end.slice(5).replace('-', '.')} 支出分析` : `${start.slice(0,4)}年${Number(start.slice(5,7))}月支出分析`;
  const primary = categories[0];
  const budgetPercent = budget.total ? Math.min(100, budget.percent) : 0;
  const html = `${subpageHeader(title,{action:{html:'<span class="material-symbols-outlined">file_download</span>',id:'ledger-analysis-export'}})}<div class="subpage-body ledger-analysis-page"><section class="ledger-analysis-overview"><div id="ledger-analysis-total"><small>本期总支出额度</small><h2>¥${money(currentExpense)}</h2></div><span class="ledger-analysis-status">${budgetText}</span><div class="ledger-analysis-kpis"><div id="ledger-analysis-daily"><b>¥${money(daily)}</b><small>日均支出</small></div><div><b>${expenses.length} 笔</b><small>记账频次</small></div><div><b>${primary?esc((ledgerCategoryMap(state)[primary[0]]||LEDGER_CATEGORIES.other).label):'暂无'}</b><small>首要分类</small></div></div><div id="ledger-analysis-compare">上一同长度周期 ¥${money(previousExpense)} · ${compare}</div><div id="ledger-analysis-budget"><span>${budget.total?`预算已用 ${budget.percent}%`:'尚未设置预算'}</span><i><i style="width:${budgetPercent}%"></i></i></div></section><section id="ledger-analysis-breakdown" class="ledger-analysis-card"><h3>支出分类占比与金额</h3>${currentExpense?`<div class="expense-breakdown-bar">${categories.map(([id,amount])=>{const cat=ledgerCategoryMap(state)[id]||LEDGER_CATEGORIES.other;return `<i style="width:${amount/currentExpense*100}%;background:${cat.color}"></i>`}).join('')}</div>`:''}${categories.map(([id,amount])=>{const cat=ledgerCategoryMap(state)[id]||LEDGER_CATEGORIES.other,pct=currentExpense?Math.round(amount/currentExpense*100):0;return `<div class="ledger-analysis-row"><span>${esc(cat.label)} (${categoryCounts[id]}笔)</span><i><i style="width:${pct}%;background:${cat.color}"></i></i><b>¥${money(amount)} · ${pct}%</b></div>`}).join('')||emptyState('暂无支出分类','本期还没有支出记录。')}</section><section id="ledger-analysis-accounts" class="ledger-analysis-card"><h3>各账户支出分布</h3>${accountExpenses.map(([id,amount])=>`<div class="ledger-account-analysis-row"><span>${esc(accountMap.get(id)?.name||'已归档账户')}</span><b>-¥${money(amount)} (${currentExpense?Math.round(amount/currentExpense*100):0}%)</b></div>`).join('')||emptyState('暂无账户支出','本期还没有账户支出。')}</section><section id="ledger-analysis-top-expenses" class="ledger-analysis-card">${top.map(item=>`<div>${esc(item.note||(ledgerCategoryMap(state)[item.category]?.label||'支出'))} · ${item.date} · ${esc(accountMap.get(item.accountId)?.name||'已归档账户')} · ¥${money(item.amount)}${item.photo?' · 小票':''}</div>`).join('')||'<p>暂无重点消费</p>'}</section><section id="ledger-analysis-ai">${state.settings.aiApiKey?'<button type="button" id="ledger-ai-analysis">生成 AI 消费分析</button>':'<button type="button" id="ledger-ai-analysis">配置 AI 后生成消费分析</button>'}</section></div>`;
  callHelper('openSubpage', 'subpage-ledger-detail', html);
  const analysisLayer = $('#subpage-ledger-detail');
  const analysisTitle = $('.subpage-nav-title', analysisLayer);
  const analysisBack = $('.subpage-back-btn', analysisLayer);
  if (analysisTitle) analysisTitle.textContent = `${Number(start.slice(5, 7))}月支出深度分析`;
  if (analysisBack) analysisBack.innerHTML = '<span class="material-symbols-outlined">arrow_back</span>返回账本';
  $('#ledger-analysis-export')?.setAttribute('disabled','');
  $('#ledger-ai-analysis')?.addEventListener('click', () => { if (!state.settings.aiApiKey) return callHelper('aiSettingsForm'); const result = callHelper('aiLedgerAnalysis', { start, end, expenses }); if (!result) return show('AI 消费分析能力尚未接入'); Promise.resolve(result).catch(() => show('AI 消费分析暂不可用')); });
}

// ---- 绑定 ----
function bindLedger() {
  $('#new-transaction-head')?.addEventListener('click', () => ledgerForm());
  $('#manage-ledger-accounts-list')?.addEventListener('click', ledgerAccountManager);
  $('#toggle-ledger-accounts')?.addEventListener('click', ledgerAccountManager);
  $('#ledger-empty-account-add')?.addEventListener('click', ledgerAccountManager);
  $('#ledger-quick-save')?.addEventListener('click', () => saveQuickTransaction().catch(error => show(error.message)));
  $('#quick-strip-amount')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); saveQuickTransaction().catch(error => show(error.message)); } });
  $$('[data-quick-type]').forEach(button => button.onclick = () => { ledgerQuickType = button.dataset.quickType; refreshQuickCategories(); });
  bindQuickCategories();
  $$('[data-edit-ledger-account]').forEach(button => button.onclick = () => ledgerAccountForm(state.ledgerAccounts.find(account => account.id === button.dataset.editLedgerAccount)));
  $$('[data-calibrate-ledger-account]').forEach(button => button.onclick = () => ledgerAccountBalanceForm(state.ledgerAccounts.find(account => account.id === button.dataset.calibrateLedgerAccount)));
  $('#fix-unassigned-transactions')?.addEventListener('click', unassignedTransactionsModal);
  $('#ledger-budget-set')?.addEventListener('click', event => { event.stopPropagation(); ledgerBudgetForm(); });
  $('#ledger-budget-analysis')?.addEventListener('click', event => { event.stopPropagation(); openLedgerAnalysis(); });
  $('.ledger-budget-box')?.addEventListener('click', openLedgerAnalysis);
  $$('[data-ledger-filter]').forEach(button => button.onclick = () => { ledgerFilter = button.dataset.ledgerFilter; render(); });
  $$('[data-edit-transaction]').forEach(button => button.onclick = () => ledgerForm(state.transactions.find(item => item.id === button.dataset.editTransaction)));
  $$('[data-delete-transaction]').forEach(button => button.onclick = () => confirmDelete('删除这笔账目？', async () => { state.transactions = state.transactions.filter(item => item.id !== button.dataset.deleteTransaction); await save(); render(); }));
  $$('[data-view-transaction-photo]').forEach(button => button.onclick = () => photoViewer([state.transactions.find(item => item.id === button.dataset.viewTransactionPhoto)?.photo].filter(Boolean), 0));
}

// ---- 表单提交 ----
registerSubmitHandler('full-ledger-modal', async data => {
  const existing = state.transactions.find(item => item.id === data.get('id'));
  const amount = Number(data.get('amount'));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('金额必须大于 0');
  const accountId = data.get('accountId');
  const sourceAccountId = data.get('sourceAccountId');
  const targetAccountId = data.get('targetAccountId');
  if (pendingLedgerType === 'transfer' && (!sourceAccountId || !targetAccountId || sourceAccountId === targetAccountId)) throw new Error('请选择不同的转出和转入账户');
  if (pendingLedgerType !== 'transfer' && !accountId) throw new Error('请选择账户');
  const next = makeTransaction({ ...existing, id: existing?.id || uid(), type: pendingLedgerType, category: pendingLedgerType === 'transfer' ? '' : pendingLedgerCategory, accountId, sourceAccountId, targetAccountId, amount, note: data.get('note'), photo: pendingTransactionPhoto, date: data.get('date'), createdAt: existing?.createdAt, updatedAt: Date.now() });
  if (!next) throw new Error('转账账户无效');
  existing ? Object.assign(existing, next) : state.transactions.push(next);
  state.settings.ledgerLastUsed = { accountId: pendingLedgerType === 'transfer' ? (sourceAccountId || '') : accountId, category: pendingLedgerCategory, type: pendingLedgerType };
  ledgerVoice?.destroy();
  ledgerVoice = null;
  pendingTransactionPhoto = '';
  await save(); closeModal(); render();
  // 新建（非编辑）餐饮支出才询问；编辑旧账不重复打扰，且已有味觉档案会自动跳过。
  if (!existing && pendingLedgerType === 'expense') offerTasteArchive(next);
  else show('已保存');
  return false;
});

registerSubmitHandler('account-balance-modal', async data => {
  const account = state.ledgerAccounts.find(a => a.id === data.get('id'));
  if (!account) throw new Error('账户不存在');
  const current = ledgerSummary(state).accounts.find(a => a.id === account.id)?.balance ?? 0;
  const rawBalance = String(data.get('newBalance') ?? '').trim();
  if (!rawBalance) throw new Error('请输入有效的新余额');
  const next = Number(rawBalance);
  if (!Number.isFinite(next)) throw new Error('请输入有效的新余额');
  const accountsSnapshot = structuredClone(state.ledgerAccounts);
  const transactionsSnapshot = structuredClone(state.transactions);
  try {
    const result = callHelper('calibrateLedgerAccount', { accountId: account.id, targetBalance: next, reasonTag: data.get('reasonTag'), note: data.get('note'), generateReconciliationTx: data.get('editAccSync') === 'on', date: dateKey() });
    await save(); closeModal(); render(); show(result.calibration.difference ? '余额已校准' : '余额无需调整');
  } catch (error) {
    state.ledgerAccounts = accountsSnapshot; state.transactions = transactionsSnapshot; throw error;
  }
  return false;
});

registerSubmitHandler('ledger-account-form', async data => {
  const existing = state.ledgerAccounts.find(account => account.id === data.get('id'));
  const next = makeLedgerAccount({ ...existing, id: existing?.id || uid(), name: data.get('name'), type: data.get('type'), initialBalance: data.get('initialBalance'), sortOrder: existing?.sortOrder ?? state.ledgerAccounts.length, archived: existing?.archived, createdAt: existing?.createdAt, updatedAt: Date.now() });
  existing ? Object.assign(existing, next) : state.ledgerAccounts.push(next);
});

registerSubmitHandler('ledger-category-form', async data => {
  const existing = state.ledgerCategories.find(category => category.id === data.get('id'));
  const next = makeLedgerCategory({ ...existing, id: existing?.id || uid(), name: data.get('name'), icon: data.get('icon'), color: data.get('color'), scope: data.get('scope'), sortOrder: existing?.sortOrder ?? state.ledgerCategories.length, archived: existing?.archived, createdAt: existing?.createdAt, updatedAt: Date.now() });
  existing ? Object.assign(existing, next) : state.ledgerCategories.push(next);
});

registerSubmitHandler('merchant-rule-form', async data => {
  const previous = structuredClone(state.merchantCategoryRules || []);
  try {
    upsertMerchantCategoryRule(state, { id: data.get('id') || undefined, keyword: data.get('keyword'), categoryId: data.get('categoryId'), enabled: data.get('enabled') === 'on' });
    await save();
    ledgerMerchantRuleManager();
    show('规则已保存');
  } catch (error) { state.merchantCategoryRules = previous; throw error; }
  return false;
});

registerSubmitHandler('ledger-budget-form', async data => {
  const total = Math.max(0, Math.round(Number(data.get('total')) || 0));
  const categories = {};
  for (const [key] of usableCategories('expense')) {
    const value = Math.max(0, Math.round(Number(data.get(`cat-${key}`)) || 0));
    if (value > 0) categories[key] = value;
  }
  const start = String(data.get('start') || '').trim();
  const end = String(data.get('end') || '').trim();
  if (start && end && start > end) throw new Error('周期结束日期不能早于开始日期');
  state.settings.ledgerBudget = { ...state.settings.ledgerBudget, start, end, total, categories };
  await save(); closeModal(); render(); show('预算已保存');
  return false;
});

registerView('ledger', ledgerView);
registerBinder(bindLedger);
