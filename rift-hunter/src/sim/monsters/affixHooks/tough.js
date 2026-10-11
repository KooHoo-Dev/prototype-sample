// OWNER: P3 — 계약 §8.2 · §7.5 · §6.9(훅 인터페이스)
// 강인함 — mods 만(hpMul 1.5 · immune [flinch, knock]). 생명은 spawnMonster(monsterStats)가 · 경직 · 넉백 면역은 status.js 가 mods.immune 으로 본다.
// 금속광 · 몸 1.1배는 view. 훅 동작은 없다(보호막과 같이 붙지 않는다 — 배제 규칙은 데이터).

/**
 * 모든 함수는 선택 — onSpawn(ctx, mon, row) · onAwakeTick(ctx, mon, row, st) · onDamaged(ctx, mon, row, st, hit, spec) ·
 * onHitPlayer(ctx, mon, row, st, res, spec) · onDeath(ctx, mon, row, st)
 */
export const hook = {};
