// OWNER: P4 — 계약 §6.7 · §5.6 · §7.6 · §7.9
// STUB — W0 스텁(§6.14): fishPrice · sellPrice = 식대로(완성) · 명령은 {ok:false, reason:'stub'} · applyLoss = 상태를 바꾸지 않는 보고
//   · grantFreeBaitIfNeeded = {granted:0} · shopList [] · previewEquip = 지금 RigStats 두 번. P4 가 채운다.
// sim/fishing/* · sim/fight/* · GameSim.js 를 import 하지 않는다(§2.2).

import { rigStats } from './modifiers.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').Profile} Profile */
/** @typedef {import('../../types.js').Modifiers} Modifiers */
/** @typedef {import('../../types.js').SpeciesDef} SpeciesDef */
/** @typedef {import('../../types.js').CatchRecord} CatchRecord */
/** @typedef {import('../../types.js').LossReport} LossReport */
/** @typedef {import('../../types.js').ShopItem} ShopItem */
/** @typedef {import('../../types.js').SetId} SetId */
/** @typedef {import('../../types.js').RigStats} RigStats */

const STUB = Object.freeze({ ok: false, reason: 'stub' });

/** round(pricePerKg × weightKg × priceMul[tier]) @param {SpeciesDef} species @param {number} weightKg @param {'normal'|'trophy'|'legend'} tier @returns {number} */
export function fishPrice(species, weightKg, tier) {
  return Math.round(species.pricePerKg * weightKg * species.priceMul[tier]);
}

/** round(record.price × mods.sellMul) @param {CatchRecord} record @param {Modifiers} mods @returns {number} */
export function sellPrice(record, mods) {
  return Math.round(record.price * mods.sellMul);
}

/** STUB → Result{count, total} @param {SimCtx} ctx @param {{auto?:boolean}} [opts] */
export function sellAll(ctx, opts = {}) { void ctx; void opts; return { ...STUB }; }

/** STUB → Result{total} @param {SimCtx} ctx @param {number} uid */
export function sellOne(ctx, uid) { void ctx; void uid; return { ...STUB }; }

/** STUB → ShopItem[] @param {Profile} profile @param {Modifiers} mods @returns {ShopItem[]} */
export function shopList(profile, mods) { void profile; void mods; return []; }

/** STUB → Result{cost} @param {SimCtx} ctx @param {string} itemId @param {number} [qty] */
export function buy(ctx, itemId, qty = 1) { void ctx; void itemId; void qty; return { ...STUB }; }

/** STUB → Result{cost, meters} @param {SimCtx} ctx @param {SetId} set @param {string} lineId @param {{free?:boolean}} [opts] */
export function refillLine(ctx, set, lineId, opts = {}) { void ctx; void set; void lineId; void opts; return { ...STUB }; }

/** STUB → Result @param {SimCtx} ctx @param {SetId} set @param {string} slot @param {string} itemId */
export function equip(ctx, set, slot, itemId) { void ctx; void set; void slot; void itemId; return { ...STUB }; }

/** STUB → Result @param {SimCtx} ctx @param {SetId} set @param {string} baitId */
export function setBait(ctx, set, baitId) { void ctx; void set; void baitId; return { ...STUB }; }

/**
 * STUB — 상태를 바꾸지 않는 손실 보고(§5.6 의 계산은 P4).
 * @param {SimCtx} ctx @param {SetId} set @param {import('../../types.js').FailReason} reason
 * @param {{lineLostM?:number, baitId?:string, cause?:import('../../types.js').LossCause, hookSmall?:boolean}} [opts]
 * @returns {LossReport}
 */
export function applyLoss(ctx, set, reason, { lineLostM = 0, baitId, cause = null, hookSmall = false } = {}) {
  void lineLostM;
  const money = ctx.state.profile.money;
  return {
    reason,
    set,
    baitId: /** @type {any} */ (baitId ?? ctx.state.profile.sets[set].bait),
    baitLost: true,
    tackleCost: 0,
    lineLostM: 0,
    rodLost: null,
    spareSpool: false,
    dragKgAfter: null,
    cause,
    hookSmall,
    moneyBefore: money,
    moneyAfter: money,
  };
}

/** STUB → {granted:number} @param {SimCtx} ctx */
export function grantFreeBaitIfNeeded(ctx) { void ctx; return { granted: 0 }; }

/**
 * STUB — 지금은 바꾸기 전 · 후가 같은 RigStats.
 * @param {Profile} profile @param {SetId} set @param {string} slot @param {string} itemId @param {Modifiers} mods
 * @returns {{before:RigStats, after:RigStats}}
 */
export function previewEquip(profile, set, slot, itemId, mods) {
  void slot; void itemId;
  return { before: rigStats(profile, set, mods), after: rigStats(profile, set, mods) };
}
