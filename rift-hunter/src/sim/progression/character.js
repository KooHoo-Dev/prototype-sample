// OWNER: P6 — 계약 §6.11 · §3.7
// STUB — W0 에 완성으로 내는 것: createCharacter · summaryOf(최소 부트 · 고정 상태에 캐릭터가 있어야 한다)
// 계정 · 캐릭터 생성 · 시작 장비.

import { BAG_SIZE, SKILL_BAR } from '../../core/constants.js';
import { getClass } from '../../data/index.js';
import { START } from '../../data/economy.js';
import { emptyArray, emptyEquip } from '../state.js';
import { makeItem } from '../loot/rollItem.js';

/** @typedef {import('../../types.js').CharacterState} CharacterState */

/**
 * 레벨 1 · START 그대로 · 시작 장비(makeItem · 일반 · ilvl 1 · flags.start) · 상점 빈 재고 · stockRun -1 · char.seed = seed · lastRiftLevel 1
 * @param {{slot:number, cls:import('../../types.js').ClassId, name:string, newId:() => string, seed?:number}} opts
 * @returns {CharacterState}
 */
export function createCharacter({ slot, cls, name, newId, seed = 1 }) {
  const C = getClass(cls);
  const equip = emptyEquip();
  for (const g of C.startGear) {
    const item = makeItem({ baseId: g.baseId, tier: g.tier, ilvl: 1, rarity: 'normal', id: newId() });
    item.flags.start = true;
    const s = item.slot === 'ring' ? 'ring1' : item.slot;
    equip[/** @type {import('../../types.js').EquipSlot} */ (s)] = item;
  }
  return {
    slot,
    name: String(name ?? ''),
    cls,
    level: 1,
    xp: 0,
    xpTotal: 0,
    gold: START.gold,
    materials: { ...START.materials },
    potions: START.potions,
    scrolls: START.scrolls,
    skills: { ranks: {}, bar: emptyArray(SKILL_BAR) },
    equip,
    bag: emptyArray(BAG_SIZE),
    riftUnlocked: START.riftUnlocked,
    best: {},
    records: [],
    blp: { count: 0 },
    buyback: [],
    shop: { blacksmith: [], general: [], restocks: 0, stockRun: -1, reroll: null },
    hints: {},
    playSec: 0,
    runs: 0,
    seed: Number(seed) >>> 0,
    lastRiftLevel: 1,
  };
}

/** account.chars 한 칸 @param {CharacterState} char */
export function summaryOf(char) {
  return { name: char.name, cls: char.cls, level: char.level, riftUnlocked: char.riftUnlocked };
}
