import assert from 'node:assert/strict';
import test from 'node:test';

const elements = new Map();
globalThis.document = {
  documentElement: { classList: { toggle() {} }, style: {} },
  body: { classList: { add() {}, remove() {} } },
  querySelector(selector) { return elements.get(selector) || null; },
  querySelectorAll() { return []; },
  addEventListener() {}
};
globalThis.window = { addEventListener() {} };

const { bindPhotoViewerGestures } = await import('../views/common.js');

function viewer(options = {}) {
  const image = { style: {}, classList: { toggle() {} } };
  const chrome = { classList: { toggle() {} } };
  const stage = {
    setPointerCapture() {},
    getBoundingClientRect() { return { width: 360, height: 760 }; }
  };
  elements.set('#photo-viewer-stage', stage);
  elements.set('#photo-viewer-image', image);
  elements.set('.photo-viewer-chrome', chrome);
  bindPhotoViewerGestures(['one', 'two'], null, 0, options);
  return stage;
}

test('Moments fullscreen finger-down swipe opens the next entry and finger-up opens the previous', () => {
  const directions = [];
  let stage = viewer({ onVerticalNavigate: direction => directions.push(direction) });
  stage.onpointerdown({ pointerId: 1, clientX: 120, clientY: 200 });
  stage.onpointermove({ pointerId: 1, clientX: 125, clientY: 285 });
  assert.deepEqual(directions, [1]);
  stage = viewer({ onVerticalNavigate: direction => directions.push(direction) });
  stage.onpointerdown({ pointerId: 2, clientX: 120, clientY: 285 });
  stage.onpointermove({ pointerId: 2, clientX: 125, clientY: 200 });
  assert.deepEqual(directions, [1, -1]);
});

test('vertical entry switching is opt-in and does not fire during pinch zoom', () => {
  const directions = [];
  let stage = viewer();
  stage.onpointerdown({ pointerId: 1, clientX: 100, clientY: 120 });
  stage.onpointermove({ pointerId: 1, clientX: 102, clientY: 220 });
  assert.deepEqual(directions, []);

  stage = viewer({ onVerticalNavigate: direction => directions.push(direction) });
  stage.onpointerdown({ pointerId: 1, clientX: 100, clientY: 120 });
  stage.onpointerdown({ pointerId: 2, clientX: 200, clientY: 120 });
  stage.onpointermove({ pointerId: 1, clientX: 100, clientY: 220 });
  stage.onpointerup({ pointerId: 2 });
  stage.onpointermove({ pointerId: 1, clientX: 100, clientY: 310 });
  assert.deepEqual(directions, []);
});
