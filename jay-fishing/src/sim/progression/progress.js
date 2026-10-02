// OWNER: P4 — 계약 §6.7 · §7.9 · §4.2
// STUB — W0 스텁(§6.14): xpToNext · stageUnlocked = 식대로(완성) · evaluateCatch = 필드를 채운 레코드(price 식대로 · xp 0)
//   · applyCatch = {ok:true, xp:0}(상태 변화 없음 — P1 흐름이 W1 에서 막히지 않게) · applyCatchToProfile no-op · addXp = {levelsGained:0}
//   · learnSkill {ok:false, reason:'stub'} · previewSkill = 같은 Modifiers · dexView = 그 스테이지 어종마다 caught:false 카드. P4 가 채운다.

import { XP } from '../../data/economy.js';
import { getSpecies, speciesOfStage } from '../../data/species/index.js';
import { getStage } from '../../data/stages/index.js';
import { computeModifiers } from './modifiers.js';
import { fishPrice } from './economy.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').Profile} Profile */
/** @typedef {import('../../types.js').FishRoll} FishRoll */
/** @typedef {import('../../types.js').CatchRecord} CatchRecord */
/** @typedef {import('../../types.js').DexCard} DexCard */
/** @typedef {import('../../types.js').Modifiers} Modifiers */
/** @typedef {import('../../types.js').SkillPreview} SkillPreview */

/** round(XP.base × level ^ XP.exp) · 캡이면 Infinity(sim 내부 비교용 — 이벤트에는 null) @param {number} level @returns {number} */
export function xpToNext(level) {
  if (level >= XP.levelCap) return Infinity;
  return Math.round(XP.base * Math.pow(level, XP.exp));
}

/** STUB → {levelsGained} @param {SimCtx} ctx @param {number} amount @param {'keep'|'release'|'debug'} source */
export function addXp(ctx, amount, source) { void ctx; void amount; void source; return { levelsGained: 0 }; }

/**
 * STUB — 상태를 바꾸지 않는다. 경험치 0 · 첫 포획/신기록 false.
 * @param {SimCtx} ctx @param {FishRoll} roll @param {number} fightSec @returns {CatchRecord}
 */
export function evaluateCatch(ctx, roll, fightSec) {
  const s = ctx.state;
  const species = getSpecies(roll.speciesId);
  return {
    uid: s.profile.nextUid,
    speciesId: roll.speciesId,
    lengthCm: roll.lengthCm,
    weightKg: roll.weightKg,
    pct: roll.pct,
    tier: roll.tier,
    price: fishPrice(species, roll.weightKg, roll.tier),
    xpKeep: 0,
    xpRelease: 0,
    firstCatch: false,
    recordWeight: false,
    stageId: /** @type {any} */ (species.stage),
    spotId: s.player.spotId ?? '',
    day: s.clock.day,
    hour: s.clock.hour,
    set: s.rig.set,
    fightSec,
  };
}

/** STUB → Result{xp}(상태 변화 없음) @param {SimCtx} ctx @param {CatchRecord} record @param {boolean} kept @param {{swapUid?:number}} [opts] */
export function applyCatch(ctx, record, kept, opts = {}) { void ctx; void record; void kept; void opts; return { ok: true, xp: 0 }; }

/** STUB — 순수 프로필 변경(이벤트 없음). 지금은 no-op @param {Profile} profile @param {CatchRecord} record @param {boolean} kept */
export function applyCatchToProfile(profile, record, kept) { void profile; void record; void kept; }

/** STUB → Result{rank} @param {SimCtx} ctx @param {string} skillId */
export function learnSkill(ctx, skillId) { void ctx; void skillId; return { ok: false, reason: 'stub' }; }

/** STUB — 지금 랭크 · 같은 Modifiers 두 번 @param {Profile} profile @param {string} skillId @returns {SkillPreview} */
export function previewSkill(profile, skillId) {
  const mods = computeModifiers(profile);
  return {
    skillId: /** @type {any} */ (skillId),
    rank: profile.skills[skillId] ?? 0,
    ok: false,
    reason: 'stub',
    before: mods,
    after: computeModifiers(profile),
  };
}

/** level ≥ stage.unlockLevel @param {Profile} profile @param {string} stageId @returns {boolean} */
export function stageUnlocked(profile, stageId) {
  return profile.level >= getStage(stageId).unlockLevel;
}

/**
 * STUB — 그 스테이지 어종마다 caught:false 카드(지식 단계에 따른 time · baits 만 채운다).
 * @param {Profile} profile @param {string} stageId @param {Modifiers} mods @returns {DexCard[]}
 */
export function dexView(profile, stageId, mods) {
  void profile;
  const k = mods ? mods.knowledge : 0;
  return speciesOfStage(stageId).map(s => ({
    speciesId: s.id,
    caught: false,
    fantasy: s.fantasy !== null,
    layers: s.layers,
    time: k >= 1 ? s.time : null,
    baits: k >= 2 ? s.baits : null,
    entry: null,
    trophyKg: s.trophyKg,
    legendKg: s.legendKg,
  }));
}
