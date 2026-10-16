import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const snippets = await readFile(new URL('../views/snippets.js', import.meta.url), 'utf8');
const performanceCss = await readFile(new URL('../performance.css', import.meta.url), 'utf8');
const motion = await readFile(new URL('../motion.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const plainLight = await readFile(new URL('../themes-plain-light.css', import.meta.url), 'utf8');

/* 2026-10-16 用户要求：随手拍里的**照片**也改成和视频封面一样的「扇形一叠」，
   并且把原来加在相册网格上的浮动效果挪到这一叠上（而不是相册）。
   —— 这一组断言就是那次改动的回归防线。 */

test('照片也走扇面：扇面不再以「有没有视频」为条件', () => {
  const card = snippets.slice(snippets.indexOf('function snippetStreamCard'), snippets.indexOf('if (item.kind === \'note\')'));
  assert.match(card, /const fan = \(photos\.length \|\| videos\.length\)/, '有照片就要走扇面');
  assert.doesNotMatch(card, /const fan = videos\.length/, '不能再只在有视频时才扇面');
});

test('纯照片的「+N」落点：直接开大图，不留给没人接的视频相册', () => {
  const card = snippets.slice(snippets.indexOf('function snippetStreamCard'), snippets.indexOf('if (item.kind === \'note\')'));
  assert.match(card, /const fanAlbumAttr = videos\.length/, '「+N」的落点要按有无视频分开算');
  assert.match(card, /data-view-snippet-photo="\$\{esc\(entry\.id\)\}" data-photo-index="0"/, '纯照片时点「+N」进大图');
  /* 这条属性本来就有绑定（bindSnippets 里按属性选），不用另加事件，否则会变成没人接的死按钮。 */
  assert.match(snippets, /\$\$\('\[data-view-snippet-photo\]'\)\.forEach/, '「+N」用的属性必须有现成绑定');
});

test('浮动从相册挪到扇面：相册网格里一点常驻动画都不留', () => {
  assert.doesNotMatch(performanceCss, /\.snippet-album-grid-cell > \* \{/, '相册格子不该再有常驻动画');
  assert.doesNotMatch(performanceCss, /\.snippet-album-grid-column \{ perspective/, '连透视也一起撤掉');
  assert.doesNotMatch(performanceCss, /\.is-near/, '「靠近抬起」整段下线，不留空转的类');
  assert.doesNotMatch(motion, /installAlbumPointerLift/, '那段监听也删掉');
  assert.doesNotMatch(app, /installAlbumPointerLift/, '入口一起删掉');
});

test('扇面的浮动必须把「姿态」一起写进关键帧，否则整叠会摊平', () => {
  const frames = performanceCss.slice(performanceCss.indexOf('@keyframes snippet-drift'));
  assert.match(frames.slice(0, 420), /rotate\(var\(--rot, 0deg\)\)/, '关键帧里要带着每张牌自己的旋转');
  assert.match(frames.slice(0, 420), /translateY\(var\(--lift, 0px\)\)/, '也要带着它的抬升');
  /* 相位靠 --i 错开，正好等于它在叠里的排位 —— 一叠牌才会「此起彼伏」而不是整体一起动 */
  assert.match(performanceCss, /:root\[data-pl-motion="rich"\] \.snippet-visual-wrap \.moment-spread-card \{/,
    '常驻动画只挂 rich 档（一屏可能十几张，lite 档不该跑）');
  assert.match(performanceCss, /animation-delay: calc\(var\(--i, 0\) \* -1\.35s\)/, '每张牌的相位要错开');
  /* 光有相位差不够：周期也一样长的话，四张牌会像节拍器一样同步上下。
     周期也要按牌位错开（--i 越大越慢），一叠牌才会此起彼伏。 */
  assert.match(performanceCss, /animation-duration: calc\(7\.6s \+ var\(--i, 0\) \* 0\.62s\)/, '周期也要错开');
  /* 关键帧不能只有一个峰值（那是纯正弦，看着像机器在呼吸）——
     数一数这条关键帧里写了几次 transform。 */
  const driftBody = performanceCss.slice(performanceCss.indexOf('@keyframes snippet-drift'));
  const stops = (driftBody.slice(0, 900).match(/transform: rotate\(/g) || []).length;
  assert.ok(stops >= 4, '浮动至少要 4 个关键帧（起 → 反向摆 → 最高 → 回落），现在是 ' + stops + ' 个');
});

test('扇面的浮动只作用在时间线那一叠，别碰编辑器里正在导入的那叠', () => {
  /* 导入中的那一叠有自己的飞入/退场动画（retireFanCard 会加 is-exiting），
     常驻动画会把它们压掉 —— 所以选择器必须限定在 .snippet-visual-wrap 里。 */
  assert.match(performanceCss, /:root\[data-pl-motion="rich"\] \.snippet-visual-wrap \.moment-spread-card \{/,
    '要限定在时间线的扇面上');
  const driftRules = performanceCss.split('\n').filter(line => /animation: snippet-drift/.test(line));
  assert.ok(driftRules.length >= 1, '至少要有一条扇面浮动规则');
  for (const line of driftRules) {
    assert.ok(line.includes('.snippet-visual-wrap') || line.startsWith('  animation'),
      '浮动规则不能落到编辑器那一叠上：' + line);
  }
});

test('减弱动态效果 / 关闭档：扇面的浮动要停住，但姿态不能清掉', () => {
  assert.match(performanceCss, /:root:not\(\[data-pl-motion-explicit="rich"\]\) \.snippet-visual-wrap \.moment-spread-card:not\(\.is-lifted\):not\(\.is-releasing\) \{ animation: none !important/,
    '系统减弱动效时要停掉浮动（但「按住拿起」是直接操作，要放过）');
  assert.doesNotMatch(performanceCss, /\.moment-spread-card \{ transform: none/,
    '🔴 不能把 transform 清成 none —— 那是每张牌的姿态，清掉整叠就摊平了');
});

test('按住一张牌拿起它：抬起 + 转正 + 置于顶层，松手滑回原位', () => {
  assert.match(motion, /export function installFanCardLift/, '要有这个手势');
  assert.match(app, /installFanCardLift\(\)/, '要在启动时装上');
  /* 只在时间线那一叠上生效 —— 编辑器/导入那一叠有自己的飞入与退场 */
  assert.match(motion, /closest\?\.\('\.snippet-visual-wrap\.is-moment-fan \.moment-spread-card'\)/, '要限定在时间线扇面上');
  assert.match(motion, /FAN_LIFT_HOLD_MS = 220/, '按住 220ms 才算拿起');
  /* 手指一动就放弃：否则滚动列表时会一路把牌拿起来 */
  assert.match(motion, /Math\.abs\(event\.clientX - origin\.x\) < 8/, '动了就判定成滚动/滑动，放弃拿起');

  /* 抬起那条动画必须把倾斜**转正**（这是「从一叠里抽出来」的关键一步），
     并且升到最上层、阴影加重。 */
  const lift = performanceCss.slice(performanceCss.indexOf('@keyframes fan-card-lift'), performanceCss.indexOf('@keyframes fan-card-settle'));
  assert.match(lift, /transform: rotate\(0deg\)/, '要转正');
  assert.match(performanceCss, /\.moment-spread-card\.is-lifted \{[\s\S]{0,220}box-shadow/, '抬起时阴影要更重');

  /* 🔴 层级只能改**内联** z-index：卡片生成时内联写死了 z-index:1~4，
     内联样式压过样式表 —— 在 CSS 里写 z-index 是死代码（2026-10-16 真机上就栽在这里：
     抬起动画照播，牌却一直压在别的牌下面）。 */
  assert.match(motion, /node\.style\.zIndex = '60'/, '升层级只能改内联值');
  assert.match(snippets, /z-index:\$\{pose\.i \+ 1\}/, '卡片确实带着内联 z-index（所以 CSS 里写没用）');
  assert.doesNotMatch(performanceCss, /\.moment-spread-card\.is-lifted \{[\s\S]{0,120}z-index: 60/,
    '不要再在样式表里写 z-index —— 那是死代码');
  assert.match(motion, /node\.style\.zIndex = raisedZ/, '松手要把原来的内联层级还回去');

  /* 「关闭」档（含真「减弱动态效果」）也要能抬起 + 置顶 —— 只是不走动画。
     否则用户按住没反应，会以为功能坏了。 */
  assert.match(performanceCss, /:root\[data-pl-motion="none"\] \.snippet-visual-wrap \.moment-spread-card\.is-lifted \{[\s\S]{0,120}transform: rotate\(0deg\)/,
    '关闭档要有静态的抬起态');
  assert.doesNotMatch(motion, /tierIsOff/, '手势本身不该被动效档位挡掉');

  /* 松手：先走 settle 回到姿态终点，并把浮动的相位归零 —— 否则浮动会接着
     上一次的相位重新开始，松手那一下会跳。 */
  assert.match(performanceCss, /@keyframes fan-card-settle/, '松手要有回落动画');
  assert.match(motion, /node\.style\.animationDelay = '0s'/, '松手要把浮动相位归零，避免跳一下');
  assert.match(motion, /node\.classList\.add\('is-releasing'\)/, '松手要先进入回落态');

  /* 拿起来过就不算点击：松手不该顺带把大图/播放打开 */
  assert.match(motion, /suppressed\.contains\(event\.target\)/, '要拦掉拿起之后那一次点击');
  /* 普通点一下（没拿起）不能进回落态，否则每点一次卡片都会抖一下 */
  assert.match(motion, /if \(!wasLifted\) return;/, '普通点击不要触发回落动画');
});

test('收尾定稿：只保留「浮动 + 相纸质感」，牌的大小/出框/文字位置全部回原样', () => {
  /* 2026-10-16 用户原话：「然后卡牌也变回原来的样式」+「只保留浮动和相纸质感」。
     这一轮加的东西只许剩两条 —— 相纸（白纸的边 + 两层阴影 + 内圈淡描边）和浮动。 */
  assert.match(plainLight, /\.moment-spread-card \{[\s\S]{0,300}border-width: 4px !important/, '相纸白边要留着');
  assert.match(plainLight, /0 1px 1px rgba\(46, 52, 59, 0\.10\), 0 10px 22px/, '两层阴影要留着');
  assert.match(plainLight, /\.moment-spread-frame \{[\s\S]{0,140}inset 0 0 0 1px/, '照片内圈的淡描边要留着');
  assert.match(performanceCss, /@keyframes snippet-drift/, '浮动要留着');
  assert.match(motion, /installFanCardLift/, '按住拿起（浮动那一套里的）也要留着');

  /* 其余一并回退 —— 谁再把它们加回来，这条会先红 */
  assert.match(styles, /--card-w: min\(168px, calc\(min\(120px, \(100% - 30px\) \/ var\(--n\) \* 1\.1\) \* 1\.46\)\)/, '用户选的大号牌：在原公式上 ×1.46、封顶 168');
  assert.doesNotMatch(styles, /calc\(100% \+ 40px\)/, '不许再让整叠外扩（不出框）');
  assert.doesNotMatch(styles, /height: calc\(var\(--card-w\)/, '框高不要再跟着牌算（回到原来的固定区间）');
  assert.doesNotMatch(snippets, /snippet-fan-copy/, '文字要留在卡片外面，不要再搬进底板');
  assert.match(styles, /clamp\(200px, 34vh, 280px\)/, '扇面高度回到原来的区间');
});

test('浮动的光影：两层光的图层，只动 transform / opacity（不许补间 box-shadow）', () => {
  assert.doesNotMatch(performanceCss, /fan-sheen/, '扫光已按用户要求去掉');
  assert.match(performanceCss, /@keyframes fan-toplight/, '顶光呼吸');
  /* 顶光必须挂 ::after：::before 排在内容之前，会被照片盖掉 */
  assert.match(performanceCss, /\.moment-spread-frame::after \{[\s\S]{0,400}animation: fan-toplight/, '顶光挂照片层的 ::after');
  assert.doesNotMatch(performanceCss, /\.moment-spread-frame::before \{[\s\S]{0,200}fan-toplight/, '::before 会被照片盖住，别用它');

  /* 🔴 红线：常驻动画不许补间 box-shadow（每帧重算阴影太贵），只许 transform / opacity */
  for (const name of ['fan-toplight', 'snippet-drift']) {
    const at = performanceCss.indexOf('@keyframes ' + name);
    assert.ok(at > 0, '找不到关键帧 ' + name);
    const body = performanceCss.slice(at, at + 700);
    assert.doesNotMatch(body, /box-shadow/, name + ' 不许补间 box-shadow');
    assert.match(body, /opacity|transform/, name + ' 只许动 transform / opacity');
  }

  /* 常驻光影只挂 rich 档；相位错开（不然四张牌整排同步） */
  assert.doesNotMatch(performanceCss, /moment-spread-card::after \{[\s\S]{0,400}animation:/, '牌上不再挂常驻光');
  assert.match(performanceCss, /:root\[data-pl-motion="rich"\] \.snippet-visual-wrap \.moment-spread-frame::after/, '顶光只挂 rich');
  assert.match(performanceCss, /animation-delay: calc\(var\(--i, 0\) \* -1\.1s\)/, '顶光相位错开');
  /* 浮动本身也加了左右漂移（纯 translate，还是只有 transform） */
  assert.match(performanceCss, /translateX\(1\.2px\) scale\(1\.012\)/, '浮动加了轻微左右漂移');

  /* 减弱动态效果：两层光一起收掉，别留一块静止的白斑 */
  const reduce = performanceCss.slice(performanceCss.indexOf('@media (prefers-reduced-motion: reduce) {\n  :root:not([data-pl-motion-explicit="rich"]) .snippet-visual-wrap .moment-spread-card'));
  assert.match(performanceCss, /prefers-reduced-motion: reduce\) \{[\s\S]{0,260}\.moment-spread-frame::after[\s\S]{0,260}opacity: 0 !important/, '减弱动效时这束光要收掉');
});
