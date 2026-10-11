# Mine · 暖色生活志核心平台契约

本文件是后续岗位接入暖色生活志的唯一共享数据与跨模块契约。原 Mine 的存档、数据库、备份和媒体引用不属于本 App，禁止读取或迁移。

## 身份与持久化

- Capacitor App ID：`com.mine.warmjournal`；正式 Android `applicationId` 与版本号由协调者统一处理。
- 浏览器状态：`mine-warmjournal-state-v1`。
- 浏览器安全快照：`mine-warmjournal-safety-snapshots-v1`。
- Android SQLite：`mine_warmjournal`，按 `storage.js` 的 `SECTIONS` 白名单逐段保存。
- 备份 `appId` 必须为 `com.mine.warmjournal`；其他 Mine 备份拒绝导入。
- 图片/视频引用仍由 `media-store.js` 外置，状态只保存 `mine-media://...` 引用。

## 状态源数据

| 顶层字段 | 关键字段/类型 | 默认值 | 规则 |
|---|---|---|---|
| `habits` | `id,name,tracking,goalType,goalPeriod,target,targetMax,repeatDays,archived` | 两个示例习惯 | 打卡源数据；热力图由 `habitHeatmapData` 实时计算 |
| `checks` | `{ [date]: { [habitId]: number } }` | `{}` | 每日进度源数据，不另建热力图表 |
| `habitCompletions` | `{ [date]: { [habitId]: timestamp } }` | `{}` | 达标时间源数据 |
| `ledgerAccounts` | `id,name,type,initialBalance,sortOrder,archived` | `cmb` 招商银行储蓄卡（bank）、`wx` 微信零钱通（wallet）、`alipay` 支付宝余额宝（wallet）、`loan` 外借应收款（receivable），余额均为 0 | 余额由初始余额+交易实时派生，总资产不落库；用户可继续新增账户 |
| `transactions` | `id,type,amount,category,accountId,sourceAccountId,targetAccountId,date,note,photo` | `[]` | `expense/income/transfer`；另有 `calibrate` 平账流水 |
| `ledgerCategories` | `id,name,icon,color,scope,sortOrder,archived` | `[]` | 内置分类在 `LEDGER_CATEGORIES`，自定义分类仅追加 |
| `merchantCategoryRules` | `id,keyword,categoryId,enabled,createdAt,updatedAt` | `[]` | 关键词→分类；`enabled=false` 为关闭，删除即移除 |
| `weeklyInsightReports` | `id,weekStart,weekEnd,dateRange,weekNumber,themeTitle,summaryNarrative,kpis,dailyFocusChart,tracks,nextWeekActionAdvice,generatedAt,status` | `[]` | 只缓存岗位④生成结果；失败写 `status=failed`，不可伪造成功 |
| `sessions` | `id,date,mode,targetDurationSeconds,durationSeconds,ambientSoundsUsed,interruptionsCount,flowScore,startedAt,endedAt` | `[]` | `minutes` 保留作旧 UI 兼容；新契约字段由模型迁移补齐 |
| `tasteEntries` | `id,type,name,placeName,brand,date,rating,verdict,price,location,flavorTags,notes,photos,ledgerTransactionId,createdAt,updatedAt` | `[]` | 食物为主记录；同名 `placeName` 自动聚合店铺档案；照片走媒体外置引用，Calendar 只派生活动事件，不复制记录 |
| `privateVault` | `salt,verifierIv,verifier,payloadIv,payload,assetRefs` | 空的锁定容器 | 文件夹名、文件名和媒体元数据保留AES-GCM密文；媒体本体使用App私有目录引用以支持快速播放，不进入普通页面、AI、搜索、统计或活动流 |
| `passwordVault` | `salt,wrappedKeyIv,wrappedKey,payloadIv,payload,biometricEnabled` | 空的独立密码容器 | 名称、账号、密码、网址、分类、标签和备注整体AES-GCM加密；不得进入AI、普通搜索、统计或活动流 |

### 账本约束

- 旧交易金额与分类原样保留；无账户语义的历史交易统一 `accountId="unassigned"`，不推断旧账户余额。
- `transfer` 必须同时具备不同的 `sourceAccountId` 与 `targetAccountId`，只改变账户余额，不计消费、收入、预算。
- `calibrate` 使用 `adjustment`/`difference`（可正可负）、`targetBalance`、`reasonTag`；只改变派生余额，不计普通消费、收入或预算。`calibrateLedgerAccount()` 默认校准初始余额，选择平账流水时生成此类型交易。
- `ledgerSummary()` 输出 `totalAssets`、`accounts`、`receivableBalance`、`unassigned`、`categoryExpense`；预算只读取 `expense`。

### 专注与周报计算

- `calculateFlowScore(session)`：达成率 × 80% +（1 − 每次中断 10% 的累计惩罚，封顶 100%）× 20%，结果限制 0–100。
- `previousCompleteWeekRange(now)` 返回当前本地时区之前完整自然周的周一至周日；周报不可把本周未结束日期当作上一完整周。
- `habitHeatmapData(state, habitId, year)` 根据 `checks` 实时输出每日 `level:0..4,value`、活跃天数、当前/最长连续天数。

## 对外 helper

通过 `registerHelper`/`callHelper` 使用，不直接读取其他岗位模块内部状态：

- `openSubpage(id, html?)` / `closeSubpage()` / `isSubpageOpen()`：共享二级页右滑、滚动置顶与关闭。
- `isModalOpen()`：系统返回优先判断弹窗。
- `ledgerSummary(now?)` / `calibrateLedgerAccount(payload)`：账本实时摘要与余额校准。
- `habitHeatmapData(habitId, year)` / `calculateFlowScore(session)` / `previousCompleteWeekRange(now?)`：热力图、心流指数与周报日期范围。
- `openCalendarEvent(id)`、`getSelected()`：已有全局协调 helper。
- `openTasteEntry(id)`：从 Calendar 活动记录打开原始味觉档案详情。
- `setSubpageSystemBack(active)`：仅由核心平台内部协调 Android 返回消费状态。
- `returnToAiOverview()`、`isAiChatActive()` 等 AI helper 由岗位④提供，核心只调用公开接口。

## 二级页与返回优先级

系统返回顺序固定为：弹窗 → 当前 `.subpage-layer.active` → AI 聊天回总览 → Android 默认返回。二级页打开时自动隐藏 Dock、滚动置顶；关闭后恢复 Dock 与原生返回状态。页面岗位只调用 `openSubpage`，不得自行维护另一套遮罩或返回栈。

## 后续岗位禁止事项

- 不新增第二份总资产、热力图、余额或周报日期源数据。
- 不把大图片长期写入 `settings` 或其他 SQLite JSON；使用媒体外置引用。
- 不得从 `privateVault` 密文推断或复制私密内容；只有通过入口密码的私密空间会话可以渲染媒体。媒体本体依赖Android应用沙箱隔离，不再宣称文件级加密。
- 不把转账/平账伪装成 expense/income。
- 不修改 `SCHEMA_VERSION`、`SECTIONS` 或核心实体工厂；新增字段先交给岗位②。
- 不读取旧 Mine 的 localStorage key、`mine_focus` 数据库或旧备份。
