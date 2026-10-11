// OWNER: P5 — 계약 §6.10 · §5.13-5
// STUB — W1 에서 P5 가 채운다(장착 비교 · 업그레이드 판정). W0: 비교 불가 결과 · isUpgrade false

import { DMG_TYPES } from '../../core/constants.js';
import { computeStats } from './stats.js';

/** @typedef {import('../../types.js').CharacterState} CharacterState */
/** @typedef {import('../../types.js').Item} Item */
/** @typedef {import('../../types.js').PlayerStats} PlayerStats */

/**
 * STUB — 그 아이템을 꼈을 때의 시트 비교
 * @param {CharacterState} char @param {Item} item @param {{riftLevel?:number|null, slot?:string|null}} [opts]
 * @returns {{slot:import('../../types.js').EquipSlot|null, ok:boolean, reason?:'class'|'level'|'slot', before:PlayerStats, after:PlayerStats,
 *   delta:{sheetDps:number, lifeMax:number, armor:number, res:Record<string, number>, ehp:number, power:number}, upgrade:boolean}}
 */
export function compareEquip(char, item, { riftLevel = null, slot = null } = {}) {
  const before = computeStats(char, { riftLevel });
  /** @type {Record<string, number>} */
  const res = {};
  for (const t of DMG_TYPES) res[t] = 0;
  return { slot: null, ok: false, reason: 'slot', before, after: before, delta: { sheetDps: 0, lifeMax: 0, armor: 0, res, ehp: 0, power: 0 }, upgrade: false };
}

/** STUB — 업그레이드 판정(§5.13-5) @param {PlayerStats} stats @param {CharacterState} char @param {Item} item */
export function isUpgrade(stats, char, item) {
  return false;
}

/** STUB — 그 아이템이 들어갈 칸 @param {CharacterState} char @param {Item} item @returns {import('../../types.js').EquipSlot|null} */
export function bestSlotFor(char, item) {
  return null;
}
