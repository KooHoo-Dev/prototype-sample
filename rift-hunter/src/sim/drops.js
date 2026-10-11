// OWNER: P2 — 계약 §6.8 · §7.6 · §5.13-5
// STUB — W0 에 완성으로 내는 것: spawnDrops(흩뿌림 없이 원 위 등간격 · 이벤트 · 업그레이드 집계) · 줍기는 W1 에서 P2 가 채운다

import { EV } from '../core/events.js';
import { PICKUP } from '../data/combat.js';
import { addDrop } from './entities.js';
import { isUpgrade } from './loot/compare.js';
import { nearestWalkable } from './world/nav.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').Drop} Drop */
/** @typedef {import('../types.js').DropRoll} DropRoll */

/**
 * DropRoll[] → 바닥 Drop · DROP_SPAWN · 장비면 rift.stats.drops[rarity] · 업그레이드 집계. W0: 흩뿌림 대신 (x, z) 둘레 원 위 등간격
 * @param {SimCtx} ctx @param {DropRoll[]} rolls @param {number} x @param {number} z @returns {Drop[]}
 */
export function spawnDrops(ctx, rolls, x, z) {
  const st = ctx.state;
  const map = ctx.map;
  const out = [];
  const n = rolls.length;
  const dist = (PICKUP.scatterMin + PICKUP.scatterMax) / 2;
  for (let i = 0; i < n; i++) {
    const roll = rolls[i];
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    let px = x + Math.sin(a) * dist, pz = z + Math.cos(a) * dist;
    if (map) {
      const p = nearestWalkable(map, px, pz, 3) ?? { x, z };
      px = p.x;
      pz = p.z;
    }
    const item = roll.item ?? null;
    /** @type {Drop} */
    const d = {
      id: ctx.nextId(),
      kind: roll.kind,
      pos: { x: px, z: pz },
      from: { x, z },
      born: st.tick,
      item,
      amount: roll.amount ?? (roll.kind === 'item' ? 1 : 0),
      mat: roll.mat ?? null,
      rarity: item ? item.rarity : null,
      gone: false,
    };
    addDrop(ctx, d);
    if (item && st.rift) {
      st.rift.stats.drops[item.rarity] += 1;
      if (st.char && isUpgrade(ctx.stats, st.char, item)) st.rift.stats.upgrades += 1;
    }
    ctx.emit(EV.DROP_SPAWN, { id: d.id, kind: d.kind, rarity: d.rarity, x: px, z: pz, fromX: x, fromZ: z });
    out.push(d);
  }
  return out;
}

/** STUB — 줍기(골드 · 재료 · 포션은 P6 add* · 구슬은 회복 · 아이템은 addToBag · removeDrop 표시) @param {SimCtx} ctx @param {Drop} drop */
export function pickupDrop(ctx, drop) {
  return { ok: false, reason: 'stub' };
}

/** STUB — 자동 줍기 반경 @param {SimCtx} ctx */
export function updatePickups(ctx) {}
