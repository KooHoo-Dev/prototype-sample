// OWNER: P0 — 계약 §6.5 (레지스트리)
// index → 훅 3개 한 방향. P3의 프레임워크는 레지스트리 대신 ctx.bossHooks를 읽는다 — 이 함수는 GameSim이 부른다.
import { valderHooks } from './valder.js';
import { fenrirHooks } from './fenrir.js';
import { nihilHooks } from './nihil.js';

/** @typedef {import('../../../types.js').BossHooks} BossHooks */
/** @typedef {import('../../../types.js').BossId} BossId */

/** @type {Record<string, BossHooks>} */
const HOOKS = { valder: valderHooks, fenrir: fenrirHooks, nihil: nihilHooks };

/**
 * @param {BossId} bossId
 * @returns {BossHooks} 없으면 {}
 */
export function getBossHooks(bossId) {
  return HOOKS[bossId] ?? {};
}
