# 暖色生活志 · 项目地图

> **先读这份**。历史日志用于了解决策；版本、完成状态和验证结果以当前源码及本文件的最新核对为准。
>
> ⚠️ 根目录的 `HANDOFF.md` / `ORG.md` / `ROADMAP.md` / `IDEAS.md` /
> `AI_DEV_PLAN.md` / `AI_TASKS/` 全部停留在旧产品「Mine」2.24.16 阶段，**不要当现状依据**。

---

## 一、这是什么

**暖色生活志** —— 一个纯本地优先的个人生活档案 App：记录今天、管理账本、建立味觉记忆、
私密收纳、以及一个越来越懂你的 AI 伴侣。

- **App ID**：`com.mine.warmjournal`（**不是** `com.mine.focus`）
- **Android 安装标识**：`com.mine.warmjournal`；`com.mine.focus` 是代码命名空间，不是安装标识。保持现有签名与覆盖升级兼容。
- **定位**：手机端 App，本地优先；网页仅为真实交互预览。AI 有主动请求与已有定时提醒路径，自动记忆提炼需用户开启独立开关，默认关闭。

## 二、技术栈

| 项 | 值 |
|---|---|
| 框架 | Capacitor 8.5.0 + 原生 JavaScript ES Module（**无框架、无 TypeScript**） |
| 构建 | esbuild 打成单文件 IIFE（`www/app.js`，约 2.7MB） |
| 持久化 | 浏览器 `localStorage` / Android SQLite（`mine_warmjournal`） |
| 字体 | 霞鹜文楷（`fonts.css` + `assets/*.ttf`） |
| 视觉 | 纸张画报 + 经典 / 暖阳两套主题 |
| 产物 | Android debug APK |

- 安装包：`releases/暖色生活志-v1.0.64-覆盖升级.apk`，168018989字节；校验记录：`releases/暖色生活志-v1.0.64-校验.json`。418项测试及Gradle构建通过，254个包内资源与当前构建一致，签名与旧版一致；真机安装验收待补。

## 三、构建命令

```bash
# 1. 打包验证（改完代码先跑，零报错才继续）
npx esbuild app.js --bundle --format=iife --global-name=Mine --outfile=www/app.js

# 2. 完整 web 构建（产出 www/）
node scripts/build-web.mjs

# 3. 同步到 Android（★先停 gradle daemon，否则偶发 assets 被清空）
cd android && ./gradlew --stop && cd ..
npx cap sync android

# 4. 构建 APK（只有主对话执行）
cd android && ./gradlew assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

### 环境（本机实测，2026-10）

- `JAVA_HOME=C:\Program Files\Microsoft\jdk-21.0.12.8-hotspot`（**不是**旧文档里的 `.toolchains/jdk-21/`，那路径已不存在）
- `android/local.properties` 已配置 SDK：`<本机 Android SDK 路径>`（本机配置不提交）
- 历史构建产物存在，说明链路大概率仍通

### 版本号三处同步（改一处必须改三处）

| 位置 | 字段 |
|---|---|
| `index.html` | `app.js?v=1.0.64`（1 处） |
| `android/app/build.gradle` | `versionCode 65`（每次 +1）/ `versionName "1.0.64"` |
| `package.json` | `"version": "1.0.64"` |

**当前版本：1.0.64 / versionCode 65 / `SCHEMA_VERSION = 18`**

---

## 当前工作基线（2026-10-08，已生成覆盖升级包）

- 上次用户安装基线：1.0.63 / versionCode 64，提交 `06e5517`。本轮已完成1.0.64 / versionCode65打包，包含下面的功能与外观增量；没有对外发布或安装到手机。
- 本次范围：保存失败反馈、启动失败禁止写入、恢复原库保护；按入站时间保留七天的媒体回收站（含旧文件兼容）；AI 时间戳全链路保留与未知时间标记；自动记忆提炼默认关闭且支持手动提炼；非零余额拒绝归档、恢复账户、统一应收口径；商户规则管理。
- 用户最终明确要求“完成后直接打包”：已将源码、网页引用、Gradle及锁文件根版本同步为1.0.64，versionCode65。SCHEMA_VERSION仍为18，包名与安装签名不变。
- 后续视觉增量：日记浏览页修正之后，继续收口其他页面的暖色画报风格：表单/主题纸签、习惯年度图和选项、私密照片相框、味觉店铺卡、统计纸面和书影音操作。改动为 `styles.css`、`themes.css`、`views/stats.js`；派生数据显示校正涉及 `analytics.js`，新增2项测试在 `tests/analytics.test.mjs`。全量418项测试通过，过程和验收见 `design-qa.md`。全部已同步Android并进入1.0.64安装包。
- 修改文件：`app.js`、`core.js`、`storage.js`、`media-store.js`、`model.js`、`ai/generate.js`、`views/ai.js`、`views/ledger.js`、`views/mine.js`、`styles.css`；更新 `tests/ai-multimodal-config.test.mjs`、`tests/ai-time-awareness.test.mjs`、`tests/media-loss-guard.test.mjs`、`tests/video-player.test.mjs`，新增 `tests/completion-gaps.test.mjs`，并更新本项目地图。原有 `.genie` 未提交改动保留。
- 新行为回归集中在 `tests/completion-gaps.test.mjs`。真机强制关闭重启、覆盖升级、大容量恢复与原生文件移动仍待设备验收。
- 历史记录里的“商户规则未接线”和“备份验证未实现”不能继续作为当前待办：备份验证入口与旧测试报告已核对；商户规则读取已存在，本轮补齐管理。

## 四、架构：极薄的手写 IoC

没有框架、没有依赖注入。`core.js`是全部地基。

### 四个注册表

| 注册表 | 调用时机 | 陷阱 |
|---|---|---|
| `registerView(route, fn)` | 每次 `render()` 按 `state.route` 调用 | 新增 view 模块**必须**在 `app.js` 加 `import`，否则不加载 |
| `registerBinder(fn)` | **每次 `render()` 后全部遍历** | 必须用 `?.` 容错；漏注册 = 按钮点了没反应 |
| `registerSubmitHandler(formId, fn)` | 全局 submit 委托 | `return false` = 自行 save/closeModal/render |
| `registerHelper(name, fn)` / `callHelper` | 跨模块调用 | **名字拼错静默返回 undefined**，零告警 |

### 必须遵守的约定

1. `export let state` 是只读绑定，**只能用 `setState()` 写**。
2. 改完必做「使用 vs import」比对 —— esbuild 对「未 import 但使用的标识符」**静默当全局变量**，构建不报错、运行时才爆。
3. **严禁重写现有 view 函数** —— 拆分模块时必须原样搬运（曾因重写导致 class 名与 CSS 全对不上）。
4. 跨模块调用走 helper，不直接 import 对方内部函数（`ai.js` 转发层的对外接口除外）。

### 二级页（subpage）与返回优先级

```
分享弹窗 → 普通模态弹窗 → .subpage-layer.active → AI 聊天回总览 → goBack()
```

`index.html` 静态预置的 subpage id：`subpage-layer`、`subpage-focus-detail`、`subpage-habit-detail`、
`subpage-journal-reader`、`subpage-ledger-detail`、`subpage-media-detail`。

**`subpage-timetable` 是唯一例外** —— 不在 index.html 里，由 `views/timetable.js` 的 `paint()`
在运行时 `createElement` 创建并挂到 `.phone-shell`。**这是有意设计，不是 bug。**

---

## 五、持久化：第一大坑

双通道：浏览器 `localStorage`（key `mine-warmjournal-state-v1`）/ Android SQLite（`mine_warmjournal`，表 `state_sections`）。

### `SECTIONS` 白名单（`storage.js`，31 个分区）

决定哪些 state 顶层字段会存进真机数据库：

```
route, profile, settings, habits, todos, checks, habitCompletions, habitSkips,
events, sessions, snippets, tasteEntries, journals, dailySummaries,
weeklyInsightReports, media, countdowns, documentFolders, documents,
privateVault, passwordVault, aiMemory, aiHistory, focusProjects,
focusCategories, timer, meta, transactions, ledgerAccounts,
ledgerCategories, merchantCategoryRules
```

> **新增 state 顶层字段必须同步加进 `SECTIONS`**，否则「浏览器正常、真机丢数据」。
> 嵌套字段（如 `settings.timetable`）随父分区持久化，不需要单独加。

- 备份 `appId` 必须为 `com.mine.warmjournal`，其他 Mine 备份拒绝导入
- 升级前自动打「安全快照」（`mine-warmjournal-safety-snapshots-v1`，保留 5 份）

### AI Key 的特殊处理（2026-10 新增）

`settings.aiApiKey` **不再明文落库**：

- 内存里保持明文（50 处调用点同步读取，不能改成异步）
- 落库前由 `ai-key-vault.js` 换成 Keystore 密文，读库后解密
- 真机用 `SecureKeyStorePlugin`（Android Keystore AES-256-GCM，**免用户认证**）
- 浏览器预览用 Web Crypto 本地派生密钥
- **加密失败宁可整次不落库**，绝不让明文进库

> 为什么不用指纹密钥：AI 对话不能要求每次按指纹（`PasswordVaultNative` 的密钥是
> `setUserAuthenticationRequired(true)`，与本项目 AI 场景不兼容）。

---

## 六、AI 层的四条安全底线（**已被 10 个测试文件锁定，不要破坏**）

这是本项目最有价值的工程资产，成熟度远高于业务层：

1. **零自动联网** —— 进 AI 页 / 切 tab / 已有缓存 / 无 Key，全部 `requests === 0`。
   用户显式点击或发消息，以及已有凌晨任务和倒数日节点检查可以联网。聊天后额外记忆请求仅在用户明确打开 `aiConversationMemoryEnabled` 后发生，默认关闭，手动提炼按钮每次只请求一次。
2. **最小外发载荷** —— habit 不发 `name`、snippet 截 40 字、journal 截 120 字；
   账本**通用 context 只发定性分档**（很少/中等/偏多…），精确金额只在用户主动问钱时给。
3. **不伪造成功** —— 生成失败保持 `undefined`，不写占位、不写失败标记、不重试。
   周报只写 `status:'ready'`，失败只写模块级 UI 变量。
4. **丢弃模型夹带字段** —— 周报模型返回的 `kpis`/`flowScore`/`amount`/`duration` 一律丢弃，
   **KPI 全部本地算，AI 只写定性叙事**。

**AI 记忆**（`aiMemory`，纯文本）与 `settings.ai*` 物理隔离 → 换模型不丢记忆（有测试锁定）。

---

## 七、模块地图

### Web 层（根目录 + `views/`）

| 文件 | 职责 |
|---|---|
| `app.js` | 入口协调器：模块加载、全局事件委托、导航、boot |
| `core.js` | 共享内核：工具、常量、state、四个注册表、导航栈、subpage |
| `model.js` | 数据模型：`SCHEMA_VERSION`、defaults、`migrateState`、实体工厂、`ledgerSummary` |
| `storage.js` | 持久化：SQLite/localStorage 双通道、`SECTIONS`、AI Key 加解密收口、备份载荷 |
| `ai-key-vault.js` | AI Key 的 Keystore 加密 / Web Crypto 降级 |
| `timetable.js` | 课表数据层（`teachingWeek` / `coursesFor` / `weekDate`） |
| `analytics.js` | 纯数据聚合：周报唯一数据源（只聚合，不写状态、不生成文案） |
| `activity-log.js` | 从 9 个数据源实时重建事件流（不持久化） |
| `notifications.js` | 通知调度：每日提醒、随机提醒、计时闹铃 |
| `ambient.js` | 环境音：4 个真实 mp3 + 1 个程序化合成（壁炉） |
| `backup.js` | 端到端加密备份 / 恢复 |
| `ledger-taste-bridge.js` | 账本餐饮支出 → 询问生成味觉档案 |
| `views/*.js` | 16 个页面（见下） |

### 16 个页面（route）

| route | 页面 | DOCK |
|---|---|---|
| `today` | 今日概览（杂志封面 / 天气 / 课程 / 习惯 / 待办 / 流水） | ✅ |
| `calendar` | 日历 + 当日档案（Chronicle 日志） | ✅ |
| `snippets` | 随手记（Moments：随手拍 / 速记 / 书影音 / 实况） | ✅ |
| `journal` | 日记（画报式排版 + AI 起笔 + AI 结构化） | ✅ |
| `ledger` | 账本（账户 / 净资产 / 预算 / 转账 / 外借 / 平账） | ✅ |
| `statistics` | 统计（周/月/年 + 习惯热力图 + 成就徽章） | |
| `focus` | 专注（番茄/倒计时/秒表 + 分类树 + 白噪音混音） | |
| `countdown` | 倒数日（卡片 + 首页横幅 + 桌面 Widget） | |
| `taste` | 味觉档案（回购/避雷清单 + 店铺档案） | |
| `mine` | 我的（头像 / 累计 / 各项设置） | |
| `ai` | AI 伴侣（总览 / 聊天 / 周报 / 记忆库） | |
| `library` | 书影音库 | |
| `documents` | 资料库（word/pdf） | |
| `private-vault` | 私密空间 | |
| `password-vault` | 密码库 | |
| `local-gallery` | 本机相册播放器 | |

### Android 原生插件（`android/.../com/mine/focus/`）

| 插件 | 职责 |
|---|---|
| `SecureKeyStorePlugin` | **免认证** Keystore 通道，存 AI API Key |
| `AiStreamPlugin` | AI 流式对话（原生侧 SSE，绕开 WebView 流式问题） |
| `TimerAlarmPlugin` | 计时闹铃（AlarmManager，**不依赖通知权限**）+ 倒数日 Widget |
| `DailySummaryPlugin` | 凌晨 02:00 一次性 alarm |
| `VoiceInputPlugin` | Android SpeechRecognizer |
| `OrientationPlugin` | 计时页横竖屏锁定 |
| `SystemBackPlugin` | 返回键消费 |
| `IncomingSharePlugin` | 系统分享接收 |
| `PasswordVaultNativePlugin` | 指纹解锁（Keystore + BiometricPrompt），scope 区分 private/password |
| `NativeMediaStorePlugin` / `LocalGalleryPlugin` | 媒体存储 / 本地相册 |
| `StreamingBackupPlugin` / `BackupChunkCrypto` / `BackupExportService` | 大容量流式加解密备份 |
| `FocusTimerService` / `TimerAlarmService` | 前台服务，防被杀 |

---

## 八、测试

- `tests/*.test.mjs`，**64 个文件**，`node tests/xxx.test.mjs` 直接跑（Node 原生 test runner）
- 质量分层明显：
  - **AI 层 10 个文件约 80 条**严密行为断言（零网络边界 / 最小载荷 / 不伪造成功）
  - **业务层大量 `assert.match(source, /正则/)`** 源码字符串断言 —— 改个变量名就红，且**检测不到死代码**
  - 计时器、通知、习惯联动、flowScore 行为测试仍然缺失

新增测试时优先写**行为断言**。前轮新增16项、本轮新增2项行为回归；全量 418 项通过，本地 web build 通过，三个手机尺寸的规则页与关键入口实际点击、重载持久化已验证（隔离预览，AI 回复使用测试替身，未连接真实提供商）。

### 定位历史问题的手法

某个测试失败时，先确认是不是自己造成的：

```bash
git stash push -q <你改过的文件>
node tests/xxx.test.mjs && echo "通过" || echo "失败 → 预先存在的问题"
git stash pop -q
```

这招排除过多次误判，比反复读代码快得多。

---

## 九、协作

- 用户用「公司式分工」管理项目：多岗位各一个长期对话，主对话协调与验收
- 当前会话身份：📊 复盘与洞察负责人（岗位 4），但用户已要求「接手整个项目」，按通盘理解工作
- 正文先说明使用结果；必要证据用文件链接提供，按用户最新 AGENTS.md 执行。
- 改完跑 `npx esbuild` 验证 + 跑全量测试；**完整 APK 构建只在用户明确要求时执行**
- 项目记忆只在用户明确要求更新时写入；日常交付更新项目文档与代码。

---

*最后核实：2026-10-08。当前版本与安装包已核对；本轮增量通过行为回归、全量测试、本地构建和隔离手机预览。历史章节中的缺失测试与旧架构描述仍应结合当前源码核对，不能作为完整真机验收证明。*
