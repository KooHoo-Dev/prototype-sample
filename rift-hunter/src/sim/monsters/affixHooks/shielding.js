// OWNER: P3 — 계약 §8.2 · §7.5 · §6.9(훅 인터페이스)
// 보호막 — 깬 뒤 first(4초) · 이후 every(9초)마다 AFFIX shieldWarn(warn 0.5초 금빛 반짝임 — 이 동안 st.warnUntil) → setInvuln(dur 3초) · AFFIX shieldOn → 끝에 shieldOff.
// 엇갈림(§8.2): 같은 팩에서 이 속성을 가진 구성원 i(memberIds 순서 · 0부터 · n = 깰 때 살아 있는 그 구성원 수)의 첫 사용 = first + i × every / n —
//   늘 팩의 일부만 무적이라 「다른 대상 공격」이 대응으로 남는다. hazard 가 아니라 모든 구성원에게 불린다.
// 상태 st = mon.ax.shielding: {nextAt, warnUntil, offUntil}(절대 틱 · -1 = 없음 — 깰 때 프레임워크가 비운다).

import { EV } from '../../../core/events.js';
import { ticks } from '../../../core/time.js';
import { getMonster } from '../../entities.js';
import { setInvuln } from '../../status.js';
import { aliveMon, packOf } from '../spawn.js';

/** @typedef {import('../../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../../types.js').MonsterState} MonsterState */
/** @typedef {import('../../../types.js').MonAffixDef} MonAffixDef */

/** 엇갈림 초 — 같은 팩에서 이 속성을 가진 살아 있는 구성원 중 내 순번 i · 수 n → i × every / n @param {SimCtx} ctx @param {MonsterState} mon @param {MonAffixDef} row */
function staggerSec(ctx, mon, row) {
  const pack = packOf(ctx, mon.packId);
  if (!pack) return 0;
  let i = -1, n = 0;
  for (const id of pack.memberIds) {
    const m = getMonster(ctx, id);
    if (!aliveMon(m) || !m.affixes.includes(row.id)) continue;
    if (m.id === mon.id) i = n;
    n += 1;
  }
  return i > 0 && n > 1 ? (i * row.params.every) / n : 0;
}

/** @param {SimCtx} ctx @param {MonsterState} mon @param {MonAffixDef} row @param {string} what */
function fx(ctx, mon, row, what) {
  ctx.emit(EV.AFFIX, { monId: mon.id, affixId: row.id, what, x: mon.pos.x, z: mon.pos.z });
}

export const hook = {
  /** @param {SimCtx} ctx @param {MonsterState} mon @param {MonAffixDef} row @param {any} st */
  onAwakeTick(ctx, mon, row, st) {
    const pr = row.params;
    const tick = ctx.state.tick;
    if (typeof st.nextAt !== 'number') {
      st.nextAt = tick + ticks(pr.first + staggerSec(ctx, mon, row));
      if (typeof st.warnUntil !== 'number') st.warnUntil = -1;
      if (typeof st.offUntil !== 'number') st.offUntil = -1;
    }
    if (typeof st.warnUntil !== 'number') st.warnUntil = -1;
    if (typeof st.offUntil !== 'number') st.offUntil = -1;
    // 막이 끝났다
    if (st.offUntil >= 0 && st.warnUntil < 0 && tick >= st.offUntil) {
      st.offUntil = -1;
      fx(ctx, mon, row, 'shieldOff');
    }
    // 예고 끝 → 무적 막
    if (st.warnUntil >= 0 && tick >= st.warnUntil) {
      st.warnUntil = -1;
      setInvuln(ctx, mon, pr.dur);
      st.offUntil = tick + ticks(pr.dur);
      fx(ctx, mon, row, 'shieldOn');
    }
    // 다음 예고
    if (st.warnUntil < 0 && st.offUntil < 0 && tick >= st.nextAt) {
      st.warnUntil = tick + Math.max(1, ticks(pr.warn));
      st.nextAt = tick + ticks(pr.every);
      fx(ctx, mon, row, 'shieldWarn');
    }
  },
};
