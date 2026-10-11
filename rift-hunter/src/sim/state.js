// OWNER: P0 — 계약 §6.3 · §3.7 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 상태 모양을 만드는 순수 함수. 상태는 순수 객체(structuredClone · JSON 가능). 「없음」인 절대 틱은 -1.

import { CHAR_SLOTS, EQUIP_SLOTS, RARITIES, STASH_SIZE, STATE_VERSION } from '../core/constants.js';
import { hash32 } from '../core/hash.js';
import { seedRng } from '../core/rng.js';
import { CLASSES } from '../data/classes.js';
import { METER } from '../data/combat.js';
import { GUARDIANS } from '../data/guardians.js';
import { RIFT } from '../data/rift.js';

/** @typedef {import('../types.js').GameState} GameState */
/** @typedef {import('../types.js').AccountState} AccountState */
/** @typedef {import('../types.js').PlayerState} PlayerState */
/** @typedef {import('../types.js').TownState} TownState */
/** @typedef {import('../types.js').RiftState} RiftState */
/** @typedef {import('../types.js').RunStats} RunStats */
/** @typedef {import('../types.js').MeterState} MeterState */
/** @typedef {import('../types.js').MonStatus} MonStatus */
/** @typedef {import('../types.js').MapData} MapData */

/**
 * char null · scene 'town' · rift null · rng 넷 = seedRng(hash32(seed, k)) k = 1..4(combat · loot · ai · shop)
 * @param {{seed:number, account?:AccountState|null, devSession?:boolean}} opts
 * @returns {GameState}
 */
export function createGameState({ seed, account = null, devSession = false }) {
  const s = Number(seed) >>> 0;
  return {
    v: STATE_VERSION,
    tick: 0,
    seed: s,
    rng: {
      combat: seedRng(hash32(s, 1)),
      loot: seedRng(hash32(s, 2)),
      ai: seedRng(hash32(s, 3)),
      shop: seedRng(hash32(s, 4)),
    },
    nextId: 1,
    scene: 'town',
    pendingTravel: null,
    account: account ?? createAccount(),
    char: null,
    player: createPlayerState(),
    town: createTownState(),
    rift: null,
    meter: createMeter(),
    events: [],
    flags: { invincible: false, devSession: !!devSession },
  };
}

/** chars [null×4] · stash [null×60] · nextItemId 1 · lastSlot -1 @returns {AccountState} */
export function createAccount() {
  return { chars: emptyArray(CHAR_SLOTS), stash: emptyArray(STASH_SIZE), nextItemId: 1, lastSlot: -1 };
}

/**
 * §3.7 PlayerState 모든 필드. life 1 · lifeMax 1 은 자리 값이다 — 캐릭터를 붙이는 쪽이 refreshStats → resetPlayerForScene({full:true})를 부른다.
 * @returns {PlayerState}
 */
export function createPlayerState() {
  return {
    pos: { x: 0, z: 0 },
    prevPos: { x: 0, z: 0 },
    facing: 0,
    r: CLASSES[0].radius,
    life: 1,
    lifeMax: 1,
    resource: 0,
    resourceMax: 1,
    act: 'idle',
    actSkill: null,
    actStart: 0,
    actHit: 0,
    actEnd: 0,
    actPoint: null,
    actTargetId: null,
    actId: 0,
    path: [],
    intent: { kind: 'none' },
    buffer: null,
    readyAt: {},
    potionReadyAt: 0,
    buffs: [],
    shield: 0,
    st: { slowPct: 0, slowUntil: 0, rootUntil: 0 },
    recall: null,
    channel: null,
    air: null,
    sk: { hitIds: [], hits: 0, nextAt: -1 },
    knock: null,
    potionQueuedUntil: 0,
    killedBy: null,
    hover: null,
    targetId: null,
    combatUntil: 0,
    protectUntil: 0,
    invulnUntil: 0,
    lowLife: false,
    dead: false,
    deadAt: -1,
    speed: 0,
    moving: false,
    rageTaken: { windowStart: 0, sum: 0 },
    loh: { actionId: 0, n: 0 },
    hitstopAt: -1,
    failAt: -1,
    failKey: null,
  };
}

/** @returns {TownState} */
export function createTownState() {
  return { portalOpen: false, returnPrompt: false, lastInteract: null };
}

/**
 * phase 'active' · gauge 0 · lives RIFT.lives · leftAt -1 · explored 0×(w×h) · checkpoint = map.spawn · stats = createRunStats()
 * @param {{level:number, seed:number, tileset:import('../types.js').TilesetId, mapId:string, map:MapData, tick?:number}} opts  tick = openedAt(기본 0)
 * @returns {RiftState}
 */
export function createRiftState({ level, seed, tileset, mapId, map, tick = 0 }) {
  return {
    level,
    seed: Number(seed) >>> 0,
    tileset,
    mapId,
    phase: 'active',
    gauge: 0,
    lives: RIFT.lives,
    deaths: 0,
    openedAt: tick,
    leftAt: -1,
    ticksIn: 0,
    mons: [],
    projs: [],
    effects: [],
    drops: [],
    packs: [],
    portals: [],
    guardianId: null,
    guardianSpawn: null,
    returnPos: null,
    checkpoint: { x: map.spawn.x, z: map.spawn.z },
    checkpointCalm: 0,
    explored: new Array(map.w * map.h).fill(0),
    rootLockUntil: -1,
    stats: createRunStats(),
    summary: null,
    completeAt: null,
    guardianType: GUARDIANS[0].id,
    calmAt: null,
    mods: null,
  };
}

/** @returns {RunStats} */
export function createRunStats() {
  /** @type {any} */
  const drops = {};
  for (const r of RARITIES) drops[r] = 0;
  return {
    kills: { normal: 0, champion: 0, elite: 0, minion: 0, guardian: 0, other: 0 },
    drops,
    gold: 0,
    xp: 0,
    upgrades: 0,
    recalls: 0,
    potions: 0,
    maxTargeting: 0,
    swarmMoments: 0,
    dmgDealt: 0,
    dmgTaken: 0,
    bagFullRecall: false,
  };
}

/** dealt/taken 0×150 · killTicks [] · swarmArmed true @returns {MeterState} */
export function createMeter() {
  return {
    dealt: new Array(METER.window).fill(0),
    taken: new Array(METER.window).fill(0),
    idx: 0,
    killTicks: [],
    runXp: 0,
    runGold: 0,
    targeting: 0,
    swarmArmed: true,
  };
}

/** 시각 필드는 -1(없음) · chill 0 @returns {MonStatus} */
export function createMonStatus() {
  return {
    stunUntil: -1,
    stunImmuneUntil: -1,
    chill: 0,
    chillDecayAt: -1,
    freezeUntil: -1,
    freezeImmuneUntil: -1,
    burn: null,
    shockUntil: -1,
    slow: null,
    flinchUntil: -1,
    flinchImmuneUntil: -1,
    knockImmuneUntil: -1,
    invulnUntil: -1,
  };
}

/** {mainHand:null, …, ring2:null} @returns {Record<import('../types.js').EquipSlot, import('../types.js').Item|null>} */
export function emptyEquip() {
  /** @type {any} */
  const out = {};
  for (const s of EQUIP_SLOTS) out[s] = null;
  return out;
}

/** [null × n] @param {number} n @returns {null[]} */
export function emptyArray(n) {
  return new Array(n).fill(null);
}

