// OWNER: P3 — 계약 §6.9 · §5.17 · §8.1 · §8.2
// STUB — W1 에서 P3 이 채운다(깨우기/잠재우기 · 흐름장 이동 · 밀어내기 · 공격 진행 · 훅 호출 · 상한). W0: no-op
// ctx.hooks 의 onMonSpawn · onMonDamaged · onMonDeath · onMonHitPlayer 를 구현한다. spawn.js 의 넷을 다시 내보낸다.

export { monsterStats, spawnMonster, startAttack, findGuardianSpot } from './spawn.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').MonsterState} MonsterState */

/** STUB — §5.17 몬스터 한 틱 @param {SimCtx} ctx */
export function updateMonsters(ctx) {}

/** STUB — 팩 깨우기 · MON_WAKE @param {SimCtx} ctx @param {number} packId @param {'sight'|'damage'|'link'|'debug'} why */
export function wakePack(ctx, packId, why) {}

/** STUB — ctx.hooks 구현: 속성 onSpawn @param {SimCtx} ctx @param {MonsterState} mon */
export function onMonSpawn(ctx, mon) {}

/** STUB — ctx.hooks 구현: 팩 깨움 · 시전 끊기 · 속성 onDamaged @param {SimCtx} ctx @param {MonsterState} mon @param {import('../../types.js').HitResult} hit @param {Object} spec */
export function onMonDamaged(ctx, mon, hit, spec) {}

/** STUB — ctx.hooks 구현: 속성 onHitPlayer @param {SimCtx} ctx @param {MonsterState} mon @param {import('../../types.js').PlayerHitResult} res @param {import('../../types.js').MonAttackSpec} spec */
export function onMonHitPlayer(ctx, mon, res, spec) {}

/** STUB — ctx.hooks 구현: 속성 onDeath · 행동 훅 death · 팩 정리 @param {SimCtx} ctx @param {MonsterState} mon */
export function onMonDeath(ctx, mon) {}

/** STUB — 수호자 출현(GUARDIAN_IMPLS[rift.guardianType].init) @param {SimCtx} ctx @param {number} x @param {number} z @returns {MonsterState|null} */
export function spawnGuardian(ctx, x, z) { return null; }
