// OWNER: P0 — 계약 §6.2 · §8.3 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 스테이지 · 낚시 자리 레지스트리. 새 스테이지는 줄 하나 + SCENE_IDS · STAGE_IDS 에 이름 하나.

import { HOME } from './home.js';
import { LAKE } from './lake.js';
import { COAST } from './coast.js';
import { RIVER } from './river.js';

/** @typedef {import('../../types.js').StageDef} StageDef */
/** @typedef {import('../../types.js').SpotDef} SpotDef */

/** home · lake · coast · river @type {StageDef[]} */
export const STAGES = [HOME, LAKE, COAST, RIVER];

/** @type {Record<string, StageDef>} */
export const STAGES_BY_ID = Object.fromEntries(STAGES.map(s => [s.id, s]));

/** 없으면 throw @param {string} id @returns {StageDef} */
export function getStage(id) {
  const s = STAGES_BY_ID[id];
  if (!s) throw new Error(`unknown stage: ${id}`);
  return s;
}

/** @type {Record<string, SpotDef>} */
export const SPOTS_BY_ID = Object.fromEntries(STAGES.flatMap(s => s.spots.map(p => [p.id, p])));

const STAGE_OF_SPOT = Object.fromEntries(STAGES.flatMap(s => s.spots.map(p => [p.id, s.id])));

/** 없으면 throw @param {string} id @returns {SpotDef} */
export function getSpot(id) {
  const p = SPOTS_BY_ID[id];
  if (!p) throw new Error(`unknown spot: ${id}`);
  return p;
}

/** 없으면 throw @param {string} spotId @returns {'lake'|'coast'|'river'} */
export function stageOfSpot(spotId) {
  const s = STAGE_OF_SPOT[spotId];
  if (!s) throw new Error(`unknown spot: ${spotId}`);
  return /** @type {any} */ (s);
}
