# 任务 2B：AI 主动洞察（首页卡片 + 主动问候）

> 让 AI 从「被动等用户问」变成「主动关心用户」：首页出现一张 AI 洞察卡片，每天用一句有温度的话结合用户数据 + 长期记忆问候/观察。

## 前置

任务 1 已完成（Provider 抽象，`chat(state,...)` 可用）。

## 必读

`AI_DEV_PLAN.md`、`PROJECT_MAP.md`（首页 view 是 `views/today.js`，先读懂它的结构和 `todayView` 函数）、`.workbuddy/memory/MEMORY.md`。

## 改动文件（本任务独占，不与他人冲突）

`ai/insight.js`（**新建**）、`ai.js`（转发层加一行）、`views/today.js`

> 注意：本任务**不碰 `ai/generate.js`**（那是任务 2C 的地盘）。新函数放独立的 `ai/insight.js`。

## 改动 1：新建 `ai/insight.js`

实现 `aiDailyInsight(state)`：

- 输入 `state`，内部用 `buildAiContext(state)`（从 `./context.js` import）+ `state.aiMemory` 拼出上下文和记忆块。
- 调 `chat(state, messages, { temperature: 0.85, maxTokens: 200 })` 生成一句（或一小段，80 字内）口语化、有温度的「今日洞察 / 问候」。
- system prompt 要点：像老朋友一样，结合用户今天的数据（是否已学习、待办、习惯打卡、倒数日临近等）和长期记忆，给一句贴心的观察或鼓励；不要罗列、不要说教、不要"首先/其次"。
- 无 `state.settings.aiApiKey` 时直接返回空字符串（由调用方决定不显示）。
- 记得 `export`。

## 改动 2：`ai.js` 转发层加一行

在 `ai.js` 的 re-export 里加：

```js
export { aiDailyInsight } from './ai/insight.js';
```

## 改动 3：`views/today.js` 首页加洞察卡片

- 在 `todayView` 里新增一张「AI 洞察」卡片（放在合适位置，如问候区之后、指标区之前，视觉风格参照现有 `.level-card` / `.today-metric` 的莫兰迪样式）。
- 缓存机制：利用现有 `state.settings.aiWeekSummary` 类似思路，或新增一个轻量缓存（如 `state.settings.aiDailyInsight = { date: '', text: '' }`，注意若新增顶层 state 字段必须同步加进 `storage.js` 的 SECTIONS；**更推荐存进 settings 里**，这样不用动 SECTIONS）。同一天只生成一次，避免每次进首页都调 API。
- 无 key 或生成失败时：不显示卡片（或显示一个「配置 AI 后可生成每日洞察」的引导，点击跳转 AI 设置）。
- 生成是异步的：先渲染页面，洞察生成完成后更新卡片内容（注意避免反复触发 render 造成闪烁）。

## 验收标准

1. 首页出现 AI 洞察卡片，文案有温度、确实结合了用户数据与长期记忆。
2. 同一天内不会重复调 API（有缓存）。
3. 无 AI key 时卡片不显示（或只显示引导），不报错。
4. `node scripts/build-web.mjs` 构建通过；真机首页正常。

## 完成后

`git commit`，message：`AI任务2B：AI 主动洞察（首页卡片+主动问候）`。
