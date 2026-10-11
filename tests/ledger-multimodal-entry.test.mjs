import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../views/ledger.js', import.meta.url), 'utf8');
const functionSource = source.match(/async function recognizeLedgerPhoto\(\)\s*\{[\s\S]*?\r?\n\}\r?\n\r?\nfunction ledgerCategoryManager/)?.[0]
  ?.replace(/\r?\n\r?\nfunction ledgerCategoryManager[\s\S]*$/, '') || '';

function recognitionHarness({ aiApiKey = '', visionApiKey = '', response, failure } = {}) {
  const calls = [];
  const notices = [];
  const settings = { opened: 0 };
  const transactions = [{ id: 'existing', amount: 12 }];
  const button = {
    disabled: false,
    textContent: 'AI 识别小票',
    isConnected: true,
    insertAdjacentHTML() {}
  };
  const inputs = {
    '#recognize-ledger-photo': button,
    '#modal-amount-input': { value: '' },
    '#modal-date-input': { value: '' },
    '#modal-note-input': { value: '' }
  };
  const callHelper = async (name, payload) => {
    calls.push({ name, payload });
    if (name === 'aiSettingsForm') { settings.opened += 1; return; }
    if (name === 'aiRecognizeLedgerImage') {
      if (failure) throw failure;
      return response || { amount: 18, category: 'restaurant', confidence: 0.8 };
    }
  };
  const factory = new Function(
    'state', 'pendingTransactionPhoto', 'pendingLedgerType', 'show', 'callHelper', '$', '$$', 'usableCategories',
    `${functionSource}; return recognizeLedgerPhoto;`
  );
  const recognize = factory(
    { settings: { aiApiKey, visionApiKey }, transactions },
    'data:image/png;base64,LOCAL_TEST_ONLY',
    'expense',
    message => notices.push(message),
    callHelper,
    selector => inputs[selector] || null,
    () => [],
    () => [['restaurant', { label: '餐饮' }]]
  );
  return { recognize, calls, notices, settings, transactions, button };
}

test('Ledger receipt recognition accepts unified aiApiKey when legacy vision key is empty', async () => {
  const harness = recognitionHarness({ aiApiKey: 'unified-key', visionApiKey: '' });
  await harness.recognize();
  assert.equal(harness.calls.filter(item => item.name === 'aiRecognizeLedgerImage').length, 1);
  assert.equal(harness.settings.opened, 0);
  assert.equal(harness.button.textContent, 'AI 识别小票');
});

test('Ledger receipt recognition without aiApiKey makes zero recognition requests and opens settings', async () => {
  const harness = recognitionHarness({ aiApiKey: '', visionApiKey: 'ignored-legacy-key' });
  await harness.recognize();
  assert.equal(harness.calls.filter(item => item.name === 'aiRecognizeLedgerImage').length, 0);
  assert.equal(harness.settings.opened, 1);
  assert.deepEqual(harness.notices, ['请先配置支持图片的AI模型']);
});

test('Ledger receipt failure is attempted once and never writes a transaction', async () => {
  const harness = recognitionHarness({ aiApiKey: 'unified-key', failure: new Error('识别失败') });
  const before = structuredClone(harness.transactions);
  await assert.rejects(harness.recognize(), /识别失败/);
  assert.equal(harness.calls.filter(item => item.name === 'aiRecognizeLedgerImage').length, 1);
  assert.deepEqual(harness.transactions, before);
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.textContent, 'AI 识别小票');
});

test('Ledger page open and photo refresh do not auto-trigger recognition', () => {
  const refreshBody = source.match(/function refreshLedgerPhotoPreview\(\)\s*\{[\s\S]*?\r?\n\}\r?\n\r?\n\/\/ ---- 账户/)?.[0] || '';
  assert.doesNotMatch(refreshBody, /aiRecognizeLedgerImage/);
  assert.match(source, /#recognize-ledger-photo'\)\?\.addEventListener\('click'/);
  assert.equal((functionSource.match(/aiRecognizeLedgerImage/g) || []).length, 1);
});

test('Ledger receipt entry contains no legacy vision configuration or wording', () => {
  assert.doesNotMatch(source, /visionApiKey|视觉模型/);
  assert.match(source, /点击后将发送到你配置的AI模型，仅用于生成记账建议/);
});
