// OWNER: P6 — 계약 §6.11
// STUB — W0 에 완성으로 내는 것: findItem · itemAt · addToBag · addGold · addMaterials · addConsumable · 나머지는 W1 에서 P6 이 채운다
// 가방 · 장착 · 보관함 · 정렬 · 내구도 · 사망 대가. char.gold · materials · potions · scrolls 를 고치는 곳은 P6 파일뿐이다.

import { EV } from '../../core/events.js';
import { EQUIP_SLOTS, MATERIAL_IDS } from '../../core/constants.js';
import { ECON } from '../../data/economy.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').GameState} GameState */
/** @typedef {import('../../types.js').Item} Item */
/** @typedef {import('../../types.js').ItemRef} ItemRef */
/** @typedef {import('../../types.js').Result} Result */

const STUB = Object.freeze({ ok: false, reason: 'stub' });
const stub = () => ({ ...STUB });

/** 아이템 ID → ItemRef(가방 · 장착 · 보관함 · 상점 재고 · 되사기) @param {GameState} state @param {string} itemId @returns {ItemRef|null} */
export function findItem(state, itemId) {
  const ch = state.char;
  if (ch) {
    for (let i = 0; i < ch.bag.length; i++) if (ch.bag[i]?.id === itemId) return { where: 'bag', idx: i };
    for (const s of EQUIP_SLOTS) if (ch.equip[s]?.id === itemId) return { where: 'equip', slot: /** @type {any} */ (s) };
  }
  const stash = state.account?.stash ?? [];
  for (let i = 0; i < stash.length; i++) if (stash[i]?.id === itemId) return { where: 'stash', idx: i };
  if (ch) {
    for (const shop of /** @type {const} */ (['blacksmith', 'general'])) {
      const list = ch.shop?.[shop] ?? [];
      for (let i = 0; i < list.length; i++) if (list[i]?.id === itemId) return { where: 'stock', shop, idx: i };
    }
    for (let i = 0; i < ch.buyback.length; i++) if (ch.buyback[i]?.item?.id === itemId) return { where: 'buyback', idx: i };
  }
  return null;
}

/** ItemRef → Item|null @param {GameState} state @param {ItemRef} ref @returns {Item|null} */
export function itemAt(state, ref) {
  const ch = state.char;
  if (!ref) return null;
  switch (ref.where) {
    case 'bag': return ch?.bag[ref.idx ?? -1] ?? null;
    case 'equip': return ch?.equip[/** @type {any} */ (ref.slot)] ?? null;
    case 'stash': return state.account?.stash[ref.idx ?? -1] ?? null;
    case 'stock': return ch?.shop?.[ref.shop ?? 'blacksmith']?.[ref.idx ?? -1] ?? null;
    case 'buyback': return ch?.buyback[ref.idx ?? -1]?.item ?? null;
    default: return null;
  }
}

/**
 * 빈 첫 칸에 넣는다 · BAG
 * @param {SimCtx} ctx @param {Item} item @param {string} [reason] BAG 의 reason(기본 'pickup')
 * @returns {{ok:true, idx:number}|{ok:false, reason:'bagFull'}}
 */
export function addToBag(ctx, item, reason = 'pickup') {
  const ch = ctx.state.char;
  if (!ch) return { ok: false, reason: 'bagFull' };
  const idx = ch.bag.indexOf(null);
  if (idx < 0) return { ok: false, reason: 'bagFull' };
  ch.bag[idx] = item;
  ctx.emit(EV.BAG, { reason });
  return { ok: true, idx };
}

/** 정수로 자른 0 이상의 양 @param {number} v */
const nonNeg = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/**
 * 골드를 더한다(정수 · amount ≥ 0) · GOLD · 균열이면 rift.stats.gold · meter.runGold 에도
 * @param {SimCtx} ctx @param {number} amount @param {string} reason @returns {number} 더한 양
 */
export function addGold(ctx, amount, reason) {
  const st = ctx.state;
  const ch = st.char;
  if (!ch) return 0;
  const n = nonNeg(amount);
  ch.gold += n;
  if (st.scene === 'rift' && st.rift) {
    st.rift.stats.gold += n;
    st.meter.runGold += n;
  }
  ctx.emit(EV.GOLD, { gold: ch.gold, delta: n, reason });
  return n;
}

/**
 * 재료를 더한다 · MATERIALS
 * @param {SimCtx} ctx @param {Partial<Record<import('../../types.js').MaterialId, number>>} mats @param {string} reason
 * @returns {Record<string, number>} 더한 양
 */
export function addMaterials(ctx, mats, reason) {
  const ch = ctx.state.char;
  /** @type {Record<string, number>} */
  const delta = {};
  if (!ch) return delta;
  for (const id of MATERIAL_IDS) {
    const n = nonNeg(/** @type {any} */ (mats ?? {})[id] ?? 0);
    if (!n) continue;
    ch.materials[/** @type {import('../../types.js').MaterialId} */ (id)] += n;
    delta[id] = n;
  }
  ctx.emit(EV.MATERIALS, { materials: { ...ch.materials }, delta, reason });
  return delta;
}

/**
 * 포션 · 두루마리를 상한(ECON)까지 더한다
 * @param {SimCtx} ctx @param {'potion'|'scroll'} what @param {number} n @returns {number} 실제로 더한 수
 */
export function addConsumable(ctx, what, n) {
  const ch = ctx.state.char;
  if (!ch) return 0;
  const key = what === 'potion' ? 'potions' : 'scrolls';
  const max = what === 'potion' ? ECON.potionMax : ECON.scrollMax;
  const add = Math.max(0, Math.min(nonNeg(n), max - ch[key]));
  ch[key] += add;
  return add;
}

/** STUB @param {SimCtx} ctx @param {ItemRef} ref @param {boolean} on @returns {Result} */
export function setItemLocked(ctx, ref, on) { return stub(); }
/** STUB @param {SimCtx} ctx @param {ItemRef} ref @param {string|null} [toSlot] @returns {Result} */
export function equip(ctx, ref, toSlot = null) { return stub(); }
/** STUB @param {SimCtx} ctx @param {string} slot @returns {Result} */
export function unequip(ctx, slot) { return stub(); }
/** STUB @param {SimCtx} ctx @param {ItemRef} from @param {ItemRef} to @returns {Result} */
export function moveItem(ctx, from, to) { return stub(); }
/** STUB @param {SimCtx} ctx @returns {Result} */
export function sortBag(ctx) { return stub(); }
/** STUB @param {SimCtx} ctx @returns {Result} */
export function sortStash(ctx) { return stub(); }
/** STUB — 장착 전부 dur −= ITEM.deathDurLoss · refreshStats · DURABILITY @param {SimCtx} ctx */
export function applyDeathPenalty(ctx) {}
/** STUB — 수리비(§7.10 · 등급과 무관) @param {import('../../types.js').CharacterState} char @returns {number} */
export function repairCost(char) { return 0; }
