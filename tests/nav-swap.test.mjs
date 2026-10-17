import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

const core = await read('core.js');
const performanceCss = await read('performance.css');
const styles = await read('styles.css');
const plainLayer = await read('themes-plain-light.css');

/**
 * 切页「闪一下」（2026-10-15 用户报：「是页面会闪一下」）
 *
 * 实测（412×919，逐帧记录「外壳透明度 × 页面透明度」）：
 *   改前 —— 每次切页最低可见度 **0**，连续 **8~12 帧**（约 130~200ms）整屏只剩底色；
 *   改后 —— 最低 0.55，一帧都不暗过一半。
 *
 * 根因有两条，都盯在这里：
 *   ① 新页面那条入场动画的起始透明度是 **0**（整页从全透明淡入）⇒ 前 100 多毫秒屏幕上
 *      只有底色，看着就是"闪一下"；而且它跟重建在同一个任务里，重建完成前画不出帧。
 *   ② `#app` 的整页淡入淡出如果一路淡到 0，会透出 WebView 的白底（仓库里踩过）。
 * ⇒ 现在改成：点下去先让整个外壳浅淡出（最低只到 .55）、重建放在下一帧做、
 *    重建完再淡回来；并且换页时**不再**叠那层"新页面从 0 淡入"。
 */

test('切页：重建放进下一帧，点下去第一帧就有动作', () => {
  assert.match(core, /const routeChanged = route !== state\.route/, '要能判断"是不是真的换页"');
  assert.match(core, /nav-swap-out/, '换页要先把外壳推出去');
  assert.match(core, /nav-swap-in/, '重建完要把外壳淡回来');
  /* 2026-10-18 方案 A：重建不再放在「同一个 rAF 里」，而是等离场真的画完再重建。
     原来 rAF 回调同步执行 render()，浏览器必须先干完 40~90ms 的活才能出下一帧，
     结果那 150ms 的离场一帧都没被画出来（实测点击后第一个绘制帧就已经是 in 状态）。
     ⇒ 现在必须是 setTimeout(..., NAV_SWAP_OUT_MS) 里做重建，且常量与 CSS 时长一致。 */
  const go = core.slice(core.indexOf('const launcher = routeChanged'), core.indexOf('// ---- 统一页面历史'));
  assert.match(go, /setTimeout\(\(\) => \{[\s\S]{0,300}apply\(false\)/, '重建要等离场画完（setTimeout 里）');
  assert.match(core, /const NAV_SWAP_OUT_MS = (\d+);/, '离场时长要有具名常量');
  const outMs = Number(core.match(/const NAV_SWAP_OUT_MS = (\d+);/)[1]);
  assert.match(performanceCss, new RegExp(`#app\\.nav-swap-out \\{ animation: navSwapOut ${outMs}ms`), 'CSS 离场时长要和 core.js 常量一致');
  assert.ok(outMs >= 60 && outMs <= 160, '离场时长落在 60~160ms（太短看不见，太长像卡住）');
  /* 2026-10-15 追加：换页那一帧给外壳打 data-route-enter，只有"真的进入这一页"才播整页入场；
     同页重渲染（点筛选/搜索）不播 —— 否则整页会先淡没再淡回来（用户录屏里 2.08s 那帧几乎全白）。 */
  assert.match(go, /launcher\.dataset\.routeEnter = '1'/, '换页这一帧要打标记');
  assert.match(go, /requestAnimationFrame\(\(\) => \{ delete launcher\.dataset\.routeEnter; \}\)/, '下一帧要把标记撤掉');
  assert.match(core, /if \(token !== navSwapToken\) return;/, '连点两个标签时只认最后一次');
  assert.match(core, /motionAllowed\(\)/, '减弱动态效果 / none 档要整段跳过');
});

test('切页：不再让新页面从 0 淡入（那就是闪一下的来源）', () => {
  // 改后：换页走外壳过渡，不挂 nav-transition；同页重渲染也同步渲染
  const goBody = core.slice(core.indexOf('export function go('), core.indexOf('// ---- 统一页面历史'));
  assert.doesNotMatch(goBody, /render\(true\)/, '换页不许再走"新页面整页进场"那条（起始透明度 0）');
  assert.match(goBody, /apply\(false\)/, '外壳过渡已经负责动效，页内重建不再叠一层');
  // 旧机制保留但不再被换页使用：它起始 opacity:0，是闪的根
  assert.match(styles, /@keyframes pageSpringEnter \{\s*from \{ opacity: 0;/, '（保留）新页面进场那条仍在');
  assert.match(plainLayer, /#app\.nav-transition > \.view \{ animation: pl-page-in/, '（保留）清简层那条仍在');
});

test('切页：外壳淡出/淡入都不许到 0（到 0 会露出底色）', () => {
  const block = performanceCss.slice(performanceCss.indexOf('@keyframes navSwapOut'), performanceCss.indexOf('@keyframes navSwapIn') + 420);
  assert.match(block, /@keyframes navSwapOut \{ to \{ opacity: \.55;/, '淡出只到 .55');
  assert.match(block, /@keyframes navSwapIn \{ from \{ opacity: \.55;/, '淡入从 .55 起');
  assert.doesNotMatch(performanceCss, /@keyframes navSwapOut \{[^}]*opacity: 0[;\s]/, '淡出不许淡到 0');
  assert.doesNotMatch(performanceCss, /@keyframes navSwapIn \{[^}]*opacity: 0[;\s]/, '淡入不许从 0 起');
  // 只动 opacity / transform（合成器上跑，不触发布局与绘制属性）
  assert.doesNotMatch(block, /(width|height|left|top|margin|padding|box-shadow|filter):/, '只许动 transform / opacity');
  // 降级块现在带着 `:root:not([data-pl-motion-explicit="rich"])` 守卫，会把间距撑长，所以切大一点
  // 2026-10-18：中间又插入了同页换内容、折叠区、新增落位几段，改成全文件定位，别再靠"距离"
  const guardLines = performanceCss.split('\n').filter(line => /nav-swap-(out|in)/.test(line) && /animation: none !important/.test(line));
  assert.ok(guardLines.length >= 1, '减弱动效时整段摘掉');
  const guard = guardLines.join('\n');
  assert.match(guard, /nav-swap-out/, '淡出也要一起摘掉');
  assert.match(guard, /nav-swap-in/, '淡入也要一起摘掉');
  assert.ok(guardLines.every(line => /:root:not\(\[data-pl-motion-explicit="rich"\]\)/.test(line)), '要给"始终完整"留出路');
});
