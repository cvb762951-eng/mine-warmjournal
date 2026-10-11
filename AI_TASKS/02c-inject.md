# 任务 2C：记忆深度注入（周总结 / 日记 / 提醒）

> 让 AI 在「周总结、日记引导、提醒文案」这些场景里更懂用户——统一并强化长期记忆的注入方式，让文案延续用户积累的认知，而不是每次像第一次认识。

## 前置

任务 1 已完成（Provider 抽象，`chat(state,...)` 可用）。

## 必读

`AI_DEV_PLAN.md`、`PROJECT_MAP.md`、`.workbuddy/memory/MEMORY.md`。先读 `ai/generate.js` 现有 `aiPeriodSummary` / `aiJournalGuide` / `aiReminderCopy` 的注入方式。

## 改动文件（本任务独占，不与他人冲突）

`ai/generate.js`、`views/stats.js`

> 注意：本任务**不碰 `ai/memory.js`（2A）和 `views/today.js`（2B）**。

## 改动 1：`ai/generate.js` 加统一记忆块助手

新增 `buildMemoryBlock(state, limit)`：

- 把 `state.aiMemory` 的 text 拼成一段可注入 system prompt 的文本块（如 `1. xxx\n2. yyy`）。
- `limit` 控制取多少条。默认按时间倒序取最近 N 条（或按 `source` 优先级简单加权：`conversation`/`data` 优先于 `photo`）。
- 返回字符串（空记忆返回空串）。

然后**用这个助手替换** `aiChat`、`aiPeriodSummary` 里现在手写的记忆拼接逻辑（现在它们各自 `(state.aiMemory || []).map(item => item.text)` 重复实现），保持行为等价。

## 改动 2：强化三处记忆注入

1. **周总结** `aiPeriodSummary`：
   - 现在只注入「最近 20 条」(`memory.slice(-20)`)。改为用 `buildMemoryBlock`，并让 prompt 更自然地把长期记忆融入总结（肯定用户长期坚持的事、呼应他以前的目标/偏好），同时保持 150 字左右的精简。
2. **日记引导** `aiJournalGuide`：
   - 现在**完全没注入记忆**。补上：把长期记忆适度注入，让提问更贴合用户（如记得他在备考 → 问"今天备考状态如何"）。
3. **提醒文案** `aiReminderCopy`：
   - 现在没注入记忆。补上：让提醒文案偶尔呼应长期记忆（如"上次你说想早睡，今晚记得早点放下手机"），但仍保持每条 18 字以内、随机、有温度。

## 改动 3：`views/stats.js`（如需）

检查统计页的周总结展示（AI 周总结卡片）是否正常消费 `aiPeriodSummary` 的返回；若无需改动则跳过本步。**核心改动在 generate.js**，不要动 stats.js 的其他逻辑。

## 不改动

`buildAiContext`、记忆提炼逻辑、Provider 调用方式**不动**。只改「记忆如何被注入到 prompt」。

## 验收标准

1. 周总结明显更懂用户（延续长期记忆），且不啰嗦。
2. 日记引导、提醒文案能呼应长期记忆。
3. 记忆为空时行为与原来一致（不报错、不出现 "undefined"）。
4. `node scripts/build-web.mjs` 构建通过；真机三个场景正常。

## 完成后

`git commit`，message：`AI任务2C：记忆深度注入（周总结/日记/提醒）`。
