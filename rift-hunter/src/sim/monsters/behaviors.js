// OWNER: P3 — 계약 §6.9 · §8.1 · §7.4
// 종류별 행동(BEHAVIORS) 9. 행 하나 = {think(ctx, mon, def), strike?(ctx, mon, def, atk), onDamaged?(ctx, mon, def, hit), onDeath?(ctx, mon, def),
//   tickAttack?(ctx, mon, def, atk) → boolean}  — strike 가 없으면 프레임워크 기본(spawn.js strikeDefault: 근접 판정 · 투사체).
//   tickAttack(P3 W1 · 선택)은 공격 중인 매 틱 프레임워크의 진행보다 먼저 불리고, true 면 그 틱의 진행을 맡는다(돌진의 달리기).
// think 는 행동 가능할 때(act idle · move · 상태 관문 통과)만 불린다 — 공격을 고르면 startAttack, 아니면 mon.ax.b.move 에 이동 목표를 둔다
//   ('chase' · 'flee' · 'kite' · 'hold' · {x, z}) · mon.ax.b.spd = 이동 배율(기본 1).
// 「살아 있어 보인다」(QUALITY §2): 시작 조건이 거리다(닿지 않는 거리에서 헛동작 없음) · 원거리 종은 시야(막는 소품 포함)가 없으면 다가간다 ·
//   바닥 표식은 예비를 시작하는 그 틱에 만든다(delay = 예비 길이) · 모든 공격 · 표식은 MON.threatRange(11m) 안에서만.

import { DT } from '../../core/constants.js';
import { segPointDist, yawOf } from '../../core/math.js';
import { circle, line } from '../../core/shapes.js';
import { ticks } from '../../core/time.js';
import { STATUS } from '../../data/combat.js';
import { getMonDef } from '../../data/index.js';
import { MON } from '../../data/monsters.js';
import { PACK_PLACE } from '../../data/packs.js';
import { monsterHitPlayer } from '../combat.js';
import { canStartHazard, rootSafeDelay, spawnEffect } from '../effects.js';
import { getMonster } from '../entities.js';
import { applyStun } from '../status.js';
import { isWalkableR, moveCircle, nearestWalkable, raycastWalk } from '../world/nav.js';
import { GUARDIAN_IMPLS } from './guardians/index.js';
import {
  aliveMon, attackReady, firstMelee, meleeStartOk, monSpec, packOf, playerDist, seesPlayer, spawnMonster, startAttack, strikeDefault,
} from './spawn.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').MonsterState} MonsterState */
/** @typedef {import('../../types.js').MonsterDef} MonsterDef */
/** @typedef {import('../../types.js').AttackDef} AttackDef */

/** 효과 kind · 투사체 visual(§9.8 — 만드는 쪽 P3) */
const FX = { chargeLine: 'chargeLine', bloaterBurst: 'bloaterBurst', poisonPool: 'poisonPool' };

/** 행동 상태(ax.b — 깰 때 프레임워크가 새로 만든다) @param {MonsterState} mon */
function bOf(mon) {
  return /** @type {any} */ (mon.ax.b ?? (mon.ax.b = { move: 'chase', spd: 1 }));
}

/** 그 kind 의 첫 공격 @param {MonsterDef} def @param {string} kind @returns {AttackDef|null} */
function attackOfKind(def, kind) {
  const list = def.attacks;
  for (let i = 0; i < list.length; i++) if (list[i].kind === kind) return list[i];
  return null;
}

/** 냉기 감속 배율(예비 · 후딜을 늘린다) @param {MonsterState} mon */
function chillK(mon) {
  return mon.st.chill > 0 ? 1 - STATUS.chillSlow : 1;
}

// ───────────────────────── melee · shield ─────────────────────────

/**
 * chase · 중심 거리 ≤ r + reach + player.r(관용 없음)이고 지금 facing 의 원뿔 안 · 근접 공격 준비면 시작
 * (정지 거리 = r + reach × 0.8 + player.r 안에서는 facing 만 돈다 — 프레임워크 이동)
 * @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def
 */
function meleeThink(ctx, mon, def) {
  const b = bOf(mon);
  const p = ctx.state.player;
  if (p.dead) { b.move = 'hold'; return; }
  const atk = firstMelee(def);
  if (atk && attackReady(mon, atk, ctx.state.tick) && meleeStartOk(mon, atk, p)) {
    startAttack(ctx, mon, atk.id);
    return;
  }
  b.move = 'chase';
}

const melee = { think: meleeThink };

// ───────────────────────── fallen ─────────────────────────

/** 같은 팩 · 같은 종류의 (살아 있는 수, 목록에 있는 수) @param {SimCtx} ctx @param {MonsterState} mon */
function kinCount(ctx, mon) {
  const pack = packOf(ctx, mon.packId);
  let alive = 0, listed = 0;
  if (!pack) return { alive: 1, listed: 1 };
  const ids = pack.memberIds;
  for (let i = 0; i < ids.length; i++) {
    const m = getMonster(ctx, ids[i]);
    if (!m || m.typeId !== mon.typeId) continue;
    if (m.gone) continue;
    listed += 1;
    if (aliveMon(m)) alive += 1;
  }
  return { alive, listed };
}

const fallen = {
  /**
   * melee 와 같다 + 도망 — 같은 팩의 같은 종류 중 fleeAt(50%) 이상이 죽었고 pack.fled 가 아니면 그 종류 전부 act flee(fleeSec · 플레이어 반대쪽 ·
   * speed × fleeSpeedMul) → 끝나면 다시 chase. 팩당 한 번(pack.fled).
   * @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def
   */
  think(ctx, mon, def) {
    const b = bOf(mon);
    const pr = def.params ?? {};
    const pack = packOf(ctx, mon.packId);
    const kin = kinCount(ctx, mon);
    if (!(b.n0 > 0)) b.n0 = kin.listed;
    const total = Math.max(b.n0, kin.listed, kin.alive);
    if (pack && !pack.fled && pr.fleeAt > 0 && total > 0 && (total - kin.alive) / total >= pr.fleeAt && !ctx.state.player.dead) {
      pack.fled = true;
      const tick = ctx.state.tick;
      const until = tick + Math.max(1, ticks(pr.fleeSec ?? 0));
      const ids = pack.memberIds;
      for (let i = 0; i < ids.length; i++) {
        const m = getMonster(ctx, ids[i]);
        if (!aliveMon(m) || !m.awake || m.typeId !== mon.typeId) continue;
        const s = m.st;
        if (s.stunUntil > tick || s.freezeUntil > tick || m.act === 'vanish') continue;
        m.act = 'flee';
        m.actId = null;
        m.actStart = tick;
        m.actHit = tick;
        m.actEnd = until;
        m.aim = null;
        m.aimLocked = false;
        const mb = bOf(m);
        mb.move = 'flee';
        mb.spd = pr.fleeSpeedMul ?? 1;
      }
      if (mon.act === 'flee') return;
    }
    meleeThink(ctx, mon, def);
  },
};

// ───────────────────────── shaman ─────────────────────────

/** 되살릴 시체(window 초 안 · range 안 · 되살린 적 없음 · 가까운 순 max 개) @param {SimCtx} ctx @param {MonsterState} mon @param {AttackDef} rv @returns {MonsterState[]} */
function reviveTargets(ctx, mon, rv) {
  const rift = ctx.state.rift;
  if (!rift) return [];
  const pr = rv.params ?? {};
  const tick = ctx.state.tick;
  const win = ticks(pr.window ?? 0);
  const range = rv.range ?? 0;
  /** @type {Array<{m:MonsterState, d:number}>} */
  const out = [];
  const mons = rift.mons;
  for (let i = 0; i < mons.length; i++) {
    const c = mons[i];
    if (!c.dead || c.gone || c.typeId !== pr.target || c.flags.revived || c.deadAt < 0 || tick - c.deadAt > win) continue;
    const d = Math.hypot(c.pos.x - mon.pos.x, c.pos.z - mon.pos.z);
    if (d <= range) out.push({ m: c, d });
  }
  out.sort((a, b) => a.d - b.d || a.m.id - b.m.id);
  const max = Math.max(1, pr.max ?? 1);
  return out.slice(0, max).map(o => o.m);
}

/** 부활 시전(kind cast · params.target) @param {MonsterDef} def @returns {AttackDef|null} */
function reviveAttack(def) {
  const list = def.attacks;
  for (let i = 0; i < list.length; i++) if (list[i].kind === 'cast' && list[i].params && list[i].params.target) return list[i];
  return null;
}

const shaman = {
  /**
   * 플레이어와 keepMin..keepMax 유지(kite — 시야가 막히면 다가감) · revive 준비 · window 초 안의 시체가 range 안이면 부활 채널(act channel · aim = 시체) ·
   * 아니면 화염탄(시야 · 사거리)
   * @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def
   */
  think(ctx, mon, def) {
    const b = bOf(mon);
    const p = ctx.state.player;
    const tick = ctx.state.tick;
    if (p.dead) { b.move = 'hold'; return; }
    const rv = reviveAttack(def);
    if (rv && attackReady(mon, rv, tick)) {
      const list = reviveTargets(ctx, mon, rv);
      if (list.length) {
        const c = list[0];
        startAttack(ctx, mon, rv.id, { act: 'channel', facing: yawOf(c.pos.x - mon.pos.x, c.pos.z - mon.pos.z), aim: { x: c.pos.x, z: c.pos.z }, lockAim: true });
        b.revive = list.map(m => m.id);
        return;
      }
    }
    const fire = attackOfKind(def, 'projectile');
    if (fire && attackReady(mon, fire, tick) && playerDist(ctx, mon) <= (fire.range ?? 0) && seesPlayer(ctx, mon, true)) {
      startAttack(ctx, mon, fire.id);
      return;
    }
    b.move = 'kite';
  },
  /** 부활 판정(채널 끝) · 화염탄은 기본 @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def @param {AttackDef} atk */
  strike(ctx, mon, def, atk) {
    if (!(atk.kind === 'cast' && atk.params && atk.params.target)) { strikeDefault(ctx, mon, def, atk); return; }
    const b = bOf(mon);
    const ids = Array.isArray(b.revive) ? b.revive : [];
    b.revive = null;
    const hpFrac = atk.params.hp ?? 1;
    for (const id of ids) {
      const c = getMonster(ctx, id);
      if (!c || c.gone || !c.dead || c.flags.revived) continue;
      c.gone = true;
      const pack = packOf(ctx, c.packId) ?? packOf(ctx, mon.packId);
      const nm = spawnMonster(ctx, {
        typeId: c.typeId, rank: 'normal', level: c.level, affixes: [], packId: pack ? pack.id : -1, x: c.pos.x, z: c.pos.z, facing: c.facing,
        awake: true, reason: 'revive', flags: { noXp: true, noDrops: true, noGauge: true, revived: true },
      });
      nm.hp = nm.hpMax * hpFrac;
      if (pack) pack.memberIds.push(nm.id);
    }
  },
  /** 부활 채널은 피해를 받으면 끊긴다(쿨다운은 쓴 채) @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def @param {import('../../types.js').HitResult} hit */
  onDamaged(ctx, mon, def, hit) {
    if (mon.act !== 'channel' || !(hit && hit.dmg > 0)) return;
    mon.act = 'idle';
    mon.actId = null;
    mon.aim = null;
    mon.aimLocked = false;
    bOf(mon).revive = null;
  },
};

// ───────────────────────── archer ─────────────────────────

const archer = {
  /**
   * keepMin..keepMax(7~10m) 유지 · 플레이어가 backoff(4m) 안이면 backoffMul 속도로 뒷걸음(뒤가 막히면 그 자리에서 쏜다) ·
   * arrow: 예비 동안 조준이 플레이어를 따라가다 마지막 aimLock(0.2초)은 멈춘다(프레임워크) → 그 점으로 발사
   * @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def
   */
  think(ctx, mon, def) {
    const b = bOf(mon);
    const p = ctx.state.player;
    if (p.dead) { b.move = 'hold'; return; }
    const pr = def.params ?? {};
    const d = playerDist(ctx, mon);
    if (pr.backoff > 0 && d < pr.backoff && !b.stuck) { b.move = 'kite'; return; }
    const arrow = attackOfKind(def, 'projectile');
    if (arrow && attackReady(mon, arrow, ctx.state.tick) && d <= (arrow.range ?? 0) && seesPlayer(ctx, mon, true)) {
      startAttack(ctx, mon, arrow.id);
      return;
    }
    b.move = 'kite';
  },
};

// ───────────────────────── charger ─────────────────────────

/** 돌진을 끝낸다 — 후딜(냉기만 늘린다 · 바닥 표식 공격이라 빠름 없음) @param {SimCtx} ctx @param {MonsterState} mon @param {AttackDef} atk */
function endCharge(ctx, mon, atk) {
  const b = bOf(mon);
  b.charge = null;
  if (mon.act === 'charge') {
    mon.act = 'recover';
    mon.actEnd = ctx.state.tick + Math.max(1, ticks(atk.recover / chillK(mon)));
  }
  mon.vel.x = 0;
  mon.vel.z = 0;
}

/**
 * 돌진 한 틱 — 선을 따라 params.speed(14 m/s) · 이번 틱 선분이 플레이어 몸과 겹치면 한 번 monsterHitPlayer(via charge · push) ·
 * 이번 틱 이동이 계획의 blockFrac(50%) 미만이면 벽 — wallStun 기절(status.applyStun · 등급 배율은 거기서) · 선 끝이면 후딜
 * @param {SimCtx} ctx @param {MonsterState} mon @param {AttackDef} atk
 */
function chargeStep(ctx, mon, atk) {
  const b = bOf(mon);
  const c = b.charge;
  const map = ctx.map;
  if (!c || !map) { endCharge(ctx, mon, atk); return; }
  const pr = atk.params ?? {};
  const want = Math.min((pr.speed ?? 0) * DT, c.len - c.done);
  if (!(want > MON.moveEps)) { endCharge(ctx, mon, atk); return; }
  const fx = Math.sin(mon.facing), fz = Math.cos(mon.facing);
  const ox = mon.pos.x, oz = mon.pos.z;
  const np = moveCircle(map, mon.pos, mon.r, fx * want, fz * want);
  const moved = Math.hypot(np.x - ox, np.z - oz);
  mon.pos.x = np.x;
  mon.pos.z = np.z;
  mon.vel.x = (np.x - ox) / DT;
  mon.vel.z = (np.z - oz) / DT;
  const p = ctx.state.player;
  if (!c.hit && !p.dead && segPointDist(ox, oz, np.x, np.z, p.pos.x, p.pos.z) <= mon.r + p.r) {
    c.hit = true;
    monsterHitPlayer(ctx, mon, monSpec(mon, atk, 'charge'));
  }
  c.done += moved;
  if (moved < want * (pr.blockFrac ?? 0)) {
    endCharge(ctx, mon, atk);
    b.wallAt = ctx.state.tick;
    applyStun(ctx, mon, pr.wallStun ?? 0);
    return;
  }
  if (c.done >= c.len - MON.moveEps) endCharge(ctx, mon, atk);
}

const charger = {
  /**
   * 거리 minRange..range(5~11m) · 시야 · charge 준비면 돌진 예비(방향 고정 · 시작 틱에 효과 chargeLine — 적대 · spec null 표시 전용 ·
   * 선 길이 = 몸 중심이 가는 거리 min(maxLen, 거리 + overshoot)(벽 앞에서 자른다) + r(몸 앞 — 판정과 같은 끝) · 폭 2r · cancelOnSrcDeath) → 판정 틱부터 act charge. 그 밖에는 gore(근접)
   * @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def
   */
  think(ctx, mon, def) {
    const b = bOf(mon);
    const p = ctx.state.player;
    const tick = ctx.state.tick;
    if (p.dead) { b.move = 'hold'; return; }
    const ch = attackOfKind(def, 'charge');
    const d = playerDist(ctx, mon);
    if (ch && ctx.map && attackReady(mon, ch, tick) && d >= (ch.minRange ?? 0) && d <= (ch.range ?? 0) && seesPlayer(ctx, mon, true)) {
      const pr = ch.params ?? {};
      const facing = yawOf(p.pos.x - mon.pos.x, p.pos.z - mon.pos.z);
      const len = Math.min(pr.maxLen ?? 0, d + (pr.overshoot ?? 0));
      const fx = Math.sin(facing), fz = Math.cos(facing);
      const ex = mon.pos.x + fx * len, ez = mon.pos.z + fz * len;
      const stop = raycastWalk(ctx.map, mon.pos.x, mon.pos.z, ex, ez, mon.r);
      // 리뷰 수정: 표식은 몸 앞까지(멈추는 몸 중심 + r) — 판정(chargeStep)은 몸 중심의 경로 선분 ↔ 플레이어 중심 ≤ r + p.r 이라 끝에 반지름 r 만큼 더 맞혔다
      //   (전에는 벽이 없으면 몸 중심이 멈추는 자리에서 선이 끝나 선 끝 바깥 0.6~0.78m 까지 맞았다 · QUALITY §2 ≤ 0.35m)
      const shown = Math.min(len, Math.hypot(stop.x - mon.pos.x, stop.z - mon.pos.z)) + mon.r;
      const shape = line(mon.pos.x, mon.pos.z, facing, shown, mon.r * 2);
      if (canStartHazard(ctx, -1, p.pos.x, p.pos.z, { srcId: mon.id, shape })) {
        const delay = startAttack(ctx, mon, ch.id, { facing, aim: { x: ex, z: ez }, lockAim: true });
        spawnEffect(ctx, {
          kind: FX.chargeLine, owner: 'mon', srcId: mon.id, packId: mon.packId, hostile: true, shape, delay, spec: null, cancelOnSrcDeath: true,
        });
        b.charge = { len, done: 0, hit: false };
        return;
      }
    }
    const gore = firstMelee(def);
    if (gore && attackReady(mon, gore, tick) && meleeStartOk(mon, gore, p)) {
      startAttack(ctx, mon, gore.id);
      return;
    }
    b.move = 'chase';
  },
  /** 돌진 판정 틱 — act charge 로 달리기 시작(이 틱부터 움직인다) · gore 는 기본 @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def @param {AttackDef} atk */
  strike(ctx, mon, def, atk) {
    if (atk.kind !== 'charge') { strikeDefault(ctx, mon, def, atk); return; }
    const b = bOf(mon);
    if (!b.charge) b.charge = { len: atk.params?.maxLen ?? 0, done: 0, hit: false };
    mon.act = 'charge';
    const speed = atk.params?.speed ?? 0;
    mon.actEnd = ctx.state.tick + (speed > 0 ? ticks(b.charge.len / speed) : 0) + 2;
    chargeStep(ctx, mon, atk);
  },
  /** act charge 동안 매 틱 달린다 @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def @param {AttackDef} atk */
  tickAttack(ctx, mon, def, atk) {
    if (mon.act !== 'charge') return false;
    if (atk.kind !== 'charge') { endCharge(ctx, mon, atk); return true; }
    chargeStep(ctx, mon, atk);
    return true;
  },
};

// ───────────────────────── bloater ─────────────────────────

const bloater = {
  /**
   * chase · range(2.2m) 안이면 burst 예비(act swell) — 시작 틱에 효과 bloaterBurst(원 r · 적대 · delay = 예비 길이 · 실제 spec — 판정은 효과(P2) ·
   * cancelOnSrcDeath). 위협 간격(H2 · H4)은 canStartHazard(팩 -1)로 본다
   * @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def
   */
  think(ctx, mon, def) {
    const b = bOf(mon);
    const p = ctx.state.player;
    if (p.dead) { b.move = 'hold'; return; }
    const burst = attackOfKind(def, 'explode');
    if (burst && attackReady(mon, burst, ctx.state.tick) && playerDist(ctx, mon) <= (burst.range ?? 0)) {
      const shape = circle(mon.pos.x, mon.pos.z, burst.params?.r ?? 0);
      if (canStartHazard(ctx, -1, mon.pos.x, mon.pos.z, { srcId: mon.id, shape })) {
        const delay = startAttack(ctx, mon, burst.id);
        spawnEffect(ctx, {
          kind: FX.bloaterBurst, owner: 'mon', srcId: mon.id, packId: mon.packId, hostile: true, shape, delay,
          spec: monSpec(mon, burst, 'explode'), cancelOnSrcDeath: true,
        });
        return;
      }
    }
    b.move = 'chase';
  },
  /** 판정 틱 — 자신의 생명 0 · noXp · noDrops · noGauge 만(피해는 효과가 준다 — 두 번 맞지 않는다 §5.16-6) @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def @param {AttackDef} atk */
  strike(ctx, mon, def, atk) {
    if (atk.kind !== 'explode') { strikeDefault(ctx, mon, def, atk); return; }
    mon.hp = 0;
    mon.flags.noXp = true;
    mon.flags.noDrops = true;
    mon.flags.noGauge = true;
    mon.lastHit = { by: 'mon', skillId: null, noProcs: true, frozen: false };
  },
  /**
   * 어떤 이유로 죽든(터지기 전 포함) 효과 poisonPool(r poolR · delay 0 · poolSec · poolTick 틱 · spec null · tickSpec 초당 poolMulPerSec ·
   * 위협 간격 · H5 예외 — 플레이어가 죽인 시점)
   * @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def
   */
  onDeath(ctx, mon, def) {
    const burst = attackOfKind(def, 'explode');
    const pr = burst?.params;
    if (!burst || !pr || !(pr.poolR > 0)) return;
    const shape = circle(mon.pos.x, mon.pos.z, pr.poolR);
    // 리뷰 수정: 감옥에 묶인 플레이어 발밑이면 웅덩이가 풀린 뒤 + 반응 + 걸어 나가는 시간 뒤에 놓인다(rootSafeDelay — 묶인 채 틱 피해를 받지 않게)
    spawnEffect(ctx, {
      kind: FX.poisonPool, owner: 'mon', srcId: mon.id, packId: mon.packId, hostile: true, shape,
      delay: rootSafeDelay(ctx, shape, 0), dur: pr.poolSec ?? 0, tick: pr.poolTick ?? 0, spec: null,
      tickSpec: { srcId: mon.id, via: 'hazard', raw: mon.dmg * (pr.poolMulPerSec ?? 0) * (pr.poolTick ?? 0), type: burst.type, level: mon.level },
      cancelOnSrcDeath: false,
    });
  },
};

// ───────────────────────── nest ─────────────────────────

/** 깨어 있고 살아 있는 자기 새끼 수(같은 팩 · params.child 종류 · rank spawn) @param {SimCtx} ctx @param {MonsterState} mon @param {string} child */
function kidsAlive(ctx, mon, child) {
  const pack = packOf(ctx, mon.packId);
  let n = 0;
  if (pack) {
    const ids = pack.memberIds;
    for (let i = 0; i < ids.length; i++) {
      const m = getMonster(ctx, ids[i]);
      if (aliveMon(m) && m.awake && m.typeId === child && m.rank === 'spawn') n += 1;
    }
    return n;
  }
  const mons = ctx.state.rift?.mons ?? [];
  for (let i = 0; i < mons.length; i++) {
    const m = mons[i];
    if (aliveMon(m) && m.awake && m.packId === mon.packId && m.typeId === child && m.rank === 'spawn') n += 1;
  }
  return n;
}

const nest = {
  /**
   * 움직이지 않는다. 깨어 있고 살아 있는 자기 새끼 < cap 이고 spawn 준비 · 플레이어가 range 안이면 예비(맥동) → 판정에 새끼 하나
   * @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def
   */
  think(ctx, mon, def) {
    const b = bOf(mon);
    b.move = 'hold';
    const p = ctx.state.player;
    if (p.dead) return;
    const sp = attackOfKind(def, 'spawn');
    if (!sp || !sp.params?.child) return;
    if (!attackReady(mon, sp, ctx.state.tick) || playerDist(ctx, mon) > (sp.range ?? 0)) return;
    if (kidsAlive(ctx, mon, sp.params.child) >= (sp.params.cap ?? 0)) return;
    startAttack(ctx, mon, sp.id, { facing: mon.facing });
  },
  /** 판정: 둥지 가장자리에서 rMin..rMax 에 params.child 를 rank spawn · 깨어 있게 · 같은 팩으로(MON_SPAWNED{nest}) @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def @param {AttackDef} atk */
  strike(ctx, mon, def, atk) {
    const pr = atk.params ?? {};
    if (!pr.child || !ctx.map || kidsAlive(ctx, mon, pr.child) >= (pr.cap ?? 0)) return;
    const cdef = getMonDef(pr.child);
    const rng = ctx.rng.ai;
    let x = mon.pos.x, z = mon.pos.z, ok = false;
    for (let i = 0; i < PACK_PLACE.tries && !ok; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = mon.r + rng.range(pr.rMin ?? 0, pr.rMax ?? 0);
      x = mon.pos.x + Math.sin(a) * d;
      z = mon.pos.z + Math.cos(a) * d;
      ok = isWalkableR(ctx.map, x, z, cdef.radius);
    }
    if (!ok) {
      const q = nearestWalkable(ctx.map, x, z, pr.rMax ?? 0);
      if (!q) return;
      x = q.x;
      z = q.z;
    }
    const pack = packOf(ctx, mon.packId);
    const kid = spawnMonster(ctx, {
      typeId: pr.child, rank: 'spawn', level: mon.level, affixes: [], packId: mon.packId, x, z, facing: yawOf(x - mon.pos.x, z - mon.pos.z),
      awake: true, reason: 'nest',
    });
    if (pack) pack.memberIds.push(kid.id);
  },
};

// ───────────────────────── guardian ─────────────────────────

/** @param {MonsterState} mon */
function implOf(mon) {
  return /** @type {any} */ (GUARDIAN_IMPLS)[mon.typeId] ?? null;
}

const guardian = {
  /** GUARDIAN_IMPLS[typeId].think 위임(§8.3) @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def */
  think(ctx, mon, def) {
    const impl = implOf(mon);
    if (impl && typeof impl.think === 'function') impl.think(ctx, mon, def);
    else meleeThink(ctx, mon, def);
  },
  /** 고유 기술(kind cast)의 판정은 impl.strike · 기본 공격은 프레임워크 기본 @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def @param {AttackDef} atk */
  strike(ctx, mon, def, atk) {
    const impl = implOf(mon);
    if (atk.kind === 'cast') { if (impl && typeof impl.strike === 'function') impl.strike(ctx, mon, def, atk); return; }
    strikeDefault(ctx, mon, def, atk);
  },
  /** 선택 — impl.onDamaged(시전 끊기 등) @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def @param {any} hit */
  onDamaged(ctx, mon, def, hit) {
    const impl = implOf(mon);
    if (impl && typeof impl.onDamaged === 'function') impl.onDamaged(ctx, mon, def, hit);
  },
  /** 선택 — impl.tickAttack(공격 중 매 틱) @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def @param {AttackDef} atk */
  tickAttack(ctx, mon, def, atk) {
    const impl = implOf(mon);
    return !!(impl && typeof impl.tickAttack === 'function' && impl.tickAttack(ctx, mon, def, atk));
  },
};

/** 종류별 행동 9(§8.1) — 행의 behavior 키 */
export const BEHAVIORS = {
  melee,
  fallen,
  shaman,
  archer,
  shield: melee,
  charger,
  bloater,
  nest,
  guardian,
};
