import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { makeDefaultState, migrateState, SCHEMA_VERSION, ledgerSummary, archiveLedgerAccount, upsertMerchantCategoryRule } from '../model.js';
import { rebuildActivityLog } from '../activity-log.js';
import { buildAiChatMessages, matchMerchantCategoryRule } from '../ai/generate.js';

const root = new URL('../', import.meta.url);
const source = async path => readFile(new URL(path, root), 'utf8');
const coreSource = await source('core.js');
const storageSource = await source('storage.js');
const mediaSource = await source('media-store.js');
// 运行真实模块实现，只替换设备 IO；不需要连接手机或触碰用户数据库。
function runModule(code, context, exports) {
  vm.runInContext(code.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + `\nObject.assign(globalThis, {${exports.join(',')}});`, context);
}

test('保存被拒绝时通知用户、拒绝成功承诺，且队列可在下一次保存恢复', async () => {
  let writes = 0, cleans = 0;
  const notices = [];
  const context = vm.createContext({ state: {}, saveQueue: Promise.resolve(), structuredClone, $: () => ({}), show: text => notices.push(text), externalizeStateMedia: async () => {}, persistState: async () => ++writes > 1, protectedSnapshotMediaReferences: async () => [], stateMediaReferences: () => [], removeUnusedMedia: async () => { cleans++; } });
  vm.runInContext(coreSource.match(/export const save = \(\) => \{[\s\S]*?\n\};/)[0].replace('export const save', 'globalThis.save'), context);
  await assert.rejects(context.save(), /数据尚未保存/);
  assert.equal(cleans, 0);
  assert.ok(notices[0].includes('保存失败'));
  await context.save();
  assert.equal(cleans, 1);
});

test('异步保存期间的编辑不能删除已落库引用或新加入的媒体', async () => {
  let cleanupState, protectedRefs;
  const context = vm.createContext({ state: { photo: 'mine-media://old.jpg' }, saveQueue: Promise.resolve(), structuredClone, $: () => null, externalizeStateMedia: async () => {}, persistState: async snapshot => { context.state.photo = 'mine-media://new.jpg'; assert.equal(snapshot.photo, 'mine-media://old.jpg'); return true; }, protectedSnapshotMediaReferences: async () => ['mine-media://snapshot.jpg'], stateMediaReferences: s => [s.photo], removeUnusedMedia: async (s, refs) => { cleanupState = s; protectedRefs = refs; } });
  vm.runInContext(coreSource.match(/export const save = \(\) => \{[\s\S]*?\n\};/)[0].replace('export const save', 'globalThis.save'), context);
  await context.save();
  assert.equal(cleanupState.photo, 'mine-media://old.jpg');
  assert.ok(protectedRefs.includes('mine-media://new.jpg'));
  assert.ok(protectedRefs.includes('mine-media://snapshot.jpg'));
});

test('密钥跳过时保存成功、照常清理媒体，并安排重试提示', async () => {
  let cleaned = 0;
  let noted = null;
  const context = vm.createContext({ state: {}, saveQueue: Promise.resolve(), structuredClone, $: () => ({}), show: () => {}, externalizeStateMedia: async () => {}, persistState: async () => 'key-skipped', protectedSnapshotMediaReferences: async () => [], stateMediaReferences: () => [], removeUnusedMedia: async () => { cleaned++; }, notifyPersistedKeySeal: result => { noted = result; } });
  vm.runInContext(coreSource.match(/export const save = \(\) => \{[\s\S]*?\n\};/)[0].replace('export const save', 'globalThis.save'), context);
  await context.save();
  assert.equal(cleaned, 1);
  assert.equal(noted, 'key-skipped');
});

test('数据库已提交后清理失败不冒充保存失败', async () => {
  const notices = [];
  const context = vm.createContext({ state: {}, saveQueue: Promise.resolve(), structuredClone, console: { warn() {} }, $: () => ({}), show: message => notices.push(message), externalizeStateMedia: async () => {}, persistState: async () => true, protectedSnapshotMediaReferences: async () => { throw new Error('快照读取失败'); }, stateMediaReferences: () => [], removeUnusedMedia: async () => assert.fail('无法读取保护引用时不应清理') });
  vm.runInContext(coreSource.match(/export const save = \(\) => \{[\s\S]*?\n\};/)[0].replace('export const save', 'globalThis.save'), context);
  await context.save();
  assert.equal(notices.length, 0);
});

function storageHarness({ native = true } = {}) {
  const rows = new Map();
  let pending, failEncryption = false, failWrite = false, seals = 0;
  const database = { open: async () => {}, execute: async sql => { assert.ok(!sql.includes('DELETE FROM state_sections'), '不能先清空原库'); }, query: async () => ({ values: [] }), beginTransaction: async () => { pending = new Map(rows); }, run: async (sql, params) => { if (sql.startsWith('INSERT INTO state_sections')) { if (failWrite) throw new Error('磁盘写入失败'); pending.set(params[0], params[1]); } }, commitTransaction: async () => { rows.clear(); for (const [k, v] of pending) rows.set(k, v); }, rollbackTransaction: async () => { pending = null; } };
  const context = vm.createContext({ Capacitor: { isNativePlatform: () => native, getPlatform: () => 'android' }, CapacitorSQLite: {}, SQLiteConnection: class { async checkConnectionsConsistency() { return { result: false }; } async isConnection() { return { result: false }; } async createConnection() { return database; } }, migrateState, SCHEMA_VERSION, rebuildActivityLog, structuredClone, console: { warn() {} }, localStorage: { getItem: () => rows.get('browser') ?? null, setItem: (_, value) => rows.set('browser', value) }, sealApiKey: async key => { seals++; if (failEncryption) throw new Error('插件不可用'); return `encrypted:${key}`; }, openApiKey: async key => key, isEncryptedKey: key => String(key).startsWith('encrypted:') });
  runModule(storageSource, context, ['initializeStorage', 'persistState', 'replaceState', 'blockStorageWrites']);
  return { context, rows, failEncryption: value => { failEncryption = value !== false; }, failWrite: () => { failWrite = true; }, seals: () => seals };
}

test('Android 数据库未就绪时禁止退回浏览器存储', async () => {
  const h = storageHarness();
  await assert.rejects(h.context.persistState(makeDefaultState()), /数据库尚未就绪/);
  assert.equal(h.rows.size, 0);
});

test('启动加载失败后保护模式禁止继续写入已有数据库', async () => {
  const h = storageHarness();
  await h.context.initializeStorage(makeDefaultState());
  const before = [...h.rows];
  h.context.blockStorageWrites();
  await assert.rejects(h.context.persistState(makeDefaultState()), /已停止保存/);
  assert.deepEqual([...h.rows], before);
});

test('事务写入失败时，恢复不能清空原始记录', async () => {
  const h = storageHarness();
  await h.context.initializeStorage(makeDefaultState());
  const before = [...h.rows];
  const next = makeDefaultState();
  next.journals['2026-10-08'] = { content: '新记录', photos: [] };
  h.failWrite();
  await assert.rejects(h.context.replaceState(next), /磁盘写入失败/);
  assert.deepEqual([...h.rows], before);
});

test('密钥加密失败时仍保存日记账本速记，保留已有密文且不写入明文', async () => {
  const h = storageHarness();
  await h.context.initializeStorage(makeDefaultState());
  const seeded = makeDefaultState();
  seeded.settings.aiApiKey = 'old-secret';
  seeded.journals['2026-10-01'] = { content: '旧日记', photos: [] };
  assert.equal(await h.context.persistState(seeded), true);
  const habitsBefore = h.rows.get('habits');
  h.failEncryption();
  const next = makeDefaultState();
  next.settings.aiApiKey = 'new-secret';
  next.journals['2026-10-01'] = { content: '旧日记', photos: [] };
  next.journals['2026-10-11'] = { content: '新日记', photos: [] };
  next.snippets = [{ id: 's1', text: '速记还在' }];
  next.transactions = [{ id: 't1', amount: 12 }];
  assert.equal(await h.context.replaceState(next), 'key-skipped');
  assert.equal(JSON.parse(h.rows.get('journals'))['2026-10-11'].content, '新日记');
  assert.equal(JSON.parse(h.rows.get('journals'))['2026-10-01'].content, '旧日记');
  assert.equal(JSON.parse(h.rows.get('snippets'))[0].text, '速记还在');
  assert.equal(JSON.parse(h.rows.get('transactions'))[0].amount, 12);
  assert.equal(h.rows.get('habits'), habitsBefore);
  assert.equal(JSON.parse(h.rows.get('settings')).aiApiKey, 'encrypted:old-secret');
  assert.equal(JSON.stringify([...h.rows]).includes('new-secret'), false);
  assert.equal(next.settings.aiApiKey, 'new-secret');
  h.failEncryption(false);
  assert.equal(await h.context.persistState(next), true);
  assert.equal(JSON.parse(h.rows.get('settings')).aiApiKey, 'encrypted:new-secret');
});

test('没有旧密文时加密失败会跳过密钥再保存内容', async () => {
  const h = storageHarness();
  await h.context.initializeStorage(makeDefaultState());
  h.failEncryption();
  const next = makeDefaultState();
  next.settings.aiApiKey = 'plain-secret';
  next.journals['2026-10-11'] = { content: '仍应保存', photos: [] };
  assert.equal(await h.context.persistState(next), 'key-skipped');
  const settings = JSON.parse(h.rows.get('settings'));
  assert.equal(settings.aiApiKey, undefined);
  assert.equal(JSON.parse(h.rows.get('journals'))['2026-10-11'].content, '仍应保存');
  assert.equal(JSON.stringify([...h.rows]).includes('plain-secret'), false);
  assert.equal(next.settings.aiApiKey, 'plain-secret');
});

test('浏览器密钥加密失败仍保存内容，且不把明文写入 localStorage', async () => {
  const h = storageHarness({ native: false });
  const state = makeDefaultState();
  state.settings.aiApiKey = 'secret-key';
  state.journals['2026-10-11'] = { content: '日记还在', photos: [] };
  state.transactions = [{ id: 't1', amount: 8 }];
  h.failEncryption();
  assert.equal(await h.context.persistState(state), 'key-skipped');
  const saved = JSON.parse(h.rows.get('browser'));
  assert.equal(saved.journals['2026-10-11'].content, '日记还在');
  assert.equal(saved.transactions[0].amount, 8);
  assert.equal(saved.settings.aiApiKey, undefined);
  assert.equal(JSON.stringify(saved).includes('secret-key'), false);
  assert.equal(state.settings.aiApiKey, 'secret-key');
});

test('浏览器保存密钥只加密一次，存储内容没有明文密钥', async () => {
  const h = storageHarness({ native: false });
  const state = makeDefaultState();
  state.settings.aiApiKey = 'secret-key';
  assert.equal(await h.context.persistState(state), true);
  assert.equal(h.seals(), 1);
  assert.equal(JSON.parse(h.rows.get('browser')).settings.aiApiKey, 'encrypted:secret-key');
  assert.equal(state.settings.aiApiKey, 'secret-key');
});

function trashHarness() {
  let now = new Date('2026-10-08T12:00:00Z').getTime();
  const files = new Map([['MineWarmJournalMedia/old.mp4', { type: 'file', mtime: now - 30 * 86400000 }]]);
  let failMove = false;
  const fs = { mkdir: async () => {}, rename: async ({ from, to }) => { if (failMove) throw new Error('文件占用'); const f = files.get(from); if (!f || files.has(to)) throw new Error('无法移动'); files.set(to, f); files.delete(from); }, readdir: async ({ path }) => ({ files: [...files].filter(([key]) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/')).map(([key, f]) => ({ name: key.slice(path.length + 1), type: f.type })) }), stat: async ({ path }) => files.get(path), deleteFile: async ({ path }) => files.delete(path) };
  const context = vm.createContext({ Capacitor: { isNativePlatform: () => true }, Filesystem: fs, Directory: { Data: 'data' }, NativeMediaStore: {}, Date: class extends Date { static now() { return now; } } });
  runModule(mediaSource, context, ['removeUnusedMedia']);
  return { files, context, advance: days => { now += days * 86400000; }, failMove: () => { failMove = true; } };
}

test('很久以前的媒体进入回收站后仍完整保留七天', async () => {
  const h = trashHarness();
  await h.context.removeUnusedMedia(makeDefaultState());
  assert.equal(h.files.size, 1);
  assert.ok([...h.files.keys()][0].includes('/.trash/'));
  h.advance(6.99);
  await h.context.removeUnusedMedia(makeDefaultState());
  assert.equal(h.files.size, 1);
  h.advance(0.02);
  await h.context.removeUnusedMedia(makeDefaultState());
  assert.equal(h.files.size, 0);
});

test('旧版回收站文件从首次观察起保留七天，移动失败保留原件', async () => {
  const legacy = trashHarness();
  legacy.files.set('MineWarmJournalMedia/.trash/legacy.mp4', { type: 'file', mtime: 1 });
  await legacy.context.removeUnusedMedia(makeDefaultState());
  assert.equal(legacy.files.size, 2);
  assert.ok([...legacy.files.keys()].some(key => /\d{13}--legacy.mp4$/.test(key)));
  const failed = trashHarness();
  failed.failMove();
  await failed.context.removeUnusedMedia(makeDefaultState());
  assert.ok(failed.files.has('MineWarmJournalMedia/old.mp4'));
});

test('仍被状态或安全快照引用的媒体不进入回收站', async () => {
  const h = trashHarness();
  await h.context.removeUnusedMedia(makeDefaultState(), ['mine-media://old.mp4']);
  assert.ok(h.files.has('MineWarmJournalMedia/old.mp4'));
});

test('非零余额拒绝归档，旧归档应收不混入资产口径，账户可恢复', () => {
  const state = makeDefaultState();
  state.ledgerAccounts = [{ id: 'cash', type: 'cash', initialBalance: 100, archived: false }, { id: 'loan', type: 'receivable', initialBalance: 50, archived: true }];
  assert.throws(() => archiveLedgerAccount(state, 'cash'), /余额尚未归零/);
  assert.equal(state.ledgerAccounts[0].archived, false);
  const totals = ledgerSummary(state);
  assert.equal(totals.totalAssets, 100);
  assert.equal(totals.receivableBalance, 0);
  archiveLedgerAccount(state, 'loan', false);
  assert.equal(ledgerSummary(state).receivableBalance, 50);
  state.ledgerAccounts[0].initialBalance = 0;
  archiveLedgerAccount(state, 'cash');
  assert.equal(state.ledgerAccounts[0].archived, true);
});

test('商户规则可新增、编辑和停用，拒绝重复与已归档分类', () => {
  const state = makeDefaultState();
  const rule = upsertMerchantCategoryRule(state, { keyword: '  SHOP  ', categoryId: 'restaurant' });
  assert.equal(matchMerchantCategoryRule(state, 'Shop午餐').id, rule.id);
  assert.throws(() => upsertMerchantCategoryRule(state, { keyword: 'shop', categoryId: 'other' }), /已有规则/);
  upsertMerchantCategoryRule(state, { id: rule.id, categoryId: 'other' });
  assert.equal(matchMerchantCategoryRule(state, 'SHOP').categoryId, 'other');
  upsertMerchantCategoryRule(state, { id: rule.id, enabled: false });
  assert.equal(matchMerchantCategoryRule(state, 'SHOP'), null);
  state.ledgerCategories.push({ id: 'custom', name: '旧分类', archived: true });
  state.merchantCategoryRules.push({ id: 'old', keyword: 'legacy', categoryId: 'custom', enabled: true });
  assert.equal(matchMerchantCategoryRule(state, 'legacy'), null);
  assert.throws(() => upsertMerchantCategoryRule(state, { keyword: 'new', categoryId: 'custom' }), /可用的分类/);
});

const classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, documentElement: { classList }, body: { classList } };
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { setState, callHelper } = await import('../core.js');
const { updateAiMemory, aiMessagesForModel, persistAiHistory } = await import('../views/ai.js');

test('旧对话未知时间，新对话时间在发送、保存及重启迁移中保持一致', () => {
  const old = makeDefaultState();
  old.aiHistory = [{ role: 'user', content: '旧事' }];
  assert.equal(migrateState(old).aiHistory[0].at, 0);
  const timestamp = new Date('2026-10-07T08:00:00').getTime();
  const state = makeDefaultState();
  setState(state);
  const history = [{ role: 'user', content: '新记录', at: timestamp }];
  callHelper('setAiHistory', history);
  assert.equal(aiMessagesForModel(history)[0].at, timestamp);
  persistAiHistory();
  assert.equal(state.aiHistory[0].at, timestamp);
  assert.equal(migrateState(state).aiHistory[0].at, timestamp);
  const messages = buildAiChatMessages(state, old.aiHistory, new Date('2026-10-08T08:00:00'));
  assert.ok(messages[1].content.startsWith('[历史消息，时间未知]'));
});

test('自动记忆默认零请求，手动提炼可用，载荷只含成功对话和有限记忆', async () => {
  const state = makeDefaultState();
  state.settings.aiApiKey = 'test';
  state.aiMemory = Array.from({ length: 40 }, (_, i) => ({ text: `记忆${i}` }));
  setState(state);
  callHelper('setAiHistory', [{ role: 'user', content: '正常问题' }, { role: 'assistant', content: '正常回答' }, { role: 'assistant', content: '失败内容', failed: true }]);
  let requests = 0;
  const deps = { extract: async (sent, conversation) => { requests++; assert.equal(sent.aiMemory.length, 24); assert.deepEqual(Object.keys(sent).sort(), ['aiMemory', 'settings']); assert.ok(!conversation.includes('失败内容')); return { add: [], remove: [] }; }, persist: async () => {} };
  assert.equal((await updateAiMemory({}, deps)).status, 'disabled');
  assert.equal(requests, 0);
  assert.equal((await updateAiMemory({ manual: true }, deps)).status, 'unchanged');
  assert.equal(requests, 1);
  state.settings.aiConversationMemoryEnabled = true;
  await updateAiMemory({}, deps);
  assert.equal(requests, 2);
});

test('关闭自动提炼会丢弃在途结果，提炼失败不重试且不写记忆', async () => {
  const state = makeDefaultState();
  state.settings.aiApiKey = 'test';
  state.settings.aiConversationMemoryEnabled = true;
  setState(state);
  callHelper('setAiHistory', [{ role: 'user', content: '问题' }, { role: 'assistant', content: '回答' }]);
  let saves = 0, requests = 0;
  const result = await updateAiMemory({}, { extract: async () => { state.settings.aiConversationMemoryEnabled = false; return { add: ['不应写入'], remove: [] }; }, persist: async () => { saves++; } });
  assert.equal(result.status, 'discarded');
  assert.equal(saves, 0);
  assert.deepEqual(state.aiMemory, []);
  await assert.rejects(updateAiMemory({ manual: true }, { extract: async () => { requests++; throw new Error('离线'); }, persist: async () => { saves++; } }), /离线/);
  assert.equal(requests, 1);
  assert.equal(saves, 0);
  assert.deepEqual(state.aiMemory, []);
});

test('模型已生成记忆但本机保存失败时恢复原记忆', async () => {
  const state = makeDefaultState();
  state.settings.aiApiKey = 'test';
  state.aiMemory = [{ id: 'old', text: '原有记忆', source: 'manual', createdAt: 1 }];
  setState(state);
  callHelper('setAiHistory', [{ role: 'user', content: '问题' }, { role: 'assistant', content: '回答' }]);
  const previous = structuredClone(state.aiMemory);
  await assert.rejects(updateAiMemory({ manual: true }, { extract: async () => ({ add: ['新的记忆'], remove: [] }), persist: async () => { throw new Error('存储已满'); } }), /存储已满/);
  assert.deepEqual(state.aiMemory, previous);
});
