// OWNER: P2 — 계약 §6.8 · §5.6 · §5.8
// STUB — W1 에서 P2 가 채운다(피해 식 · 적중 적용(양방향) · 회복 · 화상 틱). W0: 대상만 찾고 피해 0 · 플레이어 쪽은 무시(ignored) · DRa/DRr 는 완성(stats.js 를 다시 내보낸다)
// combat.js 는 player/* · monsters/* · rift.js · drops.js 를 import 하지 않는다 — 피격 · 사망 뒤의 훅은 ctx.hooks 로 부른다(§2.2).

import { monstersIn } from './entities.js';

export { DRa, DRr } from './loot/stats.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').MonsterState} MonsterState */
/** @typedef {import('../types.js').HitResult} HitResult */
/** @typedef {import('../types.js').PlayerHitResult} PlayerHitResult */

/** @param {number} monId @returns {HitResult} */
const zeroHit = (monId) => ({ monId, dmg: 0, crit: false, killed: false, immune: false, blocked: false });
/** @returns {PlayerHitResult} */
const ignoredHit = () => ({ dmg: 0, absorbed: 0, blocked: false, killed: false, ignored: true });

/** STUB — 플레이어 → 몬스터 적중 하나(§5.6) @param {SimCtx} ctx @param {MonsterState} mon @param {import('../types.js').PlayerHitSpec} spec @returns {HitResult} */
export function playerHit(ctx, mon, spec) {
  return zeroHit(mon?.id ?? -1);
}

/** STUB — 모양 적중(monstersIn · 가까운 순 · maxTargets) @param {SimCtx} ctx @param {import('../types.js').Shape} shape @param {import('../types.js').PlayerHitSpec} spec @returns {HitResult[]} */
export function playerHitShape(ctx, shape, spec) {
  return monstersIn(ctx, shape).map(m => zeroHit(m.id));
}

/** STUB — 몬스터 → 플레이어(§5.6) @param {SimCtx} ctx @param {MonsterState|null} mon @param {import('../types.js').MonAttackSpec} spec @returns {PlayerHitResult} */
export function monsterHitPlayer(ctx, mon, spec) {
  return ignoredHit();
}

/** STUB — 바닥 효과 · 출처 없는 투사체 → 플레이어 @param {SimCtx} ctx @param {import('../types.js').MonAttackSpec} spec @returns {PlayerHitResult} */
export function hazardHitPlayer(ctx, spec) {
  return ignoredHit();
}

/** STUB — 화상 · 가시 · 폭발(치명타 · 보너스 없음 · 저항만 · HIT{dot}) @param {SimCtx} ctx @param {MonsterState} mon @param {number} amount @param {string} type @param {string} [by] @returns {HitResult} */
export function damageMonsterRaw(ctx, mon, amount, type, by = 'player') {
  return zeroHit(mon?.id ?? -1);
}

/** STUB — 화상 틱(§5.1-6) @param {SimCtx} ctx */
export function tickBurns(ctx) {}

/** STUB — PLAYER_HEAL(source 'hit' 이면 이벤트 없음) @param {SimCtx} ctx @param {number} amount @param {string} source */
export function healPlayer(ctx, amount, source) {}

/** STUB @param {SimCtx} ctx @param {MonsterState} mon @param {number} amount */
export function healMonster(ctx, mon, amount) {}
