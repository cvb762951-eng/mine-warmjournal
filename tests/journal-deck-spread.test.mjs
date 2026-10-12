import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('「过往篇章」并入牌组摊开：打开走 openPastJournal，不跳日历；编辑/删除复用原有路径', async () => {
  const journal = await read('views/journal.js');
  const app = await read('app.js');
  const motion = await read('motion.js');
  assert.doesNotMatch(journal, /journal-history-title">过往篇章/, '过往篇章入口应已移除');
  const spread = journal.slice(journal.indexOf('spread: {'), journal.indexOf('spread: {') + 400);
  assert.match(spread, /onOpen: model => openPastJournal\(model\.id\)/);
  assert.match(spread, /onEdit: model => editPastJournal\(model\.id\)/);
  assert.match(spread, /onDelete: model => deletePastJournal\(model\.id\)/);
  assert.match(spread, /onSearch: \(\) => journalHistory\(\)/);
  assert.doesNotMatch(spread, /go\('calendar'/);
  const del = journal.slice(journal.indexOf('function deletePastJournal'), journal.indexOf('function onPastJournalClick'));
  assert.match(del, /confirmDelete\('删除这篇日记？'/);
  const edit = journal.slice(journal.indexOf('function editPastJournal'), journal.indexOf('function deletePastJournal'));
  assert.match(edit, /stageJournalScreenDraft\(journalEditingDay\)/);
  assert.doesNotMatch(edit, /calendar/);
  // #12：data-open-journal 的全局兜底仍不跳日历
  assert.doesNotMatch(app, /closest\('\[data-open-journal\]'\)[\s\S]{0,280}go\('calendar'/);
  // 摊开：月份快速跳转、懒加载缩略图、共用照片框、减少动态
  assert.match(motion, /journal-deck-spread-months/);
  assert.match(motion, /section\?\.scrollIntoView\(\{ block: 'start'/);
  assert.match(motion, /new IntersectionObserver/);
  assert.match(motion, /photoFrameLayers\(/);
  assert.match(motion, /const fanOut = deckRect => \{\n    if \(reduced\(\) \|\| !deckRect\?\.width\) return;/);
  assert.doesNotMatch(motion.slice(motion.indexOf('function createDeckSpread'), motion.indexOf('const journalDecks')), /filter:/);
});
