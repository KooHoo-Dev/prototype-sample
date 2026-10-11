// OWNER: P2 — 계약 §6.8 · §5.9 · §3.7(Effect)
// STUB — W0 에 완성으로 내는 것: spawnEffect · updateEffects 와 위협 간격(H1~H5)은 W1 에서 P2 가 채운다(W0: no-op · canStartHazard true)

import { EV } from '../core/events.js';
import { ticks } from '../core/time.js';
import { addEffect } from './entities.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').Effect} Effect */

/**
 * 효과 하나 → Effect · EFFECT_SPAWN. 시각(틱): start = 지금 · hitAt = start + ticks(delay) · end = hitAt + max(1, ticks(dur))(dur 0 이면 판정 한 틱 뒤 끝) ·
 * tickT = ticks(tick) · nextTickAt = tickT > 0 ? hitAt + tickT : -1(첫 지속 판정 = hitAt + tickT)
 * @param {SimCtx} ctx
 * @param {{kind:string, owner:'player'|'mon'|'env', srcId:number, packId?:number, hostile:boolean, shape:import('../types.js').Shape, delay:number,
 *   dur?:number, tick?:number, spec:Object|null, tickSpec?:Object|null, from?:import('../types.js').Vec2|null, cancelOnSrcDeath?:boolean}} def
 *   delay · dur · tick 은 초
 * @returns {Effect}
 */
export function spawnEffect(ctx, def) {
  const now = ctx.state.tick;
  const delay = def.delay ?? 0;
  const dur = def.dur ?? 0;
  const tickT = ticks(def.tick ?? 0);
  const hitAt = now + ticks(delay);
  /** @type {Effect} */
  const e = {
    id: ctx.nextId(),
    kind: def.kind,
    owner: def.owner,
    srcId: def.srcId,
    packId: def.packId ?? -1,
    cancelOnSrcDeath: !!def.cancelOnSrcDeath,
    hostile: !!def.hostile,
    shape: { ...def.shape },
    start: now,
    hitAt,
    end: hitAt + Math.max(1, ticks(dur)),
    tickT,
    nextTickAt: tickT > 0 ? hitAt + tickT : -1,
    resolved: false,
    spec: def.spec ?? null,
    tickSpec: def.tickSpec ?? null,
    from: def.from ? { x: def.from.x, z: def.from.z } : null,
  };
  addEffect(ctx, e);
  ctx.emit(EV.EFFECT_SPAWN, { id: e.id, kind: e.kind, hostile: e.hostile, shape: { ...e.shape }, sec: delay, dur });
  return e;
}

/** STUB — 취소 검사 → hitAt 판정 → 지속 틱 → EFFECT_HIT @param {SimCtx} ctx */
export function updateEffects(ctx) {}

/**
 * STUB — §5.9 H1~H4(count = 이번에 만들 표식 수 · srcId 가 기절 · 빙결 중이면 false). W0: true
 * @param {SimCtx} ctx @param {number} packId @param {number} x @param {number} z @param {{jail?:boolean, count?:number, srcId?:number}} [opts]
 */
export function canStartHazard(ctx, packId, x, z, { jail = false, count = 1, srcId = -1 } = {}) {
  return true;
}

/** STUB — 팩 간격 기록 @param {SimCtx} ctx @param {number} packId */
export function noteHazard(ctx, packId) {}
