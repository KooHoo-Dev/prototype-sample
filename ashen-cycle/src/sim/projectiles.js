// OWNER: P2 — 계약 §3.6 · §5.1 H · I3 · §6.4 「sim/projectiles.js」
// GameSim만 import 하는 패키지 내부 파일. 다른 패키지는 ctx.spawnProjectile만 쓴다(GameSim이 감싸 제공한다).
import { EV } from '../core/events.js';
import { angleOf, turnToward } from '../core/math2d.js';
import { circleOverlapsWorld } from '../core/collide.js';
import { resolveHitOnPlayer } from './combat/damage.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').ProjectileSpec} ProjectileSpec */
/** @typedef {import('../types.js').Projectile} Projectile */
/** @typedef {import('../types.js').OutgoingHit} OutgoingHit */

/** @param {SimCtx} ctx @param {Projectile} p @param {string} reason */
function emitEnded(ctx, p, reason) {
  ctx.emit(EV.PROJECTILE_ENDED, { id: p.id, kind: p.kind, style: p.style, x: p.x, z: p.z, y: p.y, reason });
}

/**
 * damage = spec.damage × damageMul. state.projectiles에 넣고 PROJECTILE_SPAWNED를 낸다.
 * @param {SimCtx} ctx
 * @param {ProjectileSpec} spec
 * @param {number} x
 * @param {number} z
 * @param {number} dir 진행 방향(rad)
 * @param {number} damageMul
 * @returns {Projectile}
 */
export function spawnProjectile(ctx, spec, x, z, dir, damageMul) {
  /** @type {Projectile} */
  const p = {
    id: ctx.nextHitId(),
    kind: spec.kind,
    style: spec.style,
    x,
    z,
    prevX: x, // 스폰 순간에는 prev도 같이 쓴다(§5.4 순간 이동 규칙)
    prevZ: z,
    y: spec.y,
    dir,
    speed: spec.speed,
    r: spec.r,
    age: 0,
    life: spec.life,
    homing: spec.homing,
    homingTime: spec.homingTime,
    damage: spec.damage * damageMul,
    guardable: spec.guardable,
    parryable: spec.parryable,
    knockdown: spec.knockdown,
    hitId: ctx.nextHitId(),
  };
  ctx.state.projectiles.push(p);
  ctx.emit(EV.PROJECTILE_SPAWNED, { id: p.id, kind: p.kind, style: p.style, x, z, y: p.y });
  return p;
}

/**
 * §5.1 H — 유도(homingTime 동안 플레이어 쪽으로 homing rad/s) 후 전진 · 수명('expire').
 * @param {SimCtx} ctx
 * @param {number} dt
 */
export function updateProjectiles(ctx, dt) {
  const list = ctx.state.projectiles;
  if (list.length === 0) return;
  const player = ctx.state.player;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.homing > 0 && p.age < p.homingTime) {
      p.dir = turnToward(p.dir, angleOf(player.pos.x - p.x, player.pos.z - p.z), p.homing * dt);
    }
    p.x += Math.sin(p.dir) * p.speed * dt;
    p.z += Math.cos(p.dir) * p.speed * dt;
    p.age += dt;
    if (p.age >= p.life) {
      emitEnded(ctx, p, 'expire');
      continue;
    }
    list[w++] = p;
  }
  list.length = w;
}

/**
 * §5.1 I3 — 투사체 → 플레이어(판정이 나면 소멸: reason = outcome) · 콜라이더 · 경계('wall').
 * 무적으로 흘린 투사체(dodge)는 그대로 지나간다.
 * @param {SimCtx} ctx
 */
export function resolveProjectiles(ctx) {
  const state = ctx.state;
  const list = state.projectiles;
  if (list.length === 0) return;
  const player = state.player;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    // 닿은 것만 판정 객체를 만든다(대부분의 틱은 여기서 걸러진다).
    if (Math.hypot(player.pos.x - p.x, player.pos.z - p.z) <= p.r + player.radius) {
      /** @type {OutgoingHit} */
      const hit = {
        source: 'projectile',
        attackId: p.kind,
        hitId: p.hitId,
        shapeDef: { type: 'circle', r: p.r },
        x: p.x,
        z: p.z,
        facing: p.dir,
        damage: p.damage,
        posture: 0,
        guardable: p.guardable,
        parryable: p.parryable,
        knockdown: p.knockdown,
        heavy: p.knockdown,
        execute: false,
        hitstop: 0,
      };
      const res = resolveHitOnPlayer(ctx, hit);
      if (res && res.outcome !== 'dodge') {
        emitEnded(ctx, p, res.outcome);
        continue;
      }
    }
    if (circleOverlapsWorld(p.x, p.z, p.r, state.world)) {
      emitEnded(ctx, p, 'wall');
      continue;
    }
    list[w++] = p;
  }
  list.length = w;
}

/**
 * 전부 제거 — PROJECTILE_ENDED{reason:'clear'}(연출 없이 사라진다).
 * @param {SimCtx} ctx
 */
export function clearProjectiles(ctx) {
  const list = ctx.state.projectiles;
  for (let i = 0; i < list.length; i++) emitEnded(ctx, list[i], 'clear');
  list.length = 0;
}
