// OWNER: P4 — 계약 §6.6 · §3.10(FlowField)
// 몬스터 떼의 흐름장 — 플레이어 칸에서 거꾸로 퍼지는 거리장(8방향 · 모서리 자르기 금지 · 최대 FLOW.maxSteps 걸음).
// 정수 가중 다익스트라(버킷 큐 — 곧은 칸 FLOW.orthCost · 대각 FLOW.diagCost · 막힌 칸에 닿는 칸 + FLOW.wallCost)라
// 떼가 45° 지그재그로 오지 않고 벽 · 모서리에 붙어 걷지 않는다. dist 는 걸음 수 × orthCost(정수) — 걸음 수는 flowDist 가 돌려준다.
// 다시 계산은 updateFlow 의 조건(플레이어 칸이 recenterCells 넘게 바뀜 · everySec 지남 · force · 처음)일 때만.
// flowDir · flowDist 는 (flow, map, x, z) 인자 넷이 정본이다.

import { NAV_CELL } from '../../core/constants.js';
import { ticks } from '../../core/time.js';
import { FLOW } from '../../data/mapgen.js';
import { nearestWalkable } from './nav.js';

/** @typedef {import('../../types.js').MapData} MapData */
/** @typedef {import('../../types.js').FlowField} FlowField */
/** @typedef {import('../../types.js').Vec2} Vec2 */

const UNREACHED = 0xffff;
const D = Math.SQRT1_2;
/** 이웃 8칸 — 칸 인덱스가 작은 순(v−1 줄 → v 줄 → v+1 줄) · [du, dv, 단위 x, 단위 z] */
const NB8 = [[-1, -1, -D, -D], [0, -1, 0, -1], [1, -1, D, -D], [-1, 0, -1, 0], [1, 0, 1, 0], [-1, 1, -D, D], [0, 1, 0, 1], [1, 1, D, D]];
const DU = Int8Array.from(NB8, e => e[0]);
const DV = Int8Array.from(NB8, e => e[1]);

/** nav 배열 → 칸마다 1 = 막힌 칸(밖 포함)에 8방향으로 닿는다 */
const NEAR_WALL = new WeakMap();
/** 버킷 큐(가중치 합 + 1 개의 원형 버킷 — 호출마다 비워 다시 쓴다) */
const BUCKETS = [];

/** @param {MapData} map @returns {Uint8Array} */
function nearWallOf(map) {
  let arr = NEAR_WALL.get(map.nav);
  if (arr) return arr;
  const { nw, nh, nav } = map;
  arr = new Uint8Array(nw * nh);
  for (let v = 0; v < nh; v++) {
    for (let u = 0; u < nw; u++) {
      const i = v * nw + u;
      if (nav[i] !== 0) continue;
      let near = 0;
      for (let k = 0; k < NB8.length && !near; k++) {
        const uu = u + NB8[k][0], vv = v + NB8[k][1];
        if (uu < 0 || vv < 0 || uu >= nw || vv >= nh || nav[vv * nw + uu] !== 0) near = 1;
      }
      arr[i] = near;
    }
  }
  NEAR_WALL.set(map.nav, arr);
  return arr;
}

/** 0xffff 로 채운 흐름장 @param {MapData} map @returns {FlowField} */
export function createFlow(map) {
  const n = (map?.nw ?? 0) * (map?.nh ?? 0);
  return { dist: new Uint16Array(n).fill(UNREACHED), cx: -1, cz: -1, builtAt: -1 };
}

/**
 * 갱신(다익스트라) 했으면 true — 플레이어 칸이 FLOW.recenterCells 넘게(체비쇼프) 바뀌었거나 ticks(FLOW.everySec) 지났거나 force · 처음이면
 * @param {FlowField} flow @param {MapData} map @param {Vec2} pos @param {number} tick @param {boolean} [force]
 */
export function updateFlow(flow, map, pos, tick, force = false) {
  if (!flow || !map || !map.nav || !pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return false;
  const u = Math.floor(pos.x / NAV_CELL), v = Math.floor(pos.z / NAV_CELL);
  const n = map.nw * map.nh;
  const due = force || flow.builtAt < 0 || flow.dist.length !== n || tick < flow.builtAt
    || tick - flow.builtAt >= ticks(FLOW.everySec)
    || Math.max(Math.abs(u - flow.cx), Math.abs(v - flow.cz)) > FLOW.recenterCells;
  if (!due) return false;
  build(flow, map, pos);
  flow.cx = u;
  flow.cz = v;
  flow.builtAt = tick;
  return true;
}

/** @param {FlowField} flow @param {MapData} map @param {Vec2} pos */
function build(flow, map, pos) {
  const { nw, nh, nav } = map;
  const n = nw * nh;
  if (flow.dist.length !== n) flow.dist = new Uint16Array(n);
  const dist = flow.dist;
  dist.fill(UNREACHED);
  // 근원 칸 — 플레이어 칸이 막혔으면(밖 · 소품) 가장 가까운 걸을 수 있는 칸
  let su = Math.floor(pos.x / NAV_CELL), sv = Math.floor(pos.z / NAV_CELL);
  if (su < 0 || sv < 0 || su >= nw || sv >= nh || nav[sv * nw + su] !== 0) {
    const p = nearestWalkable(map, pos.x, pos.z);
    if (!p) return;
    su = Math.floor(p.x / NAV_CELL); sv = Math.floor(p.z / NAV_CELL);
  }
  const near = nearWallOf(map);
  const ORTH = FLOW.orthCost, DIAG = FLOW.diagCost, WALL = FLOW.wallCost;
  const maxD = FLOW.maxSteps * ORTH;
  const B = DIAG + WALL + 1;
  while (BUCKETS.length < B) BUCKETS.push([]);
  for (let b = 0; b < BUCKETS.length; b++) BUCKETS[b].length = 0;
  const src = sv * nw + su;
  dist[src] = 0;
  BUCKETS[0].push(src);
  let pending = 1;
  for (let cur = 0; pending > 0 && cur <= maxD; cur++) {
    const bucket = BUCKETS[cur % B];
    for (let k = 0; k < bucket.length; k++) {
      const i = bucket[k];
      pending--;
      if (dist[i] !== cur) continue;   // 더 짧게 다시 들어간 칸의 옛 자리
      const u = i % nw, v = (i - u) / nw;
      for (let e = 0; e < NB8.length; e++) {
        const du = DU[e], dv = DV[e];
        const uu = u + du, vv = v + dv;
        if (uu < 0 || vv < 0 || uu >= nw || vv >= nh) continue;
        const j = i + dv * nw + du;
        if (nav[j] !== 0) continue;
        const diag = du !== 0 && dv !== 0;
        if (diag && (nav[i + du] !== 0 || nav[i + dv * nw] !== 0)) continue;   // 모서리 자르기 금지
        const nd = cur + (diag ? DIAG : ORTH) + (near[j] ? WALL : 0);
        if (nd > maxD || nd >= dist[j]) continue;
        dist[j] = nd;
        BUCKETS[nd % B].push(j);
        pending++;
      }
    }
    bucket.length = 0;
  }
  for (let b = 0; b < BUCKETS.length; b++) BUCKETS[b].length = 0;
}

/**
 * 단위 방향|null — 이웃 8칸 중 dist 가 가장 작은 칸 쪽(같으면 인덱스 작은 쪽 · 모서리 자르기 금지 · 지금 칸보다 작아야 한다) · 닿지 않으면 null
 * @param {FlowField} flow @param {MapData} map @param {number} x @param {number} z @returns {Vec2|null}
 */
export function flowDir(flow, map, x, z) {
  if (!flow || !map || !map.nav) return null;
  const { nw, nh, nav } = map;
  const dist = flow.dist;
  if (dist.length !== nw * nh) return null;
  const u = Math.floor(x / NAV_CELL), v = Math.floor(z / NAV_CELL);
  if (u < 0 || v < 0 || u >= nw || v >= nh) return null;
  let best = dist[v * nw + u];
  let bk = -1;
  for (let k = 0; k < NB8.length; k++) {
    const du = NB8[k][0], dv = NB8[k][1];
    const uu = u + du, vv = v + dv;
    if (uu < 0 || vv < 0 || uu >= nw || vv >= nh) continue;
    const j = vv * nw + uu;
    if (nav[j] !== 0) continue;
    if (du !== 0 && dv !== 0 && (nav[v * nw + uu] !== 0 || nav[vv * nw + u] !== 0)) continue;
    const d = dist[j];
    if (d < best) { best = d; bk = k; }
  }
  if (bk < 0 || best === UNREACHED) return null;
  return { x: NB8[bk][2], z: NB8[bk][3] };
}

/** 걸음 수(곧은 칸 = 1 · 대각 ≈ 1.4 · 벽 옆 가중 포함)|Infinity @param {FlowField} flow @param {MapData} map @param {number} x @param {number} z */
export function flowDist(flow, map, x, z) {
  if (!flow || !map || !map.nav) return Infinity;
  const { nw, nh } = map;
  if (flow.dist.length !== nw * nh) return Infinity;
  const u = Math.floor(x / NAV_CELL), v = Math.floor(z / NAV_CELL);
  if (u < 0 || v < 0 || u >= nw || v >= nh) return Infinity;
  const d = flow.dist[v * nw + u];
  return d === UNREACHED ? Infinity : d / FLOW.orthCost;
}
