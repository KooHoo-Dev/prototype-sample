// OWNER: P5 — 계약 §7.11 · §9.11
// SEED — P0 이 W0 에 계약 값 그대로 넣었다. 조정은 소유 패키지만 §7.0 규칙 안에서(🔒 값은 밸런스 게이트만).

export const DEFAULT_SETTINGS = { version: 1, mouseSens: 1.0, invertY: false, quality: 'medium', fov: 70,
  volume: { master: 0.8, sfx: 1.0, ambience: 0.7, ui: 0.8 }, hints: true };
export const QUALITY = {
  low:    { pixelRatio: 1.0, shadows: false, shadowMap: 0,    waterReflect: 'none',   fogParticles: 0,   rainDrops: 600,  terrainSeg: 96 },
  medium: { pixelRatio: 1.5, shadows: true,  shadowMap: 1024, waterReflect: 'sky',    fogParticles: 60,  rainDrops: 1500, terrainSeg: 160 },
  high:   { pixelRatio: 2.0, shadows: true,  shadowMap: 2048, waterReflect: 'planar', fogParticles: 140, rainDrops: 3000, terrainSeg: 256 },
};
export const MOUSE = { radPerPx: 0.0022, spikeClampPx: 120, keyYawRate: 1.2 };   // rad/px(× mouseSens) · 한 이벤트 이동량 상한(스파이크는 버리지 않고 자른다) · 낚시 모드 A/D 조준(rad/s — §11.3)
