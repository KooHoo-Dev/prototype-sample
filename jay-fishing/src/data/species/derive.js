// OWNER: P0 — 계약 §7.3.4 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// SpeciesRow → SpeciesDef: 로그정규 길이 · W = a·L^b · 트로피/레전드 문턱 · 가격 배율.

import { normalInv, sizeModelFromRange } from '../../core/stats.js';
import { PRICE } from '../economy.js';

/** @typedef {import('../../types.js').SpeciesRow} SpeciesRow */
/** @typedef {import('../../types.js').SpeciesDef} SpeciesDef */

const Z_TROPHY = normalInv(PRICE.trophyPct);   // 90 퍼센타일 ≈ 1.28155
const Z_LEGEND = normalInv(PRICE.legendPct);   // 99 퍼센타일 ≈ 2.32635

/** @param {SpeciesRow} row @returns {SpeciesDef} */
export function deriveSpecies(row) {
  const size = sizeModelFromRange(row.lenCm, row.kg);
  const { mu, sigma, a, b } = size;
  const weightAt = (cm) => a * Math.pow(cm, b);
  const medianCm = Math.exp(mu);
  const trophyCm = Math.exp(mu + Z_TROPHY * sigma);
  const legendCm = Math.exp(mu + Z_LEGEND * sigma);
  const trophy = 2 + row.trophyBonus;
  const legend = PRICE.legendTargetRatio * trophy / Math.exp(PRICE.dzLegendTrophy * b * sigma);
  return {
    ...row,
    size,
    medianCm,
    medianKg: weightAt(medianCm),
    trophyKg: weightAt(trophyCm),
    legendKg: weightAt(legendCm),
    trophyCm,
    legendCm,
    priceMul: { normal: 1, trophy, legend },
  };
}
