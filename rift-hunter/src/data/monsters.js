// OWNER: P3 — 계약 §7.4 · §8.1 (시드 — P0 이 W0 에 계약 값으로 채웠다 · 🔒 값은 혼자 바꾸지 않는다)
// 몬스터 등급 · 일반 8종 + 새끼 2. 이름 문면은 strings.ko.js 의 mon.<id>.
// params 배치: 행동 전체에 걸린 값(도망 · 거리 유지 · 정면 막기)은 MonsterDef.params, 그 공격에만 걸린 값(돌진 · 폭발 · 소환 · 부활)은
//   AttackDef.params(§7.4 표 「기타」 열을 둘로 나눴다 — 정면 막기는 combat.js 가 getMonDef(typeId).params.frontBlock 으로 읽는다).

/** @typedef {import('../types.js').MonsterDef} MonsterDef */
/** @typedef {import('../types.js').RankDef} RankDef */

export const MON = {
  // 🔒 §7.14 — dmgBase 는 W1 값 3.5 그대로다. 첫 판(균열 1~4)의 완화는 RIFT.earlyDmg 경사(data/rift.js · monsterStats)로 —
  //   W1 수정이 이 값을 0.9 로 낮췄다가 균열 5 이상의 위협이 사라져 되돌렸다(NOTES-W1FIX §2.0)
  // 밸런스 게이트(NOTES-BALANCE): hpBase 19 → 36(× 1.89) · dmgBase 3.5 → 24.5(× 7) — 봇(사람 설정)이 적정 레벨에서 죽지 않았다(사망/판 0.01).
  //   첫 판들은 RIFT.earlyDmg · earlyHp 경사가 받친다(균열 1 의 실제 피해 배율은 옛 값과 같고 일반 생명은 옛 값의 95% — data/rift.js)
  hpBase: 36, dmgBase: 24.5,
  wakeCheckT: 6, maxAwake: 120, leash: 36, leashSec: 3, shieldFront: 0.5, frontDeg: 45,
  // W1 수정(NOTES-W1FIX): linkRadius 8 → 11 — 깊은 방(depth ≥ linkMinDepth)의 파도를 크게(25마리 이상 순간) · 초반 방은 linkMinDepth 가 막는다
  stopFrac: 0.8, sepPad: 0.1, sepMaxNeighbors: 6, targetingRange: 15, directChaseR: 3, linkRadius: 11,
  reachTolerance: 0.3, resCap: 0.5, threatRange: 11,
  // (P3 W1 — 프레임워크 손잡이 · 계약 값은 위 그대로)
  sepQueryPad: 0.6,     // 밀어내기 이웃 질의 반지름 = r + 이 값(§5.17-6)
  sepMaxStep: 0.2,      // 한 틱 밀어내기 이동 상한(m) — 겹쳐 생긴 무리가 한 틱에 튀지 않게
  moveEps: 0.002,       // 이만큼(m) 안 움직였으면 act idle(걷기 애니메이션이 떨리지 않게)
  stuckFrac: 0.5,       // 뒷걸음이 계획의 이 비율 미만이면 「뒤가 막혔다」(궁수가 그 자리에서 쏜다)
  // (W1 수정 — NOTES-W1FIX) 초반 경사: 방 깊이가 이 값보다 얕은 팩(시작 방 · 그 이웃)은 팩 연결로 깨우지도 깨지도 않는다(0 = 끔)
  linkMinDepth: 2,
};

// 밸런스 게이트(NOTES-BALANCE): hp champion 3.5 → 8 · elite 7 → 15 · guardian 28 → 32(MON.hpBase 36 과 함께 — 팩 처치 시간 8~20 · 15~35 · 30~70초 목표)
/** 기절 면역 길이는 STATUS.stunImmune(§7.6) @type {RankDef[]} */
export const RANKS = [
  { id: 'normal', hp: 1, dmg: 1, xp: 1, gauge: 0.25, tc: 'normal', scale: 1.00, stunMul: 1.0, freezeMul: 1.0, knockMul: 1.0, flinchFrac: 0.15 },
  { id: 'champion', hp: 8, dmg: 1.5, xp: 4, gauge: 1.0, tc: 'champion', scale: 1.15, stunMul: 0.6, freezeMul: 0.7, knockMul: 0.5, flinchFrac: 0.30 },   // hp 🔒
  { id: 'elite', hp: 15, dmg: 1.7, xp: 12, gauge: 3.0, tc: 'elite', scale: 1.30, stunMul: 0.4, freezeMul: 0.5, knockMul: 0, flinchFrac: null },          // hp 🔒
  { id: 'minion', hp: 2, dmg: 1.2, xp: 2, gauge: 0.5, tc: 'minion', scale: 1.05, stunMul: 0.7, freezeMul: 0.8, knockMul: 0.5, flinchFrac: 0.25 },
  // hp 🔒 · W1 수정(NOTES-W1FIX): hp 35 → 28 — 시작 장비 균열 1 수호자 싸움(강인함 63%)이 35 에서 ~95초 · 사망이 그 싸움에 몰린다(§2.0 · §3.5)
  { id: 'guardian', hp: 32, dmg: 2.0, xp: 60, gauge: 0, tc: 'guardian', scale: 1.00, stunMul: 0.25, freezeMul: 0.3, knockMul: 0, flinchFrac: null },
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
      // target = 되살리는 시체의 종류(같은 팩이 아니어도 된다 · 되살린 적 없는 것만)
      { id: 'revive', kind: 'cast', windup: 1.50, recover: 0.50, cd: 8, range: 8, mul: 0, type: 'phys', telegraph: 'glow',
        params: { max: 3, hp: 0.6, window: 6, target: 'fallen' } },
    ],
    // W1 수정(NOTES-W1FIX): backoff 4 · backoffMul 0.3 — 4m 안 뒷걸음을 느리게(근접 클래스가 「우선 처치」할 수 있게 · 궁수와 같은 규칙)
    params: { keepMin: 7, keepMax: 10, backoff: 4, backoffMul: 0.3 }, look: { color: '#c26a3e', variant: 'shaman' } },
  // W1 수정(NOTES-W1FIX): backoffMul 0.8 → 0.3(파고들기가 통하게 — 브리프 §3.4 「파고들기 · 옆으로」) · dmg 는 0.8 그대로(첫 판 완화는 RIFT.earlyDmg)
  { id: 'skeletonArcher', template: 'humanoid', tags: ['ranged'], behavior: 'archer', radius: 0.40, height: 1.8, speed: 3.2, turnRate: 8,
    hp: 0.8, dmg: 0.6, xp: 1.0, gauge: 1.0, res: res({ cold: 0.25 }), aggro: 14, eliteOk: true,   // 밸런스 게이트: dmg 0.8 → 0.6(받는 피해의 절반이 화살 — 예고된 위협 쪽으로 무게를 옮긴다)
    attacks: [
      { id: 'arrow', kind: 'projectile', windup: 0.60, recover: 0.40, cd: 1.8, range: 11, mul: 1.0, type: 'phys', telegraph: 'aimLine', aimLock: 0.2,
        proj: { speed: 16, r: 0.2, life: 1.2, visual: 'arrow' } },
    ],
    params: { keepMin: 7, keepMax: 10, backoff: 4, backoffMul: 0.3 }, look: { color: '#ddd6c2', variant: 'archer' } },
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
      { id: 'charge', kind: 'charge', windup: 0.90, recover: 0.80, cd: 5, range: 11, minRange: 5, mul: 6.0, type: 'phys', telegraph: 'groundLine',
        // 밸런스 게이트: charge mul 2.0 → 6.0 · 아래 bloater burst 2.5 → 7.5(예고된 공격 × 3 — 정예 속성 · 수호자와 같은 이유)
        // overshoot = 선 길이 min(maxLen, 거리 + overshoot) · blockFrac = 이번 틱 이동이 계획의 이 비율 미만이면 벽에 박았다(§8.1)
        push: 2.0, escape: 1.0, params: { speed: 14, maxLen: 13, wallStun: 2.0, overshoot: 2, blockFrac: 0.5 } },
    ],
    params: {}, look: { color: '#6e5540', variant: 'charger' } },
  { id: 'bloater', template: 'blob', tags: ['melee'], behavior: 'bloater', radius: 0.55, height: 1.4, speed: 2.6, turnRate: 6,
    hp: 1.0, dmg: 1.0, xp: 1.0, gauge: 1.0, res: res(), aggro: 12, eliteOk: false,
    attacks: [
      { id: 'burst', kind: 'explode', windup: 1.00, recover: 0, cd: 0, range: 2.2, mul: 7.5, type: 'phys', telegraph: 'groundCircle',
        escape: 2.3, params: { r: 2.8, poolR: 1.6, poolSec: 3, poolTick: 0.5, poolMulPerSec: 0.3 } },
    ],
    params: {}, look: { color: '#9cb24c', variant: 'bloater' } },
  { id: 'boneNest', template: 'nest', tags: ['structure'], behavior: 'nest', radius: 0.90, height: 1.6, speed: 0, turnRate: 0,
    hp: 6.0, dmg: 0, xp: 3.0, gauge: 3.0, res: res(), aggro: 16, eliteOk: false,
    attacks: [
      { id: 'spawn', kind: 'spawn', windup: 0.50, recover: 0, cd: 3.5, range: 11, mul: 0, type: 'phys', telegraph: 'glow',
        // 새끼는 둥지 몸 가장자리에서 rMin..rMax(m)
        params: { child: 'boneling', cap: 6, rMin: 1.0, rMax: 1.5 } },
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
