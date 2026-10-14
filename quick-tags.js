/**
 * 随手拍快捷标签纯函数与默认列表
 */

export const QUICK_TAG_DEFAULTS = ['日常生活', '手冲咖啡', '学习心流', '夏日碎影'];

/**
 * 格式化标签：转字符串、trim、剔除前导 '#' 和 '＃'、再 trim、上限 20 字（Array.from 保证 CJK / emoji 安全）。
 * 若为空则返回 ''。
 */
export function normalizeQuickTag(raw) {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).trim();
  s = s.replace(/^[#＃]+/, '').trim();
  if (!s) return '';
  const chars = Array.from(s);
  if (chars.length > 20) {
    return chars.slice(0, 20).join('');
  }
  return s;
}

function normalizeStore(store) {
  if (!store || typeof store !== 'object') {
    return { items: [], hidden: [] };
  }
  let rawItems = [];
  let rawHidden = [];
  if (Array.isArray(store)) {
    rawItems = store;
  } else {
    rawItems = Array.isArray(store.items) ? store.items : [];
    rawHidden = Array.isArray(store.hidden) ? store.hidden : [];
  }

  const itemMap = new Map();
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') continue;
    const tag = normalizeQuickTag(it.tag);
    if (!tag) continue;
    const count = typeof it.count === 'number' && Number.isFinite(it.count) ? it.count : 0;
    const lastUsed = typeof it.lastUsed === 'number' && Number.isFinite(it.lastUsed) ? it.lastUsed : 0;
    if (!itemMap.has(tag)) {
      itemMap.set(tag, { tag, count, lastUsed });
    } else {
      const existing = itemMap.get(tag);
      existing.count = Math.max(existing.count, count);
      existing.lastUsed = Math.max(existing.lastUsed, lastUsed);
    }
  }

  const hidden = [];
  const seenHidden = new Set();
  for (const h of rawHidden) {
    const tag = normalizeQuickTag(h);
    if (!tag || seenHidden.has(tag)) continue;
    seenHidden.add(tag);
    hidden.push(tag);
  }

  return { items: Array.from(itemMap.values()), hidden };
}

/**
 * 获取有序标签名列表（不带 '#'）：
 * stored tags 按 count 降序、再按 lastUsed 降序；
 * 随后追加未被隐藏且尚未存在的默认标签。去重。
 */
export function quickTagList(store) {
  const { items, hidden } = normalizeStore(store);
  const hiddenSet = new Set(hidden);

  const sortedItems = [...items].sort((a, b) => {
    const countDiff = (b.count || 0) - (a.count || 0);
    if (countDiff !== 0) return countDiff;
    return (b.lastUsed || 0) - (a.lastUsed || 0);
  });

  const result = [];
  const seen = new Set();

  for (const item of sortedItems) {
    if (!seen.has(item.tag)) {
      seen.add(item.tag);
      result.push(item.tag);
    }
  }

  for (const def of QUICK_TAG_DEFAULTS) {
    const tag = normalizeQuickTag(def);
    if (tag && !hiddenSet.has(tag) && !seen.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
  }

  return result;
}

/**
 * 记录标签使用：返回新 store 对象，count+1 且 lastUsed=now。
 * 缺失则添加，并从 hidden 中移除。
 */
export function recordQuickTag(store, raw, now = Date.now()) {
  const tag = normalizeQuickTag(raw);
  const { items, hidden } = normalizeStore(store);
  if (!tag) {
    return { items: [...items], hidden: [...hidden] };
  }

  const newHidden = hidden.filter(h => h !== tag);
  const newItems = [];
  let found = false;

  for (const it of items) {
    if (it.tag === tag) {
      if (!found) {
        newItems.push({
          tag,
          count: (it.count || 0) + 1,
          lastUsed: now
        });
        found = true;
      }
    } else {
      newItems.push({ ...it });
    }
  }

  if (!found) {
    newItems.push({
      tag,
      count: 1,
      lastUsed: now
    });
  }

  return { items: newItems, hidden: newHidden };
}

/**
 * 添加自定义标签：返回新 store 对象，若不存在则添加 count: 0、lastUsed=now。去重。
 */
export function addQuickTag(store, raw, now = Date.now()) {
  const tag = normalizeQuickTag(raw);
  const { items, hidden } = normalizeStore(store);
  if (!tag) {
    return { items: [...items], hidden: [...hidden] };
  }

  const newHidden = hidden.filter(h => h !== tag);
  const newItems = [];
  let found = false;

  for (const it of items) {
    if (it.tag === tag) {
      if (!found) {
        newItems.push({ ...it });
        found = true;
      }
    } else {
      newItems.push({ ...it });
    }
  }

  if (!found) {
    newItems.push({
      tag,
      count: 0,
      lastUsed: now
    });
  }

  return { items: newItems, hidden: newHidden };
}

/**
 * 删除标签：返回新 store。从 items 剔除；若是默认标签，则加入 hidden。
 */
export function removeQuickTag(store, raw) {
  const tag = normalizeQuickTag(raw);
  const { items, hidden } = normalizeStore(store);
  if (!tag) {
    return { items: [...items], hidden: [...hidden] };
  }

  const newItems = items.filter(it => it.tag !== tag);
  const newHidden = hidden.filter(h => h !== tag);
  if (QUICK_TAG_DEFAULTS.includes(tag)) {
    newHidden.push(tag);
  }

  return { items: newItems, hidden: newHidden };
}
