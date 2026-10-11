// OWNER: P3 — 계약 §8.3 · §7.5b · §6.9(훅 인터페이스)
// STUB — W1 에서 P3 가 채운다. 이 파일은 impl 하나만 export 한다.
// 바닥 표식 기술: think 에서 canStartHazard → startAttack → 그 틱에 spawnEffect(delay = 예비 길이) → noteHazard · strike 는 소환 · 투사체만.

export const impl = {
  /** 스폰 직후 — 고유 기술 타이머 */
  init(ctx, mon, def) {},
  /** 행동 가능할 때마다 — 고유 기술 시작 또는 이동 목표 */
  think(ctx, mon, def) {},
  /** 고유 기술의 판정 틱(kind 'cast') */
  strike(ctx, mon, def, atk) {},
};
