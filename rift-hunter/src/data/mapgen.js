// OWNER: P4 — 계약 §7.12 · §8.7 (시드 — P0 이 W0 에 계약 값으로 채웠다)
// 균열 생성 · 경로 · 흐름장 수치. 타일 단위(1타일 = 2m)는 이름 끝 Tiles · 거리 m.

export const MAPGEN = {
  rooms: [10, 14], roomTiles: [8, 13], bigRoomChance: 0.25, bigRoomTiles: [13, 16], corridorLen: [3, 8], corridorWidth: [2, 3],
  gridMax: 96, margin: 2, loops: [0, 2], attempts: 40, propsPerRoom: [2, 6], pillarRoomMin: 11,
  normalPerArea: 90, normalPerRoom: [2, 5], corridorSlotMinLen: 6, slotSpacing: 6, spawnClear: 18, eliteMinDepth: 2, startRoomTiles: [8, 9],
};
export const PATHING = { maxNodes: 6000 };
export const FLOW = { everySec: 0.2, recenterCells: 2, maxSteps: 100 };
