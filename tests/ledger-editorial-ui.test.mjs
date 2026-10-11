import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../views/ledger.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const main = source.slice(source.indexOf('export function ledgerView'), source.indexOf('function ledgerRow'));

test('Ledger reference page remains derived from real finance state', () => {
  assert.match(main, /const summary = ledgerSummary\(state\)/);
  assert.match(main, /const accounts = summary\.accounts\.filter/);
  assert.match(main, /const list = \[\.\.\.\(state\.transactions/);
  assert.match(main, /summary\.budgetProgress|budgetRow\(summary\)/);
  assert.doesNotMatch(main, /referenceFixture|demoLedger|previewLedger/);
});

test('Ledger preserves real entry budget account filter and calibration controls', () => {
  for (const id of ['new-transaction-head','ledger-quick-save','quick-strip-amount','ledger-quick-account','manage-ledger-accounts-list','ledger-budget-set','ledger-budget-analysis']) {
    assert.match(source, new RegExp(`id="${id}"|#${id}`));
  }
  assert.doesNotMatch(main, /id="new-transaction"/);
  assert.match(source, /data-quick-type="\$\{value\}"/);
  assert.match(source, /data-quick-category="\$\{esc\(id\)\}"/);
  assert.match(source, /账户内部转账/);
  assert.match(source, /不会记作收入或支出，也不会占用预算/);
  assert.match(css, /#full-ledger-modal #ledger-normal-fields\.form-hidden\{display:none!important\}/);
  assert.match(css, /ledger-type-toggle\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(source, /data-ledger-filter="\$\{id\}"/);
  assert.match(source, /data-calibrate-ledger-account="\$\{account\.id\}"/);
});

test('Ledger inputs are integrated into torn paper without nested modern cards', () => {
  const ledgerCss = css.slice(css.indexOf('/* Ledger 1:1 画报复刻'));
  assert.match(ledgerCss, /ledger-quick-amount-main[^}]*today-actions-paper-thick\.png/);
  assert.match(ledgerCss, /ledger-quick-amount-main input[^}]*border:0/);
  assert.match(ledgerCss, /ledger-quick-account-wrap select[^}]*background:transparent!important/);
  assert.match(ledgerCss, /ledger-quick-type button\.active[^}]*background-color:#174536/);
  assert.doesNotMatch(ledgerCss, /ledger-(?:source|reference|fixture)\.(?:png|jpg|webp)/);
});

test('Ledger paper hierarchy and active Dock match the selected reference', () => {
  assert.match(css, /Ledger 1:1 画报复刻/);
  assert.match(css, /ledger-overview-card[^}]*today-bento-paper-thick\.png/);
  assert.match(css, /ledger-quick-card[^}]*today-bento-paper-thick\.png/);
  assert.match(css, /ledger-accounts-section[^}]*today-bento-paper-thick\.png/);
  assert.match(css, /ledger-stream-sheet[^}]*today-bento-paper-thick\.png/);
  assert.match(css, /phone-shell:has\(\.ledger-view\) \.dock-btn\.active/);
  assert.match(main, /material-symbols-outlined">lock/);
});

test('Ledger reconciliation records use dedicated editorial vouchers', () => {
  assert.match(source, /ledger-reconcile-kicker/);
  assert.match(source, /BALANCE RECONCILIATION · 平账核销/);
  assert.match(source, /reconcile-increase/);
  assert.match(source, /reconcile-decrease/);
  assert.match(source, /const deleteLabel = isCalibrate \? '撤销' : '删除'/);
  assert.match(css, /#screen-ledger \.ledger-row\.calibrate\{[\s\S]*?secondary-content-paper-v1\.png/);
  assert.match(css, /ledger-row\.calibrate \.ledger-row-actions button\.danger\{[\s\S]*?border-radius:0[\s\S]*?background:transparent!important/);
  assert.match(css, /ledger-stream-sheet\{padding-bottom:calc\(var\(--dock-clearance\) \+ 28px\)/);
});
