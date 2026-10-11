// OWNER: P3 — 계약 §7.5 · §8.2 (시드 — P0 이 W0 에 계약 값으로 채웠다)
// 챔피언 · 정예 속성 12종. 훅은 sim/monsters/affixHooks/<id>.js(hook = id). 이름 · 설명은 strings.ko.js 의 affix.<id>.name/desc.
// every · first · delay · dur · tick 은 초 · r · range · escape 는 m · 비율은 0..1.
// 바닥 위협(hazard)을 만드는 속성은 예고 params.delay ≥ HAZARD.react + params.escape / HAZARD.slowSpeed(H5 — data.schema.test).

/** @typedef {import('../types.js').MonAffixDef} MonAffixDef */

/** 속성 수는 riftRow(L) · 하수인은 minionShare 속성을 전부 받는다 · 챔피언 팩은 구성원이 같은 속성을 받는다 */
export const AFFIX_RULES = { minLevelByCount: [1, 1, 1, 1] };

/** 속성 수 표 — riftRow(L) 의 champAffixes · eliteAffixes · guardianAffixes 를 가리킨다(값은 data/rift.js 가 정본) */
export const AFFIX_COUNT = { champion: 'champAffixes', elite: 'eliteAffixes', guardian: 'guardianAffixes' };

/** @type {MonAffixDef[]} */
export const MON_AFFIXES = [
  { id: 'fast', hook: 'fast', mods: { speedMul: 1.30, atkSpeedMul: 1.25 }, params: {},
    minionShare: true, hazard: false, excludeTags: [], excludeAffixes: [], minLevel: 1, weight: 100 },
  { id: 'tough', hook: 'tough', mods: { hpMul: 1.5, immune: ['flinch', 'knock'] }, params: {},
    minionShare: true, hazard: false, excludeTags: [], excludeAffixes: ['shielding'], minLevel: 1, weight: 100 },
  // 사망 폭발은 H1~H4 예외(플레이어가 시점을 정한다) — H5 는 지킨다
  { id: 'fireEnchanted', hook: 'fireEnchanted', mods: { res: { fire: 0.3 } },
    params: { extraFire: 0.3, delay: 1.0, deathR: 3.0, deathMul: 1.2, escape: 2.5 },
    minionShare: true, hazard: true, excludeTags: [], excludeAffixes: [], minLevel: 1, weight: 90 },
  // 하수인은 적중 감속만 받는다(노바는 팩의 대표만 — 하수인은 대표가 되지 않는다) · range(P3 W1) = 플레이어가 이 거리 안일 때만 노바(화면 밖 표식 금지)
  { id: 'coldEnchanted', hook: 'coldEnchanted', mods: { res: { cold: 0.3 } },
    params: { chillSec: 1.5, novaEvery: 8, novaFirst: 3, novaR: 4.0, delay: 1.3, novaMul: 0.8, novaChillSec: 2.0, escape: 3.5, range: 8 },
    minionShare: true, hazard: true, excludeTags: [], excludeAffixes: [], minLevel: 1, weight: 90 },
  // fxEvery(P3 W1) = AFFIX heal 을 내는 최소 간격(초) · W1 수정(NOTES-W1FIX): regenPctPerSec 0.01 → 0.003 — 수호자(생명 × 28)에게 초당 1%는
  //   시작 캐릭터 DPS 를 거의 지워 수호자 싸움이 4~5분이 됐다(브리프 §3.5 의 흡혈은 「준 피해의 일부 회복」 — 재생은 덧붙임)
  { id: 'vampiric', hook: 'vampiric', mods: {}, params: { leech: 0.5, regenPctPerSec: 0.003, fxEvery: 1 },
    minionShare: true, hazard: false, excludeTags: [], excludeAffixes: [], minLevel: 1, weight: 80 },
  { id: 'shielding', hook: 'shielding', mods: {}, params: { every: 9, first: 4, warn: 0.5, dur: 3.0 },
    minionShare: false, hazard: false, excludeTags: [], excludeAffixes: ['tough'], minLevel: 3, weight: 70 },
  { id: 'lightningEnchanted', hook: 'lightningEnchanted', mods: { res: { lightning: 0.3 } },
    params: { chance: 0.25, icd: 0.5, n: 3, speed: 6, r: 0.35, life: 2.0, mul: 0.5 },
    minionShare: true, hazard: false, excludeTags: [], excludeAffixes: [], minLevel: 2, weight: 90 },
  { id: 'teleporter', hook: 'teleporter', mods: {}, params: { farDist: 8, cd: 4, minR: 2.5, maxR: 4, vanish: 0.4 },
    minionShare: false, hazard: false, excludeTags: ['ranged'], excludeAffixes: [], minLevel: 3, weight: 80 },
  { id: 'jailer', hook: 'jailer', mods: {}, params: { every: 7, first: 2, r: 1.2, delay: 0.8, rootSec: 1.5, range: 11, escape: 1.6 },
    minionShare: false, hazard: true, excludeTags: [], excludeAffixes: [], minLevel: 4, weight: 70 },
  // 사본 = 등급 split · 속성 없음
  { id: 'splitter', hook: 'splitter', mods: {}, params: { n: 3, spread: 1.5 },
    minionShare: false, hazard: false, excludeTags: ['structure'], excludeAffixes: [], minLevel: 2, weight: 70 },
  { id: 'plague', hook: 'plague', mods: {}, params: { every: 6, first: 2, r: 2.0, delay: 1.0, dur: 5, tick: 0.5, mulPerSec: 0.25, range: 11, escape: 2.4 },
    minionShare: false, hazard: true, excludeTags: [], excludeAffixes: [], minLevel: 3, weight: 80 },
  // 근접 전용 종 제외(브리프 §3.5) — 정예가 될 수 있는 종 중에서는 해골 궁수만 받는다
  { id: 'mortar', hook: 'mortar', mods: {},
    params: { minDist: 6, every: 5, first: 1.5, n: 3, spread: 2.0, r: 1.5, delay: 1.2, mul: 0.9, range: 11, escape: 1.9 },
    minionShare: false, hazard: true, excludeTags: ['melee'], excludeAffixes: [], minLevel: 2, weight: 80 },
];
