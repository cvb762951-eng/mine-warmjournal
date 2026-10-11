import { Capacitor, registerPlugin } from '@capacitor/core';
import { registerHelper } from './core.js';

const Orientation = registerPlugin('Orientation');

const isSupported = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export async function setTimerOrientation(mode = 'auto') {
  if (!isSupported()) return false;
  try {
    await Orientation.setMode({ mode });
    return true;
  } catch (error) {
    console.warn('方向控制设置失败', error);
    return false;
  }
}

export async function restoreTimerOrientation() {
  if (!isSupported()) return false;
  try {
    await Orientation.restore();
    return true;
  } catch (error) {
    console.warn('方向控制恢复失败', error);
    return false;
  }
}

export async function getTimerOrientation() {
  if (!isSupported()) return 'portrait';
  try {
    const result = await Orientation.currentMode();
    return String(result.orientation || 'portrait');
  } catch (error) {
    console.warn('方向状态读取失败', error);
    return 'portrait';
  }
}

registerHelper('setTimerOrientation', setTimerOrientation);
registerHelper('restoreTimerOrientation', restoreTimerOrientation);
