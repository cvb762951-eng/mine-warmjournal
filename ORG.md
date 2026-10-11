> **⚠️ 本文件已过时**：停留在旧产品「Mine」2.24.16 阶段。现状请读 `PROJECT_MAP.md` 与 `.workbuddy/memory/MEMORY.md`。

# Mine 组织架构与岗位分工

> 本文件定义软件的「公司式」分工：每个岗位由一个**长期对话**负责，持续维护、迭代自己负责的模块，而不是做完一个任务就散。
>
> 用法：
> - 开新对话时，把对应岗位的「岗位说明书」发给它（见 `JOB_PROMPTS.md` 的可复制版），它就长期负责这一块。
> - 有新需求时，按「任务路由规则」判断该交给哪个岗位对话。
> - 岗位之间通过**文件边界**隔离（互不重叠），通过 `registerHelper` / `callHelper` 协作。

---

## 一、组织架构总览

```
Mine 项目
├── 岗位① · 复盘与洞察负责人 ─── 回顾与洞察（统计/日历/分析/活动日志）
├── 岗位② · 核心平台负责人 ───── 地基（模型/存储/内核/通知/备份/个人中心/共享 + 原生代码）
├── 岗位③ · 记录与成长负责人 ─── 记录生活（今日/日记/随手记/习惯/待办/书影音）
├── 岗位④ · AI 智能负责人 ────── 让 AI 更懂用户（对话/记忆/模型/洞察/提醒文案）
├── 岗位⑤ · 专注与目标负责人 ─── 专注与目标（计时/番茄/倒数日/环境音）
└── 岗位⑥ · 产品探索负责人 ───── 创意与路线（陪用户头脑风暴/可行性评估/ROADMAP+IDEAS 文档，零代码权限）

构建 APK / 版本号 / 安装包 → 由主对话（协调者）直接负责，不设独立岗位。
```

---

## 二、文件归属总表

| 岗位 | 负责文件 |
|---|---|
| **① 复盘与洞察** | `views/stats.js`、`views/calendar.js`、`analytics.js`、`activity-log.js` |
| **② 核心平台** | `app.js`、`core.js`、`model.js`、`storage.js`、`backup.js`、`media-store.js`、`notifications.js`、`photo-utils.js`、`orientation.js`、`views/common.js`、`views/mine.js`、`service-worker.js`、`android/`（原生代码 + 构建配置）、`scripts/`、`package.json`、`capacitor.config.json` |
| **③ 记录与成长** | `views/today.js`、`views/journal.js`、`views/snippets.js`、`views/habits.js`、`views/media.js`、`views/ledger.js` |
| **④ AI 智能** | `ai/context.js`、`ai/provider.js`、`ai/memory.js`、`ai/generate.js`、`ai/insight.js`、`ai.js`、`views/ai.js` |
| **⑤ 专注与目标** | `views/focus.js`、`views/countdown.js`、`ambient.js` |
| **⑥ 产品探索** | `ROADMAP.md`、`IDEAS.md`（零代码权限，只写规划文档） |

> 每个文件只归一个岗位，岗位之间改的文件**永不重叠**，因此可以并行开发、互不冲突。
>
> 样式文件 `styles.css` / `performance.css` 是全局样式：各岗位可加**自己模块**的样式类（只加不改别人的），标清楚注释。
> 版本号（index.html `?v=`、build.gradle versionCode/versionName）由主对话统一维护。

---

## 三、岗位说明书

### 岗位① · 复盘与洞察负责人

- **职责**：统计页（周/月/总览）、日历页、数据洞察、活动日志。
- **负责文件**：`views/stats.js`、`views/calendar.js`、`analytics.js`、`activity-log.js`。
- **职责边界**：只改上面 4 个文件。周总结的 AI 文案由 AI 岗位提供（`aiPeriodSummary`），本岗位只负责展示和触发。
- **对外提供**：`focusInsights`、`mediaFocusSummary`、`rebuildActivityLog` 等。
- **当前待办**：暂无。

### 岗位② · 核心平台负责人

- **职责**：整个 App 的地基——数据模型（`makeDefaultState`/`migrateState`/实体工厂）、持久化（SQLite/localStorage + SECTIONS 白名单）、共享内核（`core.js`：工具/常量/状态/公共函数/注册表）、通知调度、备份/恢复、媒体外部化、个人中心（我的页/设置）、跨模块共享渲染（`views/common.js`）、入口协调器（`app.js`）、原生功能代码（`android/` 的 Java 插件/Manifest/res）及构建配置。
- **负责文件**：见上表岗位②。
- **职责边界**：这是**唯一**能改 `model.js`/`storage.js`/`core.js` 的岗位。其他岗位需要新增字段、新 helper、新共享函数时，都通过核心平台统一改，避免冲突。
- **对外提供**：所有 `core.js` 的导出 + 注册表（`registerView`/`registerBinder`/`registerSubmitHandler`/`registerHelper`）。
- **当前待办**：暂无。

### 岗位③ · 记录与成长负责人

- **职责**：用户记录生活的入口——今日概览、写日记（含照片、心情天气）、随手记/随手拍、习惯打卡、待办、书影音库。
- **负责文件**：`views/today.js`、`views/journal.js`、`views/snippets.js`、`views/habits.js`、`views/media.js`、`views/ledger.js`。
- **职责边界**：只改上面 5 个文件。需要 AI 能力时 `callHelper('aiChat' / 'rememberPhoto' / …)`；需要改数据模型字段时找核心平台。
- **对外提供**：日记/随手记/书影音的表单、照片上传等（已通过 `registerHelper` 暴露）。
- **当前待办**：首页 AI 洞察卡片（已完成）。

### 岗位④ · AI 智能负责人

- **职责**：让 AI 越来越懂用户——AI 对话、长期记忆体系、模型接入（可插拔 Provider）、AI 洞察/问候、每日提醒的 AI 文案、照片识别、周总结。
- **负责文件**：`ai/context.js`、`ai/provider.js`、`ai/memory.js`、`ai/generate.js`、`ai/insight.js`、`ai.js`、`views/ai.js`。
- **职责边界**：只改上面 7 个文件。要读取数据用 `buildAiContext` 和 `state`；不改 `model.js`/`storage.js`/`core.js`（归核心平台）。
- **对外提供**：`aiChat`、`aiDailyInsight`、`aiPeriodSummary`、`aiDescribeImage` 等（经 `ai.js` 转发层 export）。
- **当前待办**：任务 0/1/2A/2B/2C 全部完成。

### 岗位⑤ · 专注与目标负责人

- **职责**：专注计时（倒计时/正向/番茄循环）、专注项目、倒数日、环境音。
- **负责文件**：`views/focus.js`、`views/countdown.js`、`ambient.js`。
- **职责边界**：只改上面 3 个文件。通知（`notifications.js`）、数据模型（`model.js`）归核心平台。
- **对外提供**：`startTimer`、`completeTimer`、`projectSessionHistory` 等 helper。
- **当前待办**：屏幕方向切换 UI（沉浸态旋转按钮 + 计时设置项，依赖核心平台已交付的方向控制能力）。

### 岗位⑥ · 产品探索负责人

- **职责**：陪用户头脑风暴产品扩展可能性（天马行空欢迎）、可行性分层评估、想法收敛、维护 `IDEAS.md`（想法池）与 `ROADMAP.md`（路线图）、产出「待协调者路由」的清晰需求描述。
- **负责文件**：`ROADMAP.md`、`IDEAS.md`（**零代码权限**——不改任何代码/配置文件，不构建不打包）。
- **职责边界**：不直接向执行岗位（①-⑤）下发任务、不验收成果；需求落地一律经协调者路由。看代码可以，改代码不行。
- **与协调者分工**：协调者管执行精度（调研/路由/验收/构建/版本），岗位⑥管创意发散（探索/收敛/文档）。用户天马行空的想法先进岗位⑥，收敛成文档、用户拍板后才进入协调者流程。
- **当前待办**：创建 ROADMAP.md / IDEAS.md 骨架；整理项目已有功能清单入「已实现」区。

---

## 四、协作约定

1. **文件边界是硬规则**：任何岗位都不得改别的岗位的文件。确需跨边界改动，由协调者（主对话）转交给对应岗位。
2. **跨岗位调用**：一律走 `registerHelper(name, fn)` + `callHelper(name, …)`（`core.js` 提供），不直接 import 对方的内部函数（`ai.js` 转发层导出的对外接口除外）。
3. **数据字段变更**：新增 `settings` 字段或 `state` 顶层字段，只有核心平台能改 `model.js`（defaults + `migrateState`）和 `storage.js`（SECTIONS 白名单）。
4. **共享渲染函数**：多个页面共用的渲染函数放 `views/common.js`（归核心平台），各岗位 `import` 使用。
5. **验证与提交**：各岗位改完后用 `npx esbuild app.js --bundle` 确认零报错 + `git commit`（message 带岗位名）。**完整 APK 构建由主对话执行**，其他岗位不跑 gradle。
6. **下发任务格式**：主对话下发任务时，直接给「可复制发到对应岗位对话」的提示词，开头点明发给哪个岗位。

---

## 五、任务路由规则

新需求来了，按「主要改哪些文件」判断归属：

| 需求涉及 | 交给 |
|---|---|
| 统计/日历/复盘/活动 | ① 复盘与洞察 |
| 数据模型/存储/通知/备份/设置/共享内核/我的页/原生功能代码 | ② 核心平台 |
| 日记/随手记/习惯/待办/书影音/今日页/账本 | ③ 记录与成长 |
| AI 对话/记忆/模型/洞察/提醒文案 | ④ AI 智能 |
| 计时/番茄/倒数日/环境音 | ⑤ 专注与目标 |
| 产品创意/可行性探讨/路线图/想法收敛 | ⑥ 产品探索（先聊后路由） |
| 构建 APK/版本号/安装包 | 主对话直接执行 |

跨岗位的大需求，由协调者拆成子任务，分别下发到各岗位。

---

## 六、当前状态

> 完整交接信息见 `HANDOFF.md`（技术栈/坑/岗位/进度/如何开始）。

- **版本号**：2.24.16 / versionCode 76，git 工作区干净。
- **视觉方向（用户决定）**：iOS 浅色冷调 + 毛玻璃（2.24.3 液态玻璃尝试被整体 Revert，代码不保留）；设备骁龙 8 Gen 2 性能充足。
- **执行岗位（①-⑥）均已多轮产出并验收**：学习计时多层级分类、AI 仪表盘 + 每日小结、倒数日多卡片 + 展示开关、习惯栏轨道圆点、底部导航 7 Tab、资料库、AI 记忆体系、计时页结构重组、沉浸计时优化、屏幕方向控制、AI 陪伴三件套、账本（R4 预算/分类/照片/周期 + R5 多账户/转账/商户规则 + 记一笔提速）、图片账单入账（R4-2）、日历当日详情页、AI 聊天优化、R5 语音输入、随手拍多张（含视频/实况）、凌晨 2 点后台小结、R7 随机提醒 + AI 读日记增强、R6 布局+视觉全面重构、全局冷调收口（2.24.4）、自定义背景（2.24.3-5）、AI 聊天沉浸化（2.24.4-11）、AI 洞察增强（2.24.12-13）、习惯一键打卡/日记沉浸二级页（2.24.13）、通知测试与调度修复（2.24.14-15）、Mine 品牌启动动画（2.24.16）等。
- **当前待办**：无阻塞任务。新 agent 期间（2.24.3-16）各功能待真机复核。
