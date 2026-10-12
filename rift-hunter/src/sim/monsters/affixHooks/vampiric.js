// OWNER: P3 — 계약 §8.2 · §7.5 · §6.9(훅 인터페이스)
// 흡혈 — 준 피해의 leech(50%) 회복 · 깨어 있는 동안 초당 최대 생명 regenPctPerSec(1%) 회복 · 붉은 오라는 view(mon.affixes).
// AFFIX heal 은 fxEvery(1초)에 한 번까지(소리 · 입자가 매 틱 터지지 않게). 상태 st = mon.ax.vampiric: {fxAt}.

import { DT } from '../../../core/constants.js';
import { EV } from '../../../core/events.js';
import { ticks } from '../../../core/time.js';
import { healMonster } from '../../combat.js';

/** @typedef {import('../../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../../types.js').MonsterState} MonsterState */
/** @typedef {import('../../../types.js').MonAffixDef} MonAffixDef */

/** 회복 연출 — fxEvery 에 한 번 @param {SimCtx} ctx @param {MonsterState} mon @param {MonAffixDef} row @param {any} st */
function healFx(ctx, mon, row, st) {
  const tick = ctx.state.tick;
  if (typeof st.fxAt === 'number' && tick < st.fxAt) return;
  st.fxAt = tick + Math.max(1, ticks(row.params.fxEvery ?? 0));
  ctx.emit(EV.AFFIX, { monId: mon.id, affixId: row.id, what: 'heal', x: mon.pos.x, z: mon.pos.z });
}

export const hook = {
  /** 준 피해(res.dmg)의 leech 회복 @param {SimCtx} ctx @param {MonsterState} mon @param {MonAffixDef} row @param {any} st @param {import('../../../types.js').PlayerHitResult} res */
  onHitPlayer(ctx, mon, row, st, res) {
    const amount = (res?.dmg ?? 0) * row.params.leech;
    if (!(amount > 0)) return;
    if (healMonster(ctx, mon, amount) > 0) healFx(ctx, mon, row, st);
  },
  /** 초당 최대 생명 regenPctPerSec 회복(가득이면 없음) @param {SimCtx} ctx @param {MonsterState} mon @param {MonAffixDef} row @param {any} st */
  onAwakeTick(ctx, mon, row, st) {
    if (!(mon.hp < mon.hpMax)) return;
    if (healMonster(ctx, mon, mon.hpMax * row.params.regenPctPerSec * DT) > 0) healFx(ctx, mon, row, st);
  },
};
