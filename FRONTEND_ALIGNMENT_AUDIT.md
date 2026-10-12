# 暖色生活志 · 前端视觉对齐与排版体检报告（FRONTEND_ALIGNMENT_AUDIT）

> **体检说明**：本报告基于对 `styles.css`、`themes-plain.css`、`themes-plain-light.css`、`motion.js` 及各页面视图组件源码的逐行只读排查。  
> **排查准则**：所有类名与选择器严格以真实代码为准，杜绝编造；每项问题均指出确切文件路径、代码行号、现有视觉缺陷机理与精确改进代码。

---

## 一、体检问题汇总概览

| 编号 | 问题模块 | 核心选择器 | 问题特征 | 优先级 |
|---|---|---|---|---|
| **01** | 全局底栏 Dock | `.floating-dock`, `.phone-shell:has(.today-view) .floating-dock` | 页面切换时高度由 46px 跳跃至 64px；清简主题大圆角贴底被截断 | **P0** |
| **02** | 今日画页与格言 | `.today-photo-feature .washi-tape-note`, `.qa-card` | 每日鼓励格言被 `display:none` 屏蔽；存在 5.5px~8.5px 极端亚像素字号 | **P0** |
| **03** | 二级页导航顶栏 | `.subpage-nav-bar`, `.subpage-back-btn` | Sticky 顶栏 20px 圆角导致滚动漏底穿帮；返回文案长短不一导致居中漂移 | **P0** |
| **04** | 全屏照片与相框 | `.photo-viewer-meta`, `#photo-viewer-image`, `.polaroid-frame` | 长图注遮挡照片主体；首页拍立得相框被 72px 锁死导致比例压扁 | **P0** |
| **05** | 便当网格 | `.today-bento-grid`, `.bento-card`, `.bento-card::before` | 左右卡片内边距严重不对称；清简冷色底上残留 94px 暖棕色 A/B 水印 | **P1** |
| **06** | 账本布局 | `.ledger-overview-card`, `.ledger-accounts-track`, `.ledger-stream-sheet` | 资产总览卡、快捷记账条与账户轨道横向边距不一致，横滑边界卡死 | **P1** |
| **07** | 日记画报编辑台 | `.journal-hero-top-row`, `.journal-canvas-card`, `#journal-title-input` | 顶栏大日期与罗马徽章基线错位；卡片嵌套产生不同心圆角（20px 套 14px） | **P1** |
| **08** | 我的页面 KPI 栅格 | `.mine-kpi-row`, `.mine-kpi-card`, `.setting-item-row` | 4 宫格 KPI 卡片在 360px 窄屏挤压换行；设置行图标与副标题基线漂移 | **P1** |
| **09** | 今日天气与快捷区 | `.magazine-hero`, `.weather-box`, `.today-hero-actions` | 天气盒使用 `-14px` 极端负外边距导致左侧边缘超出规范，不对齐 | **P2** |
| **10** | 便当列表项基线 | `.bento-item-mini`, `.bento-item-copy`, `.bento-item-check` | 习惯项与待办项在多状态下的内边距、图标大小与勾选框对齐差异 | **P2** |

---

## 二、逐条对齐问题深度体检

---

### 问题 01 · 底栏 Dock 跨页面高度剧烈跳变与清简悬浮形态被屏幕截断

- **文件路径**：
  - `styles.css:3209-3212`
  - `styles.css:3381-3405`
  - `themes-plain.css:1504-1513`（源自 `themes-plain-light.css:87-96`）
- **CSS 选择器**：
  - `.floating-dock`
  - `.phone-shell:has(.today-view) .floating-dock`
  - `.phone-shell:has(.today-view) .dock-btn`
  - `:root[data-theme="plain"] .floating-dock`
- **现在错在哪**：
  1. **高度与字号跨页跳跃**：在 `styles.css:3209` 中，写死了 `.phone-shell:has(.today-view) .floating-dock { height: 46px; padding: 2px 6px max(2px, var(--app-safe-bottom)); }`，按钮高 `40px`，字号 `7px`。而切换到日记、账本、随手记等其他视图时，Dock 恢复为 `height: 64px`（`styles.css:3384`），按钮为 `54px`，字号为 `10px`。用户在首页和二级栏目之间切换时，底栏高度发生 18px 的剧烈纵向跳动，文字大小忽大忽小，视觉体验极不平稳。
  2. **悬浮圆角贴底被截断**：在 `themes-plain.css:1504` 中，清简主题给 `.floating-dock` 设置了 `border-radius: 24px !important; box-shadow: ...;`，意图将其做成漂浮的白卡胶囊；但未覆盖 `styles.css:3381` 里的 `bottom: 0; width: 100%;`。结果在清简主题下，一个具备 24px 四角大圆角的白卡硬生生满宽贴在屏幕最底端，左下角和右下角的 24px 弧度直接撞在屏幕边缘形成突兀的空洞缺口，且缺少悬浮底部留白，贴底不是贴底、悬浮不是悬浮。
- **精确改法建议**：
  1. 彻底移除 `styles.css:3209-3212` 中的 `.phone-shell:has(.today-view)` 特殊高度覆盖，底栏在所有页面统一遵循 `--dock-height`（64px 或自适应）；
  2. 在 `themes-plain-light.css`（及同步后的 `themes-plain.css`）中，为 `:root[data-theme="plain"] .floating-dock` 补齐悬浮几何定位：
     ```css
     :root[data-theme="plain"] .floating-dock {
       left: 50% !important;
       transform: translateX(-50%) !important;
       width: calc(100% - 24px) !important;
       max-width: 480px !important;
       bottom: max(10px, calc(var(--app-safe-bottom) + 6px)) !important;
       height: 60px !important;
       padding: 4px 6px !important;
       border-radius: 999px !important;
       border: 1px solid var(--pl-line) !important;
       box-shadow: 0 4px 16px rgba(46, 52, 59, 0.08), 0 1px 3px rgba(46, 52, 59, 0.04) !important;
     }
     :root[data-theme="plain"] .floating-dock .dock-btn {
       height: 50px !important;
       border-radius: 999px !important;
     }
     ```
- **优先级**：**P0**

---

### 问题 02 · 今日画页每日格言被强行隐藏与极端亚像素字号（5.5px~8.5px）基线漂移

- **文件路径**：
  - `styles.css:3204`
  - `styles.css:3170-3208`
  - `views/today.js:112`
  - `views/today.js:292-307`
- **CSS 选择器**：
  - `.today-photo-feature .washi-tape-note`
  - `.stack-indicator`
  - `.qa-card>span:last-child`
  - `#today-timeline-stream .life-stream-copy small`
- **现在错在哪**：
  1. **业务功能被样式屏蔽**：在 `views/today.js:112` 结构中渲染了 `<div class="washi-tape-note"><div class="washi-quote" id="motto-track">“...”</div></div>`，并在 JS 中专门编写了 `syncMottoMarquee` 跑马灯逻辑与 AI 每日鼓励注入。但在 `styles.css:3204` 中直接出现了 `.today-photo-feature .washi-tape-note { display:none; }`，导致该组件在界面上完全被吞掉，JS 计算等于空转。
  2. **大量不可读的亚像素字号**：在 `styles.css:3170-3208` 历史微调代码中，充斥着脱离设计规范的字号设定：
     - `.stack-indicator { font-size: 5.5px; }`
     - `.qa-card>span:last-child { font-size: 6.5px; }`
     - `.life-stream-copy small { font-size: 5.8px; }`
     - `.section-layer-hint { font-size: 6.5px; }`
     手机端浏览器（WebKit / Blink）存在默认最小字号安全限制（通常为 10px~12px）。写死 5.5px~6.5px 不仅在部分设备上发生强制放大导致的严重排版重叠，在未放大的设备上也细小如灰尘、完全无法辨识，破坏基线对齐。
- **精确改法建议**：
  1. 删除 `styles.css:3204` 的 `display:none`，恢复 `.washi-tape-note` 的流式展示；在清简主题下，将其重设为浅蓝温润胶囊题签：
     ```css
     :root[data-theme="plain"] .today-photo-feature .washi-tape-note {
       display: block !important;
       margin: 10px 0 0 !important;
       padding: 8px 12px !important;
       background: var(--pl-blue-soft) !important;
       border: 1px solid var(--pl-blue-line) !important;
       border-radius: 12px !important;
       box-shadow: none !important;
     }
     ```
  2. 清理 sub-10px 极端字号，将辅助文本基准线统一调整回 `10px` / `11px`，次级标题统一调整回 `12px`，严禁在移动端出现小于 10px 的字体声明。
- **优先级**：**P0**

---

### 问题 03 · 二级页 Sticky 导航栏 20px 圆角引发滚动穿帮与返回键宽度漂移

- **文件路径**：
  - `VISUAL_RULES.md:173-187`
  - `themes-plain.css:2360-2371`
  - `views/ledger.js:618`
- **CSS 选择器**：
  - `:root[data-theme="plain"] :is(#subpage-habit-detail, #subpage-timetable, #subpage-journal-reader, #subpage-ledger-detail, #subpage-focus-detail, #subpage-media-detail) .subpage-nav-bar`
  - `.subpage-nav-bar`
  - `.subpage-back-btn`
  - `.subpage-nav-title`
- **现在错在哪**：
  1. **吸顶漏底穿帮**：二级页导航栏 `.subpage-nav-bar` 具有 `position: sticky; top: 0; z-index: 20;` 属性。在 `themes-plain.css:2368` 中，为了去除直角，一条通用规则将其强行设置了 `border-radius: 20px !important;`。当用户在二级页向上滚动内容时，下方的文字和图片会从顶栏左上角和右上角两个 20px 的圆角空隙中露出来，形成极其业余的“滚动穿帮漏底”缺陷！
  2. **返回键文案过长导致标题轴线偏离**：规范（`VISUAL_RULES.md:177`）要求顶栏为三列网格：`grid-template-columns: minmax(74px,1fr) auto minmax(74px,1fr);`，中央标题依赖左右两侧宽度平衡来实现绝对居中。但在 `views/ledger.js:618` 中，返回按钮被写成了 `<span class="material-symbols-outlined">arrow_back</span>返回账本`（带图标共 5 个汉字长），实际宽度突破 95px，把居中标题硬生生向右挤压，造成视觉轴心明显向右漂移。
- **精确改法建议**：
  1. 修正吸顶圆角：吸顶状态下顶部两侧必须为直角，只允许底侧保留圆角或完全保持平直：
     ```css
     :root[data-theme="plain"] .subpage-nav-bar {
       border-radius: 0 0 16px 16px !important;
       border-top: 0 !important;
     }
     ```
  2. 严格按视觉规范收口返回键：在 `views/ledger.js:618` 中将返回文案纠正为标准的 `返回`（与日记、习惯详情保持一致），左右侧栏位锁定为相同尺寸基准。
- **优先级**：**P0**

---

### 问题 04 · 全屏照片查看器长图注遮盖画面与首页拍立得相框被压扁

- **文件路径**：
  - `views/common.js:182-184`
  - `styles.css:3195-3200`
  - `views/common.js:235-245`
- **CSS 选择器**：
  - `.photo-viewer-meta`
  - `.photo-viewer-stage`
  - `#photo-viewer-image`
  - `.photo-stack-container`
  - `.polaroid-frame`, `.polaroid-img`
- **现在错在哪**：
  1. **长图注侵入照片区域**：在 `views/common.js:183` 中，`.photo-viewer-meta` 包含照片时间和说明文字。当随手拍带有较长叙述（例如两三行文字）时，浮动在底部的图注面板会向上膨胀，直接遮挡照片下半部分，甚至与长图模式（`longMode`）下的手势交互发生点击穿透与视觉冲突，触碰了“硬性护栏 3：图注在照片下方，不压图”。
  2. **相框高度锁死导致比例变形**：在 `styles.css:3195` 中，`.photo-stack-container { height:72px; max-height:72px; }`，`.polaroid-img { height:68px; }`。拍立得标准画幅本为 4:5 或 1:1，此处被 72px 强行死锁后，使得整个照片故事区被压成了极度不自然的矮长条，相纸留白与文字挤作一团。
- **精确改法建议**：
  1. 遵循硬性护栏 2 和 3：
     - 重构全屏图片查看器布局：在非全屏长图态，图片容器与图注容器使用垂直 Flex 独立流式布局，图注严格在舞台下方，严禁使用覆盖式绝对定位。
     - 长图全屏上下滑动模式下，图注固定置于底部操作栏上方的独立半透明托盘中，并设置安全边距。
  2. 首页拍立得相框恢复最小体量：`.photo-stack-container` 高度恢复为自适应或 `min-height: 160px; height: clamp(160px, 24vh, 210px);`，相框保持优雅的比例，让配图完整居中舒展。
- **优先级**：**P0**

---

### 问题 05 · 便当网格（Bento Grid）不对称 Padding 与残存 94px 暖色 A/B 水印

- **文件路径**：
  - `styles.css:2760-2786`
  - `themes-plain.css:2202-2213`
  - `views/today.js:91-107`
- **CSS 选择器**：
  - `.today-bento-grid`
  - `.bento-card`
  - `.bento-card + .bento-card`
  - `.bento-card::before`
- **现在错在哪**：
  1. **不对称内边距造成的视觉失衡**：在 `styles.css:2762` 中，左侧习惯卡设置了 `padding: 13px 13px 8px 4px;`；而紧接着在 `2770-2772` 中，右侧待办卡设置了 `padding-right: 2px; padding-left: 16px; border-left: 1px solid rgba(65,57,45,.28);`。左右两张卡片无论是离容器外沿的边距，还是文字离中线的边距，差值高达 12px，造成明显的右重左轻与排版歪斜。
  2. **清简主题透出巨大暖色水印**：在 `styles.css:2774-2786` 中，为了旧纸质风格，通过伪元素注入了 94px 超大字母：
     - 左卡：`.bento-card::before { content:'A'; font-size:94px; color:rgba(137,101,30,.08); }`
     - 右卡：`.bento-card + .bento-card::before { content:'B'; color:rgba(182,64,39,.07); }`
     在清简主题下，整个网格被设为 `#F2F6FC` 冷蓝浅底，但生成器与浅色美化层均遗漏了对该伪元素的清理，导致冷色清简界面中赫然浮着两个暖棕色和砖红色的残影字母，破坏了纯净视觉。
- **精确改法建议**：
  1. 在 `themes-plain-light.css`（及同步后的 `themes-plain.css`）中，彻底关闭便当卡片水印：
     ```css
     :root[data-theme="plain"] .bento-card::before {
       content: none !important;
       display: none !important;
     }
     :root[data-theme="plain"] .bento-card + .bento-card {
       border-left: 1px solid var(--pl-line) !important;
     }
     ```
  2. 规范左右内边距：网格内卡片左右两边 padding 统一为 `12px`，消除 `16px vs 4px` 的严重偏斜。
- **优先级**：**P1**

---

### 问题 06 · 账本资产卡片、快捷记账条与账户轨道横向边距不对齐与截断

- **文件路径**：
  - `styles.css:2145-2184`
  - `styles.css:4580-4660`
  - `views/ledger.js:133-172`
- **CSS 选择器**：
  - `#screen-ledger .ledger-overview-card`
  - `#screen-ledger .ledger-quick-card`
  - `#screen-ledger .ledger-accounts-section`
  - `#screen-ledger .ledger-accounts-track`
  - `.account-mini-card`
- **现在错在哪**：
  1. **层叠卡片外边距不均**：在 `#screen-ledger` 下，资产总览卡 `.ledger-overview-card`、快捷记账条 `.ledger-quick-card` 与下方账户区 `.ledger-accounts-section` 属于连续出现的 3 个核心大卡片。但在 370px 及默认视口下：
     - 总览卡左右采用内缩 padding `14px`；
     - 快捷记账条是 `padding: 14px 13px`；
     - 下方的流式底纸 `.ledger-stream-sheet` 却出现了 `margin: 14px -16px -116px; padding: 17px 18px 116px;`。
     三者垂直层叠在一起，左右边缘各自缩进不一，未落在同一垂直参考线上。
  2. **横向滚动轨道边缘卡死**：`.ledger-accounts-track` 采用横向滚动（`overflow-x: auto`），但首个账户卡片和最后一个账户卡片与页面边缘紧密贴合，缺少安全回弹内边距（`scroll-padding`），滑到最右侧时卡片阴影被容器直接切断。
- **精确改法建议**：
  1. 建立统一的容器横向基准线：账本页所有卡片统一采用 `margin-inline: 0; padding: 16px;`，落入全局统一的安全网格；
  2. 修复账户横滑轨道：
     ```css
     .ledger-accounts-track {
       padding-inline: 16px;
       margin-inline: -16px;
       scroll-padding-inline: 16px;
     }
     ```
     确保滚动到首尾时与上方卡片两端完美对齐，且阴影自然发散不被切断。
- **优先级**：**P1**

---

### 问题 07 · 日记画报编辑台大日期与罗马徽章基线错位，及圆角不同心（20px 套 14px）

- **文件路径**：
  - `styles.css:4150-4220`
  - `themes-plain.css:2373-2376`
  - `views/journal.js:693-715`
- **CSS 选择器**：
  - `.journal-magazine-hero-box`
  - `.journal-hero-top-row`
  - `.journal-date-large`
  - `.journal-roman-badge`
  - `.journal-canvas-card`
  - `#journal-title-input`
- **现在错在哪**：
  1. **顶栏图文基线不一致**：在 `.journal-hero-top-row` 中，左侧大日期 `.journal-date-large`（中文文楷 18px）与右侧罗马日期徽章 `.journal-roman-badge`（Newsreader 等宽小写徽章）默认采用 `align-items: flex-start`，在不同手机宽度下因行高差异导致罗马徽章上下悬空漂移，两端未落在统一水平中轴线上。
  2. **圆角不同心嵌套割裂**：在清简主题下，外层卡片 `.journal-canvas-card` 统一被设为 `border-radius: 20px !important;`；而内部日记标题输入框 `#journal-title-input` 被单独设为 `border-radius: 14px !important;`（`themes-plain.css:2375`）。输入框四周内衬边距仅为 10px，由几何同心圆角法则（$R_{inner} = R_{outer} - padding = 20 - 10 = 10px$），14px 的内圆角比同心圆角过大，导致四个内角落出现肉眼可见的“胀出”突兀感。
- **精确改法建议**：
  1. `.journal-hero-top-row` 明确设置 `align-items: center`，左右基准线对齐；
  2. 优化日记画布输入框：在画报卡片内部，将标题输入框与正文多行文本框的独立边框与背景融合为整体画报纸张，输入框去除独立的圆角与描边，让标题与正文浑然一体，消除不同心视觉冲突。
- **优先级**：**P1**

---

### 问题 08 · 我的页面 4 宫格 KPI 卡片在 360px 窄屏挤压换行，与设置列表基线漂移

- **文件路径**：
  - `styles.css:5120-5200`
  - `views/mine.js:158-163`
  - `views/mine.js:165-195`
- **CSS 选择器**：
  - `.mine-kpi-row`
  - `.mine-kpi-card`
  - `.mine-kpi-num`
  - `.setting-item-row`
  - `.setting-icon-box`
- **现在错在哪**：
  1. **窄屏极端挤压**：`.mine-kpi-row` 声明为 `display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;`。在 360px 宽度手机上，每个格子仅分得约 `76px` 宽度。当用户专注时长达到 `123.4h` 或习惯打卡达到三位数时，数字与标签极易被迫拆行折断，甚至数字下半部被卡片下边缘切断。
  2. **设置行图标与箭头垂直漂移**：`.setting-item-row` 是列表项，左侧为 36px 图标 `.setting-icon-box`，右侧为 chevron 箭头。但因为中间文案有的单行、有的带有两行小字副标题（如“我的书影音与资料流”带副标题），采用纯 flex 默认对齐导致单行项与多行项的行高参差不齐（从 48px 到 68px 不等），右侧箭头在垂直方向上上下跳动，未能拉齐一条视线。
- **精确改法建议**：
  1. 针对 `.mine-kpi-row`，加入安全字号伸缩：数字使用 `font-size: clamp(16px, 4.5vw, 20px)`，在极窄视口下自动自适应，确保四格整齐单行展示；
  2. 规范设置行高度基准：
     ```css
     .setting-item-row {
       min-height: 56px;
       display: flex;
       align-items: center;
       justify-content: space-between;
     }
     ```
     确保不论副标题是否换行，左侧图标中心与右侧导航箭头中心始终绝对定锚在垂直正中。
- **优先级**：**P1**

---

### 问题 09 · 今日天气盒负边距越界与快捷操作区（Magazine Hero）内边距不对齐

- **文件路径**：
  - `styles.css:3095-3105`
  - `themes-plain.css:1516-1521`
  - `views/today.js:80-87`
- **CSS 选择器**：
  - `.magazine-hero`
  - `.weather-box`
  - `.today-hero-actions`
- **现在错在哪**：
  - 在 `styles.css:3096` 中，`.weather-box` 设置了 `margin-left: -14px; padding: 5px 10px 5px 14px;`，强行试图贴到屏幕最左侧。然而在 `themes-plain.css:1516` 下，天气卡被转为了独立的白卡，并添加了 `border-left: 3px solid var(--pl-blue)`。结果在清简主题下，由于负边距的存在，卡片的左侧蓝色描边直接顶出了视口或贴在屏幕边缘毫无间隙，而右侧的 3 个快捷按钮 `.today-hero-actions` 却具有正常右边距，整个 Magazine Hero 呈现左右极不对称的“左侧出格、右侧留白”病态。
- **精确改法建议**：
  - 在清简主题下取消 `.weather-box` 的负边距：
    ```css
    :root[data-theme="plain"] .weather-box {
      margin-left: 0 !important;
      padding: 10px 14px !important;
    }
    ```
    使天气卡与右侧动作组在 `.magazine-hero` 内平分秋色、左右对齐。
- **优先级**：**P2**

---

### 问题 10 · 便当列表项在完成/未完成态下的内边距、图标大小与勾选框对齐漂移

- **文件路径**：
  - `styles.css:1865-1888`
  - `styles.css:2802-2817`
  - `views/today.js:96`, `views/today.js:103`
- **CSS 选择器**：
  - `.bento-item-mini`
  - `.bento-item-mini.done`
  - `.bento-item-check`
  - `.habit-mini-row`
- **现在错在哪**：
  - 在 `styles.css:1865` 中，`.bento-item-mini` 设置为 `min-height: 31px; padding: 6.5px 8px;`。但在 `2802` 的覆盖规则中又被改写为 `min-height: 38px; padding: 7px 0;`。同时，待办卡项使用的是 `.bento-item-check`，而习惯卡项内部嵌套了复杂的 `.habit-progress` 轨道条。在多设备实测中，由于未统一 `align-items: center`，习惯名称的基线与待办名称的基线高度相差约 3px，且打卡完成态（`.done`）文字加粗（`font-weight: 700`）导致行内文字微跳动。
- **精确改法建议**：
  - 统一便当行高基准：固定 `min-height: 36px; padding: 6px 8px; align-items: center;`；完成态与未完成态保持统一的字符行高与间距，用色彩与勾选图标变化传达完成状态，避免字体粗细变化引起的文字微抖。
- **优先级**：**P2**

---
*文件生成于 2026-10-12 · 顾问报告*
