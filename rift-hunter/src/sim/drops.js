// OWNER: P2 — 계약 §6.8 · §7.6 · §5.13-5
// 바닥 드랍 생성 · 흩뿌림 · 줍기 · 자동 줍기. 골드 · 재료 · 포션은 P6 addGold · addMaterials · addConsumable 로만 더한다(§4.2).
// 주우면 removeDrop(표시) — 배열에서는 cleanup(removeMarked)이 뺀다(§5.14).

import { EV } from '../core/events.js';
import { GLOBE, PICKUP } from '../data/combat.js';
import { ECON } from '../data/economy.js';
import { healPlayer } from './combat.js';
import { addDrop, removeDrop } from './entities.js';
import { isUpgrade } from './loot/compare.js';
import { addConsumable, addGold, addMaterials, addToBag } from './progression/inventory.js';
import { emitHint } from './town.js';
import { isWalkable, nearestWalkable } from './world/nav.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').Drop} Drop */
/** @typedef {import('../types.js').DropRoll} DropRoll */
/** @typedef {import('../types.js').Result} Result */

const TAU = Math.PI * 2;

/** 다른 (안 주운) 드랍과 scatterSep 넘게 떨어졌는가 @param {Drop[]} drops @param {number} x @param {number} z */
function clearOfDrops(drops, x, z) {
  const sep2 = PICKUP.scatterSep * PICKUP.scatterSep;
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    if (d.gone) continue;
    const dx = d.pos.x - x, dz = d.pos.z - z;
    if (dx * dx + dz * dz <= sep2) return false;
  }
  return true;
}

/**
 * 흩뿌림(§7.6) — rng.loot 로 각도 · 거리(scatterMin..scatterMax)를 골라 걷기 가능하고 다른 드랍과 scatterSep 넘게 떨어진 첫 자리(최대 scatterTries 번) ·
 * 실패하면 마지막 시도 자리(걷기 가능하지 않으면 가장 가까운 걷기 가능 점)
 * @param {SimCtx} ctx @param {number} x @param {number} z @returns {{x:number, z:number}}
 */
function scatterPos(ctx, x, z) {
  const map = ctx.map;
  const drops = ctx.state.rift ? ctx.state.rift.drops : [];
  const rng = ctx.rng.loot;
  let px = x, pz = z;
  for (let k = 0; k < PICKUP.scatterTries; k++) {
    const a = rng.range(0, TAU);
    const d = rng.range(PICKUP.scatterMin, PICKUP.scatterMax);
    px = x + Math.sin(a) * d;
    pz = z + Math.cos(a) * d;
    if (map && !isWalkable(map, px, pz)) continue;
    if (!clearOfDrops(drops, px, pz)) continue;
    return { x: px, z: pz };
  }
  if (map && !isWalkable(map, px, pz)) {
    const q = nearestWalkable(map, px, pz) ?? nearestWalkable(map, x, z);
    if (q) return { x: q.x, z: q.z };
    return { x, z };
  }
  return { x: px, z: pz };
}

/**
 * DropRoll[] → 바닥 Drop(흩뿌림) · DROP_SPAWN · 장비면 rift.stats.drops[rarity] · 업그레이드 집계(isUpgrade) · HINT labels(첫 장비)
 * @param {SimCtx} ctx @param {DropRoll[]} rolls @param {number} x @param {number} z @returns {Drop[]}
 */
export function spawnDrops(ctx, rolls, x, z) {
  const st = ctx.state;
  /** @type {Drop[]} */
  const out = [];
  if (!st.rift || !Array.isArray(rolls)) return out;
  for (let i = 0; i < rolls.length; i++) {
    const roll = rolls[i];
    if (!roll || !roll.kind) continue;
    const item = roll.kind === 'item' ? roll.item ?? null : null;
    if (roll.kind === 'item' && !item) continue;
    const amount = item ? 1 : Math.max(0, Math.round(Number.isFinite(roll.amount) ? roll.amount : 0));
    if (!item && amount <= 0) continue;
    const pos = scatterPos(ctx, x, z);
    /** @type {Drop} */
    const d = {
      id: ctx.nextId(),
      kind: roll.kind,
      pos,
      from: { x, z },
      born: st.tick,
      item,
      amount,
      mat: roll.mat ?? null,
      rarity: item ? item.rarity : null,
      gone: false,
    };
    addDrop(ctx, d);
    if (item) {
      st.rift.stats.drops[item.rarity] = (st.rift.stats.drops[item.rarity] ?? 0) + 1;
      if (st.char && isUpgrade(ctx.stats, st.char, item)) st.rift.stats.upgrades += 1;
      emitHint(ctx, 'labels');
    }
    ctx.emit(EV.DROP_SPAWN, { id: d.id, kind: d.kind, rarity: d.rarity, x: pos.x, z: pos.z, fromX: x, fromZ: z });
    out.push(d);
  }
  return out;
}

/**
 * 줍기 → Result — 골드 · 재료 · 포션은 P6 add* · 구슬은 회복(× onGlobe().mul) · 아이템은 addToBag(가방이 차면 PICKUP_FAIL{bagFull} · 드랍은 그대로) ·
 * 포션이 상한이면 {ok:false, reason:'full'} + PICKUP_FAIL{reason:'full'} · 주우면 removeDrop(표시) · DROP_PICKED · SAVE_REQUEST{char, pickup}
 * @param {SimCtx} ctx @param {Drop} drop @returns {Result}
 */
export function pickupDrop(ctx, drop) {
  const st = ctx.state;
  const ch = st.char;
  if (!ch) return { ok: false, reason: 'invalid' };
  if (!drop || drop.gone) return { ok: false, reason: 'noItem' };
  const p = st.player;
  let amount = drop.amount;
  switch (drop.kind) {
    case 'gold':
      amount = addGold(ctx, drop.amount, 'pickup');
      break;
    case 'material':
      if (drop.mat) addMaterials(ctx, { [drop.mat]: drop.amount }, 'pickup');
      break;
    case 'potion': {
      const n = addConsumable(ctx, 'potion', drop.amount);
      if (!(n > 0)) {
        ctx.emit(EV.PICKUP_FAIL, { id: drop.id, reason: 'full' });
        return { ok: false, reason: 'full' };
      }
      if (n < drop.amount) {
        drop.amount -= n;
        ctx.emit(EV.DROP_PICKED, { id: drop.id, kind: drop.kind, amount: n, itemId: null, rarity: null });
        ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'pickup' });
        return { ok: true };
      }
      amount = n;
      break;
    }
    case 'globe': {
      if (p.dead) return { ok: false, reason: 'dead' };
      const g = ctx.hooks.onGlobe(ctx);
      const mul = g && g.mul > 0 ? g.mul : 1;
      healPlayer(ctx, p.lifeMax * GLOBE.heal * (1 + (ctx.stats.globePct ?? 0)) * mul, 'globe');
      amount = 1;
      break;
    }
    case 'item': {
      if (!drop.item) {
        removeDrop(ctx, drop.id);
        return { ok: false, reason: 'noItem' };
      }
      const r = addToBag(ctx, drop.item, 'pickup');
      if (!r.ok) {
        ctx.emit(EV.PICKUP_FAIL, { id: drop.id, reason: 'bagFull' });
        emitHint(ctx, 'bagFull');
        return { ok: false, reason: 'bagFull' };
      }
      amount = 1;
      break;
    }
    default:
      return { ok: false, reason: 'invalid' };
  }
  removeDrop(ctx, drop.id);
  ctx.emit(EV.DROP_PICKED, { id: drop.id, kind: drop.kind, amount, itemId: drop.item ? drop.item.id : null, rarity: drop.rarity });
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'pickup' });
  return { ok: true };
}

/**
 * 자동 줍기(균열 · 살아 있을 때) — 골드 goldR · 재료 matR · 포션 potionR(소지 상한 아래일 때만) ·
 * 구슬 globeR + onGlobe().radiusAdd(생명이 가득이 아닐 때만 — 가득이면 나중을 위해 남는다). 장비는 클릭으로만.
 * @param {SimCtx} ctx
 */
export function updatePickups(ctx) {
  const st = ctx.state;
  const rift = st.rift;
  const ch = st.char;
  const p = st.player;
  if (!rift || !ch || st.scene !== 'rift' || p.dead || st.pendingTravel) return;
  const drops = rift.drops;
  const px = p.pos.x, pz = p.pos.z;
  let globeR2 = -1;
  for (let i = 0, n = drops.length; i < n; i++) {
    const d = drops[i];
    if (d.gone) continue;
    const dx = d.pos.x - px, dz = d.pos.z - pz;
    const d2 = dx * dx + dz * dz;
    switch (d.kind) {
      case 'gold':
        if (d2 <= PICKUP.goldR * PICKUP.goldR) pickupDrop(ctx, d);
        break;
      case 'material':
        if (d2 <= PICKUP.matR * PICKUP.matR) pickupDrop(ctx, d);
        break;
      case 'potion':
        if (ch.potions < ECON.potionMax && d2 <= PICKUP.potionR * PICKUP.potionR) pickupDrop(ctx, d);
        break;
      case 'globe': {
        if (p.life >= p.lifeMax) break;
        if (globeR2 < 0) {
          const g = ctx.hooks.onGlobe(ctx);
          const r = PICKUP.globeR + (g && g.radiusAdd > 0 ? g.radiusAdd : 0);
          globeR2 = r * r;
        }
        if (d2 <= globeR2) pickupDrop(ctx, d);
        break;
      }
      default:
        break;
    }
  }
}
