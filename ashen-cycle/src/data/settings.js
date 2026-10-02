// OWNER: P0 — 계약 §3.9 · §9.9 (완성)
/** @typedef {import('../types.js').Settings} Settings */

/** 기본 설정. 고치지 않는다 — 쓰는 쪽이 복사한다({...DEFAULT_SETTINGS}). @type {Readonly<Settings>} */
export const DEFAULT_SETTINGS = Object.freeze({
  mouseSensitivity: 1,   // 0.2..3
  invertY: false,
  volumeMaster: 0.8,     // 0..1
  volumeSfx: 1,          // 0..1
  volumeMusic: 0.6,      // 0..1
  quality: 'medium',     // 'low' | 'medium' | 'high'
  cameraShake: 1,        // 0..1
  damageNumbers: true,
});

/** 설정 값의 허용 범위(sanitizeSettings · 일시정지 패널 슬라이더가 읽는다). */
export const SETTINGS_RANGE = Object.freeze({
  mouseSensitivity: [0.2, 3],
  volumeMaster: [0, 1],
  volumeSfx: [0, 1],
  volumeMusic: [0, 1],
  cameraShake: [0, 1],
});

/** 화질 단계. 실제 pixelRatio = min(window.devicePixelRatio, 상한). 입자 예산은 P7이 지킨다. */
export const QUALITY = {
  low:    { pixelRatio: 1.0, shadows: false, shadowMapSize: 0,    bloom: false, bloomScale: 0,   particles: 150 },
  medium: { pixelRatio: 1.5, shadows: true,  shadowMapSize: 1024, bloom: true,  bloomScale: 0.5, particles: 400 },
  high:   { pixelRatio: 2.0, shadows: true,  shadowMapSize: 2048, bloom: true,  bloomScale: 1.0, particles: 800 },
};
