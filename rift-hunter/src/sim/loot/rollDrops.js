// OWNER: P5 — 계약 §5.13 · §6.10
// 드랍 묶음 → 등급 굴림 → 부위 · 기본형(전설 · 세트 고르기) → rollItem · 불운 보정 · 아이템 발견 수확 체감.
// 순수 함수 하나 — 게임 · 봇 · 분석 패널 · 측정 · 테스트가 같은 것을 부른다. 입력을 고치지 않는다(blp 는 결과로 돌려준다).
// 등급 · 후보 가중치는 theory.js 의 rarityWeights · specialCandidates 를 그대로 쓴다(이론값 = 시뮬값의 표).

import { CLASS_IDS, RARITIES } from '../../core/constants.js';
import { BASES, BASE_TIERS, ITEM, SLOT_WEIGHTS } from '../../data/items.js';
import { BLP, GOLD, MATERIAL_DROP } from '../../data/drops.js';
import { riftRow } from '../../data/rift.js';
import { LEGENDARIES_BY_ID, SET_PIECES_BY_ID } from '../../data/index.js';
import { rollItem } from './rollItem.js';
import { normSlot, rarityWeights, specialCandidates, treasureOf } from './theory.js';

/** @typedef {import('../../types.js').Rng} Rng */
/** @typedef {import('../../types.js').DropRoll} DropRoll */
/** @typedef {import('../../types.js').Item} Item */
/** @typedef {import('../../types.js').Rarity} Rarity */

/** 0 이상 유한수(아니면 0) @param {any} v */
function nonNeg(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 클래스 ID 를 아는 값으로(모르면 첫 클래스) @param {string} cls */
function clsOf(cls) {
  return CLASS_IDS.includes(/** @type {any} */ (cls)) ? cls : CLASS_IDS[0];
}

/** 다른 클래스(두 클래스 — 하나뿐이면 자기) @param {string} cls */
function otherClassOf(cls) {
  return CLASS_IDS.find(c => c !== cls) ?? cls;
}

/** 부위 · 클래스 → 기본형 뽑기 표(Array<{id, w}>) — 데이터 배열 순서 */
const BASE_PICKS = /** @type {Record<string, Array<{id:string, w:number}>>} */ ({});
/** @param {string} slot @param {string|null} cls */
function basePicks(slot, cls) {
  const key = slot + ':' + (cls ?? '');
  let t = BASE_PICKS[key];
  if (!t) {
    t = BASES.filter(b => b.slot === slot && b.cls === cls).map(b => ({ id: b.id, w: b.weight }));
    if (!t.length) t = BASES.filter(b => b.slot === slot && (b.cls === null || b.cls === cls)).map(b => ({ id: b.id, w: b.weight }));
    BASE_PICKS[key] = t;
  }
  return t;
}

/** 기본형 단계 가중치(minIlvl ≤ ilvl) */
function baseTierWeights(ilvl) {
  return BASE_TIERS.map(t => (t.minIlvl <= ilvl ? t.weight : 0));
}

/** 열린 가장 높은 단계(전설 · 세트) @param {number} ilvl @returns {0|1|2} */
function topTier(ilvl) {
  let top = 0;
  for (let i = 0; i < BASE_TIERS.length; i++) if (BASE_TIERS[i].minIlvl <= ilvl) top = i;
  return /** @type {0|1|2} */ (top);
}

/**
 * 등급 굴림(§5.13-2 — 가중치 한 번 뽑기). blpOn 이고 blp ≥ BLP.hard 면 굴리지 않고 전설.
 * 굴린 뒤: 전설 · 세트면 blp = 0 · 아니면 blp + 1(장비 드랍만 센다 — blpOn 이 아니어도 센다)
 * @param {Rng} rng @param {{rank:string, level:number, mf?:number, blp?:number, blpOn?:boolean, guaranteed?:boolean}} opts
 * @returns {{rarity:Rarity, blp:number}}
 */
export function rollRarity(rng, { rank, level, mf = 0, blp = 0, blpOn = true, guaranteed = false }) {
  const count = Math.floor(nonNeg(blp));
  /** @type {Rarity} */
  let rarity;
  if (blpOn && count >= BLP.hard) rarity = 'legendary';
  else rarity = /** @type {Rarity|null} */ (rng.pick(rarityWeights({ rank, level, mf, blp: count, blpOn, guaranteed }))) ?? (guaranteed ? 'rare' : 'normal');
  return { rarity, blp: rarity === 'legendary' || rarity === 'set' ? 0 : count + 1 };
}

/**
 * 장비 하나(드랍 · 도박 · 제작 · 대장장이 재고 · 개발 캐릭터 공용 — §6.10).
 * slot 이 있으면 그 부위(반지 'ring' · ring1/ring2 도 받는다)로 · 없으면 slotWeights 로 · 주무기 · 보조는 ownClassOnly 가 아니면 ITEM.ownClassChance 로 자기 클래스.
 * 전설 · 세트는 specialCandidates(그 부위 · 클래스)에서 — 후보가 없으면 희귀로 내린다. 전설 · 세트의 단계 = 열린 가장 높은 단계.
 * @param {Rng} rng
 * @param {{rarity:Rarity, level:number, cls:string, newId:() => string, slot?:string|null, slotWeights?:Record<string, number>, ownClassOnly?:boolean}} opts
 * @returns {Item}
 */
export function rollGear(rng, { rarity, level, cls, newId, slot = null, slotWeights = SLOT_WEIGHTS, ownClassOnly = false }) {
  const ilvl = Math.max(1, Math.floor(Number(level)) || 1);
  const c = clsOf(cls);
  const s = normSlot(slot);
  /** @type {Rarity} */
  let r = RARITIES.includes(/** @type {any} */ (rarity)) ? rarity : 'normal';
  if (r === 'legendary' || r === 'set') {
    const cands = specialCandidates(r, { slot: s, cls: c, ownClassOnly });
    const id = cands.length ? /** @type {string|null} */ (rng.pick(cands)) : null;
    if (id && r === 'legendary' && LEGENDARIES_BY_ID[id]) {
      return rollItem(rng, { baseId: LEGENDARIES_BY_ID[id].baseId, tier: topTier(ilvl), rarity: 'legendary', ilvl, cls: c, legendaryId: id, newId });
    }
    if (id && r === 'set' && SET_PIECES_BY_ID[id]) {
      return rollItem(rng, { baseId: SET_PIECES_BY_ID[id].baseId, tier: topTier(ilvl), rarity: 'set', ilvl, cls: c, setPieceId: id, newId });
    }
    r = 'rare';
  }
  const sl = s ?? normSlot(/** @type {string|null} */ (rng.pick(slotWeights ?? SLOT_WEIGHTS))) ?? normSlot(/** @type {string} */ (rng.pick(SLOT_WEIGHTS)));
  /** @type {string|null} */
  let itemCls = null;
  if (sl === 'mainHand' || sl === 'offhand') itemCls = ownClassOnly || rng.chance(ITEM.ownClassChance) ? c : otherClassOf(c);
  const picks = basePicks(/** @type {string} */ (sl), itemCls);
  const baseId = /** @type {string} */ (rng.pick(picks));
  const ti = rng.pickIndex(baseTierWeights(ilvl));
  return rollItem(rng, { baseId, tier: ti < 0 ? 0 : ti, rarity: r, ilvl, cls: c, newId });
}

/**
 * 골드 더미(§5.13-1) = max(1, round(GOLD.base × tc.goldMul × row.goldMul × rng.range(GOLD.range) × (1 + gf)))
 * @param {Rng} rng @param {{goldMul:number}} tc @param {{goldMul:number}} row @param {number} gf
 */
function goldPile(rng, tc, row, gf) {
  return Math.max(1, Math.round(GOLD.base * tc.goldMul * row.goldMul * rng.range(GOLD.range[0], GOLD.range[1]) * (1 + gf)));
}

/**
 * 한 번의 처치 드랍(§5.13) — 드랍 묶음 picks 번 → none · gold · potion · globe · material · gear(등급 → rollGear) → 보장 장비(tc.guaranteed — 희귀 이상).
 * 입력을 고치지 않는다 — 호출자가 char.blp.count = result.blp.
 * @param {Rng} rng
 * @param {{rank:string, level:number, cls:string, mf?:number, gf?:number, blp?:number, blpOn?:boolean, newId:() => string}} opts
 *   level = 몬스터 레벨(= ilvl) · mf · gf = 비율(1.0 = 100% — PlayerStats.magicFind · goldFind)
 * @returns {{drops:DropRoll[], blp:number}}
 */
export function rollDrops(rng, { rank, level, cls, mf = 0, gf = 0, blp = 0, blpOn = true, newId }) {
  let count = Math.floor(nonNeg(blp));
  const tc = treasureOf(rank);
  if (!tc) return { drops: [], blp: count };
  const row = riftRow(level);
  const c = clsOf(cls);
  const m = nonNeg(mf);
  const g = nonNeg(gf);
  /** @type {DropRoll[]} */
  const drops = [];
  /** @param {boolean} guaranteed */
  const gear = (guaranteed) => {
    const rr = rollRarity(rng, { rank, level: row.level, mf: m, blp: count, blpOn, guaranteed });
    count = rr.blp;
    drops.push({ kind: 'item', item: rollGear(rng, { rarity: rr.rarity, level: row.ilvl, cls: c, newId }), amount: 1, mat: null });
  };
  const picks = Math.floor(nonNeg(tc.picks));
  for (let i = 0; i < picks; i++) {
    const k = rng.pick(tc.w);
    if (k === 'gold') drops.push({ kind: 'gold', item: null, amount: goldPile(rng, tc, row, g), mat: null });
    else if (k === 'potion' || k === 'globe') drops.push({ kind: k, item: null, amount: 1, mat: null });
    else if (k === 'material') drops.push({ kind: 'material', item: null, amount: 1, mat: /** @type {any} */ (rng.pick(MATERIAL_DROP)) });
    else if (k === 'gear') gear(false);
  }
  const guaranteed = Math.floor(nonNeg(tc.guaranteed));
  for (let i = 0; i < guaranteed; i++) gear(true);
  return { drops, blp: count };
}
