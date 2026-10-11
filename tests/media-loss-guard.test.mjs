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
 *   1) storage.js 的 persistState 在「AI 密钥加密失败」时静默 return ——
 *      整份 state 都没写进数据库（这是刻意的安全设计：宁可这次不存，
 *      也不让明文密钥落库）。
 *   2) 但 core.js 的 save() 不检查结果，继续执行 removeUnusedMedia，
 *      而它清理的依据是「内存里的 state」。
 *   3) 于是磁盘上刚写入的新媒体，在数据库里还没有任何记录 ——
 *      用户重启后数据库里没有它（第一次"消失"），
 *      再之后任何一次保存都会把它当"没人引用"删掉（彻底丢失）。
 *
 * 修复分三层，本文件逐条锁住：
 *   a. persistState 明确返回落库结果
 *   b. save() 在未落库成功时跳过媒体清理
 *   c. 清理改为「移入回收站」，给任何误判留出人工找回的窗口
 */

test('persistState 必须明确报告落库结果', () => {
  const fn = storage.match(/export async function persistState\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(fn, '应能提取 persistState');
  // 失败路径：加密失败 → 返回 false（不是静默 undefined）
  assert.match(fn, /if \(!sections\) return false;/,
    '加密失败必须返回 false，调用方才有可能察觉');
  // 成功路径：无变化说明数据库本已与内存一致，属于「已落库」
  assert.match(fn, /if \(!changes\.length\) return true;/,
    '无变化应返回 true 而不是 false（否则会永久跳过媒体清理）');
  // 浏览器预览路径与原生事务提交后都应落到 return true
  assert.match(fn, /localStorage\.setItem[\s\S]*?return true;/, '浏览器预览落库后应返回 true');
  assert.match(fn, /return true;\s*\}$/, '函数成功出口应返回 true');
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
