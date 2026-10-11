// OWNER: P3 — 계약 §7.5b · §8.3 (시드 — P0 이 W0 에 계약 값으로 채웠다)
// 균열 수호자 2종 — MonsterDef 와 같은 꼴(getMonDef 로 읽는다 · ID 는 MONSTERS 와 겹치지 않는다).
// 고유 기술(kind 'cast')의 모양은 AttackDef.params: shape('cone' | 'line' | 'circle') · r · angleDeg · len · width · n …
//   cast 공격의 range ≤ 그 효과 도달 거리(원뿔 r · 선 len) − 0.5(data.schema.test).

/** @typedef {import('../types.js').GuardianDef} GuardianDef */

const res = (o = {}) => ({ phys: 0, fire: 0, cold: 0, lightning: 0, ...o });

/** 수호자 종류를 고르는 가중치(1:1) */
export const GUARDIAN_WEIGHTS = { boneGiant: 1, ashWitch: 1 };

/** (P3 W1) 출현 자리(findGuardianSpot) — 플레이어에서 min..max(m) · 걷기 가능 · 시야 · 둘레를 steps 방향으로(플레이어가 보는 쪽부터) */
export const GUARDIAN_SPOT = { min: 8, mid: 9, max: 10, steps: 16 };

/** @type {GuardianDef[]} */
export const GUARDIANS = [
  { id: 'boneGiant', template: 'humanoid', tags: ['melee'], behavior: 'guardian', radius: 1.30, height: 4.6, speed: 3.2, turnRate: 2.5,
    hp: 1.1, dmg: 1.0, xp: 1, gauge: 0, res: res({ cold: 0.15 }), aggro: 99, eliteOk: false,
    attacks: [
      { id: 'swing', kind: 'melee', windup: 0.8, recover: 0.7, cd: 0, reach: 2.0, coneDeg: 120, mul: 1.5, type: 'phys', telegraph: 'pose' },
      { id: 'slam', kind: 'cast', windup: 1.2, recover: 1.0, cd: 7, range: 6.0, mul: 2.5, type: 'phys', telegraph: 'groundCircle', escape: 3.2,
        params: { shape: 'cone', r: 6.5, angleDeg: 100, shake: 0.5 } },
      { id: 'spikes', kind: 'cast', windup: 1.4, recover: 0.8, cd: 10, range: 11, mul: 1.8, type: 'phys', telegraph: 'groundLine', escape: 3.9,
        params: { shape: 'line', n: 5, spreadDeg: 50, stepDeg: 25, len: 12, width: 1.4, count: 5 } },
    ],
    // (P3 W1) 나타난 뒤 첫 대지 분쇄 · 뼈 가시까지(초 — init 이 readyAt 에 둔다)
    params: { slamFirst: 2.0, spikesFirst: 3.5 }, look: { color: '#d8cfb8', variant: 'boneGiant' } },
  { id: 'ashWitch', template: 'humanoid', tags: ['ranged'], behavior: 'guardian', radius: 0.55, height: 2.2, speed: 4.0, turnRate: 6,
    hp: 0.9, dmg: 1.0, xp: 1, gauge: 0, res: res({ fire: 0.15 }), aggro: 99, eliteOk: false,
    attacks: [
      { id: 'ashBolt', kind: 'projectile', windup: 0.5, recover: 0.5, cd: 1.6, range: 11, mul: 1.0, type: 'fire', telegraph: 'glow',
        proj: { speed: 11, r: 0.4, life: 1.6, visual: 'ashBolt' } },
      { id: 'emberRain', kind: 'cast', windup: 1.2, recover: 0.6, cd: 8, range: 11, mul: 1.8, type: 'fire', telegraph: 'groundCircle', escape: 3.1,
        params: { shape: 'circle', n: 5, r: 1.8, ringMin: 2.5, ringMax: 3.5, minSepDeg: 72, count: 5 } },
      { id: 'summon', kind: 'cast', windup: 1.0, recover: 0.5, cd: 14, mul: 0, type: 'fire', telegraph: 'glow',
        params: { child: 'ashling', n: 4, cap: 8, r: 2 } },
    ],
    params: { keepMin: 7, keepMax: 10, blinkNear: 3, blinkAfter: 1.5, blinkCd: 6, blinkDist: 6 },
    look: { color: '#5a4c48', variant: 'ashWitch' } },
];
