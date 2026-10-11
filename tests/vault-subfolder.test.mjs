import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

const vault = await read('views/private-vault.js');
const style = await read('styles.css');

/**
 * 私密空间子文件夹（2026-10-09 新增）
 *
 * 数据上只加一个字段 content.folders[].parentId（空串 = 顶层）。
 * 内容整体加密存放在 state.privateVault.payload，新增字段不涉及 SECTIONS 白名单。
 * 老数据没有该字段，一律按顶层处理，因此不需要迁移。
 */

test('子文件夹只加一个字段，且对老数据向后兼容', () => {
  assert.match(vault, /const vaultFolderParent = folder => String\(folder\?\.parentId \|\| ''\)/,
    '空值必须归一化为空串（老数据没有 parentId 时按顶层处理）');
  assert.match(vault, /function vaultFolderChildren\(content, parentId = ''\)/,
    '需要按父级筛选子文件夹的函数');
});

test('首页只列顶层文件夹，子文件夹在父级内部展示', () => {
  assert.match(vault, /const folders = \[\.\.\.vaultFolderChildren\(content\)\]/,
    '文件夹首页必须只取顶层（vaultFolderChildren 不传 parentId 即顶层）');
  assert.match(vault, /const subfolders = activeFolder \? vaultFolderChildren\(content, activeFolder\.id\) : \[\]/,
    '进入文件夹后应取出它的子文件夹');
  assert.match(vault, /vault-subfolder-block/, '需要在文件夹内部渲染子文件夹区');
  assert.match(style, /\.vault-subfolder-block\{/, '子文件夹区需要有样式');
});

test('层级有上限，且不允许把文件夹移进自己的子孙（防环）', () => {
  assert.match(vault, /const MAX_FOLDER_DEPTH = 3/, '层级上限应为 3');
  assert.match(vault, /function vaultFolderDescendants\(folderId, folders\)/, '需要求子孙集合以判断成环');
  // 表单里可选父级必须排除自己与子孙，并受深度上限约束
  assert.match(vault, /function vaultFolderParentChoices\(folders, current = null\)/);
  assert.match(vault, /const blocked = current \? new Set\(\[current\.id, \.\.\.vaultFolderDescendants\(current\.id, folders\)\]\)/,
    '父级候选必须排除自己与自己的子孙');
  assert.match(vault, /\.filter\(folder => vaultFolderDepth\(folder, folders\) < MAX_FOLDER_DEPTH\)/,
    '父级候选要受层级上限约束');
  // 保存时二次校验：即使表单被绕过也不能写坏层级
  assert.match(vault, /不能把文件夹移动到它自己或它的子文件夹里/, '保存时必须再拦一次成环');
  assert.match(vault, /最多支持 \$\{MAX_FOLDER_DEPTH\} 层文件夹/, '保存时必须再拦一次超深');
});

test('删除文件夹时子文件夹上移，不连带消失', () => {
  assert.match(vault, /子文件夹会上移到上一级/, '确认文案要说明子文件夹的去向');
  assert.match(vault, /content\.folders\.forEach\(item => \{\s*if \(vaultFolderParent\(item\) === folder\.id\) \{ item\.parentId = parentId;/,
    '删除前必须把子文件夹的 parentId 改成被删文件夹的父级');
  // 删除后应回到父级（若存在），否则回文件夹首页
  assert.match(vault, /if \(parentId && content\.folders\.some\(item => item\.id === parentId\)\) \{\s*activeFolderId = parentId;/,
    '删除后应回到父级而不是一律跳回首页');
});

test('返回按钮在子文件夹里先回上一级', () => {
  const block = vault.match(/\$\('#vault-back-folders'\)\?\.addEventListener\('click', \(\) => \{[\s\S]*?\n  \}\);/)?.[0] || '';
  assert.ok(block, '应能提取返回按钮的处理块');
  assert.match(block, /activeFolderId = parentId/, '有父级时先回到父级');
  assert.match(block, /vaultBrowseMode = 'folders'/, '已在顶层时才回文件夹首页');
});

test('同层判重、路径显示、计数口径一致', () => {
  // 同名只在同一层级内判断：不同父文件夹下允许同名子文件夹
  assert.match(vault, /const siblings = content\.folders\.filter\(folder => vaultFolderParent\(folder\) === parentId\)/,
    '判重应限定在同一父级内');
  // 选择器用完整路径，避免层级里同名文件夹分不清
  assert.match(vault, /label: vaultFolderPath\(folder, folders\)/, '移动选择器应显示完整路径');
  assert.match(vault, /name: vaultFolderPath\(folder, content\.folders\)/, '视频流的文件夹列表也应显示完整路径');
  // 计数含子孙，与卡片上标注的「N 项」一致
  assert.match(vault, /function vaultFolderCounts\(folder, content\)/, '需要统一的计数口径');
  assert.match(vault, /const scope = new Set\(\[folder\.id, \.\.\.descendants\]\)/, '计数应包含子孙文件夹里的内容');
});

test('封面候选与计数口径一致（只有子文件夹的父夹也能有封面）', () => {
  assert.match(vault, /const scope = new Set\(\[folder\.id, \.\.\.vaultFolderDescendants\(folder\.id, content\.folders\)\]\);\s*const candidates/,
    '文件夹卡片选封面时应把子孙内容纳入候选');
  assert.match(vault, /const items = privateVaultContent\(\)\.items\.filter\(item => scope\.has\(item\.folderId\)/,
    '手动选封面时同样要包含子孙内容');
});
