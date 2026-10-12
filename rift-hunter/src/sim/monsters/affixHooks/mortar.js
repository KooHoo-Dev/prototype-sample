// OWNER: P16 — 계약 §8.2 · §7.5 · §6.9(훅 인터페이스) · §5.9(위협 간격)
// 몰타르 — 플레이어가 minDist(6m) 넘게 · range(11m) 안이고 보이면(벽 — 화면 밖 · 벽 너머에서 날아오는 포탄 없음) 깬 뒤 first(1.5초) · 이후 every(5초)마다
//   포탄 n(3)발: 하나는 플레이어 자리 · 나머지는 플레이어에서 spread(2m) × [0.5, 1) 떨어진 무작위 방향(rng.ai · 벽 앞에서 자름) — 각 효과 mortar(원 r 1.5 ·
//   예고 delay 1.2 · from = 몬스터 자리(포물선 연출) · mon.dmg × mul) · AFFIX mortarFire(몬스터 자리).
// hazard 속성 — onAwakeTick 은 팩의 대표에게만. 위협 간격은 세 발을 한 묶음으로 본다(canStartHazard 한 번 · count n · noteHazard 한 번 — §8.2).
//   막히면 다음 틱에 다시. 사라짐(순간이동) 중에는 쏘지 않는다.
// 상태 st = mon.ax.mortar: {nextAt}(절대 틱 · 깰 때 프레임워크가 비운다).

import { EV } from '../../../core/events.js';
import { circle } from '../../../core/shapes.js';
import { ticks } from '../../../core/time.js';
import { canStartHazard, noteHazard, spawnEffect } from '../../effects.js';
import { raycastWalk } from '../../world/nav.js';
import { playerDist, seesPlayer } from '../spawn.js';

/** @typedef {import('../../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../../types.js').MonsterState} MonsterState */
/** @typedef {import('../../../types.js').MonAffixDef} MonAffixDef */

/** 효과 kind(§9.8) · 피해 종류 */
const KIND = 'mortar';
const TYPE = 'phys';
const TAU = Math.PI * 2;

/** 포탄 하나(효과 mortar) @param {SimCtx} ctx @param {MonsterState} mon @param {any} pr @param {number} x @param {number} z */
function shell(ctx, mon, pr, x, z) {
  spawnEffect(ctx, {
    kind: KIND, owner: 'mon', srcId: mon.id, packId: mon.packId, hostile: true, shape: circle(x, z, pr.r), delay: pr.delay,
    spec: { srcId: mon.id, via: 'hazard', raw: mon.dmg * pr.mul, type: TYPE, level: mon.level, noAffix: true },
    from: { x: mon.pos.x, z: mon.pos.z }, cancelOnSrcDeath: false,
  });
}

export const hook = {
  /**
   * 깨어 있는 매 틱(팩의 대표만) — minDist < 거리 ≤ range · 시야 · first · every 주기 · 위협 간격(묶음 count n) 통과면 포탄 n 발
   * @param {SimCtx} ctx @param {MonsterState} mon @param {MonAffixDef} row @param {any} st
   */
  onAwakeTick(ctx, mon, row, st) {
    const pr = row.params;
    const tick = ctx.state.tick;
    if (typeof st.nextAt !== 'number') st.nextAt = tick + ticks(pr.first);
    const p = ctx.state.player;
    if (tick < st.nextAt || p.dead || mon.act === 'vanish') return;
    const d = playerDist(ctx, mon);
    if (!(d > pr.minDist) || d > pr.range || !seesPlayer(ctx, mon)) return;
    const n = Math.max(1, Math.floor(pr.n ?? 1));
    const px = p.pos.x, pz = p.pos.z;
    if (!canStartHazard(ctx, mon.packId, px, pz, { count: n, srcId: mon.id, shape: circle(px, pz, pr.r) })) return;
    shell(ctx, mon, pr, px, pz);
    const rng = ctx.rng.ai;
    for (let k = 1; k < n; k++) {
      const a = rng.range(0, TAU);
      const r = pr.spread * rng.range(0.5, 1);
      let tx = px + Math.sin(a) * r, tz = pz + Math.cos(a) * r;
      if (ctx.map) {
        const q = raycastWalk(ctx.map, px, pz, tx, tz, 0);
        tx = q.x;
        tz = q.z;
      }
      shell(ctx, mon, pr, tx, tz);
    }
    noteHazard(ctx, mon.packId);
    st.nextAt = tick + ticks(pr.every);
    ctx.emit(EV.AFFIX, { monId: mon.id, affixId: row.id, what: 'mortarFire', x: mon.pos.x, z: mon.pos.z });
  },
};
