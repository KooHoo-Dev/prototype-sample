// OWNER: P0 — 계약 §6.5 · §0.2 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 내비 격자 질의 · 원 이동(벽 미끄러짐) · 시야 광선 · 가장 가까운 걸을 수 있는 점. MapData 는 상태가 아니다(ctx.map).
// 타일 (i, j): x ∈ [2i, 2i+2) · z ∈ [2j, 2j+2) · 내비 칸 (u, v): x ∈ [0.5u, 0.5u+0.5) · 인덱스는 행 우선(z 가 행).

import { NAV_CELL, TILE, TILE_FLOOR, TILE_VOID } from '../../core/constants.js';

/** @typedef {import('../../types.js').MapData} MapData */
/** @typedef {import('../../types.js').Vec2} Vec2 */

const STEP = 0.25;   // moveCircle · raycastWalk 의 최대 걸음(m)
const EPS = 1e-9;

/** 그 점의 타일 종류(밖이면 TILE_VOID) @param {MapData} map */
export function tileAt(map, x, z) {
  const i = Math.floor(x / TILE), j = Math.floor(z / TILE);
  if (i < 0 || j < 0 || i >= map.w || j >= map.h) return TILE_VOID;
  return map.tiles[j * map.w + i];
}

/** 내비 칸 인덱스(밖이면 -1) @param {MapData} map */
export function cellIndex(map, x, z) {
  const u = Math.floor(x / NAV_CELL), v = Math.floor(z / NAV_CELL);
  if (u < 0 || v < 0 || u >= map.nw || v >= map.nh) return -1;
  return v * map.nw + u;
}

/** 칸 가운데 @param {MapData} map @param {number} idx @returns {Vec2} */
export function cellCenter(map, idx) {
  const u = idx % map.nw, v = Math.floor(idx / map.nw);
  return { x: (u + 0.5) * NAV_CELL, z: (v + 0.5) * NAV_CELL };
}

/** 그 점의 내비 칸이 0 @param {MapData} map */
export function isWalkable(map, x, z) {
  const idx = cellIndex(map, x, z);
  return idx >= 0 && map.nav[idx] === 0;
}

/** 칸 (u, v) 가 막혔다(밖은 막힘) @param {MapData} map */
function blockedUV(map, u, v) {
  if (u < 0 || v < 0 || u >= map.nw || v >= map.nh) return true;
  return map.nav[v * map.nw + u] !== 0;
}

/**
 * 반지름 r 원이 막힌 칸(밖 포함)과 겹치지 않는다(칸 사각형과 원의 거리 — 경계에 닿기만 하면 겹침 아님)
 * @param {MapData} map
 */
export function isWalkableR(map, x, z, r) {
  if (!isWalkable(map, x, z)) return false;
  if (r <= 0) return true;
  const u0 = Math.floor((x - r) / NAV_CELL), u1 = Math.floor((x + r) / NAV_CELL);
  const v0 = Math.floor((z - r) / NAV_CELL), v1 = Math.floor((z + r) / NAV_CELL);
  const r2 = r * r - EPS;
  for (let v = v0; v <= v1; v++) {
    for (let u = u0; u <= u1; u++) {
      if (!blockedUV(map, u, v)) continue;
      const cx = Math.max(u * NAV_CELL, Math.min(x, (u + 1) * NAV_CELL));
      const cz = Math.max(v * NAV_CELL, Math.min(z, (v + 1) * NAV_CELL));
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < r2) return false;
    }
  }
  return true;
}

/**
 * 원(반지름 r)을 (dx, dz)만큼 움직인 새 위치 — 0.25m 이하로 잘게 나눠 축별로 미끄러진다(막히면 그 축 성분 0).
 * 시작 자리가 막힌 칸과 겹쳐 있으면 먼저 가까운 걸을 수 있는 자리로 빼낸다. 결과는 늘 걷기 가능(isWalkable).
 * @param {MapData} map @param {Vec2} pos @returns {Vec2}
 */
export function moveCircle(map, pos, r, dx, dz) {
  let x = pos.x, z = pos.z;
  if (!isWalkableR(map, x, z, r)) {
    const p = unstick(map, x, z, r);
    if (p) { x = p.x; z = p.z; }
  }
  const len = Math.hypot(dx, dz);
  if (!(len > 0) || !Number.isFinite(len)) return { x, z };
  const n = Math.max(1, Math.ceil(len / STEP));
  const sx = dx / n, sz = dz / n;
  for (let i = 0; i < n; i++) {
    let moved = false;
    if (sx !== 0 && isWalkableR(map, x + sx, z, r)) { x += sx; moved = true; }
    if (sz !== 0 && isWalkableR(map, x, z + sz, r)) { z += sz; moved = true; }
    if (!moved) break;
  }
  if (!isWalkable(map, x, z)) {
    const p = nearestWalkable(map, x, z, 3);
    if (p) return p;
  }
  return { x, z };
}

/** 막힌 칸과 겹친 원을 가까운 자리(반지름 r 이 들어가는 칸 가운데 · 2m 안)로 @param {MapData} map @returns {Vec2|null} */
function unstick(map, x, z, r) {
  const cu = Math.floor(x / NAV_CELL), cv = Math.floor(z / NAV_CELL);
  const K = Math.ceil(2 / NAV_CELL);
  let best = null, bestD2 = Infinity;
  for (let k = 0; k <= K; k++) {
    if (best && (k - 1) * NAV_CELL > Math.sqrt(bestD2)) break;
    for (let v = cv - k; v <= cv + k; v++) {
      for (let u = cu - k; u <= cu + k; u++) {
        if (Math.max(Math.abs(u - cu), Math.abs(v - cv)) !== k) continue;
        if (blockedUV(map, u, v)) continue;
        const px = (u + 0.5) * NAV_CELL, pz = (v + 0.5) * NAV_CELL;
        if (!isWalkableR(map, px, pz, r)) continue;
        const d2 = (px - x) ** 2 + (pz - z) ** 2;
        if (d2 < bestD2) { bestD2 = d2; best = { x: px, z: pz }; }
      }
    }
  }
  return best;
}

/**
 * 격자 칸을 선분 a→b 를 따라 방문한다(Amanatides–Woo · 모서리를 정확히 지나면 옆 두 칸도 본다).
 * visit(i, j) 가 true 를 돌려주면 멈추고 true.
 * @param {number} size 칸 크기 @param {(i:number, j:number) => boolean} visit
 */
function traverse(size, ax, az, bx, bz, visit) {
  let i = Math.floor(ax / size), j = Math.floor(az / size);
  const ei = Math.floor(bx / size), ej = Math.floor(bz / size);
  if (visit(i, j)) return true;
  const dx = bx - ax, dz = bz - az;
  const si = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const sj = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tdx = si !== 0 ? Math.abs(size / dx) : Infinity;
  const tdz = sj !== 0 ? Math.abs(size / dz) : Infinity;
  let tmx = si > 0 ? ((i + 1) * size - ax) / dx : si < 0 ? (i * size - ax) / dx : Infinity;
  let tmz = sj > 0 ? ((j + 1) * size - az) / dz : sj < 0 ? (j * size - az) / dz : Infinity;
  let guard = Math.abs(ei - i) + Math.abs(ej - j) + 4;
  while ((i !== ei || j !== ej) && guard-- > 0) {
    if (Math.min(tmx, tmz) > 1) break;   // 끝 점까지 왔다(수치 오차로 끝 칸 번호가 한 칸 어긋난 경우)
    if (Math.abs(tmx - tmz) < 1e-12) {
      // 모서리를 정확히 지난다 — 옆 두 칸도 막힘 검사
      if (visit(i + si, j) || visit(i, j + sj)) return true;
      i += si; j += sj; tmx += tdx; tmz += tdz;
    } else if (tmx < tmz) {
      i += si; tmx += tdx;
    } else {
      j += sj; tmz += tdz;
    }
    if (visit(i, j)) return true;
  }
  return false;
}

/**
 * 벽 타일(바닥이 아닌 타일 — 맵 밖 포함)이 선분 a–b 를 막지 않는다. props 면 막는 소품 칸(바닥 타일 위의 막힌 내비 칸)도 막는다.
 * @param {MapData} map @param {{props?:boolean}} [opts]
 */
export function losClear(map, ax, az, bx, bz, { props = false } = {}) {
  const tileBlocked = (i, j) => {
    if (i < 0 || j < 0 || i >= map.w || j >= map.h) return true;
    return map.tiles[j * map.w + i] !== TILE_FLOOR;
  };
  if (traverse(TILE, ax, az, bx, bz, tileBlocked)) return false;
  if (props) {
    if (traverse(NAV_CELL, ax, az, bx, bz, (u, v) => blockedUV(map, u, v))) return false;
  }
  return true;
}

/**
 * a 에서 b 로 가며 반지름 r 이 지나갈 수 있는 마지막 점(a 가 이미 막혔으면 a)
 * @param {MapData} map @returns {Vec2}
 */
export function raycastWalk(map, ax, az, bx, bz, r) {
  if (!isWalkableR(map, ax, az, r)) return { x: ax, z: az };
  const len = Math.hypot(bx - ax, bz - az);
  if (!(len > 0)) return { x: ax, z: az };
  const n = Math.max(1, Math.ceil(len / STEP));
  let lx = ax, lz = az;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    if (!isWalkableR(map, x, z, r)) {
      // 막힌 걸음 안에서 더 다가간다(이분)
      let lo = (i - 1) / n, hi = t;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) / 2;
        if (isWalkableR(map, ax + (bx - ax) * mid, az + (bz - az) * mid, r)) lo = mid;
        else hi = mid;
      }
      return { x: ax + (bx - ax) * lo, z: az + (bz - az) * lo };
    }
    lx = x; lz = z;
  }
  return { x: lx, z: lz };
}

/**
 * 가장 가까운 걸을 수 있는 점 — 그 점이 걸을 수 있으면 그대로, 아니면 maxR 안의 걸을 수 있는 칸 가운데 중 가장 가까운 것 · 없으면 null
 * @param {MapData} map @param {number} [maxR] @returns {Vec2|null}
 */
export function nearestWalkable(map, x, z, maxR = 3) {
  if (isWalkable(map, x, z)) return { x, z };
  const cu = Math.floor(x / NAV_CELL), cv = Math.floor(z / NAV_CELL);
  const K = Math.ceil(maxR / NAV_CELL) + 1;
  let best = null, bestD2 = maxR * maxR + EPS;
  for (let k = 0; k <= K; k++) {
    if (best && (k - 1) * NAV_CELL > Math.sqrt(bestD2)) break;
    for (let v = cv - k; v <= cv + k; v++) {
      for (let u = cu - k; u <= cu + k; u++) {
        if (Math.max(Math.abs(u - cu), Math.abs(v - cv)) !== k) continue;
        if (blockedUV(map, u, v)) continue;
        const px = (u + 0.5) * NAV_CELL, pz = (v + 0.5) * NAV_CELL;
        const d2 = (px - x) ** 2 + (pz - z) ** 2;
        if (d2 <= bestD2) {
          if (d2 === bestD2 && best) continue;
          bestD2 = d2;
          best = { x: px, z: pz };
        }
      }
    }
  }
  return best;
}

/**
 * (x, z) 에서 rMin..rMax 떨어진 무작위 점 중 반지름 0.5 가 들어가는 첫 점(tries 번) · 없으면 null
 * @param {MapData} map @param {import('../../types.js').Rng} rng @returns {Vec2|null}
 */
export function randomWalkableNear(map, rng, x, z, rMin, rMax, tries = 12) {
  for (let i = 0; i < tries; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(rMin, rMax);
    const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
    if (isWalkableR(map, px, pz, 0.5)) return { x: px, z: pz };
  }
  return null;
}

/** 맵 범위 안(0 ≤ x < w × 2 · 0 ≤ z < h × 2) @param {MapData} map */
export function inBounds(map, x, z) {
  return x >= 0 && z >= 0 && x < map.w * TILE && z < map.h * TILE;
}
