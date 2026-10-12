// OWNER: P15 — 계약 §12.1 「탐색」 (P15 내부 파일 — 다른 패키지가 import 하지 않는다)
// 균열의 큰 길 찾기 — 타일(2m) 격자 너비 우선 탐색 하나로: 탐색하지 않은 가장 가까운 방 · 기억한 몬스터 · 탐색 경계를 고르고,
// 그 길 위 몇 타일 앞을 경유점으로 누른다(가까운 길은 sim 의 findPath 가 — P4 findPath 는 ~80m 까지만 찾는다 · NOTES-W1).
// 봇이 읽는 것: 맵의 방 · 통로 배치와 탐색한 타일(미니맵 · 큰 지도에 보이는 것) · 본 적 있는 몬스터의 자리. 몬스터 배치는 읽지 않는다.

import { TILE, TILE_FLOOR } from '../core/constants.js';
import { isWalkableR, nearestWalkable } from '../sim/world/nav.js';
import { BOT_RULES } from '../data/bot.js';

/** 바닥 타일 찾기 반경(타일) */
const FLOOR_SEARCH = BOT_RULES.floorSearchTiles;

/** @typedef {import('../types.js').MapData} MapData */

/**
 * 맵마다 하나 — 바닥 타일 · BFS 버퍼 · 방마다 바닥 타일 목록
 * @typedef {Object} TileGrid
 * @property {string} id @property {number} w @property {number} h
 * @property {Uint8Array} floor @property {Int32Array} dist @property {Int32Array} prev @property {Int32Array} queue
 * @property {number} src     마지막 BFS 의 시작 타일(-1 = 없음)
 * @property {number[][]} roomTiles
 */

/** @param {MapData} map @returns {TileGrid} */
export function makeTileGrid(map) {
  const n = map.w * map.h;
  const floor = new Uint8Array(n);
  for (let i = 0; i < n; i++) floor[i] = map.tiles[i] === TILE_FLOOR ? 1 : 0;
  /** @type {number[][]} */
  const roomTiles = [];
  for (const r of map.rooms ?? []) {
    const list = [];
    const i0 = Math.max(0, Math.floor(r.x0 / TILE)), i1 = Math.min(map.w - 1, Math.floor((r.x1 - 1e-6) / TILE));
    const j0 = Math.max(0, Math.floor(r.z0 / TILE)), j1 = Math.min(map.h - 1, Math.floor((r.z1 - 1e-6) / TILE));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (floor[j * map.w + i]) list.push(j * map.w + i);
    roomTiles.push(list);
  }
  return { id: map.id, w: map.w, h: map.h, floor, dist: new Int32Array(n), prev: new Int32Array(n), queue: new Int32Array(n), src: -1, roomTiles };
}

/** 점의 타일 인덱스(밖이면 -1) @param {TileGrid} g @param {number} x @param {number} z */
export function tileIndex(g, x, z) {
  const i = Math.floor(x / TILE), j = Math.floor(z / TILE);
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return -1;
  return j * g.w + i;
}

/** 점에서 가장 가까운 바닥 타일(반경 FLOOR_SEARCH 타일 안) @param {TileGrid} g @param {number} x @param {number} z */
export function floorTileNear(g, x, z) {
  const t = tileIndex(g, x, z);
  if (t >= 0 && g.floor[t]) return t;
  const ci = Math.floor(x / TILE), cj = Math.floor(z / TILE);
  let best = -1, bd = Infinity;
  for (let dj = -FLOOR_SEARCH; dj <= FLOOR_SEARCH; dj++) {
    for (let di = -FLOOR_SEARCH; di <= FLOOR_SEARCH; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
      const k = j * g.w + i;
      if (!g.floor[k]) continue;
      const d = di * di + dj * dj;
      if (d < bd) { bd = d; best = k; }
    }
  }
  return best;
}

/**
 * 시작 타일에서 너비 우선(8방향 · 모서리 자르기 금지) — dist(걸음 · −1 닿지 않음) · prev(앞 타일)
 * @param {TileGrid} g @param {number} src
 */
export function bfs(g, src) {
  const { w, h, floor, dist, prev, queue } = g;
  dist.fill(-1);
  g.src = src;
  if (src < 0 || !floor[src]) return;
  let qh = 0, qt = 0;
  dist[src] = 0;
  prev[src] = -1;
  queue[qt++] = src;
  while (qh < qt) {
    const c = queue[qh++];
    const ci = c % w, cj = (c - ci) / w;
    const nd = dist[c] + 1;
    for (let dj = -1; dj <= 1; dj++) {
      const j = cj + dj;
      if (j < 0 || j >= h) continue;
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const i = ci + di;
        if (i < 0 || i >= w) continue;
        const k = j * w + i;
        if (!floor[k] || dist[k] >= 0) continue;
        if (di && dj && (!floor[cj * w + i] || !floor[j * w + ci])) continue;   // 모서리 자르기 금지
        dist[k] = nd;
        prev[k] = c;
        queue[qt++] = k;
      }
    }
  }
}

/** 타일 가운데(m) @param {TileGrid} g @param {number} k */
export function tileCenter(g, k) {
  const i = k % g.w, j = (k - i) / g.w;
  return { x: (i + 0.5) * TILE, z: (j + 0.5) * TILE };
}

/**
 * 마지막 BFS 의 길(시작 → goal) 위에서 시작으로부터 steps 타일 앞의 점(걷기 가능한 점으로) · 닿지 않으면 null
 * @param {TileGrid} g @param {MapData} map @param {number} goal @param {number} steps @param {number} r 몸 반지름
 */
export function waypointToward(g, map, goal, steps, r) {
  if (goal < 0 || g.dist[goal] < 0) return null;
  let k = goal;
  const back = Math.max(1, g.dist[goal] - steps);   // 목표가 steps 안이면 목표 타일 그대로(시작 타일을 경유점으로 두지 않는다)
  while (k >= 0 && g.dist[k] > back) k = g.prev[k];
  if (k < 0) k = goal;
  const c = tileCenter(g, k);
  if (isWalkableR(map, c.x, c.z, r)) return c;
  const q = nearestWalkable(map, c.x, c.z, TILE);
  return q ? { x: q.x, z: q.z } : c;
}

/**
 * 방이 끝났는가 — 들어섰거나(봇 기억) 바닥의 roomDoneFrac 이상을 탐색했다
 * @param {TileGrid} g @param {number[]} explored @param {number} roomIdx @param {Set<number>} visited @param {number} frac
 */
export function roomDone(g, explored, roomIdx, visited, frac) {
  if (visited.has(roomIdx)) return true;
  const list = g.roomTiles[roomIdx];
  if (!list || !list.length) return true;
  let n = 0;
  for (let i = 0; i < list.length; i++) if (explored[list[i]]) n++;
  return n >= list.length * frac;
}

/**
 * 탐색 목표 고르기(마지막 BFS 가 플레이어 타일에서 돈 뒤) — 끝나지 않은 방 가운데 → 기억한 몬스터 → 탐색하지 않은 바닥 타일. 없으면 null.
 * @param {TileGrid} g @param {MapData} map @param {number[]} explored @param {{visited:Set<number>, skip:Set<string>, seen:Map<number, {x:number, z:number, rank:string}>, alive:(id:number) => boolean}} mem
 * @param {number} frac
 * @returns {{tile:number, x:number, z:number, kind:'room'|'mon'|'frontier', key:string, room:number}|null}
 */
export function pickExploreGoal(g, map, explored, mem, frac) {
  const rooms = map.rooms ?? [];
  let best = null, bd = Infinity;
  for (let ri = 0; ri < rooms.length; ri++) {
    if (roomDone(g, explored, ri, mem.visited, frac)) continue;
    const key = 'room:' + ri;
    if (mem.skip.has(key)) continue;
    const t = floorTileNear(g, rooms[ri].cx, rooms[ri].cz);
    if (t < 0 || g.dist[t] < 0) continue;
    if (g.dist[t] < bd) { bd = g.dist[t]; best = { tile: t, kind: /** @type {const} */ ('room'), key, room: ri }; }
  }
  if (!best) {
    for (const [id, e] of mem.seen) {
      if (!mem.alive(id)) continue;
      const key = 'mon:' + id;
      if (mem.skip.has(key)) continue;
      const t = floorTileNear(g, e.x, e.z);
      if (t < 0 || g.dist[t] < 0) continue;
      if (g.dist[t] < bd) { bd = g.dist[t]; best = { tile: t, kind: /** @type {const} */ ('mon'), key, room: -1 }; }
    }
  }
  if (!best) {
    // 탐색 경계 — BFS 순서(가까운 순)로 처음 만나는 탐색하지 않은 바닥 타일
    const n = g.w * g.h;
    for (let k = 0; k < n; k++) {
      if (!g.floor[k] || g.dist[k] < 0 || explored[k]) continue;
      const key = 'tile:' + k;
      if (mem.skip.has(key)) continue;
      if (g.dist[k] < bd) { bd = g.dist[k]; best = { tile: k, kind: /** @type {const} */ ('frontier'), key, room: -1 }; }
    }
  }
  if (!best) return null;
  const c = best.kind === 'room' ? { x: rooms[best.room].cx, z: rooms[best.room].cz } : tileCenter(g, best.tile);
  return { ...best, x: c.x, z: c.z };
}

/** 점이 들어 있는 방(경계 상자) 인덱스 · 없으면 -1 @param {MapData} map @param {number} x @param {number} z */
export function roomAt(map, x, z) {
  const rooms = map.rooms ?? [];
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return i;
  }
  return -1;
}
