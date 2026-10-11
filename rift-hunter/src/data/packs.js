// OWNER: P3 — 계약 §7.5c (시드 — P0 이 W0 에 계약 값으로 채웠다)
// 일반 팩 구성 · 타일셋별 팩 가중치 · 챔피언/정예 팩 규칙.

/** @typedef {import('../types.js').PackDef} PackDef */

/** @type {PackDef[]} */
export const PACKS = [
  { id: 'ghoulPack', members: [{ typeId: 'ghoul', min: 6, max: 12 }], minLevel: 1 },
  { id: 'fallenPack', members: [{ typeId: 'fallen', min: 5, max: 8 }, { typeId: 'fallenShaman', min: 1, max: 2 }], minLevel: 1 },
  { id: 'skeletonPack', members: [{ typeId: 'skeletonArcher', min: 3, max: 5 }, { typeId: 'shieldSkeleton', min: 2, max: 4 }], minLevel: 1 },
  { id: 'chargerPack', members: [{ typeId: 'charger', min: 2, max: 3 }, { typeId: 'ghoul', min: 2, max: 4 }], minLevel: 1 },
  { id: 'bloaterPack', members: [{ typeId: 'bloater', min: 3, max: 5 }, { typeId: 'ghoul', min: 2, max: 3 }], minLevel: 2 },
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
