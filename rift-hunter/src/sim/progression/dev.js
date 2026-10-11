// OWNER: P6 — 계약 §6.11 · §11.7
// STUB — W1 에서 P6 이 채운다(그 레벨 · 프리셋 빌드 · rift 면 riftUnlocked · 장비 10칸 rollGear). W0: createCharacter + level 만

import { LEVEL_CAP } from '../../core/constants.js';
import { createCharacter } from './character.js';

/**
 * STUB — 개발용 캐릭터(?level · ?rift)
 * @param {{slot?:number, cls:import('../../types.js').ClassId, name:string, level?:number, rift?:number, preset?:number, seed?:number, newId:() => string}} opts
 * @returns {import('../../types.js').CharacterState}
 */
export function makeDevCharacter({ slot = 0, cls, name, level = 1, rift = 1, preset = 0, seed = 1, newId }) {
  const char = createCharacter({ slot, cls, name, newId, seed });
  char.level = Math.max(1, Math.min(LEVEL_CAP, Math.floor(level)));
  return char;
}
