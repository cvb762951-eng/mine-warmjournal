/**
 * 清简主题「圆角与层次」体检：找出那些"有可见底/描边、但是直角或圆角过小"的元素。
 *
 * 用户反馈「棱角太僵硬死板」时，靠肉眼一个个翻页面太慢，这里一次扫完：
 *   · square     —— 有可见底色或描边，圆角 < 8px（纯粹的直角块）
 *   · tight      —— 圆角 8–13px，对一块有面积的卡片来说偏硬
 *   · flat       —— 有面积、有底色，但既没有阴影也没有描边（一片死平，没有层次）
 *
 * 沉浸式暗环境与图片类元素不参与判断。
 * 前置与 tests/capture-plain-blue.mjs 相同。
 * 用法：node tests/audit-plain-roundness.mjs [主题名]
 */
import { readFile } from 'node:fs/promises';

const theme = process.argv[2] || 'plain';
const HARNESS = 'http://127.0.0.1:8772/tests/plain-theme-harness.html';
const FW = 'document.querySelectorAll("iframe")';
const FIXTURE_PHOTO = (await readFile(new URL('./fixtures-photo.b64', import.meta.url), 'utf8')).trim();

const STEPS = [
  { name: '今日', click: `` },
  { name: '专注', click: `d.querySelector('[data-func-action="focus"]')?.click()` },
  { name: '复盘统计', click: `d.querySelector('[data-func-action="statistics"]')?.click()` },
  { name: '书影音', click: `d.querySelector('[data-func-action="library"]')?.click()` },
  { name: '随手拍', click: `d.querySelector('#dock-btn-snippets')?.click()` },
  { name: '日记', click: `d.querySelector('#dock-btn-journal')?.click()` },
  { name: '日历', click: `d.querySelector('#dock-btn-calendar')?.click()` },
  { name: '账本', click: `d.querySelector('#dock-btn-ledger')?.click()` },
  { name: '我的', click: `d.querySelector('[data-func-action="mine"]')?.click()` },
  { name: '倒数日', click: `(d.querySelector('[data-open-countdown]') || d.querySelector('#open-countdown-banner'))?.click()` },
  { name: '习惯档案(二级页)', click: `d.querySelector('#open-habit-detail-today')?.click()` },
  { name: '课程表(二级页)', click: `d.querySelector('#open-timetable')?.click()` }
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

await evaluate(`(() => {
  const w = ${FW}[0].contentWindow; const KEY = 'mine-warmjournal-state-v1';
  const raw = JSON.parse(w.localStorage.getItem(KEY) || '{}'); const s = raw.state || raw;
  s.settings = Object.assign({}, s.settings, { theme: ${JSON.stringify(theme)} });
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const key = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  const photo = 'data:image/png;base64,${FIXTURE_PHOTO}';
  const mk = (n, day) => ({ id: 'seed-' + n, type: 'photo', date: key, text: '第 ' + n + ' 条随手拍', photo, tags: ['日常生活'], createdAt: Date.now() - day * 86400e3, updatedAt: Date.now() - day * 86400e3 });
  s.snippets = [mk(1, 0), mk(2, 0), mk(3, 1), mk(4, 3)];
  s.habits = (s.habits && s.habits.length ? s.habits : []).concat([
    { id: 'seed-h2', name: '数学刷题', icon: 'calculate', target: 5, unit: '题', repeat: 'daily', archived: false, createdAt: Date.now(), updatedAt: Date.now() }
  ]);
  s.countdowns = [{ id: 'seed-c1', title: '考研初试', date: '2027-12-18', createdAt: Date.now(), updatedAt: Date.now() }];
  s.media = [{ id: 'seed-m1', type: 'movie', title: '海上钢琴师', status: 'completed', completedDate: key, rating: 5, notes: '值得重看', poster: photo, createdAt: Date.now(), updatedAt: Date.now() }];
  s.tasteEntries = [{ id: 'seed-t1', type: 'dish', name: '楼下牛肉面', placeName: '老巷口', brand: '', date: key, rating: 5, verdict: 'again', photos: [photo], createdAt: Date.now(), updatedAt: Date.now() }];
  s.transactions = [{ id: 'seed-l1', type: 'expense', amount: 24.5, category: '餐饮', note: '午饭', date: key, createdAt: Date.now(), updatedAt: Date.now() }];
  w.localStorage.setItem(KEY, JSON.stringify(s));
})()`);

const AUDIT = String.raw`(() => {
  const w = document.querySelector('iframe').contentWindow;
  const d = w.document;
  const IMMERSIVE = '.photo-viewer,.vault-photo-viewer,.warm-video-wrap,.warm-video-stage,.private-vault-view,.password-vault-view,.immersive-clock-screen,.ai-chat-panel,.material-symbols-outlined';
  const px = v => { const n = parseFloat(v) || 0; return Number.isFinite(n) ? n : 0; };
  const out = [];
  d.querySelectorAll('body *').forEach(el => {
    if (el.closest(IMMERSIVE)) return;
    if (['IMG', 'SVG', 'PATH', 'CANVAS', 'VIDEO', 'INPUT', 'BR', 'HR'].includes(el.tagName) && el.tagName !== 'INPUT') return;
    const cs = w.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 24) return;
    const bg = cs.backgroundColor;
    const m = String(bg).match(/rgba?\(([^)]+)\)/);
    const parts = m ? m[1].split(',').map(Number) : null;
    const visibleBg = parts && (parts.length < 4 || parts[3] > 0.35);
    const visibleBorder = px(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
    if (!visibleBg && !visibleBorder) return;
    if (cs.backgroundImage && cs.backgroundImage.includes('gradient') && cs.backgroundImage.includes('rgb')) {
      // 有渐变底的也算"可见面"
    } else if (!visibleBg && !visibleBorder) return;

    const radius = Math.min(...['borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius']
      .map(k => parseFloat(cs[k]) || 0));
    const hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
    const sel = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
      + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    const size = Math.round(r.width) + 'x' + Math.round(r.height);
    if (radius < 1) out.push({ kind: 'square', sel, size, extra: 'bg=' + String(bg) });
    else if (radius < 8) out.push({ kind: 'tight', sel, size, extra: 'radius=' + radius + 'px' });
    if (radius >= 1 && r.width >= 120 && r.height >= 44 && !hasShadow) out.push({ kind: 'flat', sel, size, extra: 'radius=' + radius + ' 无阴影' });
  });
  const seen = new Set();
  return out.filter(x => { const k = x.kind + x.sel; if (seen.has(k)) return false; seen.add(k); return true; });
})()`;

const seen = new Set();
const all = [];
for (const step of STEPS) {
  await evaluate(`${FW}[0].contentWindow.location.reload()`);
  await wait(1600);
  await evaluate(`(() => { const d = ${FW}[0].contentWindow.document; ${step.click}; })()`);
  await wait(800);
  const rows = await evaluate(AUDIT);
  for (const x of rows) {
    const key = x.kind + x.sel;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push({ ...x, route: step.name });
  }
}
for (const kind of ['square', 'tight', 'flat']) {
  const rows = all.filter(x => x.kind === kind);
  const title = { square: '直角块（圆角 < 1px）', tight: '圆角偏小（< 8px）', flat: '有面积但无阴影（缺层次）' }[kind];
  console.log('\n=== ' + title + ' (' + rows.length + ') ===');
  rows.forEach(x => console.log(' [' + x.route + '] ' + x.sel + '  ' + x.size + '  ' + x.extra));
}
socket.close();
