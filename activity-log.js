import { habitProgressForDate, TASTE_VERDICTS } from './model.js';

const pad = value => String(value).padStart(2, '0');
const dayOf = timestamp => { const date=new Date(timestamp); return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`; };
const timestampOf = value => {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};
const sessionMinutes = session => {
  const seconds = Number(session?.durationSeconds);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds / 60) : Math.max(0, Number(session?.minutes) || 0);
};

export function rebuildActivityLog(state) {
  const events=[];
  for(const session of state.sessions||[]) {
    const timestamp = timestampOf(session.startedAt || session.endedAt);
    const minutes = sessionMinutes(session);
    events.push(event({ id:`session:${session.id}`, kind:'focus', date:session.date || dayOf(timestamp), timestamp, title:session.task || session.category || '专注记录', summary:session.detail || `${minutes}分钟 · ${session.mode || 'focus'}`, sourceId:session.id, value:minutes, projectId:session.projectId || session.categoryId, mediaId:session.mediaId }));
  }
  for(const todo of state.todos||[]) if(todo.completed&&todo.completedAt) events.push(event({id:`todo:${todo.id}`,kind:'todo',date:todo.completedDate||dayOf(todo.completedAt),timestamp:todo.completedAt,title:todo.title,summary:'已完成',sourceId:todo.id}));
  for(const [date,values] of Object.entries(state.habitCompletions||{})) for(const [habitId,timestamp] of Object.entries(values)){const habit=state.habits.find(item=>item.id===habitId);if(habit)events.push(event({id:`habit:${date}:${habitId}`,kind:'habit',date,timestamp,title:habit.name,summary:`完成 ${habitProgressForDate(state,habit,date)}${habit.unit}`,sourceId:habitId}));}
  for(const snippet of state.snippets||[]) events.push(event({id:`snippet:${snippet.id}`,kind:snippet.type==='photo'?'photo':'note',date:snippet.date,timestamp:snippet.createdAt,title:snippet.type==='photo'?'随手拍':'随手记',summary:snippet.text||(snippet.photos?.length>1?`保存了 ${snippet.photos.length} 张照片`:'保存了一张照片'),sourceId:snippet.id,media:(snippet.photos?.[0])||snippet.photo||''}));
  for(const taste of state.tasteEntries||[]) events.push(event({id:`taste:${taste.id}`,kind:'taste',date:taste.date,timestamp:taste.createdAt,title:taste.name,summary:[TASTE_VERDICTS[taste.verdict]?.label,taste.placeName||taste.brand].filter(Boolean).join(' · '),sourceId:taste.id,media:taste.photos?.[0]||''}));
  for(const [date,journal] of Object.entries(state.journals||{})) events.push(event({id:`journal:${date}`,kind:'journal',date,timestamp:journal.updatedAt,title:'生活日记',summary:String(journal.content||'').slice(0,80)||'记录了心情与生活',sourceId:date}));
  // 版本更新只显示刚升级到的那一版（settings.timelineRelease*）。
  // state.releases 里的历史说明保留给「更新记录」，不回放进生活流。
  const timelineCode = Math.floor(Number(state.settings?.timelineReleaseCode) || 0);
  const timelineDate = String(state.settings?.timelineReleaseDate || '');
  if (timelineCode > 0 && /^\d{4}-\d{2}-\d{2}$/.test(timelineDate)) {
    const release = (state.releases || []).find(item => Number(item.code) === timelineCode);
    if (release) {
      const timestamp = Number(state.settings?.timelineReleaseAt) || release.createdAt;
      events.push(event({ id:`release:${release.code}`, kind:'release', date:timelineDate, timestamp, title:release.title || `更新到 ${release.versionName}`, summary:release.summary, sourceId:String(release.code) }));
    }
  }
  for(const item of state.media||[]) if(item.status==='completed') events.push(event({id:`media:${item.id}`,kind:item.type,date:item.completedDate||dayOf(item.updatedAt),timestamp:item.updatedAt,title:item.title,summary:item.rating?`${item.rating} 星`:'已完成',sourceId:item.id,media:item.poster||''}));
  for (const transaction of state.transactions || []) {
    const timestamp = timestampOf(transaction.createdAt || transaction.date);
    if (transaction.type === 'calibrate') {
      events.push(event({ id:`transaction:${transaction.id}`, kind:'calibrate', date:transaction.date || dayOf(timestamp), timestamp, title:'账户平账', summary:transaction.reasonTag || transaction.note || '余额校准', sourceId:transaction.id, value:0 }));
      continue;
    }
    if (transaction.type === 'transfer') events.push(event({ id:`transaction:${transaction.id}`, kind:'transfer', date:transaction.date || dayOf(timestamp), timestamp, title:'账户转账', summary:transaction.note || '账户间资金转移', sourceId:transaction.id, value:0 }));
    else if (['expense', 'income'].includes(transaction.type)) events.push(event({ id:`transaction:${transaction.id}`, kind:transaction.type, date:transaction.date || dayOf(timestamp), timestamp, title:transaction.note || (transaction.type === 'expense' ? '支出记录' : '收入记录'), summary:`${transaction.type === 'expense' ? '支出' : '收入'} ¥${Number(transaction.amount || 0).toFixed(2)}`, sourceId:transaction.id, value:Number(transaction.amount) || 0 }));
  }
  return events.filter(item=>item.date&&item.timestamp).sort((a,b)=>b.timestamp-a.timestamp);
}
export function activityForDate(state,date,kind='all'){return rebuildActivityLog(state).filter(item=>item.date===date&&(kind==='all'||item.kind===kind));}
function event(input){return{id:String(input.id),kind:String(input.kind),date:String(input.date||''),timestamp:timestampOf(input.timestamp),title:String(input.title||''),summary:String(input.summary||''),sourceId:String(input.sourceId||''),value:Number(input.value)||0,projectId:String(input.projectId||''),mediaId:String(input.mediaId||''),media:String(input.media||'')};}
