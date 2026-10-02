// OWNER: P2 — 계약 §6.6 · §5.3.3 · §8.2
// STUB — W0 스텁(§6.14): buildBrain = 성격 표 그대로(특성 미적용) · stepBrain no-op. P2 가 채운다.
// 어종 ID 문자열을 두지 않는다(§8.2).

import { STYLES } from '../../data/fightStyles.js';

/** @typedef {import('../../types.js').SpeciesDef} SpeciesDef */
/** @typedef {import('../../types.js').BehaviorStateDef} BehaviorStateDef */

/**
 * STUB — 성격 표 그대로(§8.2 의 특성 합치기는 P2).
 * @param {SpeciesDef} species
 * @returns {{start:string, states:Record<string, BehaviorStateDef>, abrasionMul:number, visual:string[]}}
 */
export function buildBrain(species) {
  const st = STYLES[species.style];
  return { start: st.start, states: structuredClone(st.states), abrasionMul: 1, visual: [] };
}

/**
 * STUB — §5.3.3 행동 상태 기계 한 틱.
 * @param {Object} fight FightState @param {Object} brain buildBrain 결과 @param {import('../../core/rng.js').Rng} rng
 * @param {number} dt @param {Object} ctx SimCtx @param {number} loose
 */
export function stepBrain(fight, brain, rng, dt, ctx, loose) {
  void fight; void brain; void rng; void dt; void ctx; void loose;
}
