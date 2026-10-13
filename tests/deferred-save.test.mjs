import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDeferredSave } from '../deferred-save.js';

function harness() {
  const timers = new Map(); let id = 0; let calls = 0;
  const d = createDeferredSave({
    save: () => { calls += 1; },
    setTimer: fn => { id += 1; timers.set(id, fn); return id; },
    clearTimer: t => timers.delete(t),
    idle: null,
  });
  const tick = async () => { const fns = [...timers.values()]; timers.clear(); fns.forEach(f => f()); await new Promise(r => setTimeout(r, 0)); };
  return { d, tick, timers, calls: () => calls };
}

test('多次切页面合并成一次保存', async () => {
  const h = harness();
  h.d.request(); h.d.request(); h.d.request();
  assert.equal(h.timers.size, 1);
  assert.equal(h.calls(), 0);
  await h.tick();
  assert.equal(h.calls(), 1);
});

test('页面隐藏时 flush 立即保存且不重复', async () => {
  const h = harness();
  h.d.request();
  await h.d.flush();
  assert.equal(h.calls(), 1);
  assert.equal(h.timers.size, 0);
  await h.tick();
  assert.equal(h.calls(), 1);
  await h.d.flush();
  assert.equal(h.calls(), 1, '没有待办时 flush 不再保存');
});

test('整份保存发生后取消待办', async () => {
  const h = harness();
  h.d.request();
  h.d.cancelPending();
  await h.tick();
  assert.equal(h.calls(), 0);
  assert.equal(h.d.pending, false);
});

test('core.js：go() 不再直接整份保存，并在隐藏/关闭时补写', () => {
  const src = readFileSync(new URL('../core.js', import.meta.url), 'utf8');
  const go = src.slice(src.indexOf('export function go('), src.indexOf('export function go(') + 800);
  assert.match(go, /routeSave\.request\(\)/);
  assert.doesNotMatch(go, /\bsave\(\)\.catch/);
  assert.match(src, /visibilitychange[\s\S]{0,120}routeSave\.flush\(\)/);
  assert.match(src, /pagehide[\s\S]{0,60}routeSave\.flush\(\)/);
  assert.match(src, /export const save = \(\) => \{\s*\/\/[^\n]*\n\s*if \(typeof routeSave !== 'undefined'\) routeSave\.cancelPending\(\)/);
});
