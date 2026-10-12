// OWNER: P3 — 계약 §7.5c (시드 — P0 이 W0 에 계약 값으로 채웠다)
// 일반 팩 구성 · 타일셋별 팩 가중치 · 챔피언/정예 팩 규칙.

/** @typedef {import('../types.js').PackDef} PackDef */

/** @type {PackDef[]} */
// 피드백 2 D9(맵 밀도): 일반 몬스터 생명 × 1.6 으로 늘어난 판 길이를 팩 밀도로 맞춘다 — 몸받이(구울 · 소인 · 방패 해골)를 ~1.35배 ·
//   궁수 3~5 → 4~6 · 돌격 짐승 · 역병 덩어리 · 주술사 · 둥지는 그대로(위협 종을 늘리면 사망이 그쪽으로 쏠렸다 — 실험)
export const PACKS = [
  { id: 'ghoulPack', members: [{ typeId: 'ghoul', min: 8, max: 16 }], minLevel: 1 },
  { id: 'fallenPack', members: [{ typeId: 'fallen', min: 7, max: 11 }, { typeId: 'fallenShaman', min: 1, max: 2 }], minLevel: 1 },
  { id: 'skeletonPack', members: [{ typeId: 'skeletonArcher', min: 4, max: 6 }, { typeId: 'shieldSkeleton', min: 3, max: 6 }], minLevel: 1 },
  { id: 'chargerPack', members: [{ typeId: 'charger', min: 2, max: 3 }, { typeId: 'ghoul', min: 3, max: 5 }], minLevel: 1 },
  { id: 'bloaterPack', members: [{ typeId: 'bloater', min: 3, max: 5 }, { typeId: 'ghoul', min: 3, max: 4 }], minLevel: 2 },
  { id: 'nestPack', members: [{ typeId: 'boneNest', min: 1, max: 1 }, { typeId: 'skeletonArcher', min: 1, max: 3 }], minLevel: 3 },
];

export const TILESET_PACKS = {
  crypt: { ghoulPack: 30, skeletonPack: 30, bloaterPack: 15, nestPack: 15, chargerPack: 10 },
  cavern: { fallenPack: 35, ghoulPack: 20, chargerPack: 20, bloaterPack: 15, skeletonPack: 10 },
};

export const ELITE_PACK = {
  /** 챔피언 · 정예가 될 종(가중치) */
  types: { ghoul: 25, fallen: 25, skeletonArcher: 20, shieldSkeleton: 15, charger: 15 },
  champion: { min: 2, max: 4, maxByType: { charger: 3 } },
  elite: { minions: [3, 5] },
  /** 팩 자리에서 구성원을 놓는 거리(m) */
  placeR: [2.5, 4.5],
};

/** (P3 W1) 일반 팩 · 하수인을 놓는 거리(m) · 자리 고르기 시도 수 · 구성원 사이 여유(m) — 정예 · 챔피언은 ELITE_PACK.placeR */
export const PACK_PLACE = { normalR: [0.6, 5.2], minionR: [1.6, 3.4], tries: 10, gap: 0.15 };   // 피드백 2: normalR 4.5 → 5.2(팩이 촘촘해져 놓을 자리)

/** (P3 W1) 정예 이름 문자열 키 수 — strings.ko.js 의 elite.a.0..15 · elite.b.0..15(부록 B) */
export const ELITE_NAMES = { a: 16, b: 16 };
