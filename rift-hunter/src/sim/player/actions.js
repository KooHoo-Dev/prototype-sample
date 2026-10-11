// OWNER: P1 — 계약 §6.7 · §5.3 · §5.5
// STUB — W1 에서 P1 이 채운다(행동 단계 · 자원 · 쿨다운 · 포션 · 귀환 시전 · 선입력). W0: onPlayerDamaged no-op · isActionable 최소

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').PlayerState} PlayerState */

/** STUB — ctx.hooks.onPlayerDamaged 구현(분노 생성 · 귀환 취소) @param {SimCtx} ctx @param {number} dmg */
export function onPlayerDamaged(ctx, dmg) {}

/** 행동 가능 = act ∈ {idle, move} · 살아 있음 @param {PlayerState} player */
export function isActionable(player) {
  return !player.dead && (player.act === 'idle' || player.act === 'move');
}
