// OWNER: P1 — 계약 §6.5 · §5.4.5
// STUB — W0 스텁(§6.14): rollFish = 중앙값 물고기(z 0 · pct 를 주면 그 퍼센타일) · tierOf = §5.4.5(완성). P1 이 채운다.

import { normalCdf, normalInv } from '../../core/stats.js';
import { clamp, round1, round3 } from '../../core/math.js';
import { BITE } from '../../data/bite.js';
import { PRICE } from '../../data/economy.js';

/** @typedef {import('../../types.js').FishRoll} FishRoll */
/** @typedef {import('../../types.js').SpeciesDef} SpeciesDef */
/** @typedef {import('../../types.js').Tier} Tier */

/** §5.4.5 @param {number} pct @returns {Tier} */
export function tierOf(pct) {
  return pct >= PRICE.legendPct ? 'legend' : pct >= PRICE.trophyPct ? 'trophy' : 'normal';
}

/**
 * STUB — 난수를 쓰지 않고 z 0(pct 를 주면 그 퍼센타일)의 물고기.
 * @param {import('../../core/rng.js').Rng} rng @param {SpeciesDef} species @param {number} [pct] @returns {FishRoll}
 */
export function rollFish(rng, species, pct) {
  void rng;
  let z = pct === undefined || pct === null ? 0 : normalInv(clamp(pct, 0.0005, 0.9995));
  z = clamp(z, BITE.zMin, BITE.zMax);
  const { mu, sigma, a, b } = species.size;
  const L = Math.exp(mu + sigma * z);
  const p = normalCdf(z);
  return {
    speciesId: species.id,
    z,
    pct: p,
    lengthCm: round1(L),
    weightKg: round3(a * Math.pow(L, b)),
    tier: tierOf(p),
  };
}
