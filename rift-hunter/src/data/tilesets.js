// OWNER: P4 — 계약 §7.12 (시드 — P0 이 W0 에 계약 값으로 채웠다 · 「P4 W1」 필드는 P4 가 더했다)
// 타일셋 — 소품(kind · weight · 막음 · r · h · 자리) · 빛(방마다 2~4) · 환경음. 이름 문면은 strings.ko.js 의 tileset.<id>.
// P4 W1 필드: 소품 jitter(where 'room' 배열 자리를 흔드는 폭 m) · 빛 where('wall' 벽면 · 'floor' 바닥) · 빛 prop(그 kind 소품이 방에 있으면 그 자리에 단다)

/** @typedef {import('../types.js').TilesetDef} TilesetDef */

/** @type {TilesetDef[]} */
export const TILESETS = [
  { id: 'crypt', weight: 1,
    props: [
      { kind: 'pillar', weight: 3, block: true, r: 0.6, h: 3.0, where: 'room', jitter: 0 },
      { kind: 'coffin', weight: 4, block: true, r: 0.7, h: 0.8, where: 'wall' },
      { kind: 'candles', weight: 5, block: false, r: 0.3, h: 0.5, where: 'wall' },
      { kind: 'bones', weight: 4, block: false, r: 0.4, h: 0.2, where: 'floor' },
      { kind: 'urn', weight: 3, block: true, r: 0.35, h: 0.8, where: 'wall' },
    ],
    lights: { perRoom: [2, 4], kinds: [
      { kind: 'candle', color: '#ffb060', intensity: 1.2, radius: 6, flicker: 0.3, y: 1.0, where: 'wall', prop: 'candles' },
      { kind: 'torch', color: '#ff8a3a', intensity: 1.6, radius: 8, flicker: 0.25, y: 2.2, where: 'wall' },
    ] },
    ambience: 'cryptWind' },
  { id: 'cavern', weight: 1,
    props: [
      { kind: 'rock', weight: 5, block: true, r: 0.8, h: 1.2, where: 'floor' },
      { kind: 'stalagmite', weight: 3, block: true, r: 0.5, h: 2.0, where: 'room', jitter: 1.5 },
      { kind: 'lavaCrack', weight: 4, block: false, r: 1.2, h: 0.05, where: 'floor' },
      { kind: 'ashPile', weight: 3, block: false, r: 0.6, h: 0.3, where: 'floor' },
      { kind: 'crystal', weight: 2, block: false, r: 0.3, h: 0.8, where: 'wall' },
    ],
    lights: { perRoom: [2, 4], kinds: [
      { kind: 'lava', color: '#ff5a1a', intensity: 1.8, radius: 7, flicker: 0.15, y: 0.3, where: 'floor', prop: 'lavaCrack' },
      { kind: 'brazier', color: '#ffa040', intensity: 1.5, radius: 8, flicker: 0.25, y: 1.4, where: 'floor' },
    ] },
    ambience: 'cavernLava' },
  { id: 'town', weight: 0,
    props: [],
    lights: { perRoom: [0, 0], kinds: [
      { kind: 'bonfire', color: '#ff9a40', intensity: 2.4, radius: 12, flicker: 0.3, y: 1.0 },
      { kind: 'torch', color: '#ff8a3a', intensity: 1.6, radius: 8, flicker: 0.25, y: 2.2 },
    ] },
    ambience: 'townFire' },
];
