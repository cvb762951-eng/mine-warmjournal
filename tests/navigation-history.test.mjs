import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const core = await readFile(new URL('../core.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const vault = await readFile(new URL('../views/private-vault.js', import.meta.url), 'utf8');

test('route navigation keeps a bounded stack and restores the real previous route and scroll', () => {
  assert.match(core, /NAVIGATION_HISTORY_LIMIT = 50/);
  assert.match(core, /const navigationHistory = \[\]/);
  assert.match(core, /if \(changesPage && !navigatingBack && options\.history !== false\) rememberCurrentNavigation\(\)/);
  assert.match(core, /const target = navigationHistory\.pop\(\)/);
  assert.match(core, /go\(target\.route, target\.calendarDate, \{ history: false, resetScroll: false \}\)/);
  assert.match(core, /if \(options\.resetScroll !== false\)/);
  assert.match(core, /function currentPageScrollTop\(\)/);
  assert.match(core, /document\.scrollingElement\?\.scrollTop/);
  assert.match(core, /function setPageScrollTop\(top = 0\)/);
  assert.match(core, /requestAnimationFrame\(\(\) => \{[\s\S]*setPageScrollTop\(0\);[\s\S]*requestAnimationFrame\(\(\) => setPageScrollTop\(0\)\)/);
  assert.match(core, /window\.scrollTo\(\{ top: value, left: 0, behavior: 'auto' \}\)/);
  assert.match(core, /setPageScrollTop\(target\.scrollTop\)/);
  assert.match(core, /export const canGoBack/);
});

test('Android system back prioritizes overlays then uses the same route history', () => {
  assert.match(app, /isModalOpen[\s\S]*isSubpageOpen[\s\S]*isAiChatActive[\s\S]*canGoBack/);
  assert.match(app, /if \(callHelper\('returnToAiOverview'\)\) \{ syncAiChatChrome\(\); return; \}[\s\S]*goBack\(\)/);
});

test('private vault exit returns through navigation history and is never hardcoded to Mine', () => {
  const leave = vault.slice(vault.indexOf('async function lockAndLeave'), vault.indexOf('function bindPrivateVault'));
  assert.match(leave, /goBack\(\)/);
  assert.doesNotMatch(leave, /go\('mine'\)|go\('today'\)/);
});
