// OWNER: P0 — 계약 §6.13 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 테스트 공용 — W1 테스트가 서로를 기다리지 않게 상태 · 문맥을 리터럴로 만든다.
// makeTestCtx 만 계약대로 computeModifiers · rigStats(P4) · syncRig(P1)를 부른다(§6.13).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SKILL_IDS, STATE_VERSION, TICKS_PER_HOUR, TICKS_PER_MINUTE } from '../src/core/constants.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { hash32 } from '../src/core/hash.js';
import { makeInput } from '../src/core/inputFrame.js';
import { smoothstep } from '../src/core/math.js';
import { CAST } from '../src/data/bite.js';
import { START } from '../src/data/economy.js';
import { GEAR_BY_ID } from '../src/data/gear.js';
import { BANDS, TIME } from '../src/data/time.js';
import { WEATHER } from '../src/data/weather.js';
import { getSpot, getStage, stageOfSpot } from '../src/data/stages/index.js';
import { computeModifiers, rigStats } from '../src/sim/progression/modifiers.js';
import { syncRig } from '../src/sim/fishing/rig.js';

/** @typedef {import('../src/types.js').GameState} GameState */
/** @typedef {import('../src/types.js').Profile} Profile */
/** @typedef {import('../src/types.js').RigStats} RigStats */
/** @typedef {import('../src/types.js').Modifiers} Modifiers */
/** @typedef {import('../src/types.js').SimCtx} SimCtx */
/** @typedef {import('../src/types.js').InputFrame} InputFrame */

// ── 리터럴 값

/** §7.9 START 리터럴(createNewProfile 을 부르지 않는다) + 얕은 덮어쓰기 @returns {Profile} */
export function makeTestProfile(overrides = {}) {
  const skills = {};
  for (const id of SKILL_IDS) skills[id] = 0;
  return /** @type {Profile} */ ({
    money: START.money,
    level: START.level,
    xp: 0,
    xpTotal: 0,
    skillPoints: START.skillPoints,
    skills,
    owned: {},
    baits: { ...START.baits },
    sets: { float: { ...START.sets.float }, bottom: { ...START.sets.bottom } },
    hold: [],
    dex: {},
    flags: { hints: {}, freeBaitDay: 0 },
    stats: { landed: 0, lost: 0, released: 0, sold: 0, earned: 0, casts: 0 },
    nextUid: 1,
    ...overrides,
  });
}

/** 스킬 0 의 Modifiers 리터럴(§7.7 0단계) @returns {Modifiers} */
export function makeTestMods(overrides = {}) {
  return {
    castMul: 1, perfectWindow: 0.06,
    hookWindowAdd: 0, earlyBaitKeep: 0,
    dragNotches: 20, lineStrMul: 1,
    slackRateMul: 1, abrasionMul: 1,
    pumpDrainMul: 1, jumpPumpMul: 1,
    knowledge: 0,
    biteRateMul: 1, baitKeepOnFail: 0,
    netRangeAdd: 0, landStaminaAdd: 0,
    sellMul: 1,
    signalMul: 1, tier3Unlocked: false,
    ...overrides,
  };
}

/** 1단계 기본 장비 · 스킬 0 의 RigStats 리터럴(§7.6 · §7.7 · §3.6) @param {'float'|'bottom'} [set] @returns {RigStats} */
export function makeTestRigStats(set = 'bottom', overrides = {}) {
  const common = {
    reelId: 'reel_1', lineId: 'line_1', hookId: 'hook_m',
    rodSensitivity: 1.0,
    reelMaxDragKg: 5, reelSpeedMS: 1.5, spoolCapM: 120, lineM: 120,
    lineKg: 4, lineBiteMul: 1.0, lineAbrasionMul: 1.0, hookSize: 2,
    dragNotches: 20, dragNotchKg: 0.25, signalMul: 1,
    perfectWindow: 0.06, biteRateMul: 1, netReachM: 1.4, landStamina: 0.15,
    slackRateMul: 1, pumpDrainMul: 1, jumpPumpMul: 1, earlyBaitKeep: 0, baitKeepOnFail: 0, showStamina: false,
  };
  const bySet = set === 'float'
    ? {
      set: 'float', rodId: 'rod_float_1', floatId: 'float_1', sinkerId: null, baitId: 'worm', baitCount: 20,
      castMaxM: 24, rodMaxLoadKg: 2.6, rodLengthM: 3.6,
      floatSensitivity: 1.0, floatStability: 0.5, floatDriftMul: 1.0, sinkerHoldMS: 0, sinkerCastBonusM: 0, hookWindowS: 0.9,
    }
    : {
      set: 'bottom', rodId: 'rod_bottom_1', floatId: null, sinkerId: 'sinker_1', baitId: 'paste', baitCount: 20,
      castMaxM: 32, rodMaxLoadKg: 3.2, rodLengthM: 2.7,
      floatSensitivity: 1, floatStability: 1, floatDriftMul: 1, sinkerHoldMS: 0.5, sinkerCastBonusM: 0, hookWindowS: 1.1,
    };
  return /** @type {RigStats} */ ({ ...common, ...bySet, ...overrides });
}

// ── 상태 · 문맥

function clockAt(day, tickInDay, weatherId) {
  const hour = tickInDay / TICKS_PER_HOUR;
  const { sunrise, sunset, maxSunElev, minSunElev, nightFloor, nightLight, twilight } = TIME;
  let sunElev;
  let sunAzim;
  if (hour >= sunrise && hour < sunset) {
    const f = (hour - sunrise) / (sunset - sunrise);
    sunElev = maxSunElev * Math.sin(Math.PI * f);
    sunAzim = -Math.PI / 2 + Math.PI * f;
  } else {
    const g = ((hour - sunset + 24) % 24) / (24 - (sunset - sunrise));
    sunElev = minSunElev * Math.sin(Math.PI * g);
    sunAzim = Math.PI / 2 + Math.PI * g;
  }
  const light = nightFloor + (1 - nightFloor) * smoothstep(twilight[0], twilight[1], sunElev) * WEATHER[weatherId].light;
  const band = BANDS.find(b => (b.from < b.to ? hour >= b.from && hour < b.to : hour >= b.from || hour < b.to)).id;
  return {
    day, tickInDay, hour,
    minute: Math.floor((tickInDay % TICKS_PER_HOUR) / TICKS_PER_MINUTE),
    band, sunElev, sunAzim, light, night: light < nightLight,
  };
}

/**
 * §3.4 모양의 GameState 리터럴. spotId 가 있으면 그 자리의 씬 · 낚시 모드 · rig.phase 'ready' · origin = stand.
 * @param {{scene?:string, spotId?:string|null, mode?:'walk'|'fish', set?:'float'|'bottom', seed?:number, hour?:number, weather?:string, profile?:Profile}} [opts]
 * @returns {GameState}
 */
export function makeTestState(opts = {}) {
  const { spotId = null, set = 'bottom', seed = 1, hour = 8, weather = 'clear' } = opts;
  const scene = spotId ? stageOfSpot(spotId) : (opts.scene ?? 'lake');
  const stage = getStage(scene);
  const mode = spotId ? 'fish' : (opts.mode ?? 'walk');
  const spot = spotId ? getSpot(spotId) : mode === 'fish' ? stage.spots[0] : null;
  const profile = opts.profile ?? makeTestProfile();
  const cfg = profile.sets[set];
  const reel = GEAR_BY_ID[cfg.reel];
  const dragNotches = 20;
  const clock = clockAt(1, Math.round(hour * TICKS_PER_HOUR), weather);
  const outdoor = stage.kind === 'outdoor';
  const w = WEATHER[weather];
  const pos = spot ? { ...spot.stand } : { x: stage.spawn.x, z: stage.spawn.z };
  const yaw = spot ? spot.facing : stage.spawn.yaw;
  const baitOk = (profile.baits[cfg.bait] ?? 0) > 0;
  const lineOk = cfg.lineM >= CAST.minLineM;
  return /** @type {GameState} */ (/** @type {unknown} */ ({
    version: STATE_VERSION,
    seed,
    rng: seedRng(seed),
    tick: 0,
    scene,
    clock,
    weather: {
      today: { lake: weather, coast: weather, river: weather },
      tomorrow: { lake: weather, coast: weather, river: weather },
      current: weather,
    },
    env: {
      waveAmp: outdoor ? stage.waves.amp * w.waveMul : 0,
      wavePeriod: stage.waves.period,
      headlamp: outdoor && clock.night,
      rain: outdoor ? w.rain : 0,
      ambience: stage.ambience,
    },
    player: {
      pos: { ...pos }, prevPos: { ...pos }, yaw, pitch: 0,
      mode, spotId: spot ? spot.id : null, speed: 0, nearby: null,
    },
    rig: {
      set,
      phase: spot ? 'ready' : 'idle',
      phaseTime: 0,
      origin: { ...pos },
      aimYaw: yaw,
      power: 0,
      perfectFrom: 0.94,
      aimPreview: null,
      bobber: { ...pos },
      prevBobber: { ...pos },
      castT: 0,
      dist: 0,
      bearing: 0,
      waterDepth: 0,
      baitDepth: 0,
      layer: 'surface',
      floatDepth: profile.sets.float.depthM,
      bailOpen: false,
      drifting: false,
      bottomSlip: false,
      dragNotch: Math.min(cfg.dragNotch, dragNotches),
      dragNotches,
      dragKg: Math.min(cfg.dragNotch, dragNotches) * reel.maxDragKg / dragNotches,
      castBaitId: null,
      pendingSet: null,
      signal: { kind: 'none', t: 0, strength: 0, takeStyle: 'sink', count: 0 },
      hookWindow: { open: false, remaining: 0, total: 0 },
      canCast: !!spot && baitOk && lineOk,
      castBlock: !spot ? null : !baitOk ? 'noBait' : !lineOk ? 'noLine' : null,
      failReason: null,
      lastLoss: null,
      castBuffered: false,
      bite: null,
    },
    fight: null,
    pendingCatch: null,
    profile,
    session: { ignoreGates: false, devSession: false },
    debug: { forceBite: null, noBites: false },
    events: [],
  }));
}

/**
 * SimCtx + {events: []} — emit 은 state.events 와 ctx.events 둘 다에. stage/spot 채움 ·
 * mods = computeModifiers(profile) · rigStats = rigStats(profile, rig.set, mods) · refresh = 그 둘을 다시 계산 + syncRig(ctx).
 * opts: {refresh?, mods?, rigStats?, stage?, spot?} 로 바꿀 수 있다. 만들 때 refresh 를 부르지 않는다.
 * @param {GameState} state @returns {SimCtx & {events:Array<{name:string, payload:Object}>}}
 */
export function makeTestCtx(state, opts = {}) {
  /** @type {any} */
  const ctx = {
    state,
    rng: makeRng(state.rng),
    events: [],
    emit(name, payload = {}) {
      state.events.push({ name, payload });
      ctx.events.push({ name, payload });
    },
    stage: opts.stage ?? getStage(state.scene),
    spot: opts.spot !== undefined ? opts.spot : state.player.spotId ? getSpot(state.player.spotId) : null,
    mods: null,
    rigStats: null,
    refresh: null,
  };
  ctx.mods = opts.mods ?? computeModifiers(state.profile);
  ctx.rigStats = opts.rigStats ?? rigStats(state.profile, state.rig.set, ctx.mods);
  ctx.refresh = opts.refresh ?? (() => {
    ctx.mods = computeModifiers(state.profile);
    ctx.rigStats = rigStats(state.profile, state.rig.set, ctx.mods);
    syncRig(ctx);
  });
  return ctx;
}

// ── 도구

/** @param {number} n @param {(i:number) => void} fn */
export function runTicks(n, fn) {
  for (let i = 0; i < n; i++) fn(i);
}

/** @param {Array<{name:string}>} events @param {string} name @returns {number} */
export function countEvents(events, name) {
  let n = 0;
  for (const e of events) if (e.name === name) n++;
  return n;
}

/** NaN · Infinity 를 경로와 함께 실패 @param {any} obj @param {string} [path] */
export function assertFiniteDeep(obj, path = 'state') {
  const seen = new Set();
  const walk = (v, p) => {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) assert.fail(`${p} 가 유한수가 아니다: ${v}`);
      return;
    }
    if (v === null || typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else for (const k of Object.keys(v)) walk(v[k], `${p}.${k}`);
  };
  walk(obj, path);
}

/**
 * 결정성 테스트용 무작위 입력열 — 같은 (seed, tick) 이면 언제나 같은 입력(상태 없음).
 * 홀드는 30틱 덩어리로 바뀌고(누름/뗌 에지는 덩어리 경계에서), 나머지 에지는 틱마다 낮은 확률.
 * @param {number} seed @returns {(tick:number) => InputFrame}
 */
export function randomInputs(seed) {
  const BLOCK = 30;
  const blockOf = (b) => {
    const r = makeRng(seedRng(hash32(seed, b, 7)));
    return {
      primary: r.chance(0.5),
      secondary: r.chance(0.3),
      moveX: r.int(-1, 1),
      moveZ: r.int(-1, 1),
      yaw: (r.next() - 0.5) * 2.4,
      pitch: (r.next() - 0.5) * 0.9,
    };
  };
  return (tick) => {
    const b = Math.floor(tick / BLOCK);
    const cur = blockOf(b);
    const prev = blockOf(b - 1);
    const edge = tick % BLOCK === 0;
    const r = makeRng(seedRng(hash32(seed, tick, 13)));
    return makeInput({
      moveX: cur.moveX,
      moveZ: cur.moveZ,
      yaw: cur.yaw + (r.next() - 0.5) * 0.02,
      pitch: cur.pitch,
      primary: cur.primary,
      primaryPressed: edge && cur.primary && !prev.primary,
      primaryReleased: edge && !cur.primary && prev.primary,
      secondary: cur.secondary,
      hook: r.chance(0.02),
      interact: r.chance(0.01),
      dragSteps: r.chance(0.05) ? r.int(-2, 2) : 0,
      bail: r.chance(0.005),
      depthSteps: r.chance(0.02) ? r.int(-1, 1) : 0,
      selectSet: r.chance(0.003) ? (r.chance(0.5) ? 'float' : 'bottom') : null,
    });
  };
}

// ── 모양 검사(계약 §3 의 typedef 에서 필드 이름을 읽는다 — types.js 가 정본)

const TYPES_SRC = readFileSync(fileURLToPath(new URL('../src/types.js', import.meta.url)), 'utf8');

function topLevelKeys(objType) {
  // '{a:number, b:{c:number}|null, d?:x}' → ['a', 'b'] (선택 필드 ? 는 뺀다)
  const body = objType.trim().replace(/^\{/, '').replace(/\}$/, '');
  const keys = [];
  let depth = 0;
  let cur = '';
  for (const ch of body + ',') {
    if (ch === '{' || ch === '[' || ch === '(' || ch === '<') depth++;
    if (ch === '}' || ch === ']' || ch === ')' || ch === '>') depth--;
    if (ch === ',' && depth === 0) {
      const m = cur.trim().match(/^(\w+)(\??):/);
      if (m && !m[2]) keys.push(m[1]);
      cur = '';
    } else cur += ch;
  }
  return keys;
}

/**
 * types.js 의 typedef 이름 → 필수 필드 이름(선택 필드 [x] · x? 는 뺀다)
 * @param {string} name @returns {string[]}
 */
export function typeKeys(name) {
  const objIdx = TYPES_SRC.search(new RegExp(`@typedef \\{Object\\} ${name}\\b`));
  if (objIdx >= 0) {
    const end = TYPES_SRC.indexOf('*/', objIdx);
    const block = TYPES_SRC.slice(objIdx, end);
    const keys = [];
    for (const m of block.matchAll(/@property \{[^\n]*?\}\s+(\[?)(\w+)/g)) if (!m[1]) keys.push(m[2]);
    return keys;
  }
  const inline = TYPES_SRC.match(new RegExp(`@typedef \\{(\\{[^\\n]*\\})\\} ${name}\\b`));
  if (inline) return topLevelKeys(inline[1]);
  throw new Error(`typedef 를 찾지 못했다: ${name}`);
}

/** 그 typedef 의 필수 필드가 다 있는지(남는 필드는 본다 — 없는 필드만 실패) */
export function assertShape(obj, typeName, path = typeName) {
  assert.ok(obj && typeof obj === 'object', `${path} 가 객체가 아니다`);
  const missing = typeKeys(typeName).filter(k => !(k in obj));
  assert.deepEqual(missing, [], `${path} 에 없는 필드: ${missing.join(', ')}`);
}
