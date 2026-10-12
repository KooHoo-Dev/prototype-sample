// OWNER: P5 — 계약 §5.13 · §6.10
// 아이템 생성(rollItem) · 옵션 굴림 · 이름 · 가치. 순수 함수 — rng 줄기 밖의 난수 · 입력 변형이 없다.
// 난수를 쓰는 순서(결정성): 기본 값 편차(dmg → armor → bonus · 각자 v) → 옵션 수 → 옵션마다(고르기 → 티어 → 값 → skillPct 의 스킬) → 희귀 이름(a → b).
// 아이템의 클래스(item.cls): 기본형의 cls · 전설은 그 행의 cls(공용 전설은 기본형 cls) · 세트 조각은 그 세트의 cls — 전설 · 세트는 클래스 전용이다.

import { CLASS_IDS, ITEM_SLOTS } from '../../core/constants.js';
import { roundTo } from '../../core/math.js';
import { ITEM, BASE_TIERS } from '../../data/items.js';
import { AFFIX_TIERS } from '../../data/itemAffixes.js';
import { RARITY } from '../../data/drops.js';
import { GROWTH } from '../../data/rift.js';
import {
  CLASSES_BY_ID, ITEM_AFFIXES_BY_ID, LEGENDARIES_BY_ID, SETS_BY_ID, SET_PIECES_BY_ID, activesOf, affixesFor, getBase,
} from '../../data/index.js';

/** @typedef {import('../../types.js').Item} Item */
/** @typedef {import('../../types.js').ItemAffix} ItemAffix */
/** @typedef {import('../../types.js').ItemAffixDef} ItemAffixDef */
/** @typedef {import('../../types.js').BaseDef} BaseDef */
/** @typedef {import('../../types.js').Rarity} Rarity */
/** @typedef {import('../../types.js').Rng} Rng */

/** 부위 → 그 부위가 허용하는 옵션 행(데이터 배열 순서 — 뽑기 순서) */
const POOLS = /** @type {Record<string, ItemAffixDef[]>} */ ({});
for (const s of ITEM_SLOTS) POOLS[s] = affixesFor(s);

/** 클래스 → 액티브 노드 ID(skillPct 의 param 후보) */
const ACTIVE_IDS = /** @type {Record<string, string[]>} */ ({});
for (const c of CLASS_IDS) ACTIVE_IDS[c] = activesOf(c).map(n => n.id);

const TOP_AFFIX_TIER = AFFIX_TIERS.weight.length;

/** ilvl 을 1 이상의 정수로 @param {number} ilvl */
function ilvlOf(ilvl) {
  const v = Math.floor(Number(ilvl));
  return Number.isFinite(v) && v >= 1 ? v : 1;
}

/** 기본형 단계를 [0, 마지막]으로 @param {number} tier @returns {0|1|2} */
function tierOf(tier) {
  const v = Math.floor(Number(tier));
  return /** @type {0|1|2} */ (Number.isFinite(v) ? Math.max(0, Math.min(BASE_TIERS.length - 1, v)) : 0);
}

/** 아이템 가치(§7.10) = round(ITEM.slotValue[slotKey] × RARITY.value[rarity] × GROWTH.gold^(ilvl−1)) — 주무기는 손 수로 1h/2h @param {Item} item */
export function itemValue(item) {
  const base = getBase(item.baseId);
  const slotKey = item.slot === 'mainHand' ? ((base.hands ?? 1) === 2 ? 'mainHand2h' : 'mainHand1h') : item.slot;
  const sv = /** @type {Record<string, number>} */ (ITEM.slotValue)[slotKey] ?? 0;
  const rv = /** @type {Record<string, number>} */ (RARITY.value)[item.rarity] ?? 1;
  return Math.round(sv * rv * GROWTH.gold ** (ilvlOf(item.ilvl) - 1));
}

/** [lo, hi] 정수 범위 · 최대 ≥ 최소 + 1 @param {[number, number]} pair @param {number} mul @returns {[number, number]} */
function scalePair(pair, mul) {
  const lo = Math.round(pair[0] * mul);
  return [lo, Math.max(lo + 1, Math.round(pair[1] * mul))];
}

/**
 * 기본 값(§5.13-4): dmg · armor · bonus = round(값 × 단계 배율 × GROWTH.item^(ilvl−1) × v) — v 는 각자(rng 가 없으면 1) · block · mana · aps 는 그대로
 * @param {Rng|null} rng @param {BaseDef} base @param {number} tier @param {number} ilvl @returns {Item['base']}
 */
function baseValues(rng, base, tier, ilvl) {
  const mul = (BASE_TIERS[tier]?.mul ?? 1) * GROWTH.item ** (ilvl - 1);
  const dev = () => (rng ? rng.range(1 - ITEM.baseVar, 1 + ITEM.baseVar) : 1);
  /** @type {Item['base']} */
  const out = {};
  if (base.dmg) out.dmg = scalePair(base.dmg, mul * dev());
  if (base.aps !== undefined) out.aps = base.aps;
  if (base.armor !== undefined) out.armor = Math.round(base.armor * mul * dev());
  if (base.block !== undefined) out.block = base.block;
  if (base.bonus) out.bonus = scalePair(base.bonus, mul * dev());
  if (base.mana !== undefined) out.mana = base.mana;
  return out;
}

/** 아이템 클래스(전설 · 세트는 클래스 전용) @param {BaseDef} base @param {string|null} legendaryId @param {string|null} setPieceId @returns {import('../../types.js').ClassId|null} */
function itemClassOf(base, legendaryId, setPieceId) {
  if (legendaryId && LEGENDARIES_BY_ID[legendaryId]) return LEGENDARIES_BY_ID[legendaryId].cls ?? base.cls;
  if (setPieceId && SET_PIECES_BY_ID[setPieceId]) return SETS_BY_ID[SET_PIECES_BY_ID[setPieceId].setId]?.cls ?? base.cls;
  return base.cls;
}

/** 옵션 편향 · skillPct 가 따르는 클래스 = 아이템 클래스(공용이면 굴리는 캐릭터 클래스 · 모르면 null) */
function biasClassOf(itemCls, cls) {
  if (itemCls) return itemCls;
  return cls && CLASSES_BY_ID[cls] ? cls : null;
}

/** 주 능력치 옵션의 클래스 편향 배율(§5.13-4) @param {ItemAffixDef} def @param {string|null} biasCls */
function mainBias(def, biasCls) {
  if (!def.main || !biasCls) return 1;
  return CLASSES_BY_ID[biasCls].mainStat === def.main ? ITEM.mainBias : ITEM.offMainBias;
}

/**
 * ilvl 이 연 티어(AFFIX_TIERS.minIlvl[t] ≤ ilvl) 중 AFFIX_TIERS.weight 로 → 1..5
 * @param {Rng} rng @param {number} ilvl @returns {1|2|3|4|5}
 */
export function tierFor(rng, ilvl) {
  const lv = ilvlOf(ilvl);
  /** @type {number[]} */
  const w = [];
  for (let i = 0; i < TOP_AFFIX_TIER; i++) w.push(AFFIX_TIERS.minIlvl[i] <= lv ? AFFIX_TIERS.weight[i] : 0);
  const idx = rng.pickIndex(w);
  return /** @type {1|2|3|4|5} */ (idx < 0 ? 1 : idx + 1);
}

/**
 * 티어 범위 안 값 = rng.range(min, max) × (pow 면 GROWTH.item^(ilvl−1)) → decimals 로 반올림
 * @param {Rng} rng @param {ItemAffixDef} def @param {number} tier @param {number} ilvl @returns {number}
 */
export function affixValue(rng, def, tier, ilvl) {
  const t = Math.max(1, Math.min(def.tiers.length, Math.floor(Number(tier)) || 1));
  const [lo, hi] = def.tiers[t - 1];
  const k = def.scale === 'pow' ? GROWTH.item ** (ilvlOf(ilvl) - 1) : 1;
  return roundTo(rng.range(lo, hi) * k, def.decimals ?? 0);
}

/**
 * 옵션 하나 굴리기(티어 → 값 → skillPct 면 스킬) @param {Rng} rng @param {ItemAffixDef} def @param {number} ilvl @param {string|null} biasCls
 * @returns {ItemAffix}
 */
function rollOneAffix(rng, def, ilvl, biasCls) {
  const tier = tierFor(rng, ilvl);
  /** @type {ItemAffix} */
  const a = { id: def.id, tier, value: affixValue(rng, def, tier, ilvl) };
  if (def.param) {
    const ids = ACTIVE_IDS[biasCls ?? CLASS_IDS[0]] ?? [];
    if (ids.length) a.param = ids[rng.int(0, ids.length - 1)];
  }
  return a;
}

/**
 * 옵션 수(§5.13-4): ITEM.affixCount[rarity] 가중치 · 전설 = 행의 affixes 범위 균등 · 세트 = ITEM.setAffixes 범위 균등 · 일반 0
 * @param {Rng} rng @param {Rarity} rarity @param {string|null} legendaryId
 */
function rollAffixCount(rng, rarity, legendaryId) {
  if (rarity === 'legendary') {
    const def = legendaryId ? LEGENDARIES_BY_ID[legendaryId] : null;
    const range = def?.affixes ?? ITEM.setAffixes;
    return rng.int(range[0], range[1]);
  }
  if (rarity === 'set') return rng.int(ITEM.setAffixes[0], ITEM.setAffixes[1]);
  const table = /** @type {Record<string, Record<string, number>>} */ (ITEM.affixCount)[rarity];
  if (!table) return 0;
  const k = rng.pick(table);
  return k === null ? 0 : Number(k);
}

/**
 * 옵션 고르기(§5.13-4): 그 부위의 풀에서 가중치로 중복 없이 · 접두 ≤ maxPrefix · 접미 ≤ maxSuffix · 주 능력치 편향 · 풀이 바닥나면 그만큼 적게.
 * 결과 순서 = 접두(굴린 순) → 접미(굴린 순)
 * @param {Rng} rng @param {string} slot @param {Rarity} rarity @param {number} count @param {number} ilvl @param {string|null} biasCls
 * @param {Record<string, number>|null} slotBias 옵션 ID → 가중치 배율(선택)
 * @returns {ItemAffix[]}
 */
function rollAffixes(rng, slot, rarity, count, ilvl, biasCls, slotBias) {
  const pool = POOLS[slot] ?? [];
  if (!(count > 0) || !pool.length) return [];
  const maxPre = /** @type {Record<string, number>} */ (ITEM.maxPrefix)[rarity] ?? 0;
  const maxSuf = /** @type {Record<string, number>} */ (ITEM.maxSuffix)[rarity] ?? 0;
  const used = new Array(pool.length).fill(false);
  const w = new Array(pool.length).fill(0);
  /** @type {ItemAffix[]} */
  const pre = [];
  /** @type {ItemAffix[]} */
  const suf = [];
  for (let k = 0; k < count; k++) {
    for (let i = 0; i < pool.length; i++) {
      const def = pool[i];
      const full = def.kind === 'prefix' ? pre.length >= maxPre : suf.length >= maxSuf;
      if (used[i] || full) { w[i] = 0; continue; }
      const b = slotBias && Number.isFinite(slotBias[def.id]) ? Math.max(0, slotBias[def.id]) : 1;
      w[i] = def.weight * mainBias(def, biasCls) * b;
    }
    const idx = rng.pickIndex(w);
    if (idx < 0) break;
    used[idx] = true;
    const a = rollOneAffix(rng, pool[idx], ilvl, biasCls);
    (pool[idx].kind === 'prefix' ? pre : suf).push(a);
  }
  return pre.concat(suf);
}

/**
 * 이름 키(§5.13-4) — 일반 [기본형] · 마법 [접미어?, 접두어?, 기본형] · 희귀 [rare.a.i, rare.b.j] · 전설 [leg.id] · 세트 [setp.pieceId]
 * @param {Rng|null} rng 희귀 이름 굴림(null 이면 0번) @returns {string[]}
 */
function nameOf(rng, baseId, tier, rarity, affixes, legendaryId, setPieceId) {
  if (rarity === 'legendary' && legendaryId) return ['leg.' + legendaryId];
  if (rarity === 'set' && setPieceId) return ['setp.' + setPieceId];
  if (rarity === 'rare' || rarity === 'legendary' || rarity === 'set') {
    const i = rng ? rng.int(0, ITEM.rareNames - 1) : 0;
    const j = rng ? rng.int(0, ITEM.rareNames - 1) : 0;
    return ['rare.a.' + i, 'rare.b.' + j];
  }
  const baseKey = 'base.' + baseId + '.' + tier;
  if (rarity === 'magic') {
    const out = [];
    const suf = affixes.find(a => ITEM_AFFIXES_BY_ID[a.id]?.kind === 'suffix');
    const pre = affixes.find(a => ITEM_AFFIXES_BY_ID[a.id]?.kind === 'prefix');
    if (suf) out.push('afx.' + suf.id + '.s');
    if (pre) out.push('afx.' + pre.id + '.p');
    out.push(baseKey);
    return out;
  }
  return [baseKey];
}

/** 아이템 모양 하나(키 순서 고정 — fixtures.test 가 makeItem 의 키를 본다) */
function assemble({ id, base, baseId, rarity, ilvl, tier, values, affixes, name, legendaryId, setPieceId, cls }) {
  /** @type {Item} */
  const item = {
    id,
    baseId,
    slot: base.slot,
    cls,
    rarity,
    ilvl,
    reqLevel: Math.min(ilvl, ITEM.reqLevelCap),   // 피드백 2 D2: 상한 = 캐릭터 레벨 캡(30)
    tier,
    base: values,
    affixes,
    name,
    dur: ITEM.durMax,
    durMax: ITEM.durMax,
    rerollIdx: null,
    rerolls: 0,
    value: 0,
    flags: {},
  };
  if (legendaryId) item.legendaryId = legendaryId;
  if (setPieceId) {
    item.setPieceId = setPieceId;
    const piece = SET_PIECES_BY_ID[setPieceId];
    if (piece) item.setId = piece.setId;
  }
  item.value = itemValue(item);
  return item;
}

/** 등급을 그 아이디가 있는지에 맞춘다(전설 · 세트인데 행이 없으면 희귀) */
function effectiveRarity(rarity, legendaryId, setPieceId) {
  if (rarity === 'legendary') return legendaryId && LEGENDARIES_BY_ID[legendaryId] ? 'legendary' : 'rare';
  if (rarity === 'set') return setPieceId && SET_PIECES_BY_ID[setPieceId] ? 'set' : 'rare';
  return /** @type {Record<string, number>} */ (RARITY.value)[rarity] !== undefined ? rarity : 'normal';
}

/**
 * 난수 없이(v = 1) 아이템을 만든다 — 시작 장비 · 고정 상태 · 테스트(옵션은 받은 그대로 복사)
 * @param {{baseId:string, tier?:number, ilvl?:number, rarity?:Rarity, id:string, affixes?:ItemAffix[], legendaryId?:string|null, setPieceId?:string|null}} opts
 * @returns {Item}
 */
export function makeItem({ baseId, tier = 0, ilvl = 1, rarity = 'normal', id, affixes = [], legendaryId = null, setPieceId = null }) {
  const base = getBase(baseId);
  const t = tierOf(tier);
  const lv = ilvlOf(ilvl);
  const affs = affixes.map(a => ({ ...a }));
  const leg = rarity === 'legendary' ? legendaryId : null;
  const piece = rarity === 'set' ? setPieceId : null;
  return assemble({
    id, base, baseId, rarity, ilvl: lv, tier: t, values: baseValues(null, base, t, lv), affixes: affs,
    name: nameOf(null, baseId, t, rarity, affs, legendaryId, setPieceId),
    legendaryId, setPieceId, cls: itemClassOf(base, leg, piece),
  });
}

/**
 * 아이템 굴림(§5.13-4) — 기본 값 편차 · 옵션 수 · 옵션(중복 없음 · 접두/접미 상한 · 클래스 편향) · 티어 · 값 · 이름 · 가치
 * @param {Rng} rng
 * @param {{baseId:string, tier:number, rarity:Rarity, ilvl:number, cls:string, legendaryId?:string|null, setPieceId?:string|null, newId:() => string,
 *   slotBias?:Record<string, number>|null}} opts  cls = 굴리는 캐릭터 클래스(공용 아이템의 편향 · skillPct) · slotBias = 옵션 ID → 가중치 배율(선택)
 * @returns {Item}
 */
export function rollItem(rng, { baseId, tier, rarity, ilvl, cls, legendaryId = null, setPieceId = null, newId, slotBias = null }) {
  const base = getBase(baseId);
  const t = tierOf(tier);
  const lv = ilvlOf(ilvl);
  const r = effectiveRarity(rarity, legendaryId, setPieceId);
  const leg = r === 'legendary' ? legendaryId : null;
  const piece = r === 'set' ? setPieceId : null;
  const itemCls = itemClassOf(base, leg, piece);
  const biasCls = biasClassOf(itemCls, cls);
  const values = baseValues(rng, base, t, lv);
  const count = rollAffixCount(rng, r, leg);
  const affixes = rollAffixes(rng, base.slot, r, count, lv, biasCls, slotBias);
  const name = nameOf(rng, baseId, t, r, affixes, leg, piece);
  return assemble({ id: newId(), base, baseId, rarity: r, ilvl: lv, tier: t, values, affixes, name, legendaryId: leg, setPieceId: piece, cls: itemCls });
}

/**
 * 재굴림 후보 하나(신비술사 — §6.11): 같은 kind · 그 아이템의 다른 옵션과 중복 없음(지금 그 자리의 옵션은 다시 나올 수 있다 — 값이 새로 굴린다) ·
 * 같은 ilvl 티어 규칙 · 주 능력치 편향 · skillPct 면 스킬도 새로. 인덱스가 틀리면 null(입력을 고치지 않는다)
 * @param {Rng} rng @param {Item} item @param {number} affixIdx @param {string} cls 굴리는 캐릭터 클래스 @returns {ItemAffix|null}
 */
export function rerollAffix(rng, item, affixIdx, cls) {
  const cur = item?.affixes?.[affixIdx];
  const curDef = cur ? ITEM_AFFIXES_BY_ID[cur.id] : null;
  if (!cur || !curDef) return null;
  const pool = POOLS[item.slot] ?? [];
  const others = new Set();
  for (let i = 0; i < item.affixes.length; i++) if (i !== affixIdx) others.add(item.affixes[i].id);
  const biasCls = biasClassOf(item.cls ?? null, cls);
  /** @type {number[]} */
  const w = [];
  for (const def of pool) w.push(def.kind === curDef.kind && !others.has(def.id) ? def.weight * mainBias(def, biasCls) : 0);
  const idx = rng.pickIndex(w);
  const def = idx < 0 ? curDef : pool[idx];
  return rollOneAffix(rng, def, item.ilvl, biasCls);
}
