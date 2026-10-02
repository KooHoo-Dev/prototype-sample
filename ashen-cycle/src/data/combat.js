// OWNER: P2 — 계약 §7.2 (시드: P0이 계약 값으로 완성 · 이후 조정은 P2만)

export const COMBAT = {
  hitstopMax: 0.20,
  bossHitHitstop: 0.07, bossKnockdownHitstop: 0.10, guardHitstop: 0.04,
  parryHitstop: 0.12, executeHitstop: 0.16,
  shake: {                       // [진폭 m, 길이 초]
    playerLight: [0.04, 0.10], playerHeavy: [0.10, 0.16], execute: [0.30, 0.35],
    playerHurt: [0.16, 0.22], playerKnockdown: [0.26, 0.30], guard: [0.08, 0.12], parry: [0.12, 0.16],
  },
  outroDeath: 1.8, outroVictory: 2.6,          // 초
  dummy: { radius: 0.5, resetAfter: 3.0 },
  hitY: { player: 1.1, dummy: 1.0, bossFrac: 0.55 },
  interactCooldown: 0.3,
  projectileParryPostureMul: 0.5,              // 투사체를 패링했을 때 보스에 쌓는 체간 = stats.parryPosture × 이 값
  hitLogMax: 128,                              // state.hitLog 길이 상한
  chargeShoveSpeed: 14,                        // (W3) 돌진하는 보스 몸통이 플레이어를 옆으로 비켜 세우는 속력(m/s) — §5.1 G3
  postureHitCap: 0.6,                          // (W5) 한 번의 타격 · 패링이 쌓는 체간의 상한 = boss.postureMax × 이 값 — 한 방에 체간이 가득 차지 않는다(§6.4 규칙 4)
};
