// OWNER: P16 — 계약 §8.2 · §7.5 · §6.9(훅 인터페이스) · §5.17-2(사라짐)
// 순간이동 — 플레이어가 farDist(8m) 넘게 떨어졌거나 피해로 표시됐으면(onDamaged — 쿨이 지났을 때만 표시), 쿨(cd 4초)이 지났고 움직일 수 있을 때(idle · move ·
//   기절 · 빙결 · 경직 아님) act vanish(actStart · actEnd = +vanish 0.4초 · 그동안 무적 setInvuln · AFFIX teleportOut) →
//   tick ≥ actEnd 인 첫 onAwakeTick(프레임워크가 actEnd 틱에 act 를 idle 로 돌린 뒤 — §5.17-2)에 플레이어에서 minR..maxR(2.5~4m) · 플레이어에서 시야(벽) ·
//   몸이 들어가는 걷기 가능 점으로 옮긴다(rng.ai — §5.14 · 보간 끊기 prevPos = pos · 플레이어를 본다 · AFFIX teleportIn). 자리가 없으면 그 자리에 다시 나타난다.
//   → 사라짐은 반드시 끝난다: 무적은 actEnd 까지만 · act 는 프레임워크가 actEnd 에 idle(잠든 채여도 — monsters.js) · 깨면 st 가 비워져도 몸은 그 자리에 보인다.
// hazard 가 아니다 — 챔피언 팩이면 구성원마다 따로 돈다(하수인은 받지 않는다 · minionShare false).
// 상태 st = mon.ax.teleporter: {readyAt, marked, vanishing}(readyAt = 다음 순간이동이 가능한 절대 틱 — 이름 끝 At · shiftTicks · 깰 때 프레임워크가 비운다).

import { EV } from '../../../core/events.js';
import { yawOf } from '../../../core/math.js';
import { secOf, ticks } from '../../../core/time.js';
import { GUARDIAN_SPOT } from '../../../data/guardians.js';
import { PACK_PLACE } from '../../../data/packs.js';
import { setInvuln } from '../../status.js';
import { isWalkableR, losClear } from '../../world/nav.js';
import { isDisabled, playerDist } from '../spawn.js';

/** @typedef {import('../../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../../types.js').MonsterState} MonsterState */
/** @typedef {import('../../../types.js').MonAffixDef} MonAffixDef */

const TAU = Math.PI * 2;

/** 지금 순간이동을 시작할 수 있는 행동(공격 · 도망 · 사라짐 · 상태 이상 중이 아니다) @param {MonsterState} mon @param {number} tick */
function canStart(mon, tick) {
  return (mon.act === 'idle' || mon.act === 'move') && !isDisabled(mon, tick);
}

/** 나타날 자리 후보 — 플레이어에서 시야(벽) · 몸 반지름이 들어가는 걷기 가능 @param {SimCtx} ctx @param {MonsterState} mon @param {number} x @param {number} z */
function spotOk(ctx, mon, x, z) {
  const map = /** @type {import('../../../types.js').MapData} */ (ctx.map);
  const p = ctx.state.player.pos;
  return isWalkableR(map, x, z, mon.r) && losClear(map, p.x, p.z, x, z);
}

/**
 * 나타날 자리 — 무작위(rng.ai · PACK_PLACE.tries 번 · 거리 minR..maxR) → 없으면 결정적 훑기(몬스터 쪽부터 좌우로 GUARDIAN_SPOT.steps 방향 · 거리 셋) → 없으면 null
 * @param {SimCtx} ctx @param {MonsterState} mon @param {any} pr @returns {{x:number, z:number}|null}
 */
function findSpot(ctx, mon, pr) {
  if (!ctx.map) return null;
  const p = ctx.state.player.pos;
  const rng = ctx.rng.ai;
  for (let i = 0; i < PACK_PLACE.tries; i++) {
    const a = rng.range(0, TAU);
    const d = rng.range(pr.minR, pr.maxR);
    const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
    if (spotOk(ctx, mon, x, z)) return { x, z };
  }
  const n = Math.max(1, GUARDIAN_SPOT.steps);
  const step = TAU / n;
  const base = yawOf(mon.pos.x - p.x, mon.pos.z - p.z);
  const dists = [(pr.minR + pr.maxR) / 2, pr.minR, pr.maxR];
  for (let k = 0; k < n; k++) {
    const a = base + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * step;
    for (let j = 0; j < dists.length; j++) {
      const x = p.x + Math.sin(a) * dists[j], z = p.z + Math.cos(a) * dists[j];
      if (spotOk(ctx, mon, x, z)) return { x, z };
    }
  }
  return null;
}

/** 다시 나타난다 — 자리를 옮기고(없으면 그 자리) 보간을 끊고 플레이어를 본다 · AFFIX teleportIn @param {SimCtx} ctx @param {MonsterState} mon @param {MonAffixDef} row @param {any} st */
function reappear(ctx, mon, row, st) {
  st.vanishing = false;
  const p = ctx.state.player;
  const spot = p.dead ? null : findSpot(ctx, mon, row.params);
  if (spot) {
    mon.pos.x = spot.x;
    mon.pos.z = spot.z;
  }
  mon.prevPos.x = mon.pos.x;
  mon.prevPos.z = mon.pos.z;
  mon.vel.x = 0;
  mon.vel.z = 0;
  const dx = p.pos.x - mon.pos.x, dz = p.pos.z - mon.pos.z;
  if (dx !== 0 || dz !== 0) mon.facing = yawOf(dx, dz);
  if (mon.act === 'vanish') mon.act = 'idle';
  ctx.emit(EV.AFFIX, { monId: mon.id, affixId: row.id, what: 'teleportIn', x: mon.pos.x, z: mon.pos.z });
}

export const hook = {
  /** 피해(dmg > 0)를 받았다 — 쿨이 지났으면 표시(다음 onAwakeTick 에 순간이동) @param {SimCtx} ctx @param {MonsterState} mon @param {MonAffixDef} row @param {any} st */
  onDamaged(ctx, mon, row, st) {
    if (!(mon.hp > 0) || st.vanishing) return;
    if (typeof st.readyAt === 'number' && ctx.state.tick < st.readyAt) return;
    st.marked = true;
  },
  /**
   * 깨어 있는 매 틱 — 사라짐이 끝났으면 다시 나타나고, 아니면 (멀다 또는 표시됨) · 쿨 · 움직일 수 있음이면 사라진다
   * @param {SimCtx} ctx @param {MonsterState} mon @param {MonAffixDef} row @param {any} st
   */
  onAwakeTick(ctx, mon, row, st) {
    const pr = row.params;
    const tick = ctx.state.tick;
    if (mon.act === 'vanish') {
      st.vanishing = true;   // 고정 상태처럼 사라짐을 밖에서 세운 경우도 끝에 다시 나타난다
      if (tick < mon.actEnd) return;
    }
    if (st.vanishing) { reappear(ctx, mon, row, st); return; }
    if (typeof st.readyAt === 'number' && tick < st.readyAt) return;
    const p = ctx.state.player;
    if (p.dead || !(mon.hp > 0) || !canStart(mon, tick)) return;
    if (!st.marked && !(playerDist(ctx, mon) > pr.farDist)) return;
    const vT = Math.max(1, ticks(pr.vanish));
    mon.act = 'vanish';
    mon.actId = null;
    mon.actStart = tick;
    mon.actHit = tick;
    mon.actEnd = tick + vT;
    mon.aim = null;
    mon.aimLocked = false;
    mon.vel.x = 0;
    mon.vel.z = 0;
    setInvuln(ctx, mon, secOf(vT));
    st.vanishing = true;
    st.marked = false;
    st.readyAt = tick + ticks(pr.cd);
    ctx.emit(EV.AFFIX, { monId: mon.id, affixId: row.id, what: 'teleportOut', x: mon.pos.x, z: mon.pos.z });
  },
};
