// OWNER: P4 — 계약 §6.7 · §7.9 · §3.6
// 프로필 만들기 · 세이브에서 읽은 프로필 정리(sanitizeProfile — 던지지 않는다) · 개발용 프로필.

import { BAIT_IDS, HINT_IDS, SET_IDS, SKILL_IDS, TICKS_PER_DAY, TICKS_PER_HOUR, TIERS } from '../../core/constants.js';
import { CAST } from '../../data/bite.js';
import { HOLD, LIMITS, START, XP } from '../../data/economy.js';
import { GEAR, GEAR_BY_ID } from '../../data/gear.js';
import { SPECIES_BY_ID } from '../../data/species/index.js';
import { SPOTS_BY_ID } from '../../data/stages/index.js';
import { computeModifiers, SKILL_MAX_RANK } from './modifiers.js';
import { cumulativeXp, xpToNext } from './progress.js';

const HOURS_PER_DAY = TICKS_PER_DAY / TICKS_PER_HOUR;

/** @typedef {import('../../types.js').Profile} Profile */
/** @typedef {import('../../types.js').CatchRecord} CatchRecord */
/** @typedef {import('../../types.js').DexEntry} DexEntry */

/** §7.9 START 그대로 @returns {Profile} */
export function createNewProfile() {
  /** @type {Record<string, 0|1|2|3>} */
  const skills = {};
  for (const id of SKILL_IDS) skills[id] = 0;
  return {
    money: START.money,
    level: START.level,
    xp: 0,
    xpTotal: 0,
    skillPoints: START.skillPoints,
    skills: /** @type {any} */ (skills),
    owned: {},
    baits: /** @type {any} */ ({ ...START.baits }),
    sets: {
      float: { ...START.sets.float },
      bottom: { ...START.sets.bottom },
    },
    hold: [],
    dex: {},
    flags: { hints: {}, freeBaitDay: 0 },
    stats: { landed: 0, lost: 0, released: 0, sold: 0, earned: 0, casts: 0 },
    nextUid: 1,
  };
}

// ── 정리 도구(던지지 않는다)

/** @param {any} v @returns {v is Record<string, any>} */
function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 유한수면 [lo, hi]로 자른 값, 아니면 def @param {any} v @param {number} lo @param {number} hi @param {number} def */
function num(v, lo, hi, def) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return def;
  return v < lo ? lo : v > hi ? hi : v;
}

/** 정수로 반올림한 num @param {any} v @param {number} lo @param {number} hi @param {number} def */
function int(v, lo, hi, def) {
  return Math.round(num(v, lo, hi, def));
}

/** @param {any} v @param {string[]} allowed @param {any} def */
function oneOf(v, allowed, def) {
  return allowed.includes(v) ? v : def;
}

/** 그 슬롯(· 로드면 그 세트)의 장비 ID 면 그대로, 아니면 def @param {any} id @param {string} slot @param {string|null} set @param {string} def */
function gearOf(id, slot, set, def) {
  const g = typeof id === 'string' ? GEAR_BY_ID[id] : undefined;
  if (!g || g.slot !== slot) return def;
  if (slot === 'rod' && g.set !== set) return def;
  return g.id;
}

/** 그 슬롯 · 세트의 1단계 장비 ID(데이터에서 찾는다 — 세트 전용은 로드뿐) @param {string} slot @param {string} set @returns {string|null} */
export function tier1Gear(slot, set) {
  const g = GEAR.find(x => x.slot === slot && x.tier === 1 && (x.set === null || x.set === set));
  return g ? g.id : null;
}

/** 어창 기록 하나 — 모르는 어종 · 모양이 깨진 기록은 null @param {any} r @returns {CatchRecord|null} */
function sanitizeRecord(r) {
  if (!isObj(r)) return null;
  const sp = typeof r.speciesId === 'string' ? SPECIES_BY_ID[r.speciesId] : undefined;
  if (!sp) return null;
  if (typeof r.uid !== 'number' || !Number.isInteger(r.uid) || r.uid < 1) return null;
  const weightKg = num(r.weightKg, 0, Infinity, NaN);
  const lengthCm = num(r.lengthCm, 0, Infinity, NaN);
  if (!(weightKg > 0) || !(lengthCm > 0)) return null;
  const tier = oneOf(r.tier, TIERS, null);
  if (tier === null) return null;
  const price = int(r.price, 0, LIMITS.moneyMax, Math.round(sp.pricePerKg * weightKg * sp.priceMul[tier]));
  const xpKeep = int(r.xpKeep, 0, LIMITS.xpMax, 0);
  const spotId = typeof r.spotId === 'string' && SPOTS_BY_ID[r.spotId] ? r.spotId : '';
  return {
    uid: r.uid,
    speciesId: sp.id,
    lengthCm,
    weightKg,
    pct: num(r.pct, 0, 1, 0.5),
    tier,
    price,
    xpKeep,
    xpRelease: int(r.xpRelease, 0, LIMITS.xpMax, Math.round(xpKeep * XP.releaseMul)),
    firstCatch: r.firstCatch === true,
    recordWeight: r.recordWeight === true,
    stageId: sp.stage,
    spotId,
    day: int(r.day, 1, LIMITS.statMax, 1),
    hour: num(r.hour, 0, HOURS_PER_DAY, 0) % HOURS_PER_DAY,
    set: oneOf(r.set, SET_IDS, 'float'),
    fightSec: num(r.fightSec, 0, LIMITS.statMax, 0),
  };
}

/** @param {any} e @returns {DexEntry|null} */
function sanitizeDexEntry(e) {
  if (!isObj(e)) return null;
  const count = int(e.count, 0, LIMITS.statMax, 0);
  if (count < 1) return null;
  return {
    count,
    maxKg: num(e.maxKg, 0, Infinity, 0),
    maxCm: num(e.maxCm, 0, Infinity, 0),
    firstDay: int(e.firstDay, 1, LIMITS.statMax, 1),
    trophies: int(e.trophies, 0, count, 0),
    legends: int(e.legends, 0, count, 0),
    best: oneOf(e.best, TIERS, 'normal'),
  };
}

/**
 * 세이브에서 읽은 프로필을 정리한다. 던지지 않는다: 모르는 키 제거 · 숫자 범위 자르기 ·
 * 없는 장비/미끼/어종 ID 제거(세트 슬롯은 1단계로) · 보유 수보다 많이 끼운 장비는 1단계로 · 어창 ≤ capacity ·
 * level/xp 정합(xp < xpToNext · 캡이면 0 · xpTotal ≥ 그 레벨까지의 누적) · 스킬 포인트 ≤ 받은 포인트 − 쓴 포인트 · 돈 ≥ 0.
 * @param {any} raw @returns {Profile}
 */
export function sanitizeProfile(raw) {
  const p = createNewProfile();
  if (!isObj(raw)) return p;

  p.money = int(raw.money, 0, LIMITS.moneyMax, START.money);

  // 레벨 · 경험치
  p.level = int(raw.level, 1, XP.levelCap, START.level);
  const need = xpToNext(p.level);
  p.xp = Number.isFinite(need) ? int(raw.xp, 0, need - 1, 0) : 0;
  const floorTotal = cumulativeXp(p.level) + p.xp;
  p.xpTotal = Math.max(floorTotal, int(raw.xpTotal, 0, LIMITS.xpMax, floorTotal));

  // 스킬 · 포인트(받은 포인트 = 시작 + (레벨 − 1) × 레벨당)
  const rawSkills = isObj(raw.skills) ? raw.skills : {};
  let spent = 0;
  for (const id of SKILL_IDS) {
    const r = /** @type {0|1|2|3} */ (int(rawSkills[id], 0, SKILL_MAX_RANK, 0));
    p.skills[id] = r;
    spent += r;
  }
  const earned = START.skillPoints + (p.level - 1) * XP.pointsPerLevel;
  p.skillPoints = Math.min(int(raw.skillPoints, 0, LIMITS.statMax, 0), Math.max(0, earned - spent));

  // 보유 장비(2·3단계 · 라인 제외 — 라인은 감기만)
  const rawOwned = isObj(raw.owned) ? raw.owned : {};
  for (const id of Object.keys(rawOwned)) {
    const g = GEAR_BY_ID[id];
    if (!g || g.tier === 1 || g.slot === 'line') continue;
    const n = int(rawOwned[id], 0, LIMITS.ownedMax, 0);
    if (n > 0) p.owned[id] = n;
  }

  // 미끼
  const rawBaits = isObj(raw.baits) ? raw.baits : {};
  for (const id of BAIT_IDS) p.baits[id] = int(rawBaits[id], 0, LIMITS.baitMax, 0);

  // 세트 — 슬롯마다 맞는 장비 · 보유 수 안에서만(넘치면 1단계로)
  const mods = computeModifiers(p);
  const rawSets = isObj(raw.sets) ? raw.sets : {};
  /** @type {Record<string, number>} */
  const used = {};
  const take = (id, slot, set) => {
    const g = GEAR_BY_ID[id];
    if (!g || g.tier === 1) return id;
    const have = p.owned[id] ?? 0;
    if ((used[id] ?? 0) < have) {
      used[id] = (used[id] ?? 0) + 1;
      return id;
    }
    return /** @type {string} */ (tier1Gear(slot, set));
  };
  for (const set of SET_IDS) {
    const def = START.sets[set];
    const rs = isObj(rawSets[set]) ? rawSets[set] : {};
    const cfg = p.sets[set];
    cfg.rod = take(gearOf(rs.rod, 'rod', set, def.rod), 'rod', set);
    cfg.reel = take(gearOf(rs.reel, 'reel', set, def.reel), 'reel', set);
    cfg.hook = gearOf(rs.hook, 'hook', set, def.hook);
    cfg.float = set === 'float' ? take(gearOf(rs.float, 'float', set, /** @type {string} */ (def.float)), 'float', set) : null;
    cfg.sinker = set === 'bottom' ? take(gearOf(rs.sinker, 'sinker', set, /** @type {string} */ (def.sinker)), 'sinker', set) : null;
    cfg.bait = oneOf(rs.bait, BAIT_IDS, def.bait);
    cfg.lineId = gearOf(rs.lineId, 'line', set, def.lineId);
    const cap = GEAR_BY_ID[cfg.reel].capacityM;
    cfg.lineM = num(rs.lineM, 0, cap, cap);
    cfg.depthM = num(rs.depthM, CAST.depthMinM, CAST.depthMaxM, def.depthM);
    cfg.dragNotch = int(rs.dragNotch, 0, mods.dragNotches, Math.min(def.dragNotch, mods.dragNotches));
  }

  // 어창 — 모양이 맞는 기록만 · uid 중복 없이 · capacity 까지
  const seen = new Set();
  if (Array.isArray(raw.hold)) {
    for (const r of raw.hold) {
      if (p.hold.length >= HOLD.capacity) break;
      const rec = sanitizeRecord(r);
      if (!rec || seen.has(rec.uid)) continue;
      seen.add(rec.uid);
      p.hold.push(rec);
    }
  }

  // 도감 — 아는 어종만
  if (isObj(raw.dex)) {
    for (const id of Object.keys(raw.dex)) {
      if (!SPECIES_BY_ID[id]) continue;
      const e = sanitizeDexEntry(raw.dex[id]);
      if (e) p.dex[id] = e;
    }
  }

  // 플래그
  const rawFlags = isObj(raw.flags) ? raw.flags : {};
  const rawHints = isObj(rawFlags.hints) ? rawFlags.hints : {};
  for (const id of HINT_IDS) if (rawHints[id] === true) p.flags.hints[id] = true;
  p.flags.freeBaitDay = int(rawFlags.freeBaitDay, 0, LIMITS.statMax, 0);

  // 통계
  const rawStats = isObj(raw.stats) ? raw.stats : {};
  for (const k of Object.keys(p.stats)) p.stats[k] = int(rawStats[k], 0, LIMITS.statMax, 0);

  // 다음 uid — 어창의 어느 uid 보다 크다
  let maxUid = 0;
  for (const r of p.hold) if (r.uid > maxUid) maxUid = r.uid;
  p.nextUid = Math.max(maxUid + 1, int(raw.nextUid, 1, LIMITS.statMax, 1));

  return p;
}

/**
 * 개발용 프로필 — level 이면 그 레벨 · skillPoints = 누적 지급분(= level) · xp 0 · xpTotal = 그 레벨까지의 누적. money 면 그 돈.
 * @param {{level?:number|null, money?:number|null}} opts @returns {Profile}
 */
export function makeDevProfile({ level, money } = {}) {
  const p = createNewProfile();
  if (typeof level === 'number' && Number.isFinite(level)) {
    const lv = Math.max(1, Math.min(XP.levelCap, Math.round(level)));
    p.level = lv;
    p.skillPoints = START.skillPoints + (lv - 1) * XP.pointsPerLevel;
    p.xp = 0;
    p.xpTotal = cumulativeXp(lv);
  }
  if (typeof money === 'number' && Number.isFinite(money)) p.money = Math.max(0, Math.min(LIMITS.moneyMax, Math.round(money)));
  return p;
}
