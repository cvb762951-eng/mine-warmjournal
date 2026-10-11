import assert from 'node:assert/strict';
import test from 'node:test';
import { weatherCondition, weatherEndpoint } from '../weather-data.js';

test('WMO weather codes map to readable local weather states', () => {
  assert.deepEqual(weatherCondition(0), { label: '晴朗', icon: 'wb_sunny' });
  assert.deepEqual(weatherCondition(63), { label: '下雨', icon: 'rainy' });
  assert.deepEqual(weatherCondition(95), { label: '雷暴', icon: 'thunderstorm' });
});

test('weather request contains only rounded coordinates and requested fields', () => {
  const url = new URL(weatherEndpoint(34.753231, 113.665412));
  assert.equal(url.origin, 'https://api.open-meteo.com');
  assert.equal(url.searchParams.get('latitude'), '34.7532');
  assert.equal(url.searchParams.get('longitude'), '113.6654');
  assert.equal(url.searchParams.get('current'), 'temperature_2m,weather_code');
  assert.equal(url.searchParams.get('timezone'), 'auto');
});
