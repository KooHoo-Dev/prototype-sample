// OWNER: P16 — 계약 §8.2 · §7.5 · §6.9(훅 인터페이스) · §5.9(위협 간격)
// 역병 — 깬 뒤 first(2초) · 이후 every(6초)마다 · 플레이어가 range(11m) 안이고 보이면(벽) 플레이어 자리에 효과 plague(원 r 2.0 · 예고 delay 1.0 →
//   웅덩이 dur 5초 · tick 0.5초 틱 · 초당 mon.dmg × mulPerSec — spec null(예고 부분은 판정 없음) · tickSpec 한 틱 = 초당 × tick · 첫 지속 판정 hitAt + tickT) ·
//   AFFIX plagueWarn(시전한 몬스터 자리). 출처가 죽어도 웅덩이는 남는다(cancelOnSrcDeath false — §5.16-6).
// hazard 속성 — onAwakeTick 은 팩의 대표에게만(§5.17-7). 순서: canStartHazard(H1~H4 · 기절/빙결 출처) → spawnEffect → noteHazard. 막히면 다음 틱에 다시.
//   사라짐(순간이동) 중에는 시작하지 않는다.
// 상태 st = mon.ax.plague: {nextAt}(절대 틱 · 깰 때 프레임워크가 비운다).

import { EV } from '../../../core/events.js';
import { circle } from '../../../core/shapes.js';
import { ticks } from '../../../core/time.js';
import { canStartHazard, noteHazard, spawnEffect } from '../../effects.js';
import { playerDist, seesPlayer } from '../spawn.js';

/** @typedef {import('../../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../../types.js').MonsterState} MonsterState */
/** @typedef {import('../../../types.js').MonAffixDef} MonAffixDef */

/** 효과 kind(§9.8) · 피해 종류(독은 따로 없다 — 역병 덩어리 웅덩이와 같은 phys) */
const KIND = 'plague';
const TYPE = 'phys';

export const hook = {
  /**
   * 깨어 있는 매 틱(팩의 대표만) — first · every 주기 · 11m 안 · 시야 · 위협 간격 통과면 플레이어 발밑에 역병 예고(→ 웅덩이)
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
    const shape = circle(x, z, pr.r);
    if (!canStartHazard(ctx, mon.packId, x, z, { srcId: mon.id, shape })) return;
    spawnEffect(ctx, {
      kind: KIND, owner: 'mon', srcId: mon.id, packId: mon.packId, hostile: true, shape, delay: pr.delay, dur: pr.dur, tick: pr.tick,
      spec: null,
      tickSpec: { srcId: mon.id, via: 'hazard', raw: mon.dmg * pr.mulPerSec * pr.tick, type: TYPE, level: mon.level, noAffix: true },
      cancelOnSrcDeath: false,
    });
    noteHazard(ctx, mon.packId);
    st.nextAt = tick + ticks(pr.every);
    ctx.emit(EV.AFFIX, { monId: mon.id, affixId: row.id, what: 'plagueWarn', x: mon.pos.x, z: mon.pos.z });
  },
};
