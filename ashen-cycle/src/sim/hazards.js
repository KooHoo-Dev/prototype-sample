// OWNER: P2 — 계약 §3.6 · §5.1 H · I4 · §6.4 「sim/hazards.js」
// GameSim만 import 하는 패키지 내부 파일. 다른 패키지는 ctx.spawnHazard만 쓴다(GameSim이 감싸 제공한다).
import { EV } from '../core/events.js';
import { EPS } from '../core/constants.js';
import { angleDiff, clamp01, lerp } from '../core/math2d.js';
import { resolveShape, ringFromGrow, shapeHitsCircle } from '../core/hitShapes.js';
import { resolveHitOnPlayer } from './combat/damage.js';
import { hasHit } from './combat/hitRegistry.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').HazardSpec} HazardSpec */
/** @typedef {import('../types.js').Hazard} Hazard */
/** @typedef {import('../types.js').HitShape} HitShape */
/** @typedef {import('../types.js').ShapeDef} ShapeDef */
/** @typedef {import('../types.js').OutgoingHit} OutgoingHit */

/** @param {SimCtx} ctx @param {Hazard} h */
function activate(ctx, h) {
  h.state = 'active';
  h.t = 0;
  h.nextTick = h.interval;
  ctx.emit(EV.HAZARD_ACTIVATED, { id: h.id, kind: h.kind, style: h.style, shape: { ...h.shape } });
}

/**
 * 월드 셰이프를 장판 원점 · 방향 기준의 상대 셰이프로 되돌린다(OutgoingHit.shapeDef용 — resolveShape의 역).
 * @param {HitShape} shape
 * @param {number} ox
 * @param {number} oz
 * @param {number} facing
 * @returns {ShapeDef}
 */
function toShapeDef(shape, ox, oz, facing) {
  const s = Math.sin(facing);
  const c = Math.cos(facing);
  switch (shape.type) {
    case 'ring':
      return { type: 'ring', rInner: shape.rInner, rOuter: shape.rOuter };
    case 'arc':
      return {
        type: 'arc', r: shape.r, rInner: shape.rInner, halfAngle: shape.halfAngle, dirOffset: angleDiff(facing, shape.dir),
      };
    case 'circle': {
      const dx = shape.x - ox;
      const dz = shape.z - oz;
      return { type: 'circle', r: shape.r, fwd: dx * s + dz * c, side: dz * s - dx * c };
    }
    default: {
      const ax = shape.ax - ox;
      const az = shape.az - oz;
      const bx = shape.bx - ox;
      const bz = shape.bz - oz;
      return { type: 'capsule', fwd0: ax * s + az * c, fwd1: bx * s + bz * c, side: az * s - ax * c, r: shape.r };
    }
  }
}

/**
 * state.hazards에 넣고 HAZARD_SPAWNED를 낸다. warn 동안 state 'warn'(텔레그래프만) → 'active'(HAZARD_ACTIVATED)
 * → active 뒤 제거(HAZARD_ENDED{reason:'expire'}). warn === 0이면 바로 active.
 * shape는 resolveShape(spec.shape, x, z, facing), grow면 ringFromGrow(x, z, spec.grow, 0).
 * Hazard에 facing(생성 시 방향)을 덧붙여 둔다 — OutgoingHit.facing의 출처.
 * @param {SimCtx} ctx
 * @param {HazardSpec} spec
 * @param {number} x
 * @param {number} z
 * @param {number} facing
 * @param {number} damageMul
 * @returns {Hazard}
 */
export function spawnHazard(ctx, spec, x, z, facing, damageMul) {
  const grow = spec.grow ? { r0: spec.grow.r0, r1: spec.grow.r1, width: spec.grow.width } : null;
  /** @type {Hazard & {facing:number}} */
  const h = {
    id: ctx.nextHitId(),
    kind: spec.kind,
    style: spec.style,
    state: 'warn',
    t: 0,
    warn: spec.warn,
    active: spec.active,
    interval: spec.interval,
    shape: grow ? ringFromGrow(x, z, grow, 0) : resolveShape(spec.shape, x, z, facing),
    damage: spec.damage * damageMul,
    guardable: spec.guardable,
    knockdown: spec.knockdown,
    hitId: ctx.nextHitId(),
    nextTick: spec.interval,
    grow,
    x,
    z,
    facing,
  };
  ctx.state.hazards.push(h);
  ctx.emit(EV.HAZARD_SPAWNED, {
    id: h.id, kind: h.kind, style: h.style, x, z, warn: h.warn, active: h.active, shape: { ...h.shape },
  });
  if (!(h.warn > 0)) activate(ctx, h);
  return h;
}

/**
 * §5.1 H — warn → active → 제거. interval > 0이면 반복 타격마다 새 hitId. grow면 shape의 띠를 매 틱 갱신.
 * @param {SimCtx} ctx
 * @param {number} dt
 */
export function updateHazards(ctx, dt) {
  const list = ctx.state.hazards;
  if (list.length === 0) return;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const h = list[i];
    h.t += dt;
    if (h.state === 'warn') {
      if (h.t >= h.warn - EPS) activate(ctx, h);
    } else {
      if (h.t >= h.active - EPS) {
        ctx.emit(EV.HAZARD_ENDED, { id: h.id, reason: 'expire' });
        continue;
      }
      if (h.interval > 0) {
        h.nextTick -= dt;
        if (h.nextTick <= EPS) {
          h.hitId = ctx.nextHitId();
          h.nextTick += h.interval;
        }
      }
      if (h.grow) {
        // 띠를 제자리에서 고친다(view가 같은 객체를 따라 그린다).
        const center = lerp(h.grow.r0, h.grow.r1, clamp01(h.t / h.active));
        const half = h.grow.width / 2;
        h.shape.rInner = Math.max(0, center - half);
        h.shape.rOuter = center + half;
      }
    }
    list[w++] = h;
  }
  list.length = w;
}

/**
 * §5.1 I4 — active 장판 → 플레이어. 장판은 항상 패링 불가다.
 * @param {SimCtx} ctx
 */
export function resolveHazards(ctx) {
  const state = ctx.state;
  const list = state.hazards;
  if (list.length === 0) return;
  const player = state.player;
  for (let i = 0; i < list.length; i++) {
    const h = list[i];
    if (h.state !== 'active') continue;
    // 판정은 Hazard.shape(이미 월드 공간)로 먼저 거른다 — 닿았고 아직 안 맞은 것만 판정 객체를 만든다.
    if (!shapeHitsCircle(h.shape, player.pos.x, player.pos.z, player.radius)) continue;
    if (hasHit(state, h.hitId, 'player')) continue;
    const facing = h.facing ?? 0;
    /** @type {OutgoingHit} */
    const hit = {
      source: 'hazard',
      attackId: h.kind,
      hitId: h.hitId,
      shapeDef: toShapeDef(h.shape, h.x, h.z, facing),
      x: h.x,
      z: h.z,
      facing,
      damage: h.damage,
      posture: 0,
      guardable: h.guardable,
      parryable: false,
      knockdown: h.knockdown,
      heavy: h.knockdown,
      execute: false,
      hitstop: 0,
    };
    resolveHitOnPlayer(ctx, hit);
  }
}

/**
 * 전부 제거 — HAZARD_ENDED{reason:'clear'}.
 * @param {SimCtx} ctx
 */
export function clearHazards(ctx) {
  const list = ctx.state.hazards;
  for (let i = 0; i < list.length; i++) ctx.emit(EV.HAZARD_ENDED, { id: list[i].id, reason: 'clear' });
  list.length = 0;
}
