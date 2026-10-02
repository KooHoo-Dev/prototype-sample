// OWNER: P10 — 계약 §7.10 · §12.1
// SEED — P0 이 W0 에 계약 값 그대로 넣었다. 조정은 소유 패키지만 §7.0 규칙 안에서(🔒 값은 밸런스 게이트만).

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
