// 账本 ↔ 吃喝记录联动：记了一笔餐饮账之后，问用户要不要顺手记一条吃喝记录。
//
// 设计原则（沿用项目「不替用户决定、不伪造成功」的既有风格）：
// 1. 绝不自动创建。弹窗询问，用户确认才写 state.tasteEntries。
// 2. 已为这笔账生成过记录时不重复打扰（靠 ledgerTransactionId 判重）。
// 3. 用户拒绝不算失败，不写占位、不提示错误。
// 4. 同一笔账编辑后不重复弹（金额或分类变了才给一次机会）。
//
// 2026-10-15 随「味觉档案 → 吃喝记录」升级同步：只问「吃了什么 / 哪一顿 / 什么态度」，
// 不再问星级和店名。金额不问，但**从这笔账直接带过去**（用户不必填两遍）。
import { $, state, esc, modal, closeModal, show, uid } from './core.js';
import { makeTasteEntry, TASTE_MEALS, TASTE_VERDICTS } from './model.js';

// 值得询问的分类：吃了什么 / 喝什么 / 在哪吃。纯支出类别（房租、交通）不询问。
const FOOD_CATEGORIES = new Set(['food', 'restaurant', 'snack', 'drink', 'cafe', 'takeout', 'dining']);
const MEAL_KEYS = Object.keys(TASTE_MEALS);
const VERDICT_KEYS = Object.keys(TASTE_VERDICTS);

const categoryMatchesFood = category => FOOD_CATEGORIES.has(String(category || '').toLowerCase());

const existingTasteFor = transactionId =>
  (state.tasteEntries || []).find(entry => entry.ledgerTransactionId === transactionId);

// 从备注里猜吃了什么，猜不到就留空让用户自己填 —— 不编造。
function guessNames(transaction) {
  const note = String(transaction?.note || '').trim();
  if (!note) return '';
  return note.slice(0, 40);
}

// 记账那一刻大概是哪一顿：只作为弹窗里的**默认选项**（看得见、能改），不是替用户下结论。
function defaultMealFor(transaction) {
  const stamp = Number(transaction?.createdAt) || Date.now();
  const hour = new Date(stamp).getHours();
  if (hour < 10) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

// 餐饮支出记完后调用。满足条件才弹窗，否则什么都不做。
export function offerTasteArchive(transaction) {
  if (!transaction || transaction.type !== 'expense') return false;
  if (!categoryMatchesFood(transaction.category)) return false;
  if (!transaction.id || existingTasteFor(transaction.id)) return false;
  // 只问当天与近 7 天的账：更早的账补记吃喝没有「刚才吃了什么」的现场感，容易变成流水账。
  const today = new Date();
  const age = (today.getTime() - new Date(`${transaction.date || ''}T12:00:00`).getTime()) / 86400000;
  if (!Number.isFinite(age) || age > 7 || age < -1) return false;

  const suggestedName = guessNames(transaction);
  const mealDefault = defaultMealFor(transaction);
  modal(`<form id="taste-offer-form" class="taste-offer-form">
    <span class="eyebrow">EATING LOG</span>
    <h2>顺手记进吃喝记录？</h2>
    <p class="subtle">刚才这笔餐饮已经记好了。要不要顺便留一条 —— 吃了什么、觉得怎么样。</p>
    <label>吃了什么 / 喝了什么</label>
    <input name="name" type="text" maxlength="80" value="${esc(suggestedName)}" placeholder="例如：牛肉面">
    <label>这是哪一顿</label>
    <div class="taste-meal-picker">
      ${MEAL_KEYS.map(key => `<label><input type="radio" name="meal" value="${key}" ${key === mealDefault ? 'checked' : ''}><span>${TASTE_MEALS[key].label}</span></label>`).join('')}
    </div>
    <label>对它的态度</label>
    <div class="taste-verdict-picker">
      ${VERDICT_KEYS.map(key => `<label><input type="radio" name="verdict" value="${key}" ${key === 'good' ? 'checked' : ''}><span>${TASTE_VERDICTS[key].label}</span></label>`).join('')}
    </div>
    <div class="modal-actions">
      <button type="button" data-close>不用了</button>
      <button class="save">记一条</button>
    </div>
  </form>`, 'taste-offer-modal');

  const form = $('#taste-offer-form');
  if (!form) return false;
  form.addEventListener('submit', event => {
    event.preventDefault();
    event.stopPropagation();
    const data = new FormData(form);
    const entry = makeTasteEntry({
      id: uid(),
      meal: data.get('meal'),
      name: String(data.get('name') || '').trim(),
      verdict: data.get('verdict'),
      date: transaction.date,
      notes: transaction.note || '',
      photos: transaction.photo ? [transaction.photo] : [],
      // 金额直接从这笔账带过来：用户已经在账本里填过一次，不该再让他填第二遍
      //（记一顿那边也留着「花了多少」，两边指向同一个数）。
      price: transaction.amount,
      ledgerTransactionId: transaction.id,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    if (!entry || !entry.name) { show('请先填一下吃了什么'); return; }
    if (!state.tasteEntries) state.tasteEntries = [];
    state.tasteEntries.unshift(entry);
    closeModal();
    show('已记进吃喝记录');
  }, true);
  return true;
}
