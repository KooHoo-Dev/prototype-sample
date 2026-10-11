// OWNER: P5 — 계약 §5.13 · §6.10
// STUB — W0 에 완성으로 내는 것: makeItem · itemValue(시작 장비 · 고정 상태 · 테스트) · 나머지는 W1 에서 P5 가 채운다
// 아이템 생성(rollItem) · 옵션 굴림 · 이름 · 가치. 순수 함수 — rng 줄기 밖의 난수 · 입력 변형이 없다.

import { ITEM, BASE_TIERS } from '../../data/items.js';
import { RARITY } from '../../data/drops.js';
import { GROWTH } from '../../data/rift.js';
import { ITEM_AFFIXES_BY_ID, SET_PIECES_BY_ID, getBase } from '../../data/index.js';

/** @typedef {import('../../types.js').Item} Item */
/** @typedef {import('../../types.js').ItemAffix} ItemAffix */
/** @typedef {import('../../types.js').Rng} Rng */

/** 아이템 가치(§7.10) = round(ITEM.slotValue[slotKey] × RARITY.value[rarity] × GROWTH.gold^(ilvl−1)) — 주무기는 손 수로 1h/2h @param {Item} item */
export function itemValue(item) {
  const base = getBase(item.baseId);
  const slotKey = item.slot === 'mainHand' ? ((base.hands ?? 1) === 2 ? 'mainHand2h' : 'mainHand1h') : item.slot;
  const sv = /** @type {Record<string, number>} */ (ITEM.slotValue)[slotKey] ?? 0;
  const rv = /** @type {Record<string, number>} */ (RARITY.value)[item.rarity] ?? 1;
  return Math.round(sv * rv * GROWTH.gold ** (Math.max(1, item.ilvl) - 1));
}

/** 기본 값 꼴(§5.13-4 · v = 편차) @param {any} base @param {number} tier @param {number} ilvl @param {number} v */
function baseValues(base, tier, ilvl, v) {
  const mul = (BASE_TIERS[tier]?.mul ?? 1) * GROWTH.item ** (Math.max(1, ilvl) - 1) * v;
  /** @type {Item['base']} */
  const out = {};
  if (base.dmg) {
    const lo = Math.round(base.dmg[0] * mul);
    out.dmg = [lo, Math.max(lo + 1, Math.round(base.dmg[1] * mul))];
  }
  if (base.aps !== undefined) out.aps = base.aps;
  if (base.armor !== undefined) out.armor = Math.round(base.armor * mul);
  if (base.block !== undefined) out.block = base.block;
  if (base.bonus) {
    const lo = Math.round(base.bonus[0] * mul);
    out.bonus = [lo, Math.max(lo + 1, Math.round(base.bonus[1] * mul))];
  }
  if (base.mana !== undefined) out.mana = base.mana;
  return out;
}

/** 이름 키(§5.13-4) — 난수 없는 꼴(희귀는 0번 이름) */
function nameOf(baseId, tier, rarity, affixes, legendaryId, setPieceId) {
  if (rarity === 'legendary' && legendaryId) return ['leg.' + legendaryId];
  if (rarity === 'set' && setPieceId) return ['setp.' + setPieceId];
  if (rarity === 'rare' || rarity === 'legendary' || rarity === 'set') return ['rare.a.0', 'rare.b.0'];
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

/**
 * 난수 없이(v = 1) 아이템을 만든다 — 시작 장비 · 고정 상태 · 테스트
 * @param {{baseId:string, tier?:number, ilvl?:number, rarity?:import('../../types.js').Rarity, id:string, affixes?:ItemAffix[], legendaryId?:string|null, setPieceId?:string|null}} opts
 * @returns {Item}
 */
export function makeItem({ baseId, tier = 0, ilvl = 1, rarity = 'normal', id, affixes = [], legendaryId = null, setPieceId = null }) {
  const base = getBase(baseId);
  const t = /** @type {0|1|2} */ (Math.max(0, Math.min(BASE_TIERS.length - 1, tier | 0)));
  const lv = Math.max(1, Math.floor(ilvl));
  const affs = affixes.map(a => ({ ...a }));
  /** @type {Item} */
  const item = {
    id,
    baseId,
    slot: base.slot,
    cls: base.cls,
    rarity,
    ilvl: lv,
    reqLevel: lv,
    tier: t,
    base: baseValues(base, t, lv, 1),
    affixes: affs,
    name: nameOf(baseId, t, rarity, affs, legendaryId, setPieceId),
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

/**
 * STUB — 아이템 굴림(§5.13-4). W0: makeItem 과 같다(옵션 없음)
 * @param {Rng} rng
 * @param {{baseId:string, tier:number, rarity:import('../../types.js').Rarity, ilvl:number, cls:string, legendaryId?:string|null, setPieceId?:string|null, newId:() => string, slotBias?:any}} opts
 * @returns {Item}
 */
export function rollItem(rng, { baseId, tier, rarity, ilvl, cls, legendaryId = null, setPieceId = null, newId, slotBias = null }) {
  return makeItem({ baseId, tier, ilvl, rarity, id: newId(), legendaryId, setPieceId });
}

/**
 * STUB — 재굴림 후보 하나(같은 kind · 다른 옵션과 중복 없음 · 같은 ilvl 티어 규칙). W0: 기존 옵션의 사본
 * @param {Rng} rng @param {Item} item @param {number} affixIdx @param {string} cls @returns {ItemAffix|null}
 */
export function rerollAffix(rng, item, affixIdx, cls) {
  const a = item?.affixes?.[affixIdx];
  return a ? { ...a } : null;
}

/** STUB — ilvl 이 연 티어 중 가중치로(W0: 1) @param {Rng} rng @param {number} ilvl @returns {1|2|3|4|5} */
export function tierFor(rng, ilvl) {
  return 1;
}

/** STUB — 티어 범위 안 값(W0: 범위 최솟값) @param {Rng} rng @param {import('../../types.js').ItemAffixDef} def @param {number} tier @param {number} ilvl */
export function affixValue(rng, def, tier, ilvl) {
  return def?.tiers?.[Math.max(1, tier) - 1]?.[0] ?? 0;
}
