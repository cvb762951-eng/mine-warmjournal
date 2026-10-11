import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FilePicker } from '@capawesome/capacitor-file-picker';

// 资料库文件存储工具：文件统一写入 App 的 Data 目录 documents/ 子目录，
// 元数据（name/type/size/folderId/path）存进 state.documents，文件本体只存磁盘。

const DOC_DIR = 'documents';
const ACCEPT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

// 从文件名判断类型：pdf → 'pdf'，doc/docx → 'word'，其他 → 'other'
export function documentType(name) {
  const extension = String(name || '').split('.').pop().toLowerCase();
  if (extension === 'pdf') return 'pdf';
  if (extension === 'doc' || extension === 'docx') return 'word';
  return 'other';
}

// 调起系统文件选择器（types 限定 pdf/word），返回选中的单个文件对象（PickedFile）。
// 供资料库视图调用；也可不调它、自己 pickFiles 后把 file 直接传给 importDocument。
export async function pickDocumentFile() {
  const picked = await FilePicker.pickFiles({ types: ACCEPT_TYPES, readData: true });
  const file = picked.files?.[0];
  if (!file) throw new Error('未选择文件');
  return file;
}

// 导入：把选中的文件写入 App 目录（documents/{id}.{ext}），返回元数据 {name,type,size,path}。
// pickedFile 可省略，省略时内部自动 pickDocumentFile。
export async function importDocument(pickedFile) {
  const file = pickedFile || await pickDocumentFile();
  const name = String(file.name || '').trim();
  if (!name) throw new Error('文件名无效');
  const type = documentType(name);
  if (type === 'other') throw new Error('仅支持 PDF 或 Word 文档');
  if (!file.data) throw new Error('未能读取文件内容');
  const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const extension = name.split('.').pop().toLowerCase();
  const path = `${DOC_DIR}/${id}.${extension}`;
  await Filesystem.writeFile({ path, data: file.data, directory: Directory.Data, recursive: true });
  const size = Number(file.size) || Math.ceil(String(file.data).length * 0.75);
  return { name, type, size, path };
}

// 打开：分享文件（file:// URI），让用户选择应用打开。
export async function openDocument(doc) {
  if (!doc?.path) throw new Error('文件路径无效');
  const uri = await Filesystem.getUri({ path: doc.path, directory: Directory.Data });
  await Share.share({ title: doc.name || '打开文件', files: [uri.uri] });
}

// 删除文件本体。
export async function deleteDocument(doc) {
  if (!doc?.path) return;
  await Filesystem.deleteFile({ path: doc.path, directory: Directory.Data });
}
