// OWNER: P16 — 계약 §8.2 · §7.5 · §6.9(훅 인터페이스)
// 분열 — 죽으면(onDeath · rank 가 split 이 아닐 때) 시체 자리에서 spread(1.5m) 안의 걷기 가능 점 n(3)곳에 같은 종류 rank split(속성 없음 · 깨어 있게 ·
//   같은 팩 — memberIds 에 잇는다 · 플레이어를 본다 · MON_SPAWNED{split} 은 spawnMonster 가 낸다) · AFFIX split(시체 자리).
//   자리: 고르게 나눈 방향(360°/n + 무작위 회전) × spread × [0.5, 1) 을 먼저 보고, 막혔으면 무작위(rng.ai · PACK_PLACE.tries 번) → 그래도 없으면 시체 자리(밀어내기가 떼어 놓는다).
// P16 해석(NOTES-P16): 수호자(rank guardian)는 분열하지 않는다 — 수호자 처치 = 균열 완료라 사본은 같은 틱의 완료 정리로 곧바로 사라진다(보이자마자 쓰러지는 사본 3).
//   완료 정리로 사라지는 몬스터는 프레임워크가 사망 훅을 부르지 않는다(§5.10) · 사본(rank split)은 다시 분열하지 않는다.
// hazard 가 아니다. 상태 없음.

import { EV } from '../../../core/events.js';
import { yawOf } from '../../../core/math.js';
import { PACK_PLACE } from '../../../data/packs.js';
import { isWalkableR } from '../../world/nav.js';
import { monsterStats, packOf, spawnMonster } from '../spawn.js';

/** @typedef {import('../../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../../types.js').MonsterState} MonsterState */
/** @typedef {import('../../../types.js').MonAffixDef} MonAffixDef */

const SPLIT = 'split';
const NO_SPLIT = new Set([SPLIT, 'guardian']);
const TAU = Math.PI * 2;

export const hook = {
  /** 사망 처리 중 — 사본 n 마리 @param {SimCtx} ctx @param {MonsterState} mon @param {MonAffixDef} row */
  onDeath(ctx, mon, row) {
    if (NO_SPLIT.has(mon.rank) || !ctx.state.rift) return;
    const pr = row.params;
    const n = Math.max(0, Math.floor(pr.n ?? 0));
    if (!(n > 0)) return;
    const map = ctx.map;
    const rng = ctx.rng.ai;
    const cx = mon.pos.x, cz = mon.pos.z;
    const cr = monsterStats(mon.typeId, SPLIT, mon.level, []).r;
    const pack = packOf(ctx, mon.packId);
    const p = ctx.state.player.pos;
    const base = rng.range(0, TAU);
    for (let k = 0; k < n; k++) {
      let x = cx, z = cz;
      let ok = false;
      for (let i = 0; i <= PACK_PLACE.tries && !ok; i++) {
        const a = i === 0 ? base + (k * TAU) / n : rng.range(0, TAU);
        const d = i === 0 ? pr.spread * rng.range(0.5, 1) : rng.range(0, pr.spread);
        const tx = cx + Math.sin(a) * d, tz = cz + Math.cos(a) * d;
        if (!map || isWalkableR(map, tx, tz, cr)) { x = tx; z = tz; ok = true; }
      }
      const dx = p.x - x, dz = p.z - z;
      const copy = spawnMonster(ctx, {
        typeId: mon.typeId, rank: SPLIT, level: mon.level, affixes: [], packId: pack ? pack.id : -1, x, z,
        facing: dx !== 0 || dz !== 0 ? yawOf(dx, dz) : mon.facing, awake: true, reason: SPLIT,
      });
      if (pack) pack.memberIds.push(copy.id);
    }
    ctx.emit(EV.AFFIX, { monId: mon.id, affixId: row.id, what: 'split', x: cx, z: cz });
  },
};
