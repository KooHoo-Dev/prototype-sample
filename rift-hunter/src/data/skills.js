// OWNER: P1 — 계약 §7.2 · §8.4 (시드 — P0 이 W0 에 계약 값으로 채웠다 · 🔒 값은 혼자 바꾸지 않는다)
// 기본 공격 2 · 전사 노드 15 · 마법사 노드 15. 이름 · 설명은 strings.ko.js 의 node.<id>.name/desc.
// 규칙(§7.2): status = 적중이 싣는 상태 이상 · params = 동작 수치(§8.4 가 읽는 키) · patch = 변형이 덮어쓸 값.
//   기본 행의 params 에 변형 · 전설 패치 키(aftershock · split · shards · blast · shockwave · vortex · refund · castHeal ·
//   landQuake · landStun · pierce · shower · bouncesAdd · arrivalNova · healPerTarget · healTargetsCap)를 넣지 않는다(data.schema.test).
//   비율은 0..1 소수 · 패시브 stats 만 퍼센트 숫자. 배열은 랭크별 값([rank − 1]).
// 모양 열의 치수: radius(원 · 원뿔 반지름) · angleDeg(원뿔 전체 각) · width(선 폭) · range(사거리 · 최대 거리) · reach(근접 사거리 —
//   몸 가장자리 사이) · 최소 거리는 params.minRange. 행동 길이 action(초) · scaled(공격 속도 비례) · hitFrac(판정 시점 비율).
//   돌진: 행동 길이 = 거리 / params.speed + action(0.1) · 판정 = 시작 + 1틱(동작이 계산한다) · 회오리: action = 채널 틱 간격.
// (W1 P1 이 더한 params 키 — 패치 키가 아니다) 연출 ID(§9.8): fx · fxAftershock · fxShockwave · fxVortex · fxBlast(효과 kind) ·
//   visual · visualSplit · visualShard(투사체 visual) — 동작 코드에 연출 ID 리터럴을 두지 않으려고 행에 둔다 ·
//   메테오 fallDist(낙하 연출 출발점까지 m — 효과 from) · 연쇄 번개 arcSec(꺾은선 효과 길이) · 얼음 파편 patch 의 pierce(관통 수 — 「관통」).

/** @typedef {import('../types.js').SkillDef} SkillDef */
/** @typedef {import('../types.js').SkillNode} SkillNode */

/** 「a / +b」 → 랭크별 계수 a + b × (r − 1) */
function ranks(a, b, n = 5) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(Math.round((a + b * i) * 1000) / 1000);
  return out;
}
const NONE = [0, 0, 0, 0, 0];

export const TREE = { tierPoints: [0, 5, 10, 15], pointsPerLevel: 1 };

/** 기본 공격 — 키 = 스킬 ID(BASIC_SKILLS[CLASSES[cls].basic]) @type {Record<string, SkillDef & {id:string}>} */
export const BASIC_SKILLS = {
  bash: {
    id: 'bash', behavior: 'meleeBasic', targeting: 'target', type: 'phys', tags: ['melee'],
    cost: 0, cd: 0, action: 1 / 1.4, scaled: true, hitFrac: 0.45,
    reach: 1.1, angleDeg: 70, coef: [1.00],   // 🔒 §7.14
    params: {},
  },
  magicBolt: {
    id: 'magicBolt', behavior: 'boltBasic', targeting: 'direction', type: 'lightning', tags: ['projectile'],
    cost: 0, cd: 0, action: 1 / 1.4, scaled: true, hitFrac: 0.40,
    range: 15, coef: [1.00],                  // 🔒 §7.14
    params: { visual: 'magicBolt', speed: 22, r: 0.25 },
  },
};

/** @type {SkillNode[]} */
export const SKILL_NODES = [
  // ── 전사 · 0 분쇄 ──
  { id: 'groundStomp', cls: 'warrior', branch: 0, tier: 1, kind: 'active', maxRank: 5,
    skill: { behavior: 'cone', targeting: 'direction', type: 'phys', tags: ['aoe', 'melee'], cost: 20, cd: 0,
      action: 0.60, scaled: true, hitFrac: 0.50, radius: 4.0, angleDeg: 120, coef: ranks(1.40, 0.15),
      status: { stun: [0.8, 0.9, 1.0, 1.1, 1.2] }, params: { shake: 0.25, fxAftershock: 'stomp', fxShockwave: 'shockwave' } } },
  { id: 'weaponMastery', cls: 'warrior', branch: 0, tier: 1, kind: 'passive', maxRank: 5,
    stats: { physPct: [6, 12, 18, 24, 30] } },
  { id: 'earthquake', cls: 'warrior', branch: 0, tier: 2, kind: 'active', maxRank: 5,
    skill: { behavior: 'quake', targeting: 'self', type: 'phys', tags: ['aoe'], cost: 30, cd: 8,
      action: 0.50, scaled: true, hitFrac: 0.40, radius: 6.0, coef: ranks(1.10, 0.12),
      params: { waves: [0.4, 0.9, 1.4], shake: 0.35, fx: 'quakeWave' } } },
  { id: 'aftershock', cls: 'warrior', branch: 0, tier: 3, kind: 'transform', maxRank: 1, req: 'groundStomp', transforms: 'groundStomp',
    patch: { aftershock: { delay: 0.5, mul: 0.6 } } },
  { id: 'crusher', cls: 'warrior', branch: 0, tier: 4, kind: 'passive', maxRank: 3,
    cond: 'targetDisabled', condStats: { allPct: [10, 20, 30] } },
  // ── 전사 · 1 학살 ──
  { id: 'charge', cls: 'warrior', branch: 1, tier: 1, kind: 'active', maxRank: 5,
    skill: { behavior: 'dash', targeting: 'point', type: 'phys', tags: ['movement', 'melee'], cost: 0, gen: 10, cd: 6,
      action: 0.1, scaled: false, hitFrac: 0, width: 1.6, range: 10, coef: ranks(1.20, 0.15),
      status: { knock: 2.5 }, params: { speed: 22, minRange: 2 } } },
  { id: 'bloodthirst', cls: 'warrior', branch: 1, tier: 1, kind: 'passive', maxRank: 5,
    stats: { lifePctOnHit: [0.3, 0.6, 0.9, 1.2, 1.5] } },
  { id: 'whirlwind', cls: 'warrior', branch: 1, tier: 2, kind: 'active', maxRank: 5,
    skill: { behavior: 'spin', targeting: 'point', type: 'phys', tags: ['aoe', 'channel', 'melee'], cost: 10, costPerSec: 12, cd: 0,
      action: 0.30, scaled: true, hitFrac: 1, radius: 2.4, coef: ranks(0.42, 0.05),
      params: { moveMul: 0.7, endRecover: 0.15, fxVortex: 'vortex' } } },
  { id: 'bloodWhirl', cls: 'warrior', branch: 1, tier: 3, kind: 'transform', maxRank: 1, req: 'whirlwind', transforms: 'whirlwind',
    patch: { healPerTarget: 0.006, healTargetsCap: 3 } },
  { id: 'berserker', cls: 'warrior', branch: 1, tier: 4, kind: 'passive', maxRank: 3,
    cond: 'rage50', condStats: { attackSpeedPct: [5, 10, 15], critChance: [3, 6, 9] } },
  // ── 전사 · 2 수호 ──
  { id: 'warCry', cls: 'warrior', branch: 2, tier: 1, kind: 'active', maxRank: 5,
    skill: { behavior: 'buff', targeting: 'self', type: null, tags: ['buff'], cost: 0, gen: 30, cd: 15,
      action: 0.40, scaled: false, hitFrac: 0.50, coef: NONE.slice(),
      params: { buffSec: 8, value: [0.40, 0.46, 0.52, 0.58, 0.64] } } },
  { id: 'ironSkin', cls: 'warrior', branch: 2, tier: 1, kind: 'passive', maxRank: 5,
    stats: { armorPct: [8, 16, 24, 32, 40], resPct: [5, 10, 15, 20, 25] } },
  { id: 'leap', cls: 'warrior', branch: 2, tier: 2, kind: 'active', maxRank: 5,
    skill: { behavior: 'leap', targeting: 'point', type: 'phys', tags: ['movement', 'aoe'], cost: 0, cd: 8,
      action: 0.70, scaled: false, hitFrac: 0.55 / 0.70, radius: 3.5, range: 9, coef: ranks(1.60, 0.18),
      status: { slowPct: 0.4, slowSec: 2 }, params: { invuln: [0.10, 0.45], shake: 0.35, minRange: 2 } } },
  { id: 'quakeLanding', cls: 'warrior', branch: 2, tier: 3, kind: 'transform', maxRank: 1, req: 'leap', transforms: 'leap',
    patch: { landStun: 1.2 } },
  { id: 'undying', cls: 'warrior', branch: 2, tier: 4, kind: 'passive', maxRank: 3,
    cond: 'lifeBelow35', condStats: { dmgTakenReduce: [10, 20, 30] } },

  // ── 마법사 · 0 화염 ──
  { id: 'fireball', cls: 'mage', branch: 0, tier: 1, kind: 'active', maxRank: 5,
    skill: { behavior: 'fireball', targeting: 'direction', type: 'fire', tags: ['projectile', 'aoe'], cost: 16, cd: 0,
      action: 0.55, scaled: true, hitFrac: 0.45, range: 16, radius: 2.5, coef: ranks(1.70, 0.20),
      params: { speed: 18, range: 16, r: 0.35, explodeR: 2.5, visual: 'fireball', visualSplit: 'fireballSplit' } } },
  { id: 'combustion', cls: 'mage', branch: 0, tier: 1, kind: 'passive', maxRank: 5,
    stats: { burnFrac: [20, 40, 60, 80, 100] } },
  { id: 'meteor', cls: 'mage', branch: 0, tier: 2, kind: 'active', maxRank: 5,
    skill: { behavior: 'meteor', targeting: 'point', type: 'fire', tags: ['aoe', 'dot'], cost: 40, cd: 2,
      action: 0.60, scaled: true, hitFrac: 0.30, radius: 3.5, range: 18, coef: ranks(3.60, 0.40),
      params: { delay: 1.2, burn: { dur: 3, tick: 0.5, coefPerSec: [0.35, 0.39, 0.43, 0.47, 0.51] }, shake: 0.4, fx: 'meteor', fallDist: 6 } } },
  { id: 'splitFireball', cls: 'mage', branch: 0, tier: 3, kind: 'transform', maxRank: 1, req: 'fireball', transforms: 'fireball',
    patch: { split: { n: 3, spreadDeg: 15, mul: 0.7 } } },
  { id: 'heartOfFire', cls: 'mage', branch: 0, tier: 4, kind: 'passive', maxRank: 3,
    stats: { firePct: [8, 16, 24] }, cond: 'targetBurning', condStats: { critChance: [5, 10, 15] } },
  // ── 마법사 · 1 냉기 ──
  { id: 'frostNova', cls: 'mage', branch: 1, tier: 1, kind: 'active', maxRank: 5,
    skill: { behavior: 'nova', targeting: 'self', type: 'cold', tags: ['aoe'], cost: 20, cd: 4,
      action: 0.45, scaled: true, hitFrac: 0.50, radius: 5.0, coef: ranks(1.00, 0.12),
      status: { chill: [60, 65, 70, 75, 80] }, params: { visualShard: 'iceShard' } } },
  { id: 'coldCore', cls: 'mage', branch: 1, tier: 1, kind: 'passive', maxRank: 5,
    stats: { freezeAt: [8, 16, 24, 32, 40], freezeDurPct: [10, 20, 30, 40, 50] } },
  { id: 'energyShield', cls: 'mage', branch: 1, tier: 2, kind: 'active', maxRank: 5,
    skill: { behavior: 'shield', targeting: 'self', type: null, tags: ['buff'], cost: 30, cd: 14,
      action: 0.35, scaled: false, hitFrac: 0.50, coef: NONE.slice(),
      params: { absorbPct: [0.30, 0.34, 0.38, 0.42, 0.46], dur: 6 } } },
  { id: 'iceShards', cls: 'mage', branch: 1, tier: 3, kind: 'transform', maxRank: 1, req: 'frostNova', transforms: 'frostNova',
    patch: { shards: { n: 8, speed: 16, range: 9, r: 0.25, mul: 0.45, chill: 20, pierce: 20 } } },
  { id: 'shatter', cls: 'mage', branch: 1, tier: 4, kind: 'passive', maxRank: 3,
    cond: 'targetFrozen', condStats: { critDamage: [25, 50, 75] } },
  // ── 마법사 · 2 번개 · 비전 ──
  { id: 'chainLightning', cls: 'mage', branch: 2, tier: 1, kind: 'active', maxRank: 5,
    skill: { behavior: 'chain', targeting: 'target', type: 'lightning', tags: ['chain'], cost: 14, cd: 0,
      action: 0.50, scaled: true, hitFrac: 0.45, range: 15, coef: ranks(1.15, 0.14),
      status: { shockChance: 0.35 }, params: { bounces: [3, 3, 4, 4, 5], bounceR: 6, decay: 0.9, pickR: 4, fx: 'chainArc', arcSec: 0.2 } } },
  { id: 'manaFlow', cls: 'mage', branch: 2, tier: 1, kind: 'passive', maxRank: 5,
    stats: { manaRegenPct: [10, 20, 30, 40, 50] } },
  { id: 'teleport', cls: 'mage', branch: 2, tier: 2, kind: 'active', maxRank: 5,
    skill: { behavior: 'blink', targeting: 'point', type: null, tags: ['movement'], cost: 18, cd: [3.0, 2.8, 2.6, 2.4, 2.2],
      action: 0.25, scaled: false, hitFrac: 0.60, range: 12, coef: NONE.slice(),
      params: { range: 12, fxBlast: 'afterimageBlast' } } },
  { id: 'lightningAfterimage', cls: 'mage', branch: 2, tier: 3, kind: 'transform', maxRank: 1, req: 'teleport', transforms: 'teleport',
    patch: { blast: { r: 3.0, coef: [1.4, 1.5, 1.6, 1.7, 1.8], type: 'lightning', shockChance: 0.5 } } },
  { id: 'arcaneLore', cls: 'mage', branch: 2, tier: 4, kind: 'passive', maxRank: 3,
    stats: { critDamage: [10, 20, 30], cdr: [4, 8, 12] } },
];

/** §8.4 — 변형 · 전설이 덮어쓰는 params 키(기본 행에 있으면 안 된다) */
export const PATCH_KEYS = ['aftershock', 'split', 'shards', 'blast', 'shockwave', 'vortex', 'refund', 'castHeal',
  'landQuake', 'landStun', 'pierce', 'shower', 'bouncesAdd', 'arrivalNova', 'healPerTarget', 'healTargetsCap'];

/** §8.4 — 동작별로 패치될 수 있는 키(데이터 검사 · 문서) */
export const PATCH_KEYS_BY_BEHAVIOR = {
  cone: ['aftershock', 'shockwave'],
  quake: [],
  dash: ['refund'],
  spin: ['healPerTarget', 'healTargetsCap', 'vortex'],
  buff: ['castHeal'],
  leap: ['landStun', 'landQuake'],
  fireball: ['split', 'pierce'],
  meteor: ['shower'],
  nova: ['shards'],
  shield: [],
  chain: ['bouncesAdd'],
  blink: ['blast', 'arrivalNova'],
};
