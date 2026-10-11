# UI_STEP3 — 动画与自定义 UI 组件盘点（只读）

> 生成时间：2026-10-10
> 方式：仅检索现有代码，未修改任何文件。
> 范围：`android/` 原生侧 + 网页层（HTML/CSS/JS，随包一起打进 WebView）。

---

## 前置说明（必读，否则任务 1 的结论看不懂）

承接 UI_STEP1/STEP2 的结论：**本项目的界面不是 Compose，也不是原生 XML 界面**，
真正的界面是网页（HTML/CSS/JS）跑在 WebView 里。因此：

- 任务 1 列的 13 个关键字**全部是 Jetpack Compose / Android 原生动画 API 的名字**。
- 这 13 个关键字在**原生侧命中数为 0**（`android/app/src` 排除 assets 后全为 0 条；
  同时全仓无 `.kt` 文件、无 Compose 依赖、`res/` 下无任何 `anim` 动画资源）。
- **但是**，本项目**并不是没有动画** —— 动画全部实现在网页层。
  为了不给你一个"什么都没有"的空答案，我对每个关键字都标注了**网页层是否存在等价实现**，
  并在 1.2 节列出网页层实际存在的动画功能。

> 一句话：**任务 1 问的是"Compose 的那套 API"，答案是"一处都没有"；
> 但项目确实有动画，只是换成了网页做法。**

---

## 任务 1：关键字检索结果

### 1.1 关键字命中表

| # | 关键字 | 原生侧命中 | 网页层是否有等价实现 | 等价实现说明 |
|---|---|---|---|---|
| 1 | `AnimatedVisibility` | 0（未找到） | 有（等价物） | 用 CSS 显隐 + 过渡：`.modal-layer.open`（`styles.css:623`）、`[hidden]` 切换。无同名 API |
| 2 | `AnimatedContent` | 0（未找到） | 有（等价物） | 页面切换动画 `@keyframes viewSlideFade`（`performance.css:130`）+ 页面入场 `pageSpringEnter`（`styles.css:477`） |
| 3 | `animateFloatAsState` | 0（未找到） | 未找到同名概念 | 网页用 CSS `transition` / `animation` 表达，无"状态驱动的补间数值"对象 |
| 4 | `animateDpAsState` | 0（未找到） | 未找到 | 同上；尺寸变化靠 CSS 过渡，无独立尺寸动画对象 |
| 5 | `updateTransition` | 0（未找到） | 有（等价物） | 多属性联动过渡靠同一条 CSS `transition` 声明（如按压态 `data-pressed`，`performance.css:4288`） |
| 6 | `Animatable` | 0（未找到） | 有（等价物） | Web Animations API：`element.animate(...)`（`motion.js:107/114/219/238`） |
| 7 | `spring` | 0（Compose API 未找到） | **有（等价物）** | 弹簧曲线令牌：`--spring-release` / `--spring-entrance`（`performance.css:4274` / `4276`，用 CSS `linear()` 写的阻尼弹簧）；JS 侧过冲曲线 `EASE.overshoot`（`motion.js:30`） |
| 8 | `tween` | 0（未找到） | 有（等价物） | CSS `transition: ... ease / cubic-bezier`；`--ease-spring`、`--ease-ios`、`--ease-smooth` 等曲线变量 |
| 9 | `graphicsLayer` | 0（未找到） | 有（等价物） | CSS `transform` / `will-change`（`performance.css:4305/4338/4404`、`styles.css:166`） |
| 10 | `blur` | 0（Compose `Modifier.blur` 未找到） | **有（等价物）** | CSS `backdrop-filter` 毛玻璃（`performance.css:110/111`，全局 `--glass-blur` / `--blur-sm`）；局部 `backdrop-filter:blur(12px)` 等 |
| 11 | `ModalBottomSheet` | 0（未找到） | 未找到同名物；有替代结构 | 没有"从底部升起的抽屉"，改为①**居中弹窗** `#modal-layer`（`index.html:38`，`styles.css:606`）②**右侧滑入二级页** `.subpage-layer`（`styles.css:734`） |
| 12 | `SharedTransition` | 0（Compose API 未找到） | **有（等价物）** | `motion.js` 的 `withSharedTransition`（`motion.js:142`）+ 浏览器 **View Transitions API**（`document.startViewTransition`，`motion.js:158`），不支持时回退手写 FLIP（`beginSharedElement`，`motion.js:186`） |
| 13 | `Lottie` | 0（未找到） | 未找到 | 全仓无 Lottie 依赖、无 `.json` 动画文件；动画均为手写 CSS 关键帧 / Web Animations |

**结论**：13 个关键字在本项目**一个都没有以同名形式出现**。其中 7 个在网页层有功能等价的实现（第 1/2/5/6/7/8/9/10/12 项），另外 4 个（第 3/4/11/13）连等价物都未找到（`ModalBottomSheet` 只有"替代结构"，不是同一种交互）。

### 1.2 网页层实际存在的动画功能（每个关键字对应最多 5 个代表）

本项目动画集中在一个核心模块 + 样式表关键帧里。以下为**实际存在的动画功能**，均带文件路径。

#### ① 曲线与时长令牌（对应 `spring` / `tween`）

| 功能名称 | 文件路径 | 作用于 |
|---|---|---|
| `EASE` 三档曲线（fluid / overshoot / settle） | `motion.js:28` | 所有 JS 驱动的过渡 |
| `DURATION` 四档时长（press 90 / morph 460 / shared 420 / staggerStep 34，单位 ms） | `motion.js:34` | 所有 JS 驱动的过渡 |
| `--spring-release`（阻尼弹簧，释放峰值约 3.4% 过冲） | `performance.css:4274` | 按压回弹、入场动画的时序函数 |
| `--spring-entrance` | `performance.css:4276` | `[data-stagger]` 交错入场 |
| `--ease-spring` / `--ease-ios` / `--ease-smooth` | `performance.css`（含 137/577/603 等处引用） | 各组件自身过渡 |

#### ② 容器变形（对应 `Animatable` / 状态过渡）

| 功能名称 | 文件路径 | 作用于 |
|---|---|---|
| `morphFrom(trigger, panel)` —— 从触发点"长"成弹窗面板（Material 容器变换思路） | `motion.js:65` | 由 `core.js:171` 的 `modal()` 统一调用 → **所有弹窗** |
| 面板内容延迟淡入 | `motion.js:107` | 弹窗面板内容 |

#### ③ 共享元素转场（对应关键 `SharedTransition`）

| 功能名称 | 文件路径 | 作用于 |
|---|---|---|
| `withSharedTransition()` —— View Transitions API 主路径 | `motion.js:142` | 见下方 4 个调用点 |
| `beginSharedElement()` —— 手写 FLIP 回退 | `motion.js:186` | View Transitions 不可用的内核 |
| 调用点①：日历当天照片 → 大图 | `views/calendar.js:238` | 日历 · 照片查看 |
| 调用点②：随手拍缩略图 → 大图 | `views/snippets.js:1392` | Moments · 照片灯箱 |
| 调用点③：统计页习惯行 → 习惯档案 | `views/stats.js:310` | 统计 · 习惯详情 |
| 调用点④：私密空间缩略图 → 查看 | `views/private-vault.js:1201` | 私密空间 · 媒体查看 |

> 即：**恰好 4 个共享元素转场**（与线上记录一致），JS 侧已做"名字唯一 + 用完清除"处理（`motion.js:140/156/171`）。

#### ④ 列表交错入场（对应 `AnimatedVisibility` / 状态过渡）

| 功能名称 | 文件路径 | 作用于 |
|---|---|---|
| `autoStagger(root)` —— 按元素类型分组写 `--stagger-index` | `motion.js:266` | 生活流、账本行、随手拍卡、私密条目、统计行、日历活动行、媒体卡、味觉卡、课程行、设置行（名单 `motion.js:252`） |
| `@keyframes cascade-in` | `performance.css:4307` | 上述交错入场的实际动画 |
| 落地态 `--stagger-index` 上限 7（`max` 默认） | `motion.js:280` | 超长列表不等待 |

#### ⑤ 按压物理（对应 `Animatable` + `spring`）

| 功能名称 | 文件路径 | 作用于 |
|---|---|---|
| `installPressFeedback()` —— 指针按下/抬起切换 `data-pressed` | `motion.js:327` | 全局挂载于 `app.js:216` |
| 按压两档选择器（小控件缩小 0.96+内阴影 / 大块仅轻微缩放） | `motion.js:296`（SOLID）/ `304`（LIGHT） | 见名单，覆盖按钮、卡片、列表行等 |
| 按压回弹时序 `transition-timing-function: var(--spring-release)` | `performance.css:4288/4297` | 所有 `[data-pressable]` 元素 |

#### ⑥ 持续性 / 循环动画（对应 `tween` 的重复播放）

> 以下均为 CSS 关键帧，最多列 5 个代表。

| 功能名称 | 文件路径 | 作用于 |
|---|---|---|
| `halo-spin` 8s 循环（旋转描边） | `performance.css:4403/4406` | 各页"主角卡"光环（`halo-card`，名单在 `core.js:299` `HALO_CARDS`，由 `motion.js` 注入的 `.halo-ring` 承载） |
| `halo-breathe` 5.6s 循环（呼吸背光） | `performance.css:4421/4426` | 同上，`halo-card::after` |
| `pomodoroPulse` 1.4s 循环 | `performance.css:577` | 专注计时 · 番茄钟 |
| `today-motto-marquee` 12s 循环（横向跑马灯） | `performance.css:2790` | 首页 · 每日格言 |
| `ai-stream-cursor` 闪烁 0.9s 循环 | `performance.css:3815` | AI 助手 · 流式输出光标 |

#### ⑦ 页面切换 / 启动动画

| 功能名称 | 文件路径 | 作用于 |
|---|---|---|
| `@keyframes viewSlideFade` | `performance.css:130` | 页面切换（`render(true)` 时给 `#app` 加 `nav-transition`） |
| `@keyframes pageSpringEnter` | `styles.css:477` | 页面入场 |
| `@keyframes tabSpringBounce` | `styles.css:553` | 导航切换弹跳 |
| `@keyframes launchMarkReveal` 等 5 个启动动画 | `styles.css:2263/2269-2273` | App 启动画面 |

#### ⑧ 可访问性与降级（贯穿全部动画）

| 功能名称 | 文件路径 | 说明 |
|---|---|---|
| `prefersReducedMotion()` | `motion.js:42` | 尊重系统"减弱动态效果" |
| `canAnimate()`（页面不在前台不动画） | `motion.js:46` | 省电，避免回前台看到补间 |
| `safely(run)` 统一 try/catch | `motion.js:49` | 动画失败只退化为"无动画"，不影响功能 |
| `@media (prefers-reduced-motion)` 里关掉 `halo-*` | `performance.css:4436` | 光环动画在减弱动效时停止 |

**任务 1 小结**：原生侧关键字命中 0；网页层实际有 **8 类动画机制**（曲线令牌 / 容器变形 / 共享元素转场 / 交错入场 / 按压物理 / 循环动画 / 页面切换 / 启动动画），全部登记在 `motion.js` + `performance.css` / `styles.css`。

---

## 任务 2：可复用的自定义 UI 组件

> 注意：本项目**没有 `@Composable` 函数**（全仓 0 处），**也没有原生自定义 View**
> （`android/app/src/main/java` 下无 `extends View / FrameLayout / LinearLayout / ImageView / TextView` 的类）。
> 因此下列"可复用组件"= 网页层的**可复用函数 / 结构片段 / 注入式效果**，
> 与 Compose 的 `@Composable` 是**不同层面的东西**，请勿等同理解。
> 共列 15 个，均带文件路径。

| # | 组件名称 | 所在文件 | 用途 |
|---|---|---|---|
| 1 | `modal(html, className)` | `core.js:155` | 通用居中弹窗。传入 HTML 字符串即弹出；自动套用容器变形、焦点管理、液态玻璃 |
| 2 | `confirmDelete(message, action)` | `core.js:192` | 二次确认弹窗（基于 `modal`），用于删除类危险操作 |
| 3 | `show(message)` / toast | `core.js:148`（样式 `styles.css:2307`） | 轻提示条，2.4 秒自动消失 |
| 4 | `emptyState(title, text)` | `core.js:197` | 空状态块（图标 + 标题 + 说明），多页复用 |
| 5 | `subpageHeader(title, options)` | `core.js:502` | 二级页通用头部（返回按钮 + 标题 + 可选右动作） |
| 6 | `openSubpage(id, html)` / `closeSubpage()` | `core.js:473` / `487` | 二级页覆盖层容器控制（`index.html:32-36` 共 5 个预设层） |
| 7 | `applyCustomBackground(...)` | `core.js:84` | 自定义背景（背景图 + 遮罩不透明度）应用器 |
| 8 | `photoViewer(photos, active, meta, options)` | `views/common.js:154` | 通用照片查看器（大图浏览 + 手势），被日历、随手拍、私密空间等复用 |
| 9 | `bindPhotoViewerGestures(...)` | `views/common.js:188` | 照片查看器的手势绑定（缩放/滑动） |
| 10 | `journalPhotos(photos, className)` | `views/common.js:106` | 日记照片墙片段（可指定额外类名复用） |
| 11 | `todoCard(todo)` | `views/common.js:71` | 待办卡片片段 |
| 12 | `sessionCard(session)` | `views/common.js:93` | 专注记录卡片片段 |
| 13 | `calendarEventCard(item)` | `views/common.js:130` | 日历事件卡片片段 |
| 14 | `mediaCard(entry)` / `snapshotCard(entry)` | `views/common.js:145` / `119` | 媒体卡 / 快照卡片段 |
| 15 | `liquidGlass(el, options)` | `liquid-glass.js:125` | 液态玻璃（毛玻璃 + 位移贴图）效果封装；由 `applyLiquidGlass()`（`core.js:349`）统一套到导航/顶栏/弹窗/hero 上 |

**补充（非"组件"但属可复用件）**：

- `micButtonHtml()`（`views/common.js:269`）—— 语音输入麦克风按钮片段。
- `activityItem(item)`（`views/common.js:84`）—— 活动时间线条目片段。
- `CountdownWidgetProvider`（`android/app/src/main/java/com/mine/focus/CountdownWidgetProvider.java`）—— **唯一与原生界面有关的可复用 UI 件**，是**桌面小组件**（`AppWidgetProvider` + `RemoteViews`），布局 `res/layout/countdown_widget_layout.xml`。它不是 App 内页面组件。

---

## 任务 3：底部导航栏 / 弹窗 / 卡片组件的实现文件

### 3.1 底部导航栏（"悬浮 Dock"）

| 项目 | 内容 |
|---|---|
| 是否存在 | **存在** |
| 挂载位置（HTML） | `index.html:31` → `<nav class="floating-dock" id="floating-dock">` |
| 渲染逻辑 | `core.js:373` `renderNav()`；由 `render()` 调用（`core.js:277`） |
| 导航项定义 | `core.js:365` `DOCK_TABS`，固定 5 项：Today / Calendar / Moments / Journal / Ledger |
| 样式 | `styles.css:486`（`.floating-dock`）；激活态 `#floating-dock .dock-btn.active` |
| 液态玻璃 | 属强玻璃目标之一：`core.js:343` `['.floating-dock', {strength:'strong'}]` |
| 备注 | 旧的「自定义底部导航排序 / 显隐」数据仍保留在数据模型中，但**不再参与渲染**（`core.js:364` 注释） |

### 3.2 弹窗

| 类型 | 实现文件 |
|---|---|
| 弹窗容器（HTML） | `index.html:38` → `<div class="modal-layer" id="modal-layer">` |
| 弹窗开关逻辑 | `core.js:155` `modal()` / `core.js:175` `closeModal()` / `core.js:188` `isModalOpen()` |
| 二次确认弹窗 | `core.js:192` `confirmDelete()` |
| 弹窗样式 | `styles.css:606`（`.modal-layer`）、`styles.css:625`（`.modal`）、`styles.css:623`（`.open` 态） |
| 容器变形动画 | `motion.js:65` `morphFrom()`，在 `core.js:171` 统一挂载 |
| 二级页覆盖层（另一种"弹层"） | 逻辑 `core.js:473/487`；样式 `styles.css:734`；结构 `index.html:32-36`（5 个 `subpage-layer`） |

> 说明：本项目**没有 BottomSheet / ModalBottomSheet 那种"底部抽屉"**。弹层只有两种：**居中弹窗** 与 **右侧滑入二级页**。

### 3.3 卡片组件

卡片不是封装好的"组件类"，而是**样式类 + 片段函数**的组合：

| 卡片 | 样式位置 | 片段/用法位置 |
|---|---|---|
| `bento-card`（首页 Bento 格） | `styles.css:842`（基础）、`styles.css:1846` |
| `qa-card`（快捷入口小卡） | `styles.css:843`、`styles.css:1952` |
| `stack-card`（照片堆叠卡） | `styles.css:1907` |
| `today-hero-card`（首页主角卡） | `styles.css:832`、`performance.css:2291`（玻璃版） |
| `weather-box`（天气块） | `styles.css:1672` |
| `todoCard` 片段 | — | `views/common.js:71` |
| `sessionCard` 片段 | — | `views/common.js:93` |
| `calendarEventCard` 片段 | — | `views/common.js:130` |
| `mediaCard` / `snapshotCard` 片段 | — | `views/common.js:145` / `119` |
| 交错入场名单（含各卡片类名） | `performance.css:4307`（cascade-in） | `motion.js:252` |

> 说明：卡片条目的"可复用性"体现在 **`views/common.js` 里的返回 HTML 字符串的函数**，
> 而不是像 Compose 那样有 `@Composable fun XxxCard()`。用哪个卡片由各页面的渲染函数自行拼装。

---

## 汇总：三处「未找到」的明确清单

以下内容**实际检索后确认不存在**（非漏查）：

- `@Composable` 标记的自定义函数：**未找到**（全仓 0 处）
- Android XML 自定义 View（继承 View/Fragment 等）：**未找到**
- `res/anim/` 或任何 Android 动画资源：**未找到**
- 原生侧动画 API 调用（`ObjectAnimator` / `ValueAnimator` / `overridePendingTransition` 等）：**未找到**
- Lottie 动画库与 `.json` 动画文件：**未找到**
- `ModalBottomSheet`（底部抽屉式弹层）：**未找到**（只有居中弹窗 + 侧滑二级页）
- 功能类名与文件：`AnimatedVisibility` / `AnimatedContent` / `animateFloatAsState` / `animateDpAsState` / `updateTransition` / `Animatable` / `graphicsLayer`：**均未找到**
