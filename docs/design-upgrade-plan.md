# 清简主题 · 美化与动效升级方案

> 本轮只交付方案和预览，**不改任何运行代码**。
> 预览页：`preview/design-upgrade.html`（单文件，自带 CSS / JS，手机浏览器可直接打开）。
> 基线：`main` @ `ff38b2e`（1.1.23 / versionCode 124）。

---

## 0. 先说结论

- **只动清简（plain）主题。** 所有新规则都写在 `themes-plain-light.css`，并且一律带 `:root[data-theme="plain"]` 前缀，然后重跑 `scripts/gen-plain-theme.mjs` 产出 `themes-plain.css`。经典 / 暖阳主题一行都不受影响，`styles.css` / `performance.css` 也不改（改了要连带重生成近 2000 条选择器，影响面太大）。
- **只用 CSS 能做完的，就不写 JS。** 除了两项可选（日历切月方向、下拉关闭弹层），全部是纯 CSS；可选的 JS 也不碰通知相关文件。
- **写到能照抄。** 第 3.0 节是完整 token 表，第 5.1 节是关键动效的 CSS 写法，第 5.2 节是手势阈值；其他模型落地时按这三节执行即可。
- **再加一层有记忆点的签名动效（第 8 节）。** 共 12 项，包括刊头晨光、卡片展开成二级页、景深后退、视差页头、日历磁吸游标、弹性滑块、数字翻牌、主角卡微光与指尖倾斜、墨晕、三拍入场。仍然只动 transform / opacity，分 rich / lite / none 三档，卡顿时会自动降档；只新增一个 JS 文件，不改任何视图文件。
- **二级页与弹窗能被手直接操纵（第 9 节）。** 原位展开 + 标题飞到导航栏、边缘右滑返回、弹层跟手下拉（带中 / 高两档）、内容依次浮现、确认框轻缩放 + 模糊背景等 9 项，松手后按手指速度交给弹簧。
- **私密空间与随手拍是主角（第 10 节）。** 私密空间：解锁时锁面从中缝分开、内容浮现（≤ 430ms，全程可点）；切出 App 立刻盖模糊遮罩，回来先在遮罩下渲染锁屏再揭开；文件夹从封面原位展开。随手拍：照片从快门 / 相册按钮飞进表单，保存后飞到列表顶部的新卡片；滚动时铺底 → 主图 → 文字分层淡入；长按卡片轻轻浮起。所有照片飞行都按原始宽高比计算、只做等比缩放；加密、锁定、观看记录逻辑一行不改。
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
| 私密空间逻辑 | `views/private-vault.js` 的加密 / 解密、`lockPrivateVault` / `privateVaultUnlocked`、`scheduleVisibilityLock` 与 `visibilitychange` 处理、免密开关、指纹流程、观看记录 | 用户硬性要求：只改视觉和动效（第 10 节只"旁听" DOM 和可见性事件） |
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
- **签名动效**（第 8 节）：在"升级后"手机里默认开启。顶部"签名动效"开关可以关掉做对比，"低端机"开关模拟降级档；页面下方"签名动效"区每一项都有单独演示或"在手机里看"按钮。
- **私密空间与随手拍**（第 10 节）：页签里的"私密空间"可以直接点"模拟指纹解锁""模拟切出再回来"、点文件夹封面进详情再返回；"随手拍"里点"记录"拍照 / 选图 / 保存，滚动列表看分层淡入，长按卡片看浮起，点"删除"看新确认框。页面下方"主角"区每一项都有自动演示。
- **二级页与弹窗**（第 9 节）：进任意二级页后从左缘向右拖返回；打开弹层后按住面板下拉；随手拍表单可以上拉到高档。"二级页与弹窗"区的自动演示用蓝色圆点模拟手指。

---

## 8. 签名动效：有记忆点的高级感

第 3–6 节解决"统一、干净、不卡"。这一节在此基础上加一层**有记忆点**的动效。它们都只用 transform / opacity，有三档降级，而且不经过任何照片表面（照片过渡、图集一叠牌、日记牌组、点照片开大图都不动）。

### 8.0 总原则

1. **一页最多一个主角动效。** 今日是刊头晨光（S1），账本是数字翻牌（S7），日历是磁吸游标（S5），随手拍和我的是主角卡微光（S8）。其他都是辅助节奏。
2. **快进慢出。** 进入用强减速曲线或弹簧，退出一律 160–220ms 的 `--pl-ease-in`，不在退出上抢戏。
3. **弹簧只用两条**（`linear()` 由弹簧方程采样生成，见 8.1）：`snappy` 过冲 5%，用于滑块；`magnet` 过冲 10%，用于游标和数字。不另造。
4. **三档运动等级**，写在 `<html data-pl-motion="rich|lite|none">` 上：
   - `rich`：全部开启。
   - `lite`：关掉 S3 页面缩放（遮罩保留）、S4 视差、S8 微光、S9 倾斜、S10 墨晕，其余保留。
   - `none`：系统开了减弱动效。全部直接到终态，也包括第 5 节的基础动效。
5. **自适应降级。** 第一次页面入场时数 1 秒里的长帧，超过 3 帧大于 32ms 就本次会话切到 `lite`，不写存储。
6. **图层纪律。** `will-change` 只在动画进行中挂、结束就撤。同时存在的大图层（≥ 半屏）不超过 2 个。`installMagneticDock` 的注释里写过：清简主题下透明底的按钮被提升图层会在 WebView 里垫出白块，所以 S9 / S10 只用在白底卡片上。

### 8.1 新增令牌

```css
:root[data-theme="plain"] {
  /* 弹簧：m=1, k=420, c=28 采样 24 点；约 513ms 落定，过冲 5.2% */
  --pl-spring-snappy: linear(0, 0.0811 4.2%, 0.2578 8.3%, 0.4613 12.5%, 0.6460 16.7%, 0.8003 20.8%, 0.9133 25%, 0.9874 29.2%, 1.0290 33.3%, 1.0482 37.5%, 1.0517 41.7%, 1.0462 45.8%, 1.0367 50%, 1.0262 54.2%, 1.0167 58.3%, 1.0091 62.5%, 1.0037 66.7%, 1.0002 70.8%, 0.9982 75%, 0.9974 79.2%, 0.9973 83.3%, 0.9977 87.5%, 0.9982 91.7%, 0.9987 95.8%, 1);
  --pl-dur-snappy: 520ms;
  /* 弹簧：m=1, k=320, c=21；约 609ms 落定，过冲 10.2% */
  --pl-spring-magnet: linear(0, 0.0882 4.2%, 0.2846 8.3%, 0.5130 12.5%, 0.7199 16.7%, 0.8878 20.8%, 1.0037 25%, 1.0707 29.2%, 1.0984 33.3%, 1.0994 37.5%, 1.0842 41.7%, 1.0619 45.8%, 1.0395 50%, 1.0199 54.2%, 1.0053 58.3%, 0.9959 62.5%, 0.9911 66.7%, 0.9897 70.8%, 0.9905 75%, 0.9925 79.2%, 0.9948 83.3%, 0.9970 87.5%, 0.9987 91.7%, 1.0000 95.8%, 1);
  --pl-dur-magnet: 600ms;
  --pl-ease-expo: cubic-bezier(.22, 1, .36, 1);   /* 刊头揭幕、共享展开的减速段 */
  --pl-depth-scale: .94;                          /* S3 页面后退比例 */
  --pl-tilt-max: 5deg;                            /* S9 倾斜上限 */
}
```

`linear()` 需要 Chromium 113+（Android System WebView 跟随 Chrome 更新）。不支持时整条声明无效，退回第 3.4 节的 `--pl-ease-emph`：写成 `transition-timing-function: var(--pl-ease-emph); transition-timing-function: var(--pl-spring-snappy);` 两行即可。

### 8.2 一览

| # | 名称 | 在哪 | 时长 / 曲线 | 降级 |
|---|---|---|---|---|
| S1 | 刊头晨光 | 今日刊头，每次启动首次进入今日 | 每行 620ms `--pl-ease-expo`，行间 70ms；横线 480ms，360ms 起 | lite 保留；none 直接显示 |
| S2 | 卡片展开 | 课程卡、快捷入口、我的列表行、账本"管理" → 二级页头卡 | 展开 440ms `--pl-ease-emph`；整页 200ms 淡入，220ms 起；收回 360ms | lite 保留；none 走原来的推入 |
| S3 | 景深后退 | 底部弹层打开时页面后退；二级页推入时底页左移 | 弹层 320ms / 220ms；推入 350ms | lite 只留遮罩 |
| S4 | 视差页头 | 各页页头随滚动分层上移、渐隐 | 跟随滚动，0–240px 区间 | lite / none 关 |
| S5 | 磁吸游标 | 日历选中日：一块蓝色游标在日期间滑行 | `--pl-dur-magnet` `--pl-spring-magnet` | lite 保留；none 瞬移 |
| S6 | 弹性滑块 | 底栏选中块、账本支出/收入分段 | `--pl-dur-snappy` `--pl-spring-snappy` | 不支持 linear() 时退回 260ms emph |
| S7 | 数字翻牌 | 账本净资产、随手拍四项统计、日历三项 | 每位 600ms `magnet`，从个位起每位延后 40ms | lite 保留；none 直接显示 |
| S8 | 主角卡微光 | 光晕扫完后，一道淡光从左到右掠过卡面 | 1100ms `cubic-bezier(.4,0,.2,1)`，900ms 起，只一次 | lite / none 关 |
| S9 | 指尖倾斜 | 按住主角卡，卡面朝手指方向微倾，带一团跟手的柔光 | 按下 140ms；松手 520ms `--spring-release` | lite / none 关 |
| S10 | 墨晕 | 列表行、工具卡：从手指落点晕开一圈极淡的蓝 | 520ms `--pl-ease-out` | lite / none 关 |
| S11 | 三拍入场 | 所有主页面：页头 → 主角卡 → 其余 | 0 / 80 / 140ms 起，其余每项 +32ms | none 关 |
| S12 | Toast 弹性落位 | 全局 toast | 进 460ms `snappy`，出 160ms `ease-in` | 不支持 linear() 时 200ms ease-out |

### 8.3 落点：只新增，不改视图

- **CSS**：在 `themes-plain-light.css` 新增小节"二十九 · 签名动效"，重跑生成器。
- **JS**：新增 `motion-signature.js`，导出 `installSignatureMotion()`，在 `app.js` 的 `boot()` 里紧跟 `installMagneticDock();` 加一行调用（这是全文件唯一一处改动，在通知接线上方，不碰通知代码）。
- **不改任何 `views/*.js`。** S1、S5、S7 用一个 `MutationObserver` 观察 `#app` 的子树变化，每帧最多跑一次 `enhance(root)`，按选择器给新渲染出来的节点加效果。S2、S9、S10 用 document 级事件委托。
- 所有选择器都要在落地前用无头 Chrome 对真实 DOM 核一遍，下文选择器是**示意名**（用 `/* 核对 */` 标出）。

```js
// motion-signature.js 骨架
const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
let tier = 'rich';

export function motionTier() {
  if (reduce.matches) return 'none';
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  if (mem <= 3 || cores <= 4 || navigator.connection?.saveData) return 'lite';
  return 'rich';
}
const plain = () => root.dataset.theme === 'plain';
const rich = () => plain() && tier === 'rich';
const moving = () => plain() && tier !== 'none';

function watchJank() {               // 自适应降级：只在启动后观测 1 秒
  let last = performance.now(), long = 0;
  const end = last + 1000;
  const tick = now => {
    if (now - last > 32) long++;
    last = now;
    if (now < end) requestAnimationFrame(tick);
    else if (long > 3 && tier === 'rich') { tier = 'lite'; root.dataset.plMotion = tier; }
  };
  requestAnimationFrame(tick);
}

export function installSignatureMotion() {
  tier = motionTier();
  root.dataset.plMotion = tier;
  reduce.addEventListener?.('change', () => { tier = motionTier(); root.dataset.plMotion = tier; });
  const app = document.getElementById('app');
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; if (moving()) enhance(app); });
  }).observe(app, { childList: true, subtree: true });
  installExpand(); installTilt(); installInk();   // S2 / S9 / S10
  watchJank();
}

function enhance(scope) {
  revealMasthead(scope);   // S1
  placeCalendarCursor(scope); // S5
  rollDigits(scope);       // S7
}
```

CSS 侧所有签名规则统一挂在等级选择器下：

```css
/* P = :root[data-theme="plain"] */
P:is([data-pl-motion="rich"], [data-pl-motion="lite"]) …   /* lite 也开的 */
P[data-pl-motion="rich"] …                                  /* 只在 rich 开的 */
```

### 8.4 逐项规格

#### S1 刊头晨光（今日）

刊头五行（期号、年份、大日期、星期、格言）分别从各自的遮罩里**升起**，像铅字被推上版面；格言下的短横线从左向右画出。每次启动只在第一次进入今日时播，之后切回今日走普通入场。

| 参数 | 值 |
|---|---|
| 单行 | `translateY(105%) → 0`，620ms `--pl-ease-expo` |
| 行间 | 70ms，按 kicker → 年 → 日期 → 星期 → 格言 |
| 横线 | `scaleX(0) → 1`，`transform-origin: left`，480ms `--pl-ease-expo`，360ms 起 |
| 遮罩 | 外层 `overflow: hidden; padding-bottom: .08em; margin-bottom: -.08em`（防衬线体下缘和斜体被裁） |
| 只播一次 | 内存变量 `mastPlayed`，不写存储 |

```js
let mastPlayed = false;
function revealMasthead(scope) {
  if (mastPlayed) return;
  const mast = scope.querySelector('.today-masthead');                 /* 核对 */
  if (!mast) return;
  mastPlayed = true;
  const lines = mast.querySelectorAll(':scope > .mast-line');          /* 核对：五个行级子元素 */
  lines.forEach((line, i) => {
    if (line.querySelector(':scope > .pl-rv')) return;
    const inner = document.createElement('span');
    inner.className = 'pl-rv-in';
    inner.style.setProperty('--ri', i);
    inner.append(...line.childNodes);
    const wrap = document.createElement('span');
    wrap.className = 'pl-rv';
    wrap.append(inner);
    line.append(wrap);
  });
  mast.classList.add('pl-mast-play');
  setTimeout(() => mast.classList.remove('pl-mast-play'), 1400);
}
```

```css
P .pl-rv { display: inline-block; overflow: hidden; vertical-align: bottom; padding-bottom: .08em; margin-bottom: -.08em; }
P .pl-rv-in { display: inline-block; }
P:is([data-pl-motion="rich"],[data-pl-motion="lite"]) .pl-mast-play .pl-rv-in {
  animation: pl-rv-up 620ms var(--pl-ease-expo) both;
  animation-delay: calc(var(--ri) * 70ms);
}
P:is([data-pl-motion="rich"],[data-pl-motion="lite"]) .pl-mast-play .today-motto::after {   /* 核对 */
  transform-origin: left; animation: pl-rule-in 480ms var(--pl-ease-expo) 360ms both;
}
@keyframes pl-rv-up { from { transform: translateY(105%); } to { transform: none; } }
@keyframes pl-rule-in { from { transform: scaleX(0); } to { transform: none; } }
```

#### S2 卡片展开（容器共享元素）

点课程卡这类"入口卡"时，一块与卡片同形的白色"幽灵"从原位置飞到二级页**头卡**（首张卡片）的位置并展开，原卡同时隐去，整个二级页随后淡入、正好接住幽灵。返回时幽灵从头卡缩回原卡。手机上看起来就是"这张卡打开了，变成了下一页的头卡"。

- **只用于非照片入口。** 习惯卡已经在用 `withSharedTransition`（`views/stats.js`），保持原样，用 `:not([data-habit-detail])` 排除。
- 幽灵是空白容器，只做 `translate + scale`，不缩放文字（避免文字被拉伸）。内容是二级页自己的，靠 opacity 出现。
- **为什么落在头卡而不是全屏**：入口卡通常 80px 高，放大到全屏要纵向放大约 8 倍，圆角会被拉成很长的椭圆（预览里实测过，很明显）。落到头卡时纵向只放大约 2 倍，圆角基本看不出变形。

| 参数 | 值 |
|---|---|
| 触发 | 来源元素点击（`capture` 阶段记录矩形），随后 400ms 内出现 `.subpage-layer.active` |
| 落点 | 该二级页的首张卡片 `EXPAND_TO`；找不到就放弃，走原来的推入 |
| 展开 | 幽灵 `translate(dx,dy) scale(sx,sy)`（`transform-origin: 0 0`），440ms `--pl-ease-emph` |
| 原卡 | `opacity: 0`，直到收回结束 |
| 二级页 | 去掉推入位移，`opacity 0 → 1`，200ms `--pl-ease-out`，220ms 起 |
| 收回 | 内容 160ms 淡出 → 幽灵 360ms 缩回原位 → 原卡复现 → 幽灵 100ms 淡出 |
| 放弃条件 | 原卡不完全在视口内；原卡面积 > 屏幕 60%；正在动画中（再次点击忽略）；400ms 内没等到二级页 → 什么都不做，走原来的推入 |
| 底页 | 同时 `scale(.97)`（S3 的轻量版），收回时还原 |

```js
const EXPAND_FROM = '.today-course-card, .quick-access-item, .mine-entry-row, .ledger-account-manage'; /* 核对 */
const EXPAND_TO = ':scope .subpage-body > .card:first-of-type, :scope .subpage-hero';       /* 核对：二级页头卡 */
let expanding = null;

function installExpand() {
  document.addEventListener('click', event => {
    if (!moving() || expanding) return;
    const src = event.target.closest(EXPAND_FROM);
    if (!src || src.matches('[data-habit-detail]')) return;
    const r = src.getBoundingClientRect();
    const vw = innerWidth, vh = innerHeight;
    if (r.top < 0 || r.bottom > vh || r.width * r.height > vw * vh * 0.6) return;
    const ghost = Object.assign(document.createElement('div'), { className: 'pl-expand-ghost' });
    Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    document.body.append(ghost);
    expanding = { src, ghost, rect: r };
    waitForLayer(400).then(layer => {
      const head = layer?.querySelector(EXPAND_TO);
      if (!head) { ghost.remove(); expanding = null; return; }
      layer.classList.add('pl-expand-in');           // 先去掉推入位移，头卡矩形才是终点位置
      const t = head.getBoundingClientRect();
      src.style.opacity = '0';
      const to = `translate(${t.left - r.left}px, ${t.top - r.top}px) scale(${t.width / r.width}, ${t.height / r.height})`;
      Object.assign(expanding, { layer, to });
      ghost.animate([{ transform: 'none' }, { transform: to }], { duration: 440, easing: 'cubic-bezier(.32,.72,0,1)', fill: 'forwards' })
        .finished.then(() => { ghost.style.opacity = '0'; });
    });
  }, true);
}

function waitForLayer(timeout) {
  return new Promise(resolve => {
    const found = () => document.querySelector('.subpage-layer.active');
    if (found()) return resolve(found());
    const mo = new MutationObserver(() => { if (found()) { mo.disconnect(); resolve(found()); } });
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    setTimeout(() => { mo.disconnect(); resolve(found()); }, timeout);
  });
}
// 收回：监听该 layer 失去 .active（同一个 MutationObserver 写法），
// 原卡仍 isConnected 时 ghost.style.opacity = '1'，从 expanding.to 反向播放到 'none'（360ms），
// 然后 src.style.opacity = ''、ghost 100ms 淡出后 remove()、expanding = null；
// 原卡已被重绘掉时直接清理，让二级页走原来的推出。
```

```css
P .pl-expand-ghost { position: fixed; z-index: 190; transform-origin: 0 0; background: var(--plain-surface);
  border-radius: var(--pl-r-lg); box-shadow: var(--pl-shadow-float); pointer-events: none; will-change: transform; }
P .subpage-layer.pl-expand-in { transition: none !important; transform: none !important;
  animation: pl-fade-in 200ms var(--pl-ease-out) 220ms both; }
@keyframes pl-fade-in { from { opacity: 0; } to { opacity: 1; } }
```

#### S3 景深后退

打开底部弹层时，整个页面向后退一步（缩到 .94、下沉 10px、出现圆角），后面露出深色"桌面"。推入二级页时，底页向左让出 20%，有前后两层的纵深感。

| 参数 | 值 |
|---|---|
| 弹层开 | `#app`：`scale(var(--pl-depth-scale)) translateY(10px)`，320ms `--pl-ease-emph` |
| 弹层关 | 220ms `--pl-ease-in` |
| 圆角 | 开始时一次性给 `#app` 加 `border-radius: 18px; overflow: hidden`（只重绘一次，不补间） |
| 桌面色 | `.phone-shell` 背景 `#1E232A`，只在弹层打开期间 |
| 二级页推入 | 底页 `translateX(-20%)`，350ms 与二级页同曲线；再叠第 5.1 节的 6% 遮罩 |
| lite | 不缩放、不位移，只留遮罩 |

```css
P[data-pl-motion="rich"] #app { transition: transform 220ms var(--pl-ease-in); transform-origin: 50% 0; }
P[data-pl-motion="rich"] .phone-shell:has(.modal-layer.open) { background: #1E232A; }
P[data-pl-motion="rich"] .phone-shell:has(.modal-layer.open) > #app {
  transform: translateY(10px) scale(var(--pl-depth-scale));
  border-radius: 18px; overflow: hidden;
  transition: transform 320ms var(--pl-ease-emph);
}
P[data-pl-motion="rich"] .phone-shell:has(> .subpage-layer.active:not(.pl-expand-in)) > #app {
  transform: translate3d(-20%, 0, 0);
  transition: transform 350ms cubic-bezier(.16, 1, .3, 1);
}
/* 照片 / 私密弹窗不后退，保持它们现有的"无动效"约定 */
P .phone-shell:has(.modal-layer.open :is(.photo-viewer, .private-modal)) > #app { transform: none !important; }  /* 核对 */
```

注意：`#app` 带 transform 后，里面 `position: fixed` 的子元素会以 `#app` 为参照。底栏如果在 `#app` 内会跟着一起后退（这正是想要的）；toast、弹层、二级页必须在 `#app` 外，落地时核对一次。

#### S4 视差页头

页头的标题、副标题、角注纸签以不同速度跟随滚动，越"远"的层动得越少，同时渐隐，像翻杂志时刊头留在后面。

| 层 | 0 → 240px 滚动区间内的变化 |
|---|---|
| 主标题 / 大日期 | `translateY(0 → 96px)`，`opacity 1 → .15` |
| 副标题 / 星期 | `translateY(0 → 72px)`，`opacity 1 → 0` |
| 角注纸签 | `translateY(0 → 40px) rotate(4deg → 10deg)` |

```css
@supports (animation-timeline: scroll()) {
  P[data-pl-motion="rich"] :is(.page-title, .today-date) {                 /* 核对 */
    animation: pl-px-1 linear both; animation-timeline: scroll(nearest block); animation-range: 0 240px; }
  P[data-pl-motion="rich"] :is(.page-subtitle, .today-weekday) {           /* 核对 */
    animation: pl-px-2 linear both; animation-timeline: scroll(nearest block); animation-range: 0 240px; }
  P[data-pl-motion="rich"] .page-corner-note {                               /* 核对 */
    animation: pl-px-3 linear both; animation-timeline: scroll(nearest block); animation-range: 0 240px; }
}
@keyframes pl-px-1 { to { transform: translate3d(0, 96px, 0); opacity: .15; } }
@keyframes pl-px-2 { to { transform: translate3d(0, 72px, 0); opacity: 0; } }
@keyframes pl-px-3 { from { transform: rotate(4deg); } to { transform: translate3d(0, 40px, 0) rotate(10deg); } }
```

- 由合成线程按滚动驱动，不需要 JS、不监听 scroll。不支持 `animation-timeline`（Chromium < 115）时页头保持静止，不做 JS 兜底。
- 这些元素不能同时挂入场动画（同一个 `animation` 属性会互相覆盖）。入场动画挂在它们的父容器上，视差挂在子元素上。

#### S5 磁吸游标（日历）

选中日不再是每格各画一块，而是整个月网格里**只有一块**蓝色游标。点另一天，游标带一点过冲滑过去、吸住。日期数字在游标快到时才变白。

| 参数 | 值 |
|---|---|
| 游标 | 36×36px，10px 圆角，`--pl-blue`；`transform: translate(x, y)` |
| 移动 | `--pl-dur-magnet` `--pl-spring-magnet`（同月内任意距离都滑） |
| 文字变白 | `transition: color 0s 140ms`（离散切换，只重绘一次；弹簧在约 25% 处已到位） |
| 首次 / 切月 | 不滑，直接定位后 `opacity 0 → 1`，180ms |
| 今天 | 保留第 4.6 节的细环 |

```js
function placeCalendarCursor(scope) {
  const grid = scope.querySelector('.calendar-grid');                       /* 核对 */
  if (!grid) return;
  let cursor = grid.querySelector(':scope > .pl-cal-cursor');
  const fresh = !cursor;
  if (fresh) {
    cursor = Object.assign(document.createElement('i'), { className: 'pl-cal-cursor' });
    cursor.setAttribute('aria-hidden', 'true');
    grid.prepend(cursor);
    grid.classList.add('pl-has-cursor');
  }
  const day = grid.querySelector('.calendar-day.selected');                 /* 核对 */
  if (!day) { cursor.style.opacity = '0'; return; }
  const x = day.offsetLeft + (day.offsetWidth - 36) / 2;
  const y = day.offsetTop + (day.offsetHeight - 36) / 2;
  if (fresh) cursor.classList.add('pl-cursor-jump');
  cursor.style.transform = `translate(${x}px, ${y}px)`;
  cursor.style.opacity = '1';
  if (fresh) requestAnimationFrame(() => requestAnimationFrame(() => cursor.classList.remove('pl-cursor-jump')));
}
```

如果日历点选时整网格重绘（游标会随之重建、只淡入不滑行），让 `placeCalendarCursor` 在重建前读出旧游标的 `transform`，新游标以旧位置为起点再设目标位置。这是一个 12 行以内的补丁，仍在 `motion-signature.js` 里完成，不改 `views/calendar.js`。

```css
P .calendar-grid.pl-has-cursor { position: relative; }
P .pl-cal-cursor { position: absolute; left: 0; top: 0; width: 36px; height: 36px; border-radius: 10px;
  background: var(--pl-blue); box-shadow: var(--pl-shadow-btn); pointer-events: none; z-index: 0;
  transition: transform var(--pl-dur-magnet) var(--pl-ease-emph), opacity 180ms var(--pl-ease-out);
  transition-timing-function: var(--pl-spring-magnet), var(--pl-ease-out); }
P .pl-cal-cursor.pl-cursor-jump { transition: none; }
P .calendar-grid.pl-has-cursor .calendar-day.selected::before { opacity: 0; }
P .calendar-grid.pl-has-cursor .calendar-day { position: relative; z-index: 1; transition: color 0s; }
P .calendar-grid.pl-has-cursor .calendar-day.selected { transition: color 0s 140ms; }
```

#### S6 弹性滑块

第 5.1 节 ③ 的底栏选中块和第 4.5 节的支出/收入分段，曲线换成 `snappy`：滑到位时多走约 5% 再回来，像被弹簧拉住。`installMagneticDock` 只推当前格的按钮本身，和滑块（底栏伪元素）互不干扰。

```css
P #floating-dock::before, P .ledger-segment-thumb {                          /* 核对 */
  transition-duration: var(--pl-dur-snappy);
  transition-timing-function: var(--pl-ease-emph);
  transition-timing-function: var(--pl-spring-snappy);
}
```

#### S7 数字翻牌

金额和统计数字的每一位是一条竖排 0–9 的"转轮"，进入页面时从 0 转到目标数字，个位先停、高位后停，像机械计数器。和现有 `rollNumbers`（每帧改文字 → 每帧重新排版）不同，翻牌只动 transform，排版只发生一次。

| 参数 | 值 |
|---|---|
| 每位 | `translateY(calc(var(--d) * -1.1em))`，600ms `--pl-spring-magnet` |
| 位间 | 从个位起每位延后 40ms |
| 非数字 | `¥ , . + -` 原样静态显示 |
| 字体 | 容器 `font-variant-numeric: tabular-nums`，每位宽度固定，不抖 |
| 可访问性 | 容器 `aria-label` 是真实文本，转轮 `aria-hidden` |
| 范围 | 账本净资产、随手拍四项统计、日历三项；**复盘统计页仍用 `rollNumbers`，不改** |
| 再次触发 | 数值变化时只转变化的那几位 |

```js
const ROLL_TARGETS = '.ledger-net-amount, .snippets-stat-value, .calendar-kpi-value'; /* 核对 */
function rollDigits(scope) {
  scope.querySelectorAll(ROLL_TARGETS).forEach(el => {
    const text = el.textContent.trim();
    if (el.dataset.plRolled === text) return;
    el.dataset.plRolled = text;
    el.setAttribute('aria-label', text);
    el.classList.add('pl-reels');
    const chars = [...text];
    let digitIndex = chars.filter(c => /\d/.test(c)).length;
    el.innerHTML = chars.map(c => {
      if (!/\d/.test(c)) return `<span class="pl-reel-static" aria-hidden="true">${c}</span>`;
      digitIndex -= 1;
      return `<span class="pl-reel" aria-hidden="true" style="--d:0;--di:${digitIndex}"><span>${'0123456789'.split('').map(n => `<b>${n}</b>`).join('')}</span></span>`;
    }).join('');
    const digits = chars.filter(c => /\d/.test(c));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.querySelectorAll('.pl-reel').forEach((reel, i) => reel.style.setProperty('--d', digits[i]));
    }));
  });
}
```

```css
P .pl-reels { font-variant-numeric: tabular-nums; white-space: nowrap; }
P .pl-reel { display: inline-block; height: 1.1em; overflow: hidden; vertical-align: top; }
P .pl-reel > span { display: block; transform: translateY(calc(var(--d) * -1.1em));
  transition: transform var(--pl-dur-magnet) var(--pl-ease-emph) calc(var(--di) * 40ms);
  transition-timing-function: var(--pl-spring-magnet); }
P .pl-reel b { display: block; height: 1.1em; line-height: 1.1em; font: inherit; }
P[data-pl-motion="none"] .pl-reel > span { transition: none; }
```

`MutationObserver` 自己写 innerHTML 会再触发一次观察；`dataset.plRolled === text` 这一行就是为此做的防重入，不能删。

#### S8 主角卡微光

光晕扫完一圈后（第 5.1 节 ④），一道很淡的光带从左到右掠过整张卡，经过数字时数字会"亮"一下，然后一切静止。只播一次。

| 参数 | 值 |
|---|---|
| 光带 | 宽 = 卡宽 55%；`linear-gradient(100deg, transparent 20%, rgba(79,118,189,.10) 45%, rgba(255,255,255,.7) 50%, rgba(79,118,189,.10) 55%, transparent 80%)` |
| 运动 | `translateX(-110% → 200%)`，1100ms `cubic-bezier(.4,0,.2,1)`，900ms 起（扫光过半时开始） |
| 透明度 | 0 → 1（15%）→ 1（85%）→ 0 |

```css
P[data-pl-motion="rich"] .halo-card { overflow: hidden; }
P[data-pl-motion="rich"] .halo-card > .pl-sheen {                          /* JS 插入一个空 <i class="pl-sheen" aria-hidden> */
  position: absolute; inset: 0 auto 0 0; width: 55%; z-index: 2; pointer-events: none;
  background: linear-gradient(100deg, transparent 20%, rgba(79,118,189,.10) 45%, rgba(255,255,255,.7) 50%, rgba(79,118,189,.10) 55%, transparent 80%);
  animation: pl-sheen 1100ms cubic-bezier(.4, 0, .2, 1) 900ms both;
}
@keyframes pl-sheen { 0% { opacity: 0; transform: translateX(-110%); } 15%, 85% { opacity: 1; } 100% { opacity: 0; transform: translateX(200%); } }
```

`.halo-card` 的 `::after` 已被呼吸背光占用，`::before` 是否空闲需要核对，所以统一用一个插入的空节点（放在 `enhance()` 里，每张卡只插一次）。动画结束后可以 `remove()`。

**质感底纹（静态）**：清简画布叠一层 3% 不透明度的细噪点，让大面积冷蓝不显得"屏幕味"。噪点是 160px 的 PNG（约 2KB）平铺在 `body` 背景上，只绘制一次、不动、不放进合成层。卡片保持纯白，不叠噪点。

```css
P body { background-image: url("assets/plain-grain-160.png"); background-size: 160px; }   /* 新增素材 */
```

#### S9 指尖倾斜（主角卡）

按住主角卡时，卡面朝手指所在方向微微下沉（最多 5°），一团极淡的蓝色柔光跟着手指走；松手时带一点回弹恢复。这一项最有"拿在手里"的质感。

| 参数 | 值 |
|---|---|
| 角度 | `rotateY = (px - .5) × 2 × 5deg`，`rotateX = (.5 - py) × 2 × 5deg`（px / py 为手指在卡内的 0–1 位置） |
| 透视 | `perspective(900px)`，与按压缩放合成：`scale(.988)` |
| 按下 | 140ms `--pl-ease-out` |
| 跟手 | `pointermove` 用 rAF 节流，只写两个 CSS 变量 |
| 松手 | 角度归零，520ms `--spring-release`；结束后撤掉 `transform`，不留常驻 3D 图层 |
| 让位给滚动 | 按下后 150ms 内移动 > 10px 视为滚动，立刻取消倾斜 |
| 柔光 | 160px 圆形 `radial-gradient(closest-side, rgba(146,183,238,.28), transparent)`，`translate` 到手指位置，`opacity 0 → 1` |

```js
function installTilt() {
  let card = null, rect = null, start = null, raf = 0, px = .5, py = .5;
  const apply = () => {
    raf = 0;
    if (!card) return;
    card.style.setProperty('--pl-rx', `${((.5 - py) * 2 * 5).toFixed(2)}deg`);
    card.style.setProperty('--pl-ry', `${((px - .5) * 2 * 5).toFixed(2)}deg`);
    card.style.setProperty('--pl-gx', `${(px * rect.width - 80).toFixed(1)}px`);
    card.style.setProperty('--pl-gy', `${(py * rect.height - 80).toFixed(1)}px`);
  };
  const release = () => {
    if (!card) return;
    const done = card;
    done.classList.remove('pl-tilting');
    done.style.setProperty('--pl-rx', '0deg');
    done.style.setProperty('--pl-ry', '0deg');
    setTimeout(() => done.classList.remove('pl-tilt'), 540);
    card = null;
  };
  document.addEventListener('pointerdown', e => {
    if (!rich()) return;
    const c = e.target.closest('.halo-card');
    if (!c) return;
    card = c; rect = c.getBoundingClientRect(); start = { x: e.clientX, y: e.clientY, t: performance.now() };
    px = (e.clientX - rect.left) / rect.width; py = (e.clientY - rect.top) / rect.height;
    c.classList.add('pl-tilt', 'pl-tilting');
    apply();
  }, { passive: true });
  document.addEventListener('pointermove', e => {
    if (!card) return;
    if (performance.now() - start.t < 150 && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) { release(); return; }
    px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    if (!raf) raf = requestAnimationFrame(apply);
  }, { passive: true });
  ['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, release, { passive: true }));
}
```

```css
P[data-pl-motion="rich"] .halo-card.pl-tilt {
  transform: perspective(900px) rotateX(var(--pl-rx, 0deg)) rotateY(var(--pl-ry, 0deg)) scale(var(--pl-press, 1));
  transition: transform 520ms var(--spring-release);
}
P[data-pl-motion="rich"] .halo-card.pl-tilting { --pl-press: .988; transition-duration: 140ms; transition-timing-function: var(--pl-ease-out); }
P[data-pl-motion="rich"] .halo-card.pl-tilt > .pl-glare {                     /* JS 与 .pl-sheen 一起插入 */
  position: absolute; left: 0; top: 0; width: 160px; height: 160px; z-index: 1; pointer-events: none;
  background: radial-gradient(closest-side, rgba(146, 183, 238, .28), transparent);
  transform: translate(var(--pl-gx, 0), var(--pl-gy, 0)); opacity: 0; transition: opacity 200ms var(--pl-ease-out);
}
P[data-pl-motion="rich"] .halo-card.pl-tilting > .pl-glare { opacity: 1; }
```

`.halo-card` 如果同时被按压反馈命中（`[data-pressed]`），按压缩放由上面的 `--pl-press` 接管。落地时把 `.halo-card` 的 `[data-pressed]` 规则去掉，避免两条 transform 打架。

#### S10 墨晕

点列表行或工具卡时，从手指落点晕开一圈极淡的主题蓝，像墨滴落在纸上。比 Material 涟漪更淡更慢，不留按下态。

| 参数 | 值 |
|---|---|
| 直径 | `2 × hypot(宽, 高)`，一次性设定，不补间尺寸 |
| 运动 | `scale(.1) → 1`，`opacity .16 → 0`，520ms `--pl-ease-out` |
| 颜色 | `--pl-blue` |
| 适用 | 白底卡片里的行和卡：我的列表行、日历工具卡、快捷入口、设置行（**不含**提醒设置区）、二级页列表 |
| 不适用 | 透明底按钮、底栏、任何照片表面 |

```js
const INK_ON = '.mine-entry-row, .calendar-tool-card, .quick-access-item, .settings-row'; /* 核对；排除提醒区 */
function installInk() {
  document.addEventListener('pointerdown', e => {
    if (!rich()) return;
    const host = e.target.closest(INK_ON);
    if (!host || host.closest('.reminder-settings')) return;                  /* 核对 */
    const r = host.getBoundingClientRect();
    const d = 2 * Math.hypot(r.width, r.height);
    const ink = document.createElement('i');
    ink.className = 'pl-ink';
    ink.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    host.append(ink);
    ink.addEventListener('animationend', () => ink.remove(), { once: true });
  }, { passive: true });
}
```

```css
P[data-pl-motion="rich"] :is(.mine-entry-row, .calendar-tool-card, .quick-access-item, .settings-row) { position: relative; overflow: hidden; }
P .pl-ink { position: absolute; border-radius: 50%; background: var(--pl-blue); pointer-events: none;
  animation: pl-ink 520ms var(--pl-ease-out) forwards; }
@keyframes pl-ink { from { transform: scale(.1); opacity: .16; } to { transform: scale(1); opacity: 0; } }
```

#### S11 三拍入场

所有主页面的入场分成三拍，让视线有先后：**页头先到 → 主角卡跟上 → 其余内容依次落位**。替换第 5.1 节 ② 的延迟算法，时长与位移不变。

| 拍 | 元素 | 起始 | 位移 / 时长 |
|---|---|---|---|
| 1 | 页头 | 0ms | 8px，420ms `--spring-entrance`（今日由 S1 接管） |
| 2 | 主角卡（`.halo-card`） | 80ms | 14px，460ms `--spring-entrance` |
| 3 | 其余 `[data-stagger]` | 140ms + 序号 × 32ms（序号封顶 6） | 10px，420ms `--spring-entrance` |

```css
P [data-stagger] { animation-delay: calc(140ms + min(var(--stagger-index, 0), 6) * 32ms); }
P :is(.page-header, .today-masthead)[data-stagger] { animation-delay: 0ms; }                /* 核对 */
P .halo-card[data-stagger] { animation-name: pl-hero-in; animation-duration: 460ms; animation-delay: 80ms; }
@keyframes pl-hero-in { from { opacity: 0; transform: translate3d(0, 14px, 0); } to { opacity: 1; transform: none; } }
```

#### S12 Toast 弹性落位

```css
P .toast { transform: translate(-50%, 14px) scale(.96);
  transition: opacity 160ms var(--pl-ease-in), transform 160ms var(--pl-ease-in), visibility 160ms; }
P .toast.show { transform: translate(-50%, 0);
  transition: opacity 200ms var(--pl-ease-out), transform 460ms var(--pl-ease-out), visibility 0s;
  transition-timing-function: var(--pl-ease-out), var(--pl-spring-snappy), linear; }
```

### 8.5 性能预算（签名动效）

| # | 合成层 | 面积 | 持续 | 主线程 |
|---|---|---|---|---|
| S1 | 5 个文字行 | 各约 350×60px | 1.1s | 无 |
| S2 | 幽灵 1 个 | 由入口卡放大到头卡（≤ 屏宽 × 200px） | 0.44s | 点击时读两次矩形 |
| S3 | `#app` 1 个 | 全屏 | 0.32s，结束后保持静止的变换 | 无 |
| S4 | 页头 3 个子元素 | 各 < 400×80px | 跟随滚动 | 无（滚动时间线在合成线程） |
| S5 | 游标 1 个 | 36×36px | 0.6s | 读一次 offsetLeft/Top |
| S7 | 每位 1 个 | 每位约 20×44px，≤ 12 位 | 0.6s + 位差 | 首次 innerHTML 一次 |
| S8 | 光带 1 个 | 约 200×200px | 1.1s，仅一次 | 无 |
| S9 | 卡片 1 个 | 约 360×200px | 按住期间 | rAF 内写 4 个变量 |
| S10 | 墨晕 1 个 | ≤ 卡片尺寸 | 0.52s | 插入 / 删除一个节点 |

验收在第 6 节清单之外再加两条：

1. 6 倍 CPU 降速下打开今日（S1 + S11）、日历连点 5 个日期（S5）、账本入场（S7）：连续长帧（> 16.7ms）不超过 2 个。
2. `data-pl-motion` 切到 `lite` / `none` 后逐项点一遍，对应项确实关掉，页面直接到终态。

### 8.6 落地顺序补充

签名动效排在第 6 节的步骤 A–F **之后**，作为步骤 G 一次落完（第 9 节的二级页与弹窗手势是步骤 H，第 10 节私密空间与随手拍是步骤 I，依次排在 G 之后）：`motion-signature.js`（新文件）+ `themes-plain-light.css`"二十九 · 签名动效" + `app.js` 一行调用 + `assets/plain-grain-160.png`。建议新增测试 `tests/plain-signature-motion.test.mjs`，锁住三件事：签名规则都带 plain 前缀；所有 `@keyframes` 只出现 `transform` / `opacity`；`motion-signature.js` 不 import `model.js` / `storage.js` / `notifications.js`。

---

## 9. 二级页与弹窗：连贯、跟手、可打断

第 8 节让页面"好看地出现"，这一节让二级页和弹窗**能被手直接操纵**：从哪里来、回哪里去，拖到一半可以反悔，松手后按手指的速度把剩下的路走完。

### 9.0 原则

1. **空间连续。** 二级页从被点的卡片或列表行原位展开，标题飞到导航栏；返回时原路收回。找不到来源（比如被重绘掉了）才退回普通推入。
2. **手势可打断、可反悔。** 拖动过程中元素严格跟手（1:1），松手时用手指的速度作为初速度交给弹簧（`SpringODE.to(target, velocity)`，`motion.js` 已支持），速度方向决定完成还是回弹。
3. **背景与前景同进度。** 弹层下拉、右滑返回时，背后的页面按同一个进度值 `p` 同步变化。每帧只写 2–3 个元素的 `transform` / `opacity`，不写 CSS 变量到祖先节点（会让整棵子树重算样式）。
4. **内容浮现要短。** 弹层和二级页内的子元素依次浮现，总时长 ≤ 380ms，从不禁用点击。用户在浮现过程中点按钮、滚动都直接生效。
5. **三档照旧。** 手势本身在三档都可用（跟手是直接操纵，不算动画）。差别在松手后的动画和背景联动：

| 项 | rich | lite | none（减弱动态效果） |
|---|---|---|---|
| Z1 原位展开 + 标题飞行 | 开 | 开 | 关，普通显示 |
| Z2 右滑返回 | 跟手 + 底页视差 + 遮罩 | 跟手 + 遮罩，底页不动 | 跟手；松手直接到终点 |
| Z3 弹层下拉 | 跟手 + 背景缩小变暗 | 跟手 + 遮罩变淡，背景不缩放 | 跟手；松手直接到终点 |
| Z4 内容浮现 | 开 | 开 | 关 |
| Z5 确认框 | 缩放 + 模糊背景 | 缩放 + 实色遮罩（不模糊） | 直接出现 + 实色遮罩 |
| Z6–Z9 | 开 | 开 | 关 |

6. **落点。** 新增 `motion-layers.js`，导出 `installLayerMotion()`，在 `installSignatureMotion()` 里调用，不再改 `app.js`。CSS 进 `themes-plain-light.css`"三十 · 二级页与弹窗"。仍然**不改** `core.js`（`openSubpage` / 关闭逻辑）和任何 `views/*.js`：打开靠观察 `.subpage-layer.active` / `.modal-layer.open` 的出现，关闭靠触发现有的返回按钮或遮罩点击（选择器以真实 DOM 为准，标 `/* 核对 */`）。

### 9.1 参数总表

| # | 项 | 关键参数 |
|---|---|---|
| Z1 | 原位展开 | 幽灵 440ms `cubic-bezier(.32,.72,0,1)`；标题同时长同曲线、等比缩放 = 导航字号 / 来源字号；落地后标题 80ms 交叉淡入；收回：内容 160ms 淡出，80ms 起幽灵与标题 360ms 回程 |
| Z2 | 右滑返回 | 边缘区 x ≤ 24px，判定距离 8px，`dx > |dy|`；全页区 x < 60% 屏宽，判定距离 12px，`dx > 2|dy|`；完成条件：`v > 520px/s` 或 `p > .35 且 v > −160px/s`；弹簧 k=360, c=38（临界阻尼附近，不过冲）；底页 `translateX(−20% × (1−p))`，遮罩 `opacity = .12 × (1−p)` |
| Z3 | 弹层下拉 | 判定 6px，`|dy| > |dx|`；上拉橡皮筋 `R(d) = 40 × (1 − 1 / (1 + d/120))`；投影 `y + v × 0.18s`；关闭条件：`v > 900px/s` 或下拉 > max(110px, 可见高度 28%)；关闭补间时长 `clamp(4 × 剩余距离 / v, 140, 260)ms`，曲线 `cubic-bezier(.2,.8,.2,1)`；回弹弹簧 k=520, c=40；背景 `translateY(10px × p) scale(1 − .06p)`，遮罩 `opacity = p` |
| Z3+ | 弹层分档 | 中档 = 屏高 52%，高档 = 屏高 92%；松手按投影点选最近一档 |
| Z4 | 内容浮现 | 弹层：60ms 起，每项 +24ms，最多 5 项，单项 220ms `--pl-ease-out`，位移 8px；二级页：推入时 140ms 起、展开时 200ms 起，每项 +28ms，最多 6 项，单项 240ms，位移 10px |
| Z5 | 确认框 | 进 `scale(.96 → 1)` + 淡入 200ms `--pl-ease-out`；出 `scale(1 → .98)` + 淡出 140ms `--pl-ease-in`；遮罩 `rgba(46,52,59,.24)` + 静态 `blur(10px)`，只补间 opacity |
| Z6 | 二级页叠层 | 第二层推入时第一层也 `translateX(−20%)` + 遮罩，规则与 Z2 一致 |
| Z7 | 锚点弹出菜单 | 从触发按钮所在角 `scale(.92 → 1)` + 淡入 180ms `--pl-ease-out`；菜单项每项 +18ms；出 120ms |
| Z8 | 防误关轻推 | 不允许点遮罩关闭时（确认框、未保存表单），点遮罩 → 面板 `scale(1 → 1.02 → 1)`（确认框）或 `translateY(0 → 8px → 0)`（弹层），260ms `--pl-spring-snappy` |
| Z9 | 返回箭头 | 按下箭头 `translateX(−3px)` 90ms，松手 420ms `--spring-release` |

### 9.2 共用工具

```js
// motion-layers.js
import { SpringODE } from './motion.js';
const root = document.documentElement;
const tier = () => root.dataset.plMotion || 'rich';          // 由 motion-signature.js 写入
const on = () => root.dataset.theme === 'plain';
const rich = () => on() && tier() === 'rich';
const moving = () => on() && tier() !== 'none';

/** 最近 100ms 的平均速度（px/s）。samples: [[timeStamp, value], ...] */
function velocityOf(samples) {
  const last = samples.at(-1);
  const first = samples.find(s => last[0] - s[0] <= 100) || samples[0];
  const dt = last[0] - first[0];
  return dt > 0 ? ((last[1] - first[1]) / dt) * 1000 : 0;
}

/** 用手指速度驱动一段弹簧。none 档直接跳到终点。返回取消函数。 */
function springTo(from, to, velocity, { stiffness, damping }, onUpdate, onDone) {
  if (!moving()) { onUpdate(to); onDone?.(); return () => {}; }
  const spring = new SpringODE({ mass: 1, stiffness, damping, precision: 0.5 });
  spring.current = from;                                        /* 核对：SpringODE 设置起点的方式 */
  spring.onUpdate = value => onUpdate(value);
  spring.onRest = () => { onUpdate(to); onDone?.(); };           /* 核对：静止回调名 */
  spring.to(to, velocity);
  return () => spring.stop();
}

/** 橡皮筋：超出范围时阻力越来越大，最多 40px */
const rubber = d => 40 * (1 - 1 / (1 + d / 120));
```

### 9.3 Z1 原位展开 + 标题飞行

在第 8 节 S2（幽灵展开到头卡）基础上加两件事：

1. **来源扩大到列表行。** 我的列表行、设置行、账户行等整行可点的元素都可以作为来源。行通常在一张白卡里，幽灵从一开始就带 `--pl-shadow-float`，看起来像这一行"被拿起来"。
2. **标题飞行。** 来源里的标题文字复制一份（只复制第一个文本节点），从原位置**等比**缩放、平移到导航栏标题的中心。导航栏真标题先隐藏，克隆落地后交叉淡入 80ms。等比缩放 = 导航字号 / 来源字号，一般在 0.9–1.2 之间，文字不会糊。

```js
const TITLE_IN = ':scope b, :scope .entry-title, :scope .row-title';    /* 核对：来源里的标题 */
const NAV_TITLE = '.subpage-header .subpage-title';                      /* 核对：导航栏标题 */

function textRect(el) {
  const node = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
  if (!node) return null;
  const range = document.createRange();
  range.selectNodeContents(node);
  return { rect: range.getBoundingClientRect(), text: node.textContent.trim() };
}

function flyTitle(src, layer) {
  const from = src.querySelector(TITLE_IN) || src;
  const nav = layer.querySelector(NAV_TITLE);
  const t = textRect(from);
  if (!nav || !t) return null;
  const cs = getComputedStyle(from);
  const scale = parseFloat(getComputedStyle(nav).fontSize) / parseFloat(cs.fontSize);
  const n = nav.getBoundingClientRect();
  const fly = Object.assign(document.createElement('span'), { className: 'pl-fly-title', textContent: t.text });
  Object.assign(fly.style, { left: t.rect.left + 'px', top: t.rect.top + 'px', font: cs.font, color: cs.color, letterSpacing: cs.letterSpacing });
  document.body.append(fly);
  const to = `translate(${n.left + n.width / 2 - (t.rect.left + t.rect.width / 2)}px, ${n.top + n.height / 2 - (t.rect.top + t.rect.height / 2)}px) scale(${scale.toFixed(3)})`;
  layer.classList.add('pl-title-pending');
  fly.animate([{ transform: 'none' }, { transform: to }], { duration: 440, easing: 'cubic-bezier(.32,.72,0,1)', fill: 'forwards' })
    .finished.then(() => {
      layer.classList.remove('pl-title-pending');
      return fly.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 80, fill: 'forwards' }).finished;
    }).then(() => fly.remove());
  return { to, text: t.text, style: fly.style.cssText };      // 收回时用同一份几何反向播放
}
```

```css
P .pl-fly-title { position: fixed; z-index: 191; white-space: nowrap; pointer-events: none; transform-origin: 50% 50%; will-change: transform; }
P .subpage-layer.pl-title-pending :is(.subpage-header .subpage-title) { opacity: 0; }        /* 核对 */
P .subpage-layer :is(.subpage-header .subpage-title) { transition: opacity 80ms linear; }
```

**收回时序**：

1. 二级页内容 160ms 淡出。
2. 从 80ms 起，标题克隆从导航栏、幽灵从头卡，各自 360ms 原路返回。
3. 原卡复现，幽灵 100ms 淡出。

总共约 540ms，但 240ms 后底页就已可点（遮罩已撤）。

### 9.4 Z2 右滑返回

两个起手区，适配两种 Android 导航方式：

- **边缘区**（x ≤ 24px）：三键导航机型上最自然的位置。全面屏手势机型的系统返回手势会先接管这块区域，走现有的返回处理（播放 Z1 的收回或普通推出），不冲突。
- **全页区**（x < 屏宽 60%）：全面屏手势机型上也能用的应用内返回，要求明显的横向意图（`dx > 2|dy|`），避免和纵向滚动抢。

**不起手的情况**：起点在横向滚动容器里（`scrollWidth > clientWidth` 且 `overflow-x` 为 auto/scroll）、在 `input` / `textarea` / `[contenteditable]` / `input[type=range]` 里、在任何照片表面或牌组 / 图集里、在 `[data-no-swipe-back]` 里，或者当前没有 `.subpage-layer.active`。

| 阶段 | 行为 |
|---|---|
| 判定 | 边缘区 8px、全页区 12px 后决定；不满足横向条件就放弃，交还给滚动 |
| 跟手 | 二级页 `translateX(x)`，`x = max(0, dx)`，向左不越界；`p = x / 屏宽` |
| 联动 | 底页 `translateX(−20% × (1 − p))`（rich）；遮罩 `opacity = .12 × (1 − p)`；二级页左缘静态阴影 |
| 松手 | `v` = 最近 100ms 平均速度；完成：`v > 520` 或 `p > .35 且 v > −160`；否则回弹 |
| 收尾 | 弹簧 k=360, c=38，初速度 = `v`；完成后触发现有返回（跳过默认推出动画）；来自 Z1 展开的页面不再缩回原卡，原卡 160ms 淡入 |

```js
const BACK_BUTTON = '.subpage-header .subpage-back';                       /* 核对 */
const NO_SWIPE = 'input, textarea, [contenteditable], [data-no-swipe-back], .journal-deck, .album-stack, [class*="photo-"]'; /* 核对 */

function scrollsX(el, stop) {
  for (let n = el; n && n !== stop; n = n.parentElement) {
    const ox = getComputedStyle(n).overflowX;
    if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 1) return true;
  }
  return false;
}

function installSwipeBack() {
  let g = null;
  document.addEventListener('pointerdown', e => {
    if (!on() || e.button > 0) return;
    const layer = e.target.closest('.subpage-layer.active');
    if (!layer || layer !== [...document.querySelectorAll('.subpage-layer.active')].at(-1)) return;
    if (e.target.closest(NO_SWIPE) || scrollsX(e.target, layer)) return;
    const W = innerWidth;
    const edge = e.clientX <= 24;
    if (!edge && e.clientX > W * 0.6) return;
    g = { layer, W, edge, x0: e.clientX, y0: e.clientY, id: e.pointerId, locked: false, samples: [[e.timeStamp, 0]], x: 0, raf: 0 };
  }, { capture: true, passive: true });

  document.addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (!g.locked) {
      if (Math.hypot(dx, dy) < (g.edge ? 8 : 12)) return;
      const horizontal = dx > 0 && (g.edge ? dx > Math.abs(dy) : dx > 2 * Math.abs(dy));
      if (!horizontal) { g = null; return; }
      g.locked = true;
      g.layer.setPointerCapture?.(e.pointerId);
      g.under = document.getElementById('app');
      g.dim = document.querySelector('.pl-subpage-dim');                  /* 第 5.1 节 ⑥ 的遮罩，落地时做成真节点 */
      g.layer.classList.add('pl-swiping');
    }
    g.x = Math.max(0, dx);
    g.samples.push([e.timeStamp, g.x]);
    if (g.samples.length > 12) g.samples.shift();
    if (!g.raf) g.raf = requestAnimationFrame(() => { g && (g.raf = 0, paintSwipe(g, g.x)); });
  }, { passive: true });

  const end = e => {
    if (!g || e.pointerId !== g.id) return;
    const s = g; g = null;
    if (!s.locked) return;
    const v = velocityOf(s.samples);
    const p = s.x / s.W;
    const done = v > 520 || (p > 0.35 && v > -160);
    springTo(s.x, done ? s.W : 0, v, { stiffness: 360, damping: 38 }, x => paintSwipe(s, x), () => {
      if (done) {
        s.layer.classList.add('pl-swiped');                              // 让默认推出动画跳过
        s.layer.querySelector(BACK_BUTTON)?.click();
      }
      requestAnimationFrame(() => {
        s.layer.classList.remove('pl-swiping', 'pl-swiped');
        [s.layer, s.under, s.dim].forEach(el => el && (el.style.transform = el.style.opacity = ''));
      });
    });
  };
  document.addEventListener('pointerup', end, { passive: true });
  document.addEventListener('pointercancel', end, { passive: true });
}

function paintSwipe(s, x) {
  const p = Math.min(1, Math.max(0, x / s.W));
  s.layer.style.transform = `translate3d(${x}px, 0, 0)`;
  if (rich() && s.under) s.under.style.transform = `translate3d(${(-20 * (1 - p)).toFixed(2)}%, 0, 0)`;
  if (s.dim) s.dim.style.opacity = (1 - p).toFixed(3);
}
```

```css
P .subpage-layer.active { touch-action: pan-y; }                         /* 横向手势归我们，纵向滚动归浏览器 */
P .subpage-layer:is(.pl-swiping, .pl-swiped) { transition: none !important; }
P .phone-shell:has(.subpage-layer.pl-swiping) > #app { transition: none !important; }
P .pl-subpage-dim { background: rgba(46, 52, 59, .12); }                 /* 替换 5.1 ⑥ 的 6%，右滑时纵深更明显 */
```

**Android 14 预测性返回**：系统手势本身也能提供进度（`OnBackAnimationCallback`），接上后系统返回也能跟手。这需要原生插件，不在本轮范围内，只记作后续方向。

### 9.5 Z3 弹层跟手下拉（含分档）

**起手区**：抓手条 + 标题行（面板顶部 56px）任何时候都可以拖；内容区只有在 `scrollTop ≤ 0` 且向下拖时才接管，否则交给内容滚动。按钮上起手也可以，一旦判定为拖动就吞掉这次点击。

| 阶段 | 行为 |
|---|---|
| 判定 | 6px，`|dy| > |dx|` |
| 跟手 | `y = base + dy`；`y < 0`（高于最高档）时 `y = −R(−y)` 橡皮筋 |
| 进度 | `p = clamp(1 − (y − y中档) / (面板高 − y中档), 0, 1)`；中档及以上 `p = 1` |
| 联动 | 背后 `#app`：`translateY(10px × p) scale(1 − .06 × p)`（rich）；遮罩 `opacity = p` |
| 松手 | 投影 `y投 = y + v × 0.18`；目标取 [高档, 中档, 关闭] 中离 `y投` 最近的；**关闭还要满足** `v > 900` 或下拉 > max(110px, 可见高度 × 28%)，否则停在中档 |
| 关闭补间 | WAAPI 同时驱动面板、`#app`、遮罩三者；时长 `clamp(4 × 剩余 / max(v, 1), 140, 260)ms`；曲线 `cubic-bezier(.2,.8,.2,1)`（起始斜率 4，恰好接住手指速度） |
| 回弹 / 换档 | `SpringODE` k=520, c=40，初速度 `v`，`onUpdate` 里同步写三者 |

不声明分档的弹层只有一档（打开即"中档"，高档 = 中档），规则不变。需要分档的弹层在面板上加 `data-pl-detents="medium large"`。这只是 CSS 与手势读取的标记，不影响业务逻辑，可以由 JS 在打开时按面板内容高度自动判断（内容高于屏 60% 才启用）。

```js
const SHEET = '#modal-layer.open .modal';                                  /* 核对 */
const SHEET_HEAD = '.modal-grabber, .modal-header, .modal-title';         /* 核对 */

function sheetGeometry(sheet) {
  const H = innerHeight, h = sheet.offsetHeight;
  const detents = sheet.dataset.plDetents ? [Math.max(0, h - H * 0.92), Math.max(0, h - H * 0.52)] : [0, 0];
  return { h, large: detents[0], medium: detents[1], closed: h };
}

function paintSheet(s, y) {
  const p = Math.min(1, Math.max(0, 1 - (y - s.geo.medium) / (s.geo.closed - s.geo.medium)));
  s.sheet.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
  if (rich()) s.app.style.transform = `translateY(${(10 * p).toFixed(2)}px) scale(${(1 - 0.06 * p).toFixed(4)})`;
  s.scrim.style.opacity = p.toFixed(3);
}

function releaseSheet(s, y, v) {
  const proj = y + v * 0.18;
  const { large, medium, closed } = s.geo;
  let target = [large, medium, closed].reduce((a, b) => Math.abs(b - proj) < Math.abs(a - proj) ? b : a);
  const pulled = y - medium;
  if (target === closed && !(v > 900 || pulled > Math.max(110, (closed - medium) * 0.28))) target = medium;
  if (target === closed) {
    const ms = moving() ? Math.min(260, Math.max(140, (4 * (closed - y)) / Math.max(v, 1) * 1000)) : 0;
    const opts = { duration: ms, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' };
    const p0 = Math.min(1, Math.max(0, 1 - pulled / (closed - medium)));
    const anims = [
      s.sheet.animate([{ transform: `translate3d(0, ${y}px, 0)` }, { transform: `translate3d(0, ${closed}px, 0)` }], opts),
      s.scrim.animate([{ opacity: p0 }, { opacity: 0 }], opts),
    ];
    if (rich()) anims.push(s.app.animate([{ transform: s.app.style.transform || 'none' }, { transform: 'none' }], opts));
    Promise.all(anims.map(a => a.finished)).then(() => {
      s.sheet.closest('.modal-layer').classList.add('pl-dragged');        // 跳过默认关闭过渡
      closeCurrentSheet();                                                 /* 核对：触发现有关闭（遮罩点击或取消按钮） */
      requestAnimationFrame(() => { anims.forEach(a => a.cancel()); clearSheetStyles(s); });
    });
    return;
  }
  springTo(y, target, v, { stiffness: 520, damping: 40 }, yy => paintSheet(s, yy), () => {
    s.sheet.dataset.plDetent = target === large && large !== medium ? 'large' : 'medium';
    s.base = target;
  });
}
```

```css
P #modal-layer.open .modal { touch-action: none; }                        /* 抓手区；内容滚动区单独 pan-y */
P #modal-layer.open .modal :is(.modal-body, .modal-scroll) { touch-action: pan-y; }   /* 核对 */
P #modal-layer:is(.pl-dragging, .pl-dragged) :is(.modal, *) { transition: none !important; }
P .phone-shell:has(#modal-layer.pl-dragging) > #app { transition: none !important; }
P .modal[data-pl-detents] { height: 92vh; }
P .modal[data-pl-detents]:not([data-pl-detent="large"]) { transform: translate3d(0, calc(92vh - 52vh), 0); }
```

### 9.6 Z4 内容依次浮现

```css
/* 弹层：面板约 40% 到位时开始，最后一项 156ms 起、376ms 落定 */
P[data-pl-motion]:not([data-pl-motion="none"]) #modal-layer.open .modal > :nth-child(-n + 5) {
  animation: pl-rise 220ms var(--pl-ease-out) backwards;
  animation-delay: calc(60ms + (var(--pl-ci, 0)) * 24ms);
}
/* 二级页：推入 140ms 起；Z1 展开 200ms 起 */
P[data-pl-motion]:not([data-pl-motion="none"]) .subpage-layer.pl-cascade .subpage-body > :nth-child(-n + 6) {   /* 核对 */
  animation: pl-rise-10 240ms var(--pl-ease-out) backwards;
  animation-delay: calc(var(--pl-c0, 140ms) + var(--pl-ci, 0) * 28ms);
}
P .subpage-layer.pl-expand-in { --pl-c0: 200ms; }
@keyframes pl-rise { from { opacity: 0; transform: translate3d(0, 8px, 0); } to { opacity: 1; transform: none; } }
@keyframes pl-rise-10 { from { opacity: 0; transform: translate3d(0, 10px, 0); } to { opacity: 1; transform: none; } }
```

```js
// 打开时给前 N 个子元素写序号；600ms 后撤掉 .pl-cascade，层内再次渲染不会重播
function cascade(container, items, max) {
  [...items].slice(0, max).forEach((el, i) => el.style.setProperty('--pl-ci', i));
  container.classList.add('pl-cascade');
  setTimeout(() => container.classList.remove('pl-cascade'), 600);
}
```

`:nth-child(-n + 5)` 之后的元素不参与，和面板一起出现。浮现只用 `animation-fill-mode: backwards`，结束后不残留 transform，不影响内部 `position: sticky`。

### 9.7 Z5 确认框与删除提示

现状：确认框是底部弹层（`.modal.confirm-sheet`），和其他弹层一样用 65% 暖黑遮罩 + 全屏模糊，从底部升起。清简主题下改成**居中卡片**：危险操作需要停下来想一下，居中比底部更有"停顿"的语义。

| 参数 | 值 |
|---|---|
| 尺寸 | `width: min(320px, 100% − 48px)`，圆角 22px，内边距 20px，`--pl-shadow-float` |
| 进 | `translate(−50%, −50%) scale(.96) → scale(1)` + `opacity 0 → 1`，200ms `--pl-ease-out`，**无过冲** |
| 出 | `scale(1) → scale(.98)` + `opacity → 0`，140ms `--pl-ease-in` |
| 图标 | 危险图标（浅红圆底）`scale(.9) → 1` + 淡入，160ms，60ms 起 |
| 遮罩（rich） | `rgba(46,52,59,.24)` + `backdrop-filter: blur(10px) saturate(1.1)`；模糊半径固定不补间，只补间遮罩层的 opacity（200ms / 140ms） |
| 遮罩（lite / none） | `rgba(46,52,59,.40)`，不模糊 |
| 按钮 | 取消在左（中性），删除在右（实心 `--pl-danger` 白字）；默认焦点在取消 |
| 点遮罩 | 不关闭，触发 Z8 轻推 |

```css
P #modal-layer .modal.confirm-sheet {                                      /* 核对 */
  position: fixed; left: 50%; top: 50%; bottom: auto; right: auto;
  width: min(320px, calc(100% - 48px)); border-radius: 22px; padding: 20px;
  box-shadow: var(--pl-shadow-float);
  transform: translate(-50%, -50%) scale(.98); opacity: 0;
  transition: transform 140ms var(--pl-ease-in), opacity 140ms var(--pl-ease-in);
}
P #modal-layer.open .modal.confirm-sheet {
  transform: translate(-50%, -50%); opacity: 1;
  animation: pl-dialog-in 200ms var(--pl-ease-out) both;
}
@keyframes pl-dialog-in { from { opacity: 0; transform: translate(-50%, -50%) scale(.96); } to { opacity: 1; transform: translate(-50%, -50%); } }
P[data-pl-motion="rich"] #modal-layer:has(.confirm-sheet) {
  background: rgba(46, 52, 59, .24);
  -webkit-backdrop-filter: blur(10px) saturate(1.1); backdrop-filter: blur(10px) saturate(1.1);
}
P:not([data-pl-motion="rich"]) #modal-layer:has(.confirm-sheet) { background: rgba(46, 52, 59, .40); backdrop-filter: none; }
P #modal-layer .confirm-sheet .danger-icon { animation: pl-pop-in 160ms var(--pl-ease-out) 60ms both; }   /* 核对 */
P #modal-layer .confirm-sheet .danger { background: var(--pl-danger); color: #fff; }                       /* 核对 */
```

**性能说明**：模糊是这一节唯一的 `backdrop-filter`。它只在确认框打开期间存在，半径不变，背后页面静止，所以合成器只在淡入淡出那 200ms 里每帧重算；打开后没有新的帧就不重算。lite 档直接去掉。

### 9.8 Z6 二级页叠层

二级页里再进二级页（例如设置 → 某项详情）时，下面那层也按 Z2 的规则 `translateX(−20%)` 并压 12% 遮罩；右滑最上层时，下面那层按 `p` 回到原位。规则写成"所有非最上层的 `.subpage-layer.active`"，不需要知道层数。

```css
P[data-pl-motion="rich"] .subpage-layer.active:has(~ .subpage-layer.active) {
  transform: translate3d(-20%, 0, 0); transition: transform 350ms cubic-bezier(.16, 1, .3, 1);
}
```

### 9.9 Z7 锚点弹出菜单

导航栏 ⋯、卡片 ⋯ 这类菜单，从触发按钮所在的角长出来，而不是从屏幕中间。**日记牌组摊开里的 ⋯ 菜单不改**。

```css
P .pl-popover { transform-origin: var(--pl-origin, 100% 0); }              /* JS 按触发按钮在菜单的哪个角写 --pl-origin */
P .pl-popover.open { animation: pl-pop-menu 180ms var(--pl-ease-out) both; }
P .pl-popover.open > * { animation: pl-rise 160ms var(--pl-ease-out) backwards; animation-delay: calc(40ms + var(--pl-ci, 0) * 18ms); }
P .pl-popover.closing { animation: pl-pop-out 120ms var(--pl-ease-in) both; }
@keyframes pl-pop-menu { from { opacity: 0; transform: scale(.92); } to { opacity: 1; transform: none; } }
@keyframes pl-pop-out { to { opacity: 0; transform: scale(.96); } }
```

### 9.10 Z8 防误关轻推

确认框，以及有未保存输入的表单弹层，点遮罩不关闭，面板轻轻"回应"一下，告诉用户"要用按钮"：

```css
P .modal.confirm-sheet.pl-nudge { animation: pl-nudge-dialog 260ms var(--pl-spring-snappy); }
P .modal.pl-nudge:not(.confirm-sheet) { animation: pl-nudge-sheet 260ms var(--pl-spring-snappy); }
@keyframes pl-nudge-dialog { 50% { transform: translate(-50%, -50%) scale(1.02); } }
@keyframes pl-nudge-sheet { 50% { transform: translate3d(0, 8px, 0); } }
```

JS：在遮罩的 `pointerup` 上判断"不允许点外关闭"，给面板加 `.pl-nudge`，`animationend` 时移除。

### 9.11 Z9 返回箭头

```css
P .subpage-back .material-symbols-outlined { transition: transform 420ms var(--spring-release); }      /* 核对 */
P .subpage-back[data-pressed] .material-symbols-outlined { transform: translateX(-3px); transition-duration: 90ms; }
```

### 9.12 验收补充

1. 右滑返回：边缘起手和全页起手各 10 次，快甩、慢拖过半、拖到 30% 松手、拖出后往回拉，结果分别是完成、完成、回弹、回弹。
2. 弹层下拉：慢拉 100px 松手回弹；慢拉 140px 松手关闭；从中档快速上甩到高档；从高档快速下甩到中档而不是直接关闭（除非投影越过关闭线）。
3. 拖动过程中 6 倍 CPU 降速：拖动帧不掉到 30fps 以下；松手后的补间连续长帧不超过 2 个。
4. 减弱动态效果下：拖动仍然跟手，松手直接到终点；确认框直接出现、没有模糊。
5. 横向滚动的标签行、输入框、照片、牌组里起手不会触发右滑返回。

---

## 10. 主角：私密空间与随手拍

用户最常用的两块。这一节只**叠加**：私密空间的加密、锁定、观看记录逻辑不改一行；随手拍的图集一叠牌、`photoFrameLayersHtml`、拍照 / 选图 / 保存流程都不改。做法和第 9 节一样：在 `motion-layers.js` 里旁听 DOM 变化（`MutationObserver`）、捕获阶段的点击 / 提交（只读位置，不 `preventDefault`、不 `stopPropagation`，唯一例外见 M4）和可见性事件，然后在现有元素上叠 transform / opacity。

### 10.0 照片飞行的铁律

1. **只做等比缩放。** 飞行的永远是一张独立的 `<img>` 克隆，摆在来源照片的 **contain 显示框**上（不是外框），然后 `translate + scale(s)` 飞到目标照片的 contain 显示框。两端是同一张图，宽高比相同，所以 `s = 目标宽 / 来源宽` 一个数就够。
2. **起飞前核对比例。** `|(tw/th) / (sw/sh) − 1| > 0.5%` 就放弃飞行，只做淡入（防止目标图换了版本或还没加载）。
3. **外框和照片分开动。** 外框（白纸 / 圆角）可以用空白幽灵做非等比缩放，但只在 `|sx/sy − 1| ≤ .25` 时使用，否则只飞照片；照片本身从不非等比缩放。
4. **没加载完不飞。** 目标 `img.complete && naturalWidth` 不成立时，等 `load` 最多 300ms，超时放弃飞行。
5. **点照片看大图仍然没有入场动效。** 本节所有飞行只发生在"列表 ↔ 列表"之间。

```js
// motion-layers.js · 第 10 节共用
/** contain 显示框：img 元素框内、按原始宽高比实际显示照片的那块矩形（视口坐标） */
function containRect(img) {
  const r = img.getBoundingClientRect();
  const nw = img.naturalWidth, nh = img.naturalHeight;
  if (!nw || !nh) return null;
  const s = Math.min(r.width / nw, r.height / nh);
  const w = nw * s, h = nh * s;
  return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h, ratio: nw / nh };
}
const sameRatio = (a, b) => Math.abs(a.width / a.height / (b.width / b.height) - 1) <= 0.005;

/** 等比飞行：克隆摆在 from 上，飞到 to。返回 Animation；比例不符返回 null。 */
function flyPhoto(src, from, to, { duration = 480, easing = 'cubic-bezier(.32,.72,0,1)', radius = 12 } = {}) {
  if (!from || !to || !sameRatio(from, to) || !moving()) return null;
  const img = new Image();
  img.src = src;
  img.className = 'pl-fly-photo';
  Object.assign(img.style, { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px', borderRadius: radius + 'px' });
  document.body.append(img);
  const s = to.width / from.width;                                   // 等比：一个数
  const anim = img.animate([
    { transform: 'none' },
    { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${s})` }
  ], { duration, easing, fill: 'forwards' });
  anim.finished.then(() => img.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 80, fill: 'forwards' }).finished).finally(() => img.remove());
  return anim;
}
```

```css
/* themes-plain-light.css · 三十一 · 私密空间与随手拍 */
P .pl-fly-photo, :root[data-theme="plain"] body > .pl-fly-photo { position: fixed; z-index: 2147483000; object-fit: contain; transform-origin: 0 0; pointer-events: none; will-change: transform; box-shadow: var(--pl-shadow-float); }
```

### 10.1 参数总表

| # | 项 | 关键参数 |
|---|---|---|
| V1 | 解锁仪式 | 锁面克隆从中缝上下分开：上半 `translateY(−32px)`、下半 `translateY(+32px)`，同时淡出，280ms `cubic-bezier(.4,0,.2,1)`；锁徽 0–120ms `scale(1 → 1.18)` + 淡出；中缝一道 1px 亮线 `scaleX(0 → 1)` 0–140ms 后随下半淡出；内容 90ms 起依次浮现，每项 +24ms，最多 6 项，单项 220ms `--pl-ease-out`，位移 12px；封面网格从"第一个格子轮到的时刻"起按 `(行 + 列) × 24ms` 斜向错开；**总时长 ≤ 430ms，全程可点**（克隆 `pointer-events: none`） |
| V2 | 后台遮罩 | 切出（`visibilitychange → hidden` / `pagehide`）立即盖上，无动画；rich：`backdrop-filter: blur(24px) saturate(1.1)` + `rgba(234,240,248,.55)` + 居中锁徽；lite / none：实色 `#EAF0F8` + 锁徽；回来时等两帧（锁屏已在遮罩下渲染好），遮罩 240ms `--pl-ease-out` 淡出，锁面 40ms 起 `scale(.98 → 1)` + 淡入 260ms；保险：回来 1200ms 后无条件移除 |
| V3 | 封面原位展开 | 点 `.vault-folder-open`：封面照片按 contain 框飞到详情里同一张照片（`[data-open-vault-item="封面项 id"]`）的 contain 框，420ms `cubic-bezier(.32,.72,0,1)`；封面外框幽灵同时长同曲线，`|sx/sy − 1| ≤ .25` 才用；其余照片按到落点的距离排序依次浮现，120ms 起每项 +20ms（封顶 8），单项 200ms，位移 8px + `scale(.96 → 1)`；返回文件夹列表时反向飞回，340ms |
| M1 | 快门 / 相册飞入 | 记下被点的 `#capture-snippet-photo` / `#pick-snippet-photo` 中心；8s 内表单网格新增的 `.snippet-photo-cell` 从按钮中心飞入：`translate(按钮中心 − 格中心) scale(44 / max(格宽, 格高)) → none`，520ms `--pl-spring-magnet`（等比，过冲 10% 只发生在等比缩放上），前 30% 淡入；多张每张 +40ms，最多 6 张 |
| M2 | 保存飞到列表顶部 | 提交 `#snippet-form` 时记下第一张缩略图的 contain 框和地址，以及现有卡片位置；3s 内列表出现新卡片：照片克隆按 10.0 飞到新卡第一张图的 contain 框，480ms `cubic-bezier(.32,.72,0,1)`；新卡 100ms 起淡入 + 上移 10px 220ms，主图在克隆落地时 80ms 交叉淡入；旧卡片 FLIP 下移让位 360ms `cubic-bezier(.32,.72,0,1)`，最多处理视口内 6 张 |
| M3 | 滚动分层淡入 | 只对首屏以外的卡片：进入视口（`rootMargin: 0px 0px -8% 0px`）后三层依次到位：铺底 `opacity 0 → .5`（铺底原本就是半透明）200ms；主图 60ms 起 `opacity 0 → 1` + `scale(.985 → 1)` 300ms；文字与按钮 110ms 起上移 6px + 淡入 220ms；同一批进入的卡片每张 +40ms（封顶 3）；图片未加载时等 `load`，主图不先于加载出现 |
| M4 | 长按浮起 | 按住 380ms 且移动 < 8px：卡片 `translateY(−4px) scale(1.012)` 180ms `--pl-ease-out`，阴影层（`::after`）淡入；松手 / 取消 420ms `--spring-release` 落回；浮起后松手吞掉这一次 click（长按不等于轻点）；在视频段、按钮上起手不触发；图集一叠牌（`#moment-album-layer` / `.moment-album-stack`）不在列表卡片里，天然不受影响 |

三档：

| 项 | rich | lite | none |
|---|---|---|---|
| V1 | 分开 + 中缝亮线 + 浮现 | 锁面 160ms 淡出 + 浮现（不分开） | 直接显示 |
| V2 | 模糊遮罩 | 实色遮罩 | 实色遮罩，回来直接移除 |
| V3 | 封面飞行 + 幽灵 + 浮现 | 封面飞行 + 浮现（无幽灵） | 直接显示 |
| M1 / M2 | 开 | 开（M2 不做 FLIP） | 关 |
| M3 | 三层 | 只做整卡淡入 | 关 |
| M4 | 开 | 开 | 浮起无补间（仍有反馈，属于直接操纵） |

### 10.2 V1 解锁仪式

不接管解锁：指纹 / 密码校验成功后，`private-vault.js` 自己 `render()` 出已解锁页面。我们在锁屏还在时缓存锁面的位置，等观察到"锁屏节点被移除、已解锁页面出现"的那一批变动，把**被移除的锁面节点本身**（`removedNodes` 里拿得到）摆回原位当残影，播完即删。`MutationObserver` 回调在下一次绘制之前执行，所以不会闪一帧空白。

```js
// motion-layers.js · V1
const LOCK_PAPER = '.vault-locked-view .vault-lock-paper';           /* 核对 */
let lockRect = null;
function rememberLock() { const p = document.querySelector(LOCK_PAPER); lockRect = p ? p.getBoundingClientRect() : null; }

function playUnlock(oldPaper, view) {
  if (!moving() || !oldPaper || !lockRect) return;
  const host = document.createElement('div');
  host.className = 'pl-unlock';
  Object.assign(host.style, { left: lockRect.left + 'px', top: lockRect.top + 'px', width: lockRect.width + 'px', height: lockRect.height + 'px' });
  if (rich()) {
    // 上下两半：同一张锁面克隆两次，各自用 overflow:hidden 的半高容器裁出一半
    host.innerHTML = '<div class="pl-half top"></div><div class="pl-half bottom"></div><i class="pl-seam"></i>';
    host.querySelectorAll('.pl-half').forEach(h => h.append(oldPaper.cloneNode(true)));
  } else {
    host.append(oldPaper);
  }
  document.body.append(host);
  setTimeout(() => host.remove(), 320);
  cascade(view.querySelectorAll('.vault-security-note, .vault-toolbar, .vault-folder-home-head, .vault-folder-card'), { start: 90, step: 24, max: 6, dur: 220, dy: 12, grid: '.vault-folder-card' });
}

new MutationObserver(records => {
  if (!on()) return;
  for (const r of records) for (const n of r.removedNodes) {
    if (n.nodeType !== 1 || !n.matches?.('.vault-locked-view')) continue;
    const view = document.querySelector('.private-vault-view:not(.vault-locked-view)');
    if (view) playUnlock(n.querySelector('.vault-lock-paper'), view);
  }
  if (document.querySelector(LOCK_PAPER)) rememberLock();
}).observe(document.querySelector('#app') || document.body, { childList: true, subtree: true });   /* 核对：视图挂载点 */
```

```css
P .pl-unlock, :root[data-theme="plain"] body > .pl-unlock { position: fixed; z-index: 60; pointer-events: none; }
:root[data-theme="plain"] body > .pl-unlock > .vault-lock-paper { animation: pl-fade-out 160ms var(--pl-ease-in) both; }
:root[data-theme="plain"] body > .pl-unlock .pl-half { position: absolute; left: 0; right: 0; height: 50%; overflow: hidden; }
:root[data-theme="plain"] body > .pl-unlock .pl-half.top { top: 0; animation: pl-split-up 280ms cubic-bezier(.4,0,.2,1) both; }
:root[data-theme="plain"] body > .pl-unlock .pl-half.bottom { bottom: 0; animation: pl-split-down 280ms cubic-bezier(.4,0,.2,1) both; }
:root[data-theme="plain"] body > .pl-unlock .pl-half > * { position: absolute; left: 0; width: 100%; height: 200%; margin: 0; }
:root[data-theme="plain"] body > .pl-unlock .pl-half.top > * { top: 0; }
:root[data-theme="plain"] body > .pl-unlock .pl-half.bottom > * { bottom: 0; }
:root[data-theme="plain"] body > .pl-unlock .pl-seam { position: absolute; left: 12%; right: 12%; top: 50%; height: 1px; background: rgba(255,255,255,.9); box-shadow: 0 0 12px rgba(79,118,189,.5); transform-origin: 50% 50%; animation: pl-seam 280ms var(--pl-ease-out) both; }
:root[data-theme="plain"] body > .pl-unlock .vault-lock-mark { animation: pl-mark-out 120ms var(--pl-ease-out) both; }
@keyframes pl-split-up { to { transform: translate3d(0,-32px,0); opacity: 0; } }
@keyframes pl-split-down { to { transform: translate3d(0,32px,0); opacity: 0; } }
@keyframes pl-seam { 0% { transform: scaleX(0); opacity: 1; } 50% { transform: none; opacity: 1; } 100% { transform: none; opacity: 0; } }
@keyframes pl-mark-out { to { transform: scale(1.18); opacity: 0; } }
@keyframes pl-fade-out { to { opacity: 0; } }
```

共用的依次浮现（V1 / V3 / Z4 都用）：

```js
/** 依次浮现：只写 animation-delay 与一个类，动画本身在 CSS。
 *  grid 选择器内的元素从"第一个格子轮到的时刻"起，按 (行 + 列) × 24ms 斜向错开。 */
function cascade(nodes, { start, step, max, dur, dy, grid }) {
  if (!moving()) return;
  nodes = [...nodes];
  const gi = grid ? nodes.findIndex(n => n.matches(grid)) : -1;
  let i = 0;
  for (const el of nodes) {
    let delay = start + Math.min(i, max) * step;
    if (gi >= 0 && el.matches(grid)) {
      const cols = getComputedStyle(el.parentElement).gridTemplateColumns.split(' ').length || 1;
      const idx = [...el.parentElement.querySelectorAll(':scope > ' + grid)].indexOf(el);
      delay = start + Math.min(gi, max) * step + (Math.floor(idx / cols) + (idx % cols)) * 24;
    }
    el.style.setProperty('--pl-cd', delay + 'ms');
    el.style.setProperty('--pl-cdur', dur + 'ms');
    el.style.setProperty('--pl-cdy', dy + 'px');
    el.classList.remove('pl-cascade'); void el.offsetWidth; el.classList.add('pl-cascade');
    el.addEventListener('animationend', () => el.classList.remove('pl-cascade'), { once: true });
    i += 1;
  }
}
```

```css
P .pl-cascade { animation: pl-rise var(--pl-cdur, 220ms) var(--pl-ease-out) var(--pl-cd, 0ms) backwards; }
@keyframes pl-rise { from { opacity: 0; transform: translate3d(0, var(--pl-cdy, 10px), 0); } }
```

### 10.3 V2 后台遮罩

只是视觉：遮罩挡的是"回来那一瞬间看到上次的内容"。真正的锁定仍由 `scheduleVisibilityLock()` 按原规则执行，遮罩既不提前也不推迟锁定。

> 说明：Android 最近任务里的缩略图由系统在切出时截取，可能早于 WebView 画出遮罩。要让多任务缩略图也不露内容，需要原生 `FLAG_SECURE`，那属于原生层改动，不在本方案范围内，这里只标记出来。

```js
// motion-layers.js · V2
const inVault = () => !!document.querySelector('.private-vault-view');
let shield = null;
function raiseShield() {
  if (!on() || !inVault() || shield) return;
  shield = document.createElement('div');
  shield.className = 'pl-vault-shield' + (rich() ? ' is-blur' : '');
  shield.innerHTML = '<span class="material-symbols-outlined">lock</span>';
  document.body.append(shield);                                     // 切出时立即盖上，不做动画
}
function lowerShield() {
  const s = shield; if (!s) return;
  shield = null;
  // 等两帧：private-vault.js 的 visibilitychange 已经 render() 出锁屏（或仍是解锁页）
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const paper = document.querySelector(LOCK_PAPER);
    if (!moving()) { s.remove(); return; }
    paper?.classList.add('pl-relock');
    paper?.addEventListener('animationend', () => paper.classList.remove('pl-relock'), { once: true });
    s.classList.add('is-leaving');
    setTimeout(() => s.remove(), 260);
  }));
  setTimeout(() => s.remove(), 1200);                               // 保险：无论如何不挡操作
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' ? raiseShield() : lowerShield());
addEventListener('pagehide', raiseShield);
```

```css
:root[data-theme="plain"] body > .pl-vault-shield { position: fixed; inset: 0; z-index: 2147483600; display: grid; place-items: center; background: #EAF0F8; color: var(--pl-blue); }
:root[data-theme="plain"] body > .pl-vault-shield.is-blur { background: rgba(234,240,248,.55); -webkit-backdrop-filter: blur(24px) saturate(1.1); backdrop-filter: blur(24px) saturate(1.1); }
:root[data-theme="plain"] body > .pl-vault-shield .material-symbols-outlined { font-size: 40px; width: 72px; height: 72px; display: grid; place-items: center; border-radius: 22px; background: #fff; box-shadow: var(--pl-shadow-float); }
:root[data-theme="plain"] body > .pl-vault-shield.is-leaving { animation: pl-fade-out 240ms var(--pl-ease-out) both; }
P .vault-lock-paper.pl-relock { animation: pl-relock 260ms var(--pl-ease-out) 40ms both; }
@keyframes pl-relock { from { opacity: 0; transform: scale(.98); } }
```

模糊只在遮罩上、而且是静态的：淡出时补间的只有 opacity，GPU 每帧做一次全屏模糊合成、共 240ms；lite / none 用实色，零模糊。

### 10.4 V3 封面原位展开

```js
// motion-layers.js · V3
let coverFlight = null;
document.addEventListener('click', e => {
  const btn = e.target.closest?.('.vault-folder-open');
  if (!btn || !on() || !moving()) return;
  const cover = btn.querySelector('.vault-folder-cover');
  const still = cover?.querySelector('.photo-blur-still');
  coverFlight = {
    t: performance.now(),
    itemId: cover?.dataset.vaultCoverItem || '',                     // folderCard() 已输出该属性
    frame: cover?.getBoundingClientRect(),
    photo: still?.complete ? containRect(still) : null,
    src: still?.currentSrc || still?.src || ''
  };
}, true);                                                             // 捕获阶段只读，不拦截

function playCoverOpen(view) {
  const f = coverFlight; coverFlight = null;
  if (!f || performance.now() - f.t > 1500) return;
  const items = [...view.querySelectorAll('.vault-grid .vault-item')];
  const target = view.querySelector(`[data-open-vault-item="${CSS.escape(f.itemId)}"]`) || items[0]?.querySelector('.vault-item-open');
  const box = target?.querySelector('.vault-media-box');
  const still = box?.querySelector('.photo-blur-still');
  const vh = innerHeight;
  if (box && f.frame && rich()) {
    const b = box.getBoundingClientRect();
    const sx = b.width / f.frame.width, sy = b.height / f.frame.height;
    if (Math.abs(sx / sy - 1) <= 0.25 && b.top < vh && b.bottom > 0) ghostFrame(f.frame, b, 420);
  }
  if (still && f.photo && f.src) {
    still.style.opacity = '0';
    const go = () => { const anim = flyPhoto(f.src, f.photo, containRect(still), { duration: 420 }); (anim ? anim.finished : Promise.resolve()).finally(() => { still.style.opacity = ''; }); };
    still.complete ? go() : (still.addEventListener('load', go, { once: true }), setTimeout(() => { still.style.opacity = ''; }, 300));
  }
  const origin = target?.closest('.vault-item');
  const rest = items.filter(el => el !== origin).sort((a, b) => dist(a, origin) - dist(b, origin));
  cascade(rest, { start: 120, step: 20, max: 8, dur: 200, dy: 8 });
}
const dist = (a, b) => { if (!b) return 0; const p = a.getBoundingClientRect(), q = b.getBoundingClientRect(); return Math.hypot(p.left - q.left, p.top - q.top); };
function ghostFrame(from, to, duration) {
  const g = document.createElement('div');
  g.className = 'pl-ghost-frame';
  Object.assign(g.style, { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px' });
  document.body.append(g);
  g.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`, opacity: 1 }, ], { duration, easing: 'cubic-bezier(.32,.72,0,1)', fill: 'forwards' })
    .finished.then(() => g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100, fill: 'forwards' }).finished).finally(() => g.remove());
}
// 在 V1 的同一个 MutationObserver 里：出现 .vault-content-head 且 coverFlight 存在 → playCoverOpen(view)
```

返回文件夹列表（`#vault-back-folders`）同理：捕获阶段记下封面项在详情里的 contain 框，渲染后找到对应 `[data-vault-cover-item]` 的封面，用 `flyPhoto(..., { duration: 340 })` 飞回；其余封面按 V1 的斜向错开浮现（`start: 60`）。

```css
:root[data-theme="plain"] body > .pl-ghost-frame { position: fixed; z-index: 2147482999; transform-origin: 0 0; border-radius: 16px; background: #fff; box-shadow: var(--pl-shadow-float); pointer-events: none; will-change: transform; }
```

### 10.5 M1 快门 / 相册飞入

```js
// motion-layers.js · M1
let shotFrom = null;
document.addEventListener('click', e => {
  const b = e.target.closest?.('#capture-snippet-photo, #pick-snippet-photo');
  if (!b || !on()) return;
  const r = b.getBoundingClientRect();
  shotFrom = { x: r.left + r.width / 2, y: r.top + r.height / 2, t: performance.now(), before: document.querySelectorAll('.snippet-photo-cell').length };
}, true);

function playShotIn() {
  if (!shotFrom || !moving() || performance.now() - shotFrom.t > 8000) return;
  const cells = [...document.querySelectorAll('.snippet-photo-cell')];
  const fresh = cells.slice(shotFrom.before, shotFrom.before + 6);
  const { x, y } = shotFrom; shotFrom = null;
  fresh.forEach((cell, i) => {
    const thumb = cell.querySelector('.snippet-photo-thumb') || cell;
    const r = thumb.getBoundingClientRect();
    const s = 44 / Math.max(r.width, r.height);                        // 等比：照片框整体缩放
    thumb.animate([
      { transform: `translate(${x - (r.left + r.width / 2)}px, ${y - (r.top + r.height / 2)}px) scale(${s})`, opacity: 0 },
      { opacity: 1, offset: 0.3 },
      { transform: 'none', opacity: 1 }
    ], { duration: 520, delay: i * 40, easing: SPRING_MAGNET, fill: 'backwards' });
  });
}
// SPRING_MAGNET = getComputedStyle(root).getPropertyValue('--pl-spring-magnet').trim()（8.1 已定义）
// 触发：MutationObserver 观察到 .snippet-photo-grid 内子节点变化 → playShotIn()
```

照片框整体等比缩放，里面的铺底 + contain 主图跟着一起缩，主图永远不变形。照片框外的删除按钮（`[data-remove-pending-snippet-photo]`）在同一个 cell 里，随框一起飞入即可。

### 10.6 M2 保存飞到列表顶部

```js
// motion-layers.js · M2
let saved = null;
const cardKey = card => card.querySelector('[data-view-snippet-photo], [data-play-snippet-video]')?.dataset.viewSnippetPhoto || '';   /* 核对 */
document.addEventListener('submit', e => {
  if (e.target?.id !== 'snippet-form' || !on() || !moving()) return;
  const still = e.target.querySelector('.snippet-photo-thumb .photo-blur-still');
  saved = {
    t: performance.now(),
    editing: !!e.target.querySelector('input[name="id"]')?.value,
    photo: still?.complete ? containRect(still) : null,
    src: still?.currentSrc || still?.src || '',
    before: new Map([...document.querySelectorAll('.snippet-item-card')].map(c => [cardKey(c), c.getBoundingClientRect().top]))
  };
}, true);

function playSaveToTop() {
  const s = saved; if (!s || performance.now() - s.t > 3000) return;
  const cards = [...document.querySelectorAll('.snippet-item-card')];
  const fresh = cards.find(c => !s.before.has(cardKey(c)));
  if (!fresh) return;                                                // 编辑已有记录时不飞（位置不变）
  saved = null;
  const still = fresh.querySelector('.snippet-photo-tile .photo-blur-still, .photo-blur-still');
  const to = still?.complete ? containRect(still) : null;
  const visible = to && to.top < innerHeight && to.top + to.height > 0;
  fresh.classList.add('pl-arrive');
  if (visible && s.photo) {
    still.style.opacity = '0';
    const anim = flyPhoto(s.src, s.photo, to, { duration: 480 });
    (anim ? anim.finished : Promise.resolve()).finally(() => { still.style.opacity = ''; });
  }
  if (rich()) cards.filter(c => c !== fresh).slice(0, 6).forEach(c => {
    const old = s.before.get(cardKey(c)); if (old == null) return;
    const dy = old - c.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) c.animate([{ transform: `translate3d(0, ${dy}px, 0)` }, { transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.32,.72,0,1)' });
  });
}
// 触发：MutationObserver 观察到列表容器子节点变化 → playSaveToTop()
```

```css
P .snippet-item-card.pl-arrive { animation: pl-rise 220ms var(--pl-ease-out) 100ms backwards; --pl-cdy: 10px; }
```

表单弹层本身的关闭动画（Z3 / 现有 `closeModal`）照常进行，飞行克隆在最上层，看起来像照片"穿过"正在落下的弹层落进列表。表单里的缩略图用的是同一个地址，所以两端比例一致；如果保存过程中重新压缩了图片（地址变了），`sameRatio` 仍按两端 contain 框核对，不一致就只淡入。

### 10.7 M3 滚动分层淡入

```js
// motion-layers.js · M3
const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  let batch = 0;
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    const card = en.target; io.unobserve(card);
    const still = card.querySelector('.photo-blur-still');
    const go = () => { card.style.setProperty('--pl-lag', Math.min(batch++, 3) * 40 + 'ms'); card.classList.add('pl-in'); };
    still && !still.complete ? still.addEventListener('load', go, { once: true }) : go();
  }
}, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 }) : null;

function prepareLayers(list) {
  if (!io || !moving()) return;
  const vh = innerHeight;
  list.querySelectorAll('.snippet-item-card:not(.pl-pre)').forEach(card => {
    if (card.getBoundingClientRect().top < vh) return;               // 首屏走 S11 入场，不重复
    if (card.closest('#moment-album-layer')) return;                   // 图集一叠牌在自己的层里，不加分层
    card.classList.add('pl-pre', rich() ? 'pl-layers' : 'pl-flat');
    io.observe(card);
  });
}
```

```css
/* 分层：只动照片框里两张 img 的 opacity / transform，不碰框本身的任何尺寸与 object-fit */
P .snippet-item-card.pl-pre.pl-layers .photo-blur-pad { opacity: 0; }
P .snippet-item-card.pl-pre.pl-layers .photo-blur-still { opacity: 0; transform: scale(.985); }
P .snippet-item-card.pl-pre.pl-layers .snippet-item-meta,
P .snippet-item-card.pl-pre.pl-layers .snippet-item-meta ~ * { opacity: 0; transform: translate3d(0,6px,0); }   /* 核对：文字与按钮区 */
P .snippet-item-card.pl-pre.pl-flat { opacity: 0; }
P .snippet-item-card.pl-in.pl-layers .photo-blur-pad { opacity: var(--pl-pad-op, .5); transition: opacity 200ms var(--pl-ease-out) var(--pl-lag, 0ms); }   /* 核对：铺底原本的透明度 */
P .snippet-item-card.pl-in.pl-layers .photo-blur-still { opacity: 1; transform: none; transition: opacity 300ms var(--pl-ease-out) calc(var(--pl-lag, 0ms) + 60ms), transform 300ms var(--pl-ease-out) calc(var(--pl-lag, 0ms) + 60ms); }
P .snippet-item-card.pl-in.pl-layers .snippet-item-meta,
P .snippet-item-card.pl-in.pl-layers .snippet-item-meta ~ * { opacity: 1; transform: none; transition: opacity 220ms var(--pl-ease-out) calc(var(--pl-lag, 0ms) + 110ms), transform 220ms var(--pl-ease-out) calc(var(--pl-lag, 0ms) + 110ms); }
P .snippet-item-card.pl-in.pl-flat { opacity: 1; transition: opacity 220ms var(--pl-ease-out) var(--pl-lag, 0ms); }
```

`scale(.985 → 1)` 是等比缩放，作用在 contain 主图上，比例不变；主图不加 `will-change`（同屏可能有十几张，常驻图层会吃显存），过渡期间浏览器自动临时提层。动画结束后可以删掉 `pl-pre` / `pl-in`（`transitionend` 时），让卡片回到完全原样。

### 10.8 M4 长按浮起

```js
// motion-layers.js · M4
const LIFT_SKIP = 'button:not(.snippet-photo-tile), a, input, .snippet-video-segments, #moment-album-layer';
let hold = null, swallow = false;
document.addEventListener('pointerdown', e => {
  if (!on() || e.button > 0) return;
  const card = e.target.closest?.('.snippet-item-card');
  if (!card || e.target.closest(LIFT_SKIP)) return;
  hold = { card, x: e.clientX, y: e.clientY, timer: setTimeout(() => { card.classList.add('pl-lifted'); hold.lifted = true; }, 380) };
}, { passive: true });
document.addEventListener('pointermove', e => {
  if (hold && !hold.lifted && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8) dropHold();
}, { passive: true });
function dropHold() {
  if (!hold) return;
  clearTimeout(hold.timer);
  if (hold.lifted) { swallow = true; hold.card.classList.remove('pl-lifted'); setTimeout(() => { swallow = false; }, 400); }
  hold = null;
}
['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, dropHold, { passive: true }));
document.addEventListener('click', e => { if (swallow && e.target.closest?.('.snippet-item-card')) { e.preventDefault(); e.stopPropagation(); swallow = false; } }, true);
document.addEventListener('contextmenu', e => { if (hold?.lifted) e.preventDefault(); });
```

```css
P .snippet-item-card { -webkit-touch-callout: none; transition: transform 420ms var(--spring-release); }
P .snippet-item-card::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: var(--pl-shadow-float); opacity: 0; pointer-events: none; transition: opacity 260ms var(--pl-ease-out); }
P .snippet-item-card.pl-lifted { transform: translate3d(0,-4px,0) scale(1.012); transition: transform 180ms var(--pl-ease-out); }
P .snippet-item-card.pl-lifted::after { opacity: 1; }
:root[data-theme="plain"][data-pl-motion="none"] .snippet-item-card { transition: none; }
```

阴影放在 `::after` 上只补间 opacity，不补间 `box-shadow`。唯一"拦截"的是浮起后松手的那一次 click：长按是另一种手势，不应该顺带打开大图。如果用户不喜欢，删掉最后两行监听即可回到"长按只浮起"。

### 10.9 与第 9 节的衔接

- 新建 / 编辑随手拍的表单是底部弹层：Z3 跟手下拉、Z4 依次浮现照常生效；表单里有未保存的照片时，点遮罩走 Z8 轻推，不关闭（与现有"是否放弃"逻辑一致，只加动效）。
- 删除随手拍、移出私密空间、删除私密文件夹的确认走 Z5：居中卡片 + 轻缩放 + 模糊背景（rich）。
- 私密空间首页 → 文件夹详情不是 `openSubpage`，所以不触发 Z1 / Z2；右滑返回在私密空间里**只**映射到现有 `#vault-back-folders`（详情 → 文件夹列表），首页不响应右滑，避免误退出私密空间。

### 10.10 验收补充

1. 连续解锁 / 切出 / 回来 10 次：锁定时机与改动前完全一致（录屏比对），遮罩从未挡住锁屏输入超过 300ms。
2. 用 3:4、16:9、1:2.4 三种照片各建一个私密文件夹和一条随手拍：飞行过程逐帧截图，照片宽高比误差 ≤ 0.5%。
3. 6 倍 CPU 降速：解锁仪式、封面展开、保存飞入，连续长帧不超过 2 个；快速甩动随手拍列表 3 屏，不出现空白卡片超过 1 帧以上（未进入视口的卡片在 `pl-pre` 状态下照片仍按原规则加载）。
4. 减弱动态效果 / 低端机开关：本节各项按 10.1 三档表降级，锁定、解锁、保存流程结果不变。
5. 图集一叠牌（`#moment-album-layer`）：在牌上长按、拖动、轻点，行为与改动前一致；M3 / M4 的选择器只命中列表里的 `.snippet-item-card`。

---

*2026-10-13 · 方案与预览，不含运行代码改动。*
