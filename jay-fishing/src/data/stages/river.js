// OWNER: P12 — 계약 §7.4.4
// SEED — P0 이 W0 에 계약 값 그대로 넣었다. 조정은 소유 패키지만 §7.0 규칙 안에서(🔒 값은 밸런스 게이트만).

export const RIVER = {
  id: 'river', kind: 'outdoor', unlockLevel: 10,                                          // 🔒 unlockLevel
  spawn: { x: 0, z: 20, yaw: 0 },
  walk: [{ x: -50, z: 1.4 }, { x: 50, z: 1.4 }, { x: 50, z: 32 }, { x: -50, z: 32 }],
  shore: [{ x: -150, z: 2 }, { x: -60, z: 0.5 }, { x: 0, z: 0 }, { x: 60, z: -0.5 }, { x: 150, z: 1 }],
  points: [
    { kind: 'npc',  id: 'vendor', x: 16,  z: 8,  yaw: 0.4,  radius: 2.0, approach: { x: 16, z: 6.6 } },    // 도크
    { kind: 'camp', id: 'camp',   x: -16, z: 14, yaw: -0.3, radius: 1.8, approach: { x: -16, z: 12.6 } },
  ],
  obstacles: [{ x: 16, z: 9.6, r: 1.6 }, { x: -16, z: 14.6, r: 1.4 }],          // 도크 판매 오두막 · 캠프
  spots: [
    { id: 'river_tailrace', stand: { x: -40, z: 1.6 }, facing: 0.15, arc: 0.55, edgeM: 1.3, depth: [[0, 2], [15, 8], [40, 13], [70, 15]],
      minCastM: 6, maxDriftM: 120, farFromM: 50, flow: { x: 1.3, z: 0.2 }, snag: { fromM: 60, rate: 0.08 }, abrasion: 0.6, bottom: 'rock',
      pool: [{ id: 'chinookSalmon', w: 0.9, farMul: 2 }, { id: 'steelhead', w: 0.8, farMul: 2 }, { id: 'americanShad', w: 0.9 }, { id: 'walleye', w: 0.4 },
             { id: 'whiteSturgeon', w: 0.3 }, { id: 'smallmouthBass', w: 0.4 }, { id: 'pikeminnow', w: 0.4 }, { id: 'paleKing', w: 1 }] },
    { id: 'river_trench', stand: { x: 0, z: 1.6 }, facing: 0, arc: 0.6, edgeM: 1.6, depth: [[0, 1], [10, 6], [30, 14], [60, 20]],
      minCastM: 6, maxDriftM: 120, farFromM: null, flow: { x: 0.7, z: 0 }, snag: { fromM: 65, rate: 0.06 }, abrasion: 0.4, bottom: 'gravel',
      pool: [{ id: 'whiteSturgeon', w: 0.8 }, { id: 'channelCatfish', w: 0.8 }, { id: 'walleye', w: 0.7 }, { id: 'burbot', w: 0.5 },
             { id: 'largescaleSucker', w: 0.5 }, { id: 'chinookSalmon', w: 0.4 }, { id: 'pikeminnow', w: 0.4 }, { id: 'paleKing', w: 1 }] },
    { id: 'river_riffle', stand: { x: 40, z: 1.6 }, facing: -0.1, arc: 0.6, edgeM: 2.0, depth: [[0, 0.3], [10, 1.0], [30, 2.2], [60, 3.0]],
      minCastM: 6, maxDriftM: 120, farFromM: null, flow: { x: 1.0, z: 0 }, snag: { fromM: 55, rate: 0.06 }, abrasion: 0.3, bottom: 'gravel',
      pool: [{ id: 'smallmouthBass', w: 1.0 }, { id: 'pikeminnow', w: 1.0 }, { id: 'cutthroatTrout', w: 0.7 }, { id: 'largescaleSucker', w: 0.7 },
             { id: 'americanShad', w: 0.6 }, { id: 'steelhead', w: 0.5 }, { id: 'walleye', w: 0.3 }] },
  ],
  ambience: 'river', waves: { amp: 0.06, period: 2.5 },
  weatherWeights: { clear: 0.45, cloudy: 0.35, rain: 0.2 },
  look: {
    terrain: { ground: '#6a6a50', shore: '#8a8470', seabed: '#4a4a3c', hillAmp: 4, hillScale: 50, noiseSeed: 37 },
    ridge: { height: 520, dist: 900, color: '#3a4a3a', farBankZ: -260 },              // 컬럼비아 협곡 절벽 · 강폭 약 260m
    water: { shallow: '#4a7a6a', deep: '#1a3a44', opacity: 0.88, flowDir: { x: 1, z: 0 } },
    sky: { zenith: '#5a8ccc', horizon: '#d0dce4' }, fog: { color: '#bcc8cc', density: 0.004 },
    vendor: 'dock', dam: { x: -900, z: -120, width: 700, height: 60 },
  },
};
