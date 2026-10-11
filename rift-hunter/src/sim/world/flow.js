// OWNER: P4 — 계약 §6.6 · §3.10(FlowField)
// STUB — W1 에서 P4 가 채운다(플레이어 중심 BFS · 갱신 조건 · 방향). W0: 모양만 · updateFlow false · flowDir null · flowDist Infinity
// flowDir · flowDist 는 (flow, map, x, z) 인자 넷이 정본이다.

/** @typedef {import('../../types.js').MapData} MapData */
/** @typedef {import('../../types.js').FlowField} FlowField */
/** @typedef {import('../../types.js').Vec2} Vec2 */

/** 0xffff 로 채운 흐름장 @param {MapData} map @returns {FlowField} */
export function createFlow(map) {
  const n = (map?.nw ?? 0) * (map?.nh ?? 0);
  return { dist: new Uint16Array(n).fill(0xffff), cx: -1, cz: -1, builtAt: -1 };
}

/** STUB — 갱신(BFS) 했으면 true @param {FlowField} flow @param {MapData} map @param {Vec2} pos @param {number} tick @param {boolean} [force] */
export function updateFlow(flow, map, pos, tick, force = false) {
  return false;
}

/** STUB — 단위 방향|null @param {FlowField} flow @param {MapData} map @param {number} x @param {number} z @returns {Vec2|null} */
export function flowDir(flow, map, x, z) {
  return null;
}

/** STUB — 걸음 수|Infinity @param {FlowField} flow @param {MapData} map @param {number} x @param {number} z */
export function flowDist(flow, map, x, z) {
  return Infinity;
}
