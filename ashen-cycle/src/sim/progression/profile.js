// OWNER: P4 — 계약 §6.6 · §7.5 「새 프로필」
// P0이 §7.5 그대로 완성해 뒀다(§6.9) — 이후 변경은 P4만.
import { BOSS_IDS, WEAPON_IDS } from '../../core/constants.js';

/** @typedef {import('../../types.js').Profile} Profile */
/** @typedef {import('../../types.js').BossProgress} BossProgress */

/**
 * @param {boolean} unlocked
 * @returns {BossProgress}
 */
function newBossProgress(unlocked) {
  return { unlocked, attempts: 0, totalKills: 0, killsThisCycle: 0, bestFraction: 0, milestones: 0 };
}

/**
 * 새 프로필. 첫 보스(BOSS_IDS[0])만 해금돼 있다. 무기는 처음부터 3종 모두 보유(+0).
 * @param {number} [seed] uint32로 강제한다
 * @returns {Profile}
 */
export function createNewProfile(seed = 1) {
  /** @type {Record<string, {level:number}>} */
  const weapons = {};
  for (const id of WEAPON_IDS) weapons[id] = { level: 0 };
  /** @type {Record<string, BossProgress>} */
  const bosses = {};
  BOSS_IDS.forEach((id, i) => {
    bosses[id] = newBossProgress(i === 0);
  });
  return {
    embers: 0,
    shards: 0,
    stats: { vit: 0, end: 0, str: 0, dex: 0 },
    weapons,
    equippedWeapon: WEAPON_IDS[0],
    flaskChargeLv: 0,
    flaskHealLv: 0,
    relicsOwned: [],
    relicsEquipped: [null, null],
    cycle: 0,
    bosses,
    totals: { deaths: 0, kills: 0, embersEarned: 0, playTime: 0 },
    seed: seed >>> 0,
  };
}
