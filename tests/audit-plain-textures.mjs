import { readFile } from 'node:fs/promises';
/**
 * 清简主题「素材残留」专项体检（全页面 + 主要弹窗）。
 *
 * 背景：清简主题的工作就是把原始主题的图片素材（纸纹/纸边/撕纸边遮罩）全部撤掉。
 * 生成器只扫描 styles.css / performance.css 两条链路并逐条匹配，漏一条，
 * 那个元素就继续用原始素材 —— 用户看到的就是"用着用着有一部分切回去了"。
 *
 * 本脚本直接查**真实渲染出来的 DOM**：凡是 background-image / border-image /
 * mask-image 里还指向 assets/ 的可见元素，一律报出来。
 *
 * 前置与 tests/capture-plain-blue.mjs 相同。
 * 用法：node tests/audit-plain-textures.mjs [主题名]
 */
const theme = process.argv[2] || 'plain';
const HARNESS = 'http://127.0.0.1:8772/tests/plain-theme-harness.html';
const FW = 'document.querySelectorAll("iframe")';
// 测试用的假照片（浅蓝渐变）。别内联写死 —— 之前用的是一张 1x1 纯红像素，
// 被 object-fit:cover 铺满整块后整张卡都是红的，看起来像「主题出问题」，
// 其实只是测试数据太假（2026-10-10 排查倒数日时被它误导过一次）。
const FIXTURE_PHOTO = (await readFile(new URL('./fixtures-photo.b64', import.meta.url), 'utf8')).trim();

/* 每一步 = 一次 App 冷启动后要点开的界面（App 每次打开都会回到「今日」） */
const STEPS = [
  { name: '今日', click: `` },
  { name: '专注', click: `d.querySelector('[data-func-action="focus"]')?.click()` },
  { name: '复盘统计', click: `d.querySelector('[data-func-action="statistics"]')?.click()` },
  { name: '书影音', click: `d.querySelector('[data-func-action="library"]')?.click()` },
  { name: '习惯档案(二级页)', click: `d.querySelector('#open-habit-detail-today')?.click()` },
  { name: '课程表(二级页)', click: `d.querySelector('#open-timetable')?.click()` },
  { name: '倒数日', click: `(d.querySelector('[data-open-countdown]') || d.querySelector('#open-countdown-banner'))?.click()` },
  { name: '随手拍', click: `d.querySelector('#dock-btn-snippets')?.click()` },
  { name: '日记', click: `d.querySelector('#dock-btn-journal')?.click()` },
  { name: '日历', click: `d.querySelector('#dock-btn-calendar')?.click()` },
  { name: '账本', click: `d.querySelector('#dock-btn-ledger')?.click()` },
  { name: '我的', click: `d.querySelector('[data-func-action="mine"]')?.click()` },
  { name: '我的·主题与外观弹窗', click: `d.querySelector('[data-func-action="mine"]')?.click(); d.querySelector('#settings-background')?.click()` },
  { name: '我的·AI设置弹窗', click: `d.querySelector('[data-func-action="mine"]')?.click(); d.querySelector('#settings-ai')?.click()` },
  { name: '我的·密码本', click: `d.querySelector('[data-func-action="mine"]')?.click(); d.querySelector('#settings-password-vault')?.click()` },
  { name: '我的·味觉档案', click: `d.querySelector('[data-func-action="mine"]')?.click(); d.querySelector('#open-taste-archive')?.click()` },
  { name: '随手拍弹窗', click: `d.querySelector('#btn-snap')?.click()` },
  { name: '随手记弹窗', click: `d.querySelector('#btn-memo')?.click()` },
  { name: '记一笔弹窗', click: `d.querySelector('#dock-btn-ledger')?.click(); d.querySelector('#new-transaction-head')?.click()` }
];

const targets = await fetch('http://127.0.0.1:9223/json').then(r => r.json());
const page = targets.find(t => t.type === 'page' && /^https?:/.test(t.url)) || targets.find(t => t.type === 'page');
if (!page) throw new Error('no page target');
const socket = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
socket.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
const call = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); socket.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => {
  const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const wait = ms => new Promise(r => setTimeout(r, ms));

await call('Page.enable');
await call('Runtime.enable');
await call('Network.enable');
await call('Network.setCacheDisabled', { cacheDisabled: true });
await call('Network.clearBrowserCache');
await call('Page.navigate', { url: HARNESS });
await wait(3200);

/* 灌一份"有内容的"数据再查。
   ⚠️ 空数据只会渲染出空状态，很多带素材的元素（照片墙、拍立得、媒体海报、味觉照片）
      根本不会出现 —— 那样查出来的"0 残留"是假的。 */
await evaluate(`(() => {
  const w = ${FW}[0].contentWindow;
  const KEY = 'mine-warmjournal-state-v1';
  const raw = JSON.parse(w.localStorage.getItem(KEY) || '{}');
  const s = raw.state || raw;
  s.settings = Object.assign({}, s.settings, { theme: ${JSON.stringify(theme)} });
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const key = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + d.getDate();
  const photo = 'data:image/png;base64,${FIXTURE_PHOTO}';
  const mk = (n, day) => ({ id: 'seed-' + n, type: 'photo', date: key, text: '第 ' + n + ' 条随手拍', photo, tags: ['日常生活'], createdAt: Date.now() - day * 86400e3, updatedAt: Date.now() - day * 86400e3 });
  s.snippets = [mk(1, 0), mk(2, 0), mk(3, 1), mk(4, 2), mk(5, 5)];
  s.journals = s.journals || {};
  s.journals[key] = { content: '今天把复习计划推进了一节，晚上去江边走了走。', mood: 'calm', weather: 'sunny', photos: [photo, photo], updatedAt: Date.now() };
  s.habits = (s.habits && s.habits.length ? s.habits : [
    { id: 'seed-h1', name: '背单词', icon: 'menu_book', target: 30, unit: '个', repeat: 'daily', archived: false, createdAt: Date.now(), updatedAt: Date.now() }
  ]).concat([
    { id: 'seed-h2', name: '数学刷题', icon: 'calculate', target: 5, unit: '题', repeat: 'daily', archived: false, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'seed-h3', name: '跑步', icon: 'fitness_center', target: 3, unit: '公里', repeat: 'weekly', archived: false, createdAt: Date.now(), updatedAt: Date.now() }
  ]);
  s.media = [
    { id: 'seed-m1', type: 'movie', title: '海上钢琴师', status: 'completed', completedDate: key, rating: 5, notes: '值得重看', poster: photo, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'seed-m2', type: 'book', title: '人类简史', status: 'in_progress', rating: 0, notes: '', poster: photo, createdAt: Date.now(), updatedAt: Date.now() }
  ];
  s.tasteEntries = [
    { id: 'seed-t1', type: 'dish', name: '楼下牛肉面', placeName: '老巷口', brand: '', date: key, rating: 5, verdict: 'again', photos: [photo], createdAt: Date.now(), updatedAt: Date.now() }
  ];
  s.countdowns = [
    { id: 'seed-c1', title: '考研初试', date: '2027-12-18', createdAt: Date.now(), updatedAt: Date.now() }
  ];
  s.transactions = [
    { id: 'seed-l1', type: 'expense', amount: 24.5, category: '餐饮', note: '午饭', date: key, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'seed-l2', type: 'income', amount: 800, category: '兼职工资', note: '', date: key, createdAt: Date.now(), updatedAt: Date.now() }
  ];
  w.localStorage.setItem(KEY, JSON.stringify(s));
})()`);

const AUDIT = String.raw`(() => {
  const w = frames && frames[0] ? frames[0] : document.querySelector('iframe').contentWindow;
  const d = w.document;
  const out = [];
  /* ⚠️ 伪元素（::before / ::after）必须单独查：getComputedStyle(el) 看不到它们，
     而纸纹、纸边、胶带、撕边这类装饰素材大量挂在伪元素上。 */
  const PSEUDOS = ['', '::before', '::after'];
  d.querySelectorAll('body *').forEach(el => {
    PSEUDOS.forEach(pseudo => {
      const cs = w.getComputedStyle(el, pseudo);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return;
      if (pseudo) {
        const c = cs.content;
        if (!c || c === 'none' || c === 'normal') return;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return;
      const props = {
        'background-image': cs.backgroundImage,
        'border-image-source': cs.borderImageSource,
        'mask-image': cs.maskImage || cs.webkitMaskImage,
        'content': /url\(/.test(cs.content) ? cs.content : '',
        'list-style-image': cs.listStyleImage
      };
      for (const [prop, value] of Object.entries(props)) {
        if (!value || value === 'none') continue;
        const urls = String(value).match(/assets\/[^'")\s]+/g) || [];
        if (!urls.length) continue;
        out.push({
          pseudo, prop, files: [...new Set(urls)].join(','),
          sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
          size: Math.round(r.width) + 'x' + Math.round(r.height),
          text: (el.textContent || '').trim().slice(0, 20)
        });
      }
    });
  });
  const seen = new Set();
  return out.filter(x => { const k = x.pseudo + x.prop + x.sel + x.files; if (seen.has(k)) return false; seen.add(k); return true; });
})()`;

const seen = new Set();
for (const step of STEPS) {
  await evaluate(`${FW}[0].contentWindow.location.reload()`);
  await wait(1600);
  await evaluate(`(() => { const d = ${FW}[0].contentWindow.document; ${step.click}; })()`);
  await wait(800);
  const rows = await evaluate(AUDIT);
  rows.forEach(x => {
    const key = x.pseudo + x.prop + x.sel + x.files;
    if (seen.has(key)) return;
    seen.add(key);
    console.log('[' + step.name + '] ' + (x.pseudo || '(元素)') + ' ' + x.prop + '  ' + x.sel + '  [' + x.size + ']  ' + x.files + '  «' + x.text + '»');
  });
}
console.log('\n合计 ' + seen.size + ' 处残留');
socket.close();
