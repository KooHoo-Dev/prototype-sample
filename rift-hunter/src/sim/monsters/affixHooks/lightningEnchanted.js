// OWNER: P16 — 계약 §8.2 · §7.5 · §6.9(훅 인터페이스)
// 번개 강화 — 피해(dmg > 0)를 받으면 rng.ai.chance(chance) 이고 내부 쿨(icd) 이 지났을 때 번개 불꽃 n 발(투사체 spark · 360°/n 간격 + 무작위 회전 ·
// speed · r · life · 벽에 튕김 · 적대 · mon.dmg × mul 번개 · noAffix) · AFFIX sparks. mods(res lightning +0.3)는 프레임워크가 적용한다.
// hazard 가 아니다(투사체 — 위협 간격 대상이 아니다). 쓰러뜨린 적중도 「맞을 때」다(브리프 §3.5) — 이번 적중으로 생명 ≤ 0 이 돼도 불꽃은 튄다(반응 · 행동이 아니다 —
//   출처가 죽은 불꽃은 P2 투사체가 hazardHitPlayer 로 맞힌다). 이미 dead · gone 이면 없다.
// 상태 st = mon.ax.lightningEnchanted: {icdUntil}(절대 틱 — 이름 끝 Until · shiftTicks 가 민다 · 깰 때 프레임워크가 비운다).
// import 허용: combat · effects · projectiles · status · entities · world/nav · monsters/spawn.js(§2.2) — monsters.js · 레지스트리 · 다른 훅 파일은 import 하지 않는다.

import { EV } from '../../../core/events.js';
import { ticks } from '../../../core/time.js';
import { spawnProjectile } from '../../projectiles.js';

/** @typedef {import('../../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../../types.js').MonsterState} MonsterState */
/** @typedef {import('../../../types.js').MonAffixDef} MonAffixDef */

/** 투사체 visual(§9.8 — 만드는 쪽 P16) · 피해 종류 */
const VISUAL = 'spark';
const TYPE = 'lightning';
const TAU = Math.PI * 2;

export const hook = {
  /**
   * 피해를 받은 뒤 — 내부 쿨이 지났고 chance 에 걸리면 불꽃 n 발(출처 = 이 몬스터 · 몸 중심에서 사방으로 · 튕김)
   * @param {SimCtx} ctx @param {MonsterState} mon @param {MonAffixDef} row @param {any} st
   */
  onDamaged(ctx, mon, row, st) {
    const pr = row.params;
    const tick = ctx.state.tick;
    const n = Math.floor(pr.n ?? 0);
    if (!(n > 0) || mon.dead || mon.gone || ctx.state.player.dead) return;
    if (typeof st.icdUntil === 'number' && tick < st.icdUntil) return;
    const rng = ctx.rng.ai;
    if (!rng.chance(pr.chance)) return;
    st.icdUntil = tick + ticks(pr.icd);
    const base = rng.range(0, TAU);
    const step = TAU / n;
    const x = mon.pos.x, z = mon.pos.z;
    for (let k = 0; k < n; k++) {
      spawnProjectile(ctx, {
        visual: VISUAL, owner: 'mon', srcId: mon.id, x, z, facing: base + k * step, speed: pr.speed, life: pr.life, r: pr.r, bounce: true,
        spec: { srcId: mon.id, via: 'projectile', raw: mon.dmg * pr.mul, type: TYPE, level: mon.level, noAffix: true },
      });
    }
    ctx.emit(EV.AFFIX, { monId: mon.id, affixId: row.id, what: 'sparks', x, z });
  },
};
