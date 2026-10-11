import { Geolocation } from '@capacitor/geolocation';
import { state, save, render, show, registerHelper } from './core.js';
import { dateKey } from './model.js';
import { weatherCondition, weatherEndpoint } from './weather-data.js';

const validSnapshot = value => value && typeof value === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(value.date || '') && Number.isFinite(Number(value.temperature)) && Number.isFinite(Number(value.code));

export function weatherSnapshot(day = dateKey()) {
  const snapshot = state.settings?.weatherSnapshot;
  return validSnapshot(snapshot) && snapshot.date === day ? snapshot : null;
}

export async function refreshWeather() {
  const permission = await Geolocation.requestPermissions();
  if (permission.location !== 'granted' && permission.coarseLocation !== 'granted') throw new Error('需要位置权限才能获取当地天气');
  show('正在获取当地天气…');
  const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 });
  const { latitude, longitude } = position.coords || {};
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('未能获取当前位置');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let response;
  try { response = await fetch(weatherEndpoint(latitude, longitude), { signal: controller.signal }); }
  catch (error) { throw new Error(error?.name === 'AbortError' ? '天气服务响应超时，请稍后重试' : '无法连接天气服务，请检查网络'); }
  finally { clearTimeout(timeout); }
  if (!response.ok) throw new Error('天气服务暂时不可用，请稍后重试');
  const body = await response.json();
  const current = body?.current;
  if (!current || !Number.isFinite(Number(current.temperature_2m)) || !Number.isFinite(Number(current.weather_code))) throw new Error('天气服务返回的数据不完整');
  state.settings.weatherSnapshot = { date: dateKey(), temperature: Math.round(Number(current.temperature_2m)), code: Number(current.weather_code), updatedAt: Date.now() };
  await save();
  render();
  return weatherSnapshot();
}

export function weatherDisplay() {
  const snapshot = weatherSnapshot();
  if (!snapshot) return { temperature: '--°', label: '点击获取当地天气', icon: 'location_searching', hint: '仅在你点击后请求定位', fresh: false };
  const condition = weatherCondition(snapshot.code);
  return { temperature: `${snapshot.temperature}°`, label: condition.label, icon: condition.icon, hint: '点击刷新当地天气', fresh: true };
}

registerHelper('weatherDisplay', weatherDisplay);
registerHelper('refreshWeather', refreshWeather);
