import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

const model = await read('model.js');
const core = await read('core.js');
const themes = await read('themes.css');
const performance = await read('performance.css');
const indexHtml = await read('index.html');
const buildScript = await read('scripts/build-web.mjs');
const mineView = await read('views/mine.js');

/**
 * 主题皮肤系统（2026-10-08 新增）
 *
 * 设计：settings.theme 一个字段 + <html data-theme> 一个属性 + themes.css 一组变量覆盖。
 * 主题只影响观感，不碰数据与逻辑。
 */

test('主题字段存在且未知值会退回默认，避免老数据突然换色', () => {
  assert.match(model, /theme: 'classic'/, '默认必须是 classic，保证升级后观感不变');
  assert.match(model, /APP_THEMES = \['classic', 'sunny', 'plain'\]/, '主题清单应包含经典、暖阳与清简');
  assert.match(model, /state\.settings\.theme = APP_THEMES\.includes\(state\.settings\.theme\) \? state\.settings\.theme : 'classic'/,
    '归一化必须把未知/缺失的主题退回 classic');
});

test('每个主题都有展示信息，供设置页渲染', () => {
  assert.match(model, /THEME_META = \{/, '需要主题展示信息表');
  for (const id of ['classic', 'sunny', 'plain']) {
    assert.match(model, new RegExp(`${id}:\\s*\\{[^}]*label:[^}]*description:[^}]*swatch:`), `${id} 应有 label/description/swatch`);
  }
});

test('APP_THEMES 与 themes.css 的覆盖块严格一一对应', async () => {
  // 这是最容易漏的地方：加了新主题 id 却忘记写 CSS 覆盖 → 界面静默不变色。
  const ids = [...model.matchAll(/APP_THEMES = \[([^\]]+)\]/g)][0][1]
    .split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
  assert.ok(ids.length >= 2, '至少应有两个主题');
  for (const id of ids) {
    if (id === 'classic') {
      // classic 是历史默认，直接沿用 styles.css 的 :root，不应有覆盖块
      assert.doesNotMatch(themes, new RegExp(`:root\\[data-theme="${id}"\\]`), 'classic 不需要覆盖块');
      continue;
    }
    assert.match(themes, new RegExp(`:root\\[data-theme="${id}"\\]`), `主题 ${id} 缺少 themes.css 覆盖块`);
  }
});

test('每个非默认主题都覆盖了全部关键色彩 token', () => {
  // 背景 / 文字 / 主色 / 暖色底 / 强调 / 玻璃 / 描边 / 阴影 —— 缺任何一类都会出现半新半旧
  const REQUIRED = [
    '--canvas', '--canvas-gradient', '--sheet', '--sheet-gradient', '--sheet-card',
    '--ink', '--ink-secondary', '--ink-muted',
    '--sage-green', '--sage-green-dark', '--sage-green-light',
    '--warm-beige', '--warm-beige-light', '--warm-taupe',
    '--terracotta', '--terracotta-dark', '--terracotta-light',
    '--gold-accent', '--gold-dark', '--gold-light',
    '--dock-bg', '--card-border', '--line',
    '--shadow-ambient', '--shadow-elevated', '--shadow-floating'
  ];
  for (const id of ['sunny', 'plain']) {
    const block = themes.match(new RegExp(`:root\\[data-theme="${id}"\\]\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] || '';
    assert.ok(block, `应存在 ${id} 主题块`);
    for (const token of REQUIRED) {
      assert.match(block, new RegExp(`\\${token}:`), `${id} 主题应覆盖 ${token}`);
    }
    // 主题不应改动与观感无关的尺寸/动效变量（否则不同主题排版会漂移）
    for (const token of ['--radius-md', '--space-card-padding', '--dock-height', '--ease-spring']) {
      assert.doesNotMatch(block, new RegExp(`\\${token}:`), `主题不应覆盖 ${token}`);
    }
  }
});

test('第二套令牌 --warm-* 必须同步覆盖，否则外壳不换肤', () => {
  // performance.css 里有独立的 :root 定义了一整套 --warm-*（styles.css 里没有这些名字），
  // 它们控制 html/body、.phone-shell、.subpage-layer、.modal、.floating-dock。
  // 只覆盖 styles.css 那套的话，换肤只生效一半 —— 页面本体变了、外壳还是旧色。
  const warmNames = [...new Set([...performance.matchAll(/^\s+(--warm-[a-z-]+)\s*:/gm)].map(m => m[1]))]
    .filter(name => name !== '--warm-glass-blur'); // 模糊半径与色温无关
  assert.ok(warmNames.length >= 12, `应识别出 --warm-* 令牌，实际 ${warmNames.length} 个`);

  for (const id of ['sunny', 'plain']) {
    const block = themes.match(new RegExp(`:root\\[data-theme="${id}"\\]\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] || '';
    for (const name of warmNames) {
      assert.match(block, new RegExp(`\\${name}:`), `${id} 主题漏了 ${name}（外壳会保持旧色）`);
    }
  }
});

test('themes.css 在 styles.css 之后加载，且已登记进构建脚本', () => {
  const styleIdx = indexHtml.indexOf('styles.css');
  const themeIdx = indexHtml.indexOf('themes.css');
  assert.ok(styleIdx > -1 && themeIdx > -1, '两个样式表都要被引入');
  assert.ok(themeIdx > styleIdx, 'themes.css 必须在 styles.css 之后加载，否则覆盖失效');
  assert.match(buildScript, /'themes\.css'/, 'build-web.mjs 是显式白名单，漏登记会导致 themes.css 不进包');

  // 清简主题的质感重置：必须排在 themes.css 之后，且同样要登记进白名单
  const plainIdx = indexHtml.indexOf('themes-plain.css');
  assert.ok(plainIdx > themeIdx, 'themes-plain.css 必须排在 themes.css 之后加载');
  assert.match(buildScript, /'themes-plain\.css'/, 'themes-plain.css 必须登记进构建白名单，否则不进包');
});

test('清简主题：质感重置只作用于本主题，且确实存在', async () => {
  const plainCss = await read('themes-plain.css');
  const body = plainCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = body.match(/[^{}]+\{/g) || [];
  assert.ok(rules.length >= 3, `生成的覆盖规则太少（${rules.length} 条），可能脚本没跑`);

  /* 每一条规则的**选择器列表**都必须带 [data-theme="plain"] 前缀，漏一个就污染其他主题。
     ⚠️ 不能按行判断：选择器列表可以是多行的（浅色化层里大量用 :is(...) 跨行写法），
        续行不带前缀是合法的。这里按"花括号前的那段选择器文本"整体判断。 */
  const selectorBlocks = body.match(/(^|\})\s*([^{}]+)\{/g) || [];
  for (const block of selectorBlocks) {
    const selectors = block.replace(/[{}]/g, '').trim();
    if (!selectors) continue;
    /* 2026-10-15：降级块的选择器前面统一多了一道 `:root:not([data-pl-motion-explicit="rich"])`
       （用户可以在设置里选"始终完整"压过系统的减弱动效）。判断主题前缀前先剥掉那个 :not(...) 即可，
       注意别连 `:root` 一起剥掉。 */
    const bare = selectors.replace(/:not\(\[data-pl-motion-explicit="rich"\]\)/g, '');
    if (/^(@|:root\[data-theme="plain"\])/.test(bare)) continue;
    if (/^:root\[data-theme="plain"\][\s\S]*/.test(bare)) continue;
    assert.fail(`出现未加主题前缀的选择器：${selectors.slice(0, 70)}`);
  }

  // 撤掉的是图片，不是颜色 —— 颜色一旦被清掉，页面会变透明/空白
  assert.doesNotMatch(plainCss, /background-color:\s*none/, '不得清掉底色');
  assert.match(plainCss, /background-image:\s*none/, '应清掉图片图层');
  assert.match(plainCss, /border-image:\s*none/, '应清掉纸边框');
  // 生成脚本要留在仓库里，否则无从复现
  const generator = await read('scripts/gen-plain-theme.mjs');
  assert.match(generator, /themes-plain\.css/, '生成脚本应产出 themes-plain.css');
});

test('applyTheme 只切属性、不碰数据，且能用 classic 复位', () => {
  assert.match(core, /export function applyTheme/, 'core 应导出 applyTheme');
  assert.match(core, /root\.removeAttribute\?\.\('data-theme'\)/, 'classic 应移除属性回到默认 :root');
  assert.match(core, /root\.setAttribute\?\.\('data-theme', next\)/, '其他主题应写入 data-theme');
  assert.match(core, /export function render\([\s\S]{0,120}?applyTheme\(\)/, 'render 应自动应用主题');
  // 主题应用不得写 state（避免 save 风暴与意外持久化）
  const fn = core.match(/export function applyTheme[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(fn, /state\.[a-zA-Z]+ =/, 'applyTheme 不得修改 state');
});

test('设置页提供主题选择且点选即时生效', () => {
  assert.match(mineView, /data-theme-option=/, '主题卡片需要可点击的标记');
  assert.match(mineView, /function selectTheme\(/, '应有独立的换肤函数');
  assert.match(mineView, /applyTheme\(theme\)/, '换肤应即时应用，不等保存');
  assert.match(mineView, /save\(\)\.catch/, '换肤后应落库，且失败要有提示');
  // 入口文案应反映当前主题
  assert.match(mineView, /THEME_META\[state\.settings\?\.theme\]/, '设置入口应显示当前主题名');
});

/* ---------------------------------------------------------------------------
   清简主题的「质感重置」生成器行为回归（2026-10-09）
   这些断言对应三次真实返工：暖底没中性化、深色纸撤掉后浅字消失、
   以及把"本来就该透明"的元素刷上深底把文字压没。
   --------------------------------------------------------------------------- */

const plainRules = async () => {
  const css = (await read('themes-plain.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({
    selectors: m[1].split(',').map(s => s.trim()).filter(Boolean),
    decl: m[2].trim(),
    body: m[2]
  }));
};

const ruleFor = (rules, needle, declMatch) =>
  rules.filter(r => r.selectors.some(s => s.includes(needle)) && (!declMatch || declMatch.test(r.decl)));

test('清简主题：三个中性色令牌必须定义在 plain 块里，否则生成的选择器拿不到值', () => {
  const block = themes.match(/:root\[data-theme="plain"\]\s*\{[\s\S]*?\n\}/)?.[0] || '';
  for (const name of ['--plain-surface', '--plain-canvas', '--plain-ink-block']) {
    assert.match(block, new RegExp(`\\${name}:`), `${name} 必须定义在 plain 主题块内`);
  }
});

test('清简主题：页面级暖色底改画布灰、深色纸块改深色实底，两组都必须产出', async () => {
  const rules = await plainRules();
  assert.ok(ruleFor(rules, '.floating-dock', /--plain-ink-block/).length, '底栏原本靠深色纸衬托浅字，必须补深色实底');
  assert.ok(ruleFor(rules, '.today-view .weather-box', /--plain-ink-block/).length, '天气块同理');
  assert.ok(ruleFor(rules, '.today-view .today-courses', /--plain-ink-block/).length, '今日课程块同理');
  // 页面级容器：整页写死的暖色要换成画布灰，否则"卡片白 + 页面米黄"糊成一片
  const canvas = rules.filter(r => /--plain-canvas/.test(r.decl));
  assert.ok(canvas.length, '应存在"页面底改画布灰"这一组');
  assert.ok(canvas.some(r => r.selectors.some(s => /#app|\.view|-view/.test(s))), '画布灰必须落在页面级选择器上');
});

test('清简主题：被后续规则重置为透明的元素，不得再刷底色（账本预算那行踩过）', async () => {
  const rules = await plainRules();
  // styles.css 里 #screen-ledger .ledger-budget-copy strong 先被写成砖红块，
  // 后面又被收口规则改回 background:transparent —— 生成器必须认后者。
  const bad = ruleFor(rules, 'ledger-budget-copy strong', /background-color/);
  assert.equal(bad.length, 0, '它最终是透明的，不该被补上任何底色');
  // 生成器要真的实现了"级联感知"，不是靠把这行写进黑名单
  const generator = await read('scripts/gen-plain-theme.mjs');
  assert.match(generator, /function backgroundReset/, '生成器应能识别"背景被重置为透明"的后续规则');
});

test('清简主题：靠 border-image ... fill 铺满的按钮也要补底，否则浅字压在白底上看不见', async () => {
  const rules = await plainRules();
  assert.ok(ruleFor(rules, '.daily-focus-starts button', /--plain-ink-block/).length,
    '「开始专注」这类按钮由深色纸 fill 撑底 + 浅色字，撤图后必须补深底');
  assert.ok(ruleFor(rules, '.focus-screen .focus-timer-actions .play', /--plain-ink-block/).length,
    '只改 background-image 的规则（尺寸在别处定）也要认作"铺满"');
});

test('清简主题：就近定义的色板必须指向元素本身，写在 :root 上完全无效', () => {
  // --editorial-* 定义在 .today-view 上、--cal-* 定义在 .calendar-view.cal-screen 上。
  // 元素自己的声明会遮蔽 :root 的继承值 —— 在 :root 上覆盖等于没写。
  assert.match(themes, /:root\[data-theme="plain"\] \.today-view\s*\{[\s\S]{0,200}?--editorial-red:/,
    '--editorial-* 必须覆盖在 .today-view 上');
  assert.match(themes, /:root\[data-theme="plain"\] \.calendar-view\.cal-screen\s*\{[\s\S]{0,200}?--cal-red:/,
    '--cal-* 必须覆盖在 .calendar-view.cal-screen 上');
  const rootBlock = themes.match(/:root\[data-theme="plain"\]\s*\{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(rootBlock, /--editorial-/, ':root 上写 --editorial-* 不起作用，别放错地方');
  assert.doesNotMatch(rootBlock, /--cal-/, ':root 上写 --cal-* 不起作用，别放错地方');
});
/**
 * 清简主题「静蓝」的浅色化层（2026-10-09 v7；2026-10-10 改为并入生成文件）
 *
 * 这一层必须排在生成结果**之后**才压得住 !important。
 * 早先的做法是单独发一个 themes-plain-light.css + 第 6 个 <link>，
 * 但多一个文件就多一个「送不到设备上」的风险：老装机包里没有它，
 * 热更新一旦中断，就会留下「新 index.html 引用它、文件却不在」的半截状态，
 * 表现为「用着用着一部分界面变回旧样子」（2026-10-10 用户实测）。
 * 现在由 gen-plain-theme.mjs 把它拼到 themes-plain.css 末尾，index.html 只引 5 个样式表。
 */
test('plain theme folds the light layer into the generated theme', async () => {
  const light = await read('themes-plain-light.css');
  const plain = await read('themes-plain.css');
  const genScript = await read('scripts/gen-plain-theme.mjs');
  assert.ok(light.length > 0, '浅色化层的源文件不能是空的');
  // 源文件仍然是 themes-plain-light.css（可手改），由脚本拼接
  assert.match(genScript, /themes-plain-light\.css/, '生成器必须去读浅色化层源文件');
  assert.ok(plain.includes('浅色化 + 美化层'), 'themes-plain.css 末尾必须拼进浅色化层');
  // 拼进来的内容必须在文件**末尾**，否则又会被前面的 !important 压掉
  const tail = plain.slice(-light.length - 600);
  assert.ok(tail.includes('#floating-dock .dock-btn.active'), '浅色化层必须位于生成文件末尾');
  // index.html 不再单独引它，少一个 <link> 少一个断链风险
  assert.ok(!indexHtml.includes('themes-plain-light.css'), 'index.html 不应再单独引用浅色化层');
  const sheets = [...indexHtml.matchAll(/href="([a-z-]+\.css)/g)].map(m => m[1]);
  assert.deepEqual(sheets, ['fonts.css', 'performance.css', 'styles.css', 'themes.css', 'themes-plain.css'],
    '样式表只能是这 5 个，且顺序不变');
  // 仍然照常打包：老版本的热更新 index.html 可能还在引用它，留着当兜底
  assert.match(buildScript, /'themes-plain-light\.css'/);
});

test('plain theme restores the Today dock glyph and keeps the active pill', async () => {
  const light = await read('themes-plain-light.css');
  // 「Today」那格的图标是一张羽毛 PNG（源样式把字形写成 font-size:0 + color:transparent），
  // 生成器把这个 PNG 当装饰图撤掉后整格会空白 —— 必须把字体字形放回来。
  // 注意用 lastIndexOf：注释里也会提到这个选择器，indexOf 会命中注释而漏掉真正的规则。
  const glyphAt = light.lastIndexOf('#dock-btn-today .material-symbols-outlined');
  assert.ok(glyphAt > -1, '必须为 #dock-btn-today 的图标补一条规则');
  assert.ok(
    light.slice(glyphAt, glyphAt + 400).includes('font-size: 21px !important'),
    'Today 那格的字形必须放回可见字号，否则整格只剩文字'
  );
  // 选中胶囊要用 id 选择器：生成器的 `.phone-shell:has(.xxx-view) .dock-btn.active`
  // 是 (0,6,0) 权重，普通 class 链压不过它，选中格会变白。
  assert.ok(light.includes('#floating-dock .dock-btn.active'), '选中胶囊必须用 id 选择器压过生成器');
});

/**
 * 热更新链路的健壮性（2026-10-10）
 *
 * 用户报「清简主题用着用着有一部分切回原始素材」。根因是文件送达链路有三个洞：
 * ① 单独发的新样式文件在老装机包里不存在，热更新中断就留下半截状态（上面已并入解决）；
 * ② 原生端「先删旧文件再改名」，那两行之间文件不存在，网页会回落到旧资源；
 * ③ 服务工作线程写死了一份 1.0.53 的预缓存清单，永远不被更新，可能 serve 出旧副本。
 */
test('hot update never leaves a resource missing mid-replace', async () => {
  const plugin = await read('android/app/src/main/java/com/mine/focus/AppUpdaterPlugin.java');
  // 只针对「网页资源热更新」（syncResources）这一条链路查 ——
  // 下载 APK 时删旧包是无所谓的（那个文件不给网页读）。
  const at = plugin.indexOf('public void syncResources');
  assert.ok(at > 0, '找不到 syncResources 方法');
  const body = plugin.slice(at, plugin.indexOf('@PluginMethod', at + 10));
  assert.match(body, /\.tmp/, '应当先下载到 .tmp 再落盘');
  assert.match(body, /ATOMIC_MOVE/, '替换必须用原子移动，避免出现「文件暂时不存在」的窗口');
  // 旧写法：先删旧文件（且删失败就报错），再改名 —— 那两行之间文件是不存在的。
  // 注意别写成「禁止出现 target.delete()」：downloadTo 的异常分支里删掉下载失败的
  // 半截文件是正确的，那个不能算问题。
  assert.ok(!body.includes('无法覆盖旧文件'), '不能先删旧文件再改名 —— 中间那一刻网页会回落到旧资源');
});

test('service worker never serves a stale page/script/style', async () => {
  const sw = await read('service-worker.js');
  // 不能有写死的版本化预缓存清单（旧版就是这么烂掉的）
  assert.doesNotMatch(sw, /v1\.0\.\d+/, '预缓存清单不能写死版本号');
  assert.doesNotMatch(sw, /cache\.addAll/, '不要预缓存静态清单 —— 它必然过期');
  // 页面/脚本/样式必须 network-first
  assert.match(sw, /NETWORK_FIRST/, '样式与脚本必须走 network-first');
  assert.match(sw, /'style'/, 'style 必须在 network-first 名单里');
});

test('app self-heals when the plain theme failed to load', async () => {
  const appJs = await read('app.js');
  const heal = appJs.slice(appJs.indexOf('function plainPaperStillShowing'), appJs.indexOf('async function boot'));
  assert.ok(heal.includes('function healPlainTheme'), '启动时要验一次清简主题是否真的生效');
  // 探针是 #app 上的纸纹图：清简撤掉素材后这里应该是 none
  assert.match(appJs, /healPlainTheme\(state\.settings\?\.theme\)/, '渲染后要调用自检');
  assert.match(heal, /mine-plain-theme-heal/, '提示要节流，避免反复打扰');
  assert.match(heal, /backgroundImage/, '自检要读实际计算样式，不能只看变量');
  assert.match(heal, /plain-theme-sheet/, '自检应重新打开清简样式表');
  assert.match(heal, /data-theme/, '自检应补上 data-theme');
  assert.doesNotMatch(heal, /location\.reload/, '纸纹还在时不要整页重载，那会把暖色纸闪烁再播一遍');
  assert.match(heal, /show\(/, '修不掉时给一句轻提示');
});

function earlyThemeScript(html) {
  const at = html.indexOf("const KEY = 'mine-warmjournal-theme'");
  assert.ok(at > 0, '解析期脚本要读主题短键');
  const start = html.lastIndexOf('<script>', at);
  const end = html.indexOf('</script>', at);
  return html.slice(start + '<script>'.length, end);
}

function runEarlyTheme({ storage = {}, cookie = '', userAgent = 'Mozilla/5.0' } = {}) {
  const sheet = { disabled: true, media: 'not all' };
  const attrs = {};
  const classes = new Set();
  const meta = { content: '#f5f1e8', setAttribute(name, value) { if (name === 'content') this.content = value; } };
  const document = {
    cookie,
    documentElement: {
      setAttribute(name, value) { attrs[name] = value; },
      classList: { add(name) { classes.add(name); } }
    },
    getElementById(id) { return id === 'plain-theme-sheet' ? sheet : null; },
    querySelector(selector) { return selector === 'meta[name="theme-color"]' ? meta : null; }
  };
  const localStorage = { getItem: key => (key in storage ? storage[key] : null) };
  const context = { document, localStorage, navigator: { userAgent } };
  vm.createContext(context);
  vm.runInContext(earlyThemeScript(indexHtml), context);
  return { attrs, classes: [...classes], sheet, meta };
}

test('first paint applies plain before storage boot and leaves other themes unloaded', () => {
  assert.match(indexHtml, /id="plain-theme-sheet"[^>]*href="themes-plain\.css[^"]*"[^>]*media="not all"[^>]*disabled/,
    '清简样式表默认不参与样式计算');
  assert.match(indexHtml, /html\[data-theme="plain"\][\s\S]*background-image:\s*none !important/,
    '清简外壳要在大样式表生效前先去掉纸纹');

  const plain = runEarlyTheme({ storage: { 'mine-warmjournal-theme': 'plain' } });
  assert.equal(plain.attrs['data-theme'], 'plain');
  assert.equal(plain.sheet.disabled, false);
  assert.equal(plain.sheet.media, 'all');
  assert.equal(plain.meta.content, '#EAF0F8');
  assert.deepEqual(plain.classes, []);

  const fromCookie = runEarlyTheme({ cookie: 'mine-warmjournal-theme=plain' });
  assert.equal(fromCookie.attrs['data-theme'], 'plain');
  assert.equal(fromCookie.sheet.disabled, false);

  const fromState = runEarlyTheme({
    storage: { 'mine-warmjournal-state-v1': '{"settings":{"theme":"plain"}}' }
  });
  assert.equal(fromState.attrs['data-theme'], 'plain');
  assert.equal(fromState.sheet.disabled, false);

  const sunny = runEarlyTheme({ storage: { 'mine-warmjournal-theme': 'sunny' } });
  assert.equal(sunny.attrs['data-theme'], 'sunny');
  assert.equal(sunny.sheet.disabled, true);
  assert.equal(sunny.sheet.media, 'not all');
  assert.equal(sunny.meta.content, '#fbf3e4');

  const classic = runEarlyTheme({ storage: { 'mine-warmjournal-theme': 'classic' } });
  assert.equal(classic.attrs['data-theme'], undefined);
  assert.equal(classic.sheet.disabled, true);
  assert.equal(classic.sheet.media, 'not all');

  const desktop = runEarlyTheme();
  assert.equal(desktop.attrs['data-theme'], undefined);
  assert.equal(desktop.sheet.disabled, true);
  assert.deepEqual(desktop.classes, []);
});

test('native webview hides the shell until a theme is known', () => {
  const webView = runEarlyTheme({
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.0.0 Mobile Safari/537.36'
  });
  assert.deepEqual(webView.classes, ['theme-pending']);
  assert.equal(webView.sheet.disabled, true, '还不知道是不是清简时不要让清简样式表参与样式计算');
  assert.equal(webView.sheet.media, 'not all');

  const knownPlain = runEarlyTheme({
    storage: { 'mine-warmjournal-theme': 'plain' },
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.0.0 Mobile Safari/537.36'
  });
  assert.equal(knownPlain.attrs['data-theme'], 'plain');
  assert.deepEqual(knownPlain.classes, [], '已经知道是清简时不要再藏外壳');
});

test('theme memory is mirrored beyond localStorage and the mine row names the active theme', async () => {
  assert.match(core, /function writeThemeCookie/, '主题要写入 cookie，解析期脚本才能同步读到');
  assert.match(core, /function mirrorThemeToNative/, '真机要有一份不依赖 WebView localStorage 的镜像');
  assert.match(core, /isPluginAvailable\?\.\('Preferences'\)/, '装机包里有 Preferences 时要一起镜像 THEME_KEY');
  assert.match(core, /Filesystem\.writeFile/, '当前装机包已有 Filesystem，用它做原生镜像');
  assert.match(core, /export async function primeThemeFromNativeMirror/, '数据库打开前要用原生镜像补主题');
  assert.match(core, /theme !== 'classic'/, '过期的 classic 镜像不能抢在状态库之前把清简揭成暖色纸');
  const appJs = await read('app.js');
  assert.match(appJs, /primeThemeFromNativeMirror\(\)/, '启动时要先补主题再打开数据库');
  assert.match(mineView, /const themeLabel = \(THEME_META\[state\.settings\?\.theme\] \|\| THEME_META\.classic\)\.label/,
    '我的页要取出当前主题名');
  assert.match(mineView, /backgroundImage \? '自定义壁纸' : esc\(themeLabel\)/,
    '主题行右侧要显示当前主题，而不是写死暖色纸张');
  assert.doesNotMatch(mineView, /暖色纸张/, '我的页不再把当前主题标成暖色纸张');
});

/**
 * 浅色化层的"小节完整性"（2026-10-10）
 *
 * 追加这个文件时踩过环境层面的坑：一次整节被静默丢掉（第九节），
 * 一次好几节被写重（五/七/八/十/十一，后来又重了十三）。两种都不会报错，
 * 只会让主题悄悄少一块或多一块 —— 这条测试就是为它们写的。
 * 生成器里也加了读取时按小节去重，双保险。
 */
test('浅色化层的小节既不缺也不重', async () => {
  const light = await read('themes-plain-light.css');
  const plain = await read('themes-plain.css');
  // ⚠️ 分隔线可能带尾部空格，`-{20,}` 后面要允许 \s*，否则匹配不到（踩过）
  const titleOf = text => [...text.matchAll(/^\/\* -{20,}\s*\n\s+([^\n]+)/gm)]
    .map(m => m[1].trim())
    .filter(t => /^[一二三四五六七八九十]+ · /.test(t));

  const titles = titleOf(light);
  assert.ok(titles.length >= 19, `小节太少（${titles.length} 节），文件可能被截断了`);

  /* ⚠️ 重复判断以**产物**为准，不以源文件为准：
     这个环境偶尔会把 `cat >> 文件 << 'EOF'` 执行两遍，源文件里就会多出一节。
     gen-plain-theme.mjs 在读取时已经按标题去重（保留最后一次），所以产物永远是干净的 ——
     真正生效的是产物，测试就该盯产物。源文件脏了只是"不整洁"，不该挡住发版。 */
  const generated = titleOf(plain);
  const dupInProduct = generated.filter((t, i) => generated.indexOf(t) !== i);
  assert.deepEqual(dupInProduct, [], '产物里小节重复了：' + [...new Set(dupInProduct)].join(' / '));
  const missing = titles.filter(t => !generated.includes(t));
  assert.deepEqual(missing, [], '这些小节没被拼进 themes-plain.css：' + missing.join(' / '));

  // 逐节抽查一个特征选择器 —— 整节丢了这里会直接失败
  const mustHave = [
    ['一', '.today-view .weather-box'],
    ['二', '.habit-detail-switcher > button.active'],
    ['三', 'modal-actions .save'],
    ['四', 'input:not([type="checkbox"])'],
    ['五', '.cal-detail-head'],
    ['六', '.journal-photo-wall-head'],
    ['七', 'color: inherit !important'],
    ['八', '.cal-archive-event.tone-sage'],
    ['九', '.journal-corner-note'],
    ['十', '#dock-btn-today .material-symbols-outlined'],
    ['十一', '#floating-dock .dock-btn.active'],
    ['十二', '.countdown-card'],
    ['十三', '.today-view #countdown-banner'],
    ['十四', 'border-radius: 20px !important'],
    ['十五', 'inset 0 1px 0 rgba(255, 255, 255, 0.95)'],
    ['十六', 'linear-gradient(135deg, #FFFFFF 0%, #F2F7FE 100%)'],
    ['十七', '--pl-danger-soft'],
    ['十八', '.snippet-filter-pill'],
    ['十九', '#journal-title-input'],
    ['二十', '.vault-export-meta'],
    ['二十', '.vault-export-meta']
  ];
  for (const [name, probe] of mustHave) {
    assert.ok(light.includes(probe), `第 ${name} 节的内容不见了（找不到 ${probe}）`);
  }
});
