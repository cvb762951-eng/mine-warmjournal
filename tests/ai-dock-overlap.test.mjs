import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../performance.css', import.meta.url), 'utf8');
const audit = JSON.parse(await readFile(new URL('../evidence/ai-density/dock-overlap-audit.json', import.meta.url), 'utf8'));

test('non-immersive AI chat derives safe height from dock clearance', () => {
  assert.match(css, /\.ai-companion-screen:has\(#ai-panel-chat:not\(\[hidden\]\)\)\{[^}]*height:calc\(100dvh - var\(--dock-clearance\) - 12px\)/);
  assert.doesNotMatch(css, /\.ai-chat-page:not\(\.is-immersive\) \.ai-chat\{[^}]*100dvh - 264px/);
  assert.match(css, /#ai-panel-chat\{flex:1;min-height:0\}/);
  assert.match(css, /\.ai-chat-page:not\(\.is-immersive\) \.ai-messages\{flex:1;min-height:0;overflow-y:auto\}/);
});

test('composer clears Dock by at least 12px at all three required viewports', () => {
  for (const item of audit.viewports) {
    assert.ok(item.gap >= 12, `${item.viewport}: ${item.gap}px`);
    assert.equal(item.horizontalOverflow, false, item.viewport);
  }
});

test('long overview messages scroll internally without moving composer behind Dock', () => {
  assert.equal(audit.longMessages.internallyScrollable, true);
  assert.ok(audit.longMessages.messagesScrollHeight > audit.longMessages.messagesClientHeight);
  assert.ok(audit.longMessages.messagesScrollTop > 0);
  assert.ok(audit.longMessages.composerDockGap >= 12);
});

test('custom background and return-to-overview keep the safe gap', () => {
  assert.equal(audit.customBackground.enabled, true);
  assert.ok(audit.customBackground.composerDockGap >= 12);
  assert.ok(audit.returnedOverview.gap >= 12);
  assert.equal(audit.returnedOverview.dockVisibility, 'visible');
});

test('immersive and keyboard contracts remain unchanged', () => {
  assert.deepEqual(audit.immersiveChatPreserved, { headerHeight: 58, composerHeight: 57, dockVisibility: 'hidden' });
  assert.equal(audit.keyboardPreserved.keyboardTop, 565);
  assert.equal(audit.keyboardPreserved.composerBottom, 557);
  assert.equal(audit.keyboardPreserved.clearance, 8);
  assert.equal(audit.keyboardPreserved.dockVisibility, 'hidden');
});

test('Dock-overlap evidence uses no AI requests', () => {
  assert.ok(Object.values(audit.networkRequests).every(value => value === 0));
});
