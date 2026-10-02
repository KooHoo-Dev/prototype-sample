// OWNER: P4 — 계약 §6.7 · §7.9 · §4.2
// 경험치 · 레벨 · 스킬 · 도감 · 잡은 물고기의 판정과 반영. 이벤트(XP_GAINED · LEVEL_UP · RECORD · SKILL_LEARNED)는 여기서 직접 낸다.

import { EV } from '../../core/events.js';
import { SET_IDS } from '../../core/constants.js';
import { HOLD, XP } from '../../data/economy.js';
import { GEAR_GATES } from '../../data/gear.js';
import { SKILLS } from '../../data/skills.js';
import { getSpecies, speciesOfStage, SPECIES_BY_ID } from '../../data/species/index.js';
import { SPOTS_BY_ID, STAGES, STAGES_BY_ID, stageOfSpot } from '../../data/stages/index.js';
import { computeModifiers, SKILL_MAX_RANK, skillRank } from './modifiers.js';
import { fishPrice } from './economy.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').Profile} Profile */
/** @typedef {import('../../types.js').FishRoll} FishRoll */
/** @typedef {import('../../types.js').CatchRecord} CatchRecord */
/** @typedef {import('../../types.js').DexCard} DexCard */
/** @typedef {import('../../types.js').Modifiers} Modifiers */
/** @typedef {import('../../types.js').SkillPreview} SkillPreview */
/** @typedef {import('../../types.js').Tier} Tier */

const TIER_ORDER = { normal: 0, trophy: 1, legend: 2 };

// ── 경험치 곡선

/** round(XP.base × level ^ XP.exp) · 캡이면 Infinity(sim 내부 비교용 — 이벤트에는 null) @param {number} level @returns {number} */
export function xpToNext(level) {
  if (level >= XP.levelCap) return Infinity;
  return Math.round(XP.base * Math.pow(level, XP.exp));
}

/** 레벨 1 → level 에 닿는 누적 경험치(누적 L5 657 · L10 3,863 · L20 21,116) @param {number} level @returns {number} */
export function cumulativeXp(level) {
  let sum = 0;
  const top = Math.min(level, XP.levelCap);
  for (let l = 1; l < top; l++) sum += xpToNext(l);
  return sum;
}

/** 3단계 문턱(레벨 · 숙련) @param {number} level @param {number} mastery */
function tier3Open(level, mastery) {
  return level >= GEAR_GATES.tier3Level && mastery >= GEAR_GATES.tier3Mastery;
}

/**
 * 새 레벨이 여는 것(§4.2 — ID 분기 없이 데이터에서). 레벨 업 한 번(newLevel − 1 → newLevel)에 대해 계산한다.
 * @param {Profile} profile @param {number} newLevel @returns {string[]}
 */
function levelUnlocks(profile, newLevel) {
  const out = [];
  for (const st of STAGES) if (st.unlockLevel === newLevel) out.push('stage:' + st.id);
  if (newLevel === GEAR_GATES.tier2Level) out.push('tier:2');
  const m = skillRank(profile, 'mastery');
  if (tier3Open(newLevel, m) && !tier3Open(newLevel - 1, m)) out.push('tier:3');
  return out;
}

/**
 * 순수 — 경험치를 더하고 레벨을 올린다(포인트 지급 포함 · 이벤트 없음). 캡이면 xp 0.
 * @param {Profile} profile @param {number} amount 정수 ≥ 0
 * @returns {{levelsGained:number, levels:Array<{level:number, unlocks:string[]}>}}
 */
function addXpToProfile(profile, amount) {
  const levels = [];
  profile.xpTotal += amount;
  if (profile.level >= XP.levelCap) {
    profile.xp = 0;
    return { levelsGained: 0, levels };
  }
  profile.xp += amount;
  while (profile.level < XP.levelCap && profile.xp >= xpToNext(profile.level)) {
    profile.xp -= xpToNext(profile.level);
    profile.level += 1;
    profile.skillPoints += XP.pointsPerLevel;
    levels.push({ level: profile.level, unlocks: levelUnlocks(profile, profile.level) });
  }
  if (profile.level >= XP.levelCap) profile.xp = 0;
  return { levelsGained: levels.length, levels };
}

/** 경험치 양 정리(정수 ≥ 0) @param {any} amount */
function cleanAmount(amount) {
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
}

/** XP_GAINED · LEVEL_UP(레벨마다) @param {SimCtx} ctx @param {number} amount @param {string} source @param {Array<{level:number, unlocks:string[]}>} levels */
function emitXp(ctx, amount, source, levels) {
  const p = ctx.state.profile;
  const need = xpToNext(p.level);
  ctx.emit(EV.XP_GAINED, {
    amount,
    xpTotal: p.xpTotal,
    level: p.level,
    xp: p.xp,
    xpToNext: Number.isFinite(need) ? need : null,
    source,
  });
  for (const lv of levels) {
    ctx.emit(EV.LEVEL_UP, { level: lv.level, skillPoints: p.skillPoints, unlocks: lv.unlocks });
  }
}

/**
 * 경험치 더하기 → {levelsGained} · XP_GAINED · LEVEL_UP(레벨마다 — unlocks §4.2). 0 이하 · 유한수가 아니면 아무 일도 없다.
 * @param {SimCtx} ctx @param {number} amount @param {'keep'|'release'|'debug'} source
 */
export function addXp(ctx, amount, source) {
  const a = cleanAmount(amount);
  if (a === 0) return { levelsGained: 0 };
  const r = addXpToProfile(ctx.state.profile, a);
  emitXp(ctx, a, source, r.levels);
  return { levelsGained: r.levelsGained };
}

// ── 잡은 물고기

/**
 * 결과 패널에 보일 기록을 만든다. 상태를 바꾸지 않는다(uid 는 profile.nextUid 를 미리 본다).
 * 경험치 = round(xp × tierMul) + (첫 포획 firstBase + firstPerXp × xp) + (무게 신기록 round(recordMul × xp)) · 방생 = round(keep × releaseMul).
 * @param {SimCtx} ctx @param {FishRoll} roll @param {number} fightSec @returns {CatchRecord}
 */
export function evaluateCatch(ctx, roll, fightSec) {
  const s = ctx.state;
  const p = s.profile;
  const species = getSpecies(roll.speciesId);
  const entry = p.dex[roll.speciesId];
  const firstCatch = !entry;
  const recordWeight = !!entry && roll.weightKg > entry.maxKg;
  const xpKeep = Math.round(species.xp * XP.tierMul[roll.tier])
    + (firstCatch ? Math.round(XP.firstBase + XP.firstPerXp * species.xp) : 0)
    + (recordWeight ? Math.round(XP.recordMul * species.xp) : 0);
  const spotId = s.player.spotId ?? (ctx.spot ? ctx.spot.id : '');
  const stageId = spotId && SPOTS_BY_ID[spotId] ? stageOfSpot(spotId) : species.stage;
  return {
    uid: p.nextUid,
    speciesId: roll.speciesId,
    lengthCm: roll.lengthCm,
    weightKg: roll.weightKg,
    pct: roll.pct,
    tier: roll.tier,
    price: fishPrice(species, roll.weightKg, roll.tier),
    xpKeep,
    xpRelease: Math.round(xpKeep * XP.releaseMul),
    firstCatch,
    recordWeight,
    stageId: /** @type {any} */ (stageId),
    spotId: spotId ?? '',
    day: s.clock.day,
    hour: s.clock.hour,
    set: s.rig.set,
    fightSec: Number.isFinite(fightSec) ? fightSec : 0,
  };
}

/**
 * 순수 — 도감 · 경험치(레벨 · 포인트) · (kept면) 어창 · nextUid · stats 를 반영한다(이벤트 없음).
 * applyCatch 와 createSaveData 가 같이 쓴다. 어창이 차 있으면 kept 여도 방생으로 반영한다(어창 > capacity 금지).
 * @param {Profile} profile @param {CatchRecord} record @param {boolean} kept
 * @returns {{xp:number, kept:boolean, levelsGained:number, levels:Array<{level:number, unlocks:string[]}>}}
 */
export function applyCatchToProfile(profile, record, kept) {
  const keep = !!kept && profile.hold.length < HOLD.capacity;
  // 도감
  const prev = profile.dex[record.speciesId];
  const e = prev ?? { count: 0, maxKg: 0, maxCm: 0, firstDay: record.day, trophies: 0, legends: 0, best: 'normal' };
  e.count += 1;
  if (record.weightKg > e.maxKg) e.maxKg = record.weightKg;
  if (record.lengthCm > e.maxCm) e.maxCm = record.lengthCm;
  if (record.tier === 'trophy') e.trophies += 1;
  if (record.tier === 'legend') e.legends += 1;
  if (TIER_ORDER[record.tier] > TIER_ORDER[e.best]) e.best = record.tier;
  profile.dex[record.speciesId] = e;
  // 어창 · 통계
  if (keep) profile.hold.push({ ...record });
  profile.stats.landed += 1;
  if (!keep) profile.stats.released += 1;
  profile.nextUid = Math.max(profile.nextUid, record.uid) + 1;
  // 경험치
  const xp = keep ? record.xpKeep : record.xpRelease;
  const r = addXpToProfile(profile, cleanAmount(xp));
  return { xp: cleanAmount(xp), kept: keep, levelsGained: r.levelsGained, levels: r.levels };
}

/**
 * 결과 결정을 반영한다 → Result{xp}. kept 이고 어창이 차 있으면 swapUid(어창 물고기)를 빼고 넣는다 —
 * 뺀 물고기의 경험치 · 도감은 그대로다. swapUid 가 없으면 {reason:'holdFull'} · 어창에 없는 uid 면 {reason:'invalid'}.
 * 이벤트: RECORD(첫 포획 · 무게 신기록) · XP_GAINED · LEVEL_UP. CATCH_KEPT · RELEASED · SAVE_REQUEST 는 부르는 쪽(P1)이 낸다.
 * @param {SimCtx} ctx @param {CatchRecord} record @param {boolean} kept @param {{swapUid?:number}} [opts]
 */
export function applyCatch(ctx, record, kept, opts = {}) {
  const p = ctx.state.profile;
  if (!record || typeof record !== 'object' || !SPECIES_BY_ID[record.speciesId]) return { ok: false, reason: 'invalid' };
  if (p.hold.some(c => c.uid === record.uid)) return { ok: false, reason: 'invalid' };   // 이미 반영된 기록
  if (kept && p.hold.length >= HOLD.capacity) {
    const uid = opts ? opts.swapUid : undefined;
    if (uid === undefined || uid === null) return { ok: false, reason: 'holdFull' };
    const idx = p.hold.findIndex(c => c.uid === uid);
    if (idx < 0) return { ok: false, reason: 'invalid' };
    p.hold.splice(idx, 1);
  }
  const info = applyCatchToProfile(p, record, kept);
  if (record.firstCatch) ctx.emit(EV.RECORD, { speciesId: record.speciesId, kind: 'first', weightKg: record.weightKg, tier: record.tier });
  else if (record.recordWeight) ctx.emit(EV.RECORD, { speciesId: record.speciesId, kind: 'weight', weightKg: record.weightKg, tier: record.tier });
  if (info.xp > 0) emitXp(ctx, info.xp, info.kept ? 'keep' : 'release', info.levels);
  return { ok: true, xp: info.xp };
}

// ── 스킬

/** 배울 수 있는가 @param {Profile} profile @param {string} skillId @returns {{ok:boolean, reason:string|null}} */
function canLearn(profile, skillId) {
  if (!SKILLS.some(sk => sk.id === skillId)) return { ok: false, reason: 'invalid' };
  if (skillRank(profile, skillId) >= SKILL_MAX_RANK) return { ok: false, reason: 'maxRank' };
  if (!(profile.skillPoints >= 1)) return { ok: false, reason: 'noPoints' };
  return { ok: true, reason: null };
}

/**
 * 스킬 한 단계 → Result{rank} · SKILL_LEARNED{unlocks — 숙련으로 3단계가 열리면 'tier:3'} · ctx.refresh() · SAVE_REQUEST{skill}.
 * 드랙 눈금 수가 바뀌면 두 세트의 dragNotch 를 같은 비율로 옮긴다(round(old × new / oldNotches)).
 * @param {SimCtx} ctx @param {string} skillId
 */
export function learnSkill(ctx, skillId) {
  const p = ctx.state.profile;
  const chk = canLearn(p, skillId);
  if (!chk.ok) return { ok: false, reason: /** @type {string} */ (chk.reason) };
  const before = computeModifiers(p);
  const wasT3 = tier3Open(p.level, skillRank(p, 'mastery'));
  const rank = /** @type {0|1|2|3} */ (skillRank(p, skillId) + 1);
  p.skills[skillId] = rank;
  p.skillPoints -= 1;
  const after = computeModifiers(p);
  if (after.dragNotches !== before.dragNotches) {
    for (const set of SET_IDS) {
      const cfg = p.sets[set];
      const n = Math.round(cfg.dragNotch * after.dragNotches / before.dragNotches);
      cfg.dragNotch = Math.max(0, Math.min(after.dragNotches, n));
    }
  }
  const unlocks = [];
  if (!wasT3 && tier3Open(p.level, skillRank(p, 'mastery'))) unlocks.push('tier:3');
  ctx.emit(EV.SKILL_LEARNED, { skillId, rank, unlocks });
  ctx.refresh();
  ctx.emit(EV.SAVE_REQUEST, { reason: 'skill' });
  return { ok: true, rank };
}

/**
 * 스킬 미리보기 — rank = 지금 랭크 · after = 한 단계 올렸을 때의 Modifiers(최고 단계면 before 와 같다) · ok/reason = learnSkill 의 판정.
 * @param {Profile} profile @param {string} skillId @returns {SkillPreview}
 */
export function previewSkill(profile, skillId) {
  const chk = canLearn(profile, skillId);
  const before = computeModifiers(profile);
  const rank = skillRank(profile, skillId);
  let after = before;
  if (SKILLS.some(sk => sk.id === skillId) && rank < SKILL_MAX_RANK) {
    after = computeModifiers({ ...profile, skills: { ...profile.skills, [skillId]: rank + 1 } });
  }
  return { skillId: /** @type {any} */ (skillId), rank, ok: chk.ok, reason: chk.reason, before, after };
}

// ── 스테이지 · 도감

/** level ≥ stage.unlockLevel(모르는 씬이면 false) @param {Profile} profile @param {string} stageId @returns {boolean} */
export function stageUnlocked(profile, stageId) {
  const st = STAGES_BY_ID[stageId];
  return !!st && profile.level >= st.unlockLevel;
}

/**
 * 도감 카드 — 그 스테이지 어종마다(데이터 순서). 지식 1 이면 활동 시간대 · 2 면 선호 미끼.
 * @param {Profile} profile @param {string} stageId @param {Modifiers} mods @returns {DexCard[]}
 */
export function dexView(profile, stageId, mods) {
  const k = mods ? mods.knowledge : 0;
  return speciesOfStage(stageId).map(s => {
    const e = profile.dex[s.id];
    return {
      speciesId: s.id,
      caught: !!e,
      fantasy: s.fantasy !== null,
      layers: s.layers,
      time: k >= 1 ? s.time : null,
      baits: k >= 2 ? s.baits : null,
      entry: e ? { ...e } : null,
      trophyKg: s.trophyKg,
      legendKg: s.legendKg,
    };
  });
}
