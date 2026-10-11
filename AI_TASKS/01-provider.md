# 任务 1：Provider 抽象（模型可插拔）

> 这是「换模型时记忆无缝衔接」的核心任务。目标：把写死的 DeepSeek/通义千问，改成**可配置的 Provider**，用户改设置即可换模型，记忆数据不动。

## 前置

任务 0 已完成（`ai/` 目录已建立）。

## 必读

`AI_DEV_PLAN.md`（「2.1 Provider 抽象」）、`PROJECT_MAP.md`、`.workbuddy/memory/MEMORY.md`。

## 核心事实

DeepSeek、通义千问、Moonshot、智谱、OpenAI、Gemini（`/v1beta/openai` 兼容端点）基本都是 **OpenAI 兼容的 `POST /chat/completions` 协议**。所以 Provider 层的工作主要是「把 baseUrl / model / key 变成可配置」，消息格式统一走 OpenAI 格式即可。

## 改动 1：`model.js` 增加 settings 字段

在 `makeDefaultState` 的 `settings` 块里（约 54-59 行，`aiEnabled` 附近）增加 5 个字段，保持现有字段不变：

```js
aiProvider: 'deepseek',   // deepseek | qwen | moonshot | zhipu | openai | gemini | custom
aiBaseUrl: '',            // 空则用内置默认值；custom 时必填
aiModel: 'deepseek-chat',
visionProvider: 'qwen',
visionBaseUrl: '',
```

在 `migrateState` 里（约 221-226 行，处理 settings 的地方）补上这 5 个字段的迁移（给默认值、String 化，参考现有 `aiApiKey`/`visionModel` 的写法），**保证老用户升级后 key 不丢**。

## 改动 2：`ai/provider.js` 加 Provider 表 + 改造调用函数

1. 加一个 `PROVIDERS` 常量表（provider 名 → 默认 baseUrl）：

```js
const PROVIDERS = {
  deepseek: { baseUrl: 'https://api.deepseek.com/chat/completions', defaultModel: 'deepseek-chat' },
  qwen:     { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', defaultModel: 'qwen-plus' },
  moonshot: { baseUrl: 'https://api.moonshot.cn/v1/chat/completions', defaultModel: 'moonshot-v1-8k' },
  zhipu:    { baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', defaultModel: 'glm-4-plus' },
  openai:   { baseUrl: 'https://api.openai.com/v1/chat/completions', defaultModel: 'gpt-4o-mini' },
  gemini:   { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', defaultModel: 'gemini-2.0-flash' },
  custom:   { baseUrl: '', defaultModel: '' },
};
```

2. 把 `callDeepSeek(key, messages, opts)` 改造成 `chat(state, messages, opts)`：
   - 内部从 `state.settings` 读 `aiProvider` / `aiBaseUrl` / `aiModel` / `aiApiKey`
   - 用 `aiBaseUrl || PROVIDERS[aiProvider].baseUrl` 作为 URL；`aiModel` 作为 model
   - 其余请求格式（OpenAI 兼容）保持不变

3. 把 `callVision(key, model, content, opts)` 改造成 `vision(state, content, opts)`：
   - 从 `state.settings` 读 `visionProvider` / `visionBaseUrl` / `visionModel` / `visionApiKey`
   - 注意：`visionModel` 已有默认 `'qwen-vl-plus'`，保持兼容

## 改动 3：更新所有调用方（`ai/generate.js`、`ai/memory.js`）

原来这些文件里调 `callDeepSeek(key, messages, ...)` 和 `callVision(key, model, ...)`，现在改成传 `state`：

- `ai/memory.js`：4 个记忆函数里 `callDeepSeek(key, ...)` → `chat(state, ...)`，并删掉函数里第一行 `const key = state.settings.aiApiKey;` 的判空逻辑（改由 `chat` 内部统一判空）。
- `ai/generate.js`：`aiChat` / `aiPeriodSummary` / `aiJournalGuide` / `aiReminderCopy` 里 `callDeepSeek(key, ...)` → `chat(state, ...)`；`aiDescribeImage` 里 `callVision(key, model, ...)` → `vision(state, ...)`。

## 改动 4：`views/ai.js` 的设置表单加模型选择

`aiSettingsForm`（约 301-304 行）当前只有 `aiApiKey` + `visionApiKey` 两个输入。改为：

- 「文字模型」区：provider 下拉（deepseek/qwen/moonshot/zhipu/openai/gemini/custom）+ model 输入框 +（选 custom 时显示）baseUrl 输入框 + API Key 输入框
- 「视觉模型」区：provider 下拉 + model 输入框 + API Key 输入框
- `registerSubmitHandler('ai-settings-form', ...)`（约 408-413 行）里同步保存新增字段
- 文案里不要写死「DeepSeek」，改成通用的「文字模型」

## 不改动（关键）

- 记忆相关 prompt **不写死任何模型名**（现状已经如此，保持）。
- `buildAiContext`、`aiExtractMemories` 等记忆提炼逻辑**不动**，只改它们的模型调用入口。

## 验收标准

1. 填 DeepSeek key，对话正常、记忆照常提炼和注入。
2. 把 `aiProvider` 改成另一个 OpenAI 兼容模型（如 qwen 文字版）并填对应 key，**`aiMemory` 数据不变、照常注入/提炼**。
3. `node scripts/build-web.mjs` 构建通过；设置界面能切换 provider 并保存。
4. 老用户（已有 aiApiKey/visionApiKey）升级后 key 不丢。

## 完成后

`git commit`，message：`AI任务1：Provider 抽象，模型可插拔`。
