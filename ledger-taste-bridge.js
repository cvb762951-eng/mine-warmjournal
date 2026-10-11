// 账本 ↔ 味觉档案联动：记了一笔餐饮账之后，问用户要不要顺手记一条味觉档案。
//
// 设计原则（沿用项目「不替用户决定、不伪造成功」的既有风格）：
// 1. 绝不自动创建。弹窗询问，用户确认才写 state.tasteEntries。
// 2. 已为这笔账生成过味觉档案时不重复打扰（靠 ledgerTransactionId 判重）。
// 3. 用户拒绝不算失败，不写占位、不提示错误。
// 4. 同一笔账编辑后不重复弹（金额或分类变了才给一次机会）。
import { $, state, esc, modal, closeModal, show, uid } from './core.js';
import { makeTasteEntry } from './model.js';

// 值得询问的分类：吃了什么 / 喝什么 / 在哪吃。纯支出类别（房租、交通）不询问。
const FOOD_CATEGORIES = new Set(['food', 'restaurant', 'snack', 'drink', 'cafe', 'takeout', 'dining']);

const categoryMatchesFood = category => FOOD_CATEGORIES.has(String(category || '').toLowerCase());

const existingTasteFor = transactionId =>
  (state.tasteEntries || []).find(entry => entry.ledgerTransactionId === transactionId);

// 从备注里猜店名/吃了什么，猜不到就留空让用户自己填 —— 不编造。
function guessNames(transaction) {
  const note = String(transaction?.note || '').trim();
  if (!note) return { name: '', placeName: '' };
  return { name: note.slice(0, 40), placeName: '' };
}

// 餐饮支出记完后调用。满足条件才弹窗，否则什么都不做。
export function offerTasteArchive(transaction) {
  if (!transaction || transaction.type !== 'expense') return false;
  if (!categoryMatchesFood(transaction.category)) return false;
  if (!transaction.id || existingTasteFor(transaction.id)) return false;
  // 只问当天与近 7 天的账：更早的账补记味觉没有「刚才吃了什么」的现场感，容易变成流水账。
  const today = new Date();
  const age = (today.getTime() - new Date(`${transaction.date || ''}T12:00:00`).getTime()) / 86400000;
  if (!Number.isFinite(age) || age > 7 || age < -1) return false;

  const { name, placeName } = guessNames(transaction);
  const suggestedName = name || '这道菜';
  modal(`<form id="taste-offer-form" class="taste-offer-form">
    <span class="eyebrow">TASTE ARCHIVE</span>
    <h2>顺手记一条味觉档案？</h2>
    <p class="subtle">刚才这笔餐饮已经记好了。要不要顺便留个味觉记忆 —— 好不好吃、值不值得再去。</p>
    <label>吃了什么</label>
    <input name="name" type="text" maxlength="80" value="${esc(suggestedName)}" placeholder="例如：牛肉面">
    <label>在哪吃的<small class="field-help">留空也可以，之后能补</small></label>
    <input name="placeName" type="text" maxlength="80" value="${esc(placeName)}" placeholder="例如：老王家面馆">
    <label>好吃程度</label>
    <div class="taste-star-row" id="taste-offer-rating">
      ${[1, 2, 3, 4, 5].map(n => `<label class="taste-star"><input type="radio" name="rating" value="${n}" ${n === 4 ? 'checked' : ''}><span>${'★'.repeat(n)}</span></label>`).join('')}
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
      type: 'dish',
      name: String(data.get('name') || '').trim(),
      placeName: String(data.get('placeName') || '').trim(),
      date: transaction.date,
      rating: Number(data.get('rating')) || 0,
      price: transaction.amount,
      notes: transaction.note || '',
      photo: transaction.photo || '',
      photos: transaction.photo ? [transaction.photo] : [],
      ledgerTransactionId: transaction.id,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    if (!entry || !entry.name) { show('请先填一下吃了什么'); return; }
    if (!state.tasteEntries) state.tasteEntries = [];
    state.tasteEntries.unshift(entry);
    closeModal();
    show('已记入味觉档案');
  }, true);
  return true;
}
