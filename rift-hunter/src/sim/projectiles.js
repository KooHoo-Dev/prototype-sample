// OWNER: P2 — 계약 §6.8 · §3.7(Proj)
// STUB — W0 에 완성으로 내는 것: spawnProjectile · updateProjectiles 는 W1 에서 P2 가 채운다(W0: 시간이 다 된 것에 PROJ_END expire 만 — 배열에서는 removeMarked 가 뺀다)

import { EV } from '../core/events.js';
import { ticks } from '../core/time.js';
import { addProj } from './entities.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').Proj} Proj */

/**
 * 투사체 하나 → Proj · PROJ_SPAWN. 속도: vx · vz 가 있으면 그대로, 아니면 facing × speed. 수명: life(초)가 있으면 그것, 아니면 range / speed.
 * @param {SimCtx} ctx
 * @param {{visual:string, owner:'player'|'mon', srcId:number, x:number, z:number, facing?:number, vx?:number, vz?:number, speed?:number,
 *   range?:number, life?:number, r:number, pierce?:number, bounce?:boolean, spec:Object, explode?:{r:number, spec:Object, visual:string}|null}} def
 * @returns {Proj}
 */
export function spawnProjectile(ctx, def) {
  const tick = ctx.state.tick;
  let vx, vz;
  if (typeof def.vx === 'number' && typeof def.vz === 'number') {
    vx = def.vx;
    vz = def.vz;
  } else {
    const f = def.facing ?? 0;
    const sp = def.speed ?? 0;
    vx = Math.sin(f) * sp;
    vz = Math.cos(f) * sp;
  }
  const speed = Math.hypot(vx, vz);
  const lifeSec = typeof def.life === 'number' ? def.life : speed > 0 ? (def.range ?? 0) / speed : 0;
  /** @type {Proj} */
  const p = {
    id: ctx.nextId(),
    visual: def.visual,
    owner: def.owner,
    srcId: def.srcId,
    pos: { x: def.x, z: def.z },
    prevPos: { x: def.x, z: def.z },
    vel: { x: vx, z: vz },
    r: def.r,
    born: tick,
    until: tick + Math.max(1, ticks(lifeSec)),
    pierce: def.pierce ?? 0,
    hitIds: [],
    bounce: !!def.bounce,
    spec: def.spec ?? {},
    explode: def.explode ?? null,
  };
  addProj(ctx, p);
  ctx.emit(EV.PROJ_SPAWN, { id: p.id, visual: p.visual, owner: p.owner, x: p.pos.x, z: p.pos.z, vx, vz });
  return p;
}

/** STUB — 이동 → 벽 → 대상 겹침 → 적중 · 관통 · 폭발 → PROJ_END. W0: 이번 틱에 수명이 끝난 것에 PROJ_END expire 만 @param {SimCtx} ctx */
export function updateProjectiles(ctx) {
  const rift = ctx.state.rift;
  if (!rift) return;
  const tick = ctx.state.tick;
  for (let i = 0, n = rift.projs.length; i < n; i++) {
    const p = rift.projs[i];
    if (p.until === tick) ctx.emit(EV.PROJ_END, { id: p.id, visual: p.visual, x: p.pos.x, z: p.pos.z, reason: 'expire' });
  }
}
