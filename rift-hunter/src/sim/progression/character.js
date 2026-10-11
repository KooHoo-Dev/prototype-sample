// OWNER: P6 — 계약 §6.11 · §3.7
// 계정 · 캐릭터 생성 · 시작 장비. 캐릭터 상태는 순수 객체(JSON 왕복 가능).

import { BAG_SIZE, SKILL_BAR } from '../../core/constants.js';
import { getClass } from '../../data/index.js';
import { START } from '../../data/economy.js';
import { emptyArray, emptyEquip } from '../state.js';
import { makeItem } from '../loot/rollItem.js';

/** @typedef {import('../../types.js').CharacterState} CharacterState */
/** @typedef {import('../../types.js').EquipSlot} EquipSlot */

/**
 * 레벨 1 · START 그대로 · 시작 장비(makeItem · 일반 · ilvl 1 · flags.start) · 상점 빈 재고 · stockRun -1 · char.seed = seed · lastRiftLevel 1
 * (모르는 클래스는 데이터 오류 — getClass 가 throw 한다. 이름 · 칸 검사는 부르는 쪽 GameSim.newCharacter)
 * @param {{slot:number, cls:import('../../types.js').ClassId, name:string, newId:() => string, seed?:number}} opts
 * @returns {CharacterState}
 */
export function createCharacter({ slot, cls, name, newId, seed = 1 }) {
  const C = getClass(cls);
  const equip = emptyEquip();
  for (const g of C.startGear) {
    const item = makeItem({ baseId: g.baseId, tier: g.tier, ilvl: 1, rarity: 'normal', id: newId() });
    item.flags.start = true;
    const s = item.slot === 'ring' ? (equip.ring1 ? 'ring2' : 'ring1') : item.slot;
    equip[/** @type {EquipSlot} */ (s)] = item;
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

/** account.chars 한 칸 @param {CharacterState} char @returns {{name:string, cls:import('../../types.js').ClassId, level:number, riftUnlocked:number}} */
export function summaryOf(char) {
  return { name: char.name, cls: char.cls, level: char.level, riftUnlocked: char.riftUnlocked };
}

/** 지금 캐릭터의 계정 칸 요약을 새로 쓴다(레벨업 · 해금 뒤 — 저장되는 계정이 낡지 않게) @param {import('../../types.js').GameState} state */
export function syncSummary(state) {
  const ch = state.char;
  const chars = state.account?.chars;
  if (!ch || !Array.isArray(chars)) return;
  if (Number.isInteger(ch.slot) && ch.slot >= 0 && ch.slot < chars.length) chars[ch.slot] = summaryOf(ch);
}
