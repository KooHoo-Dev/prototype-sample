// OWNER: P4 — 계약 §7.4
// levelCost는 §7.7의 산수에 묶여 있다 — 패키지가 바꾸지 않는다(W3에서만 조정).

export const STATS = {
  maxPoints: 40,                       // 능력치당 상한
  tiers: [15, 30, 40],                 // 1~15 / 16~30 / 31~40 점 구간
  vit: { hpPerPoint: [14, 9, 5] },
  end: { staminaPerPoint: [5, 3, 1.5], regenPerPoint: [1.2, 0.8, 0.4] },
  str: { dmgPerPoint: [0.06, 0.035, 0.02] },
  dex: { posturePerPoint: [0.05, 0.03, 0.015],
         critBase: 1.25, critPerPoint: [0.03, 0.02, 0.01],
         executePerPoint: [0.05, 0.03, 0.015] },
  levelCost: { base: 60, linear: 8, quad: 0 },   // (W3) 60 + 10n + 0.3n² → 60 + 8n: 순환이 올라도 한 번 다녀오면 한 점은 산다(§7.7 (4))
  // 파생 수치를 1/precision 단위로 맞춘다 — 부동소수 잡음(1.1800000000000002)이 UI에 그대로 찍히지 않게.
  // 표의 값은 소수 5자리 안이라 손실이 없다.
  precision: 1e6,
};
