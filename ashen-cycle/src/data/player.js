// OWNER: P1 — 계약 §7.1 (시드: P0이 계약 값으로 완성 · 이후 조정은 P1만 ±20%)
// 시간은 전부 초, 길이 m, 각도 rad.

export const PLAYER = {
  radius: 0.4, height: 1.8,
  base: { hp: 100, stamina: 100, staminaRegen: 45, flaskCharges: 3, flaskHeal: 45,
          parryWindow: 0.18, parryPosture: 30 },
  move: { walkSpeed: 5.0, sprintSpeed: 7.4, guardSpeed: 2.4, flaskSpeed: 1.6,
          accel: 40, decel: 50,                 // m/s²
          turnRate: 14, lockTurnRate: 12, attackTurnRate: 6,   // rad/s
          attackSnapTurnRate: 40, attackSnapDur: 0.08,         // 공격 시작 직후의 빠른 조준(rad/s · 초)
          strideWalk: 1.7, strideSprint: 2.3,   // 발소리 간격(m)
          sprintIntentMin: 0.1, dirIntentMin: 0.3 },           // 이동 의도 길이 하한: 달리기 인정 · 방향 입력(구르기 방향 · 공격 조준) 인정
  stamina: { regenDelay: 0.7, exhaustedDelay: 0.75, exhaustedUntil: 16,   // (W3) 0.9 → 0.75 · 20 → 16: 탈진의 벌을 줄였다
             sprintDrain: 12, guardRegenMul: 0.35 },
  roll:     { dur: 0.62, moveDur: 0.50, dist: 4.2, iStart: 0.03, iEnd: 0.40, cost: 22, actAt: 0.48 },
  backstep: { dur: 0.45, moveDur: 0.30, dist: 2.2, iStart: 0.03, iEnd: 0.22, cost: 14, actAt: 0.36 },
  guard: { arcHalf: 1.75, rearm: 0.40, hitDur: 0.28, breakDur: 1.20 },
  parry: { dur: 0.35, actAt: 0.12, pressGrace: 0.15 },
  flask: { dur: 1.30, healAt: 0.70, actAt: 1.05 },
  buffer: 0.35,                                 // 선입력 유효 시간(초)
  bufferAttack: 0.70,                           // 아래 상태에서 저장한 선입력의 유효 시간(긴 무브의 캔슬 창 · 구르기/경직의 끝까지 살아 있게)
  // (W3) bufferAttack을 쓰는 상태 — 곧 풀리는 잠금. 구르기 직후의 두 번째 구르기, 맞자마자(넘어지자마자) 누른 구르기가 씹히지 않게 한다.
  bufferLongStates: ['attack', 'roll', 'backstep', 'stagger', 'knockdown', 'getup'],
  // (W5) 공격 중에 누른 구르기 · 플라스크의 유효 시간 = max(bufferAttack, 그 무브의 캔슬 창까지 남은 시간 + 이 값).
  // 대검의 전 무브와 모든 무기의 강공격(차지 포함)은 캔슬 창까지가 0.70초보다 멀어, 예고 초반에 누른 구르기가 버려졌다.
  // 넉다운 중에 누른 구르기 · 플라스크도 같은 식이다: max(bufferAttack, 남은 넉다운 + getupDur + 이 값).
  bufferCancelSlack: 0.10,
  hurt: { staggerDur: 0.45, knockdownDur: 1.10, getupDur: 0.45, invuln: 0.50, wakeInvuln: 0.20,
          staggerPush: 3.5, knockdownPush: 9.0, guardPush: 2.5, knockDecay: 12 },
  attack: { lungeLead: 0.12, lockStopGap: 0.6 },// 전진 시작 = 예고 끝 lungeLead초 전 · 록온 전진은 보스 표면 lockStopGap m 앞에서 멈춤
  chargePostureMul: 2.0,                        // 완충 강공격의 체간 배율(차지 0→1에 따라 1→이 값)
  execute: { range: 2.4, frontHalf: 1.4, dur: 1.60, hitAt: 0.70, dmgMul: 5.0 },
  dashAttackMinSprint: 0.30,
  lockOn: { maxRange: 60, autoOnFight: true },
  deadPoseDur: 1.2,                             // view용: 쓰러지는 데 걸리는 시간(초)
};
