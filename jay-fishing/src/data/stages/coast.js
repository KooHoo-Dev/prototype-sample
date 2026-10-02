// OWNER: P11 — 계약 §7.4.3
// SEED — P0 이 W0 에 계약 값 그대로 넣었다. 조정은 소유 패키지만 §7.0 규칙 안에서(🔒 값은 밸런스 게이트만).

export const COAST = {
  id: 'coast', kind: 'outdoor', unlockLevel: 5,                                           // 🔒 unlockLevel
  spawn: { x: 0, z: 20, yaw: 0 },
  walk: [{ x: -45, z: 1.6 }, { x: 45, z: 1.6 }, { x: 45, z: 30 }, { x: -45, z: 30 }],
  shore: [{ x: -120, z: 4 }, { x: -40, z: 0.4 }, { x: -20, z: -0.5 }, { x: 0, z: 0.6 }, { x: 25, z: -0.4 }, { x: 40, z: 0.8 }, { x: 120, z: 5 }],
  points: [
    { kind: 'npc',  id: 'vendor', x: 12,  z: 11, yaw: 0.5,  radius: 2.0, approach: { x: 12, z: 9.4 } },    // 어판장 트럭
    { kind: 'camp', id: 'camp',   x: -13, z: 13, yaw: -0.3, radius: 1.8, approach: { x: -13, z: 11.6 } },
  ],
  obstacles: [{ x: 12, z: 12.8, r: 2.0 }, { x: -13, z: 13.6, r: 1.4 }],         // 어판장 트럭 · 캠프
  spots: [
    { id: 'coast_shoal', stand: { x: -26, z: 2.0 }, facing: 0.2, arc: 0.6, edgeM: 2.3, depth: [[0, 1.0], [10, 3.0], [25, 6.0], [45, 9.0]],
      minCastM: 6, maxDriftM: 80, farFromM: null, flow: { x: 0.3, z: 0 }, snag: { fromM: 30, rate: 0.10 }, abrasion: 1.0, bottom: 'rock',
      pool: [{ id: 'opaleye', w: 1.0 }, { id: 'rabbitfish', w: 0.8 }, { id: 'blackSeabream', w: 0.6 }, { id: 'rockfish', w: 0.6 },
             { id: 'scorpionfish', w: 0.5 }, { id: 'threelineGrunt', w: 0.5 }, { id: 'barredKnifejaw', w: 0.3 }, { id: 'morayEel', w: 0.3 },
             { id: 'pinkShark', w: 1 }] },
    { id: 'coast_channel', stand: { x: 4, z: 2.2 }, facing: 0, arc: 0.6, edgeM: 1.8, depth: [[0, 2], [10, 7], [30, 13], [60, 17]],
      minCastM: 6, maxDriftM: 100, farFromM: 40, flow: { x: 0.7, z: -0.1 }, snag: { fromM: 45, rate: 0.08 }, abrasion: 0.6, bottom: 'rock',
      pool: [{ id: 'redSeabream', w: 0.8, farMul: 2 }, { id: 'opaleye', w: 0.6 }, { id: 'blackSeabream', w: 0.6 }, { id: 'threelineGrunt', w: 0.6 },
             { id: 'amberjack', w: 0.4, farMul: 2 }, { id: 'rockfish', w: 0.4 }, { id: 'scorpionfish', w: 0.3 }, { id: 'rabbitfish', w: 0.3 },
             { id: 'zombieShark', w: 1 }, { id: 'pinkShark', w: 1 }] },
    { id: 'coast_cape', stand: { x: 34, z: 2.4 }, facing: -0.35, arc: 0.6, edgeM: 2.2, depth: [[0, 4], [10, 11], [30, 20], [60, 28]],
      minCastM: 6, maxDriftM: 90, farFromM: null, flow: { x: 0.4, z: 0 }, snag: { fromM: 40, rate: 0.10 }, abrasion: 1.0, bottom: 'rock',
      pool: [{ id: 'barredKnifejaw', w: 0.7 }, { id: 'amberjack', w: 0.6 }, { id: 'redSeabream', w: 0.6 }, { id: 'morayEel', w: 0.5 },
             { id: 'scorpionfish', w: 0.4 }, { id: 'blackSeabream', w: 0.4 }, { id: 'rockfish', w: 0.3 }, { id: 'zombieShark', w: 1 }] },
  ],
  ambience: 'waves', waves: { amp: 0.18, period: 6.0 },
  weatherWeights: { clear: 0.45, cloudy: 0.3, rain: 0.25 },
  look: {
    terrain: { ground: '#3a3634', shore: '#2c2a28', seabed: '#3a4a48', hillAmp: 9, hillScale: 35, noiseSeed: 23, rocky: true },
    ridge: { height: 300, dist: 1100, color: '#3e4e3a', farBankZ: null },             // 이즈의 녹색 구릉 · 바다는 수평선까지
    water: { shallow: '#2f8a8a', deep: '#0d3550', opacity: 0.9, foam: true },
    sky: { zenith: '#4f8ad8', horizon: '#d2e2ee' }, fog: { color: '#c4d4dc', density: 0.0035 },
    vendor: 'truck', lighthouse: { x: 120, z: -40 },
  },
};
