# 任务 2A：记忆体系增强（去重 / 导出导入 / 浏览器）

> 让记忆可管理、可迁移——这是「换模型/换设备后记忆衔接」的落点之一。记忆保持纯文本（模型无关），只加轻量元数据和本地管理能力。

## 前置

任务 1 已完成（Provider 抽象，`chat(state,...)` / `vision(state,...)` 可用）。

## 必读

`AI_DEV_PLAN.md`（「2.2 记忆层」）、`PROJECT_MAP.md`、`.workbuddy/memory/MEMORY.md`。

## 改动文件（本任务独占，不与他人冲突）

`ai/memory.js`、`model.js`、`views/ai.js`

## 改动 1：`model.js` 记忆结构加字段

`aiMemory` 元素从 `{id, text, createdAt}` 扩展为 `{id, text, source, createdAt, updatedAt}`：

- 在 `migrateState` 里（约 252-253 行，处理 `aiMemory` 的地方）补 `source`（默认 `'manual'` 或 `''`，String 化）和 `updatedAt`（默认取 `createdAt`）。
- `source` 取值约定：`'conversation' | 'data' | 'photo' | 'sync' | 'manual'`。

## 改动 2：`ai/memory.js` 增加统一写入 + 去重 + 导出导入

1. **统一写入助手** `addMemories(state, texts, source)`：
   - 对每个 text 做去重（见下）、拼 `{id: uid(), text, source, createdAt: Date.now(), updatedAt: Date.now()}`，push 到 `state.aiMemory`
   - 上限仍为 200 条（超了删最旧的）
   - 建议把现有各调用点（`views/ai.js` 里 `scheduleAiRefresh`/`rememberPhoto` 等写入 `aiMemory` 的地方）改走这个助手，统一打 `source` 标签

2. **去重** `isDuplicate(existing, incoming)`：
   - 完全相等 → 重复
   - 高重叠（如字符串相似度 > 0.85，可用简单 Jaccard / 最长公共子串比例实现）→ 重复
   - 重复时跳过（不新增）；如需，可用 `updatedAt` 刷新旧条目时间

3. **导出** `exportMemories(state)`：把 `state.aiMemory` 序列化为 JSON 字符串（含 id/text/source/createdAt），返回给调用方触发文件下载（可复用现有备份/下载机制，见 `backup.js` 的写法）。

4. **导入** `importMemories(state, json)`：解析 JSON → 逐条 `addMemories`（去重合并）→ 返回导入条数。

## 改动 3：`views/ai.js` 升级记忆浏览器

现有 `aiMemoryModal`（约 274 行）目前大概只是「查看记忆列表」。升级为完整浏览器：

- **查看**：列出所有记忆（可按 source 或时间分组），显示文本 + 来源标签 + 时间
- **编辑**：点某条记忆可改文本
- **删除**：单条删除（带确认）
- **手动添加**：输入框新增一条（source = `'manual'`）
- **导出 / 导入**：两个按钮，分别触发 `exportMemories`（下载 JSON）和 `importMemories`（读入文件/粘贴 JSON）

注意：所有增删改后要 `save()` 持久化并 `render()` 刷新；涉及删除用 `confirmDelete`。

## 不改动

记忆的「提炼逻辑」(`aiExtractMemories` / `aiExtractFromData` / `aiRememberPhoto` / `aiSyncMemory`) 和 Provider 调用方式**不动**，只在其写入路径上套用 `addMemories`。

## 验收标准

1. 能导出记忆为 JSON、能导入回来（不产生重复）。
2. 浏览器里能查看 / 编辑 / 删除 / 手动添加记忆。
3. 多次扫描数据不会让重复记忆无限堆积（去重生效）。
4. `node scripts/build-web.mjs` 构建通过；真机记忆浏览器可用。

## 完成后

`git commit`，message：`AI任务2A：记忆体系增强（去重/导出导入/浏览器）`。
