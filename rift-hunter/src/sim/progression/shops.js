// OWNER: P6 — 계약 §6.11 · §7.10
// STUB — W1 에서 P6 이 채운다(상점 4 · 보관함 이용 · 재고 · 거래 전부). W0: 명령은 {ok:false, reason:'stub'} · 가격은 0

import { GAMBLE } from '../../data/economy.js';
import { RARITIES } from '../../core/constants.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').CharacterState} CharacterState */
/** @typedef {import('../../types.js').Item} Item */
/** @typedef {import('../../types.js').ItemRef} ItemRef */
/** @typedef {import('../../types.js').Result} Result */

const stub = () => ({ ok: /** @type {false} */ (false), reason: 'stub' });

/** STUB — 재고 갱신(stockRun !== runs 일 때만) @param {SimCtx} ctx */
export function restockShops(ctx) {}
/** STUB @param {SimCtx} ctx @param {string} shop @param {number} idx @returns {Result} */
export function buy(ctx, shop, idx) { return stub(); }
/** STUB @param {SimCtx} ctx @param {ItemRef} ref @returns {Result} */
export function sell(ctx, ref) { return stub(); }
/** STUB @param {SimCtx} ctx @param {ItemRef[]} refs @returns {Result} */
export function sellMany(ctx, refs) { return stub(); }
/** STUB @param {SimCtx} ctx @param {number} idx @returns {Result} */
export function buyback(ctx, idx) { return stub(); }
/** STUB @param {SimCtx} ctx @returns {Result} */
export function repairAll(ctx) { return stub(); }
/** STUB @param {SimCtx} ctx @param {ItemRef} ref @returns {Result} */
export function salvage(ctx, ref) { return stub(); }
/** STUB @param {SimCtx} ctx @param {ItemRef[]} refs @returns {Result} */
export function salvageMany(ctx, refs) { return stub(); }
/** STUB @param {SimCtx} ctx @param {string} slot @returns {Result} */
export function craft(ctx, slot) { return stub(); }
/** STUB @param {SimCtx} ctx @param {string} slot @returns {Result} */
export function gamble(ctx, slot) { return stub(); }
/** STUB @param {SimCtx} ctx @param {ItemRef} ref @param {number} affixIdx @returns {Result} */
export function rerollOffer(ctx, ref, affixIdx) { return stub(); }
/** STUB @param {SimCtx} ctx @param {0|1|2} choice @returns {Result} */
export function rerollChoose(ctx, choice) { return stub(); }
/** STUB @param {SimCtx} ctx @returns {Result} */
export function rerollCancel(ctx) { return stub(); }
/** STUB @param {SimCtx} ctx @param {number} n @returns {Result} */
export function buyPotions(ctx, n) { return stub(); }
/** STUB @param {SimCtx} ctx @param {number} n @returns {Result} */
export function buyScrolls(ctx, n) { return stub(); }
/** STUB @param {SimCtx} ctx @param {'potion'|'scroll'} what @returns {Result} */
export function takeFree(ctx, what) { return stub(); }
/** STUB @param {SimCtx} ctx @returns {Result} */
export function resetSkills(ctx) { return stub(); }

/** STUB @param {Item} item @returns {number} */
export function priceSell(item) { return 0; }
/** STUB @param {Item} item @returns {number} */
export function priceBuy(item) { return 0; }
/** STUB @param {CharacterState} char @param {string} slot @returns {number} */
export function priceGamble(char, slot) { return 0; }
/** STUB @param {Item} item @returns {{gold:number, dust:number, essence:number}} */
export function priceReroll(item) { return { gold: 0, dust: 0, essence: 0 }; }
/** STUB @param {CharacterState} char @returns {number} */
export function priceCraft(char) { return 0; }
/** STUB @param {CharacterState} char @returns {number} */
export function priceReset(char) { return 0; }
/** STUB @param {CharacterState} char @returns {number} */
export function pricePotion(char) { return 0; }
/** STUB @param {CharacterState} char @returns {number} */
export function priceScroll(char) { return 0; }
/** STUB @param {Item} item @returns {Partial<Record<import('../../types.js').MaterialId, number>>} */
export function salvageYield(item) { return {}; }
/** STUB @param {CharacterState} char @param {'potion'|'scroll'} what @returns {boolean} */
export function canTakeFree(char, what) { return false; }

/**
 * STUB — 그 부위 · 클래스의 실제 도박 확률(W0: GAMBLE.rarity 를 정규화한 값 · 후보 내림 없음)
 * @param {CharacterState} char @param {string} slot @returns {Record<import('../../types.js').Rarity, number>}
 */
export function gambleOdds(char, slot) {
  /** @type {Record<string, number>} */
  const w = GAMBLE.rarity;
  let total = 0;
  for (const k of Object.keys(w)) total += w[k];
  /** @type {any} */
  const out = {};
  for (const r of RARITIES) out[r] = total > 0 ? (w[r] ?? 0) / total : 0;
  return out;
}
