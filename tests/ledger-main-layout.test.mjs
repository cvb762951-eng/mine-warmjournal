import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../views/ledger.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('Ledger main screen keeps real summary formulas and contract IDs', () => {
  assert.match(source, /const liquidNetAssets = summary\.totalAssets - summary\.receivableBalance/);
  assert.match(source, /id="ledger-total-display"/);
  assert.match(source, /id="new-transaction-head"/);
  assert.match(source, /id="ledger-budget-set"/);
  assert.match(source, /id="ledger-budget-analysis"/);
  assert.match(source, /id="ledger-quick-account"/);
  assert.match(source, /id="quick-strip-amount"/);
  assert.match(source, /id="ledger-quick-save"/);
  assert.match(source, /id="quick-strip-note"/);
  assert.match(source, /id="acc-display-\$\{esc\(account\.id\)\}"/);
});

test('Ledger quick entry uses the approved three-level editorial structure', () => {
  assert.match(source, /class="ledger-quick-head"/);
  assert.match(source, /class="ledger-quick-strip"[\s\S]*id="quick-strip-amount"[\s\S]*id="ledger-quick-save"/);
  assert.match(source, /class="ledger-quick-secondary"[\s\S]*id="ledger-quick-account"[\s\S]*class="ledger-quick-type"/);
  assert.match(source, /class="ledger-quick-cats" id="quick-cat-strip"/);
  assert.match(source, /const note = \(\$\('#quick-strip-note'\)/);
  assert.match(source, /makeTransaction\(\{ type: ledgerQuickType[\s\S]*note,/);
  assert.match(css, /#screen-ledger \.ledger-quick-strip \{[^}]*grid-template-columns:minmax\(0,1fr\) 88px/);
  assert.match(css, /#screen-ledger \.ledger-quick-cats \{[^}]*overflow-x:auto/);
});

test('Ledger account rail renders every active account without nesting controls', () => {
  assert.match(source, /const accountCards = accounts\.map\(\(account, index\) =>/);
  assert.doesNotMatch(source, /const accountCards = accounts\.slice/);
  assert.match(source, /class="ledger-accounts-track">\$\{accountCards\}/);
  assert.match(source, /data-edit-ledger-account="\$\{account\.id\}"/);
  assert.match(source, /data-calibrate-ledger-account="\$\{account\.id\}"/);
  assert.match(source, /id="toggle-ledger-accounts"/);
  assert.match(source, /id="manage-ledger-accounts-list"/);
  assert.match(css, /#screen-ledger \.ledger-accounts-track \{[^}]*display:flex[^}]*overflow-x:auto/);
  assert.match(css, /#screen-ledger \.account-mini-card \{[^}]*flex-direction:column/);
});

test('Ledger budget copy exposes no-budget, ended, warning and real overspend states', () => {
  assert.match(source, /还没有设置预算/);
  assert.match(source, /周期已结束/);
  assert.match(source, /超支 ¥\$\{money\(Math\.abs\(delta\)\)\}/);
  assert.match(source, /const tone = budgetTone\(budget\.percent\)/);
  assert.doesNotMatch(source.slice(source.indexOf('function budgetRow'), source.indexOf('function ledgerDayGroup')), /Math\.max\(0, budget\.total - budget\.spent\)/);
});

test('Ledger page contains a distinct warm paper Expense Streams sheet', () => {
  assert.match(source, /class="stream-sheet ledger-stream-sheet"/);
  assert.match(source, /Expense Streams/);
  assert.match(source, /data-ledger-filter/);
  assert.match(source, /本地加密储存/);
  assert.match(css, /#screen-ledger \.ledger-stream-sheet \{[^}]*border-radius:30px 30px 0 0[^}]*background:rgba\(255,254,251,\.9\)/);
  assert.match(css, /#screen-ledger \{[^}]*overflow-x:clip/);
  assert.doesNotMatch(source.slice(source.indexOf('class="stream-sheet ledger-stream-sheet"'), source.indexOf('function ledgerRow')), /id="new-transaction"/);
  assert.match(css, /ledger-budget-meter-v1\.png/);
});

test('Ledger keeps category tabs inside the paper and separates budget copy from its meter', () => {
  const finalCss = css.slice(css.indexOf('/* 2026-09-09 browser comments final lock'));
  assert.match(finalCss, /#screen-ledger \.ledger-toolbar\{[\s\S]*?max-width:100%[\s\S]*?overflow:hidden/);
  assert.match(finalCss, /#screen-ledger \.ledger-toolbar \.ledger-tabs\{[\s\S]*?overflow-x:auto/);
  assert.match(finalCss, /#screen-ledger \.ledger-budget-head\{[\s\S]*?padding-bottom:15px/);
  assert.match(finalCss, /#screen-ledger \.ledger-stream-sheet\{[\s\S]*?background-repeat:repeat!important/);
  assert.match(finalCss, /#screen-ledger \.ledger-stream-sheet::after/);
  assert.match(finalCss, /#screen-ledger \.ledger-budget-box\{[\s\S]*?min-height:112px/);
});
