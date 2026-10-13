> **⚠️ 本文件已过时**：停留在旧产品「Mine」2.24.16 阶段。现状请读 `PROJECT_MAP.md` 与 `.workbuddy/memory/MEMORY.md`。

# Mine 项目交接文档（WorkBuddy → OpenCode）

> 这份文档是**自包含的交接说明**，给 OpenCode 里的所有对话（协调者 + 5 个岗位）第一次接手时读。读完就能开工，不依赖任何外部记忆。

---

## 一、这是什么项目

**Mine** —— 个性化专注生活 App，Android 单机应用。

- 定位：越来越懂用户的「AI 朋友」+ 专注/记录/复盘工具。
- 技术栈：**Capacitor 8 + 原生 JavaScript（无框架、无 TS）+ esbuild 打包 + SQLite 持久化**。
- 数据默认只存本机；只有用户手动开启的 AI 功能才联网。

---

## 二、技术栈与构建

### 运行时
- Python / Node 用系统自带的即可（esbuild 走 `npx`）。

### 打包（核心命令）
```bash
# 1. 快速语法/打包验证（改完代码先跑这个，零报错才继续）
npx esbuild app.js --bundle --format=iife --global-name=Mine --outfile=www/app.js

# 2. 完整 web 构建（产出 www/）
node scripts/build-web.mjs

# 3. 同步 web 资源到 Android 工程
npx cap sync android

# 4. 构建 APK（只有协调者/主对话执行，岗位不要跑）
cd android && export JAVA_HOME="<你的 JDK 21 安装路径>" && ./gradlew assembleDebug
```

### APK 产物
- `android/app/build/outputs/apk/debug/app-debug.apk`
- 复制到根目录命名：`Mine-<版本号>-android-debug.apk`

---

## 三、核心约定（不踩坑，必读）

1. **持久化白名单 SECTIONS**：`storage.js` 里的 `SECTIONS` 数组决定原生 SQLite 存哪些字段。**新增 state 顶层字段必须同步加进 SECTIONS**，否则「浏览器正常、真机丢数据」。
2. **构建前停 gradle**：`cap sync` / `build-web` 偶发文件锁（safe-delete / ETIMEDOUT），先 `cd android && ./gradlew --stop` 再重试。
3. **版本号五处一起改**：`package.json`、`app-updater.js`、`android/app/build.gradle` 的 `versionCode`(+1) / `versionName`、`index.html` 的 `?v=`、`release-notes.js` 里当前 versionCode 的条目。`scripts/check-versions.mjs` 在打包前核对，漏改 `index.html` 或 `release-notes.js` 会直接失败。
4. **AI Provider 可插拔**：文字/视觉模型经 `ai/provider.js` 的 `PROVIDERS` 表路由（deepseek/qwen/moonshot/zhipu/openai/gemini/custom，都是 OpenAI 兼容 `/chat/completions`）。settings 存 `aiProvider/aiBaseUrl/aiModel/visionProvider/visionBaseUrl` + 两个 key。记忆 `aiMemory` 是纯文本、与模型解耦，**换模型不丢记忆**。
5. **配色**：莫兰迪暖色，sage 绿主色 `#8a9a8c`。
6. **用户偏好**：中文交流；要「越来越懂他的 AI 朋友」不是问答工具；涉及持久化/联网/通知必须真机验证；**先调研再动手**（新需求先用选择题式问题确认方向，再拆任务下发）。

---

## 四、模块化架构（改代码前必读）

- `core.js` 是共享内核：工具函数 + 常量 + 共享状态 + 公共函数 + **注册表**（`registerView`/`registerBinder`/`registerOnRender`/`registerSubmitHandler`/`registerHelper` + `callHelper`）。
- **ES Module `export let` 是只读导入**，导入方不能直接赋值。core.js 只导出 `state`/`cursor`/`selected`（配 `setState`/`setCursor`/`setSelected`/`setTick`）；模块自己的 UI 状态在模块内 `let` 声明。
- **app.js 是纯协调器**（171 行）：模块加载 import + 全局事件委托 + 导航绑定 + boot。9 个功能模块全在 `views/*.js`。
- **模块标准结构**（新模块照抄）：
  - `registerView('route', viewFn)` 注册视图
  - `registerBinder(bindXxx)` 注册绑定（**每个 view 模块都必须有，漏了会导致按钮点了没反应**——倒数日曾因此「新建/编辑无响应」）
  - `registerSubmitHandler(formId, handler)` 注册表单（handler 改 state，`return false` 表示自行 save）
  - `registerHelper(name, fn)` / `callHelper(name, …)` 跨模块调用（不直接 import 对方内部函数）
- ⚠️ **改完必做「使用 vs import」比对**：esbuild 对「未 import 但使用的标识符」静默当作全局变量，构建不报错，运行时才爆（曾因此真机白屏只剩底部导航栏）。
- ⚠️ **新增 view 模块必须同时在 app.js 加 `import './views/xxx.js'`**：否则 registerView 不执行、点入口 fallback 到今日页（资料库曾因此不加载）。
- ⚠️ **严禁重写现有 view 函数**：拆分/改模块时绝不能「简化重写」，必须原样搬运（focusView 曾因被重写导致类名与 CSS 全对不上）。

---

## 五、岗位分工（5 岗位 + 协调者）

每个岗位由**一个长期对话**负责，不是一次性任务对话。岗位之间文件永不重叠，可并行。

| 编号 | 岗位 | 负责文件 |
|---|---|---|
| ① | 复盘与洞察 | `views/stats.js`、`views/calendar.js`、`analytics.js`、`activity-log.js` |
| ② | 核心平台 | `app.js`、`core.js`、`model.js`、`storage.js`、`backup.js`、`media-store.js`、`notifications.js`、`photo-utils.js`、`views/common.js`、`views/mine.js`、`android/`（原生 + 构建配置）、`scripts/`、`package.json`、`capacitor.config.json` |
| ③ | 记录与成长 | `views/today.js`、`views/journal.js`、`views/snippets.js`、`views/habits.js`、`views/media.js` |
| ④ | AI 智能 | `ai/context.js`、`ai/provider.js`、`ai/memory.js`、`ai/generate.js`、`ai/insight.js`、`ai/find.js`、`ai.js`（转发层）、`views/ai.js` |
| ⑤ | 专注与目标 | `views/focus.js`、`views/countdown.js`、`ambient.js` |

**协调者（主对话）**：不写业务代码，职责是——
1. 把新需求按文件归属路由到对应岗位对话；
2. 验收岗位成果（核对改动点 + 构建 + commit）；
3. 构建 APK / 升版本号（机械低频操作，不设岗位）。

### 边界硬规则
- **只有核心平台②能改 `model.js`/`storage.js`/`core.js`**（新增字段/SECTIONS 白名单/共享函数都经它）。
- 样式 `styles.css` / `performance.css` 是全局的：各岗位可加**自己模块**的样式（只加不改别人的，标注释）。
- 跨岗位调用走 `registerHelper`/`callHelper`。
- 下发任务时，直接给「可复制发到对应岗位对话」的提示词，开头点明发给哪个岗位。

---

## 六、当前进度（截至 2026-08-16）

- **版本号**：2.24.16 / versionCode 76（新 agent 期间非逐 1 递增，以 build.gradle 为准）。
- **git 状态**：工作区干净，最新 commit `b490394`。
- **当前基线 commit 序列**（可回滚）：`d59e932`（模块化基线）→ … → `b490394`（2.24.16 启动动画收尾）。

### 已完成的完整功能（都可真机使用）
- 模块化重构（app.js 拆分 12 个 views 模块 + core.js 内核）
- AI 深度融入：可插拔 Provider、长期记忆体系、AI 仪表盘（总览/聊天双 Tab）、每日小结（进日历自动补前一天）、记忆注入
- 资料库（word/pdf 存储 + 文件夹树形归类 + AI 查找）
- 底部导航 7 tab、AI 对话纠正误区
- 学习计时多层级分类（考研→英语→背单词 任意嵌套 + 树形统计父级汇总 + 补录 + 最近项目 + 切页续计）
- 习惯栏「轨道+圆点」视觉（区间目标高亮理想区间）
- 首页倒数日多卡片 + 展示到首页开关 + 已过去「已经过去 xx 天」
- 全局排版优化（文字溢出省略号 + 数字等宽）
- 账本账户体系（多账户 + 转账 + 商户分类规则 + AI 账单分类）（2.24.4）
- 账本记一笔提速（快捷记账条 + 记住上次账户/分类/类型 + 表单金额前置 + 预算剩余提示 + 分类过滤兼容）（2.24.4-8）
- 自定义背景（可调毛玻璃 + 清晰度/模糊联动 + 显示方式开关 + 缩放/拖动 + 计时页/AI 页适配）（2.24.3-5）
- AI 聊天沉浸化（全屏聊天页 + 全局返回语义 + 回退/重试 + 输入栏避让 + header 无缝贴状态栏）（2.24.4-11）
- AI 洞察增强（每日滚动本周小结 + 洞察变更刷新 + 重新生成入口 + 生成时间显示）（2.24.12-13）
- 习惯一键打卡（左滑补满 + 已达标防累加 + 记录弹窗重排）（2.24.13）
- 日记沉浸式二级页（全屏 + 隐藏底部导航 + 状态栏安全区 + 冷调浅色卡片分层）（2.24.13）
- 通知能力（测试通知按钮 + 每日提醒调度 on+repeats + 调度失败日志）（2.24.14-15）
- Mine 品牌启动动画（圆点汇聚构成图标 → 真实自适应图标 → 深色冷调背景 132px）（2.24.16）
- Android adjustResize 键盘避让 + 自定义背景/状态栏无缝（2.24.5-16）

### 已知遗留（非阻塞，可选后续处理）
- `core.js` 的 `focusProjectName`、`common.js` 的 `activeFocusProject` 仍用旧的 `state.focusProjects`（学习计时重构后已无人关键依赖，保留作向后兼容）。
- `ensureDailySummary` 无「生成中」标记，快速切日期理论上可能重复调 AI（幂等，不影响正确性）。
- 液态玻璃：2.24.3 曾尝试接入但被整体 Revert（含 versionCode 回退），代码已不保留；视觉方向为毛玻璃。

---

## 七、如何在 OpenCode 里开始

1. **开 6 个对话**：1 个协调者 + 5 个岗位。
2. **协调者对话**：把下面这段发过去——
   ```
   你是「Mine」App 的协调者（主对话），不写业务代码，只做三件事：把需求路由给对应岗位、验收岗位成果、构建 APK/升版本号。
   项目根目录：<本项目的本地路径>
   先读：HANDOFF.md（交接文档）、ORG.md（组织架构）、PROJECT_MAP.md（项目地图）。
   工作方式：接到新需求先做「调研」（用选择题确认方向），再按 ORG.md 的任务路由规则拆成子任务，给每个岗位一段「可复制的提示词」；岗位完成后核对改动点 + 构建 + commit。构建 APK 的完整命令在 HANDOFF.md 第二节。
   ```
3. **5 个岗位对话**：把 `JOB_PROMPTS.md` 里对应岗位的代码块整段复制发过去（里面的「先读」已指向根目录文档）。
4. **日常协作**：岗位改完 `git commit`（message 带岗位名前缀）；协调者统一升版本号 + 打 APK。

---

## 八、文档索引

| 文档 | 用途 |
|---|---|
| `HANDOFF.md` | 本文件，交接总览（技术栈/坑/岗位/进度/如何开始） |
| `ORG.md` | 组织架构 + 文件归属 + 岗位说明书 + 任务路由规则 |
| `JOB_PROMPTS.md` | 5 个岗位的可复制开工提示词 |
| `PROJECT_MAP.md` | 项目地图（文件职责/函数行号/拆分模式/坑） |
| `AI_DEV_PLAN.md` + `AI_TASKS/` | AI 开发计划与任务卡（已全部完成，存档） |
