import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLedgerReply, parseVisionLedgerReply } from './generate.js';

const state = { ledgerCategories: [], merchantCategoryRules: [{ keyword: 'steam', categoryId: 'game', enabled: true }] };

test('AI ledger categories, rules, unknowns, and transfers stay safe', () => {
  assert.equal(parseLedgerReply('{"isLedger":true,"type":"expense","category":"ai","amount":20,"note":"模型订阅"}', state).category, 'ai');
  assert.equal(parseLedgerReply('{"isLedger":true,"type":"expense","category":"entertainment","amount":30,"note":"麻将馆"}', state).category, 'entertainment');
  assert.equal(parseLedgerReply('{"isLedger":true,"type":"expense","category":"game","amount":6,"note":"游戏币"}', state).category, 'game');
  assert.equal(parseLedgerReply('{"isLedger":true,"type":"expense","category":"restaurant","amount":8,"note":"Steam"}', state).category, 'game');
  assert.equal(parseVisionLedgerReply('{"isBill":true,"bill":{"type":"expense","category":"mystery","amount":8,"note":"未知商户"}}', state).bill.category, 'other');
  assert.equal(parseLedgerReply('{"isLedger":true,"type":"transfer","amount":100,"note":"外借"}', state).type, 'transfer');
  assert.equal(parseLedgerReply('{"isLedger":true,"type":"transfer","amount":100,"note":"归还"}', state).type, 'transfer');
});
