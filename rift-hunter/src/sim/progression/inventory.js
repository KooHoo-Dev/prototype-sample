// OWNER: P6 — 계약 §6.11
// 가방 · 장착 · 보관함 · 정렬 · 잠금 · 내구도 · 사망 대가 · 수리비. char.gold · materials · potions · scrolls 를 고치는 곳은 P6 파일뿐이다
// (더하기 = addGold · addMaterials · addConsumable · 빼기 = spendGold · spendMaterials — 상점이 쓴다).
// 아이템은 한 자리(가방 칸 · 장착 칸 · 보관함 칸 · 재고 · 되사기)에만 있다 — 옮기는 명령은 「빼고 넣기」를 같은 호출 안에서 끝낸다(복사 0).

import { EV } from '../../core/events.js';
import { BAG_SIZE, EQUIP_SLOTS, ITEM_SLOTS, MATERIAL_IDS, RARITIES } from '../../core/constants.js';
import { BASES_BY_ID } from '../../data/index.js';
import { ECON, PRICES } from '../../data/economy.js';
import { ITEM } from '../../data/items.js';
import { GROWTH } from '../../data/rift.js';
import { computeStats, powerScore } from '../loot/stats.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').GameState} GameState */
/** @typedef {import('../../types.js').CharacterState} CharacterState */
/** @typedef {import('../../types.js').Item} Item */
/** @typedef {import('../../types.js').ItemRef} ItemRef */
/** @typedef {import('../../types.js').EquipSlot} EquipSlot */
/** @typedef {import('../../types.js').Result} Result */

/** @param {string} reason @param {Record<string, number|string>} [params] */
const fail = (reason, params) => (params ? { ok: /** @type {false} */ (false), reason, params } : { ok: /** @type {false} */ (false), reason });

const EQUIP_SET = new Set(EQUIP_SLOTS);
/** @type {Record<string, number>} */
const RARITY_RANK = Object.fromEntries(RARITIES.map((r, i) => [r, i]));
/** @type {Record<string, number>} */
const SLOT_RANK = Object.fromEntries(ITEM_SLOTS.map((s, i) => [s, i]));

/** 정수로 자른 0 이상의 양(NaN · 음수 → 0) @param {any} v */
const nonNeg = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

// ───────────────────────── 조회 ─────────────────────────

/** 아이템 ID → ItemRef(가방 · 장착 · 보관함 · 상점 재고 · 되사기) @param {GameState} state @param {string} itemId @returns {ItemRef|null} */
export function findItem(state, itemId) {
  const ch = state.char;
  if (ch) {
    for (let i = 0; i < ch.bag.length; i++) if (ch.bag[i]?.id === itemId) return { where: 'bag', idx: i };
    for (const s of EQUIP_SLOTS) if (ch.equip[s]?.id === itemId) return { where: 'equip', slot: /** @type {EquipSlot} */ (s) };
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
    case 'equip': return ch?.equip[/** @type {EquipSlot} */ (ref.slot)] ?? null;
    case 'stash': return state.account?.stash[ref.idx ?? -1] ?? null;
    case 'stock': return ch?.shop?.[ref.shop ?? 'blacksmith']?.[ref.idx ?? -1] ?? null;
    case 'buyback': return ch?.buyback[ref.idx ?? -1]?.item ?? null;
    default: return null;
  }
}

/** 'i<n>' 의 n(꼴이 다르면 -1) @param {any} id */
export function itemIdNum(id) {
  if (typeof id !== 'string' || id.length < 2 || id[0] !== 'i') return -1;
  const s = id.slice(1);
  if (!/^\d+$/.test(s)) return -1;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : -1;
}

/**
 * 캐릭터가 가진 아이템 전부(장착 → 가방 → 대장장이 재고 → 잡화상 재고 → 되사기)를 돈다 — 세이브 · ID 정리 · 테스트
 * @param {CharacterState|null} char @param {(item:Item, where:string) => void} fn
 */
export function eachCharItem(char, fn) {
  if (!char) return;
  for (const s of EQUIP_SLOTS) { const it = char.equip?.[s]; if (it) fn(it, 'equip'); }
  for (const it of char.bag ?? []) if (it) fn(it, 'bag');
  for (const it of char.shop?.blacksmith ?? []) if (it) fn(it, 'stock');
  for (const it of char.shop?.general ?? []) if (it) fn(it, 'stock');
  for (const e of char.buyback ?? []) if (e?.item) fn(e.item, 'buyback');
}

// ───────────────────────── 가방 칸 수(피드백 2 D4) ─────────────────────────
// 가방은 BAG_SIZE(30)칸이다. 옛 세이브(40칸 시절)의 넘친 아이템은 보관함 빈칸으로 옮기고(moveBagOverflowToStash — 캐릭터를 붙일 때),
// 보관함도 차면 가방 배열의 칸 밖(idx ≥ BAG_SIZE)에 그대로 둔다 — 사라지는 아이템 0. 든 아이템이 BAG_SIZE 아래로 줄 때까지 새로 넣지 못한다
// (줍기 · 사기 · 되사기 · 제작 · 도박 · 벗기 · 보관함에서 꺼내기 — 모두 freeBagIdx 로). 칸이 비면 넘친 아이템을 칸 안으로 당긴다(settleBag).

/** 가방에 든 아이템 수 @param {CharacterState|null|undefined} ch */
export function bagCount(ch) {
  let n = 0;
  for (const it of ch?.bag ?? []) if (it) n++;
  return n;
}

/** 가방이 찼다(든 아이템 ≥ BAG_SIZE — 넘친 옛 세이브 포함) @param {CharacterState|null|undefined} ch */
export function isBagFull(ch) {
  return bagCount(ch) >= BAG_SIZE;
}

/**
 * 넘친 가방 정리(제자리 · 아이템 수는 그대로): 칸(BAG_SIZE) 밖의 아이템을 칸 안의 빈자리로 당기고, 칸 밖의 빈자리는 없앤다(길이 = BAG_SIZE + 남은 넘친 수).
 * 넘친 것이 없으면 아무것도 하지 않는다 → 칸 안으로 당긴 수
 * @param {CharacterState|null|undefined} ch @returns {number}
 */
export function settleBag(ch) {
  const bag = ch?.bag;
  if (!Array.isArray(bag)) return 0;
  while (bag.length < BAG_SIZE) bag.push(null);
  if (bag.length === BAG_SIZE) return 0;
  let moved = 0;
  let hole = bag.indexOf(null);
  for (let i = BAG_SIZE; i < bag.length && hole >= 0 && hole < BAG_SIZE; i++) {
    if (!bag[i]) continue;
    bag[hole] = bag[i];
    bag[i] = null;
    moved++;
    hole = bag.indexOf(null, hole + 1);
  }
  const over = bag.slice(BAG_SIZE).filter(Boolean);
  bag.length = BAG_SIZE;
  for (const it of over) bag.push(it);
  return moved;
}

/**
 * 새 아이템을 넣을 가방 칸 — 든 아이템이 BAG_SIZE 이상이면(넘친 옛 세이브 포함) -1 · 아니면 넘친 것을 먼저 당긴 뒤 칸 안의 빈 첫 칸
 * @param {CharacterState|null|undefined} ch @returns {number}
 */
export function freeBagIdx(ch) {
  if (!ch || !Array.isArray(ch.bag) || isBagFull(ch)) return -1;
  settleBag(ch);
  const i = ch.bag.indexOf(null);
  return i >= 0 && i < BAG_SIZE ? i : -1;
}

/**
 * 캐릭터를 붙일 때(GameSim.loadCharacter) — 가방 칸 밖(idx ≥ BAG_SIZE)의 아이템을 칸 안 빈자리 → 보관함 빈칸 순으로 옮긴다.
 * 둘 다 차면 칸 밖에 그대로 둔다(사라지지 않는다). → {toBag, toStash, left}(옮긴 것이 있으면 부르는 쪽이 BAG · SAVE_REQUEST{all})
 * @param {GameState} state @returns {{toBag:number, toStash:number, left:number}}
 */
export function moveBagOverflowToStash(state) {
  const ch = state?.char;
  const out = { toBag: 0, toStash: 0, left: 0 };
  if (!ch || !Array.isArray(ch.bag)) return out;
  out.toBag = settleBag(ch);
  const stash = state.account?.stash;
  if (Array.isArray(stash)) {
    while (ch.bag.length > BAG_SIZE) {
      const j = stash.indexOf(null);
      if (j < 0) break;
      stash[j] = /** @type {Item} */ (ch.bag.pop());
      out.toStash++;
    }
  }
  out.left = Math.max(0, ch.bag.length - BAG_SIZE);
  return out;
}

// ───────────────────────── 더하기 · 빼기(재화) ─────────────────────────

/**
 * 빈 첫 칸에 넣는다(피드백 2 D4: freeBagIdx — 든 아이템이 BAG_SIZE 이상이면 'bagFull') · BAG
 * @param {SimCtx} ctx @param {Item} item @param {string} [reason] BAG 의 reason(기본 'pickup')
 * @returns {{ok:true, idx:number}|{ok:false, reason:'bagFull'}}
 */
export function addToBag(ctx, item, reason = 'pickup') {
  const ch = ctx.state.char;
  if (!ch) return { ok: false, reason: 'bagFull' };
  const idx = freeBagIdx(ch);
  if (idx < 0) return { ok: false, reason: 'bagFull' };
  ch.bag[idx] = item;
  ctx.emit(EV.BAG, { reason });
  return { ok: true, idx };
}

/**
 * 골드를 더한다(정수 · amount ≥ 0 — 음수 · NaN 은 0) · GOLD(더한 게 있을 때) · 균열 장면이면 rift.stats.gold · meter.runGold 에도
 * @param {SimCtx} ctx @param {number} amount @param {string} reason @returns {number} 더한 양
 */
export function addGold(ctx, amount, reason) {
  const st = ctx.state;
  const ch = st.char;
  if (!ch) return 0;
  const n = nonNeg(amount);
  if (!n) return 0;
  ch.gold += n;
  if (st.scene === 'rift' && st.rift) {
    st.rift.stats.gold += n;
    st.meter.runGold += n;
  }
  ctx.emit(EV.GOLD, { gold: ch.gold, delta: n, reason });
  return n;
}

/**
 * 골드를 쓴다 — 모자라면 아무것도 바꾸지 않고 false(결과는 절대 음수가 아니다) · GOLD{delta < 0}
 * @param {SimCtx} ctx @param {number} amount 정수 ≥ 0 @param {string} reason @returns {boolean}
 */
export function spendGold(ctx, amount, reason) {
  const ch = ctx.state.char;
  if (!ch) return false;
  const n = Math.round(Number(amount));
  if (!(n >= 0)) return false;
  if (!(ch.gold >= n)) return false;
  if (!n) return true;
  ch.gold -= n;
  ctx.emit(EV.GOLD, { gold: ch.gold, delta: -n, reason });
  return true;
}

/**
 * 재료를 더한다 · MATERIALS(더한 게 있을 때)
 * @param {SimCtx} ctx @param {Partial<Record<import('../../types.js').MaterialId, number>>} mats @param {string} reason
 * @returns {Record<string, number>} 더한 양
 */
export function addMaterials(ctx, mats, reason) {
  const ch = ctx.state.char;
  /** @type {Record<string, number>} */
  const delta = {};
  if (!ch) return delta;
  let any = false;
  for (const id of MATERIAL_IDS) {
    const n = nonNeg(/** @type {any} */ (mats ?? {})[id]);
    if (!n) continue;
    ch.materials[/** @type {import('../../types.js').MaterialId} */ (id)] += n;
    delta[id] = n;
    any = true;
  }
  if (any) ctx.emit(EV.MATERIALS, { materials: { ...ch.materials }, delta, reason });
  return delta;
}

/** 재료가 충분한가 @param {CharacterState} ch @param {Partial<Record<string, number>>} mats */
export function hasMaterials(ch, mats) {
  for (const id of MATERIAL_IDS) {
    const need = nonNeg(/** @type {any} */ (mats ?? {})[id]);
    if (need && !(/** @type {any} */ (ch.materials)[id] >= need)) return false;
  }
  return true;
}

/**
 * 재료를 쓴다 — 하나라도 모자라면 아무것도 바꾸지 않고 false · MATERIALS{delta < 0}
 * @param {SimCtx} ctx @param {Partial<Record<string, number>>} mats @param {string} reason @returns {boolean}
 */
export function spendMaterials(ctx, mats, reason) {
  const ch = ctx.state.char;
  if (!ch || !hasMaterials(ch, mats)) return false;
  /** @type {Record<string, number>} */
  const delta = {};
  let any = false;
  for (const id of MATERIAL_IDS) {
    const n = nonNeg(/** @type {any} */ (mats ?? {})[id]);
    if (!n) continue;
    /** @type {any} */ (ch.materials)[id] -= n;
    delta[id] = -n;
    any = true;
  }
  if (any) ctx.emit(EV.MATERIALS, { materials: { ...ch.materials }, delta, reason });
  return true;
}

/**
 * 포션 · 두루마리를 상한(ECON)까지 더한다(n ≥ 0 — 소모는 P1 이 직접 −1 · NOTES-P1)
 * @param {SimCtx} ctx @param {'potion'|'scroll'} what @param {number} n @returns {number} 실제로 더한 수
 */
export function addConsumable(ctx, what, n) {
  const ch = ctx.state.char;
  if (!ch) return 0;
  const key = what === 'potion' ? 'potions' : what === 'scroll' ? 'scrolls' : null;
  if (!key) return 0;
  const max = key === 'potions' ? ECON.potionMax : ECON.scrollMax;
  const cur = Number.isFinite(ch[key]) ? ch[key] : 0;
  const add = Math.max(0, Math.min(nonNeg(n), max - cur));
  ch[key] = cur + add;
  return add;
}

// ───────────────────────── 장착 ─────────────────────────

/** 무기 · 보조 기본형의 손 수(없으면 1) @param {Item|null|undefined} item */
function handsOf(item) {
  return item ? (BASES_BY_ID[item.baseId]?.hands ?? 1) : 1;
}

/** EQUIPPED — 벗으면 itemId · baseId · tier · rarity null @param {SimCtx} ctx @param {string} slot @param {Item|null} item */
function emitEquipped(ctx, slot, item) {
  ctx.emit(EV.EQUIPPED, { slot, itemId: item ? item.id : null, baseId: item ? item.baseId : null, tier: item ? item.tier : null, rarity: item ? item.rarity : null });
}

/** 반지 두 칸이 다 찼을 때 바꿀 칸 — 끼었을 때 powerScore 가 더 높은 쪽(같으면 ring1) @param {CharacterState} ch @param {Item} item @returns {EquipSlot} */
function betterRingSlot(ch, item) {
  const a = powerScore(computeStats({ ...ch, equip: { ...ch.equip, ring1: item } }));
  const b = powerScore(computeStats({ ...ch, equip: { ...ch.equip, ring2: item } }));
  return b > a ? 'ring2' : 'ring1';
}

/**
 * 가방의 아이템을 낀다 — 클래스 · 레벨(ctx.dev.ignoreReqLevel 이면 건너뜀) · 부위 검사 · 낀 것은 그 아이템이 있던 가방 칸으로 ·
 * 양손 무기는 보조를 가방으로(빈칸이 없으면 'bagFull' · 아무것도 바꾸지 않는다) · 양손 무기를 든 채 보조는 'twoHanded' ·
 * 반지는 빈 칸 → 둘 다 차면 powerScore 가 더 오르는 칸(toSlot 으로 고를 수 있다) · refreshStats · EQUIPPED · BAG · SAVE
 * @param {SimCtx} ctx @param {ItemRef} ref @param {EquipSlot|null} [toSlot] @returns {Result & {slot?:EquipSlot}}
 */
export function equip(ctx, ref, toSlot = null) {
  const ch = ctx.state.char;
  if (!ch || !ref || ref.where !== 'bag') return fail('invalid');
  const idx = /** @type {number} */ (ref.idx);
  if (!Number.isInteger(idx) || idx < 0 || idx >= ch.bag.length) return fail('invalid');
  const item = ch.bag[idx];
  if (!item) return fail('noItem');
  if (!BASES_BY_ID[item.baseId]) return fail('invalid');
  if (item.cls != null && item.cls !== ch.cls) return fail('class');
  if (!ctx.dev?.ignoreReqLevel && item.reqLevel > ch.level) return fail('level', { n: item.reqLevel });

  /** @type {EquipSlot} */
  let target;
  if (item.slot === 'ring') {
    if (toSlot != null) {
      if (toSlot !== 'ring1' && toSlot !== 'ring2') return fail('slot');
      target = toSlot;
    } else target = !ch.equip.ring1 ? 'ring1' : !ch.equip.ring2 ? 'ring2' : betterRingSlot(ch, item);
  } else {
    if (toSlot != null && toSlot !== item.slot) return fail('slot');
    target = /** @type {EquipSlot} */ (item.slot);
  }
  if (!EQUIP_SET.has(target)) return fail('slot');
  if (target === 'offhand' && ch.equip.mainHand && handsOf(ch.equip.mainHand) === 2) return fail('twoHanded');

  const old = ch.equip[target];
  const off = item.slot === 'mainHand' && handsOf(item) === 2 ? ch.equip.offhand : null;
  // 바꾼 뒤 가방의 아이템 수(이 아이템이 빠지고 · 벗은 것 · 보조가 들어온다)가 BAG_SIZE 를 넘으면 안 된다(피드백 2 D4 — 넘친 가방에는 새로 넣지 못한다)
  if (off && bagCount(ch) + (old ? 1 : 0) > BAG_SIZE) return fail('bagFull');
  ch.bag[idx] = old ?? null;
  ch.equip[target] = item;
  if (off) {
    const j = ch.bag.indexOf(null);
    ch.bag[j] = off;
    ch.equip.offhand = null;
  }
  ctx.refreshStats();
  emitEquipped(ctx, target, item);
  if (off) emitEquipped(ctx, 'offhand', null);
  ctx.emit(EV.BAG, { reason: 'equip' });
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'equip' });
  return { ok: true, slot: target };
}

/**
 * 벗어서 가방 빈 첫 칸으로(빈칸이 없으면 'bagFull') · refreshStats · EQUIPPED(null) · BAG · SAVE
 * @param {SimCtx} ctx @param {EquipSlot} slot @returns {Result & {idx?:number}}
 */
export function unequip(ctx, slot) {
  const ch = ctx.state.char;
  if (!ch || !EQUIP_SET.has(slot)) return fail('invalid');
  const item = ch.equip[slot];
  if (!item) return fail('noItem');
  const idx = freeBagIdx(ch);
  if (idx < 0) return fail('bagFull');
  ch.bag[idx] = item;
  ch.equip[slot] = null;
  ctx.refreshStats();
  emitEquipped(ctx, slot, null);
  ctx.emit(EV.BAG, { reason: 'unequip' });
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'equip' });
  return { ok: true, idx };
}

// ───────────────────────── 옮기기 · 정렬 · 잠금 ─────────────────────────

/** 'bag' | 'stash' 칸 배열 @param {GameState} state @param {string} where @returns {Array<Item|null>|null} */
function cellsOf(state, where) {
  if (where === 'bag') return state.char?.bag ?? null;
  if (where === 'stash') return state.account?.stash ?? null;
  return null;
}

/**
 * 가방 ↔ 가방(자리 바꿈) · 가방 ↔ 보관함 · 보관함 ↔ 보관함(보관함이 끼면 마을에서만 — 'notInTown').
 * to.idx 가 없으면(undefined · null · -1) 그쪽의 빈 첫 칸(없으면 'bagFull' · 'stashFull') · 차 있는 칸이면 자리를 바꾼다
 * @param {SimCtx} ctx @param {ItemRef} from @param {ItemRef} to @returns {Result & {idx?:number}}
 */
export function moveItem(ctx, from, to) {
  const st = ctx.state;
  if (!st.char || !from || !to) return fail('invalid');
  const A = cellsOf(st, from.where);
  const B = cellsOf(st, to.where);
  if (!A || !B) return fail('invalid');
  const stash = from.where === 'stash' || to.where === 'stash';
  if (stash && st.scene !== 'town') return fail('notInTown');
  const fi = /** @type {number} */ (from.idx);
  if (!Number.isInteger(fi) || fi < 0 || fi >= A.length) return fail('invalid');
  const item = A[fi];
  if (!item) return fail('noItem');
  // 피드백 2 D4: 가방 밖(보관함)에서 가방의 빈칸으로 들어오는 것은 「새로 넣기」 — 든 아이템이 BAG_SIZE 이상이면 'bagFull' · 칸 밖(넘친 자리)은 놓는 자리가 아니다
  const intoBag = to.where === 'bag' && from.where !== 'bag';
  let ti = to.idx;
  if (ti === undefined || ti === null || ti === -1) {
    ti = intoBag ? freeBagIdx(st.char) : B.indexOf(null);
    if (ti < 0) return fail(to.where === 'stash' ? 'stashFull' : 'bagFull');
  }
  if (!Number.isInteger(ti) || ti < 0 || ti >= B.length) return fail('invalid');
  if (A === B && ti === fi) return { ok: true, idx: ti };
  const other = B[ti];
  if (to.where === 'bag' && !other && ti >= BAG_SIZE) return fail('invalid');
  if (intoBag && !other && isBagFull(st.char)) return fail('bagFull');
  B[ti] = item;
  A[fi] = other ?? null;
  if (from.where === 'bag' || to.where === 'bag') settleBag(st.char);
  ctx.emit(EV.BAG, { reason: stash ? 'stash' : 'move' });
  ctx.emit(EV.SAVE_REQUEST, { scope: stash ? 'all' : 'char', reason: stash ? 'stash' : 'move' });
  return { ok: true, idx: ti };
}

/** ID 비교 — 'i<n>' 은 번호로, 그 밖은 글자로 @param {string} a @param {string} b */
function cmpId(a, b) {
  const x = itemIdNum(a);
  const y = itemIdNum(b);
  if (x >= 0 && y >= 0) return x - y;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 정렬 순서: 등급(높은 것 먼저) → 부위 → ilvl 내림 → id @param {Item} a @param {Item} b */
export function compareItems(a, b) {
  return ((RARITY_RANK[b.rarity] ?? 0) - (RARITY_RANK[a.rarity] ?? 0))
    || ((SLOT_RANK[a.slot] ?? ITEM_SLOTS.length) - (SLOT_RANK[b.slot] ?? ITEM_SLOTS.length))
    || ((b.ilvl ?? 0) - (a.ilvl ?? 0))
    || cmpId(a.id, b.id);
}

/** 칸 배열을 제자리에서 정렬(아이템은 앞으로 · 빈칸은 뒤로) @param {Array<Item|null>} cells */
function sortCells(cells) {
  const items = cells.filter(Boolean);
  items.sort(/** @type {any} */ (compareItems));
  for (let i = 0; i < cells.length; i++) cells[i] = items[i] ?? null;
}

/** 가방 정렬 · BAG{sort} · SAVE @param {SimCtx} ctx @returns {Result} */
export function sortBag(ctx) {
  const ch = ctx.state.char;
  if (!ch) return fail('invalid');
  sortCells(ch.bag);
  settleBag(ch);
  ctx.emit(EV.BAG, { reason: 'sort' });
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'sort' });
  return { ok: true };
}

/** 보관함 정렬(마을에서만) · BAG{sort} · SAVE{all} @param {SimCtx} ctx @returns {Result} */
export function sortStash(ctx) {
  const st = ctx.state;
  if (!st.char) return fail('invalid');
  if (st.scene !== 'town') return fail('notInTown');
  sortCells(st.account.stash);
  ctx.emit(EV.BAG, { reason: 'sort' });
  ctx.emit(EV.SAVE_REQUEST, { scope: 'all', reason: 'stash' });
  return { ok: true };
}

/**
 * 잠금(가방 · 장착 · 보관함의 아이템) — 일괄 판매 · 일괄 분해에서 빠지고 하나씩 팔기 · 분해는 'itemLocked' · BAG{move} · SAVE
 * @param {SimCtx} ctx @param {ItemRef} ref @param {boolean} on @returns {Result}
 */
export function setItemLocked(ctx, ref, on) {
  if (!ctx.state.char || !ref || !(ref.where === 'bag' || ref.where === 'equip' || ref.where === 'stash')) return fail('invalid');
  const item = itemAt(ctx.state, ref);
  if (!item) return fail('noItem');
  if (!item.flags || typeof item.flags !== 'object') item.flags = {};
  item.flags.locked = !!on;
  ctx.emit(EV.BAG, { reason: 'move' });
  ctx.emit(EV.SAVE_REQUEST, { scope: ref.where === 'stash' ? 'all' : 'char', reason: 'lock' });
  return { ok: true };
}

// ───────────────────────── 내구도 · 사망 대가 · 수리비 ─────────────────────────

/** 가치 · 수리의 부위 키 — 주무기는 손 수로 mainHand1h / mainHand2h @param {Item} item @returns {string} */
export function slotKeyOf(item) {
  if (item.slot === 'mainHand') return handsOf(item) === 2 ? 'mainHand2h' : 'mainHand1h';
  return item.slot;
}

/**
 * 아이템 하나의 수리비(반올림 전) = slotValue[slotKey] × repairBase × G^(ilvl−1) × (durMax − dur)/durMax — 등급과 무관(§7.10)
 * @param {Item|null|undefined} item @returns {number}
 */
export function itemRepairRaw(item) {
  if (!item) return 0;
  const durMax = item.durMax > 0 ? item.durMax : ITEM.durMax;
  const dur = Number.isFinite(item.dur) ? item.dur : 0;
  const missing = Math.max(0, Math.min(durMax, durMax - dur));
  if (!missing) return 0;
  const sv = /** @type {Record<string, number>} */ (ITEM.slotValue)[slotKeyOf(item)] ?? 0;
  const ilvl = Math.max(1, Math.floor(item.ilvl) || 1);
  return sv * PRICES.repairBase * GROWTH.gold ** (ilvl - 1) * missing / durMax;
}

/**
 * 장착 전부 dur −= ITEM.deathDurLoss(0에서 멈춤) · refreshStats · DURABILITY{broken: 내구도 0인 장착 칸 전부, fraction: 이번에 깎인 비율(0.1)}
 * @param {SimCtx} ctx
 */
export function applyDeathPenalty(ctx) {
  const ch = ctx.state.char;
  if (!ch) return;
  /** @type {EquipSlot[]} */
  const broken = [];
  for (const s of EQUIP_SLOTS) {
    const it = ch.equip[s];
    if (!it) continue;
    const d = Number.isFinite(it.dur) ? it.dur : 0;
    it.dur = Math.max(0, d - ITEM.deathDurLoss);
    if (it.dur <= 0) broken.push(/** @type {EquipSlot} */ (s));
  }
  ctx.refreshStats();
  ctx.emit(EV.DURABILITY, { broken, fraction: ITEM.deathDurLoss / ITEM.durMax });
}

/**
 * 수리비(정수) = round(Σ 장착 itemRepairRaw) — 등급과 무관(전설 · 세트를 낄수록 사망이 비싸지지 않는다 · §7.10)
 * @param {CharacterState} char @returns {number}
 */
export function repairCost(char) {
  if (!char?.equip) return 0;
  let sum = 0;
  for (const s of EQUIP_SLOTS) sum += itemRepairRaw(char.equip[/** @type {EquipSlot} */ (s)]);
  return Math.round(sum);
}
