import { $, $$, esc, state, save, render, modal, closeModal, show, confirmDelete, imgSrc, emptyState, go, formatMinutes, setState, defaults, registerView, registerBinder, registerSubmitHandler, callHelper, NAV_TABS, renderNav, pushBackState, applyTheme, notifyPersistedKeySeal } from '../core.js';
import { journalEntries, migrateState, makeDefaultNavTabs, APP_THEMES, THEME_META, formatShanghaiDateTime } from '../model.js';
import { openReleaseNotes } from './common.js';
import { exportEncryptedBackup, importEncryptedBackup, finalizeImportedBackup, rollbackImportedBackup, verifyEncryptedBackup } from '../backup.js';
import { createSafetySnapshot, listSafetySnapshots, readSafetySnapshot, storageHealth, replaceState } from '../storage.js';
import { mediaHealth, externalizeStateMedia } from '../media-store.js';
import { aiKeyStorageMode } from '../ai-key-vault.js';
import { clearJournalDraftCache } from '../journal-drafts.js';
import { Capacitor } from '@capacitor/core';
import { describeReminderStatus } from './reminder-status.js';
import { getReminderStatus, openExactAlarmSettings, openNotificationSettings } from '../notifications.js';
import { DAILY_MAX_PER_DAY } from '../reminder-plan.js';
import { APP_VERSION_NAME, fetchUpdateManifest, hasNewerVersion, effectiveVersion, pendingResourceUpdate, downloadUpdate, installUpdate, canInstall, openInstallSettings, clearDownload, isUpdateSupported, formatBytes, fetchResourceManifest, applyResourceUpdate } from '../app-updater.js';

// ---- 本地状态 ----
let pendingAvatar = '';
let pendingProfileDraft = null;
let avatarCropState = null;
let pendingBackgroundImage = '';
let pendingBackgroundOverlayOpacity = 72;
let pendingBackgroundFit = 'contain';
let pendingBackgroundZoom = 1;
let pendingBackgroundOffsetX = 0;
let pendingBackgroundOffsetY = 0;
let backgroundDrag = null;
let mineHealth = { checked: false, healthy: true, snapshotCount: null, serializedBytes: null, mediaFiles: null, mediaBytes: null };

function displayedAppVersion() {
  const source = document.querySelector('script[src*="app.js"]')?.getAttribute('src') || '';
  const match = source.match(/[?&]v=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : '开发版';
}

function formatDataSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${Number((value / 1024 / 1024).toFixed(1))} MB`;
}

function mineHealthText(mediaCount) {
  const parts = [`${mediaCount} 条媒体记录`];
  if (mineHealth.snapshotCount !== null) parts.push(`${mineHealth.snapshotCount}/5 份安全快照`);
  const size = formatDataSize(mineHealth.serializedBytes);
  if (size) parts.push(`${size} 本地数据`);
  const mediaSize = formatDataSize(mineHealth.mediaBytes);
  if (mediaSize) parts.push(`${mediaSize} 媒体`);
  return parts.join(' · ');
}

async function refreshMineHealth(mediaCount) {
  try {
    const [storage, media] = await Promise.all([storageHealth(state), mediaHealth(state)]);
    mineHealth = {
      checked: true,
      healthy: media.healthy,
      snapshotCount: Number(storage.snapshots) || 0,
      serializedBytes: Number.isFinite(Number(storage.serializedBytes)) ? Number(storage.serializedBytes) : null,
      mediaFiles: Number(media.files) || 0,
      mediaBytes: Number(media.bytes) || 0
    };
  } catch {
    mineHealth = { checked: true, healthy: false, snapshotCount: null, serializedBytes: null, mediaFiles: null, mediaBytes: null };
  }
  const card = $('#settings-data');
  if (!card) return;
  card.classList.toggle('warning', !mineHealth.healthy);
  const icon = $('.data-health-icon', card);
  const title = $('.data-health-title', card);
  const copy = $('.data-health-copy', card);
  if (icon) icon.textContent = mineHealth.healthy ? 'verified_user' : 'warning';
  if (title) title.textContent = mineHealth.healthy ? '本地数据状态正常' : '本地数据需要检查';
  if (copy) copy.textContent = mineHealthText(mediaCount);
  const snapshotStatus = $('#snapshot-count-status');
  if (snapshotStatus) snapshotStatus.textContent = mineHealth.snapshotCount === null ? '查看' : `${mineHealth.snapshotCount}/5`;
}

function newestMediaEntry() {
  return [...(state.media || [])]
    .filter(entry => entry?.id)
    .sort((a, b) => (Number(b.updatedAt) || Number(b.createdAt) || 0) - (Number(a.updatedAt) || Number(a.createdAt) || 0))[0] || null;
}

function openMineMediaEntry() {
  const entry = newestMediaEntry();
  if (entry) {
    callHelper('openMediaDetail', entry.id);
    return true;
  }
  pushBackState();
  go('library');
  return false;
}

function preferredMineHabit(now = new Date()) {
  const candidates = (state.habits || []).filter(habit => !habit.archived);
  if (!candidates.length) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const monday = new Date(today);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const recentDays = new Set(Array.from({ length: Math.round((today - monday) / 86400000) + 1 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    const pad = value => String(value).padStart(2, '0');
    return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  }));
  return candidates
    .map((habit, index) => ({
      habit,
      index,
      activity: Object.entries(state.checks || {})
        .filter(([day]) => recentDays.has(day))
        .reduce((total, [, values]) => total + (Number(values?.[habit.id]) || 0), 0)
    }))
    .sort((a, b) => b.activity - a.activity || a.index - b.index)[0];
}

function openMineHabitDetail() {
  const selected = preferredMineHabit();
  if (!selected) {
    show('请先创建习惯');
    return false;
  }
  return Boolean(callHelper('openHabitDetail', selected.habit.id));
}

export function mineView() {
  const totalMinutes = state.sessions.reduce((sum, session) => sum + session.minutes, 0);
  const journals = journalEntries(state).length;
  const checkCount = Object.values(state.checks).reduce((sum, progress) => sum + Object.entries(progress).filter(([id, count]) => count >= (state.habits.find(habit => habit.id === id)?.target || 1)).length, 0);
  const todoDone = state.todos.filter(todo => todo.completed).length;
  const mediaCount = state.media.filter(entry => ['completed', 'in_progress', 'planned'].includes(entry.status)).length;
  const documentCount = (state.documents || []).length;
  const releaseNoteCount = (state.releases || []).length;
  const tasteCount = (state.tasteEntries || []).length;
  const tasteAgainCount = (state.tasteEntries || []).filter(entry => ['favorite', 'again'].includes(entry.verdict)).length;
  const watched = state.media.filter(entry => entry.type === 'movie' && entry.status === 'completed').length;
  const read = state.media.filter(entry => entry.type === 'book' && entry.status === 'completed').length;
  const focusText = totalMinutes >= 60 ? `${Number((totalMinutes / 60).toFixed(totalMinutes >= 6000 ? 0 : 1))}h` : `${totalMinutes}m`;
  const reminderCount = (state.settings?.dailyReminders || []).length;
  const aiConfigured = Boolean(state.settings?.aiEnabled && state.settings?.aiApiKey);
  const clarity = 100 - Math.max(0, Math.min(100, Number(state.settings?.backgroundOverlayOpacity) || 0));
  const themeLabel = (THEME_META[state.settings?.theme] || THEME_META.classic).label;
  const version = displayedAppVersion();
  return `<section class="view mine-view">
    <header class="subpage-header mine-editorial-header">
      <span class="mine-header-kicker">PERSONAL ARCHIVE</span>
      <span class="mine-header-issue" aria-hidden="true">NO.01 &middot; LOCAL</span>
      <h1 class="subpage-title">Mine</h1>
      <p class="subpage-subtitle">我的生活档案与本机设置</p>
    </header>
    <div class="profile-hero-card">
      <button type="button" class="profile-avatar-control" id="edit-avatar" aria-label="编辑头像"><span class="profile-avatar-box">${state.profile.avatar ? `<img src="${imgSrc(state.profile.avatar)}" alt="头像">` : `<span>${esc(state.profile.name.slice(-1))}</span>`}</span><span class="avatar-camera-badge" aria-hidden="true"><span class="material-symbols-outlined">photo_camera</span></span></button>
      <div class="profile-meta-info">
        <span class="profile-record-label">MY LIFE RECORD</span>
        <div class="profile-meta-row"><span class="profile-user-name">${esc(state.profile.name)}</span><button class="profile-edit-pill" id="edit-profile"><span class="material-symbols-outlined">edit</span>编辑</button></div>
        <div class="profile-user-motto">“${esc(state.profile.motto)}”</div>
      </div>
    </div>
    <div class="mine-kpi-row">
      <button class="mine-kpi-card tone-sage" data-route="focus"><div class="mine-kpi-num">${focusText}</div><div class="mine-kpi-label">累计专注</div></button>
      <button class="mine-kpi-card tone-gold" data-route="today"><div class="mine-kpi-num">${checkCount}</div><div class="mine-kpi-label">习惯打卡</div></button>
      <button class="mine-kpi-card tone-blue" data-route="today"><div class="mine-kpi-num">${todoDone}</div><div class="mine-kpi-label">完成待办</div></button>
      <button class="mine-kpi-card tone-red" data-route="journal"><div class="mine-kpi-num">${journals}</div><div class="mine-kpi-label">生活日记</div></button>
    </div>
    <div class="stream-sheet mine-stream">
      <section class="mine-settings-section mine-life-section"><header class="mine-section-heading"><span class="mine-section-index" aria-hidden="true">01</span><h2>我的生活</h2><small>LIFE ARCHIVE</small></header>
      <div class="settings-group-card">
        <button class="setting-item-row taste-archive-entry" id="open-taste-archive"><span class="setting-row-left"><span class="setting-icon-box"><span class="material-symbols-outlined">restaurant_menu</span></span><span><span class="setting-row-title">味觉档案</span><span class="setting-row-subtitle">${tasteCount ? `${tasteCount} 条记录 · ${tasteAgainCount} 样还想再吃` : '记录吃过的菜、零食和店铺'}</span></span></span><span class="setting-row-right"><span>${tasteCount ? '查看档案' : '去记录'}</span><span class="material-symbols-outlined">chevron_right</span></span></button>
        <button class="setting-item-row" id="open-local-gallery"><span class="setting-row-left"><span class="setting-icon-box"><span class="material-symbols-outlined">perm_media</span></span><span><span class="setting-row-title">本机相册播放器</span><span class="setting-row-subtitle">查看手机照片和视频 · 原件留在相册</span></span></span><span class="setting-row-right"><span>打开</span><span class="material-symbols-outlined">chevron_right</span></span></button>
        <button class="setting-item-row" id="open-media-detail-mine"><span class="setting-row-left"><span class="setting-icon-box"><span class="material-symbols-outlined">auto_stories</span></span><span><span class="setting-row-title">我的书影音与资料流</span><span class="setting-row-subtitle">${mediaCount ? `${watched} 部电影 · ${read} 本书已完成归档` : '暂无记录 · 前往书影音资料库'}</span></span></span><span class="setting-row-right"><span>${mediaCount ? '查看详情' : '去记录'}</span><span class="material-symbols-outlined">chevron_right</span></span></button>
        <button class="setting-item-row" id="open-documents"><span class="setting-row-left"><span class="setting-icon-box"><span class="material-symbols-outlined">folder</span></span><span><span class="setting-row-title">资料库</span><span class="setting-row-subtitle">${documentCount ? `${documentCount} 个文件 · Word / PDF` : 'Word、PDF，以及分享进来的文件'}</span></span></span><span class="setting-row-right"><span>${documentCount ? '打开' : '去查看'}</span><span class="material-symbols-outlined">chevron_right</span></span></button>
        <button class="setting-item-row" id="open-habit-detail-mine"><span class="setting-row-left"><span class="setting-icon-box"><span class="material-symbols-outlined">track_changes</span></span><span><span class="setting-row-title">习惯与节奏管理</span><span class="setting-row-subtitle">${state.habits.some(habit => !habit.archived) ? '自定义目标量、重复周期与打卡' : '请先创建习惯'}</span></span></span><span class="setting-row-right"><span>管理</span><span class="material-symbols-outlined">chevron_right</span></span></button>
      </div></section>
      <section class="mine-settings-section mine-smart-section"><header class="mine-section-heading"><span class="mine-section-index" aria-hidden="true">02</span><h2>智能与提醒</h2><small>SMART ROUTINES</small></header>
      <div class="settings-group-card">
        <button class="setting-item-row" id="settings-ai"><span class="setting-row-left"><span class="setting-icon-box tone-gold"><span class="material-symbols-outlined">smart_toy</span></span><span><span class="setting-row-title">AI 伴侣与大模型配置</span><span class="setting-row-subtitle">${state.settings?.aiApiKeyInvalid ? '密钥需重新填写' : `模型 API Key · ${aiKeyStorageMode() === 'keystore' ? '系统密钥库加密' : '本机加密'}`}</span></span></span><span class="setting-row-right"><span class="${aiConfigured ? 'state-ok' : ''}">${aiConfigured ? '已配置' : state.settings?.aiApiKeyInvalid ? '需重填' : '未配置'}</span><span class="material-symbols-outlined">chevron_right</span></span></button>
        <button class="setting-item-row" id="settings-reminder"><span class="setting-row-left"><span class="setting-icon-box"><span class="material-symbols-outlined">notifications_active</span></span><span><span class="setting-row-title">日常作息与记录提醒</span><span class="setting-row-subtitle">专注、日记与生活记录提醒</span></span></span><span class="setting-row-right"><span id="settings-reminder-state">${reminderCount ? `已设 ${reminderCount} 项` : '未开启'}</span><span class="material-symbols-outlined">chevron_right</span></span></button>
        <div class="setting-reminder-status" id="settings-reminder-status" hidden aria-live="polite"><span class="setting-reminder-status-text"></span><button type="button" class="setting-reminder-status-action" hidden>去开启</button></div>
      </div></section>
      <section class="mine-settings-section mine-appearance-section"><header class="mine-section-heading"><span class="mine-section-index" aria-hidden="true">03</span><h2>外观与偏好</h2><small>LOOK &amp; FEEL</small></header>
      <div class="settings-group-card">
        <button class="setting-item-row" id="settings-background"><span class="setting-row-left"><span class="setting-icon-box"><span class="material-symbols-outlined">palette</span></span><span><span class="setting-row-title">主题与外观</span><span class="setting-row-subtitle">${esc(themeLabel)}主题 · 背景清晰度 ${clarity}%</span></span></span><span class="setting-row-right"><span>${state.settings?.backgroundImage ? '自定义壁纸' : esc(themeLabel)}</span><span class="material-symbols-outlined">chevron_right</span></span></button>
      </div></section>
      <section class="mine-settings-section mine-security-section"><header class="mine-section-heading"><span class="mine-section-index" aria-hidden="true">04</span><h2>数据与安全</h2><small>LOCAL SAFETY</small></header>
      <div class="settings-group-card">
        <button class="setting-item-row" id="settings-password-vault"><span class="setting-row-left"><span class="setting-icon-box"><span class="material-symbols-outlined">password</span></span><span><span class="setting-row-title">本机加密密码本</span><span class="setting-row-subtitle">独立主密码 · 系统指纹 · 离线保存</span></span></span><span class="setting-row-right"><span>${state.passwordVault?.payload ? '已设置' : '未设置'}</span><span class="material-symbols-outlined">chevron_right</span></span></button>
        <button class="data-health-banner ${mineHealth.checked && !mineHealth.healthy ? 'warning' : ''}" id="settings-data"><span class="data-health-icon material-symbols-outlined">${mineHealth.checked && !mineHealth.healthy ? 'warning' : 'verified_user'}</span><span><strong class="data-health-title">${mineHealth.checked ? (mineHealth.healthy ? '本地数据状态正常' : '本地数据需要检查') : '正在检查本地数据'}</strong><small class="data-health-copy">${mineHealthText(mediaCount)}</small></span><i class="material-symbols-outlined">chevron_right</i></button>
        <button class="setting-item-row" id="settings-snapshot"><span class="setting-row-left"><span class="setting-icon-box"><span class="material-symbols-outlined">restore_page</span></span><span><span class="setting-row-title">立即创建本机安全快照</span><span class="setting-row-subtitle">升级或误操作后可回退，最多保留 5 份</span></span></span><span class="setting-row-right"><span>立即创建</span><span class="material-symbols-outlined">chevron_right</span></span></button>
        <button class="setting-item-row" id="settings-snapshot-list"><span class="setting-row-left"><span class="setting-icon-box"><span class="material-symbols-outlined">history</span></span><span><span class="setting-row-title">查看与恢复安全快照</span><span class="setting-row-subtitle">恢复前会先保存当前数据</span></span></span><span class="setting-row-right"><span id="snapshot-count-status">${mineHealth.snapshotCount === null ? '查看' : `${mineHealth.snapshotCount}/5`}</span><span class="material-symbols-outlined">chevron_right</span></span></button>
        <button class="setting-item-row" id="settings-backup"><span class="setting-row-left"><span class="setting-icon-box"><span class="material-symbols-outlined">backup</span></span><span><span class="setting-row-title">导出端到端加密备份</span><span class="setting-row-subtitle">Android 流式归档 · 支持 100GB 级照片与视频</span></span></span><span class="setting-row-right"><span>导出</span><span class="material-symbols-outlined">chevron_right</span></span></button>
        <button class="setting-item-row" id="settings-verify-backup"><span class="setting-row-left"><span class="setting-icon-box"><span class="material-symbols-outlined">verified</span></span><span><span class="setting-row-title">验证备份文件</span><span class="setting-row-subtitle">完整解密并校验，不覆盖当前数据</span></span></span><span class="setting-row-right"><span>只验证</span><span class="material-symbols-outlined">chevron_right</span></span></button>
        <button class="setting-item-row" id="settings-restore"><span class="setting-row-left"><span class="setting-icon-box"><span class="material-symbols-outlined">settings_backup_restore</span></span><span><span class="setting-row-title">从备份恢复</span><span class="setting-row-subtitle">确认后替换本机全部数据</span></span></span><span class="setting-row-right"><span>选择文件</span><span class="material-symbols-outlined">chevron_right</span></span></button>
      </div></section>
      <section class="mine-settings-section mine-update-section"><header class="mine-section-heading"><span class="mine-section-index" aria-hidden="true">05</span><h2>应用更新</h2><small>APP UPDATE</small></header>
      <div class="settings-group-card">
        <button class="setting-item-row" id="settings-update"><span class="setting-row-left"><span class="setting-icon-box"><span class="material-symbols-outlined">system_update</span></span><span><span class="setting-row-title">检查更新</span><span class="setting-row-subtitle" id="update-current-version">当前 ${esc(APP_VERSION_NAME)} · 只在你点击时才联网</span></span></span><span class="setting-row-right"><span id="update-status">检查</span><span class="material-symbols-outlined">chevron_right</span></span></button>
        <button class="setting-item-row" id="open-release-history"><span class="setting-row-left"><span class="setting-icon-box"><span class="material-symbols-outlined">new_releases</span></span><span><span class="setting-row-title">更新记录</span><span class="setting-row-subtitle">${releaseNoteCount ? `已保存 ${releaseNoteCount} 条版本说明` : '版本说明保存在这里，不刷当天活动'}</span></span></span><span class="setting-row-right"><span>查看</span><span class="material-symbols-outlined">chevron_right</span></span></button>
      </div></section>
      <footer class="mine-privacy-note"><span class="material-symbols-outlined">lock</span><p>数据默认保存在本机。仅在用户明确触发 AI 功能，以及已授权的凌晨日结任务执行时联网。</p><small id="mine-version-footer">暖色生活志 · v${esc(version)}</small></footer>
    </div>
  </section>`;
}

function profileForm(preserve = false) {
  if (!preserve) {
    pendingAvatar = state.profile.avatar || '';
    pendingProfileDraft = { name: state.profile.name, motto: state.profile.motto };
  } else pendingProfileDraft ||= { name: state.profile.name, motto: state.profile.motto };
  modal(`<form id="profile-form"><span class="eyebrow">PERSONAL PROFILE</span><h2>编辑资料</h2><div class="avatar-picker"><button type="button" id="pick-avatar" class="avatar-preview ${pendingAvatar ? 'has-avatar' : ''}" aria-label="选择头像">${avatarPreview()}</button><div><strong>个人头像</strong><small>选择照片后可拖动和缩放，圆框内就是最终头像。</small><button type="button" id="pick-avatar-text" class="text-button">${pendingAvatar ? '更换头像' : '从手机选择'}</button>${pendingAvatar ? '<button type="button" id="remove-avatar" class="text-button danger-text">恢复默认</button>' : ''}</div></div><label>昵称</label><input name="name" maxlength="16" required value="${esc(pendingProfileDraft.name)}"><label>个人格言</label><input name="motto" maxlength="50" required value="${esc(pendingProfileDraft.motto)}"><div class="modal-actions"><button type="button" data-close>取消</button><button class="save">保存资料</button></div></form>`, 'profile-modal');
  bindAvatarForm();
}

function avatarPreview() {
  return pendingAvatar ? `<img src="${imgSrc(pendingAvatar)}" alt="头像预览">` : `<span>${esc(state.profile.name.slice(-1))}</span><i class="material-symbols-outlined">photo_camera</i>`;
}

function bindAvatarForm() {
  const pick = () => {
    const form = $('#profile-form');
    if (form) pendingProfileDraft = { name: form.elements.name.value, motto: form.elements.motto.value };
    pickAvatar().catch(error => show(error.message));
  };
  $('#pick-avatar')?.addEventListener('click', pick);
  $('#pick-avatar-text')?.addEventListener('click', pick);
  $('#remove-avatar')?.addEventListener('click', () => { pendingAvatar = ''; refreshAvatarPreview(); });
}

function refreshAvatarPreview() {
  const preview = $('#pick-avatar');
  if (!preview) return;
  preview.classList.toggle('has-avatar', Boolean(pendingAvatar));
  preview.innerHTML = avatarPreview();
  $('#pick-avatar-text').textContent = pendingAvatar ? '更换头像' : '从手机选择';
  $('#remove-avatar')?.remove();
  if (pendingAvatar) $('#pick-avatar-text').insertAdjacentHTML('afterend', '<button type="button" id="remove-avatar" class="text-button danger-text">恢复默认</button>');
  $('#remove-avatar')?.addEventListener('click', () => { pendingAvatar = ''; refreshAvatarPreview(); });
}

function pickAvatar() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) return resolve();
        if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过 20MB');
        const source = await fileToDataUrl(file);
        await avatarCropForm(source);
        resolve();
      } catch (error) { reject(error); }
    };
    input.click();
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('无法读取这张图片'));
    reader.readAsDataURL(file);
  });
}

async function avatarCropForm(source) {
  const image = new Image();
  image.src = source;
  await image.decode();
  avatarCropState = { image, zoom: 1, x: 0, y: 0, dragging: false, pointerX: 0, pointerY: 0 };
  modal(`<div class="avatar-crop-modal"><span class="eyebrow">AVATAR CROP</span><h2>调整头像范围</h2><p class="subtle">拖动照片改变位置，滑动下方控制缩放。圆框内就是保存后的头像。</p><div class="avatar-crop-stage"><canvas id="avatar-crop-canvas" width="280" height="280" aria-label="头像裁剪预览"></canvas><span class="avatar-crop-guide" aria-hidden="true"></span></div><label class="avatar-zoom"><span class="material-symbols-outlined">image</span><input id="avatar-zoom" type="range" min="1" max="3" step="0.01" value="1" aria-label="头像缩放"><span class="material-symbols-outlined">zoom_in</span></label><button type="button" id="avatar-center" class="avatar-center"><span class="material-symbols-outlined">center_focus_strong</span>恢复居中</button><div class="modal-actions"><button type="button" id="avatar-crop-cancel">返回</button><button type="button" class="save" id="avatar-crop-apply">使用此范围</button></div></div>`, 'avatar-crop-dialog');
  bindAvatarCrop();
}

function avatarCropGeometry(size = 280) {
  const { image, zoom, x, y } = avatarCropState;
  const previewSize = 280;
  const base = Math.max(previewSize / image.naturalWidth, previewSize / image.naturalHeight);
  const previewWidth = image.naturalWidth * base * zoom;
  const previewHeight = image.naturalHeight * base * zoom;
  const maxX = Math.max(0, (previewWidth - previewSize) / 2);
  const maxY = Math.max(0, (previewHeight - previewSize) / 2);
  avatarCropState.x = Math.max(-maxX, Math.min(maxX, x));
  avatarCropState.y = Math.max(-maxY, Math.min(maxY, y));
  const factor = size / previewSize;
  const width = previewWidth * factor;
  const height = previewHeight * factor;
  return { width, height, left: (size - width) / 2 + avatarCropState.x * factor, top: (size - height) / 2 + avatarCropState.y * factor };
}

function drawAvatarCrop() {
  const canvas = $('#avatar-crop-canvas');
  if (!canvas || !avatarCropState) return;
  const ctx = canvas.getContext('2d');
  const geometry = avatarCropGeometry(canvas.width);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(avatarCropState.image, geometry.left, geometry.top, geometry.width, geometry.height);
  ctx.fillStyle = 'rgba(20,28,42,.44)';
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2 - 8, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
}

function bindAvatarCrop() {
  const canvas = $('#avatar-crop-canvas');
  drawAvatarCrop();
  canvas.onpointerdown = event => {
    avatarCropState.dragging = true;
    avatarCropState.pointerX = event.clientX;
    avatarCropState.pointerY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = event => {
    if (!avatarCropState.dragging) return;
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    avatarCropState.x += (event.clientX - avatarCropState.pointerX) * scale;
    avatarCropState.y += (event.clientY - avatarCropState.pointerY) * scale;
    avatarCropState.pointerX = event.clientX;
    avatarCropState.pointerY = event.clientY;
    drawAvatarCrop();
  };
  canvas.onpointerup = canvas.onpointercancel = () => { avatarCropState.dragging = false; };
  $('#avatar-zoom').oninput = event => { avatarCropState.zoom = Number(event.target.value); drawAvatarCrop(); };
  $('#avatar-center').onclick = () => { avatarCropState.zoom = 1; avatarCropState.x = 0; avatarCropState.y = 0; $('#avatar-zoom').value = '1'; drawAvatarCrop(); };
  $('#avatar-crop-cancel').onclick = () => { avatarCropState = null; profileForm(true); };
  $('#avatar-crop-apply').onclick = () => {
    const output = document.createElement('canvas');
    output.width = output.height = 512;
    const geometry = avatarCropGeometry(512);
    output.getContext('2d').drawImage(avatarCropState.image, geometry.left, geometry.top, geometry.width, geometry.height);
    pendingAvatar = output.toDataURL('image/jpeg', .84);
    avatarCropState = null;
    profileForm(true);
  };
}

// 主题卡片：色板取自 THEME_META.swatch（主背景 / 卡片 / 强调），
// 让用户在点之前就能看出这套皮肤大概长什么样。
function themeOptionsHtml() {
  const current = state.settings?.theme || 'classic';
  return APP_THEMES.map(id => {
    const meta = THEME_META[id] || { label: id, description: '', swatch: [] };
    const active = current === id;
    return `<button type="button" class="theme-option ${active ? 'active' : ''}" data-theme-option="${esc(id)}" aria-pressed="${active}">
      <span class="theme-swatch">${(meta.swatch || []).map(color => `<i style="background:${esc(color)}"></i>`).join('')}</span>
      <strong>${esc(meta.label)}</strong>
      <small>${esc(meta.description)}</small>
      ${active ? '<span class="theme-option-check material-symbols-outlined">check_circle</span>' : ''}
    </button>`;
  }).join('');
}

// 点主题卡片 → 立即换肤 + 立即保存（换肤讲究所见即所得，不等「保存」按钮）。
// 只改 settings.theme 一个字段，不触碰背景相关的 pending 状态。
function selectTheme(theme) {
  if (!APP_THEMES.includes(theme) || state.settings.theme === theme) return;
  state.settings.theme = theme;
  applyTheme(theme);
  save().catch(error => show(error?.message || '主题保存失败'));
  // 就地更新选中态，避免重建整个弹窗（重建会丢失用户已调好的背景预览）
  const grid = $('.theme-picker-grid');
  if (grid) grid.innerHTML = themeOptionsHtml();
  $$('[data-theme-option]').forEach(button => {
    button.onclick = () => selectTheme(button.dataset.themeOption);
  });
}

function backgroundForm() {
  pendingBackgroundImage = state.settings.backgroundImage || '';
  pendingBackgroundOverlayOpacity = state.settings.backgroundOverlayOpacity ?? 72;
  pendingBackgroundFit = state.settings.backgroundFit === 'cover' ? 'cover' : 'contain';
  pendingBackgroundZoom = Number.isFinite(Number(state.settings.backgroundZoom)) ? Math.min(2, Math.max(0.5, Number(state.settings.backgroundZoom))) : 1;
  pendingBackgroundOffsetX = Number.isFinite(Number(state.settings.backgroundOffsetX)) ? Math.min(1, Math.max(-1, Number(state.settings.backgroundOffsetX))) : 0;
  pendingBackgroundOffsetY = Number.isFinite(Number(state.settings.backgroundOffsetY)) ? Math.min(1, Math.max(-1, Number(state.settings.backgroundOffsetY))) : 0;
  modal(`<form id="background-form"><span class="eyebrow">APPEARANCE</span><h2>主题与背景</h2><div class="theme-picker"><span class="theme-picker-title">主题皮肤</span><div class="theme-picker-grid">${themeOptionsHtml()}</div><small class="theme-picker-hint">点一下立即生效，会自动记住</small></div><p class="subtle">背景会覆盖整个 App 外壳，半透明毛玻璃层会持续保护文字与卡片的清晰度。</p><div class="background-preview" id="background-preview" data-no-swipe-back data-no-sheet-drag>${backgroundPreview()}</div>${pendingBackgroundImage ? '<p class="background-drag-hint"><span class="material-symbols-outlined">pan_tool_alt</span>可拖动壁纸调整位置；完整显示下可上下移动，放大后更灵活</p>' : ''}<div class="background-image-actions"><button type="button" class="soft-button" id="pick-background"><span class="material-symbols-outlined">photo_library</span>${pendingBackgroundImage ? '更换背景' : '选择图片'}</button><button type="button" class="text-button danger-text" id="reset-background">恢复默认背景</button></div><div class="background-fit-control"><label class="background-fit-option"><input type="radio" name="backgroundFit" value="cover" ${pendingBackgroundFit === 'cover' ? 'checked' : ''}><span><i class="material-symbols-outlined">fullscreen</i><strong>铺满屏幕</strong><small>横图铺满用，竖图会上下裁切</small></span></label><label class="background-fit-option"><input type="radio" name="backgroundFit" value="contain" ${pendingBackgroundFit === 'contain' ? 'checked' : ''}><span><i class="material-symbols-outlined">fit_screen</i><strong>完整显示（推荐）</strong><small>任意尺寸壁纸完整可见，可缩放拖动调整</small></span></label></div><label class="background-zoom-control"><span>壁纸缩放 <b id="background-zoom-value">${Math.round(pendingBackgroundZoom * 100)}%</b></span><input id="background-zoom" type="range" min="50" max="200" step="5" value="${Math.round(pendingBackgroundZoom * 100)}" aria-label="壁纸缩放"><small>100% = 当前显示方式默认 · 放大后可查看超出屏幕的部分</small></label><label class="background-blur-control"><span>背景清晰度 <b id="background-clarity-value">${100 - pendingBackgroundOverlayOpacity}%</b></span><input id="background-clarity" type="range" min="0" max="100" step="1" value="${100 - pendingBackgroundOverlayOpacity}" aria-label="背景清晰度"><small>0% 最朦胧 · 100% 最清晰 · 推荐：28%</small></label><div class="modal-actions"><button type="button" data-close>取消</button><button class="save">保存外观</button></div></form>`, 'background-modal mine-background-modal');
  // 真机按当前设备实际视口比例覆盖预览框；浏览器预览由 CSS 的 9:19.5 兜底。
  const backgroundPreviewBox = $('#background-preview');
  if (backgroundPreviewBox) backgroundPreviewBox.style.aspectRatio = Capacitor.isNativePlatform() ? `${innerWidth} / ${innerHeight}` : '';
  $('#pick-background').onclick = () => pickBackground().catch(error => show(error.message));
  // 主题卡片：点一下立即换肤（不经过「保存」，换肤就该所见即所得）
  $$('[data-theme-option]').forEach(button => {
    button.onclick = () => selectTheme(button.dataset.themeOption);
  });
  $('#reset-background').onclick = () => { pendingBackgroundImage = ''; pendingBackgroundOverlayOpacity = 72; pendingBackgroundFit = 'contain'; pendingBackgroundZoom = 1; pendingBackgroundOffsetX = 0; pendingBackgroundOffsetY = 0; refreshBackgroundPreview(); };
  $('#background-clarity').oninput = event => { pendingBackgroundOverlayOpacity = 100 - Number(event.target.value); refreshBackgroundPreview(); };
  $('#background-zoom').oninput = event => { pendingBackgroundZoom = Math.min(2, Math.max(0.5, Number(event.target.value) / 100)); refreshBackgroundPreview(); };
  $$('[name="backgroundFit"]').forEach(radio => radio.onchange = () => { pendingBackgroundFit = radio.value === 'cover' ? 'cover' : 'contain'; refreshBackgroundPreview(); });
  // 打开表单即回显已保存的缩放/位移：图片已加载直接应用，未加载等 onload 后再应用。
  if (pendingBackgroundImage) {
    const previewImage = $('#background-preview-image');
    if (previewImage) {
      if (previewImage.complete && previewImage.naturalWidth > 0) applyPreviewTransform();
      else previewImage.onload = applyPreviewTransform;
    }
  }
  bindBackgroundDrag();
}

function backgroundPreview() {
  if (!pendingBackgroundImage) {
    const label = (THEME_META[state.settings?.theme] || THEME_META.classic).label;
    return `<span class="material-symbols-outlined">wallpaper</span><small>当前${esc(label)}主题</small>`;
  }
  return `<img id="background-preview-image" src="${imgSrc(pendingBackgroundImage)}" alt="当前背景预览" style="object-fit:${pendingBackgroundFit}"><i style="--background-preview-overlay:${pendingBackgroundOverlayOpacity / 100}"></i>`;
}

function refreshBackgroundPreview() {
  const preview = $('#background-preview');
  if (!preview) return;
  preview.classList.toggle('has-image', Boolean(pendingBackgroundImage));
  preview.innerHTML = backgroundPreview();
  const hint = $('.background-drag-hint');
  if (hint) hint.style.display = pendingBackgroundImage ? '' : 'none';
  $('#background-clarity').value = String(100 - pendingBackgroundOverlayOpacity);
  $('#background-clarity-value').textContent = `${100 - pendingBackgroundOverlayOpacity}%`;
  const zoomSlider = $('#background-zoom');
  if (zoomSlider) zoomSlider.value = String(Math.round(pendingBackgroundZoom * 100));
  const zoomLabel = $('#background-zoom-value');
  if (zoomLabel) zoomLabel.textContent = `${Math.round(pendingBackgroundZoom * 100)}%`;
  $('#pick-background').innerHTML = `<span class="material-symbols-outlined">photo_library</span>${pendingBackgroundImage ? '更换背景' : '选择图片'}`;
  $$('[name="backgroundFit"]').forEach(radio => { radio.checked = radio.value === pendingBackgroundFit; });
  const image = $('#background-preview-image');
  if (image) image.onload = applyPreviewTransform;
  // 无移动空间的方向锁定居中（有空间的方向保留 offset）。
  if (image && image.naturalWidth && image.naturalHeight) {
    const range = backgroundDragRange();
    if (range.x === 0) pendingBackgroundOffsetX = 0;
    if (range.y === 0) pendingBackgroundOffsetY = 0;
  }
  applyPreviewTransform();
  bindBackgroundDrag();
}

// 预览拖动换算：与 core.js applyCustomBackground 的 scale/background-position 公式严格一致。
// offset ±1 ↔ 图边缘对齐容器边缘；预览 translate 像素 = 真机位移（方向已对齐）。
function backgroundDragRange() {
  const preview = $('#background-preview');
  const image = $('#background-preview-image');
  if (!preview || !image || !image.naturalWidth || !image.naturalHeight) return { x: 0, y: 0 };
  const box = preview.getBoundingClientRect();
  const fitScale = pendingBackgroundFit === 'contain'
    ? Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight)
    : Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight);
  const scaleTotal = (pendingBackgroundFit === 'contain' ? 1 : 1 + (pendingBackgroundOverlayOpacity / 100) * 0.04) * pendingBackgroundZoom;
  const renderedWidth = image.naturalWidth * fitScale * scaleTotal;
  const renderedHeight = image.naturalHeight * fitScale * scaleTotal;
  // 图比容器大时可调整裁切区域，图比容器小时可调整留白分布（边缘最多贴到容器边缘）。
  return { x: Math.abs(renderedWidth - box.width) / 2, y: Math.abs(renderedHeight - box.height) / 2 };
}

function applyPreviewTransform() {
  const image = $('#background-preview-image');
  if (!image) return;
  const range = backgroundDragRange();
  const offsetX = pendingBackgroundOffsetX;
  const offsetY = pendingBackgroundOffsetY;
  image.style.transform = `translate(${(-offsetX * range.x).toFixed(2)}px, ${(-offsetY * range.y).toFixed(2)}px) scale(${pendingBackgroundZoom})`;
}

function bindBackgroundDrag() {
  const preview = $('#background-preview');
  const image = $('#background-preview-image');
  if (!preview || !image) {
    if (preview) { preview.onpointerdown = null; preview.onpointermove = null; preview.onpointerup = null; preview.onpointercancel = null; }
    return;
  }
  const start = event => {
    const range = backgroundDragRange();
    if (!range.x && !range.y) return;
    backgroundDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, offsetX: pendingBackgroundOffsetX, offsetY: pendingBackgroundOffsetY, range };
    try { preview.setPointerCapture(event.pointerId); } catch (error) { /* headless/异常场景忽略 */ }
    preview.classList.add('dragging');
  };
  const move = event => {
    if (!backgroundDrag || event.pointerId !== backgroundDrag.pointerId) return;
    const dx = event.clientX - backgroundDrag.startX;
    const dy = event.clientY - backgroundDrag.startY;
    pendingBackgroundOffsetX = backgroundDrag.range.x > 0 ? Math.min(1, Math.max(-1, backgroundDrag.offsetX - dx / backgroundDrag.range.x)) : 0;
    pendingBackgroundOffsetY = backgroundDrag.range.y > 0 ? Math.min(1, Math.max(-1, backgroundDrag.offsetY - dy / backgroundDrag.range.y)) : 0;
    applyPreviewTransform();
  };
  const end = event => {
    if (!backgroundDrag || event.pointerId !== backgroundDrag.pointerId) return;
    backgroundDrag = null;
    preview.classList.remove('dragging');
  };
  preview.onpointerdown = start;
  preview.onpointermove = move;
  preview.onpointerup = end;
  preview.onpointercancel = end;
}

function pickBackground() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) return resolve();
        if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过 20MB');
        pendingBackgroundImage = await prepareBackgroundImage(file);
        refreshBackgroundPreview();
        resolve();
      } catch (error) { reject(error); }
    };
    input.click();
  });
}

async function prepareBackgroundImage(file) {
  const source = await fileToDataUrl(file);
  const image = new Image();
  image.src = source;
  await image.decode();
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = Math.min(1, 1600 / longestSide);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', .82);
}

function showSettingsAndData() {
  modal(`<div class="modal-head"><div><span class="eyebrow">LOCAL DATA HEALTH</span><h2>本机数据状态</h2><p>这里只显示媒体文件、数据库与安全快照的健康情况；具体操作保留在 Mine 的“数据与安全”。</p></div></div><div class="data-health-card" id="data-health-card"><span class="material-symbols-outlined">health_and_safety</span><span><strong>正在检查数据…</strong><small>媒体文件、数据库与安全快照</small></span></div><p class="local-note"><span class="material-symbols-outlined">lock</span>数据默认保存在本机。检查过程不会上传照片、视频、密码或日记内容。</p><div class="modal-actions"><button type="button" data-close>完成</button></div>`, 'mine-data-modal');
  Promise.all([storageHealth(state), mediaHealth(state)]).then(([storage, media]) => { const card = $('#data-health-card'); if (!card) return; const size = formatDataSize(storage.serializedBytes); card.classList.toggle('warning', !media.healthy); card.innerHTML = `<span class="material-symbols-outlined">${media.healthy ? 'verified_user' : 'warning'}</span><span><strong>${media.healthy ? '数据状态正常' : '发现媒体文件缺失'}</strong><small>${media.files} 个媒体文件 · ${storage.snapshots}/5 个安全快照${size ? ` · ${size} 本地数据` : ''}</small></span>`; });
}

async function createLocalSnapshot(reason) {
  return createSafetySnapshot(state, reason);
}

async function safetySnapshotList() {
  const snapshots = await listSafetySnapshots();
  modal(`<div class="modal-head"><div><h2>本机安全快照</h2><p>最多保留最近 5 份，可在升级或误操作后回退。</p></div></div><div class="snapshot-list">${snapshots.length ? snapshots.map(item => `<button data-restore-snapshot="${item.id}"><span class="material-symbols-outlined">restore</span><span><strong>${esc(item.reason)}</strong><small>${new Date(item.createdAt).toLocaleString('zh-CN')} · 数据版本 ${item.schemaVersion}</small></span><i class="material-symbols-outlined">chevron_right</i></button>`).join('') : emptyState('还没有安全快照', '升级前会自动创建，也可以手动创建。')}</div><div class="modal-actions"><button type="button" id="snapshot-back">返回</button></div>`, 'large-modal mine-snapshot-modal');
  $('#snapshot-back').onclick = showSettingsAndData;
  $$('[data-restore-snapshot]').forEach(button => button.onclick = () => confirmSnapshotRestore(button.dataset.restoreSnapshot));
}

function confirmSnapshotRestore(id) {
  modal(`<h2>恢复这个安全快照？</h2><p>当前数据会先自动保存为一份新快照，然后替换为所选版本。</p><div class="modal-actions"><button type="button" id="snapshot-cancel">取消</button><button class="save" id="snapshot-confirm">确认恢复</button></div>`, 'mine-snapshot-confirm-modal');
  $('#snapshot-cancel').onclick = safetySnapshotList;
  $('#snapshot-confirm').onclick = async () => {
    const previousState = state;
    try {
      const restored = await readSafetySnapshot(id);
      await createLocalSnapshot('恢复快照前');
      setState(migrateState(restored, defaults));
      await externalizeStateMedia(state);
      const persisted = await replaceState(state);
      callHelper('setAiHistory', [...(state.aiHistory || [])]);
      clearJournalDraftCache();
      closeModal(); render(); show('安全快照已恢复');
      notifyPersistedKeySeal(persisted);
    } catch (error) { setState(previousState); show(error.message); }
  };
}

function openBackupModal() { modal(`<form id="backup-form"><h2>导出加密备份</h2><p class="subtle">Android App 会把待办、日记、照片和视频写入一个备份文件；大媒体在文件内部按 8MB 分块并分别进行 AES-GCM 完整性保护，恢复时由 App 自动拼接，不需要手动处理。可处理 100GB 级媒体，实际容量取决于目标位置剩余空间和文件系统；超过 4GB 请勿保存到 FAT32。导出期间会在通知栏持续显示进度，请勿强制结束 App。网页预览仅保留 256MB 以内的兼容备份。密码无法找回。</p><label>备份密码（至少 8 个字符）</label><input name="password" type="password" minlength="8" required autocomplete="new-password"><div class="backup-export-status"><span id="backup-export-progress" aria-live="polite">等待选择保存位置</span><progress id="backup-export-meter" max="100" value="0" aria-label="备份导出进度"></progress></div><div class="modal-actions"><button type="button" data-close>取消</button><button class="save">选择位置并导出</button></div></form>`, 'mine-backup-modal'); }

function openVerifyBackupModal() { modal(`<form id="verify-backup-form"><h2>验证备份文件</h2><p class="subtle">App 会完整读取、解密并校验所选备份。媒体只写入临时验证区，结束后立即清理；不会提交恢复，也不会覆盖当前数据。</p><label>备份密码</label><input name="password" type="password" minlength="8" required autocomplete="current-password"><div class="backup-restore-status"><span data-backup-read-progress aria-live="polite">等待选择备份文件</span><progress data-backup-read-meter max="100" value="0" aria-label="备份验证进度"></progress></div><div class="modal-actions"><button type="button" data-close>取消</button><button class="save">选择文件并验证</button></div></form>`, 'mine-backup-verify-modal'); }

// ---- 底部导航自定义（排序 + 显隐）----
let navDraft = [];
let navDrag = null;
const MIN_VISIBLE_TABS = 2;

function navTabsForm() {
  navDraft = (state.settings?.navTabs || makeDefaultNavTabs()).map(item => ({ ...item }));
  navDrag = null;
  modal(`<div class="modal-head"><div><h2>底部导航</h2><p>拖动调整顺序，开关控制显隐。至少保留 4 个，今天不可隐藏。</p></div></div><div class="nav-preview" id="nav-preview">${navPreviewHtml()}</div><div class="nav-tabs-list" id="nav-tabs-list">${navListHtml()}</div><div class="modal-actions"><button type="button" data-close>取消</button><button class="save" id="nav-save">保存</button></div>`, 'large-modal');
  bindNavTabsList();
  bindNavPreview();
  $('#nav-save').onclick = () => {
    state.settings.navTabs = navDraft.map((item, index) => ({ route: item.route, visible: item.visible, order: index }));
    closeModal();
    save().catch(() => {});
    render();
    show('底部导航已更新');
  };
}

function navVisibleCount() {
  return navDraft.filter(item => item.visible).length;
}

function navListHtml() {
  return navDraft.map((item, index) => {
    const meta = NAV_TABS[item.route] || { label: item.route, icon: 'circle' };
    const isToday = item.route === 'today';
    const disabled = isToday || navVisibleCount() <= MIN_VISIBLE_TABS;
    return `<div class="nav-tab-row" data-nav-route="${item.route}" data-nav-index="${index}"><button type="button" class="nav-drag-handle" data-nav-drag data-no-swipe-back aria-label="拖动排序"><span class="material-symbols-outlined">drag_indicator</span></button><span class="round-icon material-symbols-outlined nav-row-icon">${meta.icon}</span><span class="nav-row-name">${meta.label}${isToday ? '<em>固定</em>' : ''}</span><label class="nav-switch"><input type="checkbox" data-nav-toggle="${item.route}" ${item.visible ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span></span></label></div>`;
  }).join('');
}

function navPreviewHtml() {
  const visible = navDraft.filter(item => item.visible).sort((a, b) => a.order - b.order);
  return visible.map(item => {
    const meta = NAV_TABS[item.route] || { label: item.route, icon: 'circle' };
    return `<span class="nav-preview-item" data-preview-route="${item.route}"><span class="material-symbols-outlined">${meta.icon}</span><small>${meta.label}</small></span>`;
  }).join('');
}

function bindNavPreview() {
  $('#nav-preview').innerHTML = navPreviewHtml();
}

function bindNavTabsList() {
  const list = $('#nav-tabs-list');
  if (!list) return;
  // 开关
  $$('[data-nav-toggle]', list).forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      const route = checkbox.dataset.navToggle;
      const item = navDraft.find(entry => entry.route === route);
      if (!item) return;
      if (item.route === 'today') { checkbox.checked = true; show('今天不可隐藏'); return; }
      const willHide = !checkbox.checked;
      if (willHide && navVisibleCount() <= MIN_VISIBLE_TABS) {
        checkbox.checked = true;
        show(`至少保留 ${MIN_VISIBLE_TABS} 个导航项`);
        return;
      }
      item.visible = checkbox.checked;
      list.innerHTML = navListHtml();
      bindNavTabsList();
      bindNavPreview();
    });
  });
  // 拖动：长按把手进入，移动换位，松手落位
  $$('[data-nav-drag]', list).forEach(handle => {
    let pressTimer = null;
    handle.addEventListener('pointerdown', event => {
      event.preventDefault();
      const row = handle.closest('[data-nav-route]');
      pressTimer = setTimeout(() => beginNavDrag(row, event), 300);
    });
    handle.addEventListener('pointerup', () => { clearTimeout(pressTimer); endNavDrag(); });
    handle.addEventListener('pointercancel', () => { clearTimeout(pressTimer); endNavDrag(); });
  });
}

function beginNavDrag(row, event) {
  if (!row) return;
  navDrag = { row, pointerId: event.pointerId, lastY: event.clientY, originIndex: Number(row.dataset.navIndex), targetIndex: Number(row.dataset.navIndex) };
  try { row.setPointerCapture?.(event.pointerId); } catch (error) { /* headless/异常场景忽略 */ }
  row.classList.add('nav-dragging');
  row.style.zIndex = '9';
  row.addEventListener('pointermove', onNavDragMove);
  row.addEventListener('pointerup', endNavDrag);
  row.addEventListener('pointercancel', endNavDrag);
  // 拖动期间全局防选/防长按系统菜单（Android WebView 长按会弹复制/文本选取菜单抢占手势）
  document.body.style.userSelect = 'none';
  document.body.style.webkitUserSelect = 'none';
  document.body.style.webkitTouchCallout = 'none';
  document.body.addEventListener('contextmenu', preventNavContextMenu, true);
}

function preventNavContextMenu(event) {
  if (navDrag) event.preventDefault();
}

function onNavDragMove(event) {
  if (!navDrag) return;
  const list = $('#nav-tabs-list');
  const rows = [...list.querySelectorAll('.nav-tab-row')];
  let targetIndex = navDrag.targetIndex;
  for (let i = 0; i < rows.length; i += 1) {
    const rect = rows[i].getBoundingClientRect();
    if (event.clientY > rect.top + rect.height / 2) targetIndex = i;
  }
  // 拖动中只做视觉跟随（平移当前行），不重建 DOM
  const offset = targetIndex - navDrag.originIndex;
  navDrag.row.style.transform = `translateY(${offset * 100}%)`;
  navDrag.targetIndex = targetIndex;
}

function endNavDrag() {
  if (!navDrag) return;
  const { row, originIndex, targetIndex } = navDrag;
  if (targetIndex !== originIndex && targetIndex >= 0 && targetIndex < navDraft.length) {
    const moved = navDraft.splice(originIndex, 1)[0];
    navDraft.splice(targetIndex, 0, moved);
    navDraft.forEach((item, index) => { item.order = index; });
    const list = $('#nav-tabs-list');
    if (list) {
      list.innerHTML = navListHtml();
      bindNavTabsList();
    }
    bindNavPreview();
  } else if (row) {
    row.classList.remove('nav-dragging');
    row.style.transform = '';
    row.style.zIndex = '';
  }
  document.body.style.userSelect = '';
  document.body.style.webkitUserSelect = '';
  document.body.style.webkitTouchCallout = '';
  document.body.removeEventListener('contextmenu', preventNavContextMenu, true);
  navDrag = null;
}
function openRestoreModal() { modal(`<form id="restore-form"><h2>从备份恢复</h2><p class="subtle">恢复会替换当前设备内的全部数据，建议先导出当前备份。</p><label>备份密码</label><input name="password" type="password" minlength="8" required autocomplete="current-password"><label class="confirm-line"><input name="confirm" type="checkbox" required> 我确认替换当前全部数据</label><div class="backup-restore-status"><span data-backup-read-progress aria-live="polite">等待选择备份文件</span><progress data-backup-read-meter max="100" value="0" aria-label="备份恢复进度"></progress><small>读取期间请保持 App 运行；退到后台时通知栏会继续显示进度。</small></div><div class="modal-actions"><button type="button" data-close>取消</button><button class="save">选择文件并恢复</button></div></form>`, 'mine-restore-modal'); }

// ---- 绑定 ----
/* ---------------------------------------------------------------------------
   应用更新（2026-10-09）

   只在用户点「检查更新」时才联网 —— 不做启动自动检查、不后台轮询，
   与项目「零自动联网，只有用户显式操作才请求」的原则一致。

   流程：读版本清单 → 比 versionCode → 有新版则下载 → 交给系统安装器。
   安装不是静默的：Android 会弹自己的确认页，用户必须亲自点「安装」。
   --------------------------------------------------------------------------- */

function showReleaseHistory() {
  const releases = [...(state.releases || [])].sort((a, b) => Number(b.code) - Number(a.code));
  if (!releases.length) {
    show('还没有保存的更新说明');
    return;
  }
  const rows = releases.map(release => {
    const when = formatShanghaiDateTime(release.createdAt) || release.date || '';
    return `<button type="button" class="release-history-row" data-release-history="${Number(release.code) || ''}"><span class="material-symbols-outlined" aria-hidden="true">new_releases</span><span class="release-history-copy"><strong>${esc(release.title || `更新到 ${release.versionName}`)}</strong><small>v${esc(release.versionName)}${when ? ` · ${esc(when)}` : ''}</small></span><span class="material-symbols-outlined" aria-hidden="true">chevron_right</span></button>`;
  }).join('');
  modal(`<div class="release-history"><div class="release-notes-head"><span class="release-notes-badge"><span class="material-symbols-outlined" aria-hidden="true">history</span></span><div class="release-notes-head-copy"><span class="eyebrow">UPDATE ARCHIVE</span><h2>更新记录</h2><p>历史版本说明都留在这里。当天活动只显示你刚升级到的那一版。</p></div></div><div class="release-history-list">${rows}</div><div class="modal-actions"><button type="button" data-close>关闭</button></div></div>`, 'release-history-modal');
  $$('[data-release-history]').forEach(button => button.onclick = () => openReleaseNotes(button.dataset.releaseHistory));
}

/* 当前生效的版本号 = 装机版本与「已应用到的资源版本」里较新的那个。
   渲染时先用常量占位，挂载后异步纠正一次。
   ⚠️ 为什么必须只有一个答案（2026-10-12 用户反馈「显示版本号和实际不符」）：
   热更新只换网页资源、装机 versionCode 不变。若一处按资源算、一处按装机算，
   用户会看到这行写着新版号、点检查却报旧版号，像是版本对不上。 */
async function refreshCurrentVersionLabel() {
  if (!isUpdateSupported()) return;
  try {
    const version = await effectiveVersion();
    if (!version.versionName) return;
    const label = $('#update-current-version');
    if (label) label.textContent = `当前 ${version.versionName} · 只在你点击时才联网`;
    const footer = $('#mine-version-footer');
    if (footer) footer.textContent = `暖色生活志 · v${version.versionName}`;
  } catch { /* 读不到就用渲染时的常量，不打扰用户 */ }
}

/* 本次真正要下载的体积：热更新=变化文件之和（几 MB）；整包=安装包体积。
   读不到清单就返回 null，界面据此不报数字 —— 绝不写死一个值。 */
async function pendingUpdateSize(manifest) {
  if (!manifest?.resourceManifestUrl) return null;
  try {
    const resourceManifest = await fetchResourceManifest(manifest);
    if (!resourceManifest) return null;
    const pending = await pendingResourceUpdate(resourceManifest);
    return pending.exact ? { bytes: pending.bytes, count: pending.count, hot: true } : null;
  } catch {
    return null;   // 算不出来就不提体积，不要编一个
  }
}

async function checkForUpdate() {
  const status = $('#update-status');
  if (!isUpdateSupported()) {
    show('网页预览不支持应用内更新，请在手机版使用');
    return;
  }
  if (status) status.textContent = '检查中…';
  try {
    const manifest = await fetchUpdateManifest(state.settings?.updateManifestUrl);
    // 比较与显示都用「实际生效的版本」：它与设置页那行、页脚同一个来源。
    // （热更新只替换网页资源，装机包的 versionCode 不会变，所以不能只看装机版本。）
    const current = await effectiveVersion();
    if (!hasNewerVersion(manifest, Number(current.versionCode) || 0)) {
      if (status) status.textContent = '已是最新';
      show(`已是最新版本（${current.versionName || APP_VERSION_NAME}）`);
      return;
    }
    if (status) status.textContent = '有新版本';
    const pending = await pendingUpdateSize(manifest);
    updateDialog(manifest, current, pending);
  } catch (error) {
    if (status) status.textContent = '检查';
    show(error?.message || '检查更新失败，请稍后再试');
  }
}

function updatePublishedLabel(value) {
  const text = String(value || '').trim();
  if (!/(?:T|\s)\d{2}:\d{2}/.test(text)) return '';
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? formatShanghaiDateTime(parsed) : '';
}

function updateDialog(manifest, current, pending) {
  const published = updatePublishedLabel(manifest.publishedAt);
  const notes = String(manifest.notes || '').split('\n').map(line => line.trim()).filter(Boolean);
  const hot = Boolean(manifest.resourceManifestUrl);
  // 体积只报「本次真正要下的量」：
  //   热更新 → 变化文件之和（通常几 MB），由 pendingUpdateSize 现算；
  //   整包   → 安装包体积。
  // ⚠️ 决不能用整包体积顶替热更新的体积 —— 用户会以为每次都要下一整包
  //    （2026-10-12 反馈：更新的实际大小一直写死一个值）。
  const sizeText = pending
    ? `${formatBytes(pending.bytes)}（${pending.count} 个文件）`
    : formatBytes(manifest.sizeBytes);
  const size = hot ? (pending ? sizeText : '') : sizeText;
  const fullSize = formatBytes(manifest.sizeBytes);
  modal(`<div class="update-dialog"><span class="eyebrow">NEW VERSION</span><h2>发现新版本 ${esc(manifest.versionName)}</h2><p class="update-from">${esc(current.versionName || APP_VERSION_NAME)} → <strong>${esc(manifest.versionName)}</strong>${size ? ` · ${esc(size)}` : ''}${published ? ` · ${esc(published)}` : ''}</p>${hot ? `<p class="update-hint"><span class="material-symbols-outlined">bolt</span>本次${pending ? `只下载变化的 ${pending.count} 个文件（${formatBytes(pending.bytes)}）` : '只下载变化的文件'}；万一装不上，会退回完整安装包${fullSize ? `（${fullSize}）` : ''}。</p>` : ''}${notes.length ? `<div class="update-notes">${notes.map(line => `<p>${esc(line)}</p>`).join('')}</div>` : ''}<div class="update-progress" id="update-progress" hidden><span class="update-progress-track"><i id="update-progress-bar"></i></span><small id="update-progress-text">准备中…</small></div><div class="modal-actions"><button type="button" data-close>以后再说</button><button type="button" class="save" id="update-download">${hot ? '下载变化部分' : '下载并更新'}</button></div></div>`, 'update-modal');
  $('#update-download')?.addEventListener('click', () => runUpdate(manifest));
}

async function runUpdate(manifest) {
  const button = $('#update-download');
  const progress = $('#update-progress');
  const bar = $('#update-progress-bar');
  const text = $('#update-progress-text');
  if (button) { button.disabled = true; button.textContent = '更新中…'; }
  if (progress) progress.hidden = false;

  // 先试资源热更新：只下载变化的文件，通常几 MB，比整个安装包小得多。
  // 失败（清单读不到、校验不过、没有权限）就静默回退到完整安装包，不让用户卡在这。
  if (manifest.resourceManifestUrl) {
    try {
      if (text) text.textContent = '正在比对差异…';
      const resources = await fetchResourceManifest(manifest);
      const result = await applyResourceUpdate(resources, (done, total, failed) => {
        const percent = total ? Math.round((done / total) * 100) : 0;
        if (bar) bar.style.width = `${percent}%`;
        if (text) text.textContent = `已更新 ${done}/${total} 个文件${failed ? `（${failed} 个失败）` : ''}`;
      });
      if (!result.failed) {
        closeModal();
        if (result.upToDate) {
          show('资源已经是最新的');
          return;
        }
        // 立刻重载页面，让新资源生效 —— 不必让用户手动杀进程重启。
        // 拦截器会从热更新目录取新文件；万一取不到，它会自动回退装机自带资源，不会白屏。
        show(`已更新 ${result.downloaded} 个文件，正在刷新…`);
        setTimeout(() => window.location.reload(), 800);
        return;
      }
    } catch (error) {
      // 落到下面的完整安装包流程
      if (text) text.textContent = '改为下载完整安装包…';
    }
  }

  if (button) button.textContent = '下载中…';
  const progressText = $('#update-progress-text');
  const progressBar = $('#update-progress-bar');
  try {
    const { path } = await downloadUpdate(manifest, ratio => {
      if (progressBar) progressBar.style.width = ratio === null ? '100%' : `${Math.round(ratio * 100)}%`;
      if (progressText) progressText.textContent = ratio === null ? '下载中…' : `已下载 ${Math.round(ratio * 100)}%`;
    });
    if (progressText) progressText.textContent = '下载完成，正在打开系统安装页…';
    // Android 8 起需要用户先允许「安装未知应用」，否则安装器会被系统拦下
    const permission = await canInstall();
    if (permission.supported && !permission.allowed) {
      closeModal();
      show('请先在系统设置里允许「暖色生活志」安装应用，然后重新下载');
      await openInstallSettings();
      return;
    }
    await installUpdate(path);
    closeModal();
    show('已交给系统安装，请在弹窗里点「安装」');
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = '重试下载'; }
    if (progressText) progressText.textContent = error?.message || '下载失败';
    show(error?.message || '更新失败');
  }
}

// ---- 提醒真实状态（读 #37 的 getReminderStatus，失败时安静降级）----
let reminderStatusSeq = 0;
async function refreshReminderStatus() {
  const box = $('#settings-reminder-status');
  if (!box) return;
  const seq = ++reminderStatusSeq;
  const configured = Math.min(DAILY_MAX_PER_DAY, (state.settings?.dailyReminders || []).filter(item => item && item.enabled !== false).length);
  let status = null;
  try { status = (await getReminderStatus()) || null; } catch { status = null; }
  if (seq !== reminderStatusSeq || !box.isConnected) return;
  const view = describeReminderStatus(status, configured);
  const right = $('#settings-reminder-state');
  if (right) { right.textContent = view.right; right.classList.toggle('state-ok', view.tone === 'ok'); }
  box.dataset.tone = view.tone;
  box.hidden = !view.note;
  box.querySelector('.setting-reminder-status-text').textContent = view.note;
  const button = box.querySelector('.setting-reminder-status-action');
  button.hidden = !view.action;
  button.onclick = view.action ? async () => {
    const opener = view.action.kind === 'exact' ? openExactAlarmSettings : openNotificationSettings;
    let opened = false;
    try { opened = await opener(); } catch { opened = false; }
    if (!opened) show('这里打不开系统设置，请到手机「设置 › 应用 › 生活志」里开启');
  } : null;
}

if (typeof document !== 'undefined') {
  // app.js 回前台时先 syncScheduledReminders，结束（成功或失败）后发 reminders:synced；
  // 等它重排完再读状态，期间保留旧显示，不闪「还在排」。从系统设置返回也走这条路。
  window.addEventListener('reminders:synced', () => { if (state.route === 'mine') refreshReminderStatus(); });
}

function bindMine() {
  const mediaCount = state.media.filter(entry => ['completed', 'in_progress', 'planned'].includes(entry.status)).length;
  $('#edit-profile')?.addEventListener('click', profileForm);
  $('#edit-avatar')?.addEventListener('click', profileForm);
  $('#settings-data')?.addEventListener('click', showSettingsAndData);
  $('#settings-update')?.addEventListener('click', () => { checkForUpdate(); });
  // 这行与页脚显示的是「实际生效的版本」（装机版本与已应用资源版本取较新者），
  // 渲染时先用常量占位，挂载后异步纠正一次 —— 否则热更新过的人会看到
  // 「这行写着新版号、点检查却报旧版号」。
  refreshCurrentVersionLabel();
  $('#settings-password-vault')?.addEventListener('click', () => callHelper('openPasswordVault'));
  $('#settings-ai')?.addEventListener('click', () => callHelper('aiSettingsForm'));
  $('#settings-reminder')?.addEventListener('click', () => callHelper('dailyReminderSettingsForm'));
  refreshReminderStatus();
  $('#settings-background')?.addEventListener('click', backgroundForm);
  $('#settings-snapshot')?.addEventListener('click', async () => { await createLocalSnapshot('用户手动创建'); await refreshMineHealth(mediaCount); show('已创建本机安全快照'); });
  $('#settings-snapshot-list')?.addEventListener('click', safetySnapshotList);
  $('#settings-backup')?.addEventListener('click', openBackupModal);
  $('#settings-verify-backup')?.addEventListener('click', openVerifyBackupModal);
  $('#settings-restore')?.addEventListener('click', openRestoreModal);
  $('#open-media-detail-mine')?.addEventListener('click', openMineMediaEntry);
  $('#open-documents')?.addEventListener('click', () => { pushBackState(); go('documents'); });
  $('#open-release-history')?.addEventListener('click', showReleaseHistory);
  $('#open-taste-archive')?.addEventListener('click', () => go('taste'));
  $('#open-local-gallery')?.addEventListener('click', () => go('local-gallery'));
  $('#open-habit-detail-mine')?.addEventListener('click', openMineHabitDetail);
  refreshMineHealth(mediaCount);
}

// ---- 表单提交 ----
registerSubmitHandler('profile-form', async data => {
  state.profile = { name: data.get('name').trim(), motto: data.get('motto').trim(), avatar: pendingAvatar };
  pendingAvatar = ''; pendingProfileDraft = null;
});

registerSubmitHandler('background-form', async () => {
  state.settings.backgroundImage = pendingBackgroundImage;
  state.settings.backgroundOverlayOpacity = pendingBackgroundOverlayOpacity;
  state.settings.backgroundFit = pendingBackgroundFit === 'cover' ? 'cover' : 'contain';
  state.settings.backgroundZoom = pendingBackgroundZoom;
  state.settings.backgroundOffsetX = pendingBackgroundOffsetX;
  state.settings.backgroundOffsetY = pendingBackgroundOffsetY;
  pendingBackgroundImage = '';
  pendingBackgroundOverlayOpacity = 72;
  pendingBackgroundFit = 'contain';
  pendingBackgroundZoom = 1;
  pendingBackgroundOffsetX = 0;
  pendingBackgroundOffsetY = 0;
});

registerSubmitHandler('backup-form', async (data, form) => {
  const button = form.querySelector('.save');
  const progress = form.querySelector('#backup-export-progress');
  const meter = form.querySelector('#backup-export-meter');
  if (button) { button.disabled = true; button.textContent = '正在导出…'; }
  if (progress) progress.textContent = '请选择保存位置，随后会开始分块写入。';
  try {
    const filename = await exportEncryptedBackup(state, data.get('password'), {
      onProgress: event => {
        if (!progress?.isConnected) return;
        const completed = Math.max(0, Number(event.completedBytes) || 0);
        const total = Math.max(0, Number(event.totalBytes) || 0);
        const percent = total > 0 ? Math.min(100, Math.floor(completed * 100 / total)) : 0;
        if (meter) meter.value = percent;
        progress.textContent = total > 0 ? `正在导出：${percent}% · ${formatBackupSize(completed)} / ${formatBackupSize(total)}` : `正在导出：已写入 ${formatBackupSize(completed)}`;
      }
    });
    closeModal(); show(`备份已生成：${filename}`);
  } finally {
    if (button?.isConnected) { button.disabled = false; button.textContent = '选择位置并导出'; }
  }
  return false;
});

registerSubmitHandler('verify-backup-form', async (data, form) => {
  const button = form.querySelector('.save');
  if (button) { button.disabled = true; button.textContent = '正在完整验证…'; }
  try {
    updateBackupReadProgress(form, { completedBytes: 0, totalBytes: 0 }, '验证');
    const result = await verifyEncryptedBackup(data.get('password'), { onProgress: event => updateBackupReadProgress(form, event, '验证') });
    const details = [
      result.archiveFormatVersion ? `归档格式 v${result.archiveFormatVersion}` : '',
      result.schemaVersion ? `数据版本 ${result.schemaVersion}` : '',
      result.exportedAt ? `导出于 ${new Date(result.exportedAt).toLocaleString('zh-CN')}` : ''
    ].filter(Boolean).join(' · ');
    modal(`<div class="modal-head"><div><h2>备份验证通过</h2><p>文件已完整解密并通过内容校验。</p></div></div><div class="data-health-card"><span class="material-symbols-outlined">verified_user</span><span><strong>当前数据未改变</strong><small>临时验证内容已经清理${details ? ` · ${esc(details)}` : ''}</small></span></div><div class="modal-actions"><button type="button" data-close>完成</button></div>`, 'mine-backup-verify-success-modal');
  } finally {
    if (button?.isConnected) { button.disabled = false; button.textContent = '选择文件并验证'; }
  }
  return false;
});

function formatBackupSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function updateBackupReadProgress(form, event, action) {
  const progress = form.querySelector('[data-backup-read-progress]');
  const meter = form.querySelector('[data-backup-read-meter]');
  const completed = Math.max(0, Number(event?.completedBytes) || 0);
  const total = Math.max(0, Number(event?.totalBytes) || 0);
  const percent = total > 0 ? Math.min(100, Math.floor(completed * 100 / total)) : 0;
  if (meter) { meter.value = percent; meter.removeAttribute('indeterminate'); }
  if (progress) progress.textContent = total > 0
    ? `正在${action}：${percent}% · ${formatBackupSize(completed)} / ${formatBackupSize(total)}`
    : `正在${action}并检查归档，请勿退出 App`;
}

registerSubmitHandler('restore-form', async (data, form) => {
  const previousState = structuredClone(state);
  const button = form.querySelector('.save');
  if (button) { button.disabled = true; button.textContent = '正在恢复…'; }
  updateBackupReadProgress(form, { completedBytes: 0, totalBytes: 0 }, '恢复');
  await createLocalSnapshot('恢复备份前');
  try {
    const restored = await importEncryptedBackup(data.get('password'), { onProgress: event => updateBackupReadProgress(form, event, '恢复') });
    setState(migrateState(restored, defaults));
    await externalizeStateMedia(state);
    const persisted = await replaceState(state);
    await finalizeImportedBackup();
    clearJournalDraftCache();
    closeModal(); render(); show('数据恢复完成');
    notifyPersistedKeySeal(persisted);
  } catch (error) {
    await rollbackImportedBackup().catch(() => {});
    setState(previousState);
    await replaceState(previousState).catch(() => {});
    render();
    throw error;
  } finally {
    if (button?.isConnected) { button.disabled = false; button.textContent = '选择文件并恢复'; }
  }
  return false;
});

registerView('mine', mineView);
registerBinder(bindMine);
