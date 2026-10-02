// OWNER: P0 — 계약 §9.6 (레지스트리)
// index → 뷰 3개 한 방향. CharacterLayer가 MODE_CHANGED에서 부른다.
import { createValderView } from './valderView.js';
import { createFenrirView } from './fenrirView.js';
import { createNihilView } from './nihilView.js';

/** @typedef {import('../../types.js').BossView} BossView */
/** @typedef {import('../../types.js').BossId} BossId */

/** @type {Record<string, ()=>BossView>} */
const FACTORIES = { valder: createValderView, fenrir: createFenrirView, nihil: createNihilView };

/**
 * @param {BossId} bossId
 * @returns {BossView|null} 모르는 id면 null
 */
export function createBossView(bossId) {
  const make = FACTORIES[bossId];
  return make ? make() : null;
}
