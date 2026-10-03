// OWNER: P0 — 계약 §11.6 · §1.1-6 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 화면 확인용 고정 상태 — sim 을 밀지 않고 레이어 · ui 만 돌려 W1 의 화면 패키지가 자기 화면을 본다(?fixture=<이름>).
// 각 상태는 §3.4 의 필드를 빠짐없이 채운 순수 객체다. fight.k 는 fightConstants · 결과는 CatchRecord 모양 · 채비 값은 rigStats 와 맞춘다.
// import 는 core · data · 상태를 만드는 순수 함수(createNewProfile · createRigState · deriveClock · fightConstants · rigStats · computeModifiers)만(§2.1).

import { DT, STATE_VERSION, TICKS_PER_HOUR } from '../core/constants.js';
import { angleDiff, clamp, clamp01, fwd, piecewise, round1, round3, triangleWave, wrapAngle, yawOf } from '../core/math.js';
import { normalCdf, normalInv } from '../core/stats.js';
import { seedRng } from '../core/rng.js';
import { CAST, LAYER, SIGNAL, BITE } from '../data/bite.js';
import { FIGHT, HOOK } from '../data/fight.js';
import { STYLES, TRAITS } from '../data/fightStyles.js';
import { PRICE, XP } from '../data/economy.js';
import { WEATHER } from '../data/weather.js';
import { getSpecies } from '../data/species/index.js';
import { getSpot, getStage } from '../data/stages/index.js';
import { createNewProfile } from '../sim/progression/profile.js';
import { computeModifiers, rigStats } from '../sim/progression/modifiers.js';
import { createRigState } from '../sim/fishing/rig.js';
import { deriveClock } from '../sim/clock.js';
import { fightConstants } from '../sim/fight/fight.js';

/** @typedef {import('../types.js').GameState} GameState */
/** @typedef {import('../types.js').Profile} Profile */
/** @typedef {import('../types.js').FishRoll} FishRoll */
/** @typedef {import('../types.js').CatchRecord} CatchRecord */
/** @typedef {import('../types.js').FightState} FightState */
/** @typedef {import('../types.js').RigStats} RigStats */

export const FIXTURE_NAMES = [
  'walkLake', 'ready', 'charging', 'waiting', 'driftRiver', 'nibble', 'take',
  'fightRun', 'fightJump', 'fightStress', 'netReady', 'landing', 'result',
  'failedRodBreak', 'night', 'rain', 'shopL12',
];

const SEED = 20261002;
const FISH_PITCH = -0.15;

// ── 작은 순수 도우미(sim 내부 식의 사본 — 고정 상태를 계약 식대로 세우는 데만 쓴다)

/** §5.4.5 — pct 퍼센타일의 물고기 @returns {FishRoll} */
function rollAt(speciesId, pct) {
  const sp = getSpecies(speciesId);
  const z = clamp(normalInv(clamp(pct, 0.0005, 0.9995)), BITE.zMin, BITE.zMax);
  const { mu, sigma, a, b } = sp.size;
  const L = Math.exp(mu + sigma * z);
  const p = normalCdf(z);
  return {
    speciesId,
    z,
    pct: p,
    lengthCm: round1(L),
    weightKg: round3(a * Math.pow(L, b)),
    tier: p >= PRICE.legendPct ? 'legend' : p >= PRICE.trophyPct ? 'trophy' : 'normal',
  };
}

/** §5.4.1 */
function layerOf(set, waterDepth, floatDepth) {
  if (set === 'bottom') return { layer: 'bottom', baitDepth: waterDepth };
  const baitDepth = Math.min(floatDepth, waterDepth);
  if (waterDepth - baitDepth <= LAYER.bottomGapM) return { layer: 'bottom', baitDepth };
  if (baitDepth <= Math.max(LAYER.surfaceMaxM, LAYER.surfaceFrac * waterDepth)) return { layer: 'surface', baitDepth };
  return { layer: 'mid', baitDepth };
}

function xpToNextLevel(level) {
  return level >= XP.levelCap ? Infinity : Math.round(XP.base * Math.pow(level, XP.exp));
}
function xpBefore(level) {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += xpToNextLevel(l);
  return sum;
}

/** 어종 데이터의 단가 · 배율로 CatchRecord 를 만든다(첫 포획 · 신기록 보너스는 인자로) @returns {CatchRecord} */
function catchRecord({ uid, roll, firstCatch = false, recordWeight = false, stageId, spotId, day = 1, hour, set, fightSec }) {
  const sp = getSpecies(roll.speciesId);
  const base = Math.round(sp.xp * XP.tierMul[roll.tier]);
  const xpKeep = base + (firstCatch ? XP.firstBase + XP.firstPerXp * sp.xp : 0) + (recordWeight ? Math.round(XP.recordMul * sp.xp) : 0);
  return {
    uid,
    speciesId: roll.speciesId,
    lengthCm: roll.lengthCm,
    weightKg: roll.weightKg,
    pct: roll.pct,
    tier: roll.tier,
    price: Math.round(sp.pricePerKg * roll.weightKg * sp.priceMul[roll.tier]),
    xpKeep,
    xpRelease: Math.round(xpKeep * XP.releaseMul),
    firstCatch,
    recordWeight,
    stageId,
    spotId,
    day,
    hour,
    set,
    fightSec,
  };
}

/** 상태의 뼈대 — 씬의 spawn 에 걷기 모드 @returns {GameState} */
function baseState({ scene, hour, weather = 'clear', profile = createNewProfile(), day = 1 }) {
  const stage = getStage(scene);
  const tickInDay = Math.round(hour * TICKS_PER_HOUR);
  const clock = deriveClock(day, tickInDay, weather);
  const outdoor = stage.kind === 'outdoor';
  const w = WEATHER[weather];
  return /** @type {GameState} */ (/** @type {unknown} */ ({
    version: STATE_VERSION,
    seed: SEED,
    rng: seedRng(SEED),
    tick: 54000,
    scene,
    clock,
    weather: {
      today: { lake: weather, coast: weather, river: weather },
      tomorrow: { lake: 'clear', coast: 'cloudy', river: 'clear' },
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
      pos: { x: stage.spawn.x, z: stage.spawn.z },
      prevPos: { x: stage.spawn.x, z: stage.spawn.z },
      yaw: stage.spawn.yaw,
      pitch: 0,
      mode: 'walk',
      spotId: null,
      speed: 0,
      nearby: null,
    },
    rig: createRigState(profile),
    fight: null,
    pendingCatch: null,
    profile,
    session: { ignoreGates: true, devSession: true },
    debug: { forceBite: null, noBites: false },
    events: [],
  }));
}

/** syncRig(§6.5)와 같은 식으로 rig 의 파생 필드를 맞추고 RigStats 를 돌려준다 @returns {RigStats} */
function syncRigFields(state) {
  const r = state.rig;
  const p = state.profile;
  const rs = rigStats(p, r.set, computeModifiers(p));
  r.dragNotches = rs.dragNotches;
  r.dragNotch = clamp(p.sets[r.set].dragNotch, 0, r.dragNotches);
  r.dragKg = r.dragNotch * rs.dragNotchKg;
  r.floatDepth = p.sets.float.depthM;
  r.perfectFrom = 1 - rs.perfectWindow;
  return rs;
}

/** 낚시 자리에 세운다(§5.2 ready 의 판정 포함) */
function standAt(state, spotId, set, phase) {
  const spot = getSpot(spotId);
  const p = state.player;
  p.mode = 'fish';
  p.spotId = spotId;
  p.pos = { x: spot.stand.x, z: spot.stand.z };
  p.prevPos = { x: spot.stand.x, z: spot.stand.z };
  p.yaw = spot.facing;
  p.pitch = FISH_PITCH;
  p.nearby = null;
  const r = state.rig;
  r.set = set;
  r.phase = phase;
  r.phaseTime = 0;
  r.origin = { x: spot.stand.x, z: spot.stand.z };
  r.bobber = { x: spot.stand.x, z: spot.stand.z };
  r.prevBobber = { x: spot.stand.x, z: spot.stand.z };
  r.aimYaw = spot.facing;
  const rs = syncRigFields(state);
  const cfg = state.profile.sets[set];
  const baitOk = (state.profile.baits[cfg.bait] ?? 0) > 0;
  const lineOk = cfg.lineM >= CAST.minLineM;
  r.canCast = baitOk && lineOk;
  r.castBlock = !baitOk ? 'noBait' : !lineOk ? 'noLine' : null;
  return { spot, rs };
}

/** 착수 처리(§5.2 casting 끝)와 같은 값으로 채비를 물속에 둔다 */
function castTo(state, spot, dist, bearing) {
  const r = state.rig;
  const pos = { x: spot.stand.x + fwd(bearing).x * dist, z: spot.stand.z + fwd(bearing).z * dist };
  r.bobber = pos;
  r.prevBobber = { ...pos };
  r.dist = dist;
  r.bearing = bearing;
  r.aimYaw = clamp(bearing, spot.facing - spot.arc, spot.facing + spot.arc);
  r.castT = 1;
  r.waterDepth = piecewise(spot.depth, dist);
  const { layer, baitDepth } = layerOf(r.set, r.waterDepth, r.floatDepth);
  r.layer = /** @type {any} */ (layer);
  r.baitDepth = baitDepth;
  r.castBaitId = state.profile.sets[r.set].bait;
}

/** 행동 상태 이름 → kind(성격 표 · 특성의 addStates) */
function behaviorKind(species, name) {
  const st = STYLES[species.style].states[name];
  if (st) return st.kind;
  for (const t of species.traits) {
    const add = TRAITS[t] && TRAITS[t].addStates;
    if (add && add[name]) return add[name].kind;
  }
  return 'hold';
}

/**
 * 계약 §3.4 · §5.3 의 식으로 파이팅 상태를 세운다. 입력은 「장면을 정하는 값」, 나머지는 계산한다.
 * @returns {FightState}
 */
function makeFight(state, spot, rs, roll, o) {
  const sp = getSpecies(roll.speciesId);
  const k = fightConstants(sp, roll);
  const lineKg = rs.lineKg;
  const abrasion = o.abrasion ?? 0;
  const lineEffKg = lineKg * (1 - abrasion);
  const rodLift = o.rodLift ?? 0;
  const rodUp = rodLift >= 0.5;
  const tension = o.tension;
  const limitKg = rodUp ? Math.min(lineEffKg, rs.rodMaxLoadKg) : lineEffKg;
  const limitBy = rodUp && rs.rodMaxLoadKg < lineEffKg ? 'rod' : 'line';
  const rodLoadRatio = tension / rs.rodMaxLoadKg;
  const tensionRatio = tension / lineEffKg;
  const behavior = behaviorKind(sp, o.behaviorName);
  const stamina = o.stamina;
  const fat = FIGHT.fatigueFloor + (1 - FIGHT.fatigueFloor) * stamina;
  const bottom = piecewise(spot.depth, o.dist);
  const depth = o.depth ?? (behavior === 'dive' ? bottom
    : behavior === 'jump' ? 0
      : stamina < FIGHT.tiredStamina ? FIGHT.tiredDepth
        : FIGHT.midDepthFrac * bottom);
  const netRangeM = spot.edgeM + rs.netReachM;
  const slackKg = Math.min(HOOK.slackFracLine * lineKg, HOOK.slackFracFish * k.Fmax);
  const lineM = state.profile.sets[state.rig.set].lineM;
  const t = o.t;
  const ticks = Math.round(t / DT);
  const avg = o.avgTension ?? tension * 0.8;
  return {
    speciesId: roll.speciesId,
    roll,
    t,
    dist: o.dist,
    prevDist: o.prevDist ?? o.dist,
    minDist: spot.edgeM + FIGHT.minDistPad,
    bearing: o.bearing,
    prevBearing: o.bearing,
    halfArc: Math.min(FIGHT.maxArc, Math.max(spot.arc + FIGHT.bearingSlack, Math.abs(angleDiff(spot.facing, o.bearing)) + FIGHT.bearingSlack)),
    depth,
    airborne: o.airborne ?? 0,
    stamina,
    behavior: /** @type {any} */ (behavior),
    behaviorName: o.behaviorName,
    behaviorT: o.behaviorT,
    behaviorDur: o.behaviorDur,
    telegraph: o.telegraph ?? null,
    tension,
    tensionRatio,
    limitKg,
    limitBy,
    limitRatio: tension / limitKg,
    lineKg,
    lineEffKg,
    abrasion,
    inSnag: o.dist >= spot.snag.fromM && Math.abs(angleDiff(spot.facing, o.bearing)) <= spot.arc + FIGHT.snagArcPad,   // fight.js inSnagAt 의 사본(리뷰 수정 — 각도)
    inCover: o.inCover ?? 0,
    rodLift,
    rodUp,
    rodLoadRatio,
    rodStress: rodUp && rodLoadRatio >= FIGHT.rodStressAt,
    rodOverT: o.rodOverT ?? 0,
    lineDanger: tensionRatio >= FIGHT.lineDangerAt,
    slipping: !!o.slipping,
    slipSpeed: o.slipping ? o.slipSpeed ?? k.vmax * 0.5 * Math.sqrt(fat) : 0,
    reeling: !!o.reeling,
    gainSpeed: o.reeling ? o.gainSpeed ?? 0 : 0,
    slack: tension < slackKg,
    slackTime: o.slackTime ?? 0,
    spoolLeftM: lineM - o.dist,
    canNet: o.dist <= netRangeM && stamina <= rs.landStamina,
    netRangeM,
    netBuffer: 0,
    landStamina: rs.landStamina,
    showStamina: rs.showStamina,
    traits: [...sp.traits],
    k: { Fmax: k.Fmax, vmax: k.vmax, endurance: k.endurance },
    stats: {
      maxTension: o.maxTension ?? tension * 1.15,
      sumTension: avg * ticks,
      sumTension2: avg * avg * ticks * 1.1,
      ticks,
      runs: o.runs ?? 1,
      jumps: o.jumps ?? 0,
      slackTicks: o.slackTicks ?? 0,
      slipTicks: o.slipTicks ?? Math.round(ticks * 0.3),
    },
    brain: { state: o.behaviorName, lateralSign: 1, slipT: o.slipping ? 0.4 : 0, netRunUsed: false, preTeleLoose: 0, pending: null },
  };
}

/** 파이팅 단계로 세운다 — 플레이어는 물고기 쪽을 본다 */
function fightingAt(state, spotId, set, roll, o, phase = 'fighting') {
  const { spot, rs } = standAt(state, spotId, set, phase);
  const fight = makeFight(state, spot, rs, roll, o);
  const r = state.rig;
  r.phaseTime = phase === 'fighting' ? fight.t : r.phaseTime;
  r.castBaitId = state.profile.sets[set].bait;
  const pos = { x: spot.stand.x + fwd(fight.bearing).x * fight.dist, z: spot.stand.z + fwd(fight.bearing).z * fight.dist };
  r.bobber = pos;
  r.prevBobber = { ...pos };
  r.dist = fight.dist;
  r.bearing = fight.bearing;
  r.castT = 1;
  r.waterDepth = piecewise(spot.depth, fight.dist);
  const { layer, baitDepth } = layerOf(set, r.waterDepth, r.floatDepth);
  r.layer = /** @type {any} */ (layer);
  r.baitDepth = baitDepth;
  state.fight = fight;
  state.player.yaw = fight.bearing;
  return { spot, rs, fight };
}

/** 미끼를 쓴 만큼 · 캐스팅 수 */
function spendBait(profile, baitId, n) {
  profile.baits[baitId] = Math.max(0, (profile.baits[baitId] ?? 0) - n);
  profile.stats.casts += n;
}

// ── 고정 상태 17개

const BUILDERS = {
  /** 호수 · 08:00 맑음 · 걷기 · 판매상 앞(nearby npc) */
  walkLake() {
    const s = baseState({ scene: 'lake', hour: 8 });
    const vendor = getStage('lake').points.find(p => p.kind === 'npc');
    const p = s.player;
    p.pos = { ...vendor.approach };
    p.prevPos = { ...vendor.approach };
    p.yaw = wrapAngle(yawOf(vendor.x - vendor.approach.x, vendor.z - vendor.approach.z)) + 0;   // + 0: −0 을 0 으로(JSON 왕복)
    p.pitch = -0.05;
    p.nearby = { kind: 'npc', id: vendor.id, dist: Math.hypot(vendor.x - vendor.approach.x, vendor.z - vendor.approach.z) };
    syncRigFields(s);
    return s;
  },

  /** 호수 자갈 · 08:00 · 바닥 세트 ready */
  ready() {
    const s = baseState({ scene: 'lake', hour: 8 });
    standAt(s, 'lake_gravel', 'bottom', 'ready');
    s.rig.phaseTime = 2.0;
    return s;
  },

  /** 같은 자리 · charging · power 0.9(오르는 중) · aimPreview ≈ 28m(완벽 띠 근처) */
  charging() {
    const s = baseState({ scene: 'lake', hour: 8 });
    const { spot, rs } = standAt(s, 'lake_gravel', 'bottom', 'charging');
    const r = s.rig;
    r.phaseTime = 0.45 * CAST.gaugePeriod;
    r.power = triangleWave(r.phaseTime / CAST.gaugePeriod);
    const factor = r.power >= r.perfectFrom ? 1 : CAST.minFactor + CAST.slope * r.power;
    const lineM = s.profile.sets.bottom.lineM;
    const hi = Math.min(rs.castMaxM, lineM - CAST.lineReserveM);
    const lo = Math.min(spot.minCastM, hi);
    const distM = clamp(rs.castMaxM * factor, lo, hi);
    const aim = spot.facing + clamp(angleDiff(spot.facing, s.player.yaw), -spot.arc, spot.arc);
    r.aimYaw = aim;
    r.aimPreview = { x: spot.stand.x + fwd(aim).x * distM, z: spot.stand.z + fwd(aim).z * distM, distM };
    return s;
  },

  /** 같은 자리 · 찌 세트 waiting · 1단계 찌 로드 최대 비거리(24m) · 수심 2m */
  waiting() {
    const s = baseState({ scene: 'lake', hour: 8 });
    const { spot, rs } = standAt(s, 'lake_gravel', 'float', 'waiting');
    spendBait(s.profile, 'worm', 1);
    castTo(s, spot, rs.castMaxM, spot.facing);
    s.rig.phaseTime = 12;
    s.rig.canCast = false;
    s.rig.castBlock = null;
    return s;
  },

  /** 강 꼬리물 · 찌 세트 흘림 중(drifting · 70m · 베일 열림) */
  driftRiver() {
    const profile = createNewProfile();
    profile.level = 10;
    profile.skillPoints = 10;
    profile.xpTotal = xpBefore(10) + 120;
    profile.xp = 120;
    profile.baits.shrimp = 10;
    profile.sets.float.bait = 'shrimp';
    profile.sets.float.depthM = 4.0;
    const s = baseState({ scene: 'river', hour: 8, profile });
    const { spot } = standAt(s, 'river_tailrace', 'float', 'waiting');
    spendBait(profile, 'shrimp', 1);
    castTo(s, spot, 70, -0.25);
    const r = s.rig;
    r.phaseTime = 41;
    r.bailOpen = true;
    r.drifting = true;
    r.canCast = false;
    r.castBlock = null;
    const step = { x: spot.flow.x * DT, z: spot.flow.z * DT };
    r.prevBobber = { x: r.bobber.x - step.x, z: r.bobber.z - step.z };
    s.player.yaw = -0.25;
    return s;
  },

  /** 호수 자갈 찌 세트 · 예신 진행 중(붕어 — 바닥층 · 찌올림 본신 예정) */
  nibble() {
    const profile = createNewProfile();
    profile.sets.float.depthM = 4.5;
    const s = baseState({ scene: 'lake', hour: 6.5, profile });
    const { spot, rs } = standAt(s, 'lake_gravel', 'float', 'bite');
    spendBait(profile, 'worm', 1);
    castTo(s, spot, rs.castMaxM, spot.facing);
    const roll = rollAt('crucian', 0.55);
    const r = s.rig;
    r.phaseTime = 1.2;
    r.canCast = false;
    r.castBlock = null;
    r.signal = { kind: 'nibble', t: 0.1, strength: clamp01(1 - Math.pow(1 - SIGNAL.baseStrength, rs.signalMul > 0 ? rs.signalMul : 1)), takeStyle: 'lift', count: 2 };   // rig.js signalStrength 의 사본(리뷰 수정)
    r.hookWindow = { open: false, remaining: 0, total: 0 };
    r.bite = { speciesId: roll.speciesId, roll, nibblesLeft: 1, nextNibbleT: 0.7, touched: true };
    return s;
  },

  /** 호수 자갈 찌 세트 · 본신 첫 틱(큰입배스 — 중층 · 찌가 잠긴다) */
  take() {
    const s = baseState({ scene: 'lake', hour: 8 });
    const { spot, rs } = standAt(s, 'lake_gravel', 'float', 'bite');
    spendBait(s.profile, 'worm', 1);
    castTo(s, spot, rs.castMaxM, spot.facing);
    const roll = rollAt('largemouthBass', 0.6);
    const r = s.rig;
    r.phaseTime = 0.9;
    r.canCast = false;
    r.castBlock = null;
    r.signal = { kind: 'take', t: 0, strength: 1, takeStyle: 'sink', count: 1 };
    r.hookWindow = { open: true, remaining: rs.hookWindowS, total: rs.hookWindowS };
    r.bite = { speciesId: roll.speciesId, roll, nibblesLeft: 0, nextNibbleT: 0, touched: true };
    return s;
  },

  /** 잉어 트로피(≈7.3kg) · 질주 · 미끄러짐(slipping · 클리커) · 텐션 = 드랙 · 35m(장애물 띠 안) */
  fightRun() {
    const s = baseState({ scene: 'lake', hour: 18 });
    spendBait(s.profile, 'paste', 3);
    const roll = rollAt('carp', 0.9005);
    const sp = getSpecies('carp');
    const k = fightConstants(sp, roll);
    const stamina = 0.78;
    const fat = FIGHT.fatigueFloor + (1 - FIGHT.fatigueFloor) * stamina;
    const run = STYLES[sp.style].states.run;
    // 드랙(rig.dragKg)은 standAt 이 rigStats 로 맞춘 뒤에 정해진다 — 먼저 세우고 텐션을 드랙에 맞춘다
    standAt(s, 'lake_gravel', 'bottom', 'fighting');
    const drag = s.rig.dragKg;
    const raw = k.Fmax * run.f * fat;
    const slipSpeed = k.vmax * Math.max(run.sp, FIGHT.minSlipSp) * Math.sqrt(fat) * Math.min(1, Math.max(0, raw - drag) / (FIGHT.slipRef * k.Fmax));
    fightingAt(s, 'lake_gravel', 'bottom', roll, {
      dist: 35, prevDist: 35 - slipSpeed / 60, bearing: 0.12, stamina, tension: drag, abrasion: 0.04,
      behaviorName: 'run', behaviorT: 1.2, behaviorDur: 3.2, slipping: true, slipSpeed,
      t: 9.5, runs: 2, maxTension: drag * 1.3, avgTension: drag * 0.85, slipTicks: 240,
    });
    return s;
  },

  /** 큰입배스 · 점프 공중(airborne 0.8) · 로드 세움 */
  fightJump() {
    const s = baseState({ scene: 'lake', hour: 8 });
    spendBait(s.profile, 'worm', 2);
    const roll = rollAt('largemouthBass', 0.75);
    const dur = STYLES.jumper.states.jump.dur[0];
    const behaviorT = dur * Math.asin(0.8) / Math.PI;
    standAt(s, 'lake_gravel', 'float', 'fighting');
    const drag = s.rig.dragKg;
    fightingAt(s, 'lake_gravel', 'float', roll, {
      dist: 14, bearing: 0.2, stamina: 0.6, tension: drag, rodLift: 1,
      behaviorName: 'jump', behaviorT, behaviorDur: dur, airborne: Math.sin(Math.PI * behaviorT / dur),
      slipping: true, t: 11.2, runs: 2, jumps: 1, maxTension: drag * 1.25,
    });
    return s;
  },

  /** 잉어 · 펌핑 중 로드 상한 92%(rodStress · limitBy 'rod') · lineDanger */
  fightStress() {
    const profile = createNewProfile();
    profile.sets.bottom.dragNotch = 12;
    const s = baseState({ scene: 'lake', hour: 18, profile });
    spendBait(profile, 'paste', 4);
    const roll = rollAt('carp', 0.75);
    const { rs } = standAt(s, 'lake_gravel', 'bottom', 'fighting');
    const tension = 0.92 * rs.rodMaxLoadKg;
    // lineDanger(tension / lineEffKg ≥ FIGHT.lineDangerAt)가 켜질 만큼 쓸린 라인 — 1단계 라인 4kg · 로드 3.2kg 에서 abrasion 0.15
    const abrasion = Math.max(0.15, 1 - tension / (FIGHT.lineDangerAt * rs.lineKg) + 0.01);
    fightingAt(s, 'lake_gravel', 'bottom', roll, {
      dist: 18, bearing: -0.15, stamina: 0.55, tension, abrasion, rodLift: 0.9,
      behaviorName: 'hold', behaviorT: 1.6, behaviorDur: 4.1, reeling: true, gainSpeed: 0.35,
      t: 31.0, runs: 3, maxTension: tension * 1.04,
    });
    return s;
  },

  /** 붕어 · 거리 2.4m · canNet · 「Space 뜰채」 */
  netReady() {
    const s = baseState({ scene: 'lake', hour: 6.5 });
    spendBait(s.profile, 'paste', 2);
    const roll = rollAt('crucian', 0.6);
    fightingAt(s, 'lake_gravel', 'bottom', roll, {
      dist: 2.4, bearing: 0.05, stamina: 0.1, tension: 0.3,
      behaviorName: 'rest', behaviorT: 0.8, behaviorDur: 2.6, reeling: true, gainSpeed: 0.6,
      t: 16.4, runs: 1, maxTension: 0.9,
    });
    return s;
  },

  /** 붕어 · 뜰채 중(landing phaseTime 0.4) */
  landing() {
    const s = baseState({ scene: 'lake', hour: 6.5 });
    spendBait(s.profile, 'paste', 2);
    const roll = rollAt('crucian', 0.6);
    fightingAt(s, 'lake_gravel', 'bottom', roll, {
      dist: 2.3, bearing: 0.05, stamina: 0.08, tension: 0.25,
      behaviorName: 'rest', behaviorT: 1.4, behaviorDur: 2.6,
      t: 17.1, runs: 1, maxTension: 0.9,
    }, 'landing');
    s.rig.phaseTime = 0.4;
    return s;
  },

  /** 결과 단계 · 잉어 트로피 pendingCatch(첫 포획) · 어창 11/12 */
  result() {
    const profile = createNewProfile();
    profile.level = 3;
    profile.skillPoints = 3;
    profile.xpTotal = xpBefore(3) + 64;
    profile.xp = 64;
    const kept = [
      ['crucian', 0.42], ['crucian', 0.71], ['bluegill', 0.33], ['steedBarbel', 0.58], ['crucian', 0.2],
      ['catfish', 0.64], ['bullhead', 0.5], ['skygager', 0.47], ['bluegill', 0.81], ['israeliCarp', 0.36], ['steedBarbel', 0.12],
    ];
    const seen = new Set();
    kept.forEach(([id, pct], i) => {
      const roll = rollAt(id, pct);
      const first = !seen.has(id);
      seen.add(id);
      const rec = catchRecord({ uid: i + 1, roll, firstCatch: first, stageId: 'lake', spotId: 'lake_gravel', hour: 6.2 + i * 1.05, set: 'bottom', fightSec: 14 + i * 2 });
      profile.hold.push(rec);
      const d = profile.dex[id] || { count: 0, maxKg: 0, maxCm: 0, firstDay: 1, trophies: 0, legends: 0, best: 'normal' };
      d.count += 1;
      d.maxKg = Math.max(d.maxKg, rec.weightKg);
      d.maxCm = Math.max(d.maxCm, rec.lengthCm);
      profile.dex[id] = d;
    });
    profile.stats = { landed: 11, lost: 2, released: 0, sold: 0, earned: 0, casts: 0 };
    profile.nextUid = 12;
    spendBait(profile, 'paste', 15);
    const s = baseState({ scene: 'lake', hour: 18.3, profile });
    standAt(s, 'lake_gravel', 'bottom', 'result');
    const roll = rollAt('carp', 0.93);
    s.pendingCatch = catchRecord({ uid: 12, roll, firstCatch: true, stageId: 'lake', spotId: 'lake_gravel', hour: s.clock.hour, set: 'bottom', fightSec: 48.2 });
    s.rig.phaseTime = 0;
    s.rig.canCast = false;
    s.rig.castBlock = null;
    return s;
  },

  /** failed · 2단계 바닥 로드 파손 lastLoss(rodLost · dragKgAfter) */
  failedRodBreak() {
    const profile = createNewProfile();
    profile.level = 6;
    profile.skillPoints = 6;
    profile.xpTotal = xpBefore(6) + 210;
    profile.xp = 210;
    profile.money = 61200;
    profile.owned = {};   // 하나뿐이던 rod_bottom_2 를 잃었다
    profile.sets.bottom.rod = 'rod_bottom_1';
    const s = baseState({ scene: 'lake', hour: 17.5, profile });
    spendBait(profile, 'paste', 6);
    const { rs } = standAt(s, 'lake_gravel', 'bottom', 'failed');
    // 예비 로드로 바로 또 부러지지 않게: 0.9 × 새 rodMaxLoadKg 아래 가장 가까운 눈금(§5.6)
    const notch = Math.floor(0.9 * rs.rodMaxLoadKg / rs.dragNotchKg);
    profile.sets.bottom.dragNotch = notch;
    syncRigFields(s);
    const r = s.rig;
    r.phaseTime = 0.3;
    r.failReason = 'rodBreak';
    r.canCast = false;
    r.castBlock = null;
    r.lastLoss = {
      reason: 'rodBreak',
      set: 'bottom',
      baitId: 'paste',
      baitLost: true,
      tackleCost: 0,
      lineLostM: 0,
      rodLost: 'rod_bottom_2',
      spareSpool: false,
      dragKgAfter: r.dragKg,
      cause: null,
      hookSmall: false,
      moneyBefore: profile.money,
      moneyAfter: profile.money,
    };
    profile.stats.lost += 1;
    return s;
  },

  /** 호수 자갈 22:00 찌 세트 대기(헤드랜턴) */
  night() {
    const s = baseState({ scene: 'lake', hour: 22 });
    const { spot, rs } = standAt(s, 'lake_gravel', 'float', 'waiting');
    spendBait(s.profile, 'worm', 1);
    castTo(s, spot, rs.castMaxM, spot.facing);
    s.rig.phaseTime = 20;
    s.rig.canCast = false;
    s.rig.castBlock = null;
    return s;
  },

  /** 갯바위 조류 홈 18:30 비 · 찌 세트 대기 */
  rain() {
    const profile = createNewProfile();
    profile.level = 6;
    profile.skillPoints = 6;
    profile.xpTotal = xpBefore(6) + 90;
    profile.xp = 90;
    profile.baits.krill = 10;
    profile.sets.float.bait = 'krill';
    profile.sets.float.depthM = 3.0;
    const s = baseState({ scene: 'coast', hour: 18.5, weather: 'rain', profile });
    const { spot, rs } = standAt(s, 'coast_channel', 'float', 'waiting');
    spendBait(profile, 'krill', 1);
    castTo(s, spot, rs.castMaxM, spot.facing);
    s.rig.phaseTime = 8;
    s.rig.canCast = false;
    s.rig.castBlock = null;
    return s;
  },

  /** 집 · 레벨 12 · 돈 3,000,000 · 숙련 2 · 2단계 일부 보유(상점 전 · 후 비교) · PC 앞 */
  shopL12() {
    const profile = createNewProfile();
    profile.level = 12;
    profile.xpTotal = xpBefore(12) + 300;
    profile.xp = 300;
    profile.money = 3000000;
    Object.assign(profile.skills, { mastery: 2, hookset: 1, dragSense: 1, netting: 1, baitCraft: 1 });
    profile.skillPoints = 12 - 6;
    profile.owned = { rod_float_2: 1, reel_2: 1, float_2: 1 };
    profile.baits = { worm: 34, paste: 12, corn: 20, shrimp: 6, krill: 10, live: 5 };
    Object.assign(profile.sets.float, { rod: 'rod_float_2', reel: 'reel_2', float: 'float_2', lineId: 'line_2', lineM: 200, dragNotch: 6 });
    profile.sets.bottom.dragNotch = 6;
    const s = baseState({ scene: 'home', hour: 10, profile });
    const pc = getStage('home').points.find(p => p.kind === 'pc');
    const p = s.player;
    p.pos = { ...pc.approach };
    p.prevPos = { ...pc.approach };
    p.yaw = wrapAngle(yawOf(pc.x - pc.approach.x, pc.z - pc.approach.z)) + 0;   // + 0: −0 을 0 으로(JSON 왕복)
    p.pitch = -0.1;
    p.nearby = { kind: 'pc', id: pc.id, dist: Math.hypot(pc.x - pc.approach.x, pc.z - pc.approach.z) };
    syncRigFields(s);
    return s;
  },
};

/**
 * @param {string} name FIXTURE_NAMES 중 하나(없으면 throw)
 * @returns {GameState} 새 객체(부를 때마다 같은 값)
 */
export function makeFixtureState(name) {
  const build = BUILDERS[name];
  if (!build) throw new Error(`unknown fixture: ${name}`);
  return build();
}
