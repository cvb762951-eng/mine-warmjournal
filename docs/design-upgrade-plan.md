# 清简主题 · 美化与动效升级方案

> 本轮只交付方案和预览，**不改任何运行代码**。
> 预览页：`preview/design-upgrade.html`（单文件，自带 CSS / JS，手机浏览器可直接打开）。
> 基线：`main` @ `ff38b2e`（1.1.23 / versionCode 124）。

---

## 0. 先说结论

- **只动清简（plain）主题。** 所有新规则都写在 `themes-plain-light.css`，并且一律带 `:root[data-theme="plain"]` 前缀，然后重跑 `scripts/gen-plain-theme.mjs` 产出 `themes-plain.css`。经典 / 暖阳主题一行都不受影响，`styles.css` / `performance.css` 也不改（改了要连带重生成近 2000 条选择器，影响面太大）。
- **只用 CSS 能做完的，就不写 JS。** 除了两项可选（日历切月方向、下拉关闭弹层），全部是纯 CSS；可选的 JS 也不碰通知相关文件。
- **写到能照抄。** 第 3.0 节是完整 token 表，第 5.1 节是关键动效的 CSS 写法，第 5.2 节是手势阈值；其他模型落地时按这三节执行即可。
- **动效只动 `transform` / `opacity`。** 颜色、底色、描边的变化一律瞬时切换，不做补间。全部尊重 `prefers-reduced-motion`。
- **先减负、再加料。** 第一步是"几乎零视觉变化"的性能减负：去掉不透明底上看不见却每帧都要算的背景模糊（底栏、天气卡、课程卡、日期条等）、把主角卡光晕的旋转层从 1641×1911px（账本页 2259×2377px）缩小到约 440×440px、旋转一圈后停下。之后才动版式。
- **按块落地、可单独撤回。** 之前 #15 清简对齐因为局部不满意被整包撤回（#16），所以落地时每一步在 `themes-plain-light.css` 里各占一个独立小节，哪一块不喜欢就只删那一节。

---

## 1. 边界：哪些绝对不碰

| 类别 | 不碰的内容 | 原因 |
|---|---|---|
| 数据层 | `model.js`、`storage.js`、`core.js` 里的 state / normalize / 注册表 | 用户硬性要求；`VISUAL_RULES.md` §8 |
| 通知 | `notifications.js`、`app.js` 里的通知接线、`views/ai.js` / `views/focus.js` / `views/countdown.js` 中调用通知的部分、`views/mine.js` 的提醒设置区（含其 CSS 选择器） | 另一个 PR 正在修通知，避免冲突 |
| 已定型的交互手感 | `motion.js` 中的日记牌组（`mountJournalDeck` / `createDeckSpread` / `cycleDeckPhoto` / `fanIn` / `fanOut`）、共享过渡（`withSharedTransition` / `beginSharedElement`）、`views/snippets.js` 的图集一叠牌 | 用户已经调好的手感，不推倒重来 |
| 照片 | `photo-frame.js`（`photoFrameLayersHtml`）及所有 `.photo-blur-frame` / `.photo-blur-pad` / `.photo-blur-still` 规则 | 照片必须保持原始比例（contain 全片 + 同图铺底），不允许任何改动引入拉伸或裁切 |
| 看大图 | 点照片**直接开大图、不加入场动效** | 用户 2026-10-12 明确要求（见提交 `788d94c`） |
| 今日画页 | Photo Story 整块（含底部留白、字号） | #15 被撤回的直接原因就是这里（"底部留白太宽、字太小、不需要 Photo Notes"） |
| 字号 | 不缩小任何字号 | 同上，#16 的撤回理由之一 |
| 页面身份 | 日记 / 日历 / 账本页头右上角的手写角注纸签、随手拍的手写注 | `VISUAL_RULES.md` §2"统一 ≠ 一样"：只修位置，不删 |
| 版本号 | `index.html` 的 `?v=`、`build.gradle`、`package.json` | 由用户统一升版 |

---

## 2. 现状体检（实测）

方法：本地 `node scripts/build-web.mjs` 构建后，用无头 Chrome 以 390×844、DPR 2、清简主题打开六个主页面，读取元素真实几何与计算样式；另在 360 宽下复查横向溢出。

| # | 发现 | 实测数据 |
|---|---|---|
| D1 | 底栏贴满屏宽、贴底，圆角被屏幕切掉 | `.floating-dock` left 0 / right 390 / bottom 844 |
| D2 | 底栏高度随页面跳动 | 今日 / 日历 / 我的 64px，随手拍 / 日记 / 账本 72px |
| D3 | 选中胶囊比底栏高，顶出上沿 | 胶囊 70px 高，顶部比底栏高出 9px（771 vs 780） |
| D4 | 切页时选中块没有过渡 | `renderNav()` 每次 `innerHTML` 重绘，只剩图标的 `tabSpringBounce`（实测清简下生效，中途放大到 1.22，过冲明显） |
| P1 | 不透明底的块带 `backdrop-filter: blur(14px)` | 手写层第一节给 12 类元素（19 条选择器）加了模糊，底色都是不透明白 / 浅蓝。实测同屏：今日页有底栏、天气卡、课程卡，随手拍有底栏、日期条。模糊看不见，但滚动时每帧都要算 |
| P2 | 主角卡光晕的旋转层过大，且无限旋转 | `.halo-sweep` 实测随手拍 1641×1911px、账本 2259×2377px；DPR 2 下理论纹理 50MB 以上；5 个页面各一张；外加无限呼吸背光 |
| P3 | 弹层遮罩是暖黑 65% + 全屏模糊；toast 也带模糊 | `#modal-layer` `rgba(18,16,14,.65)` + `blur(14px) saturate(1.6)`，并且做 opacity 淡入 → 淡入的每一帧都在重算全屏模糊；`#toast` 底色是不透明的 `#55606C`，同样带模糊 |
| P4 | 卡片 hover / 状态切换在补间 `box-shadow` | `themes.css` 清简块 `.card` 等 `transition: box-shadow .3s`，违反 `motion.js` 自己的性能红线 2 |
| P5 | 整页入场带 `scale(.985)` | `pageSpringEnter`：整页缩放会让文字重新栅格化，低端机上发虚、发涩 |
| P6 | 动效令牌冲突 | `--ease-spring` 在 `performance.css` 是回弹曲线 `(.34,1.56,.64,1)`，在 `styles.css` 是缓出曲线 `(.16,1,.3,1)`，后者覆盖前者，读代码的人会误判 |
| T1 | 今日首屏天气卡与快捷操作卡错位 | 天气卡 top 203 / right 191，快捷卡 top 213 / left 186 → 上下差 10px、左右重叠 5px |
| T2 | 快捷入口四格是硬直角 + 竖线分隔 | 与周围 20px 圆角卡片不同族 |
| M1 | 随手拍统计头：光晕描边 + 内部 4 张小卡又各自带投影 | 卡套卡双层投影，显得"肿" |
| M2 | 筛选标签 5 个挤在一行 | 360 宽下"实况影像 (0)"贴边 |
| M3 | 日期条是 76px 高的蓝描边大胶囊 | 和内容卡抢视觉重心 |
| M4 | "拍立得"角标是直角深色块 | 圆角照片上压一块直角 |
| J1 | 心情 / 天气选中态：双环（2px 白 + 4px 蓝）+ 对勾溢出到相邻格 | 选中格的 `box-shadow: 0 0 0 2px #fff, 0 0 0 4px #3D5F9E` |
| J2 | 小节标题胶囊带蓝描边，压在选项网格上 | "这一天的心情与能量" |
| J3 | 角注纸签被裁 | `.journal-corner-note` right 397（390 宽）/ 367（360 宽） |
| L1 | 三项指标、账户小卡各带投影 | 又是卡套卡 |
| L2 | 我的账户：¥ 图标块是直角苔绿底、"管理"是直角按钮、账户名折两行 | "招商银行储蓄卡"在 4 列下必折行 |
| L3 | 空预算块 110px 高、大半空白 | 未设预算时 |
| C1 | 选中日是带旋转和投影的方块"贴纸" | 和清简的柔角语言不一致；切日期时没有任何反馈 |
| C2 | 档案标题条是蓝描边大胶囊 | 同 M3 |
| Me1 | 头像 80px 塞在 84px 高的卡里，圆环压出卡片上下边 | `.profile-avatar-control` 80px / 卡 84px |
| Me2 | 四项统计之间是弧形分隔 | 观感像没对齐 |
| Me3 | 列表图标块是直角浅蓝方块 | 卡片 20px 圆角，图标块 0 |
| ✓ | 横向溢出 | 六页在 360 / 390 下 `scrollWidth == clientWidth`，无溢出（超出的只有被裁掉的装饰层） |

> 截图和测量脚本在本地 `/tmp` 下运行，不进仓库。预览页里的"现状"一栏按上表数据复刻。

---

## 3. 设计语言（清简主题内统一）

### 3.0 设计 token 全表（照抄即可）

全部定义在 `themes-plain-light.css` 的 `:root[data-theme="plain"]` 块里。已有的变量（`--pl-blue` 等）**沿用原值**，新增的标 ★。

```css
:root[data-theme="plain"] {
  /* —— 颜色：画布与纸面 —— */
  --plain-canvas: #EAF0F8;        /* L0 页面底（已有，不要调白，用户说过"太白了"） */
  --pl-tray: #F2F6FC;             /* ★ L1 底托（现写死在第十五节） */
  --plain-surface: #FFFFFF;       /* L2 卡片（已有） */
  --pl-inset: #F5F8FD;            /* ★ L2 卡内小块的浅底（替代卡内投影） */

  /* —— 颜色：墨色 —— */
  --ink: #2E343B;                 /* 正文 / 标题（已有） */
  --ink-secondary: #5A6572;       /* 次要文字（已有） */
  --ink-muted: #98A1AD;           /* 辅助文字（已有） */
  --pl-dock-idle: #6B7480;        /* ★ 底栏未选中（现写死在第十一节） */

  /* —— 颜色：主题蓝 —— */
  --pl-blue: #4F76BD;             /* 主色：选中实底、主按钮、图标（已有） */
  --pl-blue-deep: #3D5F9E;        /* 按下 / 深一档文字（已有） */
  --pl-blue-soft: #EDF1FA;        /* 浅蓝底：底栏选中块、日期条（已有） */
  --pl-blue-tint: #E2EAF8;        /* 更深一档浅蓝：图标块底（已有） */
  --pl-blue-line: rgba(79, 118, 189, 0.22);  /* 蓝描边（已有） */
  --pl-line: rgba(85, 96, 108, 0.10);        /* 中性分隔线（已有） */

  /* —— 颜色：语义 —— */
  --pl-danger: #B4564F;           /* 删除文字（已有） */
  --pl-danger-soft: #FBEEEC;      /* 删除按钮底（已有） */
  --pl-scrim: rgba(46, 52, 59, 0.32);        /* ★ 弹层遮罩（替代暖黑 65% + 模糊） */
  --pl-toast: rgba(46, 52, 59, 0.92);        /* ★ toast 底（不模糊） */
  --pl-badge: rgba(46, 52, 59, 0.72);        /* ★ 照片角标底（"拍立得"） */

  /* —— 圆角：四档 —— */
  --pl-r-lg: 20px;                /* ★ 大卡 */
  --pl-r-md: 16px;                /* ★ 中块、底栏选中块 */
  --pl-r-sm: 12px;                /* ★ 图标块、小卡、角标 */
  --pl-r-pill: 999px;             /* ★ 胶囊 */
  --pl-r-dock: 22px;              /* ★ 底栏 */
  --radius-soft: 14px;            /* 照片框（已有，不改） */

  /* —— 阴影：三档 —— */
  --pl-shadow-card: 0 1px 2px rgba(46, 52, 59, 0.035), 0 8px 20px rgba(46, 52, 59, 0.055);   /* ★ L2，与第十五节现值一致 */
  --pl-shadow-float: 0 2px 6px rgba(46, 52, 59, 0.05), 0 16px 36px rgba(46, 52, 59, 0.12);   /* ★ L3：底栏、弹层、toast */
  --pl-shadow-btn: 0 4px 12px rgba(79, 118, 189, 0.22);       /* ★ 主按钮（比现有 --pl-blue-glow .28 降一档） */
  --pl-shadow-edge: -12px 0 32px rgba(46, 52, 59, 0.08);      /* ★ 二级页左缘，静态 */
  --pl-tray-inset: inset 0 1px 2px rgba(46, 52, 59, 0.035);   /* ★ L1 底托内凹 */

  /* —— 间距 —— */
  --pl-page-x: 14px;              /* ★ 页面左右（与现状一致） */
  --pl-gap: 10px;                 /* ★ 卡片之间 */
  --pl-gap-sm: 8px;               /* ★ 卡内元素之间 */
  --pl-card-pad: 16px;            /* ★ 卡片内边距 */

  /* —— 尺寸 —— */
  --pl-dock-h: 64px;              /* ★ 底栏高度，所有页一致 */
  --pl-dock-inset: 12px;          /* ★ 底栏左右外边距 */
  --pl-dock-bottom: max(10px, env(safe-area-inset-bottom));  /* ★ 底栏离底 */
  --pl-tap-min: 44px;             /* ★ 最小点击区 */

  /* —— 动效 —— 见 3.4 */
}
```

**字号**：不新增字号档，不缩小任何现有字号。只约束一条：辅助文字最小 11px（现有小于 11px 的逐个点名后再提，不批量改）。字体沿用 `VISUAL_RULES.md` §3 的双轨。

### 3.1 层级：四级，每级只有一种写法

| 层级 | 用在哪 | 写法 |
|---|---|---|
| L0 画布 | 页面底 | `#EAF0F8` + 顶部淡蓝光晕（保持现状） |
| L1 底托 | 装卡片的大容器（便当格、流水、账户区） | `#F2F6FC` + 极淡内凹（保持现状） |
| L2 卡片 | 内容卡 | 白底 + `--pl-card-shadow`，20px 圆角 |
| L3 浮层 | 底栏、底部弹层、toast | 白底 / 墨块 + `--shadow-floating` |

**规则：L2 里面的小块不再带投影**，只用 `#F5F8FD` 浅底或 1px `--pl-line` 分隔。这一条同时解决 M1、L1、Me2。

### 3.2 圆角：四档

20px 大卡 · 16px 中块 · 12px 图标块 / 小卡 / 角标 · 999px 胶囊。照片框沿用 `--radius-soft`（14px），**不改**。

### 3.3 选中态：一种

实心主题蓝 `#4F76BD` + 白字；需要额外确认时，对勾**放在格子内部右上角**，不外溢。不再用双环 `box-shadow`。（日记心情 / 天气是用户明确要求"一眼认出"的地方，所以保留实心蓝这个最强的表达，只去掉外溢。）

### 3.4 动效令牌（只在 plain 块里定义）

```css
:root[data-theme="plain"] {
  --pl-dur-press: 100ms;   /* 按下 */
  --pl-dur-quick: 180ms;   /* 小部件状态（对勾、选中日） */
  --pl-dur-base: 260ms;    /* 底栏滑块、分段控件 */
  --pl-dur-page: 280ms;    /* 页面入场 */
  --pl-dur-sheet: 320ms;   /* 底部弹层、二级页 */
  --pl-ease-out: cubic-bezier(.22, .61, .36, 1);   /* 进入 */
  --pl-ease-emph: cubic-bezier(.32, .72, 0, 1);    /* 位移较大的进入（= 现有 --ease-ios） */
  --pl-ease-in: cubic-bezier(.4, 0, 1, 1);         /* 退出：更快 */
  --pl-dur-sweep: 1600ms;  /* 主角卡扫光，只跑一次 */
  --pl-stagger-step: 30ms; /* 列表错落间隔 */
  --pl-stagger-max: 6;     /* 最多错落几个，之后的同时出现 */
}
```

按压回弹继续用现有的 `--spring-release`、列表入场继续用 `--spring-entrance`（都在 `performance.css`，已被测试锁定），不新造。退出时长一律取进入时长的约 70%。

### 3.5 性能预算

1. 只动 `transform` / `opacity`；颜色、底色、描边、阴影的变化瞬时切换。
2. 不新增常驻无限动画；现有的主角卡光晕在清简下改为"入场扫一圈后停"。
3. 去掉不透明元素上的 `backdrop-filter`；弹层遮罩、toast 改实色半透明，不模糊。
4. `will-change` 只在动画期间存在（沿用现有 `.stagger-done` 机制）。
5. 同屏同时运动的元素不超过 8 个（列表入场最多 6 个错落）。
6. 位移距离小：页面 8px、列表 10px、toast 8px；不做整页缩放。

### 3.6 减弱动态效果

`performance.css` 末尾已有全局兜底（所有 animation / transition 压到 0.001ms）。新增规则只要不加 `!important` 的时长就会被兜住；落地时另加一条测试断言，确保新动效都落在这个兜底下，且光晕、滑块在减弱模式下直接到终态。

---

## 4. 按页面的方案

每一条标注了对应的体检编号和落地步骤（见第 6 节）。

### 4.1 全局

| 项 | 现状 | 改进 | 步骤 |
|---|---|---|---|
| 底栏 | D1–D4：贴边、跳高、胶囊顶出、切页无过渡 | 悬浮岛：左右 12px、底部 `max(10px, 安全区)`、所有页统一 64px、22px 圆角、不透明白底不模糊；选中块改为底栏自身的 `::before`，用 `:has(.dock-btn:nth-child(n).active)` 算出位置，`transform: translateX()` 滑过去（260ms）；图标弹跳改为 0.92 → 1，无上抬过冲。浏览器不支持 `:has()` 时退回现有胶囊 | B |
| 背景模糊 | P1：不透明底上的模糊 | 全部去掉，视觉零变化 | A |
| 主角卡光晕 | P2：巨型旋转层 + 无限旋转 + 无限呼吸 | 旋转层改为卡宽 120% 的正方形（宽卡下足够覆盖对角线，像素量降到原来的约 1/16～1/20）；入场扫一圈（1.6s）后淡出，留一圈静态淡蓝细描边；呼吸背光改静态。注意 `tests/motion.test.mjs` 锁的是 `performance.css` 里的基础写法（锥形渐变、`rotate(360deg)`、呼吸关键帧），清简层只覆盖次数和尺寸，不动基础写法 | A |
| 卡片过渡 | P4：补间 `box-shadow` | 只过渡 `transform`；阴影瞬时切换 | A |
| 页面入场 | P5：整页 `scale(.985)` 360ms | `opacity` + `translateY(8px)`，280ms，`--pl-ease-out`，不缩放 | A |
| 列表错落 | 640ms、16px + 缩放、最多 7 个 | 420ms、10px、不缩放、最多 6 个 | A |
| 底部弹层 | P3：暖黑 65% + 全屏模糊 | 冷墨 `rgba(46,52,59,.32)` 实色遮罩，只淡 opacity（240ms）；面板 `translateY(100%) → 0`（320ms，`--pl-ease-emph`），收起 220ms `--pl-ease-in`；加顶部抓手条。照片 / 私密弹窗保持现有 `animation: none` | C |
| 二级页 | 推入 350ms，无层次 | 推入曲线不变；给二级页左缘加一道**静态**阴影，底下页面盖一层只动 opacity 的淡遮罩（0 → .06），推入时有前后层次 | C |
| Toast | 背景模糊 20px | 实色墨块 `rgba(46,52,59,.92)`，`translateY(8px)` + opacity 进出 | C |
| 选中态 | J1 等多处双环 | 统一为 3.3 节写法 | C |
| 硬直角残留 | T2、M4、L2、Me3 | 统一为 3.2 节四档 | C / D / F |
| 角注纸签 | J3：被屏幕裁掉 | 位置内收到 `right: 10px`，保留纸签本身与倾角 | C |
| 卡套卡投影 | M1、L1、Me2 | 3.1 节规则 | C |
| 动效令牌 | P6：`--ease-spring` 两处定义冲突 | 清简内改用 3.4 节 `--pl-*`，不碰全局令牌；在方案里记录冲突，留给以后统一 | A |

### 4.2 今日

| 项 | 现状 | 改进 | 步骤 |
|---|---|---|---|
| 首屏两卡 | T1：上下差 10px、左右重叠 5px | 同一基线、同高 72px、间距 10px；天气卡左侧蓝竖线取消（第十六节已有结论：竖线遇圆角会拐弯） | D |
| 快捷入口 | T2：四格直角 + 竖线 | 四张独立 16px 圆角小卡，间距 8px，图标主题蓝 | D |
| 习惯打卡 | 小圆勾弹一下（`celebrateHabitCheck`） | **保持不变** | — |
| 刊头 | `v3-masthead-rise` 错落 | **保持不变** | — |
| Photo Story | — | **不动**（见第 1 节） | — |

### 4.3 随手拍

| 项 | 现状 | 改进 | 步骤 |
|---|---|---|---|
| 统计头 | M1：光晕 + 小卡投影 | 光晕按全局方案；四张小卡改浅底无投影 | D |
| 筛选标签 | M2：一行挤满 | 横向滚动 + `scroll-snap`，右缘用 `mask-image` 渐隐提示还有更多；选中态瞬时切换 | D |
| 日期条 | M3：76px 蓝描边大胶囊 | 44px 高、浅蓝底、无描边，可选吸顶（`position: sticky`，需真机核对与页头角注不打架） | D |
| 卡片操作 | 编辑 / 删除 / 查看照片三颗胶囊挤在一起 | 统一 32px 高、间距 8px，删除用 `--pl-danger-soft` 浅底 | D |
| 拍立得角标 | M4：直角深色块 | 12px 圆角，`rgba(46,52,59,.72)` 实色，不模糊 | D |
| 图集一叠牌 | — | **保持不变** | — |
| 点照片看大图 | 直接打开 | **保持不变**，不加入场动效 | — |

### 4.4 日记

| 项 | 现状 | 改进 | 步骤 |
|---|---|---|---|
| 日期标题 | 贴着卡片上沿 | 卡片上内边距加到 18px | E |
| 心情 / 天气选中 | J1：双环 + 外溢对勾 | 实心蓝 + 白字，对勾在格内右上角；选中时对勾 `scale(.6) → 1` + opacity，160ms | E |
| 小节标题 | J2：蓝描边胶囊压在网格上 | 去掉胶囊，改为 13px 粗体小标题 + 前置 6px 蓝点，与网格间距 8px | E |
| 角注纸签 | J3 | 见全局 | C |
| 牌组 / 摊开 / 收起 | — | **保持不变** | — |

### 4.5 账本

| 项 | 现状 | 改进 | 步骤 |
|---|---|---|---|
| 总览卡 | 光晕；"记一笔"大胶囊蓝色光晕投影偏重 | 光晕按全局；"记一笔" 40px 高，投影降一档 | F |
| 三项指标 | L1：三张小卡各带投影 | 一条三栏，1px 竖线分隔，无投影（与账本分析页"三项指标分栏"同一身份） | F |
| 预算块 | L3：未设预算时 110px 空白 | 未设预算时收成一行 56px 提示条；设了预算后不变 | F |
| 支出 / 收入 | 两颗独立按钮，瞬间换色 | 分段控件，选中滑块 `translateX` 滑动 220ms（`:has()` 驱动，需按真实 DOM 核对） | F |
| 分类标签 | 选中是直角浅蓝块 | 12px 圆角 + 蓝描边 | F |
| 我的账户 | L2：直角苔绿 ¥ 块、直角"管理"、账户名折行 | ¥ 块改主题蓝浅底 12px 圆角；"管理"改胶囊；账户卡 2×2，名称单行省略 | F |

### 4.6 日历

| 项 | 现状 | 改进 | 步骤 |
|---|---|---|---|
| 选中日 | C1：旋转 + 投影的方块 | 36px 圆角 10px 蓝块，不旋转；今天未选中时显示蓝色细环；切换时新选中块 `scale(.86) → 1` + opacity，180ms | E |
| 档案标题条 | C2：蓝描边大胶囊 | 白卡标题行，无描边 | E |
| 切月 | 瞬间替换 | （可选）网格按方向 `translateX(±16px)` + opacity，220ms。需要在 `views/calendar.js` 给容器写一个 `data-dir`，属于可选的 JS 改动，可以不做 | E（可选） |

### 4.7 我的

| 项 | 现状 | 改进 | 步骤 |
|---|---|---|---|
| 个人卡 | Me1：头像 80px 压出卡边 | 卡片上下内边距 16px，头像 64px，相机角标收进圆内 | F |
| 四项统计 | Me2：弧形分隔 | 四等分 + 1px 直竖线；数字滚动沿用现有 `rollNumbers` | F |
| 列表图标块 | Me3：直角方块 | 40px、12px 圆角、浅蓝底 | F |
| 提醒设置区 | — | **不动**（通知 PR 在改） | — |

---

## 5. 动效清单

| # | 动效 | 触发 | 动的属性 | 时长 / 曲线 | 减弱动效时 | 新 / 保持 |
|---|---|---|---|---|---|---|
| 1 | 页面入场 | 切换底栏页 | opacity、translateY 8px → 0 | 280ms `--pl-ease-out` | 直接出现 | 调整 |
| 2 | 列表错落 | 页面入场后 | opacity、translateY 10px → 0，间隔 30ms，最多 6 个 | 420ms `--spring-entrance` | 直接出现 | 调整 |
| 3 | 底栏选中滑块 | 切换底栏页 | 底栏 `::before` 的 translateX | 260ms `--pl-ease-emph` | 直接到位 | 新 |
| 4 | 底栏图标轻弹 | 切换底栏页 | 选中图标 scale .92 → 1 | 220ms `--pl-ease-out` | 无 | 调整 |
| 5 | 按压回弹 | 按下 / 松手 | scale .96（小控件）/ .988（大卡） | 90ms 按下、420ms `--spring-release` 回弹 | 无 | 保持 |
| 6 | 主角卡扫光 | 页面入场 | 旋转层 rotate 0 → 360°，opacity 0 → 1 → 0 | 1.6s 一次 | 只显示静态描边 | 调整 |
| 7 | 底部弹层 | 打开 / 关闭 | 面板 translateY；遮罩 opacity | 开 320ms `--pl-ease-emph`、关 220ms `--pl-ease-in` | 直接出现 / 消失 | 调整 |
| 8 | 二级页推入 | 打开 / 返回 | 二级页 translateX；底下淡遮罩 opacity | 350ms（沿用） | 直接切换 | 调整 |
| 9 | Toast | 提示出现 | opacity、translateY 8px → 0 | 200ms `--pl-ease-out` | 直接出现 | 调整 |
| 10 | 选中对勾 | 选心情 / 天气 | 对勾 scale .6 → 1、opacity | 160ms `--pl-ease-out` | 直接出现 | 新 |
| 11 | 选中日 | 点日期 | 选中块 scale .86 → 1、opacity | 180ms `--pl-ease-out` | 直接出现 | 新 |
| 12 | 分段滑块 | 支出 / 收入 | 滑块 translateX | 220ms `--pl-ease-emph` | 直接到位 | 新 |
| 13 | 切月（可选） | 点左右箭头 | 网格 translateX ±16px、opacity | 220ms `--pl-ease-out` | 直接替换 | 新 |
| 14 | 习惯打卡 | 点小圆勾 | 勾 scale + opacity | 现有 | 现有 | **保持** |
| 15 | 数字滚动 | 统计数字 | 文本（弹簧） | 现有 | 现有 | **保持** |
| 16 | 日记牌组切牌 / 摊开 / 收起 | 手势 | transform、opacity | 现有 | 现有 | **保持** |
| 17 | 图集一叠牌 | 手势 | transform、opacity | 现有 | 现有 | **保持** |
| 18 | 习惯卡 → 详情共享过渡 | 点卡片 | View Transitions / FLIP | 现有 | 现有 | **保持** |
| 19 | 点照片看大图 | 点照片 | 无 | — | — | **保持无动效** |

### 5.1 关键动效的落地写法

下面是规格级示例，选择器以真实 DOM 为准（落地前用无头 Chrome 核对一次）。所有规则带 `:root[data-theme="plain"]` 前缀，下文简写为 `P`。

**① 页面入场**（覆盖 `styles.css` 的 `pageSpringEnter`）

```css
P #app.nav-transition > .view { animation: pl-page-in var(--pl-dur-page) var(--pl-ease-out) both; }
@keyframes pl-page-in { from { opacity: 0; transform: translate3d(0, 8px, 0); } to { opacity: 1; transform: none; } }
```

**② 列表错落**（覆盖 `[data-stagger]`，JS 侧 `autoStagger` 不改，`max` 由 CSS 截断）

```css
P [data-stagger] {
  animation: pl-cascade 420ms var(--spring-entrance) backwards;
  animation-delay: calc(min(var(--stagger-index, 0), 6) * var(--pl-stagger-step));
}
@keyframes pl-cascade { from { opacity: 0; transform: translate3d(0, 10px, 0); } to { opacity: 1; transform: none; } }
```

**③ 底栏选中滑块**（纯 CSS；`renderNav()` 重绘的是按钮，`#floating-dock` 本身不换，所以伪元素的 transition 会正常触发）

```css
@supports selector(:has(*)) {
  P #floating-dock { --i: 0; padding: 6px 8px; }
  P #floating-dock:has(> .dock-btn:nth-child(2).active) { --i: 1; }
  P #floating-dock:has(> .dock-btn:nth-child(3).active) { --i: 2; }
  P #floating-dock:has(> .dock-btn:nth-child(4).active) { --i: 3; }
  P #floating-dock:has(> .dock-btn:nth-child(5).active) { --i: 4; }
  P #floating-dock::before {
    content: ''; position: absolute; left: 8px; top: 6px; bottom: 6px;
    width: calc((100% - 16px) / 5);
    border-radius: var(--pl-r-md); background: var(--pl-blue-soft);
    transform: translateX(calc(var(--i) * 100%));
    transition: transform var(--pl-dur-base) var(--pl-ease-emph);
  }
  P #floating-dock:not(:has(.dock-btn.active))::before { opacity: 0; }  /* 我的 / 二级页：没有选中项 */
  P #floating-dock .dock-btn.active { background: transparent !important; }  /* 交给滑块 */
}
P #floating-dock .dock-btn.active .material-symbols-outlined { animation: pl-dock-icon 220ms var(--pl-ease-out); transform: none; }
@keyframes pl-dock-icon { from { transform: scale(.92); } to { transform: scale(1); } }
```

**④ 主角卡扫光一次**（尺寸与次数覆盖，基础写法不动）

```css
P .halo-sweep { width: 120%; height: auto; aspect-ratio: 1; animation: pl-sweep-once var(--pl-dur-sweep) linear 1 both; }
@keyframes pl-sweep-once {
  0%   { opacity: 0; transform: translate(-50%, -50%) rotate(0deg); }
  15%  { opacity: 1; }
  80%  { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, -50%) rotate(360deg); }
}
P .halo-card::after { animation: none; opacity: .45; }
P .halo-card { box-shadow: var(--pl-shadow-card), inset 0 0 0 1px var(--pl-blue-line) !important; }  /* 静态描边 */
```

**⑤ 底部弹层**

```css
P .modal-layer { background: var(--pl-scrim); backdrop-filter: none; -webkit-backdrop-filter: none;
  transition: opacity 240ms var(--pl-ease-out), visibility 240ms; }
P .modal { transition: transform var(--pl-dur-sheet) var(--pl-ease-emph); }
P .modal-layer:not(.open) .modal { transition-duration: 220ms; transition-timing-function: var(--pl-ease-in); }
/* 照片 / 私密弹窗已有 animation:none / transform:none，保持不动 */
```

**⑥ 二级页层次**

```css
P .subpage-layer { box-shadow: var(--pl-shadow-edge); }   /* 静态，不补间 */
P .phone-shell::after { content: ''; position: absolute; inset: 0; z-index: 150; pointer-events: none;
  background: rgba(46, 52, 59, .06); opacity: 0; transition: opacity 350ms var(--pl-ease-out); }
P .phone-shell:has(> .subpage-layer.active)::after { opacity: 1; }
```

**⑦ 选中对勾 / 选中日**（只在出现时播一次）

```css
P :is(.mood-pick-item, .weather-pick-item).active .pick-check { animation: pl-pop-in var(--pl-dur-quick) var(--pl-ease-out); }
P .calendar-day.selected::before { animation: pl-pop-in var(--pl-dur-quick) var(--pl-ease-out); }
@keyframes pl-pop-in { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: none; } }
```

（选中日用 `scale(.86)` 起步：单独一条 `pl-day-in`，数值同理。对勾节点和日期格类名以真实 DOM 为准。）

**⑧ Toast**

```css
P .toast { background: var(--pl-toast); backdrop-filter: none; -webkit-backdrop-filter: none;
  transform: translate(-50%, 8px); transition: opacity 200ms var(--pl-ease-out), transform 200ms var(--pl-ease-out), visibility 200ms; }
P .toast.show { transform: translate(-50%, 0); }
```

**⑨ 卡片过渡去阴影补间**

```css
P :is(.card, .bento-item, .stats-card, .settings-group-card, .ledger-account-card, .journal-card) {
  transition: transform .3s var(--pl-ease-out);   /* 原来还补间 box-shadow / border-color */
}
```

### 5.2 手势阈值

已有的四组是用户调好的手感，**原样保留**；新增的只有两条，并且都是可选项。

| 手势 | 阈值 | 出处 | 状态 |
|---|---|---|---|
| 日记牌组切牌 | 位移 ≥ `max(48px, 卡宽 × 22%)`；或速度 > 700px/s 且位移 > 12px | `motion.js` `deckCutDecision` | 保持 |
| 牌组 / 图集轻点 | 位移 < 8px 且按下时长 ≤ 250ms | `motion.js` `isDeckTap` | 保持 |
| 图集一叠牌翻页 | 拖动 ≥ 56px | `views/snippets.js` 图集层 | 保持 |
| 按压反馈 | 按下 90ms 缩到 .96（小控件）/ .988（大卡），松手 420ms `--spring-release` | `motion.js` + `performance.css` | 保持 |
| ★ 按压取消 | 按下后移动 > 10px 视为滚动，立即撤销按下态 | 新增，落在 `installPressFeedback` | 可选 |
| ★ 下拉关闭弹层 | 从抓手条下拉 ≥ `max(96px, 面板高 × 25%)` 或速度 > 800px/s 关闭；否则 260ms `--pl-ease-emph` 弹回 | 新增，需 JS | 可选，默认不做 |

---

## 6. 落地顺序（供实施方参考）

本轮不拆 PR、不写业务代码。下面只给实施顺序和每一步会碰到的文件，便于其他模型照着做。每一步都只改清简主题，在 `themes-plain-light.css` 末尾各占一个独立标题的小节。

| 步骤 | 内容 | 涉及文件 | 视觉变化 |
|---|---|---|---|
| **A · 令牌与减负** | 3.0 / 3.4 节 token；P1 去背景模糊；动效 ①②④⑨ | `themes-plain-light.css`（小节"二十三 · 动效令牌与减负"）→ 重跑生成器得到 `themes-plain.css`；建议新增一条测试锁住"新规则都带 plain 前缀、不补间 box-shadow / filter" | 几乎没有；光晕从"一直转"变成"转一圈" |
| **B · 底栏悬浮岛** | D1–D4，动效 ③ | 同上（改写第十一节 + 小节"二十四 · 底栏悬浮岛"） | 中；需用户在预览里单独点头（#15 做过同类改动，撤回原因不在底栏，但仍需确认） |
| **C · 浮层与选中态** | 弹层、二级页、toast、选中态、角注纸签、卡套卡去投影，动效 ⑤⑥⑦⑧ | 同上（"二十五 · 浮层与选中态"） | 小 |
| **D · 今日 + 随手拍** | T1、T2、M1–M4 | 同上（"二十六 · 今日与随手拍"） | 中；Photo Story 不动 |
| **E · 日记 + 日历** | J1、J2、日期标题、C1、C2；可选切月方向需改 `views/calendar.js` | 同上（"二十七 · 日记与日历"） | 中 |
| **F · 账本 + 我的** | L1–L3、分段滑块、分类、我的账户、Me1–Me3 | 同上（"二十八 · 账本与我的"） | 中；不碰提醒设置区 |

**注意**：`themes-plain.css` 是生成产物，不手改；有冲突时直接重跑 `node scripts/gen-plain-theme.mjs`。生成器按小节标题去重，`tests/theme-skins.test.mjs` 会检查产物里小节不缺不重。通知 PR 若改了 `styles.css` / `performance.css`，rebase 后同样只需重跑生成器。

### 验收清单（每一步都跑）

1. `npx esbuild app.js --bundle --format=iife --global-name=Mine --outfile=www/app.js` 零报错。
2. `node --test tests/*.test.mjs`：不新增失败。当前 `main` 基线有 14 个文件失败，全部是开源仓库缺少 Android 源码与 `evidence/` 目录导致的 ENOENT，与样式无关。
3. 清简主题下 360 / 395 / 412 / 540 / 567 五种宽度横向溢出为 0。
4. 经典、暖阳主题六个主页面截图与改前**逐像素一致**（新规则全部带 plain 前缀，理论上必然一致，截图用来防手滑）。
5. Chrome DevTools 6 倍 CPU 降速下录 Performance：页面切换、开关弹层、底栏滑块无连续长帧（>16.7ms 的帧不超过 2 个）。
6. 照片相关表面（今日画页、随手拍、日记牌组、图集、私密空间）截图核对：图片宽高比与原图一致。
7. 系统开"减弱动态效果"后逐项点一遍：全部直接到终态，没有半截动画。

---

## 7. 预览页怎么看

`preview/design-upgrade.html` 是一个独立 HTML 文件，不依赖仓库里的任何资源（图标是内联 SVG，示例照片是脚本即时画出来的，不同宽高比）。

在线打开（仓库是公开的，分支合并前用分支名）：

- `https://htmlpreview.github.io/?https://github.com/cvb762951-eng/mine-warmjournal/blob/cursor/design-upgrade-plan-9c6d/preview/design-upgrade.html`
- 或 `https://raw.githack.com/cvb762951-eng/mine-warmjournal/cursor/design-upgrade-plan-9c6d/preview/design-upgrade.html`
- 本地：直接用浏览器打开该文件即可，不需要起服务。

- **手机上**：顶部切换"现状 / 升级后"；点手机框里的底栏或上方页签换页面；红色编号是现状问题，蓝色编号是改进点，编号与下方说明一一对应。
- **电脑上**（宽于 860px）：两台手机并排，切页同步。
- **动效实验室**：每个动效一张卡，点"播放"看现状与升级后对比；顶部开关可以慢放 4 倍、模拟"减弱动态效果"、打开帧率表。
- **照片比例**：竖图、横图、长图各一张放进共享相框的复刻版，页面会实时测量显示比例误差。
- 预览是**示意复刻**，不是 App 本身：版式数字按第 2 节实测值还原，字体在没有内置字体的手机上会退回系统字体。

---

*2026-10-13 · 方案与预览，不含运行代码改动。*
