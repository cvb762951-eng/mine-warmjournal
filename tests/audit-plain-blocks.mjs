/**
 * 清简主题体检：把「浅色主题里不该有的东西」自动扫出来。
 *   dark  —— 背景很深的整块（浅色主题里就是"黑洞"）
 *   faint —— 文字与它实际衬托的底色对比度过低（等于看不见）
 *   warm  —— 浅底上的暖色文字（砖红/暖褐/铜金，冷色主题里的残留）
 *
 * 沉浸式暗环境（全屏看图/看视频/私密空间/专注全屏时钟）属刻意设计，排除。
 * 前置与 tests/capture-plain-blue.mjs 相同。
 * 用法：node tests/audit-plain-blocks.mjs [主题名]
 */
const theme = process.argv[2] || 'plain';
const HARNESS = 'http://127.0.0.1:8772/tests/plain-theme-harness.html';
const FW = 'document.querySelectorAll("iframe")';

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
// ⚠️ 必须关缓存：stylesheet 的 URL 带的是固定版本号，改了源文件后浏览器会拿旧副本，
//    表现为「明明改了 CSS，截图里却没生效」（踩过两次）。
await call('Network.enable');
await call('Network.setCacheDisabled', { cacheDisabled: true });
await call('Network.clearBrowserCache');
await call('Page.navigate', { url: HARNESS });
await wait(3200);

await evaluate(`(() => {
  const w = ${FW}[0].contentWindow;
  const raw = JSON.parse(w.localStorage.getItem('mine-warmjournal-state-v1') || '{}');
  const s = raw.state || raw;
  s.settings = Object.assign({}, s.settings, { theme: ${JSON.stringify(theme)} });
  w.localStorage.setItem('mine-warmjournal-state-v1', JSON.stringify(s));
})()`);

const ROUTES = ['today', 'snippets', 'journal', 'ledger', 'calendar', 'mine'];
const frames = await evaluate(`${FW}.length`);
for (let i = 0; i < frames; i += 1) {
  const route = ROUTES[i] || 'today';
  await evaluate(`${FW}[${i}].contentWindow.location.reload()`);
  await wait(1500);
  await evaluate(`(() => {
    const d = ${FW}[${i}].contentWindow.document;
    const el = d.querySelector('#dock-btn-${route}');
    if (el) el.click();
    else { const qa = d.querySelector('[data-func-action="${route}"]'); if (qa) qa.click(); }
  })()`);
  await wait(600);
}

const AUDIT = String.raw`(() => {
  const IMMERSIVE = '.photo-viewer,.vault-photo-viewer,.warm-video-wrap,.warm-video-stage,.private-vault-view,.password-vault-view,.immersive-clock-screen,.ai-chat-panel';
  const parse = c => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const luma = c => c ? (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255 : null;
  const rel = v => { const x = v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); return x; };
  const contrast = (a, b) => { const l1 = rel(Math.max(a, b)), l2 = rel(Math.min(a, b)); return (l1 + 0.05) / (l2 + 0.05); };
  const label = el => el.tagName.toLowerCase()
    + (el.id ? '#' + el.id : '')
    + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');

  const out = [];
  document.querySelectorAll('iframe').forEach((f, fi) => {
    const w = f.contentWindow, d = w.document;
    if (!d.body) return;
    const route = (d.querySelector('.view') || {}).className || '?';
    d.querySelectorAll('body *').forEach(el => {
      if (el.closest(IMMERSIVE)) return;
      if (['IMG', 'SVG', 'PATH', 'CANVAS', 'VIDEO'].includes(el.tagName)) return;
      const cs = w.getComputedStyle(el);
      // 不可见的元素不算问题（弹窗遮罩闲置时就是一层深色，但 opacity 为 0）
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return;
      const own = parse(cs.backgroundColor);
      const opaque = own && own.a > 0.62;
      const r = el.getBoundingClientRect();
      const text = (el.textContent || '').trim();

      // 1) 深色块
      if (opaque && r.width >= 60 && r.height >= 26 && r.width * r.height >= 2600) {
        const L = luma(own);
        if (L < 0.46) out.push({ kind: 'dark', route, sel: label(el), bg: L.toFixed(2), text: text.slice(0, 24) });
        // 1b) 暖色浅底块：冷色主题里的一块米黄/奶咖，肉眼非常跳
        //     （只查"暖色文字"是不够的 —— 今日页那条米黄倒数日横幅就是这么漏掉的）
        if (L > 0.66 && (own.r - own.b) > 16) {
          out.push({ kind: 'warmblock', route, sel: label(el), color: 'rgb(' + [own.r, own.g, own.b].join(',') + ')', size: Math.round(r.width) + 'x' + Math.round(r.height), text: text.slice(0, 24) });
        }
      }

      // 2)/3) 只看叶子文字节点；它"实际衬托的底色"取最近的有底色祖先
      if (text && el.children.length === 0) {
        const fg = parse(cs.color);
        if (fg) {
          let node = el, bgc = null;
          while (node && node !== d.documentElement) {
            const ncs = w.getComputedStyle(node);
            const c = parse(ncs.backgroundColor);
            if (c && c.a > 0.62) { bgc = c; break; }
            // 渐变底：backgroundColor 是透明的，但视觉上是有底的 —— 取渐变里第一个色
            if (/gradient/.test(ncs.backgroundImage)) {
              const g = parse((ncs.backgroundImage.match(/rgba?\([^)]+\)/) || [])[0] || '');
              if (g) { bgc = g; break; }
            }
            node = node.parentElement;
          }
          if (bgc) {
            const ratio = contrast(luma(fg), luma(bgc));
            if (ratio < 1.9) out.push({ kind: 'faint', route, sel: label(el), bg: luma(bgc).toFixed(2), ratio: ratio.toFixed(2), text: text.slice(0, 24) });
            const warm = (fg.r - fg.b) > 34 && !(fg.r > 200 && fg.g > 200 && fg.b > 200);
            if (warm && luma(bgc) > 0.72) out.push({ kind: 'warm', route, sel: label(el), color: cs.color, bg: 'rgb(' + [bgc.r, bgc.g, bgc.b].join(',') + ')', text: text.slice(0, 26) });
          }
        }
      }
    });
  });
  const seen = new Set();
  return out.filter(x => { const k = x.kind + x.sel + x.text; if (seen.has(k)) return false; seen.add(k); return true; });
})()`;

const report = await evaluate(AUDIT);
for (const kind of ['dark', 'warmblock', 'faint', 'warm']) {
  const rows = report.filter(x => x.kind === kind);
  const title = { dark: '深色块', warmblock: '暖色浅底块', faint: '浅底浅字', warm: '浅底暖色文字' }[kind];
  console.log('=== ' + title + ' (' + rows.length + ') ===');
  rows.forEach(x => {
    const extra = kind === 'warmblock' ? x.color + ' ' + x.size : (kind === 'warm' ? x.color + ' on ' + x.bg : 'bg=' + x.bg + (x.ratio ? ' 对比=' + x.ratio : ''));
    console.log(' [' + x.route + '] ' + x.sel + '  ' + extra + '  «' + x.text + '»');
  });
}
socket.close();
