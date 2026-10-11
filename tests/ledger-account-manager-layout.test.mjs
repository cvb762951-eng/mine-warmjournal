import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../views/ledger.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('Ledger account manager owns semantic row, copy and balance classes', () => {
  assert.match(source, /class="manage-list ledger-account-manage-list"/);
  assert.match(source, /class="ledger-account-manage-row\$\{account\.archived \? ' done' : ''\}"/);
  assert.match(source, /class="ledger-account-manage-copy"/);
  assert.match(source, /class="ledger-account-manage-balance">¥\$\{money\(account\.balance\)\}/);
});

test('Ledger account manager replaces the generic icon column with a bounded balance track', () => {
  const row = css.match(/\.ledger-account-manage-list>\.ledger-account-manage-row\s*\{([^}]+)\}/)?.[1] || '';
  const balance = css.match(/\.ledger-account-manage-balance\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(row, /grid-template-columns:38px minmax\(0,1fr\) minmax\(72px,max-content\)/);
  assert.match(row, /overflow:hidden/);
  assert.match(balance, /max-width:120px/);
  assert.match(balance, /font-variant-numeric:tabular-nums/);
  assert.match(balance, /text-align:right/);
  assert.match(balance, /text-overflow:ellipsis/);
  assert.match(balance, /white-space:nowrap/);
});

test('Ledger account copy can shrink and long names ellipsize without moving the balance', () => {
  assert.match(css, /\.ledger-account-manage-copy \{[^}]*min-width:0/);
  assert.match(css, /\.ledger-account-manage-copy strong,\.ledger-account-manage-copy small \{[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/);
  assert.match(css, /@media\(max-width:370px\)\{\.ledger-account-manage-list>\.ledger-account-manage-row\{[^}]*minmax\(68px,max-content\)/);
});
