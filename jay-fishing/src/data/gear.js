// OWNER: P4 — 계약 §7.6
// SEED — P0 이 W0 에 계약 값 그대로 넣었다. 조정은 소유 패키지만 §7.0 규칙 안에서(🔒 값은 밸런스 게이트만).
// 행마다 GearDef 하나(§3.3 필드 이름 그대로 · 그 슬롯이 쓰지 않는 필드는 생략 · lossCost 가 없으면 0).

/** @typedef {import('../types.js').GearDef} GearDef */

/** @type {GearDef[]} */
export const GEAR = [
  // 로드 — 세트 전용
  { id: 'rod_float_1',  slot: 'rod', tier: 1, set: 'float',  price: 0,      lossCost: 0, castM: 24, maxLoadKg: 2.6, sensitivity: 1.0,  lengthM: 3.6 },
  { id: 'rod_float_2',  slot: 'rod', tier: 2, set: 'float',  price: 40000,  lossCost: 0, castM: 30, maxLoadKg: 6,   sensitivity: 1.15, lengthM: 3.9 },   // 🔒 가격
  { id: 'rod_float_3',  slot: 'rod', tier: 3, set: 'float',  price: 260000, lossCost: 0, castM: 38, maxLoadKg: 12,  sensitivity: 1.3,  lengthM: 4.2 },
  { id: 'rod_bottom_1', slot: 'rod', tier: 1, set: 'bottom', price: 0,      lossCost: 0, castM: 32, maxLoadKg: 3.2, sensitivity: 1.0,  lengthM: 2.7 },
  { id: 'rod_bottom_2', slot: 'rod', tier: 2, set: 'bottom', price: 45000,  lossCost: 0, castM: 42, maxLoadKg: 8,   sensitivity: 1.15, lengthM: 3.0 },   // 🔒 가격
  { id: 'rod_bottom_3', slot: 'rod', tier: 3, set: 'bottom', price: 300000, lossCost: 0, castM: 52, maxLoadKg: 16,  sensitivity: 1.3,  lengthM: 3.3 },
  // 릴 — 공용
  { id: 'reel_1', slot: 'reel', tier: 1, set: null, price: 0,       lossCost: 0, maxDragKg: 5,  speedMS: 1.5, capacityM: 120, castBonus: 0 },
  { id: 'reel_2', slot: 'reel', tier: 2, set: null, price: 190000,  lossCost: 0, maxDragKg: 9,  speedMS: 1.7, capacityM: 200, castBonus: 0.05 },   // 🔒 가격
  { id: 'reel_3', slot: 'reel', tier: 3, set: null, price: 2000000, lossCost: 0, maxDragKg: 16, speedMS: 2.0, capacityM: 300, castBonus: 0.10 },
  // 라인 — m 단위 소모품(감기만 · 잃을 때는 끊긴 길이)
  { id: 'line_1', slot: 'line', tier: 1, set: null, price: 0, lossCost: 0, strengthKg: 4,  biteMul: 1.0,  abrasionMul: 1.0,  pricePerM: 5 },    // 집에서는 무료
  { id: 'line_2', slot: 'line', tier: 2, set: null, price: 0, lossCost: 0, strengthKg: 8,  biteMul: 0.94, abrasionMul: 0.75, pricePerM: 25 },
  { id: 'line_3', slot: 'line', tier: 3, set: null, price: 0, lossCost: 0, strengthKg: 18, biteMul: 0.88, abrasionMul: 0.5,  pricePerM: 60 },
  // 바늘 — 크기(1단계 · 무한)
  { id: 'hook_s', slot: 'hook', tier: 1, set: null, price: 0, lossCost: 100, size: 1 },
  { id: 'hook_m', slot: 'hook', tier: 1, set: null, price: 0, lossCost: 100, size: 2 },
  { id: 'hook_l', slot: 'hook', tier: 1, set: null, price: 0, lossCost: 100, size: 3 },
  // 찌 — 찌 세트만
  { id: 'float_1', slot: 'float', tier: 1, set: null, price: 0,     lossCost: 300,  sensitivity: 1.0,  stability: 0.5,  driftMul: 1.0 },
  { id: 'float_2', slot: 'float', tier: 2, set: null, price: 12000, lossCost: 1000, sensitivity: 1.25, stability: 0.75, driftMul: 1.0 },
  { id: 'float_3', slot: 'float', tier: 3, set: null, price: 80000, lossCost: 3000, sensitivity: 1.5,  stability: 1.0,  driftMul: 1.0 },
  // 봉돌 — 바닥 세트만
  { id: 'sinker_1', slot: 'sinker', tier: 1, set: null, price: 0,     lossCost: 150,  castBonusM: 0, holdMS: 0.5 },
  { id: 'sinker_2', slot: 'sinker', tier: 2, set: null, price: 10000, lossCost: 500,  castBonusM: 4, holdMS: 0.9 },
  { id: 'sinker_3', slot: 'sinker', tier: 3, set: null, price: 70000, lossCost: 1500, castBonusM: 8, holdMS: 1.4 },
];

/** @type {Record<string, GearDef>} */
export const GEAR_BY_ID = Object.fromEntries(GEAR.map(g => [g.id, g]));

export const GEAR_GATES = { tier2Level: 5, tier3Level: 12, tier3Mastery: 2 };   // 🔒 (브리프 §4)
