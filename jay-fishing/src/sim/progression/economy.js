// OWNER: P4 — 계약 §6.7 · §5.6 · §7.6 · §7.9
// 가격 · 판매 · 상점 · 라인 감기 · 장착 · 미끼 · 실패 손실 · 무료 미끼. 돈은 정수이고 음수가 되지 않는다(§0.1).
// 이벤트(MONEY_CHANGED · SOLD · BOUGHT · LINE_REFILLED · EQUIPPED · BAIT_GRANTED)는 여기서 직접 낸다.
// sim/fishing/* · sim/fight/* · GameSim.js 를 import 하지 않는다(§2.2).

import { EV } from '../../core/events.js';
import { BAIT_IDS, GEAR_SLOTS, SET_IDS } from '../../core/constants.js';
import { CAST } from '../../data/bite.js';
import { BAITS } from '../../data/baits.js';
import { FREE_BAIT, LIMITS, LOSS, SHOP } from '../../data/economy.js';
import { GEAR, GEAR_BY_ID, GEAR_GATES } from '../../data/gear.js';
import { availableCount, rigStats, skillRank } from './modifiers.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').Profile} Profile */
/** @typedef {import('../../types.js').Modifiers} Modifiers */
/** @typedef {import('../../types.js').SpeciesDef} SpeciesDef */
/** @typedef {import('../../types.js').CatchRecord} CatchRecord */
/** @typedef {import('../../types.js').LossReport} LossReport */
/** @typedef {import('../../types.js').ShopItem} ShopItem */
/** @typedef {import('../../types.js').SetId} SetId */
/** @typedef {import('../../types.js').RigStats} RigStats */
/** @typedef {import('../../types.js').GearDef} GearDef */

const BAIT_PREFIX = 'bait_';
const REFILL_PREFIX = 'refill_';
const BAITS_BY_ID = Object.fromEntries(BAITS.map(b => [b.id, b]));
const LINES = GEAR.filter(g => g.slot === 'line');
const SHOP_GEAR = GEAR.filter(g => g.tier > 1 && g.slot !== 'line');
/** 세트에 끼우는 부위(SetConfig 의 키 = 슬롯 이름). 라인은 감기만(refillLine) */
const EQUIP_SLOTS = GEAR_SLOTS.filter(s => s !== 'line');
/** 바닥에서 잃는 채비(§5.6 — 바늘 + 찌/봉돌) */
const TACKLE_LOSS = { lineBreak: true, spoolEmpty: true };
/** 물고기를 놓친 실패(stats.lost) */
const FISH_LOST = { lineBreak: true, spoolEmpty: true, rodBreak: true, hookOff: true };

/** @param {string} reason @param {Record<string, number|string>} [params] */
function fail(reason, params) {
  return params ? { ok: false, reason, params } : { ok: false, reason };
}

/** money += delta(정수 · 0 이상) · MONEY_CHANGED(바뀌었을 때만) → 실제 바뀐 양 @param {SimCtx} ctx @param {number} delta @param {string} reason */
function changeMoney(ctx, delta, reason) {
  const p = ctx.state.profile;
  const before = p.money;
  p.money = Math.max(0, Math.min(LIMITS.moneyMax, Math.round(before + delta)));
  const d = p.money - before;
  if (d !== 0) ctx.emit(EV.MONEY_CHANGED, { money: p.money, delta: d, reason });
  return d;
}

/** 단계 문턱(§7.6 — 2단계 레벨 5 · 3단계 레벨 12 + 숙련 2) → null 이면 통과 @param {Profile} profile @param {number} tier */
function gateOf(profile, tier) {
  if (tier > 2) {
    if (profile.level < GEAR_GATES.tier3Level) return { reason: 'level', params: { n: GEAR_GATES.tier3Level } };
    if (skillRank(profile, 'mastery') < GEAR_GATES.tier3Mastery) return { reason: 'mastery', params: { n: GEAR_GATES.tier3Mastery } };
  } else if (tier >= 2) {
    if (profile.level < GEAR_GATES.tier2Level) return { reason: 'level', params: { n: GEAR_GATES.tier2Level } };
  }
  return null;
}

/** 이 장비를 끼울 수 있는 세트(로드는 그 세트 · 찌는 찌 세트 · 봉돌은 바닥 세트 · 그 밖 둘 다) @param {GearDef} g @returns {SetId[]} */
function setsFor(g) {
  if (g.slot === 'rod') return [/** @type {SetId} */ (g.set)];
  if (g.slot === 'float') return ['float'];
  if (g.slot === 'sinker') return ['bottom'];
  return /** @type {SetId[]} */ (SET_IDS.slice());
}

/** 라인 감기 비용(같은 라인이면 모자란 m × 단가, 다른 라인이면 capacityM × 단가) @param {Profile} profile @param {SetId} set @param {GearDef} line */
function refillQuote(profile, set, line) {
  const cfg = profile.sets[set];
  const cap = GEAR_BY_ID[cfg.reel].capacityM;
  const same = cfg.lineId === line.id;
  const meters = same ? Math.max(0, cap - cfg.lineM) : cap;
  return { meters, cost: Math.round(meters * line.pricePerM), same, cap };
}

// ── 가격 · 판매

/** round(pricePerKg × weightKg × priceMul[tier]) @param {SpeciesDef} species @param {number} weightKg @param {'normal'|'trophy'|'legend'} tier @returns {number} */
export function fishPrice(species, weightKg, tier) {
  return Math.round(species.pricePerKg * weightKg * species.priceMul[tier]);
}

/** round(record.price × mods.sellMul) — 흥정 반영 @param {CatchRecord} record @param {Modifiers} mods @returns {number} */
export function sellPrice(record, mods) {
  return Math.round(record.price * mods.sellMul);
}

/** 판매 반영 · 이벤트 @param {SimCtx} ctx @param {CatchRecord[]} sold @param {boolean} auto */
function finishSale(ctx, sold, auto) {
  const p = ctx.state.profile;
  let total = 0;
  for (const r of sold) total += sellPrice(r, ctx.mods);
  const gained = changeMoney(ctx, total, 'sell');
  p.stats.sold += sold.length;
  p.stats.earned += gained;
  ctx.emit(EV.SOLD, { count: sold.length, total: gained, auto });
  ctx.refresh();
  ctx.emit(EV.SAVE_REQUEST, { reason: 'sell' });
  return gained;
}

/**
 * 어창 전부 판매 → Result{count, total} · MONEY_CHANGED · SOLD · SAVE_REQUEST{sell}. 어창이 비었으면 {ok:true, count:0, total:0}(이벤트 없음).
 * @param {SimCtx} ctx @param {{auto?:boolean}} [opts]
 */
export function sellAll(ctx, { auto = false } = {}) {
  const p = ctx.state.profile;
  if (p.hold.length === 0) return { ok: true, count: 0, total: 0 };
  const sold = p.hold;
  p.hold = [];
  const total = finishSale(ctx, sold, !!auto);
  return { ok: true, count: sold.length, total };
}

/** 한 마리 판매 → Result{total} — 어창에 없는 uid 는 {reason:'invalid'} @param {SimCtx} ctx @param {number} uid */
export function sellOne(ctx, uid) {
  const p = ctx.state.profile;
  const idx = typeof uid === 'number' ? p.hold.findIndex(c => c.uid === uid) : -1;
  if (idx < 0) return fail('invalid');
  const [rec] = p.hold.splice(idx, 1);
  const total = finishSale(ctx, [rec], false);
  return { ok: true, total };
}

// ── 상점

/**
 * 상점 목록(§3.6): 2·3단계 장비(잠긴 것도 — 사유 · reasonParams) · 미끼 팩 · 라인 감기(세트 × 라인).
 * 장비 항목의 previews 는 그 장비를 끼울 수 있는 세트마다 {before, after}(사기 전 · 후), 라인 감기는 그 세트만.
 * 라인 감기 price 는 판매상 기준이다(집의 line_1 무료는 refillLine 의 free 가 정한다).
 * @param {Profile} profile @param {Modifiers} mods @returns {ShopItem[]}
 */
export function shopList(profile, mods) {
  /** @type {ShopItem[]} */
  const items = [];
  for (const g of SHOP_GEAR) {
    const owned = profile.owned[g.id] ?? 0;
    const gate = gateOf(profile, g.tier);
    let reason = gate ? gate.reason : null;
    let params = gate ? gate.params : null;
    if (!reason && owned >= LIMITS.ownedMax) reason = 'invalid';
    if (!reason && profile.money < g.price) { reason = 'money'; params = null; }
    /** @type {any} */
    const previews = { float: null, bottom: null };
    for (const set of setsFor(g)) previews[set] = previewEquip(profile, set, g.slot, g.id, mods);
    items.push({
      id: g.id, kind: 'gear', set: null, lineId: null, price: g.price,
      ok: !reason, reason, reasonParams: reason ? params : null,
      owned, slot: g.slot, tier: g.tier, previews,
    });
  }
  for (const b of BAITS) {
    const owned = profile.baits[b.id] ?? 0;
    let reason = null;
    if (owned + b.packSize > LIMITS.baitMax) reason = 'invalid';
    else if (profile.money < b.packPrice) reason = 'money';
    items.push({
      id: BAIT_PREFIX + b.id, kind: 'bait', set: null, lineId: null, price: b.packPrice,
      ok: !reason, reason, reasonParams: null,
      owned, slot: null, tier: 0, previews: null,
    });
  }
  for (const set of SET_IDS) {
    for (const line of LINES) {
      const q = refillQuote(profile, /** @type {SetId} */ (set), line);
      const gate = gateOf(profile, line.tier);
      let reason = gate ? gate.reason : null;
      let params = gate ? gate.params : null;
      if (!reason && q.same && q.meters <= 0) reason = 'full';     // 이미 가득(W1 확정 — 부록 A reason.full)
      if (!reason && profile.money < q.cost) { reason = 'money'; params = null; }
      /** @type {any} */
      const previews = { float: null, bottom: null };
      previews[set] = previewEquip(profile, /** @type {SetId} */ (set), 'line', line.id, mods);
      items.push({
        id: REFILL_PREFIX + set + '_' + line.id, kind: 'line', set: /** @type {SetId} */ (set), lineId: line.id, price: q.cost,
        ok: !reason, reason, reasonParams: reason ? params : null,
        owned: q.same ? profile.sets[set].lineM : 0, slot: 'line', tier: line.tier, previews,
      });
    }
  }
  return items;
}

/**
 * 구매 → Result{cost}. itemId: 장비 GearId(2·3단계) · 미끼 팩 'bait_<id>' · 라인 감기 'refill_<set>_<lineId>'(refillLine 에 넘긴다).
 * qty 는 정수 1..SHOP.maxQty(아니면 {reason:'invalid'} · 돈 불변). 레벨 · 숙련 · 돈 검사 · BOUGHT · MONEY_CHANGED · SAVE_REQUEST{buy}.
 * @param {SimCtx} ctx @param {string} itemId @param {number} [qty]
 */
export function buy(ctx, itemId, qty = 1) {
  const p = ctx.state.profile;
  if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > SHOP.maxQty) return fail('invalid');
  if (typeof itemId !== 'string') return fail('invalid');

  if (itemId.startsWith(REFILL_PREFIX)) {
    const rest = itemId.slice(REFILL_PREFIX.length);
    const cut = rest.indexOf('_');
    if (cut < 0) return fail('invalid');
    return refillLine(ctx, /** @type {SetId} */ (rest.slice(0, cut)), rest.slice(cut + 1));
  }

  let cost;
  if (itemId.startsWith(BAIT_PREFIX)) {
    const b = BAITS_BY_ID[itemId.slice(BAIT_PREFIX.length)];
    if (!b) return fail('invalid');
    if ((p.baits[b.id] ?? 0) + b.packSize * qty > LIMITS.baitMax) return fail('invalid');
    cost = b.packPrice * qty;
    if (p.money < cost) return fail('money');
    p.baits[b.id] = (p.baits[b.id] ?? 0) + b.packSize * qty;
  } else {
    const g = GEAR_BY_ID[itemId];
    if (!g || g.tier === 1 || g.slot === 'line') return fail('invalid');
    const gate = gateOf(p, g.tier);
    if (gate) return fail(gate.reason, gate.params);
    if ((p.owned[g.id] ?? 0) + qty > LIMITS.ownedMax) return fail('invalid');
    cost = g.price * qty;
    if (p.money < cost) return fail('money');
    p.owned[g.id] = (p.owned[g.id] ?? 0) + qty;
  }
  changeMoney(ctx, -cost, 'buy');
  ctx.emit(EV.BOUGHT, { itemId, qty, cost });
  ctx.refresh();
  ctx.emit(EV.SAVE_REQUEST, { reason: 'buy' });
  return { ok: true, cost };
}

/**
 * 라인 감기 → Result{cost, meters}: 그 세트 릴을 그 라인으로 가득. 같은 라인이면 모자란 m × 단가, 다른 라인이면 capacityM × 단가(기존 라인은 버린다).
 * free 는 1단계 라인에만 적용된다(집의 line_1). 이미 가득이면 {ok:true, cost:0, meters:0}(이벤트 없음).
 * MONEY_CHANGED{refill} · LINE_REFILLED · ctx.refresh() · SAVE_REQUEST{refill}.
 * @param {SimCtx} ctx @param {SetId} set @param {string} lineId @param {{free?:boolean}} [opts]
 */
export function refillLine(ctx, set, lineId, { free = false } = {}) {
  const p = ctx.state.profile;
  if (!SET_IDS.includes(set)) return fail('invalid');
  const line = GEAR_BY_ID[lineId];
  if (!line || line.slot !== 'line') return fail('invalid');
  const isFree = !!free && line.tier === 1;
  if (!isFree) {
    const gate = gateOf(p, line.tier);
    if (gate) return fail(gate.reason, gate.params);
  }
  const q = refillQuote(p, set, line);
  if (q.same && q.meters <= 0) return { ok: true, cost: 0, meters: 0 };
  const cost = isFree ? 0 : q.cost;
  if (p.money < cost) return fail('money');
  const cfg = p.sets[set];
  cfg.lineId = line.id;
  cfg.lineM = q.cap;
  changeMoney(ctx, -cost, 'refill');
  ctx.emit(EV.LINE_REFILLED, { set, lineId: line.id, meters: q.meters, cost });
  ctx.refresh();
  ctx.emit(EV.SAVE_REQUEST, { reason: 'refill' });
  return { ok: true, cost, meters: q.meters };
}

// ── 채비

/**
 * 장착 검사 → null 이면 끼울 수 있다 @param {Profile} profile @param {any} set @param {any} slot @param {any} itemId
 * @returns {{reason:string}|null}
 */
function equipCheck(profile, set, slot, itemId) {
  if (!SET_IDS.includes(set)) return { reason: 'invalid' };
  if (!EQUIP_SLOTS.includes(slot)) return { reason: 'wrongSlot' };
  const g = typeof itemId === 'string' ? GEAR_BY_ID[itemId] : undefined;
  if (!g) return { reason: 'invalid' };
  if (g.slot !== slot) return { reason: 'wrongSlot' };
  if (!setsFor(g).includes(set)) return { reason: 'wrongSet' };
  if (g.tier > 1) {
    if ((profile.owned[g.id] ?? 0) < 1) return { reason: 'notOwned' };
    if (profile.sets[set][slot] !== g.id && availableCount(profile, g.id, set) < 1) return { reason: 'inUse' };
  }
  return null;
}

/**
 * 세트 설정에 장비를 끼운다(순수 — 검사는 끝난 뒤). 릴이면 드랙 kg 을 보존하는 눈금(§7.7)과 스풀 용량으로 자른 lineM.
 * 라인이면 감은 상태(가득)로 본다(미리보기용).
 * @param {import('../../types.js').SetConfig} cfg @param {string} slot @param {GearDef} g @param {number} dragNotches
 */
function fitGear(cfg, slot, g, dragNotches) {
  if (slot === 'line') {
    cfg.lineId = g.id;
    cfg.lineM = GEAR_BY_ID[cfg.reel].capacityM;
    return;
  }
  if (slot === 'reel') {
    const oldReel = GEAR_BY_ID[cfg.reel];
    const oldKg = cfg.dragNotch * (oldReel.maxDragKg / dragNotches);
    const notchKg = g.maxDragKg / dragNotches;
    cfg.dragNotch = Math.max(0, Math.min(dragNotches, Math.round(oldKg / notchKg)));
    cfg.lineM = Math.min(cfg.lineM, g.capacityM);
  }
  /** @type {any} */ (cfg)[slot] = g.id;
}

/**
 * 장착 → Result — 슬롯 · 세트 · 보유 검사(wrongSlot · wrongSet · notOwned · inUse · invalid) · 릴이면 드랙 kg 보존 ·
 * EQUIPPED · ctx.refresh() · SAVE_REQUEST{equip}. 이미 끼운 것이면 {ok:true}(이벤트 없음). 단계 검사(ready/idle)는 GameSim 이 한다.
 * @param {SimCtx} ctx @param {SetId} set @param {string} slot @param {string} itemId
 */
export function equip(ctx, set, slot, itemId) {
  const p = ctx.state.profile;
  const bad = equipCheck(p, set, slot, itemId);
  if (bad) return fail(bad.reason);
  const cfg = p.sets[set];
  if (/** @type {any} */ (cfg)[slot] === itemId) return { ok: true };
  fitGear(cfg, slot, GEAR_BY_ID[itemId], ctx.mods.dragNotches);
  ctx.emit(EV.EQUIPPED, { set, slot, itemId });
  ctx.refresh();
  ctx.emit(EV.SAVE_REQUEST, { reason: 'equip' });
  return { ok: true };
}

/**
 * 끼울 미끼(다음 캐스팅부터 — 물속 미끼는 rig.castBaitId 그대로) → Result · ctx.refresh() · SAVE_REQUEST{tackle}.
 * 보유 0 인 미끼도 고를 수 있다(캐스팅이 noBait 로 막힌다). 같은 미끼면 {ok:true}(이벤트 없음).
 * @param {SimCtx} ctx @param {SetId} set @param {string} baitId
 */
export function setBait(ctx, set, baitId) {
  const p = ctx.state.profile;
  if (!SET_IDS.includes(set) || !BAIT_IDS.includes(baitId)) return fail('invalid');
  const cfg = p.sets[set];
  if (cfg.bait === baitId) return { ok: true };
  cfg.bait = /** @type {any} */ (baitId);
  ctx.refresh();
  ctx.emit(EV.SAVE_REQUEST, { reason: 'tackle' });
  return { ok: true };
}

/**
 * 장비를 바꾸면 어떻게 되는가 → {before, after}(RigStats). 라인이면 감은 뒤(가득) · 릴이면 드랙 kg 보존 · 잘못된 입력이면 after = before 와 같은 값.
 * 보유 수는 보지 않는다(상점의 「사기 전 · 후」에도 쓴다).
 * @param {Profile} profile @param {SetId} set @param {string} slot @param {string} itemId @param {Modifiers} mods
 * @returns {{before:RigStats, after:RigStats}}
 */
export function previewEquip(profile, set, slot, itemId, mods) {
  const s = SET_IDS.includes(set) ? set : 'float';
  const before = rigStats(profile, s, mods);
  const g = typeof itemId === 'string' ? GEAR_BY_ID[itemId] : undefined;
  const okSlot = g && g.slot === slot && setsFor(g).includes(s);
  if (!okSlot) return { before, after: rigStats(profile, s, mods) };
  const cfg = { ...profile.sets[s] };
  fitGear(cfg, slot, /** @type {GearDef} */ (g), mods.dragNotches);
  const after = rigStats({ ...profile, sets: { ...profile.sets, [s]: cfg } }, s, mods);
  return { before, after };
}

// ── 실패 손실

/**
 * §5.6 실패 손실 → LossReport. 미끼는 baitId(물속에 있던 미끼 — rig.castBaitId) 기준: 캐스팅 때 이미 소모됐고,
 * early 는 earlyBaitKeep · hookOff/lineBreak 는 baitKeepOnFail 확률로 환불(ctx.rng). lineBreak · spoolEmpty 는 바늘 + 찌/봉돌 lossCost 를
 * 자동 차감(돈은 0 아래로 가지 않는다 — tackleCost 는 실제로 깎인 액수) · 라인 감소. rodBreak 는 그 로드를 잃고(2·3단계면 owned −1)
 * 그 세트의 1단계 로드로 바꾸며, 드랙이 LOSS.rodBreakDragFrac × 새 maxLoadKg 를 넘으면 그 아래 가장 가까운 눈금으로 낮춘다.
 * 끝에(모든 사유) 라인이 CAST.minLineM + CAST.lineReserveM 아래면 예비 스풀(line_1 가득 · 무료 · LINE_REFILLED{cost:0}).
 * MONEY_CHANGED{loss} · 끝에 ctx.refresh(). FAIL · RIG_RESTORED · SAVE_REQUEST 는 부르는 쪽(P1)이 낸다.
 * @param {SimCtx} ctx @param {SetId} set @param {import('../../types.js').FailReason} reason
 * @param {{lineLostM?:number, baitId?:string, cause?:import('../../types.js').LossCause, hookSmall?:boolean}} [opts]
 * @returns {LossReport}
 */
export function applyLoss(ctx, set, reason, { lineLostM = 0, baitId, cause = null, hookSmall = false } = {}) {
  const p = ctx.state.profile;
  const cfg = p.sets[set];
  const moneyBefore = p.money;
  const mods = ctx.mods;

  // 미끼 — 캐스팅 때 소모됐다. 보존 스킬이면 확률로 환불
  const bait = typeof baitId === 'string' && BAIT_IDS.includes(baitId) ? baitId : null;
  let keepP = 0;
  if (reason === 'early') keepP = mods.earlyBaitKeep;
  else if (reason === 'hookOff' || reason === 'lineBreak') keepP = mods.baitKeepOnFail;
  let baitLost = bait !== null;
  if (bait !== null && keepP > 0 && ctx.rng.chance(keepP)) {
    p.baits[bait] = Math.min(LIMITS.baitMax, (p.baits[bait] ?? 0) + 1);
    baitLost = false;
  }

  // 채비(바늘 + 찌/봉돌) · 라인
  let tackleCost = 0;
  let lost = 0;
  if (TACKLE_LOSS[reason]) {
    const hook = GEAR_BY_ID[cfg.hook];
    const bob = cfg.float ? GEAR_BY_ID[cfg.float] : cfg.sinker ? GEAR_BY_ID[cfg.sinker] : null;
    const cost = (hook ? hook.lossCost : 0) + (bob ? bob.lossCost : 0);
    tackleCost = -changeMoney(ctx, -cost, 'loss') || 0;   // -0 이 아닌 0
    const before = cfg.lineM;
    if (reason === 'spoolEmpty') cfg.lineM = 0;
    else {
      const cut = typeof lineLostM === 'number' && Number.isFinite(lineLostM) && lineLostM > 0 ? lineLostM : 0;
      cfg.lineM = Math.max(0, before - cut);
    }
    lost = before - cfg.lineM;
  }

  // 로드 파손 — 예비 1단계 로드 · 드랙 낮추기
  /** @type {string|null} */
  let rodLost = null;
  /** @type {number|null} */
  let dragKgAfter = null;
  if (reason === 'rodBreak') {
    rodLost = cfg.rod;
    const old = GEAR_BY_ID[cfg.rod];
    if (old && old.tier > 1) {
      const n = (p.owned[old.id] ?? 0) - 1;
      if (n > 0) p.owned[old.id] = n;
      else delete p.owned[old.id];
    }
    const spare = GEAR.find(g => g.slot === 'rod' && g.tier === 1 && g.set === set);
    if (spare) cfg.rod = spare.id;
    const rs = rigStats(p, set, mods);
    const limit = LOSS.rodBreakDragFrac * rs.rodMaxLoadKg;
    const notch = Math.max(0, Math.min(cfg.dragNotch, rs.dragNotches));
    if (notch * rs.dragNotchKg > limit) {
      let n = Math.floor(limit / rs.dragNotchKg);
      if ((n + 1) * rs.dragNotchKg <= limit) n += 1;          // 부동소수 경계 보정 — 상한 이하의 가장 큰 눈금
      while (n > 0 && n * rs.dragNotchKg > limit) n -= 1;
      cfg.dragNotch = Math.max(0, n);
      dragKgAfter = cfg.dragNotch * rs.dragNotchKg;
    }
  }

  // 예비 스풀(모든 사유)
  let spareSpool = false;
  if (cfg.lineM < CAST.minLineM + CAST.lineReserveM) {
    const spareLine = GEAR.find(g => g.slot === 'line' && g.tier === 1);
    const cap = GEAR_BY_ID[cfg.reel].capacityM;
    if (spareLine) {
      cfg.lineId = spareLine.id;
      cfg.lineM = cap;
      spareSpool = true;
      ctx.emit(EV.LINE_REFILLED, { set, lineId: spareLine.id, meters: cap, cost: 0 });
    }
  }

  if (FISH_LOST[reason]) p.stats.lost += 1;
  ctx.refresh();
  return {
    reason,
    set,
    baitId: /** @type {any} */ (bait ?? cfg.bait),
    baitLost,
    tackleCost,
    lineLostM: lost,
    rodLost,
    spareSpool,
    dragKgAfter,
    cause: cause ?? null,
    hookSmall: !!hookSmall,
    moneyBefore,
    moneyAfter: p.money,
  };
}

/**
 * 무료 미끼(§5.6): 돈 < FREE_BAIT.moneyBelow 이고 미끼가 하나도 없고 오늘 아직 받지 않았으면 FREE_BAIT.count 개 → {granted}.
 * 미끼가 하나도 없었으므로 두 세트의 끼울 미끼도 그 미끼로 바꾼다(바꾸지 않으면 캐스팅이 계속 noBait 로 막힌다).
 * BAIT_GRANTED · ctx.refresh().
 * @param {SimCtx} ctx
 */
export function grantFreeBaitIfNeeded(ctx) {
  const p = ctx.state.profile;
  const day = ctx.state.clock.day;
  if (p.money >= FREE_BAIT.moneyBelow) return { granted: 0 };
  if (p.flags.freeBaitDay === day) return { granted: 0 };
  for (const id of BAIT_IDS) if ((p.baits[id] ?? 0) > 0) return { granted: 0 };
  p.baits[FREE_BAIT.baitId] = FREE_BAIT.count;
  p.flags.freeBaitDay = day;
  for (const set of SET_IDS) p.sets[set].bait = /** @type {any} */ (FREE_BAIT.baitId);
  ctx.emit(EV.BAIT_GRANTED, { baitId: FREE_BAIT.baitId, count: FREE_BAIT.count });
  ctx.refresh();
  return { granted: FREE_BAIT.count };
}
