/**
 * 版本更新动态的界面回归验证（文件版注入，避免命令行内联引号被环境打碎）。
 * 场景：模拟「早期版本把 103 误写到了更新当天」的老用户：
 *   state 里只有 103（日期错、标题旧）和 105（日期对）两条，水位 105。
 * 启动后应：补齐登记表全部条目并各落在真实发布日；103 的日期和标题被纠正；105 原样保留；
 * 今天的 Life Stream 只出现刚升级到的当前版本；点开这张卡片，弹层结构完整。
 * 前置：http.server 8772 + 无头 Chrome 9223（见 capture-release-demo.mjs 头注）。
 * 运行：node tests/verify-release-modal.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';

const HARNESS = 'http://127.0.0.1:8772/tests/plain-theme-harness.html';
const FW = 'document.querySelectorAll("iframe")';

const targets = await fetch('http://127.0.0.1:9223/json').then(r => r.json());
const page = targets.find(t => t.type === 'page' && /^https?:/.test(t.url)) || targets.find(t => t.type === 'page');
if (!page) throw new Error('no page target');

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

const ok = await evaluate(`(() => {
  const w = ${FW}[0] && ${FW}[0].contentWindow;
  if (!w || !w.localStorage) return 'no-frame';
  const raw = JSON.parse(w.localStorage.getItem('mine-warmjournal-state-v1') || '{}');
  const s = raw.state || raw;
  s.settings = Object.assign({}, s.settings, { theme: 'classic', lastSeenReleaseCode: 105 });
  s.releases = [
    { code: 103, versionName: '1.1.2', title: '旧标题', summary: '旧摘要', bullets: [], screenshots: [], date: '2026-10-11', createdAt: Date.parse('2026-10-11T00:20:00') },
    { code: 105, versionName: '1.1.4', title: '更新动态上线',
      summary: '从这版起，每次升级都会在当天的活动里留一条「更新」动态，点开能看完整说明和演示图。',
      bullets: ['升级当天自动出现版本说明', '日记页恢复原版', '习惯砍开头上限提到 20 秒'],
      screenshots: ['assets/release-1.1.4-1.png'], date: '2026-10-10', createdAt: 1791650000000 }
  ];
  w.localStorage.setItem('mine-warmjournal-state-v1', JSON.stringify(s));
  w.location.reload();
  return 'ok';
})()`);
if (ok !== 'ok') throw new Error('seed failed: ' + ok);
await wait(3200);

// 校验 1：补齐 + 归位
const backfill = await evaluate(`(() => {
  const w = ${FW}[0].contentWindow;
  const raw = JSON.parse(w.localStorage.getItem('mine-warmjournal-state-v1'));
  const s = raw.state || raw;
  const list = (s.releases || []).map(item => ({ code: item.code, date: item.date }));
  return JSON.stringify({ count: list.length, byCode: Object.fromEntries(list.map(item => [item.code, item.date])) });
})()`);
console.log('backfill:', backfill.slice(0, 220) + '…');

// 校验 2：今天的 Life Stream 只有刚升级到的当前版本，不再铺历史发布日
const stream = await evaluate(`(() => {
  const d = ${FW}[0].contentWindow.document;
  const cards = [...d.querySelectorAll('.life-stream-release-card')];
  return JSON.stringify({ count: cards.length, codes: cards.map(c => c.dataset.releaseCode) });
})()`);
console.log('stream:', stream);

// 校验 3：点开当天仅有的那张更新卡片，弹层结构完整
const clicked = await evaluate(`(() => {
  const d = ${FW}[0].contentWindow.document;
  const card = d.querySelector('.life-stream-release-card');
  if (!card) return 'no-card';
  card.scrollIntoView({ block: 'center' });
  card.click();
  return 'clicked';
})()`);
await wait(900);
if (clicked !== 'clicked') throw new Error('click failed: ' + clicked);

const modal = await evaluate(`(() => {
  const d = ${FW}[0].contentWindow.document;
  const m = d.querySelector('.release-notes-modal');
  if (!m) return null;
  return JSON.stringify({
    badge: Boolean(m.querySelector('.release-notes-badge .material-symbols-outlined')),
    pill: m.querySelector('.release-notes-pill')?.textContent,
    title: m.querySelector('.release-notes-head-copy h2')?.textContent,
    meta: m.querySelector('.release-notes-head-copy p')?.textContent,
    bullets: m.querySelectorAll('.release-notes-bullets li').length,
    closeBtn: Boolean(m.querySelector('[data-close]'))
  });
})()`);
console.log('modal:', modal);

// 截图存证
const box = await evaluate(`(() => {
  const f = ${FW}[0];
  const fr = f.getBoundingClientRect();
  const d = f.contentWindow.document;
  const m = d.querySelector('.modal');
  const r = m ? m.getBoundingClientRect() : null;
  return JSON.stringify(r ? { x: fr.left + r.left, y: fr.top + r.top, width: r.width, height: Math.min(r.height, 700) } : 'no rect');
})()`);
const b = JSON.parse(box);
const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: b.x, y: b.y, width: b.width, height: b.height, scale: 2 } });
await writeFile(new URL('../tmp/release-modal-v3.png', import.meta.url), Buffer.from(shot.data, 'base64'));
console.log('saved tmp/release-modal-v3.png');

let failed = 0;
const expect = (name, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed += 1;
  console.log(pass ? 'PASS' : 'FAIL', name, '=', JSON.stringify(actual), pass ? '' : `（期望 ${JSON.stringify(want)}）`);
};

// 登记表在 Node 侧直接导入，期望值从它推导（不写死）
const { RELEASE_NOTES } = await import(new URL('../release-notes.js', import.meta.url));
const { releaseInstant } = await import(new URL('../release-activity.js', import.meta.url));
const { formatShanghaiDateTime } = await import(new URL('../model.js', import.meta.url));
const registryCodes = Object.keys(RELEASE_NOTES).map(Number).sort((a, b) => a - b);
const gradle = await readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
const current = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
const currentNotes = RELEASE_NOTES[current];

const parsed = JSON.parse(backfill);
expect('补齐登记表全部条目', parsed.count, registryCodes.length);
expect('补发落在真实发布日（1.0.82 → 10-09）', parsed.byCode['83'], '2026-10-09');
expect('误写的 103 归位到 10-10', parsed.byCode['103'], '2026-10-10');
expect('105 保持在 10-10', parsed.byCode['105'], '2026-10-10');
expect('106 在 10-11', parsed.byCode['106'], '2026-10-11');
expect('107 在 10-11', parsed.byCode['107'], '2026-10-11');

const parsedStream = JSON.parse(stream);
expect('今天的活动只出现刚升级到的版本', parsedStream.codes, [String(current)]);

const parsedModal = JSON.parse(modal || '{}');
expect('弹层徽标', parsedModal.badge, true);
expect('药丸版本号', parsedModal.pill, `v${currentNotes.name}`);
expect('弹层标题', parsedModal.title, currentNotes.title);
expect('版本行', parsedModal.meta, `更新到 ${currentNotes.name} · ${formatShanghaiDateTime(releaseInstant(currentNotes))}`);
expect('清单条数', parsedModal.bullets, currentNotes.bullets.length);
expect('关闭按钮走 data-close', parsedModal.closeBtn, true);
console.log(failed ? `FAILED: ${failed} 项` : 'ALL PASS');
socket.close();
process.exit(failed ? 1 : 0);
