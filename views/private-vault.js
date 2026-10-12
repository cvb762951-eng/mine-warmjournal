import { Capacitor } from '@capacitor/core';
import { NativeMediaStore } from '../native-media-store.js';
import { PasswordVaultNative } from '../password-vault-native.js';
import { $, $$, esc, state, save, render, modal, closeModal, show, confirmDelete, goBack, registerView, registerBinder, registerOnRender, registerSubmitHandler, callHelper } from '../core.js';
import { compressSnippetPhoto, captureVideoFrame, saveMotionFromMediaRef, clampStillTransform, measureLongStill } from '../photo-utils.js';
import { livePhotoMarkHtml } from '../motion-photo.js';
import { privateVaultConfigured, privateVaultUnlocked, privateVaultContent, privateVaultKey, privateVaultKeyBase64, setupPrivateVault, unlockPrivateVault, unlockPrivateVaultWithKey, persistPrivateVault, lockPrivateVault, vaultPlayableDuration, vaultItemEdited, vaultItemOrientation } from '../private-vault.js';
import { encryptVaultFile, encryptVaultPoster, encryptExistingVaultMedia, encryptExistingVaultPoster, openVaultAsset, deleteVaultAssets, exportVaultItemToGallery, reencodeVaultItem, cancelVaultReencode } from '../vault-media-store.js';
import { imgSrc } from '../core.js';
import { withSharedTransition } from '../motion.js';
import { showVideoFramePicker } from '../video-frame-picker.js';
import { showVideoEditor } from '../video-editor.js';
import { formatVideoDuration } from '../video-player.js';
import { readVideoMetadata, captureVideoCropFrame } from '../video-poster.js';
import { redactSnapshotMediaReferences } from '../storage.js';
import { makeSnippet, HABIT_HEAD_MAX_SECONDS } from '../model.js';
import { mediaReferenceSize, resolveMediaReference } from '../media-store.js';

let activeFolderId = '';
let vaultBrowseMode = 'folders';
let vaultFolderSort = 'recent';
let vaultContentSort = 'recent';
let vaultMediaFilter = 'all';
let vaultGridView = 'thumb';
let vaultSelectionMode = false;
let vaultExperienceMode = 'library';
const vaultSelectedIds = new Set();
const thumbnailUrls = new Map();
const decryptedVideoUrls = new Map();
const decryptingVideoUrls = new Map();
let externalUiDepth = 0;
let vaultFullscreenActive = false;
let pendingVisibilityLock = null;
let vaultPhotoChromeTimer = null;
// 仅内存态：App 进程结束后自然丢失，绝不写入 state/SQLite/备份。
let passwordlessForThisRun = false;
let vaultRouteWasActive = false;
let vaultBiometric = { checked: false, available: false, enrolled: false };
let vaultFingerprintAttempted = false;
let vaultFingerprintInFlight = false;
const VAULT_POSTER_MAX_SIDE = 720;

export function privateVaultView() {
  if (!privateVaultConfigured(state)) return vaultGate('setup');
  if (!privateVaultUnlocked()) return vaultGate('unlock');
  if (!vaultRouteWasActive) {
    vaultExperienceMode = 'library';
    vaultBrowseMode = 'folders';
    activeFolderId = '';
    vaultMediaFilter = 'all';
  }
  const content = privateVaultContent();
  const folders = content.folders;
  const items = visibleVaultItems(content);
  const activeFolder = activeFolderId ? folders.find(folder => folder.id === activeFolderId) : null;
  // 当前文件夹名用完整路径（如「旅行 / 2024」），层级深了也知道自己在哪。
  const folderName = activeFolder
    ? vaultFolderPath(activeFolder, folders) || activeFolder.name
    : vaultBrowseMode === 'unfiled' ? '未分类' : '全部私密内容';
  // 子文件夹只在自己父级内部展示（首页只列顶层）。
  const subfolders = activeFolder ? vaultFolderChildren(content, activeFolder.id) : [];
  const browsingFolders = vaultBrowseMode === 'folders';
  return `<section class="view private-vault-view">
    <header class="vault-header"><button id="vault-back" aria-label="返回私密空间入口"><span class="material-symbols-outlined">arrow_back</span></button><span><small>PRIVATE ARCHIVE</small><strong>私密空间</strong></span><button id="vault-lock"><span class="material-symbols-outlined">lock</span>锁定</button></header>
    <div class="vault-security-note"><span class="material-symbols-outlined">verified_user</span><span><strong>当前已解锁</strong><small>${passwordlessForThisRun ? '本次运行免密已开启 · 后台未被清除时无需再次输入' : '离开页面或 App 进入后台后会重新要求指纹'}</small></span><div class="vault-security-actions"><button id="vault-fingerprint-settings"><span class="material-symbols-outlined">fingerprint</span>指纹设置</button><button id="vault-passwordless" class="${passwordlessForThisRun ? 'active' : ''}" aria-pressed="${passwordlessForThisRun}"><span class="material-symbols-outlined">${passwordlessForThisRun ? 'toggle_on' : 'toggle_off'}</span>本次运行免密</button></div></div>
    <div class="vault-toolbar"><button id="vault-import"><span class="material-symbols-outlined">video_file</span>批量导入照片 / 视频</button><button id="vault-import-moments"><span class="material-symbols-outlined">collections</span>从随手拍加入</button><button id="vault-new-folder"><span class="material-symbols-outlined">create_new_folder</span>新建文件夹</button></div>
    ${browsingFolders ? folderHome(content) : `<div class="vault-section-head vault-content-head"><button id="vault-back-folders" aria-label="返回文件夹"><span class="material-symbols-outlined">arrow_back</span></button><span><small>PRIVATE COLLECTION</small><strong>${esc(folderName)}</strong></span><select id="vault-content-sort" aria-label="内容排序"><option value="recent" ${vaultContentSort === 'recent' ? 'selected' : ''}>最近加入</option><option value="date" ${vaultContentSort === 'date' ? 'selected' : ''}>记录日期</option><option value="name" ${vaultContentSort === 'name' ? 'selected' : ''}>名称</option></select><button id="vault-select-items">${vaultSelectionMode ? '取消' : '选择'}</button>${activeFolderId ? `<button id="vault-folder-menu" aria-label="管理文件夹"><span class="material-symbols-outlined">more_horiz</span></button>` : ''}</div>${subfolders.length ? `<div class="vault-subfolder-block"><span class="vault-subfolder-heading"><span class="material-symbols-outlined">folder_open</span>子文件夹（${subfolders.length}）</span><div class="vault-folder-grid">${subfolders.map(folder => folderCard({ ...folder, mode: 'folder', ...vaultFolderCounts(folder, content) }, content)).join('')}</div></div>` : ''}<div class="vault-media-filter" role="group" aria-label="筛选当前内容"><button type="button" data-vault-media-filter="all" class="${vaultMediaFilter === 'all' ? 'active' : ''}" aria-pressed="${vaultMediaFilter === 'all'}">全部</button><button type="button" data-vault-media-filter="photo" class="${vaultMediaFilter === 'photo' ? 'active' : ''}" aria-pressed="${vaultMediaFilter === 'photo'}"><span class="material-symbols-outlined">photo_library</span>照片</button><button type="button" data-vault-media-filter="video" class="${vaultMediaFilter === 'video' ? 'active' : ''}" aria-pressed="${vaultMediaFilter === 'video'}"><span class="material-symbols-outlined">video_library</span>视频</button><button type="button" data-vault-media-filter="portrait" class="${vaultMediaFilter === 'portrait' ? 'active' : ''}" aria-pressed="${vaultMediaFilter === 'portrait'}"><span class="material-symbols-outlined">stay_current_portrait</span>竖屏</button><button type="button" data-vault-media-filter="landscape" class="${vaultMediaFilter === 'landscape' ? 'active' : ''}" aria-pressed="${vaultMediaFilter === 'landscape'}"><span class="material-symbols-outlined">stay_current_landscape</span>横屏</button></div><div class="vault-grid${ORIENTATION_FILTERS.has(vaultMediaFilter) ? ` filter-${vaultMediaFilter}` : ''}">${items.length ? items.map(vaultItem).join('') : `<div class="vault-empty"><span class="material-symbols-outlined">${vaultMediaFilter === 'photo' ? 'photo_library' : vaultMediaFilter === 'video' ? 'video_library' : ORIENTATION_FILTERS.has(vaultMediaFilter) ? 'screen_rotation' : 'lock'}</span><strong>${vaultMediaFilter === 'photo' ? '这里还没有照片' : vaultMediaFilter === 'video' ? '这里还没有视频' : vaultMediaFilter === 'portrait' ? '这里还没有竖屏内容' : vaultMediaFilter === 'landscape' ? '这里还没有横屏内容' : '这里还没有私密内容'}</strong><small>${vaultMediaFilter === 'all' ? '可以导入文件，或从其他文件夹移动到这里。' : '切换到其他筛选，或导入新的私密内容。'}</small></div>`}</div>${vaultSelectionMode ? bulkActionBar() : ''}`}
  </section>`;
}

function vaultFeedFolders() {
  const content = privateVaultContent();
  const videoCount = predicate => content.items.filter(item => item.type === 'video' && predicate(item)).length;
  return [
    { mode: 'all', id: '', name: '全部视频', count: videoCount(() => true) },
    { mode: 'unfiled', id: '', name: '未分类', count: videoCount(item => !item.folderId) },
    // 名称用完整路径（层级里常有同名文件夹）；计数含子孙，与文件列表页的口径一致。
    ...content.folders.map(folder => {
      const scope = new Set([folder.id, ...vaultFolderDescendants(folder.id, content.folders)]);
      return { mode: 'folder', id: folder.id, name: vaultFolderPath(folder, content.folders), count: videoCount(item => scope.has(item.folderId)) };
    })
  ].filter(folder => folder.count > 0);
}

function startVaultFeed(index = 0) {
  if (!privateVaultUnlocked() || state.route !== 'private-vault') return;
  if (vaultBrowseMode === 'folders') { vaultBrowseMode = 'all'; activeFolderId = ''; }
  const videos = shuffledVaultVideos();
  if (!videos.length) { vaultExperienceMode = 'library'; return; }
  vaultExperienceMode = 'active';
  openVaultVideo(videos[Math.max(0, Math.min(videos.length - 1, index))], videos, index, '', true).catch(error => { vaultExperienceMode = 'library'; show(error.message); });
}

/* ---------------------------------------------------------------------------
   按画面方向筛选（2026-10-09 新增）

   用户诉求：「可以筛选竖屏视频和横屏视频，并在竖屏分类下把竖屏视频的封面
   调整到最能体现的样式」。
   思路正好化解了之前的矛盾 —— 混排时卡片统一尺寸（整齐），
   只看竖屏时切换成竖版卡片（最能体现内容）。

   方向判定见 `private-vault.js` 的 `vaultItemOrientation`（数据层唯一事实来源）——
   它还要处理"裁过画面之后方向以取景框为准"，放在这里会和别处不一致。
   --------------------------------------------------------------------------- */

const ORIENTATION_FILTERS = new Set(['portrait', 'landscape']);

function visibleVaultItems(content = privateVaultContent()) {
  const scoped = vaultItemsForBrowseScope(content);
  // 方向筛选与类型筛选是同一组互斥选项（全部 / 照片 / 视频 / 竖屏 / 横屏），
  // 所以这里按当前值分派，而不是叠加两层条件。
  const items = ORIENTATION_FILTERS.has(vaultMediaFilter)
    ? scoped.filter(item => vaultItemOrientation(item) === vaultMediaFilter)
    : scoped.filter(item => vaultMediaFilter === 'all' || item.type === vaultMediaFilter);
  return [...items].sort((a, b) => vaultContentSort === 'name' ? String(a.name).localeCompare(String(b.name), 'zh-CN') : vaultContentSort === 'date' ? String(b.date || '').localeCompare(String(a.date || '')) || b.createdAt - a.createdAt : b.createdAt - a.createdAt);
}

function vaultItemsForBrowseScope(content = privateVaultContent()) {
  return content.items.filter(item => vaultBrowseMode === 'all' || (vaultBrowseMode === 'unfiled' ? !item.folderId : item.folderId === activeFolderId));
}

/* ---------------------------------------------------------------------------
   子文件夹支持（2026-10-09 新增）

   数据上只加一个字段：content.folders[].parentId。
   空字符串 = 顶层。老数据没有该字段，一律按顶层处理，因此无需迁移。
   内容整体是加密存储的（state.privateVault.payload），新增字段不涉及
   SECTIONS 白名单，也不会改变落库结构。

   层级上限 3 层：够用且不会让面包屑路径长到读不下。
   --------------------------------------------------------------------------- */
const MAX_FOLDER_DEPTH = 3;
const vaultFolderParent = folder => String(folder?.parentId || '');

function vaultFolderChildren(content, parentId = '') {
  return (content?.folders || []).filter(folder => vaultFolderParent(folder) === parentId);
}

// 从顶层往下拼路径，带环保护（数据异常时不至于死循环）。
function vaultFolderPath(folder, folders, separator = ' / ') {
  const parts = [];
  const seen = new Set();
  let cursor = folder;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    parts.unshift(cursor.name);
    cursor = (folders || []).find(item => item.id === vaultFolderParent(cursor));
  }
  return parts.join(separator);
}

function vaultFolderDepth(folder, folders) {
  const parts = vaultFolderPath(folder, folders).split(' / ');
  return parts.filter(Boolean).length;
}

// 某文件夹的全部子孙 id —— 用于禁止「把文件夹移进自己的子级」造成环。
function vaultFolderDescendants(folderId, folders) {
  const out = new Set();
  const walk = id => (folders || []).forEach(folder => {
    if (vaultFolderParent(folder) === id && !out.has(folder.id)) {
      out.add(folder.id);
      walk(folder.id);
    }
  });
  walk(folderId);
  return out;
}

// 可供选择的父文件夹：排除自己与自己的子孙，并受层级上限约束。
function vaultFolderParentChoices(folders, current = null) {
  const blocked = current ? new Set([current.id, ...vaultFolderDescendants(current.id, folders)]) : new Set();
  return (folders || [])
    .filter(folder => !blocked.has(folder.id))
    .filter(folder => vaultFolderDepth(folder, folders) < MAX_FOLDER_DEPTH)
    .map(folder => ({ id: folder.id, label: vaultFolderPath(folder, folders) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
}

/* ---------------------------------------------------------------------------
   文件夹封面：统一尺寸 + 完整内容（2026-10-09，第二次迭代）

   第一次修法：让封面框按内容比例自适应（竖的竖、横的横）。
   内容确实完整了，但竖屏与横屏的卡片高矮相差很大，2 列网格里排在一起很突兀
   —— 用户反馈「大小差异太大，排在一起显得突兀」。

   现在改为折中：卡片回到统一的 4:3，内容用 contain 完整显示，
   两侧的留白由**同一张画面放大虚化**填住（视频 App 全屏时的常见处理）。
   三个目标于是同时成立：
     · 卡片尺寸统一   → 网格整齐
     · 内容不被裁切   → 竖屏视频完整可见
     · 留白不是纯色块 → 不显得"缺了一块"
   --------------------------------------------------------------------------- */

// 封面图分两层：底层虚化铺满、上层完整显示。
// 两层用同一个地址，浏览器只会下载一次。
function vaultCoverImage(source, alt = '') {
  const url = esc(source);
  return `<img class="vault-cover-blur" src="${url}" alt="" aria-hidden="true"><img class="vault-cover-main" src="${url}" alt="${esc(alt)}">`;
}

function folderHome(content) {
  const unfiled = content.items.filter(item => !item.folderId);
  const special = [
    { mode: 'all', id: '', name: '全部内容', count: content.items.length, updatedAt: Math.max(0, ...content.items.map(item => item.createdAt || 0)), icon: 'collections' },
    { mode: 'unfiled', id: '', name: '未分类', count: unfiled.length, updatedAt: Math.max(0, ...unfiled.map(item => item.createdAt || 0)), icon: 'inbox' }
  ];
  // 首页只列顶层文件夹；子文件夹在各自父级内部展示，避免首页被层级塞满。
  const folders = [...vaultFolderChildren(content)]
    .sort((a, b) => vaultFolderSort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : vaultFolderSort === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt);
  const cards = [...special, ...folders.map(folder => ({ ...folder, mode: 'folder', ...vaultFolderCounts(folder, content) }))];
  return `<div class="vault-folder-home-head"><span><small>PRIVATE ALBUMS</small><strong>私密文件夹</strong></span><select id="vault-folder-sort" aria-label="文件夹排序"><option value="recent" ${vaultFolderSort === 'recent' ? 'selected' : ''}>最近更新</option><option value="name" ${vaultFolderSort === 'name' ? 'selected' : ''}>名称</option><option value="created" ${vaultFolderSort === 'created' ? 'selected' : ''}>创建时间</option></select></div><div class="vault-folder-grid">${cards.map(card => folderCard(card, content)).join('')}</div>`;
}

// 文件夹的计数：总数含子孙文件夹里的内容（用户关心「这一夹里一共有多少东西」），
// 另外单独给出子文件夹数量，好在卡片上标注。
function vaultFolderCounts(folder, content) {
  const descendants = vaultFolderDescendants(folder.id, content.folders);
  const scope = new Set([folder.id, ...descendants]);
  return {
    count: content.items.filter(item => scope.has(item.folderId)).length,
    subfolderCount: descendants.size
  };
}

function folderCard(folder, content) {
  // 封面候选含子孙文件夹的内容：只有子文件夹的父夹也能有封面。
  const scope = new Set([folder.id, ...vaultFolderDescendants(folder.id, content.folders)]);
  const candidates = content.items.filter(item => folder.mode === 'all' || (folder.mode === 'unfiled' ? !item.folderId : scope.has(item.folderId)));
  const preferred = candidates.find(item => item.id === folder.coverItemId && (item.type === 'photo' || item.posterRef)) || [...candidates].sort((a, b) => b.createdAt - a.createdAt).find(item => item.posterRef || item.type === 'photo');
  const cached = preferred ? thumbnailUrls.get(preferred.id) : '';
  const meta = `${folder.count} 项${folder.subfolderCount ? ` · ${folder.subfolderCount} 个子夹` : ''} · ${folder.updatedAt ? formatFolderDate(folder.updatedAt) : '暂无内容'}`;
  const cover = cached ? vaultCoverImage(cached, folder.name) : `<span class="material-symbols-outlined">${folder.icon}</span>`;
  return `<article class="vault-folder-card"><button class="vault-folder-open" data-vault-folder-mode="${folder.mode}" data-vault-folder-id="${folder.id || ''}"><span class="vault-folder-cover" ${preferred ? `data-vault-cover-item="${preferred.id}"` : ''}>${cover}</span><span class="vault-folder-copy"><strong>${esc(folder.name)}</strong><small>${esc(meta)}</small></span></button>${folder.mode === 'folder' ? `<button class="vault-folder-card-menu" data-manage-vault-folder="${folder.id}" aria-label="管理${esc(folder.name)}"><span class="material-symbols-outlined">more_horiz</span></button>` : ''}</article>`;
}

function formatFolderDate(timestamp) { const date = new Date(Number(timestamp) || 0); return `${date.getMonth() + 1}月${date.getDate()}日更新`; }
function bulkActionBar() { return `<div class="vault-bulk-bar"><span>已选 <strong>${vaultSelectedIds.size}</strong> 项</span><button id="vault-bulk-move" ${vaultSelectedIds.size ? '' : 'disabled'}><span class="material-symbols-outlined">drive_file_move</span>移动</button><button id="vault-bulk-delete" ${vaultSelectedIds.size ? '' : 'disabled'}><span class="material-symbols-outlined">delete</span>删除</button></div>`; }

function vaultGate(mode) {
  const setup = mode === 'setup';
  return `<section class="view private-vault-view vault-locked-view"><header class="vault-header"><button id="vault-back" aria-label="返回"><span class="material-symbols-outlined">arrow_back</span></button><span><small>PRIVATE ARCHIVE</small><strong>私密空间</strong></span><i></i></header><div class="vault-lock-paper"><span class="vault-lock-mark material-symbols-outlined">${setup ? 'enhanced_encryption' : 'fingerprint'}</span><small>${setup ? 'CREATE PRIVATE KEY' : 'PRIVATE ARCHIVE LOCKED'}</small><h2>${setup ? '设置私密密码' : '指纹解锁私密空间'}</h2><p id="vault-unlock-status">${setup ? '照片和视频保存在App专属私有目录，只有通过入口密码后才会显示。' : '正在检查本机系统指纹…'}</p><form id="${setup ? 'vault-setup-form' : 'vault-unlock-form'}" ${setup ? '' : 'hidden'}><label>私密密码</label><input name="password" type="password" minlength="6" required autocomplete="${setup ? 'new-password' : 'current-password'}" inputmode="numeric" placeholder="至少 6 位">${setup ? '<label>再次输入</label><input name="confirm" type="password" minlength="6" required autocomplete="new-password" inputmode="numeric" placeholder="再次输入密码">' : ''}<button class="save">${setup ? '创建私密空间' : '使用私密密码解锁'}</button></form>${setup ? '' : '<button type="button" id="vault-fingerprint-unlock" hidden><span class="material-symbols-outlined">fingerprint</span>重新使用系统指纹</button>'}</div></section>`;
}

function vaultItem(item) {
  const cached = thumbnailUrls.get(item.id) || '';
  // 剪过的显示"剪完还剩多久"，不是原片时长（见 vaultPlayableDuration 的注释）
  const duration = item.type === 'video' ? formatVideoDuration(vaultPlayableDuration(item), item.sourceType === 'hls' ? '在线' : '待读取') : '';
  const edited = item.type === 'video' && vaultItemEdited(item);
  const rawName = item.name || (item.type === 'video' ? '私密视频' : '私密照片');
  // 竖屏卡片样式：裁过画面之后也算重判（横屏裁成竖屏就该换成竖版卡片）
  const portraitCover = item.type === 'video' && vaultItemOrientation(item) === 'portrait';
  const media = `<span class="vault-media-box ${item.type === 'video' ? 'video-contain-cover' : ''} ${portraitCover ? 'is-portrait-video-cover' : ''}">${cached ? `${item.type === 'video' ? `<img class="photo-blur-pad" src="${esc(cached)}" alt="" aria-hidden="true">` : ''}<img src="${esc(cached)}" alt="${esc(rawName)}">` : '<span class="vault-media-loading material-symbols-outlined">encrypted</span>'}${item.type === 'video' ? `<i class="material-symbols-outlined">play_arrow</i><em class="video-duration-stamp" data-vault-duration="${item.id}" aria-label="视频时长 ${duration}">${duration}</em>` : ''}${item.type === 'photo' && item.motionRef ? livePhotoMarkHtml() : ''}${edited ? '<em class="video-edited-stamp" aria-label="已剪辑">已剪辑</em>' : ''}</span>`;
  const selected = vaultSelectedIds.has(item.id);
  const primary = vaultSelectionMode ? `data-select-vault-item="${item.id}" aria-label="${selected ? '取消选择' : '选择'}${esc(rawName)}"` : `data-open-vault-item="${item.id}" aria-label="${item.type === 'video' ? '播放' : '查看'}${esc(rawName)}"`;
  const mark = vaultSelectionMode ? `<span class="vault-selection-mark material-symbols-outlined">${selected ? 'check_circle' : 'radio_button_unchecked'}</span>` : '';
  if (item.type === 'video') return `<article class="vault-item vault-video-item ${selected ? 'selected' : ''}"><button class="vault-item-open" ${primary}>${media}${mark}</button>${vaultSelectionMode ? '' : `<button type="button" class="vault-video-menu-trigger" data-vault-item-menu="${item.id}" aria-label="管理${esc(rawName)}"><span class="material-symbols-outlined">more_horiz</span></button>`}</article>`;
  return `<article class="vault-item ${selected ? 'selected' : ''}"><button class="vault-item-open" ${primary}>${media}${mark}<strong>${esc(rawName)}</strong><small>${item.date ? `${item.date} · ` : ''}${formatSize(item.size)}</small></button>${vaultSelectionMode ? '' : `<div><button data-move-vault-item="${item.id}" aria-label="移动"><span class="material-symbols-outlined">drive_file_move</span></button><button data-delete-vault-item="${item.id}" aria-label="删除"><span class="material-symbols-outlined">delete</span></button></div>`}</article>`;
}

function cleanVaultVideoTitle(name, date) {
  const escapedDate = String(date || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escapedDate ? new RegExp(`^随手拍\\s+${escapedDate}\\s*[·・-]\\s*`) : null;
  return String(name || '')
    .replace(pattern || /^$/, '')
    .replace(/^正在播放\s*[-—:：]\s*/i, '')
    .replace(/\.(?:mp4|webm|mov|mkv|m4v|3gp)$/i, '')
    .replace(/[_]+/g, ' ')
    .trim() || '私密视频';
}

function vaultItemMenu(item) {
  if (!item) return;
  const title = cleanVaultVideoTitle(item.name || '私密视频', item.date);
  const meta = [item.date, formatVideoDuration(item.duration), formatSize(item.size)].filter(Boolean).join(' · ');
  // 「压缩并替换原件」只在"确实剪辑过"时出现：没剪过的视频压一遍没有任何意义，
  // 白白让用户等一次重编码、还平白多一次损失画质的机会。
  const canBake = item.sourceType !== 'hls' && vaultItemEdited(item);
  const trimEntry = '<button type="button" id="vault-menu-trim"><span class="material-symbols-outlined">content_cut</span><span><strong>剪辑视频</strong><small>剪短时长 · 框选画面</small></span></button>';
  const bakeEntry = canBake ? '<button type="button" id="vault-menu-bake"><span class="material-symbols-outlined">compress</span><span><strong>压缩并替换原件</strong><small>剪掉的部分真正消失 · 文件变小</small></span></button>' : '';
  modal(`<div class="vault-item-menu-sheet"><span class="eyebrow">PRIVATE VIDEO</span><h2>${esc(title)}</h2>${meta ? `<small>${esc(meta)}</small>` : ''}<div class="vault-item-menu-actions"><button type="button" id="vault-menu-edit"><span class="material-symbols-outlined">edit_note</span><span><strong>编辑说明</strong><small>名称、日期与视频故事</small></span></button>${trimEntry}${bakeEntry}${item.sourceType !== 'hls' ? '<button type="button" id="vault-menu-cover"><span class="material-symbols-outlined">image</span><span><strong>选择封面</strong><small>从视频时间轴重新取帧</small></span></button>' : ''}<button type="button" id="vault-menu-move"><span class="material-symbols-outlined">drive_file_move</span><span><strong>移动到文件夹</strong><small>整理私密影像</small></span></button>${restorableVaultVideo(item) ? '<button type="button" id="vault-menu-restore-moment"><span class="material-symbols-outlined">restore</span><span><strong>恢复到随手拍</strong><small>重新显示在普通生活记录中</small></span></button>' : ''}${item.sourceType !== 'hls' ? '<button type="button" id="vault-menu-export"><span class="material-symbols-outlined">download</span><span><strong>保存到相册</strong><small>导出到系统相册，可用手机自带剪辑</small></span></button>' : ''}<button type="button" class="danger" id="vault-menu-delete"><span class="material-symbols-outlined">delete</span><span><strong>永久删除</strong><small>此操作无法撤销</small></span></button></div><div class="modal-actions"><button type="button" data-close>关闭</button></div></div>`, 'vault-item-menu-modal');
  $('#vault-menu-edit').onclick = () => { closeModal(); editVaultVideoForm(item); };
  $('#vault-menu-trim')?.addEventListener('click', () => { closeModal(); trimVaultVideo(item).catch(error => show(error.message)); });
  $('#vault-menu-bake')?.addEventListener('click', () => { closeModal(); bakeVaultVideoPrompt(item); });
  $('#vault-menu-cover')?.addEventListener('click', () => { closeModal(); choosePrivateVideoCover(item).catch(error => show(error.message)); });
  $('#vault-menu-move').onclick = () => { closeModal(); moveItemForm(item); };
  $('#vault-menu-restore-moment')?.addEventListener('click', () => restoreVaultVideoPrompt(item));
  $('#vault-menu-export')?.addEventListener('click', () => { closeModal(); exportVaultItemPrompt(item); });
  $('#vault-menu-delete').onclick = () => { closeModal(); deleteVaultItem(item); };
}

/**
 * 「保存到相册」的确认框（2026-10-10 新增）。
 *
 * ⚠️ 这一步必须把话说清楚：导出之后这条内容就出了私密空间，任何能读相册的应用都看得到。
 *    私密空间的产品承诺是"只在本机、只有你能看"，导出是唯一一次主动打破它的动作，
 *    所以这里用警告样式单独提示，不做成一句小字。
 */
function exportVaultItemPrompt(item) {
  if (!item) return;
  const label = cleanVaultVideoTitle(item.name || '私密视频', item.date);
  const meta = [formatSize(item.size), formatVideoDuration(item.duration)].filter(Boolean).join(' · ');
  modal(`<div class="vault-export-sheet"><span class="eyebrow">SAVE TO ALBUM</span><h2>保存到相册</h2><div class="vault-export-warning"><span class="material-symbols-outlined">shield</span><span><strong>导出后不再受私密空间保护</strong><small>这段视频会写进系统相册，手机上任何能看相册的应用都能看到它。</small></span></div><div class="vault-export-meta"><strong>${esc(label)}</strong><small>${esc(meta || '私密视频')}</small></div><p class="vault-export-note">原件仍留在私密空间，这里只是另存一份，不会被移走。存出来之后，想剪短时长或裁画面，用手机自带的编辑功能就行。</p><div class="modal-actions"><button type="button" data-close>取消</button><button class="save" id="vault-export-confirm">保存到相册</button></div></div>`, 'vault-export-modal');
  $('#vault-export-confirm').onclick = () => exportVaultItem(item);
}

async function exportVaultItem(item) {
  const button = $('#vault-export-confirm');
  const restore = () => { if (button) { button.disabled = false; button.textContent = '保存到相册'; } };
  if (button) { button.disabled = true; button.textContent = '正在保存…'; }
  try {
    const result = await exportVaultItemToGallery(item, privateVaultKey());
    closeModal();
    show(result?.album ? `已保存到相册 · ${result.album}` : '已保存到相册');
  } catch (error) {
    restore();
    show(error?.message || '保存到相册失败');
  }
}

function restorableVaultVideo(item) {
  return Boolean(item?.type === 'video' && (item.sourceType === 'hls' ? /^https?:\/\//.test(item.remoteUrl || '') : /^mine-(?:media|browser-media):\/\//.test(item.assetRef || '')));
}

function restoreVaultVideoPrompt(item) {
  modal(`<div class="vault-restore-moment"><span class="eyebrow">RETURN TO MOMENTS</span><h2>恢复到随手拍？</h2><p>恢复后，这段视频会重新出现在普通随手拍、当天活动和日历中，不再只在私密空间可见。</p><div class="modal-actions"><button type="button" data-close>取消</button><button type="button" class="save" id="confirm-vault-restore-moment">确认恢复</button></div></div>`, 'vault-restore-moment-modal');
  $('#confirm-vault-restore-moment')?.addEventListener('click', () => restoreVaultVideoToMoments(item).catch(error => show(error.message)));
}

async function restoreVaultVideoToMoments(item) {
  if (!restorableVaultVideo(item) || !privateVaultUnlocked()) throw new Error('这段视频无法恢复到随手拍');
  const content = privateVaultContent();
  const previousSnippets = structuredClone(state.snippets);
  const previousItems = structuredClone(content.items);
  const previousFolders = structuredClone(content.folders);
  const source = item.sourceType === 'hls' ? item.remoteUrl : item.assetRef;
  const video = {
    video: source,
    poster: /^mine-(?:media|browser-media):\/\//.test(item.posterRef || '') ? item.posterRef : '',
    ...(item.sourceType === 'hls' ? { sourceType: 'hls' } : {}),
    label: cleanVaultVideoTitle(item.name || '私密视频', item.date),
    duration: item.duration || 0,
    width: item.width || 0,
    height: item.height || 0,
    contentLeft: item.contentLeft || 0,
    contentRight: item.contentRight || 0,
    contentAspect: item.contentAspect || 0,
    displayOrientation: item.displayOrientation || '',
    displayAnalysisVersion: item.displayAnalysisVersion || 0,
    coverTime: item.coverTime || 0
  };
  try {
    let entry = item.sourceSnippetId ? state.snippets.find(record => record.id === item.sourceSnippetId && record.type === 'photo') : null;
    entry ||= state.snippets.find(record => (record.videos || []).some(existing => existing.video === source));
    const alreadyPresent = entry && (entry.videos || []).some(existing => existing.video === source);
    if (entry && !alreadyPresent && (entry.videos || []).length < 60) {
      const restored = makeSnippet({ ...entry, videos: [...(entry.videos || []), video], updatedAt: Date.now() });
      state.snippets = state.snippets.map(record => record.id === entry.id ? restored : record);
    } else if (!alreadyPresent) {
      state.snippets.unshift(makeSnippet({ type: 'photo', date: item.date, text: item.note, videos: [video], createdAt: item.createdAt, updatedAt: Date.now() }));
    }
    content.items = content.items.filter(record => record.id !== item.id);
    const coverFolder = content.folders.find(folder => folder.coverItemId === item.id);
    if (coverFolder) coverFolder.coverItemId = '';
    touchFolder(item.folderId);
    await persistPrivateVault(state);
    await save();
    thumbnailUrls.delete(item.id);
    decryptedVideoUrls.delete(item.id);
    closeModal(); render(); show('视频已恢复到随手拍');
  } catch (error) {
    state.snippets = previousSnippets;
    const current = privateVaultContent();
    current.items = previousItems;
    current.folders = previousFolders;
    await persistPrivateVault(state).then(() => save()).catch(() => {});
    throw error;
  }
}

function deleteVaultItem(item) {
  if (!item) return;
  confirmDelete(`永久删除私密文件「${item.name}」？`, async () => {
    touchFolder(item.folderId);
    const folder = privateVaultContent().folders.find(entry => entry.coverItemId === item.id);
    if (folder) folder.coverItemId = '';
    privateVaultContent().items = privateVaultContent().items.filter(entry => entry.id !== item.id);
    await deleteVaultAssets([item.assetRef, item.posterRef]);
    thumbnailUrls.delete(item.id);
    decryptedVideoUrls.delete(item.id);
    await persistPrivateVault(state); await save(); render();
  });
}

function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function loadThumbnails() {
  if (!privateVaultUnlocked()) return;
  const key = privateVaultKey();
  let metadataChanged = false;
  for (const image of $$('[data-open-vault-item]')) {
    const id = image.dataset.openVaultItem;
    if (thumbnailUrls.has(id)) continue;
    const item = privateVaultContent().items.find(entry => entry.id === id);
    if (!item) continue;
    try {
      const url = await openVaultAsset(item, key, { poster: Boolean(item.posterRef) });
      if (!privateVaultUnlocked()) return;
      thumbnailUrls.set(id, url);
      const target = $(`[data-open-vault-item="${id}"] .vault-media-box`);
      target?.querySelector('.vault-media-loading')?.remove();
      if (target && !target.querySelector('img')) target.insertAdjacentHTML('afterbegin', `${item.type === 'video' ? `<img class="photo-blur-pad" src="${esc(url)}" alt="" aria-hidden="true">` : ''}<img src="${esc(url)}" alt="${esc(item.name)}">`);
      if (item.type === 'video' && (!item.duration || !item.displayOrientation) && item.sourceType !== 'hls' && /^mine-(?:media|browser-media):\/\//.test(item.assetRef || '')) {
        const metadata = await readVideoMetadata(await vaultVideoSource(item));
        if (metadata.duration || metadata.displayOrientation) {
          item.duration = metadata.duration || item.duration || 0;
          item.width = metadata.width;
          item.height = metadata.height;
          item.displayOrientation = metadata.displayOrientation || '';
          target?.classList.toggle('is-portrait-video-cover', vaultItemOrientation(item) === 'portrait');
          metadataChanged = true;
          const stamp = $(`[data-vault-duration="${item.id}"]`);
          if (stamp && item.duration) stamp.textContent = formatVideoDuration(vaultPlayableDuration(item));
        }
      }
    } catch { /* 单项损坏不暴露其他私密条目 */ }
  }
  if (metadataChanged && privateVaultUnlocked()) {
    await persistPrivateVault(state);
    await save();
  }
}

async function loadFolderCovers() {
  if (!privateVaultUnlocked()) return;
  for (const cover of $$('[data-vault-cover-item]')) {
    const id = cover.dataset.vaultCoverItem;
    const item = privateVaultContent().items.find(entry => entry.id === id);
    if (!item || cover.querySelector('img')) continue;
    try {
      const source = thumbnailUrls.get(id) || await openVaultAsset(item, privateVaultKey(), { poster: Boolean(item.posterRef) });
      thumbnailUrls.set(id, source);
      if (cover.isConnected && !cover.querySelector('img')) cover.innerHTML = vaultCoverImage(source);
    } catch {}
  }
}

function openVaultImportMode() {
  const native = Capacitor.isNativePlatform();
  modal(`<div class="vault-import-mode"><span class="eyebrow">PRIVATE IMPORT</span><h2>批量加入私密空间</h2><p>两种方式都会先完整保存私密副本。选择“移入”时，只有成功保存的项目才会请求删除相册原件。</p><button type="button" id="vault-import-copy"><span class="material-symbols-outlined">content_copy</span><span><strong>复制到私密空间</strong><small>相册原件继续保留</small></span></button><button type="button" id="vault-import-move" ${native ? '' : 'disabled'}><span class="material-symbols-outlined">drive_file_move</span><span><strong>移入私密空间</strong><small>${native ? '保存完成后由Android确认删除原件' : '仅Android安装包支持删除相册原件'}</small></span></button><div class="modal-actions"><button type="button" data-close>取消</button></div></div>`, 'vault-import-mode-modal');
  $('#vault-import-copy')?.addEventListener('click', () => { closeModal(); importVaultMedia().catch(error => show(error.message)); });
  $('#vault-import-move')?.addEventListener('click', () => { closeModal(); importVaultMedia({ deleteOriginals: true }).catch(error => show(error.message)); });
}

async function importVaultMedia({ deleteOriginals = false } = {}) {
  if (!privateVaultUnlocked()) return;
  const picked = await withAuthorizedExternalUi(pickPrivateFiles);
  if (!picked.length) return;
  openVaultImportProgress(picked.length);
  await waitForVaultPaint();
  const key = privateVaultKey();
  const failures = [];
  const originalUris = [];
  const importedItems = [];
  let imported = 0;
  for (let index = 0; index < picked.length; index += 1) {
    const input = picked[index];
    let stored = null;
    let poster = null;
    let addedItem = null;
    let motionRef = '';
    updateVaultImportProgress(index, picked.length, input.name || `文件 ${index + 1}`, imported, failures.length);
    await waitForVaultPaint();
    try {
      const preview = await previewFile(input);
      const type = String(input.mimeType || input.type || '').startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(input.name || '') ? 'video' : 'photo';
      let videoMetadata = {};
      const photoFile = type === 'photo' ? (preview instanceof File ? preview : await sourceToFile(preview, input)) : null;
      const posterData = type === 'video' ? await captureVideoFrame(preview, { maxSide: VAULT_POSTER_MAX_SIDE, quality: .84, onMetadata: value => { videoMetadata = value; } }) : await compressSnippetPhoto(photoFile);
      stored = await encryptVaultFile(input, key);
      poster = await encryptVaultPoster(posterData, key);
      // 用已经复制进应用目录的原件切视频。网页预览拿到的那份有时会被系统压成静图。
      if (type === 'photo' && stored?.assetRef) motionRef = await saveMotionFromMediaRef(stored.assetRef);
      addedItem = { id: crypto.randomUUID(), folderId: activeFolderId, ...stored, ...poster, ...videoMetadata, ...(motionRef ? { motionRef } : {}), createdAt: Date.now() };
      privateVaultContent().items.push(addedItem);
      touchFolder(activeFolderId);
      await persistPrivateVault(state);
      await save();
      await verifyImportedVaultItems([addedItem]);
      imported += 1;
      importedItems.push(addedItem);
      if (deleteOriginals && typeof input.path === 'string' && input.path.startsWith('content://')) originalUris.push(input.path);
    } catch (error) {
      if (addedItem) {
        const current = privateVaultContent();
        current.items = current.items.filter(item => item.id !== addedItem.id);
      }
      await deleteVaultAssets([stored?.assetRef, poster?.posterRef, motionRef].filter(Boolean), { force: true });
      await persistPrivateVault(state).then(() => save()).catch(() => {});
      failures.push({ name: input.name || `文件 ${index + 1}`, message: error?.message || '导入失败' });
    }
    await waitForVaultPaint();
  }
  updateVaultImportProgress(picked.length, picked.length, '', imported, failures.length);
  let deletionMessage = '';
  if (deleteOriginals && failures.length) {
    deletionMessage = `有 ${failures.length} 项未成功，为保护原件，本批次没有删除任何相册视频。`;
  } else if (deleteOriginals && originalUris.length) {
    try {
      await verifyImportedVaultItems(importedItems);
      await persistPrivateVault(state);
      await save();
      const result = await withAuthorizedExternalUi(() => NativeMediaStore.deleteOriginalMedia({ uris: originalUris }));
      deletionMessage = `Android 已确认删除 ${Number(result?.deleted) || originalUris.length} 个相册原件。`;
    } catch (error) {
      deletionMessage = `私密副本已保存；相册原件未删除：${error?.message || '系统未授权删除'}`;
    }
  } else if (deleteOriginals && imported) {
    deletionMessage = '私密副本已保存；这些文件并非来自可删除的本机系统相册，原件已保留。';
  }
  closeModal();
  render();
  if (failures.length || deletionMessage) return showVaultImportResult(imported, failures, deletionMessage);
  show(`已批量导入 ${imported} 个私密文件`);
}

async function verifyImportedVaultItems(items) {
  const current = privateVaultContent();
  const records = new Map((current?.items || []).map(item => [item.id, item]));
  const persistedRefs = new Set(state.privateVault?.assetRefs || []);
  for (const expected of items) {
    const record = records.get(expected.id);
    if (!record) throw new Error(`私密记录复核失败：${expected.name || '未命名文件'}`);
    for (const ref of [record.assetRef, record.posterRef, record.motionRef].filter(Boolean)) {
      if (!persistedRefs.has(ref)) throw new Error(`私密索引复核失败：${record.name || '未命名文件'}`);
      if (await mediaReferenceSize(ref) <= 0) throw new Error(`私密文件复核失败：${record.name || '未命名文件'}`);
    }
  }
  return true;
}

function openVaultImportProgress(total) {
  modal(`<div class="vault-import-progress"><span class="material-symbols-outlined">video_file</span><small>BATCH IMPORT</small><h2>正在批量导入</h2><strong id="vault-import-progress-copy">准备处理 ${total} 个文件</strong><progress id="vault-import-progress-meter" max="${total}" value="0"></progress><p id="vault-import-current">视频和照片会逐个处理，避免同时占用大量内存。</p><em id="vault-import-counts">成功 0 · 失败 0</em></div>`, 'vault-import-progress-modal');
}

function updateVaultImportProgress(completed, total, name, imported, failed) {
  const copy = $('#vault-import-progress-copy');
  const meter = $('#vault-import-progress-meter');
  const current = $('#vault-import-current');
  const counts = $('#vault-import-counts');
  if (copy) copy.textContent = completed >= total ? `已处理 ${total} / ${total}` : `正在处理 ${completed + 1} / ${total}`;
  if (meter) meter.value = completed;
  if (current) current.textContent = completed >= total ? '批量导入处理完成' : name;
  if (counts) counts.textContent = `成功 ${imported} · 失败 ${failed}`;
}

function waitForVaultPaint() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function showVaultImportResult(imported, failures, deletionMessage = '') {
  modal(`<div class="vault-import-result"><span class="material-symbols-outlined">${imported ? 'task_alt' : 'error'}</span><h2>批量导入完成</h2><p>成功 ${imported} 个，失败 ${failures.length} 个。成功文件已经保存，不会因个别文件失败而丢失。</p>${deletionMessage ? `<p class="vault-import-delete-result">${esc(deletionMessage)}</p>` : ''}${failures.length ? `<div>${failures.slice(0, 12).map(item => `<span><strong>${esc(item.name)}</strong><small>${esc(item.message)}</small></span>`).join('')}</div>` : ''}${failures.length > 12 ? `<small>另有 ${failures.length - 12} 个失败文件未展开</small>` : ''}<div class="modal-actions"><button type="button" data-close>知道了</button></div></div>`, 'vault-import-result-modal');
}

function momentVaultCandidates() {
  const candidates = [];
  (state.snippets || []).filter(entry => entry.type === 'photo').sort((a, b) => b.createdAt - a.createdAt).forEach(entry => {
    const photos = entry.photos?.length ? entry.photos : (entry.photo ? [entry.photo] : []);
    photos.forEach((source, index) => {
      if (source) candidates.push({ id: `${entry.id}:photo:${index}`, entry, kind: 'photo', index, source, poster: source, motion: (entry.livePhotos || []).find(item => item.still === source)?.video || '', name: `随手拍 ${entry.date} · 照片 ${index + 1}` });
    });
    (entry.videos || []).forEach((video, index) => {
      if (video?.video) candidates.push({ id: `${entry.id}:video:${index}`, entry, kind: 'video', index, source: video.video, poster: video.poster || '', sourceType: video.sourceType || '', duration: Number(video.duration) || 0, width: Number(video.width) || 0, height: Number(video.height) || 0, contentLeft: Number(video.contentLeft) || 0, contentRight: Number(video.contentRight) || 0, contentAspect: Number(video.contentAspect) || 0, displayOrientation: video.displayOrientation || '', name: video.label || `随手拍 ${entry.date} · 视频 ${index + 1}` });
    });
  });
  return candidates;
}

function openMomentVaultPicker() {
  const candidates = momentVaultCandidates();
  const folders = privateVaultContent().folders;
  modal(`<div class="vault-moment-picker"><span class="eyebrow">FROM MOMENTS</span><h2>选择随手拍照片与视频</h2><p>复制会保留原随手拍；“移入并隐藏”仅在全部加密成功后删除原内容。</p><label class="vault-destination">放入文件夹<select id="vault-moment-folder"><option value="">未分类</option>${folders.map(folder => `<option value="${folder.id}" ${folder.id === activeFolderId ? 'selected' : ''}>${esc(folder.name)}</option>`).join('')}</select></label><div class="vault-moment-list">${candidates.length ? candidates.map(candidate => `<label class="vault-moment-item"><input type="checkbox" data-vault-moment="${esc(candidate.id)}"><span class="vault-moment-preview">${candidate.poster ? `<img src="${imgSrc(candidate.poster)}" alt="">` : `<span class="material-symbols-outlined">${candidate.sourceType === 'hls' ? 'stream' : 'movie'}</span>`}${candidate.kind === 'video' ? '<i class="material-symbols-outlined">play_arrow</i>' : ''}</span><span><strong>${esc(candidate.name)}</strong><small>${esc(candidate.entry.text || (candidate.kind === 'video' ? '视频' : '照片'))}</small><em>${candidate.entry.date}</em></span></label>`).join('') : '<div class="vault-moment-empty">Moments中还没有可加入的照片或视频</div>'}</div><div class="modal-actions"><button type="button" data-close>取消</button><button type="button" id="vault-copy-moments" ${candidates.length ? '' : 'disabled'}>复制到私密空间</button><button type="button" class="save" id="vault-move-moments" ${candidates.length ? '' : 'disabled'}>移入并隐藏</button></div></div>`, 'vault-moment-picker-modal');
  const transferCopy = $('.vault-moment-picker>p');
  if (transferCopy) transferCopy.textContent = '复制会保留原随手拍；“移入并隐藏”仅在全部私密保存成功后删除原内容。';
  $('#vault-copy-moments')?.addEventListener('click', () => transferMomentsToVault(candidates, false).catch(error => show(error.message)));
  $('#vault-move-moments')?.addEventListener('click', () => transferMomentsToVault(candidates, true).catch(error => show(error.message)));
}

async function transferMomentsToVault(candidates, move) {
  const selected = new Set($$('[data-vault-moment]:checked').map(input => input.dataset.vaultMoment));
  const chosen = candidates.filter(candidate => selected.has(candidate.id));
  if (!chosen.length) throw new Error('请至少选择一张照片或一段视频');
  const destination = $('#vault-moment-folder')?.value || '';
  const content = privateVaultContent();
  const previousSnippets = structuredClone(state.snippets);
  const previousItems = structuredClone(content.items);
  const createdRefs = [];
  const added = [];
  show(`正在私密保存 ${chosen.length} 项随手拍素材…`);
  try {
    for (const candidate of chosen) {
      if (candidate.sourceType === 'hls') {
        added.push({ id: crypto.randomUUID(), folderId: destination, type: 'video', name: candidate.name, mime: 'application/vnd.apple.mpegurl', size: 0, assetRef: '', assetIv: '', posterRef: '', posterIv: '', sourceType: 'hls', remoteUrl: candidate.source, duration: candidate.duration || 0, date: candidate.entry.date, note: candidate.entry.text || '', sourceModule: 'moments', sourceSnippetId: candidate.entry.id, sourceVideoIndex: candidate.index, createdAt: candidate.entry.createdAt || Date.now() });
        continue;
      }
      const mime = candidate.kind === 'video' ? mimeForVideo(candidate.source) : 'image/jpeg';
      const stored = await encryptExistingVaultMedia(candidate.source, { name: candidate.name + extensionForMime(mime), mime, type: candidate.kind }, privateVaultKey());
      if (!stored.reused) createdRefs.push(stored.assetRef);
      let poster = {};
      if (candidate.kind === 'video' && candidate.poster) {
        poster = await encryptExistingVaultPoster(candidate.poster, privateVaultKey());
        if (poster.posterRef && !poster.reused) createdRefs.push(poster.posterRef);
      }
      added.push({ id: crypto.randomUUID(), folderId: destination, ...stored, ...poster, ...(candidate.kind === 'photo' && candidate.motion ? { motionRef: candidate.motion } : {}), sourceType: '', remoteUrl: '', duration: candidate.duration || 0, width: candidate.width || 0, height: candidate.height || 0, contentLeft: candidate.contentLeft || 0, contentRight: candidate.contentRight || 0, contentAspect: candidate.contentAspect || 0, displayOrientation: candidate.displayOrientation || '', date: candidate.entry.date, note: candidate.entry.text || '', sourceModule: 'moments', sourceSnippetId: candidate.entry.id, sourceVideoIndex: candidate.index, createdAt: candidate.entry.createdAt || Date.now() });
    }
    content.items.push(...added);
    touchFolder(destination);
    if (move) {
      removeTransferredMomentMedia(chosen);
      await redactSnapshotMediaReferences(chosen.flatMap(candidate => [candidate.source, candidate.poster, candidate.motion]).filter(Boolean));
    }
    await persistPrivateVault(state);
    await save();
    closeModal(); render();
    show(move ? `已将 ${added.length} 项移入私密空间并从日常隐藏` : `已复制 ${added.length} 项到私密空间`);
  } catch (error) {
    content.items = previousItems;
    state.snippets = previousSnippets;
    await deleteVaultAssets(createdRefs, { force: true });
    await persistPrivateVault(state).catch(() => {});
    throw error;
  }
}

function removeTransferredMomentMedia(chosen) {
  const byEntry = new Map();
  chosen.forEach(candidate => {
    const record = byEntry.get(candidate.entry.id) || { photos: new Set(), videos: new Set() };
    record[candidate.kind === 'video' ? 'videos' : 'photos'].add(candidate.index);
    byEntry.set(candidate.entry.id, record);
  });
  state.snippets = state.snippets.flatMap(entry => {
    const remove = byEntry.get(entry.id);
    if (!remove) return [entry];
    const photos = (entry.photos?.length ? entry.photos : (entry.photo ? [entry.photo] : [])).filter((_, index) => !remove.photos.has(index));
    const videos = (entry.videos || []).filter((_, index) => !remove.videos.has(index));
    const livePhotos = (entry.livePhotos || []).filter(item => photos.includes(item.still));
    if (!photos.length && !videos.length) return [];
    return [{ ...entry, photos, photo: photos[0] || '', videos, livePhotos, updatedAt: Date.now() }];
  });
}

function mimeForVideo(source) {
  const extension = String(source || '').split(/[?#]/)[0].split('.').pop().toLowerCase();
  return { webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska' }[extension] || 'video/mp4';
}
const extensionForMime = mime => ({ 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/x-matroska': '.mkv', 'video/mp4': '.mp4' }[mime] || '.jpg');

async function pickPrivateFiles() {
  if (Capacitor.isNativePlatform()) {
    const result = await NativeMediaStore.pickPrivateMedia();
    const files = result.files || [];
    if (files.length > 100) throw new Error('一次最多导入 100 个私密文件');
    return files;
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*,video/*'; input.multiple = true;
    input.onchange = () => {
      const files = [...(input.files || [])];
      if (files.length > 100) reject(new Error('一次最多导入 100 个私密文件'));
      else resolve(files);
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

async function withAuthorizedExternalUi(operation) {
  externalUiDepth += 1;
  clearTimeout(pendingVisibilityLock);
  try { return await operation(); }
  finally {
    setTimeout(() => {
      externalUiDepth = Math.max(0, externalUiDepth - 1);
      if (document.visibilityState === 'hidden') scheduleVisibilityLock();
    }, 350);
  }
}

const previewFile = input => input instanceof File ? input : Capacitor.convertFileSrc(input.path || input.webPath || '');
async function sourceToFile(source, input) {
  const response = await fetch(source);
  if (!response.ok) throw new Error('无法读取所选照片');
  const blob = await response.blob();
  return new File([blob], input.name || 'private-photo.jpg', { type: input.mimeType || blob.type || 'image/jpeg' });
}

function folderForm(folder = null) {
  const content = privateVaultContent();
  // 封面按钮的显示条件按「含子孙」的总数判断：只有子文件夹的父夹同样能设封面。
  const scope = folder ? new Set([folder.id, ...vaultFolderDescendants(folder.id, content.folders)]) : new Set();
  const count = folder ? content.items.filter(item => scope.has(item.folderId)).length : 0;
  const choices = vaultFolderParentChoices(content.folders, folder);
  // 新建时默认落在当前正打开的文件夹里，少点一次。
  const currentParent = folder ? vaultFolderParent(folder) : String(activeFolderId || '');
  const parentField = choices.length
    ? `<label>放在哪个文件夹里</label><select name="parentId"><option value="">（最外层）</option>${choices.map(choice => `<option value="${choice.id}" ${choice.id === currentParent ? 'selected' : ''}>${esc(choice.label)}</option>`).join('')}</select>`
    : '';
  modal(`<form id="vault-folder-form"><input type="hidden" name="id" value="${folder?.id || ''}"><span class="eyebrow">PRIVATE FOLDER</span><h2>${folder ? '管理私密文件夹' : '新建私密文件夹'}</h2><label>文件夹名称</label><input name="name" maxlength="40" required value="${esc(folder?.name || '')}" autofocus>${parentField}${folder && count ? '<button type="button" class="vault-folder-cover-button" id="vault-folder-cover"><span class="material-symbols-outlined">photo_library</span>设置文件夹封面</button>' : ''}<div class="modal-actions">${folder ? '<button type="button" class="danger" id="vault-delete-folder">删除文件夹</button>' : ''}<button type="button" data-close>取消</button><button class="save">保存</button></div></form>`, 'vault-form-modal');
  $('#vault-folder-cover')?.addEventListener('click', () => { closeModal(); folderCoverPicker(folder); });
  $('#vault-delete-folder')?.addEventListener('click', () => confirmDelete(`删除私密文件夹「${folder.name}」？里面的内容会移到“未分类”，子文件夹会上移到上一级。`, async () => {
    const content = privateVaultContent();
    const parentId = vaultFolderParent(folder);
    // 子文件夹上移而不是连带消失 —— 删除一个空壳不该毁掉它下面整棵子树。
    content.folders.forEach(item => {
      if (vaultFolderParent(item) === folder.id) { item.parentId = parentId; item.updatedAt = Date.now(); }
    });
    content.folders = content.folders.filter(item => item.id !== folder.id);
    content.items.forEach(item => { if (item.folderId === folder.id) item.folderId = ''; });
    if (parentId && content.folders.some(item => item.id === parentId)) {
      activeFolderId = parentId; vaultBrowseMode = 'folder';
    } else {
      activeFolderId = ''; vaultBrowseMode = 'folders';
    }
    await persistPrivateVault(state); await save(); closeModal(); render();
  }));
}

function folderCoverPicker(folder) {
  // 候选含子孙文件夹的内容，和 folderCard 的自动封面口径保持一致。
  const scope = new Set([folder.id, ...vaultFolderDescendants(folder.id, privateVaultContent().folders)]);
  const items = privateVaultContent().items.filter(item => scope.has(item.folderId) && (item.posterRef || item.type === 'photo'));
  modal(`<div class="vault-folder-cover-picker"><span class="eyebrow">ALBUM COVER</span><h2>选择「${esc(folder.name)}」的封面</h2><div>${items.map(item => `<button data-folder-cover-choice="${item.id}" aria-label="使用${esc(item.name)}作为封面"><span class="vault-folder-cover" data-vault-cover-item="${item.id}">${thumbnailUrls.get(item.id) ? vaultCoverImage(thumbnailUrls.get(item.id)) : '<span class="material-symbols-outlined">image</span>'}</span></button>`).join('')}</div><div class="modal-actions"><button type="button" id="vault-cover-auto">自动选择最近内容</button><button data-close>取消</button></div></div>`, 'vault-folder-cover-modal');
  const chooseCover = async id => {
    if (!privateVaultUnlocked()) return;
    const previous = { ...folder }, previousVault = structuredClone(state.privateVault);
    try { folder.coverItemId = id; folder.updatedAt = Date.now(); await persistPrivateVault(state); await save(); closeModal(); render(); }
    catch (error) { Object.assign(folder, previous); state.privateVault = previousVault; show(error.message); }
  };
  $$('[data-folder-cover-choice]').forEach(button => button.onclick = () => chooseCover(button.dataset.folderCoverChoice));
  $('#vault-cover-auto').onclick = () => chooseCover('');
  loadFolderCovers();
}

function moveItemForm(item) {
  const folders = privateVaultContent().folders;
  // 用完整路径而不是裸名称：层级里常有同名文件夹，只有路径能分清。
  const options = [...folders]
    .map(folder => ({ id: folder.id, label: vaultFolderPath(folder, folders) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  modal(`<form id="vault-move-form"><input type="hidden" name="id" value="${item.id}"><h2>移动私密文件</h2><label>移动到</label><select name="folderId"><option value="">未分类</option>${options.map(option => `<option value="${option.id}" ${item.folderId === option.id ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select><div class="modal-actions"><button type="button" data-close>取消</button><button class="save">移动</button></div></form>`, 'vault-form-modal');
}

function bulkMoveForm() {
  const folders = privateVaultContent().folders;
  const options = [...folders]
    .map(folder => ({ id: folder.id, label: vaultFolderPath(folder, folders) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  modal(`<form id="vault-bulk-move-form"><h2>移动 ${vaultSelectedIds.size} 项私密内容</h2><label>移动到</label><select name="folderId"><option value="">未分类</option>${options.map(option => `<option value="${option.id}">${esc(option.label)}</option>`).join('')}</select><div class="modal-actions"><button type="button" data-close>取消</button><button class="save">确认移动</button></div></form>`, 'vault-form-modal');
}

function deleteSelectedVaultItems() {
  const items = privateVaultContent().items.filter(item => vaultSelectedIds.has(item.id));
  if (!items.length) return;
  confirmDelete(`永久删除选中的 ${items.length} 项私密内容？`, async () => {
    items.forEach(item => { touchFolder(item.folderId); const folder = privateVaultContent().folders.find(entry => entry.coverItemId === item.id); if (folder) folder.coverItemId = ''; });
    privateVaultContent().items = privateVaultContent().items.filter(item => !vaultSelectedIds.has(item.id));
    await deleteVaultAssets(items.flatMap(item => [item.assetRef, item.posterRef]).filter(Boolean));
    items.forEach(item => { thumbnailUrls.delete(item.id); decryptedVideoUrls.delete(item.id); });
    vaultSelectedIds.clear(); vaultSelectionMode = false;
    await persistPrivateVault(state); await save(); render();
  });
}

function touchFolder(folderId) { const folder = privateVaultContent().folders.find(item => item.id === folderId); if (folder) folder.updatedAt = Date.now(); }

function vaultPhotosForCurrentFolder() {
  return vaultItemsForBrowseScope().filter(item => item.type === 'photo');
}

function currentVaultPhotoScopeLabel() {
  if (vaultBrowseMode === 'unfiled') return '未分类';
  if (vaultBrowseMode === 'folder') return privateVaultContent().folders.find(folder => folder.id === activeFolderId)?.name || '当前文件夹';
  return '全部照片';
}

async function vaultPhotoSource(item) {
  if (thumbnailUrls.has(item.id)) return thumbnailUrls.get(item.id);
  const source = await openVaultAsset(item, privateVaultKey());
  thumbnailUrls.set(item.id, source);
  return source;
}

async function openVaultPhoto(item, providedItems = null, providedIndex = -1) {
  const items = providedItems || vaultPhotosForCurrentFolder();
  const index = providedIndex >= 0 ? providedIndex : items.findIndex(entry => entry.id === item?.id);
  if (!item || index < 0 || !privateVaultUnlocked()) return;
  if (!thumbnailUrls.has(item.id)) showVaultPreparing(item, '正在安全读取原图…', 'image');
  const source = await vaultPhotoSource(item);
  if (!privateVaultUnlocked() || state.route !== 'private-vault') return closeModal();
  const motion = item.motionRef ? await resolveMediaReference(item.motionRef).catch(() => '') : '';
  renderVaultPhotoViewer(items, index, source, motion);
  if (items.length > 1) {
    [items[(index - 1 + items.length) % items.length], items[(index + 1) % items.length]].forEach(neighbor => vaultPhotoSource(neighbor).catch(() => {}));
  }
}

function renderVaultPhotoViewer(items, index, source, motion = '') {
  const item = items[index];
  const details = [item.date || '', formatSize(item.size), motion ? '实况' : ''].filter(Boolean).join(' · ');
  const frame = motion
    ? `<video id="vault-photo-image" class="is-live-photo" src="${esc(motion)}" poster="${esc(source)}" autoplay loop muted controls playsinline></video>`
    : `<img id="vault-photo-image" src="${esc(source)}" alt="${esc(item.name || '私密照片')}，第 ${index + 1} 张，共 ${items.length} 张" draggable="false">`;
  modal(`<div class="vault-photo-viewer" id="vault-photo-viewer"><div class="vault-photo-stage" id="vault-photo-stage">${frame}</div><div class="vault-photo-chrome" id="vault-photo-chrome"><header><button type="button" data-close aria-label="返回资料库"><span class="material-symbols-outlined">arrow_back</span></button><span><strong>${esc(currentVaultPhotoScopeLabel())}</strong><small>${index + 1} / ${items.length}</small></span><i aria-hidden="true"></i></header><footer><strong>${esc(item.name || '私密照片')}</strong>${details ? `<small>${esc(details)}</small>` : ''}</footer></div><div class="vault-photo-loading" id="vault-photo-loading" hidden><span class="material-symbols-outlined">progress_activity</span></div></div>`, 'photo-modal vault-photo-modal');
  if (motion) $('#vault-photo-image')?.play?.().catch(() => {});
  bindVaultPhotoGestures(items, index);
}

function bindVaultPhotoGestures(items, active) {
  const stage = $('#vault-photo-stage'), image = $('#vault-photo-image'), chrome = $('#vault-photo-chrome'), loading = $('#vault-photo-loading');
  if (!stage || !image || !chrome) return;
  const pointers = new Map();
  let scale = 1, x = 0, y = 0, startDistance = 0, startScale = 1, startX = 0, startY = 0, moved = false, lastTap = 0, navigating = false;
  let longMode = false, baseHeight = 0;
  const scheduleChromeHide = () => {
    clearTimeout(vaultPhotoChromeTimer);
    vaultPhotoChromeTimer = setTimeout(() => { if (chrome.isConnected) chrome.classList.add('hidden'); }, 1100);
  };
  const clampView = () => {
    const rect = stage.getBoundingClientRect();
    const next = clampStillTransform({ longMode, baseHeight, scale, x, y, width: rect.width, height: rect.height });
    scale = next.scale; x = next.x; y = next.y;
    image.style.transform = `translate3d(${x}px,${y}px,0) scale(${scale})`;
    image.classList.toggle('zoomed', scale > 1);
  };
  const refreshLongImage = () => {
    const rect = stage.getBoundingClientRect?.() || { width: 0, height: 0 };
    const measured = measureLongStill(image, rect.width, rect.height);
    longMode = measured.long;
    baseHeight = measured.baseHeight;
    stage.classList?.toggle?.('is-long-image', longMode);
    if (longMode) clampView();
  };
  const navigate = async next => {
    if (navigating || items.length <= 1) return;
    const wrapped = (next + items.length) % items.length;
    navigating = true;
    loading.hidden = false;
    try { await openVaultPhoto(items[wrapped], items, wrapped); }
    catch (error) { if (loading.isConnected) loading.hidden = true; show(error.message); }
  };
  stage.onpointerdown = event => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    startX = event.clientX; startY = event.clientY; moved = false;
    stage.setPointerCapture?.(event.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      startDistance = Math.hypot(a.x - b.x, a.y - b.y); startScale = scale;
    }
  };
  stage.onpointermove = event => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
    if (Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY) > 5) moved = true;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      scale = Math.max(1, Math.min(5, startScale * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, startDistance)));
    } else if (scale > 1) { x += dx; y += dy; }
    else if (longMode) {
      const totalX = event.clientX - startX, totalY = event.clientY - startY;
      if (Math.abs(totalX) > 58 && Math.abs(totalX) > Math.abs(totalY) * 1.15) return;
      y += dy;
    }
    clampView();
  };
  const release = event => pointers.delete(event.pointerId);
  stage.onpointerup = event => {
    release(event);
    const totalX = event.clientX - startX, totalY = event.clientY - startY;
    if (scale === 1 && Math.abs(totalX) > 58 && Math.abs(totalX) > Math.abs(totalY) * 1.15) return navigate(totalX < 0 ? active + 1 : active - 1);
    if (moved) return;
    const now = Date.now();
    if (now - lastTap < 280) {
      clearTimeout(vaultPhotoChromeTimer);
      const nextScale = scale > 1 ? 1 : 2.5;
      if (longMode && baseHeight > 0) {
        const rect = stage.getBoundingClientRect();
        const anchor = (-y + rect.height / 2) / Math.max(scale, 1);
        scale = nextScale;
        y = rect.height / 2 - anchor * nextScale;
        x = 0;
      } else scale = nextScale;
      clampView(); lastTap = 0;
    } else {
      lastTap = now;
      setTimeout(() => {
        if (lastTap !== now || !chrome.isConnected) return;
        chrome.classList.toggle('hidden');
        if (!chrome.classList.contains('hidden')) scheduleChromeHide();
      }, 290);
    }
  };
  stage.onpointercancel = release;
  stage.onwheel = event => {
    event.preventDefault();
    if (longMode && scale <= 1 && !event.ctrlKey && !event.metaKey) { y -= event.deltaY; clampView(); return; }
    scale = Math.max(1, Math.min(5, scale + (event.deltaY < 0 ? .25 : -.25)));
    clampView();
  };
  if (typeof image.addEventListener === 'function') image.addEventListener('load', refreshLongImage);
  if (image.complete && image.naturalWidth) refreshLongImage();
  scheduleChromeHide();
}

async function openItem(item) {
  if (!item || !privateVaultUnlocked()) return;
  if (item.type === 'video') return openVaultVideo(item, null, -1, '', true);
  return openVaultPhoto(item);
}

async function vaultVideoSource(item) {
  if (item.sourceType === 'hls') return item.remoteUrl;
  if (decryptedVideoUrls.has(item.id)) return decryptedVideoUrls.get(item.id);
  if (decryptingVideoUrls.has(item.id)) return decryptingVideoUrls.get(item.id);
  const pending = openVaultAsset(item, privateVaultKey()).then(source => {
    decryptedVideoUrls.set(item.id, source);
    return source;
  }).finally(() => decryptingVideoUrls.delete(item.id));
  decryptingVideoUrls.set(item.id, pending);
  return pending;
}

function vaultVideosForCurrentFolder() {
  return vaultItemsForBrowseScope().filter(item => item.type === 'video');
}

function shuffledVaultVideos(startId = '') {
  const videos = vaultVideosForCurrentFolder();
  for (let index = videos.length - 1; index > 0; index -= 1) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000;
    const swap = Math.floor(random * (index + 1));
    [videos[index], videos[swap]] = [videos[swap], videos[index]];
  }
  if (startId) {
    const selected = videos.findIndex(item => item.id === startId);
    if (selected > 0) [videos[0], videos[selected]] = [videos[selected], videos[0]];
  }
  return videos;
}

function currentVaultVideoScopeLabel() {
  if (vaultBrowseMode === 'unfiled') return '未分类';
  if (vaultBrowseMode === 'folder') return privateVaultContent().folders.find(folder => folder.id === activeFolderId)?.name || '当前文件夹';
  return '全部内容';
}

async function openVaultVideo(item, providedItems = null, providedIndex = -1, feedDirection = '', resetFeedAudio = false) {
  const items = providedItems || shuffledVaultVideos(item?.id || '');
  const index = providedIndex >= 0 ? providedIndex : Math.max(0, items.findIndex(entry => entry.id === item.id));
  if (item.sourceType !== 'hls' && !decryptedVideoUrls.has(item.id)) showVaultPreparing(item, decryptingVideoUrls.has(item.id) ? '相邻视频正在预载…' : '准备完成后会自动打开');
  const source = await vaultVideoSource(item);
  if (!privateVaultUnlocked() || state.route !== 'private-vault') return closeModal();
  let progressDirty = false;
  // 保存会把条目规范化。播放器必须写回当前仍在列表里的那一条，不能写到切集前拿到的旧对象上。
  const live = () => privateVaultContent()?.items?.find(entry => entry.id === item.id) || item;
  const current = live();
  callHelper('playSnippetVideo', { video: source, poster: thumbnailUrls.get(item.id) || '', label: cleanVaultVideoTitle(current.name, current.date), sourceType: current.sourceType || '', position: current.position || 0, duration: current.duration || 0, trim: current.trim || null, crop: current.crop || null }, null, index, {
    count: items.length,
    immersiveFeed: true,
    loopNavigation: true,
    resetFeedAudio,
    feedDirection,
    folders: vaultFeedFolders(),
    episodeTitle: currentVaultVideoScopeLabel(),
    episodes: items.map(entry => ({ name: cleanVaultVideoTitle(entry.name || '私密视频', entry.date), label: cleanVaultVideoTitle(entry.name || '私密视频', entry.date), poster: thumbnailUrls.get(entry.id) || '', duration: entry.duration || 0, date: entry.date || '' })),
    description: current.note || '',
    date: current.date || '',
    sourceLabel: current.sourceType === 'hls' ? '私密在线视频' : 'App私有视频',
    watchHistory: current.watchHistory || [],
    autoAdvance: false,
    onReady: ({ duration, width, height }) => {
      const record = live();
      const seconds = Math.max(0, Math.floor(Number(duration) || 0));
      if (seconds && record.duration !== seconds) { record.duration = seconds; progressDirty = true; }
      if (width && height) { record.width = width; record.height = height; }
      const stamp = $(`[data-vault-duration="${item.id}"]`);
      if (stamp && seconds) stamp.textContent = formatVideoDuration(vaultPlayableDuration(record));
    },
    onProgress: ({ position, duration }) => {
      const record = live();
      if (record.position !== position) { record.position = position; progressDirty = true; }
      const seconds = Math.max(0, Math.floor(Number(duration) || 0));
      if (seconds && record.duration !== seconds) { record.duration = seconds; progressDirty = true; }
    },
    onEnded: () => { live().position = 0; progressDirty = true; },
    onWatchSession: session => {
      const record = live();
      record.watchHistory = [...(record.watchHistory || []), session].slice(-100);
      progressDirty = true;
    },
    onClose: async () => { if (progressDirty && privateVaultUnlocked()) { await persistPrivateVault(state); await save(); } },
    onDeleteCurrent: () => deleteVaultVideoFromFeed(item, items, index),
    deleteConfirmText: '永久删除当前私密视频？删除后将清理私密媒体文件，且无法恢复。',
    onOpenLibrary: () => { vaultExperienceMode = 'library'; closeModal(); render(); },
    onFolderNavigate: (mode, id) => { vaultBrowseMode = mode; activeFolderId = id || ''; const scoped = shuffledVaultVideos(); if (scoped.length) openVaultVideo(scoped[0], scoped, 0).catch(error => show(error.message)); else show('这个文件夹还没有视频'); },
    onNavigate: (next, direction) => openVaultVideo(items[next], items, next, direction).catch(error => show(error.message))
  });
  bindVaultVideoFullscreen();
  [items[index - 1], items[index + 1]].filter(Boolean).forEach(neighbor => vaultVideoSource(neighbor).catch(() => {}));
}

async function deleteVaultVideoFromFeed(item, items, index) {
  if (!item || !privateVaultUnlocked()) throw new Error('私密空间已经锁定');
  const remaining = items.filter(entry => entry.id !== item.id);
  touchFolder(item.folderId);
  const folder = privateVaultContent().folders.find(entry => entry.coverItemId === item.id);
  if (folder) folder.coverItemId = '';
  privateVaultContent().items = privateVaultContent().items.filter(entry => entry.id !== item.id);
  await deleteVaultAssets([item.assetRef, item.posterRef].filter(Boolean));
  thumbnailUrls.delete(item.id);
  decryptedVideoUrls.delete(item.id);
  await persistPrivateVault(state);
  await save();
  closeModal();
  render();
  show('私密视频已删除');
  if (remaining.length) {
    const nextIndex = Math.min(index, remaining.length - 1);
    setTimeout(() => openVaultVideo(remaining[nextIndex], remaining, nextIndex, '', true).catch(error => show(error.message)), 0);
  }
}

function showVaultPreparing(item, hint, kind = 'video') {
  // 视频准备态铺满深色：浅色纸卡会从点击处被容器变形"长"出来，看起来就是点下去先冒一块白。
  const preparingVideo = kind !== 'image';
  modal(`<div class="vault-decrypting"><span class="material-symbols-outlined">${preparingVideo ? 'play_circle' : 'image'}</span>${thumbnailUrls.get(item.id) ? `<img src="${esc(thumbnailUrls.get(item.id))}" alt="">` : ''}<strong>正在准备「${esc(item.name)}」</strong><small>${esc(hint)}</small></div>`, preparingVideo ? 'vault-decrypting-modal vault-video-preparing' : 'vault-decrypting-modal');
}

function editVaultVideoForm(item) {
  if (!item || item.type !== 'video') return;
  modal(`<form id="vault-video-edit-form"><input type="hidden" name="id" value="${item.id}"><span class="eyebrow">PRIVATE VIDEO NOTE</span><h2>编辑私密视频</h2><label>视频名称</label><input name="name" maxlength="120" required value="${esc(item.name)}"><label>记录日期</label><input name="date" type="date" value="${esc(item.date || '')}"><label>视频说明</label><textarea name="note" maxlength="300" rows="5" placeholder="记录这段视频的故事、地点或心情……">${esc(item.note || '')}</textarea><small class="field-help">名称、日期和说明都会保存在私密加密元数据中。</small><div class="modal-actions"><button type="button" data-close>取消</button><button class="save">保存说明</button></div></form>`, 'vault-video-edit-modal');
}

/* ---------------------------------------------------------------------------
   剪辑视频（2026-10-10 新增）：剪短时长 + 框选画面，非破坏性。

   保存的只是"要播哪一段、要框哪一块"，原文件一个字节都不动 —— 随时能还原。
   画面裁剪之后封面会按取景框重新抓一帧，否则列表里还是原来那张没裁过的图。
   --------------------------------------------------------------------------- */
async function trimVaultVideo(item) {
  if (!item || item.type !== 'video') return;
  if (item.sourceType === 'hls') return show('在线视频（m3u8）暂时不支持剪辑');
  if (!privateVaultUnlocked()) throw new Error('私密空间已经锁定');
  const source = await vaultVideoSource(item);
  const previousCrop = item.crop || null;
  showVideoEditor({
    source,
    poster: thumbnailUrls.get(item.id) || '',
    duration: item.duration || 0,
    width: item.width || 0,
    height: item.height || 0,
    name: item.name,
    trim: item.trim || null,
    crop: item.crop || null,
    // 用户记过的「习惯裁掉开头 N 秒」。只有这段视频还没剪过时才会自动套用。
    trimHead: Number(state.settings?.vaultTrimHeadSeconds) || 0,
    onApply: async ({ trim, crop, trimHeadSeconds }) => {
      const cropChanged = JSON.stringify(previousCrop) !== JSON.stringify(crop || null);
      const orientationBefore = vaultItemOrientation(item);
      item.trim = trim || null;
      item.crop = crop || null;
      // ⚠️ 这一层判断不能省、也不能只写 Number.isFinite(Number(...))：
      //    null 是"这次没动过它"的哨兵，而 Number(null) === 0 恰好是个有限数 ——
      //    少了这一句，用户点「还原整段」时会被当成"把习惯改成 0 秒"，
      //    记过的长度被静默抹掉（真机上表现为"以后不再自动砍开头了"）。
      if (trimHeadSeconds !== null && trimHeadSeconds !== undefined && Number.isFinite(Number(trimHeadSeconds))) {
        state.settings.vaultTrimHeadSeconds = Math.max(0, Math.min(HABIT_HEAD_MAX_SECONDS, Math.round(Number(trimHeadSeconds))));
      }
      // 起点被剪掉之后，之前存的播放进度可能落在区间外，夹回区间内。
      const floor = trim ? Math.floor(trim.start) : 0;
      if (Number(item.position) < floor) item.position = floor;
      touchFolder(item.folderId);
      if (cropChanged) await refreshVaultPosterForCrop(item, source, crop);
      await persistPrivateVault(state);
      await save();
      render();
      // 画面被框成另一个方向之后，它会从「竖屏 / 横屏」里换一类。
      // 不告诉用户的话，他会以为这条视频不见了（列表上真的一下就空了）。
      const orientationAfter = vaultItemOrientation(item);
      const flipped = orientationBefore && orientationAfter && orientationBefore !== orientationAfter;
      if (flipped && ORIENTATION_FILTERS.has(vaultMediaFilter)) {
        show(`画面方向变成${orientationAfter === 'portrait' ? '竖屏' : '横屏'}了，已归到「${orientationAfter === 'portrait' ? '竖屏' : '横屏'}」`);
      } else if (flipped) {
        show(`已保存 · 画面方向现在是${orientationAfter === 'portrait' ? '竖屏' : '横屏'}`);
      } else {
        show(trim || crop ? '剪辑已保存' : '已还原为完整视频');
      }
    }
  });
}

/** 画面裁剪后按取景框重新抓封面（抓不到就保留旧封面，绝不打断保存）。 */
async function refreshVaultPosterForCrop(item, source, crop) {
  try {
    // coverTime 为 0 表示"没自己选过封面"，交给抓帧逻辑挑一张有内容的（不能默认抓第 0 秒，
    // 很多视频开头是黑场/淡入）；同时把它限制在剪辑区间内，免得起封面取自已经剪掉的那一段。
    const posterData = await captureVideoCropFrame(source, { time: item.coverTime || 0, crop, range: item.trim || null });
    const previousRef = item.posterRef;
    const encrypted = await encryptVaultPoster(posterData, privateVaultKey());
    item.posterRef = encrypted.posterRef;
    item.posterIv = encrypted.posterIv;
    if (previousRef) await deleteVaultAssets([previousRef]);
    thumbnailUrls.delete(item.id);
  } catch (error) {
    console.warn('私密视频封面重抓失败', error);
  }
}

/**
 * 「压缩并替换原件」的二次确认（2026-10-10 新增，用户在三个方案里选了"剪完替换原件"）。
 *
 * ⚠️ 这是全 App 里少数几个**不可逆**的动作：新文件顶掉原片，原来那整段录像就没了。
 *    所以这里不是一句"确定吗"，而是把"会发生什么、会失去什么、还剩什么"逐条讲清楚；
 *    并且明确给出退路（想留原片就改用「保存到相册」）。
 *
 * 2026-10-10 补：用户反馈「我目前并不知道新增的压缩功能有什么用」——
 * 于是这一屏要先把**好处**讲明白，再讲代价。剪辑本身只写在记录里，
 * 文件没动过；这一步才是让好处落地的地方（内容真的消失、体积真的变小、导出也是剪好的）。
 */
function bakeVaultVideoPrompt(item) {
  if (!item) return;
  if (item.sourceType === 'hls') return show('在线视频（m3u8）暂时不支持重新压缩');
  if (!vaultItemEdited(item)) return show('这段视频还没有剪辑过，不需要压缩');
  const label = cleanVaultVideoTitle(item.name || '私密视频', item.date);
  const keep = vaultPlayableDuration(item);
  const changes = [
    item.trim ? `只保留 ${formatVideoDuration(Math.round(Number(item.trim.start) || 0))} 之后的那一段（约 ${formatVideoDuration(keep)}）` : '',
    item.crop ? '画面按你框选的范围裁掉多余部分' : ''
  ].filter(Boolean);
  // 这三条就是"为什么要做这一步"：不做的话，剪辑只写在记录里，文件还是原来那一整段。
  const gains = [
    '剪掉的那部分会真正从这个文件里消失，不再是"还在手机里、只是不播"',
    '文件会明显变小（已导入的私密视频是完整原片，剪多少就省多少）',
    '以后「保存到相册」导出的、分享出去的，也都是剪好的样子'
  ];
  modal(`<div class="vault-bake-sheet"><span class="eyebrow">BAKE INTO FILE</span><h2>把剪辑写进文件里？</h2><p class="vault-bake-why">「剪辑视频」只记下了"播哪一段、框哪一块"，原文件一直没动过。这一步是用手机重新编码一次，把剪辑变成文件本身。</p><div class="vault-bake-gain"><strong>做完之后</strong><ul>${gains.map(line => `<li>${esc(line)}</li>`).join('')}</ul></div><div class="vault-bake-warning"><span class="material-symbols-outlined">warning</span><span><strong>原来的整段录像会被删除，无法撤销</strong><small>${esc(label)}</small></span></div><ul class="vault-bake-changes">${changes.map(line => `<li>${esc(line)}</li>`).join('')}</ul><p class="vault-bake-note">会用手机重新编码一次，画质有轻微变化；处理时间和视频长度成正比，长片请让应用留在前台。做完之后列表上不再显示「已剪辑」——因为剪辑已经变成文件本身。</p><p class="vault-bake-safe">不想动原片就别做这一步：剪辑在观看时照样生效，只是被剪掉的那部分还留在文件里。</p><div class="modal-actions"><button type="button" data-close>取消</button><button class="danger" id="vault-bake-confirm">压缩并替换</button></div></div>`, 'vault-bake-modal');
  $('#vault-bake-confirm').onclick = () => { closeModal(); bakeVaultVideo(item).catch(error => show(error.message)); };
}

/**
 * 真剪文件：把已经记下的剪辑重新编码成一个新文件，然后替换掉原片。
 *
 * 顺序刻意排成"先出文件、再改记录"：
 * 压缩过程中任何一步失败，私密空间的元数据都还没动过，原片与列表记录原封不动。
 * 只有新文件确实做出来了，才去换引用 —— 这时才轮到"原片会被删掉"这件事发生。
 */
async function bakeVaultVideo(item) {
  if (!item || item.type !== 'video') return;
  if (item.sourceType === 'hls') throw new Error('在线视频（m3u8）暂时不支持重新压缩');
  if (!privateVaultUnlocked()) throw new Error('私密空间已经锁定');
  const trim = item.trim || null;
  const crop = item.crop || null;
  if (!trim && !crop) throw new Error('这段视频还没有剪辑过，不需要压缩');
  const previousRef = item.assetRef;

  showBakeProgress();
  try {
    const result = await reencodeVaultItem(item, { trim, crop }, privateVaultKey(), {
      onProgress: value => updateBakeProgress(value)
    });
    // 用户在等待期间点了取消（或把弹窗关掉）→ 结果一律不用，原片保持原样。
    if (!bakeJob || bakeJob.cancelled) throw new Error('已取消，原视频没有改动');
    stopBakeWatch();

    item.assetRef = result.ref;
    item.assetIv = '';
    item.mime = 'video/mp4';
    if (result.bytes > 0) item.size = result.bytes;
    const seconds = result.durationMs > 0 ? Math.round(result.durationMs / 1000) : 0;
    if (seconds > 0) item.duration = seconds;
    if (result.width > 0 && result.height > 0) {
      item.width = result.width;
      item.height = result.height;
      if (crop) {
        // 画面比例变了，之前对"竖屏/黑边"的判断已经过时，清掉让它重新分析一次。
        item.displayOrientation = '';
        item.displayAnalysisVersion = 0;
        item.contentLeft = 0;
        item.contentRight = 0;
        item.contentAspect = 0;
      }
    }
    // ⚠️ 剪辑已经进到文件里，这两条记录必须清掉；留着播放时会被再剪一遍、再裁一遍。
    item.trim = null;
    item.crop = null;
    // 时间轴整体前移：原来的播放进度和封面时间点都要跟着减掉被剪掉的起点。
    const shift = trim ? Math.max(0, Math.floor(Number(trim.start) || 0)) : 0;
    item.position = Math.max(0, Math.floor(Number(item.position) || 0) - shift);
    if (Number(item.coverTime) > 0) item.coverTime = Math.max(0, Math.floor(Number(item.coverTime) || 0) - shift);

    touchFolder(item.folderId);
    await persistPrivateVault(state);
    // 保存成功之后，这条记录已经不再引用原片 → 它会被统一的"未引用媒体"清理收走（先入回收站）。
    await save();
    // 老格式的加密文件不在那套清理的管辖范围里，这里显式收尾；
    // 普通引用会直接跳过（删除只对老格式生效），所以可以放心统一调用。
    await deleteVaultAssets([previousRef]).catch(() => {});
    stopBakeWatch();
    closeModal();
    render();
    show('已压缩并替换原件');
  } catch (error) {
    stopBakeWatch();
    closeModal();
    throw new Error(error?.message || '压缩失败，原视频没有改动');
  }
}

// 正在进行的压缩任务：cancelled 一旦置位，回来的结果一律作废。
let bakeJob = null;
let bakeObserver = null;

/** 压缩进度弹窗；进度未知时不假装走条，先给一句"正在开始…"。 */
function showBakeProgress() {
  modal(`<div class="vault-bake-progress"><span class="eyebrow">RE-ENCODING</span><h2>正在压缩视频</h2><p>正在把剪辑做进文件里。请让应用留在前台，处理时间和视频长度成正比。</p><div class="vault-bake-bar" role="progressbar" aria-label="压缩进度"><i id="vault-bake-bar-fill"></i></div><small id="vault-bake-percent">正在开始…</small><div class="modal-actions"><button type="button" id="vault-bake-cancel">取消压缩</button></div></div>`, 'vault-bake-progress-modal');
  bakeJob = { cancelled: false };
  $('#vault-bake-cancel').onclick = () => requestBakeCancel();
  // ⚠️ 这一步不可逆，绝不能出现"看着像取消、实际还是把原片换掉了"。
  //    点背景、按返回、按 Esc 都会让弹窗被移除 —— 只要它不在了，就当成放弃处理。
  bakeObserver?.disconnect();
  bakeObserver = new MutationObserver(() => {
    if (!document.querySelector('.vault-bake-progress-modal')) requestBakeCancel();
  });
  bakeObserver.observe($('#modal-layer'), { childList: true });
}

function requestBakeCancel() {
  if (!bakeJob || bakeJob.cancelled) return;
  bakeJob.cancelled = true;
  cancelVaultReencode().catch(() => {});
}

function stopBakeWatch() {
  bakeJob = null;
  bakeObserver?.disconnect();
  bakeObserver = null;
}

function updateBakeProgress(value) {
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  const fill = $('#vault-bake-bar-fill');
  const label = $('#vault-bake-percent');
  // 用 scaleX 而不是 width：width 会触发布局，长片压缩时被高频刷新会拖慢页面。
  if (fill) fill.style.transform = `scaleX(${(percent / 100).toFixed(4)})`;
  if (label) label.textContent = `${percent}%`;
}

async function choosePrivateVideoCover(item) {
  if (!item || item.type !== 'video' || item.sourceType === 'hls') return;
  const source = await vaultVideoSource(item);
  // ⚠️ 必须把当前的裁剪与剪短一起传进去：用户是在「裁剪后的画面」上挑封面，
  //    预览、时间轴范围、抓出来的那张图三者都要和播放时看到的一致。
  showVideoFramePicker(source, {
    title: '选择私密视频封面',
    initialTime: item.coverTime || 0,
    crop: item.crop || null,
    range: item.trim || null,
    onApply: async (posterData, time) => {
      const previousRef = item.posterRef;
      const encrypted = await encryptVaultPoster(posterData, privateVaultKey());
      item.posterRef = encrypted.posterRef;
      item.posterIv = encrypted.posterIv;
      item.coverTime = time;
      touchFolder(item.folderId);
      await persistPrivateVault(state);
      await save();
      if (previousRef) await deleteVaultAssets([previousRef]);
      thumbnailUrls.delete(item.id);
      render(); show('私密视频封面已更新');
    }
  });
}

function bindVaultVideoFullscreen() {
  const player = $('#warm-video-element');
  if (!player) return;
  player.dataset.privateVaultVideo = 'true';
  player.addEventListener('webkitbeginfullscreen', beginVaultFullscreen);
  player.addEventListener('webkitendfullscreen', endVaultFullscreen);
  $('#warm-video-fullscreen')?.addEventListener('pointerdown', () => {
    beginVaultFullscreen();
    setTimeout(() => { if (!document.fullscreenElement && !player.webkitDisplayingFullscreen) endVaultFullscreen(); }, 2000);
  }, { capture: true });
}

function enterVaultFullscreen(element) {
  if (!element?.requestFullscreen) return show('当前设备无法进入全屏');
  beginVaultFullscreen();
  element.requestFullscreen().catch(() => { endVaultFullscreen(); show('当前设备无法进入全屏'); });
}

function beginVaultFullscreen() {
  vaultFullscreenActive = true;
  clearTimeout(pendingVisibilityLock);
}

function endVaultFullscreen() {
  vaultFullscreenActive = false;
  if (document.visibilityState === 'hidden') scheduleVisibilityLock();
}

function scheduleVisibilityLock() {
  clearTimeout(pendingVisibilityLock);
  if (!privateVaultUnlocked() || passwordlessForThisRun || externalUiDepth > 0 || vaultFullscreenActive) return;
  pendingVisibilityLock = setTimeout(() => {
    if (document.visibilityState !== 'hidden' || externalUiDepth > 0 || vaultFullscreenActive || !privateVaultUnlocked()) return;
    thumbnailUrls.clear();
    decryptedVideoUrls.clear();
    decryptingVideoUrls.clear();
    const closing = Promise.resolve(callHelper('closeVideoPlayer'));
    closing.finally(() => {
      closeModal();
      if (document.visibilityState !== 'hidden' || externalUiDepth > 0 || vaultFullscreenActive || !privateVaultUnlocked()) return;
      resetVaultFingerprintAttempt();
      lockPrivateVault().finally(() => { if (state.route === 'private-vault') render(); });
    });
  }, 300);
}

async function lockAndLeave() {
  await Promise.resolve(callHelper('closeVideoPlayer'));
  closeModal();
  thumbnailUrls.clear();
  if (!passwordlessForThisRun) { decryptedVideoUrls.clear(); decryptingVideoUrls.clear(); await lockPrivateVault(); }
  resetVaultFingerprintAttempt();
  activeFolderId = ''; vaultBrowseMode = 'folders'; vaultSelectionMode = false; vaultSelectedIds.clear();
  goBack();
}

function resetVaultFingerprintAttempt() {
  vaultBiometric = { checked: false, available: false, enrolled: false };
  vaultFingerprintAttempted = false;
  vaultFingerprintInFlight = false;
}

function showVaultPasswordFallback(message = '系统指纹暂时无法使用，请输入私密密码。') {
  const form = $('#vault-unlock-form');
  const retry = $('#vault-fingerprint-unlock');
  const status = $('#vault-unlock-status');
  if (form) form.hidden = false;
  if (retry) retry.hidden = !vaultBiometric.enrolled;
  if (status) status.textContent = message;
}

async function refreshVaultFingerprint() {
  vaultBiometric = { checked: true, ...(await PasswordVaultNative.capability({ scope: 'private' }).catch(() => ({ available: false, enrolled: false }))) };
  if (state.route !== 'private-vault' || privateVaultUnlocked()) return;
  const retry = $('#vault-fingerprint-unlock');
  if (retry) retry.onclick = () => vaultFingerprintUnlock(false);
  if (!vaultBiometric.enrolled) return showVaultPasswordFallback(vaultBiometric.available ? '尚未为私密空间启用指纹，请先使用私密密码。' : '本机强指纹不可用，请使用私密密码。');
  if (document.visibilityState === 'visible' && !vaultFingerprintAttempted && !vaultFingerprintInFlight) await vaultFingerprintUnlock(true);
}

async function vaultFingerprintUnlock(automatic = false) {
  if (vaultFingerprintInFlight) return;
  vaultFingerprintAttempted = true;
  vaultFingerprintInFlight = true;
  const status = $('#vault-unlock-status');
  if (status) status.textContent = '请在系统面板验证指纹…';
  try {
    const result = await PasswordVaultNative.unlockWithFingerprint({ scope: 'private' });
    await unlockPrivateVaultWithKey(state, result.secret);
    vaultBrowseMode = 'folders'; activeFolderId = ''; vaultSelectionMode = false; vaultSelectedIds.clear(); vaultExperienceMode = 'library';
    render();
  } catch (error) {
    if (String(error?.message || '').includes('密钥失效')) {
      await PasswordVaultNative.disableFingerprint({ scope: 'private' }).catch(() => {});
      vaultBiometric.enrolled = false;
    }
    showVaultPasswordFallback(error?.message || '指纹验证未完成，请使用私密密码。');
    if (!automatic) show(error?.message || '指纹验证未完成');
  } finally {
    vaultFingerprintInFlight = false;
  }
}

async function vaultFingerprintSettings() {
  vaultBiometric = await PasswordVaultNative.capability({ scope: 'private' }).catch(() => ({ available: false, enrolled: false }));
  modal(`<div class="password-security vault-fingerprint-security"><span class="eyebrow">PRIVATE ARCHIVE SECURITY</span><h2>私密空间指纹设置</h2><button id="vault-fingerprint-toggle"><span class="material-symbols-outlined">fingerprint</span><span><strong>系统指纹解锁</strong><small>${vaultBiometric.enrolled ? '已启用；系统指纹变化后需用私密密码重设' : vaultBiometric.available ? '启用后进入私密空间会优先验证指纹' : '本机没有可用的强指纹'}</small></span><em>${vaultBiometric.enrolled ? '关闭' : '启用'}</em></button><p>指纹密钥仅保存在这台手机的 Android Keystore，不会写入备份，也不会与密码本共用。</p><div class="modal-actions"><button data-close>关闭</button></div></div>`, 'password-security-modal');
  $('#vault-fingerprint-toggle').onclick = async () => {
    const wasEnrolled = vaultBiometric.enrolled;
    try {
      if (wasEnrolled) await PasswordVaultNative.disableFingerprint({ scope: 'private' });
      else {
        if (!vaultBiometric.available) throw new Error('请先在系统设置中录入可用的强指纹');
        const secret = privateVaultKeyBase64();
        if (!secret) throw new Error('私密空间已经锁定，请重新解锁');
        await PasswordVaultNative.enableFingerprint({ scope: 'private', secret });
      }
      resetVaultFingerprintAttempt();
      closeModal();
      show(wasEnrolled ? '私密空间指纹解锁已关闭' : '私密空间指纹解锁已启用');
    } catch (error) { show(error?.message || '指纹设置失败'); }
  };
}

function bindPrivateVault() {
  const vaultGrid = $('.private-vault-view .vault-grid');
  if (vaultGrid) {
    vaultGrid.classList.toggle('vault-grid-large', vaultGridView === 'large');
    const switcher = document.createElement('div');
    switcher.className = 'vault-view-switch';
    switcher.setAttribute('role', 'group');
    switcher.setAttribute('aria-label', '文件夹浏览视角');
    switcher.innerHTML = `<span>浏览视角</span><button type="button" data-vault-grid-view="thumb" aria-pressed="${vaultGridView === 'thumb'}" class="${vaultGridView === 'thumb' ? 'active' : ''}"><span class="material-symbols-outlined">grid_view</span>缩略图</button><button type="button" data-vault-grid-view="large" aria-pressed="${vaultGridView === 'large'}" class="${vaultGridView === 'large' ? 'active' : ''}"><span class="material-symbols-outlined">view_agenda</span>大图</button>`;
    vaultGrid.before(switcher);
    $$('[data-vault-grid-view]', switcher).forEach(button => button.onclick = () => {
      vaultGridView = button.dataset.vaultGridView;
      vaultGrid.classList.toggle('vault-grid-large', vaultGridView === 'large');
      $$('[data-vault-grid-view]', switcher).forEach(item => {
        const active = item.dataset.vaultGridView === vaultGridView;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
    });
  }
  $('#vault-back')?.addEventListener('click', lockAndLeave);
  $('#vault-lock')?.addEventListener('click', async () => {
    passwordlessForThisRun = false;
    resetVaultFingerprintAttempt();
    thumbnailUrls.clear();
    decryptedVideoUrls.clear();
    decryptingVideoUrls.clear();
    activeFolderId = '';
    vaultBrowseMode = 'folders';
    vaultSelectionMode = false;
    vaultSelectedIds.clear();
    await Promise.resolve(callHelper('closeVideoPlayer'));
    closeModal();
    await lockPrivateVault();
    render();
  });
  $('#vault-fingerprint-settings')?.addEventListener('click', vaultFingerprintSettings);
  $('#vault-passwordless')?.addEventListener('click', () => {
    passwordlessForThisRun = !passwordlessForThisRun;
    render();
    show(passwordlessForThisRun ? '本次运行已免密；结束 App 后自动失效' : '本次运行免密已关闭');
  });
  $('#vault-import')?.addEventListener('click', openVaultImportMode);
  $('#vault-import-moments')?.addEventListener('click', openMomentVaultPicker);
  $('#vault-new-folder')?.addEventListener('click', () => folderForm());
  $$('[data-vault-folder-mode]').forEach(button => button.onclick = () => { vaultBrowseMode = button.dataset.vaultFolderMode; activeFolderId = button.dataset.vaultFolderId || ''; vaultMediaFilter = 'all'; vaultSelectionMode = false; vaultSelectedIds.clear(); render(); });
  $$('[data-manage-vault-folder]').forEach(button => button.onclick = event => { event.stopPropagation(); folderForm(privateVaultContent().folders.find(folder => folder.id === button.dataset.manageVaultFolder)); });
  $('#vault-back-folders')?.addEventListener('click', () => {
    // 在子文件夹里点返回 → 先回上一级；已经在顶层才回文件夹首页。
    const content = privateVaultContent();
    const current = activeFolderId ? content.folders.find(folder => folder.id === activeFolderId) : null;
    const parentId = vaultFolderParent(current);
    if (current && parentId && content.folders.some(folder => folder.id === parentId)) {
      activeFolderId = parentId;
    } else {
      vaultBrowseMode = 'folders';
      activeFolderId = '';
    }
    vaultMediaFilter = 'all'; vaultSelectionMode = false; vaultSelectedIds.clear(); render();
  });
  $('#vault-folder-sort')?.addEventListener('change', event => { vaultFolderSort = event.target.value; render(); });
  $('#vault-content-sort')?.addEventListener('change', event => { vaultContentSort = event.target.value; render(); });
  $$('[data-vault-media-filter]').forEach(button => button.onclick = () => { vaultMediaFilter = button.dataset.vaultMediaFilter; vaultSelectionMode = false; vaultSelectedIds.clear(); render(); });
  $('#vault-select-items')?.addEventListener('click', () => { vaultSelectionMode = !vaultSelectionMode; vaultSelectedIds.clear(); render(); });
  $$('[data-select-vault-item]').forEach(button => button.onclick = () => { const id = button.dataset.selectVaultItem; vaultSelectedIds.has(id) ? vaultSelectedIds.delete(id) : vaultSelectedIds.add(id); render(); });
  $('#vault-bulk-move')?.addEventListener('click', bulkMoveForm);
  $('#vault-bulk-delete')?.addEventListener('click', deleteSelectedVaultItems);
  $('#vault-folder-menu')?.addEventListener('click', () => folderForm(privateVaultContent().folders.find(folder => folder.id === activeFolderId)));
  $$('[data-open-vault-item]').forEach(button => button.onclick = () => {
    const item = privateVaultContent().items.find(entry => entry.id === button.dataset.openVaultItem);
    const open = () => openItem(item).catch(error => show(error.message));
    // 视频没有 #vault-photo-image 这个落点。若仍给封面挂 view-transition-name，
    // Android WebView 会把封面从页面快照里抠走：抠空处是点击位置的白块，
    // 整页交叉淡化再透出 WebView 的白底，闪一整屏白。照片才走共享元素。
    if (item?.type === 'video') { open(); return; }
    const source = button.querySelector('.vault-media-box img:not(.photo-blur-pad)') || button.querySelector('.vault-media-box');
    withSharedTransition(source, open, {
      targetSelector: '#vault-photo-image',
      fallbackTargetSelector: '#vault-photo-image'
    });
  });
  $$('[data-vault-item-menu]').forEach(button => button.onclick = () => vaultItemMenu(privateVaultContent().items.find(item => item.id === button.dataset.vaultItemMenu)));
  $$('[data-move-vault-item]').forEach(button => button.onclick = () => moveItemForm(privateVaultContent().items.find(item => item.id === button.dataset.moveVaultItem)));
  $$('[data-vault-video-cover]').forEach(button => button.onclick = () => choosePrivateVideoCover(privateVaultContent().items.find(item => item.id === button.dataset.vaultVideoCover)).catch(error => show(error.message)));
  $$('[data-edit-vault-video]').forEach(button => button.onclick = () => editVaultVideoForm(privateVaultContent().items.find(item => item.id === button.dataset.editVaultVideo)));
  $$('[data-delete-vault-item]').forEach(button => button.onclick = () => deleteVaultItem(privateVaultContent().items.find(entry => entry.id === button.dataset.deleteVaultItem)));
  if (state.route === 'private-vault' && !privateVaultUnlocked() && privateVaultConfigured(state)) refreshVaultFingerprint();
  // 文件夹内部也可能有子文件夹（同样带封面），所以两种模式都要跑封面加载。
  loadFolderCovers();
  if (vaultBrowseMode !== 'folders') loadThumbnails();
}

registerSubmitHandler('vault-setup-form', async data => {
  const password = String(data.get('password') || '');
  if (password !== String(data.get('confirm') || '')) throw new Error('两次输入的密码不一致');
  await setupPrivateVault(state, password);
  vaultBrowseMode = 'folders'; activeFolderId = '';
  await save(); render(); show('私密空间已创建');
  return false;
});

registerSubmitHandler('vault-unlock-form', async data => {
  const button = $('#vault-unlock-form .save');
  if (button) { button.disabled = true; button.textContent = '正在验证密码…'; }
  try {
    await unlockPrivateVault(state, String(data.get('password') || ''));
    resetVaultFingerprintAttempt();
    vaultBrowseMode = 'folders'; activeFolderId = ''; vaultSelectionMode = false; vaultSelectedIds.clear(); vaultExperienceMode = 'library';
    // 解锁只负责验证密码和读取加密元数据。旧媒体转换可能持续很久，绝不能阻塞入口。
    render();
    show('私密空间已解锁');
  } finally {
    if (button?.isConnected) { button.disabled = false; button.textContent = '解锁并显示内容'; }
  }
  return false;
});

registerSubmitHandler('vault-folder-form', async data => {
  const content = privateVaultContent();
  const id = String(data.get('id') || '');
  const name = String(data.get('name') || '').trim();
  const parentId = String(data.get('parentId') || '');
  if (!name) throw new Error('请输入文件夹名称');
  // 同名只在同一层级内判重：不同父文件夹下允许出现同名子文件夹。
  const siblings = content.folders.filter(folder => vaultFolderParent(folder) === parentId);
  if (siblings.some(folder => folder.id !== id && folder.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error(parentId ? '这个文件夹里已经有同名子文件夹' : '顶层已经有同名文件夹');
  }
  if (id) {
    const folder = content.folders.find(item => item.id === id);
    if (folder) {
      // 换父级前再拦一次成环与超深：即使表单被绕过也不会写坏层级。
      const blocked = new Set([folder.id, ...vaultFolderDescendants(folder.id, content.folders)]);
      if (parentId && blocked.has(parentId)) throw new Error('不能把文件夹移动到它自己或它的子文件夹里');
      const target = parentId ? content.folders.find(item => item.id === parentId) : null;
      if (parentId && !target) throw new Error('上级文件夹不存在');
      if (target && vaultFolderDepth(target, content.folders) >= MAX_FOLDER_DEPTH) throw new Error(`最多支持 ${MAX_FOLDER_DEPTH} 层文件夹`);
      folder.name = name;
      folder.parentId = parentId;
      folder.updatedAt = Date.now();
    }
  } else {
    if (parentId) {
      const target = content.folders.find(item => item.id === parentId);
      if (!target) throw new Error('上级文件夹不存在');
      if (vaultFolderDepth(target, content.folders) >= MAX_FOLDER_DEPTH) throw new Error(`最多支持 ${MAX_FOLDER_DEPTH} 层文件夹`);
    }
    const folder = { id: crypto.randomUUID(), name, parentId, createdAt: Date.now(), updatedAt: Date.now() };
    content.folders.push(folder); activeFolderId = folder.id; vaultBrowseMode = 'folder';
  }
  await persistPrivateVault(state);
});

registerSubmitHandler('vault-move-form', async data => {
  const item = privateVaultContent().items.find(entry => entry.id === data.get('id'));
  if (item) { const previous = item.folderId; item.folderId = String(data.get('folderId') || ''); touchFolder(previous); touchFolder(item.folderId); }
  await persistPrivateVault(state);
});

registerSubmitHandler('vault-bulk-move-form', async data => {
  const destination = String(data.get('folderId') || '');
  for (const item of privateVaultContent().items) if (vaultSelectedIds.has(item.id)) { touchFolder(item.folderId); item.folderId = destination; }
  touchFolder(destination); vaultSelectedIds.clear(); vaultSelectionMode = false;
  await persistPrivateVault(state);
});

registerSubmitHandler('vault-video-edit-form', async data => {
  const item = privateVaultContent().items.find(entry => entry.id === data.get('id'));
  if (!item || item.type !== 'video') throw new Error('没有找到这个私密视频');
  const name = String(data.get('name') || '').trim();
  if (!name) throw new Error('请输入视频名称');
  item.name = name.slice(0, 120);
  item.date = /^\d{4}-\d{2}-\d{2}$/.test(String(data.get('date') || '')) ? String(data.get('date')) : '';
  item.note = String(data.get('note') || '').trim().slice(0, 300);
  touchFolder(item.folderId);
  await persistPrivateVault(state);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    clearTimeout(pendingVisibilityLock);
    if (state.route === 'private-vault' && privateVaultConfigured(state) && !privateVaultUnlocked()) render();
  }
  else if (passwordlessForThisRun) {
    if (externalUiDepth === 0 && !vaultFullscreenActive) { callHelper('closeVideoPlayer'); closeModal(); }
  } else scheduleVisibilityLock();
});

document.addEventListener('fullscreenchange', () => {
  const current = document.fullscreenElement;
  if (current?.matches?.('[data-private-vault-video="true"]') || (current?.id === 'warm-video-viewport' && $('#warm-video-element')?.dataset.privateVaultVideo === 'true')) beginVaultFullscreen();
  else if (vaultFullscreenActive) endVaultFullscreen();
});

registerOnRender(() => {
  const routeActive = state.route === 'private-vault';
  $('.phone-shell')?.classList.toggle('private-vault-active', routeActive);
  if (!routeActive && vaultRouteWasActive && privateVaultUnlocked()) {
    clearTimeout(pendingVisibilityLock);
    externalUiDepth = 0;
    vaultFullscreenActive = false;
    thumbnailUrls.clear();
    const closing = Promise.resolve(callHelper('closeVideoPlayer'));
    closeModal();
    activeFolderId = ''; vaultBrowseMode = 'folders'; vaultSelectionMode = false; vaultSelectedIds.clear();
    if (!passwordlessForThisRun) {
      closing.finally(() => {
        if (!privateVaultUnlocked()) return;
        resetVaultFingerprintAttempt();
        decryptedVideoUrls.clear();
        decryptingVideoUrls.clear();
        lockPrivateVault();
      });
    }
  }
  vaultRouteWasActive = routeActive;
});
registerView('private-vault', privateVaultView);
registerBinder(bindPrivateVault);
