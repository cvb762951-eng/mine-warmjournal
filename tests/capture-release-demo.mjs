/**
 * 版本更新动态的演示图截图（纯界面驱动，不改源码）。
 * 做法：iframe 里正常启动 App → 往 localStorage 注入一条「更新」动态（用真实的 105 版说明数据）
 * → 回到今日页，把 Life Stream 里的更新卡片裁出来存成 assets/release-1.1.4-1.png。
 *
 * ⚠️ 两遍法：第一遍卡片缩略图 404（素材还不存在），先把截图写进素材位；
 *    第二遍重跑，缩略图用的就是真素材（卡片里套卡片，一层嵌套，视觉自洽）。
 *
 * 前置：
 *   python -m http.server 8772 --bind 127.0.0.1   （项目根目录）
 *   chrome --headless=new --remote-debugging-port=9223 --window-size=1240,2780 --hide-scrollbars --user-data-dir=<tmp> about:blank
 * 运行：
 *   node tests/capture-release-demo.mjs
 */
import { writeFile } from 'node:fs/promises';

const OUT = 'assets/release-1.1.4-1.png';
const HARNESS = 'http://127.0.0.1:8772/tests/plain-theme-harness.html';
const FW = 'document.querySelectorAll("iframe")';

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
await call('Network.enable');
await call('Network.setCacheDisabled', { cacheDisabled: true });
await call('Network.clearBrowserCache');
await call('Page.navigate', { url: HARNESS });
await wait(3500);

const frameCount = await evaluate(`${FW}.length`);
if (!frameCount) throw new Error('harness has no iframe');

// 注入一条与线上 1.1.4 说明完全一致的「更新」动态（数据照抄 release-notes.js 的 105 条目）。
const patch = `(() => {
  const KEY = 'mine-warmjournal-state-v1';
  const raw = JSON.parse(w.localStorage.getItem(KEY) || '{}');
  const s = raw.state || raw;
  s.settings = Object.assign({}, s.settings, { theme: 'classic' });
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const key = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  s.releases = [{
    code: 105, versionName: '1.1.4', title: '更新动态上线',
    summary: '从这版起，每次升级都会在当天的活动里留一条「更新」动态，点开能看完整说明和演示图。',
    bullets: [
      '升级当天，「当天活动」里自动出现一条带演示图的版本说明，点开可看全部改动',
      '日记页恢复为你熟悉的原版样子（上一版试的书写改法已整体撤掉）',
      '「习惯裁掉开头」的时长上限从 10 秒提到 20 秒（保留）'
    ],
    screenshots: ['assets/release-1.1.4-1.png'],
    date: key, createdAt: d.getTime() - 1800e3
  }];
  return s;
})()`;

const ok = await evaluate(`(() => {
  const w = ${FW}[0] && ${FW}[0].contentWindow;
  if (!w || !w.localStorage) return 'no-frame';
  const s = ${patch};
  w.localStorage.setItem('mine-warmjournal-state-v1', JSON.stringify(s));
  return 'ok';
})()`);
if (ok !== 'ok') throw new Error('seed failed: ' + ok);
await evaluate(`${FW}[0].contentWindow.location.reload()`);
await wait(2500);

// 检查卡片真的渲染出来了（主题等一帧）
const probe = await evaluate(`(() => {
  const d = ${FW}[0].contentWindow.document;
  const card = d.querySelector('.life-stream-release-card');
  if (!card) return { found: false };
  const img = card.querySelector('.life-stream-release-shot');
  return { found: true, title: card.querySelector('strong')?.textContent, imgOk: img ? img.complete && img.naturalWidth > 0 : 'no-img' };
})()`);
console.log('probe:', JSON.stringify(probe));
if (!probe.found) throw new Error('release card not rendered');

await wait(800);
// Life Stream 区块比手机可视区高，更新卡片排在时间轴后面、藏在折叠线以下 —— 先滚进可视区。
const scrolled = await evaluate(`(() => {
  const w = ${FW}[0].contentWindow;
  const d = w.document;
  const section = d.querySelector('.today-life-stream-section');
  if (!section) return 'no-section';
  section.scrollIntoView({ block: 'start' });
  w.scrollBy(0, -70); // 给固定顶栏让位
  return 'ok';
})()`);
if (scrolled !== 'ok') throw new Error('scroll failed: ' + scrolled);
await wait(600);
const box = await evaluate(`(() => {
  const d = ${FW}[0].contentWindow.document;
  const section = d.querySelector('.today-life-stream-section');
  const card = d.querySelector('.life-stream-release-card');
  const frame = ${FW}[0].getBoundingClientRect();
  const r = section.getBoundingClientRect();
  // 卡片必须真的在可视区内；底部给悬浮底栏留 90px，超出就裁到可视边界。
  const top = Math.max(r.top, 0);
  const cardBottom = card.getBoundingClientRect().bottom;
  const bottom = Math.min(r.bottom, frame.height - 90, cardBottom + 6);
  return { x: frame.left + r.left, y: frame.top + top, width: r.width, height: Math.max(0, bottom - top) };
})()`);
if (!(box.height > 40)) throw new Error('clip box too small: ' + JSON.stringify(box));
const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 2 } });
await writeFile(new URL(`../${OUT}`, import.meta.url), Buffer.from(shot.data, 'base64'));
console.log('written', OUT, JSON.stringify(box));
socket.close();
