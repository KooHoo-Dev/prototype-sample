// OWNER: P6 — 계약 §6.11 · §7.10
// 상점 4(대장장이 · 잡화상 · 도박꾼 · 신비술사) · 재고 · 거래 전부 · 가격 식. 명령은 전부 마을에서만('notInTown').
// 재화 규칙: 먼저 충분한지 검사하고(모자라면 아무것도 바꾸지 않고 'gold' · 'materials' · 'bagFull'), 그 뒤 빼고 넣는다 — 결과는 절대 음수가 아니다.
// 아이템은 한 곳에서 빠지면서 다른 곳에 들어간다(재고 → 가방 · 가방 → 되사기 · 되사기 → 가방) — 복사 0.

import { EV } from '../../core/events.js';
import { CLASS_IDS, EQUIP_SLOTS, ITEM_SLOTS, MATERIAL_IDS, RARITIES, SKILL_BAR } from '../../core/constants.js';
import { hash32 } from '../../core/hash.js';
import { makeRng, seedRng } from '../../core/rng.js';
import { ITEM_AFFIXES_BY_ID } from '../../data/index.js';
import { CRAFT, ECON, GAMBLE, PRICES, REPAIR_ORDER, REROLL, SALVAGE, SEED_SALT, SHOP } from '../../data/economy.js';
import { ITEM, SLOT_WEIGHTS } from '../../data/items.js';
import { GROWTH } from '../../data/rift.js';
import { rollGear } from '../loot/rollDrops.js';
import { rerollAffix } from '../loot/rollItem.js';
import { specialCandidates } from '../loot/theory.js';
import { emptyArray } from '../state.js';
import {
  addConsumable, addGold, addMaterials, addToBag, findItem, hasMaterials, itemAt, itemIdNum, itemRepairRaw, repairCost, spendGold, spendMaterials,
} from './inventory.js';
import { pointsSpent } from './progress.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').CharacterState} CharacterState */
/** @typedef {import('../../types.js').Item} Item */
/** @typedef {import('../../types.js').ItemRef} ItemRef */
/** @typedef {import('../../types.js').EquipSlot} EquipSlot */
/** @typedef {import('../../types.js').Rarity} Rarity */
/** @typedef {import('../../types.js').Rng} Rng */
/** @typedef {import('../../types.js').Result} Result */

/** @param {string} reason @param {Record<string, number|string>} [params] */
const fail = (reason, params) => (params ? { ok: /** @type {false} */ (false), reason, params } : { ok: /** @type {false} */ (false), reason });

const ITEM_SLOT_SET = new Set(ITEM_SLOTS);

/** 대장장이 재고의 부위 가중치 = SLOT_WEIGHTS 에서 장신구(잡화상 부위 — SHOP.generalSlots 의 키) 뺀 것 */
const STOCK_SLOT_WEIGHTS = Object.freeze(Object.fromEntries(Object.entries(SLOT_WEIGHTS).filter(([s]) => !Object.prototype.hasOwnProperty.call(SHOP.generalSlots, s))));

/** 부위 · 클래스 → 도박에서 그 등급이 나올 수 있는가(전설: 그 부위의 자기 클래스 · 공용 전설 / 세트: 그 부위의 자기 클래스 세트 조각) */
// W1 확정(통합 게이트): 도박의 「그 부위 · 클래스에 전설 · 세트 후보가 있는가」는 P5 specialCandidates(rollGear 가 쓰는 정본 — §6.10
// 「P6이 고르기를 다시 구현하지 않는다」)로 본다 — 화면의 확률과 rollGear 의 후보가 갈라지지 않는다.
const GAMBLE_CANDIDATES = (() => {
  /** @type {Record<string, Record<string, {legendary:boolean, set:boolean}>>} */
  const out = {};
  for (const slot of ITEM_SLOTS) {
    out[slot] = {};
    for (const cls of CLASS_IDS) {
      const legendary = specialCandidates('legendary', { slot, cls }).length > 0;
      const set = specialCandidates('set', { slot, cls }).length > 0;
      out[slot][cls] = { legendary, set };
    }
  }
  return out;
})();

// ───────────────────────── 공통 ─────────────────────────

/** 캐릭터가 있고 마을인가 → 실패 Result | null @param {SimCtx} ctx */
function townGate(ctx) {
  if (!ctx.state.char) return fail('invalid');
  if (ctx.state.scene !== 'town') return fail('notInTown');
  return null;
}

/** 가격 기준 균열 레벨 PL = riftUnlocked @param {CharacterState} char */
function PL(char) { return Math.max(1, Math.floor(char?.riftUnlocked) || 1); }
/** 소모품 · 초기화 가격의 PLc = min(riftUnlocked, lastRiftLevel) @param {CharacterState} char */
function PLc(char) { return Math.max(1, Math.min(PL(char), Math.floor(char?.lastRiftLevel) || 1)); }
/** GROWTH.gold^(L−1) @param {number} L */
const goldMul = (L) => GROWTH.gold ** (Math.max(1, L) - 1);

/** 아이템 가치(정수 ≥ 0) @param {Item} item */
const valueOf = (item) => {
  const v = Number(item?.value);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/** 판 곳(TRADE.shop) — 마지막으로 상호작용한 상점(잡화상이면 general · 그 밖 blacksmith) @param {SimCtx} ctx */
function sellShop(ctx) {
  return ctx.state.town?.lastInteract === 'general' ? 'general' : 'blacksmith';
}

/** TRADE @param {SimCtx} ctx @param {string} shop @param {string} kind @param {number} cost @param {Item|null} item */
function emitTrade(ctx, shop, kind, cost, item) {
  ctx.emit(EV.TRADE, { shop, kind, cost, itemId: item ? item.id : null, rarity: item ? item.rarity : null });
}

/** 진행 중인 재굴림 제안이 그 아이템이면 지운다(팔기 · 분해로 아이템이 사라질 때) @param {CharacterState} ch @param {string} itemId */
function dropOfferFor(ch, itemId) {
  if (ch.shop?.reroll && ch.shop.reroll.itemId === itemId) ch.shop.reroll = null;
}

/**
 * 가방에서 하나씩 팔기 · 분해할 수 있는가 — 장착 'equipped' · 가방 아님 'invalid' · 없음 'noItem' · 잠김 'itemLocked'
 * @param {CharacterState} ch @param {ItemRef} ref @returns {Result}
 */
function checkBagItem(ch, ref) {
  if (!ref || typeof ref !== 'object') return fail('invalid');
  if (ref.where === 'equip') return fail('equipped');
  if (ref.where !== 'bag') return fail('invalid');
  const idx = ref.idx;
  if (!Number.isInteger(idx) || /** @type {number} */ (idx) < 0 || /** @type {number} */ (idx) >= ch.bag.length) return fail('invalid');
  const item = ch.bag[/** @type {number} */ (idx)];
  if (!item) return fail('noItem');
  if (item.flags?.locked) return fail('itemLocked');
  return { ok: true };
}

/** 되사기 목록 앞에(ECON.buybackMax 개 유지 — 밀려난 것은 사라진다) @param {CharacterState} ch @param {Item} item @param {number} price */
function pushBuyback(ch, item, price) {
  ch.buyback.unshift({ item, price });
  if (ch.buyback.length > ECON.buybackMax) ch.buyback.length = ECON.buybackMax;
}

// ───────────────────────── 재고 ─────────────────────────

/**
 * 재고 갱신 — char.shop.stockRun !== char.runs 일 때만(같은 판에서 몇 번 돌아와도 같은 재고 · 산 것만 빠진다 · 재고는 저장된다).
 * makeRng(seedRng(hash32(char.seed, char.runs, 7))) — 대장장이 SHOP.blacksmithStock(rollGear · 장신구 뺀 SLOT_WEIGHTS · ownClassOnly) ·
 * 잡화상 SHOP.generalSlots(목걸이 1 · 반지 3) · 등급 SHOP.stockRarity · ilvl = max(1, PL + stockIlvlOffset) → stockRun = runs · restocks += 1
 * @param {SimCtx} ctx
 */
export function restockShops(ctx) {
  const ch = ctx.state.char;
  if (!ch) return;
  if (!ch.shop) ch.shop = { blacksmith: [], general: [], restocks: 0, stockRun: -1, reroll: null };
  if (ch.shop.stockRun === ch.runs) return;
  const rng = makeRng(seedRng(hash32(ch.seed, ch.runs, SEED_SALT.stock)));
  const level = Math.max(1, PL(ch) + SHOP.stockIlvlOffset);
  /** @type {Item[]} */
  const blacksmith = [];
  for (let k = 0; k < SHOP.blacksmithStock; k++) {
    const rarity = /** @type {Rarity} */ (rng.pick(SHOP.stockRarity) ?? RARITIES[1]);
    blacksmith.push(rollGear(rng, { rarity, level, cls: ch.cls, newId: ctx.newItemId, slotWeights: STOCK_SLOT_WEIGHTS, ownClassOnly: true }));
  }
  /** @type {Item[]} */
  const general = [];
  for (const slot of Object.keys(SHOP.generalSlots)) {
    const n = /** @type {Record<string, number>} */ (SHOP.generalSlots)[slot];
    for (let k = 0; k < n && general.length < SHOP.generalStock; k++) {
      const rarity = /** @type {Rarity} */ (rng.pick(SHOP.stockRarity) ?? RARITIES[1]);
      general.push(rollGear(rng, { rarity, level, cls: ch.cls, newId: ctx.newItemId, slot, ownClassOnly: true }));
    }
  }
  ch.shop.blacksmith = blacksmith;
  ch.shop.general = general;
  ch.shop.stockRun = ch.runs;
  ch.shop.restocks = (Number.isFinite(ch.shop.restocks) ? ch.shop.restocks : 0) + 1;
}

// ───────────────────────── 사기 · 팔기 · 되사기 ─────────────────────────

/**
 * 재고에서 사기 — 'invalid'(상점 · 칸) · 'noItem' · 'bagFull' · 'gold' · 재고에서 빠진다 · flags.bought · TRADE · SAVE{trade}
 * @param {SimCtx} ctx @param {'blacksmith'|'general'} shop @param {number} idx @returns {Result & {idx?:number, item?:Item, cost?:number}}
 */
export function buy(ctx, shop, idx) {
  const g = townGate(ctx); if (g) return g;
  const ch = /** @type {CharacterState} */ (ctx.state.char);
  if (shop !== 'blacksmith' && shop !== 'general') return fail('invalid');
  const list = ch.shop?.[shop];
  if (!Array.isArray(list) || !Number.isInteger(idx) || idx < 0 || idx >= list.length) return fail('noItem');
  const item = list[idx];
  if (!item) return fail('noItem');
  if (ch.bag.indexOf(null) < 0) return fail('bagFull');
  const cost = priceBuy(item);
  if (!(ch.gold >= cost)) return fail('gold');
  spendGold(ctx, cost, 'buy');
  list.splice(idx, 1);
  if (!item.flags || typeof item.flags !== 'object') item.flags = {};
  item.flags.bought = true;
  const r = addToBag(ctx, item, 'buy');
  emitTrade(ctx, shop, 'buy', cost, item);
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'trade' });
  return { ok: true, idx: r.ok ? r.idx : -1, item, cost };
}

/**
 * 가방의 아이템 하나 팔기 — 장착 'equipped' · 잠김 'itemLocked' · 판매가 priceSell · 되사기 목록 앞에(10개) · GOLD · BAG · TRADE · SAVE
 * @param {SimCtx} ctx @param {ItemRef} ref @returns {Result & {gold?:number}}
 */
export function sell(ctx, ref) {
  const g = townGate(ctx); if (g) return g;
  const ch = /** @type {CharacterState} */ (ctx.state.char);
  const c = checkBagItem(ch, ref);
  if (!c.ok) return c;
  const idx = /** @type {number} */ (ref.idx);
  const item = /** @type {Item} */ (ch.bag[idx]);
  const price = priceSell(item);
  ch.bag[idx] = null;
  dropOfferFor(ch, item.id);
  pushBuyback(ch, item, price);
  addGold(ctx, price, 'sell');
  ctx.emit(EV.BAG, { reason: 'sell' });
  emitTrade(ctx, sellShop(ctx), 'sell', price, item);
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'sell' });
  return { ok: true, gold: price };
}

/**
 * 일괄 판매 — 잠긴 것 · 장착 · 없는 칸 · 같은 칸 두 번은 건너뛴다(skipped) · 하나도 못 팔면 'nothing' · GOLD 한 번 · TRADE{sellMany}
 * @param {SimCtx} ctx @param {ItemRef[]} refs @returns {Result & {sold?:number, gold?:number, skipped?:number}}
 */
export function sellMany(ctx, refs) {
  const g = townGate(ctx); if (g) return g;
  const ch = /** @type {CharacterState} */ (ctx.state.char);
  if (!Array.isArray(refs)) return fail('invalid');
  let gold = 0;
  let sold = 0;
  let skipped = 0;
  for (const ref of refs) {
    if (!checkBagItem(ch, ref).ok) { skipped++; continue; }
    const idx = /** @type {number} */ (ref.idx);
    const item = /** @type {Item} */ (ch.bag[idx]);
    const price = priceSell(item);
    ch.bag[idx] = null;
    dropOfferFor(ch, item.id);
    pushBuyback(ch, item, price);
    gold += price;
    sold++;
  }
  if (!sold) return fail('nothing');
  addGold(ctx, gold, 'sell');
  ctx.emit(EV.BAG, { reason: 'sell' });
  emitTrade(ctx, sellShop(ctx), 'sellMany', gold, null);
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'sell' });
  return { ok: true, sold, gold, skipped };
}

/**
 * 되사기 — 판 값 그대로(이득 0) · 'noItem' · 'bagFull' · 'gold' · 목록에서 빠지고 가방으로 · TRADE · SAVE{trade}
 * @param {SimCtx} ctx @param {number} idx @returns {Result & {idx?:number, cost?:number}}
 */
export function buyback(ctx, idx) {
  const g = townGate(ctx); if (g) return g;
  const ch = /** @type {CharacterState} */ (ctx.state.char);
  if (!Number.isInteger(idx) || idx < 0 || idx >= ch.buyback.length) return fail('noItem');
  const entry = ch.buyback[idx];
  if (!entry?.item) return fail('noItem');
  if (ch.bag.indexOf(null) < 0) return fail('bagFull');
  const cost = Math.max(0, Math.round(Number(entry.price) || 0));
  if (!(ch.gold >= cost)) return fail('gold');
  spendGold(ctx, cost, 'buyback');
  ch.buyback.splice(idx, 1);
  const r = addToBag(ctx, entry.item, 'buyback');
  emitTrade(ctx, sellShop(ctx), 'buyback', cost, entry.item);
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'trade' });
  return { ok: true, idx: r.ok ? r.idx : -1, cost };
}

// ───────────────────────── 수리 · 분해 · 제작 ─────────────────────────

/**
 * 일괄 수리 — 고칠 것이 없으면 'nothing' · 골드가 되면 전부(repairCost) · 모자라면 주무기 → 갑옷 → 보조 → 나머지 순으로 살 수 있는 만큼(각 아이템 round 값) →
 * {ok:true, partial:true, repaired, cost} · 하나도 못 고치면 'gold' · refreshStats · TRADE · SAVE. 수리비는 등급과 무관(§7.10).
 * @param {SimCtx} ctx @returns {Result & {partial?:boolean, repaired?:EquipSlot[], cost?:number}}
 */
export function repairAll(ctx) {
  const g = townGate(ctx); if (g) return g;
  const ch = /** @type {CharacterState} */ (ctx.state.char);
  /** @type {EquipSlot[]} */
  const damaged = [];
  for (const s of EQUIP_SLOTS) {
    const it = ch.equip[s];
    if (it && it.dur < (it.durMax > 0 ? it.durMax : ITEM.durMax)) damaged.push(/** @type {EquipSlot} */ (s));
  }
  if (!damaged.length) return fail('nothing');
  const full = repairCost(ch);
  /** @type {EquipSlot[]} */
  let repaired;
  let cost;
  if (ch.gold >= full) {
    repaired = damaged;
    cost = full;
  } else {
    const order = [...REPAIR_ORDER.filter(s => damaged.includes(/** @type {EquipSlot} */ (s))), ...damaged.filter(s => !REPAIR_ORDER.includes(s))];
    repaired = [];
    cost = 0;
    let budget = ch.gold;
    for (const s of order) {
      const c = Math.round(itemRepairRaw(ch.equip[/** @type {EquipSlot} */ (s)]));
      if (c > budget) continue;
      budget -= c;
      cost += c;
      repaired.push(/** @type {EquipSlot} */ (s));
    }
    if (!repaired.length) return fail('gold');
  }
  spendGold(ctx, cost, 'repair');
  for (const s of repaired) {
    const it = /** @type {Item} */ (ch.equip[s]);
    it.dur = it.durMax > 0 ? it.durMax : ITEM.durMax;
  }
  ctx.refreshStats();
  emitTrade(ctx, 'blacksmith', 'repair', cost, null);
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'repair' });
  return { ok: true, partial: repaired.length < damaged.length, repaired, cost };
}

/** 분해 결과 — SALVAGE[rarity] 사본 @param {Item} item @returns {Partial<Record<import('../../types.js').MaterialId, number>>} */
export function salvageYield(item) {
  const row = /** @type {Record<string, Record<string, number>>} */ (SALVAGE)[item?.rarity] ?? {};
  /** @type {Record<string, number>} */
  const out = {};
  for (const id of MATERIAL_IDS) if (row[id] > 0) out[id] = row[id];
  return out;
}

/**
 * 가방의 아이템 하나 분해 — 장착 'equipped' · 잠김 'itemLocked' · 아이템이 사라지고 SALVAGE 재료 · MATERIALS · BAG · TRADE · SAVE
 * @param {SimCtx} ctx @param {ItemRef} ref @returns {Result & {materials?:Record<string, number>}}
 */
export function salvage(ctx, ref) {
  const g = townGate(ctx); if (g) return g;
  const ch = /** @type {CharacterState} */ (ctx.state.char);
  const c = checkBagItem(ch, ref);
  if (!c.ok) return c;
  const idx = /** @type {number} */ (ref.idx);
  const item = /** @type {Item} */ (ch.bag[idx]);
  const mats = salvageYield(item);
  ch.bag[idx] = null;
  dropOfferFor(ch, item.id);
  addMaterials(ctx, mats, 'salvage');
  ctx.emit(EV.BAG, { reason: 'salvage' });
  emitTrade(ctx, 'blacksmith', 'salvage', 0, item);
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'salvage' });
  return { ok: true, materials: mats };
}

/**
 * 일괄 분해 — 잠긴 것 · 장착 · 없는 칸은 건너뛴다 · 하나도 못 하면 'nothing' · MATERIALS 한 번 · TRADE{salvageMany}
 * @param {SimCtx} ctx @param {ItemRef[]} refs @returns {Result & {salvaged?:number, skipped?:number, materials?:Record<string, number>}}
 */
export function salvageMany(ctx, refs) {
  const g = townGate(ctx); if (g) return g;
  const ch = /** @type {CharacterState} */ (ctx.state.char);
  if (!Array.isArray(refs)) return fail('invalid');
  /** @type {Record<string, number>} */
  const total = {};
  let salvaged = 0;
  let skipped = 0;
  for (const ref of refs) {
    if (!checkBagItem(ch, ref).ok) { skipped++; continue; }
    const idx = /** @type {number} */ (ref.idx);
    const item = /** @type {Item} */ (ch.bag[idx]);
    const y = salvageYield(item);
    for (const id of Object.keys(y)) total[id] = (total[id] ?? 0) + /** @type {any} */ (y)[id];
    ch.bag[idx] = null;
    dropOfferFor(ch, item.id);
    salvaged++;
  }
  if (!salvaged) return fail('nothing');
  addMaterials(ctx, total, 'salvage');
  ctx.emit(EV.BAG, { reason: 'salvage' });
  emitTrade(ctx, 'blacksmith', 'salvageMany', 0, null);
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'salvage' });
  return { ok: true, salvaged, skipped, materials: total };
}

/** 제작 재료 비용 */
const CRAFT_MATS = Object.freeze({ scrap: CRAFT.scrap, dust: CRAFT.dust, essence: CRAFT.essence });

/**
 * 제작 — 부위를 고르고 골드 priceCraft + 재료(CRAFT) → rollGear({rarity:'rare', slot, ownClassOnly:true}) · ilvl = riftUnlocked · flags.crafted ·
 * 'invalid'(부위) · 'bagFull' · 'gold' · 'materials' · TRADE · SAVE{trade}
 * @param {SimCtx} ctx @param {import('../../types.js').ItemSlot} slot @returns {Result & {item?:Item, ref?:ItemRef}}
 */
export function craft(ctx, slot) {
  const g = townGate(ctx); if (g) return g;
  const ch = /** @type {CharacterState} */ (ctx.state.char);
  if (!ITEM_SLOT_SET.has(slot)) return fail('invalid');
  if (ch.bag.indexOf(null) < 0) return fail('bagFull');
  const cost = priceCraft(ch);
  if (!(ch.gold >= cost)) return fail('gold');
  if (!hasMaterials(ch, CRAFT_MATS)) return fail('materials');
  const item = rollGear(ctx.rng.shop, { rarity: 'rare', level: PL(ch), cls: ch.cls, newId: ctx.newItemId, slot, ownClassOnly: true });
  if (!item.flags || typeof item.flags !== 'object') item.flags = {};
  item.flags.crafted = true;
  spendGold(ctx, cost, 'craft');
  spendMaterials(ctx, CRAFT_MATS, 'craft');
  const r = addToBag(ctx, item, 'craft');
  emitTrade(ctx, 'blacksmith', 'craft', cost, item);
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'trade' });
  return { ok: true, item, ref: { where: 'bag', idx: r.ok ? r.idx : -1 } };
}

// ───────────────────────── 도박 ─────────────────────────

/**
 * 그 부위 · 클래스에서의 실제 도박 확률(합 1 · 화면에 공개) — GAMBLE.rarity 에서, 그 부위에 자기 클래스(또는 공용) 전설이 없으면 전설 몫을,
 * 자기 클래스 세트 조각이 없으면 세트 몫을 희귀에 더한다. 일반은 0.
 * @param {CharacterState} char @param {string} slot @returns {Record<Rarity, number>}
 */
export function gambleOdds(char, slot) {
  const w = /** @type {Record<string, number>} */ (GAMBLE.rarity);
  const cand = GAMBLE_CANDIDATES[slot]?.[char?.cls] ?? { legendary: false, set: false };
  /** @type {Record<string, number>} */
  const raw = {};
  for (const r of RARITIES) raw[r] = w[r] > 0 ? w[r] : 0;
  if (!cand.legendary) { raw.rare += raw.legendary; raw.legendary = 0; }
  if (!cand.set) { raw.rare += raw.set; raw.set = 0; }
  let total = 0;
  for (const r of RARITIES) total += raw[r];
  /** @type {any} */
  const out = {};
  for (const r of RARITIES) out[r] = total > 0 ? raw[r] / total : 0;
  return out;
}

/** 도박 등급 한 번 굴림(gambleOdds 그대로 — 화면의 확률과 실제가 같다) @param {Rng} rng @param {CharacterState} char @param {string} slot @returns {Rarity} */
export function gambleRarity(rng, char, slot) {
  return /** @type {Rarity} */ (rng.pick(gambleOdds(char, slot)) ?? RARITIES[2]);
}

/**
 * 도박 — 골드 priceGamble → 등급 gambleRarity → rollGear({rarity, slot}) · ilvl = riftUnlocked · flags.gambled ·
 * 'invalid'(부위) · 'bagFull' · 'gold' · TRADE · SAVE{trade}
 * @param {SimCtx} ctx @param {import('../../types.js').ItemSlot} slot @returns {Result & {item?:Item, ref?:ItemRef, cost?:number}}
 */
export function gamble(ctx, slot) {
  const g = townGate(ctx); if (g) return g;
  const ch = /** @type {CharacterState} */ (ctx.state.char);
  if (!ITEM_SLOT_SET.has(slot)) return fail('invalid');
  if (ch.bag.indexOf(null) < 0) return fail('bagFull');
  const cost = priceGamble(ch, slot);
  if (!(ch.gold >= cost)) return fail('gold');
  const rarity = gambleRarity(ctx.rng.shop, ch, slot);
  const item = rollGear(ctx.rng.shop, { rarity, level: PL(ch), cls: ch.cls, newId: ctx.newItemId, slot });
  if (!item.flags || typeof item.flags !== 'object') item.flags = {};
  item.flags.gambled = true;
  spendGold(ctx, cost, 'gamble');
  const r = addToBag(ctx, item, 'gamble');
  emitTrade(ctx, 'gambler', 'gamble', cost, item);
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'trade' });
  return { ok: true, item, ref: { where: 'bag', idx: r.ok ? r.idx : -1 }, cost };
}

// ───────────────────────── 재굴림(신비술사) ─────────────────────────

/** 마법 등급 이름 키 [접미어?, 접두어?, 기본형](§5.13-4) — 재굴림으로 옵션이 바뀌면 다시 만든다 @param {Item} item */
function magicName(item) {
  /** @type {string[]} */
  const out = [];
  const suf = item.affixes.find(a => ITEM_AFFIXES_BY_ID[a.id]?.kind === 'suffix');
  const pre = item.affixes.find(a => ITEM_AFFIXES_BY_ID[a.id]?.kind === 'prefix');
  if (suf) out.push('afx.' + suf.id + '.s');
  if (pre) out.push('afx.' + pre.id + '.p');
  out.push('base.' + item.baseId + '.' + item.tier);
  return out;
}

/**
 * 재굴림 제안 — 가방 · 장착의 아이템 · 옵션 하나 · 이미 다른 옵션을 고정했으면 'rerollLocked' · 비용을 미리 계산(모자라면 'gold' · 'materials' — 결제는 choose 때).
 * 후보 둘은 그 아이템 · 재굴림 횟수 · 옵션 칸에서 파생한 난수로 굴린다 — 취소(무료) 뒤 다시 제안해도 같은 후보(공짜로 새 후보를 보는 길이 없다 · NOTES-P6).
 * options[0] = 기존 · [1..2] = 새 후보 · char.shop.reroll 에 둔다(저장하지 않는다)
 * @param {SimCtx} ctx @param {ItemRef} ref @param {number} affixIdx @returns {Result & {offer?:import('../../types.js').RerollOffer}}
 */
export function rerollOffer(ctx, ref, affixIdx) {
  const g = townGate(ctx); if (g) return g;
  const ch = /** @type {CharacterState} */ (ctx.state.char);
  if (!ref || (ref.where !== 'bag' && ref.where !== 'equip')) return fail('invalid');
  const item = itemAt(ctx.state, ref);
  if (!item) return fail('noItem');
  if (!Number.isInteger(affixIdx) || affixIdx < 0 || affixIdx >= (item.affixes?.length ?? 0)) return fail('invalid');
  if (item.rerollIdx !== null && item.rerollIdx !== undefined && item.rerollIdx !== affixIdx) return fail('rerollLocked');
  const cost = priceReroll(item);
  if (!(ch.gold >= cost.gold)) return fail('gold');
  if (!hasMaterials(ch, { dust: cost.dust, essence: cost.essence })) return fail('materials');
  const rng = makeRng(seedRng(hash32(ch.seed, itemIdNum(item.id), item.rerolls | 0, affixIdx, SEED_SALT.reroll)));
  const cur = item.affixes[affixIdx];
  const a = rerollAffix(rng, item, affixIdx, ch.cls) ?? { ...cur };
  // 두 번째 후보는 첫 후보와 겹치지 않게 — 첫 후보를 「다른 옵션」으로 넣은 사본에서 굴린다(rerollAffix 는 다른 옵션과 중복 없이 고른다)
  const b = rerollAffix(rng, { ...item, affixes: [...item.affixes, a] }, affixIdx, ch.cls) ?? { ...cur };
  /** @type {import('../../types.js').RerollOffer} */
  const offer = {
    itemId: item.id,
    where: /** @type {'bag'|'equip'} */ (ref.where),
    idx: ref.where === 'bag' ? /** @type {number} */ (ref.idx) : EQUIP_SLOTS.indexOf(/** @type {EquipSlot} */ (ref.slot)),
    affixIdx,
    options: [{ ...cur }, { ...a }, { ...b }],
    cost,
  };
  ch.shop.reroll = offer;
  return { ok: true, offer };
}

/**
 * 재굴림 고르기 — 0 = 기존 유지 · 1|2 = 후보. 비용 결제(골드 · 비전 가루 · 3회째 뒤 망각의 정수) · rerollIdx 고정 · rerolls += 1 ·
 * 제안이 없거나 아이템이 사라졌으면 'noOffer' · 모자라면 'gold' · 'materials'(제안은 남는다) · 장착 중이면 refreshStats · BAG · TRADE · SAVE{trade}
 * @param {SimCtx} ctx @param {number} choice @returns {Result & {item?:Item}}
 */
export function rerollChoose(ctx, choice) {
  const g = townGate(ctx); if (g) return g;
  const ch = /** @type {CharacterState} */ (ctx.state.char);
  const offer = ch.shop?.reroll;
  if (!offer) return fail('noOffer');
  if (!Number.isInteger(choice) || choice < 0 || choice >= offer.options.length || !offer.options[choice]) return fail('invalid');
  const ref = findItem(ctx.state, offer.itemId);
  const item = ref && (ref.where === 'bag' || ref.where === 'equip') ? itemAt(ctx.state, ref) : null;
  if (!item || !item.affixes?.[offer.affixIdx] || (item.rerollIdx != null && item.rerollIdx !== offer.affixIdx)) {
    ch.shop.reroll = null;
    return fail('noOffer');
  }
  const cost = priceReroll(item);
  if (!(ch.gold >= cost.gold)) return fail('gold');
  const mats = { dust: cost.dust, essence: cost.essence };
  if (!hasMaterials(ch, mats)) return fail('materials');
  spendGold(ctx, cost.gold, 'reroll');
  spendMaterials(ctx, mats, 'reroll');
  item.affixes[offer.affixIdx] = { ...offer.options[choice] };
  item.rerollIdx = offer.affixIdx;
  item.rerolls = (item.rerolls | 0) + 1;
  if (item.rarity === 'magic') item.name = magicName(item);
  ch.shop.reroll = null;
  if (ref && ref.where === 'equip') ctx.refreshStats();
  ctx.emit(EV.BAG, { reason: 'reroll' });
  emitTrade(ctx, 'mystic', 'reroll', cost.gold, item);
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'trade' });
  return { ok: true, item };
}

/** 재굴림 취소 — 비용 없음 · 제안이 없으면 'noOffer' @param {SimCtx} ctx @returns {Result} */
export function rerollCancel(ctx) {
  const g = townGate(ctx); if (g) return g;
  const ch = /** @type {CharacterState} */ (ctx.state.char);
  if (!ch.shop?.reroll) return fail('noOffer');
  ch.shop.reroll = null;
  return { ok: true };
}

// ───────────────────────── 소모품 · 무료 · 스킬 초기화 ─────────────────────────

/** @param {SimCtx} ctx @param {'potion'|'scroll'} what @param {number} n @returns {Result & {bought?:number, cost?:number, partial?:boolean}} */
function buyConsumable(ctx, what, n) {
  const g = townGate(ctx); if (g) return g;
  const ch = /** @type {CharacterState} */ (ctx.state.char);
  const want = Math.floor(Number(n));
  if (!(want >= 1)) return fail('invalid');
  const have = what === 'potion' ? ch.potions : ch.scrolls;
  const max = what === 'potion' ? ECON.potionMax : ECON.scrollMax;
  const room = Math.max(0, max - (Number.isFinite(have) ? have : 0));
  if (room < 1) return fail('full');
  const price = what === 'potion' ? pricePotion(ch) : priceScroll(ch);
  let count = Math.min(want, room);
  if (price > 0) count = Math.min(count, Math.floor(ch.gold / price));
  if (count < 1) return fail('gold');
  const cost = count * price;
  spendGold(ctx, cost, 'buy');
  addConsumable(ctx, what, count);
  emitTrade(ctx, 'general', what, cost, null);
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'trade' });
  return { ok: true, bought: count, cost, partial: count < want };
}

/** 체력 포션 사기 — 상한(ECON.potionMax)까지만 · 골드가 되는 만큼(partial) · 'full' · 'gold' @param {SimCtx} ctx @param {number} n */
export function buyPotions(ctx, n) { return buyConsumable(ctx, 'potion', n); }
/** 귀환 두루마리 사기 — 상한(ECON.scrollMax)까지만 · 골드가 되는 만큼 · 'full' · 'gold' @param {SimCtx} ctx @param {number} n */
export function buyScrolls(ctx, n) { return buyConsumable(ctx, 'scroll', n); }

/** 무료로 받을 수 있는가 — 그것이 0개이고 골드가 그 값보다 적을 때만(파밍 경로가 되지 않게) @param {CharacterState} char @param {'potion'|'scroll'} what */
export function canTakeFree(char, what) {
  if (!char) return false;
  if (what === 'potion') return !(char.potions > 0) && char.gold < pricePotion(char);
  if (what === 'scroll') return !(char.scrolls > 0) && char.gold < priceScroll(char);
  return false;
}

/** 무료 1개(canTakeFree) · 아니면 'notEligible' · TRADE{free} · SAVE @param {SimCtx} ctx @param {'potion'|'scroll'} what @returns {Result} */
export function takeFree(ctx, what) {
  const g = townGate(ctx); if (g) return g;
  const ch = /** @type {CharacterState} */ (ctx.state.char);
  if (what !== 'potion' && what !== 'scroll') return fail('invalid');
  if (!canTakeFree(ch, what)) return fail('notEligible');
  addConsumable(ctx, what, 1);
  emitTrade(ctx, 'general', 'free', 0, null);
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'free' });
  return { ok: true };
}

/**
 * 스킬 초기화(신비술사 · 골드 priceReset) — 찍은 것도 바에 놓인 것도 없으면 'nothing' · 'gold' · ranks 비우고 bar 비움 · refreshStats · SKILLS{reset} · TRADE · SAVE
 * @param {SimCtx} ctx @returns {Result & {cost?:number}}
 */
export function resetSkills(ctx) {
  const g = townGate(ctx); if (g) return g;
  const ch = /** @type {CharacterState} */ (ctx.state.char);
  const barUsed = (ch.skills?.bar ?? []).some(Boolean);
  if (pointsSpent(ch) === 0 && !barUsed) return fail('nothing');
  const cost = priceReset(ch);
  if (!(ch.gold >= cost)) return fail('gold');
  spendGold(ctx, cost, 'reset');
  ch.skills.ranks = {};
  ch.skills.bar = emptyArray(SKILL_BAR);
  ctx.refreshStats();
  ctx.emit(EV.SKILLS, { reason: 'reset', nodeId: null, rank: 0 });
  emitTrade(ctx, 'mystic', 'reset', cost, null);
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'skills' });
  return { ok: true, cost };
}

// ───────────────────────── 가격(전부 정수 · §7.10) ─────────────────────────

/** 판매가 = max(1, round(value × sellRate)) @param {Item} item @returns {number} */
export function priceSell(item) { return Math.max(1, Math.round(valueOf(item) * PRICES.sellRate)); }

/** 상점 구매가 = round(value × buyMul[rarity]) — 희귀 2.5(골라 사는 희귀가 사냥을 앞지르지 않게) @param {Item} item @returns {number} */
export function priceBuy(item) {
  const mul = /** @type {Record<string, number>} */ (PRICES.buyMul)[item?.rarity] ?? PRICES.buyMul.rare;
  return Math.max(1, Math.round(valueOf(item) * mul));
}

/**
 * 도박가 = round(GAMBLE.price × slotValue / GAMBLE.slotRef × G^(PL−1)) — 주무기는 GAMBLE.mainHandValue · 모르는 부위는 0
 * @param {CharacterState} char @param {string} slot @returns {number}
 */
export function priceGamble(char, slot) {
  if (!ITEM_SLOT_SET.has(slot)) return 0;
  const sv = slot === 'mainHand' ? GAMBLE.mainHandValue : (/** @type {Record<string, number>} */ (ITEM.slotValue)[slot] ?? 0);
  return Math.round(GAMBLE.price * sv / GAMBLE.slotRef * goldMul(PL(char)));
}

/**
 * 재굴림 비용 — 골드 round(REROLL.gold × G^(ilvl−1) × growth^min(rerolls, cap)) · 비전 가루 min(dustCap, dustBase + rerolls) · 망각의 정수 rerolls ≥ essenceFrom ? 1 : 0
 * @param {Item} item @returns {{gold:number, dust:number, essence:number}}
 */
export function priceReroll(item) {
  const ilvl = Math.max(1, Math.floor(item?.ilvl) || 1);
  const n = Math.max(0, Math.floor(item?.rerolls) || 0);
  return {
    gold: Math.round(REROLL.gold * goldMul(ilvl) * REROLL.growth ** Math.min(n, REROLL.cap)),
    dust: Math.min(REROLL.dustCap, REROLL.dustBase + n),
    essence: n >= REROLL.essenceFrom ? 1 : 0,
  };
}

/** 제작 골드 = round(CRAFT.gold × G^(PL−1)) (+ 재료 CRAFT) @param {CharacterState} char @returns {number} */
export function priceCraft(char) { return Math.round(CRAFT.gold * goldMul(PL(char))); }
/** 스킬 초기화 = round(resetPerLevel × level × G^(PLc−1)) @param {CharacterState} char @returns {number} */
export function priceReset(char) { return Math.round(PRICES.resetPerLevel * Math.max(1, Math.floor(char?.level) || 1) * goldMul(PLc(char))); }
/** 체력 포션 = round(potion × G^(PLc−1)) @param {CharacterState} char @returns {number} */
export function pricePotion(char) { return Math.round(PRICES.potion * goldMul(PLc(char))); }
/** 귀환 두루마리 = round(scroll × G^(PLc−1)) @param {CharacterState} char @returns {number} */
export function priceScroll(char) { return Math.round(PRICES.scroll * goldMul(PLc(char))); }
