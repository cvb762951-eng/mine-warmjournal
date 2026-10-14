import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { migrateState, SCHEMA_VERSION } from './model.js';
import { rebuildActivityLog } from './activity-log.js';
import { sealApiKey, openApiKey, isEncryptedKey } from './ai-key-vault.js';

// 暖色生活志使用独立命名空间：这里刻意不读取旧 Mine 的 key/数据库。
export const STORAGE_KEYS = Object.freeze({
  state: 'mine-warmjournal-state-v1',
  snapshots: 'mine-warmjournal-safety-snapshots-v1',
  database: 'mine_warmjournal'
});
const LEGACY_KEY = STORAGE_KEYS.state;
const DB_NAME = STORAGE_KEYS.database;
const DATABASE_VERSION = SCHEMA_VERSION;
const SQLITE_CONNECTION_VERSION = 1;
export const SECTIONS = ['route', 'profile', 'settings', 'habits', 'todos', 'checks', 'habitCompletions', 'habitSkips', 'events', 'sessions', 'snippets', 'tasteEntries', 'journals', 'dailySummaries', 'weeklyInsightReports', 'media', 'countdowns', 'releases', 'documentFolders', 'documents', 'privateVault', 'passwordVault', 'aiMemory', 'aiHistory', 'focusProjects', 'focusCategories', 'timer', 'meta', 'transactions', 'ledgerAccounts', 'ledgerCategories', 'merchantCategoryRules', 'localGalleryWatchHistory', 'localGalleryProgress'];
let database = null;
let writesBlocked = false;
const serializedSections = new Map();
const SNAPSHOT_KEY = STORAGE_KEYS.snapshots;
export const WARM_APP_ID = 'com.mine.warmjournal';

export const isNativeAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export async function initializeStorage(defaultState) {
  writesBlocked = false;
  if (!isNativeAndroid()) {
    const raw = loadBrowser(defaultState);
    if (Number(raw.meta?.schemaVersion || 0) < SCHEMA_VERSION) await createSafetySnapshot(raw, '版本升级前').catch(console.warn);
    // 媒体必须先由启动流程外置到 IndexedDB，再把只含短引用的状态写回 localStorage。
    return hydrateAiKey(migrateState(raw, defaultState));
  }

  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const consistency = await sqlite.checkConnectionsConsistency();
  const existing = await sqlite.isConnection(DB_NAME, false);
  if (consistency.result && existing.result) {
    database = await sqlite.retrieveConnection(DB_NAME, false);
  } else {
    database = await sqlite.createConnection(DB_NAME, false, 'no-encryption', SQLITE_CONNECTION_VERSION, false);
  }
  await database.open();
  await database.execute(`
    CREATE TABLE IF NOT EXISTS state_sections (
      section TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS safety_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      reason TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
  `);

  const rows = await database.query('SELECT section, payload FROM state_sections');
  if (!rows.values?.length) {
    serializedSections.clear();
    const legacy = migrateState(loadBrowser(defaultState), defaultState);
    if (await persistState(legacy) === false) throw new Error('初始数据尚未保存');
    await ensureDailySnapshot(legacy).catch(console.warn);
    return legacy;
  }

  const state = structuredClone(defaultState);
  for (const row of rows.values) {
    if (SECTIONS.includes(row.section)) {
      state[row.section] = JSON.parse(row.payload);
      serializedSections.set(row.section, row.payload);
    }
  }
  if (Number(state.meta?.schemaVersion || 0) < SCHEMA_VERSION) await createSafetySnapshot(state, '版本升级前').catch(console.warn);
  const migrated = migrateState(state, defaultState);
  // 读库后把 Keystore 密文还原成内存明文；此时 state.settings.aiApiKey 尚未落库，明文只活在内存。
  await hydrateAiKey(migrated);
  if (await persistState(migrated) === false) throw new Error('升级后的数据尚未保存');
  await ensureDailySnapshot(migrated).catch(console.warn);
  return migrated;
}

// 内容已落库，但本次 AI 密钥没能加密，明文没有写入。下次保存会自动重试。
export const PERSIST_KEY_SKIPPED = 'key-skipped';
export const KEY_SEAL_SKIPPED_NOTICE = '日记、账本和速记已保存。AI 密钥这次没能加密，已跳过密钥，下次保存会自动重试。';

// 落库前把 AI Key 从明文换成 Keystore 密文。只克隆 settings 一个分区，避免整份 state 深拷贝的内存开销。
// 加密是异步的（Web Crypto / 原生插件都是 Promise）。失败时由 sectionsForWrite 跳过密钥，不中断其它分区。
async function sectionForWrite(section, value) {
  if (section !== 'settings' || !value || typeof value !== 'object') return value;
  const key = value.aiApiKey;
  if (!key || isEncryptedKey(key)) return value;
  return { ...value, aiApiKey: await sealApiKey(key) };
}

function keyFromPayload(payload) {
  if (!payload) return '';
  try {
    const key = JSON.parse(payload)?.aiApiKey;
    return typeof key === 'string' ? key : '';
  } catch {
    return '';
  }
}

// 只沿用目标库里已经成功加密的密钥。新的明文绝不写入；也不得把浏览器遗留明文抄进 SQLite。
function previouslySealedApiKey() {
  const fromSection = keyFromPayload(serializedSections.get('settings'));
  if (isEncryptedKey(fromSection)) return fromSection;
  if (isNativeAndroid()) return '';
  try {
    const saved = JSON.parse(localStorage.getItem(LEGACY_KEY) || '{}');
    const key = saved?.settings?.aiApiKey;
    return isEncryptedKey(key) ? key : '';
  } catch {
    return '';
  }
}

// 加密失败时保留已有密文（若有），并去掉本次明文。浅拷贝，不改内存里的 settings。
function settingsSkippingPlainKey(settings) {
  const next = { ...(settings && typeof settings === 'object' ? settings : {}) };
  const previous = previouslySealedApiKey();
  if (previous) next.aiApiKey = previous;
  else delete next.aiApiKey;
  return next;
}

// 日记、账本、速记等分区与密钥加密拆开：密钥失败只跳过密钥，其余照常落库。
async function sectionsForWrite(state) {
  let keySkipped = false;
  const sections = [];
  for (const section of SECTIONS) {
    let value = state[section];
    if (section === 'settings') {
      try {
        value = await sectionForWrite(section, value);
      } catch (error) {
        console.warn('AI 密钥加密失败，本次跳过密钥，其余内容仍会保存', error);
        value = settingsSkippingPlainKey(value);
        keySkipped = true;
      }
    }
    sections.push([section, JSON.stringify(value)]);
  }
  return { sections, keySkipped };
}

// 返回值：
//   true = 数据库已与内存一致（含密钥）
//   PERSIST_KEY_SKIPPED = 内容已落库，密钥加密失败，明文未写入，下次保存会重试
//   false = 本次完全没有落库
//
// ⚠️ 调用方必须把 false 当成「媒体引用还没进库」：
// 此刻若执行「删除未被引用的媒体」，磁盘上会留下「数据库不认、清理又删掉」的
// 孤儿文件，重启后引用断裂 —— 这就是 2026-10-08 用户反馈的「导入的视频丢失」根因。
// 密钥单独跳过时内容已经落库，可以照常清理媒体。
export async function persistState(state) {
  if (writesBlocked) throw new Error('本机数据加载失败，已停止保存以保护已有记录');
  state.events = rebuildActivityLog(state);
  const prepared = await sectionsForWrite(state);
  const sections = prepared?.sections;
  if (!sections) return false;
  const outcome = prepared.keySkipped ? PERSIST_KEY_SKIPPED : true;
  if (isNativeAndroid() && !database) throw new Error('本机数据库尚未就绪，请重新打开 App');
  if (!isNativeAndroid()) {
    // 浏览器预览：整份 state 写 localStorage，但用密文替换 settings 里的 Key。
    // 复用本次已加密的分区，不再进行第二次可能失败的密钥加密。
    const settings = JSON.parse(sections.find(([section]) => section === 'settings')[1]);
    localStorage.setItem(LEGACY_KEY, JSON.stringify(settings === state.settings ? state : { ...state, settings }));
    return outcome;
  }
  const now = Date.now();
  const changes = sections.filter(([section, payload]) => serializedSections.get(section) !== payload);
  // 没有变化 = 数据库本来就与内存一致，属于「已落库」，可以安全清理媒体。
  // 仅密钥没能更新时仍返回 PERSIST_KEY_SKIPPED，方便提示重试，不代表内容没写上。
  if (!changes.length) return outcome;
  await database.beginTransaction();
  try {
    for (const [section, payload] of changes) {
      await database.run(
        `INSERT INTO state_sections(section,payload,updated_at,schema_version)
         VALUES(?,?,?,?)
         ON CONFLICT(section) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at,schema_version=excluded.schema_version`,
        [section, payload, now, DATABASE_VERSION],
        false
      );
    }
    await database.commitTransaction();
    for (const [section, payload] of changes) serializedSections.set(section, payload);
  } catch (error) {
    await database.rollbackTransaction().catch(() => {});
    throw error;
  }
  return outcome;
}

export function blockStorageWrites() { writesBlocked = true; }

// 读库后把 Keystore 密文还原成内存明文，调用方同步读取无需感知。
export async function hydrateAiKey(state) {
  const stored = state?.settings?.aiApiKey;
  if (!stored || !isEncryptedKey(stored)) return state;
  try {
    state.settings.aiApiKey = await openApiKey(stored);
  } catch (error) {
    // 密钥失效必须让用户看见：置空并在设置页显示，不伪造成功。
    state.settings.aiApiKey = '';
    state.settings.aiApiKeyInvalid = true;
    console.warn('AI 密钥解密失败', error);
  }
  return state;
}

export async function replaceState(nextState) {
  // 所有白名单分区在同一事务内替换。先删旧库会在写入失败时丢掉原数据。
  // 密钥加密失败不再整单作废：内容会落库，明文密钥不会写入。
  const persisted = await persistState(nextState);
  if (persisted === false) throw new Error('数据尚未写入，原记录未被替换');
  return persisted;
}

// 快照与备份都要落到数据库，必须先把内存明文 Key 换成密文。
// 加密失败时写入去掉 Key 的版本 —— 宁可少一份密钥，也不能让明文进库。
async function snapshotSafeState(state) {
  try {
    const settings = await sectionForWrite('settings', state?.settings);
    if (settings === state?.settings) return state;
    return { ...state, settings };
  } catch (error) {
    console.warn('AI 密钥加密失败，本次快照/备份不含密钥', error);
    const { aiApiKey, ...rest } = state?.settings || {};
    return { ...state, settings: rest };
  }
}

export async function createSafetySnapshot(state, reason = '手动快照') {
  const safe = await snapshotSafeState(state);
  const snapshot = { createdAt:Date.now(), reason, schemaVersion:Number(safe?.meta?.schemaVersion || 0), data:safe };
  if (!isNativeAndroid() || !database) {
    const snapshots = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '[]');
    snapshots.unshift(snapshot);
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots.slice(0,5)));
    return snapshot;
  }
  await database.run('INSERT INTO safety_snapshots(created_at,reason,schema_version,payload) VALUES(?,?,?,?)',[snapshot.createdAt,reason,snapshot.schemaVersion,JSON.stringify(safe)],false);
  await database.run('DELETE FROM safety_snapshots WHERE id NOT IN (SELECT id FROM safety_snapshots ORDER BY created_at DESC LIMIT 5)',[],false);
  return snapshot;
}

export async function listSafetySnapshots() {
  if (!isNativeAndroid() || !database) return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '[]').map((item,index)=>({id:index,createdAt:item.createdAt,reason:item.reason,schemaVersion:item.schemaVersion}));
  const rows = await database.query('SELECT id,created_at,reason,schema_version FROM safety_snapshots ORDER BY created_at DESC LIMIT 5');
  return (rows.values || []).map(row=>({id:row.id,createdAt:row.created_at,reason:row.reason,schemaVersion:row.schema_version}));
}

// 清理媒体文件时必须同时保护安全快照仍引用的文件，否则“恢复快照”只能恢复文字记录而无法恢复视频。
export async function protectedSnapshotMediaReferences() {
  const payloads = [];
  if (!isNativeAndroid() || !database) {
    payloads.push(localStorage.getItem(SNAPSHOT_KEY) || '');
  } else {
    const rows = await database.query('SELECT payload FROM safety_snapshots ORDER BY created_at DESC LIMIT 5');
    payloads.push(...(rows.values || []).map(row => String(row.payload || '')));
  }
  const refs = new Set();
  for (const payload of payloads) {
    for (const match of payload.matchAll(/mine-(?:browser-)?media:\/\/[^"\\\s]+/g)) refs.add(match[0]);
  }
  return [...refs];
}

// 媒体“移入私密空间”后，旧安全快照不得再把普通引用恢复到 Moments/日历。
export async function redactSnapshotMediaReferences(refs = []) {
  const targets = new Set(refs.map(String).filter(value => value.startsWith('mine-media://') || value.startsWith('mine-browser-media://')));
  if (!targets.size) return 0;
  const redact = value => {
    if (typeof value === 'string') return targets.has(value) ? '' : value;
    if (Array.isArray(value)) return value.map(redact).filter(item => item !== '');
    if (value && typeof value === 'object') for (const key of Object.keys(value)) value[key] = redact(value[key]);
    return value;
  };
  let changed = 0;
  if (!isNativeAndroid() || !database) {
    const snapshots = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '[]');
    for (const snapshot of snapshots) {
      const before = JSON.stringify(snapshot.data);
      redact(snapshot.data);
      if (JSON.stringify(snapshot.data) !== before) changed += 1;
    }
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots));
    return changed;
  }
  const rows = await database.query('SELECT id,payload FROM safety_snapshots ORDER BY created_at DESC LIMIT 5');
  for (const row of rows.values || []) {
    const data = JSON.parse(row.payload);
    const before = JSON.stringify(data);
    redact(data);
    const payload = JSON.stringify(data);
    if (payload !== before) { await database.run('UPDATE safety_snapshots SET payload=? WHERE id=?', [payload, Number(row.id)], false); changed += 1; }
  }
  return changed;
}

async function ensureDailySnapshot(state) {
  if (!isNativeAndroid() || !database) return;
  const snapshots = await listSafetySnapshots();
  const latestDay = snapshots[0]?.createdAt ? new Date(snapshots[0].createdAt).toDateString() : '';
  if (latestDay !== new Date().toDateString()) await createSafetySnapshot(state, '每日自动保护');
}

export async function readSafetySnapshot(id) {
  if (!isNativeAndroid() || !database) {
    const snapshots = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '[]');
    const snapshot = snapshots[Number(id)];
    if (!snapshot?.data) throw new Error('没有找到这个安全快照');
    return hydrateAiKey(migrateState(snapshot.data));
  }
  const rows = await database.query('SELECT payload FROM safety_snapshots WHERE id=? LIMIT 1', [Number(id)]);
  const payload = rows.values?.[0]?.payload;
  if (!payload) throw new Error('没有找到这个安全快照');
  return hydrateAiKey(migrateState(JSON.parse(payload)));
}

export async function storageHealth(state) {
  const snapshots = await listSafetySnapshots();
  const serializedBytes = new Blob(SECTIONS.map(section=>JSON.stringify(state[section]))).size;
  return { schemaVersion:SCHEMA_VERSION, snapshots:snapshots.length, lastSnapshot:snapshots[0]?.createdAt || 0, serializedBytes, sections:SECTIONS.length };
}

export async function createBackupPayload(state) {
  return {
    format: 'mine-backup',
    formatVersion: 1,
    schemaVersion: DATABASE_VERSION,
    exportedAt: new Date().toISOString(),
    appId: WARM_APP_ID,
    // 备份文件本身已端到端加密，但仍然只写入密文 Key，避免解密备份后落库时出现明文窗口。
    data: Object.fromEntries(await Promise.all(SECTIONS.map(async section => [section, await sectionForWrite(section, state[section])])))
  };
}

// 备份导入的所有路径都走这里，因此 Key 的解密只需在这一处收口。
export async function validateBackupPayload(payload) {
  if (!payload || payload.format !== 'mine-backup' || payload.formatVersion !== 1) throw new Error('不是有效的 Mine 备份文件');
  if (payload.appId !== WARM_APP_ID) throw new Error('备份不属于暖色生活志，已拒绝导入');
  if (!payload.data || !Array.isArray(payload.data.habits) || !Array.isArray(payload.data.sessions)) throw new Error('备份内容不完整');
  return hydrateAiKey(migrateState(payload.data));
}

function loadBrowser(defaultState) {
  try {
    const saved = JSON.parse(localStorage.getItem(LEGACY_KEY) || '{}');
    return { ...structuredClone(defaultState), ...saved };
  } catch {
    return structuredClone(defaultState);
  }
}
