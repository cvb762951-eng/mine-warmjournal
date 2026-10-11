import { readFile, writeFile } from 'node:fs/promises';

const targets = await fetch('http://127.0.0.1:9223/json').then(response => response.json());
const page = targets.find(target => target.type === 'page');
if (!page) throw new Error('Chrome page target not found');
const socket = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  pending.get(message.id)(message.result);
  pending.delete(message.id);
};
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const call = (method, params = {}) => new Promise(resolve => {
  const callId = ++id;
  pending.set(callId, resolve);
  socket.send(JSON.stringify({ id: callId, method, params }));
});
const evaluate = expression => call('Runtime.evaluate', { expression, awaitPromise: true });
const capture = async filename => {
  const result = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(new URL(`../${filename}`, import.meta.url), Buffer.from(result.data, 'base64'));
};

await call('Page.enable');
const photo = `data:image/png;base64,${(await readFile(new URL('../icon-512.png', import.meta.url))).toString('base64')}`;
await evaluate(`(() => {
  const w=frames[0],s=w.__mineTest.snapshot();
  s.snippets=s.snippets.filter(entry=>entry.date!=='2026-08-13');
  s.snippets.push({id:'preview-photo',type:'photo',date:'2026-08-13',text:'傍晚散步时看到的光影',photo:${JSON.stringify(photo)},createdAt:new Date('2026-08-13T18:42:00').getTime(),updatedAt:Date.now()});
  s.journals['2026-08-13']={content:'今天专注完成了计划，也记下了路上的风景。',mood:'calm',weather:'sunny',photos:[],updatedAt:Date.now()};
  w.__mineTest.setState(s); w.__mineTest.go('focus');
})()`);
await new Promise(resolve => setTimeout(resolve, 120));
await capture('v1.8-focus-390.png');

await evaluate(`frames[0].__mineTest.go('calendar','2026-08-13')`);
await new Promise(resolve => setTimeout(resolve, 120));
await evaluate(`scrollTo(0,430)`);
await new Promise(resolve => setTimeout(resolve, 80));
await capture('v1.8-calendar-daily-390.png');
socket.close();
