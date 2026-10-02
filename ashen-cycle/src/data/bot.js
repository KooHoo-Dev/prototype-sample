// OWNER: P9 — 계약 §12.3 (시드: P0이 계약 값으로 완성 · 이후 조정은 P9만)
// 헤드리스 봇의 수치. 시간 초 · 길이 m · 각 rad. 로직(src/bot/bot.js)에는 숫자를 박지 않는다.

export const BOT = {
  dodgeChance: 0.85, reaction: 0.18, aggression: 1,       // createBot 기본값
  threatPad: 0.6, hazardPad: 0.3,                          // 위협 판정 여유(m)
  ringNear: 1.5, projLead: 0.4,                            // 충격파 띠 접근 거리(m) · 투사체 반응 시간(초)
  bigRadius: 4,                                            // 이보다 큰 원/띠는 중심 쪽으로 굴러 뚫는다(m)
  healBelow: 0.4, healSafeDist: 7, healRecovery: 1.2,      // 회복: HP 비율 · 안전 거리(m) · 보스 남은 후딜(초)
  executeStand: 1.6,                                       // 처형하러 설 지점 = 보스 정면 radius + 이 값(m)
  punishRecovery: 0.45, reachPad: 0.3, attackStamina: 25,  // 반격: 남은 후딜(초) · 사거리 여유(m) · 필요 스태미나
  sprintDist: 8, sprintStamina: 40, retreatStamina: 20,    // 거리 유지

  // ── 아래는 계약 표에 이름이 없던 값(P9 추가 — §12.3 본문의 규칙을 구현하며 필요해진 것)
  seed: 1,                 // createBot({seed}) 기본값
  attackCommit: 0.6,       // 위협이 이 시간(초) 안에 닿을 예정이면 새 공격을 시작하지 않는다(약공격이 구르기로 풀리기까지 ≈ 0.5초)
  edgeBand: 0.3,           // 사거리 끝에서 옆걸음할 때 거리를 맞추는 띠의 폭(m)
  wallMargin: 1.5,         // 후퇴 · 옆걸음이 경계에서 이만큼 안쪽에 닿으면 벽을 따라 미끄러진다(m)
  projAimCos: 0.7,         // 투사체 진행 방향과 「투사체 → 플레이어」 방향의 cos이 이 값 이상이면 「나를 향해 온다」
  flaskDrift: 0.5,         // 플라스크를 마시는 동안 보스 반대쪽으로 걷는 이동 의도의 크기(0..1)
  memoryMax: 256,          // 인스턴스별 구르기 판정 기억의 상한(넘으면 비운다)
  guardStamina: 20,        // (W3) 막을 수 있는 투사체를 가드로 받는 데 필요한 스태미나 — 모자라면 구른다
  coneNear: 3, coneInward: 0.9,   // (W3) 지속 판정(브레스)에서 벗어날 때: 보스에서 coneNear m보다 멀면 옆 방향에 「보스 쪽」을 이 비중으로 섞는다
};
