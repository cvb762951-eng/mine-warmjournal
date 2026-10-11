# 任务 0：拆分 ai.js 为 ai/ 目录

> 纯搬移任务，**禁止重写任何函数逻辑**。目标是把 374 行的 `ai.js` 按职责拆成 4 个文件，让后续任务可以并行改不同文件。

## 背景

`ai.js` 目前混了四类职责：模型调用（DeepSeek/通义千问）、数据摘要、记忆提炼、内容生成。不拆开，后续每个 AI 任务都要改同一个文件，无法并行。

## 必读

`PROJECT_MAP.md`、`.workbuddy/memory/MEMORY.md`、`AI_DEV_PLAN.md`（尤其「三、任务清单」的阶段 0）。

## 拆分方案

创建 `ai/` 目录，放 4 个文件，然后**保留 `ai.js` 变成转发层**（这样 `views/ai.js`、`views/journal.js`、`views/stats.js` 里现有的 `import ... from '../ai.js'` 完全不用改）。

### 1. `ai/context.js`（数据摘要）

搬入这两个函数（从 ai.js 原样搬，只改 import 路径）：

- `fmt(minutes)` —— 注意：现在它是内部函数，搬过去后要**加上 `export`**（因为 generate.js 也要用）
- `buildAiContext(state)`（已 export，保持）

文件头 import：
```js
import { dateKey, daysUntil, periodSummary, todayCompletion, todosForDate } from '../model.js';
```

### 2. `ai/provider.js`（模型调用）

搬入这些（原样搬）：

- 常量 `AI_BASE_URL`、`AI_MODEL`（保持 `export`）
- 常量 `VISION_BASE_URL`（原来是普通 `const`，搬过去保持普通 const 即可）
- `postJson(url, headers, body)`（内部函数）
- `callDeepSeek(key, messages, opts)` —— 搬过去后**加上 `export`**（memory.js、generate.js 要跨文件用）
- `callVision(key, model, content, opts)` —— 搬过去后**加上 `export`**

文件头 import：
```js
import { Capacitor, CapacitorHttp } from '@capacitor/core';
```

### 3. `ai/memory.js`（记忆提炼）

搬入这些（原样搬）：

- `parseMemories(text)`（内部）
- `aiExtractMemories(state, conversation)`（保持 export）
- `aiExtractFromData(state, photoDescriptions = [])`（保持 export）
- `aiRememberPhoto(state, imageDesc)`（保持 export）
- `parseSyncResult(text)`（内部）
- `aiSyncMemory(state)`（保持 export）

文件头 import：
```js
import { buildAiContext } from './context.js';
import { callDeepSeek } from './provider.js';
```

### 4. `ai/generate.js`（内容生成）

搬入这些（原样搬）：

- `parseAiCopy(text)`（内部）
- `aiChat(state, messages, { signal } = {})`（保持 export）
- `aiPeriodSummary(state, period = 'week')`（保持 export）
- `aiJournalGuide(state)`（保持 export）
- `aiReminderCopy(state)`（保持 export）
- `aiDescribeImage(state, imageDataUrl, prompt)`（保持 export）

文件头 import：
```js
import { buildAiContext, fmt } from './context.js';
import { callDeepSeek, callVision } from './provider.js';
```

### 5. `ai.js`（改为转发层）

把 `ai.js` 的全部实现代码删掉，替换为下面的 re-export（注意要覆盖 `views/ai.js` 用到 `AI_MODEL` 的引用）：

```js
// ai.js —— 转发层：保持对外 import 路径不变，实现已拆到 ai/ 目录
export { AI_BASE_URL, AI_MODEL } from './ai/provider.js';
export { buildAiContext } from './ai/context.js';
export { aiChat, aiPeriodSummary, aiJournalGuide, aiReminderCopy, aiDescribeImage } from './ai/generate.js';
export { aiExtractMemories, aiExtractFromData, aiRememberPhoto, aiSyncMemory } from './ai/memory.js';
```

## 不需要改的文件

`views/ai.js`、`views/journal.js`、`views/stats.js` 的 import 路径 `'../ai.js'` **保持不变**，因为 `ai.js` 转发层把名字都转出去了。

## 验收标准

1. `npx esbuild app.js --bundle --format=iife --global-name=Mine --outfile=www/app.js` 零报错。
2. `node scripts/build-web.mjs` 构建成功。
3. 确认拆出去的函数没有被遗漏或重复定义（对照上面的函数清单逐一核对）。
4. 行为与拆分前完全一致（不做任何逻辑改动，所以理论上不会有行为变化）。

## 完成后

`git commit`，message：`AI任务0：拆分 ai.js 为 ai/ 目录（纯搬移）`。
