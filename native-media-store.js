import { registerPlugin } from '@capacitor/core';

// 单例注册，避免普通媒体与私密媒体重复注册同一个原生插件。
export const NativeMediaStore = registerPlugin('NativeMediaStore');
