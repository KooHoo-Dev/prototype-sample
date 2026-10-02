// OWNER: P1 — 계약 §7.5
// SEED — P0 이 W0 에 계약 값 그대로 넣었다. 조정은 소유 패키지만 §7.0 규칙 안에서(🔒 값은 밸런스 게이트만).

export const BITE = {
  t0: 28, minWait: 5,                                    // 🔒 평균 대기 = minWait + t0 / W
  timeCoef: { '0': 0, L: 0.25, N: 0.6, H: 1.0 },         // 🔒
  stepUp: { '0': '0', L: 'N', N: 'H', H: 'H' },
  baitFit: [1.0, 0.8, 0.6], baitOther: 0.2,              // 🔒 선호 1·2·3순위 · 그 밖
  layerFit: [1.0, 0.3, 0.08],                            // 🔒 층 차이 0·1·2
  hookBigger: [1.0, 0.6, 0.3],                           // 바늘 − 입 = 0 이하 · 1 · 2 → 입질 배율
  hookSmallerHookOff: [1.0, 1.5, 2.2],                   // 입 − 바늘 = 0 이하 · 1 · 2 → 바늘 빠짐 배율
  fantasyShare: 0.035, fantasyBaitFloor: 0.6,            // 🔒
  driftMinFlow: 0.15, driftMul: 1.4,                     // 흘림: 흐름 ≥ 0.15m/s 에서만 · 입질 ×1.4(+ 먼 곳의 farMul — §5.4.2)
  bottomSlipMul: 0.5, bottomSlipSpeed: 0.5,              // 봉돌이 밀리면 입질 ×0.5 · (흐름 − 버팀) × 0.5 m/s 로 밀린다
  zMin: -2.5, zMax: 3.3,
};
export const LAYER = { surfaceMaxM: 1.2, surfaceFrac: 0.25, bottomGapM: 0.5 };
export const CAST = {
  gaugePeriod: 1.6,                 // 🔒 왕복 1.6초(0 → 1에 0.8초)
  minFactor: 0.3, slope: 0.65,      // 완벽 밖: 비거리 = castMax × (0.3 + 0.65 × power) — 완벽 = ×1.0
  flightBase: 0.5, flightPerM: 0.0286,
  lineReserveM: 10, minLineM: 20, retrieveDoneM: 2.0,   // minLineM ≥ minCastM + lineReserveM + 4 — 거리 상 · 하한이 뒤집히지 않는다
  emptyRetrieveMul: 3,              // 빈 채비 회수 = 릴 회수 속도 × 3(28m 약 6초)
  driftReserveM: 40, driftArc: 1.3, shoreMarginM: 1.0,  // 흘림 상한 = lineM − 40 · 흘림 · 봉돌 밀림은 facing ± 1.3rad 안 · 물가에서 1m 안쪽(§5.2)
  depthMinM: 0.5, depthMaxM: 30, depthStepM: 0.25,
};
export const SIGNAL = {
  firstDelay: [0.3, 0.8], baseStrength: 0.6,
  float:  { nibbles: [1, 3], nibbleDur: 0.25, gap: [0.5, 1.2], takeWindow: 0.9, liftWindowAdd: 0.3 },   // 🔒 takeWindow · 찌올림 본신은 창 +0.3초
  bottom: { tremble: [1.0, 2.5], pulse: 0.4, takeWindow: 1.1 },                     // 🔒 takeWindow
  earlyGrace: 0.10,
};
export const RIG = { failNotice: 1.0, netTime: 0.8 };                               // 🔒 failNotice
