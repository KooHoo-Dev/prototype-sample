// OWNER: P3 — 계약 §8.6
// 세 보스 공통 AI · 프레임워크 상수. §8.1 · §8.4 · §8.5 · §8.7 · §8.9 본문의 숫자는 전부 이 표의 값이다.

export const BOSS_AI = {
  minWindup: 0.40,            // 배속을 받아도 예고는 이보다 짧아지지 않는다(초)
  negOffsetMax: 0.75,         // 음수 오프셋 절댓값 ≤ windup × 이 값(§8.9 규칙 4)
  reselect: 0.3,              // chase 중 재선택 간격(초)
  fallbackAfter: 3.0,         // 후보 없이 chase가 이만큼 이어지면 fallbackAttack(초)
  repeatPenalty: [0.3, 0.6],  // 직전 · 전전 공격과 같으면 가중치에 곱한다
  maxChain: 3,                // 연속기 최대 횟수
  approachBand: 1,            // d > preferredRange + 이 값이면 approach(m)
  kiteNear: 0.6,              // kite 보스: d < preferredRange × 이 값이면 retreat
  strafeSpeedMul: 0.6, strafeFlip: [1.5, 3.0],   // 스트레이프 속력 배율 · 방향 재추첨 간격 [min, max] 초
  stopShortPad: 0.9,          // lunge · leap의 stopShort 기본값 = radius + 이 값(m)
  teleportMargin: 1,          // 순간이동 목적지는 world.radius − radius − 이 값 안(m)
  introRoarAt: 0.5, phaseRoarAt: 0.6, phaseShake: [0.3, 0.6],   // 포효 큐 시각(초) · 페이즈 포효 흔들림 [진폭 m, 길이 초]
  rearChance: 0.5,            // (W3) 공격을 끝냈을 때 뒤를 잡혀 있으면(등 뒤 전용 공격을 고를 수 있으면) 이 확률로 돌아서지 않는다
  rearThinkMul: 0.3,          // (W3) 그때의 고민 시간 배율 — 짧게 고민하고 등 뒤 공격을 고른다

  // ── 아래는 계약 표에 이름이 없던 프레임워크 내부 상수(P3 추가 — 본문 §8.5 · §8.9의 숫자)
  teleportTries: 4,           // 순간이동 목적지를 콜라이더 밖으로 고쳐 보는 횟수
  validate: {                 // validateBossDef(§8.9)의 하한 · 범위
    windupMin: 0.45,          // 규칙 2: 예고 하한(초)
    recoveryMin: 0.3,         // 규칙 2: 후딜 하한(초)
    hitEndEps: 1e-6,          // 규칙 3: t1 ≤ active + 이 값
    minDamagingP1: 2,         // 규칙 6: 1페이즈에 고를 수 있는 피해 공격 수 하한
    rangeMax: 20,             // 규칙 6: 공백 구간을 보는 거리 범위 [0, 이 값] m
    preferredBand: 1,         // 규칙 6: preferredRange ± 이 값(m)에 공백이 걸치면 안 된다
  },
};
