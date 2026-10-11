import { Capacitor } from '@capacitor/core';
import { $, $$, esc, state, modal, closeModal, show, save, render, registerHelper } from '../core.js';
import { IncomingShare } from '../incoming-share.js';
import { makeSnippet, makeDocument, dateKey } from '../model.js';
import { compressSnippetPhoto, captureVideoFrame } from '../photo-utils.js';
import { persistImageData, saveNativeMediaSource, deleteMediaReference } from '../media-store.js';
import { deleteDocument, documentType } from '../document-utils.js';
import { privateVaultConfigured, privateVaultUnlocked, privateVaultContent, privateVaultKey, unlockPrivateVault, persistPrivateVault } from '../private-vault.js';
import { encryptVaultFile, encryptVaultPoster, deleteVaultAssets } from '../vault-media-store.js';

let incoming = null;
let opening = false;
let saving = false;

const filesOf = kind => (incoming?.files || []).filter(file => file.kind === kind);
const mediaFiles = () => (incoming?.files || []).filter(file => file.kind === 'photo' || file.kind === 'video');
const hasText = () => Boolean(String(incoming?.text || incoming?.subject || '').trim());
const folderOptions = (folders, selected = '') => `<option value="">根目录 / 未分类</option>${folders.map(folder => `<option value="${esc(folder.id)}" ${folder.id === selected ? 'selected' : ''}>${esc(folder.name)}</option>`).join('')}`;
const formatSize = bytes => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export async function checkIncomingShare() {
  if (!Capacitor.isNativePlatform() || opening || saving || incoming) return false;
  const pending = await IncomingShare.hasPending().catch(() => ({ available: false }));
  if (!pending.available) return false;
  opening = true;
  modal('<div class="incoming-share-loading"><span class="material-symbols-outlined">move_to_inbox</span><h2>正在接收分享内容</h2><p>大文件会先安全复制到临时收件箱，请稍候。</p></div>', 'incoming-share-loading-modal');
  try {
    const payload = await IncomingShare.consumePending();
    if (!payload?.available) { closeModal(); return false; }
    incoming = { ...payload, files: Array.isArray(payload.files) ? payload.files : [] };
    openIncomingShare();
    return true;
  } catch (error) {
    closeModal(); show(error.message || '无法接收分享内容'); return false;
  } finally { opening = false; }
}

function openIncomingShare() {
  if (!incoming) return;
  const media = mediaFiles();
  const documents = filesOf('document');
  const text = incoming.draftText ?? [incoming.subject, incoming.text].filter(Boolean).join('\n').trim();
  const vaultFolders = privateVaultUnlocked() ? privateVaultContent().folders : [];
  modal(`<form id="incoming-share-form"><div class="incoming-share-head"><span class="material-symbols-outlined">move_to_inbox</span><span><small>INCOMING SHARE</small><h2>保存到暖色生活志</h2><p>确认前只保存在临时收件箱；取消不会留下正式记录。</p></span></div>${hasText() ? `<section class="incoming-share-section"><h3>文字或链接</h3><textarea name="text" maxlength="100000" rows="5">${esc(text)}</textarea><label>保存位置<select name="textDestination"><option value="snippet">随手记</option><option value="journal">今天的日记</option></select></label></section>` : ''}${media.length ? `<section class="incoming-share-section"><h3>照片与视频 <small>${media.length} 项</small></h3><div class="incoming-share-files">${media.map(file => `<span><i class="material-symbols-outlined">${file.kind === 'video' ? 'movie' : 'image'}</i><b>${esc(file.name)}</b><small>${formatSize(file.size)}</small></span>`).join('')}</div><label>保存位置<select name="mediaDestination" id="incoming-media-destination"><option value="moments">随手拍</option>${privateVaultConfigured(state) ? '<option value="vault">私密空间</option>' : ''}</select></label><div id="incoming-vault-unlock" hidden><label>私密密码<input name="vaultPassword" type="password" minlength="6" autocomplete="current-password" placeholder="验证后显示私密文件夹"></label><button type="button" id="incoming-vault-unlock-button"><span class="material-symbols-outlined">lock_open</span>验证并选择文件夹</button></div><label id="incoming-vault-folder" hidden>私密文件夹<select name="vaultFolderId">${folderOptions(vaultFolders)}</select></label></section>` : ''}${documents.length ? `<section class="incoming-share-section"><h3>普通文件 <small>${documents.length} 项</small></h3><div class="incoming-share-files">${documents.map(file => `<span><i class="material-symbols-outlined">description</i><b>${esc(file.name)}</b><small>${formatSize(file.size)}</small></span>`).join('')}</div><label>资料库保存路径<select name="documentFolderId">${folderOptions(state.documentFolders || [])}</select></label></section>` : ''}<label class="incoming-share-date">记录日期<input name="date" type="date" required value="${incoming.draftDate || dateKey()}"></label><div class="modal-actions"><button type="button" id="incoming-share-cancel">取消</button><button type="submit" class="save">确认保存</button></div></form>`, 'incoming-share-modal');
  const syncVaultFields = () => {
    const vault = $('#incoming-media-destination')?.value === 'vault';
    if ($('#incoming-vault-unlock')) $('#incoming-vault-unlock').hidden = !vault || privateVaultUnlocked();
    if ($('#incoming-vault-folder')) $('#incoming-vault-folder').hidden = !vault || !privateVaultUnlocked();
  };
  $('#incoming-media-destination')?.addEventListener('change', syncVaultFields);
  syncVaultFields();
  $('#incoming-vault-unlock-button')?.addEventListener('click', async () => {
    const form = $('#incoming-share-form'); const data = new FormData(form);
    try {
      await ensureVault(data);
      incoming.draftText = String(data.get('text') || text);
      incoming.draftDate = String(data.get('date') || dateKey());
      openIncomingShare();
      const destination = $('#incoming-media-destination'); if (destination) { destination.value = 'vault'; destination.dispatchEvent(new Event('change')); }
    } catch (error) { show(error.message); }
  });
  $('#incoming-share-cancel').onclick = cancelIncomingShare;
  $('#incoming-share-form').onsubmit = event => { event.preventDefault(); event.stopPropagation(); saveIncomingShare(new FormData(event.currentTarget)).catch(error => { saving = false; openIncomingShare(); show(error.message); }); };
}

async function ensureVault(data) {
  if (privateVaultUnlocked()) return;
  const password = String(data.get('vaultPassword') || '');
  await unlockPrivateVault(state, password);
}

function progressModal(total) {
  modal(`<div class="incoming-share-progress"><span class="material-symbols-outlined">save</span><h2>正在保存分享内容</h2><progress id="incoming-share-progress" max="${Math.max(1, total)}" value="0"></progress><strong id="incoming-share-count">0 / ${total}</strong><p id="incoming-share-current">正在准备…</p></div>`, 'incoming-share-progress-modal');
}

function updateProgress(done, total, name) {
  const progress = $('#incoming-share-progress'); if (progress) progress.value = String(done);
  if ($('#incoming-share-count')) $('#incoming-share-count').textContent = `${done} / ${total}`;
  if ($('#incoming-share-current')) $('#incoming-share-current').textContent = name || '正在写入本机';
}

async function saveIncomingShare(data) {
  if (!incoming || saving) return;
  saving = true;
  const payload = incoming;
  const media = mediaFiles(); const documents = filesOf('document');
  const total = (hasText() ? 1 : 0) + media.length + documents.length;
  progressModal(total);
  let done = 0;
  const createdMedia = []; const createdDocs = []; const createdVaultRefs = [];
  const previousSnippets = structuredClone(state.snippets); const previousJournals = structuredClone(state.journals); const previousDocuments = structuredClone(state.documents);
  let previousVault = privateVaultUnlocked() ? structuredClone(privateVaultContent()) : null;
  try {
    const date = String(data.get('date') || dateKey());
    if (hasText()) {
      const text = String(data.get('text') || '').trim();
      if (text) {
        if (data.get('textDestination') === 'journal') {
          const old = state.journals[date] || { content: '', mood: '', weather: '', photos: [], tags: [], summary: '' };
          state.journals[date] = { ...old, content: [old.content, text].filter(Boolean).join('\n\n'), updatedAt: Date.now() };
        } else state.snippets.unshift(makeSnippet({ type: 'text', date, text, createdAt: Date.now() }));
      }
      done++; updateProgress(done, total, '文字已整理');
    }
    if (media.length) {
      if (data.get('mediaDestination') === 'vault') {
        await ensureVault(data);
        const content = privateVaultContent();
        if (!previousVault) previousVault = structuredClone(content);
        const folderId = String(data.get('vaultFolderId') || '');
        for (const file of media) {
          updateProgress(done, total, file.name);
          const input = { path: file.path, name: file.name, mimeType: file.mimeType, size: file.size };
          const stored = await encryptVaultFile(input, privateVaultKey());
          let poster = {};
          if (file.kind === 'video') {
            const source = Capacitor.convertFileSrc(file.path);
            const posterData = await captureVideoFrame(source, { maxSide: 720, quality: .84 }).catch(() => '');
            if (posterData) poster = await encryptVaultPoster(posterData, privateVaultKey());
          }
          createdVaultRefs.push(...[stored.assetRef, poster.posterRef].filter(Boolean));
          content.items.push({ id: crypto.randomUUID(), folderId, type: stored.type, name: stored.name, mime: stored.mime, size: stored.size, assetRef: stored.assetRef, assetIv: stored.assetIv || '', posterRef: poster.posterRef || '', posterIv: poster.posterIv || '', date, note: String(data.get('text') || '').trim().slice(0, 300), createdAt: Date.now() });
          done++; updateProgress(done, total, file.name);
        }
        await persistPrivateVault(state);
      } else {
        const savedItems = [];
        for (const file of media) {
          updateProgress(done, total, file.name);
          if (file.kind === 'photo') {
            const response = await fetch(Capacitor.convertFileSrc(file.path));
            if (!response.ok) throw new Error(`无法读取「${file.name}」`);
            const blob = await response.blob();
            const compressed = await compressSnippetPhoto(new File([blob], file.name, { type: file.mimeType || blob.type }));
            const ref = await persistImageData(compressed); savedItems.push({ kind: 'photo', value: ref }); createdMedia.push(ref);
          } else {
            const ref = await saveNativeMediaSource(file.path, { name: file.name, size: file.size }); createdMedia.push(ref);
            const posterData = await captureVideoFrame(Capacitor.convertFileSrc(file.path), { maxSide: 720, quality: .84 }).catch(() => '');
            const poster = posterData ? await persistImageData(posterData) : ''; if (poster) createdMedia.push(poster);
            savedItems.push({ kind: 'video', value: { video: ref, poster, label: file.name } });
          }
          done++; updateProgress(done, total, file.name);
        }
        for (let start = 0; start < savedItems.length; start += 60) {
          const chunk = savedItems.slice(start, start + 60);
          state.snippets.unshift(makeSnippet({ type: 'photo', date, text: String(data.get('text') || '').trim().slice(0, 300), photos: chunk.filter(item => item.kind === 'photo').map(item => item.value), videos: chunk.filter(item => item.kind === 'video').map(item => item.value), createdAt: Date.now() + start }));
        }
      }
    }
    for (const file of documents) {
      updateProgress(done, total, file.name);
      const result = await IncomingShare.commitDocument({ session: payload.session, id: file.id, name: file.name });
      const doc = makeDocument({ name: file.name, type: documentType(file.name), size: result.size || file.size, path: result.path, folderId: String(data.get('documentFolderId') || ''), createdAt: Date.now() });
      state.documents.push(doc); createdDocs.push(doc); done++; updateProgress(done, total, file.name);
    }
    await save();
    await IncomingShare.discard({ session: payload.session });
    incoming = null; saving = false; closeModal(); render(); show(`已保存 ${total} 项分享内容`);
  } catch (error) {
    state.snippets = previousSnippets; state.journals = previousJournals; state.documents = previousDocuments;
    if (previousVault && privateVaultUnlocked()) { const content = privateVaultContent(); content.folders = previousVault.folders; content.items = previousVault.items; await persistPrivateVault(state).catch(() => {}); }
    await Promise.all(createdMedia.map(ref => deleteMediaReference(ref).catch(() => {})));
    await Promise.all(createdDocs.map(doc => deleteDocument(doc).catch(() => {})));
    await deleteVaultAssets(createdVaultRefs, { force: true }).catch(() => {});
    throw error;
  }
}

export async function cancelIncomingShare() {
  if (!incoming || saving) return;
  const session = incoming.session; incoming = null;
  await IncomingShare.discard({ session }).catch(() => {});
  closeModal(); show('已取消保存，临时分享文件已清理');
}

registerHelper('checkIncomingShare', checkIncomingShare);
registerHelper('cancelIncomingShare', cancelIncomingShare);
registerHelper('isIncomingShareOpen', () => Boolean(incoming || opening || saving));
