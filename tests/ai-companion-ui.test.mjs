import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const viewSource = await readFile(new URL('../views/ai.js', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../performance.css', import.meta.url), 'utf8');

test('AI Companion renders the authoritative title, sheet and three panels in order', () => {
  assert.match(viewSource, /暖色生活志 AI 伴侣/);
  assert.match(viewSource, /DeepSeek-V3 · Mind & Reflection/);
  assert.match(viewSource, /stream-sheet ai-stream-sheet/);
  const chat = viewSource.indexOf('id="ai-panel-chat"');
  const report = viewSource.indexOf('id="ai-panel-report"');
  const memory = viewSource.indexOf('id="ai-panel-memory"');
  assert.ok(chat >= 0 && report > chat && memory > report);
});

test('AI entry stays at overview until the user focuses or sends a chat message', () => {
  assert.match(viewSource, /let aiChatExpanded = false/);
  assert.match(viewSource, /addEventListener\('focus', enterAiChat\)/);
  assert.match(viewSource, /registerHelper\('isAiChatActive', \(\) => aiChatExpanded\)/);
  assert.match(viewSource, /if \(!routeActive && aiRouteWasActive\)[\s\S]*?aiTab = 'chat'/);
});

test('page entry, render and panel switching do not trigger an AI insight request', () => {
  assert.doesNotMatch(viewSource, /maybeGenerateOverview/);
  assert.doesNotMatch(viewSource, /scheduleInsightRefresh/);
  assert.doesNotMatch(viewSource, /maybeScanData/);
  assert.doesNotMatch(viewSource, /registerOnRender\([\s\S]{0,700}(?:maybeGenerateInsight|scheduleTodayRandomReminders|checkCountdownNodes)\(/);
  assert.match(viewSource, /#ai-regenerate-insight/);
  assert.match(viewSource, /maybeGenerateInsight\(true\)/);
  assert.match(viewSource, /registerHelper\('generateAutoSummary', runScheduledAutoSummary\)/);
  assert.match(viewSource, /function scheduleAiRefresh\(\)[\s\S]{0,180}return null/);
  assert.match(viewSource, /registerHelper\('aiDailyEncouragement'[\s\S]{0,220}aiDailyEncouragement/);
  assert.doesNotMatch(viewSource, /registerHelper\('aiDailyEncouragement'[\s\S]{0,260}await aiDailyEncouragement\(/);
});

test('Markdown code blocks are escaped and contained independently from prose lists', () => {
  assert.match(viewSource, /ai-code-block/);
  assert.match(viewSource, /<code>\$\{esc\(/);
  assert.match(cssSource, /\.ai-code-block\{[^}]*overflow-x:auto/);
});

test('weekly report retains local KPI structure and success-only cache behavior', () => {
  assert.match(viewSource, /weeklyInsightReports/);
  assert.match(viewSource, /warmWeeklyLifeMetrics/);
  assert.match(viewSource, /aiGenerateWeeklyInsight/);
  assert.match(viewSource, /status: 'ready'/);
  assert.doesNotMatch(viewSource, /status: 'failed'[\s\S]{0,240}upsertWeeklyInsightReport/);
});

test('memory groups are real-state driven and keep the existing manager entry', () => {
  assert.match(viewSource, /const MEMORY_GROUPS/);
  assert.match(viewSource, /\(state\.aiMemory \|\| \[\]\)\.forEach/);
  assert.match(viewSource, /id="ai-memory-entry"/);
  assert.match(viewSource, /function aiMemoryModal/);
});

test('message-area redraw rebinds the existing settings and explicit insight actions', () => {
  assert.match(viewSource, /box\.innerHTML = aiMessagesHtml\(\);[\s\S]{0,220}bindAiWelcomeActions\(\)/);
  assert.match(viewSource, /function bindAiWelcomeActions\(\)[\s\S]{0,500}#ai-open-settings[\s\S]{0,500}maybeGenerateInsight\(true\)/);
});

test('obsolete cold dashboard and wrong chat-panel selector are removed', () => {
  assert.doesNotMatch(cssSource, /#ai-chat-panel\s*\{/);
  assert.doesNotMatch(cssSource, /AI 模块冷调收口/);
  assert.match(cssSource, /AI Companion 原型逐元素复刻/);
  assert.match(cssSource, /\.ai-chat-page\.is-immersive/);
});

test('semantic background range preview is local, expandable and updated from the draft', () => {
  assert.match(viewSource, /id="ai-semantic-scope"/);
  assert.match(viewSource, /本次将参考/);
  assert.match(viewSource, /function updateSemanticScopePreview\(query\)/);
  assert.match(viewSource, /addEventListener\('input',[\s\S]{0,180}updateSemanticScopePreview\(aiDraft\)/);
  assert.match(viewSource, /aiLastSemanticPreview = aiSemanticPreview\(state, content\)/);
  assert.match(cssSource, /岗位④｜普通聊天本地语义背景范围/);
  assert.doesNotMatch(viewSource, /function (?:semanticScopeHtml|updateSemanticScopePreview|bindSemanticScopePreview)[\s\S]{0,1200}(?:aiChat|aiChatStream|fetch)\(/);
});
