// OWNER: P4 — 계약 §6.6 · §7.4
// 능력치 곡선 · 레벨업 비용 · 미리보기. 수치는 전부 data/(STATS · ECONOMY · PLAYER.base · WEAPONS · RELICS)에서 읽는다.
import { STAT_IDS, WEAPON_IDS } from '../../core/constants.js';
import { PLAYER } from '../../data/player.js';
import { STATS } from '../../data/stats.js';
import { ECONOMY } from '../../data/economy.js';
import { RELICS } from '../../data/relics.js';
import { getWeaponDef } from '../../data/weapons.js';
import { tidy, clampInt, nonNegInt } from './num.js';

/** @typedef {import('../../types.js').Profile} Profile */
/** @typedef {import('../../types.js').StatBlock} StatBlock */
/** @typedef {import('../../types.js').StatId} StatId */
/** @typedef {import('../../types.js').WeaponId} WeaponId */

/** previewLevelUp.changes의 표시 순서(§6.6). */
const CHANGE_KEYS = ['hpMax', 'staminaMax', 'staminaRegen', 'damageMul', 'postureMul', 'critMul', 'executeMul', 'parryPosture'];

/** 능력치마다 그 점수가 타는 곡선들(diminished 판정용). @type {Record<StatId, number[][]>} */
const CURVES = {
  vit: [STATS.vit.hpPerPoint],
  end: [STATS.end.staminaPerPoint, STATS.end.regenPerPoint],
  str: [STATS.str.dmgPerPoint],
  dex: [STATS.dex.posturePerPoint, STATS.dex.critPerPoint, STATS.dex.executePerPoint],
};

/**
 * 구간별 합. 예: 17점 · [14, 9, 5] = 15×14 + 2×9.
 * @param {number} points
 * @param {number[]} perPoint 구간별 한 점의 값
 * @returns {number}
 */
function tiered(points, perPoint) {
  let sum = 0;
  let prev = 0;
  for (let i = 0; i < STATS.tiers.length; i++) {
    const n = Math.min(points, STATS.tiers[i]) - prev;
    if (n <= 0) break;
    sum += n * perPoint[i];
    prev = STATS.tiers[i];
  }
  return sum;
}

/**
 * k번째 점(1부터)이 속한 구간 번호.
 * @param {number} k
 * @returns {number}
 */
function tierIndexOf(k) {
  for (let i = 0; i < STATS.tiers.length; i++) if (k <= STATS.tiers[i]) return i;
  return STATS.tiers.length - 1;
}

/**
 * @param {Profile} profile
 * @param {StatId} statId
 * @returns {number} 0..maxPoints 정수(깨진 값은 0)
 */
function pointsIn(profile, statId) {
  return clampInt(profile?.stats?.[statId], 0, STATS.maxPoints, 0);
}

/**
 * 강화 단계의 무기 피해 = baseDamage × (1 + dmgPerLevel × level). 대장장이의 현재/다음 단계 표시와 같은 식이다.
 * @param {WeaponId} weaponId
 * @param {number} level
 * @returns {number} 모르는 무기면 0
 */
export function weaponDamageAt(weaponId, level) {
  const w = getWeaponDef(weaponId);
  if (!w) return 0;
  return tidy(w.baseDamage * (1 + ECONOMY.weapon.dmgPerLevel * level));
}

/**
 * 장착 유물을 블록에 얹는다. 더하기 → 곱하기 → 덮어쓰기 순서라 두 칸의 순서가 결과를 바꾸지 않는다.
 * @param {StatBlock} block
 * @param {(string|null)[]} equipped
 */
function applyRelics(block, equipped) {
  if (!Array.isArray(equipped)) return;
  /** @type {import('../../types.js').RelicDef[]} */
  const defs = [];
  for (let i = 0; i < equipped.length && defs.length < ECONOMY.relicSlots; i++) {
    const id = equipped[i];
    if (typeof id !== 'string' || !Object.hasOwn(RELICS, id)) continue;
    if (!defs.includes(RELICS[id])) defs.push(RELICS[id]);   // 같은 유물이 두 번 들어와도 한 번만
  }
  for (const d of defs) for (const k of Object.keys(d.mods)) block[k] += d.mods[k];
  for (const d of defs) for (const k of Object.keys(d.mul)) block[k] *= d.mul[k];
  for (const d of defs) for (const k of Object.keys(d.set)) block[k] = d.set[k];
}

/**
 * 파생 능력치(유물 반영). 깨진 프로필에서도 던지지 않는다(범위 밖 값은 잘라서 읽는다).
 * @param {Profile} profile
 * @returns {StatBlock}
 */
export function computeStatBlock(profile) {
  const vit = pointsIn(profile, 'vit');
  const end = pointsIn(profile, 'end');
  const str = pointsIn(profile, 'str');
  const dex = pointsIn(profile, 'dex');
  const weaponId = WEAPON_IDS.includes(profile?.equippedWeapon) ? profile.equippedWeapon : WEAPON_IDS[0];
  const w = getWeaponDef(weaponId);
  const weaponLevel = clampInt(profile?.weapons?.[weaponId]?.level, 0, ECONOMY.weapon.maxLevel, 0);
  const base = PLAYER.base;
  const shop = ECONOMY.shop;
  const posture = 1 + tiered(dex, STATS.dex.posturePerPoint);

  /** @type {StatBlock} */
  const block = {
    level: 1 + vit + end + str + dex,
    hpMax: base.hp + tiered(vit, STATS.vit.hpPerPoint),
    staminaMax: base.stamina + tiered(end, STATS.end.staminaPerPoint),
    staminaRegen: base.staminaRegen + tiered(end, STATS.end.regenPerPoint),
    weaponId,
    weaponLevel,
    weaponDamage: weaponDamageAt(weaponId, weaponLevel),
    damageMul: 1 + tiered(str, STATS.str.dmgPerPoint),
    postureMul: posture * (1 + ECONOMY.weapon.posturePerLevel * weaponLevel),
    critMul: STATS.dex.critBase + tiered(dex, STATS.dex.critPerPoint),
    executeMul: 1 + tiered(dex, STATS.dex.executePerPoint),
    guardReduction: w.guardReduction,
    guardStaminaFactor: w.guardStaminaFactor,
    flaskCharges: base.flaskCharges + clampInt(profile?.flaskChargeLv, 0, shop.flaskCharge.prices.length, 0),
    flaskHeal: base.flaskHeal + shop.flaskHeal.perLevel * clampInt(profile?.flaskHealLv, 0, shop.flaskHeal.prices.length, 0),
    parryWindow: base.parryWindow,
    parryPosture: base.parryPosture * posture,
    postRollDmgMul: 1,
    postRollWindow: 0,
    lifesteal: 0,
    lowHpThreshold: 0,
    lowHpDmgMul: 1,
    emberGainMul: 1,
  };
  applyRelics(block, profile?.relicsEquipped);
  for (const k of Object.keys(block)) {
    if (typeof block[k] === 'number') block[k] = tidy(block[k]);
  }
  return block;
}

/**
 * 투자 점수 합.
 * @param {Profile} profile
 * @returns {number}
 */
export function totalPoints(profile) {
  let sum = 0;
  for (const id of STAT_IDS) sum += pointsIn(profile, id);
  return sum;
}

/**
 * 레벨업 비용(잔불) = round(base + linear·n + quad·n²). points = 지금까지 투자한 점수 합(능력치 구분 없음).
 * @param {number} points
 * @returns {number}
 */
export function levelUpCost(points) {
  const n = nonNegInt(points);
  const c = STATS.levelCost;
  return Math.round(c.base + c.linear * n + c.quad * n * n);
}

/**
 * 보유 잔불로 연속해서 살 수 있는 레벨업 횟수(어느 능력치든 — 비용은 점수 합에만 달렸다).
 * 전 능력치 상한까지 남은 점수를 넘지 않는다.
 * @param {Profile} profile
 * @returns {number}
 */
export function affordableLevelUps(profile) {
  let n = totalPoints(profile);
  const cap = STATS.maxPoints * STAT_IDS.length;
  let embers = nonNegInt(profile?.embers);
  let count = 0;
  while (n < cap) {
    const cost = levelUpCost(n);
    if (embers < cost) break;
    embers -= cost;
    n += 1;
    count += 1;
  }
  return count;
}

/**
 * 레벨업 미리보기 — 화톳불 패널이 계산 없이 그대로 그린다.
 * @param {Profile} profile
 * @param {StatId} statId
 * @returns {{cost:number, canAfford:boolean, maxed:boolean, before:StatBlock, after:StatBlock,
 *            changes:{key:string, before:number, after:number}[], diminished:boolean,
 *            nextCost:number|null, affordableCount:number}}
 *   cost: 지금 한 점의 비용(능력치와 무관). canAfford: 상한이 아니고 잔불이 닿는가
 *   changes: 바뀌는 StatBlock 필드만, 표시 순서대로(hpMax · staminaMax · staminaRegen · damageMul · postureMul ·
 *            critMul · executeMul · parryPosture). 상한이면 빈 배열(after = before)
 *   diminished: 이번 한 점의 증가분이 직전 한 점보다 작은가(구간 경계 15 · 30점을 넘는 순간)
 *   nextCost: 이번에 올린 뒤의 다음 비용(전 능력치가 상한이면 null). 이 능력치가 상한이면 올릴 것이 없으므로 지금 비용 그대로
 *   affordableCount: = affordableLevelUps(profile)
 */
export function previewLevelUp(profile, statId) {
  const total = totalPoints(profile);
  const cost = levelUpCost(total);
  const before = computeStatBlock(profile);
  const valid = STAT_IDS.includes(statId);
  const cur = valid ? pointsIn(profile, statId) : 0;
  const raisable = valid && cur < STATS.maxPoints;
  const after = raisable
    ? computeStatBlock({ ...profile, stats: { ...profile.stats, [statId]: cur + 1 } })
    : { ...before };

  const changes = [];
  for (const key of CHANGE_KEYS) {
    if (after[key] !== before[key]) changes.push({ key, before: before[key], after: after[key] });
  }

  let diminished = false;
  if (raisable && cur >= 1) {
    const now = tierIndexOf(cur);
    const next = tierIndexOf(cur + 1);
    diminished = CURVES[statId].some((curve) => curve[next] < curve[now]);
  }

  const totalAfter = total + (raisable ? 1 : 0);
  return {
    cost,
    canAfford: raisable && nonNegInt(profile?.embers) >= cost,
    maxed: valid && !raisable,
    before,
    after,
    changes,
    diminished,
    nextCost: totalAfter < STATS.maxPoints * STAT_IDS.length ? levelUpCost(totalAfter) : null,
    affordableCount: affordableLevelUps(profile),
  };
}
