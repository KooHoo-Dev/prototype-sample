// OWNER: P4 — 계약 §7.9
// SEED — P0 이 W0 에 계약 값 그대로 넣었다. 조정은 소유 패키지만 §7.0 규칙 안에서(🔒 값은 밸런스 게이트만).

export const START = {
  money: 5000, level: 1, skillPoints: 1,                                         // 🔒
  baits: { worm: 20, paste: 20, corn: 0, shrimp: 0, krill: 0, live: 0 },
  sets: {
    float:  { rod: 'rod_float_1',  reel: 'reel_1', hook: 'hook_m', float: 'float_1', sinker: null,       bait: 'worm',  lineId: 'line_1', lineM: 120, depthM: 2.0, dragNotch: 5 },
    bottom: { rod: 'rod_bottom_1', reel: 'reel_1', hook: 'hook_m', float: null,      sinker: 'sinker_1', bait: 'paste', lineId: 'line_1', lineM: 120, depthM: 2.0, dragNotch: 5 },
  },
};
export const XP = {                                                             // 🔒 전부
  base: 45, exp: 1.36, levelCap: 20,           // 다음 레벨까지 = round(45 × L^1.36): 45 · 116 · 200 · 296 · 402 · 515 · 635 · 761 · 893 · 1,031 … 2,468 — 누적 L5 657 · L10 3,863 · L20 21,116
  tierMul: { normal: 1, trophy: 2, legend: 5 }, releaseMul: 0.7,
  firstBase: 8, firstPerXp: 1,                 // 첫 포획 보너스 = 8 + 어종 xp (첫날 정상 경험치의 약 25%)
  recordMul: 0.5,                              // 무게 신기록(첫 포획 제외) 보너스 = round(0.5 × 어종 xp)
  pointsPerLevel: 1,
};
export const PRICE = { trophyPct: 0.90, legendPct: 0.99, legendTargetRatio: 5.0, dzLegendTrophy: 0.97763 };   // 🔒
export const HOLD = { capacity: 12 };                                           // 🔒
export const FREE_BAIT = { baitId: 'worm', count: 10, moneyBelow: 2000 };        // moneyBelow = 가장 싼 미끼 팩 값 — 살 수 없으면 준다
