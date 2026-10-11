import { chat } from './provider.js';

const DOC_TYPE_LABELS = { pdf: 'PDF', word: 'Word 文档', other: '其他文件' };

// 根据 folderId 递归向上，拼出完整文件夹路径（如「考研/数学/讲义」）。folderId 空或无对应文件夹时返回 ''。
function folderPathOf(folderId, folderById) {
  if (!folderId) return '';
  const parts = [];
  let current = folderById.get(folderId);
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.parentId ? folderById.get(current.parentId) : null;
  }
  return parts.join('/');
}

// 解析 AI 返回的文件 id 列表，容错（参考 parseMemories）：只保留真实存在的文件 id，最多 10 个。
function parseDocIds(text, docs) {
  try {
    const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const arr = JSON.parse(cleaned);
    if (!Array.isArray(arr)) return [];
    const validIds = new Set(docs.map(doc => doc.id));
    return arr.map(item => String(item).trim()).filter(id => validIds.has(id)).slice(0, 10);
  } catch {
    return [];
  }
}

// 资料库 AI 查找：用户用自然语言描述要找的文件，AI 根据文件名 + 文件夹路径返回相关文件 id 列表。
export async function aiFindDocuments(state, query) {
  const settings = state?.settings || {};
  if (!settings.aiApiKey) return [];
  const docs = state?.documents || [];
  if (!docs.length) return [];
  const folders = state?.documentFolders || [];
  const folderById = new Map(folders.map(folder => [folder.id, folder]));

  const list = docs.map((doc, i) => {
    const path = folderPathOf(doc.folderId, folderById);
    const location = path ? `，位于「${path}」` : '，位于根目录';
    return `${i + 1}. 文件ID「${doc.id}」：${doc.name}（类型：${DOC_TYPE_LABELS[doc.type] || DOC_TYPE_LABELS.other}${location}）`;
  }).join('\n');

  const system = `你是「Mine」App 资料库的检索助手。下面是用户资料库里所有文件的清单，每行都标注了「文件ID」、文件名、类型和所在文件夹路径。请根据用户的查找描述，找出最相关的文件，只返回一个 JSON 数组，数组里是文件ID字符串，按相关度从高到低排序，最多 10 个；没有相关的就返回空数组 []。不要返回任何其他文字或解释。`;

  const reply = await chat(state, [
    { role: 'system', content: system },
    { role: 'user', content: `文件清单：\n${list}\n\n用户的查找描述：${query}` }
  ], { temperature: 0.2, maxTokens: 400 });

  return parseDocIds(reply, docs);
}
