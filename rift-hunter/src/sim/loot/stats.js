// OWNER: P5 — 계약 §5.6 · §6.10 · §3.8
// STUB — W0 에 완성으로 내는 것: computeStats · DRa · DRr · powerScore · weaponVisual(최소 부트 · 고정 상태 · 다른 패키지 테스트가 실제 시트를 쓴다)
// 캐릭터 시트 · 감소 식. 아이템 옵션 · 패시브 stats · 세트 효과는 퍼센트 숫자 → PlayerStats 는 0..1(퍼센트 키는 /100 · 고정값 키는 그대로).

import { CLASS_IDS, DMG_TYPES, EQUIP_SLOTS } from '../../core/constants.js';
import { COMBAT } from '../../data/combat.js';
import { CLASSES_BY_ID, BASES_BY_ID, ITEM_AFFIXES_BY_ID, SETS_BY_ID, SKILL_NODES_BY_ID, getClass } from '../../data/index.js';
import { FIST } from '../../data/items.js';
import { GROWTH } from '../../data/rift.js';
import { BASIC_SKILLS } from '../../data/skills.js';

/** @typedef {import('../../types.js').PlayerStats} PlayerStats */
/** @typedef {import('../../types.js').CharacterState} CharacterState */
/** @typedef {import('../../types.js').Item} Item */

/** 고정값 StatKey(합 그대로) — 나머지 퍼센트 키는 /100 */
const FLAT_KEYS = new Set(['str', 'int', 'vit', 'lifeRegen', 'lifeOnHit', 'thorns', 'rageOnHit', 'armor', 'allRes', 'physRes', 'fireRes', 'coldRes', 'lightningRes', 'freezeAt']);

/**
 * 방어도 감소율(🔒 §7.14) = min(drCap, A / (A + armorK × GROWTH.item^(L−1)))
 * @param {number} armor @param {number} level
 */
export function DRa(armor, level) {
  const A = armor > 0 ? armor : 0;
  const L = Math.max(1, Number(level) || 1);
  return Math.min(COMBAT.drCap, A / (A + COMBAT.armorK * GROWTH.item ** (L - 1)));
}

/**
 * 저항 감소율(🔒 §7.14) = min(drCap, R / (R + resK × GROWTH.item^(L−1)))
 * @param {number} res @param {number} level
 */
export function DRr(res, level) {
  const R = res > 0 ? res : 0;
  const L = Math.max(1, Number(level) || 1);
  return Math.min(COMBAT.drCap, R / (R + COMBAT.resK * GROWTH.item ** (L - 1)));
}

/** 비교 · 봇 · 업그레이드 판정의 한 숫자 = √(sheetDps × ehp) @param {PlayerStats} stats */
export function powerScore(stats) {
  const v = (stats?.sheetDps ?? 0) * (stats?.ehp ?? 0);
  return v > 0 ? Math.sqrt(v) : 0;
}

/** view 용 무기 · 보조 외형 @param {Item|null|undefined} item @returns {{look:string, tier:number, rarity:string, hands:number}|null} */
export function weaponVisual(item) {
  if (!item) return null;
  const base = BASES_BY_ID[item.baseId];
  if (!base) return null;
  return { look: base.look, tier: item.tier ?? 0, rarity: item.rarity, hands: base.hands ?? 1 };
}

/** @param {Record<string, number>} sum @param {string} key @param {number} v */
function add(sum, key, v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return;
  sum[key] = (sum[key] ?? 0) + v;
}

/** 랭크별 배열에서 그 랭크의 값(배열이 짧으면 마지막) @param {number[]|number} arr @param {number} rank */
function atRank(arr, rank) {
  if (!Array.isArray(arr)) return typeof arr === 'number' ? arr : 0;
  if (!arr.length) return 0;
  return arr[Math.max(0, Math.min(arr.length, rank) - 1)];
}

/** 조건부 패시브 값 → PlayerStats 단위 키(allPct → dmgPct · 퍼센트 키 /100) */
function condKey(stat) { return stat === 'allPct' ? 'dmgPct' : stat === 'freezeAt' ? 'freezeAtReduce' : stat; }

/**
 * 캐릭터 시트(§5.6) — 내구도 0 아이템은 없는 것으로 친다 · char 가 null 이면 throw 하지 않고 전사 FIST · 레벨 1 시트
 * @param {CharacterState|null} char @param {{riftLevel?:number|null}} [opts] riftLevel = ehp 의 몬스터 레벨(기본 char.riftUnlocked)
 * @returns {PlayerStats}
 */
export function computeStats(char, { riftLevel = null } = {}) {
  const cls = char && CLASSES_BY_ID[char.cls] ? char.cls : CLASS_IDS[0];
  const C = getClass(cls);
  const level = Math.max(1, Math.floor(char?.level ?? 1));
  /** @type {Record<string, number>} */
  const sum = {};
  /** @type {Record<string, number>} */
  const skillPctRaw = {};
  let mainAdd = 0;
  let armorBase = 0;
  /** @type {string[]} */
  const broken = [];
  /** @type {string[]} */
  const hooks = [];
  /** @type {Record<string, number>} */
  const setCounts = {};
  const equip = char?.equip ?? {};

  /** @param {string} stat @param {number} v @param {string} [param] */
  const addStat = (stat, v, param) => {
    if (stat === 'str' || stat === 'int') {
      if (stat === C.mainStat) mainAdd += v;
      return;
    }
    if (stat === 'skillPct') {
      if (param) skillPctRaw[param] = (skillPctRaw[param] ?? 0) + v;
      return;
    }
    add(sum, stat, v);
  };

  for (const slot of EQUIP_SLOTS) {
    const item = equip[slot];
    if (!item) continue;
    if (!(item.dur > 0)) { broken.push(slot); continue; }
    armorBase += item.base?.armor ?? 0;
    for (const a of item.affixes ?? []) {
      const def = ITEM_AFFIXES_BY_ID[a.id];
      if (!def) continue;
      if (def.stat === 'weaponDmgPct') continue;   // 무기 로컬 — 아래 weapon 에서
      addStat(def.stat, a.value, a.param);
    }
    if (item.legendaryId) hooks.push(item.legendaryId);
    if (item.setId) setCounts[item.setId] = (setCounts[item.setId] ?? 0) + 1;
  }

  for (const setId of Object.keys(setCounts)) {
    const set = SETS_BY_ID[setId];
    if (!set) continue;
    const n = setCounts[setId];
    if (n >= 2) for (const k of Object.keys(set.bonus2)) addStat(k, set.bonus2[k]);
    if (n >= 4) for (const k of Object.keys(set.bonus4)) addStat(k, set.bonus4[k]);
  }

  /** @type {Record<string, number>} */
  const ranks = { ...(char?.skills?.ranks ?? {}) };
  /** @type {string[]} */
  const transforms = [];
  /** @type {Array<{cond:string, stats:Record<string, number>}>} */
  const conds = [];
  for (const id of Object.keys(ranks)) {
    const rank = ranks[id];
    const node = SKILL_NODES_BY_ID[id];
    if (!node || !(rank > 0)) continue;
    if (node.kind === 'transform') transforms.push(id);
    if (node.kind !== 'passive') continue;
    if (node.stats) for (const k of Object.keys(node.stats)) addStat(k, atRank(node.stats[k], rank));
    if (node.cond && node.condStats) {
      /** @type {Record<string, number>} */
      const cs = {};
      for (const k of Object.keys(node.condStats)) {
        const v = atRank(node.condStats[k], rank);
        cs[condKey(k)] = (cs[condKey(k)] ?? 0) + (FLAT_KEYS.has(k) ? v : v / 100);
      }
      conds.push({ cond: node.cond, stats: cs });
    }
  }

  const pct = (k) => (sum[k] ?? 0) / 100;
  const flat = (k) => sum[k] ?? 0;

  const main = 10 + 2 * (level - 1) + mainAdd;
  const vit = flat('vit');
  const lifeMax = C.life.base * C.life.growth ** (level - 1) * (1 + vit * COMBAT.vitLife + pct('lifePct'));

  const off = equip.offhand && equip.offhand.dur > 0 ? equip.offhand : null;
  const resourceMax = C.resourceMax.base + C.resourceMax.perLevel * (level - 1) + (off?.base?.mana ?? 0);
  const manaRegenPct = pct('manaRegenPct');
  const resourceRegen = (C.regen.base + C.regen.perLevel * (level - 1)) * (1 + manaRegenPct);

  const basicType = BASIC_SKILLS[C.basic]?.type ?? 'phys';
  const mh = equip.mainHand && equip.mainHand.dur > 0 ? equip.mainHand : null;
  /** @type {PlayerStats['weapon']} */
  let weapon;
  if (mh && mh.base?.dmg) {
    let wdp = 0;
    for (const a of mh.affixes ?? []) if (ITEM_AFFIXES_BY_ID[a.id]?.stat === 'weaponDmgPct') wdp += a.value;
    const k = 1 + wdp / 100;
    const bonus = off?.base?.bonus ?? [0, 0];
    const hands = /** @type {1|2} */ (BASES_BY_ID[mh.baseId]?.hands ?? 1);
    weapon = { min: mh.base.dmg[0] * k + bonus[0], max: mh.base.dmg[1] * k + bonus[1], aps: mh.base.aps ?? 1, type: basicType, hands, baseId: mh.baseId, fist: false };
  } else {
    const f = FIST[cls];
    weapon = { min: f.dmg[0], max: f.dmg[1], aps: f.aps, type: basicType, hands: 1, baseId: null, fist: true };
  }

  const aps = weapon.aps * (1 + pct('attackSpeedPct'));
  const critChance = Math.min(COMBAT.critCap, COMBAT.baseCrit + pct('critChance'));
  const critDamage = COMBAT.baseCritDmg + pct('critDamage');
  /** @type {Record<string, number>} */
  const dmgPct = {};
  for (const t of DMG_TYPES) dmgPct[t] = (flat(t + 'Pct') + flat('allPct')) / 100;
  /** @type {Record<string, number>} */
  const skillPct = {};
  for (const id of Object.keys(skillPctRaw)) skillPct[id] = skillPctRaw[id] / 100;
  const armor = (armorBase + flat('armor')) * (1 + pct('armorPct'));
  /** @type {Record<string, number>} */
  const res = {};
  for (const t of DMG_TYPES) res[t] = (flat('allRes') + flat(t + 'Res')) * (1 + pct('resPct'));
  const block = off && off.base?.block ? off.base.block : 0;
  const moveSpeed = C.moveSpeed * (1 + Math.min(COMBAT.moveCap, pct('moveSpeed')));
  const dmgTakenReduce = Math.min(COMBAT.dmgTakenCap, pct('dmgTakenReduce'));

  const sheetDps = ((weapon.min + weapon.max) / 2) * aps * (1 + main / 100) * (1 + dmgPct[weapon.type]) * (1 + critChance * critDamage);
  const L = Math.max(1, Math.floor(riftLevel ?? char?.riftUnlocked ?? 1));
  let drr = 0;
  for (const t of DMG_TYPES) drr += DRr(res[t], L);
  drr /= DMG_TYPES.length;
  const ehp = lifeMax / ((1 - DRa(armor, L)) * (1 - drr) * (1 - dmgTakenReduce));

  return {
    cls: /** @type {any} */ (cls), level,
    main, vit,
    lifeMax, resourceMax, resourceRegen,
    weapon,
    aps,
    critChance, critDamage,
    dmgPct: /** @type {any} */ (dmgPct),
    skillPct,
    aoePct: pct('aoePct'), elitePct: pct('elitePct'),
    cdr: Math.min(COMBAT.cdrCap, pct('cdr')), costReduce: Math.min(COMBAT.costCap, pct('costReduce')),
    lifeRegen: flat('lifeRegen'), lifeOnHit: flat('lifeOnHit'), lifePctOnHit: pct('lifePctOnHit'),
    armor,
    res: /** @type {any} */ (res),
    block,
    moveSpeed,
    thorns: flat('thorns'), goldFind: pct('goldFind'), magicFind: pct('magicFind'), xpPct: pct('xpPct'),
    potionPct: pct('potionPct'), globePct: pct('globePct'), dmgTakenReduce, rageOnHit: flat('rageOnHit'),
    burnFrac: pct('burnFrac'), freezeAtReduce: flat('freezeAt'), freezeDurPct: pct('freezeDurPct'),
    manaRegenPct,
    hooks,
    ranks,
    transforms,
    conds,
    broken: /** @type {any} */ (broken),
    setCounts,
    sheetDps,
    ehp,
  };
}
