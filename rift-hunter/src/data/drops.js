// OWNER: P5 — 계약 §7.8 · §5.13 (시드 — P0 이 W0 에 계약 값으로 채웠다 · 🔒 값은 혼자 바꾸지 않는다)
// 드랍 묶음(트레저 클래스) · 등급 가중치 · 보장 · 아이템 발견 수확 체감 · 불운 보정 · 골드 · 재료.

/** @typedef {import('../types.js').TreasureDef} TreasureDef */

/**
 * 🔒 §7.14 (전부) · W1 수정(NOTES-W1FIX): normal · minion 의 globe ↔ none 맞교환(normal 25 → 80 · minion 80 → 150) — 시작 캐릭터의 유일한
 * 처치 연동 회복. gold · potion · material · gear 가중치와 합(1000)은 그대로라 §7.14 의 드랍 · 골드 · 재료 산수는 바뀌지 않는다.
 * @type {TreasureDef[]}
 */
export const TREASURE = [
  { id: 'normal', picks: 1, goldMul: 1.0, w: { none: 732, gold: 90, potion: 5, globe: 80, material: 8, gear: 85 } },
  { id: 'minion', picks: 1, goldMul: 1.2, w: { none: 450, gold: 150, potion: 30, globe: 150, material: 20, gear: 200 } },
  { id: 'champion', picks: 2, goldMul: 1.6, w: { none: 315, gold: 250, potion: 25, globe: 90, material: 45, gear: 275 } },
  { id: 'elite', picks: 4, goldMul: 2.2, w: { none: 150, gold: 300, potion: 50, globe: 60, material: 40, gear: 400 } },
  { id: 'guardian', picks: 8, goldMul: 4.0, w: { none: 0, gold: 400, potion: 50, globe: 0, material: 100, gear: 450 }, guaranteed: 2 },
  { id: 'split', picks: 1, goldMul: 0.5, w: { none: 900, gold: 60, potion: 0, globe: 40, material: 0, gear: 0 } },
];

export const RARITY = {   // 🔒 §7.14
  base: { normal: 1000, magic: 640, rare: 95, legendary: 6.5, set: 1.8 },
  rank: {
    normal: { magic: 1.0, rare: 1.0, legendary: 1.0, set: 1.0 },
    minion: { magic: 1.2, rare: 1.4, legendary: 1.4, set: 1.4 },
    champion: { magic: 1.5, rare: 2.2, legendary: 2.2, set: 2.2 },
    elite: { magic: 2.0, rare: 3.2, legendary: 3.5, set: 3.5 },
    guardian: { magic: 2.5, rare: 5.0, legendary: 6.0, set: 6.0 },
    split: { magic: 1.0, rare: 1.0, legendary: 1.0, set: 1.0 },
  },
  value: { normal: 1, magic: 2.5, rare: 6, legendary: 15, set: 15 },
};

export const GUARANTEE = { rare: 100, legendary: 3, set: 0.8 };   // 🔒 §7.14
export const MF = { k: 2.0, scale: { magic: 1.0, rare: 0.8, legendary: 0.6, set: 0.6 } };   // 🔒 §7.14
export const BLP = { rate: 0.004, capCount: 300, hard: 400 };   // 🔒 §7.14
export const GOLD = { base: 3,   // 🔒 §7.14
  /** (P5 W1) 골드 더미 편차 — amount = max(1, round(base × goldMul × row.goldMul × rng.range(range[0], range[1]) × (1 + gf)))(§5.13-1 의 0.5 ~ 1.5) */
  range: [0.5, 1.5] };
export const MATERIAL_DROP = { scrap: 70, dust: 25, essence: 5 };
