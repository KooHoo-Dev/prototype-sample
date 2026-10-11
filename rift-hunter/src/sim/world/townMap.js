// OWNER: P4 — 계약 §6.6 · §7.12
// 마을 맵 — data/town.js 배치 그대로: 24 × 24 타일(48m) · 가장자리 1타일 벽 · 상호작용 물체 7 + 모닥불(장식) + 장식 건물 4(상자).
// 막는 것: 장식 건물 상자 · 막는 장식 원(모닥불). 상호작용 물체(NPC · 보관함 · 균열석 · 포털)는 막지 않는다 — 클릭하면 그 자리까지 걸어가
// r 안에서 도착한다(debug/fixtureMap.js 의 townMapFromData 와 같은 내비 · 같은 자리 — 고정 상태를 이 맵으로 바꿔 넘겨도 같다).

import { NAV_CELL, NAV_PER_TILE, TILE, TILE_FLOOR, TILE_WALL } from '../../core/constants.js';
import { getTileset } from '../../data/index.js';
import { TOWN } from '../../data/town.js';

/** @typedef {import('../../types.js').MapData} MapData */
/** @typedef {import('../../types.js').MapObject} MapObject */
/** @typedef {import('../../types.js').LightDef} LightDef */

/** 마을 MapData(kind 'town') — 부를 때마다 새 객체(배열 · 물체를 나눠 쓰지 않는다) @returns {MapData} */
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
  const circles = objects.filter(o => o.block && !(o.w && o.d));
  const nw = w * NAV_PER_TILE, nh = h * NAV_PER_TILE;
  const nav = new Uint8Array(nw * nh).fill(1);
  for (let v = 0; v < nh; v++) for (let u = 0; u < nw; u++) {
    if (tiles[Math.floor(v / NAV_PER_TILE) * w + Math.floor(u / NAV_PER_TILE)] !== TILE_FLOOR) continue;
    const x0 = u * NAV_CELL, z0 = v * NAV_CELL, x1 = x0 + NAV_CELL, z1 = z0 + NAV_CELL;
    let blocked = false;
    for (const c of circles) {
      const cx = Math.max(x0, Math.min(c.x, x1)), cz = Math.max(z0, Math.min(c.z, z1));
      if ((cx - c.x) ** 2 + (cz - c.z) ** 2 < c.r * c.r) { blocked = true; break; }
    }
    if (!blocked) {
      for (const b of TOWN.buildings) {
        if (x1 > b.x0 && x0 < b.x1 && z1 > b.z0 && z0 < b.z1) { blocked = true; break; }
      }
    }
    if (!blocked) nav[v * nw + u] = 0;
  }
  const kinds = getTileset('town').lights.kinds;
  /** @type {LightDef[]} */
  const lights = TOWN.lights.map(l => {
    const k = kinds.find(x => x.kind === l.kind) ?? kinds[0];
    return { x: l.x, y: k.y, z: l.z, color: k.color, intensity: k.intensity, radius: k.radius, flicker: k.flicker, kind: k.kind };
  });
  const x0 = TILE, z0 = TILE, x1 = (w - 1) * TILE, z1 = (h - 1) * TILE;
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
