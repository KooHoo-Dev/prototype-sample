// OWNER: P2 — 계약 §6.6 · §5.3
// 파이팅 모델: 1차원 거리 + 텐션 스칼라 + 물고기 행동 상태 기계(fishBrain). 물리 엔진이 아니다.
// 「드랙 이하면 버티고, 넘으면 미끄러지며 라인이 풀린다」가 뿌리다. §5.3.2 의 순서를 그대로 따른다.
// 어종 ID 문자열을 두지 않는다(§8.2 — fishBrain.test 가 훑는다). rig 를 import 하지 않는다(§2.2).

import { DT } from '../../core/constants.js';
import { EV } from '../../core/events.js';
import { angleDiff, clamp, clamp01, lerp, piecewise } from '../../core/math.js';
import { BITE } from '../../data/bite.js';
import { FIGHT, HOOK } from '../../data/fight.js';
import { STYLES } from '../../data/fightStyles.js';
import { getSpecies } from '../../data/species/index.js';
import { buildBrain, lateralOf, startBrain, stepBrain } from './fishBrain.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').FightState} FightState */
/** @typedef {import('../../types.js').FightOutcome} FightOutcome */
/** @typedef {import('../../types.js').FishRoll} FishRoll */
/** @typedef {import('../../types.js').SpeciesDef} SpeciesDef */
/** @typedef {import('../../types.js').InputFrame} InputFrame */

/**
 * §5.3.1 — 이 물고기의 상수.
 * @param {SpeciesDef} species @param {FishRoll} roll
 * @returns {{Fmax:number, vmax:number, endurance:number, reelBase:number}}
 */
export function fightConstants(species, roll) {
  const st = STYLES[species.style];
  const f = species.fight || {};
  const W = roll.weightKg;
  const Lm = roll.lengthCm / 100;
  return {
    Fmax: st.force * (f.force ?? 1) * Math.pow(W, FIGHT.forceExp),
    vmax: st.speed * (f.speed ?? 1) * Math.pow(Lm, FIGHT.speedExp),
    endurance: st.endurance * (f.stamina ?? 1) * Math.pow(W, FIGHT.enduranceExp),
    reelBase: FIGHT.reelLoadK * Math.pow(W, FIGHT.reelLoadExp),
  };
}

/** 작은 바늘에 큰 입 → 빠짐 배율(§5.3.1 hookOffMul) @param {SpeciesDef} species @param {number} hookSize */
export function hookOffMulOf(species, hookSize) {
  return BITE.hookSmallerHookOff[clamp(species.mouth - hookSize, 0, 2)];
}

/** 피로 배율(§5.3.2 3) @param {number} stamina */
function fatOf(stamina) {
  return FIGHT.fatigueFloor + (1 - FIGHT.fatigueFloor) * stamina;
}

/**
 * §5.3.1 — 파이팅 시작 상태. 시작 상태가 질주류면 FIGHT.startTele 예고(FIGHT_TELEGRAPH)를, 아니면 FIGHT_BEHAVIOR 를 낸다.
 * @param {SimCtx} ctx @param {{speciesId:string, roll:FishRoll, dist:number, bearing:number, depth:number}} args
 * @returns {FightState}
 */
export function createFight(ctx, { speciesId, roll, dist, bearing, depth }) {
  const s = ctx.state;
  const rs = ctx.rigStats;
  const spot = ctx.spot;
  const species = getSpecies(speciesId);
  const k = fightConstants(species, roll);
  const brain = buildBrain(species);
  const edgeM = spot ? spot.edgeM : 0;
  const facing = spot ? spot.facing : bearing;
  const arc = spot ? spot.arc : 0;
  const lineM = s.profile.sets[s.rig.set].lineM;
  const startDef = brain.states[brain.start];
  /** @type {FightState} */
  const fight = {
    speciesId,
    roll,
    t: 0,
    dist,
    prevDist: dist,
    minDist: edgeM + FIGHT.minDistPad,
    bearing,
    prevBearing: bearing,
    halfArc: Math.min(FIGHT.maxArc, Math.max(arc + FIGHT.bearingSlack, Math.abs(angleDiff(facing, bearing)) + FIGHT.bearingSlack)),
    depth: Math.max(0, depth),
    airborne: 0,
    stamina: 1,
    behavior: startDef.kind,
    behaviorName: brain.start,
    behaviorT: 0,
    behaviorDur: 0,
    telegraph: null,
    tension: 0,
    tensionRatio: 0,
    limitKg: rs.lineKg,
    limitBy: 'line',
    limitRatio: 0,
    lineKg: rs.lineKg,
    lineEffKg: rs.lineKg,
    abrasion: 0,
    inSnag: spot ? dist >= spot.snag.fromM : false,
    inCover: 0,
    rodLift: 0,
    rodUp: false,
    rodLoadRatio: 0,
    rodStress: false,
    rodOverT: 0,
    lineDanger: false,
    slipping: false,
    slipSpeed: 0,
    reeling: false,
    gainSpeed: 0,
    slack: false,
    slackTime: 0,
    spoolLeftM: lineM - dist,
    canNet: false,
    netRangeM: edgeM + rs.netReachM,
    netBuffer: 0,
    landStamina: rs.landStamina,
    showStamina: rs.showStamina,
    traits: [...species.traits],
    k: { Fmax: k.Fmax, vmax: k.vmax, endurance: k.endurance },
    stats: { maxTension: 0, sumTension: 0, sumTension2: 0, ticks: 0, runs: 0, jumps: 0, slackTicks: 0, slipTicks: 0 },
    // sim 내부(행동 상태 기계 변수) — view · ui · 봇은 읽지 않는다
    brain: { state: brain.start, lateralSign: 1, slipT: 0, netRunUsed: false, preTeleLoose: 0, pending: null,
      entered: false, pulseIdx: -1, air: false },
  };
  if (spot && fight.inSnag) ctx.emit(EV.SNAG, { on: true });
  startBrain(fight, brain, ctx.rng, ctx);
  return fight;
}

/** 끝난 틱의 결과 — FIGHT_END 를 내고 FightOutcome 을 돌려준다 */
function finish(ctx, f, type, lineLostM, cause, hookSmall) {
  const outcome = type === 'net' ? 'landed' : type;
  ctx.emit(EV.FIGHT_END, {
    outcome,
    durationSec: f.t,
    maxTension: Math.max(f.stats.maxTension, f.tension),
    distM: f.dist,
    cause,
  });
  return { type, lineLostM, durationSec: f.t, cause, hookSmall };
}

/**
 * §5.3.2 — 파이팅 한 틱(이 순서 그대로). 끝난 틱에만 FightOutcome, 나머지 null.
 * @param {SimCtx} ctx @param {InputFrame} input @returns {FightOutcome|null}
 */
export function updateFight(ctx, input) {
  const s = ctx.state;
  const f = s.fight;
  if (!f) return null;
  const rs = ctx.rigStats;
  const spot = ctx.spot;
  const rng = ctx.rng;
  const species = getSpecies(f.speciesId);
  const brain = buildBrain(species);
  const b = f.brain;
  const { Fmax, vmax } = f.k;
  const E = f.k.endurance;
  const W = f.roll.weightKg;
  const reelBase = FIGHT.reelLoadK * Math.pow(W, FIGHT.reelLoadExp);
  const hookOffMul = hookOffMulOf(species, rs.hookSize);
  const hookSmall = hookOffMul > 1;
  const slackKg = Math.min(HOOK.slackFracLine * f.lineKg, HOOK.slackFracFish * Fmax);
  const rodMax = rs.rodMaxLoadKg;
  const lineM = s.profile.sets[s.rig.set].lineM;
  const primary = !!input.primary;

  // 직전 틱의 플래그(바뀐 것만 이벤트 — 11)
  const wasCanNet = f.canNet;
  const wasSlipping = f.slipping;
  const wasInSnag = f.inSnag;
  const wasRodStress = f.rodStress;
  const wasLineDanger = f.lineDanger;
  b.entered = false;

  // 0. 뜰채 — 같은 틱의 다른 판정보다 먼저(직전 틱의 canNet · 선입력 버퍼)
  if ((input.hook || f.netBuffer > 0) && wasCanNet) {
    const o = s.rig.origin;
    ctx.emit(EV.NET_START, {
      x: o.x - Math.sin(f.bearing) * f.dist,
      z: o.z - Math.cos(f.bearing) * f.dist,
      lengthM: f.roll.lengthCm / 100,
    });
    f.netBuffer = 0;
    return finish(ctx, f, 'net', 0, null, hookSmall);
  }
  f.netBuffer = input.hook ? FIGHT.netBufferS : Math.max(0, f.netBuffer - DT);

  // 1. 느슨함 — 드랙이 미끄러지는 동안은 스풀이 하중을 받으므로 0
  const fatPrev = fatOf(f.stamina);
  const loose = wasSlipping ? 0 : clamp01(1 - f.tension / (HOOK.tightRef * Fmax * fatPrev));

  // 2. 행동
  if (!brain.states[f.behaviorName]) {                   // 바깥에서 만든 상태(고정 상태 등)의 모르는 이름 — 시작 상태로
    f.behaviorName = brain.start;
    f.behavior = brain.states[brain.start].kind;
  }
  stepBrain(f, brain, rng, DT, ctx, loose);
  const tele = f.telegraph !== null;
  const def = brain.states[f.behaviorName];
  const kind = f.behavior;

  // 3. 힘
  const fat = fatOf(f.stamina);
  const sqrtFat = Math.sqrt(fat);
  const sF = tele ? FIGHT.teleF : def.f;
  const sAlong = tele ? FIGHT.teleAlong : def.along;
  const sSp = tele ? FIGHT.teleSp : def.sp;
  const F = Fmax * sF * fat;
  let Fal = F * sAlong;

  // 4. 로드
  const liftBefore = f.rodLift;
  f.rodLift = clamp01(f.rodLift + (input.secondary ? DT / FIGHT.pumpLiftTime : -DT / FIGHT.rodLowerTime));
  const dLift = f.rodLift - liftBefore;
  f.rodUp = f.rodLift >= 0.5;
  const pumpGain = (dLift > 0 && f.rodLift >= FIGHT.pumpGainFrom) ? FIGHT.pumpStroke * dLift : 0;

  // 5. 특수 행동(예고 아님)
  /** @type {'jump'|'shake'|null} */
  let hookRoll = null;
  if (!tele && kind === 'jump') {
    Fal = Fmax * FIGHT.jumpSpike * fat * (f.rodUp ? 1 : FIGHT.lowRodAbsorb);
    if (b.entered) {
      const p = (f.rodUp ? HOOK.jumpPumpP * rs.jumpPumpMul + HOOK.jumpLooseP * b.preTeleLoose : HOOK.jumpLowP) * hookOffMul;
      if (rng.chance(p)) hookRoll = 'jump';
    }
  } else if (!tele && kind === 'shake') {
    if (b.entered && rng.chance(HOOK.shakeP * loose * hookOffMul)) hookRoll = 'shake';
    const idx = Math.floor(f.behaviorT / FIGHT.shakePulse);
    if (f.behaviorT - idx * FIGHT.shakePulse < FIGHT.shakePulseOn) {
      Fal += Fmax * FIGHT.shakeAmp * fat;
      if (idx !== b.pulseIdx) {
        b.pulseIdx = idx;
        ctx.emit(EV.FIGHT_SHAKE, { strength: FIGHT.shakeAmp * fat });
      }
    }
  }

  // 6. 텐션 목표값 · 거리
  const flowSq = spot ? spot.flow.x * spot.flow.x + spot.flow.z * spot.flow.z : 0;
  const flowLoad = FIGHT.flowLoadK * flowSq * f.dist;
  const pumpMul = 1 + FIGHT.pumpTension * f.rodLift;
  const drag = s.rig.dragKg;
  let target;
  let slipping = false;
  let slipSpeed = 0;
  let gainSpeed = 0;
  if (s.rig.bailOpen) {
    // (a) 베일 열림 — 라인이 그냥 풀려 나간다(드랙도 텐션도 없다)
    target = 0;
    b.slipT = 0;
    if (Fal > 0) f.dist += vmax * Math.max(sSp, FIGHT.minSlipSp) * sqrtFat * DT;
  } else if (sAlong >= 0) {
    // (b) 멀어지거나 옆으로
    const raw = (Fal + (primary ? reelBase : 0) + flowLoad) * pumpMul;
    if (raw > drag) {
      slipping = true;
      b.slipT = (b.slipT || 0) + DT;
      target = (b.slipT <= FIGHT.stickTime && f.t > FIGHT.hookGrace) ? drag + (raw - drag) * FIGHT.stick : drag;
      slipSpeed = vmax * Math.max(sSp, FIGHT.minSlipSp) * sqrtFat * Math.min(1, (raw - drag) / (FIGHT.slipRef * Fmax));
      f.dist += slipSpeed * DT;
    } else {
      b.slipT = 0;
      target = raw;
      const gain = primary ? rs.reelSpeedMS * clamp01(1 - Fal / rs.reelMaxDragKg) : 0;
      const pumpDist = pumpGain * clamp01(1 - Fal / rodMax);
      f.dist -= gain * DT + pumpDist;
      gainSpeed = gain + pumpDist / DT;
    }
  } else {
    // (c) charge — 이쪽으로 온다. 감으며 세우면 여유 줄을 거둔다
    b.slipT = 0;
    const approach = vmax * (-sAlong) * sSp * sqrtFat;
    f.dist -= approach * DT;
    const takeUp = (primary ? rs.reelSpeedMS : 0) + pumpGain / DT;
    target = takeUp >= approach ? (reelBase + flowLoad) * pumpMul : flowLoad * FIGHT.slackFlowFrac;
    gainSpeed = Math.min(takeUp, approach);
  }
  if (f.dist < f.minDist) f.dist = f.minDist;
  f.tension += (target - f.tension) * (1 - Math.exp(-FIGHT.tensionLambda * DT));
  f.slipping = slipping;
  f.slipSpeed = slipSpeed;
  f.gainSpeed = gainSpeed;
  f.reeling = primary;

  // 7. 체력
  f.stamina -= (FIGHT.baseDrain + f.tension / Fmax * (f.rodUp ? FIGHT.pumpDrain * rs.pumpDrainMul : 1)) / E * DT;
  if (kind === 'rest' && !tele && f.tension < FIGHT.recoverBelow * Fmax) f.stamina += FIGHT.recoverRate / E * DT;
  f.stamina = clamp01(f.stamina);

  // 8. 쓸림 — 드랙이 버티면(미끄러지지 않으면) 바닥에 박히지 못한다
  if ((kind === 'dive' || def.abrades) && !tele) {
    f.inCover = clamp01(f.inCover + (slipping ? FIGHT.coverRate : -FIGHT.coverEscape) * DT);
  } else {
    f.inCover = clamp01(f.inCover - FIGHT.coverDecay * DT);
  }
  f.inSnag = spot ? f.dist >= spot.snag.fromM : false;
  const spotAbr = spot ? spot.abrasion : 0;
  const snagRate = f.inSnag ? spot.snag.rate : 0;
  f.abrasion = Math.min(FIGHT.maxAbrasion,
    f.abrasion + (FIGHT.coverAbrasion * f.inCover * spotAbr * brain.abrasionMul + snagRate) * rs.lineAbrasionMul * DT);
  f.lineEffKg = f.lineKg * (1 - f.abrasion);
  if (f.rodUp && rodMax < f.lineEffKg) {
    f.limitKg = rodMax;
    f.limitBy = 'rod';
  } else {
    f.limitKg = f.lineEffKg;
    f.limitBy = 'line';
  }
  f.limitRatio = f.tension / f.limitKg;
  f.tensionRatio = f.tension / f.lineEffKg;
  f.rodLoadRatio = f.tension / rodMax;

  // 9. 연출 값 — depth · bearing · airborne (§5.3.4)
  const bottomDepth = spot ? piecewise(spot.depth, f.dist) : f.depth;
  let depthTarget;
  if ((tele && f.telegraph.kind === 'jump') || (!tele && kind === 'jump')) depthTarget = 0;
  else if (kind === 'dive' && !tele) depthTarget = bottomDepth;
  else if (f.stamina < FIGHT.tiredStamina) depthTarget = FIGHT.tiredDepth;
  else depthTarget = FIGHT.midDepthFrac * bottomDepth;
  if (tele) depthTarget = Math.min(depthTarget, FIGHT.teleDepth);
  const dStep = FIGHT.depthSpeed * DT;
  f.depth = Math.max(0, f.depth + clamp(depthTarget - f.depth, -dStep, dStep));

  const omega = lateralOf(def) * vmax * sSp * fat / Math.max(f.dist, FIGHT.bearingMinDist);
  f.bearing += b.lateralSign * omega * DT;
  const facing = spot ? spot.facing : f.prevBearing;
  const allowed = lerp(FIGHT.nearArc, f.halfArc, clamp01(f.dist / FIGHT.nearDist));
  const off = angleDiff(facing, f.bearing);
  if (off > allowed) {
    f.bearing = facing + allowed;
    b.lateralSign = -1;
  } else if (off < -allowed) {
    f.bearing = facing - allowed;
    b.lateralSign = 1;
  }

  const inAir = !tele && kind === 'jump';
  f.airborne = inAir && f.behaviorDur > 0 ? Math.max(0, Math.sin(Math.PI * Math.min(1, f.behaviorT / f.behaviorDur))) : 0;
  if (inAir !== !!b.air) {
    b.air = inAir;
    const o = s.rig.origin;
    ctx.emit(EV.FIGHT_JUMP, {
      phase: inAir ? 'leave' : 'land',
      x: o.x - Math.sin(f.bearing) * f.dist,
      z: o.z - Math.cos(f.bearing) * f.dist,
      lengthM: f.roll.lengthCm / 100,
    });
  }

  // 10. 실패 판정 — 처음 걸린 하나만(스풀 > 로드 > 라인 > 바늘)
  f.spoolLeftM = lineM - f.dist;
  f.rodOverT = (f.rodUp && f.tension > rodMax) ? f.rodOverT + DT : 0;
  f.slack = f.tension < slackKg;
  if (f.slack) f.slackTime += DT;
  else f.slackTime = Math.max(0, f.slackTime - HOOK.slackDecay * DT);
  if (f.dist >= lineM) return finish(ctx, f, 'spoolEmpty', lineM, null, hookSmall);
  if (f.rodOverT >= FIGHT.rodBreakHold) return finish(ctx, f, 'rodBreak', 0, null, hookSmall);
  if (f.tension > f.lineEffKg) return finish(ctx, f, 'lineBreak', Math.round(f.dist), null, hookSmall);
  if (hookRoll) return finish(ctx, f, 'hookOff', 0, hookRoll, hookSmall);
  if (f.slackTime > 0) {
    const h = HOOK.slackRate * Math.min(f.slackTime, HOOK.slackCap) * rs.slackRateMul * hookOffMul;
    if (rng.chance(h * DT)) return finish(ctx, f, 'hookOff', 0, 'slack', hookSmall);
  }
  if (!tele && (kind === 'run' || kind === 'shake' || kind === 'turn' || kind === 'jump' || kind === 'charge')) {
    const looseNow = slipping ? 0 : clamp01(1 - f.tension / (HOOK.tightRef * Fmax * fat));
    const h = HOOK.activeRate * (HOOK.looseBase + (1 - HOOK.looseBase) * looseNow) * hookOffMul;
    if (rng.chance(h * DT)) return finish(ctx, f, 'hookOff', 0, 'active', hookSmall);
  }

  // 11. 플래그 — 바뀐 것만 이벤트
  f.canNet = f.dist <= f.netRangeM && f.stamina <= f.landStamina;
  f.rodStress = f.rodUp && f.rodLoadRatio >= FIGHT.rodStressAt;
  f.lineDanger = f.tensionRatio >= FIGHT.lineDangerAt;
  if (f.canNet !== wasCanNet) ctx.emit(EV.NET_READY, { on: f.canNet });
  if (f.rodStress !== wasRodStress) ctx.emit(EV.ROD_STRESS, { on: f.rodStress });
  if (f.lineDanger !== wasLineDanger) ctx.emit(EV.LINE_DANGER, { on: f.lineDanger });
  if (f.inSnag !== wasInSnag) ctx.emit(EV.SNAG, { on: f.inSnag });
  if (f.slipping !== wasSlipping) ctx.emit(EV.FIGHT_SLIP, { on: f.slipping });

  // 12. 통계 · 시간
  const st = f.stats;
  if (f.tension > st.maxTension) st.maxTension = f.tension;
  st.sumTension += f.tension;
  st.sumTension2 += f.tension * f.tension;
  st.ticks += 1;
  if (f.slack) st.slackTicks += 1;
  if (slipping) st.slipTicks += 1;
  f.t += DT;
  return null;
}
