// OWNER: P9 — 계약 §7.13 · §3.11 (시드 — P0 이 W0 에 계약 값으로 채웠다)
// 설정 기본값과 정화 스키마(clamp · 모르는 키 버림). 문면은 strings.ko.js 의 settings.<key>.

export const DEFAULT_SETTINGS = {
  volMaster: 0.8, volSfx: 0.9, volAmbient: 0.6, quality: 'medium', damageNumbers: true, alwaysLabels: false,
  hideNormal: false, advancedTooltips: false, meterHud: false, screenShake: true,
};

/** 키 → {type:'number', min, max} | {type:'bool'} | {type:'enum', values} */
export const SETTINGS_SCHEMA = {
  volMaster: { type: 'number', min: 0, max: 1 },
  volSfx: { type: 'number', min: 0, max: 1 },
  volAmbient: { type: 'number', min: 0, max: 1 },
  quality: { type: 'enum', values: ['low', 'medium', 'high'] },
  damageNumbers: { type: 'bool' },
  alwaysLabels: { type: 'bool' },
  hideNormal: { type: 'bool' },
  advancedTooltips: { type: 'bool' },
  meterHud: { type: 'bool' },
  screenShake: { type: 'bool' },
};
