// OWNER: P0 — 계약 §6.2 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 데이터 조회 표. 다른 데이터 파일은 서로를 import 하지 않는다(참조는 ID 문자열) — 이 파일만 전부를 모은다.
// getX(id) 는 없는 ID 에서 throw(데이터 오류 — 테스트가 잡는다). 세이브 정화는 *_BY_ID[id] 존재 검사로 한다.

import { CLASSES } from './classes.js';
import { BASIC_SKILLS, SKILL_NODES } from './skills.js';
import { MONSTERS, RANKS } from './monsters.js';
import { MON_AFFIXES } from './monsterAffixes.js';
import { PACKS } from './packs.js';
import { GUARDIANS } from './guardians.js';
import { BASES } from './items.js';
import { ITEM_AFFIXES } from './itemAffixes.js';
import { LEGENDARIES, SETS } from './legendaries.js';
import { TILESETS } from './tilesets.js';
import { TREASURE } from './drops.js';

/** @template T @param {T[]} rows @returns {Record<string, T>} */
function byId(rows) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const r of rows) out[r.id] = r;
  return Object.freeze(out);
}

export const CLASSES_BY_ID = byId(CLASSES);
export const SKILL_NODES_BY_ID = byId(SKILL_NODES);
export const MONSTERS_BY_ID = byId(MONSTERS);
export const RANKS_BY_ID = byId(RANKS);
export const MON_AFFIXES_BY_ID = byId(MON_AFFIXES);
export const PACKS_BY_ID = byId(PACKS);
export const GUARDIANS_BY_ID = byId(GUARDIANS);
export const BASES_BY_ID = byId(BASES);
export const ITEM_AFFIXES_BY_ID = byId(ITEM_AFFIXES);
export const LEGENDARIES_BY_ID = byId(LEGENDARIES);
export const SETS_BY_ID = byId(SETS);
/** 세트 조각 ID → {id, baseId, slot, setId} */
export const SET_PIECES_BY_ID = byId(SETS.flatMap(s => s.pieces.map(p => ({ ...p, setId: s.id }))));
export const TILESETS_BY_ID = byId(TILESETS);
export const TREASURE_BY_ID = byId(TREASURE);

function must(table, id, what) {
  const row = Object.prototype.hasOwnProperty.call(table, id) ? table[id] : undefined;
  if (row === undefined) throw new Error(`data: unknown ${what} id '${id}'`);
  return row;
}

export function getClass(id) { return must(CLASSES_BY_ID, id, 'class'); }
export function getNode(id) { return must(SKILL_NODES_BY_ID, id, 'skill node'); }
export function getMonster(id) { return must(MONSTERS_BY_ID, id, 'monster'); }
export function getRank(id) { return must(RANKS_BY_ID, id, 'rank'); }
export function getMonAffix(id) { return must(MON_AFFIXES_BY_ID, id, 'monster affix'); }
export function getPack(id) { return must(PACKS_BY_ID, id, 'pack'); }
export function getGuardian(id) { return must(GUARDIANS_BY_ID, id, 'guardian'); }
export function getBase(id) { return must(BASES_BY_ID, id, 'base'); }
export function getItemAffix(id) { return must(ITEM_AFFIXES_BY_ID, id, 'item affix'); }
export function getLegendary(id) { return must(LEGENDARIES_BY_ID, id, 'legendary'); }
export function getSet(id) { return must(SETS_BY_ID, id, 'set'); }
export function getSetPiece(id) { return must(SET_PIECES_BY_ID, id, 'set piece'); }
export function getTileset(id) { return must(TILESETS_BY_ID, id, 'tileset'); }
export function getTreasure(id) { return must(TREASURE_BY_ID, id, 'treasure'); }

/**
 * 몬스터 종류 조회(일반 · 수호자 공용) — sim · view · ui · bot 의 몬스터 종류 조회는 전부 이것
 * @param {string} typeId @returns {import('../types.js').MonsterDef}
 */
export function getMonDef(typeId) {
  if (Object.prototype.hasOwnProperty.call(MONSTERS_BY_ID, typeId)) return MONSTERS_BY_ID[typeId];
  if (Object.prototype.hasOwnProperty.call(GUARDIANS_BY_ID, typeId)) return /** @type {any} */ (GUARDIANS_BY_ID[typeId]);
  throw new Error(`data: unknown monster/guardian id '${typeId}'`);
}

/**
 * 스킬 수치 — 노드 ID 면 node.skill · 'bash' · 'magicBolt' 면 BASIC_SKILLS 행(없으면 throw · 패시브 · 변형도 throw)
 * @param {string} id @returns {import('../types.js').SkillDef}
 */
export function getSkillDef(id) {
  if (Object.prototype.hasOwnProperty.call(BASIC_SKILLS, id)) return BASIC_SKILLS[id];
  const node = SKILL_NODES_BY_ID[id];
  if (node && node.skill) return node.skill;
  throw new Error(`data: no skill def for id '${id}'`);
}

/** 그 클래스 노드(배열 순서) @param {string} cls */
export function nodesOf(cls) { return SKILL_NODES.filter(n => n.cls === cls); }
/** 그 클래스 액티브만 @param {string} cls */
export function activesOf(cls) { return SKILL_NODES.filter(n => n.cls === cls && n.kind === 'active'); }
/** 그 부위 · 클래스의 기본형(cls null 공용 포함) @param {string} slot @param {string|null} cls */
export function basesFor(slot, cls) { return BASES.filter(b => b.slot === slot && (b.cls === null || b.cls === cls)); }
/** 그 부위가 허용하는 옵션 @param {string} slot */
export function affixesFor(slot) { return ITEM_AFFIXES.filter(a => a.slots.includes(slot)); }
