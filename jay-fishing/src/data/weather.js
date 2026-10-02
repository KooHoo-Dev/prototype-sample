// OWNER: P3 — 계약 §7.2
// SEED — P0 이 W0 에 계약 값 그대로 넣었다. 조정은 소유 패키지만 §7.0 규칙 안에서(🔒 값은 밸런스 게이트만).

export const WEATHER = {
  clear:  { id: 'clear',  biteMul: 1.00, dayBandStep: 0, light: 1.00, fog: 1.0, waveMul: 1.00, rain: 0 },
  cloudy: { id: 'cloudy', biteMul: 1.05, dayBandStep: 1, light: 0.72, fog: 1.6, waveMul: 1.20, rain: 0 },
  rain:   { id: 'rain',   biteMul: 1.10, dayBandStep: 1, light: 0.55, fog: 2.4, waveMul: 1.45, rain: 1 },
};
