// OWNER: P2 — 계약 §7.8
// SEED — P0 이 W0 에 계약 값 그대로 넣었다. 조정은 소유 패키지만 §7.0 규칙 안에서(🔒 값은 밸런스 게이트만).

export const FIGHT = {
  forceExp: 0.75, speedExp: 0.5, enduranceExp: 0.3,                 // 🔒
  fatigueFloor: 0.3, runFatigueMin: 0.4,
  reelLoadK: 0.25, reelLoadExp: 0.6,
  pumpTension: 0.35, pumpLiftTime: 0.8, rodLowerTime: 0.4, pumpDrain: 1.7,   // 🔒 pumpTension · pumpDrain
  pumpStroke: 2.4, pumpGainFrom: 0.5,                                // 펌핑 거리는 rodLift 0.5 → 1 구간에서만(완전한 스트로크 = 2.4 × 0.5 = 1.2m)
  baseDrain: 0.18, recoverRate: 0.25, recoverBelow: 0.35,            // 🔒 baseDrain
  slipRef: 0.25, minSlipSp: 0.3, stick: 0.5, stickTime: 0.25,        // 🔒 stick · stickTime
  hookGrace: 0.6, startTele: 0.6,                                    // 챔질 뒤 0.6초는 정지 마찰 과부하 없음 · 시작 상태가 질주류면 0.6초 예고
  tensionLambda: 18, minDistPad: 0.5, slackFlowFrac: 0.5, flowLoadK: 0.02,   // 최소 거리 = spot.edgeM + 0.5
  teleF: 0.4, teleAlong: 0.5, teleSp: 0.3, teleDepth: 1.5,
  jumpSpike: 1.1, lowRodAbsorb: 0.55,
  shakePulse: 0.3, shakePulseOn: 0.1, shakeAmp: 0.6,
  coverRate: 0.35, coverEscape: 0.5, coverDecay: 0.3, coverAbrasion: 0.03, maxAbrasion: 0.9,
  netReachM: 1.4, landStamina: 0.15, netRunReset: 3.0, netBufferS: 0.3,   // 🔒 netReachM · landStamina — 뜰채 범위 = spot.edgeM + netReachM(+ 스킬)
  rodStressAt: 0.85, lineDangerAt: 0.85, rodBreakHold: 0.3,          // 🔒 rodBreakHold — 세운 로드가 상한을 0.3초 넘겨야 부러진다
  tiredStamina: 0.3, tiredDepth: 0.4, midDepthFrac: 0.5, depthSpeed: 1.5,
  bearingSlack: 0.35, bearingMinDist: 3.0, nearArc: 0.3, nearDist: 8, maxArc: 1.3,
};
export const HOOK = {                                                // 🔒 전부
  slackFracLine: 0.06, slackFracFish: 0.2, slackRate: 0.06, slackCap: 4, slackDecay: 2,
  jumpPumpP: 0.30, jumpLowP: 0.03, jumpLooseP: 0.25,                 // 세우고 맞으면 0.30 + 0.25 × 예고 직전 느슨함 · 숙이면 0.03
  shakeP: 0.08, tightRef: 0.7,                                       // 흔들기 상태 진입마다 한 번
  activeRate: 0.035, looseBase: 0.1,
};
