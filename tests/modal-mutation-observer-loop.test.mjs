import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dialogsSrc = readFileSync(new URL('../motion-dialogs.js', import.meta.url), 'utf8');
const layersSrc = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');

function createObservedElement({ initialClasses = [] } = {}) {
  const classes = new Set(initialClasses);
  let mutationRecords = [];

  const classList = {
    contains(token) {
      return classes.has(token);
    },
    add(...tokens) {
      for (const t of tokens) {
        classes.add(t);
        mutationRecords.push({ type: 'attributes', attributeName: 'class', action: 'add', token: t });
      }
    },
    remove(...tokens) {
      for (const t of tokens) {
        // Simulates Chromium / Android WebView where remove() of absent token
        // executes update steps and triggers a MutationObserver record.
        classes.delete(t);
        mutationRecords.push({ type: 'attributes', attributeName: 'class', action: 'remove', token: t });
      }
    },
    toggle(token, force) {
      // Simulates Chromium / Android WebView where toggle() queues a mutation record
      mutationRecords.push({ type: 'attributes', attributeName: 'class', action: 'toggle', token, force });
      if (force !== undefined) {
        if (force) classes.add(token);
        else classes.delete(token);
        return Boolean(force);
      }
      if (classes.has(token)) {
        classes.delete(token);
        return false;
      }
      classes.add(token);
      return true;
    },
  };

  return {
    classList,
    style: {},
    dataset: {},
    querySelector: () => null,
    get mutationCount() { return mutationRecords.length; },
    get mutations() { return mutationRecords; },
    reset() { mutationRecords = []; },
  };
}

test('仿真测试：watchModals 弹窗关闭后不会因为 remove(\'pl-confirm-open\') 触发死循环', () => {
  const layer = createObservedElement({ initialClasses: [] }); // 已关闭，且无 pl-confirm-open

  // 模拟 MutationObserver 回调逻辑：
  const callback = () => {
    // 模拟 markConfirmSheets：当 layer 没有 .open 时安全返回
    if (!layer.classList.contains('open') && layer.classList.contains('pl-confirm-open')) {
      layer.classList.remove('pl-confirm-open');
    }
  };

  // 触发一次回调
  callback();
  // 必须没有触发任何 class mutation，否则在真实浏览器中会形成微任务死循环
  assert.equal(layer.mutationCount, 0, '未打开且无 pl-confirm-open 时，不得触发 classList.remove 突变');

  // 如果原本带有 pl-confirm-open（例如刚关掉确认框）
  layer.classList.add('pl-confirm-open');
  layer.reset();
  callback();
  assert.equal(layer.mutationCount, 1, '带有 pl-confirm-open 时移除一次');
  assert.equal(layer.classList.contains('pl-confirm-open'), false);

  // 下一次 observer 被唤醒时：
  layer.reset();
  callback();
  assert.equal(layer.mutationCount, 0, '移除后下一次回调不产生新的突变，死循环终止');
});

test('仿真测试：markConfirmSheets 打开普通弹窗时不无条件 toggle(\'pl-confirm-open\')', () => {
  const layer = createObservedElement({ initialClasses: ['open'] });
  const isConfirm = false; // 普通弹窗（如随手拍 quick-modal）

  const markLogic = () => {
    if (layer.classList.contains('pl-confirm-open') !== isConfirm) {
      layer.classList.toggle('pl-confirm-open', isConfirm);
    }
  };

  markLogic();
  assert.equal(layer.mutationCount, 0, '非确认框且未设置类名时，不得触发 classList.toggle 突变');
});

test('仿真测试：watchSheets 弹层关闭时不向 absent class 触发 classList.remove(\'pl-sheet\')', () => {
  const layer = createObservedElement({ initialClasses: [] }); // 已关闭，且无 pl-sheet

  const watchSheetsCallback = () => {
    const isOpen = layer.classList.contains('open');
    if (!isOpen) {
      if (layer.classList.contains('pl-sheet')) {
        layer.classList.remove('pl-sheet');
      }
    }
  };

  watchSheetsCallback();
  assert.equal(layer.mutationCount, 0, '未打开且无 pl-sheet 时，不得触发 classList.remove 突变');
});

test('源码静态检查：motion-dialogs.js 中的 watchModals 与 markConfirmSheets 均已条件守卫', () => {
  // 1. watchModals 中 remove('pl-confirm-open') 必须先检查 contains('pl-confirm-open')
  assert.match(
    dialogsSrc,
    /layer\.classList\.contains\(['"]pl-confirm-open['"]\)\s*\)\s*\{\s*layer\.classList\.remove\(['"]pl-confirm-open['"]\)/,
    'watchModals 必须在 contains("pl-confirm-open") 成立时才调用 remove("pl-confirm-open")',
  );
  assert.doesNotMatch(
    dialogsSrc,
    /if\s*\(!layer\.classList\.contains\(['"]open['"]\)\)\s*layer\.classList\.remove\(['"]pl-confirm-open['"]\);/,
    '不得出现无条件的 layer.classList.remove("pl-confirm-open")',
  );

  // 2. markConfirmSheets 中 toggle('pl-confirm-open') 必须检查状态差异
  assert.match(
    dialogsSrc,
    /layer\.classList\.contains\(['"]pl-confirm-open['"]\)\s*!==\s*isConfirm[\s\S]*?layer\.classList\.toggle\(['"]pl-confirm-open['"],\s*isConfirm\)/,
    'markConfirmSheets 必须在状态不一致时才 toggle("pl-confirm-open", isConfirm)',
  );
});

test('源码静态检查：motion-layers.js watchSheets 观察 #modal-layer 时不得无条件 remove/toggle', () => {
  // 1. watchSheets 观察层关闭分支
  assert.match(
    layersSrc,
    /if\s*\(layer\?\.classList\.contains\(['"]pl-sheet['"]\)\)\s*layer\?\.classList\.remove\(['"]pl-sheet['"]\)/,
    'watchSheets 关闭分支必须在 contains("pl-sheet") 时才 remove("pl-sheet")',
  );

  // 2. watchSheets requestAnimationFrame 分支
  assert.match(
    layersSrc,
    /if\s*\(curLayer\?\.classList\.contains\(['"]pl-sheet['"]\)\)\s*curLayer\?\.classList\.remove\(['"]pl-sheet['"]\)/,
    'watchSheets RAF 关闭分支必须在 contains("pl-sheet") 时才 remove("pl-sheet")',
  );

  // 3. watchSheets 底部状态 toggle 必须检查状态差异
  assert.match(
    layersSrc,
    /if\s*\(curLayer\s*&&\s*curLayer\.classList\.contains\(['"]pl-sheet['"]\)\s*!==\s*bottom\)\s*curLayer\.classList\.toggle\(['"]pl-sheet['"],\s*bottom\)/,
    'watchSheets bottom 切换必须在当前状态不一致时才 toggle',
  );
});
