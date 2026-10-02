// OWNER: P4 — 계약 §6.7 · §3.6 · §7.7
// STUB — W0 스텁(§6.14): computeModifiers = 스킬 0단계 값 · isOwned = 1단계면 true(그 밖 owned > 0)
//   · availableCount = 1단계 Infinity(그 밖 owned 수). rigStats 는 §3.6 식 그대로 W0 완성(스텁 상태의 HUD · 테스트가 쓴다).
// 순수 — view · ui 도 써도 된다.

import { FIGHT } from '../../data/fight.js';
import { SIGNAL } from '../../data/bite.js';
import { GEAR_BY_ID } from '../../data/gear.js';
import { SKILLS } from '../../data/skills.js';

/** @typedef {import('../../types.js').Profile} Profile */
/** @typedef {import('../../types.js').Modifiers} Modifiers */
/** @typedef {import('../../types.js').RigStats} RigStats */
/** @typedef {import('../../types.js').SetId} SetId */

/**
 * STUB — 스킬 효과의 합(§7.7). 지금은 모든 스킬 0단계 값.
 * @param {Profile} profile @returns {Modifiers}
 */
export function computeModifiers(profile) {
  void profile;
  /** @type {Record<string, number|boolean>} */
  const mods = {};
  for (const sk of SKILLS) for (const [field, ranks] of Object.entries(sk.effects)) mods[field] = ranks[0];
  return /** @type {Modifiers} */ (/** @type {unknown} */ (mods));
}

/**
 * §3.6 RigStats — rig · fight · ui 미리보기가 같은 값을 본다.
 * 없는 부위의 값: 찌가 없으면(바닥 세트) floatSensitivity 1 · floatStability 1 · floatDriftMul 1,
 * 봉돌이 없으면(찌 세트) sinkerHoldMS 0 · sinkerCastBonusM 0. dragNotchKg = reelMaxDragKg / dragNotches.
 * @param {Profile} profile @param {SetId} set @param {Modifiers} mods @returns {RigStats}
 */
export function rigStats(profile, set, mods) {
  const cfg = profile.sets[set];
  const rod = GEAR_BY_ID[cfg.rod];
  const reel = GEAR_BY_ID[cfg.reel];
  const line = GEAR_BY_ID[cfg.lineId];
  const hook = GEAR_BY_ID[cfg.hook];
  const flt = cfg.float ? GEAR_BY_ID[cfg.float] : null;
  const sink = cfg.sinker ? GEAR_BY_ID[cfg.sinker] : null;
  const sinkerCastBonusM = sink ? sink.castBonusM : 0;
  const floatSensitivity = flt ? flt.sensitivity : 1;
  return {
    set,
    rodId: rod.id,
    reelId: reel.id,
    lineId: line.id,
    hookId: hook.id,
    floatId: flt ? flt.id : null,
    sinkerId: sink ? sink.id : null,
    baitId: cfg.bait,
    baitCount: profile.baits[cfg.bait] ?? 0,
    castMaxM: (rod.castM + sinkerCastBonusM) * (1 + reel.castBonus) * mods.castMul,
    rodMaxLoadKg: rod.maxLoadKg,
    rodSensitivity: rod.sensitivity,
    rodLengthM: rod.lengthM,
    reelMaxDragKg: reel.maxDragKg,
    reelSpeedMS: reel.speedMS,
    spoolCapM: reel.capacityM,
    lineM: cfg.lineM,
    lineKg: line.strengthKg * mods.lineStrMul,
    lineBiteMul: line.biteMul,
    lineAbrasionMul: line.abrasionMul * mods.abrasionMul,
    hookSize: hook.size,
    floatSensitivity,
    floatStability: flt ? flt.stability : 1,
    floatDriftMul: flt ? flt.driftMul : 1,
    sinkerHoldMS: sink ? sink.holdMS : 0,
    sinkerCastBonusM,
    dragNotches: mods.dragNotches,
    dragNotchKg: reel.maxDragKg / mods.dragNotches,
    signalMul: rod.sensitivity * (set === 'float' ? floatSensitivity : 1) * mods.signalMul,
    hookWindowS: SIGNAL[set].takeWindow + mods.hookWindowAdd,
    perfectWindow: mods.perfectWindow,
    biteRateMul: mods.biteRateMul,
    netReachM: FIGHT.netReachM + mods.netRangeAdd,
    landStamina: FIGHT.landStamina + mods.landStaminaAdd,
    slackRateMul: mods.slackRateMul,
    pumpDrainMul: mods.pumpDrainMul,
    jumpPumpMul: mods.jumpPumpMul,
    earlyBaitKeep: mods.earlyBaitKeep,
    baitKeepOnFail: mods.baitKeepOnFail,
    showStamina: mods.knowledge >= 3,
  };
}

/** STUB — 1단계는 언제나 true @param {Profile} profile @param {string} gearId */
export function isOwned(profile, gearId) {
  const g = GEAR_BY_ID[gearId];
  if (!g) return false;
  return g.tier === 1 || (profile.owned[gearId] ?? 0) > 0;
}

/** STUB — 보유 − 다른 세트가 끼운 수(1단계 Infinity). 지금은 보유 수 그대로 @param {Profile} profile @param {string} gearId @param {SetId} exceptSet */
export function availableCount(profile, gearId, exceptSet) {
  void exceptSet;
  const g = GEAR_BY_ID[gearId];
  if (!g) return 0;
  if (g.tier === 1) return Infinity;
  return profile.owned[gearId] ?? 0;
}
