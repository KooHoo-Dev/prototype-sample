// OWNER: P7 — 계약 §7.13 · §9.10 (시드 — P0 이 W0 에 계약 값으로 채웠다)
// 화질 3단계. 그림자는 플레이어 빛 하나만.

export const QUALITY = {
  low: { pixelRatio: 1.0, shadows: false, maxLights: 3, particles: 0.4, outlines: true, wallFadeSmooth: false },
  medium: { pixelRatio: 1.5, shadows: false, maxLights: 5, particles: 0.7, outlines: true, wallFadeSmooth: true },
  high: { pixelRatio: 2.0, shadows: true, maxLights: 8, particles: 1.0, outlines: true, wallFadeSmooth: true },
};
