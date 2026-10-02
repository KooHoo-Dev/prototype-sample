// OWNER: P0 — 계약 §6.2 · §8.1 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 어종 레지스트리 — 스테이지 행 파일 셋을 이어 붙여 파생 값을 붙인다. 새 스테이지는 줄 하나.

import { LAKE_SPECIES } from './lake.js';
import { COAST_SPECIES } from './coast.js';
import { RIVER_SPECIES } from './river.js';
import { deriveSpecies } from './derive.js';

/** @typedef {import('../../types.js').SpeciesDef} SpeciesDef */

/** lake 12 · coast 12 · river 12 순서 @type {SpeciesDef[]} */
export const SPECIES = [...LAKE_SPECIES, ...COAST_SPECIES, ...RIVER_SPECIES].map(deriveSpecies);

/** @type {Record<string, SpeciesDef>} */
export const SPECIES_BY_ID = Object.fromEntries(SPECIES.map(s => [s.id, s]));

/** 없으면 throw(데이터 오류 — 테스트가 잡는다) @param {string} id @returns {SpeciesDef} */
export function getSpecies(id) {
  const s = SPECIES_BY_ID[id];
  if (!s) throw new Error(`unknown species: ${id}`);
  return s;
}

/** @param {string} stageId @returns {SpeciesDef[]} */
export function speciesOfStage(stageId) {
  return SPECIES.filter(s => s.stage === stageId);
}
