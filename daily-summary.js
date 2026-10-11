import { Capacitor, registerPlugin } from '@capacitor/core';
import { registerHelper } from './core.js';

const DailySummary = registerPlugin('DailySummary');

const isSupported = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

/**
 * 在每次正常启动后确保下一次本地时间 02:00 的静默唤醒已登记。
 * 原生端以一次性 alarm 重排，系统延迟由 Android 自行处理。
 */
export async function scheduleAutoSummary() {
  if (!isSupported()) return false;
  try {
    await DailySummary.scheduleNext();
    return true;
  } catch (error) {
    console.warn('每日小结定时任务登记失败', error);
    return false;
  }
}

/**
 * 本次启动是否由凌晨定时器（每日小结静默模式）拉起。
 * 岗位④据此决定是否执行「生成前一天小结」；浏览器/非静默返回 false。
 */
export async function isAutoSummaryLaunch() {
  if (!isSupported()) return false;
  try {
    const result = await DailySummary.isAutoSummaryLaunch();
    return Boolean(result.autoSummary);
  } catch (error) {
    console.warn('静默模式检测失败', error);
    return false;
  }
}

/**
 * 静默模式任务完成：Activity finish 退出（避免驻留）。
 * 前台使用时调用不会退出（原生侧有前台保护）。
 */
export async function finishAutoSummary() {
  if (!isSupported()) return false;
  try {
    await DailySummary.finishAutoSummary();
    return true;
  } catch (error) {
    console.warn('静默退出失败', error);
    return false;
  }
}

registerHelper('scheduleAutoSummary', scheduleAutoSummary);
registerHelper('isAutoSummaryLaunch', isAutoSummaryLaunch);
registerHelper('finishAutoSummary', finishAutoSummary);
