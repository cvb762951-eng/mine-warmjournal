import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { makeDefaultState, makeTransaction } from '../model.js';

const source = await readFile(new URL('../views/ledger.js', import.meta.url), 'utf8');

test('Ledger monetary inputs accept cents in every entry path', () => {
  assert.equal((source.match(/step="0\.01"/g) || []).length, 6);
  assert.doesNotMatch(source, /(?:quick-strip-amount|modal-amount-input|initialBalance|newBalance|name="total"|name="cat-[^\"]+")[^>]*step="1"/);
});

test('Ledger model preserves two decimal places instead of truncating cents', () => {
  const state = makeDefaultState(new Date('2026-09-04T12:00:00'));
  const accountId = state.ledgerAccounts[0].id;
  assert.equal(makeTransaction({ type: 'expense', category: 'restaurant', accountId, amount: 12.34 }).amount, 12.34);
  assert.equal(makeTransaction({ type: 'expense', category: 'restaurant', accountId, amount: 12.345 }).amount, 12.35);
});
