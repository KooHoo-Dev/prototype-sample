// OWNER: P3 — 계약 §7.2b
// SEED — P0 이 W0 에 계약 값 그대로 넣었다. 조정은 소유 패키지만 §7.0 규칙 안에서(🔒 값은 밸런스 게이트만).

export const WORLD = {
  walkSpeed: 3.2, backMul: 0.7, strafeMul: 0.85, accel: 16,   // m/s · 뒤 · 옆 배율 · m/s² (멈출 때도 같은 가속)
  eyeHeight: 1.65,                                            // 브리프 §5
  spotRadius: 1.4, interactFov: 1.22,                         // 자리 진입 반경(m) · 상호작용 시선 반각(rad, 70°)
  exitStepBack: 1.0,                                          // 낚시 자리에서 일어나면 facing 반대로 1m
  pitchMin: -1.40, pitchMax: 1.40,
};
