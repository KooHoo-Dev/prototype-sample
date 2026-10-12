// OWNER: P2 — 계약 §7.3 (시드 — P0 이 W0 에 계약 값으로 채웠다 · 🔒 값은 혼자 바꾸지 않는다 · 「P2 W1」 값은 P2 가 더했다)
// 균열 레벨 곡선. 아이템 가치 · 가격 · 골드 더미는 GROWTH.gold, 무기 피해 · 방어도 · pow 옵션 · 감소 식 분모는 GROWTH.item.

/** @typedef {import('../types.js').RiftRow} RiftRow */

export const GROWTH = { item: 1.10, hp: 1.14, dmg: 1.10, gold: 1.14, xp: 1.12, lateFrom: 30, hpLate: 1.12, dmgLate: 1.05 };   // 밸런스 게이트: lateFrom 20 → 30(봇이 캐릭터 레벨 30 에 닿는 것은 균열 22~26 — 균열 20~30 에서 막힘 없이 올랐다)   // 🔒 §7.14 (모두)

export const RIFT = {
  lives: 3, guardianDelay: 2.0, completeDelay: 1.5, unlockClear: 1, unlockNoDeath: 2, maxLevel: 99, exitPortalOffset: 3, exploreR: 14,
  portalR: 1.0, earlyGaugeTo: 4,
  // W1 수정(NOTES-W1FIX): 1.25 → 1.6(균열 1~2) · 밸런스 게이트: 균열별 배열로 — 균열 3 에서 배율이 1.6 → 1 로 끊겨 봇이 7.5분 판을
  //   거기서 7~8번 돌았다. [1.5, 1.35, 1.2, 1.1] = 균열 1 · 2 · 3 · 4 의 일반 · 하수인 게이지 배율(5 이상 1 — earlyGaugeMulOf)
  //   피드백 2: [1.5, 1.35, 1.2, 1.1] → 입문 구간 6칸 [1.25, 1.2, 1.15, 1.15, 1.1, 1.05](일반 생명 × 1.6 뒤 균열 4~6 판이 6분을 넘어 봇이 그 레벨에 묶였다 —
  //   입문 구간만 짧게 · 후반 판 길이는 그대로)
  earlyGaugeMul: [1.25, 1.2, 1.15, 1.15, 1.1, 1.05],
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
  //   W1 수정 3: [0.2, 0.3, 0.45, 0.67] → 레벨당 경사 ≤ × 1.488(균열 5 에서 1 이 되는 기하 경사) — 어려움/보상 비가 모든 L 에서 ≤ 1.25
  //   (옛 표는 L1→2 · L2→3 1.2537 · L4→5 1.2505 · 균열 1 은 0.2022 이상이어야 한다 — monsters.test 가 본다)
  //   밸런스 게이트(NOTES-BALANCE): MON.dmgBase × 7(24.5) 에 맞춰 경사를 균열 11 까지 늘렸다 — 균열 L 의 실제 배율(옛 dmgBase 3.5 기준) =
  //   0.205 · 0.283 · 0.389 · 0.537 · 0.740 · 1.02 · 1.41 · 1.94 · 2.67 · 3.68 · 5.08 · (12 이상) 7 — 균열 1 은 옛 값과 같고 레벨당 × 1.3785
  //   피드백 2 D1(Jay 결정 2026-10-12): 입문 구간을 균열 1~6 으로 — 균열 7 에서 1(본 곡선). MON.dmgBase 22 와 함께 균열 1 실제 배율(옛 dmgBase 3.5 기준) 0.205 그대로 ·
  //   앞을 무겁게(레벨당 × 2.4 → × 1.25) — 캐릭터 레벨이 빨리 오르는 균열 2~5 에 경사를 몰아 균열 3~5 무렵(30~45분)부터 사망이 나오고, 6 → 7 의 벽을 낮춘다.
  //   레벨 비 상한 1.25 는 입문 구간에서 푼다(monsters.test — 균열 7 부터)
  earlyDmg: [0.0326, 0.0777, 0.1805, 0.3277, 0.4836, 0.6045],
  // 밸런스 게이트(NOTES-BALANCE): 첫 판 생명 경사 — 몬스터 생명(hpMax)에 곱한다(earlyHpMul) · 균열 1 = × 0.45(hpBase 36 → 일반 생명 16.2 = 옛 hpBase 19 의 85% ·
  //   챔피언 · 정예 · 수호자는 옛 값의 1.95 · 2.03 · 0.97 배) → 균열 12 에서 1 · 레벨당 × 1.0753. 피해 경사와 합친 레벨당 × 1.4822 —
  //   어려움 √(생명 × 피해) ÷ 보상(+9.4%) 비 ≤ 1.2467(monsters.test)
  //   피드백 2 D1 · D9: 균열 1~6 · 기하 경사(레벨당 × 1.188) → 균열 7 에서 1. RANKS.normal.hp 1.6 과 곱한 균열 1 일반 생명 = 옛 값(0.45)의 1.27배 —
  //   시작 장비 회전 베기 정타 3.4번(첫 판 3~4번 안쪽 · 9분 안)
  earlyHp: [0.3569, 0.4238, 0.5032, 0.5974, 0.7093, 0.8422],
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
 * 순수 — 균열 레벨 L 의 첫 판 생명 경사(밸런스 게이트 · RIFT.earlyHp[L − 1] · 표 밖 · 잘못된 값은 1)
 * @param {number} level @returns {number}
 */
export function earlyHpMul(level) {
  const L = Math.floor(Number(level));
  const t = RIFT.earlyHp;
  if (!Array.isArray(t) || !(L >= 1) || L > t.length) return 1;
  const v = Number(t[L - 1]);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/**
 * 순수 — 균열 레벨 L 의 일반 · 하수인 게이지 배율(밸런스 게이트 · RIFT.earlyGaugeMul 이 배열이면 [L − 1] · 수면 L ≤ earlyGaugeTo 일 때 그 값 · 그 밖 1)
 * @param {number} level @returns {number}
 */
export function earlyGaugeMulOf(level) {
  const L = Math.floor(Number(level));
  const m = RIFT.earlyGaugeMul;
  if (!(L >= 1)) return 1;
  if (Array.isArray(m)) {
    const v = Number(m[L - 1]);
    return L <= m.length && Number.isFinite(v) && v > 0 ? v : 1;
  }
  return L <= RIFT.earlyGaugeTo && Number.isFinite(m) && m > 0 ? m : 1;
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
