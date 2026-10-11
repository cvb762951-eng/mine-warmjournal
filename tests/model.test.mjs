import assert from 'node:assert/strict';
import test from 'node:test';
import { SCHEMA_VERSION, HABIT_HEAD_MAX_SECONDS, habitHeadLimit, activeStreak, calculateFlowScore, calibrateLedgerAccount, habitGoalMet, habitHeatmapData, habitProgressForDate, habitsForDate, journalEntries, ledgerSummary, makeDefaultState, makeFocusProject, makeHabit, makeMediaEntry, makeSnippet, makeTodo, makeTransaction, mediaEntries, migrateState, nextPomodoroStage, periodSummary, pomodoroPhaseSeconds, previousCompleteWeekRange, snippetEntries, todayCompletion, todosForDate } from '../model.js';
import { activityForDate, rebuildActivityLog } from '../activity-log.js';
import { focusInsights, mediaFocusSummary, projectGoalSummary } from '../analytics.js';

test('legacy demo data migrates to the current schema without fake sessions', () => {
  const defaults = makeDefaultState(new Date('2026-08-13T10:00:00'));
  const migrated = migrateState({
    habits: [{ id: 'read', name: '阅读', icon: 'menu_book', goal: '0/30 分钟' }],
    sessions: [
      { id: 'a', date: '2026-08-06', minutes: 120, task: '深度阅读', detail: '心理学导论 第3章', category: 'read' },
      { id: 'user-record', date: '2026-08-12', minutes: 20, task: '我的记录', detail: '', category: 'work' }
    ],
    journals: { '2026-08-12': '真实日记' }
  }, defaults);
  assert.equal(migrated.meta.schemaVersion, SCHEMA_VERSION);
  assert.equal(migrated.sessions.length, 1);
  assert.equal(migrated.sessions[0].task, '我的记录');
  assert.equal(migrated.habits[0].target, 30);
  assert.equal(migrated.habits[0].unit, '分钟');
  assert.equal(migrated.habits[0].tracking, 'quantity');
  assert.equal(migrated.journals['2026-08-12'].content, '真实日记');
});

test('older state migrates to the current schema with unified events, media references, private vault, habit skips and background defaults', () => {
  const migrated = migrateState({ habits: [], sessions: [], journals: {} });
  assert.equal(migrated.meta.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(migrated.media, []);
  assert.deepEqual(migrated.snippets, []);
  assert.deepEqual(migrated.todos, []);
  assert.deepEqual(migrated.habitSkips, {});
  assert.deepEqual([
    migrated.settings.pomodoroFocusMinutes,
    migrated.settings.pomodoroShortBreakMinutes,
    migrated.settings.pomodoroLongBreakMinutes,
    migrated.settings.pomodoroRounds
  ], [25, 5, 15, 4]);
  assert.equal(migrated.settings.backgroundImage, '');
  assert.equal(migrated.settings.todayCoverImage, '');
  assert.equal(migrated.settings.backgroundOverlayOpacity, 72);
  assert.equal(migrated.settings.backgroundFit, 'contain');
  assert.equal(migrated.settings.backgroundZoom, 1);
  assert.equal(migrated.settings.backgroundOffsetX, 0);
  assert.equal(migrated.settings.backgroundOffsetY, 0);
  assert.equal(migrated.settings.timetable.courses.length, 14);
  assert.equal(migrated.settings.timetable.totalWeeks, 18);
  assert.equal(migrateState({ settings: { backgroundOverlayOpacity: -1 } }).settings.backgroundOverlayOpacity, 0);
  assert.equal(migrateState({ settings: { backgroundOverlayOpacity: 999 } }).settings.backgroundOverlayOpacity, 100);
  assert.equal(migrateState({ settings: { backgroundFit: 'contain' } }).settings.backgroundFit, 'contain');
  assert.equal(migrateState({ settings: { backgroundFit: 'cover' } }).settings.backgroundFit, 'cover');
  assert.equal(migrateState({ settings: { backgroundFit: 'stretch' } }).settings.backgroundFit, 'contain');
  assert.equal(migrateState({ settings: { backgroundZoom: 0.3 } }).settings.backgroundZoom, 0.5);
  assert.equal(migrateState({ settings: { backgroundZoom: 3 } }).settings.backgroundZoom, 2);
  assert.equal(migrateState({ settings: { backgroundZoom: 'abc' } }).settings.backgroundZoom, 1);
  assert.equal(migrateState({ settings: { backgroundOffsetX: 5 } }).settings.backgroundOffsetX, 1);
  assert.equal(migrateState({ settings: { backgroundOffsetY: -5 } }).settings.backgroundOffsetY, -1);
  assert.equal(migrateState({ settings: { backgroundOffsetX: 'abc' } }).settings.backgroundOffsetX, 0);
  // 私密视频的「习惯裁掉开头 N 秒」（2026-10-10）：整数秒 0 ~ HABIT_HEAD_MAX_SECONDS（=20）。
  // 超范围或非数字一律当 0（不自动裁）—— 否则一条脏数据能把每段视频的开头都吃掉。
  assert.equal(makeDefaultState().settings.vaultTrimHeadSeconds, 0);
  assert.equal(migrateState({ settings: { vaultTrimHeadSeconds: 4 } }).settings.vaultTrimHeadSeconds, 4);
  assert.equal(migrateState({ settings: { vaultTrimHeadSeconds: -3 } }).settings.vaultTrimHeadSeconds, 0);
  // 2026-10-10 用户提的"太短了"，上限从 10 提到 20 —— 15 秒这种原来会被压掉的值得留下来。
  assert.equal(migrateState({ settings: { vaultTrimHeadSeconds: 15 } }).settings.vaultTrimHeadSeconds, 15, '提到 20 之后 15 秒是合法值，不能再被压成 10');
  assert.equal(HABIT_HEAD_MAX_SECONDS, 20, '上限的口径写在这里，其他地方一律引用');
  assert.equal(migrateState({ settings: { vaultTrimHeadSeconds: 999 } }).settings.vaultTrimHeadSeconds, HABIT_HEAD_MAX_SECONDS);
  assert.equal(migrateState({ settings: { vaultTrimHeadSeconds: 'abc' } }).settings.vaultTrimHeadSeconds, 0);
  assert.equal(migrateState({ settings: {} }).settings.vaultTrimHeadSeconds, 0, '老数据没有这个字段时不能崩，默认不自动裁');
  const defaults = makeDefaultState();
  assert.equal(defaults.settings.backgroundFit, 'contain');
  assert.equal(defaults.settings.backgroundZoom, 1);
  assert.equal(defaults.settings.backgroundOffsetX, 0);
  assert.equal(defaults.settings.backgroundOffsetY, 0);
  assert.deepEqual(defaults.settings.ledgerLastUsed, { accountId: '', category: '', type: 'expense' });
  assert.deepEqual(migrateState({ settings: { ledgerLastUsed: { accountId: '  wx ', category: 'restaurant', type: 'transfer' } } }).settings.ledgerLastUsed, { accountId: 'wx', category: 'restaurant', type: 'transfer' });
  assert.deepEqual(migrateState({ settings: { ledgerLastUsed: { type: 'invalid' } } }).settings.ledgerLastUsed, { accountId: '', category: '', type: 'expense' });
  assert.deepEqual(migrateState({}).settings.ledgerLastUsed, { accountId: '', category: '', type: 'expense' });
  assert.deepEqual(migrateState({ settings: { aiWeekSummary: { start: '2026-08-10', end: '2026-08-16', text: '本周小结', generatedAt: 1755300000000 } } }).settings.aiWeekSummary, { start: '2026-08-10', end: '2026-08-16', text: '本周小结', generatedAt: 1755300000000 });
  assert.deepEqual(migrateState({ settings: { aiWeekSummary: { weekStart: '2026-08-10', text: '旧小结' } } }).settings.aiWeekSummary, { start: '2026-08-10', end: '', text: '旧小结', generatedAt: 0 });
  assert.deepEqual(migrateState({}).settings.aiWeekSummary, { start: '', end: '', text: '', generatedAt: 0 });
  assert.equal(defaults.habits.find(habit => habit.id === 'read').tracking, 'quantity');
  assert.equal(defaults.habits.find(habit => habit.id === 'water').tracking, 'tap');
});

test('habit head-trim ceiling is 20s and never eats more than half a clip', () => {
  // 用户 2026-10-10 提的「习惯性开头裁剪太短了」：上限 10 → 20 秒。
  // 规则只有这一处定义，滑块上限 / 落库校验 / 读回校验全部引用它。
  assert.equal(HABIT_HEAD_MAX_SECONDS, 20);
  // 2 分钟以上的片子能用满 20 秒（这条是关键：上限提上去必须真的够得着）
  assert.equal(habitHeadLimit(120), 20);
  assert.equal(habitHeadLimit(60), 20);
  assert.equal(habitHeadLimit(40), 20, '正好 40 秒（一半 = 20）就该能用满');
  assert.equal(habitHeadLimit(39), 19);
  // 短片最多砍一半 —— 否则滑块能拖到 20 秒，实际起点却被夹回头部，"手柄指 20、读数 0:01"
  assert.equal(habitHeadLimit(30), 15);
  assert.equal(habitHeadLimit(6), 3);
  // 再短的片子也要留一个至少 1 秒的可达区间，不能算出 0（0 会让滑块整条失效）
  assert.equal(habitHeadLimit(1.6), 1);
  assert.equal(habitHeadLimit(0), HABIT_HEAD_MAX_SECONDS, '时长还没读到时按上限给，别把滑块禁用');
  assert.equal(habitHeadLimit(NaN), HABIT_HEAD_MAX_SECONDS);
});

test('todos keep today and tomorrow items, filter invalid titles and sort unfinished first', () => {
  const migrated = migrateState({ todos: [
    makeTodo({ id: 'done', date: '2026-08-13', title: '已完成事项', completed: true, createdAt: 1 }),
    makeTodo({ id: 'open', date: '2026-08-13', title: '今天事项', createdAt: 2 }),
    makeTodo({ id: 'tomorrow', date: '2026-08-14', title: '明天事项', createdAt: 3 }),
    makeTodo({ id: 'empty', date: '2026-08-13', title: '   ', createdAt: 4 })
  ] });
  assert.deepEqual(todosForDate(migrated, '2026-08-13').map(todo => todo.id), ['open', 'done']);
  assert.deepEqual(todosForDate(migrated, '2026-08-14').map(todo => todo.id), ['tomorrow']);
});

test('completed todos keep completion date and time while old records get a stable fallback', () => {
  const completedAt = new Date('2026-08-13T09:42:00').getTime();
  const state = migrateState({ todos: [
    { id: 'new', date: '2026-08-14', title: '提前完成', completed: true, completedAt, completedDate: '2026-08-13' },
    { id: 'old', date: '2026-08-12', title: '旧版完成项', completed: true, updatedAt: new Date('2026-08-12T18:20:00').getTime() }
  ] });
  assert.equal(state.todos[0].completedDate, '2026-08-13');
  assert.equal(state.todos[0].completedAt, completedAt);
  assert.equal(state.todos[1].completedDate, '2026-08-12');
  assert.ok(state.todos[1].completedAt > 0);
});

test('journal v4 migration preserves legacy text and validates mood and weather', () => {
  const migrated = migrateState({ journals: {
    '2026-08-10': ' 旧文字日记 ',
    '2026-08-11': { content: '合法枚举', mood: 'happy', weather: 'sunny', photos: [], updatedAt: 42 },
    '2026-08-12': { content: '非法枚举', mood: 'excited', weather: 'hail', photos: [], updatedAt: 43 }
  } });

  assert.deepEqual(migrated.journals['2026-08-10'], {
    content: '旧文字日记',
    mood: '',
    weather: '',
    photos: [],
    tags: [],
    summary: '',
    updatedAt: new Date('2026-08-10T12:00:00').getTime()
  });
  assert.equal(migrated.journals['2026-08-11'].mood, 'happy');
  assert.equal(migrated.journals['2026-08-11'].weather, 'sunny');
  assert.equal(migrated.journals['2026-08-12'].mood, '');
  assert.equal(migrated.journals['2026-08-12'].weather, '');
});

test('journal v4 keeps photo-only entries, filters invalid sources and keeps a 60-photo journal album', () => {
  const localPhotos = Array.from({ length: 61 }, (_, index) => `data:image/jpeg;base64,cGhvdG8t${index}`);
  const migrated = migrateState({ journals: {
    '2026-08-13': {
      content: '',
      mood: '',
      weather: '',
      photos: [
        ...localPhotos,
        'https://example.com/photo.jpg',
        'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==',
        'not-an-image'
      ],
      updatedAt: 44
    },
    '2026-08-14': { content: '', mood: '', weather: '', photos: ['https://example.com/only-external.jpg'] }
  } });

  assert.ok(migrated.journals['2026-08-13'], '仅含本地照片的日记应保留');
  assert.deepEqual(migrated.journals['2026-08-13'].photos, localPhotos.slice(0, 60));
  assert.equal(migrated.journals['2026-08-14'], undefined, '过滤后为空的日记不应保留');
});

test('journal search matches date, body, mood and weather labels', () => {
  const state = migrateState({ journals: {
    '2026-08-10': { content: '读完了百年孤独', mood: 'fulfilled', weather: 'cloudy', photos: [] },
    '2026-08-11': { content: '散步二十分钟', mood: 'calm', weather: 'rainy', photos: [] },
    '2026-08-12': { content: '整理工作台', mood: 'tired', weather: 'storm', photos: [] }
  } });

  assert.deepEqual(journalEntries(state).map(entry => entry.date), ['2026-08-12', '2026-08-11', '2026-08-10']);
  assert.deepEqual(journalEntries(state, '2026-08-11').map(entry => entry.date), ['2026-08-11']);
  assert.deepEqual(journalEntries(state, '百年孤独').map(entry => entry.date), ['2026-08-10']);
  assert.deepEqual(journalEntries(state, '满足').map(entry => entry.date), ['2026-08-10']);
  assert.deepEqual(journalEntries(state, '雷雨').map(entry => entry.date), ['2026-08-12']);
  assert.deepEqual(journalEntries(state, '不存在').map(entry => entry.date), []);
});

test('profile migration preserves valid local avatars and rejects external URLs', () => {
  const local = migrateState({ profile: { name: '我', avatar: 'data:image/jpeg;base64,dGVzdA==' } });
  const external = migrateState({ profile: { name: '我', avatar: 'https://example.com/avatar.jpg' } });
  assert.equal(local.profile.avatar, 'data:image/jpeg;base64,dGVzdA==');
  assert.equal(external.profile.avatar, '');
});

test('media entries normalize fields and support type, status and text filters', () => {
  const state = makeDefaultState();
  state.media = [
    makeMediaEntry({ id: 'movie', type: 'movie', title: '海边的曼彻斯特', status: 'completed', completedDate: '2026-08-12', rating: 5, notes: '克制的悲伤', updatedAt: 20 }),
    makeMediaEntry({ id: 'book', type: 'book', title: '百年孤独', status: 'in_progress', completedDate: '2026-08-10', rating: 4, notes: '正在阅读', updatedAt: 10 })
  ];
  assert.equal(state.media[1].completedDate, '');
  assert.equal(state.media[1].rating, 0);
  assert.deepEqual(mediaEntries(state, { type: 'movie' }).map(entry => entry.id), ['movie']);
  assert.deepEqual(mediaEntries(state, { status: 'in_progress', search: '阅读' }).map(entry => entry.id), ['book']);
});

test('habit schedule, completion and streak use real data', () => {
  const state = makeDefaultState(new Date('2026-08-13T10:00:00'));
  state.habits[0].repeatDays = [4];
  state.habits[1].repeatDays = [1];
  state.habits[0].target = 2;
  state.checks['2026-08-13'] = { water: 2 };
  state.checks['2026-08-12'] = { water: 1 };
  state.sessions.push({ id: 's', date: '2026-08-11', minutes: 30, task: '工作', detail: '', category: 'work' });
  assert.deepEqual(habitsForDate(state, '2026-08-13').map(item => item.id), ['water']);
  assert.deepEqual(todayCompletion(state, '2026-08-13'), { done: 1, total: 1, percent: 100 });
  assert.equal(activeStreak(state, '2026-08-13'), 3);
});

test('weekly and range habits aggregate safely and rest days do not break streaks', () => {
  const state = makeDefaultState(new Date('2026-08-13T10:00:00'));
  const weekly = makeHabit({ id: 'weekly-read', name: '每周阅读', target: 120, unit: '分钟', tracking: 'quantity', goalPeriod: 'weekly' });
  const sleep = makeHabit({ id: 'sleep', name: '睡眠', target: 7, targetMax: 9, unit: '小时', tracking: 'quantity', goalType: 'range' });
  state.habits = [weekly, sleep];
  state.checks = {
    '2026-08-11': { 'weekly-read': 30 },
    '2026-08-12': { 'weekly-read': 45 },
    '2026-08-13': { 'weekly-read': 45, sleep: 8 }
  };
  state.habitSkips = { '2026-08-10': ['sleep'] };
  assert.equal(habitProgressForDate(state, weekly, '2026-08-13'), 120);
  assert.equal(habitGoalMet(weekly, 120), true);
  assert.equal(habitGoalMet(sleep, 8), true);
  assert.equal(habitGoalMet(sleep, 10), false);
  assert.equal(activeStreak(state, '2026-08-13'), 4);
  assert.deepEqual(habitsForDate(state, '2026-08-10').map(item => item.id), ['weekly-read']);
});

test('expired running timers survive migration for boot-time completion', () => {
  const defaults = makeDefaultState(new Date('2026-08-13T10:00:00'));
  const migrated = migrateState({ timer: { duration: 60, left: 10, running: true, endAt: Date.now() - 1000, startedAt: Date.now() - 61000, task: '测试', category: 'work' } }, defaults);
  assert.equal(migrated.timer.running, true);
  assert.equal(migrated.timer.left, 0);
  assert.ok(migrated.timer.endAt < Date.now());
});

test('custom timer migration preserves one-second and all-day durations', () => {
  const oneSecond = migrateState({ timer: { duration: 1, left: 1, task: '呼吸', category: 'relax' } });
  const longTimer = migrateState({ timer: { duration: 86399, left: 86399, task: '长时任务', category: 'work' } });
  assert.equal(oneSecond.timer.duration, 1);
  assert.equal(oneSecond.timer.left, 1);
  assert.equal(longTimer.timer.duration, 86399);
  assert.equal(longTimer.timer.left, 86399);
});

test('snippet migration keeps dated text and local photos, then groups through filters', () => {
  const photo = 'data:image/jpeg;base64,c25pcHBldA==';
  const state = migrateState({ snippets: [
    { id: 't1', type: 'text', date: '2026-08-12', text: '路上想到的句子', createdAt: 10 },
    { id: 'p1', type: 'photo', date: '2026-08-13', text: '晚霞', photo, createdAt: 20 },
    { id: 'bad', type: 'photo', date: '2026-08-13', photo: 'https://example.com/a.jpg', createdAt: 30 }
  ] });
  assert.deepEqual(state.snippets.map(item => item.id), ['t1', 'p1']);
  assert.deepEqual(snippetEntries(state).map(item => item.id), ['p1', 't1']);
  assert.deepEqual(snippetEntries(state, { type: 'photo' }).map(item => item.id), ['p1']);
  assert.deepEqual(snippetEntries(state, { search: '句子' }).map(item => item.id), ['t1']);
  assert.equal(makeSnippet({ type: 'text', text: '  灵感  ', date: '2026-08-13' }).text, '灵感');
});

test('snippet videos migration keeps video references and tolerates legacy data', () => {
  const migrated = migrateState({ snippets: [
    { id: 'v1', type: 'photo', date: '2026-08-13', createdAt: 1, photo: 'mine-media://a.jpg', photos: ['mine-media://a.jpg'], videos: [{ poster: 'mine-media://a.jpg', video: 'mine-media://v.mp4' }, { poster: '', video: '   ' }] },
    { id: 't1', type: 'text', date: '2026-08-12', createdAt: 2, text: '旧文字' }
  ] });
  const videoEntry = migrated.snippets.find(item => item.id === 'v1');
  assert.deepEqual(videoEntry.videos, [{ poster: 'mine-media://a.jpg', video: 'mine-media://v.mp4' }]);
  assert.equal(videoEntry.photos[0], 'mine-media://a.jpg');
  assert.equal(migrated.snippets.find(item => item.id === 't1').videos.length, 0);
  assert.equal(migrateState({ snippets: [{ id: 'x', type: 'photo', date: '2026-08-13', createdAt: 1, photos: ['mine-media://p.jpg'] }] }).snippets[0].videos.length, 0);
  const videosOnly = migrateState({ snippets: [{ id: 'vo', type: 'photo', date: '2026-08-13', createdAt: 1, videos: [{ poster: '', video: 'mine-media://v.mp4' }] }] });
  assert.equal(videosOnly.snippets.length, 1);
  assert.equal(videosOnly.snippets[0].photo, '');
  assert.deepEqual(videosOnly.snippets[0].videos, [{ poster: '', video: 'mine-media://v.mp4' }]);
});

test('snippet videos preserve HLS addresses and playback position without changing legacy files', () => {
  const url = 'https://media.example.test/archive/master.m3u8?token=local-only';
  const entry = makeSnippet({ type: 'photo', videos: [{ video: url, sourceType: 'hls', label: '课程回放', position: 83, duration: 900, width: 1920, height: 1080, contentLeft: .34, contentRight: .34, contentAspect: .5689, displayOrientation: 'portrait', displayAnalysisVersion: 2 }] });
  assert.deepEqual(entry.videos[0], { poster: '', video: url, sourceType: 'hls', label: '课程回放', position: 83, duration: 900, width: 1920, height: 1080, contentLeft: .34, contentRight: .34, contentAspect: .5689, displayOrientation: 'portrait', displayAnalysisVersion: 2 });
  const legacy = makeSnippet({ type: 'photo', videos: [{ video: 'mine-media://clip.mp4' }] });
  assert.deepEqual(legacy.videos[0], { poster: '', video: 'mine-media://clip.mp4' });
});

test('browser video data URLs keep every byte instead of being truncated', () => {
  const embedded = `data:video/webm;base64,${'A'.repeat(12000)}`;
  const entry = makeSnippet({ type: 'photo', videos: [{ video: embedded }] });
  assert.equal(entry.videos[0].video, embedded);
  assert.equal(entry.videos[0].video.length, embedded.length);
});

test('browser IndexedDB media references survive image and poster normalization', () => {
  const ref = 'mine-browser-media://poster-1.webp';
  assert.equal(makeSnippet({ type: 'photo', photos: [ref], videos: [{ poster: ref, video: 'mine-browser-media://clip-1.webm' }] }).photo, ref);
});

test('pomodoro timer migration preserves phase, round and bounds invalid settings', () => {
  const migrated = migrateState({
    settings: { pomodoroFocusMinutes: 999, pomodoroShortBreakMinutes: 0, pomodoroLongBreakMinutes: 200, pomodoroRounds: 99 },
    timer: { mode: 'pomodoro', phase: 'shortBreak', round: 3, duration: 300, left: 120, task: '项目', category: 'work' }
  });
  assert.deepEqual([
    migrated.settings.pomodoroFocusMinutes,
    migrated.settings.pomodoroShortBreakMinutes,
    migrated.settings.pomodoroLongBreakMinutes,
    migrated.settings.pomodoroRounds
  ], [180, 1, 120, 12]);
  assert.deepEqual([migrated.timer.mode, migrated.timer.phase, migrated.timer.round], ['pomodoro', 'shortBreak', 3]);
});

test('pomodoro stages advance through short and long breaks without auto-starting', () => {
  const settings = { pomodoroFocusMinutes: 25, pomodoroShortBreakMinutes: 5, pomodoroLongBreakMinutes: 15, pomodoroRounds: 4 };
  assert.equal(pomodoroPhaseSeconds(settings, 'focus'), 1500);
  assert.equal(pomodoroPhaseSeconds(settings, 'shortBreak'), 300);
  assert.equal(pomodoroPhaseSeconds(settings, 'longBreak'), 900);
  assert.deepEqual(nextPomodoroStage({ phase: 'focus', round: 1 }, settings), { phase: 'shortBreak', round: 1 });
  assert.deepEqual(nextPomodoroStage({ phase: 'shortBreak', round: 1 }, settings), { phase: 'focus', round: 2 });
  assert.deepEqual(nextPomodoroStage({ phase: 'focus', round: 4 }, settings), { phase: 'longBreak', round: 4 });
  assert.deepEqual(nextPomodoroStage({ phase: 'longBreak', round: 4 }, settings), { phase: 'focus', round: 1 });
});

test('period statistics derive totals and categories from sessions', () => {
  const state = makeDefaultState(new Date('2026-08-13T10:00:00'));
  state.sessions = [
    { id: '1', date: '2026-08-10', minutes: 30, task: '工作', detail: '', category: 'work' },
    { id: '2', date: '2026-08-12', minutes: 45, task: '阅读', detail: '', category: 'read' },
    { id: '3', date: '2026-08-09', minutes: 20, task: '旧记录', detail: '', category: 'work' }
  ];
  const summary = periodSummary(state, 'week', new Date('2026-08-13T10:00:00'));
  assert.equal(summary.totalMinutes, 75);
  assert.equal(summary.previousMinutes, 20);
  assert.equal(summary.longestMinutes, 45);
  assert.equal(summary.byCategory.work, 30);
  assert.equal(summary.byCategory.read, 45);
});

test('focus projects and historical links survive migration and project statistics', () => {
  const state = migrateState({
    habits: [{ id: 'read', name: '阅读', target: 30, unit: '分钟', tracking: 'quantity' }],
    media: [{ id: 'book-1', type: 'book', title: '局外人' }],
    focusProjects: [{ id: 'literature', name: '文学阅读', icon: 'menu_book', color: '#77708f', category: 'read', habitId: 'read', mediaId: 'book-1' }],
    sessions: [{ id: 's1', date: '2026-08-13', minutes: 35, task: '文学阅读', category: 'read', projectId: 'literature', habitId: 'read', habitMinutes: 35, mediaId: 'book-1' }],
    timer: { mode: 'stopwatch', projectId: 'literature', running: false, elapsed: 90 }
  });
  assert.equal(state.focusProjects[0].habitId, 'read');
  assert.equal(state.focusProjects[0].mediaId, 'book-1');
  assert.equal(state.sessions[0].mediaId, 'book-1');
  assert.equal(state.timer.elapsed, 90);
  assert.equal(periodSummary(state, 'week', new Date('2026-08-13T10:00:00')).byProject.literature, 35);
});

test('unified activity log derives editable source records without duplicating state', () => {
  const completedAt = new Date('2026-08-13T10:12:00').getTime();
  const state = migrateState({
    habits: [{ id:'read', name:'阅读', target:30, unit:'分钟', tracking:'quantity' }],
    checks: { '2026-08-13': { read:30 } },
    habitCompletions: { '2026-08-13': { read:completedAt } },
    todos: [{ id:'todo-1', date:'2026-08-14', title:'整理笔记', completed:true, completedAt, completedDate:'2026-08-13' }],
    sessions: [{ id:'focus-1', date:'2026-08-13', minutes:25, startedAt:completedAt-1500000, task:'数学', category:'work' }]
  });
  state.events = rebuildActivityLog(state);
  assert.deepEqual(activityForDate(state,'2026-08-13').map(item=>item.kind).sort(), ['focus','habit','todo']);
  state.todos[0].completed = false;
  state.events = rebuildActivityLog(state);
  assert.equal(state.events.some(item=>item.id==='todo:todo-1'), false);
});

test('statistics insights, project goals and linked book focus derive from source sessions', () => {
  const now = new Date('2026-08-13T20:00:00');
  const project = makeFocusProject({ id:'reading-project', name:'文学阅读', mediaId:'book-1', weeklyTargetMinutes:120, monthlyTargetMinutes:600 });
  const state = migrateState({
    focusProjects:[project],
    media:[{id:'book-1',type:'book',title:'局外人'}],
    sessions:[
      {id:'s1',date:'2026-08-12',startedAt:new Date('2026-08-12T09:00:00').getTime(),minutes:30,task:'阅读',projectId:'reading-project',mediaId:'book-1'},
      {id:'s2',date:'2026-08-13',startedAt:new Date('2026-08-13T20:00:00').getTime(),minutes:60,task:'阅读',projectId:'reading-project',mediaId:'book-1'}
    ]
  });
  const media = mediaFocusSummary(state,'book-1');
  const goal = projectGoalSummary(state,state.focusProjects[0],now);
  const insight = focusInsights(state,state.sessions,now);
  assert.deepEqual([media.minutes,media.sessions.length,media.lastDate],[90,2,'2026-08-13']);
  assert.deepEqual([goal.weekly,goal.weeklyPercent,goal.monthly,goal.monthlyPercent],[90,75,90,15]);
  assert.equal(insight.averageSessionMinutes,45);
  assert.equal(insight.peakLabel,'晚上');
  assert.equal(insight.heatmap.length,28);
});

test('ledger migration keeps historical amounts/categories while leaving old transactions unassigned', () => {
  const state = migrateState({
    transactions: [{ id: 'old-expense', type: 'expense', category: 'game', amount: 38.5, date: '2026-08-15', note: '旧账' }]
  });
  assert.equal(state.ledgerAccounts.length, 4);
  assert.deepEqual(state.ledgerAccounts.map(account => [account.id, account.name, account.type]), [
    ['cmb', '招商银行储蓄卡', 'bank'],
    ['wx', '微信零钱通', 'wallet'],
    ['alipay', '支付宝余额宝', 'wallet'],
    ['loan', '外借应收款', 'receivable']
  ]);
  assert.deepEqual(state.ledgerAccounts.map(account => account.initialBalance), [0, 0, 0, 0]);
  assert.deepEqual(state.transactions[0].accountId, 'unassigned');
  assert.equal(state.transactions[0].amount, 38.5);
  assert.equal(state.transactions[0].category, 'game');
  assert.deepEqual(ledgerSummary(state, new Date('2026-08-15T12:00:00')).unassigned, { count: 1, amount: 38.5 });
});

test('custom ledger categories and merchant rules persist with archiving and disable state', () => {
  const state = migrateState({
    ledgerAccounts: [],
    ledgerCategories: [{ id: 'coffee', name: '咖啡', icon: 'local_cafe', color: '#7c8db0', scope: 'expense', archived: true }],
    merchantCategoryRules: [
      { id: 'rule-on', keyword: '星巴克', categoryId: 'coffee', enabled: true },
      { id: 'rule-off', keyword: '瑞幸', categoryId: 'coffee', enabled: false }
    ],
    transactions: [{ id: 'coffee-old', type: 'expense', category: 'coffee', amount: 22, accountId: 'unassigned', date: '2026-08-15' }]
  });
  assert.equal(state.ledgerCategories[0].archived, true);
  assert.deepEqual(state.merchantCategoryRules.map(rule => [rule.keyword, rule.enabled]), [['星巴克', true], ['瑞幸', false]]);
  assert.equal(state.transactions[0].category, 'coffee');
});

test('account transfer changes only account balances and never spending, income or budget totals', () => {
  const state = makeDefaultState();
  state.ledgerAccounts.find(account => account.id === 'alipay').initialBalance = 100;
  state.transactions = [makeTransaction({ id: 'transfer', type: 'transfer', amount: 40, sourceAccountId: 'alipay', targetAccountId: 'wx', date: '2026-08-15' })];
  const summary = ledgerSummary(state, new Date('2026-08-15T12:00:00'));
  assert.equal(summary.monthExpense, 0);
  assert.equal(summary.monthIncome, 0);
  assert.equal(summary.todayExpense, 0);
  assert.equal(summary.budgetProgress.spent, 0);
  assert.equal(summary.accounts.find(account => account.id === 'alipay').balance, 60);
  assert.equal(summary.accounts.find(account => account.id === 'wx').balance, 40);
  assert.equal(summary.totalAssets, 100);
});

test('lending and repayment through receivable are transfers, not income', () => {
  const state = makeDefaultState();
  state.ledgerAccounts.find(account => account.id === 'wx').initialBalance = 100;
  state.transactions = [
    makeTransaction({ id: 'lend', type: 'transfer', amount: 100, sourceAccountId: 'wx', targetAccountId: 'loan', date: '2026-08-15', note: '借给小王' }),
    makeTransaction({ id: 'repay', type: 'transfer', amount: 100, sourceAccountId: 'loan', targetAccountId: 'cmb', date: '2026-08-16', note: '小王归还' })
  ];
  const summary = ledgerSummary(state, new Date('2026-08-16T12:00:00'));
  assert.equal(summary.monthExpense, 0);
  assert.equal(summary.monthIncome, 0);
  assert.equal(summary.receivableBalance, 0);
  assert.equal(summary.accounts.find(account => account.id === 'cmb').balance, 100);
  assert.equal(summary.totalAssets, 100);
});

test('warm foundation migrates focus metadata and caches only valid weekly reports', () => {
  const state = migrateState({
    sessions: [{ id: 'focus-1', date: '2026-08-18', minutes: 30, mode: 'pomodoro', targetDurationSeconds: 3600, interruptionsCount: 2 }],
    weeklyInsightReports: [
      { id: 'valid', weekStart: '2026-08-10', weekEnd: '2026-08-16', status: 'ready' },
      { id: 'invalid', weekStart: 'not-a-date', weekEnd: '2026-08-16' }
    ]
  });
  assert.deepEqual([state.sessions[0].mode, state.sessions[0].durationSeconds, state.sessions[0].targetDurationSeconds, state.sessions[0].flowScore], ['pomo', 1800, 3600, 56]);
  assert.deepEqual(state.weeklyInsightReports.map(report => report.id), ['valid']);
  assert.deepEqual(previousCompleteWeekRange(new Date('2026-08-19T09:00:00')), { start: '2026-08-10', end: '2026-08-16', weekNumber: 33 });
});

test('balance calibration reaches target without entering expense, income or budget totals', () => {
  const state = makeDefaultState();
  const account = state.ledgerAccounts.find(item => item.id === 'wx');
  account.initialBalance = 100;
  state.transactions = [makeTransaction({ type: 'expense', amount: 20, accountId: 'wx', category: 'restaurant', date: '2026-08-19' })];
  const result = calibrateLedgerAccount(state, { accountId: 'wx', targetBalance: 150, reasonTag: '#平账核销', generateReconciliationTx: true });
  const summary = ledgerSummary(state, new Date('2026-08-19T12:00:00'));
  assert.equal(result.calibration.difference, 70);
  assert.equal(result.reconciliationTx.type, 'calibrate');
  assert.equal(summary.accounts.find(item => item.id === 'wx').balance, 150);
  assert.equal(summary.monthExpense, 20);
  assert.equal(summary.monthIncome, 0);
  assert.equal(summary.budgetProgress.spent, 20);
});

test('habit heatmap derives 0-4 levels and focus flow score is bounded', () => {
  const state = makeDefaultState(new Date('2026-01-01T12:00:00'));
  const habit = state.habits.find(item => item.id === 'water');
  state.checks['2026-01-01'] = { water: 2 };
  state.checks['2026-01-02'] = { water: 8 };
  const heatmap = habitHeatmapData(state, 'water', 2026);
  assert.equal(heatmap.days.length, 365);
  assert.deepEqual(heatmap.days.slice(0, 2).map(item => [item.value, item.level]), [[2, 1], [8, 4]]);
  assert.equal(heatmap.totalActiveDays, 2);
  assert.equal(calculateFlowScore({ durationSeconds: 3600, targetDurationSeconds: 3600, interruptionsCount: 0 }), 100);
  assert.equal(calculateFlowScore({ durationSeconds: 0, targetDurationSeconds: 3600, interruptionsCount: 20 }), 0);
});
