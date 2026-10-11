// OWNER: P3 — 계약 §6.9 · §8.1
// STUB — W1 에서 P3 이 채운다(종류별 행동 9). W0: 키 전부 {think(){}, strike(){}}
// BEHAVIORS[id] = {think(ctx, mon, def), strike?(ctx, mon, def, atk), onDamaged?(ctx, mon, def, hit), onDeath?(ctx, mon, def)}

const none = () => ({ think(ctx, mon, def) {}, strike(ctx, mon, def, atk) {} });

export const BEHAVIORS = {
  melee: none(),
  fallen: none(),
  shaman: none(),
  archer: none(),
  shield: none(),
  charger: none(),
  bloater: none(),
  nest: none(),
  guardian: none(),
};
