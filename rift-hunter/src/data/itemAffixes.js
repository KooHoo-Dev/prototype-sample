// OWNER: P5 — 계약 §7.7 (시드 — P0 이 W0 에 계약 값으로 채웠다 · 🔒 값은 혼자 바꾸지 않는다)
// 아이템 옵션 32행 · 티어 5. 값은 퍼센트 숫자 또는 고정값(§0.1) · pow 면 값 × GROWTH.item^(ilvl−1).
// 문면은 strings.ko.js 의 afx.<id>.line · afx.<id>.p(접두어) / afx.<id>.s(접미어).

/** @typedef {import('../types.js').ItemAffixDef} ItemAffixDef */

export const AFFIX_TIERS = { minIlvl: [1, 6, 12, 18, 24], weight: [100, 70, 45, 25, 12] };   // 🔒 §7.14

const W = 'mainHand', O = 'offhand', H = 'helm', C = 'chest', G = 'gloves', B = 'boots', T = 'belt', A = 'amulet', R = 'ring';
const ELEM = [[4, 7], [7, 10], [10, 14], [14, 19], [19, 25]];
const RES = [[4, 7], [7, 11], [11, 15], [15, 20], [20, 26]];
const MAIN = [[4, 8], [9, 15], [16, 25], [26, 38], [39, 55]];

/** @type {ItemAffixDef[]} */
export const ITEM_AFFIXES = [
  { id: 'str', kind: 'prefix', stat: 'str', main: 'str', slots: [W, O, H, C, G, B, T, A, R], weight: 100, scale: 'flat', tiers: MAIN, decimals: 0 },
  { id: 'int', kind: 'prefix', stat: 'int', main: 'int', slots: [W, O, H, C, G, B, T, A, R], weight: 100, scale: 'flat', tiers: MAIN, decimals: 0 },
  { id: 'vit', kind: 'suffix', stat: 'vit', slots: [O, H, C, G, B, T, A, R], weight: 100, scale: 'flat', tiers: [[3, 6], [7, 12], [13, 20], [21, 30], [31, 45]], decimals: 0 },
  { id: 'weaponDmg', kind: 'prefix', stat: 'weaponDmgPct', slots: [W], weight: 150, scale: 'flat', tiers: [[8, 14], [15, 22], [23, 32], [33, 45], [46, 60]], decimals: 0 },
  { id: 'attackSpeed', kind: 'suffix', stat: 'attackSpeedPct', slots: [W, G, A, R], weight: 60, scale: 'flat', tiers: [[3, 5], [5, 7], [7, 9], [9, 11], [11, 13]], decimals: 0 },
  { id: 'critChance', kind: 'prefix', stat: 'critChance', slots: [O, H, G, A, R], weight: 70, scale: 'flat', tiers: [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6]], decimals: 1 },
  { id: 'critDamage', kind: 'suffix', stat: 'critDamage', slots: [W, G, A, R], weight: 70, scale: 'flat', tiers: [[8, 14], [14, 20], [20, 28], [28, 38], [38, 50]], decimals: 0 },
  { id: 'physDmg', kind: 'prefix', stat: 'physPct', slots: [W, O, G, A, R], weight: 40, scale: 'flat', tiers: ELEM, decimals: 0 },
  { id: 'fireDmg', kind: 'prefix', stat: 'firePct', slots: [W, O, G, A, R], weight: 40, scale: 'flat', tiers: ELEM, decimals: 0 },
  { id: 'coldDmg', kind: 'prefix', stat: 'coldPct', slots: [W, O, G, A, R], weight: 40, scale: 'flat', tiers: ELEM, decimals: 0 },
  { id: 'lightningDmg', kind: 'prefix', stat: 'lightningPct', slots: [W, O, G, A, R], weight: 40, scale: 'flat', tiers: ELEM, decimals: 0 },
  { id: 'skillDmg', kind: 'prefix', stat: 'skillPct', param: 'skill', slots: [O, H, C, B, A], weight: 60, scale: 'flat', tiers: [[8, 12], [12, 16], [16, 22], [22, 28], [28, 36]], decimals: 0 },
  { id: 'cdr', kind: 'suffix', stat: 'cdr', slots: [O, H, G, A, R], weight: 40, scale: 'flat', tiers: [[2, 3], [3, 4], [4, 5], [5, 6], [6, 8]], decimals: 1 },
  { id: 'costReduce', kind: 'suffix', stat: 'costReduce', slots: [O, H, T, R], weight: 40, scale: 'flat', tiers: [[3, 5], [5, 7], [7, 9], [9, 11], [11, 14]], decimals: 0 },
  { id: 'lifePct', kind: 'suffix', stat: 'lifePct', slots: [O, C, T, A], weight: 60, scale: 'flat', tiers: [[3, 5], [5, 7], [7, 9], [9, 11], [11, 14]], decimals: 0 },
  { id: 'lifeRegen', kind: 'suffix', stat: 'lifeRegen', slots: [H, C, T, A, R], weight: 50, scale: 'pow', tiers: [[0.6, 1.0], [1.0, 1.6], [1.6, 2.4], [2.4, 3.4], [3.4, 4.6]], decimals: 1 },
  { id: 'lifeOnHit', kind: 'suffix', stat: 'lifeOnHit', slots: [W, G, A, R], weight: 50, scale: 'pow', tiers: [[0.4, 0.8], [0.8, 1.3], [1.3, 2.0], [2.0, 2.8], [2.8, 3.8]], decimals: 1 },
  { id: 'armor', kind: 'prefix', stat: 'armor', slots: [O, H, C, G, B, T], weight: 100, scale: 'pow', tiers: [[3, 6], [6, 10], [10, 15], [15, 21], [21, 28]], decimals: 0 },
  { id: 'allRes', kind: 'suffix', stat: 'allRes', slots: [O, H, C, G, B, T, A, R], weight: 50, scale: 'pow', tiers: [[2, 3], [3, 5], [5, 7], [7, 9], [9, 12]], decimals: 0 },
  { id: 'physRes', kind: 'suffix', stat: 'physRes', slots: [O, H, C, G, B, T, A, R], weight: 35, scale: 'pow', tiers: RES, decimals: 0 },
  { id: 'fireRes', kind: 'suffix', stat: 'fireRes', slots: [O, H, C, G, B, T, A, R], weight: 35, scale: 'pow', tiers: RES, decimals: 0 },
  { id: 'coldRes', kind: 'suffix', stat: 'coldRes', slots: [O, H, C, G, B, T, A, R], weight: 35, scale: 'pow', tiers: RES, decimals: 0 },
  { id: 'lightningRes', kind: 'suffix', stat: 'lightningRes', slots: [O, H, C, G, B, T, A, R], weight: 35, scale: 'pow', tiers: RES, decimals: 0 },
  { id: 'moveSpeed', kind: 'prefix', stat: 'moveSpeed', slots: [B], weight: 120, scale: 'flat', tiers: [[4, 6], [6, 8], [8, 10], [10, 12], [12, 15]], decimals: 0 },
  { id: 'aoeDmg', kind: 'prefix', stat: 'aoePct', slots: [C, G, A], weight: 40, scale: 'flat', tiers: [[3, 5], [5, 8], [8, 11], [11, 14], [14, 18]], decimals: 0 },
  { id: 'eliteDmg', kind: 'prefix', stat: 'elitePct', slots: [W, A, R], weight: 40, scale: 'flat', tiers: [[3, 5], [5, 7], [7, 10], [10, 13], [13, 16]], decimals: 0 },
  { id: 'thorns', kind: 'suffix', stat: 'thorns', slots: [O, C, T], weight: 40, scale: 'pow', tiers: [[2, 4], [4, 7], [7, 11], [11, 16], [16, 22]], decimals: 0 },
  { id: 'goldFind', kind: 'suffix', stat: 'goldFind', slots: [H, T, A, R], weight: 40, scale: 'flat', tiers: [[5, 10], [10, 15], [15, 22], [22, 30], [30, 40]], decimals: 0 },
  { id: 'magicFind', kind: 'suffix', stat: 'magicFind', slots: [H, B, A, R], weight: 40, scale: 'flat', tiers: [[4, 7], [7, 10], [10, 14], [14, 19], [19, 25]], decimals: 0 },
  { id: 'xpPct', kind: 'suffix', stat: 'xpPct', slots: [H, A, R], weight: 30, scale: 'flat', tiers: [[2, 3], [3, 5], [5, 7], [7, 9], [9, 12]], decimals: 0 },
  { id: 'potionPct', kind: 'suffix', stat: 'potionPct', slots: [T, A], weight: 40, scale: 'flat', tiers: [[5, 10], [10, 15], [15, 20], [20, 25], [25, 30]], decimals: 0 },
  { id: 'globePct', kind: 'suffix', stat: 'globePct', slots: [B, T, R], weight: 40, scale: 'flat', tiers: [[5, 10], [10, 20], [20, 30], [30, 40], [40, 50]], decimals: 0 },
];
