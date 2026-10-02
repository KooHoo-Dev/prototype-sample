// OWNER: P2 — 계약 §6.4 「sim/combat/hitRegistry.js」
// 판정 등록부. 모듈 전역 상태를 두지 않는다 — 정본은 state.hitLog({hitId, target}[]).
import { COMBAT } from '../../data/combat.js';

/** @typedef {import('../../types.js').GameState} GameState */

/**
 * 같은 hitId × 대상이 이미 등록됐는가.
 * @param {GameState} state
 * @param {number} hitId
 * @param {'player'|'boss'|'dummy'} target
 * @returns {boolean}
 */
export function hasHit(state, hitId, target) {
  const log = state.hitLog;
  // 살아 있는 판정은 대개 최근 것이다 — 뒤에서부터 본다.
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.hitId === hitId && e.target === target) return true;
  }
  return false;
}

/**
 * 등록(push). 길이가 COMBAT.hitLogMax를 넘으면 앞에서 버린다.
 * @param {GameState} state
 * @param {number} hitId
 * @param {'player'|'boss'|'dummy'} target
 */
export function markHit(state, hitId, target) {
  const log = state.hitLog;
  log.push({ hitId, target });
  while (log.length > COMBAT.hitLogMax) log.shift();
}
