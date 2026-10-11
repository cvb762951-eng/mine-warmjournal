import assert from 'node:assert/strict';
import http from 'node:http';

const host = '127.0.0.1';
const port = 9223;
const targets = await fetch(`http://${host}:${port}/json`).then(response => response.json());
const page = targets.find(target => target.type === 'page');
assert.ok(page, 'Chrome page target not found');

const socket = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  message.error ? reject(new Error(message.error.message)) : resolve(message.result);
};
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });

function call(method, params = {}) {
  const callId = ++id;
  socket.send(JSON.stringify({ id: callId, method, params }));
  return new Promise((resolve, reject) => pending.set(callId, { resolve, reject }));
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

await call('Runtime.enable');
await evaluate(`(async () => { const w=frames[0]; if (w.caches) await Promise.all((await w.caches.keys()).map(key => w.caches.delete(key))); })()`);
await call('Page.enable');
await call('Page.reload', { ignoreCache: true });
await new Promise(resolve => setTimeout(resolve, 350));
for (const [route, requiredText] of [['today', '今日概览'], ['focus', '深度工作'], ['statistics', '成长轨迹'], ['calendar', '补记专注'], ['mine', '整理我的生活']]) {
  await evaluate(`frames[0].__mineTest.go('${route}')`);
  const result = await evaluate(`(() => { const d=frames[0].document; return { text: d.querySelector('#app').innerText, overflow: d.documentElement.scrollWidth > d.documentElement.clientWidth }; })()`);
  assert.ok(result.text.includes(requiredText), `${route} did not render expected text`);
  assert.equal(result.overflow, false, `${route} has horizontal overflow`);
}
assert.equal(await evaluate(`(() => { frames[0].__mineTest.go('focus'); const d=frames[0].document; return d.querySelector('#app-header h1').textContent==='Timer' && !d.querySelector('#app-header').innerText.includes('Mine'); })()`), true, 'focus should use the standard Timer header');
assert.equal(await evaluate(`getComputedStyle(frames[0].document.querySelector('.view')).animationName`), 'none', 'local refreshes should not replay a page animation');
await evaluate(`frames[0].__mineTest.go('today')`);
const todayDashboard = await evaluate(`(() => { const d=frames[0].document; return {hero:Boolean(d.querySelector('.today-hero')),stats:d.querySelectorAll('.today-stat-grid article').length,feed:Boolean(d.querySelector('.activity-feed')),timeline:Boolean(d.querySelector('.timeline')),overflow:d.documentElement.scrollWidth>d.documentElement.clientWidth}; })()`);
assert.deepEqual([todayDashboard.hero,todayDashboard.stats,todayDashboard.feed,todayDashboard.timeline,todayDashboard.overflow],[true,4,true,false,false], 'today should render the compact dashboard without the old timeline');
await evaluate(`frames[0].__mineTest.go('statistics')`);
const statsDashboard = await evaluate(`(() => { const d=frames[0].document; return {summary:Boolean(d.querySelector('.stats-summary-card')),panels:d.querySelectorAll('.stats-panel').length,report:Boolean(d.querySelector('.stats-report-entry')),oldCard:Boolean(d.querySelector('.total-card')),overflow:d.documentElement.scrollWidth>d.documentElement.clientWidth}; })()`);
assert.deepEqual([statsDashboard.summary,statsDashboard.panels,statsDashboard.report,statsDashboard.oldCard,statsDashboard.overflow],[true,3,true,false,false], 'statistics should render summary, trend, rhythm and project panels without the old sparse card');
assert.equal(await evaluate(`frames[0].document.querySelectorAll('.focus-heatmap button').length`), 28, 'statistics should expose a 28-day drill-down heatmap');
await evaluate(`frames[0].document.querySelector('.focus-heatmap button:last-child').click()`);
assert.equal(await evaluate(`frames[0].__mineTest.snapshot().route`), 'calendar', 'heatmap should drill down to the selected calendar day');

await evaluate(`(() => { const w=frames[0],s=w.__mineTest.snapshot(); s.snippets=s.snippets.filter(entry=>entry.date!=='2026-08-13'); s.snippets.push({id:'calendar-photo',type:'photo',date:'2026-08-13',text:'日历里的随手拍',photo:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',createdAt:new Date('2026-08-13T14:35:00').getTime(),updatedAt:new Date('2026-08-13T14:35:00').getTime()}); w.__mineTest.setState(s); w.__mineTest.go('calendar','2026-08-13'); })()`);
const calendarArchive = await evaluate(`(() => { const d=frames[0].document; return { text:d.querySelector('.day-story').innerText, photos:d.querySelectorAll('.calendar-event img').length, overflow:d.documentElement.scrollWidth>d.documentElement.clientWidth }; })()`);
assert.ok(calendarArchive.text.includes('随手拍') && calendarArchive.text.includes('14:35') && calendarArchive.text.includes('日历里的随手拍'));
assert.equal(calendarArchive.photos, 1);
assert.equal(calendarArchive.overflow, false, 'calendar daily archive has horizontal overflow');
await evaluate(`frames[0].document.querySelector('[data-calendar-event^="snippet:"]').click()`);
assert.equal(await evaluate(`frames[0].document.querySelector('.photo-viewer') !== null`), true);
const largePhoto = await evaluate(`(() => { const d=frames[0].document,r=d.querySelector('.photo-modal').getBoundingClientRect(),v=d.documentElement; return {width:r.width,height:r.height,viewportWidth:v.clientWidth,viewportHeight:v.clientHeight}; })()`);
assert.ok(largePhoto.width >= largePhoto.viewportWidth && largePhoto.height >= largePhoto.viewportHeight, 'photo viewer should fill the mobile viewport');
await evaluate(`(() => { const d=frames[0].document,s=d.querySelector('#photo-viewer-stage'); const now=Date.now; Date.now=()=>1000; s.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,clientX:100,clientY:100,bubbles:true})); s.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,clientX:100,clientY:100,bubbles:true})); Date.now=()=>1200; s.dispatchEvent(new PointerEvent('pointerdown',{pointerId:2,clientX:100,clientY:100,bubbles:true})); s.dispatchEvent(new PointerEvent('pointerup',{pointerId:2,clientX:100,clientY:100,bubbles:true})); Date.now=now; })()`);
assert.ok((await evaluate(`frames[0].document.querySelector('#photo-viewer-image').style.transform`)).includes('scale(2.5)'), 'double tap should enlarge the photo');
await evaluate(`frames[0].document.querySelector('[data-close]').click()`);

await evaluate(`(() => { const w=frames[0],s=w.__mineTest.snapshot(); s.todos=[]; w.__mineTest.setState(s); w.__mineTest.go('today'); w.document.querySelector('#new-todo').click(); })()`);
assert.equal(await evaluate(`frames[0].document.querySelector('#todo-form') !== null`), true);
await evaluate(`(() => { const f=frames[0].document.querySelector('#todo-form'); f.querySelector('[name=title]').value='整理明天的读书笔记'; f.querySelectorAll('[name=date]')[1].checked=true; f.requestSubmit(); })()`);
await new Promise(resolve => setTimeout(resolve, 120));
assert.equal(await evaluate(`frames[0].__mineTest.snapshot().todos.length`), 1);
assert.equal(await evaluate(`frames[0].document.querySelector('.todo-empty').innerText.includes('明天已安排 1 项')`), true);
await evaluate(`frames[0].document.querySelector('#new-todo-empty').click(); (() => { const f=frames[0].document.querySelector('#todo-form'); f.querySelector('[name=title]').value='今天完成的待办'; f.requestSubmit(); })()`);
await new Promise(resolve => setTimeout(resolve, 120));
assert.equal(await evaluate(`frames[0].document.querySelectorAll('.todo-row').length`), 1);
await evaluate(`frames[0].document.querySelector('[data-toggle-todo]').click()`);
await new Promise(resolve => setTimeout(resolve, 120));
assert.equal(await evaluate(`frames[0].__mineTest.snapshot().todos.find(t=>t.title==='今天完成的待办').completed`), true);
let completedTodo = await evaluate(`frames[0].__mineTest.snapshot().todos.find(t=>t.title==='今天完成的待办')`);
assert.ok(completedTodo.completedAt > 0 && /^\d{4}-\d{2}-\d{2}$/.test(completedTodo.completedDate), 'todo completion should persist actual date and time');

await evaluate(`(() => { const w=frames[0],s=w.__mineTest.snapshot(); const day=new Date(),pad=n=>String(n).padStart(2,'0'),key=day.getFullYear()+'-'+pad(day.getMonth()+1)+'-'+pad(day.getDate()); s.checks[key]={}; w.__mineTest.setState(s); w.__mineTest.go('today'); })()`);
await evaluate(`frames[0].document.querySelector('[data-habit=read]').click()`);
assert.equal(await evaluate(`frames[0].document.querySelector('#habit-amount-form') !== null`), true, 'quantity habit should open amount entry instead of adding one');
assert.equal(await evaluate(`frames[0].__mineTest.snapshot().checks[Object.keys(frames[0].__mineTest.snapshot().checks).sort().at(-1)]?.read || 0`), 0);
assert.ok((await evaluate(`frames[0].document.querySelector('.habit-quick-log').innerText`)).includes('+30'));
await evaluate(`frames[0].document.querySelector('[data-habit-amount="10"]').click()`);
await new Promise(resolve => setTimeout(resolve, 100));
assert.equal(await evaluate(`(() => { const s=frames[0].__mineTest.snapshot(),d=new Date(),p=n=>String(n).padStart(2,'0'),k=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); return s.checks[k].read; })()`), 10);
await evaluate(`frames[0].document.querySelector('[data-habit=read]').click(); frames[0].document.querySelector('#adjust-habit-total').click(); (()=>{const f=frames[0].document.querySelector('#habit-total-form');f.querySelector('[name=total]').value='30';f.requestSubmit();})()`);
await new Promise(resolve => setTimeout(resolve, 100));
assert.equal(await evaluate(`frames[0].document.querySelector('[data-habit=read]').classList.contains('done')`), true);
let habitCompletedAt = await evaluate(`(() => { const s=frames[0].__mineTest.snapshot(),d=new Date(),p=n=>String(n).padStart(2,'0'),k=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); return s.habitCompletions[k]?.read || 0; })()`);
assert.ok(habitCompletedAt > 0 && Math.abs(Date.now()-habitCompletedAt) < 10000, 'habit completion should persist the actual completion time');
await evaluate(`(() => { const w=frames[0],s=w.__mineTest.snapshot(),d=new Date(),p=n=>String(n).padStart(2,'0'),k=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); w.__mineTest.setState(s); w.__mineTest.go('calendar',k); })()`);
let completionArchive = await evaluate(`frames[0].document.querySelector('.calendar-timeline').innerText`);
assert.ok(completionArchive.includes('今天完成的待办') && completionArchive.includes('阅读') && !completionArchive.includes('旧版未记录时间'), 'calendar should show completed todos and habits with recorded time');
await evaluate(`frames[0].__mineTest.go('today')`);
await evaluate(`frames[0].document.querySelector('[data-habit=water]').click()`);
await new Promise(resolve => setTimeout(resolve, 80));
assert.equal(await evaluate(`frames[0].document.querySelector('#habit-amount-form') === null`), true, 'tap habit should still increment directly');

await evaluate(`frames[0].document.querySelector('#manage-habits').click(); frames[0].document.querySelector('#new-habit').click()`);
assert.ok((await evaluate(`frames[0].document.querySelectorAll('.habit-icon-picker input').length`)) >= 20);
await evaluate(`(() => { const f=frames[0].document.querySelector('#habit-form'); f.querySelector('[name=name]').value='晨间拉伸'; f.querySelector('[name=target]').value='10'; f.querySelector('[name=unit]').value='分钟'; f.querySelector('[name=icon][value=sports_gymnastics]').checked=true; f.requestSubmit(); })()`);
await new Promise(resolve => setTimeout(resolve, 120));
assert.equal(await evaluate(`frames[0].__mineTest.snapshot().habits.some(h=>h.name==='晨间拉伸'&&h.icon==='sports_gymnastics')`), true);
await evaluate(`frames[0].document.querySelector('[data-habit=read]').click(); frames[0].document.querySelector('#skip-habit-today').click()`);
await new Promise(resolve => setTimeout(resolve, 100));
assert.equal(await evaluate(`frames[0].document.querySelector('[data-unskip-habit=read]') !== null`), true, 'rest day should replace the habit with a reversible rest row');
await evaluate(`frames[0].document.querySelector('[data-unskip-habit=read]').click()`);
await new Promise(resolve => setTimeout(resolve, 100));
assert.equal(await evaluate(`frames[0].document.querySelector('[data-habit=read]') !== null`), true, 'rest day should be reversible');
await evaluate(`frames[0].__mineTest.go('mine')`);
const mineLayout = await evaluate(`(() => { const d=frames[0].document; return { text:d.querySelector('#app').innerText, summary:d.querySelectorAll('.mine-summary article').length, overflow:d.documentElement.scrollWidth>d.documentElement.clientWidth }; })()`);
assert.ok(mineLayout.text.includes('整理我的生活') && mineLayout.text.includes('待办清单'));
assert.equal(mineLayout.summary, 4);
assert.equal(mineLayout.overflow, false, 'redesigned mine view has horizontal overflow');
await evaluate(`frames[0].document.querySelector('#settings-data').click()`);
assert.equal(await evaluate(`frames[0].document.querySelector('#settings-snapshot-list') !== null`), true, 'data settings should expose safety snapshot recovery');
await evaluate(`frames[0].document.querySelector('#settings-snapshot-list').click()`);
assert.equal(await evaluate(`frames[0].document.querySelector('.snapshot-list') !== null`), true);
await evaluate(`frames[0].document.querySelector('#snapshot-back').click(); frames[0].document.querySelector('[data-close]').click()`);

await evaluate(`(() => { const w=frames[0],c=w.document.createElement('canvas'); c.width=4; c.height=2; const x=c.getContext('2d'); x.fillStyle='#d7b39c'; x.fillRect(0,0,2,2); x.fillStyle='#52698f'; x.fillRect(2,0,2,2); return w.__mineTest.openAvatarCrop(c.toDataURL()); })()`);
await new Promise(resolve => setTimeout(resolve, 80));
assert.equal(await evaluate(`(() => { const d=frames[0].document; return Boolean(d.querySelector('#avatar-crop-canvas') && d.querySelector('#avatar-zoom') && d.querySelector('#avatar-crop-apply')); })()`), true, 'avatar should open a visual crop editor');
await evaluate(`(() => { const d=frames[0].document,z=d.querySelector('#avatar-zoom'); z.value='1.8'; z.dispatchEvent(new Event('input')); d.querySelector('#avatar-crop-apply').click(); })()`);
assert.equal(await evaluate(`frames[0].document.querySelector('#profile-form .avatar-preview img')?.src.startsWith('data:image/jpeg;base64,')`), true, 'cropped avatar should return to profile preview');
await evaluate(`frames[0].document.querySelector('#profile-form').requestSubmit()`);
await new Promise(resolve => setTimeout(resolve, 100));
assert.equal(await evaluate(`frames[0].__mineTest.snapshot().profile.avatar.startsWith('data:image/jpeg;base64,')`), true, 'cropped avatar should persist after saving profile');

await evaluate(`(() => { const w=frames[0],s=w.__mineTest.snapshot(); s.snippets=[]; w.__mineTest.setState(s); w.__mineTest.go('today'); w.document.querySelector('#quick-note').click(); })()`);
assert.equal(await evaluate(`frames[0].document.querySelector('#snippet-form [name=type]').value`), 'text');
await evaluate(`(() => { const f=frames[0].document.querySelector('#snippet-form'); f.querySelector('[name=date]').value='2026-08-13'; f.querySelector('[name=text]').value='可用于正式日记的灵感素材'; f.requestSubmit(); })()`);
await new Promise(resolve => setTimeout(resolve, 120));
assert.equal(await evaluate(`frames[0].__mineTest.snapshot().snippets.length`), 1);
await evaluate(`frames[0].__mineTest.go('snippets')`);
let snippets = await evaluate(`(() => { const d=frames[0].document; return { text:d.querySelector('#app').innerText, groups:d.querySelectorAll('.snippet-day').length, overflow:d.documentElement.scrollWidth>d.documentElement.clientWidth }; })()`);
assert.ok(snippets.text.includes('8月13日') && snippets.text.includes('可用于正式日记的灵感素材'));
assert.equal(snippets.groups, 1);
assert.equal(snippets.overflow, false, 'snippets view has horizontal overflow');

await evaluate(`(() => { const w=frames[0],s=w.__mineTest.snapshot(); s.snippets.push({id:'photo-material',type:'photo',date:'2026-08-13',text:'当天的一张照片',photo:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',createdAt:1776056400000,updatedAt:1776056400000}); w.__mineTest.setState(s); })()`);
await evaluate(`frames[0].__mineTest.go('calendar'); frames[0].document.querySelector('#write').click(); frames[0].document.querySelector('#use-snippets').click()`);
assert.equal(await evaluate(`frames[0].document.querySelectorAll('[data-snippet-choice]').length`), 2);
await evaluate(`(() => { const d=frames[0].document; d.querySelectorAll('[data-snippet-choice]').forEach(c => { c.checked=true; c.dispatchEvent(new Event('change')); }); d.querySelector('#import-snippets').click(); })()`);
assert.ok((await evaluate(`frames[0].document.querySelector('#journal-form [name=content]').value`)).includes('可用于正式日记的灵感素材'));
assert.equal(await evaluate(`frames[0].document.querySelectorAll('[data-remove-journal-photo]').length`), 1, 'photo material should be imported');
assert.equal(await evaluate(`frames[0].__mineTest.snapshot().snippets.length`), 2, 'import should keep original snippets');

await evaluate(`frames[0].document.querySelector('[data-close]').click(); frames[0].__mineTest.go('focus'); frames[0].document.querySelector('#project-change').click(); frames[0].document.querySelector('#new-focus-project').click()`);
assert.equal(await evaluate(`frames[0].document.querySelector('#project-form') !== null`), true, 'focus project manager should create projects');
await evaluate(`(() => { const f=frames[0].document.querySelector('#project-form'); f.querySelector('[name=name]').value='高等数学'; f.querySelector('[name=habitId]').value='read'; f.requestSubmit(); })()`);
await new Promise(resolve => setTimeout(resolve, 100));
assert.equal(await evaluate(`frames[0].__mineTest.snapshot().focusProjects.some(p=>p.name==='高等数学'&&p.habitId==='read')`), true, 'project should keep its linked habit');

await evaluate(`(() => { const w=frames[0],s=w.__mineTest.snapshot(),p=s.focusProjects.find(x=>x.name==='高等数学'); s.timer={...s.timer,mode:'stopwatch',projectId:p.id,running:true,startedAt:Date.now()-125000,endAt:null,elapsed:0}; w.__mineTest.setState(s); w.__mineTest.go('focus'); })()`);
await evaluate(`frames[0].document.querySelector('#finish').click()`);
await new Promise(resolve => setTimeout(resolve, 120));
let focusSync = await evaluate(`(() => { const s=frames[0].__mineTest.snapshot(),d=new Date(),p=n=>String(n).padStart(2,'0'),k=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()),x=s.sessions.at(-1); return {id:x.id,minutes:x.minutes,habitMinutes:x.habitMinutes,count:s.checks[k].read}; })()`);
assert.deepEqual([focusSync.minutes,focusSync.habitMinutes,focusSync.count], [2,2,32], 'stopwatch completion should add actual minutes to linked habit');
await evaluate(`frames[0].__mineTest.go('calendar'); frames[0].document.querySelector('[data-calendar-event="session:${focusSync.id}"]').click(); (()=>{const f=frames[0].document.querySelector('#session-form');f.querySelector('[name=minutes]').value='5';f.requestSubmit();})()`);
await new Promise(resolve => setTimeout(resolve, 120));
assert.equal(await evaluate(`(() => { const s=frames[0].__mineTest.snapshot(),d=new Date(),p=n=>String(n).padStart(2,'0'),k=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); return s.checks[k].read; })()`), 35, 'editing a session should apply only the habit-minute difference');
await evaluate(`frames[0].document.querySelector('[data-calendar-event="session:${focusSync.id}"]').click(); frames[0].document.querySelector('[data-delete-session="${focusSync.id}"]').click(); frames[0].document.querySelector('#confirm-delete').click()`);
await new Promise(resolve => setTimeout(resolve, 120));
assert.equal(await evaluate(`(() => { const s=frames[0].__mineTest.snapshot(),d=new Date(),p=n=>String(n).padStart(2,'0'),k=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); return s.checks[k].read; })()`), 30, 'deleting a session should keep the manually logged habit amount');

await evaluate(`frames[0].document.querySelector('[data-close]').click(); frames[0].__mineTest.go('focus'); frames[0].document.querySelector('[data-timer-mode=pomodoro]').click()`);
let timer = await evaluate(`(() => { const s=frames[0].__mineTest.snapshot(); const d=frames[0].document; return { mode:s.timer.mode, phase:s.timer.phase, round:s.timer.round, duration:s.timer.duration, text:d.querySelector('.timer-card').innerText, overflow:d.documentElement.scrollWidth>d.documentElement.clientWidth }; })()`);
assert.deepEqual([timer.mode,timer.phase,timer.round,timer.duration], ['pomodoro','focus',1,1500]);
assert.ok(timer.text.includes('第 1/4 轮'));
assert.equal(timer.overflow, false, 'pomodoro view has horizontal overflow');
await evaluate(`frames[0].document.querySelector('#finish').click()`);
await new Promise(resolve => setTimeout(resolve, 120));
assert.deepEqual(await evaluate(`(() => { const t=frames[0].__mineTest.snapshot().timer; return [t.mode,t.phase,t.round,t.duration,t.running]; })()`), ['pomodoro','shortBreak',1,300,false]);

await evaluate(`(() => { const w=frames[0],s=w.__mineTest.snapshot(); s.settings.notificationsEnabled=true; s.timer={...s.timer,mode:'pomodoro',phase:'shortBreak',round:1,duration:1,left:1,running:true,startedAt:Date.now()-1000,endAt:Date.now()-20}; w.__mineTest.setState(s); })()`);
await new Promise(resolve => setTimeout(resolve, 180));
assert.equal(await evaluate(`frames[0].document.querySelector('.alarm-modal h2').textContent`), '短休息结束');
assert.ok((await evaluate(`frames[0].document.querySelector('.alarm-modal').innerText`)).includes('直到你手动停止'));
assert.equal(await evaluate(`frames[0].__mineTest.snapshot().timer.phase`), 'focus', 'rest completion should advance to the next focus phase');
assert.equal(await evaluate(`frames[0].document.querySelector('#modal-layer').click(); frames[0].document.querySelector('.alarm-modal') !== null`), true, 'alarm must not close from the backdrop');
await evaluate(`frames[0].document.querySelector('#stop-completion-alarm').click()`);
await new Promise(resolve => setTimeout(resolve, 80));
assert.equal(await evaluate(`!frames[0].document.querySelector('#modal-layer').classList.contains('open')`), true);

await evaluate(`frames[0].__mineTest.go('focus'); frames[0].document.querySelector('[data-timer-mode=free]').click(); frames[0].document.querySelector('#custom-duration').click()`);
assert.equal(await evaluate(`frames[0].document.querySelector('#duration-form') !== null`), true);
await evaluate(`(() => { const f=frames[0].document.querySelector('#duration-form'); f.querySelector('[name=hours]').value='1'; f.querySelector('[name=minutes]').value='2'; f.querySelector('[name=seconds]').value='3'; f.requestSubmit(); })()`);
await new Promise(resolve => setTimeout(resolve, 120));
timer = await evaluate(`(() => { const d=frames[0].document; const s=frames[0].__mineTest.snapshot(); return { duration:s.timer.duration, value:d.querySelector('#timer-value').textContent, custom:d.querySelector('#custom-duration').innerText, overflow:d.documentElement.scrollWidth>d.documentElement.clientWidth, bottom:d.querySelector('.timer-card').getBoundingClientRect().bottom, viewport:d.documentElement.clientHeight }; })()`);
assert.equal(timer.duration, 3723);
assert.equal(timer.value, '01:02:03');
assert.ok(timer.custom.includes('1小时 2分钟 3秒'));
assert.equal(timer.overflow, false, 'focus custom duration has horizontal overflow');
assert.ok(timer.bottom <= timer.viewport - 90, `focus controls should stay above the bottom navigation (${timer.bottom}px > ${timer.viewport - 90}px)`);

await evaluate(`frames[0].__mineTest.go('today'); frames[0].document.querySelector('#manage-habits').click()`);
assert.equal(await evaluate(`frames[0].document.querySelector('#modal-layer').classList.contains('open')`), true);
await evaluate(`frames[0].document.querySelector('[data-close]').click(); frames[0].__mineTest.go('calendar'); frames[0].document.querySelector('#new-session').click()`);
assert.equal(await evaluate(`frames[0].document.querySelector('#session-form') !== null`), true);
await evaluate(`frames[0].document.querySelector('[data-close]').click(); frames[0].document.querySelector('#write').click()`);
assert.equal(await evaluate(`frames[0].document.querySelector('#journal-form') !== null`), true);
assert.equal(await evaluate(`frames[0].document.querySelectorAll('[name=mood]').length`), 7);
assert.equal(await evaluate(`frames[0].document.querySelectorAll('[name=weather]').length`), 8);
assert.equal(await evaluate(`frames[0].document.querySelector('#add-journal-photos') !== null`), true);
assert.equal(await evaluate(`frames[0].document.querySelectorAll('[data-clear-journal-choice]').length`), 2);
await evaluate(`(() => { const f=frames[0].document.querySelector('#journal-form'); f.querySelector('[name=mood][value=calm]').checked=true; f.querySelector('[name=weather][value=cloudy]').checked=true; f.querySelector('[name=content]').value='今天很平静'; f.requestSubmit(); })()`);
await new Promise(resolve => setTimeout(resolve, 120));
let journal = await evaluate(`(() => { const s=frames[0].__mineTest.snapshot(); const j=s.journals[Object.keys(s.journals).sort().at(-1)]; return { mood:j.mood, weather:j.weather, content:j.content, detail:frames[0].document.querySelector('.rich-journal')?.innerText, overflow:frames[0].document.documentElement.scrollWidth>frames[0].document.documentElement.clientWidth }; })()`);
assert.deepEqual([journal.mood, journal.weather, journal.content], ['calm', 'cloudy', '今天很平静']);
assert.ok(journal.detail.includes('平静') && journal.detail.includes('多云'));
assert.equal(journal.overflow, false, 'rich journal detail has horizontal overflow');
await evaluate(`frames[0].document.querySelector('[data-edit-journal]').click()`);
assert.equal(await evaluate(`frames[0].document.querySelector('[name=mood][value=calm]').checked`), true);
await evaluate(`(() => { const d=frames[0].document; d.querySelector('[data-clear-journal-choice=mood]').click(); d.querySelector('[data-clear-journal-choice=weather]').click(); d.querySelector('#journal-form').requestSubmit(); })()`);
await new Promise(resolve => setTimeout(resolve, 120));
assert.deepEqual(await evaluate(`(() => { const s=frames[0].__mineTest.snapshot(); const j=s.journals[Object.keys(s.journals).sort().at(-1)]; return [j.mood,j.weather]; })()`), ['', '']);
await evaluate(`(() => { const s=frames[0].__mineTest.snapshot(); s.journals['2025-01-02']={content:'历史日期测试',mood:'happy',weather:'sunny',photos:[],updatedAt:1}; s.route='mine'; frames[0].__mineTest.setState(s); frames[0].document.querySelector('#journal-history-mine').click(); })()`);
await evaluate(`frames[0].document.querySelector('[data-open-journal="2025-01-02"]').click()`);
assert.equal(await evaluate(`frames[0].__mineTest.snapshot().route !== 'calendar' && Boolean(frames[0].document.querySelector('#subpage-journal-reader.active #journal-reader-edit'))`), true, 'journal history should open the reader instead of the calendar');
await evaluate(`(() => { const w=frames[0]; w.__mineOriginalSetItem=w.Storage.prototype.setItem; w.Storage.prototype.setItem=() => { throw new Error('空间不足'); }; w.document.querySelector('#journal-reader-edit').click(); const f=w.document.querySelector('#journal-form'); f.querySelector('[name=content]').value='失败后仍保留'; f.requestSubmit(); })()`);
await new Promise(resolve => setTimeout(resolve, 120));
const failedSave = await evaluate(`(() => { const d=frames[0].document; return { open:d.querySelector('#modal-layer').classList.contains('open'), value:d.querySelector('#journal-form [name=content]')?.value, toast:d.querySelector('#toast').textContent, stored:frames[0].__mineTest.snapshot().journals['2025-01-02'].content }; })()`);
assert.equal(failedSave.open, true, 'failed save should keep journal editor open');
assert.equal(failedSave.value, '失败后仍保留');
assert.equal(failedSave.stored, '历史日期测试', 'failed save should roll in-memory journal back');
assert.ok(failedSave.toast.includes('保存失败') && failedSave.toast.includes('空间不足'));
assert.equal(failedSave.toast.includes('已保存'), false);
await evaluate(`frames[0].Storage.prototype.setItem=frames[0].__mineOriginalSetItem; delete frames[0].__mineOriginalSetItem; frames[0].document.querySelector('[data-close]').click()`);
await evaluate(`frames[0].__mineTest.go('mine'); frames[0].document.querySelector('#edit-profile').click()`);
assert.equal(await evaluate(`frames[0].document.querySelector('#profile-form') !== null`), true);
assert.equal(await evaluate(`frames[0].document.querySelector('#pick-avatar') !== null`), true);
await evaluate(`(() => { const f=frames[0].document.querySelector('#profile-form'); f.querySelector('[name=name]').value='头像测试'; f.requestSubmit(); })()`);
await new Promise(resolve => setTimeout(resolve, 120));
assert.equal(await evaluate(`frames[0].__mineTest.snapshot().profile.name`), '头像测试');
await evaluate(`frames[0].__mineTest.go('today')`);
assert.ok((await evaluate(`frames[0].document.querySelector('.portrait').textContent`)).includes('试'));
await evaluate(`(() => { frames[0].document.querySelector('[data-close]').click(); const s=frames[0].__mineTest.snapshot(); s.media=[]; s.route='mine'; frames[0].__mineTest.setState(s); frames[0].document.querySelector('#open-library').click(); })()`);
let library = await evaluate(`(() => { const d=frames[0].document; return { text:d.querySelector('#app').innerText, overflow:d.documentElement.scrollWidth>d.documentElement.clientWidth, empty:Boolean(d.querySelector('#new-media-empty')) }; })()`);
assert.ok(library.text.includes('你的书架还是空的'));
assert.equal(library.overflow, false, 'library empty state has horizontal overflow');
assert.equal(library.empty, true);
await evaluate(`frames[0].document.querySelector('#new-media-empty').click()`);
assert.equal(await evaluate(`frames[0].document.querySelector('#media-form') !== null`), true);
await evaluate(`(() => { const f=frames[0].document.querySelector('#media-form'); f.querySelector('[name=title]').value='测试电影'; f.querySelector('[name=status]').value='completed'; f.querySelector('[name=status]').dispatchEvent(new Event('change',{bubbles:true})); f.querySelector('[name=rating]').value='4'; f.requestSubmit(); })()`);
await new Promise(resolve => setTimeout(resolve, 120));
library = await evaluate(`(() => { const d=frames[0].document; return { text:d.querySelector('#app').innerText, cards:d.querySelectorAll('.media-card').length, overflow:d.documentElement.scrollWidth>d.documentElement.clientWidth }; })()`);
assert.ok(library.text.includes('测试电影'));
assert.equal(library.cards, 1);
assert.equal(library.overflow, false, 'library populated state has horizontal overflow');

socket.close();
console.log('Five main routes, media shelf states, overflow checks, and core editor entry points passed.');
