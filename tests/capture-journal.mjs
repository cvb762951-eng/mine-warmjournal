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
  pending.get(message.id)(message.result); pending.delete(message.id);
};
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const call = (method, params = {}) => new Promise(resolve => {
  const callId = ++id; pending.set(callId, resolve);
  socket.send(JSON.stringify({ id: callId, method, params }));
});
await call('Runtime.evaluate', { expression: `frames[0].__mineTest.go('calendar'); frames[0].document.querySelector('#write').click()` });
await new Promise(resolve => setTimeout(resolve, 100));
await call('Page.enable');
const screenshot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { x: 0, y: 0, width: 390, height: 844, scale: 1 } });
await writeFile(new URL('../v1.5-journal-editor-390.png', import.meta.url), Buffer.from(screenshot.data, 'base64'));
socket.close();
