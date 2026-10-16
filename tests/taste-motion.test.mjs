import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

const performanceCss = await read('performance.css');
const styles = await read('styles.css');
const motion = await read('motion.js');
const tasteView = await read('views/taste.js');

/**
 * 吃喝记录 · 动效（2026-10-15）
 *
 * 这一套动效最容易出问题的不是"好不好看"，而是四条纪律：
 *   ① 只动 transform / opacity（动布局或绘制属性 = 每帧重排/重绘）；
 *   ② 低端机与「减弱动态效果」必须真的关掉，而且不能"卡着延时隐形"；
 *   ③ 不能和既有的列表级联（autoStagger + [data-stagger]）抢同一份 animation；
 *   ④ 点照片放大仍然直接开大图，不做进入动效（用户 2026-10-12 明确要求）。
 * 这条测试盯的就是这四条。
 */

/** 只取「吃喝记录 · 动效编排」这一节，并剥掉注释 ——
    注释里会写到被断言的原文（比如"不写 will-change"），不剥会自己撞自己。
    ⚠️ 必须从**包住标题的那个 /* 开始**截：标题本身在注释里，从标题处截会从注释中间开始，
    剥注释的正则就配不上对，注释文字会原样留下来。 */
function motionBlock(css) {
  const title = css.indexOf('吃喝记录 · 动效编排');
  assert.ok(title > -1, '找不到吃喝记录动效编排这一节');
  const start = css.lastIndexOf('/*', title);
  const rest = css.slice(start > -1 ? start : title);
  const next = rest.indexOf('View Transitions');
  const body = next > -1 ? rest.slice(0, rest.lastIndexOf('/*', next)) : rest;
  return body.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 按花括号配对取出关键帧 —— 这些关键帧都写在一行里，正则很难正确收尾。 */
function keyframesOf(css) {
  const out = [];
  const re = /@keyframes\s+(taste-[\w-]+)\s*\{/g;
  let match;
  while ((match = re.exec(css))) {
    let depth = 1;
    let index = re.lastIndex;
    for (; index < css.length && depth > 0; index += 1) {
      if (css[index] === '{') depth += 1;
      else if (css[index] === '}') depth -= 1;
    }
    out.push([match[1], css.slice(re.lastIndex, index - 1)]);
    re.lastIndex = index;
  }
  return out;
}

test('吃喝记录动效：落在 performance.css 里，不新增样式表', async () => {
  const indexHtml = await read('index.html');
  const sheets = [...indexHtml.matchAll(/href="([a-z-]+\.css)/g)].map(m => m[1]);
  assert.deepEqual(sheets, ['fonts.css', 'performance.css', 'styles.css', 'themes.css', 'themes-plain.css'],
    '样式表只能这 5 个，动效不许另起一个文件');
  assert.ok(motionBlock(performanceCss).length > 400, '动效编排要在 performance.css 里，且不是空壳');
});

test('吃喝记录动效：关键帧只动 transform / opacity，且不写中间帧', () => {
  const frames = keyframesOf(motionBlock(performanceCss));
  assert.ok(frames.length >= 6, `关键帧太少（${frames.length} 个），编排没写完`);

  const BANNED = ['width', 'height', 'left', 'right', 'top', 'bottom', 'margin', 'padding',
    'box-shadow', 'filter', 'background', 'border', 'font-size', 'opacity '];
  for (const [name, body] of frames) {
    assert.match(body, /transform:|opacity:/, `${name} 什么都没动？`);
    for (const prop of BANNED) {
      assert.doesNotMatch(body, new RegExp(`(^|[;{\\s])${prop}\\s*:`, 'i'),
        `${name} 里动了 ${prop} —— 位移动画只许动 transform / opacity`);
    }
    // 主题样式表里的约定：每个 @keyframes 只留 from / to，中间交给缓动曲线
    assert.doesNotMatch(body, /\d+%/, `${name} 写了中间帧 —— 本仓库的约定是关键帧只留 from/to`);
  }
});

test('吃喝记录动效：三拍的顺序写死在延时里（页头 → 主角卡 → 其余）', () => {
  const block = motionBlock(performanceCss);
  assert.match(block, /\.taste-header\s*\{\s*animation:\s*taste-head-in[^}]*backwards;\s*\}/, '页头要第一拍');
  assert.match(block, /\.taste-today-card\s*\{\s*animation:\s*taste-hero-in[^}]*60ms backwards;\s*\}/,
    '今日卡片要排在第二拍（60ms），它是这一页的主角');
  assert.match(block, /\.taste-controls-paper\s*\{\s*animation:\s*taste-row-in[^}]*140ms backwards;\s*\}/, '搜索是第三拍');
  assert.match(block, /\.taste-section > header\s*\{\s*animation:\s*taste-row-in[^}]*180ms backwards;\s*\}/, '栏目头是第三拍');
  assert.match(block, /\.taste-section > \.taste-day-group\s*\{\s*animation:[^}]*220ms backwards;\s*\}/, '日期组要有自己的延时');
  assert.match(block, /\.taste-entry-list > \.taste-entry-card\s*\{\s*animation:[^}]*20ms backwards;\s*\}/, '组内卡片要再错落一次');
});

test('吃喝记录动效：照片条横滑与日期细线的生长都是纯 transform', () => {
  const block = motionBlock(performanceCss);
  const frames = new Map(keyframesOf(block));
  assert.match(frames.get('taste-slide-in') || '', /transform: translate3d\(18px, 0, 0\)/, '照片条要从右边滑进来');
  assert.match(frames.get('taste-rule-in') || '', /transform: scaleX\(0\)/, '日期细线要用 scaleX 长出来');
  assert.match(block, /\.taste-today-strip > button:nth-child\(2\)[^}]*animation-delay: 165ms/,
    '照片条要一张张来，不是整条一起动');
  assert.match(block, /\.today-meal-strip > \*/, '今日首页那条入口要有同一套动效');
  assert.match(block, /\.taste-day-date::after[^}]*transform-origin: left center/,
    '细线要从左边开始长，不然会从中间往两头窜');
});

test('吃喝记录动效：低端机 / 减弱动效必须真关掉，且不能卡着延时隐形', () => {
  const block = motionBlock(performanceCss);
  const entrances = block.match(/animation:\s*taste-[\w-]+/g) || [];
  assert.ok(entrances.length >= 6, '入场规则太少');
  // 每一条入场规则都要么挂 data-pl-motion="none" 这道闸，要么只是改已有动画的延时
  const unguarded = block.split('\n')
    .map(line => line.trim())
    .filter(line => /animation:\s*taste-[\w-]+/.test(line))
    .filter(line => !line.includes('data-pl-motion="none"'));
  assert.deepEqual(unguarded, [],
    '有入场规则没挂 data-pl-motion="none" 这道闸，低端机会照样播：\n' + unguarded.join('\n'));
  /* ⚠️ 改延时的那几条也必须再写一遍这道闸。栅门那条 animation 是**简写**、里面已经带了延时，
     权重比裸的 `:nth-child()` 高 —— 少写一次，那条延时规则就静默失效：
     规则在、测试的字符串断言也过，但照片条和卡片其实是同时进来的（2026-10-15 真踩过）。 */
  const delayRules = block.split('\n').map(line => line.trim()).filter(line => /animation-delay:/.test(line));
  assert.ok(delayRules.length >= 5, '错落延时的规则太少，级联没写全');
  const weak = delayRules.filter(line => !line.includes('data-pl-motion="none"'));
  assert.deepEqual(weak, [],
    '这些延时规则没带闸，权重压不过上面那条简写，错落会静默失效：\n' + weak.join('\n'));
  /* 全局兜底只把时长压到 0.001ms，**延时还在** —— 带延时的元素会先隐形等一个延时再瞬间蹦出来，
     比不做动画更难看。所以本节必须自己把 animation 整个摘掉。 */
  const reduced = block.slice(block.indexOf('prefers-reduced-motion'));
  assert.match(reduced, /animation: none !important/, '减弱动效时要把 animation 摘掉，不能只压时长');
  for (const sel of ['.taste-today-card', '.taste-entry-list > .taste-entry-card', '.taste-day-date::after']) {
    assert.ok(reduced.includes(sel), `减弱动效那张名单漏了 ${sel}`);
  }
});

test('吃喝记录动效：不写 will-change，也不和既有的列表级联抢动画', () => {
  const block = motionBlock(performanceCss);
  /* 这些元素每次 render 都会重播动画，常驻提升等于一直占着合成层不放（列表越长越吃显存）。 */
  assert.doesNotMatch(block, /will-change/, '动效编排里不许写 will-change');
  /* autoStagger 会给名单里的元素加 [data-stagger]，那套动画由 performance.css 的 [data-stagger]
     和清简的浅色化层共同决定，权重比这里高 —— 两边同时命中就是两个动画打架。 */
  const cascade = motion.slice(motion.indexOf('const CASCADE_ITEMS'), motion.indexOf('export function autoStagger'));
  const list = cascade.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(list, /\.taste-/, '吃喝记录不能进 CASCADE_ITEMS，它有自己的编排');
});

test('吃喝记录动效：可按压元素登记进按压物理的两档名单', () => {
  const solid = motion.slice(motion.indexOf('const PRESS_SOLID'), motion.indexOf('const PRESS_LIGHT'));
  const light = motion.slice(motion.indexOf('const PRESS_LIGHT'), motion.indexOf('export const PRESS_SELECTOR'));
  // 小控件：筛选、餐次与态度的格子、投放区
  for (const sel of ['.taste-filter-rail button', '.taste-meal-picker span', '.taste-verdict-picker span', '#taste-pick-photos']) {
    assert.ok(solid.includes(sel), `${sel} 是小控件，该进 PRESS_SOLID`);
  }
  // 大块：卡片正文与照片 —— 大块那档不带内阴影（内阴影是绘制属性，每帧重绘）
  for (const sel of ['.taste-entry-body', '.taste-entry-cover', '.today-meal-chip']) {
    assert.ok(light.includes(sel), `${sel} 是大块，该进 PRESS_LIGHT`);
  }
});

test('吃喝记录交互动效：筛选/搜索时留下来的记录滑到新位置（FLIP），不瞬间跳过去', () => {
  /* FLIP 的实现放在 motion.js 里做成通用工具，views 与预览页共用同一份。 */
  assert.match(motion, /export function withFlip/, '重排滑位要有一个通用入口');
  assert.match(motion, /export function motionAllowed/, '要有统一的"现在能不能动"判断');
  assert.match(motion, /measureFlipRects/, '要先量旧位置（First）再改 DOM');
  assert.match(motion, /transform: `translate3d\(\$\{dx\}px, \$\{dy\}px, 0\)`/, '反向抵消只许用 transform');
  assert.match(motion, /dataset\?\.plMotion !== 'none'/, 'none 档要跳过，退化成瞬间重排');
  assert.match(motion, /el\.style\.animation = 'none'/, '参与 FLIP 的元素要摘掉入场动画，否则会被按在隐形状态');
  // 视图侧：筛选与搜索两条路都走 FLIP
  assert.match(tasteView, /function relayoutTasteList\(change\)/, '筛选/搜索要共用同一个重排入口');
  assert.match(tasteView, /withFlip\(document\.body, change, \{ item: CARD_ITEM/, '重排要对整份列表做，不是只对当前可见的');
  assert.match(tasteView, /mute: '\.taste-day-group'/, '日期组那层也要一起摘动画（它是被错落延迟的）');
  assert.equal((tasteView.match(/relayoutTasteList\(\(\) =>/g) || []).length, 2, '筛选和搜索都要接上');
});

test('吃喝记录交互动效：餐次筛选的选中块是滑过去的，不是闪现', () => {
  /* 逻辑收在动效层做成通用工具（预览页共用同一份），视图只负责每次渲染后摆一次。 */
  assert.match(motion, /export function mountRailMarker/, '要有一个通用的"选中底"工具');
  assert.match(motion, /const railMarkerX = new Map\(\)/, '按 rail 记住上一次的位置（rail 每次渲染都是新元素）');
  assert.match(motion, /const sliding = previous !== undefined && previous !== x/,
    '新挂上来的那块要先摆回上一次的位置再滑动，否则只会凭空出现');
  /* ⚠️ 判据必须是"有没有上一次的位置"，**不能**再带上"是不是刚挂上来的"：
     真机是整页重渲染（那块底每次都是新的），设计预览页是静态的（那块底一直在）——
     只看 fresh 的话，预览页里它会直接跳过去（2026-10-15 真踩过）。 */
  assert.doesNotMatch(motion, /const sliding = fresh &&/, '判据不能只看"是不是新挂的"，静态页面里就滑不起来了');
  assert.match(motion, /void marker\.offsetWidth/, '起点要先落定，不然会被合并成一次样式变更（看不到滑动）');
  assert.match(motion, /rail\.scrollTo\(\{ left: Math\.max\(0, x \+ box\.width \/ 2 - rail\.clientWidth \/ 2\)/,
    '选中的那块滑出栏外时要带回中间（只横着挪，不动整页）');
  const calls = tasteView.match(/mountRailMarker\(\$\('#taste-filter-rail'\)\)/g) || [];
  assert.equal(calls.length, 1,
    '⚠️ 只能摆一次：点击处理里再摆一次会把正在滑动的过渡关掉（读 style.transition 变成 none），滑动会静默消失');
  // 样式侧：滑动的底 + 没有脚本时仍然有选中态
  const block = motionBlock(performanceCss);
  assert.match(block, /\.rail-marker \{ position: absolute/, '滑动底要能绝对定位在按钮下面');
  assert.match(block, /:root:not\(\[data-pl-motion="none"\]\) \.rail-marker \{ transition: transform/,
    '滑动本身是 transform 过渡，且要挂 none 档的闸');
  assert.match(block, /\.has-rail-marker > button\.active \{ background: transparent/,
    '有滑动底时按钮自身不再画底（没跑脚本时 .has-rail-marker 不会加上，选中态照旧）');
  assert.match(block, /\.has-rail-marker > button \{ transition: color/,
    '选中底滑走的那一格颜色要跟着退回来，否则有 300ms 是白字压浅底');
});

test('吃喝记录交互动效：删掉一张照片，其余的滑过来补位', () => {
  assert.match(tasteView, /function removeTastePhoto\(index\)/, '要有单独的删除处理');
  assert.match(tasteView, /fill: 'forwards'/, '被删的那张要停在缩走的末态，不能缩完又弹回来');
  assert.match(tasteView, /out\.finished\.then\(drop, drop\)/, '动画失败也要把数据改掉（动画不能拖垮功能）');
  assert.match(tasteView, /withFlip\(preview \|\| document\.body,[\s\S]{0,120}\{ item: PHOTO_ITEM/,
    '删完要让其余几张滑到新位置');
  /* 2026-10-16 起：卡片本身 → 详情走共享转场（用户点名要的「点小卡长成大卡」），
     但「点照片直接开大图」这条红线不变 ⇒ 这里只查**照片那一段**，不再查整份文件。 */
  assert.match(tasteView, /withSharedTransition\(button, \(\) => tasteDetail\(entry\)/, '卡片本身要「长」成详情，不是换一页');
  const photoOpening = tasteView.slice(tasteView.indexOf("$$('[data-taste-photo]')"));
  assert.ok(photoOpening.length > 200, '要能定位到照片那一段');
  assert.doesNotMatch(photoOpening.slice(0, 500), /withSharedTransition\(|beginSharedElement\(/,
    '吃喝记录的照片放大直接开大图，不做进入动效/共享转场');
});

test('吃喝记录交互动效：点开一条之后，弹层里的内容依次落位', () => {
  const block = motionBlock(performanceCss);
  assert.match(block, /\.taste-detail > \* \{ animation: taste-row-in[^}]*backwards; \}/, '弹层内容要有入场');
  assert.match(block, /\.taste-detail > \*:nth-child\(2\) \{ animation-delay: 50ms; \}/, '标题→态度→照片→那段话要错开');
  for (const line of block.split('\n').map(l => l.trim())
    .filter(l => /\.taste-detail > \*/.test(l) && /animation: taste-/.test(l))) {
    assert.ok(line.includes('data-pl-motion="none"'), '弹层入场也要挂 none 档的闸：' + line);
  }
  const reduced = block.slice(block.indexOf('prefers-reduced-motion'));
  assert.ok(reduced.includes('.taste-detail > *'), '减弱动效那张名单漏了弹层内容');
  // 照片条滑一下停在整格上
  assert.match(block, /scroll-snap-type: x proximity/, '照片条要吸附到整格');
  assert.match(block, /scroll-snap-align: start/, '吸附点要在每格的开头');
});

test('吃喝记录动效：「刚记下」只落位一次，而且点照片依旧直接开大图', () => {
  // 落位只在保存那一次渲染里出现，渲染完就清掉 —— 否则每次筛选都会莫名弹一下
  assert.match(tasteView, /justAdded = \{ id: next\.id, at: Date\.now\(\) \}/, '保存后要记住是哪一条');
  assert.match(tasteView, /taste-entry-card verdict-\$\{entry\.verdict\}\$\{isJustAdded\(entry\.id\)/,
    '列表卡片要带 is-just-added 标记');
  assert.match(tasteView, /justAdded = null;\s*\/\/ 「落位」只播一次/, '渲染完要清掉标记，只播一次');
  assert.match(tasteView, /JUST_ADDED_MS = 10000/, '标记要有个有效期，从今日首页记完绕回来不该再弹');
  // 红线的另一头：点照片放大不做进入动效
  /* 2026-10-16 起：卡片本身 → 详情走共享转场（用户点名要的「点小卡长成大卡」），
     但「点照片直接开大图」这条红线不变 ⇒ 这里只查**照片那一段**，不再查整份文件。 */
  assert.match(tasteView, /withSharedTransition\(button, \(\) => tasteDetail\(entry\)/, '卡片本身要「长」成详情，不是换一页');
  const photoOpening = tasteView.slice(tasteView.indexOf("$$('[data-taste-photo]')"));
  assert.ok(photoOpening.length > 200, '要能定位到照片那一段');
  assert.doesNotMatch(photoOpening.slice(0, 500), /withSharedTransition\(|beginSharedElement\(/,
    '吃喝记录的照片放大直接开大图，不做进入动效/共享转场');
  const frames = new Map(keyframesOf(motionBlock(performanceCss)));
  assert.match(frames.get('taste-land') || '', /translate3d\(0, -14px, 0\) scale\(0\.985\)/,
    '「刚记下」要从上方落位');
});
