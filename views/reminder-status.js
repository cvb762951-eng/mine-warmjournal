// 设置页「日常作息与记录提醒」的真实状态。只读 notifications.js 的 getReminderStatus()，
// 不改任何排程逻辑，也不写存储。纯函数，方便测试。

const GENTLE_ERROR = '刚才排提醒时遇到一点小问题，回到 App 会再试一次';

// status: { permission, exactAlarm, scheduledCount, lastError } | null
// configured: 用户设置里的提醒条数
export function describeReminderStatus(status, configured = 0) {
  const count = Number(configured) || 0;
  const fallbackRight = count ? `已设 ${count} 项` : '未开启';
  if (!count) return { tone: 'idle', right: '未开启', note: '', action: null };
  if (!status || status.permission === 'unsupported') {
    // 浏览器预览 / 读不到状态：不假装「已排好」，只给保守文案
    return { tone: 'idle', right: fallbackRight, note: '安装到手机后，这里会显示实际排好的提醒', action: null };
  }
  if (status.permission !== 'granted') {
    return { tone: 'warn', right: '未生效', note: '通知权限未开启，提醒不会弹出', action: { kind: 'notification', label: '去开启' } };
  }
  if (status.exactAlarm === 'denied' || status.exactAlarm === 'prompt' || status.exactAlarm === 'prompt-with-rationale') {
    return { tone: 'warn', right: `已排 ${status.scheduledCount || 0} 条`, note: '精确闹钟未开启，提醒可能延迟', action: { kind: 'exact', label: '去开启' } };
  }
  const n = Number(status.scheduledCount) || 0;
  if (status.lastError) {
    return { tone: 'soft', right: n ? `已排 ${n} 条` : fallbackRight, note: GENTLE_ERROR, action: null };
  }
  if (!n) return { tone: 'soft', right: fallbackRight, note: '提醒还在排，稍后回来看看', action: null };
  return { tone: 'ok', right: `已排好 ${n} 条提醒`, note: '', action: null };
}
