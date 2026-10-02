// OWNER: P4 — 계약 §7.5 「유물」 (P0이 계약 값을 그대로 옮겨 뒀다 · 이후 조정은 P4만)
// 2칸 장착. 상점 itemId는 `relic:<id>`. mods = 더하기, mul = 곱하기, set = 덮어쓰기(같은 키 중복 금지).
/** @typedef {import('../types.js').RelicDef} RelicDef */

/** @type {Record<string, RelicDef>} */
export const RELICS = {
  // 구르기 직후 1.5초 피해 +25%
  ember_fang:   { id: 'ember_fang',   price: 500, mods: {}, mul: {}, set: { postRollDmgMul: 1.25, postRollWindow: 1.5 } },
  // 패링 창 +0.08초
  watcher_ring: { id: 'watcher_ring', price: 500, mods: { parryWindow: 0.08 }, mul: {}, set: {} },
  // 스태미나 회복 +25%
  green_moss:   { id: 'green_moss',   price: 400, mods: {}, mul: { staminaRegen: 1.25 }, set: {} },
  // 준 피해의 5% 흡혈
  leech_seal:   { id: 'leech_seal',   price: 700, mods: {}, mul: {}, set: { lifesteal: 0.05 } },
  // HP 30% 이하에서 피해 +30%
  red_tear:     { id: 'red_tear',     price: 600, mods: {}, mul: {}, set: { lowHpThreshold: 0.3, lowHpDmgMul: 1.3 } },
  // 잔불 획득 +15%
  ash_idol:     { id: 'ash_idol',     price: 450, mods: {}, mul: { emberGainMul: 1.15 }, set: {} },
  // 가드 스태미나 소모 −30%
  stone_ward:   { id: 'stone_ward',   price: 450, mods: {}, mul: { guardStaminaFactor: 0.7 }, set: {} },
};

/** 상점 진열 순서 */
export const RELIC_IDS = ['ember_fang', 'watcher_ring', 'green_moss', 'leech_seal', 'red_tear', 'ash_idol', 'stone_ward'];
