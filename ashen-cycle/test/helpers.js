// OWNER: P0 — 계약 §6.8
// 웨이브 1의 단위 테스트가 서로를 기다리지 않게 하는 리터럴 빌더. P1 · P3 · P4의 생성 함수에 기대지 않는다
// (import 하는 것은 core/ · data/뿐이다). 자기 패키지의 생성 함수로 만든 상태를 끼워 넣고 싶으면
// `state.player = createPlayerState(…)`처럼 덮어쓴다.
import assert from 'node:assert/strict';
import { EV } from '../src/core/events.js';
import { createRng } from '../src/core/rng.js';
import { resolveShape, ringFromGrow } from '../src/core/hitShapes.js';
import { COMBAT } from '../src/data/combat.js';
import { getWorld } from '../src/data/world.js';

/** @typedef {import('../src/types.js').StatBlock} StatBlock */
/** @typedef {import('../src/types.js').Profile} Profile */
/** @typedef {import('../src/types.js').PlayerState} PlayerState */
/** @typedef {import('../src/types.js').BossState} BossState */
/** @typedef {import('../src/types.js').BossDef} BossDef */
/** @typedef {import('../src/types.js').BossHooks} BossHooks */
/** @typedef {import('../src/types.js').GameState} GameState */
/** @typedef {import('../src/types.js').SimCtx} SimCtx */
/** @typedef {import('../src/types.js').CycleScaling} CycleScaling */
/** @typedef {import('../src/types.js').WorldDef} WorldDef */
/** @typedef {import('../src/types.js').Projectile} Projectile */
/** @typedef {import('../src/types.js').Hazard} Hazard */

/**
 * §7.4 「기본 StatBlock」 리터럴(점수 0 · 장검 +0 · 유물 없음). P4에 의존하지 않는다.
 * @param {Partial<StatBlock>} [overrides]
 * @returns {StatBlock}
 */
export function makeTestStats(overrides = {}) {
  return {
    level: 1,
    hpMax: 100,
    staminaMax: 100,
    staminaRegen: 45,
    weaponId: 'longsword',
    weaponLevel: 0,
    weaponDamage: 20,
    damageMul: 1,
    postureMul: 1,
    critMul: 1.25,
    executeMul: 1,
    guardReduction: 0.75,
    guardStaminaFactor: 0.9,
    flaskCharges: 3,
    flaskHeal: 45,
    parryWindow: 0.18,
    parryPosture: 30,
    postRollDmgMul: 1,
    postRollWindow: 0,
    lifesteal: 0,
    lowHpThreshold: 0,
    lowHpDmgMul: 1,
    emberGainMul: 1,
    ...overrides,
  };
}

/**
 * §7.5 「새 프로필」 리터럴.
 * @param {{points?:{vit?:number, end?:number, str?:number, dex?:number}, weaponLevel?:number, embers?:number,
 *          shards?:number, cycle?:number, seed?:number}} [opts]
 *   weaponLevel은 장착 무기(장검)의 강화 단계다. seed 기본값 1.
 * @returns {Profile}
 */
export function makeTestProfile(opts = {}) {
  const boss = (unlocked) => ({ unlocked, attempts: 0, totalKills: 0, killsThisCycle: 0, bestFraction: 0, milestones: 0 });
  return {
    embers: opts.embers ?? 0,
    shards: opts.shards ?? 0,
    stats: { vit: 0, end: 0, str: 0, dex: 0, ...(opts.points ?? {}) },
    weapons: {
      longsword: { level: opts.weaponLevel ?? 0 },
      greatsword: { level: 0 },
      spear: { level: 0 },
    },
    equippedWeapon: 'longsword',
    flaskChargeLv: 0,
    flaskHealLv: 0,
    relicsOwned: [],
    relicsEquipped: [null, null],
    cycle: opts.cycle ?? 0,
    bosses: { valder: boss(true), fenrir: boss(false), nihil: boss(false) },
    totals: { deaths: 0, kills: 0, embersEarned: 0, playTime: 0 },
    seed: (opts.seed ?? 1) >>> 0,
  };
}

/**
 * PlayerState 리터럴 — §3.4 전 필드(state 'idle', hp/stamina/flasks 가득, pos {0, 0}, facing 0).
 * createPlayerState를 부르지 않는다(P1에 의존하지 않는다).
 * overrides는 얕게 덮어쓴다. pos만 주고 prevPos를 안 주면 prevPos = pos의 복사본이 된다(facing/prevFacing도 같다).
 * @param {StatBlock} [stats]
 * @param {Partial<PlayerState>} [overrides]
 * @returns {PlayerState}
 */
export function makeTestPlayer(stats = makeTestStats(), overrides = {}) {
  /** @type {PlayerState} */
  const p = {
    pos: { x: 0, z: 0 },
    prevPos: { x: 0, z: 0 },
    vel: { x: 0, z: 0 },
    facing: 0,
    prevFacing: 0,
    radius: 0.4,
    hp: stats.hpMax,
    stamina: stats.staminaMax,
    staminaDelay: 0,
    exhausted: false,
    stats,
    state: 'idle',
    stateTime: 0,
    stateDur: 0,
    attack: null,
    iframe: false,
    guarding: false,
    parryActive: false,
    parryT: 0,
    parryArmT: 0,
    parryRearm: 0,
    guardHeldPrev: false,
    canExecute: false,
    lockOn: false,
    sprinting: false,
    sprintTime: 0,
    rollDir: { x: 0, z: 1 },
    flasks: stats.flaskCharges,
    buffer: { action: null, t: 0, dirX: 0, dirZ: 0 },
    hurtInvuln: 0,
    postRollT: 0,
    stepDist: 0,
    knockVel: { x: 0, z: 0 },
    ...overrides,
  };
  if (overrides.pos && !overrides.prevPos) p.prevPos = { x: p.pos.x, z: p.pos.z };
  if (overrides.facing !== undefined && overrides.prevFacing === undefined) p.prevFacing = p.facing;
  return p;
}

/**
 * BossState 리터럴 — §3.5 전 필드(state 'idle', hp = hpMax = def.hp, phase 1, invulnerable false,
 * dmgMul 1, speedMul 1, pos {0, 6}, facing π). createBossState를 부르지 않는다(P3에 의존하지 않는다).
 * overrides는 얕게 덮어쓴다. pos만 주고 prevPos를 안 주면 prevPos = pos의 복사본이 된다(facing · y도 같다).
 * @param {BossDef} def
 * @param {Partial<BossState>} [overrides]
 * @returns {BossState}
 */
export function makeTestBoss(def, overrides = {}) {
  /** @type {BossState} */
  const b = {
    id: def.id,
    pos: { x: 0, z: 6 },
    prevPos: { x: 0, z: 6 },
    facing: Math.PI,
    prevFacing: Math.PI,
    y: 0,
    prevY: 0,
    radius: def.radius,
    hp: def.hp,
    hpMax: def.hp,
    posture: 0,
    postureMax: def.postureMax,
    postureIdle: 0,
    phase: 1,
    pendingPhase: false,
    state: 'idle',
    stateTime: 0,
    stateDur: 0,
    attack: null,
    lastAttacks: [],
    cooldowns: {},
    moveIntent: 'hold',
    strafeDir: 1,
    chaseTime: 0,
    invulnerable: false,
    dmgMul: 1,
    speedMul: 1,
    stepDist: 0,
    ext: {},
    ...overrides,
  };
  if (overrides.pos && !overrides.prevPos) b.prevPos = { x: b.pos.x, z: b.pos.z };
  if (overrides.facing !== undefined && overrides.prevFacing === undefined) b.prevFacing = b.facing;
  if (overrides.y !== undefined && overrides.prevY === undefined) b.prevY = b.y;
  return b;
}

/**
 * GameState 리터럴.
 *   player = makeTestPlayer(stats), boss = bossDef ? makeTestBoss(bossDef) : null.
 *   bossDef가 있으면 mode 'boss' · fight = {phase:'fight', …0} · world = 그 아레나 · dummy null,
 *   없으면 mode 'town' · world = town · dummy = 마을 허수아비 · fight null.
 *   플레이어는 항상 원점(pos {0, 0})에 있다 — 스폰 지점이 필요하면 테스트가 pos를 옮긴다.
 *   bossDef 자체는 상태에 들어가지 않는다 — makeTestCtx(state, {bossDef})로 다시 넘긴다.
 * @param {{mode?:'town'|'boss', bossDef?:BossDef, stats?:StatBlock, world?:WorldDef, profile?:Profile, seed?:number}} [opts]
 * @returns {GameState}
 */
export function makeTestState(opts = {}) {
  const def = opts.bossDef ?? null;
  const world = opts.world ?? getWorld(def ? def.arenaId : 'town');
  const mode = opts.mode ?? (def ? 'boss' : 'town');
  const profile = opts.profile ?? makeTestProfile();
  return {
    mode,
    tick: 0,
    time: 0,
    hitstop: 0,
    world,
    player: makeTestPlayer(opts.stats ?? makeTestStats()),
    boss: def ? makeTestBoss(def) : null,
    dummy: !def && world.dummy
      ? { x: world.dummy.x, z: world.dummy.z, radius: COMBAT.dummy.radius, lastDamage: 0, total: 0, sinceHit: 0 }
      : null,
    projectiles: [],
    hazards: [],
    telegraphs: [],
    fight: def
      ? {
        bossId: def.id,
        phase: 'fight',
        time: 0,
        phaseTime: 0,
        damageDealt: 0,
        damageTaken: 0,
        parries: 0,
        executions: 0,
        outcome: null,
        reward: null,
      }
      : null,
    nearFacility: null,
    profile,
    debug: { godMode: false, noStamina: false },
    events: [],
    hitLog: [],
    rngState: (opts.seed ?? 1) >>> 0,
    nextId: 1,
  };
}

/**
 * SimCtx + {events: [], spawned: {projectiles: [], hazards: []}}.
 *   emit            — state.events와 ctx.events 양쪽에 {name, payload}를 쌓는다(ctx.events는 비워지지 않는다).
 *   nextHitId       — state.nextId를 돌려주고 1 올린다.
 *   requestHitstop  — state.hitstop = min(COMBAT.hitstopMax, max(현재, 요청)).
 *   shake           — CAMERA_SHAKE {amp, dur}를 emit.
 *   spawnProjectile — 기록만 한다(state.projectiles에는 넣지 않는다). §3.6 전 필드의 Projectile을 돌려주고
 *                     ctx.spawned.projectiles에 push. damage = spec.damage × damageMul.
 *   spawnHazard     — 기록만 한다. §3.6 전 필드의 Hazard(shape는 월드 공간 — grow면 u = 0의 띠)를 돌려주고
 *                     ctx.spawned.hazards에 push.
 *   bossDef 기본값 null · bossHooks 기본값 {} · scaling 기본값 전부 1(chainBonus 0).
 * @param {GameState} state
 * @param {{seed?:number, bossDef?:BossDef|null, bossHooks?:BossHooks, scaling?:Partial<CycleScaling>}} [opts]
 * @returns {SimCtx & {events:{name:string, payload:Object}[], spawned:{projectiles:Projectile[], hazards:Hazard[]}}}
 */
export function makeTestCtx(state, opts = {}) {
  const rng = createRng(opts.seed ?? state.rngState ?? 1);
  /** @type {any} */
  const ctx = {
    state,
    rng,
    events: [],
    spawned: { projectiles: [], hazards: [] },
    bossDef: opts.bossDef ?? null,
    bossHooks: opts.bossHooks ?? {},
    scaling: { hpMul: 1, dmgMul: 1, rewardMul: 1, speedMul: 1, thinkMul: 1, chainBonus: 0, ...(opts.scaling ?? {}) },
  };
  ctx.emit = (name, payload = {}) => {
    const e = { name, payload };
    state.events.push(e);
    ctx.events.push(e);
  };
  ctx.nextHitId = () => {
    const id = state.nextId;
    state.nextId += 1;
    return id;
  };
  ctx.requestHitstop = (seconds) => {
    state.hitstop = Math.min(COMBAT.hitstopMax, Math.max(state.hitstop, seconds));
  };
  ctx.shake = (amp, dur) => ctx.emit(EV.CAMERA_SHAKE, { amp, dur });
  ctx.spawnProjectile = (spec, x, z, dir, damageMul) => {
    /** @type {Projectile} */
    const p = {
      id: ctx.nextHitId(),
      kind: spec.kind,
      style: spec.style,
      x,
      z,
      prevX: x,
      prevZ: z,
      y: spec.y,
      dir,
      speed: spec.speed,
      r: spec.r,
      age: 0,
      life: spec.life,
      homing: spec.homing,
      homingTime: spec.homingTime,
      damage: spec.damage * damageMul,
      guardable: spec.guardable,
      parryable: spec.parryable,
      knockdown: spec.knockdown,
      hitId: ctx.nextHitId(),
    };
    ctx.spawned.projectiles.push(p);
    return p;
  };
  ctx.spawnHazard = (spec, x, z, facing, damageMul) => {
    /** @type {Hazard} */
    const h = {
      id: ctx.nextHitId(),
      kind: spec.kind,
      style: spec.style,
      state: spec.warn > 0 ? 'warn' : 'active',
      t: 0,
      warn: spec.warn,
      active: spec.active,
      interval: spec.interval,
      shape: spec.grow ? ringFromGrow(x, z, spec.grow, 0) : resolveShape(spec.shape, x, z, facing),
      damage: spec.damage * damageMul,
      guardable: spec.guardable,
      knockdown: spec.knockdown,
      hitId: ctx.nextHitId(),
      nextTick: spec.interval,
      grow: spec.grow ?? null,
      x,
      z,
    };
    ctx.spawned.hazards.push(h);
    return h;
  };
  return ctx;
}

/**
 * validateBossDef(§8.9)를 통과하는 합성 BossDef. 공격 2개:
 *   synth_melee  — 근접 arc(0~5m · 패링 가능 · glow 'none')
 *   synth_ranged — 원거리 capsule(4~20m · 패링 불가 · glow 'danger' · 텔레그래프)
 * id는 'valder', 아레나는 arena_valder(기둥 없음 · 반경 20)다. think는 [0.5, 0.5]로 고정이라 타이밍 테스트가 결정적이다.
 * overrides는 최상위 필드를 얕게 덮어쓴다(attacks를 주면 통째로 바뀐다). 반환값은 매번 새 객체다.
 * @param {Partial<BossDef>} [overrides]
 * @returns {BossDef}
 */
export function makeSynthBossDef(overrides = {}) {
  /** @type {BossDef} */
  const def = {
    id: 'valder',
    rig: 'humanoid',
    arenaId: 'arena_valder',
    style: 'fire',
    hp: 1000,
    postureMax: 100,
    postureDecayDelay: 5,
    postureDecayRate: 6,
    radius: 0.8,
    height: 2.7,
    moveSpeed: 3,
    turnRate: 3.5,
    preferredRange: 3,
    kite: false,
    stride: 1.6,
    think: [0.5, 0.5],
    introDur: 1,
    parriedDur: 1,
    groggyDur: 5,
    executedDur: 1.2,
    recoverDur: 0.8,
    phaseShiftDur: 2,
    phase2: { hpFrac: 0.5, speedMul: 1.1, dmgMul: 1.15, thinkMul: 0.7, moveSpeedMul: 1.2 },
    fallbackAttack: 'synth_melee',
    reward: 1000,
    attacks: {
      synth_melee: {
        id: 'synth_melee',
        pose: 'slashR',
        glow: 'none',
        windup: 0.6,
        active: 0.15,
        recovery: 1.0,
        sel: { minRange: 0, maxRange: 5, weight: 1, cooldown: 0 },
        hits: [{
          t0: 0, t1: 0.15, interval: 0, shape: { type: 'arc', r: 4, halfAngle: 1.2 }, damage: 20,
          guardable: true, parryable: true, knockdown: false, telegraph: false,
        }],
        move: null,
        track: { turnRate: 4, lockLead: 0.15 },
        events: [],
        chain: [],
      },
      synth_ranged: {
        id: 'synth_ranged',
        pose: 'thrust',
        glow: 'danger',
        windup: 0.8,
        active: 0.3,
        recovery: 1.2,
        sel: { minRange: 4, maxRange: 20, weight: 1, cooldown: 0 },
        hits: [{
          t0: 0, t1: 0.3, interval: 0, shape: { type: 'capsule', fwd0: 0, fwd1: 20, r: 0.8 }, damage: 25,
          guardable: true, parryable: false, knockdown: false, telegraph: true,
        }],
        move: null,
        track: { turnRate: 3, lockLead: 0.2 },
        events: [],
        chain: [],
      },
    },
  };
  return { ...def, ...structuredClone(overrides) };
}

/**
 * fn(i)를 n번(i = 0..n−1).
 * @param {number} n
 * @param {(i:number)=>void} fn
 */
export function runTicks(n, fn) {
  for (let i = 0; i < n; i++) fn(i);
}

/**
 * @param {{name:string}[]} events
 * @param {string} name EV의 값
 * @returns {number}
 */
export function countEvents(events, name) {
  let n = 0;
  for (const e of events) if (e.name === name) n += 1;
  return n;
}

/**
 * 숫자 필드에 NaN/Infinity가 있으면 assert 실패(경로 표시). 함수는 건너뛴다. 순환 참조에 안전하다.
 * @param {any} obj
 * @param {string} [path]
 */
export function assertFiniteDeep(obj, path = 'state') {
  const seen = new Set();
  /** @param {any} v @param {string} p */
  const walk = (v, p) => {
    if (typeof v === 'number') {
      assert.ok(Number.isFinite(v), `${p} = ${v} (유한한 수가 아니다)`);
      return;
    }
    if (v === null || typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) walk(v[i], `${p}[${i}]`);
      return;
    }
    for (const k of Object.keys(v)) walk(v[k], `${p}.${k}`);
  };
  walk(obj, path);
}
