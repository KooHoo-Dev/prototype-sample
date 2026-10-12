// OWNER: P16 — 계약 §8.3 · §7.5b · §6.9(훅 인터페이스)
// 잿빛 마녀 — 기본 공격 ashBolt(투사체 · 프레임워크 기본 판정) + 고유 기술 둘(kind cast):
//   emberRain 잿불 비 — range(11m) 안 · 시야(벽) · 효과 emberRain 5개(원 r 1.8 — 하나는 플레이어 자리 · 넷은 플레이어에서 ringMin..ringMax(2.5~3.5m) 고리 위
//                       minSepDeg(72°) 이상 떨어져 — 360°/4 간격 ± (90° − 72°)/2 흔들림 · rng.ai) · 예고 = 예비 길이(1.2초) · H4 count 5 · from = 마녀 자리
//   summon 재의 하수인 — 마녀가 플레이어에서 MON.threatRange 안 · 살아 있는 하수인(같은 팩 · params.child · rank spawn) < cap(8)이면 시전(1.0초) →
//                       판정 틱(strike)에 min(n 4, cap − 살아 있는 수)마리를 마녀 몸에서 r(2m)에 rank spawn · 깨어 있게 · 같은 팩(MON_SPAWNED{summon})
//   (이동) 7~10m 유지 — keepMax(10m) 밖이거나 안 보이면 다가오고(chase) 그 안에서는 제자리(hold — 뒷걸음질하지 않는다 · NOTES-P16) ·
//                       플레이어가 blinkNear(3m) 안에 blinkAfter(1.5초) 있으면 플레이어에서 blinkDist(6m) 떨어진
//                       걷기 가능 · 시야 점으로 즉시 순간이동(쿨 blinkCd 6초 · MON_ACT{actId:'blink'} · x, z = 떠난 자리 + 연출용 AFFIX teleportOut/In(affixId null — W2 통합) · 보간 끊기 prevPos = pos).
// 바닥 표식 기술: canStartHazard(H1~H4 · count) → startAttack → **그 틱에** spawnEffect(delay = 예비 길이 · 실제 spec · cancelOnSrcDeath false — 바닥에 놓인 것) →
//   noteHazard — 막히면 그 기술을 시작하지 않는다(다음 생각에 다시). strike 는 소환만(효과를 다시 만들지 않는다 — §8.3).
// 시전은 맞아도 끊기지 않는다(P16 해석 · NOTES-P16): 끊기는 것은 기절 · 빙결(status.js 의 공격 취소)뿐 — 소환이 데미지로 늘 끊기면 하수인이 위협이 되지 못한다.
// impl 상태 mon.ax.g(깨울 때 남는다): {initAt, nearAt(플레이어가 3m 안에 들어온 틱 · -1), blinkAt(다음 순간이동이 가능한 틱)} — 절대 틱은 At 이름(shiftTicks).
// 3m 안 시간은 think(행동 가능)와 tickAttack(공격 중 매 틱 — 진행은 프레임워크에 맡긴다)에서 센다.

import { EV } from '../../../core/events.js';
import { deg2rad, yawOf } from '../../../core/math.js';
import { circle } from '../../../core/shapes.js';
import { ticks } from '../../../core/time.js';
import { GUARDIAN_SPOT } from '../../../data/guardians.js';
import { getMonDef } from '../../../data/index.js';
import { MON } from '../../../data/monsters.js';
import { PACK_PLACE } from '../../../data/packs.js';
import { getMonster } from '../../entities.js';
import { canStartHazard, noteHazard, spawnEffect } from '../../effects.js';
import { isWalkableR, losClear, nearestWalkable } from '../../world/nav.js';
import { aliveMon, attackOf, attackReady, monSpec, packOf, playerDist, seesPlayer, spawnMonster, startAttack } from '../spawn.js';

/** @typedef {import('../../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../../types.js').MonsterState} MonsterState */
/** @typedef {import('../../../types.js').MonsterDef} MonsterDef */
/** @typedef {import('../../../types.js').AttackDef} AttackDef */

/** 공격 ID · 효과 kind(§9.8) · 순간이동 행동 ID */
const BOLT = 'ashBolt';
const EMBER = 'emberRain';
const SUMMON = 'summon';
const FX_EMBER = 'emberRain';
const BLINK = 'blink';
const TAU = Math.PI * 2;

/** impl 상태(없으면 init) @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def */
function gOf(ctx, mon, def) {
  if (!mon.ax.g) impl.init(ctx, mon, def);
  const g = /** @type {any} */ (mon.ax.g);
  if (typeof g.nearAt !== 'number') g.nearAt = -1;
  if (typeof g.blinkAt !== 'number') g.blinkAt = -1;
  return g;
}

/** 플레이어가 blinkNear 안에 머문 시작 틱을 센다 @param {SimCtx} ctx @param {MonsterState} mon @param {any} g @param {any} pr */
function trackNear(ctx, mon, g, pr) {
  const p = ctx.state.player;
  if (!p.dead && playerDist(ctx, mon) <= pr.blinkNear) {
    if (g.nearAt < 0) g.nearAt = ctx.state.tick;
  } else {
    g.nearAt = -1;
  }
}

/** 살아 있는 자기 하수인 수(같은 팩 · child 종류 · rank spawn) @param {SimCtx} ctx @param {MonsterState} mon @param {string} child */
function kidsAlive(ctx, mon, child) {
  const pack = packOf(ctx, mon.packId);
  let n = 0;
  if (pack) {
    const ids = pack.memberIds;
    for (let i = 0; i < ids.length; i++) {
      const m = getMonster(ctx, ids[i]);
      if (aliveMon(m) && m.typeId === child && m.rank === 'spawn') n += 1;
    }
    return n;
  }
  const mons = ctx.state.rift?.mons ?? [];
  for (let i = 0; i < mons.length; i++) {
    const m = mons[i];
    if (aliveMon(m) && m.packId === mon.packId && m.typeId === child && m.rank === 'spawn') n += 1;
  }
  return n;
}

/**
 * 순간이동 자리 — 플레이어에서 blinkDist · 마녀 쪽(플레이어 → 마녀)부터 좌우로 GUARDIAN_SPOT.steps 방향 · 몸이 들어가는 걷기 가능 · 플레이어에서 시야(벽) · 없으면 null
 * @param {SimCtx} ctx @param {MonsterState} mon @param {any} pr
 */
function blinkSpot(ctx, mon, pr) {
  const map = ctx.map;
  if (!map) return null;
  const p = ctx.state.player.pos;
  const n = Math.max(1, GUARDIAN_SPOT.steps);
  const step = TAU / n;
  const dx = mon.pos.x - p.x, dz = mon.pos.z - p.z;
  const base = dx !== 0 || dz !== 0 ? yawOf(dx, dz) : mon.facing;
  for (let k = 0; k < n; k++) {
    const a = base + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * step;
    const x = p.x + Math.sin(a) * pr.blinkDist, z = p.z + Math.cos(a) * pr.blinkDist;
    if (isWalkableR(map, x, z, mon.r) && losClear(map, p.x, p.z, x, z)) return { x, z };
  }
  return null;
}

/** 즉시 순간이동 — 자리 · 보간 끊기 · 플레이어를 본다 · MON_ACT{actId:'blink'} · 쿨 @param {SimCtx} ctx @param {MonsterState} mon @param {any} g @param {any} pr @returns {boolean} */
function tryBlink(ctx, mon, g, pr) {
  const spot = blinkSpot(ctx, mon, pr);
  if (!spot) return false;
  const tick = ctx.state.tick;
  const fromX = mon.pos.x, fromZ = mon.pos.z;
  mon.pos.x = spot.x;
  mon.pos.z = spot.z;
  mon.prevPos.x = spot.x;
  mon.prevPos.z = spot.z;
  mon.vel.x = 0;
  mon.vel.z = 0;
  const p = ctx.state.player.pos;
  mon.facing = yawOf(p.x - spot.x, p.z - spot.z);
  mon.act = 'idle';
  mon.actId = null;
  mon.aim = null;
  mon.aimLocked = false;
  g.nearAt = -1;
  g.blinkAt = tick + ticks(pr.blinkCd);
  ctx.emit(EV.MON_ACT, { id: mon.id, typeId: mon.typeId, act: 'idle', actId: BLINK, telegraph: null, x: fromX, z: fromZ, facing: mon.facing, dur: 0 });
  // W2 통합: 순간이동의 보라 잔상 · 소리 — fx · audio 가 이미 그리는 AFFIX teleportOut/In 을 같이 낸다(속성이 아니라 affixId null · NOTES-W2)
  ctx.emit(EV.AFFIX, { monId: mon.id, affixId: null, what: 'teleportOut', x: fromX, z: fromZ });
  ctx.emit(EV.AFFIX, { monId: mon.id, affixId: null, what: 'teleportIn', x: spot.x, z: spot.z });
  return true;
}

/**
 * 잿불 비 다섯 원 — 플레이어 자리 하나 + 고리 위 n − 1 개(360°/(n − 1) 간격 ± (그 간격 − minSep)/2 · 거리 ringMin..ringMax)
 * @param {SimCtx} ctx @param {any} pr @returns {import('../../../types.js').Shape[]}
 */
function emberShapes(ctx, pr) {
  const p = ctx.state.player.pos;
  const n = Math.max(1, Math.floor(pr.n ?? 1));
  const out = [circle(p.x, p.z, pr.r)];
  const ring = n - 1;
  if (ring <= 0) return out;
  const rng = ctx.rng.ai;
  const gap = TAU / ring;
  const jitter = Math.max(0, gap - deg2rad(pr.minSepDeg ?? 0)) / 2;
  const base = rng.range(0, TAU);
  for (let k = 0; k < ring; k++) {
    const a = base + k * gap + (jitter > 0 ? rng.range(-jitter, jitter) : 0);
    const d = rng.range(pr.ringMin, pr.ringMax);
    out.push(circle(p.x + Math.sin(a) * d, p.z + Math.cos(a) * d, pr.r));
  }
  return out;
}

/**
 * 잿불 비 시작 — 위협 간격(count) 통과면 예비 시작 + 그 틱에 효과 다섯 + noteHazard
 * @param {SimCtx} ctx @param {MonsterState} mon @param {AttackDef} atk @returns {boolean}
 */
function startEmberRain(ctx, mon, atk) {
  const pr = atk.params ?? {};
  const p = ctx.state.player.pos;
  const count = pr.count ?? pr.n ?? 1;
  if (!canStartHazard(ctx, mon.packId, p.x, p.z, { count, srcId: mon.id, shape: circle(p.x, p.z, pr.r) })) return false;
  const shapes = emberShapes(ctx, pr);
  const delay = startAttack(ctx, mon, atk.id);
  const from = { x: mon.pos.x, z: mon.pos.z };
  for (let i = 0; i < shapes.length; i++) {
    spawnEffect(ctx, {
      kind: FX_EMBER, owner: 'mon', srcId: mon.id, packId: mon.packId, hostile: true, shape: shapes[i], delay,
      spec: monSpec(mon, atk, 'hazard'), from, cancelOnSrcDeath: false,
    });
  }
  noteHazard(ctx, mon.packId);
  return true;
}

/**
 * 하수인 자리 — 마녀 몸에서 r(고르게 나눈 방향 + 무작위 회전) · 막혔으면 무작위(PACK_PLACE.tries) · 그래도 없으면 가장 가까운 걷기 가능 점 · 없으면 마녀 자리
 * @param {SimCtx} ctx @param {MonsterState} mon @param {number} a @param {number} d @param {number} cr
 */
function summonSpot(ctx, mon, a, d, cr) {
  const map = ctx.map;
  const cx = mon.pos.x, cz = mon.pos.z;
  if (!map) return { x: cx + Math.sin(a) * d, z: cz + Math.cos(a) * d };
  const rng = ctx.rng.ai;
  for (let i = 0; i <= PACK_PLACE.tries; i++) {
    const aa = i === 0 ? a : rng.range(0, TAU);
    const x = cx + Math.sin(aa) * d, z = cz + Math.cos(aa) * d;
    if (isWalkableR(map, x, z, cr)) return { x, z };
  }
  return nearestWalkable(map, cx + Math.sin(a) * d, cz + Math.cos(a) * d, d) ?? { x: cx, z: cz };
}

/** 소환 판정 — 살아 있는 하수인 < cap 이면 그 차이와 n 중 작은 수만큼 @param {SimCtx} ctx @param {MonsterState} mon @param {AttackDef} atk */
function summon(ctx, mon, atk) {
  const pr = atk.params ?? {};
  if (!pr.child || !ctx.state.rift) return;
  const k = Math.min(Math.floor(pr.n ?? 0), Math.floor(pr.cap ?? 0) - kidsAlive(ctx, mon, pr.child));
  if (!(k > 0)) return;
  const cdef = getMonDef(pr.child);
  const pack = packOf(ctx, mon.packId);
  const d = mon.r + (pr.r ?? 0);
  const base = ctx.rng.ai.range(0, TAU);
  const p = ctx.state.player.pos;
  for (let i = 0; i < k; i++) {
    const s = summonSpot(ctx, mon, base + (i * TAU) / k, d, cdef.radius);
    const dx = p.x - s.x, dz = p.z - s.z;
    const kid = spawnMonster(ctx, {
      typeId: pr.child, rank: 'spawn', level: mon.level, affixes: [], packId: pack ? pack.id : mon.packId, x: s.x, z: s.z,
      facing: dx !== 0 || dz !== 0 ? yawOf(dx, dz) : mon.facing, awake: true, reason: 'summon',
    });
    if (pack) pack.memberIds.push(kid.id);
  }
}

export const impl = {
  /** 스폰 직후 — 상태(깨울 때 남는다) · 고유 기술은 나타나자마자 쓸 수 있다 @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def */
  init(ctx, mon, def) {
    const tick = ctx.state.tick;
    mon.ax.g = { initAt: tick, nearAt: -1, blinkAt: tick };
  },
  /**
   * 행동 가능할 때마다 — 순간이동(3m 안 1.5초 · 쿨) > 잿불 비(range · 시야 · 준비) > 소환(위협 거리 · 하수인 < cap · 준비) > 재 화살(range · 시야(소품 포함) · 준비) >
   * 이동(keepMax 밖 · 시야 없음이면 chase · 아니면 hold)
   * @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def
   */
  think(ctx, mon, def) {
    const g = gOf(ctx, mon, def);
    const b = /** @type {any} */ (mon.ax.b ?? (mon.ax.b = { move: 'chase', spd: 1 }));
    const st = ctx.state;
    const p = st.player;
    const tick = st.tick;
    const pr = def.params ?? {};
    if (p.dead) { b.move = 'hold'; g.nearAt = -1; return; }
    trackNear(ctx, mon, g, pr);
    if (g.nearAt >= 0 && tick - g.nearAt >= ticks(pr.blinkAfter) && tick >= g.blinkAt && tryBlink(ctx, mon, g, pr)) {
      b.move = 'hold';   // 이 틱은 그 자리(보간을 끊은 자리)에 선다
      return;
    }
    const d = playerDist(ctx, mon);
    const ember = attackOf(def, EMBER);
    if (ember && attackReady(mon, ember, tick) && d <= (ember.range ?? 0) && seesPlayer(ctx, mon) && startEmberRain(ctx, mon, ember)) return;
    const sm = attackOf(def, SUMMON);
    if (sm && sm.params?.child && attackReady(mon, sm, tick) && d <= MON.threatRange && kidsAlive(ctx, mon, sm.params.child) < (sm.params.cap ?? 0)) {
      startAttack(ctx, mon, sm.id);
      return;
    }
    const bolt = attackOf(def, BOLT);
    if (bolt && attackReady(mon, bolt, tick) && d <= (bolt.range ?? 0) && seesPlayer(ctx, mon, true)) {
      startAttack(ctx, mon, bolt.id);
      return;
    }
    // 7~10m 유지(P16 해석 · NOTES-P16): 멀거나(keepMax 밖) 안 보이면 다가오고, 그 안에서는 제자리에서 쏜다 — 뒷걸음질(kite)하지 않는다.
    //   거리는 순간이동(3m 안 1.5초 → 6m)이 벌린다. 데이터에 backoff 가 없어 kite 의 뒷걸음이 전속력(4 m/s · 빠름 5.2)이라
    //   근접 클래스가 거의 때리지 못했다(균열 1 시작 전사 · 수호자 단계 중앙 447초 → 219초).
    b.move = d > (pr.keepMax ?? 0) || !seesPlayer(ctx, mon, true) ? 'chase' : 'hold';
  },
  /** 고유 기술의 판정 틱(kind cast) — 소환만(잿불 비는 think 에서 놓은 효과가 판정한다) @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def @param {AttackDef} atk */
  strike(ctx, mon, def, atk) {
    if (atk.id === SUMMON) summon(ctx, mon, atk);
  },
  /** 공격 중 매 틱 — 3m 안 시간만 센다(진행은 프레임워크 — false) @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def @param {AttackDef} atk */
  tickAttack(ctx, mon, def, atk) {
    trackNear(ctx, mon, gOf(ctx, mon, def), def.params ?? {});
    return false;
  },
};
