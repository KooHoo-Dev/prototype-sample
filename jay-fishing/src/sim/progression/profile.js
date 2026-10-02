// OWNER: P4 — 계약 §6.7 · §7.9 · §3.6
// STUB — W0 스텁(§6.14): createNewProfile 은 §7.9 그대로(완성) · sanitizeProfile = 인자 그대로(없으면 새 프로필)
//   · makeDevProfile = 새 프로필에 level · money(· skillPoints = level). P4 가 채운다.

import { SKILL_IDS } from '../../core/constants.js';
import { START, XP } from '../../data/economy.js';

/** @typedef {import('../../types.js').Profile} Profile */

/** §7.9 START 그대로 @returns {Profile} */
export function createNewProfile() {
  /** @type {Record<string, 0|1|2|3>} */
  const skills = {};
  for (const id of SKILL_IDS) skills[id] = 0;
  return {
    money: START.money,
    level: START.level,
    xp: 0,
    xpTotal: 0,
    skillPoints: START.skillPoints,
    skills: /** @type {any} */ (skills),
    owned: {},
    baits: /** @type {any} */ ({ ...START.baits }),
    sets: {
      float: { ...START.sets.float },
      bottom: { ...START.sets.bottom },
    },
    hold: [],
    dex: {},
    flags: { hints: {}, freeBaitDay: 0 },
    stats: { landed: 0, lost: 0, released: 0, sold: 0, earned: 0, casts: 0 },
    nextUid: 1,
  };
}

/**
 * STUB — 던지지 않는다. 지금은 인자 그대로(없거나 객체가 아니면 새 프로필).
 * @param {any} raw @returns {Profile}
 */
export function sanitizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return createNewProfile();
  return raw;
}

/**
 * STUB — 새 프로필에 level · money. level 이면 skillPoints = level(누적 지급분) · xp 0.
 * @param {{level?:number|null, money?:number|null}} opts @returns {Profile}
 */
export function makeDevProfile({ level, money } = {}) {
  const p = createNewProfile();
  if (Number.isFinite(level)) {
    const lv = Math.max(1, Math.min(XP.levelCap, Math.round(/** @type {number} */ (level))));
    p.level = lv;
    p.skillPoints = lv;
  }
  if (Number.isFinite(money)) p.money = Math.max(0, Math.round(/** @type {number} */ (money)));
  return p;
}
