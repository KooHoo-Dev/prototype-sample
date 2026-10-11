// OWNER: P16 — 계약 §8.2 · §7.5 · §6.9(훅 인터페이스)
// STUB — W2 에서 P16 가 채운다. 이 파일은 hook 하나만 export 한다.
// import 허용: combat · effects · projectiles · status · entities · world/nav · monsters/spawn.js(§2.2) — monsters.js · 레지스트리 · 다른 훅 파일은 import 하지 않는다.
// 훅 상태는 st = mon.ax['lightningEnchanted'](순수 객체 · 절대 틱은 이름 끝 At · Until 로만 — shiftTicks §5.11).

/**
 * 모든 함수는 선택 — onSpawn(ctx, mon, row) · onAwakeTick(ctx, mon, row, st) · onDamaged(ctx, mon, row, st, hit, spec) ·
 * onHitPlayer(ctx, mon, row, st, res) · onDeath(ctx, mon, row, st)
 */
export const hook = {};
