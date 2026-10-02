// OWNER: P4 — 계약 §7.5 (P0이 계약 값을 그대로 옮겨 뒀다 · 이후 조정은 P4만)
// 사망 보상 공식 · 순환 배율은 §7.7의 산수에 묶여 있다 — 패키지가 바꾸지 않는다(W3에서만 조정).

export const ECONOMY = {
  death: { floor: 0.05, floorFullAt: 0.10, perFraction: 0.60 },
  repeatMul: [1, 0.5, 0.25],             // 이번 순환 격파 수 0 · 1 · 2 이상
  shardMilestones: [0.25, 0.5, 0.75],    // 각 1개. 보스별 · 순환별 1회
  shardsFirstKill: 3, shardsRepeatKill: 1,
  shardsRepeatKillMax: 2,                // 재격파 파편은 보스별 · 순환별 2번까지(그 뒤 재격파는 파편 0)
  cycle: { hpPer: 0.50, dmgPer: 0.20, rewardPer: 1.0,          // (W3) 0.75 → 0.50 · 0.30 → 0.20: 순환 +1에서 정체하지 않게
           softCap: 8, hpPerAfter: 0.25, dmgPerAfter: 0.10,   // 순환 8을 넘으면 HP · 피해 증가가 완만해진다(보상은 계속 선형)
           speedPer: 0.04, speedMax: 1.12, thinkBase: 0.85, thinkMin: 0.5,
           chainPer: 0.15, chainMax: 0.30 },
  weapon: { maxLevel: 10, dmgPerLevel: 0.10, posturePerLevel: 0.03,
            embers: [80, 130, 200, 290, 400, 530, 680, 850, 1040, 1250],   // +0→+1 … +9→+10
            shards: [1, 1, 1, 2, 2, 2, 3, 3, 3, 4],                         // 합 22
            catchUpEmberMul: 0.5 },                                         // 따라잡기 강화: 잔불 반값 · 파편 0
  shop: { flaskCharge: { prices: [350, 700, 1200] },                        // 3 → 6개
          flaskHeal: { prices: [200, 350, 550, 800, 1100], perLevel: 10 } },// 45 → 95
  relicSlots: 2,
};
