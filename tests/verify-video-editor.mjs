/**
 * 私密视频剪辑器 · 真实链路验证（2026-10-10）
 *
 * 走真实 App（iframe 里的 www/index.html），全程只点界面：
 *   长按日历日 → 设置私密密码 → 导入真实视频 → 打开剪辑器 → 框选画面 / 拖时长手柄
 *   → 保存 → 重开编辑器确认记住 → 播放确认画面真的被裁了。
 *
 * 前置：
 *   python -m http.server 8772 --bind 127.0.0.1     （项目根目录）
 *   chrome --headless=new --remote-debugging-port=9223 --window-size=1240,1100 --hide-scrollbars --user-data-dir=<tmp> about:blank
 * 运行：
 *   node tests/verify-video-editor.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../scripts/lib/asset-luma.mjs';

const HARNESS = 'http://127.0.0.1:8772/tests/plain-theme-harness.html';
const VIDEO = fileURLToPath(new URL('../assets/launch-ink-logo-v1.webm', import.meta.url));
/* 声明时长 45 秒的同源素材（画面数据与原素材完全相同，只改了时长声明那 4 个字节）。
   用途：验「习惯裁掉开头」的上限从 10 提到 20 —— 规则是"最多不超过片长的一半"，
   1.6 秒的原素材最多只能砍 1 秒，在它上面无论如何都够不到 20 秒。
   生成方式见 .workbuddy/memory 的当天记录（本机没有 ffmpeg）。 */
const LONG_VIDEO = fileURLToPath(new URL('./fixtures-video-45s.webm', import.meta.url));
const OUT = fileURLToPath(new URL('../evidence/', import.meta.url));
const PASSWORD = '246810';
const F = `document.querySelectorAll('iframe')[0].contentWindow`;

const targets = await fetch('http://127.0.0.1:9223/json').then(r => r.json());
const page = targets.find(t => t.type === 'page' && /^https?:/.test(t.url)) || targets.find(t => t.type === 'page');
if (!page) throw new Error('找不到可调试的页面目标');
const socket = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const waiters = [];
const consoleErrors = [];
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return; }
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(String(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || '').split('\n').slice(0, 3).join(' '));
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
    consoleErrors.push((message.params.args || []).map(a => a.value ?? a.description ?? '').join(' '));
  }
  for (let i = waiters.length - 1; i >= 0; i -= 1) {
    if (waiters[i].match(message)) { waiters[i].resolve(message); waiters.splice(i, 1); }
  }
};
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const callId = ++id;
  pending.set(callId, message => message.error ? reject(new Error(`${method}: ${JSON.stringify(message.error)}`)) : resolve(message.result));
  socket.send(JSON.stringify({ id: callId, method, params }));
});
const waitEvent = (match, timeout = 10000) => new Promise((resolve, reject) => {
  const entry = { match, resolve };
  waiters.push(entry);
  setTimeout(() => { const index = waiters.indexOf(entry); if (index >= 0) { waiters.splice(index, 1); reject(new Error('等待事件超时')); } }, timeout);
});
const wait = ms => new Promise(r => setTimeout(r, ms));
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const inFrame = body => evaluate(`(() => { const w = ${F}; const d = w.document; ${body} })()`);

await call('Page.enable');
await call('Runtime.enable');
await call('Network.enable');
await call('DOM.enable');
await call('Network.setCacheDisabled', { cacheDisabled: true });
await call('Network.clearBrowserCache');
await call('Page.setInterceptFileChooserDialog', { enabled: true });
// ⚠️ 光关 HTTP 缓存还不够：App 注册了 Service Worker，它会绕过 Network.setCacheDisabled
//    继续喂旧副本（表现为"明明重建了产物，测出来还是老代码"）。这里连同站点数据一起清掉。
try { await call('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:8772', storageTypes: 'all' }); } catch { /* 忽略 */ }
await call('Page.navigate', { url: HARNESS });
await wait(1500);
await evaluate(`(async () => { if (!navigator.serviceWorker) return 'no-sw'; const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.unregister())); return 'sw-cleared:' + regs.length; })()`);
await mkdir(OUT, { recursive: true });

const shots = [];
const shot = async label => {
  const data = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true });
  const path = `${OUT}2026-10-10-video-editor-${label}.png`;
  await writeFile(path, Buffer.from(data.data, 'base64'));
  shots.push(path);
  console.log('  · 截图', label);
};
const log = (label, value) => console.log(`[${label}]`, typeof value === 'string' ? value : JSON.stringify(value));

/* 放大截一小块（用来自己看清楚手感细节 —— 整屏截图缩到聊天里根本看不出色带/压暗）。 */
const shotRegion = async (label, selector, scale = 3) => {
  await evaluate('scrollTo(0, 0)');
  await wait(150);
  const box = await evaluate(`(() => {
    const f = document.querySelectorAll('iframe')[0];
    const el = f.contentDocument.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect(); const fr = f.getBoundingClientRect();
    return { x: fr.left + r.left, y: fr.top + r.top, width: r.width, height: r.height };
  })()`);
  if (!box || !box.width) return console.log('  · 区域截图跳过', selector);
  const pad = 12;
  const data = await call('Page.captureScreenshot', {
    format: 'png',
    clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2, scale },
    captureBeyondViewport: true
  });
  const path = `${OUT}2026-10-10-video-editor-${label}.png`;
  await writeFile(path, Buffer.from(data.data, 'base64'));
  shots.push(path);
  console.log('  · 截图', label, `(${Math.round(box.width)}×${Math.round(box.height)} @${scale}x)`);
};

/* 只截第一台"手机"（harness 是六宫格，整屏截图做发布预览没法看）。 */
const shotPhone = async label => {
  await evaluate('scrollTo(0, 0)');
  await wait(200);
  const box = await evaluate(`(() => {
    const f = document.querySelectorAll('iframe')[0];
    if (!f) return null;
    const r = f.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  })()`);
  if (!box || !box.width) return console.log('  · 手机截图跳过', label);
  const data = await call('Page.captureScreenshot', {
    format: 'png',
    clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 2 },
    captureBeyondViewport: true
  });
  const path = `${OUT}2026-10-10-video-editor-${label}.png`;
  await writeFile(path, Buffer.from(data.data, 'base64'));
  shots.push(path);
  console.log('  · 手机截图', label, `(${Math.round(box.width)}×${Math.round(box.height)} @2x)`);
};

/* 量屏幕上真实的像素。为什么要做这个：压暗块"写进 DOM 了"不等于"真的画出来了" ——
   上一版用 box-shadow 扩散，DOM 里也有，但那一层 overflow:hidden 把溢出部分裁掉了，
   屏幕上框外根本没暗。所以这里不看 DOM，直接看画出来的颜色。 */
const probePixel = async (x, y, size = 10) => {
  const data = await call('Page.captureScreenshot', {
    format: 'png',
    clip: { x: Math.round(x - size / 2), y: Math.round(y - size / 2), width: size, height: size, scale: 1 },
    captureBeyondViewport: true
  });
  const png = decodePng(Buffer.from(data.data, 'base64'));
  if (!png) return null;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i + 2 < png.px.length; i += png.chan) { r += png.px[i]; g += png.px[i + 1]; b += png.px[i + 2]; n += 1; }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
};
const luma = rgb => (rgb ? (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 : 0);

/* 断言：光打日志"看起来没问题"不算数，最后要能给出通过/失败的结论。 */
const checks = [];
const check = (label, ok, detail = '') => {
  checks.push({ label, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` —— ${detail}` : ''}`);
};

/* 拖动/点击都走合成 PointerEvent：剪辑器与时间轴都监听 Pointer Events，
   用真实的事件类型才测得到真正的拖动逻辑。 */
const pointer = (selector, points) => inFrame(`
  const el = d.querySelector(${JSON.stringify(selector)});
  if (!el) return 'missing:' + ${JSON.stringify(selector)};
  const r = el.getBoundingClientRect();
  const fire = (type, x, y) => el.dispatchEvent(new w.PointerEvent(type, {
    pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
    clientX: r.left + x, clientY: r.top + y
  }));
  ${points.map(([type, x, y]) => `fire('${type}', ${x}, ${y});`).join('\n')}
  return 'ok';
`);

/* 真实鼠标点击：文件选择框要求"用户激活"，纯 JS 的 .click() 在无头里会被拦掉，
   所以这里用 CDP 投递真实鼠标事件（坐标要换算到顶层页面）。 */
const realClick = async selector => {
  await evaluate('scrollTo(0, 0)');
  await wait(120);
  const box = await evaluate(`(() => {
    const f = document.querySelectorAll('iframe')[0];
    const el = f.contentDocument.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const fr = f.getBoundingClientRect();
    return { x: fr.left + r.left + r.width / 2, y: fr.top + r.top + r.height / 2, localX: r.left, localY: r.top, w: r.width, h: r.height, frameTop: fr.top };
  })()`);
  if (!box) return `missing:${selector}`;
  console.log('    click目标', selector, JSON.stringify(box));
  const hit = await evaluate(`(() => { const el = document.elementFromPoint(${box.x}, ${box.y}); return el ? (el.id || el.className || el.tagName) : 'none'; })()`);
  console.log('    elementFromPoint →', String(hit).slice(0, 90));
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  return 'ok';
};

const waitFor = async (body, label, timeout = 25000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await inFrame(body).catch(() => null);
    if (value) return value;
    await wait(500);
  }
  console.log('    ⚠ 等待超时：', label);
  return null;
};

await call('Page.navigate', { url: HARNESS });
await wait(4000);

// 每次从干净的本地状态开始，避免上一轮留下的私密空间影响判断
await inFrame(`w.localStorage.clear(); return 'cleared';`);
await evaluate(`${F}.location.reload()`);
await wait(3500);

/* 1 · 长按日历日进私密空间 */
await inFrame(`const el = d.querySelector('#today-date-secret'); if (!el) return 'missing-date'; el.dispatchEvent(new w.PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true, clientX: 10, clientY: 10 })); return 'ok';`);
await wait(1900);
log('1 进入私密空间', await inFrame(`return d.querySelector('#vault-setup-form') ? 'setup' : (d.querySelector('.private-vault-view') ? 'view' : 'unknown');`));

/* 2 · 设置 / 输入私密密码 */
log('2 提密码', await inFrame(`
  const setup = d.querySelector('#vault-setup-form');
  const unlock = d.querySelector('#vault-unlock-form');
  if (setup) {
    setup.querySelector('input[name="password"]').value = ${JSON.stringify(PASSWORD)};
    setup.querySelector('input[name="confirm"]').value = ${JSON.stringify(PASSWORD)};
    setup.requestSubmit();
    return 'setup';
  }
  if (unlock) {
    unlock.querySelector('input[name="password"]').value = ${JSON.stringify(PASSWORD)};
    unlock.requestSubmit();
    return 'unlock';
  }
  return 'no-form';
`));
await wait(3000);
log('2 私密空间状态', await inFrame(`return d.querySelector('#vault-import') ? 'unlocked' : 'locked';`));
await shot('01-vault');

/* 3 · 导入真实视频（拦截文件选择框，塞进仓库里的 webm） */
await wait(400);
log('3 点导入', await realClick('#vault-import'));
await wait(900);
log('3 导入弹窗', await inFrame(`return { copy: !!d.querySelector('#vault-import-copy'), move: !!d.querySelector('#vault-import-move') };`));
const chooser = waitEvent(m => m.method === 'Page.fileChooserOpened', 8000).catch(() => null);
log('3 点复制到私密空间', await realClick('#vault-import-copy'));
const opened = await chooser;
if (opened) {
  await call('DOM.setFileInputFiles', { files: [VIDEO], backendNodeId: opened.params.backendNodeId });
  log('3 文件已投喂', 'ok');
} else {
  log('3 文件选择框', '未拦截到（可能走了别的路径）');
}
await waitFor(`return [...d.querySelectorAll('.vault-folder-copy small')].some(n => /[1-9]\\d* 项/.test(n.textContent)) ? 'ok' : '';`, '导入完成（文件夹计数 ≥ 1）', 30000);
log('3 导入结果', await inFrame(`return { folders: d.querySelectorAll('.vault-folder-card').length, meta: [...d.querySelectorAll('.vault-folder-copy small')].map(n => n.textContent) };`));
await shot('02-imported');

/* 3.5 · 进入「全部内容」列表，看到那条视频 */
log('3.5 进入全部内容', await inFrame(`const b = d.querySelector('[data-vault-folder-mode="all"]'); if (!b) return 'missing'; b.click(); return 'clicked';`));
await wait(1500);
log('3.5 列表', await inFrame(`return { items: d.querySelectorAll('.vault-item').length, videos: d.querySelectorAll('.vault-video-item').length, menus: d.querySelectorAll('[data-vault-item-menu]').length };`));
// 记住第一条（短素材）的 id：第 15 节会再导入一段 45 秒的片子，
// 到时候列表里会有两条，必须能精确挑回这一条，不能靠"第一条"这种顺序假设。
const shortItemId = await inFrame(`const b = d.querySelector('[data-vault-item-menu]'); return b ? b.dataset.vaultItemMenu : '';`);
log('3.5 短素材 id', shortItemId);
await shot('02b-list');

/* 4 · 打开剪辑器 */
log('4 点视频菜单', await inFrame(`const b = d.querySelector('[data-vault-item-menu]'); if (!b) return 'missing'; b.click(); return 'clicked';`));
await wait(900);
log('4 菜单项', await inFrame(`return { trim: !!d.querySelector('#vault-menu-trim'), edit: !!d.querySelector('#vault-menu-edit') };`));
log('4 点剪辑视频', await inFrame(`const b = d.querySelector('#vault-menu-trim'); if (!b) return 'missing'; b.click(); return 'clicked';`));
await wait(3500);
const editorState = await inFrame(`return { open: !!d.querySelector('#video-editor'), handles: d.querySelectorAll('.video-editor-crop-handle').length, tabs: d.querySelectorAll('[data-editor-tab]').length, meta: (d.querySelector('#video-editor-subtitle')||{}).textContent || '' };`);
log('4 剪辑器', editorState);
check('从视频菜单能打开剪辑器', editorState.open, editorState.meta);
await shot('03-editor-trim');
await shotPhone('P1-trim');

/* 5 · 剪时长：把起点手柄拖到约 50% 处 */
const trims = await inFrame(`
  const bar = d.querySelector('#video-editor-timeline');
  const handle = d.querySelector('#video-editor-handle-start');
  if (!bar || !handle) return 'missing';
  const r = bar.getBoundingClientRect();
  const target = r.left + r.width * 0.5;
  handle.dispatchEvent(new w.PointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + 2, clientY: r.top + r.height / 2 }));
  handle.dispatchEvent(new w.PointerEvent('pointermove', { pointerId: 2, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: target, clientY: r.top + r.height / 2 }));
  handle.dispatchEvent(new w.PointerEvent('pointerup', { pointerId: 2, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: target, clientY: r.top + r.height / 2 }));
  return {
    readStart: (d.querySelector('#video-editor-read-start')||{}).textContent || '',
    readEnd: (d.querySelector('#video-editor-read-end')||{}).textContent || '',
    readLength: (d.querySelector('#video-editor-read-length')||{}).textContent || '',
    rangeWidth: (d.querySelector('#video-editor-range')||{}).style?.width || ''
  };
`);
log('5 拖动起点手柄到 50%', trims);
check('拖起点手柄能剪掉开头（区间不再是整段）', trims && trims.rangeWidth && parseFloat(trims.rangeWidth) < 90, `区间宽度 ${trims?.rangeWidth}`);
await shot('04-editor-trimmed');
await shotRegion('04b-timeline-zoom', '#video-editor-timeline');

/* 6 · 裁画面：切标签 + 自由框选一块 */
await inFrame(`const t = d.querySelector('[data-editor-tab="crop"]'); if (t) t.click(); return 'ok';`);
await wait(600);
log('6 切到裁画面', await inFrame(`return { layer: !!d.querySelector('#video-editor-crop-layer:not([hidden])'), box: !!d.querySelector('#video-editor-crop-box') };`));
log('6 自由框选', await pointer('#video-editor-crop-layer', [
  ['pointerdown', 20, 20], ['pointermove', 160, 120], ['pointerup', 160, 120]
]));
const drawn = await inFrame(`const b = d.querySelector('#video-editor-crop-box'); return b ? { left: b.style.left, top: b.style.top, width: b.style.width, height: b.style.height, size: (b.querySelector('.video-editor-crop-size')||{}).textContent || '' } : 'missing';`);
log('6 框选结果', drawn);
check('能在画面上自由框出任意比例的矩形', drawn && drawn.width && drawn.width !== '100%' && drawn.height !== '100%', JSON.stringify(drawn));
await shot('05-editor-crop');
await shotPhone('P2-crop-free');

/* 7 · 点「1:1」看比例是否被锁（测试视频是 9:16，1:1 才会真的裁出东西） */
log('7 套用 1:1', await inFrame(`const b = d.querySelector('[data-crop-preset="1:1"]'); if (!b) return 'missing'; b.click(); return 'clicked';`));
await wait(400);
const locked = await inFrame(`const b = d.querySelector('#video-editor-crop-box'); return b ? { width: b.style.width, height: b.style.height, visibleHandles: [...d.querySelectorAll('.video-editor-crop-handle')].filter(n => !n.hidden).length, size: (b.querySelector('.video-editor-crop-size')||{}).textContent || '' } : 'missing';`);
log('7 锁比例后', locked);
// 源片是 720×1280（9:16），锁 1:1 后在归一化坐标里应该是「整宽、高 56.25%」。
check('套用 1:1 后取景框真的是正方形画面', locked && Math.abs(parseFloat(locked.height) - 56.25) < 1.5, JSON.stringify(locked));
check('锁住比例时只留四角手柄（边上不再能拉伸破坏比例）', locked?.visibleHandles === 4, `可见手柄 ${locked?.visibleHandles}`);
await shot('06-editor-crop-ratio');
await shotPhone('P3-crop-1to1');
await shotRegion('06b-crop-zoom', '#video-editor-stage', 2);

/* 7.5 · 量像素：框外到底有没有被压暗。
   上一版栽在这里：压暗块在 DOM 里明明有，屏幕上却一点没暗 —— 因为承载取景框的那一层
   overflow:hidden 把阴影的溢出部分裁掉了。所以这里不看 DOM，只看画出来的颜色：
   同一个点量两次（带着压暗块 / 把压暗块藏起来），藏着的那次必须明显更亮。 */
{
  await evaluate('scrollTo(0, 0)');
  await wait(150);
  const probe = await evaluate(`(() => {
    const f = document.querySelectorAll('iframe')[0];
    const fr = f.getBoundingClientRect();
    const layer = f.contentDocument.querySelector('#video-editor-crop-layer');
    const box = f.contentDocument.querySelector('#video-editor-crop-box');
    const shade = f.contentDocument.querySelector('.video-editor-crop-shade');
    if (!layer || !box || !shade) return { error: 'missing' };
    const lr = layer.getBoundingClientRect(), br = box.getBoundingClientRect();
    // 框外有四个方向，挑最宽的那个方向量 —— 避免量到"画面之外"（那本来就接近纯黑，说明不了问题）
    const gaps = [
      { side: '上', space: br.top - lr.top, x: (lr.left + lr.right) / 2, y: (lr.top + br.top) / 2 },
      { side: '下', space: lr.bottom - br.bottom, x: (lr.left + lr.right) / 2, y: (br.bottom + lr.bottom) / 2 },
      { side: '左', space: br.left - lr.left, x: (lr.left + br.left) / 2, y: (lr.top + lr.bottom) / 2 },
      { side: '右', space: lr.right - br.right, x: (br.right + lr.right) / 2, y: (lr.top + lr.bottom) / 2 }
    ].sort((a, b) => b.space - a.space);
    const best = gaps[0];
    return { x: fr.left + best.x, y: fr.top + best.y, side: best.side, space: Math.round(best.space) };
  })()`);

  if (probe?.error || probe.space < 8) {
    check('取景框外真的被压暗了', false, `量测点取不到：${JSON.stringify(probe)}`);
  } else {
    const withMask = await probePixel(probe.x, probe.y);
    await inFrame(`const s = d.querySelector('.video-editor-crop-shade'); if (s) s.hidden = true; return 'ok';`);
    await wait(150);
    const withoutMask = await probePixel(probe.x, probe.y);
    await inFrame(`const s = d.querySelector('.video-editor-crop-shade'); if (s) s.hidden = false; return 'ok';`);
    const delta = luma(withoutMask) - luma(withMask);
    log('7.5 框外压暗（画面上同一点 A/B）', {
      量测方向: probe.side, 框外空当: `${probe.space}px`, 带压暗: withMask, 藏掉压暗: withoutMask, 亮度差: Number(delta.toFixed(3))
    });
    check('取景框外真的被压暗了（屏幕上量出来的，不是看 DOM）', delta > 0.2, `亮度差 ${delta.toFixed(3)}`);
  }
}

/* 8 · 保存 */
log('8 保存', await inFrame(`const b = d.querySelector('#video-editor-save'); if (!b) return 'missing'; b.click(); return 'clicked';`));
// 画面裁剪的保存要重抓一帧封面（定位 + 解码），短视频也可能要一两秒，别用固定等待
await waitFor(`return d.querySelector('#video-editor') ? '' : 'closed';`, '剪辑器关闭（保存完成）', 20000);
await wait(600);
const saved = await inFrame(`return { editor: !!d.querySelector('#video-editor'), toast: (d.querySelector('#toast')||{}).textContent || '' };`);
log('8 保存后', saved);
check('保存后剪辑器自动关闭', !saved.editor);
await shot('07-saved');

/* 8.5 · 列表上要能看出"这条动过" */
const listed = await inFrame(`
  const box = d.querySelector('.vault-item .vault-media-box');
  return box ? {
    badge: (box.querySelector('.video-edited-stamp')||{}).textContent || '(无)',
    duration: (box.querySelector('.video-duration-stamp')||{}).textContent || '(无)'
  } : 'missing';
`);
log('8.5 列表上的剪辑标记', listed);
check('列表上标出了这是剪辑过的视频', listed?.badge === '已剪辑', JSON.stringify(listed));
await shotRegion('07b-list-zoom', '.vault-item', 2);
await shotPhone('P0-list');

/* 8.7 · 不可逆动作的二次确认 —— 必须把"原片会被删除、无法撤销"讲出来 */
await inFrame(`const b = d.querySelector('[data-vault-item-menu]'); if (b) b.click(); return 'ok';`);
await wait(900);
log('8.7 点压缩入口', await inFrame(`const b = d.querySelector('#vault-menu-bake'); if (!b) return 'missing'; b.click(); return 'clicked';`));
await wait(700);
const bakePrompt = await inFrame(`
  const s = d.querySelector('.vault-bake-sheet');
  return s ? {
    warning: (s.querySelector('.vault-bake-warning')||{}).textContent || '',
    changes: [...s.querySelectorAll('.vault-bake-changes li')].map(n => n.textContent),
    confirm: !!s.querySelector('#vault-bake-confirm'),
    escape: (s.querySelector('.vault-bake-safe')||{}).textContent || ''
  } : 'missing';
`);
log('8.7 压缩确认', bakePrompt);
check('不可逆动作要先说清"原片会被删除、无法撤销"', typeof bakePrompt === 'object' && /无法撤销/.test(bakePrompt.warning), bakePrompt?.warning);
check('确认框要列出这次到底做什么（保留哪段 / 裁哪块）', typeof bakePrompt === 'object' && bakePrompt.changes.length >= 1, JSON.stringify(bakePrompt?.changes));
check('确认框要给出退路（不想动原片就别做这一步）', typeof bakePrompt === 'object' && /不想动原片就别做这一步/.test(bakePrompt.escape));
await shot('07c-bake-confirm');
await shotPhone('P4-bake-confirm');
await inFrame(`const b = d.querySelector('.vault-bake-sheet [data-close]'); if (b) b.click(); return 'ok';`);
await wait(700);

/* 9 · 重开剪辑器，确认记住了 */
await inFrame(`const b = d.querySelector('[data-vault-item-menu]'); if (b) b.click(); return 'ok';`);
await wait(900);
await inFrame(`const b = d.querySelector('#vault-menu-trim'); if (b) b.click(); return 'ok';`);
await waitFor(`return d.querySelector('#video-editor') ? 'open' : '';`, '剪辑器重新打开', 20000);
await wait(700);
const reopened = await inFrame(`return { trimStart: (d.querySelector('#video-editor-read-start')||{}).textContent || '', rangeLeft: (d.querySelector('#video-editor-range')||{}).style?.left || '', rangeWidth: (d.querySelector('#video-editor-range')||{}).style?.width || '', ratio: [...d.querySelectorAll('[data-crop-preset]')].filter(n => n.classList.contains('active')).map(n => n.textContent) };`);
log('9 重开剪辑器', reopened);
check('剪掉的时长被记住了（区间不再是整段）', reopened.rangeWidth && reopened.rangeWidth !== '100%', `区间宽度 ${reopened.rangeWidth}`);
check('重开后锁定的比例被认出来（1:1 胶囊亮着）', reopened.ratio.includes('1:1'), `亮着的比例 ${JSON.stringify(reopened.ratio)}`);
await inFrame(`const t = d.querySelector('[data-editor-tab="crop"]'); if (t) t.click(); return 'ok';`);
await wait(500);
const reopenedBox = await inFrame(`const b = d.querySelector('#video-editor-crop-box'); return b ? { width: b.style.width, height: b.style.height } : 'missing';`);
log('9 取景框', reopenedBox);
// 整幅画面才是 100%×100%。这次存的是 9:16 源上的 1:1，应该是 100%×56.25%。
check('裁掉的画面被记住了（重开后取景框仍是那一块）', reopenedBox?.width === '100%' && reopenedBox?.height === '56.25%', JSON.stringify(reopenedBox));
await shot('08-reopened');
await inFrame(`const b = d.querySelector('#video-editor-cancel'); if (b) b.click(); return 'ok';`);
await wait(600);

/* 10 · 播放确认画面真的被裁了，而且不放出剪掉的开头 */
await inFrame(`const b = d.querySelector('[data-open-vault-item]'); if (b) b.click(); return 'ok';`);
await wait(5000);
const playing = await inFrame(`
  const v = d.querySelector('#warm-video-element');
  const bar = d.querySelector('#vault-feed-progress');
  return v ? {
    clip: v.style.clipPath || '(无)',
    transform: v.style.transform || '(无)',
    time: Number(v.currentTime.toFixed(2)),
    progressMax: bar ? Number(bar.max) : null,
    totalLabel: (d.querySelector('#vault-feed-total-time')||{}).textContent || ''
  } : 'missing-player';
`);
log('10 播放器', playing);
check('播放器画面被裁到取景框', typeof playing === 'object' && playing.clip !== '(无)', playing.clip);
check('播放进度条只覆盖剪出来的那一段，不是整片时长', typeof playing === 'object' && playing.progressMax !== null && playing.progressMax < 1.6, `进度条上限 ${playing?.progressMax}`);
await shot('09-playing');
await shotRegion('10-player-zoom', '#warm-video-element', 2);

/* 11 · 横竖屏重判（2026-10-10 用户要求）
   素材是 720×1280 的竖屏片。先框成 9:16（还是竖的），再框成 16:9（变成横的）——
   每次保存后，它都必须出现在对应的那一类里、并从不该在的那一类里消失。 */
const exitPlayer = async () => {
  await inFrame(`const b = d.querySelector('#warm-video-player [data-close]'); if (b) b.click(); return 'ok';`);
  await waitFor(`return d.querySelector('#warm-video-player') ? '' : 'closed';`, '退出播放器', 8000);
  await wait(600);
};
const filterCounts = async () => {
  await inFrame(`const b = d.querySelector('[data-vault-media-filter="landscape"]'); if (b) b.click(); return 'ok';`);
  await wait(700);
  const landscape = await inFrame(`return d.querySelectorAll('.vault-item').length;`);
  await inFrame(`const b = d.querySelector('[data-vault-media-filter="portrait"]'); if (b) b.click(); return 'ok';`);
  await wait(700);
  const portrait = await inFrame(`return d.querySelectorAll('.vault-item').length;`);
  return { 竖屏: portrait, 横屏: landscape };
};
const applyCropPreset = async (key, label) => {
  await inFrame(`const b = d.querySelector('[data-vault-media-filter="all"]'); if (b) b.click(); return 'ok';`);
  await wait(700);
  await inFrame(`const b = d.querySelector('[data-vault-item-menu]'); if (b) b.click(); return 'ok';`);
  await wait(900);
  await inFrame(`const b = d.querySelector('#vault-menu-trim'); if (b) b.click(); return 'ok';`);
  await waitFor(`return d.querySelector('#video-editor') ? 'open' : '';`, `剪辑器（${label}）打开`, 20000);
  await wait(800);
  await inFrame(`const t = d.querySelector('[data-editor-tab="crop"]'); if (t) t.click(); return 'ok';`);
  await wait(500);
  await inFrame(`const b = d.querySelector('[data-crop-preset="${key}"]'); if (b) b.click(); return 'ok';`);
  await wait(400);
  const box = await inFrame(`const b = d.querySelector('#video-editor-crop-box'); return b ? { width: b.style.width, height: b.style.height, size: (b.querySelector('.video-editor-crop-size')||{}).textContent || '' } : 'missing';`);
  await inFrame(`const b = d.querySelector('#video-editor-save'); if (b) b.click(); return 'ok';`);
  await waitFor(`return d.querySelector('#video-editor') ? '' : 'closed';`, `保存（${label}）`, 20000);
  await wait(900);
  return box;
};

await exitPlayer();

// 11a · 框成 9:16 —— 竖的，必须落在「竖屏」里
const box916 = await applyCropPreset('9:16', '9:16');
// ⚠️ 别用归一化的 width/height 百分比判横竖：源片本来就是 9:16，
//    框成 9:16 等于整幅，归一化出来是 100%×100%（正方形）。
//    要看的是**实际画面像素**（720 × 1280 才是真竖的）。
const framePixels = box => {
  const match = String(box?.size || '').match(/(\d+)\s*×\s*(\d+)/);
  return match ? { w: Number(match[1]), h: Number(match[2]) } : null;
};
const pixels916 = framePixels(box916);
log('11a 取景框（9:16）', box916);
check('框成 9:16 之后实际画面是竖的', pixels916 && pixels916.h > pixels916.w, box916?.size);
const counts916 = await filterCounts();
log('11a 裁成 9:16 之后的归类', counts916);
check('竖屏片框成 9:16 后待在「竖屏」里', counts916.竖屏 === 1 && counts916.横屏 === 0, JSON.stringify(counts916));
// filterCounts 最后停在「竖屏」，正好拍下它待在这一类里的样子
await shotPhone('P5-crop-9to16');

// 11b · 再框成 16:9 —— 横的，必须从「竖屏」挪到「横屏」
const box169 = await applyCropPreset('16:9', '16:9');
const pixels169 = framePixels(box169);
log('11b 取景框（16:9）', box169);
check('框成 16:9 之后实际画面是横的', pixels169 && pixels169.w > pixels169.h, box169?.size);
const counts169 = await filterCounts();
log('11b 裁成 16:9 之后的归类', counts169);
check('同一条裁成横条后挪进了「横屏」', counts169.横屏 === 1, `横屏 ${counts169.横屏} 条`);
check('同一条不再留在「竖屏」里', counts169.竖屏 === 0, `竖屏还剩 ${counts169.竖屏} 条`);
// 切回「横屏」再拍：要拍到的是"它确实出现在横屏这一类里"，而不是空列表
await inFrame(`const b = d.querySelector('[data-vault-media-filter="landscape"]'); if (b) b.click(); return 'ok';`);
await wait(700);
await shotPhone('P6-landscape-filter');

// 11c · 播放器的控件排版也要按「看到的画面」重排
await inFrame(`const b = d.querySelector('[data-vault-media-filter="landscape"]'); if (b) b.click(); return 'ok';`);
await wait(700);
await inFrame(`const b = d.querySelector('[data-open-vault-item]'); if (b) b.click(); return 'ok';`);
await wait(5000);
const flipped = await inFrame(`
  const shell = d.querySelector('#warm-video-player');
  const bar = d.querySelector('#vault-feed-progress');
  const info = d.querySelector('.vault-feed-info');
  if (!shell || !bar) return 'missing-player';
  const cs = getComputedStyle(shell);
  const barBox = bar.getBoundingClientRect();
  return {
    画面下沿留黑: parseInt(cs.getPropertyValue('--vault-feed-video-bottom'), 10) || 0,
    控件移到画面外侧: shell.classList.contains('feed-info-below'),
    进度条可见: barBox.height > 0,
    进度条在屏内: barBox.top >= 0 && barBox.bottom <= window.innerHeight + 2,
    信息层顶边: info ? Math.round(info.getBoundingClientRect().top) : null
  };
`);
log('11c 播放器排版（横条）', flipped);
check('裁成横条后下方出现黑场，控件被挪到画面外侧', flipped?.控件移到画面外侧 === true && flipped?.画面下沿留黑 >= 56, JSON.stringify(flipped));
check('进度条仍然可见、没被挤出屏幕', flipped?.进度条可见 === true && flipped?.进度条在屏内 === true);
await shotPhone('P7-play-wide');
await exitPlayer();

/* ── 12 · 裁画面时的进度条（2026-10-10 用户反馈：裁画面时没法拖进度条换画面）──
   要求：这一页自己有进度条；而且只在「剪短之后真正会播的那一段」里走 ——
   能拖到已经剪掉的画面上再框一遍，框出来的东西保存后根本看不到。 */
const openEditor = async label => {
  await inFrame(`const b = d.querySelector('[data-vault-media-filter="all"]'); if (b) b.click(); return 'ok';`);
  await wait(700);
  await inFrame(`const b = d.querySelector('[data-vault-item-menu]'); if (b) b.click(); return 'ok';`);
  await wait(900);
  await inFrame(`const b = d.querySelector('#vault-menu-trim'); if (b) b.click(); return 'ok';`);
  await waitFor(`return d.querySelector('#video-editor') ? 'open' : '';`, `剪辑器（${label}）打开`, 20000);
  await wait(1200);
};
const saveEditor = async label => {
  await inFrame(`const b = d.querySelector('#video-editor-save'); if (b) b.click(); return 'ok';`);
  await waitFor(`return d.querySelector('#video-editor') ? '' : 'closed';`, `保存（${label}）`, 20000);
  await wait(1000);
};
const closeEditor = async () => {
  await inFrame(`const b = d.querySelector('#video-editor-cancel'); if (b) b.click(); return 'ok';`);
  await waitFor(`return d.querySelector('#video-editor') ? '' : 'closed';`, '关闭剪辑器', 10000);
  await wait(800);
};
const savedTrimHead = async () => {
  const raw = await inFrame(`return localStorage.getItem('mine-warmjournal-state-v1') || '';`);
  try { return JSON.parse(raw)?.settings?.vaultTrimHeadSeconds ?? null; } catch { return null; }
};

await openEditor('进度条');
await inFrame(`const t = d.querySelector('[data-editor-tab="crop"]'); if (t) t.click(); return 'ok';`);
await wait(600);
const scrub = await inFrame(`
  const s = d.querySelector('#video-editor-scrub');
  const v = d.querySelector('#video-editor-video');
  if (!s || !v) return 'missing';
  return { min: Number(s.min), max: Number(s.max), duration: Number(v.duration) || 0 };
`);
log('12 裁画面进度条', scrub);
check('裁画面这页有进度条', scrub !== 'missing' && scrub.max > scrub.min, JSON.stringify(scrub));
// ⚠️ 不能拿「上限 < 片长」当判据：这条素材只剪了开头，终点本来就在片尾 ——
//    那样写会把"只剪开头"的正确实现误判成失败。要判的是"可拖的窗口比整片窄、且不从头开始"。
check('进度条只在剪出来的那一段里走，不是整片',
  scrub !== 'missing' && scrub.max - scrub.min < scrub.duration - .05 && scrub.min > .05,
  `可拖区间 ${scrub?.min}–${scrub?.max}s｜全片 0–${scrub?.duration}s`);
const midScrub = scrub === 'missing' ? 0 : (scrub.min + scrub.max) / 2;
const moved = await inFrame(`
  const s = d.querySelector('#video-editor-scrub');
  const v = d.querySelector('#video-editor-video');
  s.value = String(${midScrub});
  s.dispatchEvent(new w.Event('input', { bubbles: true }));
  return { time: Number(v.currentTime.toFixed(2)), want: ${midScrub} };
`);
await wait(500);
const movedAfter = await inFrame(`const v = d.querySelector('#video-editor-video'); return Number(v.currentTime.toFixed(2));`);
log('12 拖动后', { ...moved, 落地时间: movedAfter });
check('拖动进度条真的把画面换到了那一帧', Math.abs(movedAfter - midScrub) < 0.4, `想 ${midScrub.toFixed(2)}s，实际 ${movedAfter}s`);
// 越界必须被夹回区间：拖不到已经剪掉的开头/结尾上
const clamped = await inFrame(`
  const s = d.querySelector('#video-editor-scrub');
  s.value = '-5'; const low = Number(s.value);
  s.value = '9999'; const high = Number(s.value);
  return { low, high, min: Number(s.min), max: Number(s.max) };
`);
log('12 越界夹回', clamped);
check('拖不出剪掉的那一段', Math.abs(clamped.low - clamped.min) < 1e-6 && Math.abs(clamped.high - clamped.max) < 1e-6, JSON.stringify(clamped));
await shot('11-crop-scrub');
await shotPhone('P9-crop-scrub');
await closeEditor();

/* ── 13 · 「习惯裁掉开头 N 秒」（2026-10-10 用户提的）──
   ⚠️ 用户当次改的口径：**打开时不许自己动手**，点了「砍掉开头 N 秒」才砍。
      第一版做成"打开就按记住的长度自动砍"，用户看到的却是"默认开启剪开头"。
   验证六件事：拖滑块只定长度不动画面 / 点按钮才砍 / 点记住能存下来 / 重开还在 /
               重开时也不自动砍 / 记住的按钮不用"关了再开"就能改数字。 */
await openEditor('习惯-1');
const headMeta = await inFrame(`
  const v = d.querySelector('#video-editor-video');
  const r = d.querySelector('#video-editor-head-range');
  return { duration: Number(v.duration) || 0, limit: r ? Number(r.max) : 0 };
`);
// 素材只有几秒，滑块上限是跟着片长算的 —— 别写死 2 秒，取一个一定在范围内的值。
const headTarget = Math.max(1, Math.min(headMeta.limit, 2));
const pad = value => `0:${String(value).padStart(2, '0')}`;
const readHeadPanel = () => inFrame(`
  const b = d.querySelector('#video-editor-head-apply');
  return {
    读数: (d.querySelector('#video-editor-head-read')||{}).textContent || '',
    按钮: (d.querySelector('#video-editor-head-apply-label')||{}).textContent || '',
    按钮可点: b ? !b.disabled : null,
    起点: (d.querySelector('#video-editor-read-start')||{}).textContent || '',
    已记住: d.querySelector('#video-editor-head-remember')?.classList.contains('active') ?? null,
    记住按钮字: (d.querySelector('#video-editor-head-remember-label')||{}).textContent || '',
    说明: (d.querySelector('#video-editor-head-hint')||{}).textContent || ''
  };
`);

await inFrame(`const r = d.querySelector('#video-editor-head-range'); r.value = '${headTarget}'; r.dispatchEvent(new w.Event('input', { bubbles: true })); return 'ok';`);
await wait(500);
const headDragged = await readHeadPanel();
log('13a 拖滑块', { ...headDragged, 目标: headTarget });
// ⚠️ 这一条是用户这次改口的核心：拖滑块**只定长度**，画面一动不动。
check('拖滑块只定长度，不会自己把画面剪了', headDragged.起点 === '0:00', `起点「${headDragged.起点}」`);
check('读数跟着滑块走', headDragged.读数 === `${headTarget} 秒`, `读数「${headDragged.读数}」`);
check('按钮上的数字跟读数一致（点了就会砍这么多）', headDragged.按钮 === `砍掉开头 ${headTarget} 秒`, `按钮「${headDragged.按钮}」`);
check('还没点「记住」时不算已记住', headDragged.已记住 === false, JSON.stringify({ 已记住: headDragged.已记住 }));

await inFrame(`d.querySelector('#video-editor-head-apply').click(); return 'ok';`);
await wait(600);
const headTapped = await readHeadPanel();
log('13a2 点按钮', headTapped);
check('点「砍掉开头 N 秒」才真的把开头砍掉', headTapped.起点 === pad(headTarget), `起点「${headTapped.起点}」`);
check('点按钮不会顺手改成"已记住"', headTapped.已记住 === false, JSON.stringify({ 已记住: headTapped.已记住 }));

await inFrame(`d.querySelector('#video-editor-head-remember').click(); return 'ok';`);
await wait(400);
const remembered = await readHeadPanel();
log('13b 点记住', remembered);
check('点「记住」后按钮变成已记住', remembered.已记住 === true, JSON.stringify({ 已记住: remembered.已记住, 字: remembered.记住按钮字 }));

await saveEditor('习惯-1');
const storedHead = await savedTrimHead();
log('13c 存进设置', { vaultTrimHeadSeconds: storedHead });
check('「记住」的长度写进了设置', storedHead === headTarget, `存的是 ${storedHead}`);

await openEditor('习惯-2');
const reopenedHead = await readHeadPanel();
log('13d 重开', reopenedHead);
check('重开后「已记住」的状态还在', reopenedHead.已记住 === true, JSON.stringify({ 已记住: reopenedHead.已记住 }));
check('重开时不会自己再砍一刀（这次本来就是 0:01 起）', reopenedHead.起点 === pad(headTarget), `起点「${reopenedHead.起点}」`);
await shot('12-habit-head');
await shotPhone('P10-habit-head');

// 还原整段 → 保存：让它变回「没剪过」，看会不会自己把记住的长度补上
await inFrame(`d.querySelector('#video-editor-reset').click(); return 'ok';`);
await wait(500);
await saveEditor('还原整段');
const resetHead = await savedTrimHead();
check('还原整段不会把记过的习惯抹掉', resetHead === headTarget, `存的是 ${resetHead}`);

await openEditor('习惯-3');
const autoHead = await readHeadPanel();
log('13e 没剪过的视频重开', autoHead);
// ⚠️ 这一条正是用户要求改掉的行为：打开**不许**自己砍，要等点了按钮。
check('没剪过的视频打开时是完整的，不会自己砍', autoHead.起点 === '0:00', `起点「${autoHead.起点}」`);
check('但记住的长度已经准备好，按钮写着「砍掉开头 N 秒」', autoHead.按钮 === `砍掉开头 ${headTarget} 秒`, `按钮「${autoHead.按钮}」`);
check('重开一条没剪过的视频，「已记住」还是亮的', autoHead.已记住 === true, JSON.stringify({ 已记住: autoHead.已记住 }));
await shot('13-habit-auto');
await closeEditor();

/* ── 14 · 换封面要站在「裁剪后的画面」上（2026-10-10 用户提的）──
   用户原话：裁完画面再换封面，应该按裁剪后的画面来选。
   这一节要证明三件事都对齐了裁剪结果：
     · 预览里放的就是取景框那一块，不是整幅原片；
     · 时间轴只在「剪短之后真正会播的那一段」里走，挑不到已经剪掉的画面；
     · 抓出来的封面构图 = 裁剪后画面的构图（不是整幅）。
   第 13 节结束时这条视频是「没剪过」的，而「习惯裁掉开头」还记着 ——
   现在打开不会自动砍了，所以这一节先点一下那个按钮，造出一个非零的保留区间。 */
const labelSeconds = text => {
  const match = String(text || '').match(/(\d+):(\d+)/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
};

await openEditor('封面');
// 打开时必须是完整的（这一节所有断言都建立在这上面）。
const coverBefore = await readHeadPanel();
check('打开时是完整的，等着我点', coverBefore.起点 === '0:00', `起点「${coverBefore.起点}」`);
await inFrame(`d.querySelector('#video-editor-head-apply').click(); return 'ok';`);
await wait(600);
const coverTrim = await inFrame(`
  const v = d.querySelector('#video-editor-video');
  return {
    起点: (d.querySelector('#video-editor-read-start')||{}).textContent || '',
    全片时长: Number(v.duration) || 0,
    原始画面: { w: Number(v.videoWidth) || 0, h: Number(v.videoHeight) || 0 }
  };
`);
await inFrame(`const t = d.querySelector('[data-editor-tab="crop"]'); if (t) t.click(); return 'ok';`);
await wait(500);
await inFrame(`const b = d.querySelector('[data-crop-preset="16:9"]'); if (b) b.click(); return 'ok';`);
await wait(400);
// 取景框的像素尺寸就是"裁剪后画面"的尺寸 —— 后面拿它当基准比封面构图。
const coverCrop = await inFrame(`
  const box = d.querySelector('#video-editor-crop-box');
  return box ? { width: box.style.width, height: box.style.height, size: (box.querySelector('.video-editor-crop-size')||{}).textContent || '' } : 'missing';
`);
log('14 先砍开头、再裁成 16:9', { ...coverTrim, 取景框: coverCrop });
// 前提：这一节必须建立在"真的剪掉了一段开头"之上，否则后面几条会因为区间是整段而白通过。
check('前提成立：点了「砍掉开头」之后真的砍掉了一段', labelSeconds(coverTrim.起点) > 0, `起点读数「${coverTrim.起点}」`);
await saveEditor('封面-16:9');

log('14 点换封面', await inFrame(`const b = d.querySelector('[data-vault-item-menu]'); if (b) { b.click(); return 'menu'; } return 'missing';`));
await wait(900);
log('14 点选择封面', await inFrame(`const b = d.querySelector('#vault-menu-cover'); if (!b) return 'missing'; b.click(); return 'clicked';`));
await waitFor(`return d.querySelector('.video-frame-picker') ? 'open' : '';`, '换封面弹窗打开', 20000);
await wait(1800); // 等元数据读完、布局稳定之后才会套裁剪样式

const picker = await inFrame(`
  const v = d.querySelector('#video-frame-source');
  const r = d.querySelector('#video-frame-range');
  if (!v || !r) return 'missing';
  return {
    clip: v.style.clipPath || '',
    transform: v.style.transform || '',
    已套裁剪: v.dataset.cropApplied || '',
    min: Number(r.min), max: Number(r.max),
    地板: (d.querySelector('#video-frame-floor')||{}).textContent || '',
    天花板: (d.querySelector('#video-frame-duration')||{}).textContent || '',
    时长: Number(v.duration) || 0,
    提示: (d.querySelector('#video-frame-subtle')||{}).textContent || ''
  };
`);
log('14 换封面弹窗', picker);
check('预览里放的是取景框那块，不是整幅原片', typeof picker === 'object' && picker.clip !== '' && picker.已套裁剪 === '1', typeof picker === 'object' ? picker.clip : String(picker));
const pickerScale = typeof picker === 'object' ? Number((String(picker.transform).match(/scale\(([-\d.]+)\)/) || [])[1]) : NaN;
check('取景框那块被放大铺满（和播放时的构图一致）', pickerScale > 1.5, `放大 ${pickerScale} 倍`);
check('时间轴起点落在剪掉之后的开头，挑不到已经剪掉的画面',
  typeof picker === 'object' && picker.min >= labelSeconds(coverTrim.起点) - .06,
  `滑杆下限 ${picker?.min}s，界面读数是「${coverTrim.起点}」`);
check('时间轴地板显示的就是剪掉之后的开头', typeof picker === 'object' && picker.地板 === coverTrim.起点, `地板「${picker?.地板}」`);
check('时间轴天花板没有超过片尾', typeof picker === 'object' && picker.max <= picker.时长 + .05, `上限 ${picker?.max}s / 全片 ${picker?.时长}s`);
check('弹窗明说了只在保留的那段画面里挑', typeof picker === 'object' && /保留/.test(picker.提示), picker?.提示);
await shot('14-cover-picker');
await shotRegion('14b-cover-preview', '.video-frame-stage', 2);
await shotPhone('P8-cover-picker');

// 挑中间一帧保存 —— 列表缩略图就是这次抓出来的封面，拿它的宽高比反推构图
await inFrame(`
  const r = d.querySelector('#video-frame-range');
  r.value = String((Number(r.min) + Number(r.max)) / 2);
  r.dispatchEvent(new w.Event('input', { bubbles: true }));
  return 'ok';
`);
await wait(800);
await inFrame(`const b = d.querySelector('#video-frame-apply'); if (b) b.click(); return 'ok';`);
await waitFor(`return d.querySelector('.video-frame-picker') ? '' : 'closed';`, '换封面保存完成', 20000);
await wait(2500);
const coverThumbRaw = await waitFor(`
  const img = d.querySelector('[data-open-vault-item] .vault-media-box img');
  return img && img.naturalWidth ? JSON.stringify({ w: img.naturalWidth, h: img.naturalHeight }) : '';
`, '列表缩略图（新封面）加载出来', 20000);
const coverPixels = (() => { try { return JSON.parse(coverThumbRaw); } catch { return null; } })();
const shotFrame = framePixels(coverCrop);
const coverRatio = coverPixels ? coverPixels.w / coverPixels.h : 0;
const shotRatio = shotFrame ? shotFrame.w / shotFrame.h : 0;
const fullRatio = coverTrim.原始画面.h ? coverTrim.原始画面.w / coverTrim.原始画面.h : 0;
log('14 抓出来的封面', { 新封面像素: coverPixels, 取景框像素: shotFrame });
check('抓出来的封面就是裁剪后的构图（不是整幅原片）',
  Boolean(coverPixels) && shotRatio > 0 && Math.abs(coverRatio - shotRatio) < .08 && Math.abs(coverRatio - fullRatio) > .3,
  `封面宽高比 ${coverRatio.toFixed(3)}｜裁剪后 ${shotRatio.toFixed(3)}｜整幅 ${fullRatio.toFixed(3)}`);
await shot('15-cover-applied');
await shotRegion('15b-cover-thumb', '.vault-item', 2);

/* ── 15 · 「习惯裁掉开头」的上限提到 20 秒（2026-10-10 用户提的）──
   规则两条取小：最多 20 秒，且不超过片长的一半。
   原来的素材只有 1.6 秒 —— 最多砍 1 秒，在它上面**永远够不到 20**，
   所以这里再导入一段"声明时长 45 秒"的同源素材（画面数据相同，只改了时长声明那 4 个字节）。
   要证明四件事：
     · 45 秒的片子上滑块上限就是 20、而且真的拖得到；拖了之后**还是不动手**，点了按钮才砍；
     · 记住的 1 秒改成 20 秒，只要拖一下滑块再点一下「记住」（不用先点掉再点开）；
     · 1.6 秒的短片上限是 1，读数/按钮都说 1 秒，说明句里讲清"记住的其实是 20 秒"；
     · 在短片上拖滑块 + 保存，**不许**把记住的 20 秒悄悄压成 1 秒。
       这一条是这节最要紧的：它是"记住的功能又自己失效了"那类事故的现场。 */
await inFrame(`
  const el = d.querySelector('#vault-import');
  if (el) { let n = el.parentElement; while (n) { n.scrollTop = 0; n = n.parentElement; } d.scrollingElement.scrollTop = 0; }
  return 'ok';
`);
await wait(300);
log('15 点批量导入', await realClick('#vault-import'));
await wait(900);
const chooser2 = waitEvent(m => m.method === 'Page.fileChooserOpened', 8000).catch(() => null);
log('15 点复制到私密空间', await realClick('#vault-import-copy'));
const opened2 = await chooser2;
if (opened2) {
  await call('DOM.setFileInputFiles', { files: [LONG_VIDEO], backendNodeId: opened2.params.backendNodeId });
  log('15 长素材已投喂', 'ok');
} else {
  log('15 文件选择框', '未拦截到（可能走了别的路径）');
}
// 45 秒的片子要采 5 个时间点抓封面，每个最多等 3.5 秒 —— 给足时间，别用默认 25 秒。
await waitFor(`return d.querySelectorAll('.vault-item').length >= 2 ? 'ok' : '';`, '第二条视频导入完成', 90000);
await wait(1200);

// ⚠️ 列表里现在有两条，不能再用"第一条"这种顺序假设 —— 按 id 精确挑。
const longItemId = await inFrame(`
  const ids = [...d.querySelectorAll('[data-vault-item-menu]')].map(b => b.dataset.vaultItemMenu).filter(Boolean);
  return ids.find(value => value !== ${JSON.stringify(shortItemId)}) || '';
`);
log('15 两条素材的 id', { shortItemId, longItemId });
check('长素材导入成功，列表里两条都在', Boolean(shortItemId) && Boolean(longItemId) && longItemId !== shortItemId, `短 ${shortItemId}｜长 ${longItemId}`);

const openEditorFor = async (itemId, label) => {
  await inFrame(`const b = d.querySelector('[data-vault-media-filter="all"]'); if (b) b.click(); return 'ok';`);
  await wait(700);
  await inFrame(`const b = d.querySelector('[data-vault-item-menu="${itemId}"]'); if (b) b.click(); return 'ok';`);
  await wait(900);
  await inFrame(`const b = d.querySelector('#vault-menu-trim'); if (b) b.click(); return 'ok';`);
  await waitFor(`const v = d.querySelector('#video-editor-video'); return v && Number(v.duration) > 0 ? 'open' : '';`, `剪辑器（${label}）打开`, 20000);
  await wait(1200);
};
const setHeadSlider = async seconds => {
  await inFrame(`const r = d.querySelector('#video-editor-head-range'); r.value = '${seconds}'; r.dispatchEvent(new w.Event('input', { bubbles: true })); return 'ok';`);
  await wait(600);
};
const tapHeadApply = async () => {
  await inFrame(`const b = d.querySelector('#video-editor-head-apply'); if (b) b.click(); return 'ok';`);
  await wait(600);
};
const readHead = () => inFrame(`
  const v = d.querySelector('#video-editor-video');
  const r = d.querySelector('#video-editor-head-range');
  const a = d.querySelector('#video-editor-head-apply');
  return {
    片长: Number(v && v.duration) || 0,
    max: r ? Number(r.max) : 0,
    value: r ? Number(r.value) : 0,
    读数: (d.querySelector('#video-editor-head-read')||{}).textContent || '',
    按钮: (d.querySelector('#video-editor-head-apply-label')||{}).textContent || '',
    按钮可点: a ? !a.disabled : null,
    已记住: d.querySelector('#video-editor-head-remember')?.classList.contains('active') ?? null,
    说明: (d.querySelector('#video-editor-head-hint')||{}).textContent || '',
    起点: (d.querySelector('#video-editor-read-start')||{}).textContent || ''
  };
`);

if (longItemId) {
  await openEditorFor(longItemId, '长片 45 秒');
  const longHead = await readHead();
  log('15a 长片打开', longHead);
  check('长片被认成 45 秒左右（素材声明就是 45 秒）', longHead.片长 > 40, `片长 ${longHead.片长}s`);
  check('45 秒的片子上，滑块上限就是新的 20 秒', longHead.max === 20, `max = ${longHead.max}`);
  check('长片打开时也是完整的，没有因为记住过就自己砍', longHead.起点 === '0:00', `起点「${longHead.起点}」`);

  // 真的拖到 20 —— 只断言 max 会被"上限写成 20 但实际夹不住"骗过去。
  await setHeadSlider(20);
  const longDragged = await readHead();
  log('15a 拖到 20 秒', longDragged);
  check('拖到 20 秒之后按钮说会砍 20 秒', longDragged.value === 20 && longDragged.按钮 === '砍掉开头 20 秒', `滑块 ${longDragged.value}／按钮「${longDragged.按钮}」`);
  check('读数跟着显示 20 秒', longDragged.读数 === '20 秒', `读数「${longDragged.读数}」`);
  // ⚠️ 用户这次的核心要求：拖完滑块**还是不许动手**。
  check('拖到 20 秒也不会自己砍，还是等点按钮', longDragged.起点 === '0:00', `起点「${longDragged.起点}」`);
  await shot('16-habit-long-set');
  await shotPhone('P11-habit-long-set');

  await tapHeadApply();
  const longApplied = await readHead();
  log('15a2 点按钮', longApplied);
  check('点了按钮才真的砍掉 20 秒开头', longApplied.起点 === '0:20', `起点「${longApplied.起点}」`);
  await shot('16b-habit-long-20');
  await shotPhone('P11b-habit-long');

  // 把记住的 1 秒改成 20 秒：拖一下滑块（按钮自动灭）→ 点一下「记住」，不该需要先点掉。
  await inFrame(`d.querySelector('#video-editor-head-remember').click(); return 'ok';`);
  await wait(500);
  const longRemembered = await readHead();
  log('15a3 点记住', longRemembered);
  check('改数字不用"先关再开"：拖完直接点「记住」就存下新的',
    longRemembered.已记住 === true && /已记住 20 秒/.test(longRemembered.说明),
    JSON.stringify({ 已记住: longRemembered.已记住, 说明: longRemembered.说明 }));

  await saveEditor('长片-20秒');
  const storedAfterLong = await savedTrimHead();
  check('长片上记住的 20 秒写进了设置', storedAfterLong === 20, `存的是 ${storedAfterLong}`);
}

await openEditorFor(shortItemId, '短片 1.6 秒');
const shortHead = await readHead();
log('15b 短片打开', shortHead);
check('短片的上限是片长的一半（1 秒），不是 20', shortHead.max === 1, `max = ${shortHead.max}`);
// ⚠️ 读数/按钮说"这次能砍多少"，记住的数字放在说明句里 ——
//    绝不能让按钮写着"砍 20 秒"、实际只砍得动 1 秒。
check('短片上的读数是这次能砍的 1 秒', shortHead.读数 === '1 秒', `读数「${shortHead.读数}」`);
check('短片上的按钮就写 1 秒，不写记不住的 20 秒', shortHead.按钮 === '砍掉开头 1 秒', `按钮「${shortHead.按钮}」`);
check('说明里讲清了"记住的其实是 20 秒、这段最多只能砍 1 秒"',
  /记住的是 20 秒/.test(shortHead.说明) && /最多能砍 1 秒/.test(shortHead.说明), shortHead.说明);
check('滑块停在 1，不会指到一个这段视频根本达不到的位置', shortHead.value <= shortHead.max, `滑块 ${shortHead.value} / 上限 ${shortHead.max}`);
await shot('17-habit-short-clip');
await shotPhone('P12-habit-short');

// ⚠️ 最容易静默出错的一步：在短片（够不到记住的 20 秒）上把滑块随手拖一下，再保存。
//    绝不能让记住的 20 秒被压成 1 秒 —— 这是"记住的功能又自己失效了"那类事故的现场。
await setHeadSlider(0);
const shortDragged = await readHead();
log('15c 短片把滑块拖到 0', shortDragged);
check('短片拖滑块只改"这次砍多长"，画面一动不动', shortDragged.value === 0 && shortDragged.起点 === '0:01', `滑块 ${shortDragged.value}／起点「${shortDragged.起点}」`);
check('拖到 0 之后按钮点不了（没什么可砍的）', shortDragged.按钮可点 === false, `按钮可点 ${shortDragged.按钮可点}`);
check('短片拖滑块不会把记住的 20 秒改掉', /记住的是 20 秒/.test(shortDragged.说明), shortDragged.说明);

await saveEditor('短片-拖了一下');
const storedAfterShort = await savedTrimHead();
log('15d 短片保存之后', { vaultTrimHeadSeconds: storedAfterShort });
check('短片拖滑块 + 保存之后，记住的 20 秒还在（没被压成 1 秒）',
  storedAfterShort === 20, `存的是 ${storedAfterShort}`);
await shot('18-habit-kept');
await shotPhone('P13-habit-kept');

// 收尾：重开长片，确认它真的按 20 秒剪、记住的长度也还够得到。
if (longItemId) {
  await openEditorFor(longItemId, '长片复查');
  const longAgain = await readHead();
  log('15e 长片复查', longAgain);
  check('重开长片：起点还是砍掉的那 20 秒', longAgain.起点 === '0:20', `起点「${longAgain.起点}」`);
  check('重开长片：20 秒仍然够得到、按钮也备好了', longAgain.max === 20 && longAgain.value === 20 && longAgain.按钮 === '砍掉开头 20 秒', `max ${longAgain.max}／滑块 ${longAgain.value}／按钮「${longAgain.按钮}」`);
  await closeEditor();
}

/* ── 结论 ────────────────────────────────────────────────────────── */
const failed = checks.filter(entry => !entry.ok);
console.log('\n控制台错误：', consoleErrors.length ? consoleErrors : '无');
console.log(`检查项：${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) console.log('未通过：', failed.map(entry => entry.label).join('；'));
console.log('截图：', shots.length, '张');
if (consoleErrors.length || failed.length) process.exitCode = 1;
socket.close();
