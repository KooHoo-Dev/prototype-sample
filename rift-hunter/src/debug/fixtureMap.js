// OWNER: P0 — 계약 §11.9 · §6.17 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// ASCII → MapData(고정 상태 · 테스트 맵). 한 글자 = 타일 하나(2m) · 줄 = z(위에서 아래로 j 증가) · 글자 = x(i 증가).
//   '#' 막힘(비바닥) · ' ' 빈 곳(비바닥) · '.' 바닥 · 'S' 시작점 · 'P' 막는 소품(타일셋의 room 막는 소품 — 기둥 · 석순)
//   'd' 막지 않는 소품(타일셋의 첫 비막음 소품) · 'N' · 'C' · 'E' 팩 자리(normal · champion · elite) · 'L' 빛(타일셋 첫 빛)
// 벽(TILE_WALL) = 바닥에 8방향으로 닿는 비바닥 타일 · 내비 = 바닥 타일의 4 × 4 칸 중 막는 소품 원과 겹치지 않는 칸.
// debug/* 는 app 과 test 만 import 한다. sim/world/townMap.js 를 import 하지 못해 마을 맵은 데이터로 직접 만든다(townMapFromData).

import { NAV_CELL, NAV_PER_TILE, TILE, TILE_FLOOR, TILE_VOID, TILE_WALL } from '../core/constants.js';
import { getTileset } from '../data/index.js';
import { TOWN } from '../data/town.js';

/** @typedef {import('../types.js').MapData} MapData */
/** @typedef {import('../types.js').MapObject} MapObject */
/** @typedef {import('../types.js').Prop} Prop */

/** 기본: 40 × 40m 방 하나(바닥 20 × 20 타일) · 기둥 4 · 팩 자리 6 · 빛 4 */
export const DEFAULT_ROOM = [
  '######################',
  '#....................#',
  '#.L..............L...#',
  '#....................#',
  '#...P..........P.....#',
  '#........N...........#',
  '#....................#',
  '#..N.............C...#',
  '#....................#',
  '#....................#',
  '#..........S.........#',
  '#....................#',
  '#....................#',
  '#..N.............N...#',
  '#....................#',
  '#....................#',
  '#...P..........P.....#',
  '#.........E..........#',
  '#.L..............L...#',
  '#....................#',
  '#....................#',
  '######################',
].join('\n');

/**
 * 고정 상태용 넓은 방(56 × 56m 바닥) — 가운데 시작점 · 시작점의 +X+Z(카메라 쪽) 5~9m 에 벽 덩어리(벽 낮추기 확인) · 기둥 3 · 소품 · 빛 6 · 팩 자리 5
 * @returns {string}
 */
export function arenaAscii() {
  const n = 30;
  const rows = [];
  for (let j = 0; j < n; j++) {
    let row = '';
    for (let i = 0; i < n; i++) row += i === 0 || j === 0 || i === n - 1 || j === n - 1 ? '#' : '.';
    rows.push(row.split(''));
  }
  const put = (i, j, ch) => { rows[j][i] = ch; };
  put(14, 14, 'S');
  for (const [i, j] of [[17, 17], [18, 17], [17, 18]]) put(i, j, '#');   // 카메라 쪽 벽 덩어리
  for (const [i, j] of [[9, 9], [20, 9], [9, 20]]) put(i, j, 'P');
  for (const [i, j] of [[4, 12], [12, 4], [25, 15], [15, 25], [5, 25], [25, 5]]) put(i, j, 'd');
  for (const [i, j] of [[6, 6], [22, 6], [6, 22], [22, 23], [14, 7], [7, 14]]) put(i, j, 'L');
  for (const [i, j] of [[5, 10], [10, 25], [25, 10]]) put(i, j, 'N');
  put(23, 25, 'C');
  put(25, 23, 'E');
  return rows.map(r => r.join('')).join('\n');
}

/** 비바닥 중 바닥에 8방향으로 닿는 것을 벽으로 @param {Uint8Array} tiles @param {number} w @param {number} h */
function markWalls(tiles, w, h) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (tiles[j * w + i] === TILE_FLOOR) continue;
    let near = false;
    for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < w && jj < h && tiles[jj * w + ii] === TILE_FLOOR) { near = true; break; }
    }
    tiles[j * w + i] = near ? TILE_WALL : TILE_VOID;
  }
}

/**
 * 내비 칸: 바닥 타일의 칸 중 막는 원(소품 · 물체)과 막는 상자(건물)에 겹치지 않는 칸 = 0
 * @param {Uint8Array} tiles @param {number} w @param {number} h
 * @param {Array<{x:number, z:number, r:number}>} circles @param {Array<{x0:number, z0:number, x1:number, z1:number}>} boxes
 */
function buildNav(tiles, w, h, circles, boxes) {
  const nw = w * NAV_PER_TILE, nh = h * NAV_PER_TILE;
  const nav = new Uint8Array(nw * nh).fill(1);
  for (let v = 0; v < nh; v++) for (let u = 0; u < nw; u++) {
    const ti = Math.floor(u / NAV_PER_TILE), tj = Math.floor(v / NAV_PER_TILE);
    if (tiles[tj * w + ti] !== TILE_FLOOR) continue;
    const x0 = u * NAV_CELL, z0 = v * NAV_CELL, x1 = x0 + NAV_CELL, z1 = z0 + NAV_CELL;
    let blocked = false;
    for (const c of circles) {
      const cx = Math.max(x0, Math.min(c.x, x1)), cz = Math.max(z0, Math.min(c.z, z1));
      if ((cx - c.x) ** 2 + (cz - c.z) ** 2 < c.r * c.r) { blocked = true; break; }
    }
    if (!blocked) for (const b of boxes) {
      if (x1 > b.x0 && x0 < b.x1 && z1 > b.z0 && z0 < b.z1) { blocked = true; break; }
    }
    if (!blocked) nav[v * nw + u] = 0;
  }
  return { nw, nh, nav };
}

/**
 * ASCII → MapData
 * @param {string} ascii
 * @param {{id?:string, kind?:'rift'|'town', tileset?:import('../types.js').TilesetId}} [opts]
 * @returns {MapData}
 */
export function mapFromAscii(ascii, { id = 'fixture:map', kind = 'rift', tileset = 'crypt' } = {}) {
  const lines = ascii.split('\n').filter(l => l.length);
  const h = lines.length;
  const w = Math.max(...lines.map(l => l.length));
  const ts = getTileset(tileset);
  const blockProp = ts.props.find(p => p.block && p.where === 'room') ?? ts.props.find(p => p.block) ?? { kind: 'pillar', r: 0.6, h: 3.0, block: true };
  const decoProp = ts.props.find(p => !p.block) ?? null;
  const light = ts.lights.kinds[0];
  const tiles = new Uint8Array(w * h);
  /** @type {Prop[]} */
  const props = [];
  const lights = [];
  const packSlots = [];
  let spawn = null;
  let fx0 = Infinity, fz0 = Infinity, fx1 = -Infinity, fz1 = -Infinity;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const ch = lines[j][i] ?? ' ';
      if (ch === '#' || ch === ' ') continue;
      tiles[j * w + i] = TILE_FLOOR;
      fx0 = Math.min(fx0, i * TILE); fz0 = Math.min(fz0, j * TILE);
      fx1 = Math.max(fx1, (i + 1) * TILE); fz1 = Math.max(fz1, (j + 1) * TILE);
      const x = (i + 0.5) * TILE, z = (j + 0.5) * TILE;
      if (ch === 'S') spawn = { x, z, facing: Math.PI / 4 };
      else if (ch === 'P') props.push({ id: props.length + 1, kind: blockProp.kind, x, z, facing: 0, r: blockProp.r, h: blockProp.h, block: true });
      else if (ch === 'd' && decoProp) props.push({ id: props.length + 1, kind: decoProp.kind, x, z, facing: (i * 7 + j * 3) % 6, r: decoProp.r, h: decoProp.h, block: false });
      else if (ch === 'L') lights.push({ x, y: light.y, z, color: light.color, intensity: light.intensity, radius: light.radius, flicker: light.flicker, kind: light.kind });
      else if (ch === 'N' || ch === 'C' || ch === 'E') {
        const k = ch === 'N' ? 'normal' : ch === 'C' ? 'champion' : 'elite';
        packSlots.push({ id: packSlots.length + 1, roomId: 0, x, z, kind: /** @type {'normal'|'champion'|'elite'} */ (k), depth: k === 'normal' ? 0 : 2 });
      }
    }
  }
  if (!Number.isFinite(fx0)) throw new Error('fixtureMap: no floor tiles');
  markWalls(tiles, w, h);
  const { nw, nh, nav } = buildNav(tiles, w, h, props.filter(p => p.block), []);
  if (!spawn) spawn = { x: (fx0 + fx1) / 2, z: (fz0 + fz1) / 2, facing: 0 };
  return {
    id, kind, tileset,
    w, h, tiles, nw, nh, nav,
    rooms: [{ id: 0, x0: fx0, z0: fz0, x1: fx1, z1: fz1, cx: (fx0 + fx1) / 2, cz: (fz0 + fz1) / 2, depth: 0, kind: 'start' }],
    corridors: [],
    props,
    lights,
    spawn,
    packSlots,
    objects: [],
    bounds: { x0: fx0, z0: fz0, x1: fx1, z1: fz1 },
  };
}

/**
 * 마을 MapData — data/town.js 배치 그대로(sim/world/townMap.js 의 W0 스텁과 같은 꼴). 막는 것: 장식 건물 상자 · 막는 장식(모닥불)
 * @returns {MapData}
 */
export function townMapFromData() {
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
  const circles = objects.filter(o => o.block && !(o.w && o.d)).map(o => ({ x: o.x, z: o.z, r: o.r }));
  const boxes = TOWN.buildings.map(b => ({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 }));
  const { nw, nh, nav } = buildNav(tiles, w, h, circles, boxes);
  const kinds = getTileset('town').lights.kinds;
  const lights = TOWN.lights.map(l => {
    const k = kinds.find(x => x.kind === l.kind) ?? kinds[0];
    return { x: l.x, y: k.y, z: l.z, color: k.color, intensity: k.intensity, radius: k.radius, flicker: k.flicker, kind: k.kind };
  });
  const x0 = TILE, z0 = TILE, x1 = (w - 1) * TILE, z1 = (h - 1) * TILE;
  return {
    id: 'town', kind: 'town', tileset: 'town',
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
