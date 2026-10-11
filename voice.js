import { Capacitor, registerPlugin } from '@capacitor/core';
import { registerHelper } from './core.js';

const VoiceInput = registerPlugin('VoiceInput');

const isSupported = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

/**
 * 开始语音识别。Promise 只确认「已启动」；识别文本经 voiceResult 事件异步回传，
 * 错误经 voiceError 事件（含可读错误码）。
 */
export function startVoiceInput() {
  if (!isSupported()) return Promise.reject(new Error('browser_unsupported'));
  return VoiceInput.startListening().then(() => ({ started: true }));
}

export function cancelVoiceInput() {
  if (!isSupported()) return Promise.resolve(false);
  return VoiceInput.cancelListening().then(() => true).catch(() => false);
}

export async function isVoiceAvailable() {
  if (!isSupported()) return false;
  try {
    const result = await VoiceInput.isAvailable();
    return Boolean(result.available);
  } catch (error) {
    console.warn('语音可用性检查失败', error);
    return false;
  }
}

export function onVoiceResult(callback) {
  if (!isSupported()) return () => {};
  let off = false;
  VoiceInput.addListener('voiceResult', data => callback(data)).then(handle => {
    if (off) handle.remove();
    else voiceHandles.push(handle);
  }).catch(() => {});
  return () => { off = true; };
}

export function onVoiceError(callback) {
  if (!isSupported()) return () => {};
  let off = false;
  VoiceInput.addListener('voiceError', data => callback(data)).then(handle => {
    if (off) handle.remove();
    else voiceHandles.push(handle);
  }).catch(() => {});
  return () => { off = true; };
}

const voiceHandles = [];

registerHelper('startVoiceInput', startVoiceInput);
registerHelper('cancelVoiceInput', cancelVoiceInput);
registerHelper('isVoiceAvailable', isVoiceAvailable);
registerHelper('onVoiceResult', onVoiceResult);
registerHelper('onVoiceError', onVoiceError);
