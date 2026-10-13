/**
 * 探针：二级页按钮点按会不会被「右滑返回」吞掉（#56 的真机问题）。
 *
 * 背景（2026-10-13）：真机上二级页左半边的按钮经常点了没反应。
 * 根因是右滑返回「按下即跟踪」——手指在左侧 60% 区按下后只要横向漂十几像素，
 * 手势就接管并在松手时吞掉这次点击。真机点按时手指微滑很常见，所以左半边按钮常点不动。
 *
 * 判定方式：click 被吞的唯一原因是手势接管（layer 被平移）。
 * 所以在页面里合成 pointerdown → pointermove(横向漂移) ，读二级页的位移：
 *   位移 > 1px  ⇒ 手势接管了 ⇒ 这次点击会被吞
 *   位移 ≈ 0    ⇒ 没接管    ⇒ 点击正常
 * 合成 PointerEvent 不会让浏览器生成 click，所以测的时候不会真的点到按钮（安全）。
 *
 * 可选端到端抽查（REAL=1）：用 CDP 真触摸事件测左侧前几个按钮，确认 click 确实到达。
 * ⚠️ 真触摸会很快耗尽 headless 实例的调试通道，所以只抽查少量；跑完请重启 Chrome。
 *
 * 前置（在项目根目录）：
 *   python -m http.server 8772 --bind 127.0.0.1
 *   chrome --headless=new --remote-debugging-port=9223 --window-size=430,900 --hide-scrollbars \
 *          --user-data-dir=<临时目录> about:blank
 * 运行（改了 CSS / JS 先跑 build-web.mjs）：
 *   node tests/probe-swipeback-tap.mjs
 *   DRIFT=8 REAL=1 node tests/probe-swipeback-tap.mjs
 */
const APP = 'http://127.0.0.1:8772/www/index.html';
const DEBUG_PORT = process.env.CDP_PORT || 9223;
const DRIFT = Number(process.env.DRIFT || 13);
const REAL = process.env.REAL === '1';
const PAGE_ID = process.env.PAGE_ID || 'subpage-timetable';
const ENTRY = process.env.ENTRY || '#open-timetable';
const ROUTE = process.env.ROUTE || 'today';

const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then(r => r.json());
const page = list.find(t => t.type === 'page' && /^https?:/.test(t.url)) || list.find(t => t.type === 'page');
if (!page) throw new Error('没有可用的页面 target');
const socket = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
socket.onmessage = e => {
  try {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  } catch { /* 忽略无法解析的消息 */ }
};
await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
const call = (method, params = {}, ms = 8000) => new Promise(res => {
  const id = ++seq;
  pending.set(id, res);
  socket.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); res({ __timeout: true }); } }, ms);
});
const evaluate = async expr => {
  const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r?.__timeout) return '__TIMEOUT__';
  const ex = r?.result?.exceptionDetails;
  if (ex) console.log('[页面内异常]', String(ex.exception?.description || JSON.stringify(ex)).slice(0, 400));
  return r?.result?.result?.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

await call('Page.enable');
await call('Runtime.enable');
await call('Network.enable');
await call('Network.setCacheDisabled', { cacheDisabled: true });   // 防止量到缓存里的旧脚本
await call('Page.navigate', { url: APP }, 20000);
await sleep(3000);

// ⚠️ 右滑返回这套动效只在清简主题生效；默认是米白主题，不切过去量到的是「根本没装」，会得出假结论
const THEME = process.env.THEME || 'plain';
const SEED = process.env.SEED === '1';   // 有些页面（如习惯详情）需要先有数据才进得去
const seeded = await evaluate(`(() => {
  const k = 'mine-warmjournal-state-v1';
  const s = JSON.parse(localStorage.getItem(k) || '{}');
  s.settings = { ...(s.settings || {}), theme: ${JSON.stringify(THEME)} };
  ${SEED ? "s.habits = [{ id: 'probe-habit', name: '探针习惯', emoji: '🌱', tracking: 'check', unit: '次', createdAt: Date.now(), archived: false }];" : ''}
  localStorage.setItem(k, JSON.stringify(s));
  return { theme: s.settings.theme, habits: (s.habits || []).length };
})()`);
console.log('[注入] 主题', seeded?.theme, '｜习惯数', seeded?.habits);
await call('Page.navigate', { url: APP }, 20000);
await sleep(3200);
console.log('[环境] 主题 data-theme =', await evaluate("document.documentElement.dataset.theme"),
  '｜动效档位 data-pl-motion =', await evaluate("document.documentElement.dataset.plMotion || '(未设置，可能是 classic)'"));

console.log('[连通性] 页面标题：', await evaluate('document.title'), '｜DOMMatrixReadOnly:', await evaluate("typeof DOMMatrixReadOnly"), '｜PointerEvent:', await evaluate("typeof PointerEvent"));

await evaluate(`(() => {
  if (!window.__tapProbe) {
    window.__tapProbe = { log: [] };
    document.addEventListener('click', e => {
      const b = e.target.closest?.('button');
      if (b?.dataset.probeId) window.__tapProbe.log.push(b.dataset.probeId);
    }, true);
  }
  window.__tapProbe.log = [];
  return 'ok';
})()`);

async function enterPage() {
  await evaluate(`(() => {
    document.querySelectorAll('.subpage-layer.active').forEach(layer => {
      const b = layer.querySelector('.subpage-back-btn, [data-subpage-close]');
      if (b) b.click();
    });
    document.querySelector('[data-route="${ROUTE}"]')?.click();
  })()`);
  await sleep(1000);
  await evaluate(`(() => { const b = document.querySelector('${ENTRY}'); if (b) { b.scrollIntoView({ block: 'center' }); b.click(); } })()`);
  await sleep(900);
  return evaluate(`document.querySelector('.subpage-layer.active')?.id || 'none'`);
}

// ---- 进入目标二级页，再取数 ----
const enter = await enterPage();
if (enter !== PAGE_ID) { console.log(`没能进入 ${PAGE_ID}（当前 ${enter}），退出`); socket.close(); process.exit(1); }

// ---- 阶段 1：页面内合成 pointer，量「手势有没有在按钮上接管」 ----
const sweep = await evaluate(`(async () => {
  const DRIFT = ${DRIFT};
  const layer = document.querySelector('.subpage-layer.active');
  if (!layer) return { error: 'no-layer' };
  const readX = () => {
    const t = getComputedStyle(layer).transform;
    if (!t || t === 'none') return 0;
    try { return new DOMMatrixReadOnly(t).m41; } catch { return 0; }
  };
  const btns = [...layer.querySelectorAll('button')].filter(b => {
    const bb = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    return bb.width >= 8 && bb.height >= 8 && cs.visibility !== 'hidden' && cs.display !== 'none';
  });
  const out = [];
  for (const b of btns) {
    const bb = b.getBoundingClientRect();
    const cx = bb.left + bb.width / 2, cy = bb.top + bb.height / 2;
    const base = { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'touch', isPrimary: true, buttons: 1 };
    const before = readX();
    b.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: cx, clientY: cy }));
    for (let k = 1; k <= 4; k += 1) {
      b.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: cx + DRIFT * k / 4, clientY: cy }));
      // ⚠️ 不能用 requestAnimationFrame：headless 下页面被判定不可见时 rAF 不触发，会把 evaluate 挂死
      await new Promise(r => setTimeout(r, 24));
    }
    const after = readX();
    b.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: cx + DRIFT, clientY: cy, buttons: 0 }));
    await new Promise(r => setTimeout(r, 120));   // 等这一次手势彻底收尾，避免残留位移影响下一个读数
    out.push({
      text: (b.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 16) || '(无文字)',
      cls: String(b.className || '').split(' ')[0],
      left: Math.round(bb.left),
      x: Math.round(cx),
      moved: Math.round((after - before) * 10) / 10
    });
  }
  return { vw: innerWidth, out };
})()`);

if (!sweep || sweep === '__TIMEOUT__' || sweep.error) {
  console.log('阶段 1 取数失败：', sweep === '__TIMEOUT__' ? '调试通道无响应，重启 Chrome 再试' : JSON.stringify(sweep));
  socket.close();
  process.exit(1);
}

const pageRatio = 0.6;
console.log(`二级页 ${PAGE_ID}｜视口宽 ${sweep.vw}px｜起手区 = 左缘 24px 与左侧 ${Math.round(sweep.vw * pageRatio)}px（60%）`);
console.log(`对每个按钮模拟「按下 → 横向漂移 ${DRIFT}px」\n`);
console.log('按钮'.padEnd(18) + '类名'.padEnd(26) + '起手区'.padEnd(9) + '页面位移'.padEnd(10) + '结论');
console.log('-'.repeat(78));

let captured = 0;
let inZone = 0;
for (const r of sweep.out) {
  const zone = r.x <= 24 ? '边缘' : r.x < sweep.vw * pageRatio ? '页面区' : '不在区';
  const hit = Math.abs(r.moved) > 1;
  if (zone !== '不在区') { inZone += 1; if (hit) captured += 1; }
  const verdict = zone === '不在区' ? '本来不涉及' : hit ? '被手势接管 ✘' : '正常 ✔';
  console.log(r.text.padEnd(18) + r.cls.padEnd(26) + zone.padEnd(9) + `${r.moved}px`.padEnd(10) + verdict);
}
console.log('-'.repeat(78));
console.log(`起手区内的按钮：${inZone} 个；其中被手势接管的：${captured} 个`);
console.log(captured === 0
  ? '结论：起手区内的按钮点击不会被「右滑返回」吞掉 ✔'
  : '结论：有按钮会被右滑返回吞掉点击 ✘');

// ---- 附带验证：修好按钮之后，右滑返回本身还好用吗（不能为了点按钮把返回弄坏） ----
const edge = await evaluate(`(async () => {
  const layer = document.querySelector('.subpage-layer.active');
  if (!layer) return { error: 'no-layer' };
  const readX = () => {
    const t = getComputedStyle(layer).transform;
    if (!t || t === 'none') return 0;
    try { return new DOMMatrixReadOnly(t).m41; } catch { return 0; }
  };
  const y = Math.round(innerHeight / 2);
  const base = { bubbles: true, cancelable: true, composed: true, pointerId: 9, pointerType: 'touch', isPrimary: true, buttons: 1 };
  const start = readX();
  layer.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: 5, clientY: y }));
  for (let k = 1; k <= 5; k += 1) {
    layer.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: 5 + 90 * k / 5, clientY: y }));
    await new Promise(r => setTimeout(r, 24));
  }
  const mid = readX();
  for (let k = 1; k <= 4; k += 1) {          // 回拉让它回弹，不真的关掉页面
    layer.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: 95 - 80 * k / 4, clientY: y }));
    await new Promise(r => setTimeout(r, 24));
  }
  layer.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: 15, clientY: y, buttons: 0 }));
  await new Promise(r => setTimeout(r, 200));
  return { moved: Math.round((mid - start) * 10) / 10 };
})()`);
const edgeOk = edge && edge !== '__TIMEOUT__' && !edge.error && Math.abs(edge.moved) > 1;
console.log(`\n从屏幕左缘右滑（90px）：二级页位移 ${edge?.moved ?? '?'}px → ${edgeOk ? '返回手势仍然生效 ✔' : '返回手势没反应 ✘'}`);

// ---- 阶段 2（可选）：CDP 真触摸抽查，确认 click 确实到达 ----
if (REAL) {
  console.log('\n【端到端抽查：真触摸事件】');
  const lefties = sweep.out.filter(r => r.x < sweep.vw * pageRatio).slice(0, 4);
  for (let i = 0; i < lefties.length; i += 1) {
    const still = await evaluate(`document.querySelector('.subpage-layer.active')?.id || 'none'`);
    if (still !== PAGE_ID) { await enterPage(); }
    await evaluate(`window.__tapProbe.log = []`);
    const geo = await evaluate(`(() => {
      const layer = document.querySelector('.subpage-layer.active');
      const bs = [...layer.querySelectorAll('button')].filter(b => { const bb=b.getBoundingClientRect(); return bb.width>=8 && bb.height>=8; });
      const b = bs.find(x => (x.textContent||'').replace(/\\s+/g,' ').trim().slice(0,16) === ${JSON.stringify(lefties[i].text)});
      if (!b) return null;
      b.dataset.probeId = 'real';
      const bb = b.getBoundingClientRect();
      return { x: Math.round(bb.left + bb.width/2), y: Math.round(bb.top + bb.height/2) };
    })()`);
    if (!geo) { console.log(`  ${lefties[i].text}: 找不到按钮`); continue; }
    await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: geo.x, y: geo.y, id: 1 }] });
    await call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: geo.x + DRIFT, y: geo.y, id: 1 }] });
    await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(320);
    const got = await evaluate(`window.__tapProbe.log.includes('real')`);
    console.log(`  ${lefties[i].text}: ${got === true ? '收到点击 ✔' : got === false ? '没收到 ✘' : '取数失败 ?'}`);
  }
}
socket.close();
