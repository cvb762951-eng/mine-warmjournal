# AI 深度融入 + 模型无关记忆体系 · 开发计划

> 本计划的目标：让 AI 助手更深地融入 Mine 的各个场景，并且**记忆与模型彻底解耦**——以后无论换成 DeepSeek、通义、OpenAI、Claude、Gemini 还是任何 OpenAI 兼容模型，用户积累的记忆都能无缝衔接、不丢失。
>
> 使用方式：每个「独立任务」都可以交给一个独立对话执行。执行前先读本文件 + `PROJECT_MAP.md` + `.workbuddy/memory/MEMORY.md`。

---

## 一、现状诊断

### 1.1 当前 AI 架构

| 层次 | 现状 | 文件 |
|---|---|---|
| 模型调用 | 硬编码两个模型：文字 = DeepSeek（`deepseek-chat`），视觉 = 通义千问（`qwen-vl-plus`） | `ai.js` |
| 数据摘要 | `buildAiContext(state)` 把 App 数据转成文本，喂给模型 | `ai.js` |
| 记忆存储 | `state.aiMemory = [{id, text, createdAt}]` 纯文本数组（≤200 条），已持久化到 SQLite | `model.js` / `storage.js` |
| 记忆提炼 | 4 个入口：对话提炼、数据扫描、照片识别、增删同步 | `ai.js` |
| 记忆注入 | 聊天 + 周总结时把 `aiMemory` 拼进 system prompt | `ai.js` |
| 设置 | 只有 `aiApiKey` + `visionApiKey` + `visionModel` 三项 | `model.js` / `views/ai.js` |

### 1.2 三个核心问题

1. **模型写死**：`AI_BASE_URL` / `AI_MODEL` / `VISION_BASE_URL` 是代码常量，换模型必须改代码、重新打包。
2. **双模型割裂**：文字模型和视觉模型是两套独立配置、两个 Key、两个调用函数，无法用一个统一的多模态模型替代。
3. **记忆不可迁移**：记忆虽然已经是纯文本（本身模型无关，这是好基础），但**没有导出/导入、没有可视化管理、没有合并去重**，换设备或想手动调整记忆都做不到；而且提炼记忆的 prompt 散落在各函数里，换模型后 prompt 适配要到处改。

**结论**：记忆的"数据形式"已经对了（纯文本），缺的是「模型可插拔」和「记忆的完整生命周期管理」。

---

## 二、目标架构

核心思想一句话：**记忆是数据，模型是工具。**

```
┌─────────────────────────────────────────────┐
│  场景层（深度融入）                            │
│  对话 · 周总结 · 日记引导 · 提醒文案 · 照片识别  │
│  首页洞察 · 主动问候 · 习惯建议 …              │
└──────────────────┬──────────────────────────┘
                   │ 统一调用
┌──────────────────▼──────────────────────────┐
│  Provider 抽象层（模型可插拔）                  │
│  chat(messages, opts) / vision(content, opts) │
│  内部按 settings 路由：DeepSeek/通义/OpenAI/…  │
│  （绝大多数都是 OpenAI 兼容的 /chat/completions）│
└──────────────────┬──────────────────────────┘
                   │ 读 / 写
┌──────────────────▼──────────────────────────┐
│  记忆层（模型无关，纯本地数据）                  │
│  aiMemory：纯文本 + 轻量元数据                 │
│  增删改查 · 合并去重 · 导出/导入 · 浏览器        │
│  持久化到 SQLite（storage.js SECTIONS）        │
└─────────────────────────────────────────────┘
```

### 2.1 Provider 抽象（换模型的关键）

把 `settings` 里新增这些字段（在 `model.js` 的 defaults 和 `migrateState` 里补）：

```
aiProvider      // 'deepseek' | 'qwen' | 'moonshot' | 'zhipu' | 'openai' | 'gemini' | 'custom'
aiBaseUrl       // 自定义时填，空则用内置默认值
aiModel         // 如 'deepseek-chat' / 'qwen-plus' / 'gpt-4o' …
aiApiKey        // 已有

visionProvider  // 复用上面的文字 provider，或独立视觉 provider
visionBaseUrl
visionModel     // 已有
visionApiKey    // 已有
```

**关键事实**：DeepSeek、通义千问、Moonshot、智谱、OpenAI、Gemini（`/v1beta/openai` 兼容端点）基本都是 **OpenAI 兼容的 `POST /chat/completions` 协议**。所以 Provider 层 90% 的工作只是「把 baseUrl / model / key 变成可配置」，消息格式统一走 OpenAI 格式即可。少数模型（如 Claude 原生端点）才需要特殊适配。

### 2.2 记忆层（衔接记忆的关键）

记忆保持「纯文本」这一优点（最通用、任何模型都能读），只加**轻量元数据**用于本地管理，不影响模型读取：

```js
aiMemory: [{ id, text, source, createdAt, updatedAt }]
// source: 'conversation' | 'data' | 'photo' | 'sync' | 'manual'
```

新增能力：
- **合并去重**：新记忆写入前，与已有记忆做相似度判断（可本地简单比对 + 交给 AI 合并），避免重复堆积。
- **导出/导入**：记忆导出为 JSON 文件、从 JSON 导入（换设备/换模型/备份记忆的关键）。
- **记忆浏览器**：查看、编辑、删除、手动添加记忆（让用户参与、可控）。

---

## 三、任务清单

> 执行顺序：**阶段 0 → 阶段 1 → 阶段 2**。阶段 2 的 A/B/C 可以并行（改的文件互不重叠）。

### 阶段 0：AI 模块内部拆分（前置，串行，1 个任务）

**为什么先做**：现在 `ai.js` 是一个 374 行的文件，模型调用、数据摘要、记忆、生成全混在一起。不拆开，后面每个任务都要改同一个 `ai.js`，无法并行。

**任务 0 — 拆分 ai.js 为 ai/ 目录**

- 拆成 4 个文件（职责边界清晰）：
  - `ai/provider.js`：`postJson`、`chat()`（原 `callDeepSeek`）、`vision()`（原 `callVision`）
  - `ai/context.js`：`buildAiContext`
  - `ai/memory.js`：`aiExtractMemories`、`aiExtractFromData`、`aiRememberPhoto`、`aiSyncMemory` + 内部 `parseMemories`/`parseSyncResult`
  - `ai/generate.js`：`aiChat`、`aiPeriodSummary`、`aiJournalGuide`、`aiReminderCopy`、`aiDescribeImage` + 内部 `parseAiCopy`
- 新建 `ai/index.js` 做 **re-export**（把上面所有导出函数原样转出），这样 `app.js` 和 `views/*.js` 里现有的 `import ... from './ai.js'` 只需把路径改成 `./ai/index.js`（或保留一个薄的 `ai.js` 转发），**业务调用零改动**。
- **验收**：`npx esbuild app.js --bundle` 零报错；`node scripts/build-web.mjs` 成功；真机各 AI 功能（对话/周总结/日记引导/提醒文案/照片识别/记忆同步）行为与拆分前完全一致。

> ⚠️ 拆分是纯搬移，**禁止重写逻辑**（上次 focus.js 被"简化重写"导致类名全错的教训）。每个函数原样搬走，只改 import 路径。

### 阶段 1：Provider 抽象（模型可插拔，1 个任务）

**任务 1 — 模型可插拔 + 记忆与模型解耦**

- `model.js`：defaults + `migrateState` 增加 `aiProvider` / `aiBaseUrl` / `aiModel` / `visionProvider` / `visionBaseUrl` 字段；默认 `aiProvider='deepseek'`、`aiModel='deepseek-chat'`、`visionProvider='qwen'`，保持向后兼容（老用户已有 key 不丢）。
- `ai/provider.js`：内置一个 `PROVIDERS` 表（provider 名 → 默认 baseUrl + 支持的模型示例），`chat()`/`vision()` 改为读 `state.settings` 路由到对应 provider；统一走 OpenAI 兼容请求格式。
- `views/ai.js` 的 `aiSettingsForm`：增加模型提供商下拉（deepseek/qwen/moonshot/zhipu/openai/gemini/custom）、baseUrl 输入、model 输入；custom 时显示 baseUrl 输入框。
- 记忆相关的所有 prompt **不写死任何模型名**，保持通用。
- **验收**：填 DeepSeek key 能正常对话；把 provider 改成另一个 OpenAI 兼容模型（如 qwen 文字版）后，**记忆照常注入、照常提炼**；`aiMemory` 数据不因切换 provider 而改变。

### 阶段 2（三个任务可并行）

**任务 A — 记忆体系增强（结构化 + 导出导入 + 浏览器）**

- 文件：`ai/memory.js`、`model.js`（aiMemory 加 `source`/`updatedAt` + 迁移）、`views/ai.js`（记忆浏览器）。
- 内容：
  1. `aiMemory` 增加 `source`、`updatedAt` 字段，`migrateState` 兼容旧数据。
  2. 合并去重：写入前与已有记忆比对（简单关键词重叠 + 可选交给 AI 合并），重复则合并/跳过。
  3. 导出/导入：`exportMemories()` 生成 JSON 文件下载；`importMemories(json)` 解析并合并（去重）。
  4. 记忆浏览器：现有 `aiMemoryModal` 升级为「查看 + 编辑 + 删除 + 手动添加 + 导出/导入」。
- **验收**：能导出记忆 JSON、能导入回来；手动增删改记忆；重复记忆不会无限堆积。

**任务 B — AI 主动洞察（首页卡片 + 主动问候）**

- 文件：`ai/insight.js`（新建）、`ai.js`（转发层加一行 export）、`views/today.js`。
- 内容：
  1. 新增 `aiDailyInsight(state)`：基于 `buildAiContext` + `aiMemory` 生成一句/一小段"今日观察/贴心问候"，温度稍高、口语化。
  2. `views/today.js` 首页新增一张「AI 洞察」卡片，显示当天的洞察（缓存到 settings，每天生成一次，避免频繁调用）。
  3. 可选：打开 App 时如果距离上次生成超过一天，静默生成并展示。
- **验收**：首页出现 AI 洞察卡片，文案有温度、结合了用户数据与长期记忆；无 key 时不显示卡片。

**任务 C — 记忆深度注入（周总结/日记/提醒的记忆强化）**

- 文件：`ai/generate.js`、`views/stats.js`。
- 内容：
  1. 统一一个 `buildMemoryBlock(state, limit)` 助手（把 aiMemory 拼成可注入的文本块），替换现在 `aiChat`/`aiPeriodSummary` 里重复的拼接代码。
  2. 周总结：增强记忆注入（不只最近 20 条，按重要性/时间更智能地选取）。
  3. 日记引导、提醒文案：把长期记忆也适度注入，让文案更懂用户。
- **验收**：周总结/日记引导/提醒文案明显更"懂用户"（延续长期记忆），且不啰嗦。

---

## 四、并行策略总结

```
阶段 0（任务 0）  ──►  阶段 1（任务 1）  ──►  阶段 2（任务 A / B / C 可同时开工）
```

| 阶段 | 任务 | 主要改动文件 | 依赖 |
|---|---|---|---|
| 0 | 拆分 ai.js | `ai/*.js`、`ai/index.js`、各 import 路径 | 无 |
| 1 | Provider 抽象 | `ai/provider.js`、`model.js`、`views/ai.js` | 任务 0 |
| 2-A | 记忆体系 | `ai/memory.js`、`model.js`、`views/ai.js` | 任务 1 |
| 2-B | 主动洞察 | `ai/insight.js`、`views/today.js` | 任务 1 |
| 2-C | 记忆注入 | `ai/generate.js`、`views/stats.js` | 任务 1 |

> 阶段 2 的 A / B / C 改的文件完全不重叠（A 主改 `ai/memory.js` + `views/ai.js`，B 主改 `ai/insight.js` + `views/today.js`，C 主改 `ai/generate.js` + `views/stats.js`），可以放心并行。

---

## 五、风险与注意事项

1. **拆分严禁重写**：阶段 0 是纯搬移，函数体一字不动，只改 import。这是上次 focus.js 血泪教训。
2. **向后兼容**：所有新 settings 字段都要在 `migrateState` 里给默认值并处理旧数据，保证老用户升级后 key 和记忆不丢。
3. **SECTIONS 白名单**：`aiMemory` 已在 `storage.js` 的 SECTIONS 里；若新增顶层 state 字段（本次没有，都在 settings/aiMemory 内部），必须同步加白名单。
4. **记忆不写死模型名**：所有 system prompt 保持模型无关，方便后续任意换模型。
5. **每个任务完成后跑一遍**：`node scripts/build-web.mjs`（先 `./gradlew --stop` 若遇文件锁）+ 真机回归相关功能，再提交一个 commit 作为该任务的检查点。
