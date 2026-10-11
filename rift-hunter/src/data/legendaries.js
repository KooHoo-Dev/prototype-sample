// OWNER: P5 — 계약 §7.9 · §8.5 (시드 — P0 이 W0 에 계약 값으로 채웠다 · 훅 구현은 P1 sim/player/equipHooks.js)
// 전설 12(패치형 9 · 사건형 3) · 세트 2. 문면은 leg.<id> · legfx.<id> · set.<id> · set.<id>.b2/b4 · setp.<pieceId>.
// 패치형: skill(대상 노드) + patch(그 스킬 params 에 덮어쓸 값 — §8.4 키) · 사건형: at('kill' | 'globe') + params(EQUIP_HOOKS[hook]).

/** @typedef {import('../types.js').LegendaryDef} LegendaryDef */
/** @typedef {import('../types.js').SetDef} SetDef */

/** @type {LegendaryDef[]} */
export const LEGENDARIES = [
  { id: 'emberMaelstrom', baseId: 'greatsword', cls: 'warrior', hook: 'whirlwindVortex', skill: 'whirlwind',
    patch: { vortex: { everySec: 0.6, r: 2.0, dur: 2.0, tick: 0.5, coefPerSec: 0.35 } }, params: {}, affixes: [3, 4], weight: 1 },
  { id: 'quakeTreads', baseId: 'boots', cls: 'warrior', hook: 'leapQuake', skill: 'leap',
    patch: { landQuake: { mul: 0.6 } }, params: {}, affixes: [3, 4], weight: 1 },
  { id: 'ragingHorn', baseId: 'helm', cls: 'warrior', hook: 'chargeRefund', skill: 'charge',
    patch: { refund: { ragePerHit: 5, resetAt: 3, resetTo: 1.0 } }, params: {}, affixes: [3, 4], weight: 1 },
  { id: 'ancestorBelt', baseId: 'belt', cls: 'warrior', hook: 'warCryHeal', skill: 'warCry',
    patch: { castHeal: 0.25 }, params: {}, affixes: [3, 4], weight: 1 },
  { id: 'tremorFists', baseId: 'gloves', cls: 'warrior', hook: 'stompShockwave', skill: 'groundStomp',
    patch: { shockwave: { len: 10, width: 2.0, coef: 1.0 } }, params: {}, affixes: [3, 4], weight: 1 },
  { id: 'piercingFlame', baseId: 'wand', cls: 'mage', hook: 'fireballPierce', skill: 'fireball',
    patch: { pierce: 3 }, params: {}, affixes: [3, 4], weight: 1 },
  { id: 'stormOrb', baseId: 'orb', cls: 'mage', hook: 'chainBounce', skill: 'chainLightning',
    patch: { bouncesAdd: 2 }, params: {}, affixes: [3, 4], weight: 1 },
  { id: 'frostWalkers', baseId: 'boots', cls: 'mage', hook: 'teleportNova', skill: 'teleport',
    patch: { arrivalNova: true }, params: {}, affixes: [3, 4], weight: 1 },
  { id: 'ashenCrown', baseId: 'helm', cls: 'mage', hook: 'meteorShower', skill: 'meteor',
    patch: { shower: { n: 2, r: 2.0, mul: 0.5, delay: 0.3 } }, params: {}, affixes: [3, 4], weight: 1 },
  { id: 'rimeRing', baseId: 'ring', cls: 'mage', hook: 'frozenShatter', at: 'kill',
    params: { r: 2.5, coef: 0.8 }, affixes: [3, 4], weight: 1 },
  { id: 'bloodPact', baseId: 'amulet', cls: null, hook: 'killExplode', at: 'kill',
    params: { chance: 0.10, r: 3.0, pctOfMax: 0.2 }, affixes: [3, 4], weight: 1 },
  { id: 'verdantSash', baseId: 'belt', cls: null, hook: 'globeDouble', at: 'globe',
    params: { mul: 2, radiusAdd: 1.0 }, affixes: [3, 4], weight: 1 },
];

/** @type {SetDef[]} */
export const SETS = [
  { id: 'ironLord', cls: 'warrior',
    pieces: [
      { id: 'ironLordHelm', baseId: 'helm', slot: 'helm' },
      { id: 'ironLordPlate', baseId: 'chest', slot: 'chest' },
      { id: 'ironLordGrips', baseId: 'gloves', slot: 'gloves' },
      { id: 'ironLordGreaves', baseId: 'boots', slot: 'boots' },
    ],
    bonus2: { armorPct: 25, str: 20 },
    bonus4: { aoePct: 40, dmgTakenReduce: 10 } },
  { id: 'ashSage', cls: 'mage',
    pieces: [
      { id: 'ashSageCowl', baseId: 'helm', slot: 'helm' },
      { id: 'ashSageRobe', baseId: 'chest', slot: 'chest' },
      { id: 'ashSageGloves', baseId: 'gloves', slot: 'gloves' },
      { id: 'ashSageSteps', baseId: 'boots', slot: 'boots' },
    ],
    bonus2: { manaRegenPct: 40, int: 20 },
    bonus4: { firePct: 30, coldPct: 30, cdr: 8 } },
];
