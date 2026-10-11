import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../performance.css', import.meta.url), 'utf8');
const summary = JSON.parse(await readFile(new URL('../evidence/ai-density/density-summary.json', import.meta.url), 'utf8'));

test('AI overview and non-chat panels use the shared moderate-density tokens', () => {
  assert.match(css, /\.ai-stream-sheet\{[^}]*margin-top:var\(--space-section-gap\)[^}]*padding:18px var\(--space-page-inline\)/);
  assert.match(css, /\.ai-tabs\.segmented-control\{[^}]*margin:0 0 var\(--space-section-gap\)/);
  assert.match(css, /\.ai-report-card\{[^}]*padding:var\(--space-card-padding\)/);
  assert.match(css, /\.ai-report-section\{[^}]*margin-bottom:var\(--space-section-gap\)[^}]*padding:var\(--space-card-padding\)/);
  assert.match(css, /\.ai-memory-panel-content\{[^}]*gap:var\(--space-section-gap\)/);
});

test('weekly chart and KPI density are not enlarged', () => {
  assert.equal(summary.weeklyReport.chartHeightBefore, 68);
  assert.equal(summary.weeklyReport.chartHeightAfter, 68);
  assert.equal(summary.weeklyReport.kpiFontSizeIncreased, false);
});

test('memory and settings primary controls meet the 44px target', () => {
  assert.ok(summary.memoryAndSettings.memoryActionComputedAfter >= 44);
  assert.ok(summary.memoryAndSettings.settingsInputHeightAfter >= 44);
  assert.ok(summary.memoryAndSettings.settingsSelectHeightAfter >= 44);
  assert.ok(summary.memoryAndSettings.settingsConfirmRowHeightAfter >= 44);
  assert.ok(summary.memoryAndSettings.settingsActionHeightAfter >= 44);
});

test('immersive chat preserves compact header, bubble and composer metrics', () => {
  const chat = summary.chatCompactException;
  assert.equal(chat.headerHeightAfter, chat.headerHeightBefore);
  assert.equal(chat.composerHeightAfter, chat.composerHeightBefore);
  assert.equal(chat.bubblePaddingAfter, chat.bubblePaddingBefore);
  assert.equal(chat.dockVisibility, 'hidden');
  assert.ok(chat.composerBottom < chat.keyboardTop);
  assert.equal(chat.keyboardClearance, 8);
});

test('all audited AI states make zero automatic requests', () => {
  assert.ok(Object.values(summary.networkRequests).every(count => count === 0));
});

test('360, 395 and 412 widths have no horizontal overflow', () => {
  for (const item of summary.responsiveOverflow) {
    assert.equal(item.documentWidth, item.bodyScrollWidth, item.viewport);
    assert.equal(item.documentWidth, item.appScrollWidth, item.viewport);
    assert.equal(item.scrollX, 0, item.viewport);
  }
});
