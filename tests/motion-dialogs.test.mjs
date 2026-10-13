import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DIALOG_MOTION, backdropAction, formLooksUnsaved, popoverOrigin, stackedSubpageIndexes,
} from '../motion-dialogs.js';

const dialogs = readFileSync(new URL('../motion-dialogs.js', import.meta.url), 'utf8');
const layers = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');
const core = readFileSync(new URL('../core.js', import.meta.url), 'utf8');
const light = readFileSync(new URL('../themes-plain-light.css', import.meta.url), 'utf8');

test('Z8：确认框 / 未保存表单点遮罩轻推，不关闭', () => {
  assert.equal(backdropAction({ confirm: true }), 'nudge');
  assert.equal(backdropAction({ unsaved: true }), 'nudge');
  assert.equal(backdropAction({}), 'close');
  assert.equal(backdropAction({ alarm: true, confirm: true }), 'ignore');
  assert.equal(DIALOG_MOTION.nudgeMs, 260);
});

test('formLooksUnsaved：有待保存照片或说明文字才算', () => {
  assert.equal(formLooksUnsaved({
    classList: { contains: () => false },
    querySelector: sel => (sel.includes('snippet-photo-cell') ? {} : null),
    matches: () => false,
  }), true);
  assert.equal(formLooksUnsaved({
    classList: { contains: name => name === 'confirm-sheet' },
    querySelector: () => ({ value: 'x' }),
    matches: () => false,
  }), false);
  assert.equal(formLooksUnsaved({
    classList: { contains: () => false },
    querySelector: sel => (sel.includes('textarea') ? { value: '  hello ' } : null),
    matches: () => false,
  }), true);
});

test('Z7 origin 与 Z6 叠层索引', () => {
  assert.equal(
    popoverOrigin({ left: 300, top: 10, width: 40, height: 40 }, { left: 200, top: 60, width: 160, height: 120 }),
    '100% 0',
  );
  assert.equal(
    popoverOrigin({ left: 20, top: 200, width: 40, height: 40 }, { left: 20, top: 40, width: 160, height: 120 }),
    '0 100%',
  );
  assert.deepEqual(stackedSubpageIndexes(1), []);
  assert.deepEqual(stackedSubpageIndexes(3), [0, 1]);
});

test('接线：confirm-sheet 标记、不拖确认框、返回用 subpage-back-btn', () => {
  assert.match(layers, /installDialogMotion\(\)/);
  assert.match(layers, /\.confirm-sheet/);
  assert.match(core, /: 'confirm-sheet'/);
  assert.match(dialogs, /\.subpage-back-btn/);
  assert.doesNotMatch(dialogs, /\.subpage-back[^\-]/);
  assert.doesNotMatch(dialogs, /from '\.\/(storage|notifications|private-vault|model)\.js'/);
  assert.match(dialogs, /journal-deck/);
});

test('CSS：Z5 居中、Z6 叠层、Z8 轻推、Z9 箭头', () => {
  assert.match(light, /三十三 · 确认框与小弹窗/);
  assert.match(light, /pl-dialog-in/);
  assert.match(light, /subpage-layer\.active:has\(~ \.subpage-layer\.active\)/);
  assert.match(light, /pl-nudge-dialog/);
  assert.match(light, /\.subpage-back-btn\[data-pressed\]/);
  assert.match(light, /backdrop-filter: blur\(10px\)/);
});

test('确认框默认聚焦取消钮，不自动聚焦删除', () => {
  assert.match(core, /#modal-layer \.modal \[data-close\]/);
  assert.match(dialogs, /cancel\.focus\?\.\(\{\s*preventScroll:\s*true\s*\}\)/);
});
