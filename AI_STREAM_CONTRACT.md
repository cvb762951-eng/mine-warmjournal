# Android AI SSE 流式传输契约

`AiStream` 是 Android 原生侧的 OpenAI-compatible SSE 传输桥接。岗位④负责调用、解析模型 JSON 和展示；插件只传输原始 SSE `data:` 内容，不持久化任何请求或响应。

## 调用

```js
import { registerPlugin } from '@capacitor/core';

const AiStream = registerPlugin('AiStream');

await AiStream.start({
  requestId: 'uuid-or-unique-id',
  url: 'https://api.example.com/v1/chat/completions',
  apiKey: '...',
  body: { model: '...', messages: [...] }
});
```

- `requestId`：必填、最多 128 字符，在活动传输中必须唯一。重复 `start` 会以 `duplicate_request_id` 拒绝，不会取消旧请求。
- `url`：仅接受 HTTPS、且不允许 URL 用户信息。开发环境 localhost 不由此插件支持。
- `apiKey`：必填，仅写入 `Authorization: Bearer ...` 请求头；禁止放入 URL 或 body。
- `body`：OpenAI-compatible JSON 对象或 JSON 字符串；原生侧会强制写入 `stream: true`。
- `cancel({ requestId })`：只取消指定请求，返回 `{ requestId, cancelled }`。未知或已结束 ID 返回 `cancelled: false`。

## 事件

岗位④在 `start` 前注册监听，并在完成、错误、取消、组件销毁时移除对应 listener：

```js
const chunkListener = await AiStream.addListener('aiStreamChunk', payload => {
  if (payload.requestId !== requestId) return;
  // JSON.parse(payload.data) 由岗位④负责。
});
const doneListener = await AiStream.addListener('aiStreamDone', payload => { /* requestId */ });
const errorListener = await AiStream.addListener('aiStreamError', payload => { /* requestId, message */ });

// finally: chunkListener.remove(); doneListener.remove(); errorListener.remove();
```

| 事件 | 负载 |
|---|---|
| `aiStreamChunk` | `{ requestId, data }`，`data` 为去掉 SSE `data:` 前缀后的原始 JSON 字符串 |
| `aiStreamDone` | `{ requestId }`，仅收到 `data: [DONE]` 时发出 |
| `aiStreamError` | `{ requestId, message }`，网络、超时、非 2xx 或没有 `[DONE]` 即结束时发出 |

空行与 `:` 注释行会忽略。插件不解析 `data` 内 JSON，也不合并多行 SSE 数据；每个 `data:` 行对应一个 chunk 事件。

## 与浏览器 fetch 流的一致语义

Android 原生和浏览器 fetch 流都遵守同一生命周期：唯一 `requestId` → 多个原始 JSON chunk → 一个 done 或一个 error。取消是终止状态，取消成功后不会再发送 chunk、done 或 error；岗位④应忽略不匹配的 `requestId`，并在每条终止路径清理 listener 与本地 UI 流状态。
