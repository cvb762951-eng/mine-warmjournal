# UI_STEP1.md — 暖色生活志 Android 项目 UI 信息整理

> 说明：本文只根据仓库中的实际代码整理，不含设计评价与优化建议。
> 所有未在代码中找到依据的字段一律写「未找到」，不做推断。
> 涉及版本号、签名等敏感字段的取值不在本文输出范围内。

---

## 任务 1：UI 技术确认

### 参考文件
- `android/build.gradle`
- `android/app/build.gradle`
- `android/variables.gradle`
- `android/app/capacitor.build.gradle`
- `android/settings.gradle`
- `package.json`
- `capacitor.config.json`

### 1.1 项目主要使用 Kotlin 还是 Java？

**Java。**

- `android/app/src/main/java/com/mine/focus/` 下共 27 个 `.java` 文件，全部为 Java。
- 全仓库（排除 `build/` 产物）未找到任何 `.kt` 文件。
- `android/app/build.gradle` 中没有应用 `kotlin-android` 插件，`dependencies` 中没有 Kotlin 标准库。

### 1.2 界面使用 Jetpack Compose 还是 XML？

**都不是。App 的界面主体是网页（HTML / CSS / JavaScript），运行在 WebView 里。**

具体分层（这是理解本项目 UI 的关键）：

| 层 | 技术 | 说明 |
|---|---|---|
| 原生层 | Java + 一个 XML 布局 | 仅用于「装一个 WebView」和桌面小组件 |
| 界面层 | HTML + CSS + 原生 JS（ES Module） | 所有页面都在这里，由 Capacitor 打进安装包 |

证据：

- `android/app/src/main/res/layout/activity_main.xml`：只有一个 `CoordinatorLayout` 包着一个 `<WebView>`，没有任何可见控件。
- `android/app/src/main/java/com/mine/focus/MainActivity.java`：继承 `com.getcapacitor.BridgeActivity`（Capacitor 的 WebView 宿主），没有 `setContentView` 调用自定义界面。
- `capacitor.config.json`：`"webDir": "www"`，说明 Capacitor 把 `www/` 目录作为 App 界面打包。
- 全仓库未找到 `@Composable`、`setContent {`、`androidx.compose`、`NavHost` 等 Compose 痕迹。

原生 XML 布局清单（全部 2 个，都不是常规页面）：

| 文件 | 用途 |
|---|---|
| `android/app/src/main/res/layout/activity_main.xml` | WebView 容器 |
| `android/app/src/main/res/layout/countdown_widget_layout.xml` | 桌面「倒数日」小组件布局 |

### 1.3 是否使用 Material 3？

**否。**

- `android/app/build.gradle` 的 `dependencies` 中没有 `com.google.android.material:material`，也没有 `androidx.compose.material3`。
- 主题在 `android/app/src/main/res/values/styles.xml` 中定义，父主题是 `Theme.AppCompat.Light.DarkActionBar` / `Theme.AppCompat.DayNight.NoActionBar` / `Theme.SplashScreen`，属于 AppCompat，不是 Material 3。

补充（避免混淆）：界面层确实用了 **Material Symbols Outlined 图标字体**（`fonts.css` 中以 `@font-face` 本地引入，字体名 `'Material Symbols Outlined'`）。这是图标字体，只提供图标字形，**不是 Material 3 组件库**。

### 1.4 是否依赖第三方 UI 或动画库？

**原生 Android 侧：没有第三方 UI 库，也没有第三方动画库。**

`android/app/build.gradle` 的 `dependencies` 全部内容：

| 依赖 | 性质 |
|---|---|
| `androidx.appcompat:appcompat` | AndroidX 基础（AppCompat） |
| `androidx.coordinatorlayout:coordinatorlayout` | AndroidX 布局 |
| `androidx.core:core-splashscreen` | AndroidX 启动画面 |
| `:capacitor-android` | Capacitor 运行时 |
| `:capacitor-cordova-android-plugins` | Capacitor/Cordova 桥接 |
| `junit` / `androidx.test.ext:junit` / `androidx.test.espresso:espresso-core` | 测试用 |

Capacitor 插件（来自 `android/app/capacitor.build.gradle` 与 `android/app/src/main/assets/capacitor.plugins.json`，均为功能插件，非 UI 库）：

| 插件 | 用途 |
|---|---|
| `@capacitor-community/sqlite` | 本地数据库 |
| `@capacitor/camera` | 相机 |
| `@capacitor/filesystem` | 文件读写 |
| `@capacitor/geolocation` | 定位（天气用） |
| `@capacitor/local-notifications` | 本地通知 |
| `@capacitor/share` | 系统分享 |
| `@capawesome/capacitor-file-picker` | 文件选择 |

**界面层（网页部分）依赖（`package.json`）**：

| 依赖 | 性质 |
|---|---|
| `hls.js` | 视频流播放（功能库，非 UI / 动画库） |
| `esbuild`（devDependency） | 打包工具 |

**未找到**以下任何第三方 UI / 动画库的引用（已全仓检索，排除 `node_modules/`、打包产物与临时目录）：
GSAP、Framer Motion、anime.js、Lottie、Bootstrap、jQuery、Tailwind CSS（App 代码内）、Material Components。

> 备注：仓库中的 `.design-reference/` 目录下的 HTML 文件里出现过 Tailwind CDN 与 Google Fonts 外链，但那是**设计参考稿**，不参与 App 构建，也不被打包进安装包。App 本体所有样式表均为本地文件，`index.html` 只引 5 个本地 CSS，无任何 CDN 外链。

### 1.5 界面技术小结

| 问题 | 结论 |
|---|---|
| 主要语言 | Java |
| 界面技术 | WebView + HTML/CSS/JS（Capacitor 8.5.0） |
| Compose | 未找到 |
| Material 3 | 未找到 |
| 第三方 UI 库 | 未找到 |
| 第三方动画库 | 未找到 |
| Activity | 2 个（`MainActivity`、`OriginalMediaDeleteActivity`） |
| Fragment | 未找到 |
| AndroidX Navigation 组件 | 未找到 |

---

## 任务 2：主要页面

### 2.1 页面机制说明（先说清，否则下面的字段会看不懂）

本项目**没有 Fragment、没有 Composable、没有 NavHost**。页面系统是自研的：

- 页面注册：`core.js` 的 `registerView(route, fn)`，把页面函数登记进一个字典。
- 页面渲染：`render()` 把当前页面的 HTML 字符串塞进 `index.html` 里的 `<main id="app">`。
- 页面切换：`go(route)` / `goBack()`，改变 `state.route` 后整块重渲染（配合一段转场动画）。
- 详情页：不是独立页面，而是 `index.html` 中预设的 5 个覆盖层 `<div class="subpage-layer" id="subpage-xxx">`。
- 底部导航：`<nav class="floating-dock" id="floating-dock">`，由 `renderNav()` 生成。

所以下表里「界面技术」一律是网页（HTML/CSS/JS），「页面跳转方式」是自研路由，不是 Intent / NavHost。

### 2.2 主要页面清单（10 个）

#### 1
- **页面名称**：首页（Today）
- **功能**：启动后第一屏。包含首页封面（可自定义照片）、天气、随手拍、随手记、AI 助手入口、倒数日横幅、习惯卡片、待办卡片、当天活动时间线、今日画页（照片墙）、快捷入口宫格
- **代码文件**：`views/today.js`（页面本体）；外壳在 `index.html`
- **界面技术**：HTML / CSS / JS（WebView 内渲染）
- **主要组件**：`<section class="view today-view">`、封面块 `today-editorial-cover`、天气按钮 `weather-box`、快捷按钮 `hero-icon-btn`（拍照 / 记一笔 / AI 助手）、`today-bento-grid` 下的 `bento-card`（习惯 / 待办）、`timeline` 活动流、`photo-stack-container` 照片堆叠、`quick-access-grid` 的 `qa-card` 快捷入口、`<nav class="floating-dock">` 底部导航
- **页面跳转方式**：自研路由 `go(route)`；通过 `data-func-action` 属性分发到各功能

#### 2
- **页面名称**：日历（Calendar）
- **功能**：月历视图 + 选中日期的当天内容（专注记录、事件），可新增当天的会话/事件
- **代码文件**：`views/calendar.js`
- **界面技术**：HTML / CSS / JS
- **主要组件**：`<section class="view calendar-view cal-screen">`、月历网格、日期格子按钮、当天记录卡片（复用 `views/common.js` 的 `sessionCard` / `calendarEventCard`）、表单 `sessionForm`
- **页面跳转方式**：自研路由 `go('calendar', 日期)`；月份翻页为页内状态切换

#### 3
- **页面名称**：Moments / 随手拍（照片墙）
- **功能**：展示随手拍 / 随手记的照片墙，支持查看与滑动浏览
- **代码文件**：`views/snippets.js`
- **界面技术**：HTML / CSS / JS
- **主要组件**：`<section class="view snippets-view" id="screen-snippets">`、照片卡片、`photoViewer`（来自 `views/common.js`，全屏看图浮层）
- **页面跳转方式**：自研路由 `go('snippets')`；看图走 `photoViewer` 浮层

#### 4
- **页面名称**：日记（Journal）
- **功能**：日记列表与正文阅读、撰写、归档
- **代码文件**：`views/journal.js`
- **界面技术**：HTML / CSS / JS
- **主要组件**：`<section class="view journal-view" id="screen-journal">`、日记卡片、正文阅读覆盖层 `#subpage-journal-reader`、表单 `journalForm`
- **页面跳转方式**：自研路由 `go('journal')`；读全文进 `subpage-journal-reader` 覆盖层

#### 5
- **页面名称**：账本（Ledger）
- **功能**：收支记账、分类、预算
- **代码文件**：`views/ledger.js`
- **界面技术**：HTML / CSS / JS
- **主要组件**：`<section class="view ledger-view" id="screen-ledger">`、账目列表、详情覆盖层 `#subpage-ledger-detail`
- **页面跳转方式**：自研路由 `go('ledger')`；明细进 `subpage-ledger-detail` 覆盖层

#### 6
- **页面名称**：专注计时 / 专注工坊（Timer / Focus）
- **功能**：番茄钟、倒计时、正向秒表三种模式；环境声音混音；专注偏好设置；沉浸屏保；复盘报告
- **代码文件**：`views/focus.js`
- **界面技术**：HTML / CSS / JS（计时圆环用内联 SVG）
- **主要组件**：`<section class="view focus-view focus-screen">`、模式切换按钮组 `focus-mode-btn`、SVG 计时环 `timer-svg`（`timer-track` / `timer-progress`）、操作按钮（放弃 / 暂停 / 结算 / 屏保）、设置面板 `<details class="focus-stream-sheet">`、声景混音 `sound-mixer-box`
- **页面跳转方式**：自研路由 `go('focus')`；参数调整走浮层与折叠面板

#### 7
- **页面名称**：统计（Statistics）
- **功能**：周 / 月 / 年维度的专注统计；AI 周总结展示
- **代码文件**：`views/stats.js`
- **界面技术**：HTML / CSS / JS
- **主要组件**：`<section class="view stats-view stats-screen">`、周期切换、统计卡片、图表区
- **页面跳转方式**：自研路由 `go('statistics')`；周期切换为页内状态

#### 8
- **页面名称**：我的（Mine）
- **功能**：个人资料、头像、应用设置入口，以及进入书影音 / 倒数日 / 资料库 / 私密空间等二级页的入口
- **代码文件**：`views/mine.js`
- **界面技术**：HTML / CSS / JS
- **主要组件**：`<section class="view mine-view">`、`profile-avatar` 头像块、设置分组列表
- **页面跳转方式**：自研路由 `go('mine')`；二级入口跳 `library` / `countdown` / `documents` / `private-vault` 等

#### 9
- **页面名称**：AI 助手（AI）
- **功能**：与 AI 陪伴助手对话，支持流式回复
- **代码文件**：`views/ai.js`
- **界面技术**：HTML / CSS / JS
- **主要组件**：`<section class="view ai-view ai-companion-screen">`、消息气泡列表、输入框、发送按钮、`.app-header` 顶部标题（此路由下显示）
- **页面跳转方式**：自研路由 `go('ai')`；返回键做特殊拦截（`mine-system-back` 事件）

#### 10
- **页面名称**：书影音 / 媒体库（Library）
- **功能**：记录书、影、音等媒体条目与状态
- **代码文件**：`views/media.js`
- **界面技术**：HTML / CSS / JS
- **主要组件**：`<section class="view library-view" id="screen-library">`、媒体卡片 `mediaCard`（来自 `views/common.js`）、顶部返回栏 `.app-header`（此路由下显示）、表单 `mediaForm`
- **页面跳转方式**：自研路由 `go('library')`；返回走 `.app-header` 内的 `#library-back` 按钮

### 2.3 未纳入清单的页面（存在，但为二级页 / 特殊页）

以下路由同样在代码中注册，未计入上面 10 个：

| 路由 | 文件 | 说明 |
|---|---|---|
| `countdown` | `views/countdown.js` | 倒数日（也作为桌面小组件） |
| `documents` | `views/documents.js` | 资料库（文件管理） |
| `private-vault` | `views/private-vault.js` | 私密空间（照片 / 视频） |
| `password-vault` | `views/password-vault.js` | 密码本 |
| `taste` | `views/taste.js` | 味觉档案 |
| `local-gallery` | `views/local-gallery.js` | 本机相册播放器 |

另有一个非页面的原生界面：桌面「倒数日」小组件（`android/app/src/main/res/layout/countdown_widget_layout.xml` + `CountdownWidgetProvider.java`）。

### 2.4 未找到的字段

- Activity 形式的页面（除 `MainActivity` 与无界面的 `OriginalMediaDeleteActivity`）：**未找到**
- Fragment：**未找到**
- Composable（可组合函数）：**未找到**
- NavHost / Navigation 图：**未找到**

---

## 任务 3：首页入口

### 3.1 启动 Activity 的文件路径

`android/app/src/main/java/com/mine/focus/MainActivity.java`

补充依据（来自 `android/app/src/main/AndroidManifest.xml`）：

- `MainActivity` 声明了 `android.intent.action.MAIN` + `android.intent.category.LAUNCHER`，即启动入口。
- `android:launchMode="singleTask"`、`android:screenOrientation="portrait"`（竖屏锁定）、`android:windowSoftInputMode="adjustResize"`。
- 启动主题为 `@style/AppTheme.NoActionBarLaunch`（启动画面），加载完成后切换到 `@style/AppTheme.NoActionBar`。
- `MainActivity` 继承 `BridgeActivity`（Capacitor 宿主），本身不绘制界面。

第二个 Activity：

- `android/app/src/main/java/com/mine/focus/OriginalMediaDeleteActivity.java`，继承 `android.app.Activity`，主题为 `Theme.Translucent.NoTitleBar`，**没有布局、没有可见界面**，是一个「删除原始媒体」的辅助 Activity。

### 3.2 首页 UI 所在文件路径

- **首页内容（真正画出来的东西）**：`views/today.js`
- **页面外壳 / 容器**：`index.html`
- **样式**：`styles.css`（基础令牌）、`performance.css`（App 外壳与动效）、`themes.css` 与 `themes-plain.css`（主题皮肤）
- **打包后的真实入口**：`www/index.html`（由构建脚本产出，Capacitor 以 `www/` 为界面目录）
- **装机包内路径**：`android/app/src/main/assets/public/index.html`

### 3.3 首页使用的主要组件

> 说明：因为界面是网页，没有 Scaffold / Card / Button 这类框架组件，下面列出实际使用的 HTML 结构与 CSS 类。

| 区块 | 实际结构 |
|---|---|
| 页面根容器 | `<section class="view today-view">` |
| 杂志式封面 | `today-editorial-cover`、`magazine-header`、`editorial-hero-image`（可自定义照片） |
| 天气 | 按钮 `weather-box`（`#refresh-weather`，点击获取天气） |
| 快捷操作 | `hero-icon-btn`：`#btn-snap`（随手拍）、`#btn-memo`（随手记）、`#btn-ai`（AI 助手） |
| 倒数日横幅 | `#countdown-banner` / `countdown-empty-ticket` |
| 习惯卡片 | `bento-card habits-bento-card`、`bento-item-mini`、`habit-progress`（轨道 + 圆点）、`bento-card-footer` |
| 待办卡片 | `bento-card todos-bento-card`、`bento-item-mini`、`#new-todo`、`#open-todo-manager` |
| 活动时间线 | `today-life-stream-section`、`timeline`、`life-stream-card` |
| 今日画页（照片堆叠） | `today-photo-feature`、`photo-stack-container`、`polaroid-img`、`stack-dot`、`washi-tape-note` |
| 快捷入口宫格 | `quick-access-grid`、`qa-card`（由 `data-func-action` 驱动） |
| 底部导航 | `<nav class="floating-dock" id="floating-dock">` |
| 顶部标题栏 | `<header class="app-header" id="app-header">` |
| 图标 | Material Symbols Outlined 图标字体（`<span class="material-symbols-outlined">`） |

### 3.4 底部导航栏是否存在？

**存在。**

- 位置：`index.html` 第 31 行，`<nav class="floating-dock" id="floating-dock" aria-label="主导航"></nav>`
- 渲染逻辑：`core.js` 的 `renderNav()`，数据源为 `DOCK_TABS`
- 固定 5 项（等权，仅当前路由用胶囊强调）：

| 序号 | 路由 | 英文标签 | 图标 |
|---|---|---|---|
| 1 | `today` | Today | `draw` |
| 2 | `calendar` | Calendar | `calendar_month` |
| 3 | `snippets` | Moments | `auto_awesome_motion` |
| 4 | `journal` | Journal | `history_edu` |
| 5 | `ledger` | Ledger | `account_balance_wallet` |

- 代码中注释说明：旧的「自定义底部导航（排序 / 显隐）」数据仍保留在 model 里，但**不再参与渲染**。

### 3.5 顶部导航栏是否存在？

**存在这个元素，但默认隐藏；只在 3 个路由下显示。**

- 位置：`index.html` 第 29 行，`<header class="app-header" id="app-header" hidden></header>`
- 显隐逻辑（`core.js` 的 `render()`）：
  `appHeader.hidden = !['library', 'countdown', 'documents'].includes(state.route);`
- 结论：
  - `library`（书影音）、`countdown`（倒数日）、`documents`（资料库）：**显示**，形态是「返回按钮 + 标题 + 右侧操作按钮」
  - 其余路由（含首页）：**隐藏**
- 代码注释明确写道：全局顶栏已移除，各屏自带标题；只有原型中没有的这几个路由仍需要返回栏。

---

## 附：默认首页的确定依据

- `model.js` 中 `state` 默认值包含 `route: 'today'`。
- `core.js` 中 `resolveView(route)` 的兜底也是 `views.today`：`return views[route] || views.today;`
- 因此启动后 `MainActivity` → WebView 加载 `www/index.html` → 渲染 `today` 页面，即「首页」。

---

*本文档只记录代码事实，未做任何设计评价或优化建议。*
