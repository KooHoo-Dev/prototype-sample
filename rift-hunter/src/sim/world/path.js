// OWNER: P4 — 계약 §6.6
// 클릭 이동 경로 — 8방향 A*(모서리 자르기 금지 · 몸 반지름 r 여유는 isWalkableR) → 줄 당기기(losClear + isWalkableR 표본).
// 막힌 곳을 누르면 nearestWalkable(to)로(곧장 가다 멈추는 이쪽 점이 거의 같은 거리면 그 점) · 그 점이 몸에 맞지 않으면 가까운 맞는 점으로 ·
// 닿지 않으면 탐색한 칸 중 to 에 가장 가까운 칸까지.
// 시작 칸 둘레 PATHING.escapeCells 칸은 몸 여유 없이도 지나간다(벽에 붙어 선 자리에서 빠져나오기). 결과는 시작점 제외 · 마지막 = 목적지.
// 맵은 상태가 아니고 바뀌지 않는다 — 칸별 몸 여유는 맵의 nav 배열마다 캐시한다(WeakMap · 결과에 영향 없음).

import { NAV_CELL } from '../../core/constants.js';
import { PATHING } from '../../data/mapgen.js';
import { isWalkable, isWalkableR, losClear, nearestWalkable, raycastWalk } from './nav.js';

/** @typedef {import('../../types.js').MapData} MapData */
/** @typedef {import('../../types.js').Vec2} Vec2 */

const SQRT2 = Math.SQRT2;
const OCT = SQRT2 - 1;
/** 8방향 (du, dv, 비용) */
const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [-1, 1, SQRT2], [1, -1, SQRT2], [-1, -1, SQRT2]];

/** nav 배열 → (r 열쇠 → 칸별 몸 여유 0 모름 · 1 들어감 · 2 안 들어감) */
const CLEAR_CACHE = new WeakMap();

/** A* 작업 배열(호출마다 세대 번호로 비운다 — 할당 없음) */
let SCR = null;
/** 이진 힙(칸 인덱스 · f) */
const heapI = [];
const heapF = [];

/** @param {number} n */
function scratch(n) {
  if (!SCR || SCR.n < n) {
    SCR = { n, g: new Float64Array(n), parent: new Int32Array(n), seen: new Uint32Array(n), closed: new Uint32Array(n), gen: 0 };
  }
  SCR.gen++;
  if (SCR.gen >= 0xffffffff) { SCR.seen.fill(0); SCR.closed.fill(0); SCR.gen = 1; }
  return SCR;
}

function heapPush(i, f) {
  let k = heapI.length;
  heapI.push(i); heapF.push(f);
  while (k > 0) {
    const p = (k - 1) >> 1;
    if (heapF[p] <= f) break;
    heapI[k] = heapI[p]; heapF[k] = heapF[p];
    k = p;
  }
  heapI[k] = i; heapF[k] = f;
}

function heapPop() {
  const top = heapI[0];
  const li = heapI.pop(), lf = heapF.pop();
  const n = heapI.length;
  if (n > 0) {
    let k = 0;
    for (;;) {
      const a = k * 2 + 1;
      if (a >= n) break;
      const b = a + 1;
      const c = b < n && heapF[b] < heapF[a] ? b : a;
      if (heapF[c] >= lf) break;
      heapI[k] = heapI[c]; heapF[k] = heapF[c];
      k = c;
    }
    heapI[k] = li; heapF[k] = lf;
  }
  return top;
}

/** 칸별 몸 여유 캐시 @param {MapData} map @param {number} r @returns {Uint8Array} */
function clearArr(map, r) {
  let byR = CLEAR_CACHE.get(map.nav);
  if (!byR) { byR = new Map(); CLEAR_CACHE.set(map.nav, byR); }
  let arr = byR.get(r);
  if (!arr) { arr = new Uint8Array(map.nw * map.nh); byR.set(r, arr); }
  return arr;
}

/** 칸 i 의 가운데에 반지름 r 원이 들어간다(캐시) @param {MapData} map @param {Uint8Array} arr @param {number} i @param {number} r */
function cellClear(map, arr, i, r) {
  const c = arr[i];
  if (c !== 0) return c === 1;
  const u = i % map.nw, v = (i - u) / map.nw;
  const ok = map.nav[i] === 0 && isWalkableR(map, (u + 0.5) * NAV_CELL, (v + 0.5) * NAV_CELL, r);
  arr[i] = ok ? 1 : 2;
  return ok;
}

/**
 * 선분 a–b 를 반지름 r 이 지나간다 — 벽 · 막는 소품 시야(losClear props) + PATHING.sampleStep 간격 isWalkableR 표본.
 * a 자체가 몸에 맞지 않으면(벽에 붙어 선 자리) a 둘레 escape 거리 안의 표본은 걸을 수 있는지만 본다.
 * @param {MapData} map @param {Vec2} a @param {Vec2} b @param {number} r
 */
function segClear(map, a, b, r) {
  if (!losClear(map, a.x, a.z, b.x, b.z, { props: true })) return false;
  if (!(r > 0)) return true;
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (!(len > 0)) return true;
  const esc = isWalkableR(map, a.x, a.z, r) ? 0 : (PATHING.escapeCells + 0.5) * NAV_CELL;
  const n = Math.max(1, Math.ceil(len / PATHING.sampleStep));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = a.x + dx * t, z = a.z + dz * t;
    if (t * len <= esc) { if (!isWalkable(map, x, z)) return false; continue; }
    if (!isWalkableR(map, x, z, r)) return false;
  }
  return true;
}

/**
 * 몸 반지름 r 이 들어가는 점 — p 가 맞으면 그대로, 아니면 PATHING.fitR 안의 맞는 칸 가운데 중 가장 가까운 것에서 p 쪽으로 이분해 다가간 점 · 없으면 p
 * @param {MapData} map @param {Vec2} p @param {number} r @returns {Vec2}
 */
function fitPoint(map, p, r) {
  if (!(r > 0) || isWalkableR(map, p.x, p.z, r)) return p;
  const arr = clearArr(map, r);
  const cu = Math.floor(p.x / NAV_CELL), cv = Math.floor(p.z / NAV_CELL);
  const K = Math.ceil(PATHING.fitR / NAV_CELL);
  let best = -1, bestD2 = PATHING.fitR * PATHING.fitR;
  for (let v = cv - K; v <= cv + K; v++) {
    if (v < 0 || v >= map.nh) continue;
    for (let u = cu - K; u <= cu + K; u++) {
      if (u < 0 || u >= map.nw) continue;
      const i = v * map.nw + u;
      if (!cellClear(map, arr, i, r)) continue;
      const x = (u + 0.5) * NAV_CELL, z = (v + 0.5) * NAV_CELL;
      const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = i; }
    }
  }
  if (best < 0) return p;
  const u = best % map.nw, v = (best - u) / map.nw;
  const cx = (u + 0.5) * NAV_CELL, cz = (v + 0.5) * NAV_CELL;
  let lo = 0, hi = 1;
  for (let k = 0; k < PATHING.refineIters; k++) {
    const mid = (lo + hi) / 2;
    if (isWalkableR(map, cx + (p.x - cx) * mid, cz + (p.z - cz) * mid, r)) lo = mid; else hi = mid;
  }
  return { x: cx + (p.x - cx) * lo, z: cz + (p.z - cz) * lo };
}

/**
 * a 에서 b 쪽으로 칸 크기 간격으로 가며 처음 만나는 걸을 수 있는 점(그 자리의 nearestWalkable) · 없으면 null
 * @param {MapData} map @param {Vec2} a @param {Vec2} b @returns {Vec2|null}
 */
function firstFloorToward(map, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const n = Math.ceil(len / NAV_CELL);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = a.x + dx * t, z = a.z + dz * t;
    if (isWalkable(map, x, z)) return nearestWalkable(map, x, z) ?? { x, z };
  }
  return null;
}

/**
 * 경유점(시작점 제외 · 마지막 = 목적지). to 가 막혔으면 nearestWalkable(to)로 · 닿지 않으면 탐색한 칸 중 to 에 가장 가까운 칸까지.
 * 8방향 A*(모서리 자르기 금지 · r 여유는 isWalkableR) → 줄 당기기(losClear + isWalkableR 표본) · 시작과 목적지가 시야 안이면 [to].
 * 더 가까이 갈 곳이 없으면 [].
 * @param {MapData} map @param {Vec2} from @param {Vec2} to @param {{r?:number, maxNodes?:number}} [opts] @returns {Vec2[]}
 */
export function findPath(map, from, to, { r = 0.4, maxNodes = PATHING.maxNodes } = {}) {
  if (!map || !map.nav || !from || !to) return [];
  if (!Number.isFinite(from.x) || !Number.isFinite(from.z) || !Number.isFinite(to.x) || !Number.isFinite(to.z)) return [];
  const rr = r > 0 ? r : 0;
  const { nw, nh, nav } = map;
  // 1) 목적지 — 막혔으면 nearestWalkable(to). 단 from 에서 to 로 곧장 가다 멈추는 점이 그만큼 가까우면(PATHING.nearSideSlack 안) 그 점
  //    (벽 한가운데를 누르면 벽 건너편으로 돌아가지 않고 이쪽 벽 앞에 선다) · 그 반경에도 바닥이 없으면(벽 너머 빈 곳) to 에서 from 쪽으로 처음 만나는 바닥
  let near = null;
  if (isWalkable(map, to.x, to.z)) near = { x: to.x, z: to.z };
  else {
    near = nearestWalkable(map, to.x, to.z);
    if (rr > 0 && isWalkableR(map, from.x, from.z, rr)) {
      const ray = raycastWalk(map, from.x, from.z, to.x, to.z, rr);
      const dRay = Math.hypot(ray.x - to.x, ray.z - to.z);
      const moved = Math.hypot(ray.x - from.x, ray.z - from.z) > 0;
      if (moved && (!near || dRay <= Math.hypot(near.x - to.x, near.z - to.z) + PATHING.nearSideSlack)) near = ray;
    }
    if (!near) near = firstFloorToward(map, to, from);
  }
  const goal = near ? fitPoint(map, near, rr) : null;
  // 시작 칸
  const su = Math.floor(from.x / NAV_CELL), sv = Math.floor(from.z / NAV_CELL);
  if (su < 0 || sv < 0 || su >= nw || sv >= nh) return goal ? [goal] : [];
  const start = sv * nw + su;
  // 2) 같은 칸 · 곧장 보인다
  if (goal) {
    const gu0 = Math.floor(goal.x / NAV_CELL), gv0 = Math.floor(goal.z / NAV_CELL);
    if ((gu0 === su && gv0 === sv) || segClear(map, from, goal, rr)) return [goal];
  }
  // 3) A*
  const target = goal ?? to;
  const gu = goal ? Math.floor(goal.x / NAV_CELL) : -1, gv = goal ? Math.floor(goal.z / NAV_CELL) : -1;
  const goalIdx = goal && gu >= 0 && gv >= 0 && gu < nw && gv < nh ? gv * nw + gu : -1;
  const tu = target.x / NAV_CELL - 0.5, tv = target.z / NAV_CELL - 0.5;   // 칸 좌표(가운데 기준)
  const S = scratch(nw * nh);
  const gen = S.gen, g = S.g, parent = S.parent, seen = S.seen, closed = S.closed;
  const clear = clearArr(map, rr);
  // 몸이 시작 자리에 맞지 않을 때만(밀려 벽에 겹친 자리) 시작 둘레를 몸 여유 없이 지나간다
  const esc = rr > 0 && !isWalkableR(map, from.x, from.z, rr) ? PATHING.escapeCells : -1;
  const fitsCell = (i) => rr === 0 || cellClear(map, clear, i, rr);
  const pass = (u, v) => {
    if (u < 0 || v < 0 || u >= nw || v >= nh) return false;
    const i = v * nw + u;
    if (nav[i] !== 0) return false;
    if (fitsCell(i) || i === goalIdx) return true;
    return Math.max(Math.abs(u - su), Math.abs(v - sv)) <= esc;
  };
  const hOf = (u, v) => {
    const a = Math.abs(u - tu), b = Math.abs(v - tv);
    return a > b ? a + OCT * b : b + OCT * a;
  };
  heapI.length = 0; heapF.length = 0;
  g[start] = 0; parent[start] = -1; seen[start] = gen;
  heapPush(start, hOf(su, sv));
  let found = false, expanded = 0;
  let best = -1, bestD = Infinity;   // 탐색한 칸 중 몸이 들어가는 칸으로 to 에 가장 가까운 것
  while (heapI.length) {
    const i = heapPop();
    if (closed[i] === gen) continue;
    closed[i] = gen;
    const u = i % nw, v = (i - u) / nw;
    const du0 = u - tu, dv0 = v - tv;
    const d2 = du0 * du0 + dv0 * dv0;
    if (d2 < bestD && i !== start && fitsCell(i)) { bestD = d2; best = i; }
    if (i === goalIdx) { found = true; break; }
    if (++expanded >= maxNodes) break;
    const gi = g[i];
    for (let k = 0; k < NB.length; k++) {
      const du = NB[k][0], dv = NB[k][1];
      const uu = u + du, vv = v + dv;
      if (!pass(uu, vv)) continue;
      // 모서리 자르기 금지 — 단 시작 칸에서는 실제 시작점에서 그 칸 가운데까지 몸이 곧장 지나가면 된다(최종 게이트: 벽을 눌러 r 만큼 앞에 선 자리는
      //   몸은 맞지만 시작 칸 가운데가 맞지 않고 맞는 이웃이 대각선뿐이라 시작 칸을 떠나지 못했다 — 시야 밖 목적지가 모두 [] · 생성 맵 벽 앞 정지의 1.2%)
      if (du !== 0 && dv !== 0 && (!pass(u + du, v) || !pass(u, v + dv))
        && !(i === start && rr > 0 && segClear(map, from, { x: (uu + 0.5) * NAV_CELL, z: (vv + 0.5) * NAV_CELL }, rr))) continue;
      const j = vv * nw + uu;
      if (closed[j] === gen) continue;
      const ng = gi + NB[k][2];
      if (seen[j] === gen && ng >= g[j]) continue;
      seen[j] = gen; g[j] = ng; parent[j] = i;
      heapPush(j, ng + hOf(uu, vv));
    }
  }
  heapI.length = 0; heapF.length = 0;
  const end = found ? goalIdx : best;
  if (end < 0 || end === start) return found && goal ? [goal] : [];
  if (!found) {
    // 시작보다 가깝지 않으면 움직이지 않는다
    const du0 = su - tu, dv0 = sv - tv;
    if (du0 * du0 + dv0 * dv0 <= bestD) return [];
  }
  // 4) 칸 경로 → 점 목록 [from, 칸 가운데…, 끝]
  /** @type {number[]} */
  const cells = [];
  for (let c = end; c !== start && c >= 0; c = parent[c]) cells.push(c);
  cells.reverse();
  /** @type {Vec2[]} */
  const pts = [{ x: from.x, z: from.z }];
  for (const c of cells) {
    const u = c % nw, v = (c - u) / nw;
    pts.push({ x: (u + 0.5) * NAV_CELL, z: (v + 0.5) * NAV_CELL });
  }
  if (found && goal) pts[pts.length - 1] = { x: goal.x, z: goal.z };
  // 5) 줄 당기기 — 기준점에서 보이는 가장 먼 점까지(이웃 칸 사이는 A*가 이미 확인했다)
  /** @type {Vec2[]} */
  const out = [];
  let ai = 0;
  for (let j = 2; j < pts.length; j++) {
    if (!segClear(map, pts[ai], pts[j], rr)) { out.push(pts[j - 1]); ai = j - 1; }
  }
  out.push(pts[pts.length - 1]);
  // 시작 둘레(몸 여유 없이 지나온 칸)의 경유점은 몸이 닿지 못할 수 있다 — 마지막이 아니면 뺀다
  if (esc >= 0) {
    for (let k = out.length - 2; k >= 0; k--) if (!isWalkableR(map, out[k].x, out[k].z, rr)) out.splice(k, 1);
  }
  return out;
}
