// OWNER: P1 — 계약 §6.5 · §5.4
// STUB — W0 스텁(§6.14): depthAt · layerAt 은 완성 · biteWeights = 빈 가중치 · biteRate 0 · meanWait Infinity · pickSpecies null. P1 이 채운다.
// 전부 순수(ctx 없이).

import { piecewise } from '../../core/math.js';
import { LAYER } from '../../data/bite.js';

/** @typedef {import('../../types.js').SpotDef} SpotDef */
/** @typedef {import('../../types.js').LayerId} LayerId */
/** @typedef {import('../../types.js').SetId} SetId */

/** 수심 프로필 꺾은선 보간(끝점 밖은 끝값) @param {SpotDef} spot @param {number} distM @returns {number} */
export function depthAt(spot, distM) {
  return piecewise(spot.depth, distM);
}

/**
 * §5.4.1 @param {SetId} set @param {number} waterDepth @param {number} floatDepth
 * @returns {{layer:LayerId, baitDepth:number}}
 */
export function layerAt(set, waterDepth, floatDepth) {
  if (set === 'bottom') return { layer: 'bottom', baitDepth: waterDepth };
  const baitDepth = Math.min(floatDepth, waterDepth);
  if (waterDepth - baitDepth <= LAYER.bottomGapM) return { layer: 'bottom', baitDepth };
  if (baitDepth <= Math.max(LAYER.surfaceMaxM, LAYER.surfaceFrac * waterDepth)) return { layer: 'surface', baitDepth };
  return { layer: 'mid', baitDepth };
}

/**
 * STUB — §5.4.2 가중치. distM 은 farMul.
 * @param {{spot:SpotDef, band:string, weather:string, layer:LayerId, baitId:string, rigStats:Object, distM?:number}} args
 * @returns {{entries:Array<{speciesId:string, w:number}>, total:number, fantasy:string[]}}
 */
export function biteWeights({ spot, band, weather, layer, baitId, rigStats, distM = 0 }) {
  void spot; void band; void weather; void layer; void baitId; void rigStats; void distM;
  return { entries: [], total: 0, fantasy: [] };
}

/**
 * STUB — 위험률(/s).
 * @param {{entries:Array, total:number, fantasy:string[]}} weights
 * @param {{weather:string, rigStats:Object, drifting:boolean, bottomSlip:boolean}} opts @returns {number}
 */
export function biteRate(weights, { weather, rigStats, drifting, bottomSlip }) {
  void weights; void weather; void rigStats; void drifting; void bottomSlip;
  return 0;
}

/** STUB — BITE.minWait + 1/rate (rate 0 이면 Infinity) @param {number} rate @returns {number} */
export function meanWait(rate) {
  void rate;
  return Infinity;
}

/**
 * STUB — §5.4.3 어종 뽑기(판타지 섞기).
 * @param {import('../../core/rng.js').Rng} rng @param {{entries:Array, total:number, fantasy:string[]}} weights @param {string} baitId
 * @returns {string|null}
 */
export function pickSpecies(rng, weights, baitId) {
  void rng; void weights; void baitId;
  return null;
}
