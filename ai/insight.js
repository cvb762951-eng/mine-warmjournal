import { buildAiContext, buildMoodSummary, nearestCountdown, todayAnniversary } from './context.js';
import { chat } from './provider.js';

// 主动洞察：结合用户当天数据 + 长期记忆，生成一句有温度的「今日洞察 / 问候」。
// 无 AI key 或生成失败时返回空字符串，由调用方决定不展示。
export async function aiDailyInsight(state) {
  const settings = state?.settings || {};
  if (!settings.aiApiKey) return '';
  const context = buildAiContext(state);
  const memory = (state.aiMemory || []).map(item => item.text);
  const memoryBlock = memory.length
    ? `\n\n你对他已经积累了不少了解（这些是你长期记得的，自然地延续，别刻意复述）：\n${memory.map((text, i) => `${i + 1}. ${text}`).join('\n')}`
    : '';
  const extra = [];
  // R2：问候语气自适应 + 连续低落预警（aiEmotionCare 关闭时不注入）
  const mood = buildMoodSummary(state);
  if (mood.enabled && mood.lowStreak >= 1) {
    extra.push(mood.lowStreak >= 3
      ? '他最近连续好几天心情低落：今天先温柔地关心他一句、再谈别的，语气轻一点，多问一句他的状态。'
      : '他最近几天有点低落：语气温柔一些，先照顾他的情绪。');
  }
  // R1：每日问候顺带提最近最重要的 1 个倒计时（开关 dailyMention）
  const cfg = settings.countdownAiReminders || {};
  if (cfg.dailyMention) {
    const nearest = nearestCountdown(state);
    if (nearest) {
      extra.push(`顺带自然地提一句他最近最重要的日子：「${nearest.title}」${nearest.days === 0 ? '就是今天' : `还有 ${nearest.days} 天`}${nearest.note ? `（${nearest.note}）` : ''}，一句带过，不要生硬罗列。`);
    }
  }
  // R1：纪念日祝福（开关 anniversaryBlessing；无法判定类型则跳过）
  if (cfg.anniversaryBlessing) {
    const anniversary = todayAnniversary(state);
    if (anniversary) {
      extra.push(`今天是「${anniversary.title}」${anniversary.note ? `（${anniversary.note}）` : ''}，请写一句「写给今天」的祝福语：真诚、温暖，像为这个日子专门写的话。`);
    }
  }
  const extraBlock = extra.length ? `\n另外：\n- ${extra.join('\n- ')}` : '';
  const system = `你是「Mine」App 里陪伴他的朋友，正在写一句每天给他的「今日洞察 / 问候」。像老朋友那样，结合他今天的数据（是否已学习、待办、习惯打卡、倒数日临近等）和他长期的习惯、目标、偏好，说一句贴心的观察或鼓励。要求：
- 一句话或一小段，80 字以内，口语化、有温度
- 不要罗列数据，不要说教，不要用"首先/其次"这类书面套话
- 不要编造数据里没有的内容
- 直接给文案本身，不要加引号或多余解释${extraBlock}`;

  try {
    const reply = await chat(state, [
      { role: 'system', content: system },
      { role: 'user', content: `他今天的数据：\n${context}${memoryBlock}` }
    ], { temperature: 0.85, maxTokens: 200 });
    return String(reply || '').trim().slice(0, 120);
  } catch {
    return '';
  }
}
