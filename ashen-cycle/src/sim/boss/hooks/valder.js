// OWNER: P3 — 계약 §8.10 · §8.8 (훅)
// 발더의 보스 전용 로직은 이것뿐이다 — 2페이즈에 대검에 불이 붙는다(ext.enchanted · `enchant` 큐).
// 나머지 동작은 전부 data/bosses/valder.js의 데이터로 프레임워크가 돌린다.
import { EV } from '../../../core/events.js';

/** @typedef {import('../../../types.js').BossHooks} BossHooks */

/** @type {BossHooks} */
export const valderHooks = {
  onCreate(ctx) {
    ctx.state.boss.ext.enchanted = false;
  },

  onPhaseChange(ctx, phase) {
    const boss = ctx.state.boss;
    boss.ext.enchanted = phase === 2;
    if (!boss.ext.enchanted) return;
    ctx.emit(EV.BOSS_CUE, {
      bossId: boss.id, attackId: '', seq: 0, cue: 'enchant', style: ctx.bossDef.style,
      x: boss.pos.x, z: boss.pos.z, facing: boss.facing,
    });
  },
};
