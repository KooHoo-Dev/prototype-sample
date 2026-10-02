// OWNER: P3 — 계약 §7.4.2
// SEED — P0 이 W0 에 계약 값 그대로 넣었다. 조정은 소유 패키지만 §7.0 규칙 안에서(🔒 값은 밸런스 게이트만).

export const LAKE = {
  id: 'lake', kind: 'outdoor', unlockLevel: 1,                                            // 🔒 unlockLevel
  spawn: { x: 0, z: 22, yaw: 0 },
  walk: [{ x: -50, z: 1.4 }, { x: 50, z: 1.4 }, { x: 50, z: 36 }, { x: -50, z: 36 }],
  shore: [{ x: -120, z: 6 }, { x: -60, z: 0.6 }, { x: -30, z: -0.4 }, { x: 0, z: 0 }, { x: 30, z: -0.8 }, { x: 60, z: 0.4 }, { x: 120, z: 6 }],
  points: [
    { kind: 'npc',  id: 'vendor', x: 14,  z: 9,  yaw: 0.6,  radius: 1.8, approach: { x: 14, z: 7.6 } },    // 좌판
    { kind: 'camp', id: 'camp',   x: -15, z: 12, yaw: -0.4, radius: 1.8, approach: { x: -15, z: 10.6 } },
  ],
  obstacles: [{ x: 14, z: 10, r: 1.2 }, { x: -15, z: 12.6, r: 1.4 }],           // 좌판 · 캠프(텐트 + 모닥불)
  spots: [
    { id: 'lake_shallows', stand: { x: -32, z: 1.6 }, facing: 0.25, arc: 0.6, edgeM: 2.0, depth: [[0, 0.2], [10, 1.2], [25, 2.2], [45, 3.0]],
      minCastM: 6, maxDriftM: 60, farFromM: null, flow: { x: 0, z: 0 }, snag: { fromM: 26, rate: 0.08 }, abrasion: 0.3, bottom: 'mud',
      pool: [{ id: 'crucian', w: 1.0 }, { id: 'bluegill', w: 1.0 }, { id: 'snakehead', w: 0.6 }, { id: 'largemouthBass', w: 0.6 },
             { id: 'catfish', w: 0.4 }, { id: 'bullhead', w: 0.5 }, { id: 'carp', w: 0.3 }, { id: 'skygager', w: 0.3 }] },
    { id: 'lake_gravel', stand: { x: 0, z: 1.6 }, facing: 0, arc: 0.6, edgeM: 1.6, depth: [[0, 0.3], [10, 2.0], [25, 4.5], [45, 7.0]],
      minCastM: 6, maxDriftM: 60, farFromM: null, flow: { x: 0.05, z: 0 }, snag: { fromM: 31, rate: 0.12 }, abrasion: 0, bottom: 'gravel',
      pool: [{ id: 'crucian', w: 1.0 }, { id: 'carp', w: 0.6 }, { id: 'israeliCarp', w: 0.6 }, { id: 'steedBarbel', w: 0.8 },
             { id: 'largemouthBass', w: 0.4 }, { id: 'bluegill', w: 0.5 }, { id: 'catfish', w: 0.4 }, { id: 'bullhead', w: 0.4 },
             { id: 'skygager', w: 0.4 }, { id: 'goldenDragon', w: 1 }] },
    { id: 'lake_cape', stand: { x: 36, z: 1.6 }, facing: -0.3, arc: 0.6, edgeM: 2.2, depth: [[0, 1.0], [8, 5.0], [20, 10.0], [45, 16.0]],
      minCastM: 6, maxDriftM: 60, farFromM: 30, flow: { x: 0, z: 0 }, snag: { fromM: 34, rate: 0.08 }, abrasion: 0.5, bottom: 'rock',
      pool: [{ id: 'mandarinFish', w: 0.8, farMul: 2 }, { id: 'skygager', w: 0.6, farMul: 2 }, { id: 'largemouthBass', w: 0.5 }, { id: 'carp', w: 0.5 },
             { id: 'catfish', w: 0.4 }, { id: 'steedBarbel', w: 0.4 }, { id: 'crucian', w: 0.3 }, { id: 'israeliCarp', w: 0.3 },
             { id: 'goldenDragon', w: 1 }] },
  ],
  ambience: 'lake', waves: { amp: 0.03, period: 3.5 },
  weatherWeights: { clear: 0.5, cloudy: 0.3, rain: 0.2 },
  look: {
    terrain: { ground: '#5b6b3a', shore: '#8a7d62', seabed: '#4a4a36', hillAmp: 6, hillScale: 60, noiseSeed: 11 },
    ridge: { height: 380, dist: 1400, color: '#4c5e48', farBankZ: -900 },          // 호수 건너편 산 · 맞은편 기슭
    water: { shallow: '#4e7f78', deep: '#1d4652', opacity: 0.86 },
    sky: { zenith: '#5e8fd0', horizon: '#c9dbe8' }, fog: { color: '#b8c8d0', density: 0.0045 },
    vendor: 'stall', reeds: true,
  },
};
