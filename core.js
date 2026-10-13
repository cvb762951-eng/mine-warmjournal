import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { persistState, protectedSnapshotMediaReferences, PERSIST_KEY_SKIPPED, KEY_SEAL_SKIPPED_NOTICE } from './storage.js';
import { CATEGORIES, dateKey, makeDefaultState, makeDefaultNavTabs, DEFAULT_NAV_ROUTES, ledgerSummary, calibrateLedgerAccount, habitHeatmapData, previousCompleteWeekRange, calculateFlowScore } from './model.js';
import { createDeferredSave } from './deferred-save.js';
import { externalizeStateMedia, mediaSource, removeUnusedMedia, stateMediaReferences } from './media-store.js';
import { liquidGlass, isLiquidGlassEnabled } from './liquid-glass.js';
import { morphFrom, autoStagger, markPressables, prefersReducedMotion } from './motion.js';

// ---- 工具函数 ----
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const pad = value => String(value).padStart(2, '0');
export const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
export const esc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

// ---- 常量 ----
export const defaults = makeDefaultState();
// 单条记录允许成为小型相册；总量由设备存储空间决定。张数上限保留，体积不再卡死。
export const JOURNAL_PHOTO_LIMIT = 60;
export const PHOTO_IMPORT_BATCH_LIMIT = 100;
// 日记照片优先原样外置保存。只有边长或像素会把解码内存顶满时才缩小，
// 缩小用的画布上限仍远高于旧的 1280 / 480KB。
export const JOURNAL_PHOTO_KEEP_MAX_SIDE = 16384;
export const JOURNAL_PHOTO_KEEP_MAX_PIXELS = 40 * 1024 * 1024;
export const JOURNAL_PHOTO_MAX_SIDE = 8192;
export const JOURNAL_PHOTO_MAX_PIXELS = 18 * 1024 * 1024;
export const JOURNAL_PHOTO_QUALITY = 0.92;
export const JOURNAL_PHOTO_MEMORY_BYTES = 48 * 1024 * 1024;
export const SUPPORTED_JOURNAL_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
// 随手拍高清晰度参数：最长边 1920px / 质量约 0.9 / 单张上限 2MB（真机以文件存储，不内嵌 SQLite）。
export const SNIPPET_PHOTO_MAX_SIDE = 1920;
export const SNIPPET_PHOTO_QUALITY = 0.9;
export const SNIPPET_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const HABIT_ICONS = [
  ['water_drop', '饮水'], ['menu_book', '阅读'], ['school', '学习'], ['edit_note', '写作'],
  ['fitness_center', '力量'], ['directions_run', '跑步'], ['directions_walk', '散步'], ['sports_gymnastics', '拉伸'],
  ['self_improvement', '冥想'], ['bedtime', '睡眠'], ['wb_sunny', '早起'], ['restaurant', '饮食'],
  ['medication', '健康'], ['brush', '创作'], ['music_note', '音乐'], ['translate', '语言'],
  ['savings', '储蓄'], ['cleaning_services', '整理'], ['pets', '宠物'], ['favorite', '关爱'],
  ['eco', '自然'], ['task_alt', '打卡'], ['computer', '编程'], ['psychology', '思考']
];
export const PROJECT_ICONS = [['school', '学习'], ['menu_book', '阅读'], ['translate', '语言'], ['calculate', '数学'], ['science', '理科'], ['history_edu', '人文'], ['code', '编程'], ['draw', '创作'], ['music_note', '音乐'], ['psychology', '思考'], ['fitness_center', '运动'], ['self_improvement', '冥想']];
export const PROJECT_COLORS = ['#4d638b', '#77708f', '#4f7b74', '#9a6a55', '#6b789b', '#8a6f85'];
export const NAV_TABS = {
  today: { label: '今天', icon: 'today' },
  calendar: { label: '日历', icon: 'calendar_month' },
  focus: { label: '计时', icon: 'timer' },
  statistics: { label: '统计', icon: 'monitoring' },
  ledger: { label: '账本', icon: 'receipt_long' },
  documents: { label: '资料库', icon: 'folder' },
  ai: { label: 'AI', icon: 'auto_awesome' },
  mine: { label: '我的', icon: 'person' }
};
export const MORE_ENTRIES = ['calendar', 'statistics', 'documents', 'mine'];

// ---- 共享状态（live binding：导出 let 变量，通过 setter 写入）----
export let state = structuredClone(defaults);
export let cursor = new Date();
export let selected = dateKey();

// ---- 内部变量（仅 core.js 函数使用，不导出）----
let modalTrigger = null;
let tick;
let toastTick;
let saveQueue = Promise.resolve();

// ---- setter（使 app.js 等导入方可以修改导出的 let 变量）----
export const setState = next => { state = next; };
export const setCursor = next => { cursor = next; };
export const setSelected = next => { selected = next; };
export const setTick = next => { tick = next; };

document.documentElement.classList.toggle('native-platform', Capacitor.isNativePlatform());

// ---- 工具函数（依赖 model/CATEGORIES）----
export const clock = seconds => {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor(safe % 3600 / 60);
  const tail = `${pad(minutes)}:${pad(safe % 60)}`;
  return hours ? `${pad(hours)}:${tail}` : tail;
};
export const durationText = seconds => {
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = seconds % 60;
  return [hours && `${hours}小时`, minutes && `${minutes}分钟`, rest && `${rest}秒`].filter(Boolean).join(' ') || '0秒';
};
export const formatMinutes = minutes => minutes >= 60 ? `${Math.floor(minutes / 60)}小时 ${minutes % 60}分` : `${minutes}分钟`;
export const category = key => CATEGORIES[key] || CATEGORIES.work;
export const imgSrc = value => esc(mediaSource(value));
export const avatarContent = (profile, alt = '头像') => profile.avatar ? `<img src="${imgSrc(profile.avatar)}" alt="${alt}">` : esc(profile.name.slice(-1));

export function applyCustomBackground(image = state.settings?.backgroundImage, overlayOpacity = state.settings?.backgroundOverlayOpacity) {
  const shell = $('.phone-shell');
  if (!shell) return;
  const source = mediaSource(image);
  if (!source) {
    shell.classList.remove('has-custom-background');
    shell.style.removeProperty('--custom-background-image');
    shell.style.removeProperty('--custom-background-overlay');
    shell.style.removeProperty('--custom-background-overlay-soft');
    shell.style.removeProperty('--custom-background-overlay-faint');
    shell.style.removeProperty('--custom-background-blur');
    shell.style.removeProperty('--custom-background-scale');
    shell.style.removeProperty('--custom-background-fit');
    shell.style.removeProperty('--custom-background-offset-x');
    shell.style.removeProperty('--custom-background-offset-y');
    return;
  }
  const fit = state.settings?.backgroundFit === 'contain' ? 'contain' : 'cover';
  const opacity = Math.max(0, Math.min(100, Number.isFinite(Number(overlayOpacity)) ? Number(overlayOpacity) : 72)) / 100;
  const blur = `${(opacity * 16).toFixed(2)}px`;
  const zoom = Number.isFinite(Number(state.settings?.backgroundZoom)) ? Math.min(2, Math.max(0.5, Number(state.settings.backgroundZoom))) : 1;
  // cover 保留模糊补边系数，contain 不补边；两者都叠乘用户缩放。
  const scale = String((fit === 'contain' ? 1 : 1 + opacity * 0.04) * zoom);
  const offsetX = Number.isFinite(Number(state.settings?.backgroundOffsetX)) ? Math.min(1, Math.max(-1, Number(state.settings.backgroundOffsetX))) : 0;
  const offsetY = Number.isFinite(Number(state.settings?.backgroundOffsetY)) ? Math.min(1, Math.max(-1, Number(state.settings.backgroundOffsetY))) : 0;
  const cssUrl = String(source).replace(/["\\\n\r]/g, '\\$&');
  shell.classList.add('has-custom-background');
  shell.style.setProperty('--custom-background-image', `url("${cssUrl}")`);
  shell.style.setProperty('--custom-background-overlay', String(opacity));
  shell.style.setProperty('--custom-background-overlay-soft', (opacity * .72).toFixed(3));
  shell.style.setProperty('--custom-background-overlay-faint', (opacity * .38).toFixed(3));
  shell.style.setProperty('--custom-background-blur', blur);
  shell.style.setProperty('--custom-background-scale', scale);
  shell.style.setProperty('--custom-background-fit', fit);
  // 归一化偏移映射为 background-position 百分比（offset ±1 ↔ 图边缘对齐容器边缘）。
  shell.style.setProperty('--custom-background-offset-x', `${(offsetX * 50).toFixed(2)}%`);
  shell.style.setProperty('--custom-background-offset-y', `${(offsetY * 50).toFixed(2)}%`);
}

// ---- 公共函数 ----
export const save = () => {
  // 整份保存会带上当前页面，切页面留下的延后保存就不用再跑了。
  if (typeof routeSave !== 'undefined') routeSave.cancelPending();
  const operation = saveQueue.then(async () => {
    await externalizeStateMedia(state);
    // 异步写入期间页面仍可能编辑状态；清理必须保护本次实际提交的引用。
    const savedState = structuredClone(state);
    const persisted = await persistState(savedState);
    // ⚠️ 只有确认内容已落库（persisted !== false）才清理未引用的媒体。
    // 整份落库被跳过时，内存里的新媒体引用还没进数据库；
    // 若此刻清理，会删掉「数据库不认、清理又删掉」的孤儿文件，重启后引用断裂 ——
    // 这正是 2026-10-08 用户反馈的「导入的视频丢失」根因。
    // 密钥单独跳过时日记/账本/速记已经落库，清理是安全的，也不能把这次保存判失败。
    if (persisted === false) throw new Error('数据尚未保存。请保持 App 打开后重试。');
    // 保存已经提交；清理失败不能反过来让调用方撤销内存中的成功记录。
    try { await removeUnusedMedia(savedState, [...await protectedSnapshotMediaReferences(), ...stateMediaReferences(state), ...(state.privateVault?.assetRefs || [])]); }
    catch (error) { console.warn('数据已保存，媒体清理暂未执行', error); }
    if (persisted === 'key-skipped') notifyPersistedKeySeal(persisted);
  }).catch(error => {
    const failure = new Error(`保存失败：${error?.message || '本机存储不可用'}`);
    if ($('#toast')) show(failure.message);
    throw failure;
  });
  saveQueue = operation.catch(() => {});
  return operation;
};

// 切页面只改了 state.route：延后合并成一次整份保存，避免每次点进页面都 structuredClone + JSON.stringify 整个数据库。
// 页面隐藏 / 关闭时立即补写；真实数据改动仍各自直接调用 save()，语义不变。
const routeSave = createDeferredSave({ save: () => save() });
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') routeSave.flush(); });
  globalThis.addEventListener?.('pagehide', () => routeSave.flush());
}

// 放在保存承诺兑现之后再提示，避免被紧接着的「已保存」盖掉。
export function notifyPersistedKeySeal(result) {
  if (result !== PERSIST_KEY_SKIPPED || !$('#toast')) return;
  setTimeout(() => show(KEY_SEAL_SKIPPED_NOTICE), 0);
}

export function show(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toastTick);
  toastTick = setTimeout(() => $('#toast').classList.remove('show'), 2400);
}

export function modal(html, className = '') {
  const layer = $('#modal-layer');
  if (!layer.classList.contains('open')) modalTrigger = document.activeElement;
  layer.innerHTML = `<div class="modal ${className}" role="dialog" aria-modal="true" tabindex="-1">${html}</div>`;
  layer.classList.add('open');
  document.documentElement.classList.add('modal-open');
  document.body.classList.add('modal-open');
  callHelper('syncSystemBackConsumption');
  const dialog = $('.modal', layer);
  const title = $('h2', dialog);
  if (title) {
    title.id = `modal-title-${Date.now()}`;
    dialog.setAttribute('aria-labelledby', title.id);
  }
  // 容器变形：从触发它的那个按钮/胶囊"长"出来，而不是凭空出现。
  // 挂在 modal() 这一处，所有弹窗自动都带上，不需要每个页面各写一遍。
  morphFrom(modalTrigger, dialog);
  requestAnimationFrame(() => { dialog.focus({ preventScroll: true }); applyLiquidGlass(); });
}

export function closeModal() {
  callHelper('closeVideoPlayer');
  const layer = $('#modal-layer');
  layer.classList.remove('open');
  // 关闭后立即移除旧播放器/表单节点，避免下一个异步解密流程命中隐藏的旧媒体元素。
  layer.innerHTML = '';
  document.documentElement.classList.remove('modal-open');
  document.body.classList.remove('modal-open');
  modalTrigger?.focus?.({ preventScroll: true });
  modalTrigger = null;
  callHelper('syncSystemBackConsumption');
}

export function isModalOpen() {
  return Boolean($('#modal-layer')?.classList.contains('open'));
}

// 第三个参数可选：{ title, note, confirmText, cancelText, light }，不传时与旧版完全一致。
export function confirmDelete(message, action, options = {}) {
  const { title = '确认删除', note = '此操作无法撤销。', confirmText = '删除', cancelText = '取消', light = false } = options || {};
  modal(`<h2>${title}</h2>${message ? `<p>${message}</p>` : ''}${note ? `<p class="subtle">${note}</p>` : ''}<div class="modal-actions">${light ? '<span class="ts-spacer"></span>' : ''}<button type="button" data-close>${cancelText}</button><button class="danger" id="confirm-delete">${confirmText}</button></div>`, light ? 'confirm-modal detail-sheet confirm-sheet' : 'confirm-sheet');
  $('#confirm-delete').onclick = async () => { closeModal(); await action(); };
  requestAnimationFrame(() => {
    $('#modal-layer .modal [data-close]')?.focus?.({ preventScroll: true });
  });
}

export function emptyState(title, text) {
  return `<div class="empty-state"><span class="material-symbols-outlined">inbox</span><strong>${title}</strong><small>${text}</small></div>`;
}

export function focusProjectName(projectId, fallback = '未分类专注') {
  return state.focusProjects.find(project => project.id === projectId)?.name || fallback;
}

function header() {
  if (state.route === 'library') return `<button class="head-profile" id="library-back" aria-label="返回我的"><span class="material-symbols-outlined">arrow_back</span></button><h1>书影音</h1><button class="head-profile" id="new-media-head" aria-label="添加记录"><span class="material-symbols-outlined">add</span></button>`;
  if (state.route === 'countdown') return `<button class="head-profile" id="countdown-back" aria-label="返回我的"><span class="material-symbols-outlined">arrow_back</span></button><h1>倒数日</h1><button class="head-profile" id="new-countdown-head" aria-label="新增倒数日"><span class="material-symbols-outlined">add</span></button>`;
  if (state.route === 'ai') return `<div class="app-header-text"><span class="eyebrow">MINE AI</span><h1>AI 助手</h1></div>`;
  if (state.route === 'documents') return `<button class="head-profile" id="documents-back" aria-label="返回我的"><span class="material-symbols-outlined">arrow_back</span></button><h1>资料库</h1><button class="head-profile" id="new-document-folder" aria-label="新建文件夹"><span class="material-symbols-outlined">create_new_folder</span></button>`;
  // 主页面顶栏：eyebrow 小字 + 主标题两行文字排版（参考日历详情页 DAILY DETAIL），无按钮无占位。
  const pageTitle = {
    today: ['TODAY', 'Today'],
    calendar: ['CALENDAR', 'Calendar'],
    focus: ['TIMER', 'Timer'],
    statistics: ['STATISTICS', 'Statistics'],
    ledger: ['LEDGER', 'Ledger'],
    mine: ['MINE', 'Mine'],
    snippets: ['MOMENTS', 'Moments']
  }[state.route];
  if (pageTitle) return `<div class="app-header-text"><span class="eyebrow">${pageTitle[0]}</span><h1>${pageTitle[1]}</h1></div>`;
  const title = { today: 'Today', calendar: 'Calendar', focus: 'Timer', statistics: 'Statistics', mine: 'Mine', snippets: 'Moments', ledger: 'Ledger' }[state.route];
  return `<span></span><h1>${title}</h1><span></span>`;
}

// ---- 注册表（解决 view/binder/helper/submit 的跨模块调用）----
const views = {};
const binders = [];
const onRenders = [];
const helpers = {};
const submitHandlers = {};
export function registerView(route, fn) { views[route] = fn; }
export function registerBinder(fn) { binders.push(fn); }
export function registerOnRender(fn) { onRenders.push(fn); }
export function resolveView(route) { return views[route] || views.today; }
export function registerHelper(name, fn) { helpers[name] = fn; }
export function callHelper(name, ...args) { return helpers[name]?.(...args); }
export function registerSubmitHandler(formId, fn) { submitHandlers[formId] = fn; }
export function getSubmitHandler(formId) { return submitHandlers[formId]; }

// 主题皮肤：把 state.settings.theme 写到 <html data-theme>，
// themes.css 里的 :root[data-theme="…"] 覆盖块随之生效。
// 只在值变化时写 DOM，避免每次 render 都触发无谓的样式重算。
let appliedTheme = null;

/* 主题记忆键：index.html 的解析期脚本据此决定要不要加载「清简」那份样式表，
   并在首屏前写上 data-theme。单独存一个短键，而不是每次启动去解析整份状态。 */
const THEME_KEY = 'mine-warmjournal-theme';
const THEME_FILE = 'mine-warmjournal-theme.txt';
const KNOWN_THEMES = new Set(['classic', 'sunny', 'plain']);
let themePreferences;

function knownTheme(value) {
  const theme = String(value ?? '').trim();
  return KNOWN_THEMES.has(theme) ? theme : '';
}

function preferencesPlugin() {
  themePreferences ||= registerPlugin('Preferences');
  return themePreferences;
}

/* 清简主题的样式表在 index.html 里默认不参与样式计算（理由见那里的注释）。
   切到清简时要同时打开 media 和 disabled，否则变量换了、撤图规则还没进来。
   其他主题保持关闭，避免那近 2000 条选择器参与启动时的样式计算。 */
function syncPlainThemeSheet(theme) {
  const sheet = document.getElementById?.('plain-theme-sheet');
  if (!sheet) return;
  const want = theme === 'plain';
  if (want) {
    if (sheet.media !== 'all') sheet.media = 'all';
    if (sheet.disabled) sheet.disabled = false;
    return;
  }
  if (!sheet.disabled) sheet.disabled = true;
  if (sheet.media !== 'not all') sheet.media = 'not all';
}

function writeThemeCookie(theme) {
  try {
    const current = document.cookie.match(/(?:^|;\s*)mine-warmjournal-theme=([^;]*)/)?.[1] || '';
    if (current === theme) return;
    document.cookie = `${THEME_KEY}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch { /* 隐私模式下写不进去也不影响本次换肤 */ }
}

function rememberTheme(theme) {
  try {
    if (localStorage.getItem(THEME_KEY) !== theme) localStorage.setItem(THEME_KEY, theme);
  } catch { /* 无痕模式 / 测试 mock 下写入会抛错，与主题本身无关 */ }
  writeThemeCookie(theme);
  void mirrorThemeToNative(theme);
}

/* localStorage 是 WebView 存储，真机上可能丢；SQLite 里的主题要等数据库打开才读得到。
   这里再镜像一份到原生存储：Filesystem 当前装机包里就有；Preferences 有插件时一并写。
   两者都是异步的，只给下一次冷启动的 primeThemeFromNativeMirror 用。 */
async function mirrorThemeToNative(theme) {
  if (!knownTheme(theme) || !Capacitor.isNativePlatform?.()) return;
  const writes = [];
  if (Capacitor.isPluginAvailable?.('Filesystem')) {
    writes.push(Filesystem.writeFile({
      path: THEME_FILE,
      data: theme,
      directory: Directory.Data,
      encoding: Encoding.UTF8
    }).catch(() => {}));
  }
  if (Capacitor.isPluginAvailable?.('Preferences')) {
    writes.push(preferencesPlugin().set({ key: THEME_KEY, value: theme }).catch(() => {}));
  }
  await Promise.all(writes);
}

async function readNativeThemeMirror() {
  if (!Capacitor.isNativePlatform?.()) return '';
  const jobs = [];
  if (Capacitor.isPluginAvailable?.('Filesystem')) {
    jobs.push(Filesystem.readFile({
      path: THEME_FILE,
      directory: Directory.Data,
      encoding: Encoding.UTF8
    }).then(result => knownTheme(result?.data)).catch(() => ''));
  }
  if (Capacitor.isPluginAvailable?.('Preferences')) {
    jobs.push(preferencesPlugin().get({ key: THEME_KEY }).then(result => knownTheme(result?.value)).catch(() => ''));
  }
  if (!jobs.length) return '';
  const values = await Promise.race([
    Promise.all(jobs),
    new Promise(resolve => setTimeout(() => resolve([]), 400))
  ]);
  return values.find(value => value && value !== 'classic') || '';
}

/* 解析期没读到主题时，index.html 会给 html 加上 theme-pending，先藏住暖色纸。
   数据库打开前先看原生镜像：是清简或暖阳就立刻揭开，经典则继续等状态库确认，
   避免一份过期的 classic 把清简又闪回暖色纸。 */
export async function primeThemeFromNativeMirror() {
  const root = document?.documentElement;
  if (!root?.classList?.contains('theme-pending')) return '';
  if (!Capacitor.isNativePlatform?.()) {
    root.classList.remove('theme-pending');
    return '';
  }
  const theme = await readNativeThemeMirror();
  if (theme && theme !== 'classic') applyTheme(theme);
  return theme || '';
}

export function applyTheme(theme = state.settings?.theme) {
  const next = typeof theme === 'string' && theme ? theme : 'classic';
  if (next === appliedTheme) {
    document?.documentElement?.classList?.remove('theme-pending');
    return next;
  }
  appliedTheme = next;
  syncPlainThemeSheet(next);
  rememberTheme(next);
  // 全部用 ?. 容错：单元测试跑在精简 DOM mock 上，缺 removeAttribute / getComputedStyle 时不应中断。
  const root = document?.documentElement;
  if (!root) return next;
  root.classList?.remove('theme-pending');
  if (next === 'classic') root.removeAttribute?.('data-theme');
  else root.setAttribute?.('data-theme', next);
  // 让系统状态栏/浏览器 UI 的底色跟着主题走（index.html 里的默认值是米白）。
  try {
    const meta = document.querySelector?.('meta[name="theme-color"]');
    const canvas = getComputedStyle(root).getPropertyValue('--canvas').trim();
    if (meta && canvas) meta.setAttribute('content', canvas);
  } catch { /* 测试环境无 getComputedStyle 时忽略，不影响主题本身 */ }
  return next;
}

export function render(animated = false, { skipStagger = false } = {}) {
  clearInterval(tick);
  applyTheme();
  applyCustomBackground();
  // 全局顶栏已移除（原型无全局顶栏，各屏自带标题）；library/countdown/documents 等
  // 未在原型中的路由仍需要返回栏，条件显示。
  const appHeader = $('#app-header');
  if (appHeader) {
    appHeader.className = 'app-header';
    appHeader.innerHTML = header();
    appHeader.hidden = !['library', 'countdown', 'documents'].includes(state.route);
  }
  $('#app').classList.toggle('nav-transition', animated);
  $('#app').innerHTML = resolveView(state.route)();
  if (animated) setTimeout(() => { $('#app')?.classList.remove('nav-transition'); }, 300);
  renderNav();
  if (state.profile.avatar) {
    const profileAvatar = $('.profile-avatar');
    if (profileAvatar) { profileAvatar.classList.add('has-avatar'); profileAvatar.innerHTML = avatarContent(state.profile, '个人头像'); }
  }
  $$('[data-route]').forEach(button => {
    button.classList.toggle('active', button.dataset.route === state.route);
    button.onclick = () => go(button.dataset.route);
    if (button.classList.contains('active') && button.scrollIntoView) button.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  });
  binders.forEach(bind => bind());
  onRenders.forEach(fn => fn());
  applyLiquidGlass();
  decorateMotion($('#app'), { skipStagger });
}

/* 主角卡的旋转描边与呼吸背光（2026-10-10）
 *
 * 每个页面挑一张"主角卡"戴上光晕，一页最多一张 —— 到处都是光就等于没有重点。
 * 名单在这里集中管理：改版换了卡片结构，只要改这一行。
 * ⚠️ 名单里的卡片不能有 overflow:hidden（会把背光裁掉），也不能已经占用了 ::before/::after。
 */
const HALO_CARDS = [
  '.profile-hero-card',      // 我的 · 个人卡
  '.habit-hero-card',        // 习惯档案 · 头卡
  '.focus-intro',            // 专注 · 头卡
  '.snippets-stats-hero',    // 随手拍 · 统计头
  '.ledger-overview-card',   // 账本 · 总览
  '.course-hero',            // 课程表 · 头卡
];

function decorateMotion(root, { skipStagger = false } = {}) {
  if (!root || prefersReducedMotion()) return;
  try {
    root.querySelectorAll(HALO_CARDS.join(',')).forEach(card => {
      card.classList.add('halo-card');
      // 描边要"外层做遮罩、内层做旋转"两层，而伪元素放不下子节点，所以注入真实节点。
      // 只注入一次：重渲染时已经有了就跳过。
      if (card.querySelector(':scope > .halo-ring')) return;
      const ring = document.createElement('i');
      ring.className = 'halo-ring';
      ring.setAttribute('aria-hidden', 'true');
      const sweep = document.createElement('i');
      sweep.className = 'halo-sweep';
      ring.appendChild(sweep);
      card.insertBefore(ring, card.firstChild);
    });
    // 打卡轻反馈走就地更新时不应整页 autoStagger（会盖住勾的弹一下，画报还可能闪纸色）
    if (!skipStagger) autoStagger(root);
  } catch {
    // 装饰失败不影响任何功能
  }
  // 按压标记要独立于"减弱动效"判断：即便不做动画，属性打上也无害，
  // 而且用户中途改系统设置时不用重新渲染。
  try {
    markPressables(root);
  } catch {
    // 装饰失败不影响任何功能
  }
}

// ---- 液态玻璃应用（body.liquid-glass 时启用；只做局部强调——强玻璃清单）----
// 设计：液态玻璃只用于「强强调」组件（导航/顶部栏/弹窗/hero），其余恢复浅色卡。
// 主卡/小卡/列表行/输入区/悬浮按钮不套液态玻璃（保持清爽浅色风格）。
const liquidGlassInstances = new WeakMap();

const LIQUID_GLASS_TARGETS = [
  ['.floating-dock', { strength: 'strong' }],
  ['.app-header', { strength: 'strong' }],
  ['.modal', { strength: 'strong' }],
  ['.today-hero-card', { strength: 'strong' }]
];

export function applyLiquidGlass() {
  if (!isLiquidGlassEnabled()) return;
  for (const [selector, opts] of LIQUID_GLASS_TARGETS) {
    const elements = $$(selector);
    for (const el of elements) {
      // 已套过且未被 render 破坏（装饰层仍在）→ 跳过
      const existing = liquidGlassInstances.get(el);
      if (existing && el.querySelector('.liquid-glass__bottom')) continue;
      if (existing) { existing.destroy(); liquidGlassInstances.delete(el); }
      liquidGlassInstances.set(el, liquidGlass(el, opts));
    }
  }
}

// ---- 悬浮 Dock（原型 5 键：五项等权，仅当前路由使用胶囊强调）----
// 旧底部导航自定义（navTabs 排序/显隐）数据保留在 model，不再参与渲染（原型无此功能）。
export const DOCK_TABS = [
  { route: 'today', icon: 'draw', label: 'Today' },
  { route: 'calendar', icon: 'calendar_month', label: 'Calendar' },
  { route: 'snippets', icon: 'auto_awesome_motion', label: 'Moments' },
  { route: 'journal', icon: 'history_edu', label: 'Journal' },
  { route: 'ledger', icon: 'account_balance_wallet', label: 'Ledger' }
];

export function renderNav() {
  const nav = $('.floating-dock');
  if (!nav) return;
  nav.innerHTML = DOCK_TABS.map(item => {
    const active = item.route === state.route;
    return `<button type="button" class="dock-btn${active ? ' active' : ''}" id="dock-btn-${item.route}" data-route="${item.route}" aria-label="${item.label}">
      <span class="material-symbols-outlined">${item.icon}</span><small>${item.label}</small>
    </button>`;
  }).join('');
}

const NAVIGATION_HISTORY_LIMIT = 50;
const navigationHistory = [];
let navigatingBack = false;

function currentNavigationState() {
  return {
    route: state.route,
    calendarDate: state.route === 'calendar' ? selected : '',
    scrollTop: currentPageScrollTop()
  };
}

function currentPageScrollTop() {
  return Math.max(
    $('#app')?.scrollTop || 0,
    $('.phone-shell')?.scrollTop || 0,
    document.scrollingElement?.scrollTop || 0,
    window.scrollY || 0
  );
}

function setPageScrollTop(top = 0) {
  const value = Math.max(0, Number(top) || 0);
  const app = $('#app');
  const shell = $('.phone-shell');
  if (app) { app.scrollTop = value; app.scrollLeft = 0; }
  if (shell) { shell.scrollTop = value; shell.scrollLeft = 0; }
  if (document.scrollingElement) { document.scrollingElement.scrollTop = value; document.scrollingElement.scrollLeft = 0; }
  window.scrollTo({ top: value, left: 0, behavior: 'auto' });
}

function rememberCurrentNavigation() {
  if (!state.route) return;
  const current = currentNavigationState();
  const previous = navigationHistory[navigationHistory.length - 1];
  if (previous?.route === current.route && previous?.calendarDate === current.calendarDate) {
    previous.scrollTop = current.scrollTop;
    return;
  }
  navigationHistory.push(current);
  if (navigationHistory.length > NAVIGATION_HISTORY_LIMIT) navigationHistory.splice(0, navigationHistory.length - NAVIGATION_HISTORY_LIMIT);
}

export function go(route, calendarDate = '', options = {}) {
  const targetCalendarDate = route === 'calendar' ? (calendarDate || dateKey()) : '';
  const changesPage = route !== state.route || (route === 'calendar' && targetCalendarDate !== selected);
  if (changesPage && !navigatingBack && options.history !== false) rememberCurrentNavigation();
  state.route = route;
  if (route === 'calendar') {
    selected = targetCalendarDate;
    cursor = calendarDate ? new Date(`${calendarDate}T12:00:00`) : new Date();
  }
  routeSave.request();
  render(true);
  if (options.resetScroll !== false) {
    setPageScrollTop(0);
    requestAnimationFrame(() => {
      setPageScrollTop(0);
      requestAnimationFrame(() => setPageScrollTop(0));
    });
  }
  callHelper('syncSystemBackConsumption');
}

// ---- 统一页面历史：所有返回回到真实上一步，并恢复其滚动位置 ----
export function pushBackState() {
  // 兼容现有显式二级页入口；go() 会识别栈顶相同页面，不会重复记录。
  rememberCurrentNavigation();
}

export function goBack() {
  const target = navigationHistory.pop();
  if (!target) {
    if (state.route !== 'today') go('today', '', { history: false });
    return false;
  }
  navigatingBack = true;
  try { go(target.route, target.calendarDate, { history: false, resetScroll: false }); }
  finally { navigatingBack = false; }
  requestAnimationFrame(() => {
    setPageScrollTop(target.scrollTop);
  });
  callHelper('syncSystemBackConsumption');
  return true;
}

export const canGoBack = () => navigationHistory.length > 0;

// ---- 二级页骨架（原型 .subpage-layer：右滑入，置顶；关闭右滑出）----
export function openSubpage(id, html = '') {
  const layer = document.getElementById(id);
  if (!layer || !layer.classList.contains('subpage-layer')) return false;
  document.querySelectorAll('.subpage-layer.active').forEach(item => {
    if (item !== layer) item.classList.remove('active');
  });
  if (html) layer.innerHTML = html;
  layer.scrollTop = 0;
  layer.classList.add('active');
  document.body.classList.add('subpage-active');
  callHelper('syncSystemBackConsumption');
  return true;
}

export function closeSubpage() {
  const active = document.querySelectorAll('.subpage-layer.active');
  if (active.length) {
    active.forEach(layer => layer.classList.remove('active'));
    document.body.classList.remove('subpage-active');
  }
  callHelper('syncSystemBackConsumption');
  return Boolean(active.length);
}

export function isSubpageOpen() {
  return Boolean(document.querySelector('.subpage-layer.active'));
}

// 二级页通用头部：返回按钮（左）+ Newsreader 标题（中）+ 可选右动作（原型 .subpage-nav-bar）
export function subpageHeader(title, options = {}) {
  const action = options.action
    ? `<button type="button" class="subpage-nav-action" ${options.action.id ? `id="${options.action.id}"` : ''}>${options.action.html || options.action.label}</button>`
    : `<span></span>`;
  return `<nav class="subpage-nav-bar"><button type="button" class="subpage-back-btn" data-subpage-close><span class="material-symbols-outlined" style="font-size:16px;">arrow_back</span>返回</button><span class="subpage-nav-title">${title}</span>${action}</nav>`;
}

registerHelper('openSubpage', openSubpage);
registerHelper('closeSubpage', closeSubpage);
registerHelper('isSubpageOpen', isSubpageOpen);
registerHelper('isModalOpen', isModalOpen);
registerHelper('canGoBack', canGoBack);
registerHelper('goBack', goBack);
registerHelper('ledgerSummary', (now = new Date()) => ledgerSummary(state, now));
registerHelper('calibrateLedgerAccount', payload => calibrateLedgerAccount(state, payload));
registerHelper('habitHeatmapData', (habitId, year) => habitHeatmapData(state, habitId, year));
registerHelper('previousCompleteWeekRange', previousCompleteWeekRange);
registerHelper('calculateFlowScore', calculateFlowScore);

// 二级页全局关闭委托（data-subpage-close 任意位置可关）
document.addEventListener('click', event => {
  if (event.target.closest('[data-subpage-close]')) closeSubpage();
});
