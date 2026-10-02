// OWNER: P6 — 계약 §9.4 (시드: P0이 계약 값으로 완성 · 이후 조정은 P6만)
// 계약에 적힌 필드는 값 그대로다. 그 아래 「P6 추가」 필드는 CameraRig 내부 감쇠 · 연출용이다(다른 패키지는 읽지 않는다).

export const CAMERA = {
  fov: 60, near: 0.1, far: 200,
  pivotY: 1.5, lookAtY: 0.2,              // 피벗 = 플레이어 발밑 + pivotY, 바라보는 점 = 피벗 + lookAtY (m)
  rotSpeed: 0.0022,                       // rad/픽셀 (× settings.mouseSensitivity)
  pitchMin: -0.45, pitchMax: 1.2, pitchDefault: 0.30,
  distTown: 4.4, distBoss: 5.0, distMin: 1.2,
  lock: { yawLambda: 8,                   // 록온 yaw 추종(damp λ)
          pitchMin: 0.15, pitchMax: 0.80, pitchEnter: 0.34, pitchLambda: 6,
          distFrom: 6, distPerMeter: 0.12, distExtraMax: 1.6,     // 보스가 멀수록 물러난다
          bossRadiusRef: 0.8, bossRadiusMul: 1.5,                 // 큰 보스일수록 물러난다
          aimBlend: 0.3,                                          // 조준점 = 플레이어 → 보스의 30% 지점
          // ── P6 추가 ──
          yawMaxSpeed: 5.2,               // rad/s. 순간이동 · 등 뒤로 넘어간 보스를 따라갈 때의 회전 상한(멀미 방지)
          nearDist: 2.6, nearMin: 0.3,    // 보스와 이 거리(m) 안이면 추종 λ를 d/nearDist(최소 nearMin)배로 낮춘다 — 밀착 시 급회전 억제
          minDist: 0.35,                  // 이보다 가까우면 목표 yaw를 갱신하지 않는다(각이 불안정)
          aimLambda: 6, aimMax: 4.0,      // 조준점 이동 감쇠 · 플레이어에서 벗어나는 최대 거리(m)
          aimHeight: 0.5 },               // 보스 표현 높이(y)를 조준점 높이에 섞는 비율(aimBlend에 곱한다)
  collide: { wallPad: 0.4, hitPad: 0.3, minY: 0.4, liftPerMeter: 0.14, liftMax: 0.5,
             growLambda: 6,               // P6 추가: 줄었던 거리가 다시 늘어날 때의 damp λ(계약 본문의 6)
             // ── W5 추가(§9.4-3) ──
             shrinkSpeed: 25,             // 충돌로 거리가 줄어드는 속도 상한(m/s). 기둥 · 상자 모서리가 선을 스치면 목표가 한 프레임에 3~4m 꺾인다 — 25m/s면 3.8m를 0.15초에 당긴다
             boxLiftSpeed: 8 },           // 담 때문에 더 올려다보는 각이 커지는 속도 상한(rad/s) — 모서리를 스칠 때 시점이 한 프레임에 꺾이지 않게
  // ── P6 추가 ──
  distLambda: 4,                          // 원하는 거리(마을/보스전/록온 가산)가 바뀔 때의 damp λ
  shake: { maxAmp: 0.5, freqA: 27, freqB: 41, roll: 0.035 },      // 진폭 상한(m) · 두 사인의 주파수(Hz) · 롤(rad/m)
  fx: { zoomLambda: 5,
        executeZoom: 0.74, executeDur: 1.1,                        // 처형: 거리 배율 · 유지 시간(초)
        phaseZoom: 0.86, phaseAimBlend: 0.5, phaseDur: 1.6,        // 2페이즈 포효: 보스 쪽으로 살짝 당김
        deathPull: 1.6, deathRate: 0.55, deathLift: 0.18, deathLambda: 1.5 },   // 사망: 최대 후퇴(m) · 속도(m/s) · 올려다보는 양(rad) · 그 damp λ
};
