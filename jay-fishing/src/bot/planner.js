// OWNER: P10 — 계약 §6.8 · §12.1
// STUB — W0 스텁(§6.14): createPlanner = 목표 없음(null). P10 이 W2 에 채운다.

/** @typedef {{kind:'fish'|'sell'|'travel'|'buy'|'skill'|'sleep'|'walkTo'}} Goal */

/**
 * STUB
 * @param {'lakeDay'|'coastDay'|'riverDay'|'progress'|'stay'} planId @param {Object} [opts]
 * @returns {{next(state:Object, sim:Object): Goal|null}}
 */
export function createPlanner(planId, opts) {
  void planId; void opts;
  return { next: () => null };
}
