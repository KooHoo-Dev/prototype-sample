// OWNER: P2 — 계약 §6.8 · §3.7(Proj)
// 투사체 — 이동 → 벽(bounce 면 튕김 · 아니면 끝) → 대상 겹침(owner player: 몬스터 · mon: 플레이어) → 적중 · 관통 · 폭발 → PROJ_END.
// 한 틱의 이동 선분 전체로 겹침을 본다(빠른 투사체가 몸을 건너뛰지 않게). 벽은 PROJ.step 간격으로 표본을 본다.
// 규칙(W1 확정): explode 가 있는 투사체는 접촉마다 폭발만 한다(접촉한 몬스터도 폭발 원 안이라 한 번만 맞는다) — 관통이 남아 있으면
//   pierce − 1 하고 계속 날아가고(꿰뚫는 화염), 남지 않았으면 끝난다 · explode 가 없으면 spec 적중 → 관통 · 벽 · 사거리 끝에서도 폭발한다.
//   이미 끝난 투사체(until ≤ tick)는 건드리지 않는다.

import { DT } from '../core/constants.js';
import { EV } from '../core/events.js';
import { circle, overlaps } from '../core/shapes.js';
import { ticks } from '../core/time.js';
import { PROJ } from '../data/combat.js';
import { hazardHitPlayer, monsterHitPlayer, playerHit, playerHitShape } from './combat.js';
import { addProj, getMonster } from './entities.js';
import { isWalkable } from './world/nav.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').Proj} Proj */
/** @typedef {import('../types.js').MonsterState} MonsterState */

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
  if (!Number.isFinite(vx) || !Number.isFinite(vz)) vx = vz = 0;
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
    r: Number.isFinite(def.r) && def.r > 0 ? def.r : 0,
    born: tick,
    until: tick + Math.max(1, ticks(Number.isFinite(lifeSec) ? lifeSec : 0)),
    pierce: Number.isFinite(def.pierce) && def.pierce > 0 ? Math.floor(def.pierce) : 0,
    hitIds: [],
    bounce: !!def.bounce,
    spec: def.spec ?? {},
    explode: def.explode ?? null,
  };
  addProj(ctx, p);
  ctx.emit(EV.PROJ_SPAWN, { id: p.id, visual: p.visual, owner: p.owner, x: p.pos.x, z: p.pos.z, vx, vz });
  return p;
}

/** 이번 틱 선분에 닿은 몬스터(재사용 버퍼 — 할당 줄이기) */
const contactMons = /** @type {MonsterState[]} */ ([]);
const contactT = /** @type {number[]} */ ([]);

/** 투사체를 (x, z)에서 끝낸다 — until = tick · PROJ_END @param {SimCtx} ctx @param {Proj} pr @param {'hit'|'wall'|'expire'} reason @param {number} x @param {number} z */
function endProj(ctx, pr, reason, x, z) {
  pr.pos.x = x;
  pr.pos.z = z;
  pr.until = ctx.state.tick;
  ctx.emit(EV.PROJ_END, { id: pr.id, visual: pr.visual, x, z, reason });
}

/** 폭발(원 explode.r · 플레이어 소유면 몬스터에 · 몬스터 소유면 플레이어에) · EFFECT_HIT(kind = explode.visual) @param {SimCtx} ctx @param {Proj} pr @param {number} x @param {number} z */
function explodeProj(ctx, pr, x, z) {
  const ex = pr.explode;
  if (!ex || !(ex.r > 0)) return;
  const shape = circle(x, z, ex.r);
  let targets = 0, hitPlayer = false;
  if (pr.owner === 'player') {
    targets = playerHitShape(ctx, shape, /** @type {any} */ (ex.spec)).length;
  } else {
    const p = ctx.state.player;
    if (!p.dead && overlaps(shape, p.pos.x, p.pos.z, p.r)) hitPlayer = !hazardHitPlayer(ctx, /** @type {any} */ (ex.spec)).ignored;
  }
  ctx.emit(EV.EFFECT_HIT, { id: pr.id, kind: ex.visual ?? pr.visual, hostile: pr.owner !== 'player', shape, hitPlayer, targets });
}

/**
 * 한 틱 — 이동(벽 표본) → 대상 → 벽 끝 → 수명 끝(마지막 이동 틱에 expire — 수명 L틱이면 L번 움직인다).
 * 몬스터 투사체: 출처가 살아 있으면 monsterHitPlayer(속성 onHitPlayer 가 돈다) · 아니면 hazardHitPlayer. 무시된 적중(도착 보호 · 도약 무적)은 지나간다.
 * @param {SimCtx} ctx
 */
export function updateProjectiles(ctx) {
  const st = ctx.state;
  const rift = st.rift;
  if (!rift) return;
  const tick = st.tick;
  const projs = rift.projs;
  for (let i = 0, n = projs.length; i < n; i++) {
    const pr = projs[i];
    if (pr.until <= tick) continue;
    stepProj(ctx, pr, tick);
  }
}

/** @param {SimCtx} ctx @param {Proj} pr @param {number} tick */
function stepProj(ctx, pr, tick) {
  const map = ctx.map;
  const ox = pr.pos.x, oz = pr.pos.z;
  let x = ox, z = oz;
  let wall = false;
  const vx = pr.vel.x, vz = pr.vel.z;
  const dist = Math.hypot(vx, vz) * DT;
  if (dist > 0) {
    const nSub = Math.max(1, Math.ceil(dist / PROJ.step));
    const sx = (vx * DT) / nSub, sz = (vz * DT) / nSub;
    for (let k = 0; k < nSub; k++) {
      const nx = x + sx, nz = z + sz;
      if (map && !isWalkable(map, nx, nz)) {
        if (pr.bounce) {
          const bx = !isWalkable(map, nx, z), bz = !isWalkable(map, x, nz);
          if (bx || !bz) pr.vel.x = -pr.vel.x;
          if (bz || !bx) pr.vel.z = -pr.vel.z;
        } else {
          wall = true;
        }
        break;
      }
      x = nx;
      z = nz;
    }
  }

  // 대상(선분 ox,oz → x,z)
  const segX = x - ox, segZ = z - oz;
  const segL2 = segX * segX + segZ * segZ;
  if (pr.owner === 'player') {
    const mons = ctx.state.rift.mons;
    contactMons.length = 0;
    contactT.length = 0;
    const minX = Math.min(ox, x) - pr.r, maxX = Math.max(ox, x) + pr.r, minZ = Math.min(oz, z) - pr.r, maxZ = Math.max(oz, z) + pr.r;
    for (let j = 0; j < mons.length; j++) {
      const m = mons[j];
      if (m.gone || m.dead || !(m.hp > 0)) continue;
      const R = pr.r + m.r;
      const mx = m.pos.x, mz = m.pos.z;
      if (mx < minX - m.r || mx > maxX + m.r || mz < minZ - m.r || mz > maxZ + m.r) continue;
      let t = segL2 > 0 ? ((mx - ox) * segX + (mz - oz) * segZ) / segL2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ox + segX * t - mx, cz = oz + segZ * t - mz;
      if (cx * cx + cz * cz > R * R) continue;
      if (pr.hitIds.includes(m.id)) continue;
      // 선분 위 순서대로 넣는다(삽입 정렬 — 보통 0~2개)
      let k = contactT.length;
      while (k > 0 && contactT[k - 1] > t) k--;
      contactMons.splice(k, 0, m);
      contactT.splice(k, 0, t);
    }
    for (let k = 0; k < contactMons.length; k++) {
      const m = contactMons[k];
      const t = contactT[k];
      const hx = ox + segX * t, hz = oz + segZ * t;
      if (!(m.hp > 0) || m.gone || m.dead) continue;   // 앞선 폭발 · 적중이 이미 쓰러뜨렸다
      if (pr.explode && !(pr.pierce > 0)) {
        explodeProj(ctx, pr, hx, hz);
        endProj(ctx, pr, 'hit', hx, hz);
        return;
      }
      if (pr.explode) {
        // W1 확정(통합 게이트): 관통이 남은 폭발 투사체는 접촉마다 폭발한다(§7.9 꿰뚫는 화염 「관통하며 맞힐 때마다 폭발」) —
        // 접촉한 몬스터는 폭발 원 안이라 spec 을 따로 쓰지 않는다
        explodeProj(ctx, pr, hx, hz);
        pr.hitIds.push(m.id);
        pr.pierce -= 1;
        continue;
      }
      playerHit(ctx, m, /** @type {any} */ (pr.spec));
      pr.hitIds.push(m.id);
      if (pr.pierce > 0) {
        pr.pierce -= 1;
        continue;
      }
      endProj(ctx, pr, 'hit', hx, hz);
      return;
    }
  } else {
    const p = ctx.state.player;
    if (!p.dead) {
      const R = pr.r + p.r;
      let t = segL2 > 0 ? ((p.pos.x - ox) * segX + (p.pos.z - oz) * segZ) / segL2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const hx = ox + segX * t, hz = oz + segZ * t;
      const cx = hx - p.pos.x, cz = hz - p.pos.z;
      if (cx * cx + cz * cz <= R * R) {
        const src = getMonster(ctx, pr.srcId);
        const spec = /** @type {any} */ (pr.spec);
        const res = src && !src.dead && !src.gone ? monsterHitPlayer(ctx, src, spec) : hazardHitPlayer(ctx, spec);
        if (pr.until <= tick) return;   // 이 적중으로 플레이어가 쓰러져 적대 투사체가 이미 지워졌다(PROJ_END cancel)
        if (!res.ignored) {
          if (pr.explode) explodeProj(ctx, pr, hx, hz);
          endProj(ctx, pr, 'hit', hx, hz);
          return;
        }
      }
    }
  }

  if (wall) {
    if (pr.explode) explodeProj(ctx, pr, x, z);
    endProj(ctx, pr, 'wall', x, z);
    return;
  }
  pr.pos.x = x;
  pr.pos.z = z;
  if (tick + 1 >= pr.until) {
    if (pr.explode) explodeProj(ctx, pr, x, z);
    endProj(ctx, pr, 'expire', x, z);
  }
}
