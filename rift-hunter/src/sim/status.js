// OWNER: P2 — 계약 §6.8 · §5.8
// STUB — W1 에서 P2 가 채운다(상태 이상의 적용과 틱 · 버프 · 플레이어 감속 · 속박). W0: no-op · 배율 1
// status.js 는 combat.js 를 import 하지 않는다(화상 틱은 combat.js 의 tickBurns).

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').MonsterState} MonsterState */

/** STUB @param {SimCtx} ctx @param {MonsterState} mon @param {number} sec */
export function applyStun(ctx, mon, sec) {}
/** STUB @param {SimCtx} ctx @param {MonsterState} mon @param {number} pts */
export function applyChill(ctx, mon, pts) {}
/** STUB @param {SimCtx} ctx @param {MonsterState} mon @param {number} dps */
export function applyBurn(ctx, mon, dps) {}
/** STUB @param {SimCtx} ctx @param {MonsterState} mon */
export function applyShock(ctx, mon) {}
/** STUB @param {SimCtx} ctx @param {MonsterState} mon @param {number} pct @param {number} sec */
export function applySlow(ctx, mon, pct, sec) {}
/** STUB @param {SimCtx} ctx @param {MonsterState} mon @param {number} fromX @param {number} fromZ @param {number} dist */
export function applyKnock(ctx, mon, fromX, fromZ, dist) {}
/** STUB @param {SimCtx} ctx @param {MonsterState} mon */
export function applyFlinch(ctx, mon) {}
/** STUB @param {SimCtx} ctx @param {MonsterState} mon @param {number} sec */
export function setInvuln(ctx, mon, sec) {}
/** STUB @param {SimCtx} ctx @param {number} pct @param {number} sec */
export function slowPlayer(ctx, pct, sec) {}
/** STUB @param {SimCtx} ctx @param {number} sec */
export function rootPlayer(ctx, sec) {}
/** STUB @param {SimCtx} ctx @param {string} id @param {number} sec @param {number} value */
export function addBuff(ctx, id, sec, value) {}
/** STUB @param {SimCtx} ctx @param {string} id */
export function removeBuff(ctx, id) {}
/** STUB — §5.1-6 상태 틱 @param {SimCtx} ctx */
export function updateStatus(ctx) {}
/** STUB — 냉기 · 감속 · 속성 배율 → 이동 배율 @param {MonsterState} mon @param {number} tick */
export function monSpeedMul(mon, tick) { return 1; }
/** STUB @param {MonsterState} mon @param {number} tick */
export function monAtkSpeedMul(mon, tick) { return 1; }
