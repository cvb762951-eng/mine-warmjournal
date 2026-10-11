import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  aiGenerateWeeklyInsight,
  calculateWeeklyFlowScore,
  findReadyWeeklyInsightReport,
  parseWeeklyInsightReply,
  upsertWeeklyInsightReport
} from '../ai/generate.js';

const metrics = {
  dateRange: { start: '2026-08-10', end: '2026-08-16' },
  weekNumber: 33,
  peakFocusDay: { date: '2026-08-12', minutes: 90 },
  focus: { sessions: 2, differenceMinutes: 30 },
  habits: { targets: 7 },
  ledger: { transactionCount: 2, budgetTotal: 500, remainingBudget: 123.45 },
  journals: { count: 1 },
  media: { completed: 1, inProgress: 0 }
};

const payload = {
  themeTitle: '稳稳推进的一周',
  summaryNarrative: '这一周的节奏清晰，几条生活轨道都有真实记录。',
  tracks: {
    study: '专注投入较前周更积极，可以延续当前节奏。',
    wellbeing: '记录与习惯形成了相互支撑。',
    finance: '预算仍有余地，消费节奏较稳。',
    media: '书影音轨道留下了完成记录。'
  },
  nextWeekActionAdvice: ['固定一次周中复盘', '保留一段不被打扰的专注时间', '周末整理本周记录']
};

test('weekly insight accepts valid plain JSON', () => {
  assert.deepEqual(parseWeeklyInsightReply(JSON.stringify(payload), metrics), payload);
});

test('weekly insight accepts JSON in a Markdown code fence', () => {
  assert.deepEqual(parseWeeklyInsightReply(`\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``, metrics), payload);
});

test('weekly insight rejects a missing tracks field', () => {
  const invalid = { ...payload };
  delete invalid.tracks;
  assert.throws(() => parseWeeklyInsightReply(JSON.stringify(invalid), metrics), /缺少四轨/);
});

test('weekly insight rejects fewer than three non-empty actions', () => {
  const invalid = { ...payload, nextWeekActionAdvice: ['一', '二', ''] };
  assert.throws(() => parseWeeklyInsightReply(JSON.stringify(invalid), metrics), /正好 3 条/);
});

test('weekly insight rejects more than three actions', () => {
  const invalid = { ...payload, nextWeekActionAdvice: ['一', '二', '三', '四'] };
  assert.throws(() => parseWeeklyInsightReply(JSON.stringify(invalid), metrics), /正好 3 条/);
});

test('weekly insight drops model-supplied KPI and numeric fields', () => {
  const result = parseWeeklyInsightReply(JSON.stringify({
    ...payload,
    kpis: { weeklyExpense: 999 },
    flowScore: 100,
    dailyFocusChart: [{ hours: 24 }],
    amount: 999,
    percentage: 100,
    duration: 1440
  }), metrics);
  assert.deepEqual(Object.keys(result).sort(), ['nextWeekActionAdvice', 'summaryNarrative', 'themeTitle', 'tracks']);
  assert.equal('kpis' in result, false);
  assert.equal('flowScore' in result, false);
});

test('same-week ready cache is reused and upsert keeps one entry per week', () => {
  const ready = { id: 'ready', weekStart: metrics.dateRange.start, weekEnd: metrics.dateRange.end, status: 'ready' };
  assert.equal(findReadyWeeklyInsightReport([ready], metrics), ready);
  const replaced = upsertWeeklyInsightReport([ready], { ...ready, id: 'replacement', status: 'ready' });
  assert.deepEqual(replaced.map(item => item.id), ['replacement']);
});

test('weekly generation persists only ready success and keeps failure in module UI state', async () => {
  const source = await readFile(new URL('../views/ai.js', import.meta.url), 'utf8');
  assert.match(source, /status: 'ready'/);
  assert.match(source, /weekGenerationError = error\.message/);
  assert.doesNotMatch(source, /status: 'failed'[\s\S]{0,240}upsertWeeklyInsightReport/);
});

test('weekly report cache retains only the latest twelve weeks', () => {
  let reports = [];
  for (let index = 1; index <= 13; index += 1) {
    const day = String(index).padStart(2, '0');
    reports = upsertWeeklyInsightReport(reports, { id: day, weekStart: `2026-01-${day}`, weekEnd: `2026-01-${day}`, status: 'ready' });
  }
  assert.equal(reports.length, 12);
  assert.equal(reports[0].id, '02');
  assert.equal(reports.at(-1).id, '13');
});

test('weekly flow score is duration-weighted, falls back when missing and stays bounded', () => {
  const score = calculateWeeklyFlowScore({ sessions: [
    { date: '2026-08-10', durationSeconds: 3600, flowScore: 100 },
    { date: '2026-08-11', durationSeconds: 1800 },
    { date: '2026-08-18', durationSeconds: 9999, flowScore: 0 }
  ] }, metrics, () => 40);
  assert.equal(score, 80);
  assert.equal(calculateWeeklyFlowScore({ sessions: [] }, metrics, () => 100), 0);
  assert.equal(calculateWeeklyFlowScore({ sessions: [{ date: '2026-08-10', durationSeconds: 60 }] }, metrics, () => 999), 100);
});

test('empty metrics force every track to the explicit no-record message', () => {
  const emptyMetrics = {
    dateRange: { start: '2026-08-10', end: '2026-08-16' },
    focus: {}, habits: {}, ledger: {}, journals: {}, media: {}
  };
  const result = parseWeeklyInsightReply(JSON.stringify(payload), emptyMetrics);
  assert.deepEqual(result.tracks, {
    study: '本周暂无对应记录',
    wellbeing: '本周暂无对应记录',
    finance: '本周暂无对应记录',
    media: '本周暂无对应记录'
  });
});

test('weekly AI request contains only authorized qualitative signals', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = '';
  globalThis.fetch = async (_url, options) => {
    requestBody = String(options.body || '');
    return {
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] })
    };
  };
  try {
    const result = await aiGenerateWeeklyInsight({ settings: {
      aiApiKey: 'test-key',
      aiProvider: 'custom',
      aiBaseUrl: 'https://example.invalid/chat',
      aiModel: 'test-model'
    } }, { ...metrics, secretLeak: 'PRIVATE-JOURNAL-TEXT' });
    assert.equal(result.themeTitle, payload.themeTitle);
    assert.match(requestBody, /tracksWithRecords/);
    assert.match(requestBody, /focusTrend/);
    assert.doesNotMatch(requestBody, /2026-08-10|2026-08-16|123\.45|PRIVATE-JOURNAL-TEXT/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
