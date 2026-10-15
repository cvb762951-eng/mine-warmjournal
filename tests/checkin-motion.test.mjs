import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

const styles = await read('styles.css');
const habits = await read('views/habits.js');

/**
 * 打卡动效（2026-10-15 用户要「打卡习惯或待办那个按钮的打卡动效」）
 *
 * 原来只有习惯圆勾有个很小的缩放（habitCheckPop），待办两处（今日页那排 / 待办弹层里）
 * 完全没有动效，只换了个图标。现在三处共用一套：
 *   圆勾「缩—弹—回」(checkInPop) + 一圈从圆心扩散出去的环 (checkInRing)。
 * 只用 transform / opacity：都在合成器上跑，不重排、不补间阴影。
 * 环用 currentColor，不写死颜色；减弱动效与 data-pl-motion="none" 整段关掉。
 */

test('打卡动效：圆勾缩弹 + 一圈扩散的环，三处共用同一套', () => {
  assert.match(styles, /@keyframes checkInPop \{/, '圆勾要有缩弹');
  assert.match(styles, /@keyframes checkInRing \{/, '要有扩散出去的环');
  // 三类圆勾都要接上（习惯圆勾 / 待办弹层里的勾 / 今日页那排待办的勾；hs-tick-dot 是待办详情页的）
  for (const sel of ['.habit-check-dot::after', '.hs-tick-dot::after', '.bento-item-check::after', '.daily-task-check .material-symbols-outlined::after']) {
    assert.ok(styles.includes(sel), `环要挂在 ${sel} 上`);
  }
  // 只动 transform / opacity：环的那段里不许出现会引发布局或大范围重绘的属性
  const ring = styles.slice(styles.indexOf('@keyframes checkInRing'), styles.indexOf('@keyframes checkInRing') + 220);
  assert.doesNotMatch(ring, /(width|height|margin|padding|box-shadow|filter|background-position)\s*:/, '只许动 transform / opacity');
  // 环用 currentColor（两端主题各自生效），不能写死颜色
  const ringRule = styles.slice(styles.indexOf('.habit-check-dot::after'), styles.indexOf('.habit-check-dot::after') + 260);
  assert.match(ringRule, /border: 1\.5px solid currentColor/, '环用 currentColor，别写死颜色');
});

test('打卡动效：低端机与"减弱动态效果"要整段关掉', () => {
  assert.match(styles, /:root:not\(\[data-pl-motion="none"\]\) \.bento-item-mini\.is-pop/, '低端机（data-pl-motion="none"）不走这套');
  assert.match(styles, /:root:not\(\[data-pl-motion="none"\]\) \.daily-task-check\.is-pop/, '待办弹层那处也要有同一道闸');
  const tail = styles.slice(styles.indexOf('@keyframes checkInRing'));
  assert.match(tail.slice(0, 2600), /prefers-reduced-motion[\s\S]*?animation: none !important/, '系统"减弱动态效果"时整段摘掉');
});

test('打卡动效：待办两处都要被触发（一个就地更新、一个重渲染后补', () => {
  // 弹层里那排是就地更新、弹层不重建 ⇒ 按钮还在，直接放
  assert.match(habits, /if \(markingDone\) celebrateHabitCheck\(button\)/, '待办弹层里勾完要放动效');
  // 今日页那排点完会整页重渲染 ⇒ 先记 id，等新节点出来再放（习惯那套也是这么做的）
  assert.match(habits, /let pendingTodoCelebrateId = null/);
  assert.match(habits, /if \(markingDone\) pendingTodoCelebrateId = todo\.id/, '点完先记下是哪一条');
  assert.match(habits, /querySelectorAll\('\.bento-item-mini\[data-toggle-todo\]'\)[\s\S]{0,220}celebrateHabitCheck\(tickBtn\)/, '重建后找到新节点再放');
  // 取消完成不该有"打卡"动效
  assert.doesNotMatch(habits, /celebrateHabitCheck\(button\);\s*\} else/, '只在该打上的时候放');
});
