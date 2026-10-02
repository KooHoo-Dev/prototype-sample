// OWNER: P1 — 계약 §6.5 · §5.2 · §3.4(RigState)
// 채비 단계 기계 — 캐스팅 · 대기(흘림 · 봉돌 밀림) · 회수 · 입질 신호 · 챔질 창 · 파이팅 위임 · 랜딩 · 결과 · 실패.
// rig → fight 단방향(fightImpl 로만 부른다) · rig → world 는 placePlayer 만(§2.2).
// 지금 못 하는 입력은 다음 가능한 틱으로 미루거나(pendingSet · castBuffered · 챔질 선입력) RIG_BUSY 로 알린다 — 조용히 버리지 않는다.

import { EV } from '../../core/events.js';
import { DT } from '../../core/constants.js';
import { angleDiff, clamp, clamp01, fwdX, fwdZ, shoreZAt, triangleWave, yawOf } from '../../core/math.js';
import { BITE, CAST, RIG, SIGNAL } from '../../data/bite.js';
import { HOLD } from '../../data/economy.js';
import { WORLD } from '../../data/world.js';
import { SPOTS_BY_ID } from '../../data/stages/index.js';
import { SPECIES_BY_ID } from '../../data/species/index.js';
import { placePlayer } from '../world.js';
import { createFight, updateFight } from '../fight/fight.js';
import { applyLoss, grantFreeBaitIfNeeded } from '../progression/economy.js';
import { applyCatch, evaluateCatch } from '../progression/progress.js';
import { biteRate, biteWeights, depthAt, layerAt, pickSpecies } from './biteModel.js';
import { rollFish } from './catch.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').RigState} RigState */
/** @typedef {import('../../types.js').Profile} Profile */
/** @typedef {import('../../types.js').InputFrame} InputFrame */
/** @typedef {import('../../types.js').FishRoll} FishRoll */
/** @typedef {import('../../types.js').SetId} SetId */

/** rig 는 파이팅을 이 객체로만 부른다 — W1 테스트가 P2 를 기다리지 않고 바꿔 끼운다(P1 rig.test) */
export const fightImpl = { createFight, updateFight };

const EPS = RIG.timeEps;
/** exitFishing 이 되는 단계(§5.2) */
const EXITABLE = ['ready', 'charging', 'casting', 'waiting', 'retrieving', 'failed'];
/** 물속에 미끼가 있고 아무것도 물지 않은 단계 — 즉시 회수(미끼 환불)할 수 있다 */
const IN_WATER = ['casting', 'waiting', 'retrieving'];

// ── 생성 · 동기화

/**
 * phase 'idle' · set 'float' · 드랙 · 수심 필드는 profile.sets.float 에서.
 * @param {Profile} profile @returns {RigState}
 */
export function createRigState(profile) {
  const f = profile.sets.float;
  const dragNotches = 20;
  return {
    set: 'float',
    phase: 'idle',
    phaseTime: 0,
    origin: { x: 0, z: 0 },
    aimYaw: 0,
    power: 0,
    perfectFrom: 1,
    aimPreview: null,
    bobber: { x: 0, z: 0 },
    prevBobber: { x: 0, z: 0 },
    castT: 0,
    dist: 0,
    bearing: 0,
    waterDepth: 0,
    baitDepth: 0,
    layer: 'surface',
    floatDepth: f.depthM,
    bailOpen: false,
    drifting: false,
    bottomSlip: false,
    dragNotch: clamp(f.dragNotch, 0, dragNotches),
    dragNotches,
    dragKg: 0,
    castBaitId: null,
    pendingSet: null,
    signal: { kind: 'none', t: 0, strength: 0, takeStyle: 'sink', count: 0 },
    hookWindow: { open: false, remaining: 0, total: 0 },
    canCast: false,
    castBlock: null,
    failReason: null,
    lastLoss: null,
    castBuffered: false,
    bite: null,
  };
}

/** 재고는 profile 에서 직접 읽는다(§5.2) @param {SimCtx} ctx */
function updateCanCast(ctx) {
  const s = ctx.state;
  const r = s.rig;
  const cfg = s.profile.sets[r.set];
  const baitOk = (s.profile.baits[cfg.bait] ?? 0) > 0;
  const lineOk = cfg.lineM >= CAST.minLineM;
  r.canCast = baitOk && lineOk;
  r.castBlock = !baitOk ? 'noBait' : !lineOk ? 'noLine' : null;
}

/**
 * rig 파생 필드를 profile · rigStats 에 맞춘다(§6.5). ctx.refresh() 가 끝에서 부른다(§3.8).
 * dragNotches · dragNotch · dragKg · floatDepth(계약 네 줄) + perfectFrom · (낚시 모드면) canCast/castBlock — 패널에서 미끼를 사고 바꿔도 HUD 가 바로 맞는다.
 * @param {SimCtx} ctx
 */
export function syncRig(ctx) {
  const r = ctx.state.rig;
  const p = ctx.state.profile;
  r.dragNotches = ctx.rigStats.dragNotches;
  r.dragNotch = clamp(p.sets[r.set].dragNotch, 0, r.dragNotches);
  r.dragKg = r.dragNotch * ctx.rigStats.dragNotchKg;
  r.floatDepth = p.sets.float.depthM;
  r.perfectFrom = 1 - ctx.rigStats.perfectWindow;
  if (ctx.state.player.mode === 'fish' && r.phase !== 'idle') updateCanCast(ctx);   // 걷기 모드는 canCast false · castBlock null 그대로
}

// ── 작은 도구

/** @param {RigState} r @param {string} phase */
function setPhase(r, phase) {
  r.phase = /** @type {any} */ (phase);
  r.phaseTime = 0;
}

/** @param {RigState} r */
function clearSignal(r) {
  const g = r.signal;
  g.kind = 'none';
  g.t = 0;
  g.strength = 0;
  g.count = 0;
  const h = r.hookWindow;
  h.open = false;
  h.remaining = 0;
  h.total = 0;
  r.bite = null;
}

/** 찌/봉돌을 (dist, bearing) 에 놓는다(보간 끊기 — prevBobber 도) @param {SimCtx} ctx @param {number} dist @param {number} bearing */
function placeBobber(ctx, dist, bearing) {
  const r = ctx.state.rig;
  r.dist = dist;
  r.bearing = bearing;
  r.bobber.x = r.origin.x + fwdX(bearing) * dist;
  r.bobber.z = r.origin.z + fwdZ(bearing) * dist;
  r.prevBobber.x = r.bobber.x;
  r.prevBobber.z = r.bobber.z;
}

/** bobber 지점의 수심 · 미끼 수심 · 층 @param {SimCtx} ctx */
function recomputeWater(ctx) {
  const r = ctx.state.rig;
  r.waterDepth = ctx.spot ? depthAt(ctx.spot, r.dist) : 0;
  const l = layerAt(r.set, r.waterDepth, r.floatDepth);
  r.layer = l.layer;
  r.baitDepth = l.baitDepth;
}

/** @param {SimCtx} ctx */
function closeBail(ctx) {
  const r = ctx.state.rig;
  if (r.bailOpen) {
    r.bailOpen = false;
    ctx.emit(EV.BAIL_CHANGED, { open: false });
  }
}

/** ready 로(물속 미끼 없음 · 찌는 발밑) — 이벤트는 부르는 쪽이 낸다 @param {SimCtx} ctx */
function toReady(ctx) {
  const r = ctx.state.rig;
  setPhase(r, 'ready');
  r.castBaitId = null;
  r.power = 0;
  r.castT = 0;
  r.aimPreview = null;
  r.drifting = false;
  r.bottomSlip = false;
  r.failReason = null;
  clearSignal(r);
  closeBail(ctx);
  placeBobber(ctx, 0, r.aimYaw);
  updateCanCast(ctx);
}

/** 물속 미끼를 되돌리고 ready 로 — RETRIEVE_DONE{baitReturned} @param {SimCtx} ctx */
function retrieveNow(ctx) {
  const s = ctx.state;
  const r = s.rig;
  const bait = r.castBaitId;
  if (bait) s.profile.baits[bait] = (s.profile.baits[bait] ?? 0) + 1;
  toReady(ctx);
  ctx.emit(EV.RETRIEVE_DONE, { baitReturned: !!bait });
  ctx.refresh();
}

/** 세트 전환(ready 에서만 부른다) @param {SimCtx} ctx @param {SetId} set */
function switchSet(ctx, set) {
  const r = ctx.state.rig;
  r.pendingSet = null;
  if (r.set === set) return;
  r.set = set;
  ctx.emit(EV.SET_CHANGED, { set });
  ctx.refresh();
}

/**
 * 찌 수심을 바꾼다(단계 검사는 부르는 쪽). 대기 · 회수 중이면 물속 미끼의 층을 바로 다시 계산하고 minWait 를 다시 센다.
 * @param {SimCtx} ctx @param {number} depthM @returns {boolean} 바뀌었는가
 */
function changeDepth(ctx, depthM) {
  const s = ctx.state;
  const r = s.rig;
  const d = clamp(depthM, CAST.depthMinM, CAST.depthMaxM);
  if (d === s.profile.sets.float.depthM && d === r.floatDepth) return false;
  s.profile.sets.float.depthM = d;
  r.floatDepth = d;
  if (r.set === 'float' && (r.phase === 'waiting' || r.phase === 'retrieving')) {
    recomputeWater(ctx);
    r.phaseTime = 0;
  }
  ctx.emit(EV.DEPTH_CHANGED, { depthM: d });
  ctx.emit(EV.SAVE_REQUEST, { reason: 'tackle' });
  return true;
}

/** 조준 yaw = facing + clamp(angleDiff(facing, player.yaw), ±arc) @param {SimCtx} ctx */
function aimYawOf(ctx) {
  const spot = ctx.spot;
  const yaw = ctx.state.player.yaw;
  return spot.facing + clamp(angleDiff(spot.facing, Number.isFinite(yaw) ? yaw : spot.facing), -spot.arc, spot.arc);
}

/** §5.2 캐스팅 거리 @param {SimCtx} ctx @param {number} factor */
function castDistOf(ctx, factor) {
  const s = ctx.state;
  const rs = ctx.rigStats;
  const lineM = s.profile.sets[s.rig.set].lineM;
  const hi = Math.min(rs.castMaxM, lineM - CAST.lineReserveM);
  const lo = Math.min(ctx.spot.minCastM, hi);
  return clamp(rs.castMaxM * factor, lo, hi);
}

/** @param {RigState} r @param {number} power */
function factorOf(r, power) {
  return power >= r.perfectFrom ? 1 : CAST.minFactor + CAST.slope * power;
}

/** 착수 처리(§5.2 casting 끝) — bobber · 수심 · 층 → CAST_SPLASH → waiting @param {SimCtx} ctx */
function splash(ctx) {
  const r = ctx.state.rig;
  r.castT = 1;
  recomputeWater(ctx);
  r.drifting = false;
  r.bottomSlip = false;
  ctx.emit(EV.CAST_SPLASH, {
    x: r.bobber.x, z: r.bobber.z, distM: r.dist,
    waterDepthM: r.waterDepth, baitDepthM: r.baitDepth, layer: r.layer, set: r.set,
  });
  setPhase(r, 'waiting');
}

/** 디버그 착수: 지금 미끼를 물속에 두고(재고가 있으면 소모) castMaxM × frac 지점에 바로 내린다 @param {SimCtx} ctx @param {number} frac @param {boolean} consume */
function debugLand(ctx, frac, consume) {
  const s = ctx.state;
  const r = s.rig;
  if (!r.castBaitId) {
    const bait = s.profile.sets[r.set].bait;
    r.castBaitId = bait;
    if (consume && (s.profile.baits[bait] ?? 0) > 0) {
      s.profile.baits[bait] -= 1;
      s.profile.stats.casts += 1;
      ctx.refresh();
    }
  }
  const aim = aimYawOf(ctx);
  r.aimYaw = aim;
  r.aimPreview = null;
  r.power = 0;
  clearSignal(r);
  placeBobber(ctx, castDistOf(ctx, frac), aim);
  splash(ctx);
}

// ── 입질

/** 입질 시작 — 신호 타임라인을 미리 다 정한다(챔질 선입력이 본신까지 남은 시간을 알아야 한다 · §5.4.4) @param {SimCtx} ctx @param {string} speciesId @param {FishRoll} roll */
function startBite(ctx, speciesId, roll) {
  const r = ctx.state.rig;
  const rng = ctx.rng;
  const sp = SPECIES_BY_ID[speciesId];
  const times = [];
  let takeAt;
  let takeStyle;
  const first = rng.range(SIGNAL.firstDelay);
  if (r.set === 'float') {
    const n = rng.int(...((sp && sp.bite && sp.bite.nibbles) || SIGNAL.float.nibbles));
    let t = first;
    for (let i = 0; i < n; i++) {
      times.push(t);
      t += SIGNAL.float.nibbleDur + rng.range(SIGNAL.float.gap);
    }
    takeAt = t;
    takeStyle = (sp && sp.bite && sp.bite.take) || 'sink';
  } else {
    const tremble = rng.range(SIGNAL.bottom.tremble);
    takeAt = first + tremble;
    for (let t = first; t < takeAt - EPS; t += SIGNAL.bottom.pulse) times.push(t);
    takeStyle = 'pull';
  }
  r.bite = { speciesId, roll, nibbleTimes: times, nextNibble: 0, takeAt, takeStyle, touched: false, hookBuffered: false };
  clearSignalKeepBite(r);
  r.signal.takeStyle = /** @type {any} */ (takeStyle);
  r.drifting = false;
  r.bottomSlip = false;
  setPhase(r, 'bite');
}

/** @param {RigState} r */
function clearSignalKeepBite(r) {
  const b = r.bite;
  clearSignal(r);
  r.bite = b;
}

/** 챔질 성공 → HOOK_SET → createFight → fighting @param {SimCtx} ctx @param {string} speciesId @param {FishRoll} roll */
function hookFish(ctx, speciesId, roll) {
  const s = ctx.state;
  const r = s.rig;
  ctx.emit(EV.HOOK_SET, { weightKg: roll.weightKg, lengthCm: roll.lengthCm });
  clearSignal(r);
  r.drifting = false;
  r.bottomSlip = false;
  s.fight = fightImpl.createFight(ctx, { speciesId, roll, dist: r.dist, bearing: r.bearing, depth: r.baitDepth });
  setPhase(r, 'fighting');
}

/** bite 단계 한 틱(§5.4.4 · §5.5) @param {SimCtx} ctx @param {InputFrame} input */
function updateBite(ctx, input) {
  const r = ctx.state.rig;
  const b = r.bite;
  if (!b) { toReady(ctx); return; }
  const g = r.signal;
  const t = r.phaseTime;
  if (g.kind !== 'none') g.t += DT;
  if (g.kind !== 'take') {
    while (b.nextNibble < b.nibbleTimes.length && t >= b.nibbleTimes[b.nextNibble] - EPS) {
      const index = b.nextNibble;
      b.nextNibble++;
      b.touched = true;
      g.kind = 'nibble';
      g.t = 0;
      g.strength = clamp01(SIGNAL.baseStrength * ctx.rigStats.signalMul);
      g.count = index + 1;
      ctx.emit(EV.BITE_NIBBLE, { set: r.set, strength: g.strength, index });
    }
    if (t >= b.takeAt - EPS) {
      const win = ctx.rigStats.hookWindowS + (b.takeStyle === 'lift' ? SIGNAL.float.liftWindowAdd : 0);
      b.touched = true;
      g.kind = 'take';
      g.t = 0;
      g.strength = 1;
      g.takeStyle = b.takeStyle;
      r.hookWindow.open = true;
      r.hookWindow.remaining = win;
      r.hookWindow.total = win;
      ctx.emit(EV.BITE_TAKE, { set: r.set, style: b.takeStyle, window: win });
    } else if (r.set === 'float' && g.kind === 'nibble' && g.t >= SIGNAL.float.nibbleDur - EPS) {
      g.kind = 'none';      // 찌 예신 한 번 = nibbleDur 초 잠김. 바닥 초리 떨림은 본신까지 이어진다
    }
  }
  if (g.kind === 'take') {
    // 창 판정은 remaining 을 깎기 전에 본다 — 첫 틱 · 마지막 틱 모두 성공
    if ((input.hook || b.hookBuffered) && r.hookWindow.remaining > EPS) {
      hookFish(ctx, b.speciesId, b.roll);
      return;
    }
    r.hookWindow.remaining -= DT;
    if (r.hookWindow.remaining <= EPS) {
      r.hookWindow.remaining = 0;
      fail(ctx, 'late');
    }
    return;
  }
  if (input.hook && !b.hookBuffered) {
    if (b.takeAt - t <= SIGNAL.earlyGrace + EPS) b.hookBuffered = true;   // 선입력 — 본신 첫 틱에 성공
    else if (b.touched) fail(ctx, 'early');                              // 예신 중 이른 챔질
    // 신호가 아직 하나도 없으면(첫 예신 전) 헛챔질이 아니다 — 대기 중 Space 와 같다
  }
}

// ── 실패 · 결과

/**
 * §5.2 3 실패 처리(헛챔질 · 늦음 · 파이팅 실패 공통)
 * @param {SimCtx} ctx @param {import('../../types.js').FailReason} reason
 * @param {{lineLostM?:number, cause?:import('../../types.js').LossCause, hookSmall?:boolean}} [o]
 */
function fail(ctx, reason, o = {}) {
  const s = ctx.state;
  const r = s.rig;
  const set = r.set;
  const loss = applyLoss(ctx, set, reason, {
    lineLostM: o.lineLostM ?? 0,
    baitId: r.castBaitId ?? s.profile.sets[set].bait,
    cause: o.cause ?? null,
    hookSmall: !!o.hookSmall,
  });
  s.fight = null;
  r.failReason = reason;
  r.lastLoss = loss;
  r.castBaitId = null;
  r.drifting = false;
  r.bottomSlip = false;
  r.castBuffered = false;
  r.aimPreview = null;
  clearSignal(r);
  placeBobber(ctx, 0, r.aimYaw);
  closeBail(ctx);
  if (reason === 'early' || reason === 'late') ctx.emit(EV.HOOK_MISS, { reason, baitKept: !loss.baitLost });
  ctx.emit(EV.FAIL, { reason, loss });
  ctx.emit(EV.SAVE_REQUEST, { reason: 'loss' });
  setPhase(r, 'failed');
}

/** 결과 → ready @param {SimCtx} ctx */
function finishResult(ctx) {
  ctx.state.pendingCatch = null;
  toReady(ctx);
  ctx.refresh();
}

/** @param {SimCtx} ctx */
function holdFull(ctx) {
  return ctx.state.profile.hold.length >= HOLD.capacity;
}

// ── 단계별

/** @param {SimCtx} ctx */
function startCharge(ctx) {
  const r = ctx.state.rig;
  if (!r.canCast) {
    grantFreeBaitIfNeeded(ctx);
    updateCanCast(ctx);
  }
  if (!r.canCast) {
    ctx.emit(EV.CAST_BLOCKED, { reason: r.castBlock });
    return;
  }
  setPhase(r, 'charging');
  r.power = 0;
  r.perfectFrom = 1 - ctx.rigStats.perfectWindow;
  updateAimPreview(ctx);
  ctx.emit(EV.CAST_START, { set: r.set });
}

/** charging 중 「지금 놓으면 떨어질 점」 — 객체를 다시 쓴다 @param {SimCtx} ctx */
function updateAimPreview(ctx) {
  const r = ctx.state.rig;
  const aim = aimYawOf(ctx);
  const d = castDistOf(ctx, factorOf(r, r.power));
  const p = r.aimPreview || (r.aimPreview = { x: 0, z: 0, distM: 0 });
  p.x = r.origin.x + fwdX(aim) * d;
  p.z = r.origin.z + fwdZ(aim) * d;
  p.distM = d;
}

/** @param {SimCtx} ctx @param {InputFrame} input @param {boolean} entry failed → ready 로 들어온 틱 */
function updateReady(ctx, input, entry) {
  const r = ctx.state.rig;
  if (r.pendingSet) switchSet(ctx, r.pendingSet);
  updateCanCast(ctx);
  const press = input.primaryPressed || (entry && r.castBuffered && input.primary);
  r.castBuffered = false;
  if (press) startCharge(ctx);
}

/** @param {SimCtx} ctx @param {InputFrame} input */
function updateCharging(ctx, input) {
  const s = ctx.state;
  const r = s.rig;
  r.power = triangleWave(r.phaseTime / CAST.gaugePeriod);
  r.perfectFrom = 1 - ctx.rigStats.perfectWindow;
  updateAimPreview(ctx);
  if (!(input.primaryReleased || !input.primary)) return;
  // 놓았다 — 캐스팅. 충전 중 미끼를 바꿨을 수 있으니 재고를 다시 본다
  updateCanCast(ctx);
  if (!r.canCast) {
    setPhase(r, 'ready');
    r.power = 0;
    r.aimPreview = null;
    ctx.emit(EV.CAST_BLOCKED, { reason: r.castBlock });
    return;
  }
  const power = r.power;
  const perfect = power >= r.perfectFrom;
  const bait = s.profile.sets[r.set].bait;
  r.castBaitId = bait;
  s.profile.baits[bait] -= 1;
  s.profile.stats.casts += 1;
  ctx.refresh();
  const distM = castDistOf(ctx, factorOf(r, power));
  const aimYaw = aimYawOf(ctx);
  r.aimYaw = aimYaw;
  r.aimPreview = null;
  r.castT = 0;
  placeBobber(ctx, distM, aimYaw);
  setPhase(r, 'casting');
  ctx.emit(EV.CAST_RELEASE, { power, perfect, distM, aimYaw });
}

/** @param {SimCtx} ctx */
function updateCasting(ctx) {
  const r = ctx.state.rig;
  const flight = CAST.flightBase + r.dist * CAST.flightPerM;
  r.castT = Math.min(1, r.phaseTime / flight);
  if (r.phaseTime >= flight - EPS) splash(ctx);
}

/**
 * 흘림 · 봉돌 밀림(§5.2 waiting) — 후보가 경계 넷을 모두 만족할 때만 움직인다.
 * @param {SimCtx} ctx
 */
function updateDrift(ctx) {
  const s = ctx.state;
  const r = s.rig;
  const spot = ctx.spot;
  const rs = ctx.rigStats;
  const fx = spot.flow.x;
  const fz = spot.flow.z;
  const fl = Math.hypot(fx, fz);
  let nx = 0;
  let nz = 0;
  let kind = 0;           // 1 흘림 · 2 봉돌 밀림
  if (r.set === 'float' && r.bailOpen && fl >= BITE.driftMinFlow) {
    const k = rs.floatDriftMul * DT;
    nx = r.bobber.x + fx * k;
    nz = r.bobber.z + fz * k;
    kind = 1;
  } else if (r.set === 'bottom' && fl > rs.sinkerHoldMS) {
    const k = (fl - rs.sinkerHoldMS) * BITE.bottomSlipSpeed * DT / fl;
    nx = r.bobber.x + fx * k;
    nz = r.bobber.z + fz * k;
    kind = 2;
  }
  if (!kind) {
    r.drifting = false;
    r.bottomSlip = false;
    return;
  }
  const dx = nx - r.origin.x;
  const dz = nz - r.origin.z;
  const d = Math.hypot(dx, dz);
  const lineM = s.profile.sets[r.set].lineM;
  const ok = Math.abs(angleDiff(spot.facing, yawOf(dx, dz))) <= CAST.driftArc
    && d >= spot.minCastM
    && nz < shoreZAt(ctx.stage.shore, nx) - CAST.shoreMarginM
    && (kind !== 1 || d <= Math.min(spot.maxDriftM, lineM - CAST.driftReserveM));
  if (!ok) {
    r.drifting = false;
    r.bottomSlip = false;
    return;
  }
  r.bobber.x = nx;
  r.bobber.z = nz;
  r.dist = d;
  r.bearing = yawOf(dx, dz);
  r.drifting = kind === 1;
  r.bottomSlip = kind === 2;
  recomputeWater(ctx);
}

// 입질 가중치 캐시 — 같은 조건이면 매 틱 배열을 다시 만들지 않는다(파생 값 · 상태 밖 · 결정성 무관)
const wCache = { spot: null, band: '', weather: '', layer: '', bait: '', hook: 0, lineMul: 0, far: false, w: null };

/** @param {SimCtx} ctx */
function currentWeights(ctx) {
  const s = ctx.state;
  const r = s.rig;
  const spot = ctx.spot;
  const rs = ctx.rigStats;
  const far = spot.farFromM != null && r.dist >= spot.farFromM;
  const c = wCache;
  if (c.w && c.spot === spot && c.band === s.clock.band && c.weather === s.weather.current && c.layer === r.layer
    && c.bait === r.castBaitId && c.hook === rs.hookSize && c.lineMul === rs.lineBiteMul && c.far === far) return c.w;
  c.w = biteWeights({ spot, band: s.clock.band, weather: s.weather.current, layer: r.layer, baitId: r.castBaitId, rigStats: rs, distM: r.dist });
  c.spot = spot; c.band = s.clock.band; c.weather = s.weather.current; c.layer = r.layer;
  c.bait = r.castBaitId; c.hook = rs.hookSize; c.lineMul = rs.lineBiteMul; c.far = far;
  return c.w;
}

/** @param {SimCtx} ctx @param {InputFrame} input */
function updateWaiting(ctx, input) {
  const s = ctx.state;
  const r = s.rig;
  updateDrift(ctx);
  if (input.primary) {
    r.phase = 'retrieving';          // phaseTime 은 이어서 센다 — 회수를 멈추고 다시 기다려도 minWait 를 다시 세지 않는다
    r.drifting = false;
    r.bottomSlip = false;
    return;
  }
  const fb = s.debug && s.debug.forceBite;
  if (fb) {
    s.debug.forceBite = null;
    const sp = SPECIES_BY_ID[fb.speciesId];
    if (sp) { startBite(ctx, sp.id, rollFish(ctx.rng, sp, fb.pct)); return; }
  }
  if (s.debug && s.debug.noBites) return;
  if (r.phaseTime < BITE.minWait - EPS) return;
  const w = currentWeights(ctx);
  const rate = biteRate(w, { weather: s.weather.current, rigStats: ctx.rigStats, drifting: r.drifting, bottomSlip: r.bottomSlip });
  if (!(rate > 0)) return;
  if (!ctx.rng.chance(1 - Math.exp(-rate * DT))) return;
  const id = pickSpecies(ctx.rng, w, r.castBaitId);
  if (!id) return;
  startBite(ctx, id, rollFish(ctx.rng, SPECIES_BY_ID[id]));
}

/** @param {SimCtx} ctx @param {InputFrame} input */
function updateRetrieving(ctx, input) {
  const r = ctx.state.rig;
  if (!input.primary) {
    r.phase = 'waiting';             // phaseTime 을 이어 센다(§5.2 — minWait 를 다시 세지 않는다)
    return;
  }
  const d = r.dist - ctx.rigStats.reelSpeedMS * CAST.emptyRetrieveMul * DT;
  if (d <= CAST.retrieveDoneM) {
    retrieveNow(ctx);
    return;
  }
  r.dist = d;
  r.bobber.x = r.origin.x + fwdX(r.bearing) * d;
  r.bobber.z = r.origin.z + fwdZ(r.bearing) * d;
  recomputeWater(ctx);
}

/** @param {SimCtx} ctx @param {InputFrame} input */
function updateFighting(ctx, input) {
  const s = ctx.state;
  if (!s.fight) { toReady(ctx); return; }
  const out = fightImpl.updateFight(ctx, input);
  if (!out) return;
  if (out.type === 'net') {
    setPhase(s.rig, 'landing');
    return;
  }
  fail(ctx, out.type, { lineLostM: out.lineLostM, cause: out.cause ?? null, hookSmall: out.hookSmall });
}

/** @param {SimCtx} ctx */
function updateLanding(ctx) {
  const s = ctx.state;
  const r = s.rig;
  if (!s.fight) { toReady(ctx); return; }
  if (r.phaseTime < RIG.netTime - EPS) return;
  enterResult(ctx, evaluateCatch(ctx, s.fight.roll, s.fight.t));
}

/** @param {SimCtx} ctx @param {import('../../types.js').CatchRecord} record */
function enterResult(ctx, record) {
  const s = ctx.state;
  const r = s.rig;
  s.pendingCatch = record;
  s.fight = null;
  r.castBaitId = null;
  r.drifting = false;
  r.bottomSlip = false;
  clearSignal(r);
  setPhase(r, 'result');
  ctx.emit(EV.CATCH_RESULT, { catch: record, holdFull: holdFull(ctx) });
}

/** @param {SimCtx} ctx @param {InputFrame} input */
function updateFailed(ctx, input) {
  const s = ctx.state;
  const r = s.rig;
  if (input.primaryPressed) r.castBuffered = true;
  if (r.phaseTime < RIG.failNotice - EPS) return;
  const loss = r.lastLoss;
  const buffered = r.castBuffered;
  toReady(ctx);
  r.castBuffered = buffered;
  const cfg = s.profile.sets[r.set];
  ctx.emit(EV.RIG_RESTORED, {
    set: r.set,
    rodReplaced: !!(loss && loss.rodLost),
    spoolReplaced: !!(loss && loss.spareSpool),
    baitLeft: s.profile.baits[cfg.bait] ?? 0,
    lineM: cfg.lineM,
    dragKg: r.dragKg,
  });
  updateReady(ctx, input, true);      // 같은 틱에 ready 를 한 번 더 — 버퍼된 충전을 시작한다
}

// ── 설정 입력(§5.2 1)

/** @param {SimCtx} ctx @param {InputFrame} input */
function handleSettings(ctx, input) {
  const s = ctx.state;
  const r = s.rig;
  const want = input.selectSet;
  if (want === 'float' || want === 'bottom') {
    if (want !== r.set) {
      switch (r.phase) {
        case 'ready': switchSet(ctx, want); break;
        case 'charging':
          setPhase(r, 'ready');
          r.power = 0;
          r.aimPreview = null;
          switchSet(ctx, want);
          break;
        case 'casting': case 'waiting': case 'retrieving':
          retrieveNow(ctx);
          switchSet(ctx, want);
          break;
        case 'failed': case 'landing': r.pendingSet = want; break;
        default: ctx.emit(EV.RIG_BUSY, { action: 'set' });
      }
    } else if (r.pendingSet) {
      r.pendingSet = null;           // 미뤄 둔 전환을 지금 세트로 되돌렸다
    }
  }
  if (input.depthSteps && r.set === 'float') {
    switch (r.phase) {
      case 'bite': case 'fighting': case 'landing': case 'result':
        ctx.emit(EV.RIG_BUSY, { action: 'depth' });
        break;
      default:
        changeDepth(ctx, r.floatDepth + Math.trunc(input.depthSteps) * CAST.depthStepM);
    }
  }
  if (input.dragSteps) {
    const cfg = s.profile.sets[r.set];
    cfg.dragNotch = clamp(Math.round(cfg.dragNotch + input.dragSteps), 0, ctx.rigStats.dragNotches);
    syncRig(ctx);
    const lineKg = ctx.rigStats.lineKg;
    ctx.emit(EV.DRAG_CHANGED, { notch: r.dragNotch, notches: r.dragNotches, kg: r.dragKg, ratio: lineKg > 0 ? r.dragKg / lineKg : 0 });
  }
  if (input.bail && (r.phase === 'waiting' || r.phase === 'fighting')) {
    r.bailOpen = !r.bailOpen;
    if (!r.bailOpen) r.drifting = false;
    ctx.emit(EV.BAIL_CHANGED, { open: r.bailOpen });
  }
}

// ── 공개 API

/**
 * 걷기 → 낚시: ctx.spot · placePlayer(PLAYER_PLACED{spot}) · ready · FISHING_ENTER.
 * 이미 다른 자리에서 낚시 중이면(나갈 수 있는 단계일 때) 먼저 일어난다.
 * @param {SimCtx} ctx @param {string} spotId @returns {{ok:boolean, reason?:string}}
 */
export function enterSpot(ctx, spotId) {
  const s = ctx.state;
  const spot = SPOTS_BY_ID[spotId];
  if (!spot) return { ok: false, reason: 'invalid' };
  if (s.player.mode === 'fish') {
    if (!EXITABLE.includes(s.rig.phase) && s.rig.phase !== 'idle') return { ok: false, reason: 'busy' };
    exitSpot(ctx);
  }
  ctx.spot = spot;
  s.player.mode = 'fish';
  s.player.spotId = spotId;
  s.player.nearby = null;
  placePlayer(ctx, spot.stand, spot.facing, s.player.pitch, 'spot');
  const r = s.rig;
  if (r.pendingSet) { r.set = r.pendingSet; r.pendingSet = null; }
  r.origin = { x: spot.stand.x, z: spot.stand.z };
  r.aimYaw = spot.facing;
  r.lastLoss = null;
  r.castBuffered = false;
  toReady(ctx);
  ctx.refresh();
  ctx.emit(EV.FISHING_ENTER, { spotId, set: r.set });
  return { ok: true };
}

/**
 * §5.2 exitFishing — ready · charging · casting · waiting · retrieving · failed 에서만.
 * 물속 미끼는 즉시 회수(환불) → idle · 걷기 · FISHING_EXIT · PLAYER_PLACED{exitSpot}(자리에서 facing 반대로 WORLD.exitStepBack).
 * @param {SimCtx} ctx @returns {{ok:boolean, reason?:string}}
 */
export function exitSpot(ctx) {
  const s = ctx.state;
  const r = s.rig;
  if (s.player.mode !== 'fish') return { ok: false, reason: 'notHere' };
  if (!EXITABLE.includes(r.phase) && r.phase !== 'idle') return { ok: false, reason: 'busy' };
  if (IN_WATER.includes(r.phase)) retrieveNow(ctx);
  if (r.pendingSet) {
    const want = r.pendingSet;
    r.pendingSet = null;
    if (want !== r.set) {
      r.set = want;
      ctx.emit(EV.SET_CHANGED, { set: want });
    }
  }
  const spot = ctx.spot || (s.player.spotId ? SPOTS_BY_ID[s.player.spotId] : null);
  const spotId = s.player.spotId;
  r.castBuffered = false;
  toReady(ctx);
  setPhase(r, 'idle');
  r.canCast = false;
  r.castBlock = null;
  s.fight = null;
  s.player.mode = 'walk';
  s.player.spotId = null;
  ctx.spot = null;
  ctx.refresh();
  ctx.emit(EV.FISHING_EXIT, { spotId });
  if (spot) {
    const back = { x: spot.stand.x - fwdX(spot.facing) * WORLD.exitStepBack, z: spot.stand.z - fwdZ(spot.facing) * WORLD.exitStepBack };
    placePlayer(ctx, back, spot.facing, s.player.pitch, 'exitSpot');
    r.origin = { x: back.x, z: back.z };
    placeBobber(ctx, 0, r.aimYaw);
  }
  return { ok: true };
}

/**
 * §5.2 채비 단계 기계 — 낚시 모드에서 GameSim.step 이 매 틱 부른다.
 * @param {SimCtx} ctx @param {InputFrame} input
 */
export function updateRig(ctx, input) {
  const s = ctx.state;
  const r = s.rig;
  if (s.player.mode !== 'fish' || !ctx.spot || r.phase === 'idle' || r.phase === 'result') return;
  handleSettings(ctx, input);
  r.phaseTime += DT;
  switch (r.phase) {
    case 'ready': updateReady(ctx, input, false); break;
    case 'charging': updateCharging(ctx, input); break;
    case 'casting': updateCasting(ctx); break;
    case 'waiting': updateWaiting(ctx, input); break;
    case 'retrieving': updateRetrieving(ctx, input); break;
    case 'bite': updateBite(ctx, input); break;
    case 'fighting': updateFighting(ctx, input); break;
    case 'landing': updateLanding(ctx); break;
    case 'failed': updateFailed(ctx, input); break;
    default: break;
  }
}

/**
 * 결과 → 어창. 어창이 차 있으면 opts.swapUid(어창 물고기 uid)가 있어야 한다 — 그것을 빼고(CATCH_RELEASED{swapped:true}) 새 것을 넣는다.
 * applyCatch(P4) · CATCH_KEPT · SAVE_REQUEST{catch} · ready.
 * @param {SimCtx} ctx @param {{swapUid?:number}} [opts] @returns {{ok:boolean, reason?:string, xp?:number}}
 */
export function keepCatch(ctx, opts = {}) {
  const s = ctx.state;
  const rec = s.pendingCatch;
  if (s.rig.phase !== 'result' || !rec) return { ok: false, reason: 'notHere' };
  let removed = null;
  if (holdFull(ctx)) {
    const uid = opts && opts.swapUid;
    if (uid === undefined || uid === null) return { ok: false, reason: 'holdFull' };
    removed = s.profile.hold.find(c => c.uid === uid) || null;
    if (!removed) return { ok: false, reason: 'invalid' };
  }
  const res = applyCatch(ctx, rec, true, removed ? { swapUid: removed.uid } : {});
  if (!res || res.ok === false) return res || { ok: false, reason: 'invalid' };
  if (removed) ctx.emit(EV.CATCH_RELEASED, { catch: removed, swapped: true });
  ctx.emit(EV.CATCH_KEPT, { catch: rec });
  ctx.emit(EV.SAVE_REQUEST, { reason: 'catch' });
  finishResult(ctx);
  return { ok: true, xp: res.xp ?? 0 };
}

/**
 * 결과 → 방생. applyCatch(P4) · CATCH_RELEASED{swapped:false} · SAVE_REQUEST{catch} · ready.
 * @param {SimCtx} ctx @returns {{ok:boolean, reason?:string, xp?:number}}
 */
export function releaseCatch(ctx) {
  const s = ctx.state;
  const rec = s.pendingCatch;
  if (s.rig.phase !== 'result' || !rec) return { ok: false, reason: 'notHere' };
  const res = applyCatch(ctx, rec, false);
  if (!res || res.ok === false) return res || { ok: false, reason: 'invalid' };
  ctx.emit(EV.CATCH_RELEASED, { catch: rec, swapped: false });
  ctx.emit(EV.SAVE_REQUEST, { reason: 'catch' });
  finishResult(ctx);
  return { ok: true, xp: res.xp ?? 0 };
}

/**
 * 찌 수심 설정(§5.2 depthSteps 와 같은 단계 규칙) — bite · fighting · landing · result 면 {reason:'busy'}.
 * @param {SimCtx} ctx @param {number} depthM @returns {{ok:boolean, reason?:string, depthM?:number}}
 */
export function setFloatDepth(ctx, depthM) {
  const r = ctx.state.rig;
  if (typeof depthM !== 'number' || !Number.isFinite(depthM)) return { ok: false, reason: 'invalid' };
  if (r.phase === 'bite' || r.phase === 'fighting' || r.phase === 'landing' || r.phase === 'result') return { ok: false, reason: 'busy' };
  changeDepth(ctx, depthM);
  return { ok: true, depthM: r.floatDepth };
}

/**
 * 디버그: ready(· charging)면 즉시 착수(castMaxM × RIG.debugBiteCastFrac) → bite / casting 이면 착수 → bite / waiting · retrieving 이면 바로 bite.
 * @param {SimCtx} ctx @param {string} speciesId @param {number} pct
 */
export function forceBite(ctx, speciesId, pct) {
  const s = ctx.state;
  const r = s.rig;
  const sp = SPECIES_BY_ID[speciesId];
  if (!sp) return { ok: false, reason: 'invalid' };
  if (s.player.mode !== 'fish' || !ctx.spot) return { ok: false, reason: 'notHere' };
  switch (r.phase) {
    case 'ready': case 'charging': debugLand(ctx, RIG.debugBiteCastFrac, true); break;
    case 'casting': placeBobber(ctx, r.dist, r.bearing); splash(ctx); break;
    case 'waiting': case 'retrieving': break;
    default: return { ok: false, reason: 'busy' };
  }
  startBite(ctx, sp.id, rollFish(ctx.rng, sp, pct));
  return { ok: true };
}

/**
 * 디버그: 입질 · 챔질을 건너뛰고 fighting(§6.3 debugForceFight) — castMaxM × RIG.debugFightCastFrac 착수 · castBaitId = 지금 미끼.
 * @param {SimCtx} ctx @param {string} speciesId @param {number} pct
 */
export function forceFight(ctx, speciesId, pct) {
  const s = ctx.state;
  const r = s.rig;
  const sp = SPECIES_BY_ID[speciesId];
  if (!sp) return { ok: false, reason: 'invalid' };
  if (s.player.mode !== 'fish' || !ctx.spot) return { ok: false, reason: 'notHere' };
  if (r.phase === 'fighting' || r.phase === 'landing' || r.phase === 'result' || r.phase === 'idle') return { ok: false, reason: 'busy' };
  debugLand(ctx, RIG.debugFightCastFrac, false);
  hookFish(ctx, sp.id, rollFish(ctx.rng, sp, pct));
  return { ok: true };
}

/**
 * 디버그: result 로(pendingCatch 생성 · CATCH_RESULT). 낚시 모드가 아니면 GameSim 이 먼저 자리에 세운다(§6.3).
 * @param {SimCtx} ctx @param {string} speciesId @param {number} pct
 */
export function skipToResult(ctx, speciesId, pct) {
  const s = ctx.state;
  const r = s.rig;
  const sp = SPECIES_BY_ID[speciesId];
  if (!sp) return { ok: false, reason: 'invalid' };
  if (s.player.mode !== 'fish' || !ctx.spot) return { ok: false, reason: 'notHere' };
  if (r.phase === 'result') return { ok: false, reason: 'busy' };
  closeBail(ctx);
  placeBobber(ctx, 0, r.aimYaw);
  enterResult(ctx, evaluateCatch(ctx, rollFish(ctx.rng, sp, pct), 0));
  return { ok: true };
}
