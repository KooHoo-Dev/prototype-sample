// OWNER: P1 — 계약 §6.5 · §5.4
// 입질 모델 — 층 · 가중치 · 위험률 · 어종 뽑기(판타지 섞기). 전부 순수(ctx 없이).

import { clamp, piecewise } from '../../core/math.js';
import { BAND_IDS, LAYER_IDS } from '../../core/constants.js';
import { BITE, LAYER } from '../../data/bite.js';
import { WEATHER } from '../../data/weather.js';
import { getSpecies } from '../../data/species/index.js';

/** @typedef {import('../../types.js').SpotDef} SpotDef */
/** @typedef {import('../../types.js').LayerId} LayerId */
/** @typedef {import('../../types.js').SetId} SetId */
/** @typedef {import('../../types.js').SpeciesDef} SpeciesDef */
/** @typedef {import('../../types.js').WeatherDef} WeatherDef */
/** @typedef {{entries:Array<{speciesId:string, w:number}>, total:number, fantasy:string[]}} BiteWeights */

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
 * 날씨 인자는 WeatherId 문자열 · WeatherDef · WeatherState({current}) 어느 것이든 받는다(호출자마다 들고 있는 것이 다르다).
 * @param {any} w @returns {WeatherDef}
 */
function weatherDef(w) {
  if (typeof w === 'string') return WEATHER[w] || WEATHER.clear;
  if (w && typeof w === 'object') {
    if (typeof w.current === 'string') return WEATHER[w.current] || WEATHER.clear;
    if (typeof w.biteMul === 'number') return w;
    if (typeof w.id === 'string' && WEATHER[w.id]) return WEATHER[w.id];
  }
  return WEATHER.clear;
}

/** 선호 미끼 순번 → BITE.baitFit[i], 없으면 BITE.baitOther @param {SpeciesDef} s @param {string|null} baitId */
export function baitFitOf(s, baitId) {
  const i = baitId ? s.baits.indexOf(/** @type {any} */ (baitId)) : -1;
  return i >= 0 && i < BITE.baitFit.length ? BITE.baitFit[i] : BITE.baitOther;
}

/** 어종 서식층과 미끼 층의 최소 순번 차 → BITE.layerFit @param {SpeciesDef} s @param {LayerId} layer */
function layerFitOf(s, layer) {
  const li = LAYER_IDS.indexOf(layer);
  let best = LAYER_IDS.length;
  for (const l of s.layers) {
    const d = Math.abs(LAYER_IDS.indexOf(l) - li);
    if (d < best) best = d;
  }
  return BITE.layerFit[Math.min(best, BITE.layerFit.length - 1)];
}

/**
 * §5.4.2 가중치. entries 의 w 는 rigStats.lineBiteMul 까지 곱한 값이고 total = Σ w(= W).
 * fantasy 는 지금 조건(band ∈ fantasy.bands && 날씨 ∈ fantasy.weather)을 만족하는 풀의 판타지 어종.
 * @param {{spot:SpotDef, band:string, weather:any, layer:LayerId, baitId:string|null, rigStats:Object, distM?:number}} args
 * @returns {BiteWeights}
 */
export function biteWeights({ spot, band, weather, layer, baitId, rigStats, distM = 0 }) {
  const wd = weatherDef(weather);
  const bandIdx = BAND_IDS.indexOf(/** @type {any} */ (band));
  const stepUp = wd.dayBandStep > 0 && (band === 'morning' || band === 'day');
  const far = spot.farFromM != null && distM >= spot.farFromM;
  const rs = /** @type {any} */ (rigStats);
  const hookSize = rs.hookSize;
  const lineMul = rs.lineBiteMul ?? 1;
  /** @type {Array<{speciesId:string, w:number}>} */
  const entries = [];
  /** @type {string[]} */
  const fantasy = [];
  let total = 0;
  for (const p of spot.pool) {
    const s = getSpecies(p.id);
    if (s.fantasy) {
      if (s.fantasy.bands.includes(/** @type {any} */ (band)) && s.fantasy.weather.includes(/** @type {any} */ (wd.id))) fantasy.push(s.id);
      continue;
    }
    let c = bandIdx >= 0 ? s.time[bandIdx] : '0';
    if (stepUp) c = BITE.stepUp[c];
    const hookFit = BITE.hookBigger[clamp(hookSize - s.mouth, 0, BITE.hookBigger.length - 1)];
    const farMul = far ? (p.farMul ?? 1) : 1;
    const w = p.w * BITE.timeCoef[c] * layerFitOf(s, layer) * baitFitOf(s, baitId) * hookFit * farMul * lineMul;
    entries.push({ speciesId: s.id, w });
    total += w;
  }
  return { entries, total, fantasy };
}

/**
 * §5.4.2 위험률(/s) = W × weather.biteMul × rigStats.biteRateMul × (흘림 ×driftMul) × (봉돌 밀림 ×bottomSlipMul) / t0
 * @param {BiteWeights} weights
 * @param {{weather:any, rigStats:Object, drifting?:boolean, bottomSlip?:boolean}} opts @returns {number}
 */
export function biteRate(weights, { weather, rigStats, drifting = false, bottomSlip = false }) {
  const wd = weatherDef(weather);
  const rs = /** @type {any} */ (rigStats);
  const W = weights && weights.total > 0 ? weights.total : 0;
  return W * wd.biteMul * (rs.biteRateMul ?? 1) * (drifting ? BITE.driftMul : 1) * (bottomSlip ? BITE.bottomSlipMul : 1) / BITE.t0;
}

/** 평균 대기 = BITE.minWait + 1/rate (rate 0 이면 Infinity) @param {number} rate @returns {number} */
export function meanWait(rate) {
  return rate > 0 ? BITE.minWait + 1 / rate : Infinity;
}

/**
 * §5.4.3 어종 뽑기. 조건을 만족하는 판타지 어종이 있으면 그중 하나를 균등으로 고르고
 * rng.chance(fantasyShare × clamp(baitFit, fantasyBaitFloor, 1)) 이면 그 어종 — 위험률은 바꾸지 않는다.
 * 아니면 w 비례. 비판타지 가중치가 0 이고 판타지도 안 걸리면 null.
 * @param {import('../../core/rng.js').Rng} rng @param {BiteWeights} weights @param {string|null} baitId
 * @returns {string|null}
 */
export function pickSpecies(rng, weights, baitId) {
  const F = weights.fantasy;
  if (F.length) {
    const f = F.length === 1 ? F[0] : F[rng.int(0, F.length - 1)];
    const fit = clamp(baitFitOf(getSpecies(f), baitId), BITE.fantasyBaitFloor, 1);
    if (rng.chance(BITE.fantasyShare * fit)) return f;
  }
  if (!(weights.total > 0)) return null;
  let r = rng.next() * weights.total;
  let last = null;
  for (const e of weights.entries) {
    if (!(e.w > 0)) continue;
    last = e.speciesId;
    r -= e.w;
    if (r < 0) return e.speciesId;
  }
  return last;
}
