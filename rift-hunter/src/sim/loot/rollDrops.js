// OWNER: P5 — 계약 §5.13 · §6.10
// STUB — W1 에서 P5 가 채운다(드랍 묶음 → 등급 굴림 → 부위 · 기본형 → rollItem · 불운 보정 · 아이발 수확 체감)
// 순수 함수 하나 — 게임 · 봇 · 분석 패널 · 측정 · 테스트가 같은 것을 부른다. 입력을 고치지 않는다.

import { SLOT_WEIGHTS } from '../../data/items.js';
import { basesFor } from '../../data/index.js';
import { ITEM_SLOTS } from '../../core/constants.js';
import { makeItem } from './rollItem.js';

/** @typedef {import('../../types.js').Rng} Rng */
/** @typedef {import('../../types.js').DropRoll} DropRoll */
/** @typedef {import('../../types.js').Item} Item */

/**
 * STUB — 한 번의 처치 드랍. W0: {drops: [], blp}
 * @param {Rng} rng
 * @param {{rank:string, level:number, cls:string, mf?:number, gf?:number, blp?:number, blpOn?:boolean, newId:() => string}} opts
 * @returns {{drops:DropRoll[], blp:number}}
 */
export function rollDrops(rng, { rank, level, cls, mf = 0, gf = 0, blp = 0, blpOn = true, newId }) {
  return { drops: [], blp };
}

/**
 * STUB — 등급 굴림(가중치 한 번 뽑기). W0: normal
 * @param {Rng} rng @param {{rank:string, level:number, mf?:number, blp?:number, blpOn?:boolean, guaranteed?:boolean}} opts
 * @returns {{rarity:import('../../types.js').Rarity, blp:number}}
 */
export function rollRarity(rng, { rank, level, mf = 0, blp = 0, blpOn = true, guaranteed = false }) {
  return { rarity: 'normal', blp };
}

/**
 * STUB — 장비 하나(드랍 · 도박 · 제작 · 재고 · 개발 캐릭터 공용). W0: 그 부위(없으면 첫 부위)의 첫 기본형을 makeItem 으로 —
 * 전설 · 세트는 희귀로 내린다(W0 에는 후보 고르기가 없다)
 * @param {Rng} rng
 * @param {{rarity:import('../../types.js').Rarity, level:number, cls:string, newId:() => string, slot?:string|null, slotWeights?:Record<string, number>, ownClassOnly?:boolean}} opts
 * @returns {Item}
 */
export function rollGear(rng, { rarity, level, cls, newId, slot = null, slotWeights = SLOT_WEIGHTS, ownClassOnly = false }) {
  const s = slot ?? ITEM_SLOTS[0];
  const base = basesFor(s, cls)[0] ?? basesFor(ITEM_SLOTS[0], cls)[0];
  const r = rarity === 'legendary' || rarity === 'set' ? 'rare' : rarity;
  return makeItem({ baseId: base.id, tier: 0, ilvl: Math.max(1, level), rarity: r, id: newId() });
}
