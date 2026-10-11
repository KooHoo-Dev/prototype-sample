// OWNER: P2 — 계약 §6.8 · §5.7
// STUB — W1 에서 P2 가 채운다(조건부 패시브 판정). W0: 키 전부 false · condStatsFor 빈 합
// CONDS[id] = (ctx, mon|null) => boolean — 프레임워크는 ID 를 모른다(표만 돈다).

/** @typedef {import('../types.js').SimCtx} SimCtx */

export const CONDS = {
  targetDisabled: (ctx, mon) => false,
  targetBurning: (ctx, mon) => false,
  targetFrozen: (ctx, mon) => false,
  rage50: (ctx, mon) => false,
  lifeBelow35: (ctx, mon) => false,
};

/** STUB — 참인 조건의 합(PlayerStats 단위) @param {SimCtx} ctx @param {import('../types.js').MonsterState|null} mon @param {'offense'|'defense'} side @returns {Record<string, number>} */
export function condStatsFor(ctx, mon, side) {
  return {};
}
