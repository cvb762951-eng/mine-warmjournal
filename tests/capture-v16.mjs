import { writeFile } from 'node:fs/promises';

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
  const result = await call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await writeFile(new URL(`../${filename}`, import.meta.url), Buffer.from(result.data, 'base64'));
};

await call('Page.enable');
await evaluate(`(() => {
  const w=frames[0],s=w.__mineTest.snapshot();
  s.snippets=[
    {id:'sample-text',type:'text',date:'2026-08-13',text:'傍晚散步时，忽然想起书里那句关于慢下来生活的话。',photo:'',createdAt:1776056400000,updatedAt:1776056400000},
    {id:'sample-photo',type:'text',date:'2026-08-12',text:'留一张今天很喜欢的光影，之后写进日记。',photo:'',createdAt:1775966400000,updatedAt:1775966400000}
  ];
  w.__mineTest.setState(s); w.__mineTest.go('snippets');
})()`);
await new Promise(resolve => setTimeout(resolve, 150));
await capture('v1.6-snippets-390.png');

await evaluate(`(() => { const w=frames[0]; w.__mineTest.go('focus'); w.document.querySelector('[data-timer-mode=pomodoro]').click(); })()`);
await new Promise(resolve => setTimeout(resolve, 150));
await capture('v1.6-pomodoro-390.png');

socket.close();
