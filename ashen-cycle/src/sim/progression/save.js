// OWNER: P4 — 계약 §6.6
// 세이브의 직렬화 · 이주 · 정화 · 검증. 읽기 쪽은 어떤 입력(잘린 JSON · 옛 버전 · 범위 밖 값 · 모르는 ID)에서도 던지지 않는다.
// localStorage 읽기/쓰기는 app/storage.js(P9)가 한다 — sim은 저장소 · 시계를 모른다(savedAt은 app이 넘긴다).
import { SAVE_VERSION, BOSS_IDS, WEAPON_IDS, STAT_IDS } from '../../core/constants.js';
import { clamp, clamp01 } from '../../core/math2d.js';
import { STATS } from '../../data/stats.js';
import { ECONOMY } from '../../data/economy.js';
import { RELICS } from '../../data/relics.js';
import { DEFAULT_SETTINGS, SETTINGS_RANGE, QUALITY } from '../../data/settings.js';
import { createNewProfile } from './profile.js';
import { clampInt, nonNegInt, isPlainObject } from './num.js';

/** @typedef {import('../../types.js').Profile} Profile */
/** @typedef {import('../../types.js').BossProgress} BossProgress */
/** @typedef {import('../../types.js').SaveData} SaveData */
/** @typedef {import('../../types.js').Settings} Settings */

const UINT32_MAX = 0xffffffff;

/** @param {any} v @returns {boolean} */
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/** @param {any} id @returns {boolean} 아는 유물 id인가(상속 속성 이름은 거른다) */
const isRelicId = (id) => typeof id === 'string' && Object.hasOwn(RELICS, id);

/**
 * @param {Profile} profile
 * @param {number} savedAt epoch ms(app이 채운다)
 * @returns {SaveData} 깊은 복사
 */
export function createSaveData(profile, savedAt) {
  return { version: SAVE_VERSION, savedAt: isFiniteNumber(savedAt) ? savedAt : 0, profile: structuredClone(profile) };
}

/**
 * @param {SaveData} save
 * @returns {string} JSON
 */
export function serializeSave(save) {
  return JSON.stringify(save);
}

/**
 * @param {string} text
 * @returns {Object|null} JSON이 깨졌거나 객체가 아니면 null
 */
export function parseSave(text) {
  if (typeof text !== 'string') return null;
  try {
    const raw = JSON.parse(text);
    return isPlainObject(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * v0(공개 전 형태) → v1. v0은 래퍼 없이 프로필 필드가 최상위에 펼쳐져 있고 이름이 달랐다:
 *   weapon · weaponLevels{id: n} · flask{charges, heal} · relics · relicSlots · bosses[id].kills / .best. totals는 없었다.
 * 값의 범위는 여기서 보지 않는다 — sanitizeProfile의 일이다.
 * @param {any} raw
 * @returns {Object|null} v1 모양. v0으로 볼 수 없으면 null
 */
function migrateV0(raw) {
  if (!isPlainObject(raw.stats)) return null;
  /** @type {Record<string, {level:any}>} */
  const weapons = {};
  if (isPlainObject(raw.weaponLevels)) {
    for (const id of WEAPON_IDS) weapons[id] = { level: raw.weaponLevels[id] };
  }
  /** @type {Record<string, Object>} */
  const bosses = {};
  if (isPlainObject(raw.bosses)) {
    for (const id of BOSS_IDS) {
      const b = raw.bosses[id];
      if (!isPlainObject(b)) continue;
      bosses[id] = {
        unlocked: b.unlocked, attempts: b.attempts, totalKills: b.kills,
        killsThisCycle: b.killsThisCycle, bestFraction: b.best, milestones: b.milestones,
      };
    }
  }
  const flask = isPlainObject(raw.flask) ? raw.flask : {};
  return {
    version: 1,
    savedAt: raw.savedAt,
    profile: {
      embers: raw.embers, shards: raw.shards, stats: raw.stats,
      weapons, equippedWeapon: raw.weapon,
      flaskChargeLv: flask.charges, flaskHealLv: flask.heal,
      relicsOwned: raw.relics, relicsEquipped: raw.relicSlots,
      cycle: raw.cycle, bosses, seed: raw.seed,
    },
  };
}

/** MIGRATIONS[v] = v → v + 1. 버전을 올릴 때 여기에 한 칸씩 더한다. */
const MIGRATIONS = [migrateV0];

/**
 * raw.version → SAVE_VERSION까지 순차 변환. version이 없으면 v0으로 본다.
 * @param {Object} raw
 * @returns {SaveData|null} 미래 버전 · 모르는 형태면 null. profile은 아직 정화 전이다
 */
export function migrateSave(raw) {
  try {
    if (!isPlainObject(raw)) return null;
    let version = raw.version === undefined ? 0 : raw.version;
    if (!Number.isInteger(version) || version < 0 || version > SAVE_VERSION) return null;
    let cur = raw;
    while (version < SAVE_VERSION) {
      cur = MIGRATIONS[version](cur);
      if (cur === null) return null;
      version += 1;
    }
    if (!isPlainObject(cur.profile)) return null;
    return { version: SAVE_VERSION, savedAt: isFiniteNumber(cur.savedAt) ? cur.savedAt : 0, profile: cur.profile };
  } catch {
    return null;
  }
}

/**
 * createNewProfile() 위에 병합(빠진 필드는 기본값)하고 범위로 자른다:
 *   stats 0..STATS.maxPoints 정수 · weapon level 0..10 · flaskChargeLv 0..3 · flaskHealLv 0..5 ·
 *   embers/shards/cycle ≥ 0 정수(NaN → 0) · 모르는 유물 id 제거 · relicsEquipped는 보유한 것만(중복 금지) ·
 *   equippedWeapon이 무효면 'longsword' · bosses.valder.unlocked는 항상 true
 * 입력을 고치지 않고 새 객체를 돌려준다. 객체가 아니면 새 프로필.
 * @param {Profile} profile
 * @returns {Profile}
 */
export function sanitizeProfile(profile) {
  const src = isPlainObject(profile) ? /** @type {any} */ (profile) : {};
  const out = createNewProfile(isFiniteNumber(src.seed) ? clamp(Math.floor(src.seed), 0, UINT32_MAX) : undefined);

  out.embers = nonNegInt(src.embers);
  out.shards = nonNegInt(src.shards);
  out.cycle = nonNegInt(src.cycle);

  const stats = isPlainObject(src.stats) ? src.stats : {};
  for (const id of STAT_IDS) out.stats[id] = clampInt(stats[id], 0, STATS.maxPoints, 0);

  const weapons = isPlainObject(src.weapons) ? src.weapons : {};
  for (const id of WEAPON_IDS) {
    out.weapons[id].level = clampInt(isPlainObject(weapons[id]) ? weapons[id].level : undefined, 0, ECONOMY.weapon.maxLevel, 0);
  }
  if (WEAPON_IDS.includes(src.equippedWeapon)) out.equippedWeapon = src.equippedWeapon;

  out.flaskChargeLv = clampInt(src.flaskChargeLv, 0, ECONOMY.shop.flaskCharge.prices.length, 0);
  out.flaskHealLv = clampInt(src.flaskHealLv, 0, ECONOMY.shop.flaskHeal.prices.length, 0);

  if (Array.isArray(src.relicsOwned)) {
    for (const id of src.relicsOwned) {
      if (isRelicId(id) && !out.relicsOwned.includes(id)) out.relicsOwned.push(id);
    }
  }
  const equipped = Array.isArray(src.relicsEquipped) ? src.relicsEquipped : [];
  for (let slot = 0; slot < ECONOMY.relicSlots; slot++) {
    const id = equipped[slot];
    out.relicsEquipped[slot] = out.relicsOwned.includes(id) && !out.relicsEquipped.includes(id) ? id : null;
  }

  const bosses = isPlainObject(src.bosses) ? src.bosses : {};
  BOSS_IDS.forEach((id, i) => {
    const b = isPlainObject(bosses[id]) ? bosses[id] : {};
    const o = out.bosses[id];
    o.unlocked = i === 0 || b.unlocked === true;
    o.attempts = nonNegInt(b.attempts);
    o.totalKills = nonNegInt(b.totalKills);
    o.killsThisCycle = nonNegInt(b.killsThisCycle);
    o.bestFraction = isFiniteNumber(b.bestFraction) ? clamp01(b.bestFraction) : 0;
    o.milestones = clampInt(b.milestones, 0, ECONOMY.shardMilestones.length, 0);
  });

  const totals = isPlainObject(src.totals) ? src.totals : {};
  out.totals.deaths = nonNegInt(totals.deaths);
  out.totals.kills = nonNegInt(totals.kills);
  out.totals.embersEarned = nonNegInt(totals.embersEarned);
  out.totals.playTime = isFiniteNumber(totals.playTime) ? Math.max(0, totals.playTime) : 0;

  return out;
}

/**
 * DEFAULT_SETTINGS 위에 병합 + 범위 clamp(data/settings.js의 SETTINGS_RANGE). 모르는 quality → 기본값.
 * 모르는 키는 버리고, 타입이 다른 값은 기본값으로 돌린다. 항상 새 객체를 돌려준다.
 * @param {Partial<Settings>} settings
 * @returns {Settings}
 */
export function sanitizeSettings(settings) {
  const src = isPlainObject(settings) ? /** @type {any} */ (settings) : {};
  /** @type {any} */
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const v = src[key];
    const def = DEFAULT_SETTINGS[key];
    if (Object.hasOwn(SETTINGS_RANGE, key)) {
      if (isFiniteNumber(v)) out[key] = clamp(v, SETTINGS_RANGE[key][0], SETTINGS_RANGE[key][1]);
    } else if (key === 'quality') {
      if (typeof v === 'string' && Object.hasOwn(QUALITY, v)) out[key] = v;
    } else if (typeof v === typeof def && (typeof v !== 'number' || Number.isFinite(v))) {
      out[key] = v;
    }
  }
  return out;
}

/**
 * 프로필이 §3.9의 모양과 범위를 지키는가. sanitizeProfile의 결과는 항상 통과한다.
 * @param {Profile} profile
 * @returns {string[]} 오류 목록. 빈 배열이면 통과
 */
export function validateProfile(profile) {
  /** @type {string[]} */
  const errors = [];
  if (!isPlainObject(profile)) return ['profile: 객체가 아니다'];
  const p = /** @type {any} */ (profile);

  /** @param {string} path @param {any} v @param {number} [max] */
  const int = (path, v, max = Number.MAX_SAFE_INTEGER) => {
    if (!Number.isInteger(v) || v < 0 || v > max) errors.push(`${path}: 0..${max} 정수가 아니다(${v})`);
  };

  int('embers', p.embers);
  int('shards', p.shards);
  int('cycle', p.cycle);
  int('seed', p.seed, UINT32_MAX);
  int('flaskChargeLv', p.flaskChargeLv, ECONOMY.shop.flaskCharge.prices.length);
  int('flaskHealLv', p.flaskHealLv, ECONOMY.shop.flaskHeal.prices.length);

  if (!isPlainObject(p.stats)) errors.push('stats: 객체가 아니다');
  else for (const id of STAT_IDS) int(`stats.${id}`, p.stats[id], STATS.maxPoints);

  if (!isPlainObject(p.weapons)) errors.push('weapons: 객체가 아니다');
  else {
    for (const id of WEAPON_IDS) {
      if (!isPlainObject(p.weapons[id])) errors.push(`weapons.${id}: 없다`);
      else int(`weapons.${id}.level`, p.weapons[id].level, ECONOMY.weapon.maxLevel);
    }
  }
  if (!WEAPON_IDS.includes(p.equippedWeapon)) errors.push(`equippedWeapon: 모르는 무기(${p.equippedWeapon})`);

  const owned = Array.isArray(p.relicsOwned) ? p.relicsOwned : null;
  if (!owned) errors.push('relicsOwned: 배열이 아니다');
  else {
    owned.forEach((id, i) => {
      if (!isRelicId(id)) errors.push(`relicsOwned[${i}]: 모르는 유물(${id})`);
      else if (owned.indexOf(id) !== i) errors.push(`relicsOwned[${i}]: 중복(${id})`);
    });
  }
  if (!Array.isArray(p.relicsEquipped) || p.relicsEquipped.length !== ECONOMY.relicSlots) {
    errors.push(`relicsEquipped: 길이 ${ECONOMY.relicSlots}의 배열이 아니다`);
  } else {
    p.relicsEquipped.forEach((id, i) => {
      if (id === null) return;
      if (!owned || !owned.includes(id)) errors.push(`relicsEquipped[${i}]: 보유하지 않은 유물(${id})`);
      else if (p.relicsEquipped.indexOf(id) !== i) errors.push(`relicsEquipped[${i}]: 중복(${id})`);
    });
  }

  if (!isPlainObject(p.bosses)) errors.push('bosses: 객체가 아니다');
  else {
    BOSS_IDS.forEach((id, i) => {
      const b = p.bosses[id];
      if (!isPlainObject(b)) {
        errors.push(`bosses.${id}: 없다`);
        return;
      }
      if (typeof b.unlocked !== 'boolean') errors.push(`bosses.${id}.unlocked: 불리언이 아니다`);
      else if (i === 0 && !b.unlocked) errors.push(`bosses.${id}.unlocked: 첫 보스는 항상 열려 있어야 한다`);
      int(`bosses.${id}.attempts`, b.attempts);
      int(`bosses.${id}.totalKills`, b.totalKills);
      int(`bosses.${id}.killsThisCycle`, b.killsThisCycle);
      int(`bosses.${id}.milestones`, b.milestones, ECONOMY.shardMilestones.length);
      if (!isFiniteNumber(b.bestFraction) || b.bestFraction < 0 || b.bestFraction > 1) {
        errors.push(`bosses.${id}.bestFraction: 0..1이 아니다(${b.bestFraction})`);
      }
    });
  }

  if (!isPlainObject(p.totals)) errors.push('totals: 객체가 아니다');
  else {
    int('totals.deaths', p.totals.deaths);
    int('totals.kills', p.totals.kills);
    int('totals.embersEarned', p.totals.embersEarned);
    if (!isFiniteNumber(p.totals.playTime) || p.totals.playTime < 0) errors.push(`totals.playTime: 0 이상의 수가 아니다(${p.totals.playTime})`);
  }
  return errors;
}

/**
 * 전체 사슬: parseSave → migrateSave → sanitizeProfile → validateProfile. 어느 단계든 실패하면 null. 던지지 않는다.
 * @param {string} text
 * @returns {SaveData|null}
 */
export function loadProfileFromText(text) {
  try {
    const raw = parseSave(text);
    if (raw === null) return null;
    const save = migrateSave(raw);
    if (save === null) return null;
    const profile = sanitizeProfile(save.profile);
    if (validateProfile(profile).length > 0) return null;
    return { version: save.version, savedAt: save.savedAt, profile };
  } catch {
    return null;
  }
}
