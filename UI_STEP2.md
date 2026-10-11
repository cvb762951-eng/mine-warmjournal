# UI_STEP2.md — 暖色生活志 Android 项目界面样式信息

> 本文只记录代码中实际存在的样式定义，不做设计评价、不提供优化建议。
> 所有未在代码中找到依据的项一律写「未找到」。
> 承接 `UI_STEP1.md`：本项目的界面是 **WebView + HTML/CSS/JS**，不是 Compose、也不是原生 XML 界面。
> 因此样式定义的**主战场是 CSS 文件**，Android 原生资源里几乎没有内容。

---

## 任务 1：颜色定义

### 1.1 Android 原生侧（几乎是空的）

| 文件路径 | 内容 | 颜色名 | 颜色值 |
|---|---|---|---|
| `android/app/src/main/res/values/colors.xml` | 仅 1 条 | `launch_background` | `#F2E8D8` |
| `android/app/src/main/res/values/ic_launcher_background.xml` | 仅 1 条 | `ic_launcher_background` | `#F2E8D8` |

`android/app/src/main/res/values/styles.xml` 中引用了 3 个颜色名，**但本 App 自己的资源目录里没有定义它们**：

| 引用处 | 颜色名 | 实际来源 | 值 |
|---|---|---|---|
| `styles.xml` 的 `AppTheme` | `@color/colorPrimary` | 来自 Capacitor 库 `node_modules/@capacitor/android/capacitor/src/main/res/values/colors.xml` | `#3F51B5` |
| 同上 | `@color/colorPrimaryDark` | 同上 | `#303F9F` |
| 同上 | `@color/colorAccent` | 同上 | `#FF4081` |

> 说明：这 3 个值是 Capacitor 模板自带的默认色，只挂在 `AppTheme` 上（该主题带 ActionBar）；实际启动用的是 `AppTheme.NoActionBarLaunch` → `AppTheme.NoActionBar`，没有 ActionBar，所以界面里看不到它们。

**未找到**：`Color.kt`、`Theme.kt`（本项目无 Kotlin 文件）。

### 1.2 界面层（真正的颜色定义所在）

颜色以 **CSS 变量（custom properties）** 的形式集中定义，共 **3 套主题**，每套都有**两套并行的令牌**：

- 第 1 套「页面本体令牌」：定义在 `styles.css` 的 `:root`
- 第 2 套「App 外壳令牌」`--warm-*`：定义在 `performance.css` 的独立 `:root`

---

#### 主题 A：classic / 米白（默认主题）

文件路径：`styles.css` 第 10 行起的 `:root` 块

**主要颜色值：**

| 变量名 | 颜色值 | 用途（代码注释中的语义） |
|---|---|---|
| `--canvas` | `#f5f1e8` | 页面底色（米白） |
| `--canvas-gradient` | `radial-gradient(ellipse at 50% 0%, #faf6ee 0%, #efeae0 100%)` | 页面底渐变 |
| `--sheet` | `#fdfcf9` | 纸张面 |
| `--sheet-gradient` | `linear-gradient(180deg, #ffffff 0%, #fdfbf7 100%)` | 纸张面渐变 |
| `--sheet-card` | `#ffffff` | 卡片底 |
| `--ink` | `#181614` | 正文 |
| `--ink-secondary` | `#4a453f` | 次级文字 |
| `--ink-muted` | `#878177` | 弱化文字 |
| `--sage-green` | `#7e9d86` | 主色（草木绿） |
| `--sage-green-dark` | `#4d7056` | 主色深 |
| `--sage-green-light` | `#edf5f0` | 主色浅底 |
| `--warm-beige` | `#eee7db` | 暖米 |
| `--warm-beige-light` | `#f8f4ec` | 暖米浅 |
| `--warm-taupe` | `#e5dfd2` | 暖灰褐 |
| `--terracotta` | `#c47e68` | 强调色（陶土） |
| `--terracotta-dark` | `#9c5540` | 陶土深 |
| `--terracotta-light` | `#fbf1ec` | 陶土浅底 |
| `--gold-accent` | `#c49a6c` | 金色强调 |
| `--gold-dark` | `#966f42` | 金色深 |
| `--gold-light` | `#fcf6ee` | 金色浅底 |
| `--dock-bg` | `rgba(255, 254, 250, 0.92)` | 底部导航底（半透明） |
| `--dock-border` | `rgba(255, 255, 255, 0.95)` | 底部导航描边 |
| `--card-border` | `1px solid rgba(220, 212, 198, 0.65)` | 卡片描边 |
| `--card-border-subtle` | `1px solid rgba(232, 226, 214, 0.85)` | 卡片细描边 |
| `--line` | `rgba(24, 22, 20, 0.08)` | 分隔线 |

**第二套外壳令牌（`performance.css` 第 3646 行）：**

| 变量名 | 颜色值 |
|---|---|
| `--warm-canvas` | `#f5f1e8` |
| `--warm-sheet` | `#fdfcf9` |
| `--warm-ink` | `#181614` |
| `--warm-ink-secondary` | `#4a453f` |
| `--warm-ink-muted` | `#878177` |
| `--warm-sage` | `#7e9d86` |
| `--warm-sage-strong` | `#4d7056` |
| `--warm-terracotta` | `#c47e68` |
| `--warm-card-border` | `1px solid rgba(220, 212, 198, .65)` |
| `--warm-dock-background` | `rgba(255,254,250,.92)` |

---

#### 主题 B：sunny / 暖阳

文件路径：`themes.css` 第 29 行起的 `:root[data-theme="sunny"]`

| 变量名 | 颜色值 |
|---|---|
| `--canvas` | `#fbf3e4` |
| `--canvas-gradient` | `radial-gradient(ellipse at 50% 0%, #fffcf2 0%, #f4e8cf 100%)` |
| `--sheet` | `#fffcf5` |
| `--sheet-card` | `#fffdf8` |
| `--ink` | `#3b2e1e` |
| `--ink-secondary` | `#6b5b47` |
| `--ink-muted` | `#9c8563` |
| `--sage-green` | `#8aa06b` |
| `--sage-green-dark` | `#5d7a43` |
| `--sage-green-light` | `#f2f5e4` |
| `--warm-beige` | `#f0e4ce` |
| `--warm-beige-light` | `#faf3e6` |
| `--warm-taupe` | `#e8dcc4` |
| `--terracotta` | `#c97a4e` |
| `--terracotta-dark` | `#a05a31` |
| `--terracotta-light` | `#fdf2e8` |
| `--gold-accent` | `#d0a04a` |
| `--gold-dark` | `#a2782c` |
| `--gold-light` | `#fdf6e6` |
| `--dock-bg` | `rgba(255, 252, 245, 0.92)` |
| `--card-border` | `1px solid rgba(223, 206, 175, 0.72)` |

第二套外壳令牌 `--warm-*` 同样在该块内（`themes.css` 第 89–101 行），与上表同色。

---

#### 主题 C：plain / 清简（静蓝）

文件路径：`themes.css` 第 292 行起的 `:root[data-theme="plain"]`

| 变量名 | 颜色值 | 说明 |
|---|---|---|
| `--plain-surface` | `#FFFFFF` | 撤图后垫底的白 |
| `--plain-canvas` | `#EAF0F8` | 页面底（冷雾蓝） |
| `--plain-ink-block` | `#55606C` | 深色强调块（石板灰蓝） |
| `--plain-sage-block` | `#4F76BD` | 强调块（主题蓝） |
| `--canvas` | `#EAF0F8` | 页面底 |
| `--sheet` | `#FFFFFF` | 纸张面 |
| `--sheet-card` | `#FFFFFF` | 卡片底 |
| `--ink` | `#2E343B` | 正文 |
| `--ink-secondary` | `#5A6572` | 次级文字 |
| `--ink-muted` | `#98A1AD` | 弱化文字 |
| `--sage-green` | `#4F76BD` | 主色（主题蓝） |
| `--sage-green-dark` | `#3D5F9E` | 主色深 |
| `--sage-green-light` | `rgba(79, 118, 189, 0.10)` | 主色浅底 |
| `--warm-beige` | `#EFF3F8` | 中性浅 |
| `--warm-taupe` | `#E1E7EF` | 中性中 |
| `--terracotta` | `#6E93D1` | 次强调（浅一档蓝） |
| `--terracotta-dark` | `#4F76BD` | 次强调深 |
| `--gold-accent` | `#6E93D1` | 金位改为蓝 |
| `--gold-dark` | `#4F76BD` | 同上 |
| `--dock-bg` | `rgba(255, 255, 255, 0.92)` | 底部导航底 |
| `--card-border` | `1px solid rgba(85, 96, 108, 0.08)` | 卡片描边 |
| `--border-cool` | `rgba(85, 96, 108, 0.14)` | 冷调描边 |
| `--shadow-glow-gold` | `0 0 24px rgba(79, 118, 189, 0.20)` | 蓝色光晕 |

第二套外壳令牌 `--warm-*` 同样在该块内（`themes.css` 第 369–381 行），`--warm-canvas: #EAF0F8`、`--warm-sage: #4F76BD`。

**另有一处主题蓝常量**：`themes.css` 第 306 行 `--plain-sage-block: #4F76BD`，供 `themes-plain.css`（由 `scripts/gen-plain-theme.mjs` 自动生成）在撤掉图片素材后垫纯色底使用。

---

#### 组件里直接写死的颜色（未走变量，节选）

这些是代码里明文写死的色值，换主题时由 `themes.css` 的「硬编码色值补丁」逐条覆盖。

| 位置 | 选择器 | 色值 |
|---|---|---|
| `styles.css` 第 2380–2384 行 | `.today-view` | `--editorial-ink:#20241f`、`--editorial-green:#173f31`、`--editorial-red:#b64027`、`--editorial-blue:#245b82`、`--editorial-brass:#8b651e` |
| `styles.css` 第 2374 行 | `#app:has(.today-view)` | `#f3eddf` |
| `styles.css` 第 7978 行 | `body:has(.mine-view) #app` | `#eee3ce` |
| `styles.css` 第 7986 行 | `.mine-view` | `color:#352f27` |
| `styles.css` 第 8112 行 | `.mine-section-heading` 左边框 | `#9f5038` |
| `performance.css` 第 3694 行 | `.cal-cell.active` | `#6b7c6e` |

---

## 任务 2：字体样式

### 2.1 字体文件位置

**未找到** `Type.kt`、`Typography.kt`。

`styles.xml`（`android/app/src/main/res/values/styles.xml`）中**没有任何字体定义**（无 `fontFamily`、无 `textAppearance`）。

字体全部由界面层的 `fonts.css` 定义。

### 2.2 字体族（font-family）清单

定义文件：`fonts.css`（`@font-face` 声明）与 `fonts/lxgw-wenkai-screen/` 下的 4 个子样式表（由 `fonts.css` 顶部 `@import` 引入）。

| 字体名 | 字重 | 文件来源 | 用途 |
|---|---|---|---|
| `Inter` | 400 / 500 / 600 / 700 / 800 | `fonts/inter-*.woff2` | 拉丁字母、数字（基础字体首位） |
| `Noto Sans SC` | 400 / 500 / 600 | `assets/fonts/noto-sc-*.woff2` | 中文无衬线回退 |
| `Noto Serif SC` | 400 / 500 / 600 | `assets/fonts/noto-sc-*.woff2`（与上同一批文件） | 中文衬线回退 |
| `Newsreader` | 400 / 400i / 500 / 600 / 600i / 700 / 800 | `fonts/newsreader-*.woff2` | 标题、数字、英文装饰（衬线） |
| `Caveat` | 600 / 700 | `fonts/caveat-*.woff2` | 手写批注 |
| `Zhi Mang Xing`（志莽行） | 400 | `fonts/zhi-mang-xing/ZhiMangXing-Regular.woff2` | 手写装饰 |
| `LXGW WenKai Screen R`（霞鹜文楷） | 400 | `fonts/lxgw-wenkai-screen/files/*.woff2`（分片 `unicode-range` 加载） | 中文正文主力 |
| `Material Symbols Outlined` | 400 | `fonts/ms-65.woff2` | 图标字体 |

### 2.3 全局基础字体

文件路径：`styles.css` 第 323 行

```
body, button, input, textarea, select → font-family: 'Inter', 'Noto Sans SC', sans-serif;
```

代码注释说明：中文回退到本地打包的 Noto Sans SC，确保 Windows 预览与 Android WebView 字形一致。

### 2.4 语义字体变量（两个）

文件路径：`styles.css` 第 8265 行的 `:root` 块

| 变量名 | 值 |
|---|---|
| `--paper-heading-font` | `'Newsreader','LXGW WenKai Screen R','Noto Serif SC',serif` |
| `--paper-body-font` | `'LXGW WenKai Screen R','Noto Serif SC',serif` |

### 2.5 主要字号与字重（首页 + 设置页实测值）

| 元素 | 选择器 | 字号 | 字重 | 字体族 | 文件路径（行号） |
|---|---|---|---|---|---|
| 顶栏标题 | `.app-header h1` | `19px` | `800` | `'Newsreader', serif` | `styles.css:422` |
| 顶栏小标 | `.app-header-text .eyebrow` | `11px` | `600` | 继承 | `performance.css:3208` |
| 首页刊头英文 | `.magazine-brand` | `14px` → 覆盖为 `8.5px` | `800` | `'Newsreader', serif` | `styles.css:1640` / `2477` |
| 首页年份 | `.magazine-title-date .date-year` | `13px` | `700` | `'Newsreader',Georgia,serif` | `styles.css:2494` |
| 首页大日期 | `.magazine-title-date .date-num` | `46px` | `500` | `'Newsreader',Georgia,serif` | `styles.css:2501` |
| 首页星期行 | `.magazine-title-date .date-name` | `11px` | `700` | `'Newsreader','LXGW WenKai',serif` | `styles.css:2518` |
| 首页题词 | `.editorial-cover-motto` | `12px` | `650` | 继承 | `styles.css:2528` |
| 首页天气温度 | `.weather-temp` | `32px` | `600` | `'Newsreader',Georgia,serif` | `styles.css:2578` |
| 首页分区标题 | `.section-layer-title` | `17.5px` | `800` | `'Newsreader', serif` | `styles.css:1836` |
| 习惯/待办卡标题 | `.bento-title` | `13px` | `800` | `'Newsreader', serif` | `styles.css:1860` |
| 卡内条目主文 | `.bento-item-copy strong` | `11px` | `700` | 继承 | `styles.css:1885` |
| 卡内条目副文 | `.bento-item-copy small` | `9px` | — | 继承 | `styles.css:1886` |
| 快捷入口文字 | `.qa-card > span:last-child` | `13px` | `750` | 继承 | `styles.css:1956` |
| 设置分组英文小标 | `.mine-section-heading small` | `8px`（`8px/1.1`） | `800` | `'Newsreader', serif` | `styles.css:8114` |
| 设置分组标题 | `.mine-section-heading h2` | `18px`（`18px/1.15`） | `600` | `'LXGW WenKai Screen R','Noto Serif SC',serif` | `styles.css:8115` |
| 设置行标题 | `.setting-row-title` | `13px` | `700` | `'Inter','Noto Sans SC',sans-serif` | `styles.css:1277` |
| 设置行副标题 | `.setting-row-subtitle` | `10px` | — | 继承 | `styles.css:1278` |
| 设置行标题（我的页覆盖） | `.mine-view .setting-row-title` | `13px` | `700` | `'LXGW WenKai Screen R','Noto Sans SC',sans-serif` | `styles.css:8141` |
| 设置行右侧状态 | `.mine-view .setting-row-right` | `10px` | — | 继承 | `styles.css:8143` |
| 用户名 | `.mine-view .profile-user-name` | `20px` | `600` | `'LXGW WenKai Screen R','Noto Serif SC',serif` | `styles.css:8058` |
| 主题选项标题 | `.theme-option strong` | `13px` | `700` | 继承 | `themes.css:232–235` |
| 主题选项说明 | `.theme-option small` | `10px` | — | 继承 | `themes.css:238–242` |
| 图标默认 | `.material-symbols-outlined` | `24px` | `normal` | `'Material Symbols Outlined'` | `fonts.css:582` |

### 2.6 全局行高

文件路径：`styles.css` 第 109–110 行

| 变量名 | 值 |
|---|---|
| `--body-copy-line-height` | `1.6` |
| `--support-copy-line-height` | `1.5` |

---

## 任务 3：圆角、间距与尺寸定义

### 3.1 Android 原生侧

**未找到**：`dimens.xml`（`android/app/src/main/res/` 下无任何 `<dimen>` 资源，已全目录检索）。

`android/app/src/main/res/layout/activity_main.xml` 与 `countdown_widget_layout.xml` 中只使用 `match_parent`，**未找到**具体尺寸数值。

### 3.2 界面层：圆角令牌（radius scale）

文件路径：`styles.css` 第 65–68 行（`performance.css` 第 21–24 行有一套同值定义，位于 `@layer module-legacy` 内）

| 变量名 | 值 |
|---|---|
| `--radius-sm` | `12px` |
| `--radius-md` | `18px` |
| `--radius-lg` | `24px` |
| `--radius-xl` | `32px` |

### 3.3 界面层：间距令牌

文件路径：`styles.css` 第 102–110 行

| 变量名 | 值 |
|---|---|
| `--space-page-inline` | `16px` |
| `--space-section-gap` | `20px` |
| `--space-card-padding` | `16px` |
| `--space-hero-padding` | `20px` |
| `--control-min-height` | `44px` |
| `--control-preferred-height` | `48px` |

### 3.4 界面层：布局与安全区尺寸

文件路径：`styles.css` 第 93–100 行

| 变量名 | 值 |
|---|---|
| `--app-max-width` | `567px` |
| `--app-safe-top` | `env(safe-area-inset-top, 0px)` |
| `--app-safe-bottom` | `env(safe-area-inset-bottom, 0px)` |
| `--app-content-top` | `max(16px, var(--app-safe-top))` |
| `--dock-height` | `72px` |
| `--dock-edge` | `max(16px, calc(var(--app-safe-bottom) + 10px))` |
| `--dock-clearance` | `calc(var(--dock-height) + var(--dock-edge) + 18px)` |

### 3.5 界面层：组件上实际使用的圆角值（非令牌，直接写死）

| 组件 | 圆角 | 文件路径 |
|---|---|---|
| `.bento-card`（首页习惯/待办卡） | `22px` | `styles.css:1851` |
| `.qa-card`（首页快捷入口） | `22px` | `styles.css:1952` |
| `.settings-group-card`（设置分组卡，基础定义） | `22px` | `styles.css:1224` |
| `.settings-group-card`（「我的」页覆盖） | `0` | `styles.css:8121` |
| `.setting-icon-box`（设置行图标框，基础定义） | `10px` | `styles.css:1265` |
| `.setting-icon-box`（「我的」页覆盖） | `0` | `styles.css:8135` |
| `.bento-item-mini`（卡内条目） | `10px` | `styles.css:1869` |
| `.stack-card`（首页照片堆叠卡） | `14px` | `styles.css:1907` |
| `.hero-icon-btn`（首页三个圆快捷按钮） | `50%`（圆形） | `styles.css:1729` |
| `.theme-option`（主题选项卡） | `var(--radius-sm)` = `12px` | `themes.css:218` |
| `.theme-swatch`（主题色板） | `7px` | `themes.css:249` |
| 胶囊类（徽章、筛选、标签） | `999px` | 多处，如 `styles.css:1862`、`1994` |

### 3.6 界面层：其他尺寸常量

| 项 | 值 | 文件路径 |
|---|---|---|
| 首页封面最小高度 | `240px` | `styles.css:2394` |
| 首页习惯/待办卡最小高度 | `168px` | `styles.css:1848` |
| 首页快捷入口卡最小高度 | `108px` | `styles.css:1952` |
| 首页照片堆叠区高度 | `clamp(210px,27vh,238px)`，上限 `238px` | `styles.css:1905` |
| 首页快捷圆按钮尺寸 | `40px × 40px` | `styles.css:1725` |
| 设置行最小高度 | `62px`（基础） / `66px`（「我的」页覆盖） | `styles.css:1231` / `8126` |
| 设置图标框尺寸 | `32px × 32px`（基础） / `38px × 38px`（「我的」页覆盖） | `styles.css:1262` / `8133` |
| 顶栏最小高度 | `calc(56px + var(--app-safe-top))` | `styles.css:407` |
| 顶栏三列栅格 | `40px 1fr 40px` | `styles.css:410` |
| 卡片描边宽度 | `1px`（见 1.2 的 `--card-border`） | `styles.css:38` |

---

## 任务 4：首页与设置页的样式

> 说明：**本项目没有独立的「设置页」**。设置内容全部位于「我的」页（代码文件 `views/mine.js`），
> 以 4 个分组卡片的形式呈现：我的生活 / 智能与提醒 / 外观与偏好 / 数据与安全。
> 已全仓检索，**未找到** `settings` 独立路由或独立设置页面。

### 4.1 首页（Today）

#### 背景颜色
- 页面滚动容器：`#app:has(.today-view)` → `background-color:#f3eddf` + `background-image:url('assets/today-paper-texture.png')`，尺寸 `512px 512px`
  - 文件路径：`styles.css` 第 2374 行
- 页面本体：`.today-view` → `background-color:rgba(246,241,231,.54)` + 同一张纸纹图（`512px 512px`）
  - 文件路径：`styles.css` 第 2379 行起（底色在第 2388 行）
- 首页封面左右分栏背景：`.magazine-header` → `background:rgba(247,242,232,.93)`
  - 文件路径：`styles.css` 第 2458 行
- 天气+快捷行容器 `.magazine-hero` → `background:rgba(247,242,232,.92)`
  - 文件路径：`styles.css` 第 2560 行
- 天气块本体 `.weather-box` → `background:var(--editorial-green)`（= `#173f31`），文字 `#fff8e9`
  - 文件路径：`styles.css` 第 2565 行起

#### 主要卡片样式

| 卡片 | 具体样式 | 文件路径 |
|---|---|---|
| 习惯卡 / 待办卡 `.bento-card` | `min-height:168px`；`padding:14px 16px`；`border:1px solid rgba(232,226,214,.85)`；`border-radius:22px`；`background:linear-gradient(180deg,#fff 0%,#faf8f4 100%)`；`box-shadow:var(--shadow-ambient), var(--inner-highlight)` | `styles.css:1846` |
| 卡内条目 `.bento-item-mini` | `min-height:31px`；`border-radius:10px`；`background:#f7f4ec`；完成后 `background:#edf5f0` | `styles.css:1864`、`1877` |
| 卡底操作区 `.bento-card-footer` | `border-top:1px dashed rgba(220,212,198,.70)` | `styles.css:1892` |
| 快捷入口 `.qa-card` | `min-height:108px`；`padding:17px 15px`；`border-radius:22px`；`background:linear-gradient(180deg,#fff,#fbf9f4)`；描边与阴影来自第 842 行的共享规则 | `styles.css:1952`、`838` |
| 照片堆叠卡 `.stack-card` | `border:1px solid rgba(0,0,0,.05)`；`border-radius:14px`；`background:#fff`；`box-shadow:0 14px 34px rgba(35,28,18,.12),0 2px 6px rgba(0,0,0,.04),inset 0 1px 0 rgba(255,255,255,.9)` | `styles.css:1907` |
| 共享卡片规则 | `.settings, .settings-group-card, .profile-hero-card, .mine-kpi-card, .bento-card, .qa-card, .data-health-banner, .stats-panel, .stats-summary-card, .ledger-account-card, .ai-overview-card` 统一 `border:var(--card-border-subtle)`；`background:var(--sheet-card)`；`box-shadow:var(--shadow-ambient), var(--inner-highlight)` | `styles.css:838` |

#### 按钮样式

| 按钮 | 具体样式 | 文件路径 |
|---|---|---|
| 三个圆快按钮 `.hero-icon-btn` | `40px×40px`；`border:1.5px solid rgba(255,255,255,.95)`；`border-radius:50%`；`background:#ffffff`；`box-shadow:0 3px 12px rgba(35,28,20,.06), inset 0 1px 1px #ffffff`；按下 `transform:scale(0.88)` | `styles.css:1723`、`1738` |
| └ 拍照键 `.btn-snap` | `background:var(--terracotta-light)`；`color:var(--terracotta)` | `styles.css:1740` |
| └ 记一笔键 `.btn-memo` | `background:var(--sage-green-light)`；`color:var(--sage-green)` | `styles.css:1741` |
| └ AI 键 `.btn-ai` | `background:var(--gold-light)`；`color:var(--gold-dark)` | `styles.css:1742` |
| 天气按钮 `.weather-box` | `padding:0`；`border:0`；`background:transparent`（后段覆盖为深绿底，见「背景颜色」） | `styles.css:1672` |
| 卡底按钮 `.bento-card-footer` | 无描边无底色；文字色 `var(--sage-green-dark)`，`10px/700` | `styles.css:1889` |
| 底部导航按钮 `.dock-btn`（首页态） | `height:60px`；`border:0`；`border-radius:0`；`color:#f1e6d1` | `styles.css:2963` |

#### 标题样式

| 标题 | 具体样式 | 文件路径 |
|---|---|---|
| 刊名 `Warm Life Journal` `.magazine-brand` | `8.5px`；`800`；`'Newsreader',serif`；`letter-spacing:.18em`；`text-transform:uppercase`；色 `var(--editorial-green)` | `styles.css:2477`、`1640` |
| 期号徽章 `.magazine-issue-badge` | `padding:2px 5px`；`border-radius:0`；`background:var(--editorial-red)`；`color:#fff8eb`；`7px` | `styles.css:2482` |
| 大日期 `.date-num` | `46px`；`500`；`letter-spacing:-.075em`；`line-height:.84`；色 `#171b18`；中间斜杠为朱红 `var(--editorial-red)` 并 `skew(-9deg)` | `styles.css:2501`、`2512` |
| 星期行 `.date-name` | `11px`；`700`；色 `var(--editorial-red)` | `styles.css:2518` |
| 题词 `.editorial-cover-motto` | `12px`；`650`；色 `#32342e`，下方带一条 `66px` 宽的装饰线 | `styles.css:2528`、`2537` |
| 分区标题 `.section-layer-title` | `17.5px`；`800`；`'Newsreader',serif` | `styles.css:1836` |
| 卡标题 `.bento-title` | `13px`；`800`；`'Newsreader',serif`；图标 `var(--sage-green)` | `styles.css:1860` |

#### 渐变 / 阴影 / 透明度

- **渐变**：
  - `.bento-card` → `linear-gradient(180deg,#fff 0%,#faf8f4 100%)`（`styles.css:1855`）
  - `.qa-card` → `linear-gradient(180deg,#fff,#fbf9f4)`（`styles.css:1952`）
  - 主题变量 `--canvas-gradient`（首页本身直接用纹理图，未使用该项，但该变量在主题中存在）
- **阴影**：
  - `--shadow-ambient`：`0 2px 10px rgba(32,24,15,.035), 0 10px 28px rgba(32,24,15,.045)`（`styles.css:34`）
  - `--shadow-elevated`：`0 4px 18px rgba(32,24,15,.05), 0 20px 44px rgba(32,24,15,.075)`（`styles.css:35`）
  - `--shadow-floating`：`0 18px 48px rgba(32,24,15,.13), 0 2px 8px rgba(0,0,0,.03)`（`styles.css:36`）
  - `--inner-highlight`：`inset 0 1px 0 rgba(255,255,255,.95), inset 0 -1px 0 rgba(0,0,0,.015)`（`styles.css:37`）
- **透明度**：
  - 页面本体 `rgba(246,241,231,.54)`（`styles.css:2386`）
  - 刊头 `rgba(247,242,232,.93)`（`styles.css:2458`）
  - 照片堆叠卡分层 `opacity:1 / .92 / .82`（`styles.css:1909-1911`）
  - `.today-editorial-cover::before` 撕纸条 `opacity:.78`（`styles.css:2410`）
  - `.magazine-header::after` 印章 `opacity:.34`（`styles.css:2468`）
- **毛玻璃**：首页当前生效的 `.magazine-hero` 已把 `backdrop-filter` 置为 `none`（`styles.css:2562`）。毛玻璃主要出现在其他位置（见 4.2 与全局令牌）。

---

### 4.2 设置（「我的」页）

#### 背景颜色
- 页面滚动容器：`body:has(.mine-view) #app` → `background-color:#eee3ce` + `background-image:url('assets/today-paper-texture.png')`，尺寸 `240px 240px`
  - 文件路径：`styles.css` 第 7978 行
- 页面本体：`.mine-view` → `background:transparent`（第 7993 行）；文字色 `#352f27`（第 7992 行）
  - 文件路径：`styles.css` 第 7986 行起
- 顶部装饰层：`.mine-view::before` → `height:min(350px,42dvh)`；`opacity:.38`；
  `background:url('assets/secondary-page-canvas-v1.png')` + 自上而下渐隐遮罩
  - 文件路径：`styles.css` 第 7995 行

#### 主要卡片样式
- 分组卡片 `.mine-view .settings-group-card`：
  - `margin:0`；`padding:7px 12px`；`border:0`；`border-radius:0`
  - `background:rgba(249,241,225,.82)` + `url('assets/secondary-content-paper-v1.png')` 铺满
  - `box-shadow:0 7px 19px rgba(55,43,28,.07)`
  - 文件路径：`styles.css` 第 8116 行
  - （基础定义在 `styles.css:1219`：`border-radius:22px`、`background:#ffffff`，被上面的「我的」页规则覆盖）
- 分组标题区 `.mine-section-heading`：`min-height:42px`；`padding:5px 10px 6px 12px`；`border-left:4px solid #9f5038`
  - 文件路径：`styles.css` 第 8106 行
- 设置行 `.mine-view .setting-item-row`：`min-height:66px`；`padding:11px 3px`；底部 `1px solid rgba(85,67,44,.13)` 分隔；`background:transparent`
  - 文件路径：`styles.css` 第 8125 行
- 图标框 `.mine-view .setting-icon-box`：`38px×38px`；`border:1px solid rgba(67,86,72,.12)`；`border-radius:0`；`background:rgba(235,230,215,.74)`；`color:#315b49`
  - 文件路径：`styles.css` 第 8132 行
  - 金色调变体 `.tone-gold`：`background:rgba(239,223,190,.58)`；`color:#916b35`（`styles.css:8139`）
- 数据健康条 `.mine-view .data-health-banner`：`min-height:66px`；`border:0`；`border-radius:0`；`background:transparent`；`box-shadow:none`
  - 警告态 `.warning`：`background:rgba(164,78,55,.06)`（`styles.css:8154`）

#### 按钮样式

| 按钮 | 具体样式 | 文件路径 |
|---|---|---|
| 设置行整行为按钮 `.setting-item-row` | `border:0`；`border-radius:0`；`background:transparent`；按下态 `background:rgba(49,91,73,.06)` | `styles.css:8125`、`8131` |
| 同上（基础定义） | `padding:12px 14px`；按下态 `background:#faf8f4`；底部分隔 `1px solid #f0ece4` | `styles.css:1229`、`1249`、`1235` |
| 主题选项按钮 `.theme-option` | `padding:12px 12px 11px`；`border:1.5px solid var(--border-cool)`；`border-radius:12px`；`background:var(--sheet-card)`；`box-shadow:var(--shadow-ambient)`；按下 `scale(.975)` | `themes.css:211`、`225` |
| 主题选项选中态 `.theme-option.active` | `border-color:var(--sage-green-dark)`；`box-shadow:var(--shadow-elevated), inset 0 0 0 1px var(--sage-green-light)`；`background:linear-gradient(180deg, var(--sage-green-light) 0%, var(--sheet-card) 62%)` | `themes.css:226` |

#### 标题样式

| 标题 | 具体样式 | 文件路径 |
|---|---|---|
| 分组英文小标 `.mine-section-heading small` | `8px/1.1`；`800`；`'Newsreader',serif`；`letter-spacing:.16em`；色 `#9c5a42` | `styles.css:8114` |
| 分组标题 `.mine-section-heading h2` | `18px/1.15`；`600`；`'LXGW WenKai Screen R','Noto Serif SC',serif`；色 `#243d33` | `styles.css:8115` |
| 设置行标题 `.mine-view .setting-row-title` | `13px`；`700`；`'LXGW WenKai Screen R','Noto Sans SC',sans-serif` | `styles.css:8141` |
| 设置行副标题 `.mine-view .setting-row-subtitle` | `10px`；色 `#776b5c`；`line-height:1.45` | `styles.css:8142` |
| 设置行右侧状态 `.mine-view .setting-row-right` | `10px`；`max-width:92px`；色 `#817465` | `styles.css:8143` |

#### 渐变 / 阴影 / 透明度
- **渐变**：`.mine-view::before` 的 `-webkit-mask-image:linear-gradient(to bottom,#000 0%,rgba(0,0,0,.72) 52%,transparent 100%)`（`styles.css:8004`，属于遮罩渐变，不是背景渐变）；主题选项选中态的 `linear-gradient(180deg, …)`（`themes.css:230`）
- **阴影**：`.mine-view .settings-group-card` → `0 7px 19px rgba(55,43,28,.07)`（`styles.css:8123`）
- **透明度**：`.mine-view::before` 的 `opacity:.38`（`styles.css:8002`）；分组卡底 `rgba(249,241,225,.82)`（`styles.css:8122`）；图标框 `rgba(235,230,215,.74)`（`styles.css:8136`）
- **毛玻璃**：设置页本身**未找到** `backdrop-filter` 定义。毛玻璃是全局壳层的特性，见下方令牌：

| 令牌 | 值 | 文件路径 |
|---|---|---|
| `--glass-blur` | `blur(28px)` | `styles.css:76` |
| `--glass-saturate` | `saturate(180%)` | `styles.css:77` |
| `--glass-bg` | `rgba(255,254,250,0.72)` | `styles.css:78` |
| `--glass-bg-main` | `rgba(255,255,255,0.60)` | `styles.css:79` |
| `--glass-bg-sub` | `rgba(255,255,255,0.68)` | `styles.css:80` |
| `--glass-blur-main` | `blur(24px)` | `styles.css:86` |
| `--glass-blur-sub` | `blur(18px)` | `styles.css:87` |

**顶栏毛玻璃的实际值**（`.app-header`，书影音/倒数日/资料库三个页面使用）：
`background:rgba(245,241,232,0.90)`；`border-bottom:1px solid rgba(220,212,198,0.60)`；
`backdrop-filter:blur(20px) saturate(160%)` —— `styles.css` 第 402 行起。

**底部导航毛玻璃**：`performance.css` 第 3666 行，`.floating-dock` 使用 `background:var(--warm-dock-background)` + `backdrop-filter:var(--warm-glass-blur)`（= `blur(28px)`）。

---

## 任务 5：深色模式与浅色模式

### 5.1 深色模式

**未找到。**

全仓检索以下关键词均无结果（已排除 `node_modules/`、打包产物与临时目录）：

- `prefers-color-scheme` —— 未找到
- `color-scheme: dark` —— 未找到
- `data-theme="dark"` / `dark-mode` / `darkMode` —— 未找到

三个主题的 `:root` 块里都**显式写死** `color-scheme: light`：

| 文件路径 | 内容 |
|---|---|
| `styles.css` 第 11 行 | `color-scheme: light;` |
| `themes.css` 第 30 行 | `:root[data-theme="sunny"]` 内 `color-scheme: light;` |
| `themes.css` 第 293 行 | `:root[data-theme="plain"]` 内 `color-scheme: light;` |

Android 侧同样只声明浅色状态栏图标：
`android/app/src/main/res/values/styles.xml` 中 `AppTheme.NoActionBar` 与 `AppTheme.NoActionBarLaunch` 均设置了
`android:windowLightStatusBar` = `true`，并注释说明「状态栏透明 + 深色图标，与页面浅色背景无缝衔接」。

> 项目内确实存在深色视觉**局部**（例如照片查看浮层、私密视频、记账沉浸页），但那是单点写死的深色，不是「深色模式」。

### 5.2 浅色模式（本项目实际采用的方案：多套浅色主题）

机制的权威说明写在 `themes.css` 第 1–20 行。

**实现位置：**

| 环节 | 文件路径 | 说明 |
|---|---|---|
| 主题清单与展示信息 | `model.js` 第 76–81 行 | `APP_THEMES = ['classic','sunny','plain']`；`THEME_META` 含 label / description / swatch |
| 默认主题 | `model.js` 第 104 行附近 → `state.settings.theme`；兜底 `classic` | 见 `model.js` 第 670 行 |
| 主题变量覆盖 | `themes.css` 第 29 行（sunny）、第 292 行（plain） | classic 不单独写覆盖块，直接用 `styles.css` 的 `:root` |
| 撤图重置层 | `themes-plain.css`（自动生成）、`themes-plain-light.css` | 仅作用于 `[data-theme="plain"]` |
| 主题写入 DOM | `core.js` 第 244 行的 `applyTheme()`（由第 264 行的 `render()` 调用） | 把 `state.settings.theme` 写到 `<html data-theme>`；`classic` 时移除该属性；同时同步 `<meta name="theme-color">` |
| 主题选择界面 | `views/mine.js` 的「主题与外观」入口；选项样式在 `themes.css` 第 206–260 行 | |

**三套主题的标签与色板**（`model.js` 第 77–81 行原文）：

| 主题 id | 标签 | 描述 | 色板（背景 / 卡片 / 强调） |
|---|---|---|---|
| `classic` | 米白 | 冷调纸感，克制清爽 | `#f5f1e8` / `#ffffff` / `#4d7056` |
| `sunny` | 暖阳 | 奶油暖黄，呼应「暖色」 | `#fbf3e4` / `#fffcf5` / `#b06a2c` |
| `plain` | 清简 | 纯色无纸纹，干净利落 | `#f5f6f7` / `#ffffff` / `#2f7d5f` |

**⚠️ 需要注意的事实**：上表中 `plain` 的色板（`#f5f6f7` / `#2f7d5f`）与 `themes.css` 第 292 行起的实际主题变量**不一致** —— 主题文件里 `plain` 的画布是 `#EAF0F8`、主色是 `#4F76BD`（蓝色系）。也就是主题选择界面上的色板小方块颜色，与主题实际生效的颜色对不上。此处只作为代码事实记录，不做评价。

**切换机制要点**（引自 `themes.css` 注释与代码）：

- 用 `:root[data-theme=x]` 而非 `[data-theme=x]`，是为了显式抬高一档权重，避免依赖加载顺序。
- 只覆盖「色彩与质感」，**不覆盖尺寸**（圆角、间距、动效、安全区与主题无关）。
- 每套主题必须**同时覆盖两套令牌**（页面本体 `--*` 与 App 外壳 `--warm-*`），只覆盖一套会「半新半旧」。
- 新增一个主题需要改三处：`model.js` 的 `APP_THEMES` + `THEME_META`、`themes.css` 覆盖块、`scripts/build-web.mjs` 白名单。

---

## 附：Android 原生界面层样式汇总（完整）

原生侧只有 1 个样式文件，内容如下（`android/app/src/main/res/values/styles.xml`）：

| 主题名 | 父主题 | 主要样式项 |
|---|---|---|
| `AppTheme` | `Theme.AppCompat.Light.DarkActionBar` | `colorPrimary` / `colorPrimaryDark` / `colorAccent`（取自 Capacitor 库） |
| `AppTheme.NoActionBar` | `Theme.AppCompat.DayNight.NoActionBar` | `windowActionBar:false`；`windowNoTitle:true`；`android:background:@null`；`android:statusBarColor:transparent`；`android:windowDrawsSystemBarBackgrounds:true`；`android:windowLightStatusBar:true` |
| `AppTheme.NoActionBarLaunch` | `Theme.SplashScreen` | `android:background:@drawable/splash`；`windowSplashScreenBackground:@color/launch_background`（`#F2E8D8`）；`windowSplashScreenAnimatedIcon:@drawable/splash_transparent_icon`；`windowSplashScreenAnimationDuration:0`；`postSplashScreenTheme:@style/AppTheme.NoActionBar`；状态栏透明 + 深色图标 |

`android/app/src/main/java/com/mine/focus/MainActivity.java` 第 74 行：
`WindowCompat.setDecorFitsSystemWindows(getWindow(), false)`（内容延伸到状态栏后，即 edge-to-edge）。

---

*本文档只记录代码事实，未做任何设计评价或优化建议。*
