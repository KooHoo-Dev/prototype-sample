// OWNER: P0 — 계약 §6.2 (레지스트리)
// 세 보스 정의를 모아 다시 내보낸다. index → valder · fenrir · nihil 한 방향.
import { VALDER } from './valder.js';
import { FENRIR } from './fenrir.js';
import { NIHIL } from './nihil.js';

/** @typedef {import('../../types.js').BossDef} BossDef */
/** @typedef {import('../../types.js').BossId} BossId */

/** @type {Record<BossId, BossDef>} */
export const BOSS_DEFS = { valder: VALDER, fenrir: FENRIR, nihil: NIHIL };

/**
 * @param {BossId} id
 * @returns {BossDef} 없는 id면 undefined
 */
export function getBossDef(id) {
  return BOSS_DEFS[id];
}
