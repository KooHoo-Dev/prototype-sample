// OWNER: P3 — 계약 §8.3 · §7.5b · §6.9(훅 인터페이스)
// 뼈 거인 — 기본 공격 swing(근접 · 프레임워크 기본 판정) + 고유 기술 둘(kind cast):
//   slam 대지 분쇄 — 플레이어가 range(6m) 안 · 효과 slam(원뿔 r 6.5 · 100° · 예고 1.2 · cancelOnSrcDeath · 흔들림 0.5)
//   spikes 뼈 가시 — range(11m) 안 · 시야 · 효과 boneSpikes 5개(선 len 12 · 폭 1.4 · 플레이어 방향 기준 −50 · −25 · 0 · +25 · +50° · 예고 1.4 ·
//                   cancelOnSrcDeath · H4 count 5) — 선 사이로 피한다(틈 = 2d·sin12.5° − 1.4 — 6m 에서 1.2m > 몸 0.8m · 5.1m 안이면 옆으로 나간다 — escape 3.9)
// 바닥 표식 기술: canStartHazard(H1~H4 · count) → startAttack → **그 틱에** spawnEffect(delay = 예비 길이 · 실제 spec) → noteHazard — 막히면 그 기술을 시작하지 않는다.
// strike(판정 틱)는 효과를 다시 만들지 않는다(판정 주체는 효과 하나 — §8.3). 흔들림은 효과 spec.shake(P2 effects 가 판정 틱에 SHAKE).
// impl 상태 mon.ax.g(깨울 때 남는다) — init 이 고유 기술 첫 사용 시각을 readyAt 에 둔다(think 가 init 전이면 먼저 부른다 — 고정 상태 · 디버그 팩).

import { deg2rad, yawOf } from '../../../core/math.js';
import { cone, line } from '../../../core/shapes.js';
import { ticks } from '../../../core/time.js';
import { canStartHazard, noteHazard, spawnEffect } from '../../effects.js';
import { attackOf, attackReady, firstMelee, meleeStartOk, monSpec, playerDist, seesPlayer, startAttack } from '../spawn.js';

/** @typedef {import('../../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../../types.js').MonsterState} MonsterState */
/** @typedef {import('../../../types.js').MonsterDef} MonsterDef */
/** @typedef {import('../../../types.js').AttackDef} AttackDef */

/** 공격 ID · 효과 kind(§9.8) */
const SLAM = 'slam';
const SPIKES = 'spikes';
const FX_SLAM = 'slam';
const FX_SPIKES = 'boneSpikes';

/** 뼈 가시 선 모양들(플레이어 방향 기준 −spread … +spread · step 간격) @param {MonsterState} mon @param {number} base @param {any} pr */
function spikeShapes(mon, base, pr) {
  const out = [];
  const spread = deg2rad(pr.spreadDeg ?? 0), step = deg2rad(pr.stepDeg ?? 0);
  const n = Math.max(1, pr.n ?? 1);
  for (let i = 0; i < n; i++) {
    const a = base - spread + step * i;
    out.push(line(mon.pos.x, mon.pos.z, a, pr.len ?? 0, pr.width ?? 0));
  }
  return out;
}

/**
 * 바닥 표식 기술 시작 — 위협 간격을 통과하면 예비 시작 + 그 틱에 효과(들) + noteHazard
 * @param {SimCtx} ctx @param {MonsterState} mon @param {AttackDef} atk @param {import('../../../types.js').Shape[]} shapes @param {string} kind
 * @param {number} facing @returns {boolean}
 */
function startGroundSkill(ctx, mon, atk, shapes, kind, facing) {
  const p = ctx.state.player.pos;
  const count = atk.params?.count ?? shapes.length;
  const center = shapes[Math.floor(shapes.length / 2)];
  if (!canStartHazard(ctx, mon.packId, p.x, p.z, { count, srcId: mon.id, shape: center })) return false;
  const delay = startAttack(ctx, mon, atk.id, { facing });
  const spec = monSpec(mon, atk, 'hazard');
  if (atk.params?.shake > 0) /** @type {any} */ (spec).shake = atk.params.shake;
  for (const shape of shapes) {
    spawnEffect(ctx, { kind, owner: 'mon', srcId: mon.id, packId: mon.packId, hostile: true, shape, delay, spec: { ...spec }, cancelOnSrcDeath: true });
  }
  noteHazard(ctx, mon.packId);
  return true;
}

export const impl = {
  /** 스폰 직후 — 고유 기술 첫 사용(params.slamFirst · spikesFirst 초 뒤) @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def */
  init(ctx, mon, def) {
    const tick = ctx.state.tick;
    const pr = def.params ?? {};
    mon.ax.g = { initAt: tick };
    const slam = attackOf(def, SLAM), spikes = attackOf(def, SPIKES);
    if (slam) mon.readyAt[slam.id] = Math.max(mon.readyAt[slam.id] ?? 0, tick + ticks(pr.slamFirst ?? 0));
    if (spikes) mon.readyAt[spikes.id] = Math.max(mon.readyAt[spikes.id] ?? 0, tick + ticks(pr.spikesFirst ?? 0));
  },
  /**
   * 행동 가능할 때마다 — slam(range 안 · 준비) > swing(근접 사거리 · 원뿔) > spikes(range 안 · 시야 · 준비) > chase
   * @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def
   */
  think(ctx, mon, def) {
    if (!mon.ax.g) impl.init(ctx, mon, def);
    const b = /** @type {any} */ (mon.ax.b ?? (mon.ax.b = { move: 'chase', spd: 1 }));
    const st = ctx.state;
    const p = st.player;
    const tick = st.tick;
    if (p.dead) { b.move = 'hold'; return; }
    const d = playerDist(ctx, mon);
    const base = yawOf(p.pos.x - mon.pos.x, p.pos.z - mon.pos.z);
    const slam = attackOf(def, SLAM);
    if (slam && attackReady(mon, slam, tick) && d <= (slam.range ?? 0)) {
      const pr = slam.params ?? {};
      const shape = cone(mon.pos.x, mon.pos.z, pr.r ?? 0, base, deg2rad(pr.angleDeg ?? 0));
      if (startGroundSkill(ctx, mon, slam, [shape], FX_SLAM, base)) return;
    }
    const swing = firstMelee(def);
    if (swing && attackReady(mon, swing, tick) && meleeStartOk(mon, swing, p)) {
      startAttack(ctx, mon, swing.id);
      return;
    }
    const spikes = attackOf(def, SPIKES);
    if (spikes && attackReady(mon, spikes, tick) && d <= (spikes.range ?? 0) && seesPlayer(ctx, mon)) {
      if (startGroundSkill(ctx, mon, spikes, spikeShapes(mon, base, spikes.params ?? {}), FX_SPIKES, base)) return;
    }
    b.move = 'chase';
  },
  /** 고유 기술의 판정 틱 — 효과가 판정한다(여기서 다시 만들지 않는다) @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def @param {AttackDef} atk */
  strike(ctx, mon, def, atk) {},
};
