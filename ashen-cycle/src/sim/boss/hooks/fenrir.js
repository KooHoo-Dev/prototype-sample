// OWNER: P10 — 계약 §8.11 · §8.8 (훅)
// 펜리르의 보스 전용 로직은 둘뿐이다. 나머지 동작은 전부 data/bosses/fenrir.js의 데이터로 프레임워크가 돌린다.
//   1) 백홉 다듬기(adjustWeights) — 빠질 자리가 없으면(벽 · 기둥) 뛰지 않고, 방금 뛰었으면 다른 공격을 몇 번 한 뒤에야 다시 뛰고,
//      얻어맞고 있으면(최근에 깎인 HP = ext.pressure) 더 자주 빠진다 — "사거리 밖으로 자주 빠진다"(§8.11).
//   2) 2페이즈 포효의 순간에 `shatter` 큐 — 몸의 얼음이 터져 자란다(뷰가 갈기 가시를 키운다).
// ext: {sinceHop: number, pressure: number, lastHp: number, burst: boolean} — 순수 값. 수치는 FENRIR_EXT.
// 훅이 쓰는 것: boss.ext뿐(+ ctx.emit(BOSS_CUE)). 플레이어 상태 · boss.state/attack은 건드리지 않는다.
import { EV } from '../../../core/events.js';
import { EPS } from '../../../core/constants.js';
import { clamp01, lerp } from '../../../core/math2d.js';
import { circleOverlapsWorld } from '../../../core/collide.js';
import { BOSS_AI } from '../../../data/bossCommon.js';
import { FENRIR_EXT } from '../../../data/bosses/fenrir.js';

/** @typedef {import('../../../types.js').BossHooks} BossHooks */
/** @typedef {import('../../../types.js').SimCtx} SimCtx */

const HOP_ID = 'backhop';

/**
 * ext를 채운다(없는 필드만). makeTestBoss처럼 onCreate 없이 만든 상태도 받는다.
 * @param {SimCtx} ctx
 * @returns {{sinceHop:number, pressure:number, lastHp:number, burst:boolean}}
 */
function ensureExt(ctx) {
  const boss = ctx.state.boss;
  /** @type {any} */
  const ext = boss.ext;
  if (typeof ext.sinceHop !== 'number') ext.sinceHop = FENRIR_EXT.hopGapAttacks;
  if (typeof ext.pressure !== 'number') ext.pressure = 0;
  if (typeof ext.lastHp !== 'number') ext.lastHp = boss.hp;
  if (typeof ext.burst !== 'boolean') ext.burst = boss.phase === 2;
  return ext;
}

/**
 * 백홉으로 빠질 자리가 있는가 — 플레이어 반대쪽(백홉은 예고 내내 플레이어를 보므로 뛰는 방향 = 플레이어 반대)으로
 * 이동 거리만큼의 경로와 착지 자리가 아레나 안이고 기둥에 걸리지 않는다.
 * @param {SimCtx} ctx
 * @returns {boolean}
 */
function hasHopRoom(ctx) {
  const boss = ctx.state.boss;
  const hop = ctx.bossDef.attacks[HOP_ID];
  if (!hop || !hop.move) return false;
  const p = ctx.state.player.pos;
  let dx = boss.pos.x - p.x;
  let dz = boss.pos.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d > EPS) {
    dx /= d;
    dz /= d;
  } else {
    dx = -Math.sin(boss.facing);
    dz = -Math.cos(boss.facing);
  }
  const dist = hop.move.dist;
  // 경로를 hopSamples 등분해 본다. 마지막 지점이 착지 자리다(여유를 더 준다)
  const n = FENRIR_EXT.hopSamples;
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const pad = i < n ? 0 : FENRIR_EXT.hopClearPad;
    if (circleOverlapsWorld(boss.pos.x + dx * dist * u, boss.pos.z + dz * dist * u, boss.radius + pad, ctx.state.world)) return false;
  }
  return true;
}

/** @type {BossHooks} */
export const fenrirHooks = {
  onCreate(ctx) {
    const boss = ctx.state.boss;
    boss.ext.sinceHop = FENRIR_EXT.hopGapAttacks;
    boss.ext.pressure = 0;
    boss.ext.lastHp = boss.hp;
    boss.ext.burst = false;
  },

  onTick(ctx, dt) {
    const boss = ctx.state.boss;
    const ext = ensureExt(ctx);
    // 압박: 최근에 깎인 HP 비율. 맞을 때마다 쌓이고 시간이 지나면 식는다
    const lost = ext.lastHp - boss.hp;
    ext.lastHp = boss.hp;
    ext.pressure *= Math.exp(-FENRIR_EXT.pressureDecay * dt);
    if (lost > 0 && boss.hpMax > 0) ext.pressure += lost / boss.hpMax;

    // 2페이즈 포효(프레임워크의 `roar` 큐와 같은 틱)에 얼음이 터진다
    if (boss.state === 'phaseShift' && !ext.burst && boss.stateTime >= BOSS_AI.phaseRoarAt) {
      ext.burst = true;
      ctx.emit(EV.BOSS_CUE, {
        bossId: boss.id, attackId: '', seq: 0, cue: 'shatter', style: ctx.bossDef.style,
        x: boss.pos.x, z: boss.pos.z, facing: boss.facing,
      });
    }
  },

  adjustWeights(ctx, cands) {
    const ext = ensureExt(ctx);
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (c.id !== HOP_ID) continue;
      if (ext.sinceHop < FENRIR_EXT.hopGapAttacks || !hasHopRoom(ctx)) {
        c.weight = 0;
      } else {
        c.weight *= lerp(1, FENRIR_EXT.pressureHopMul, clamp01(ext.pressure / FENRIR_EXT.pressureFull));
      }
    }
  },

  onAttackStart(ctx, atk) {
    const ext = ensureExt(ctx);
    if (atk.id === HOP_ID) {
      ext.sinceHop = 0;
      ext.pressure = 0; // 빠졌다 — 압박을 턴다
    } else {
      ext.sinceHop += 1;
    }
  },

  onPhaseChange(ctx, phase) {
    const ext = ensureExt(ctx);
    ext.pressure = 0;
    ext.burst = phase !== 2; // 2페이즈 전환이면 포효 때 한 번 터진다(onTick)
  },
};
