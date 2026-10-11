// OWNER: P1 — 계약 §7.1 (시드 — P0 이 W0 에 계약 값으로 채웠다 · 🔒 값은 혼자 바꾸지 않는다)
// 클래스 정의 · 플레이어 조작 상수. 이름 문면은 strings.ko.js 의 class.<id>.

/** @typedef {import('../types.js').ClassDef} ClassDef */

export const PLAYER = { turnRate: 18, repathSec: 0.2, repathDist: 0.75, arriveR: 0.15, attackRepathDist: 1.0, standConeDeg: 70, reachTolerance: 0.3, shoveMul: 0.6, pushSec: 0.15 };

/** @type {ClassDef[]} */
export const CLASSES = [
  {
    id: 'warrior', mainStat: 'str', resource: 'rage',
    life: { base: 120, growth: 1.09 },   // 🔒 §7.14
    resourceMax: { base: 100, perLevel: 1 }, regen: { base: 0, perLevel: 0 },
    rage: { onBasicHit: 6, perExtraTarget: 1, extraCap: 3, onHitTaken: 2, takenCapPerSec: 8, decayDelay: 3, decayPerSec: 5 },
    moveSpeed: 6, radius: 0.40, height: 1.8, basic: 'bash',
    startGear: [{ baseId: 'sword', tier: 0 }, { baseId: 'chest', tier: 0 }],
    mainHandBases: ['sword', 'axe', 'mace', 'greatsword', 'greataxe'], offhandBases: ['shield'],
  },
  {
    id: 'mage', mainStat: 'int', resource: 'mana',
    life: { base: 90, growth: 1.09 },    // 🔒 §7.14
    resourceMax: { base: 100, perLevel: 2 }, regen: { base: 7, perLevel: 0.15 },
    rage: null,
    moveSpeed: 6, radius: 0.40, height: 1.8, basic: 'magicBolt',
    startGear: [{ baseId: 'wand', tier: 0 }, { baseId: 'chest', tier: 0 }],
    mainHandBases: ['wand', 'staff'], offhandBases: ['orb'],
  },
];
