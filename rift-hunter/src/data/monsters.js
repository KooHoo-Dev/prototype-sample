// OWNER: P3 — 계약 §7.4 · §8.1 (시드 — P0 이 W0 에 계약 값으로 채웠다 · 🔒 값은 혼자 바꾸지 않는다)
// 몬스터 등급 · 일반 8종 + 새끼 2. 이름 문면은 strings.ko.js 의 mon.<id>.
// params 배치: 행동 전체에 걸린 값(도망 · 거리 유지 · 정면 막기)은 MonsterDef.params, 그 공격에만 걸린 값(돌진 · 폭발 · 소환 · 부활)은
//   AttackDef.params(§7.4 표 「기타」 열을 둘로 나눴다 — 정면 막기는 combat.js 가 getMonDef(typeId).params.frontBlock 으로 읽는다).

/** @typedef {import('../types.js').MonsterDef} MonsterDef */
/** @typedef {import('../types.js').RankDef} RankDef */

export const MON = {
  hpBase: 19, dmgBase: 3.5,   // 🔒 §7.14
  wakeCheckT: 6, maxAwake: 120, leash: 36, leashSec: 3, shieldFront: 0.5, frontDeg: 45,
  stopFrac: 0.8, sepPad: 0.1, sepMaxNeighbors: 6, targetingRange: 15, directChaseR: 3, linkRadius: 8,
  reachTolerance: 0.3, resCap: 0.5, threatRange: 11,
};

/** 기절 면역 길이는 STATUS.stunImmune(§7.6) @type {RankDef[]} */
export const RANKS = [
  { id: 'normal', hp: 1, dmg: 1, xp: 1, gauge: 0.25, tc: 'normal', scale: 1.00, stunMul: 1.0, freezeMul: 1.0, knockMul: 1.0, flinchFrac: 0.15 },
  { id: 'champion', hp: 3.5, dmg: 1.5, xp: 4, gauge: 1.0, tc: 'champion', scale: 1.15, stunMul: 0.6, freezeMul: 0.7, knockMul: 0.5, flinchFrac: 0.30 },   // hp 🔒
  { id: 'elite', hp: 7, dmg: 1.7, xp: 12, gauge: 3.0, tc: 'elite', scale: 1.30, stunMul: 0.4, freezeMul: 0.5, knockMul: 0, flinchFrac: null },          // hp 🔒
  { id: 'minion', hp: 2, dmg: 1.2, xp: 2, gauge: 0.5, tc: 'minion', scale: 1.05, stunMul: 0.7, freezeMul: 0.8, knockMul: 0.5, flinchFrac: 0.25 },
  { id: 'guardian', hp: 35, dmg: 2.0, xp: 60, gauge: 0, tc: 'guardian', scale: 1.00, stunMul: 0.25, freezeMul: 0.3, knockMul: 0, flinchFrac: null },    // hp 🔒
  { id: 'split', hp: 0.6, dmg: 0.5, xp: 0.25, gauge: 0.1, tc: 'split', scale: 0.60, stunMul: 1.0, freezeMul: 1.0, knockMul: 1.0, flinchFrac: 0.15 },
  { id: 'spawn', hp: 1, dmg: 1, xp: 0, gauge: 0, tc: null, scale: 1.00, stunMul: 1.0, freezeMul: 1.0, knockMul: 1.0, flinchFrac: 0.15 },
];

const res = (o = {}) => ({ phys: 0, fire: 0, cold: 0, lightning: 0, ...o });

/** @type {MonsterDef[]} */
export const MONSTERS = [
  { id: 'ghoul', template: 'humanoid', tags: ['melee', 'swarm'], behavior: 'melee', radius: 0.45, height: 1.7, speed: 2.6, turnRate: 8,
    hp: 1.0, dmg: 1.0, xp: 1.0, gauge: 1.0, res: res(), aggro: 12, eliteOk: true,
    attacks: [
      { id: 'claw', kind: 'melee', windup: 0.55, recover: 0.60, cd: 0, reach: 0.9, coneDeg: 90, mul: 1.0, type: 'phys', telegraph: 'pose' },
    ],
    params: {}, look: { color: '#7d8f6b', variant: 'ghoul' } },
  { id: 'fallen', template: 'small', tags: ['melee', 'swarm'], behavior: 'fallen', radius: 0.35, height: 1.1, speed: 5.2, turnRate: 12,
    hp: 0.8, dmg: 0.6, xp: 0.6, gauge: 0.6, res: res(), aggro: 12, eliteOk: true,
    attacks: [
      { id: 'jab', kind: 'melee', windup: 0.35, recover: 0.45, cd: 0, reach: 0.7, coneDeg: 70, mul: 1.0, type: 'phys', telegraph: 'pose' },
    ],
    params: { fleeAt: 0.5, fleeSec: 2.5, fleeSpeedMul: 1.2 }, look: { color: '#b0493a', variant: 'fallen' } },
  { id: 'fallenShaman', template: 'small', tags: ['ranged', 'support'], behavior: 'shaman', radius: 0.35, height: 1.2, speed: 3.6, turnRate: 8,
    hp: 0.8, dmg: 0.9, xp: 1.5, gauge: 1.5, res: res({ fire: 0.25 }), aggro: 14, eliteOk: false,
    attacks: [
      { id: 'shamanFire', kind: 'projectile', windup: 0.50, recover: 0.50, cd: 2.8, range: 11, mul: 1.0, type: 'fire', telegraph: 'glow',
        proj: { speed: 9, r: 0.35, life: 1.6, visual: 'shamanFire' } },
      { id: 'revive', kind: 'cast', windup: 1.50, recover: 0.50, cd: 8, range: 8, mul: 0, type: 'phys', telegraph: 'glow',
        params: { max: 3, hp: 0.6, window: 6 } },
    ],
    params: { keepMin: 7, keepMax: 10 }, look: { color: '#c26a3e', variant: 'shaman' } },
  { id: 'skeletonArcher', template: 'humanoid', tags: ['ranged'], behavior: 'archer', radius: 0.40, height: 1.8, speed: 3.2, turnRate: 8,
    hp: 0.8, dmg: 0.8, xp: 1.0, gauge: 1.0, res: res({ cold: 0.25 }), aggro: 14, eliteOk: true,
    attacks: [
      { id: 'arrow', kind: 'projectile', windup: 0.60, recover: 0.40, cd: 1.8, range: 11, mul: 1.0, type: 'phys', telegraph: 'aimLine', aimLock: 0.2,
        proj: { speed: 16, r: 0.2, life: 1.2, visual: 'arrow' } },
    ],
    params: { keepMin: 7, keepMax: 10, backoff: 4, backoffMul: 0.8 }, look: { color: '#ddd6c2', variant: 'archer' } },
  { id: 'shieldSkeleton', template: 'humanoid', tags: ['melee'], behavior: 'shield', radius: 0.45, height: 1.85, speed: 3.0, turnRate: 3.0,
    hp: 1.2, dmg: 0.9, xp: 1.3, gauge: 1.3, res: res({ cold: 0.25 }), aggro: 12, eliteOk: true,
    attacks: [
      { id: 'shieldBash', kind: 'melee', windup: 0.50, recover: 0.70, cd: 0, reach: 0.9, coneDeg: 80, mul: 1.0, type: 'phys', telegraph: 'pose', push: 1.2 },
    ],
    params: { frontBlock: true }, look: { color: '#cfc7b2', variant: 'shieldSkeleton' } },
  { id: 'charger', template: 'quadruped', tags: ['melee'], behavior: 'charger', radius: 0.60, height: 1.3, speed: 3.8, turnRate: 6,
    hp: 1.3, dmg: 1.2, xp: 1.5, gauge: 1.5, res: res(), aggro: 14, eliteOk: true,
    attacks: [
      { id: 'gore', kind: 'melee', windup: 0.60, recover: 0.60, cd: 0, reach: 1.0, coneDeg: 80, mul: 1.0, type: 'phys', telegraph: 'pose' },
      { id: 'charge', kind: 'charge', windup: 0.90, recover: 0.80, cd: 5, range: 11, minRange: 5, mul: 2.0, type: 'phys', telegraph: 'groundLine',
        push: 2.0, escape: 1.0, params: { speed: 14, maxLen: 13, wallStun: 2.0 } },
    ],
    params: {}, look: { color: '#6e5540', variant: 'charger' } },
  { id: 'bloater', template: 'blob', tags: ['melee'], behavior: 'bloater', radius: 0.55, height: 1.4, speed: 2.6, turnRate: 6,
    hp: 1.0, dmg: 1.0, xp: 1.0, gauge: 1.0, res: res(), aggro: 12, eliteOk: false,
    attacks: [
      { id: 'burst', kind: 'explode', windup: 1.00, recover: 0, cd: 0, range: 2.2, mul: 2.5, type: 'phys', telegraph: 'groundCircle',
        escape: 2.3, params: { r: 2.8, poolR: 1.6, poolSec: 3, poolTick: 0.5, poolMulPerSec: 0.3 } },
    ],
    params: {}, look: { color: '#9cb24c', variant: 'bloater' } },
  { id: 'boneNest', template: 'nest', tags: ['structure'], behavior: 'nest', radius: 0.90, height: 1.6, speed: 0, turnRate: 0,
    hp: 6.0, dmg: 0, xp: 3.0, gauge: 3.0, res: res(), aggro: 16, eliteOk: false,
    attacks: [
      { id: 'spawn', kind: 'spawn', windup: 0.50, recover: 0, cd: 3.5, range: 11, mul: 0, type: 'phys', telegraph: 'glow',
        params: { child: 'boneling', cap: 6 } },
    ],
    params: {}, look: { color: '#cdc2a6', variant: 'nest' } },
  { id: 'boneling', template: 'small', tags: ['melee', 'spawnling'], behavior: 'melee', radius: 0.30, height: 0.9, speed: 4.2, turnRate: 12,
    hp: 0.35, dmg: 0.5, xp: 0, gauge: 0, res: res(), aggro: 16, eliteOk: false,
    attacks: [
      { id: 'jab', kind: 'melee', windup: 0.35, recover: 0.50, cd: 0, reach: 0.6, coneDeg: 70, mul: 1.0, type: 'phys', telegraph: 'pose' },
    ],
    params: {}, look: { color: '#dcd3be', variant: 'boneling' } },
  { id: 'ashling', template: 'small', tags: ['melee', 'spawnling'], behavior: 'melee', radius: 0.32, height: 1.0, speed: 4.5, turnRate: 12,
    hp: 0.5, dmg: 0.6, xp: 0, gauge: 0, res: res({ fire: 0.5 }), aggro: 16, eliteOk: false,
    attacks: [
      { id: 'claw', kind: 'melee', windup: 0.40, recover: 0.50, cd: 0, reach: 0.7, coneDeg: 80, mul: 1.0, type: 'fire', telegraph: 'pose' },
    ],
    params: {}, look: { color: '#6b5b55', variant: 'ashling' } },
];
