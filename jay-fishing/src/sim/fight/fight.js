// OWNER: P2 — 계약 §6.6 · §5.3
// STUB — W0 스텁(§6.14): fightConstants = §5.3.1 식(완성) · createFight = §3.4 전 필드(정지한 물고기) · updateFight = null. P2 가 채운다.
// 어종 ID 문자열을 두지 않는다(§8.2 — fishBrain.test 가 훑는다). rig 를 import 하지 않는다(§2.2).

import { angleDiff } from '../../core/math.js';
import { FIGHT } from '../../data/fight.js';
import { STYLES } from '../../data/fightStyles.js';
import { getSpecies } from '../../data/species/index.js';
import { buildBrain } from './fishBrain.js';

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

/**
 * STUB — §3.4 의 필드를 전부 채운 시작 상태(움직이지 않는다).
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
  const startDef = brain.states[brain.start];
  const edgeM = spot ? spot.edgeM : 0;
  const facing = spot ? spot.facing : bearing;
  const arc = spot ? spot.arc : 0;
  const lineM = s.profile.sets[s.rig.set].lineM;
  return {
    speciesId,
    roll,
    t: 0,
    dist,
    prevDist: dist,
    minDist: edgeM + FIGHT.minDistPad,
    bearing,
    prevBearing: bearing,
    halfArc: Math.min(FIGHT.maxArc, Math.max(arc + FIGHT.bearingSlack, Math.abs(angleDiff(facing, bearing)) + FIGHT.bearingSlack)),
    depth,
    airborne: 0,
    stamina: 1,
    behavior: startDef.kind,
    behaviorName: brain.start,
    behaviorT: 0,
    behaviorDur: startDef.dur[0],
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
    brain: { state: brain.start, lateralSign: 1, slipT: 0, netRunUsed: false, preTeleLoose: 0, pending: null },
  };
}

/**
 * STUB — §5.3.2. 끝난 틱에만 FightOutcome, 나머지 null.
 * @param {SimCtx} ctx @param {InputFrame} input @returns {FightOutcome|null}
 */
export function updateFight(ctx, input) {
  void ctx; void input;
  return null;
}
