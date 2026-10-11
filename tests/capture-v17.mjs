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
  const result = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(new URL(`../${filename}`, import.meta.url), Buffer.from(result.data, 'base64'));
};

await call('Page.enable');
await evaluate(`(() => {
  const w=frames[0],s=w.__mineTest.snapshot(),day=new Date(),pad=n=>String(n).padStart(2,'0'),key=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  s.todos=[
    {id:'todo-a',date:key(day),title:'整理本周的阅读笔记',completed:false,createdAt:1,updatedAt:1},
    {id:'todo-b',date:key(day),title:'傍晚散步三十分钟',completed:true,createdAt:2,updatedAt:2}
  ];
  w.__mineTest.setState(s); w.__mineTest.go('today');
})()`);
await new Promise(resolve => setTimeout(resolve, 150));
await capture('v1.7-today-todos-390.png');

await evaluate(`frames[0].__mineTest.go('mine')`);
await new Promise(resolve => setTimeout(resolve, 150));
await capture('v1.7-mine-390.png');

await evaluate(`frames[0].document.querySelector('#manage-habits-mine').click(); frames[0].document.querySelector('#new-habit').click()`);
await new Promise(resolve => setTimeout(resolve, 150));
await capture('v1.7-habit-icons-390.png');
socket.close();
