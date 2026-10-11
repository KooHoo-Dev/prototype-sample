// OWNER: P5 — 계약 §6.10 · §5.13
// STUB — W1 에서 P5 가 채운다(이론 확률 — 분석 패널 「이론값」 · 테스트). W0: 균등 분포 모양 · effectiveMF 는 완성
// 순수 함수.

import { ITEM_SLOTS, RARITIES } from '../../core/constants.js';
import { MF } from '../../data/drops.js';

/** @param {readonly string[]} keys @returns {Record<string, number>} */
function uniform(keys) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const k of keys) out[k] = 1 / keys.length;
  return out;
}

/** 유효 아이템 발견(수확 체감) = mf × k / (mf + k) · mf 는 비율(1.0 = 100%) @param {number} mf */
export function effectiveMF(mf) {
  const m = mf > 0 ? mf : 0;
  return m === 0 ? 0 : (m * MF.k) / (m + MF.k);
}

/** STUB — 등급 분포(합 1) @param {{rank:string, level:number, mf?:number, blp?:number, blpOn?:boolean, guaranteed?:boolean}} opts */
export function rarityDist({ rank, level, mf = 0, blp = 0, blpOn = false, guaranteed = false }) {
  return /** @type {Record<import('../../types.js').Rarity, number>} */ (uniform(RARITIES));
}

/** STUB — 한 번 뽑기 확률 @param {string} rank */
export function tcDist(rank) {
  return /** @type {{none:number, gold:number, potion:number, globe:number, material:number, gear:number}} */ (uniform(['none', 'gold', 'potion', 'globe', 'material', 'gear']));
}

/** STUB — 처치 하나의 기대값 @param {{rank:string, level:number, mf?:number}} opts */
export function expectedPerKill({ rank, level, mf = 0 }) {
  /** @type {Record<string, number>} */
  const byRarity = {};
  for (const r of RARITIES) byRarity[r] = 0;
  return { gear: 0, gold: 0, goldAmount: 0, potion: 0, globe: 0, material: 0, byRarity };
}

/** STUB — 부위 분포 @param {string} cls */
export function slotDist(cls) {
  return /** @type {Record<import('../../types.js').ItemSlot, number>} */ (uniform(ITEM_SLOTS));
}

/** STUB — 옵션 수 분포 @param {string} rarity @returns {Record<number, number>} */
export function affixCountDist(rarity) {
  return { 0: 1 };
}

/** STUB — 티어 분포 [p1..p5] @param {number} ilvl @returns {number[]} */
export function tierDist(ilvl) {
  return [0.2, 0.2, 0.2, 0.2, 0.2];
}
