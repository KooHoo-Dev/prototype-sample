// OWNER: P2 — 계약 §3.8(DummyState) · §5.1 K · §6.4 「플레이어 → 허수아비」
// GameSim만 import 하는 패키지 내부 파일. 타격 처리는 combat/damage.js의 resolveHitOnDummy가 한다.
import { COMBAT } from '../data/combat.js';

/** @typedef {import('../types.js').DummyState} DummyState */
/** @typedef {import('../types.js').WorldDef} WorldDef */
/** @typedef {import('../types.js').SimCtx} SimCtx */

/**
 * @param {WorldDef} world
 * @returns {DummyState|null} 월드에 허수아비가 없으면 null
 */
export function createDummyState(world) {
  if (!world.dummy) return null;
  return {
    x: world.dummy.x,
    z: world.dummy.z,
    radius: COMBAT.dummy.radius,
    lastDamage: 0,
    total: 0,
    sinceHit: 0,
  };
}

/**
 * 허수아비 타이머 — COMBAT.dummy.resetAfter 동안 맞지 않으면 누적 피해를 0으로(lastDamage는 남긴다).
 * @param {SimCtx} ctx
 * @param {number} dt
 */
export function updateDummy(ctx, dt) {
  const dummy = ctx.state.dummy;
  if (!dummy) return;
  const limit = COMBAT.dummy.resetAfter;
  if (dummy.sinceHit >= limit) return;
  dummy.sinceHit = Math.min(limit, dummy.sinceHit + dt);
  if (dummy.sinceHit >= limit) dummy.total = 0;
}
