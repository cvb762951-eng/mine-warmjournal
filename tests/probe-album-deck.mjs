/**
 * 探针：图集层（随手拍点「查看照片」进去那层）改成一叠牌之后，布局与手势是否真的对。
 *
 * 目的（2026-10-12）：这条改动动的是布局 + 手势，静态测试看不出「牌是不是铺满、能不能拖动」，
 * 所以在无头 Chrome 里把界面真跑起来量一遍：
 *   ① 一叠三张、深度位移正确；② 顶牌铺满 stage；③ 左右拖能翻下一张；④ 轻触能开大图。
 *
 * 前置（在项目根目录）：
 *   python -m http.server 8772 --bind 127.0.0.1
 *   chrome --headless=new --remote-debugging-port=9223 --window-size=460,900 --hide-scrollbars \
 *          --user-data-dir=<临时目录> about:blank
 * 运行（改了 CSS / JS 先跑 build-web.mjs）：
 *   node tests/probe-album-deck.mjs
 */
const APP = 'http://127.0.0.1:8772/www/index.html';
const DEBUG_PORT = process.env.CDP_PORT || 9223;
// ⚠️ 照片地址必须过 model.js 的 isLocalImage（只认 data:image/jpeg|png|webp;base64、mine-media://）
//    —— 拿 assets/ 下的路径塞进去会被规范化丢掉，图集入口根本不会出现。
const PHOTOS = [
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGPYE+OFFTEMLQkAsUZYgQX59h8AAAAASUVORK5CYII=',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGOwr03GihiGlgQAAGxHwTDO3eYAAAAASUVORK5CYII=',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGPwL9uLFTEMLQkAmXNggXbts4gAAAAASUVORK5CYII='
];

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
const evaluate = async expression => {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
  return r?.result?.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

await call('Page.enable');
await call('Network.enable');
await call('Network.setCacheDisabled', { cacheDisabled: true });
await call('Runtime.enable');
await call('Page.navigate', { url: APP });
await sleep(2600);

// 1) 塞一条三张图的随手拍
const seeded = await evaluate(`(() => {
  const key = 'mine-warmjournal-state-v1';
  const state = JSON.parse(localStorage.getItem(key));
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const day = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  // ⚠️ 条目必须同时带 photo（单数）—— model.js 的规范化按 snippet.photo || videos 过滤，
  //    只给 photos 数组会被丢掉（探针第一次就是这么失败的）。
  const photos = ${JSON.stringify(PHOTOS)};
  state.snippets = [{ id: 'probe-moment', type: 'photo', date: day, text: '探针图集', photo: photos[0], photos, createdAt: Date.now() }];
  localStorage.setItem(key, JSON.stringify(state));
  return { photos: state.snippets[0].photos.length };
})()`);
console.log('注入一条三张图的随手拍：', JSON.stringify(seeded));

await call('Page.navigate', { url: APP });
await sleep(2600);
const afterReload = await evaluate(`(() => {
  const state = JSON.parse(localStorage.getItem('mine-warmjournal-state-v1'));
  const first = state.snippets?.[0];
  return { count: (state.snippets || []).length, first: first ? { type: first.type, photo: String(first.photo || '').slice(0, 40), photos: (first.photos || []).length, text: first.text } : null };
})()`);
console.log('重载后存储里的随手拍：', JSON.stringify(afterReload));

// 2) 切到随手拍页 → 点图集入口
const opened = await evaluate(`(async () => {
  const dock = document.querySelector('[data-route="snippets"]');
  dock?.click();
  await new Promise(r => setTimeout(r, 1200));
  const entry = document.querySelector('[data-view-snippet-photo]');
  if (!entry) {
    return {
      stage: 'no-entry',
      dockFound: Boolean(dock),
      route: document.querySelector('[data-route].active')?.dataset.route || '',
      snippetCards: document.querySelectorAll('.snippet-item-card').length,
      photoButtons: document.querySelectorAll('[data-view-snippet-photo]').length,
      mosaic: document.querySelectorAll('.snippet-photo-mosaic').length,
      bodyHas: document.body.innerHTML.includes('探针图集')
    };
  }
  entry.click();
  await new Promise(r => setTimeout(r, 700));
  return document.querySelector('#moment-album-layer.open') ? 'open' : 'not-open';
})()`);
console.log('打开图集层：', JSON.stringify(opened));

// 3) 量布局
const layout = await evaluate(`(() => {
  const stage = document.querySelector('#moment-album-stage');
  const stack = document.querySelector('#moment-album-stack');
  const cards = [...document.querySelectorAll('.moment-album-card')];
  if (!stage || !cards.length) return { error: '没有牌' };
  const s = stage.getBoundingClientRect();
  const top = cards.find(c => c.dataset.depth === '0').getBoundingClientRect();
  const frames = cards.map(c => { const f = c.querySelector('.moment-album-frame').getBoundingClientRect(); return { depth: c.dataset.depth, w: Math.round(f.width), h: Math.round(f.height) }; });
  return {
    cardCount: cards.length,
    depths: cards.map(c => c.dataset.depth).join(','),
    stage: { w: Math.round(s.width), h: Math.round(s.height) },
    topCard: { w: Math.round(top.width), h: Math.round(top.height) },
    fillRatio: +(top.width / s.width).toFixed(2),
    transforms: cards.map(c => getComputedStyle(c).transform === 'none' ? 'none' : 'set'),
    frames,
    counter: document.querySelector('#moment-album-counter')?.textContent,
    hint: document.querySelector('.moment-album-hint')?.textContent
  };
})()`);
console.log('布局测量：', JSON.stringify(layout, null, 2));

const shot1 = await call('Page.captureScreenshot', { format: 'png' });
if (shot1?.data) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile('probe-album-deck-1.png', Buffer.from(shot1.data, 'base64'));
}

// 4) 左拖一次，应该翻到 2 / 3
const box = await evaluate(`(() => { const r = document.querySelector('.moment-album-card[data-depth="0"]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
const drag = async (fromX, toX) => {
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y: box.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 6; i += 1) await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fromX + ((toX - fromX) * i) / 6, y: box.y, button: 'left' });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: box.y, button: 'left', clickCount: 1 });
  await sleep(450);
};
await drag(box.x, box.x - 140);
const afterDrag = await evaluate(`({
  counter: document.querySelector('#moment-album-counter')?.textContent,
  topIndex: document.querySelector('.moment-album-card[data-depth="0"]')?.dataset.momentAlbumIndex,
  animated: document.querySelector('#moment-album-stack')?.className
})`);
console.log('左拖之后：', JSON.stringify(afterDrag));

const shot2 = await call('Page.captureScreenshot', { format: 'png' });
if (shot2?.data) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile('probe-album-deck-2.png', Buffer.from(shot2.data, 'base64'));
}

// 5) 轻触一次，应该开大图（无位移）
await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
await sleep(60);
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
await sleep(900);
const afterTap = await evaluate(`({
  viewerOpen: Boolean(document.querySelector('.photo-viewer-stage, #photo-viewer, .photo-viewer')),
  albumStillOpen: Boolean(document.querySelector('#moment-album-layer.open'))
})`);
console.log('轻触之后：', JSON.stringify(afterTap));

console.log('');
console.log(layout.cardCount === 3 ? '✅ 一叠三张' : `❌ 牌数不对：${layout.cardCount}`);
console.log(layout.fillRatio >= 0.85 ? `✅ 顶牌铺满 stage（${layout.fillRatio}）` : `❌ 顶牌没铺满（${layout.fillRatio}）`);
console.log(afterDrag.counter === '2 / 3' ? '✅ 左拖翻到了第 2 张' : `❌ 左拖没翻页：${afterDrag.counter}`);
console.log(afterTap.viewerOpen ? '✅ 轻触打开了大图' : '⚠️ 轻触没开大图（看截图确认）');
socket.close();
