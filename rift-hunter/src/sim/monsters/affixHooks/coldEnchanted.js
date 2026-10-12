// OWNER: P3 — 계약 §8.2 · §7.5 · §6.9(훅 인터페이스)
// 냉기 강화 — 적중 시 플레이어 감속 · 주기적 냉기 노바(자기 중심 원 · 예고 delay 1.3). mods(res cold +0.3)는 프레임워크가 적용한다.
// hazard 속성이라 onAwakeTick 은 팩의 대표에게만 불린다(§5.17-7 — 하수인은 대표가 되지 않는다: 하수인은 적중 감속만).
// 바닥 위협 순서: canStartHazard(H1~H4 · 기절 · 빙결이면 false) → spawnEffect → noteHazard. 막히면 다음 틱에 다시(타이머를 버리지 않는다).
// 플레이어가 params.range(8m) 밖이면 노바를 깔지 않는다(화면 밖 표식 금지 — 그 사이 타이머는 기다린다).
// 상태 st = mon.ax.coldEnchanted: {nextAt} — 깰 때 프레임워크가 비운다(깬 뒤 novaFirst · 이후 novaEvery).

import { EV } from '../../../core/events.js';
import { circle } from '../../../core/shapes.js';
import { ticks } from '../../../core/time.js';
import { STATUS } from '../../../data/combat.js';
import { canStartHazard, noteHazard, spawnEffect } from '../../effects.js';
import { slowPlayer } from '../../status.js';
import { playerDist } from '../spawn.js';

/** @typedef {import('../../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../../types.js').MonsterState} MonsterState */
/** @typedef {import('../../../types.js').MonAffixDef} MonAffixDef */

/** 효과 kind(§9.8) · 피해 종류 */
const KIND = 'coldNova';
const TYPE = 'cold';

export const hook = {
  /** 적중 감속 — slowPlayer(STATUS.playerChill 0.4, chillSec) @param {SimCtx} ctx @param {MonsterState} mon @param {MonAffixDef} row */
  onHitPlayer(ctx, mon, row) {
    slowPlayer(ctx, STATUS.playerChill, row.params.chillSec);
  },
  /**
   * 깬 뒤 novaFirst · 이후 novaEvery 초마다 효과 coldNova(자기 중심 r novaR · 예고 delay · mon.dmg × novaMul 냉기 · 적중 시 감속 novaChillSec · noAffix) · AFFIX novaWarn
   * @param {SimCtx} ctx @param {MonsterState} mon @param {MonAffixDef} row @param {any} st
   */
  onAwakeTick(ctx, mon, row, st) {
    const pr = row.params;
    const tick = ctx.state.tick;
    if (typeof st.nextAt !== 'number') st.nextAt = tick + ticks(pr.novaFirst);
    if (tick < st.nextAt || ctx.state.player.dead) return;
    if (playerDist(ctx, mon) > pr.range) return;
    const x = mon.pos.x, z = mon.pos.z;
    const shape = circle(x, z, pr.novaR);
    if (!canStartHazard(ctx, mon.packId, x, z, { srcId: mon.id, shape })) return;
    spawnEffect(ctx, {
      kind: KIND, owner: 'mon', srcId: mon.id, packId: mon.packId, hostile: true, shape, delay: pr.delay,
      spec: { srcId: mon.id, via: 'hazard', raw: mon.dmg * pr.novaMul, type: TYPE, level: mon.level, noAffix: true, onHit: { chillSec: pr.novaChillSec } },
      cancelOnSrcDeath: false,
    });
    noteHazard(ctx, mon.packId);
    st.nextAt = tick + ticks(pr.novaEvery);
    ctx.emit(EV.AFFIX, { monId: mon.id, affixId: row.id, what: 'novaWarn', x, z });
  },
};
