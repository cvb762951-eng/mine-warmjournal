// ai.js —— 转发层：保持对外 import 路径不变，实现已拆到 ai/ 目录
export { AI_BASE_URL, AI_MODEL } from './ai/provider.js';
export { buildAiContext, buildMoodSummary, nearestCountdown, todayAnniversary } from './ai/context.js';
export { aiChat, aiChatStream, buildAiChatMessages, runAiStreamLifecycle, aiPeriodSummary, aiGenerateWeeklyInsight, calculateWeeklyFlowScore, findReadyWeeklyInsightReport, upsertWeeklyInsightReport, aiJournalGuide, aiReminderCopy, aiDescribeImage, aiDailySummary, aiCountdownNodeCopy, aiSuggestStructure, aiParseLedger, aiLedgerAnalysis, aiRecognizeLedgerImage, aiFocusCoach, detectLedgerIntent, aiReadImageWithLedger, aiRandomReminderCopies, genericRandomReminderCopies, aiDailyEncouragement } from './ai/generate.js';
export { aiExtractMemories, aiExtractFromData, aiRememberPhoto, aiSyncMemory, applySuggestion } from './ai/memory.js';
export { aiDailyInsight } from './ai/insight.js';
export { aiFindDocuments } from './ai/find.js';
export { SEMANTIC_SOURCE_TYPES, SEMANTIC_DEFAULT_LIMIT, SEMANTIC_DEFAULT_CHAR_BUDGET, buildSemanticRecords, retrieveSemanticContext, buildSemanticOverview, parseJournalContent, semanticRecordLabel } from './ai/semantic.js';
