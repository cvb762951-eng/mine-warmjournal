import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

const motion = await read('motion.js');
const core = await read('core.js');
const appJs = await read('app.js');
const performance = await read('performance.css');
const styles = await read('styles.css');
const plainTheme = await read('themes-plain.css');
const vaultView = await read('views/private-vault.js');
const calendarView = await read('views/calendar.js');
const statsView = await read('views/stats.js');
const snippetsView = await read('views/snippets.js');

/**
 * 交互动效层（2026-10-10）
 *
 * 五件事：胶囊→弹窗的容器变形、卡片→详情的共享元素、旋转描边+呼吸背光、
 * 列表交错入场、按钮按压物理。
 *
 * 最容易出问题的不是"动画好不好看"，而是三条纪律：
 *   ① 尊重系统「减弱动态效果」；② 动画不能拖垮功能（全部要兜底）；
 *   ③ 不许为此新增样式表文件（会多一条"送不到设备上"的链路）。
 */

test('动效层：四个原子动作都在一个地方，且都尊重「减弱动态效果」', async () => {
  for (const name of ['morphFrom', 'beginSharedElement', 'autoStagger', 'installPressFeedback']) {
    assert.match(motion, new RegExp(`export function ${name}`), `缺少 ${name}`);
  }
  // 统一的开关：所有动画都要过 canAnimate，它包含 prefersReducedMotion
  assert.match(motion, /export const prefersReducedMotion/, '要有统一的系统偏好判定');
  assert.match(motion, /const canAnimate = \(\) => !prefersReducedMotion\(\)/, 'canAnimate 必须包含偏好判定');
  // 页面不可见时不跑动画（省电）
  assert.match(motion, /!document\.hidden/, '页面不在前台时不应跑动画');
  // 每一个原子动作都要走 safely 兜底
  const guarded = (motion.match(/safely\(/g) || []).length;
  assert.ok(guarded >= 6, `兜底太少（${guarded} 处），动画出错会拖垮功能`);
});

test('动效层：曲线是令牌，不是各处手写', async () => {
  assert.match(motion, /export const EASE = \{/, '缓动要集中成令牌');
  assert.match(motion, /fluid:/, '要有默认的流体曲线');
  assert.match(motion, /overshoot:/, '要有轻微超调曲线');
  assert.match(motion, /export const DURATION = \{/, '时长也要集中成令牌');
  // 超调幅度要克制：只允许超出一点点，多了就廉价
  assert.match(motion, /cubic-bezier\(0\.34, 1\.42/, '超调曲线不能过大');
});

test('容器变形：挂在 modal() 这一处，所有弹窗自动生效', async () => {
  assert.match(core, /import \{[^}]*morphFrom[^}]*\} from '\.\/motion\.js'/, 'core 要引入 morphFrom');
  const at = core.indexOf('export function modal(');
  const body = core.slice(at, core.indexOf('export function closeModal', at));
  assert.match(body, /morphFrom\(modalTrigger, dialog\)/, '弹窗打开时要跑容器变形');
  // 尺寸差太小时不该变形（否则会"抖一下"）
  assert.match(motion, /Math\.abs\(to\.width - from\.width\) < 24/, '尺寸接近时应跳过变形');
  // 变形不能缩放面板本身：那会把里面的文字拉变形，必须用独立的"面"
  assert.match(motion, /className = 'morph-surface'/, '要用独立的纯色面，不能缩放面板');
});

test('共享元素：详情是异步打开的，所以必须两段式交接', async () => {
  assert.match(motion, /export function beginSharedElement/, '要有两段式接口');
  // 先把源矩形和克隆体记下来，等目标出现再交接
  assert.match(motion, /return targetEl => \{/, '要返回一个"交接"函数');
  assert.match(motion, /cloneNode\(true\)/, '飞过去的应该是克隆体，不能动原节点');
  // 落点要有兜底：找不到目标就安静放弃
  assert.match(motion, /if \(!targetEl\) return;/, '没有目标时不能报错');
});

test('共享元素：优先用浏览器原生 View Transitions，且至少有 4 个真实落点', async () => {
  /* 业界当前最好的做法是 View Transitions API：浏览器把新旧状态各拍一张快照，
     对同名元素做位置/尺寸插值，全程在合成器上、不触发布局，比手写 FLIP 更准。
     ⚠️ 名字必须在同一份文档里唯一，结束后要清掉 —— 重名会让整次转场被静默跳过。 */
  assert.match(motion, /document\.startViewTransition/, '要用 View Transitions API');
  assert.match(motion, /export function withSharedTransition/, '要有一层封装');
  assert.match(motion, /viewTransitionName = name/, '要给源和目标挂同一个名字');
  assert.match(motion, /nextShareName/, '名字必须每次唯一，否则整次转场会被跳过');
  assert.match(motion, /viewTransitionName = ''/, '转场结束要清掉名字');
  // 不支持的内核退回手写 FLIP
  assert.match(motion, /export function beginSharedElement/, '要有 FLIP 回退');
  // 四个落点
  assert.match(snippetsView, /withSharedTransition\(button\.querySelector\('img'\)/, '随手拍照片要用共享元素');
  assert.match(vaultView, /withSharedTransition\(source/, '私密空间要用共享元素');
  assert.match(vaultView, /#vault-photo-image/, '落点要指向查看器里那张图');
  assert.match(calendarView, /withSharedTransition\(source/, '日历要用共享元素');
  assert.match(statsView, /withSharedTransition\(button/, '习惯档案要用共享元素');
  assert.match(statsView, /#subpage-habit-detail \.habit-hero-card/, '落点要指向档案头卡');
});

test('旋转描边与呼吸背光：只在合成器上跑，不做逐帧样式重算', async () => {
  /* ⚠️ 这是实测踩出来的红线：最初用 `@property --halo-angle` 动画锥形渐变的角度，
     结果**每秒 60 次样式重算**（摘掉光晕立刻 0），手机上"干什么都发涩"。
     现在的做法：外层静态遮罩圈出圆角矩形描边，内层只做 transform 旋转。 */
  // 注意：说明注释里会提到这个旧写法，所以要匹配真正的规则而不是任意出现
  assert.ok(!/@property\s+--halo-angle\s*\{/.test(performance), '不许再动画自定义属性驱动的渐变：会逐帧重算样式');
  assert.match(performance, /\.halo-sweep[\s\S]{0,400}conic-gradient/, '描边还是锥形渐变');
  assert.match(performance, /@keyframes halo-spin[\s\S]{0,140}rotate\(360deg\)/, '旋转必须靠 transform: rotate');
  assert.match(performance, /@keyframes halo-breathe/, '背光要呼吸');
  // 呼吸背光不许用 filter:blur —— 那会让每帧重新模糊
  const breathe = performance.slice(performance.indexOf('.halo-card::after'), performance.indexOf('@keyframes halo-breathe'));
  assert.ok(!breathe.includes('filter: blur'), '呼吸层不许用 blur 滤镜（每帧重新模糊）');
  // 只留一圈描边：用 mask 挖掉中间
  assert.match(performance, /mask-composite: exclude/, '要用 mask 挖空，只留描边');
  // 减弱动态效果时必须停
  const reduced = performance.slice(performance.indexOf('prefers-reduced-motion'));
  assert.match(reduced, /halo-ring[\s\S]{0,60}animation: none/, '减弱动效时要停掉旋转与呼吸');
});

test('动效性能红线：位移动画只许动 transform，不许动会触发布局的属性', async () => {
  /* 动画 left/top/width/height 会每帧重新布局 —— 这正是"点照片卡一下"的直接原因。
     两处都改成经典 FLIP（按目标/源尺寸放好，只做 transform）。 */
  const morph = motion.slice(motion.indexOf('export function morphFrom'), motion.indexOf('export function beginSharedElement'));
  const shared = motion.slice(motion.indexOf('export function beginSharedElement'), motion.indexOf('export function staggerIn'));
  for (const [name, body] of [['容器变形', morph], ['共享元素', shared]]) {
    assert.ok(!/\{[^}]*\bleft: `/.test(body), `${name}的关键帧不许动 left`);
    assert.ok(!/\{[^}]*\bwidth: `/.test(body), `${name}的关键帧不许动 width`);
    assert.match(body, /transform: `translate/, `${name}要用 transform 做位移`);
  }
  // 提升的也必须是 transform
  assert.match(performance, /\.morph-surface[\s\S]{0,300}will-change: transform/, '变形面只提升 transform');
  assert.match(performance, /\.shared-element-ghost[\s\S]{0,300}will-change: transform/, '幽灵只提升 transform');
  assert.ok(!performance.includes('will-change: left'), '不许提升 left/top/width/height');
});

test('按压物理：大块卡片不参与内阴影（那是绘制属性，每帧重绘）', async () => {
  /* 内阴影是绘制属性：补间它等于每帧重绘整个元素 —— 大卡片上就是"点照片整页发涩"的原因。
     所以分两档，而且内阴影只在按下那一瞬间切换，不做补间。 */
  assert.match(motion, /const PRESS_SOLID = \[/, '要区分"小控件"');
  assert.match(motion, /const PRESS_LIGHT = \[/, '要区分"大块"');
  const light = motion.slice(motion.indexOf('const PRESS_LIGHT'), motion.indexOf('export const PRESS_SELECTOR'));
  for (const big of ['.snippet-item-card', '.ledger-row', '.setting-item-row']) {
    assert.ok(light.includes(big), `${big} 属于大块，不该吃内阴影`);
  }
  // CSS 侧：大块那档必须显式声明不带阴影
  assert.match(performance, /data-press-light\]\[data-pressed\] \{[^}]*box-shadow: none/, '大块按下时必须没有内阴影');
  // 内阴影不许补间：基础规则只过渡 transform
  assert.match(performance, /\[data-pressable\] \{\s*transition: transform/, '基础规则只过渡 transform');
});

test('交错入场：按元素类型找同类项，不写死容器类名', async () => {
  assert.match(motion, /const CASCADE_ITEMS = \[/, '要有"哪些算列表项"的名单');
  assert.match(motion, /export function autoStagger/, '要有自动分组入口');
  assert.match(motion, /groups\.get\(parent\)/, '要按父元素分组，每组各自从 0 数');
  // 超长列表不做：入场会变成漫长的等待
  assert.match(motion, /children\.length > 60\) return/, '超长列表要跳过');
  // 渲染后要真的调用
  assert.match(core, /autoStagger\(root\)/, 'render 之后要跑交错入场');
});

test('按压物理：按下缩到 0.96 并压内阴影，释放带回弹', async () => {
  // JS 只切属性，动画在 CSS —— 这比 JS 逐帧写内联样式更快也更稳
  assert.match(motion, /setAttribute\('data-pressed'/, '按下只切换属性');
  assert.match(motion, /removeAttribute\('data-pressed'\)/, '松开只切回属性');
  // ⚠️ 只看按压那一段，别全文搜 —— FLIP 回退里合法地用着 sourceEl.animate()
  const pressSection = motion.slice(motion.indexOf('export function installPressFeedback'));
  assert.ok(!pressSection.includes('.animate('), '按压不该由 JS 逐帧驱动');
  assert.match(performance, /\[data-pressable\]\[data-pressed\] \{[^}]*scale\(0\.96\)/, '按下缩到 0.96 由 CSS 负责');
  assert.match(performance, /box-shadow: inset 0 2px 6px/, '按下要压一层内阴影');
  // 回弹用真实的弹簧曲线（由阻尼弹簧采样得出），不是随手写的控制点
  assert.match(performance, /--spring-release: linear\(/, '回弹要用弹簧曲线');
  assert.match(performance, /transition-timing-function: var\(--spring-release\)/, '回弹要真的用上它');
  // 事件委托：新渲染出来的按钮不用重新登记
  assert.match(motion, /document\.addEventListener\('pointerdown'/, '要用事件委托');
  assert.match(motion, /closest\?\.\(PRESS_SELECTOR\)/, '要按名单匹配，不是所有元素都缩');
  // 按下后指针移开再松手也要回弹，否则会卡在按下态
  assert.match(motion, /pointercancel/, '要有取消处理');
  assert.match(motion, /pointerleave/, '指针移出后松手也要回弹');
  assert.match(motion, /markPressables/, '要在按下之前先把属性打上，否则状态切换不会触发过渡');
  // 要在启动时挂载
  assert.match(appJs, /installPressFeedback\(\)/, '启动时要挂载按压物理');
});

test('动效层：不许为此新增样式表文件', async () => {
  const indexHtml = await read('index.html');
  const sheets = [...indexHtml.matchAll(/href="([a-z-]+\.css)/g)].map(m => m[1]);
  assert.deepEqual(sheets, ['fonts.css', 'performance.css', 'styles.css', 'themes.css', 'themes-plain.css'],
    '样式表只能这 5 个：多一个就多一条送不到设备上的链路');
  // 动效样式放在 performance.css 里（它本来就在第 2 位，先于所有主题）
  assert.match(performance, /动效层/, '动效样式要落在 performance.css');
});

/**
 * 「点进大图白屏闪一下」（2026-10-10 用户报）
 *
 * 两个来源，都是"一整屏白"：
 *   ① 清简主题里我把 `.modal` 统一刷成了白底，**没排除沉浸式看图/看视频** ——
 *      而且权重 (0,3,0) 压过源码 `.modal.photo-modal` 的 (0,2,0)，必然生效；
 *   ② 容器变形垫的那块"面"，遇到整屏弹窗会实打实盖住屏幕一下，背景透明时还会回退成白色。
 */
test('沉浸式弹窗不许被主题刷白，也不许走容器变形', async () => {
  const themes = await read('themes.css');
  // ① 主题里那条"统一白底"必须排除沉浸式弹窗
  const blanket = themes.match(/:root\[data-theme="plain"\] \.modal[^{]*\{/g) || [];
  assert.ok(blanket.length > 0, '找不到清简主题的 modal 规则');
  for (const sel of blanket) {
    if (!sel.includes(':not(')) continue;
    for (const immersive of ['photo-modal', 'vault-photo-modal', 'vault-feed-modal', 'vault-video-preparing', 'video-editor-modal']) {
      assert.ok(sel.includes(`:not(.${immersive})`), `白底规则必须排除沉浸式弹窗 .${immersive}`);
    }
  }
  assert.ok(blanket.some(sel => sel.includes(':not(.photo-modal)')), '看图器必须被排除，否则打开大图会先看到一整屏白');

  // ② 整屏弹窗不做容器变形
  assert.match(motion, /to\.width >= viewportW \* 0\.88/, '整屏弹窗要跳过容器变形');
  // ③ 背景透明时不许回退成白色
  assert.ok(!motion.includes("'#fff'"), '不许把透明的弹窗背景回退成白色（那会凭空闪一下白）');
  assert.match(motion, /transparentPanel/, '要识别"背景透明"的弹窗并跳过垫面');
});

/* 打开私密视频时的白块 + 白屏：
   视频复用了照片的共享元素，但落点 #vault-photo-image 并不存在。
   封面被从页面快照里抠走，Android WebView 的转场底是白的 —— 抠空处就是点击位置的白块，
   整页交叉淡化再闪一整屏白。准备弹窗还会从按钮上长出一块浅色面；<video> 在首帧前铺原生白底。 */
test('打开私密视频停在深色底上，照片仍走共享元素', async () => {
  const openHandler = vaultView.slice(vaultView.indexOf("$$('[data-open-vault-item]')"), vaultView.indexOf("$$('[data-vault-item-menu]')"));
  assert.match(openHandler, /item\?\.type === 'video'\) \{ open\(\); return; \}/, '点视频不能走共享元素转场');
  assert.match(openHandler, /withSharedTransition\(source/, '点照片仍要走共享元素');
  assert.match(openHandler, /#vault-photo-image/, '照片落点仍是查看器里的那张图');
  assert.match(vaultView, /vault-decrypting-modal vault-video-preparing/, '视频准备层要单独标成深色全屏');
  assert.match(motion, /vault-video-preparing'\)\) return null/, '视频弹窗不许从点击处长出一块面');
  assert.match(styles, /\.modal\.vault-video-preparing\{[^}]*background:#050807!important[^}]*animation:none!important/);
  assert.match(styles, /\.modal-layer:has\(\.vault-feed-modal\),\.modal-layer:has\(\.vault-video-preparing\)\{[^}]*background:#050807[^}]*animation:none/);
  assert.match(styles, /\.modal\.vault-feed-modal\{[^}]*animation:none!important/);
  assert.match(snippetsView, /class="is-awaiting-frame"/, '视频元素第一帧就绪前不能露出来');
  assert.match(snippetsView, /addEventListener\('loadeddata', revealVideoFrame/);
  assert.match(styles, /\.warm-video-canvas>video\.is-awaiting-frame\{opacity:0\}/);
  assert.match(plainTheme, /\.modal\.snippet-video-modal\.vault-feed-modal[\s\S]{0,500}background(?:-color)?: #050807 !important/, '清简主题不能把沉浸播放器刷白');
  assert.match(plainTheme, /\.modal\.vault-decrypting-modal\.vault-video-preparing[\s\S]{0,500}#050807 !important/);
});

test('共享元素：拍"新状态"快照前要等图片解码', async () => {
  /* 不等的话，快照里的图还是空白 —— 观感同样是"打开大图时闪一下"。
     View Transitions 的 update 回调支持 await，就是为这种场景准备的。 */
  assert.match(motion, /target\.decode\?\.\(\)/, '要等图片解码完再让浏览器拍快照');
  assert.match(motion, /!target\.complete/, '只在还没解码完时才等');
});
