// OWNER: P1 — 계약 §6.5 · §5.4.5
// 크기 뽑기 — 물기 시점에 정한다. 「흥정」 외의 스킬 · 장비는 이 분포를 바꾸지 않는다.

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
 * §5.4.5 — z = pct 가 있으면 Φ⁻¹(clamp(pct)) 아니면 rng.normal() · [zMin, zMax] 로 자른다.
 * lengthCm = round1(exp(mu + sigma·z)) · weightKg = round3(a · L^b)(L 은 반올림 전) · pct = Φ(z).
 * @param {import('../../core/rng.js').Rng|null} rng @param {SpeciesDef} species @param {number|null} [pct]
 * @returns {FishRoll}
 */
export function rollFish(rng, species, pct) {
  const given = typeof pct === 'number' && Number.isFinite(pct);
  const pIn = given ? clamp(pct, BITE.pctMin, BITE.pctMax) : 0;
  let z = given ? normalInv(pIn) : rng ? rng.normal() : 0;
  if (!Number.isFinite(z)) z = 0;
  const zc = clamp(z, BITE.zMin, BITE.zMax);
  // pct = Φ(z). 퍼센타일을 받았고 z 가 잘리지 않았으면 Φ(Φ⁻¹(p)) = p 를 그대로 쓴다 — 근사 오차로 0.9 가 'normal' 이 되지 않게
  const p = given && zc === z ? pIn : normalCdf(zc);
  z = zc;
  const { mu, sigma, a, b } = species.size;
  const L = Math.exp(mu + sigma * z);
  return {
    speciesId: species.id,
    z,
    pct: p,
    lengthCm: round1(L),
    weightKg: round3(a * Math.pow(L, b)),
    tier: tierOf(p),
  };
}
