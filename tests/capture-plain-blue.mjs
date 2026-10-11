/**
 * 清简主题多屏截图（纯界面驱动，不改源码）。
 * 做法：先让一个 iframe 正常启动把默认状态写进 localStorage，
 * 然后「改写 localStorage 里的 settings.theme / route」+ 逐帧 reload，
 * 每帧就落在指定页面上。localStorage 与 iframe 同源共享，所以只需改写一次状态。
 *
 * 前置：
 *   python -m http.server 8772 --bind 127.0.0.1
 *   chrome --headless=new --remote-debugging-port=9223 --window-size=1240,2780 --hide-scrollbars --user-data-dir=<tmp> about:blank
 * 运行：
 *   node tests/capture-plain-blue.mjs <输出文件名> [主题名]
 */
import { writeFile, readFile } from 'node:fs/promises';

const outName = process.argv[2] || 'plain-blue.png';
const theme = process.argv[3] || 'plain';
const onlyFrame = process.argv[4] ? Number(process.argv[4]) : null;
const HARNESS = 'http://127.0.0.1:8772/tests/plain-theme-harness.html';
const FW = 'document.querySelectorAll("iframe")';
// 每次打开 App 都会被强制回到「今日」，所以路由只能靠点导航切。
// 底部 Dock 有 today/calendar/snippets/journal/ledger；「我的」在顶栏的头像按钮上。
const ROUTES = ['today', 'snippets', 'journal', 'ledger', 'calendar', 'mine'];

const targets = await fetch('http://127.0.0.1:9223/json').then(r => r.json());
const page = targets.find(t => t.type === 'page' && /^https?:/.test(t.url)) || targets.find(t => t.type === 'page');
if (!page) throw new Error('no page target: ' + targets.map(t => t.url).join(' | '));

const socket = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
socket.onmessage = event => {
  const m = JSON.parse(event.data);
  if (!m.id || !pending.has(m.id)) return;
  pending.get(m.id)(m.result);
  pending.delete(m.id);
};
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const call = (method, params = {}) => new Promise(resolve => {
  const callId = ++id;
  pending.set(callId, resolve);
  socket.send(JSON.stringify({ id: callId, method, params }));
});
const evaluate = async expression => {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
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
await wait(3500);

const frameCount = await evaluate(`${FW}.length`);
if (!frameCount) throw new Error('harness has no iframe');

const photo = `data:image/png;base64,${(await readFile(new URL('../icon-192.png', import.meta.url))).toString('base64')}`;

// 只改「状态」这一段；空状态的文件都保留原样。
const patch = `(() => {
  const KEY = 'mine-warmjournal-state-v1';
  const raw = JSON.parse(w.localStorage.getItem(KEY) || '{}');
  const s = raw.state || raw;                       // 预览版把整份状态直接存在这个 key 下
  s.settings = Object.assign({}, s.settings, { theme: ${JSON.stringify(theme)} });
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const key = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  const base = d.getTime() - 3600e3;
  s.snippets = [
    { id: 'demo-1', type: 'photo', date: key, text: '傍晚散步时看到的光影', photo: ${JSON.stringify(photo)}, tags: ['日常生活'], createdAt: base, updatedAt: base },
    { id: 'demo-2', type: 'photo', date: key, text: '午后书桌的阳光', photo: ${JSON.stringify(photo)}, tags: ['学习心流'], createdAt: base - 3600e3, updatedAt: base - 3600e3 }
  ];
  s.journals = s.journals || {};
  s.journals[key] = { content: '今天把计划里的几件事都做完了，路过江边的时候记下了晚霞。', mood: 'calm', weather: 'sunny', photos: [], updatedAt: base };
  return s;
})()`;

for (let i = 0; i < frameCount; i += 1) {
  const route = ROUTES[i] || 'today';
  const ok = await evaluate(`(() => {
    const w = ${FW}[${i}] && ${FW}[${i}].contentWindow;
    if (!w || !w.localStorage) return 'no-frame';
    const s = ${patch};
    w.localStorage.setItem('mine-warmjournal-state-v1', JSON.stringify(s));
    return 'ok';
  })()`);
  if (ok !== 'ok') throw new Error('frame ' + i + ' seed failed: ' + ok);
  await evaluate(`${FW}[${i}].contentWindow.location.reload()`);
  await wait(1500);
  // 打开即「今日」，用界面上的导航切到目标页
  const navigated = await evaluate(`(() => {
    const d = ${FW}[${i}].contentWindow.document;
    const dock = d.querySelector('#dock-btn-${route}');
    if (dock) { dock.click(); return 'dock'; }
    const head = d.querySelector('#app-header [data-route="${route}"]');
    if (head) { head.click(); return 'header'; }
    // 今日页的「快捷入口」卡片：我的与设置 / 专注工坊 / 复盘统计 / 书影音
    const qa = d.querySelector('[data-func-action="${route}"]');
    if (qa) { qa.click(); return 'quick-access'; }
    const avatar = d.querySelector('#today-avatar');
    if (avatar) { avatar.click(); return 'avatar'; }
    return 'none';
  })()`);
  await wait(700);
  console.log('frame', i, route, '→', navigated);
}
await wait(1200);
await evaluate(`scrollTo(0,0); true`);
await wait(400);

// 只截某一帧时，取那一帧在页面里的位置，用 clip 放大 2 倍截，方便看清细节。
let clipBox = null;
if (onlyFrame !== null) {
  clipBox = await evaluate(`(() => {
    const r = ${FW}[${onlyFrame}].getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
  })()`);
}

const states = await evaluate(`(() => ${FW}[0] ? ${FW}[0].contentWindow.document.documentElement.getAttribute('data-theme') : 'none')()`);
console.log('theme attr on frame0:', states);

const shot = await call('Page.captureScreenshot', onlyFrame === null
  ? { format: 'png', fromSurface: true, captureBeyondViewport: true }
  : (() => {
      const box = clipBox;
      return { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 2 } };
    })());
await writeFile(new URL(`../${outName}`, import.meta.url), Buffer.from(shot.data, 'base64'));
console.log('written', outName, 'frames', frameCount);
socket.close();
