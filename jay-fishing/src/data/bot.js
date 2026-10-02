// OWNER: P10 — 계약 §7.10 · §12.1
// SEED — P0 이 W0 에 계약 값 그대로 넣었다. 조정은 소유 패키지만 §7.0 규칙 안에서(🔒 값은 밸런스 게이트만).
// BOT 은 §7.10 그대로다. PLAN 은 P10 이 더한 계획 봇의 동선 값(계약 밖 · 🔒 아님 — 측정의 손잡이가 아니라 걷기 · 장보기의 습관).

export const BOT = {
  react: { mean: 0.40, sd: 0.12, min: 0.18, max: 0.9 },    // 신호를 보고 Space까지(s) — 본신 창 0.9s 안
  earlyRate: 0.10,                                           // 🔒 예신에 성급히 챔질할 확률(입질당 — 챔질 성공 ≈ 0.90)
  castPower: { target: 0.90, sd: 0.04 },                     // 놓는 게이지 값(완벽 띠를 노린다)
  netReact: 0.30,
  dragEveryTicks: 2,                                         // 🔒 드랙은 2틱에 1눈금까지만 바꾼다(사람의 휠 · Z/C 속도 — 초당 30눈금)
  basic:      { dragRatio: 0.30, reelBelow: 0.50 },          // 🔒 브리프 §7 — 드랙 = 라인 강도의 30% 고정 · 텐션 50% 아래면 릴링 · 펌핑 없음
  controlled: { restDrag: 0.70, runDrag: 0.45, snagDrag: 0.80, rodCap: 0.90, panic: 0.80, reelBelow: 0.70, pumpStart: 0.50, pumpStop: 0.80, teleReact: 0.30 },
  mindless:   { pumpCycle: [0.8, 0.4] },                     // 드랙 최대 · 항상 릴링 · 세우기 0.8s / 숙이기 0.4s 반복
  locked:     { dragRatio: 0.85 },                           // 측정 전용 — 드랙 = 라인의 85% 고정 · 항상 릴링 · 펌핑 · 점프 대응 없음(「드랙 잠그고 감기만」의 반복 전략)
  plans: {   // byBand: [자리, 세트, 미끼]
    lakeDay:  { stage: 'lake',  byBand: { dawn: ['lake_gravel', 'bottom', 'paste'], morning: ['lake_gravel', 'bottom', 'paste'], day: ['lake_gravel', 'bottom', 'paste'],
                                          evening: ['lake_gravel', 'bottom', 'paste'], night: ['lake_gravel', 'bottom', 'worm'] } },
    coastDay: { stage: 'coast', byBand: { dawn: ['coast_channel', 'float', 'krill'], morning: ['coast_shoal', 'float', 'krill'], day: ['coast_shoal', 'float', 'krill'],
                                          evening: ['coast_channel', 'float', 'krill'], night: ['coast_cape', 'bottom', 'shrimp'] } },
    riverDay: { stage: 'river', byBand: { dawn: ['river_tailrace', 'float', 'shrimp'], morning: ['river_tailrace', 'float', 'shrimp'], day: ['river_riffle', 'float', 'worm'],
                                          evening: ['river_trench', 'bottom', 'live'], night: ['river_trench', 'bottom', 'live'] } },
    progress: { coastFromLevel: 5, riverFromLevel: 10, riverHook: 'hook_l',      // 강에서는 두 세트에 큰 바늘(입 3 어종 — 1단계라 무료 · equip)
                buyOrder: ['rod_float_2', 'reel_2', 'line_2', 'float_2', 'rod_bottom_2', 'reel_2', 'sinker_2', 'rod_bottom_3', 'reel_3', 'line_3', 'sinker_3', 'rod_float_3', 'reel_3', 'float_3'],
                skillOrder: ['hookset', 'dragSense', 'mastery', 'mastery', 'netting', 'baitCraft', 'lineCare', 'casting', 'pumping', 'haggling', 'knowledge', 'dragSense', 'netting', 'baitCraft', 'lineCare', 'hookset', 'casting', 'pumping', 'haggling', 'mastery'] },
  },
};

/** 계획 봇(bot.js · planner.js)의 동선 · 장보기 습관 — §12.1 의 문장을 수치로 옮긴 것 */
export const PLAN = {
  dayEndHour: 4.5,          // 야외: 이 시각(새벽)부터 기상 전까지는 캠프 → 집(§12.1 「다음 날 04:30에 캠프」)
  homeSleepFrom: 3.0,       // 집: 이 시각부터 기상 전까지 집에 있으면 문 대신 침대
  baitLow: 5,               // 계획 미끼가 이 아래면 판매상에 간다(§12.1)
  baitRestock: 15,          // 판매상 · PC 에 간 김에 이 아래인 계획 미끼는 채운다
  baitTarget: 30,           // 미끼 팩을 이만큼까지 산다
  moneyReserve: 8000,       // 업그레이드를 살 때 남겨 둘 돈(미끼 여유 — §12.1 「돈 + 미끼 여유」)
  lineRestoreFrac: 0.7,     // 라인이 용량의 이 비율 아래면 다시 감는다(§12.1)
  retryHours: 1,            // 판매상에서 할 일을 못 끝냈으면(돈 부족) 이만큼 지나야 다시 간다 · 실패한 장착도 같은 간격
  arriveM: 0.3,             // 목표 점에 닿았다고 보는 거리(§12.1)
  slowM: 0.9,               // 이 거리 안에서는 걸음을 늦춘다(가속 16m/s² — 지나치지 않게)
  stuckS: 1.5,              // 이만큼 걸어도 0.2m 도 줄지 않으면 옆걸음으로 비킨다
};
