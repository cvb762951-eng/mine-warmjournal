import { registerPlugin } from '@capacitor/core';

// 单例注册。和 NativeMediaStore 一样：同名插件只注册一次，避免重复代理。
export const NativeVideoReencode = registerPlugin('VideoReencode');

/**
 * 订阅"重新压缩"的进度（0~100）。
 *
 * 刻意不做成 Capacitor 的 addListener 直出：调用方只关心一个数字，
 * 而且必须在结束后可靠地摘掉监听 —— 返回一个"取消订阅"的函数，用它做收尾。
 */
export async function onReencodeProgress(handler) {
  if (typeof handler !== 'function') return () => {};
  const listener = await NativeVideoReencode.addListener('progress', event => {
    handler(Math.max(0, Math.min(100, Math.round(Number(event?.progress) || 0))));
  });
  return () => { try { listener?.remove?.(); } catch { /* 监听已经随页面卸载，忽略 */ } };
}
