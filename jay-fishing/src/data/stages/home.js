// OWNER: P3 — 계약 §7.4.1
// SEED — P0 이 W0 에 계약 값 그대로 넣었다. 조정은 소유 패키지만 §7.0 규칙 안에서(🔒 값은 밸런스 게이트만).

export const HOME = {
  id: 'home', kind: 'interior', unlockLevel: 1,
  spawn: { x: 0, z: 1.2, yaw: 0 },
  walk: [{ x: -3.1, z: -2.6 }, { x: 3.1, z: -2.6 }, { x: 3.1, z: 2.6 }, { x: -3.1, z: 2.6 }],
  shore: [],
  points: [
    { kind: 'pc',   id: 'pc',   x: -2.2, z: -2.3, yaw: 0,            radius: 1.3, approach: { x: -2.2, z: -1.4 } },   // 책상 + PC — 북쪽(−Z) 벽
    { kind: 'bed',  id: 'bed',  x: 2.3,  z: 1.6,  yaw: -Math.PI / 2,  radius: 1.3, approach: { x: 1.4, z: 1.0 } },
    { kind: 'door', id: 'door', x: 0,    z: 2.6,  yaw: Math.PI,       radius: 1.2, approach: { x: 0, z: 1.6 } },     // 남쪽(+Z) 벽의 문
  ],
  obstacles: [{ x: -2.2, z: -2.55, r: 0.55 }, { x: 2.3, z: 1.7, r: 0.85 }],     // 책상 · 침대
  spots: [], ambience: 'indoor', waves: { amp: 0, period: 1 },
  weatherWeights: { clear: 1, cloudy: 0, rain: 0 },     // 쓰지 않는다(집의 current 는 lake 의 날씨)
  look: { room: { w: 7.0, d: 6.0, h: 2.6 }, wall: '#d9cfbf', floor: '#8a6a48', ceiling: '#efe9df', window: { wall: '+x', z: -0.6, w: 1.6, h: 1.1 } },
};
