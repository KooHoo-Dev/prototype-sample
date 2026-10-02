// OWNER: P4 — 계약 §6.7 · §3.6 · §7.7
// 스킬 효과의 합(Modifiers) · 세트의 RigStats · 장비 보유 판정. 순수 — view · ui 도 써도 된다.

import { FIGHT } from '../../data/fight.js';
import { SIGNAL } from '../../data/bite.js';
import { GEAR_BY_ID } from '../../data/gear.js';
import { SKILLS } from '../../data/skills.js';
import { SET_IDS } from '../../core/constants.js';

/** @typedef {import('../../types.js').Profile} Profile */
/** @typedef {import('../../types.js').Modifiers} Modifiers */
/** @typedef {import('../../types.js').RigStats} RigStats */
/** @typedef {import('../../types.js').SetId} SetId */

/** 스킬의 최고 랭크 — effects 배열의 [0단계, 1, 2, 3] 에서 센다(§7.7) */
export const SKILL_MAX_RANK = Math.min(...SKILLS.flatMap(sk => Object.values(sk.effects).map(a => a.length))) - 1;

/** 스킬 랭크(정수 0..SKILL_MAX_RANK — 모르는 값은 0) @param {Profile} profile @param {string} id @returns {number} */
export function skillRank(profile, id) {
  const r = profile && profile.skills ? profile.skills[id] : 0;
  if (typeof r !== 'number' || !Number.isFinite(r)) return 0;
  const n = Math.round(r);
  return n < 0 ? 0 : n > SKILL_MAX_RANK ? SKILL_MAX_RANK : n;
}

/**
 * 스킬 효과의 합(§7.7) — mods[필드] = effects[필드][skills[id]].
 * @param {Profile} profile @returns {Modifiers}
 */
export function computeModifiers(profile) {
  /** @type {Record<string, number|boolean>} */
  const mods = {};
  for (const sk of SKILLS) {
    const rank = skillRank(profile, sk.id);
    for (const field of Object.keys(sk.effects)) mods[field] = sk.effects[field][rank];
  }
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
    showStamina: mods.knowledge >= SKILL_MAX_RANK,   // 어종 지식 3단계(§7.7)
  };
}

/** 1단계는 언제나 true · 2·3단계는 owned > 0 · 모르는 ID false @param {Profile} profile @param {string} gearId @returns {boolean} */
export function isOwned(profile, gearId) {
  const g = GEAR_BY_ID[gearId];
  if (!g) return false;
  return g.tier === 1 || (profile.owned[gearId] ?? 0) > 0;
}

/** 세트가 그 장비를 끼운 수(부위 하나당 1) @param {Profile} profile @param {SetId} set @param {string} gearId @returns {number} */
function usedBySet(profile, set, gearId) {
  const cfg = profile.sets[set];
  if (!cfg) return 0;
  let n = 0;
  if (cfg.rod === gearId) n++;
  if (cfg.reel === gearId) n++;
  if (cfg.hook === gearId) n++;
  if (cfg.float === gearId) n++;
  if (cfg.sinker === gearId) n++;
  return n;
}

/**
 * 보유 − 다른 세트가 끼운 수(exceptSet 이 끼운 것은 세지 않는다 · 생략하면 모든 세트를 뺀다). 1단계 Infinity · 모르는 ID 0.
 * @param {Profile} profile @param {string} gearId @param {SetId} [exceptSet] @returns {number}
 */
export function availableCount(profile, gearId, exceptSet) {
  const g = GEAR_BY_ID[gearId];
  if (!g) return 0;
  if (g.tier === 1) return Infinity;
  let n = profile.owned[gearId] ?? 0;
  for (const set of SET_IDS) if (set !== exceptSet) n -= usedBySet(profile, set, gearId);
  return Math.max(0, n);
}
