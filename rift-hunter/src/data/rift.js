// OWNER: P2 — 계약 §7.3 (시드 — P0 이 W0 에 계약 값으로 채웠다 · 🔒 값은 혼자 바꾸지 않는다 · 「P2 W1」 값은 P2 가 더했다)
// 균열 레벨 곡선. 아이템 가치 · 가격 · 골드 더미는 GROWTH.gold, 무기 피해 · 방어도 · pow 옵션 · 감소 식 분모는 GROWTH.item.

/** @typedef {import('../types.js').RiftRow} RiftRow */

export const GROWTH = { item: 1.10, hp: 1.14, dmg: 1.10, gold: 1.14, xp: 1.12, lateFrom: 20, hpLate: 1.12, dmgLate: 1.05 };   // 🔒 §7.14 (모두)

export const RIFT = {
  lives: 3, guardianDelay: 2.0, completeDelay: 1.5, unlockClear: 1, unlockNoDeath: 2, maxLevel: 99, exitPortalOffset: 3, exploreR: 14,
  portalR: 1.0, earlyGaugeTo: 2,
  earlyGaugeMul: 1.6,        // W1 수정(NOTES-W1FIX): 1.25 → 1.6 — 균열 1~2 의 일반 처치 필요 ~250 → ~195(챔피언 · 정예 게이지 ~22% 를 뺀 78% ÷ (0.25% × 배율) · §7.14 · 균열 3 이상은 그대로)
  // P2 W1 — 로직의 숫자를 데이터로(계약 §5.10 · §5.18 · §9.8 의 값)
  guardianSpawnR: 2.0,       // 수호자 출현 예고 효과(guardianSpawn) 원 반지름(m — §9.8)
  exitPortalTries: 8,        // 나가는 포털 자리 찾기 방향 수(수호자 자리 + exitPortalOffset 의 원 위)
  exploreEvery: 0.2,         // 탐색 타일 갱신 간격(초)
  checkpointEvery: 0.5,      // 안전 지점 검사 간격(초 — 15틱 · §5.10)
  checkpointR: 15,           // 이 거리(m) 안에 깨어 있는 몬스터가 없으면 「조용하다」
  checkpointCalm: 2.0,       // 조용한 시간이 이만큼(초 — 60틱) 쌓이면 checkpoint = 플레이어 자리
  checkpointSleepMargin: 2,  // W1 수정(NOTES-W1FIX): 잠든 몬스터의 aggro + 이 거리(m) 안이고 시야(벽)가 트이면 조용하지 않다(음수면 끈다)
  hintEvery: 0.2,            // 「정예」 안내 검사 간격(초)
  // W1 수정 2(NOTES-W1FIX §2.0): 첫 판 완화를 균열 레벨에 묶는다 — 몬스터 피해(mon.dmg — 공격 · 투사체 · 속성 · 수호자 기술 전부)에 곱하는 경사.
  //   인덱스 = 균열 레벨 − 1 · 표 밖(그 위 레벨)은 1 — 🔒 MON.dmgBase · GROWTH 곡선은 손대지 않는다(earlyDmgMul · §7.3 · §7.14)
  earlyDmg: [0.2, 0.3, 0.45, 0.67],
};

/**
 * 순수 — 균열 레벨 L 의 첫 판 피해 경사(RIFT.earlyDmg[L − 1] · 표 밖 · 잘못된 값은 1)
 * @param {number} level @returns {number}
 */
export function earlyDmgMul(level) {
  const L = Math.floor(Number(level));
  const t = RIFT.earlyDmg;
  if (!Array.isArray(t) || !(L >= 1) || L > t.length) return 1;
  const v = Number(t[L - 1]);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

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
