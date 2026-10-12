// OWNER: P15 — 계약 §7.13 · §12.1
// 봇 행동 수치. 시간은 초 · 거리 m · 비율 0..1. viewR 은 카메라(§9.3) · MON.threatRange 와 묶인 값이다.
// BOT 은 계약 §7.13 의 값 그대로다(priority 에 guardian · minion 두 키만 더했다 — 표에 없는 등급의 기본값).
// BOT_RULES 는 §12.1 의 규칙 표(동작별 스킬 사용 · 피하기 · 카이팅 · 줍기 · 탐색)의 숫자를 P15 가 데이터로 모은 것이다 —
//   로직 파일(src/bot/*)에는 수학 상수 밖의 숫자를 두지 않는다(§0.5).

export const BOT = {
  // 밸런스 게이트: 「보통 사람」 설정 — 반응 0.22 → 0.30초(sd 0.06 → 0.08 · 상한 0.4 → 0.5) · 알아챔 0.9 → 0.85 · 실수 2% → 4%
  reactSec: 0.30, reactSd: 0.08, dodgeNotice: 0.85, missClick: 0.04, missOffset: 1.0, potionAt: 0.40, kiteFrom: 4.0, kiteCount: 3,
  lootRadius: 12, lootSafeR: 10, upMaxSec: 360, downDeaths: 2, potionsTo: 10, scrollsTo: 5, viewR: 11.4, equipMinGain: 0.005,
  // P15 W2: guardian · minion 은 계약 표에 없는 등급의 값(수호자 = 정예와 같은 무게 · 하수인 = 일반)
  priority: { fallenShaman: 5, boneNest: 4, elite: 3, champion: 2, normal: 1, guardian: 3, minion: 1 }, chaseGiveUpSec: 6,
  townSec: { blacksmith: 20, general: 8, riftStone: 4 },
};

/** §12.1 의 규칙 표 숫자(P15 W2) — 계약 문면의 값을 그대로 옮기고, 문면에 없는 손잡이는 「P15」 표시 */
export const BOT_RULES = {
  // 반응 지연 — N(reactSec, reactSd)을 이 범위로 자른다(§12.1) · 봇 난수 시드의 소금(P15)
  reactMin: 0.1, reactMax: 0.5, rngSalt: 0x5eed,
  // 대상 — 12m 넘게 멀어지면 다시 고른다 · 포기한 대상은 이 초 동안 다시 고르지 않는다(P15)
  retargetDist: 12, giveUpIgnoreSec: 8,
  // 대상의 닿는 길 — 흐름장 걸음 수(0.5m 칸)가 직선 거리(칸)의 이 배수 + 여유를 넘으면 벽 너머로 보고 고르지 않는다(P15)
  reachMul: 2.5, reachPad: 16,
  // 피하기 — 플레이어 자리 +0.5m 를 덮는 예고 · hitAt − 지금 ≤ 걸어 나가는 시간 + 0.2초 · 12방향 × 2~5m 표본(§12.1)
  // 밸런스 게이트: 비키는 거리에 1m · 6 · 7m 를 더했다(좁은 표식은 한 걸음이면 된다 ·
  //   잿불 비(원 5 — 가운데 + 2.5~3.5m 고리)는 5m 안에 안전한 점이 없어 봇이 맞고 섰다 — 사람은 고리 틈으로 더 멀리 뛴다)
  // 밸런스 게이트: dodgeLead 0.8초 — 「걸어 나가는 시간 + 0.2초」까지 기다리면 그 사이 새 공격의 잠김에 걸려 맞았다(감옥 70% · 화염 강화 폭발 55~100%) · 방향 12 → 16
  dodgeMargin: 0.5, dodgeSlack: 0.2, dodgeLead: 0.8, dodgeDirs: 16, dodgeDists: [1, 2, 3, 4, 5, 6, 7], dodgeSafePad: 0.3,
  // 이동 스킬로 피할 때의 표본 거리(P15 — 도약 · 순간이동 · 돌진의 사거리 안)
  dodgeSkillDists: [3, 5, 7],
  // 생존 — 생명 < 70% 이고 8m 안에 구슬(§12.1)
  globeLife: 0.70, globeR: 8,
  // 카이팅 — 뒷걸음 거리 · 한 번에 걷는 시간 · 최소 간격 · 몰림이 풀린 뒤 다시 물러설 준비까지(P15) · 잠든 몬스터 쪽으로 물러서지 않는 거리 · 순간이동은 반대쪽 10m(§12.1)
  kiteDist: 5, kiteSec: 0.5, kiteGapSec: 1.5, kiteRearmSec: 1.0, kiteSleepR: 14, blinkDist: 10, awayDirs: 12,
  // 동작별 스킬 사용(§12.1 표)
  cone: { range: 4.0, count: 2, angleDeg: 120 },
  quake: { range: 6.0, count: 5 },
  dash: { min: 6, max: 10 },
  spin: { range: 2.4, count: 3, rage: 30, keepRange: 3.4, keepCount: 2, aimR: 5, aimAhead: 2 },
  buff: { combatR: 10 },
  leap: { min: 6, max: 9, packCount: 2, packMin: 2 },
  fireball: { reserve: 20 },
  meteor: { cluster: 3.5, count: 4, range: 18 },
  nova: { range: 5.0, count: 3 },
  shield: { life: 0.70 },
  chain: { range: 15 },
  // 같은 칸을 다시 누르기까지(틱 — 버퍼 · 실패 반복 막기 · P15)
  pressGap: 6,
  // 탐색 — 경유점 간격(타일) · 다시 계산(초) · 방에 들어섰다고 보는 거리(m) · 방이 이만큼 탐색되면 끝(P15)
  waypointTiles: 4, repathSec: 1.0, roomArriveR: 4, roomDoneFrac: 0.8, waypointReach: 1.5,
  // 나가는 포털 — 이 거리(m) 밖이면 타일 길로 걷고 안이면 누른다(밸런스 게이트)
  exitClickR: 8,
  // 끼임 — 이 초 동안 이 거리 안이고 준 피해 그대로면 둘레 이 거리의 걷기 가능 점을 이 초 동안 누른다(P15 — NOTES-W1FIX 「봇에는 끼임 풀기가 필요하다」)
  stuckSec: 3, stuckDist: 1, unstickSec: 1, unstickR: 4, unstickTries: 12, stuckGoalMax: 3,
  // 싸움 기억 — 깨어 있는 몬스터가 화면에서 사라진 뒤 이 초 동안은 마지막으로 본 자리로 돌아선다(P15 — 순간이동 · 도약으로 화면 밖에 나간 떼)
  fightMemorySec: 4,
  // 줍기 — 이 초 동안 못 주우면 그 드랍을 버린다 · 화면 밖(미니맵의 장비 점)은 이 거리 안이면 주우러 돌아간다(P15)
  lootGiveUpSec: 8, lootIgnoreSec: 60, lootMemoryR: 40,
  // 밸런스 게이트: 쫓던 화면 밖 드랍을 놓는 거리 여유(m) · 같은 드랍을 다시 고를 때 쫓은 시간을 이어 세는 틈(초) — 경계에서 줍기 ↔ 탐색이 뒤집혀 30초 넘게 제자리에서 떨었다(개발 마법사 레벨 30 · 균열 5)
  lootMemoryPad: 8, lootTryGapSec: 2,
  // 포션을 누른 뒤 같은 하락에 다시 누르지 않는 시간 · 귀환을 다시 누르는 간격 · 위협 기록을 잊는 시간 · 장착 비교 기억 상한 · 바닥 타일 찾기 반경(P15)
  potionRepressSec: 0.5, recallGapSec: 0.5, threatForgetSec: 3, equipSeenCap: 400, floorSearchTiles: 3,
  // 마을 — 물체를 다시 누르는 간격 · 이 초 안에 닿지 못하면 그 상점을 건너뛴다(P15)
  interactRetrySec: 2, interactGiveUpSec: 25,
  // 결정 기록 길이 상한(P15 — 몇 시간 측정에서도 메모리가 늘지 않게)
  logMax: 4000,
};

/** 측정(src/bot/measure.js · npm run measure — §12.5)의 작업 크기와 탐침 설정(P15) */
export const BOT_MEASURE = {
  // 1 · 2단계 작업 기본값 — basic 세션 시간 · challenge · noDodge/해금 + 3 · 빌드 · 장비 판 수 · 속성 탐침 시드 수 · 균열 레벨 · 빌드 비교 캐릭터 · 장비 비교 균열
  // 밸런스 게이트: replayRuns 20 → 40 · gearRuns 10 → 20 · buildRuns 10 → 15(판마다 사망 0~4 로 흔들려 20판 비율이 측정마다 크게 달랐다)
  hours: 9, challengeRuns: 20, replayRuns: 40, buildRuns: 15, gearRuns: 20, probeSeeds: 8, probeLevel: 5,
  buildChar: { level: 12, rift: 6 }, gearLevel: 8, gearPlus: 3, dropRolls: 100000, dropLevel: 5,
  // 판 하나의 상한 — 균열 시간(초) · 마을 등 균열 밖 여유(초) · 세션 끝 마을 정비 여유(초)
  maxRiftSec: 1200, townAllowSec: 900, tailTownSec: 60,
  // 정예 속성 탐침 — 팩 자리(플레이어에서 m · 방향 수 · 자리 몸 반지름) · 균열 시간 상한(초) · 캐릭터 레벨 = round(균열 × a + b)(NOTES-W1FIX 의 (5, 10) · (10, 18) · (15, 24))
  probeDist: 9, probeDirs: 12, probeR: 1.2, probeMaxSec: 150, probeCharA: 1.4, probeCharB: 3,
  // 경제 탐침 — 이 해금 레벨 무렵의 캐릭터로 부위마다 도박 n 번 · 리포트의 「무렵」 레벨 폭
  econLevel: 10, gambleSamples: 40, econBand: 2,
};
