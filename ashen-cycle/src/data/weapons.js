// OWNER: P1 — 계약 §7.3 (시드: 머리 필드 + 무브 표를 P0이 계약 값으로 옮겼다 · 이후 조정은 P1만)
// 시간은 초, 길이 m, 각도 rad.
/** @typedef {import('../types.js').WeaponDef} WeaponDef */
/** @typedef {import('../types.js').MoveDef} MoveDef */
/** @typedef {import('../types.js').ShapeDef} ShapeDef */
/** @typedef {import('../types.js').WeaponId} WeaponId */

/** `arc r/half` @returns {ShapeDef} */
const arc = (r, halfAngle) => ({ type: 'arc', r, halfAngle });
/** `cap a→b/r` @returns {ShapeDef} */
const cap = (fwd0, fwd1, r) => ({ type: 'capsule', fwd0, fwd1, r });

/** `heavy` 플래그는 hitstop이 이 값 이상인 타(§7.3). */
const HEAVY_HITSTOP = 0.07;

/**
 * §7.3 무브 표 한 줄 → MoveDef. 인자 순서는 표의 열 순서와 같다.
 * chargeMax · chargeDmgMul은 heavy만(나머지 0 · 1).
 * @returns {MoveDef}
 */
function move(id, kind, motion, windup, active, recovery, dmgMul, posture, stamina, shape, lunge,
  comboAt, rollCancelAt, next, hitstop, chargeMax = 0, chargeDmgMul = 1) {
  return {
    id, kind, motion, windup, active, recovery, chargeMax, dmgMul, chargeDmgMul, posture, stamina,
    shape, lunge, comboAt, rollCancelAt, next, hitstop, heavy: hitstop >= HEAVY_HITSTOP,
  };
}

/** @param {MoveDef[]} list @returns {Record<string, MoveDef>} */
function byId(list) {
  /** @type {Record<string, MoveDef>} */
  const out = {};
  for (const m of list) out[m.id] = m;
  return out;
}

/** @type {Record<WeaponId, WeaponDef>} */
export const WEAPONS = {
  // 균형
  longsword: {
    id: 'longsword', grip: 'oneHand', baseDamage: 20, guardReduction: 0.75, guardStaminaFactor: 0.90,
    reach: 2.6, length: 1.1,
    moves: byId([
      //   id         kind     motion      windup active recov  dmg   post stam  shape                 lunge comboAt rollCancel next     hitstop
      move('light1',  'light', 'slashR',   0.27,  0.10,  0.38,  1.00, 6,   12,   arc(2.6, 0.96),       0.8,  0.12,   0.15,      'light2', 0.05),
      move('light2',  'light', 'slashL',   0.24,  0.10,  0.38,  1.00, 6,   12,   arc(2.6, 0.96),       0.7,  0.12,   0.15,      'light3', 0.05),
      move('light3',  'light', 'slashUp',  0.27,  0.10,  0.42,  1.10, 7,   13,   arc(2.7, 1.05),       0.8,  0.14,   0.17,      'light4', 0.05),
      move('light4',  'light', 'overhead', 0.36,  0.12,  0.58,  1.40, 10,  17,   cap(0.3, 3.0, 0.7),   1.0,  0.58,   0.24,      null,     0.07),
      move('heavy',   'heavy', 'thrust',   0.42,  0.12,  0.60,  1.70, 14,  24,   cap(0.3, 3.2, 0.8),   1.2,  0.25,   0.26,      'light1', 0.08, 0.80, 1.50),
      move('dash',    'dash',  'thrust',   0.24,  0.14,  0.52,  1.30, 8,   16,   cap(0.3, 3.2, 0.6),   2.6,  0.22,   0.22,      'light2', 0.06),
      move('rollAtk', 'roll',  'slashUp',  0.20,  0.10,  0.42,  1.10, 6,   12,   arc(2.6, 1.05),       0.9,  0.14,   0.16,      'light2', 0.05),
    ]),
  },
  // 느리고 강함 · 체간 큼
  greatsword: {
    id: 'greatsword', grip: 'twoHand', baseDamage: 34, guardReduction: 0.85, guardStaminaFactor: 0.70,
    reach: 3.3, length: 1.7,
    moves: byId([
      move('light1',  'light', 'slashR',   0.42,  0.14,  0.55,  1.00, 12,  20,   arc(3.3, 1.22),       0.9,  0.18,   0.24,      'light2', 0.08),
      move('light2',  'light', 'slashL',   0.40,  0.14,  0.58,  1.05, 12,  20,   arc(3.3, 1.22),       0.9,  0.18,   0.24,      'light3', 0.08),
      move('light3',  'light', 'overhead', 0.52,  0.14,  0.75,  1.40, 18,  26,   cap(0.4, 3.8, 0.9),   1.1,  0.75,   0.30,      null,     0.10),
      move('heavy',   'heavy', 'spin',     0.60,  0.16,  0.80,  1.80, 26,  38,   arc(3.6, 1.75),       1.0,  0.30,   0.32,      'light1', 0.11, 1.00, 1.50),
      move('dash',    'dash',  'thrust',   0.34,  0.16,  0.70,  1.35, 14,  24,   cap(0.4, 3.8, 0.8),   2.8,  0.28,   0.28,      'light2', 0.09),
      move('rollAtk', 'roll',  'slashUp',  0.30,  0.14,  0.58,  1.10, 12,  20,   arc(3.3, 1.22),       1.0,  0.18,   0.24,      'light2', 0.08),
    ]),
  },
  // 빠른 찌르기 · 긴 사거리(화력 · 체간은 낮다)
  spear: {
    id: 'spear', grip: 'polearm', baseDamage: 15, guardReduction: 0.65, guardStaminaFactor: 1.10,
    reach: 4.0, length: 2.4,
    moves: byId([
      move('light1',  'light', 'thrust',   0.22,  0.09,  0.33,  1.00, 4,   10,   cap(0.4, 4.0, 0.45),  0.7,  0.10,   0.13,      'light2', 0.04),
      move('light2',  'light', 'thrust',   0.20,  0.09,  0.33,  1.00, 4,   10,   cap(0.4, 4.0, 0.45),  0.7,  0.10,   0.13,      'light3', 0.04),
      move('light3',  'light', 'thrust',   0.20,  0.09,  0.35,  1.05, 4,   10,   cap(0.4, 4.0, 0.45),  0.7,  0.10,   0.13,      'light4', 0.04),
      move('light4',  'light', 'sweep',    0.30,  0.12,  0.52,  1.45, 7,   16,   arc(4.0, 0.87),       0.6,  0.52,   0.22,      null,     0.07),
      move('heavy',   'heavy', 'thrust',   0.40,  0.12,  0.58,  1.75, 11,  22,   cap(0.4, 4.8, 0.55),  1.8,  0.24,   0.25,      'light1', 0.08, 0.70, 1.50),
      move('dash',    'dash',  'thrust',   0.20,  0.14,  0.50,  1.40, 8,   15,   cap(0.4, 4.6, 0.5),   3.2,  0.20,   0.20,      'light2', 0.06),
      move('rollAtk', 'roll',  'thrust',   0.18,  0.09,  0.38,  1.10, 4,   10,   cap(0.4, 4.0, 0.45),  1.0,  0.12,   0.14,      'light2', 0.04),
    ]),
  },
};

/**
 * @param {WeaponId} id
 * @returns {WeaponDef} 없는 id면 undefined
 */
export function getWeaponDef(id) {
  return WEAPONS[id];
}

/**
 * @param {WeaponId} weaponId
 * @param {string} moveId
 * @returns {MoveDef|null} 없으면 null
 */
export function getMoveDef(weaponId, moveId) {
  const w = WEAPONS[weaponId];
  return (w && w.moves[moveId]) || null;
}
