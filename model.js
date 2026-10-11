import { makeDefaultTimetable, normalizeTimetable } from './timetable.js';
import { normalizePasswordVault } from './password-vault.js';

export const SCHEMA_VERSION = 18;

/* 「习惯裁掉开头」的长度上限（秒）。2026-10-10 由 10 提到 20。
 *
 * ⚠️ 这个数字原来在四处各写了一遍（滑块 max、滑块可达上限、落库校验、读回校验）——
 *    漏改任何一处，就会出现"界面能拖到 20、存进去还是 10"这种错位，而且不报错。
 *    现在只在这里定义，其余地方一律引用。
 */
export const HABIT_HEAD_MAX_SECONDS = 20;

/**
 * 一段视频最多能砍掉多少开头。
 * 两条约束取小：不超过总上限，也不超过片长的一半（免得整段被砍没）。
 * ⚠️ 不能只返回总上限：短片上滑块能拖到 20，但实际起点会被夹回头部附近，
 *    于是"滑块指着 20 秒、起点读数却是 0:01"，用户只会觉得这个功能坏了。
 */
export function habitHeadLimit(duration) {
  const total = Number(duration) || 0;
  if (!total) return HABIT_HEAD_MAX_SECONDS;
  return Math.max(1, Math.min(HABIT_HEAD_MAX_SECONDS, Math.floor(total / 2)));
}

export const WEEK_DAYS = ['日', '一', '二', '三', '四', '五', '六'];
export const TASTE_TYPES = {
  dish: { label: '菜品', icon: 'restaurant' },
  snack: { label: '零食饮料', icon: 'cookie' },
  place: { label: '店铺', icon: 'storefront' }
};
export const TASTE_VERDICTS = {
  favorite: { label: '非常喜欢', short: '挚爱', icon: 'favorite' },
  again: { label: '还会再吃', short: '再来', icon: 'replay' },
  okay: { label: '感觉一般', short: '一般', icon: 'remove' },
  no: { label: '不会再买', short: '不再买', icon: 'block' },
  avoid: { label: '需要避雷', short: '避雷', icon: 'warning' }
};
export const MOODS = {
  happy: { label: '开心', symbol: '😊' },
  calm: { label: '平静', symbol: '😌' },
  fulfilled: { label: '满足', symbol: '🥰' },
  normal: { label: '一般', symbol: '😐' },
  tired: { label: '疲惫', symbol: '😴' },
  anxious: { label: '焦虑', symbol: '😟' },
  sad: { label: '难过', symbol: '😢' }
};
export const WEATHERS = {
  sunny: { label: '晴', icon: 'light_mode' },
  cloudy: { label: '多云', icon: 'partly_cloudy_day' },
  overcast: { label: '阴', icon: 'cloud' },
  rainy: { label: '雨', icon: 'rainy' },
  storm: { label: '雷雨', icon: 'thunderstorm' },
  snowy: { label: '雪', icon: 'weather_snowy' },
  foggy: { label: '雾', icon: 'foggy' },
  windy: { label: '风', icon: 'air' }
};
export const CATEGORIES = {
  work: { label: '深度工作', icon: 'code', color: '#4d638b' },
  read: { label: '阅读学习', icon: 'menu_book', color: '#77708f' },
  relax: { label: '冥想放松', icon: 'self_improvement', color: '#aac1ef' }
};

export const LEDGER_CATEGORIES = {
  restaurant: { label: '餐饮', icon: 'restaurant', color: '#5b7fbf' },
  transport: { label: '交通', icon: 'directions_bus', color: '#4d6b9e' },
  study: { label: '学习', icon: 'menu_book', color: '#6b789b' },
  entertainment: { label: '娱乐', icon: 'sports_esports', color: '#8a6f85' },
  other: { label: '其他', icon: 'category', color: '#7c8db0' },
  ai: { label: 'AI', icon: 'smart_toy', color: '#6f87b5' },
  game: { label: '游戏', icon: 'videogame_asset', color: '#3d5a80' }
};

export const DEFAULT_LEDGER_ACCOUNTS = [
  ['cmb', '招商银行储蓄卡', 'bank'],
  ['wx', '微信零钱通', 'wallet'],
  ['alipay', '支付宝余额宝', 'wallet'],
  ['loan', '外借应收款', 'receivable']
];

/** 供账本 UI（岗位③）与 AI 规则（岗位④）共享的持久化字段契约。 */
export const LEDGER_DATA_CONTRACT = {
  account: ['id', 'name', 'type', 'initialBalance', 'sortOrder', 'archived'],
  transaction: ['id', 'type', 'category', 'amount', 'accountId', 'sourceAccountId', 'targetAccountId', 'adjustment', 'targetBalance', 'difference', 'reasonTag', 'date', 'note', 'photo'],
  category: ['id', 'name', 'icon', 'color', 'scope', 'sortOrder', 'archived'],
  merchantRule: ['id', 'keyword', 'categoryId', 'enabled', 'createdAt', 'updatedAt'],
  calibration: ['targetBalance', 'difference', 'reasonTag', 'note', 'generateReconciliationTx']
};

export const FOCUS_SESSION_DATA_CONTRACT = ['id', 'mode', 'targetDurationSeconds', 'durationSeconds', 'ambientSoundsUsed', 'interruptionsCount', 'flowScore', 'startedAt', 'endedAt'];
export const WEEKLY_INSIGHT_REPORT_CONTRACT = ['id', 'weekStart', 'weekEnd', 'dateRange', 'weekNumber', 'themeTitle', 'summaryNarrative', 'kpis', 'dailyFocusChart', 'tracks', 'nextWeekActionAdvice', 'generatedAt', 'status'];

const AI_PROVIDERS = ['deepseek', 'qwen', 'moonshot', 'zhipu', 'openai', 'gemini', 'custom'];

// 可选主题皮肤。第一项是默认值：老数据升级后保持原观感。
// 新增主题时：这里加 id + themes.css 加 [data-theme="id"] 覆盖块 + 下面 THEME_META 加展示信息。
export const APP_THEMES = ['classic', 'sunny', 'plain'];
export const THEME_META = {
  classic: { label: '米白', description: '冷调纸感，克制清爽', swatch: ['#f5f1e8', '#ffffff', '#4d7056'] },
  sunny: { label: '暖阳', description: '奶油暖黄，呼应「暖色」', swatch: ['#fbf3e4', '#fffcf5', '#b06a2c'] },
  plain: { label: '清简', description: '纯色无纸纹，干净利落', swatch: ['#f5f6f7', '#ffffff', '#2f7d5f'] }
};

const DEMO_SESSION_KEYS = new Set([
  '2026-08-06|120|深度阅读|心理学导论 第3章',
  '2026-08-06|90|项目开发|重构UI组件库',
  '2026-08-06|60|语言学习|日语听力练习'
]);

export function dateKey(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const DEFAULT_NAV_ROUTES = ['today', 'calendar', 'focus', 'ledger', 'ai'];
export const MORE_NAV_ROUTES = ['statistics', 'documents', 'mine'];

export function makeDefaultNavTabs() {
  return DEFAULT_NAV_ROUTES.map((route, index) => ({ route, visible: true, order: index }));
}

export function makeDefaultState(now = new Date()) {
  const duration = 25 * 60;
  return {
    route: 'today',
    profile: { name: '用户', motto: '今天也是充满光芒的一天。', avatar: '' },
    settings: {
      defaultDurationMinutes: 25,
      focusLinkedHabitId: '',
      notificationsEnabled: true,
      pomodoroFocusMinutes: 25,
      pomodoroShortBreakMinutes: 5,
      pomodoroLongBreakMinutes: 15,
      pomodoroRounds: 4,
      pomodoroAutoStart: false,
      ambientSound: 'none',
      ambientVolume: 0.5,
      aiEnabled: false,
      aiProvider: 'deepseek',
      aiBaseUrl: '',
      aiModel: 'deepseek-chat',
      aiApiKey: '',
      aiLastDataScanAt: 0,
      aiConversationMemoryEnabled: false,
      // 以下 vision* 四个字段是有意保留的「遗留兼容字段」，不要删除：
      // 项目已从「文字模型 + 视觉模型双配置」演进为单一多模态模型，
      // 界面不再暴露它们（views/mine.js 只有一套多模态配置），
      // 但旧用户数据里可能存在，归一化必须原样保留（见下方 normalizeSettings）。
      // 测试 tests/ai-multimodal-config.test.mjs 锁定了「保存 AI 设置时 legacy vision 配置不变」。
      visionProvider: 'qwen',
      visionBaseUrl: '',
      visionApiKey: '',
      visionModel: 'qwen-vl-plus',
      aiWeekSummary: { start: '', end: '', text: '', generatedAt: 0 },
      dailyReminders: [],
      reminderAiCopy: { photo: [], journal: [] },
      timerOrientation: 'auto',
      // 主题皮肤（2026-10-08 新增）：
      //   classic = 冷调米白（历史默认，老用户升级后观感不变）
      //   sunny   = 暖阳（奶油暖黄，呼应「暖色生活志」这个名字）
      // 主题只是一组 CSS 变量的覆盖，见 themes.css；不影响任何数据与逻辑。
      theme: 'classic',
      countdownAiReminders: {
        nodeReminder: true,
        nodeNotify: true,
        dailyMention: true,
        anniversaryBlessing: true
      },
      aiEmotionCare: true,
      ledgerBudget: { total: 0, categories: {}, periods: [] },
      ledgerLastUsed: { accountId: '', category: '', type: 'expense' },
      aiRandomRemindersEnabled: true,
      aiRandomReminders: { date: '', items: [] },
      weatherSnapshot: null,
      journalDrafts: {},
      backgroundImage: '',
      todayCoverImage: '',
      backgroundOverlayOpacity: 72,
      // 默认完整显示不裁切壁纸，铺满为可选。
      backgroundFit: 'contain',
      backgroundZoom: 1,
      backgroundOffsetX: 0,
      backgroundOffsetY: 0,
      timetable: makeDefaultTimetable(),
      navTabs: makeDefaultNavTabs(),
      // 私密视频的「习惯裁掉开头 N 秒」（2026-10-10 新增）：
      // 用户在剪辑器里点过「记住」的长度。打开任一段**还没剪过**的视频时自动套用；
      // 0 表示不自动裁。只影响打开剪辑器时的初始起点，随时可以拖回来。
      vaultTrimHeadSeconds: 0
    },
    habits: [
      makeHabit({ id: 'water', name: '喝水', icon: 'water_drop', target: 8, unit: '杯', createdAt: now.getTime() }),
      makeHabit({ id: 'read', name: '阅读', icon: 'menu_book', target: 30, unit: '分钟', createdAt: now.getTime() + 1 })
    ],
    todos: [],
    checks: {},
    habitCompletions: {},
    habitSkips: {},
    events: [],
    sessions: [],
    snippets: [],
    journals: {},
    dailySummaries: {},
    weeklyInsightReports: [],
    media: [],
    tasteEntries: [],
    transactions: [],
    ledgerAccounts: DEFAULT_LEDGER_ACCOUNTS.map(([id, name, type], sortOrder) => makeLedgerAccount({ id, name, type, sortOrder })),
    ledgerCategories: [],
    merchantCategoryRules: [],
    countdowns: [],
    // 版本更新动态（2026-10-10 新增）：每次升级后自动写入当天的版本说明，出现在「当天活动」里。
    // ⚠️ 新增顶层字段必须同步加进 storage.js 的 SECTIONS，否则真机不会落库。
    releases: [],
    documentFolders: [],
    documents: [],
    // 本机相册（系统相册）的观看历史（2026-10-09 新增）。
    // 本机视频的「播放进度」不保存 —— 它们是系统文件，App 不去改它们；
    // 这里只记录「看过哪些、看了多久」，供视频流的观看记录面板使用。
    // ⚠️ 新增顶层字段必须同步加进 storage.js 的 SECTIONS，否则真机不会落库。
    localGalleryWatchHistory: [],
    // 私密空间只保存加密后的元数据密文和随机媒体引用。
    privateVault: { version: 1, salt: '', verifierIv: '', verifier: '', payloadIv: '', payload: '', assetRefs: [], updatedAt: 0 },
    passwordVault: normalizePasswordVault(),
    aiMemory: [],
    aiHistory: [],
    focusProjects: [
      makeFocusProject({ id: 'study', name: '专注学习', icon: 'school', color: '#4d638b', category: 'work', createdAt: now.getTime() }),
      makeFocusProject({ id: 'reading', name: '阅读', icon: 'menu_book', color: '#77708f', category: 'read', habitId: 'read', createdAt: now.getTime() + 1 })
    ],
    focusCategories: [],
    timer: {
      duration, left: duration, running: false, endAt: null, startedAt: null,
      task: '', category: 'work', projectId: 'study', mode: 'free', phase: 'focus', round: 1, elapsed: 0
    },
    meta: { schemaVersion: SCHEMA_VERSION, migratedAt: null }
  };
}

export function makeHabit(input = {}) {
  const unit = String(input.unit || '次').trim();
  const inferredTracking = /分钟|小时|页|公里|千米|米|步|字|词|题|毫升|升|元/.test(unit) ? 'quantity' : 'tap';
  const tracking = ['tap', 'quantity'].includes(input.tracking) ? input.tracking : inferredTracking;
  const target = positiveInt(input.target, 1);
  return {
    id: input.id || crypto.randomUUID(),
    name: String(input.name || '新习惯').trim(),
    icon: input.icon || 'self_improvement',
    target,
    targetMax: Math.max(target, positiveInt(input.targetMax, target)),
    unit,
    tracking,
    goalType: ['check','quantity','range'].includes(input.goalType) ? input.goalType : (tracking === 'tap' && target === 1 ? 'check' : 'quantity'),
    goalPeriod: input.goalPeriod === 'weekly' ? 'weekly' : 'daily',
    repeatDays: normalizeRepeatDays(input.repeatDays),
    archived: Boolean(input.archived),
    createdAt: Number(input.createdAt) || Date.now()
  };
}

export function makeFocusProject(input = {}) {
  const allowedIcons = ['school', 'menu_book', 'translate', 'calculate', 'science', 'history_edu', 'code', 'draw', 'music_note', 'psychology', 'fitness_center', 'self_improvement'];
  return {
    id: String(input.id || crypto.randomUUID()),
    name: String(input.name || '新项目').trim().slice(0, 24),
    icon: allowedIcons.includes(input.icon) ? input.icon : 'school',
    color: /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : '#4d638b',
    category: CATEGORIES[input.category] ? input.category : 'work',
    group: String(input.group || '').trim().slice(0, 16),
    habitId: String(input.habitId || ''),
    mediaId: String(input.mediaId || ''),
    weeklyTargetMinutes: positiveInt(input.weeklyTargetMinutes, 0),
    monthlyTargetMinutes: positiveInt(input.monthlyTargetMinutes, 0),
    archived: Boolean(input.archived),
    createdAt: Number(input.createdAt) || Date.now()
  };
}

export function makeFocusCategory(input = {}) {
  const allowedIcons = ['school', 'menu_book', 'translate', 'calculate', 'science', 'history_edu', 'code', 'draw', 'music_note', 'psychology', 'fitness_center', 'self_improvement'];
  return {
    id: String(input.id || crypto.randomUUID()),
    name: String(input.name || '新分类').trim().slice(0, 24),
    parentId: String(input.parentId || ''),
    icon: allowedIcons.includes(input.icon) ? input.icon : 'school',
    color: /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : '#4d638b',
    sortOrder: positiveInt(input.sortOrder, 0),
    archived: Boolean(input.archived),
    createdAt: Number(input.createdAt) || Date.now()
  };
}

export function makeTodo(input = {}) {
  const createdAt = Number(input.createdAt) || Date.now();
  const updatedAt = Number(input.updatedAt) || createdAt;
  const completedAt = input.completed ? (Number(input.completedAt) || updatedAt) : 0;
  return {
    id: String(input.id || crypto.randomUUID()),
    date: /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : dateKey(new Date(createdAt)),
    title: String(input.title || '').trim().slice(0, 80),
    completed: Boolean(input.completed),
    completedAt,
    completedDate: input.completed ? (/^\d{4}-\d{2}-\d{2}$/.test(input.completedDate || '') ? input.completedDate : dateKey(new Date(completedAt))) : '',
    createdAt,
    updatedAt
  };
}

export function makeMediaEntry(input = {}) {
  const type = input.type === 'book' ? 'book' : 'movie';
  const allowedStatuses = ['planned', 'in_progress', 'completed'];
  const status = allowedStatuses.includes(input.status) ? input.status : 'planned';
  const completedDate = /^\d{4}-\d{2}-\d{2}$/.test(input.completedDate || '') ? input.completedDate : '';
  const poster = String(input.poster || '');
  return {
    id: input.id || crypto.randomUUID(),
    type,
    title: String(input.title || '').trim(),
    status,
    completedDate: status === 'completed' ? completedDate : '',
    rating: status === 'completed' ? clamp(positiveInt(input.rating, 0), 0, 5) : 0,
    notes: String(input.notes || '').trim(),
    poster: isLocalImage(poster) ? poster : '',
    createdAt: Number(input.createdAt) || Date.now(),
    updatedAt: Number(input.updatedAt) || Date.now()
  };
}

export function makeRelease(input = {}) {
  const createdAt = Number(input.createdAt) || Date.now();
  return {
    code: Math.max(1, Math.floor(Number(input.code)) || 0),
    versionName: String(input.versionName || '').trim().slice(0, 20),
    title: String(input.title || '').trim().slice(0, 60),
    summary: String(input.summary || '').trim().slice(0, 200),
    bullets: Array.isArray(input.bullets) ? input.bullets.map(item => String(item || '').trim().slice(0, 120)).filter(Boolean).slice(0, 12) : [],
    screenshots: Array.isArray(input.screenshots) ? input.screenshots.map(item => String(item || '').trim()).filter(Boolean).slice(0, 4) : [],
    date: /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : '',
    createdAt
  };
}

export function makeCountdown(input = {}) {
  const createdAt = Number(input.createdAt) || Date.now();
  return {
    id: String(input.id || crypto.randomUUID()),
    title: String(input.title || '').trim().slice(0, 40),
    date: /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : '',
    note: String(input.note || '').trim().slice(0, 200),
    image: isLocalImage(input.image) ? String(input.image) : '',
    showOnHome: Boolean(input.showOnHome !== false),
    createdAt,
    updatedAt: Number(input.updatedAt) || createdAt
  };
}

export function makeDocumentFolder(input = {}) {
  const createdAt = Number(input.createdAt) || Date.now();
  return {
    id: String(input.id || crypto.randomUUID()),
    name: String(input.name || '').trim().slice(0, 40),
    parentId: String(input.parentId || ''),
    createdAt,
    updatedAt: Number(input.updatedAt) || createdAt
  };
}

export function makeDocument(input = {}) {
  const type = ['pdf', 'word', 'other'].includes(input.type) ? input.type : 'other';
  return {
    id: String(input.id || crypto.randomUUID()),
    name: String(input.name || '').trim().slice(0, 80),
    type,
    size: positiveInt(input.size, 0),
    folderId: String(input.folderId || ''),
    path: String(input.path || '').trim(),
    createdAt: Number(input.createdAt) || Date.now()
  };
}

export function makeDailySummary(text = '') {
  return {
    text: String(text || '').trim(),
    updatedAt: Date.now()
  };
}

export function daysUntil(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return 0;
  const target = new Date(`${dateStr}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function makeLedgerAccount(input = {}) {
  const type = ['wallet', 'bank', 'cash', 'receivable'].includes(input.type) ? input.type : 'wallet';
  return {
    id: String(input.id || crypto.randomUUID()),
    name: String(input.name || '新账户').trim().slice(0, 24),
    type,
    initialBalance: clampSignedAmount(input.initialBalance),
    sortOrder: positiveInt(input.sortOrder, 0),
    archived: Boolean(input.archived),
    createdAt: Number(input.createdAt) || Date.now(),
    updatedAt: Number(input.updatedAt) || Number(input.createdAt) || Date.now()
  };
}

export function makeLedgerCategory(input = {}) {
  return {
    id: String(input.id || crypto.randomUUID()).trim().slice(0, 48),
    name: String(input.name || '自定义分类').trim().slice(0, 24),
    icon: String(input.icon || 'category').trim().slice(0, 48),
    color: /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : '#7c8db0',
    scope: ['expense', 'income', 'both'].includes(input.scope) ? input.scope : 'both',
    sortOrder: positiveInt(input.sortOrder, 0),
    archived: Boolean(input.archived),
    createdAt: Number(input.createdAt) || Date.now(),
    updatedAt: Number(input.updatedAt) || Number(input.createdAt) || Date.now()
  };
}

export function makeMerchantCategoryRule(input = {}) {
  const createdAt = Number(input.createdAt) || Date.now();
  return {
    id: String(input.id || crypto.randomUUID()),
    keyword: String(input.keyword || '').trim().toLowerCase().slice(0, 80),
    categoryId: String(input.categoryId || input.category || '').trim().slice(0, 48),
    enabled: input.enabled !== false,
    createdAt,
    updatedAt: Number(input.updatedAt) || createdAt
  };
}

export function upsertMerchantCategoryRule(state, input = {}) {
  const existing = (state.merchantCategoryRules || []).find(rule => rule.id === input.id);
  const next = makeMerchantCategoryRule({ ...existing, ...input, createdAt: existing?.createdAt || input.createdAt, updatedAt: Date.now() });
  if (!next.keyword) throw new Error('请输入商户关键词');
  const category = ledgerCategoryMap(state)[next.categoryId];
  if (!category || category.archived) throw new Error('请选择可用的分类');
  if ((state.merchantCategoryRules || []).some(rule => rule.id !== next.id && rule.keyword.trim().toLowerCase() === next.keyword)) throw new Error('这个关键词已有规则，请直接编辑原规则');
  state.merchantCategoryRules ||= [];
  if (existing) Object.assign(existing, next);
  else state.merchantCategoryRules.push(next);
  return next;
}

export function makeTransaction(input = {}) {
  const createdAt = Number(input.createdAt) || Date.now();
  const updatedAt = Number(input.updatedAt) || createdAt;
  const fallbackDate = /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : dateKey(new Date(createdAt));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : fallbackDate;
  const type = ['expense', 'income', 'transfer', 'calibrate'].includes(input.type) ? input.type : 'expense';
  const category = ['transfer', 'calibrate'].includes(type) ? '' : String(input.category || 'other').trim().slice(0, 48) || 'other';
  const photo = isLocalImage(input.photo) ? String(input.photo) : '';
  const accountId = String(input.accountId || 'unassigned').trim().slice(0, 80) || 'unassigned';
  const sourceAccountId = String(input.sourceAccountId || '').trim().slice(0, 80);
  const targetAccountId = String(input.targetAccountId || '').trim().slice(0, 80);
  if (type === 'transfer' && (!sourceAccountId || !targetAccountId || sourceAccountId === targetAccountId)) return null;
  return {
    id: String(input.id || crypto.randomUUID()),
    type,
    category,
    amount: clampAmount(Number(input.amount)),
    accountId: type === 'transfer' ? '' : accountId,
    sourceAccountId: type === 'transfer' ? sourceAccountId : '',
    targetAccountId: type === 'transfer' ? targetAccountId : '',
    adjustment: type === 'calibrate' ? clampSignedAmount(input.adjustment ?? input.difference) : 0,
    targetBalance: type === 'calibrate' ? clampSignedAmount(input.targetBalance) : null,
    difference: type === 'calibrate' ? clampSignedAmount(input.difference ?? input.adjustment) : 0,
    reasonTag: type === 'calibrate' ? String(input.reasonTag || '余额校准').trim().slice(0, 48) : '',
    note: String(input.note || '').trim().slice(0, 100),
    photo,
    date,
    createdAt,
    updatedAt
  };
}

function normalizePrivateVault(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const cleanBase64 = value => /^[A-Za-z0-9+/]*={0,2}$/.test(String(value || '')) ? String(value || '') : '';
  return {
    version: 1,
    salt: cleanBase64(source.salt),
    verifierIv: cleanBase64(source.verifierIv),
    verifier: cleanBase64(source.verifier),
    payloadIv: cleanBase64(source.payloadIv),
    payload: cleanBase64(source.payload),
    assetRefs: Array.isArray(source.assetRefs) ? [...new Set(source.assetRefs.map(String).filter(value => /^mine-(?:vault-media|media|browser-media):\/\/[a-z0-9.-]+$/i.test(value)))].slice(0, 2000) : [],
    updatedAt: Number(source.updatedAt) || 0
  };
}

export function makeWeeklyInsightReport(input = {}) {
  const createdAt = Number(input.generatedAt || input.createdAt) || Date.now();
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
  const chart = Array.isArray(input.dailyFocusChart) ? input.dailyFocusChart.slice(0, 7).map(item => ({
    dayName: String(item?.dayName || '').slice(0, 12),
    hours: Math.max(0, Math.round((Number(item?.hours) || 0) * 100) / 100),
    isPeak: Boolean(item?.isPeak)
  })) : [];
  const weekStart = validDate(input.weekStart || input.start);
  const weekEnd = validDate(input.weekEnd || input.end);
  return {
    id: String(input.id || crypto.randomUUID()),
    weekStart,
    weekEnd,
    dateRange: String(input.dateRange || (weekStart && weekEnd ? `${weekStart} - ${weekEnd}` : '')).slice(0, 32),
    weekNumber: Math.max(0, Math.round(Number(input.weekNumber) || 0)),
    themeTitle: String(input.themeTitle || '').trim().slice(0, 120),
    summaryNarrative: String(input.summaryNarrative || input.text || '').trim().slice(0, 4000),
    kpis: input.kpis && typeof input.kpis === 'object' ? structuredClone(input.kpis) : {},
    dailyFocusChart: chart,
    tracks: input.tracks && typeof input.tracks === 'object' ? structuredClone(input.tracks) : {},
    nextWeekActionAdvice: Array.isArray(input.nextWeekActionAdvice) ? input.nextWeekActionAdvice.map(item => String(item || '').trim()).filter(Boolean).slice(0, 5) : [],
    generatedAt: createdAt,
    status: ['ready', 'failed', 'pending'].includes(input.status) ? input.status : 'ready'
  };
}

export function makeFocusSession(input = {}) {
  const durationSeconds = clamp(positiveInt(input.durationSeconds, positiveInt(input.minutes, 0) * 60), 0, 604800);
  const targetDurationSeconds = clamp(positiveInt(input.targetDurationSeconds, durationSeconds), 0, 604800);
  const startedAt = Number(input.startedAt) || Date.now();
  const endedAt = Number(input.endedAt) || (startedAt + durationSeconds * 1000);
  const mode = ['pomo', 'pomodoro', 'countdown', 'stopwatch', 'free'].includes(input.mode) ? (input.mode === 'pomodoro' ? 'pomo' : input.mode) : 'free';
  const interruptionsCount = clamp(positiveInt(input.interruptionsCount, 0), 0, 999);
  const flowScore = Number.isFinite(Number(input.flowScore)) ? clamp(Math.round(Number(input.flowScore)), 0, 100) : calculateFlowScore({ durationSeconds, targetDurationSeconds, interruptionsCount });
  const ambientSoundsUsed = Array.isArray(input.ambientSoundsUsed) ? input.ambientSoundsUsed.map(sound => ({ soundId: String(sound?.soundId || '').slice(0, 48), volume: clamp(Number(sound?.volume) || 0, 0, 1) })).filter(sound => sound.soundId).slice(0, 8) : [];
  return { ...input, id: String(input.id || crypto.randomUUID()), mode, targetDurationSeconds, durationSeconds, minutes: Math.floor(durationSeconds / 60), ambientSoundsUsed, interruptionsCount, flowScore, startedAt, endedAt };
}

export function calculateFlowScore(session = {}) {
  const target = Math.max(0, Number(session.targetDurationSeconds) || 0);
  const duration = Math.max(0, Number(session.durationSeconds) || 0);
  const completion = target > 0 ? Math.min(1, duration / target) : duration > 0 ? 1 : 0;
  const interruptionPenalty = Math.min(1, Math.max(0, Number(session.interruptionsCount) || 0) * 0.1);
  return Math.round((completion * 0.8 + (1 - interruptionPenalty) * 0.2) * 100);
}

export function makeSnippet(input = {}) {
  const type = input.type === 'photo' ? 'photo' : 'text';
  const createdAt = Number(input.createdAt) || Date.now();
  const fallbackDate = dateKey(new Date(createdAt));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : fallbackDate;
  const photos = normalizeSnippetPhotos(input.photos, input.photo);
  const text = String(input.text || '').trim().slice(0, type === 'photo' ? 300 : 2000);
  // 视频/实况图项：本地文件保持 { poster, video }；HLS 可附加 sourceType/label/position/duration。
  const videos = Array.isArray(input.videos)
    ? input.videos
        .map(item => {
          const rawVideo = String(item?.video || '').trim();
          // 浏览器预览没有原生私有文件目录，本地视频以完整 data URL 保存；不能截断媒体字节。
          // Android 使用短 mine-media:// 引用，HLS 使用受限长度的网络地址。
          const video = /^data:video\/[a-z0-9.+-]+;base64,/i.test(rawVideo) ? rawVideo : rawVideo.slice(0, 4096);
          const isHls = item?.sourceType === 'hls' || /^https?:\/\/[^\s]+\.m3u8(?:[?#].*)?$/i.test(video);
          const label = String(item?.label || '').trim().slice(0, 80);
          const position = Math.max(0, Math.floor(Number(item?.position) || 0));
           const duration = Math.max(0, Math.floor(Number(item?.duration) || 0));
           const coverTime = Math.max(0, Number(item?.coverTime) || 0);
          const width = Math.max(0, Math.floor(Number(item?.width) || 0));
          const height = Math.max(0, Math.floor(Number(item?.height) || 0));
          const contentLeft = clamp(Number(item?.contentLeft) || 0, 0, .45);
          const contentRight = clamp(Number(item?.contentRight) || 0, 0, .45);
          const contentAspect = Math.max(0, Number(item?.contentAspect) || 0);
          const displayOrientation = item?.displayOrientation === 'portrait' ? 'portrait' : item?.displayOrientation === 'landscape' ? 'landscape' : '';
          const displayAnalysisVersion = Math.max(0, Math.floor(Number(item?.displayAnalysisVersion) || 0));
          return {
            poster: isLocalImage(item?.poster) ? String(item.poster) : '',
            video,
            ...(isHls ? { sourceType: 'hls' } : {}),
            ...(label ? { label } : {}),
            ...(position ? { position } : {}),
             ...(duration ? { duration } : {}),
            ...(width && height ? { width, height } : {}),
            ...(contentLeft + contentRight < .82 && contentAspect ? { contentLeft, contentRight, contentAspect } : {}),
            ...(displayOrientation ? { displayOrientation } : {}),
            ...(displayAnalysisVersion ? { displayAnalysisVersion } : {}),
             ...(coverTime ? { coverTime } : {})
          };
        })
        .filter(item => item.video)
        .slice(0, SNIPPET_PHOTO_LIMIT)
    : [];
  return {
    id: String(input.id || crypto.randomUUID()),
    type,
    date,
    text,
    photo: photos[0] || '',
    photos,
    videos,
    tags: normalizeStringArray(input.tags, 8, 24),
    summary: String(input.summary || '').trim().slice(0, 120),
    createdAt,
    updatedAt: Number(input.updatedAt) || createdAt
  };
}

export function makeTasteEntry(input = {}) {
  const createdAt = Number(input.createdAt) || Date.now();
  const type = Object.hasOwn(TASTE_TYPES, input.type) ? input.type : 'dish';
  const verdict = Object.hasOwn(TASTE_VERDICTS, input.verdict) ? input.verdict : 'again';
  const photos = Array.isArray(input.photos)
    ? [...new Set(input.photos.map(item => isLocalImage(item) ? String(item) : '').filter(Boolean))].slice(0, 6)
    : [];
  return {
    id: String(input.id || crypto.randomUUID()),
    type,
    name: String(input.name || '').trim().slice(0, 80),
    placeName: String(input.placeName || '').trim().slice(0, 80),
    brand: String(input.brand || '').trim().slice(0, 80),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || '')) ? String(input.date) : dateKey(new Date(createdAt)),
    rating: clamp(Math.round(Number(input.rating) || 0), 0, 5),
    verdict,
    price: clampAmount(input.price),
    location: String(input.location || '').trim().slice(0, 120),
    flavorTags: normalizeStringArray(input.flavorTags, 12, 24),
    notes: String(input.notes || '').trim().slice(0, 1200),
    photos,
    ledgerTransactionId: String(input.ledgerTransactionId || '').trim().slice(0, 120),
    createdAt,
    updatedAt: Number(input.updatedAt) || createdAt
  };
}

export function tastePlaceGroups(entries = []) {
  const groups = new Map();
  for (const entry of entries) {
    const name = String(entry?.type === 'place' ? entry.name : entry?.placeName || '').trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase('zh-CN');
    const group = groups.get(key) || { key, name, entries: [], totalRating: 0, rated: 0, latestAt: 0 };
    group.entries.push(entry);
    if (entry.rating) { group.totalRating += entry.rating; group.rated += 1; }
    group.latestAt = Math.max(group.latestAt, Number(entry.updatedAt) || Number(entry.createdAt) || 0);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({
    ...group,
    averageRating: group.rated ? Math.round(group.totalRating * 10 / group.rated) / 10 : 0,
    favorites: group.entries.filter(entry => ['favorite', 'again'].includes(entry.verdict)).length,
    avoid: group.entries.filter(entry => entry.verdict === 'avoid').length,
    cover: group.entries.find(entry => entry.photos?.length)?.photos?.[0] || ''
  })).sort((a, b) => b.latestAt - a.latestAt || a.name.localeCompare(b.name, 'zh-CN'));
}

export function migrateState(rawState, defaults = makeDefaultState()) {
  const raw = rawState && typeof rawState === 'object' ? rawState : {};
  const state = structuredClone(defaults);
  state.route = ['today', 'focus', 'statistics', 'calendar', 'mine', 'library', 'snippets', 'countdown', 'ai', 'documents', 'private-vault', 'password-vault', 'taste', 'local-gallery'].includes(raw.route) ? raw.route : 'today';
  state.profile = { ...state.profile, ...(raw.profile || {}) };
  state.profile.avatar = isLocalImage(state.profile.avatar) ? state.profile.avatar : '';
  state.settings = { ...state.settings, ...(raw.settings || {}) };
  state.settings.timetable = normalizeTimetable(raw.settings?.timetable, raw.settings?.courseOverrides);
  state.settings.defaultDurationMinutes = clamp(positiveInt(state.settings.defaultDurationMinutes, 25), 1, 180);
  // 专注↔习惯联动：指向的习惯若已删除 / 已归档 / 类型不再计量分钟，自动断开而不是静默失效。
  const linkedHabit = (state.habits || []).find(habit => habit.id === state.settings.focusLinkedHabitId);
  state.settings.focusLinkedHabitId = linkedHabit && !linkedHabit.archived && linkedHabit.tracking === 'quantity' && /分钟/.test(linkedHabit.unit || '') ? linkedHabit.id : '';
  state.settings.notificationsEnabled = state.settings.notificationsEnabled !== false;
  state.settings.pomodoroFocusMinutes = clamp(positiveInt(state.settings.pomodoroFocusMinutes, 25), 1, 180);
  state.settings.pomodoroShortBreakMinutes = clamp(positiveInt(state.settings.pomodoroShortBreakMinutes, 5), 1, 60);
  state.settings.pomodoroLongBreakMinutes = clamp(positiveInt(state.settings.pomodoroLongBreakMinutes, 15), 1, 120);
  state.settings.pomodoroRounds = clamp(positiveInt(state.settings.pomodoroRounds, 4), 1, 12);
  state.settings.pomodoroAutoStart = state.settings.pomodoroAutoStart === true;
  state.settings.ambientSound = ['none', 'leaves', 'ocean', 'rain', 'library'].includes(state.settings.ambientSound) ? state.settings.ambientSound : 'none';
  state.settings.ambientVolume = clamp(Number(state.settings.ambientVolume) || 0.5, 0, 1);
  state.settings.aiEnabled = state.settings.aiEnabled === true;
  state.settings.aiProvider = AI_PROVIDERS.includes(state.settings.aiProvider) ? state.settings.aiProvider : 'deepseek';
  state.settings.aiBaseUrl = String(state.settings.aiBaseUrl || '').trim();
  state.settings.aiModel = String(state.settings.aiModel || 'deepseek-chat').trim() || 'deepseek-chat';
  state.settings.aiApiKey = String(state.settings.aiApiKey || '').trim();
  state.settings.aiLastDataScanAt = Number(state.settings.aiLastDataScanAt) || 0;
  state.settings.visionProvider = AI_PROVIDERS.includes(state.settings.visionProvider) ? state.settings.visionProvider : 'qwen';
  state.settings.visionBaseUrl = String(state.settings.visionBaseUrl || '').trim();
  state.settings.visionApiKey = String(state.settings.visionApiKey || '').trim();
  state.settings.visionModel = String(state.settings.visionModel || 'qwen-vl-plus').trim() || 'qwen-vl-plus';
  // 周小结结构：start/end 为日期、text 为文案、generatedAt 为时间戳；
  // 兼容旧数据：仅有 weekStart 时将其作为 start。
  const rawSummary = state.settings.aiWeekSummary || {};
  const legacyStart = String(rawSummary.weekStart || '');
  state.settings.aiWeekSummary = {
    start: String(rawSummary.start || legacyStart || '').slice(0, 10),
    end: String(rawSummary.end || '').slice(0, 10),
    text: String(rawSummary.text || ''),
    generatedAt: Number(rawSummary.generatedAt) || 0
  };
  state.settings.backgroundImage = isLocalImage(state.settings.backgroundImage) ? String(state.settings.backgroundImage) : '';
  state.settings.todayCoverImage = isLocalImage(state.settings.todayCoverImage) ? String(state.settings.todayCoverImage) : '';
  const rawWeather = state.settings.weatherSnapshot;
  state.settings.weatherSnapshot = rawWeather && /^\d{4}-\d{2}-\d{2}$/.test(rawWeather.date || '') && Number.isFinite(Number(rawWeather.temperature)) && Number.isFinite(Number(rawWeather.code))
    ? { date: rawWeather.date, temperature: Math.round(Number(rawWeather.temperature)), code: Number(rawWeather.code), updatedAt: Number(rawWeather.updatedAt) || 0 }
    : null;
  const backgroundOverlayOpacity = Number(state.settings.backgroundOverlayOpacity);
  state.settings.backgroundOverlayOpacity = clamp(Math.round(Number.isFinite(backgroundOverlayOpacity) ? backgroundOverlayOpacity : 72), 0, 100);
  // 显式保存过 cover 的用户选择保留；缺失或非法值一律回到默认的完整显示。
  state.settings.backgroundFit = state.settings.backgroundFit === 'cover' ? 'cover' : 'contain';
  state.settings.backgroundZoom = clamp(Number(state.settings.backgroundZoom) || 1, 0.5, 2);
  state.settings.backgroundOffsetX = Number.isFinite(Number(state.settings.backgroundOffsetX)) ? clamp(Number(state.settings.backgroundOffsetX), -1, 1) : 0;
  state.settings.backgroundOffsetY = Number.isFinite(Number(state.settings.backgroundOffsetY)) ? clamp(Number(state.settings.backgroundOffsetY), -1, 1) : 0;
  state.settings.dailyReminders = migrateDailyReminders(raw.settings);
  const rawAiCopy = raw.settings?.reminderAiCopy || {};
  state.settings.reminderAiCopy = {
    photo: Array.isArray(rawAiCopy.photo) ? rawAiCopy.photo.map(item => String(item || '').trim()).filter(Boolean).slice(0, 10) : [],
    journal: Array.isArray(rawAiCopy.journal) ? rawAiCopy.journal.map(item => String(item || '').trim()).filter(Boolean).slice(0, 10) : []
  };
  state.settings.timerOrientation = ['auto', 'portrait', 'landscape'].includes(state.settings.timerOrientation) ? state.settings.timerOrientation : 'auto';
  // 主题皮肤：未知值一律退回 classic（老数据没有这个字段时也是 classic），
  // 保证升级后观感与升级前一致，不会突然换色。
  state.settings.theme = APP_THEMES.includes(state.settings.theme) ? state.settings.theme : 'classic';
  const rawCountdownAi = state.settings.countdownAiReminders || {};
  state.settings.countdownAiReminders = {
    nodeReminder: rawCountdownAi.nodeReminder !== false,
    nodeNotify: rawCountdownAi.nodeNotify !== false,
    dailyMention: rawCountdownAi.dailyMention !== false,
    anniversaryBlessing: rawCountdownAi.anniversaryBlessing !== false
  };
  state.settings.aiEmotionCare = state.settings.aiEmotionCare !== false;
  // 旧用户未明确同意过自动提炼，升级后默认关闭。
  state.settings.aiConversationMemoryEnabled = state.settings.aiConversationMemoryEnabled === true;
  const rawBudget = state.settings.ledgerBudget || {};
  const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  const validPeriod = item => isDate(item?.start) && isDate(item?.end) && String(item.start) <= String(item.end) && clampAmount(item.total) > 0;
  state.settings.ledgerBudget = {
    start: isDate(rawBudget.start) ? String(rawBudget.start) : '',
    end: isDate(rawBudget.end) ? String(rawBudget.end) : '',
    total: clampAmount(rawBudget.total),
    categories: Object.fromEntries(Object.entries(rawBudget.categories || {})
      .filter(([key]) => String(key || '').trim().length > 0 && String(key).length <= 48)
      .map(([key, value]) => [String(key), clampAmount(value)])),
    periods: Array.isArray(rawBudget.periods)
      ? rawBudget.periods.map(item => ({ start: String(item?.start || ''), end: String(item?.end || ''), total: clampAmount(item?.total) })).filter(validPeriod).slice(-24)
      : []
  };
  const rawLedgerLast = state.settings.ledgerLastUsed || {};
  state.settings.ledgerLastUsed = {
    accountId: String(rawLedgerLast.accountId || '').trim().slice(0, 80),
    category: String(rawLedgerLast.category || '').trim().slice(0, 48),
    type: ['expense', 'income', 'transfer'].includes(rawLedgerLast.type) ? rawLedgerLast.type : 'expense'
  };
  state.settings.navTabs = normalizeNavTabs(raw.settings?.navTabs);
  // 习惯裁掉开头：整数秒，0 ~ HABIT_HEAD_MAX_SECONDS。超出范围或非数字一律当 0（不自动裁），
  // 免得旧数据里塞进来一个巨大值，把每段视频的开头都吃掉。
  state.settings.vaultTrimHeadSeconds = clamp(Math.round(Number(state.settings.vaultTrimHeadSeconds) || 0), 0, HABIT_HEAD_MAX_SECONDS);
  state.settings.aiRandomRemindersEnabled = state.settings.aiRandomRemindersEnabled !== false;
  const rawPlan = state.settings.aiRandomReminders;
  const planDate = /^\d{4}-\d{2}-\d{2}$/.test(String(rawPlan?.date || '')) ? String(rawPlan.date) : '';
  state.settings.aiRandomReminders = {
    date: planDate,
    items: Array.isArray(rawPlan?.items)
      ? rawPlan.items.map(item => {
          const time = String(item?.time || '');
          const [hour, minute] = time.split(':').map(Number);
          const validTime = /^\d{2}:\d{2}$/.test(time) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
          return {
            id: String(item?.id || crypto.randomUUID()),
            time: validTime ? time : '',
            title: String(item?.title || '').trim().slice(0, 60),
            body: String(item?.body || '').trim().slice(0, 120),
            pushed: Boolean(item?.pushed)
          };
        }).filter(item => item.time).slice(0, 8)
      : []
  };

  if (Array.isArray(raw.habits)) state.habits = raw.habits.map((habit, index) => migrateHabit(habit, index));
  state.habits = state.habits.filter(habit => habit.name);
  state.todos = Array.isArray(raw.todos) ? raw.todos.map(makeTodo).filter(todo => todo.title) : [];
  state.checks = normalizeChecks(raw.checks, state.habits);
  state.habitCompletions = normalizeHabitCompletions(raw.habitCompletions, state.checks, state.habits);
  state.habitSkips = normalizeHabitSkips(raw.habitSkips, state.habits);
  state.events = Array.isArray(raw.events) ? raw.events : [];
  const leafCategoryIds = new Set();
  state.focusCategories = migrateFocusCategories(raw, leafCategoryIds);
  state.sessions = Array.isArray(raw.sessions)
    ? raw.sessions.filter(session => !isBundledDemoSession(session)).map(session => migrateSession(session, leafCategoryIds)).filter(Boolean)
    : [];
  state.snippets = Array.isArray(raw.snippets)
    ? raw.snippets.map(makeSnippet).filter(snippet => snippet.type === 'photo' ? (snippet.photo || snippet.videos?.length) : snippet.text)
    : [];
  state.tasteEntries = Array.isArray(raw.tasteEntries)
    ? raw.tasteEntries.map(makeTasteEntry).filter(entry => entry.name).slice(0, 5000)
    : [];
  state.ledgerAccounts = migrateLedgerAccounts(raw.ledgerAccounts, state.ledgerAccounts);
  const seenLedgerCategoryIds = new Set(Object.keys(LEDGER_CATEGORIES));
  state.ledgerCategories = Array.isArray(raw.ledgerCategories)
    ? raw.ledgerCategories.map(makeLedgerCategory).filter(category => category.id && category.name && !seenLedgerCategoryIds.has(category.id) && (seenLedgerCategoryIds.add(category.id) || true))
    : [];
  const validLedgerCategoryIds = new Set([...Object.keys(LEDGER_CATEGORIES), ...state.ledgerCategories.map(category => category.id)]);
  state.merchantCategoryRules = Array.isArray(raw.merchantCategoryRules)
    ? raw.merchantCategoryRules.map(makeMerchantCategoryRule)
      .filter(rule => rule.keyword && validLedgerCategoryIds.has(rule.categoryId)).slice(-200)
    : [];
  const legacyLedger = !Array.isArray(raw.ledgerAccounts);
  state.transactions = Array.isArray(raw.transactions)
    ? raw.transactions.map(transaction => makeTransaction({
        ...transaction,
        // 升级前没有账户语义：一律待归属，绝不猜测扣减哪张卡/钱包。
        ...(legacyLedger && transaction?.type !== 'transfer' ? { accountId: 'unassigned' } : {})
      })).filter(transaction => transaction?.amount > 0)
    : [];
  state.transactions.forEach(transaction => {
    if (!['transfer', 'calibrate'].includes(transaction.type) && !validLedgerCategoryIds.has(transaction.category)) transaction.category = 'other';
    if (!['transfer', 'calibrate'].includes(transaction.type) && !state.ledgerAccounts.some(account => account.id === transaction.accountId)) transaction.accountId = 'unassigned';
  });
  const validAccountIds = new Set(state.ledgerAccounts.map(account => account.id));
  state.transactions = state.transactions.filter(transaction => {
    if (transaction.type === 'transfer') return validAccountIds.has(transaction.sourceAccountId) && validAccountIds.has(transaction.targetAccountId);
    if (transaction.type === 'calibrate') return validAccountIds.has(transaction.accountId) && transaction.adjustment !== 0;
    return true;
  });
  const validTransactionIds = new Set(state.transactions.map(transaction => transaction.id));
  state.tasteEntries.forEach(entry => { if (!validTransactionIds.has(entry.ledgerTransactionId)) entry.ledgerTransactionId = ''; });
  state.journals = normalizeJournals(raw.journals);
  state.dailySummaries = normalizeDailySummaries(raw.dailySummaries);
  state.weeklyInsightReports = Array.isArray(raw.weeklyInsightReports)
    ? raw.weeklyInsightReports.map(makeWeeklyInsightReport).filter(report => report.weekStart && report.weekEnd).slice(-12)
    : [];
  state.media = Array.isArray(raw.media) ? raw.media.map(makeMediaEntry).filter(entry => entry.title) : [];
  state.countdowns = Array.isArray(raw.countdowns)
    ? raw.countdowns.map(makeCountdown).filter(entry => entry.title && entry.date)
    : [];
  // 版本更新动态：同一版本只留一条；字段全部过一遍 normalize，脏数据直接丢。
  state.releases = Array.isArray(raw.releases)
    ? raw.releases.map(makeRelease).filter(release => release.code && release.title)
    : [];
  // 升级说明的去重水位：0 = 还没记录过（首次由 ensureReleaseActivities 按基线处理）。
  state.settings.lastSeenReleaseCode = Math.max(0, Math.floor(Number(state.settings.lastSeenReleaseCode)) || 0);
  state.documentFolders = Array.isArray(raw.documentFolders)
    ? raw.documentFolders.map(makeDocumentFolder).filter(folder => folder.name)
    : [];
  state.documents = Array.isArray(raw.documents)
    ? raw.documents.map(makeDocument).filter(document => document.name)
    : [];
  // 本机相册观看历史：只留「有 id 且看过」的记录，倒序保留最近 200 条。
  state.localGalleryWatchHistory = Array.isArray(raw.localGalleryWatchHistory)
    ? raw.localGalleryWatchHistory
      .map(entry => ({
        id: String(entry?.id || ''),
        name: String(entry?.name || '').slice(0, 120),
        watchedSeconds: Math.max(0, Math.floor(Number(entry?.watchedSeconds) || 0)),
        startedAt: Number(entry?.startedAt) || 0,
        endedAt: Number(entry?.endedAt) || 0
      }))
      .filter(entry => entry.id && entry.startedAt)
      .slice(-200)
    : [];
  state.privateVault = normalizePrivateVault(raw.privateVault);
  state.passwordVault = normalizePasswordVault(raw.passwordVault);
  state.aiMemory = Array.isArray(raw.aiMemory)
    ? raw.aiMemory.map(item => {
        const createdAt = Number(item.createdAt) || Date.now();
        return {
          id: String(item.id || crypto.randomUUID()),
          text: String(item.text || '').trim(),
          source: String(item.source || ''),
          createdAt,
          updatedAt: Number(item.updatedAt) || createdAt
        };
      }).filter(item => item.text).slice(0, 200)
    : [];
  state.aiHistory = Array.isArray(raw.aiHistory)
    ? raw.aiHistory.map(item => {
        const role = item.role === 'user' ? 'user' : 'assistant';
        const content = String(item.content || '').trim();
        return {
          role,
          content,
          // 旧消息缺少时间时保留未知，不能把迁移时间伪装成发送时间。
          at: Number.isFinite(Number(item.at)) && Number(item.at) > 0 ? Number(item.at) : 0,
          ...(item.id ? { id: String(item.id) } : {}),
          ...(item.image ? { image: String(item.image) } : {}),
          ...(item.imageDesc ? { imageDesc: String(item.imageDesc) } : {}),
          ...(item.ledger && typeof item.ledger === 'object' ? { ledger: { ...item.ledger } } : {}),
          ...(item.imageBill && typeof item.imageBill === 'object' ? { imageBill: { ...item.imageBill } } : {})
        };
      }).filter(item => item.content || item.ledger || item.imageBill || item.image).slice(-40)
    : [];
  state.focusProjects = Array.isArray(raw.focusProjects) && raw.focusProjects.length
    ? raw.focusProjects.map(makeFocusProject).filter(project => project.name)
    : state.focusProjects;
  const validHabitIds = new Set(state.habits.filter(habit => habit.tracking === 'quantity' && /分钟/.test(habit.unit)).map(habit => habit.id));
  const validMediaIds = new Set(state.media.filter(entry => entry.type === 'book').map(entry => entry.id));
  state.focusProjects.forEach(project => {
    if (!validHabitIds.has(project.habitId)) project.habitId = '';
    if (!validMediaIds.has(project.mediaId)) project.mediaId = '';
  });
  state.timer = migrateTimer(raw.timer, state.settings.defaultDurationMinutes, state.focusProjects);
  state.meta = { schemaVersion: SCHEMA_VERSION, migratedAt: new Date().toISOString() };
  return state;
}

function migrateLedgerAccounts(rawAccounts, defaults) {
  if (!Array.isArray(rawAccounts)) return structuredClone(defaults);
  const seen = new Set();
  return rawAccounts.map(makeLedgerAccount)
    .filter(account => account.id && account.name && !seen.has(account.id) && (seen.add(account.id) || true))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function migrateHabit(habit, index) {
  const parsed = parseLegacyGoal(habit?.goal);
  return makeHabit({
    ...habit,
    id: habit?.id || `habit-${Date.now()}-${index}`,
    target: habit?.target ?? parsed.target,
    unit: habit?.unit ?? parsed.unit,
    repeatDays: habit?.repeatDays
  });
}

function migrateSession(session, leafCategoryIds = new Set()) {
  const minutes = positiveInt(session?.minutes, 0);
  if (!minutes || !/^\d{4}-\d{2}-\d{2}$/.test(session?.date || '')) return null;
  const startedAt = Number(session.startedAt) || new Date(`${session.date}T12:00:00`).getTime();
  const projectId = String(session.projectId || '');
  const categoryId = leafCategoryIds.has(String(session.categoryId || projectId)) ? String(session.categoryId || projectId) : '';
  return makeFocusSession({
    id: session.id || crypto.randomUUID(),
    date: session.date,
    startedAt,
    minutes,
    task: String(session.task || '专注记录').trim(),
    detail: String(session.detail || '').trim(),
    category: CATEGORIES[session.category] ? session.category : 'work',
    projectId,
    categoryId,
    habitId: String(session.habitId || ''),
    habitMinutes: clamp(positiveInt(session.habitMinutes, 0), 0, minutes),
    mediaId: String(session.mediaId || ''),
    mode: session.mode,
    targetDurationSeconds: session.targetDurationSeconds ?? minutes * 60,
    durationSeconds: session.durationSeconds ?? minutes * 60,
    ambientSoundsUsed: session.ambientSoundsUsed,
    interruptionsCount: session.interruptionsCount,
    flowScore: session.flowScore,
    endedAt: Number(session.endedAt) || (startedAt + minutes * 60000)
  });
}

function migrateFocusCategories(raw, leafCategoryIds) {
  if (Array.isArray(raw.focusCategories) && raw.focusCategories.length) {
    const categories = raw.focusCategories.map(makeFocusCategory).filter(category => category.name);
    const childParentIds = new Set(categories.map(category => category.parentId).filter(Boolean));
    categories.forEach(category => {
      if (!childParentIds.has(category.id)) leafCategoryIds.add(category.id);
    });
    return categories;
  }
  const projects = Array.isArray(raw.focusProjects)
    ? raw.focusProjects.map(makeFocusProject).filter(project => project.name)
    : [];
  return projects.length ? buildFocusCategoriesFromProjects(projects, leafCategoryIds) : [];
}

function buildFocusCategoriesFromProjects(projects, leafCategoryIds) {
  const categories = [];
  const groupNodes = new Map();
  projects.forEach((project, index) => {
    let parentId = '';
    if (project.group) {
      if (!groupNodes.has(project.group)) {
        const parent = makeFocusCategory({
          name: project.group,
          parentId: '',
          icon: project.icon,
          color: project.color,
          sortOrder: groupNodes.size
        });
        groupNodes.set(project.group, parent.id);
        categories.push(parent);
      }
      parentId = groupNodes.get(project.group);
    }
    const leaf = makeFocusCategory({
      id: project.id,
      name: project.name,
      parentId,
      icon: project.icon,
      color: project.color,
      sortOrder: index,
      archived: project.archived,
      createdAt: project.createdAt
    });
    leafCategoryIds.add(leaf.id);
    categories.push(leaf);
  });
  return categories;
}

function migrateTimer(timer, defaultMinutes, projects = []) {
  const fallback = defaultMinutes * 60;
  const duration = clamp(positiveInt(timer?.duration, fallback), 1, 86399);
  const left = clamp(positiveInt(timer?.left, duration), 0, duration);
  const mode = ['free', 'stopwatch', 'pomodoro'].includes(timer?.mode) ? timer.mode : 'free';
  const running = Boolean(timer?.running && (mode === 'stopwatch' ? Number(timer?.startedAt) : Number(timer?.endAt)));
  return {
    duration,
    left: running ? Math.max(0, Math.ceil((Number(timer.endAt) - Date.now()) / 1000)) : left,
    running,
    endAt: running && mode !== 'stopwatch' ? Number(timer.endAt) : null,
    startedAt: running ? (Number(timer.startedAt) || Date.now()) : null,
    task: String(timer?.task || '').trim(),
    category: CATEGORIES[timer?.category] ? timer.category : 'work',
    projectId: projects.some(project => project.id === timer?.projectId && !project.archived) ? timer.projectId : (projects.find(project => !project.archived)?.id || ''),
    mode,
    phase: ['focus', 'shortBreak', 'longBreak'].includes(timer?.phase) ? timer.phase : 'focus',
    round: clamp(positiveInt(timer?.round, 1), 1, 12),
    elapsed: running && mode === 'stopwatch'
      ? clamp(Math.floor((Date.now() - Number(timer.startedAt)) / 1000), 0, 604800)
      : clamp(positiveInt(timer?.elapsed, 0), 0, 604800)
  };
}

function normalizeChecks(checks, habits) {
  if (!checks || typeof checks !== 'object') return {};
  return Object.fromEntries(Object.entries(checks)
    .filter(([day, progress]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && progress && typeof progress === 'object')
    .map(([day, progress]) => {
      if (Array.isArray(progress)) {
        return [day, Object.fromEntries([...new Set(progress.map(String))].map(id => [id, habits.find(habit => habit.id === id)?.target || 1]))];
      }
      return [day, Object.fromEntries(Object.entries(progress).map(([id, count]) => [String(id), positiveInt(count, 0)]).filter(([, count]) => count > 0))];
    }));
}

function normalizeHabitCompletions(completions, checks, habits) {
  if (!completions || typeof completions !== 'object') return {};
  return Object.fromEntries(Object.entries(completions).flatMap(([day, values]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !values || typeof values !== 'object') return [];
    const normalized = Object.fromEntries(Object.entries(values).flatMap(([habitId, timestamp]) => {
      const habit = habits.find(item => item.id === habitId);
      const time = Number(timestamp);
      return habit && habitGoalMet(habit, habitProgressForDate({ checks }, habit, day)) && Number.isFinite(time) && time > 0
        ? [[habitId, time]] : [];
    }));
    return Object.keys(normalized).length ? [[day, normalized]] : [];
  }));
}

function normalizeHabitSkips(skips, habits) {
  if (!skips || typeof skips !== 'object') return {};
  const valid = new Set(habits.map(habit=>habit.id));
  return Object.fromEntries(Object.entries(skips).flatMap(([day,ids])=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&Array.isArray(ids)?[[day,[...new Set(ids.map(String).filter(id=>valid.has(id)))]]]:[]).filter(([,ids])=>ids.length));
}

function normalizeJournals(journals) {
  if (!journals || typeof journals !== 'object') return {};
  return Object.fromEntries(Object.entries(journals).flatMap(([day, value]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
    const entry = typeof value === 'string'
      ? { content: value.trim(), mood: '', weather: '', photos: [], tags: [], summary: '', updatedAt: new Date(`${day}T12:00:00`).getTime() }
      : {
          content: String(value?.content || '').trim(),
          mood: MOODS[value?.mood] ? value.mood : '',
          weather: WEATHERS[value?.weather] ? value.weather : '',
          photos: Array.isArray(value?.photos) ? value.photos.filter(isLocalImage).slice(0, 60) : [],
          tags: normalizeStringArray(value?.tags, 8, 24),
          summary: String(value?.summary || '').trim().slice(0, 120),
          updatedAt: Number(value?.updatedAt) || Date.now()
        };
    return entry.content || entry.mood || entry.weather || entry.photos.length ? [[day, entry]] : [];
  }));
}

function normalizeDailySummaries(summaries) {
  if (!summaries || typeof summaries !== 'object') return {};
  return Object.fromEntries(Object.entries(summaries).flatMap(([day, value]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
    const text = String(value?.text || '').trim();
    if (!text) return [];
    return [[day, { text, updatedAt: Number(value?.updatedAt) || Date.now() }]];
  }));
}

function parseLegacyGoal(goal) {
  const text = String(goal || '');
  const match = text.match(/(?:\d+\s*\/\s*)?(\d+)\s*(.*)/);
  return { target: positiveInt(match?.[1], 1), unit: match?.[2]?.trim() || '次' };
}

function isBundledDemoSession(session) {
  const value = `${session?.date}|${session?.minutes}|${session?.task}|${session?.detail}`;
  return ['a', 'b', 'c'].includes(session?.id) && DEMO_SESSION_KEYS.has(value);
}

function normalizeRepeatDays(days) {
  if (!Array.isArray(days) || !days.length) return [0, 1, 2, 3, 4, 5, 6];
  return [...new Set(days.map(Number).filter(day => day >= 0 && day <= 6))].sort();
}

export function habitsForDate(state, day) {
  const weekDay = new Date(`${day}T12:00:00`).getDay();
  const skipped = new Set(state.habitSkips?.[day] || []);
  return state.habits.filter(habit => !habit.archived && !skipped.has(habit.id) && (habit.goalPeriod === 'weekly' || habit.repeatDays.includes(weekDay)));
}

export function habitProgressForDate(state, habit, day) {
  if (habit.goalPeriod !== 'weekly') return Number(state.checks?.[day]?.[habit.id] || 0);
  const cursor = new Date(`${day}T12:00:00`);
  cursor.setDate(cursor.getDate() - ((cursor.getDay()+6)%7));
  let total=0;
  for(let index=0;index<7;index+=1){const current=new Date(cursor);current.setDate(cursor.getDate()+index);total+=Number(state.checks?.[dateKey(current)]?.[habit.id]||0);}
  return total;
}

export function habitGoalMet(habit, value) {
  if (habit.goalType === 'range') return value >= habit.target && value <= habit.targetMax;
  return value >= habit.target;
}

export function todosForDate(state, day) {
  return state.todos
    .filter(todo => todo.date === day)
    .sort((a, b) => Number(a.completed) - Number(b.completed) || a.createdAt - b.createdAt);
}

export function minutesOnDate(state, day) {
  return state.sessions.filter(session => session.date === day).reduce((sum, session) => sum + session.minutes, 0);
}

export function activeStreak(state, endDay = dateKey()) {
  let streak = 0;
  const cursor = new Date(`${endDay}T12:00:00`);
  while (streak < 3660) {
    const day = dateKey(cursor);
    const active = minutesOnDate(state, day) > 0
      || Object.values(state.checks[day] || {}).some(count => Number(count) > 0)
      || Boolean(state.journals[day])
      || Boolean(state.habitSkips?.[day]?.length);
    if (!active) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function periodSummary(state, period = 'week', now = new Date()) {
  const { start, end, previousStart } = periodBounds(period, now);
  const sessions = state.sessions.filter(session => {
    const time = new Date(`${session.date}T12:00:00`).getTime();
    return time >= start.getTime() && time <= end.getTime();
  });
  const previousMinutes = state.sessions.filter(session => {
    const time = new Date(`${session.date}T12:00:00`).getTime();
    return time >= previousStart.getTime() && time < start.getTime();
  }).reduce((sum, session) => sum + session.minutes, 0);
  const totalMinutes = sessions.reduce((sum, session) => sum + session.minutes, 0);
  const dayCount = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const byCategory = Object.fromEntries(Object.keys(CATEGORIES).map(category => [category, 0]));
  const byProject = {};
  sessions.forEach(session => {
    byCategory[session.category] = (byCategory[session.category] || 0) + session.minutes;
    const projectKey = session.projectId || 'legacy';
    byProject[projectKey] = (byProject[projectKey] || 0) + session.minutes;
  });
  return {
    start: dateKey(start), end: dateKey(end), sessions, totalMinutes, previousMinutes,
    difference: totalMinutes - previousMinutes,
    averageMinutes: Math.round(totalMinutes / dayCount),
    longestMinutes: sessions.reduce((max, session) => Math.max(max, session.minutes), 0),
    byCategory, byProject,
    daily: Array.from({ length: dayCount }, (_, index) => {
      const date = new Date(start); date.setDate(start.getDate() + index);
      const day = dateKey(date);
      return { day, label: period === 'week' ? WEEK_DAYS[date.getDay()] : String(date.getDate()), minutes: minutesOnDate(state, day) };
    })
  };
}

export function todayCompletion(state, day = dateKey()) {
  const habits = habitsForDate(state, day);
  const done = habits.filter(habit => habitGoalMet(habit, habitProgressForDate(state, habit, day))).length;
  return { done, total: habits.length, percent: habits.length ? Math.round(done / habits.length * 100) : 0 };
}

export function ledgerCategoryMap(state) {
  return Object.fromEntries([
    ...Object.entries(LEDGER_CATEGORIES),
    ...(state.ledgerCategories || []).map(category => [category.id, category])
  ]);
}

export function ledgerSummary(state, now = new Date()) {
  const today = dateKey(now);
  const transactions = state.transactions || [];
  const budget = state.settings?.ledgerBudget || { total: 0, categories: {} };
  const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  const hasPeriod = isDate(budget.start) && isDate(budget.end) && String(budget.start) <= String(budget.end);
  // 统计区间：有周期用 start~end（含首尾）；无周期用自然月
  const period = hasPeriod
    ? { start: String(budget.start), end: String(budget.end) }
    : { start: `${today.slice(0, 7)}-01`, end: `${today.slice(0, 7)}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}` };
  const inRange = item => item.date >= period.start && item.date <= period.end;
  const periodList = transactions.filter(inRange);
  const periodExpense = round2(periodList.filter(item => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0));
  const periodIncome = round2(periodList.filter(item => item.type === 'income').reduce((sum, item) => sum + item.amount, 0));
  const todayExpense = round2(transactions.filter(item => item.type === 'expense' && item.date === today).reduce((sum, item) => sum + item.amount, 0));
  const byCategory = {};
  periodList.filter(item => item.type === 'expense').forEach(item => {
    byCategory[item.category] = round2((byCategory[item.category] || 0) + item.amount);
  });
  const budgetTotal = budget.total;
  const daysTotal = Math.round((new Date(`${period.end}T00:00:00`).getTime() - new Date(`${period.start}T00:00:00`).getTime()) / 86400000) + 1;
  const daysLeft = Math.max(0, Math.round((new Date(`${period.end}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000));
  const ended = hasPeriod && today > period.end;
  const ledgerCategories = ledgerCategoryMap(state);
  const budgetProgress = {
    total: round2(budgetTotal || 0),
    spent: periodExpense,
    percent: budgetTotal > 0 ? Math.min(999, Math.round(periodExpense / budgetTotal * 100)) : 0,
    byCategory: Object.fromEntries(Object.keys(ledgerCategories).map(key => {
      const limit = Number(budget.categories?.[key]) || 0;
      return [key, { limit, spent: round2(byCategory[key] || 0), percent: limit > 0 ? Math.min(999, Math.round((byCategory[key] || 0) / limit * 100)) : 0 }];
    }))
  };
  const accountBalances = (state.ledgerAccounts || []).map(account => ({ ...account, balance: account.initialBalance }));
  const balanceById = new Map(accountBalances.map(account => [account.id, account]));
  transactions.forEach(item => {
    if (item.type === 'transfer') {
      const source = balanceById.get(item.sourceAccountId);
      const target = balanceById.get(item.targetAccountId);
      if (source) source.balance = round2(source.balance - item.amount);
      if (target) target.balance = round2(target.balance + item.amount);
      return;
    }
    const account = balanceById.get(item.accountId);
    if (!account) return;
    if (item.type === 'calibrate') {
      account.balance = round2(account.balance + (Number(item.adjustment ?? item.difference) || 0));
      return;
    }
    account.balance = round2(account.balance + (item.type === 'income' ? item.amount : -item.amount));
  });
  accountBalances.forEach(account => { account.balance = round2(account.balance); });
  const receivable = accountBalances.filter(account => account.type === 'receivable' && !account.archived);
  const activeAssets = accountBalances.filter(account => !account.archived);
  const totalAssets = round2(activeAssets.reduce((sum, account) => sum + account.balance, 0));
  const unassignedTransactions = transactions.filter(item => ['expense', 'income'].includes(item.type) && item.accountId === 'unassigned');
  const unassignedAmount = round2(unassignedTransactions.reduce((sum, item) => sum + item.amount, 0));
  return {
    month: period.start.slice(0, 7),
    period,
    periodEnded: ended,
    daysTotal,
    daysLeft,
    monthExpense: periodExpense,
    monthIncome: periodIncome,
    todayExpense,
    byCategory,
    budgetProgress,
    totalAssets,
    accounts: accountBalances.sort((a, b) => a.sortOrder - b.sortOrder),
    receivableBalance: round2(receivable.reduce((sum, account) => sum + account.balance, 0)),
    unassigned: { count: unassignedTransactions.length, amount: unassignedAmount },
    categoryExpense: byCategory
  };
}

export function archiveLedgerAccount(state, accountId, archived = true) {
  const account = (state.ledgerAccounts || []).find(item => item.id === accountId);
  if (!account) throw new Error('账户不存在');
  const balance = ledgerSummary(state).accounts.find(item => item.id === accountId)?.balance || 0;
  if (archived && Math.abs(balance) >= 0.005) throw new Error('账户余额尚未归零，请先转出余额或校准后再归档。');
  account.archived = archived;
  account.updatedAt = Date.now();
  return account;
}

/** 直接余额校准：默认将差额写入账户初始余额；勾选平账流水时写入 calibrate 交易。 */
export function calibrateLedgerAccount(state, payload = {}) {
  const accountId = String(payload.accountId || payload.accountKey || '').trim();
  const account = (state.ledgerAccounts || []).find(item => item.id === accountId);
  if (!account) throw new Error('找不到要校准的账户');
  const current = ledgerSummary(state).accounts.find(item => item.id === accountId)?.balance ?? account.initialBalance;
  const targetBalance = clampSignedAmount(payload.targetBalance);
  const difference = round2(targetBalance - current);
  const generateReconciliationTx = payload.generateReconciliationTx === true || payload.autoGenerateReconciliationTx === true;
  const calibration = {
    accountId,
    targetBalance,
    difference,
    reasonTag: String(payload.reasonTag || '余额校准').trim().slice(0, 48),
    note: String(payload.note || '').trim().slice(0, 200),
    generateReconciliationTx,
    createdAt: Date.now()
  };
  let reconciliationTx;
  if (generateReconciliationTx && difference !== 0) {
    reconciliationTx = makeTransaction({
      id: payload.transactionId,
      type: 'calibrate',
      amount: Math.abs(difference),
      adjustment: difference,
      difference,
      targetBalance,
      accountId,
      reasonTag: calibration.reasonTag,
      note: calibration.note,
      date: payload.date
    });
    if (reconciliationTx) state.transactions.push(reconciliationTx);
  } else if (difference !== 0) {
    account.initialBalance = round2(account.initialBalance + difference);
    account.updatedAt = Date.now();
  }
  const summary = ledgerSummary(state);
  return { updatedAccount: summary.accounts.find(item => item.id === accountId), totalNetAssets: summary.totalAssets, calibration, reconciliationTx };
}

export function previousCompleteWeekRange(now = new Date()) {
  const currentMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  currentMonday.setDate(currentMonday.getDate() - ((currentMonday.getDay() + 6) % 7));
  const start = new Date(currentMonday);
  start.setDate(start.getDate() - 7);
  const end = new Date(currentMonday);
  end.setDate(end.getDate() - 1);
  const weekNumber = Math.ceil((((start - new Date(start.getFullYear(), 0, 1, 12)) / 86400000) + new Date(start.getFullYear(), 0, 1, 12).getDay() + 1) / 7);
  return { start: dateKey(start), end: dateKey(end), weekNumber };
}

export const weeklyInsightPeriod = previousCompleteWeekRange;

export function habitHeatmapData(state, habitId, year = new Date().getFullYear()) {
  const habit = (state.habits || []).find(item => item.id === habitId);
  if (!habit) return { habitId: String(habitId || ''), year: Number(year), days: [], totalActiveDays: 0, currentStreak: 0, longestStreak: 0 };
  const daysInYear = new Date(Number(year), 1, 29).getMonth() === 1 ? 366 : 365;
  const days = Array.from({ length: daysInYear }, (_, index) => {
    const date = new Date(Number(year), 0, 1, 12);
    date.setDate(date.getDate() + index);
    const dateValue = dateKey(date);
    const value = Math.max(0, Number(habitProgressForDate(state, habit, dateValue)) || 0);
    const ratio = habit.goalType === 'range'
      ? (value >= habit.target && value <= habit.targetMax ? 1 : value / Math.max(1, habit.target))
      : value / Math.max(1, habit.target);
    const level = value > 0 ? Math.min(4, Math.max(1, Math.ceil(ratio * 4))) : 0;
    return { date: dateValue, level, value };
  });
  let longestStreak = 0;
  let run = 0;
  days.forEach(item => { run = item.level > 0 ? run + 1 : 0; longestStreak = Math.max(longestStreak, run); });
  let currentStreak = 0;
  const today = new Date();
  const endIndex = Number(year) === today.getFullYear()
    ? Math.min(days.length - 1, Math.floor((new Date(Number(year), today.getMonth(), today.getDate(), 12) - new Date(Number(year), 0, 1, 12)) / 86400000))
    : days.length - 1;
  for (let index = endIndex; index >= 0 && days[index].level > 0; index -= 1) currentStreak += 1;
  return { habitId: habit.id, year: Number(year), days, totalActiveDays: days.filter(item => item.level > 0).length, currentStreak, longestStreak };
}

export const getHabitHeatmapData = habitHeatmapData;

export function journalEntries(state, search = '') {
  const query = search.trim().toLowerCase();
  return Object.entries(state.journals)
    .map(([date, entry]) => ({ date, ...entry }))
    .filter(entry => !query || entry.content.toLowerCase().includes(query) || entry.date.includes(query) || MOODS[entry.mood]?.label.includes(query) || WEATHERS[entry.weather]?.label.includes(query))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function mediaEntries(state, { type = 'all', status = 'all', search = '' } = {}) {
  const query = search.trim().toLowerCase();
  return (state.media || [])
    .filter(entry => type === 'all' || entry.type === type)
    .filter(entry => status === 'all' || entry.status === status)
    .filter(entry => !query || entry.title.toLowerCase().includes(query) || entry.notes.toLowerCase().includes(query))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function snippetEntries(state, { type = 'all', search = '' } = {}) {
  const query = search.trim().toLowerCase();
  return (state.snippets || [])
    .filter(entry => type === 'all' || entry.type === type)
    .filter(entry => !query || entry.date.includes(query) || entry.text.toLowerCase().includes(query))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function pomodoroPhaseSeconds(settings, phase = 'focus') {
  const minutes = phase === 'shortBreak'
    ? settings.pomodoroShortBreakMinutes
    : phase === 'longBreak'
      ? settings.pomodoroLongBreakMinutes
      : settings.pomodoroFocusMinutes;
  return clamp(positiveInt(minutes, phase === 'focus' ? 25 : 5), 1, 180) * 60;
}

export function nextPomodoroStage(timer, settings) {
  const rounds = clamp(positiveInt(settings.pomodoroRounds, 4), 1, 12);
  const currentRound = clamp(positiveInt(timer.round, 1), 1, rounds);
  if (timer.phase === 'shortBreak') return { phase: 'focus', round: Math.min(rounds, currentRound + 1) };
  if (timer.phase === 'longBreak') return { phase: 'focus', round: 1 };
  if (currentRound >= rounds) return { phase: 'longBreak', round: currentRound };
  return { phase: 'shortBreak', round: currentRound };
}

function periodBounds(period, now) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  let start;
  if (period === 'year') start = new Date(now.getFullYear(), 0, 1, 12);
  else if (period === 'month') start = new Date(now.getFullYear(), now.getMonth(), 1, 12);
  else {
    start = new Date(end);
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
  }
  const span = Math.round((end - start) / 86400000) + 1;
  const previousStart = new Date(start);
  previousStart.setDate(previousStart.getDate() - span);
  return { start, end, previousStart };
}

const positiveInt = (value, fallback) => {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round2 = value => Math.round((Number(value) || 0) * 100) / 100;
const clampAmount = value => Number.isFinite(Number(value)) ? round2(Math.max(0, Number(value))) : 0;
const clampSignedAmount = value => Number.isFinite(Number(value)) ? round2(clamp(Number(value), -999999999, 999999999)) : 0;

const makeReminder = (input = {}) => ({
  id: String(input.id || crypto.randomUUID()),
  hour: clamp(positiveInt(input.hour, 21), 0, 23),
  minute: clamp(positiveInt(input.minute, 0), 0, 59),
  type: ['photo', 'journal', 'random'].includes(input.type) ? input.type : 'random'
});

function migrateDailyReminders(rawSettings = {}) {
  if (Array.isArray(rawSettings.dailyReminders) && rawSettings.dailyReminders.length) {
    return rawSettings.dailyReminders.map(makeReminder);
  }
  if (rawSettings.dailyReminderEnabled === true) {
    return [makeReminder({ hour: rawSettings.dailyReminderHour, minute: rawSettings.dailyReminderMinute, type: 'journal' })];
  }
  return [];
}
const isLocalImage = value => /^(?:data:image\/(?:jpeg|png|webp);base64,|mine-media:\/\/|mine-browser-media:\/\/)/.test(String(value || ''));

const normalizeStringArray = (value, maxItems = 8, maxLen = 24) => Array.isArray(value)
  ? [...new Set(value.map(item => String(item || '').trim().slice(0, maxLen)).filter(Boolean))].slice(0, maxItems)
  : [];

const SNIPPET_PHOTO_LIMIT = 100;

const normalizeSnippetPhotos = (photos, legacyPhoto) => {
  const list = Array.isArray(photos)
    ? [...new Set(photos.map(item => isLocalImage(item) ? String(item) : '').filter(Boolean))]
    : [];
  if (!list.length) {
    const fallback = isLocalImage(legacyPhoto) ? String(legacyPhoto) : '';
    if (fallback) list.push(fallback);
  }
  return list.slice(0, SNIPPET_PHOTO_LIMIT);
};

const normalizeNavTabs = (rawTabs) => {
  const valid = new Set([...DEFAULT_NAV_ROUTES, ...MORE_NAV_ROUTES]);
  const defaults = makeDefaultNavTabs();
  if (!Array.isArray(rawTabs) || !rawTabs.length) return defaults;
  const seen = new Set();
  const tabs = [];
  rawTabs.forEach(item => {
    const route = String(item?.route || '');
    if (!valid.has(route) || seen.has(route)) return;
    seen.add(route);
    tabs.push({
      route,
      visible: route === 'today' ? true : item.visible !== false,
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : tabs.length
    });
  });
  // 只输出底部 4 主 Tab（more 类路由固定在我的页内，不参与底部导航）
  const mainTabs = tabs.filter(item => DEFAULT_NAV_ROUTES.includes(item.route));
  DEFAULT_NAV_ROUTES.forEach(route => {
    if (!seen.has(route)) {
      mainTabs.push({ route, visible: true, order: mainTabs.length });
      seen.add(route);
    }
  });
  return mainTabs.sort((a, b) => a.order - b.order).map((item, index) => ({ ...item, order: index }));
};
