// OWNER: P5 — 계약 §6.10 · §10.9
// STUB — W1 에서 P5 가 채운다(드랍 시뮬레이터 집계기 — 분석 패널 · 측정 · 테스트 공용). W0: 0 으로 채운 결과
// 순수 — 조각 실행(시간 예산)은 ui 쪽이 run(n) 을 나눠 부른다.

import { ITEM_SLOTS, RARITIES } from '../../core/constants.js';

/**
 * @typedef {Object} SimResult
 * @property {number} kills @property {number} gear @property {Record<string, number>} byRarity @property {Record<string, number>} bySlot
 * @property {Record<number, number>} affixCount @property {number[]} tiers   길이 5 @property {number} gold @property {number} goldAmount
 * @property {number[]} killsToLegendary   전설 사이 처치 수 목록 @property {number} maxGearGap
 */

/** @returns {SimResult} */
function emptyResult() {
  /** @type {Record<string, number>} */
  const byRarity = {};
  for (const r of RARITIES) byRarity[r] = 0;
  /** @type {Record<string, number>} */
  const bySlot = {};
  for (const s of ITEM_SLOTS) bySlot[s] = 0;
  return { kills: 0, gear: 0, byRarity, bySlot, affixCount: {}, tiers: [0, 0, 0, 0, 0], gold: 0, goldAmount: 0, killsToLegendary: [], maxGearGap: 0 };
}

/**
 * STUB — @param {{rank:string, level:number, cls:string, mf?:number, blpOn?:boolean, seed?:number}} opts
 * @returns {{run:(n:number) => number, result:() => SimResult, reset:() => void}}
 */
export function createDropSim({ rank, level, cls, mf = 0, blpOn = true, seed = 1 }) {
  return {
    run(n) { return 0; },
    result() { return emptyResult(); },
    reset() {},
  };
}
