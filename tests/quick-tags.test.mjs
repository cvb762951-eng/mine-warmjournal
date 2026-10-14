import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeQuickTag,
  QUICK_TAG_DEFAULTS,
  quickTagList,
  recordQuickTag,
  addQuickTag,
  removeQuickTag
} from '../quick-tags.js';

test('normalizeQuickTag: trim, 剔除前导 #/＃, 20 字上限 (CJK/emoji 安全), 空值处理', () => {
  // 空值与边界
  assert.equal(normalizeQuickTag(''), '');
  assert.equal(normalizeQuickTag(null), '');
  assert.equal(normalizeQuickTag(undefined), '');
  assert.equal(normalizeQuickTag('   '), '');
  assert.equal(normalizeQuickTag('#'), '');
  assert.equal(normalizeQuickTag('###'), '');
  assert.equal(normalizeQuickTag('＃'), '');
  assert.equal(normalizeQuickTag('＃＃＃'), '');
  assert.equal(normalizeQuickTag(' #＃# '), '');

  // trim 与剔除前导 # / ＃
  assert.equal(normalizeQuickTag('  日常生活  '), '日常生活');
  assert.equal(normalizeQuickTag('#日常生活'), '日常生活');
  assert.equal(normalizeQuickTag('＃日常生活'), '日常生活');
  assert.equal(normalizeQuickTag('###手冲咖啡'), '手冲咖啡');
  assert.equal(normalizeQuickTag('  #＃  学习心流  '), '学习心流');

  // 保留内部 '#'
  assert.equal(normalizeQuickTag('#标签#二级标签'), '标签#二级标签');
  assert.equal(normalizeQuickTag('C#编程'), 'C#编程');

  // 20 字上限（CJK 与 emoji 安全）
  const longText = '这是一个超过二十个字符非常非常长长长长长的自定义标签名称测试';
  const normText = normalizeQuickTag(longText);
  assert.equal(Array.from(normText).length, 20);
  assert.equal(normText, '这是一个超过二十个字符非常非常长长长长长');

  const emojiText = '🎉'.repeat(25);
  const normEmoji = normalizeQuickTag(emojiText);
  assert.equal(Array.from(normEmoji).length, 20);
  assert.equal(normEmoji, '🎉'.repeat(20));
});

test('quickTagList 与 addQuickTag: 去重与默认标签', () => {
  // 空 store 默认返回完整默认标签列表
  const defaultList = quickTagList();
  assert.deepEqual(defaultList, QUICK_TAG_DEFAULTS);
  assert.deepEqual(quickTagList({ items: [], hidden: [] }), QUICK_TAG_DEFAULTS);

  // addQuickTag 添加新标签，未重复添加
  let store = addQuickTag(undefined, '自定义标签1');
  assert.equal(store.items.length, 1);
  assert.equal(store.items[0].tag, '自定义标签1');
  assert.equal(store.items[0].count, 0);

  // 再次添加相同标签（含不同前导 # 与空格），必须去重
  store = addQuickTag(store, '  #自定义标签1 ');
  assert.equal(store.items.length, 1);

  // 列表包含新增标签和未包含的默认标签
  const list = quickTagList(store);
  assert.deepEqual(list, ['自定义标签1', ...QUICK_TAG_DEFAULTS]);

  // 若 store items 内已经存在某个默认标签，列表中不重复出现
  store = addQuickTag(store, '日常生活');
  const list2 = quickTagList(store);
  const dailyCount = list2.filter(t => t === '日常生活').length;
  assert.equal(dailyCount, 1);
});

test('quickTagList: 按 count 降序、再按 lastUsed 降序排列', () => {
  const store = {
    items: [
      { tag: '标签C', count: 1, lastUsed: 100 },
      { tag: '标签A', count: 5, lastUsed: 50 },
      { tag: '标签B', count: 5, lastUsed: 200 },
      { tag: '标签D', count: 2, lastUsed: 300 }
    ],
    hidden: []
  };

  const list = quickTagList(store);
  // 标签B 与 标签A count 均为 5，但 B 的 lastUsed (200) > A 的 lastUsed (50)
  // 然后是 标签D (count 2), 标签C (count 1)
  // 最后是剩下的默认标签
  assert.equal(list[0], '标签B');
  assert.equal(list[1], '标签A');
  assert.equal(list[2], '标签D');
  assert.equal(list[3], '标签C');
  assert.deepEqual(list.slice(4), QUICK_TAG_DEFAULTS);
});

test('removeQuickTag: 删除默认标签加入 hidden 并在列表中隐藏；删除自定义标签彻底移除', () => {
  // 删除默认标签 '手冲咖啡'
  let store = removeQuickTag(undefined, '手冲咖啡');
  assert.ok(store.hidden.includes('手冲咖啡'));
  assert.deepEqual(quickTagList(store), ['日常生活', '学习心流', '夏日碎影']);

  // 删除自定义标签
  store = addQuickTag(store, '临时标签');
  assert.ok(quickTagList(store).includes('临时标签'));
  store = removeQuickTag(store, '临时标签');
  assert.ok(!quickTagList(store).includes('临时标签'));
  assert.ok(!store.hidden.includes('临时标签'));
});

test('recordQuickTag: 记录已有/新标签增加 count 并更新 lastUsed；能重新找回已删除的默认标签', () => {
  // 1. 删除默认标签
  let store = removeQuickTag(undefined, '夏日碎影');
  assert.ok(!quickTagList(store).includes('夏日碎影'));
  assert.ok(store.hidden.includes('夏日碎影'));

  // 2. 重新记录 '夏日碎影'，应从 hidden 移除，并以 count=1 成为已存项
  const t1 = 1700000000000;
  store = recordQuickTag(store, '#夏日碎影', t1);
  assert.ok(!store.hidden.includes('夏日碎影'));
  const found = store.items.find(it => it.tag === '夏日碎影');
  assert.ok(found);
  assert.equal(found.count, 1);
  assert.equal(found.lastUsed, t1);
  assert.equal(quickTagList(store)[0], '夏日碎影'); // count=1 排在 count=0 的默认项之前

  // 3. 再次记录增加 count
  const t2 = 1700000001000;
  store = recordQuickTag(store, '夏日碎影', t2);
  const updated = store.items.find(it => it.tag === '夏日碎影');
  assert.equal(updated.count, 2);
  assert.equal(updated.lastUsed, t2);
});
