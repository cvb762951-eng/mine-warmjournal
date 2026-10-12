/**
 * 探针：待办弹出层里的勾选图标，实际渲染成「字形」还是「字面文字」。
 *
 * 背景（2026-10-12 真机乱码）：styles.css 里 `.modal button { font: inherit }` 的优先级是
 * (0,1,1)，高于 `.material-symbols-outlined` (0,1,0)。把图标类直接挂在弹层里的 <button> 上时，
 * 图标字体会被这条规则刷掉，字形退化成字面文字 "radio_button_unchecked"，且宽度撑开压到标题上。
 * 正确写法：图标放在按钮内部的 <span class="material-symbols-outlined">（span 不受那条规则影响）。
 *
 * 前置（在项目根目录）：
 *   python -m http.server 8772 --bind 127.0.0.1
 *   chrome --headless=new --remote-debugging-port=9223 --window-size=460,900 --hide-scrollbars \
 *          --user-data-dir=<临时目录> about:blank
 * 运行（改了 CSS 先跑 build-web.mjs）：
 *   node tests/probe-todo-icon.mjs
 */
const APP = 'http://127.0.0.1:8772/www/index.html';
const DEBUG_PORT = process.env.CDP_PORT || 9223;

const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then(r => r.json());
const page = targets.find(t => t.type === 'page' && /^https?:/.test(t.url)) || targets.find(t => t.type === 'page');
if (!page) throw new Error('没有可用的 page target');
const socket = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
socket.onmessage = event => {
  const m = JSON.parse(event.data);
  if (!m.id || !pending.has(m.id)) return;
  pending.get(m.id)(m.result);
  pending.delete(m.id);
};
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const call = (method, params = {}) => new Promise(resolve => {
  const id = ++seq;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, awaitPromise = true) => {
  const r = await call('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
  return r?.result?.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

await call('Page.enable');
await call('Runtime.enable');
await call('Page.navigate', { url: APP });
await sleep(2600);

// 1) 塞一条今天的待办（存储形状未知，先探一下）
const prepared = await evaluate(`(() => {
  const key = Object.keys(localStorage).find(k => k.includes('mine-warmjournal'));
  const dump = { keys: Object.keys(localStorage), key };
  const today = new Date();
  const pad = n => String(n).padStart(2, '0');
  const day = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
  const todo = { id: 'probe-todo', title: '探针待办', date: day, completed: false, createdAt: Date.now() };
  const raw = key ? localStorage.getItem(key) : null;
  const parsed = raw ? JSON.parse(raw) : null;
  if (parsed && Array.isArray(parsed.todos)) {
    parsed.todos = [todo];
    localStorage.setItem(key, JSON.stringify(parsed));
    dump.shape = 'single-state';
  } else {
    let sectionKey = null;
    for (const k of Object.keys(localStorage)) {
      try { const v = JSON.parse(localStorage.getItem(k)); if (Array.isArray(v) && v.length && v[0] && 'title' in v[0]) { sectionKey = k; break; } } catch {}
    }
    if (sectionKey) { localStorage.setItem(sectionKey, JSON.stringify([todo])); dump.shape = 'per-section'; dump.sectionKey = sectionKey; }
    else dump.shape = 'unknown';
  }
  return dump;
})()`);
console.log('存储探测：', JSON.stringify(prepared));

await call('Page.navigate', { url: APP });
await sleep(2600);

// 2) 打开待办弹层
const opened = await evaluate(`(async () => {
  const btn = document.querySelector('#open-todo-manager');
  if (!btn) return 'no-button';
  btn.click();
  await new Promise(r => setTimeout(r, 700));
  return document.querySelector('.todo-manager-modal') ? 'ok' : 'no-modal';
})()`);
console.log('打开弹层：', opened);

// 3) 量一下：图标元素的计算字体 / 渲染宽度；同时放一个「旧写法」按钮做对照
const measured = await evaluate(`(() => {
  const row = document.querySelector('.todo-manager-modal .daily-task-row');
  if (!row) return { error: '弹层里没有待办行' };
  const checkBtn = row.querySelector('.daily-task-check');
  const glyph = checkBtn?.querySelector('.material-symbols-outlined');
  const modal = document.querySelector('.todo-manager-modal');

  // 对照组：把图标类直接挂在按钮上（旧的错误写法）
  const ctrl = document.createElement('button');
  ctrl.className = 'daily-task-check material-symbols-outlined';
  ctrl.textContent = 'radio_button_unchecked';
  ctrl.id = 'probe-legacy-icon';
  modal.appendChild(ctrl);

  const info = el => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return { font: cs.fontFamily, width: Math.round(box.width), text: (el.textContent || '').trim() };
  };
  const expected = 'Material Symbols Outlined';
  const now = { button: info(checkBtn), glyph: info(glyph) };
  const legacy = info(ctrl);
  ctrl.remove();
  return {
    now,
    legacy,
    nowOk: Boolean(now.glyph && now.glyph.font.includes(expected) && now.glyph.width <= 44),
    legacyBroken: Boolean(legacy && !legacy.font.includes(expected))
  };
})()`);
console.log('测量结果：', JSON.stringify(measured, null, 2));

const shot = await call('Page.captureScreenshot', { format: 'png' });
if (shot?.data) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile('probe-todo-icon.png', Buffer.from(shot.data, 'base64'));
  console.log('截图已存：probe-todo-icon.png');
}

console.log('');
console.log(measured.nowOk ? '✅ 现在这条待办的勾是「字形」（字体正确、宽度未撑开）' : '❌ 现在这条待办的勾仍有问题');
console.log(measured.legacyBroken ? '✅ 对照组成立：图标挂在按钮上时字体确实被 .modal button{font:inherit} 刷掉（这就是乱码的根因）' : '⚠️ 对照组未复现，需重新判断根因');
socket.close();
