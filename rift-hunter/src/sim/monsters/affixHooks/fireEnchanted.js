// OWNER: P3 — 계약 §8.2 · §7.5 · §6.9(훅 인터페이스)
// 화염 강화 — 적중에 화염 추가 · 죽으면 delay(1초) 뒤 자기 자리 폭발(fireDeath). mods(res fire +0.3)는 프레임워크가 적용한다.
// 사망 폭발은 위협 간격 H1~H4 의 예외다(플레이어가 죽이는 시점을 정한다 — 데이터 주석) · H5 는 데이터(delay 1.0 ≥ react + escape/slowSpeed).
// 속성 훅이 만든 피해는 noAffix(속성 onHitPlayer 가 다시 돌지 않는다). 출처가 죽은 뒤에도 남는다(cancelOnSrcDeath false — §5.16-6).

import { EV } from '../../../core/events.js';
import { circle } from '../../../core/shapes.js';
import { hazardHitPlayer } from '../../combat.js';
import { spawnEffect } from '../../effects.js';

/** @typedef {import('../../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../../types.js').MonsterState} MonsterState */
/** @typedef {import('../../../types.js').MonAffixDef} MonAffixDef */

/** 효과 kind(§9.8) · 피해 종류 */
const KIND = 'fireDeath';
const TYPE = 'fire';

export const hook = {
  /**
   * 같은 공격 피해(spec.raw — 감소 전)의 extraFire(30%)를 화염으로 한 번 더(hazardHitPlayer · noAffix · 밀림 없음)
   * @param {SimCtx} ctx @param {MonsterState} mon @param {MonAffixDef} row @param {Object} st
   * @param {import('../../../types.js').PlayerHitResult} res @param {import('../../../types.js').MonAttackSpec} [spec]
   */
  onHitPlayer(ctx, mon, row, st, res, spec) {
    const k = row.params.extraFire;
    const base = spec && spec.raw > 0 ? spec.raw : (res?.dmg ?? 0);
    if (!(k > 0) || !(base > 0) || ctx.state.player.dead) return;
    hazardHitPlayer(ctx, { srcId: mon.id, via: 'hazard', raw: base * k, type: TYPE, level: mon.level, noAffix: true });
  },
  /**
   * 사망 — 효과 fireDeath(자기 자리 원 deathR · 예고 delay · mon.dmg × deathMul 화염 · noAffix · 출처 사망 후에도 남는다) · AFFIX fireArm
   * @param {SimCtx} ctx @param {MonsterState} mon @param {MonAffixDef} row @param {Object} st
   */
  onDeath(ctx, mon, row, st) {
    const pr = row.params;
    if (!(pr.deathR > 0)) return;
    const x = mon.pos.x, z = mon.pos.z;
    spawnEffect(ctx, {
      kind: KIND, owner: 'mon', srcId: mon.id, packId: mon.packId, hostile: true, shape: circle(x, z, pr.deathR), delay: pr.delay,
      spec: { srcId: mon.id, via: 'hazard', raw: mon.dmg * pr.deathMul, type: TYPE, level: mon.level, noAffix: true },
      cancelOnSrcDeath: false,
    });
    ctx.emit(EV.AFFIX, { monId: mon.id, affixId: row.id, what: 'fireArm', x, z });
  },
};
