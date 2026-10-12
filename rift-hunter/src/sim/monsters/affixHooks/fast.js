// OWNER: P3 — 계약 §8.2 · §7.5 · §6.9(훅 인터페이스)
// 빠름 — mods 만(speedMul 1.30 · atkSpeedMul 1.25). 프레임워크가 적용한다: 이동 속도는 spawnMonster(monsterStats)가 mon.speed 에 ·
// 공격 속도는 startAttack 이 telegraph pose · aimLine · glow 인 공격의 예비 · 후딜에만(바닥 표식 · 시전의 예고는 줄이지 않는다 — 쿨다운만 ÷ · §5.17-5).
// 바람 줄 오라는 view 가 mon.affixes 로 그린다. 훅 동작은 없다.

/**
 * 모든 함수는 선택 — onSpawn(ctx, mon, row) · onAwakeTick(ctx, mon, row, st) · onDamaged(ctx, mon, row, st, hit, spec) ·
 * onHitPlayer(ctx, mon, row, st, res, spec) · onDeath(ctx, mon, row, st)
 */
export const hook = {};
