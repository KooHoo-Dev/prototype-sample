// OWNER: P5 — 계약 §6.10 · §5.13-5
// 장착 비교 · 업그레이드 판정. 순수 — char · item 을 고치지 않는다(가상의 장착은 equip 사본으로 계산한다).
// 칸 규칙: 반지는 slot 이 없으면 power 가 더 크게 오르는 칸(같으면 ring1) · 양손 무기는 보조를 뺀 시트 · 보조는 양손 무기를 끼고 있으면 비교하지 않는다('slot').

import { DMG_TYPES, EQUIP_SLOTS } from '../../core/constants.js';
import { COMPARE } from '../../data/items.js';
import { BASES_BY_ID } from '../../data/index.js';
import { computeStats, powerScore } from './stats.js';

/** @typedef {import('../../types.js').CharacterState} CharacterState */
/** @typedef {import('../../types.js').Item} Item */
/** @typedef {import('../../types.js').PlayerStats} PlayerStats */
/** @typedef {import('../../types.js').EquipSlot} EquipSlot */

const RING_SLOTS = /** @type {EquipSlot[]} */ (['ring1', 'ring2']);

/** 양손 무기인가 @param {Item|null|undefined} item */
function isTwoHanded(item) {
  return !!item && item.slot === 'mainHand' && (BASES_BY_ID[item.baseId]?.hands ?? 1) === 2;
}

/** 그 아이템이 지금 끼워져 있는 칸(같은 ID) @param {CharacterState} char @param {Item} item @returns {EquipSlot|null} */
function equippedSlotOf(char, item) {
  const eq = char?.equip;
  if (!eq || !item) return null;
  for (const s of EQUIP_SLOTS) if (eq[s] && (eq[s] === item || eq[s].id === item.id)) return s;
  return null;
}

/** 그 아이템이 들어갈 수 있는 칸 후보(부위 규칙만 — 클래스 · 레벨은 보지 않는다) @param {Item} item @param {string|null} slot @returns {EquipSlot[]} */
function candidateSlots(item, slot) {
  if (!item || !item.slot) return [];
  if (item.slot === 'ring') {
    if (!slot) return RING_SLOTS.slice();
    return RING_SLOTS.includes(/** @type {any} */ (slot)) ? [/** @type {EquipSlot} */ (slot)] : [];
  }
  if (!EQUIP_SLOTS.includes(/** @type {any} */ (item.slot))) return [];
  if (slot && slot !== item.slot) return [];
  return [/** @type {EquipSlot} */ (item.slot)];
}

/** 그 칸에 끼운 가상의 캐릭터(equip 사본 · 양손 무기면 보조를 뺀다) @param {CharacterState} char @param {Item} item @param {EquipSlot} slot */
function withItem(char, item, slot) {
  const equip = { ...char.equip, [slot]: item };
  if (slot === 'mainHand' && isTwoHanded(item)) equip.offhand = null;
  return { ...char, equip };
}

/** 그 칸에 보조를 끼울 수 없는가(양손 무기를 끼고 있다) @param {CharacterState} char @param {EquipSlot} slot */
function blockedByTwoHand(char, slot) {
  return slot === 'offhand' && isTwoHanded(char.equip?.mainHand);
}

/** 오른 비율이 COMPARE.minGain 을 넘는가 @param {number} before @param {number} after */
function gains(before, after) {
  if (!(after > 0)) return false;
  if (!(before > 0)) return true;
  return after > before * (1 + COMPARE.minGain);
}

/**
 * 끼울 칸과 그때의 시트 — 후보 칸마다 계산해 power 가 가장 큰 칸(앞 칸 우선) · 끼울 수 없으면 null
 * @param {CharacterState} char @param {Item} item @param {string|null} slot @param {number|null} riftLevel
 * @returns {{slot:EquipSlot, after:PlayerStats, power:number}|null}
 */
function bestFit(char, item, slot, riftLevel) {
  /** @type {{slot:EquipSlot, after:PlayerStats, power:number}|null} */
  let best = null;
  for (const s of candidateSlots(item, slot)) {
    if (blockedByTwoHand(char, s)) continue;
    const after = computeStats(withItem(char, item, s), { riftLevel });
    const power = powerScore(after);
    if (!best || power > best.power) best = { slot: s, after, power };
  }
  return best;
}

/** @param {PlayerStats} before @param {PlayerStats} after */
function deltaOf(before, after) {
  /** @type {Record<string, number>} */
  const res = {};
  for (const t of DMG_TYPES) res[t] = (after.res?.[t] ?? 0) - (before.res?.[t] ?? 0);
  return {
    sheetDps: after.sheetDps - before.sheetDps,
    lifeMax: after.lifeMax - before.lifeMax,
    armor: after.armor - before.armor,
    res,
    ehp: after.ehp - before.ehp,
    power: powerScore(after) - powerScore(before),
  };
}

/** 클래스 · 레벨 검사 → 사유(통과면 null) @param {CharacterState} char @param {Item} item @returns {'class'|'level'|null} */
function gateReason(char, item) {
  if (item.cls && item.cls !== char.cls) return 'class';
  if ((item.reqLevel ?? item.ilvl ?? 1) > (char.level ?? 1)) return 'level';
  return null;
}

/**
 * 그 아이템을 꼈을 때의 시트 비교(§6.10). 클래스 · 레벨이 안 맞으면 ok:false('class' · 'level')지만 after · delta 는 「꼈다면」 값이다(툴팁이 붉게 보인다).
 * 끼울 칸이 없으면(부위가 다름 · 양손 무기를 낀 채 보조) ok:false 'slot' · after = before · delta 0. 이미 끼운 그 아이템이면 그 칸 · delta 0 · upgrade false.
 * @param {CharacterState} char @param {Item} item @param {{riftLevel?:number|null, slot?:string|null}} [opts]
 * @returns {{slot:EquipSlot|null, ok:boolean, reason?:'class'|'level'|'slot', before:PlayerStats, after:PlayerStats,
 *   delta:{sheetDps:number, lifeMax:number, armor:number, res:Record<string, number>, ehp:number, power:number}, upgrade:boolean}}
 */
export function compareEquip(char, item, { riftLevel = null, slot = null } = {}) {
  const before = computeStats(char, { riftLevel });
  if (!char || !item) return { slot: null, ok: false, reason: 'slot', before, after: before, delta: deltaOf(before, before), upgrade: false };
  const worn = equippedSlotOf(char, item);
  if (worn) {
    const reason = gateReason(char, item);
    return { slot: worn, ok: !reason, ...(reason ? { reason } : {}), before, after: before, delta: deltaOf(before, before), upgrade: false };
  }
  const fit = bestFit(char, item, slot, riftLevel);
  if (!fit) return { slot: null, ok: false, reason: 'slot', before, after: before, delta: deltaOf(before, before), upgrade: false };
  const reason = gateReason(char, item);
  const upgrade = !reason && gains(powerScore(before), fit.power);
  return { slot: fit.slot, ok: !reason, ...(reason ? { reason } : {}), before, after: fit.after, delta: deltaOf(before, fit.after), upgrade };
}

/**
 * 업그레이드 판정(§5.13-5): 클래스가 맞고(null 또는 같은 클래스) · reqLevel ≤ level · 그 부위에 꼈을 때의 powerScore 가 지금보다 COMPARE.minGain 넘게 크다
 * (반지는 낮은 쪽을 바꾼 것 = 더 크게 오르는 칸 · 양손 무기는 보조를 뺀 것 · 보조는 양손 무기를 끼고 있으면 false).
 * stats = 지금 시트(ctx.stats — computeStats(char)와 같은 레벨 기준) · 없거나 유한수가 아니면 다시 계산한다.
 * @param {PlayerStats|null} stats @param {CharacterState} char @param {Item} item @returns {boolean}
 */
export function isUpgrade(stats, char, item) {
  if (!char || !item) return false;
  if (gateReason(char, item)) return false;
  if (equippedSlotOf(char, item)) return false;
  const fit = bestFit(char, item, null, null);
  if (!fit) return false;
  const now = stats && Number.isFinite(stats.sheetDps) && Number.isFinite(stats.ehp) ? powerScore(stats) : powerScore(computeStats(char));
  return gains(now, fit.power);
}

/**
 * 그 아이템이 들어갈 칸(부위 규칙 — 반지는 빈 칸 먼저(ring1 → ring2) · 둘 다 차 있으면 power 가 더 크게 오르는 칸) · 부위를 모르면 null.
 * 클래스 · 레벨 · 양손 무기 검사는 하지 않는다(장착 명령이 사유를 돌려준다)
 * @param {CharacterState} char @param {Item} item @returns {EquipSlot|null}
 */
export function bestSlotFor(char, item) {
  if (!item) return null;
  const worn = char ? equippedSlotOf(char, item) : null;
  if (worn) return worn;
  const cands = candidateSlots(item, null);
  if (cands.length <= 1) return cands[0] ?? null;
  const eq = char?.equip ?? {};
  for (const s of cands) if (!eq[s]) return s;
  if (!char) return cands[0];
  const fit = bestFit(char, item, null, null);
  return fit ? fit.slot : cands[0];
}
