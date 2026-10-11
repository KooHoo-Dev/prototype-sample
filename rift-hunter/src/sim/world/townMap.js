// OWNER: P4 — 계약 §6.6 · §7.12
// STUB — W1 에서 P4 가 채운다. W0: 48 × 48m 광장 · TOWN.objects 위치 그대로 + 장식 건물(완성에 가깝게 — 데이터만으로)
// 막는 것: 장식 건물 상자 · 막는 장식(모닥불). 상호작용 물체(NPC · 보관함 · 균열석 · 포털)는 막지 않는다.

import { NAV_CELL, NAV_PER_TILE, TILE_FLOOR, TILE_WALL } from '../../core/constants.js';
import { getTileset } from '../../data/index.js';
import { TOWN } from '../../data/town.js';

/** @typedef {import('../../types.js').MapData} MapData */
/** @typedef {import('../../types.js').MapObject} MapObject */

/** STUB — 마을 MapData(kind 'town') @returns {MapData} */
export function buildTownMap() {
  const w = TOWN.w, h = TOWN.h;
  const tiles = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1;
    tiles[j * w + i] = edge ? TILE_WALL : TILE_FLOOR;
  }
  /** @type {MapObject[]} */
  const objects = TOWN.objects.map(o => ({ ...o }));
  for (const b of TOWN.buildings) {
    objects.push({ id: b.id, kind: 'deco', x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, facing: 0, r: 0, w: b.x1 - b.x0, d: b.z1 - b.z0, h: b.h, look: b.look, block: true });
  }
  const nw = w * NAV_PER_TILE, nh = h * NAV_PER_TILE;
  const nav = new Uint8Array(nw * nh).fill(1);
  for (let v = 0; v < nh; v++) for (let u = 0; u < nw; u++) {
    const ti = Math.floor(u / NAV_PER_TILE), tj = Math.floor(v / NAV_PER_TILE);
    if (tiles[tj * w + ti] !== TILE_FLOOR) continue;
    const x0 = u * NAV_CELL, z0 = v * NAV_CELL, x1 = x0 + NAV_CELL, z1 = z0 + NAV_CELL;
    let blocked = false;
    for (const o of objects) {
      if (!o.block) continue;
      if (o.w && o.d) {
        if (x1 > o.x - o.w / 2 && x0 < o.x + o.w / 2 && z1 > o.z - o.d / 2 && z0 < o.z + o.d / 2) { blocked = true; break; }
      } else {
        const cx = Math.max(x0, Math.min(o.x, x1)), cz = Math.max(z0, Math.min(o.z, z1));
        if ((cx - o.x) ** 2 + (cz - o.z) ** 2 < o.r * o.r) { blocked = true; break; }
      }
    }
    if (!blocked) nav[v * nw + u] = 0;
  }
  const kinds = getTileset('town').lights.kinds;
  const lights = TOWN.lights.map(l => {
    const k = kinds.find(x => x.kind === l.kind) ?? kinds[0];
    return { x: l.x, y: k.y, z: l.z, color: k.color, intensity: k.intensity, radius: k.radius, flicker: k.flicker, kind: k.kind };
  });
  const x0 = 2, z0 = 2, x1 = (w - 1) * 2, z1 = (h - 1) * 2;
  return {
    id: 'town',
    kind: 'town',
    tileset: 'town',
    w, h, tiles, nw, nh, nav,
    rooms: [{ id: 0, x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, depth: 0, kind: 'start' }],
    corridors: [],
    props: [],
    lights,
    spawn: { x: TOWN.arrive.x, z: TOWN.arrive.z, facing: TOWN.arrive.facing },
    packSlots: [],
    objects,
    bounds: { x0, z0, x1, z1 },
  };
}
