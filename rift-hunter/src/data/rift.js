// OWNER: P2 — 계약 §7.3 (시드 — P0 이 W0 에 계약 값으로 채웠다 · 🔒 값은 혼자 바꾸지 않는다)
// 균열 레벨 곡선. 아이템 가치 · 가격 · 골드 더미는 GROWTH.gold, 무기 피해 · 방어도 · pow 옵션 · 감소 식 분모는 GROWTH.item.

/** @typedef {import('../types.js').RiftRow} RiftRow */

export const GROWTH = { item: 1.10, hp: 1.14, dmg: 1.10, gold: 1.14, xp: 1.12, lateFrom: 20, hpLate: 1.12, dmgLate: 1.05 };   // 🔒 §7.14 (모두)

export const RIFT = {
  lives: 3, guardianDelay: 2.0, completeDelay: 1.5, unlockClear: 1, unlockNoDeath: 2, maxLevel: 99, exitPortalOffset: 3, exploreR: 14,
  portalR: 1.0, earlyGaugeTo: 2, earlyGaugeMul: 1.25,
};

/**
 * 순수 · 1..maxLevel · 30 위도 같은 식(NaN · Infinity 없음 — L 은 정수로 자르고 [1, maxLevel])
 * @param {number} level @returns {RiftRow}
 */
export function riftRow(level) {
  let L = Math.floor(Number(level));
  if (!Number.isFinite(L) || L < 1) L = 1;
  if (L > RIFT.maxLevel) L = RIFT.maxLevel;
  return {
    level: L, monLevel: L, ilvl: L,
    hpMul: GROWTH.hp ** (Math.min(L, GROWTH.lateFrom) - 1) * GROWTH.hpLate ** Math.max(0, L - GROWTH.lateFrom),
    dmgMul: GROWTH.dmg ** (Math.min(L, GROWTH.lateFrom) - 1) * GROWTH.dmgLate ** Math.max(0, L - GROWTH.lateFrom),
    // L > 20: 캐릭터 레벨 캡(≈ 균열 19) 뒤 생명이 늘지 않으니 몬스터 성장을 늦춘다 — §7.14
    goldMul: GROWTH.gold ** (L - 1), xpMul: GROWTH.xp ** (L - 1),
    champAffixes: L < 10 ? 1 : 2, eliteAffixes: L < 5 ? 2 : L < 15 ? 3 : 4, guardianAffixes: L < 15 ? 3 : 4,
    championPacks: 4 + (L >= 8 ? 1 : 0) + (L >= 16 ? 1 : 0), elitePacks: L < 5 ? 2 : 3,
    rarityMul: { magic: 1 + 0.02 * (L - 1), rare: 1 + 0.035 * (L - 1), legendary: 1 + 0.05 * (L - 1), set: 1 + 0.05 * (L - 1) },
  };
}

/** 표 보기 · 균열석 @type {RiftRow[]} */
export const RIFT_LEVELS = Array.from({ length: 30 }, (_, i) => riftRow(i + 1));
