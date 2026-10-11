// OWNER: P4 — 계약 §6.6 · §8.7 · §7.12
// STUB — W1 에서 P4 가 채운다(방 · 통로 그래프 · 타일셋 소품 · 빛 · 팩 자리 · 결정성 · ≤ 150ms).
// W0: 60 × 60m 방 하나(fixtureMap 과 같은 꼴 — sim 은 debug 를 import 하지 못해 같은 코드를 직접 쓴다) · 팩 자리 12(normal 8 · champion 3 · elite 1) · 빛 6 · 기둥 4

import { NAV_CELL, NAV_PER_TILE, TILE, TILE_FLOOR, TILE_VOID, TILE_WALL } from '../../core/constants.js';
import { hash32 } from '../../core/hash.js';
import { getTileset } from '../../data/index.js';
import { TILESETS } from '../../data/tilesets.js';

/** @typedef {import('../../types.js').MapData} MapData */

/** STUB 배치(W0 — 타일 단위) */
const STUB = {
  floorTiles: 30,
  pillars: [[8, 8], [22, 8], [8, 22], [22, 22]],
  slots: [
    ['normal', 6, 22], ['normal', 12, 26], ['normal', 18, 26], ['normal', 25, 24], ['normal', 26, 17], ['normal', 26, 10],
    ['normal', 20, 4], ['normal', 12, 18], ['champion', 16, 14], ['champion', 22, 18], ['champion', 6, 14], ['elite', 24, 27],
  ],
  lights: [[4, 4], [15, 4], [27, 4], [4, 27], [15, 27], [27, 27]],
  spawn: [5, 5],
};

/**
 * STUB — 균열 생성 → MapData(kind 'rift'). 타일셋은 hash32(seed, level, 9) % 2(crypt · cavern)
 * @param {number} seed @param {number} level @returns {MapData}
 */
export function generateRift(seed, level) {
  const rifts = TILESETS.filter(t => t.weight > 0);
  const ts = rifts[hash32(seed, level, 9) % rifts.length];
  const n = STUB.floorTiles;
  const w = n + 2, h = n + 2;
  const tiles = new Uint8Array(w * h);
  for (let j = 1; j <= n; j++) for (let i = 1; i <= n; i++) tiles[j * w + i] = TILE_FLOOR;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (tiles[j * w + i] !== TILE_VOID) continue;
    let near = false;
    for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < w && jj < h && tiles[jj * w + ii] === TILE_FLOOR) { near = true; break; }
    }
    if (near) tiles[j * w + i] = TILE_WALL;
  }
  const at = (t) => (t + 0.5) * TILE;   // 타일 가운데(m · 바닥 타일 1..n)
  const pillar = getTileset(ts.id).props.find(p => p.block) ?? { kind: 'pillar', r: 0.6, h: 3.0, block: true };
  const props = STUB.pillars.map(([i, j], k) => ({ id: k + 1, kind: pillar.kind, x: at(i), z: at(j), facing: 0, r: pillar.r, h: pillar.h, block: true }));
  const nw = w * NAV_PER_TILE, nh = h * NAV_PER_TILE;
  const nav = new Uint8Array(nw * nh).fill(1);
  for (let v = 0; v < nh; v++) for (let u = 0; u < nw; u++) {
    const ti = Math.floor(u / NAV_PER_TILE), tj = Math.floor(v / NAV_PER_TILE);
    if (tiles[tj * w + ti] !== TILE_FLOOR) continue;
    const x0 = u * NAV_CELL, z0 = v * NAV_CELL;
    let blocked = false;
    for (const p of props) {
      const cx = Math.max(x0, Math.min(p.x, x0 + NAV_CELL)), cz = Math.max(z0, Math.min(p.z, z0 + NAV_CELL));
      if ((cx - p.x) ** 2 + (cz - p.z) ** 2 < p.r * p.r) { blocked = true; break; }
    }
    if (!blocked) nav[v * nw + u] = 0;
  }
  const lk = ts.lights.kinds[0];
  const lights = STUB.lights.map(([i, j]) => ({ x: at(i), y: lk.y, z: at(j), color: lk.color, intensity: lk.intensity, radius: lk.radius, flicker: lk.flicker, kind: lk.kind }));
  const x0 = TILE, z0 = TILE, x1 = (n + 1) * TILE, z1 = (n + 1) * TILE;
  return {
    id: `rift:${seed >>> 0}:${level}`,
    kind: 'rift',
    tileset: ts.id,
    w, h, tiles, nw, nh, nav,
    rooms: [{ id: 0, x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, depth: 0, kind: 'start' }],
    corridors: [],
    props,
    lights,
    spawn: { x: at(STUB.spawn[0]), z: at(STUB.spawn[1]), facing: Math.PI / 4 },
    packSlots: STUB.slots.map(([kind, i, j], k) => ({ id: k + 1, roomId: 0, x: at(/** @type {number} */ (i)), z: at(/** @type {number} */ (j)), kind: /** @type {any} */ (kind), depth: kind === 'normal' ? 0 : 2 })),
    objects: [],
    bounds: { x0, z0, x1, z1 },
  };
}
