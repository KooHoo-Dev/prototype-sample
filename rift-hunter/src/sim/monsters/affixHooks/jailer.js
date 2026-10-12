// OWNER: P16 — 계약 §8.2 · §7.5 · §6.9(훅 인터페이스) · §5.9(위협 간격)
// 감옥 — 깬 뒤 first(2초) · 이후 every(7초)마다 · 플레이어가 range(11m) 안이고 보이면(벽) 플레이어 자리에 효과 jail(원 r 1.2 · 예고 delay 0.8 ·
//   spec raw 0 + onHit.rootSec 1.5 — 판정 때 플레이어가 안이면 P2 effects 가 rootPlayer + rootLockUntil(H2)) · AFFIX jailWarn(시전한 몬스터 자리).
// hazard 속성 — onAwakeTick 은 팩의 대표에게만(§5.17-7). 순서: canStartHazard(jail:true — H1 · H2 · H3 · H4 · 기절/빙결 출처) → spawnEffect → noteHazard.
//   막히면 다음 틱에 다시(타이머를 버리지 않는다). 사라짐(순간이동) 중에는 시작하지 않는다(보이지 않는 출처의 표식 금지).
// P16 보수 규칙(NOTES-P16): 감옥 원(r + 플레이어 몸)에 끝나지 않은 적대 지속 효과(역병 웅덩이 · 독 웅덩이 — 예고 중 포함)가 겹치면 시작하지 않는다 —
//   H3 은 예고만 보므로 이것이 없으면 역병 웅덩이 위에서 묶여 웅덩이 틱을 맞는 「묶인 채 맞는」 판정이 생긴다.
// 상태 st = mon.ax.jailer: {nextAt}(절대 틱 · 깰 때 프레임워크가 비운다 — 첫 onAwakeTick 에서 first 를 잡는다).

import { EV } from '../../../core/events.js';
import { circle, overlaps } from '../../../core/shapes.js';
import { ticks } from '../../../core/time.js';
import { canStartHazard, noteHazard, spawnEffect } from '../../effects.js';
import { playerDist, seesPlayer } from '../spawn.js';

/** @typedef {import('../../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../../types.js').MonsterState} MonsterState */
/** @typedef {import('../../../types.js').MonAffixDef} MonAffixDef */

/** 효과 kind(§9.8) · 피해 종류(raw 0 — 묶기만 한다) */
const KIND = 'jail';
const TYPE = 'phys';

/**
 * (x, z) 반지름 rad 원과 겹치는 끝나지 않은 적대 지속 효과(tickT > 0 — 웅덩이)가 있는가(예고 중 · 지속 중 모두)
 * @param {SimCtx} ctx @param {number} x @param {number} z @param {number} rad
 */
function poolNear(ctx, x, z, rad) {
  const rift = ctx.state.rift;
  if (!rift) return false;
  const tick = ctx.state.tick;
  const list = rift.effects;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.hostile || !(e.tickT > 0) || e.end <= tick) continue;
    if (overlaps(e.shape, x, z, rad)) return true;
  }
  return false;
}

export const hook = {
  /**
   * 깨어 있는 매 틱(팩의 대표만) — first · every 주기 · 11m 안 · 시야 · 위협 간격 통과면 플레이어 발밑에 감옥 예고
   * @param {SimCtx} ctx @param {MonsterState} mon @param {MonAffixDef} row @param {any} st
   */
  onAwakeTick(ctx, mon, row, st) {
    const pr = row.params;
    const tick = ctx.state.tick;
    if (typeof st.nextAt !== 'number') st.nextAt = tick + ticks(pr.first);
    const p = ctx.state.player;
    if (tick < st.nextAt || p.dead || mon.act === 'vanish') return;
    if (playerDist(ctx, mon) > pr.range || !seesPlayer(ctx, mon)) return;
    const x = p.pos.x, z = p.pos.z;
    if (poolNear(ctx, x, z, pr.r + p.r)) return;
    const shape = circle(x, z, pr.r);
    if (!canStartHazard(ctx, mon.packId, x, z, { jail: true, srcId: mon.id, shape })) return;
    spawnEffect(ctx, {
      kind: KIND, owner: 'mon', srcId: mon.id, packId: mon.packId, hostile: true, shape, delay: pr.delay,
      spec: { srcId: mon.id, via: 'hazard', raw: 0, type: TYPE, level: mon.level, noAffix: true, onHit: { rootSec: pr.rootSec } },
      cancelOnSrcDeath: false,
    });
    noteHazard(ctx, mon.packId);
    st.nextAt = tick + ticks(pr.every);
    ctx.emit(EV.AFFIX, { monId: mon.id, affixId: row.id, what: 'jailWarn', x: mon.pos.x, z: mon.pos.z });
  },
};
