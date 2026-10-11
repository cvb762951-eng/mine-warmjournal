import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

const core = await read('core.js');
const storage = await read('storage.js');
const mediaStore = await read('media-store.js');

/**
 * 媒体数据安全防护（2026-10-08 建立）
 *
 * 背景：用户反馈「前几个版本导入的视频数据丢失了」。
 * 根因是一条**跨模块的时序缺陷**，两个模块各自看都"正常"：
 *
 *   core.js  save() 的三步：externalizeStateMedia → persistState → removeUnusedMedia
 *
 *   1) storage.js 的 persistState 在「AI 密钥加密失败」时曾经整份跳过。
 *      明文不能落库，但日记/账本/速记也不该被一起丢掉。
 *      现在密钥失败只跳过密钥（返回 key-skipped），内容照常落库；
 *      false 只表示这次什么都没写上。
 *   2) core.js 的 save() 只在完全没落库时跳过媒体清理。
 *      密钥单独跳过时内容已在库里，清理是安全的，保存也不能判失败。
 *
 * 修复分三层，本文件逐条锁住：
 *   a. persistState 明确返回落库结果；密钥失败与整份失败分开
 *   b. save() 在未落库成功时跳过媒体清理，密钥跳过仍算保存成功
 *   c. 清理改为「移入回收站」，给任何误判留出人工找回的窗口
 */

test('persistState 必须明确报告落库结果', () => {
  const fn = storage.match(/export async function persistState\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(fn, '应能提取 persistState');
  // 整份没写上时返回 false（不是静默 undefined）。密钥加密失败不再走这条路。
  assert.match(fn, /if \(!sections\) return false;/,
    '分区无法准备时必须返回 false，调用方才不会清理媒体');
  assert.match(fn, /prepared\.keySkipped \? PERSIST_KEY_SKIPPED : true/,
    '密钥加密失败应返回 key-skipped，内容仍然落库');
  assert.match(storage, /function settingsSkippingPlainKey/,
    '密钥失败时要去掉明文并保留已有密文，而不是放弃整份 state');
  assert.doesNotMatch(storage, /return null;/,
    '密钥加密失败不得再让全部分区变成空结果');
  // 成功路径：无变化说明数据库本已与内存一致，属于「已落库」
  assert.match(fn, /if \(!changes\.length\) return outcome;/,
    '无变化应返回 outcome 而不是 false（否则会永久跳过媒体清理）');
  // 浏览器预览路径与原生事务提交后都应落到 return outcome（true 或 key-skipped）
  assert.match(fn, /localStorage\.setItem[\s\S]*?return outcome;/, '浏览器预览落库后应返回结果');
  assert.match(fn, /return outcome;\s*\}$/, '函数成功出口应返回落库结果');
  assert.doesNotMatch(fn, /^\s*return;\s*$/m, '不得再出现裸 return（调用方无法区分成败）');
});

test('save() 在未落库成功时必须跳过媒体清理（数据丢失防护核心）', () => {
  const saveBlock = core.match(/export const save = \(\) => \{[\s\S]*?\n\};/)?.[0] || '';
  assert.ok(saveBlock, '应能提取 save 实现');

  assert.match(saveBlock, /const persisted = await persistState\(savedState\)/,
    'save 必须接住 persistState 的结果');
  // 关键：跳过清理的分支必须在 removeUnusedMedia 之前
  assert.match(saveBlock, /if \(persisted === false\) throw new Error\([\s\S]*?removeUnusedMedia/,
    '落库未成功时必须报错，绝不能继续清理媒体');
  assert.match(saveBlock, /if \(persisted === 'key-skipped'\) notifyPersistedKeySeal\(persisted\)/,
    '密钥单独跳过时要提示重试，但不能把整次保存判失败');
  assert.ok(saveBlock.indexOf('removeUnusedMedia') < saveBlock.lastIndexOf('notifyPersistedKeySeal'),
    '密钥提示必须在内容落库之后');
  assert.match(core, /setTimeout\(\(\) => show\(KEY_SEAL_SKIPPED_NOTICE\), 0\)/,
    '密钥提示要晚于调用方的成功 toast');
  // 三步顺序不能被调换（清理必须在落库之后）
  const order = ['externalizeStateMedia', 'persistState', 'removeUnusedMedia'].map(name => saveBlock.indexOf(name));
  assert.ok(order.every(i => i >= 0), '保存三步都应存在');
  assert.deepEqual([...order].sort((a, b) => a - b), order,
    '顺序必须是 外部化 → 落库 → 清理；调换顺序会造成引用断裂');
});

test('未引用的媒体移入回收站，不再直接删除', () => {
  const fn = mediaStore.match(/export async function removeUnusedMedia\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(fn, '应能提取 removeUnusedMedia');

  assert.match(fn, /moveToTrash\(file\.name\)/, '未引用文件应移入回收站');
  assert.doesNotMatch(fn, /await Filesystem\.deleteFile\(\{ path, directory: Directory\.Data \}\)/,
    '不得再对未引用文件直接 deleteFile');
  assert.match(fn, /await purgeTrash\(\)/, '清理后应顺带清掉过期的回收站文件');

  assert.match(mediaStore, /const TRASH_DIR = '\.trash';/, '需要回收站目录常量');
  assert.match(mediaStore, /const TRASH_RETENTION_MS = 7 \* 24 \* 60 \* 60 \* 1000;/,
    '回收站应有明确的保留期（当前 7 天）');
});

test('回收站的安全语义：移动失败保留原文件，且不误伤子目录', () => {
  const trashFn = mediaStore.match(/async function moveToTrash\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(trashFn, '应能提取 moveToTrash');
  assert.match(trashFn, /catch \{\s*return false;\s*\}/,
    '移动失败必须返回 false —— 宁可留着也不删');
  assert.match(trashFn, /recursive: true/, '回收站目录需要可递归创建');

  // readdir 要跳过回收站自身与其它子目录，否则会试图"移动目录"
  const fn = mediaStore.match(/export async function removeUnusedMedia\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn, /file\.name === TRASH_DIR \|\| file\.type === 'directory'/,
    '必须跳过回收站目录本身和其它子目录');

  // 过期清理只删回收站内的文件，不能碰主目录
  const purgeFn = mediaStore.match(/async function purgeTrash\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(purgeFn, '应能提取 purgeTrash');
  assert.match(purgeFn, /TRASH_DIR/, '过期清理只作用于回收站内');
});

test('私密空间媒体与本目录隔离，不会被通用清理扫到', () => {
  // 私密空间有独立目录与独立引用集合，必须保持隔离，
  // 否则通用清理会把私密资产判为「未引用」。
  assert.match(mediaStore, /const ROOT = 'MineWarmJournalMedia';/);
  assert.match(mediaStore, /Filesystem\.readdir\(\{ path: ROOT, directory: Directory\.Data \}\)/,
    '通用清理只应扫描普通媒体目录');
});
