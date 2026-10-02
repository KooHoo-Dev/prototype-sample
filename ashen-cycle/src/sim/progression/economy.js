// OWNER: P4 — 계약 §6.6 · §7.5
// 순환 배율 · 강화 비용 · 보상 계산과 지급. 수치는 전부 data/economy.js의 ECONOMY와 보스 정의의 reward에서 읽는다.
import { BOSS_IDS } from '../../core/constants.js';
import { clamp01 } from '../../core/math2d.js';
import { ECONOMY } from '../../data/economy.js';
import { getBossDef } from '../../data/bosses/index.js';
import { computeStatBlock } from './stats.js';
import { tidy, clampInt, nonNegInt } from './num.js';

/** @typedef {import('../../types.js').Profile} Profile */
/** @typedef {import('../../types.js').BossId} BossId */
/** @typedef {import('../../types.js').BossProgress} BossProgress */
/** @typedef {import('../../types.js').CycleScaling} CycleScaling */
/** @typedef {import('../../types.js').RewardResult} RewardResult */

/**
 * 순환 배율(§7.5). softCap을 넘으면 HP · 피해 증가가 완만해지고 보상은 계속 선형이다.
 * @param {number} cycle
 * @returns {CycleScaling}
 */
export function getCycleScaling(cycle) {
  const k = ECONOMY.cycle;
  const c = nonNegInt(cycle);
  const a = Math.min(c, k.softCap);
  const b = Math.max(0, c - k.softCap);
  return {
    hpMul: tidy(1 + k.hpPer * a + k.hpPerAfter * b),
    dmgMul: tidy(1 + k.dmgPer * a + k.dmgPerAfter * b),
    rewardMul: tidy(1 + k.rewardPer * c),
    speedMul: Math.min(k.speedMax, tidy(1 + k.speedPer * c)),
    thinkMul: Math.max(k.thinkMin, tidy(k.thinkBase ** c)),
    chainBonus: Math.min(k.chainMax, tidy(k.chainPer * c)),
  };
}

/**
 * 무기 강화 비용. catchUp이면 잔불 × ECONOMY.weapon.catchUpEmberMul · 파편 0
 * (파편은 "어떤 무기로든 그 단계에 처음 도달할 때"만 든다).
 * @param {number} level 현재 단계(0..maxLevel)
 * @param {boolean} [catchUp]
 * @returns {{embers:number, shards:number}|null} 최대 단계(또는 무효 단계)면 null
 */
export function weaponUpgradeCost(level, catchUp = false) {
  const w = ECONOMY.weapon;
  if (!Number.isInteger(level) || level < 0 || level >= w.maxLevel) return null;
  if (catchUp) return { embers: Math.round(w.embers[level] * w.catchUpEmberMul), shards: 0 };
  return { embers: w.embers[level], shards: w.shards[level] };
}

/**
 * 재도전 감쇠 배율 — 이번 순환 격파 수 0 · 1 · 2 이상.
 * @param {number} killsThisCycle
 * @returns {number} 1 | 0.5 | 0.25
 */
export function repeatMulFor(killsThisCycle) {
  const list = ECONOMY.repeatMul;
  return list[clampInt(killsThisCycle, 0, list.length - 1, 0)];
}

/**
 * 프로필의 그 보스 진행. BOSS_IDS에 없는 id는 undefined(상속 속성 이름이 섞여 들지 않게 목록으로 거른다).
 * @param {Profile} profile
 * @param {string} bossId
 * @returns {BossProgress|undefined}
 */
function progressOf(profile, bossId) {
  return BOSS_IDS.includes(bossId) ? profile.bosses?.[bossId] : undefined;
}

/**
 * 격파 파편(구간 파편 제외). killsBefore = 지급 전의 이번 순환 격파 수: 0 → 첫 격파 · 1..max → 재격파 · 그 뒤 0.
 * @param {number} killsBefore
 * @returns {number}
 */
function killShardsFor(killsBefore) {
  if (killsBefore === 0) return ECONOMY.shardsFirstKill;
  return killsBefore <= ECONOMY.shardsRepeatKillMax ? ECONOMY.shardsRepeatKill : 0;
}

/**
 * 이번 순환에 이 보스에게서 더 받을 수 있는 파편 합(남은 구간 + 남은 격파 파편). 상한은 구간 3 + 첫 격파 3 + 재격파 2 = 8.
 * @param {BossProgress|undefined} bp
 * @returns {number}
 */
export function shardsLeftFor(bp) {
  if (!bp) return 0;
  const milestones = ECONOMY.shardMilestones.length - clampInt(bp.milestones, 0, ECONOMY.shardMilestones.length, 0);
  let kills = 0;
  for (let k = nonNegInt(bp.killsThisCycle); k <= ECONOMY.shardsRepeatKillMax; k++) kills += killShardsFor(k);
  return milestones + kills;
}

/**
 * 보상 계산(§7.5). 순수 계산 — profile을 고치지 않는다. 모르는 bossId에서도 던지지 않는다(보상 0).
 * 사망 잔불의 바닥은 준 피해에 따라 열린다: f = 0이면 0, f ≥ floorFullAt부터 floor 전부.
 * @param {Profile} profile
 * @param {BossId} bossId
 * @param {{victory:boolean, damageFraction:number, duration:number}} outcome
 * @returns {RewardResult}
 */
export function computeReward(profile, bossId, outcome) {
  const victory = outcome?.victory === true;
  const f = Number.isFinite(outcome?.damageFraction) ? clamp01(outcome.damageFraction) : 0;
  const duration = Number.isFinite(outcome?.duration) ? Math.max(0, outcome.duration) : 0;
  const cycle = nonNegInt(profile.cycle);
  const bp = progressOf(profile, bossId);
  const def = BOSS_IDS.includes(bossId) ? getBossDef(bossId) : undefined;
  const base = Number.isFinite(def?.reward) ? def.reward : 0;
  const killsBefore = nonNegInt(bp?.killsThisCycle);
  const repeatMul = repeatMulFor(killsBefore);

  const R = base * getCycleScaling(cycle).rewardMul * repeatMul * computeStatBlock(profile).emberGainMul;
  const d = ECONOMY.death;
  const share = victory ? 1 : d.floor * Math.min(1, f / d.floorFullAt) + d.perFraction * f;
  const embers = Math.round(tidy(R * share));

  // 구간 파편: 승리는 f = 1로 본다. 받은 구간은 항상 앞에서부터라 개수(bp.milestones)만으로 가른다.
  const reached = victory ? 1 : f;
  const got = bp ? clampInt(bp.milestones, 0, ECONOMY.shardMilestones.length, 0) : ECONOMY.shardMilestones.length;
  const milestones = ECONOMY.shardMilestones.filter((m, i) => i >= got && reached >= m);
  const shards = milestones.length + (victory && bp ? killShardsFor(killsBefore) : 0);

  let unlocked = null;
  let cycleAdvanced = false;
  if (victory && bp) {
    const next = BOSS_IDS[BOSS_IDS.indexOf(bossId) + 1];
    if (next && profile.bosses[next] && !profile.bosses[next].unlocked) unlocked = next;
    cycleAdvanced = BOSS_IDS.every((id) => id === bossId || nonNegInt(profile.bosses[id]?.killsThisCycle) >= 1);
  }

  return {
    bossId,
    cycle,
    victory,
    damageFraction: f,
    duration,
    embers,
    shards,
    milestones,
    firstKill: victory && !!bp && killsBefore === 0,
    repeatMul,
    unlocked,
    cycleAdvanced,
    embersAfter: nonNegInt(profile.embers) + embers,
  };
}

/**
 * 지급(§7.5): 잔불 · 파편 → bestFraction · milestones → 승리면 격파 수 · 다음 보스 해금 → 세 보스를 다 잡았으면 순환 +1과 초기화.
 * totals도 여기서 갱신한다. 해금 · 순환은 reward의 플래그가 아니라 지급 뒤의 profile에서 다시 판정한다.
 * @param {Profile} profile
 * @param {RewardResult} reward
 */
export function applyReward(profile, reward) {
  profile.embers = nonNegInt(profile.embers) + nonNegInt(reward.embers);
  profile.shards = nonNegInt(profile.shards) + nonNegInt(reward.shards);

  const bp = progressOf(profile, reward.bossId);
  if (bp) {
    const f = reward.victory ? 1 : clamp01(reward.damageFraction);
    bp.bestFraction = Math.max(bp.bestFraction, f);
    bp.milestones = clampInt(bp.milestones + reward.milestones.length, 0, ECONOMY.shardMilestones.length, 0);
    if (reward.victory) {
      bp.killsThisCycle += 1;
      bp.totalKills += 1;
      const next = BOSS_IDS[BOSS_IDS.indexOf(reward.bossId) + 1];
      if (next && profile.bosses[next]) profile.bosses[next].unlocked = true;
      if (BOSS_IDS.every((id) => profile.bosses[id] && profile.bosses[id].killsThisCycle >= 1)) {
        profile.cycle += 1;
        for (const id of BOSS_IDS) {
          const b = profile.bosses[id];
          b.killsThisCycle = 0;
          b.bestFraction = 0;
          b.milestones = 0;
        }
      }
    }
  }

  const t = profile.totals;
  if (t) {
    if (Number.isFinite(reward.duration)) t.playTime += Math.max(0, reward.duration);
    t.embersEarned += nonNegInt(reward.embers);
    if (reward.victory) t.kills += 1;
    else t.deaths += 1;
  }
}

/**
 * 도전 횟수 +1(다음 보스전 시드의 재료이기도 하다). 모르는 bossId는 무시한다.
 * @param {Profile} profile
 * @param {BossId} bossId
 */
export function noteAttempt(profile, bossId) {
  const bp = progressOf(profile, bossId);
  if (bp) bp.attempts += 1;
}
