import { $, $$, esc, state, save, render, modal, show, confirmDelete, emptyState, registerView, registerBinder, registerSubmitHandler } from '../core.js';
import { makeDocument, makeDocumentFolder } from '../model.js';
import { importDocument, openDocument, deleteDocument } from '../document-utils.js';
import { aiFindDocuments } from '../ai.js';

// ---- 本地状态 ----
let docFolderId = '';           // 当前选中文件夹（'' = 根目录/全部文件）
let docSearch = '';             // AI 查找关键词
let docMatches = new Set();     // AI 查找命中的 document id
let docFinding = false;         // AI 查找进行中

// ---- 工具 ----
function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// 返回按层级展开的文件夹列表（含缩进深度 depth）
function folderTree() {
  const folders = state.documentFolders || [];
  const ids = new Set(folders.map(folder => folder.id));
  const children = parentId => folders
    .filter(folder => (folder.parentId || '') === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  const out = [];
  const walk = (parentId, depth) => {
    for (const folder of children(parentId)) { out.push({ ...folder, depth }); walk(folder.id, depth + 1); }
  };
  walk('', 0);
  // 兜底：parentId 指向已删除文件夹的孤儿挂到根
  folders.filter(folder => folder.parentId && !ids.has(folder.parentId))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    .forEach(folder => { if (!out.some(item => item.id === folder.id)) out.push({ ...folder, depth: 0 }); });
  return out;
}

// 某文件夹及其所有后代 id（用于删除/防止移动成环）
function descendantFolderIds(folderId) {
  const doomed = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    state.documentFolders.forEach(folder => {
      if (doomed.has(folder.parentId) && !doomed.has(folder.id)) { doomed.add(folder.id); changed = true; }
    });
  }
  doomed.delete(folderId);
  return doomed;
}

function folderName(folderId) {
  return state.documentFolders.find(folder => folder.id === folderId)?.name || '';
}

// ---- 渲染 ----
export function documentsView() {
  const totalFiles = (state.documents || []).length;
  const currentName = docFolderId ? folderName(docFolderId) : '全部文件';
  const currentCount = (state.documents || []).filter(doc => (doc.folderId || '') === docFolderId).length;
  return `<section class="view documents-view">
    <div class="documents-intro">
      <div><span class="eyebrow">KNOWLEDGE BASE</span><h2>资料库</h2><p>${(state.documentFolders || []).length} 个文件夹 · ${totalFiles} 个文件</p></div>
    </div>
    <form id="doc-search-form" class="media-search doc-search"><span class="material-symbols-outlined">search</span><input name="search" value="${esc(docSearch)}" placeholder="AI 查找资料，如「高数笔记」"><button>查找</button></form>
    <div class="doc-import-bar">
      <button id="import-document" class="soft-button doc-import-btn"><span class="material-symbols-outlined">upload_file</span>导入文件</button>
      <span class="doc-current-path">当前：${esc(currentName)}</span>
    </div>
    <div class="doc-folder-tree">${folderTreeHtml()}</div>
    <div class="doc-section-head"><div><span class="eyebrow">FILES</span><h2>${esc(currentName)}</h2></div><span>${currentCount} 个文件</span></div>
    <div class="doc-list">${documentRows()}</div>
  </section>`;
}

function folderTreeHtml() {
  const rootCount = (state.documents || []).filter(doc => (doc.folderId || '') === '').length;
  let html = `<div class="doc-folder-row ${docFolderId === '' ? 'active' : ''}">
    <button class="doc-folder" data-folder=""><span class="material-symbols-outlined">folder_open</span><strong>全部文件</strong><span class="doc-folder-count">${rootCount}</span></button>
  </div>`;
  for (const folder of folderTree()) {
    const count = (state.documents || []).filter(doc => doc.folderId === folder.id).length;
    html += `<div class="doc-folder-row ${docFolderId === folder.id ? 'active' : ''}" style="padding-left:${10 + folder.depth * 18}px">
      <button class="doc-folder" data-folder="${folder.id}"><span class="material-symbols-outlined">folder</span><strong>${esc(folder.name)}</strong><span class="doc-folder-count">${count}</span></button>
      <span class="doc-folder-actions">
        <button data-rename-folder="${folder.id}" aria-label="重命名"><span class="material-symbols-outlined">edit</span></button>
        <button data-delete-folder="${folder.id}" aria-label="删除"><span class="material-symbols-outlined">delete</span></button>
      </span>
    </div>`;
  }
  if (!(state.documentFolders || []).length) html += '<p class="doc-tree-empty">还没有文件夹，点右上角新建。</p>';
  return html;
}

function docRow(doc, highlight = false, showFolder = false) {
  const icon = doc.type === 'pdf' ? 'picture_as_pdf' : doc.type === 'word' ? 'description' : 'insert_drive_file';
  const location = showFolder ? ` · ${esc(folderName(doc.folderId) || '根目录')}` : '';
  return `<article class="doc-item ${highlight ? 'match' : ''}">
    <button class="doc-open" data-open-doc="${doc.id}"><span class="doc-item-icon material-symbols-outlined">${icon}</span><span class="doc-item-copy"><strong>${esc(doc.name)}</strong><small>${formatSize(doc.size)}${location}</small></span></button>
    <button class="doc-item-action" data-move-doc="${doc.id}" aria-label="移动到其他文件夹"><span class="material-symbols-outlined">drive_file_move</span></button>
    <button class="doc-item-action danger" data-delete-doc="${doc.id}" aria-label="删除文件"><span class="material-symbols-outlined">delete</span></button>
  </article>`;
}

function documentRows() {
  const docs = state.documents || [];
  const current = docs.filter(doc => (doc.folderId || '') === docFolderId);
  if (!docMatches.size) {
    return current.map(doc => docRow(doc)).join('') || emptyState('这个文件夹还没有文件', '点上方「导入文件」添加 PDF 或 Word。');
  }
  // AI 查找命中：相关文件置顶 + 高亮（跨文件夹的也列出）
  const matched = current.filter(doc => docMatches.has(doc.id));
  const rest = current.filter(doc => !docMatches.has(doc.id));
  const external = docs.filter(doc => docMatches.has(doc.id) && (doc.folderId || '') !== docFolderId);
  if (!matched.length && !external.length) {
    return `<div class="doc-group-label">没有找到相关文件</div>` + (rest.map(doc => docRow(doc)).join('') || emptyState('这个文件夹还没有文件', '点上方「导入文件」添加 PDF 或 Word。'));
  }
  let html = '';
  if (external.length) html += `<div class="doc-group-label">其他文件夹中的相关文件</div>` + external.map(doc => docRow(doc, true, true)).join('');
  if (matched.length) html += `<div class="doc-group-label">当前文件夹相关文件</div>` + matched.map(doc => docRow(doc, true)).join('');
  if (rest.length) html += `<div class="doc-group-label">其他文件</div>` + rest.map(doc => docRow(doc)).join('');
  return html;
}

// ---- 文件夹表单（新建/重命名，可选调整父级）----
function folderForm(folder = null) {
  const exclude = folder ? descendantFolderIds(folder.id) : new Set();
  const parents = (state.documentFolders || []).filter(item => !exclude.has(item.id));
  const defaultParent = folder ? folder.parentId : docFolderId;
  modal(`<form id="folder-form"><input type="hidden" name="id" value="${folder?.id || ''}"><span class="eyebrow">FOLDER</span><h2>${folder ? '重命名文件夹' : '新建文件夹'}</h2><label>名称</label><input name="name" maxlength="40" required value="${esc(folder?.name || '')}" placeholder="例如：考研数学" autofocus><label>放在哪个文件夹里</label><select name="parentId"><option value="">顶层（不嵌套）</option>${parents.map(item => `<option value="${item.id}" ${item.id === defaultParent ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select><div class="modal-actions"><button type="button" data-close>取消</button><button class="save">保存</button></div></form>`, 'folder-modal');
}

// ---- 移动文件 ----
function moveDocForm(doc) {
  modal(`<form id="move-doc-form"><input type="hidden" name="id" value="${doc.id}"><span class="eyebrow">ORGANIZE</span><h2>移动「${esc(doc.name)}」</h2><label>移动到</label><select name="folderId"><option value="">根目录（不归类）</option>${(state.documentFolders || []).map(folder => `<option value="${folder.id}" ${folder.folderId === doc.folderId ? 'selected' : ''}>${esc(folder.name)}</option>`).join('')}</select><div class="modal-actions"><button type="button" data-close>取消</button><button class="save">移动</button></div></form>`, 'folder-modal');
}

// ---- 动作 ----
async function importDoc() {
  try {
    const meta = await importDocument(); // 内部 FilePicker 选 pdf/word + 写入磁盘
    state.documents.push(makeDocument({ ...meta, folderId: docFolderId }));
    await save(); render(); show(`已导入「${meta.name}」`);
  } catch (error) {
    show(error.message || '导入失败');
  }
}

async function openDoc(doc) {
  try {
    await openDocument(doc);
  } catch (error) {
    show(error.message || '打开失败');
  }
}

function deleteFolderConfirm(folderId) {
  const folder = state.documentFolders.find(item => item.id === folderId);
  if (!folder) return;
  const doomed = descendantFolderIds(folder.id); doomed.add(folder.id);
  const fileCount = state.documents.filter(doc => doomed.has(doc.folderId)).length;
  confirmDelete(`删除文件夹「${folder.name}」？${fileCount ? `其中 ${fileCount} 个文件会移到根目录。` : ''}子文件夹将一并删除。`, async () => {
    state.documentFolders = state.documentFolders.filter(item => !doomed.has(item.id));
    state.documents.forEach(doc => { if (doomed.has(doc.folderId)) doc.folderId = ''; });
    if (doomed.has(docFolderId)) docFolderId = '';
    await save(); render();
  });
}

function deleteDocConfirm(docId) {
  const doc = state.documents.find(item => item.id === docId);
  if (!doc) return;
  confirmDelete(`删除文件「${doc.name}」？文件本体也会从本机移除。`, async () => {
    state.documents = state.documents.filter(item => item.id !== docId);
    docMatches.delete(docId);
    try { await deleteDocument(doc); } catch {}
    await save(); render();
  });
}

// ---- AI 查找 ----
// aiFindDocuments(state, query) 由 AI 岗位提供（ai.js 转发层导出），返回相关文件 id 字符串数组。
async function runAiFind(query) {
  if (!query) { docMatches = new Set(); render(); return; }
  if (docFinding) return;
  docFinding = true;
  show('正在查找…');
  try {
    if (!state.settings.aiApiKey) {
      docMatches = new Set();
      show('配置 AI 后才能智能查找');
    } else {
      const ids = await aiFindDocuments(state, query);
      docMatches = new Set(Array.isArray(ids) ? ids : []);
      show(docMatches.size ? `找到 ${docMatches.size} 个相关文件` : '没有找到相关文件');
    }
  } catch (error) {
    docMatches = new Set();
    show(error.message || '查找失败');
  } finally {
    docFinding = false;
    render();
  }
}

// ---- 绑定 ----
function bindDocuments() {
  $('#new-document-folder')?.addEventListener('click', () => folderForm());
  $('#import-document')?.addEventListener('click', importDoc);
  $$('[data-folder]').forEach(button => button.onclick = () => { docFolderId = button.dataset.folder; docMatches = new Set(); docSearch = ''; render(); });
  $$('[data-rename-folder]').forEach(button => button.onclick = () => folderForm(state.documentFolders.find(folder => folder.id === button.dataset.renameFolder)));
  $$('[data-delete-folder]').forEach(button => button.onclick = () => deleteFolderConfirm(button.dataset.deleteFolder));
  $$('[data-open-doc]').forEach(button => button.onclick = () => openDoc(state.documents.find(doc => doc.id === button.dataset.openDoc)));
  $$('[data-move-doc]').forEach(button => button.onclick = () => moveDocForm(state.documents.find(doc => doc.id === button.dataset.moveDoc)));
  $$('[data-delete-doc]').forEach(button => button.onclick = () => deleteDocConfirm(button.dataset.deleteDoc));
}

// ---- 表单提交 ----
registerSubmitHandler('folder-form', async data => {
  const id = data.get('id');
  const name = (data.get('name') || '').trim();
  const parentId = data.get('parentId') || '';
  if (!name) throw new Error('请输入文件夹名称');
  if (id) {
    const folder = state.documentFolders.find(item => item.id === id);
    if (folder) { folder.name = name; folder.parentId = parentId; folder.updatedAt = Date.now(); }
  } else {
    state.documentFolders.push(makeDocumentFolder({ name, parentId }));
    const created = state.documentFolders[state.documentFolders.length - 1];
    docFolderId = created.id;
  }
});

registerSubmitHandler('move-doc-form', async data => {
  const doc = state.documents.find(item => item.id === data.get('id'));
  if (doc) doc.folderId = data.get('folderId') || '';
});

registerSubmitHandler('doc-search-form', async data => {
  docSearch = (data.get('search') || '').trim();
  await runAiFind(docSearch);
  return false;
});

registerView('documents', documentsView);
registerBinder(bindDocuments);
