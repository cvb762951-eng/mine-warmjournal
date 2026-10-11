export function weatherCondition(code) {
  const value = Number(code);
  if (value === 0) return { label: '晴朗', icon: 'wb_sunny' };
  if ([1, 2].includes(value)) return { label: '晴间多云', icon: 'partly_cloudy_day' };
  if (value === 3) return { label: '多云', icon: 'cloud' };
  if ([45, 48].includes(value)) return { label: '有雾', icon: 'foggy' };
  if ([51, 53, 55, 56, 57].includes(value)) return { label: '毛毛雨', icon: 'grain' };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(value)) return { label: '下雨', icon: 'rainy' };
  if ([71, 73, 75, 77, 85, 86].includes(value)) return { label: '下雪', icon: 'ac_unit' };
  if ([95, 96, 99].includes(value)) return { label: '雷暴', icon: 'thunderstorm' };
  return { label: '天气未知', icon: 'cloud' };
}

export function weatherEndpoint(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: Number(latitude).toFixed(4),
    longitude: Number(longitude).toFixed(4),
    current: 'temperature_2m,weather_code',
    timezone: 'auto'
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}
