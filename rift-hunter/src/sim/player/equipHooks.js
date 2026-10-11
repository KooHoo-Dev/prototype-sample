// OWNER: P1 — 계약 §6.7 · §8.5 · §7.9
// STUB — W1 에서 P1 이 채운다(전설 효과 훅 12 — 사건형 3 · 패치형은 skillParams 로). W0: 키 전부 빈 객체 · 처치 훅 no-op · globeMods 기본값

/** @typedef {import('../../types.js').SimCtx} SimCtx */

/** 전설 훅 12(LEGENDARIES 의 hook 이름) */
export const EQUIP_HOOKS = {
  whirlwindVortex: {},
  leapQuake: {},
  chargeRefund: {},
  warCryHeal: {},
  stompShockwave: {},
  fireballPierce: {},
  chainBounce: {},
  teleportNova: {},
  meteorShower: {},
  frozenShatter: {},
  killExplode: {},
  globeDouble: {},
};

/** STUB — ctx.hooks.onPlayerKill 구현(처치 폭발 · 빙결 파쇄 …) @param {SimCtx} ctx @param {import('../../types.js').MonsterState} mon @param {Object} lastHit */
export function onPlayerKill(ctx, mon, lastHit) {}

/** STUB — ctx.hooks.onGlobe 구현 → {mul, radiusAdd}(전설이 없으면 {1, 0}) @param {SimCtx} ctx */
export function globeMods(ctx) {
  return { mul: 1, radiusAdd: 0 };
}
