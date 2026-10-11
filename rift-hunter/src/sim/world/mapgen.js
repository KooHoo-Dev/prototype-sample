// OWNER: P4 — 계약 §6.6 · §8.7 · §7.12
// 균열 생성 — 시드 · 레벨 → MapData(kind 'rift'). 결정적(난수는 makeRng(seedRng(hash32(seed, level, 1))) 하나) · ≤ 150ms.
// 절차(§8.7): 시작 방 → 「방에서 통로를 내고 방을 붙이기」 나무 → 고리 0~2 → 타일(바닥 · 벽) → 소품 → 빛 → 내비 → 고립 칸 막기 → 팩 자리.
// 생성은 96 × 96 타일 격자에서 하고, 결과는 바닥 둘레 MAPGEN.cropPad 타일까지 잘라 원점으로 옮긴다(모든 좌표 ≥ 0).
// 규칙(방 수 · 챔피언/정예 자리 수 = riftRow)을 못 채우면 같은 난수 줄기로 다시 만든다(결정적 · 드묾).

import { NAV_CELL, NAV_PER_TILE, TILE, TILE_FLOOR, TILE_VOID, TILE_WALL } from '../../core/constants.js';
import { hash32 } from '../../core/hash.js';
import { yawOf } from '../../core/math.js';
import { makeRng, seedRng } from '../../core/rng.js';
import { getTileset } from '../../data/index.js';
import { MAPGEN } from '../../data/mapgen.js';
import { riftRow } from '../../data/rift.js';
import { TILESETS } from '../../data/tilesets.js';
import { isWalkableR } from './nav.js';

/** @typedef {import('../../types.js').MapData} MapData */
/** @typedef {import('../../types.js').Room} Room */
/** @typedef {import('../../types.js').Prop} Prop */
/** @typedef {import('../../types.js').LightDef} LightDef */
/** @typedef {import('../../types.js').PackSlot} PackSlot */
/** @typedef {import('../../types.js').Rng} Rng */
/** @typedef {import('../../types.js').TilesetDef} TilesetDef */
/** 타일 사각형 [x0, x1) × [z0, z1) @typedef {{x0:number, z0:number, x1:number, z1:number}} Rect */
/** @typedef {Rect & {big:boolean}} RoomRect */
/** @typedef {{a:number, b:number, rect:Rect, axis:'x'|'z'}} Cor */

/** 통로를 내는 네 방향 (dx, dz) */
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** 4방향 이웃 (du, dv) */
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** 두 사각형이 m 타일 여백 안에서 겹친다 @param {Rect} a @param {Rect} b @param {number} m */
function hit(a, b, m) {
  return a.x0 - m < b.x1 && b.x0 < a.x1 + m && a.z0 - m < b.z1 && b.z0 < a.z1 + m;
}

/** 방 바닥 면적(m²) @param {Rect} r */
function area(r) { return (r.x1 - r.x0) * (r.z1 - r.z0) * TILE * TILE; }

/** 원(m)과 사각형(m)이 겹친다 */
function circleRect(x, z, r, x0, z0, x1, z1) {
  const cx = x < x0 ? x0 : x > x1 ? x1 : x;
  const cz = z < z0 ? z0 : z > z1 ? z1 : z;
  const dx = x - cx, dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

/**
 * 균열 생성 → MapData(kind 'rift'). 타일셋은 hash32(seed, level, 9) % 2(crypt · cavern)
 * @param {number} seed @param {number} level @returns {MapData}
 */
export function generateRift(seed, level) {
  const s = Number.isFinite(Number(seed)) ? (Math.floor(Number(seed)) >>> 0) : 0;
  const row = riftRow(level);
  const L = row.level;
  const rifts = TILESETS.filter(t => t.weight > 0);
  const ts = getTileset(rifts[hash32(s, L, 9) % rifts.length].id);
  const rng = makeRng(seedRng(hash32(s, L, 1)));
  let best = null;
  for (let attempt = 0; attempt <= MAPGEN.genRetries; attempt++) {
    const b = buildOnce(rng, ts, row);
    if (!best || b.score > best.score) best = b;
    if (b.ok) break;
  }
  const map = /** @type {MapData} */ (best.map);
  map.id = `rift:${s}:${L}`;
  return map;
}

/**
 * 한 번 만들기 — ok 이면 규칙을 모두 지켰다
 * @param {Rng} rng @param {TilesetDef} ts @param {import('../../types.js').RiftRow} row
 */
function buildOnce(rng, ts, row) {
  const lay = layout(rng);
  const { rooms, cors } = lay;
  // ── 잘라 옮기기 ──
  let mx0 = Infinity, mz0 = Infinity, mx1 = -Infinity, mz1 = -Infinity;
  for (const r of [...rooms, ...cors.map(c => c.rect)]) {
    if (r.x0 < mx0) mx0 = r.x0;
    if (r.z0 < mz0) mz0 = r.z0;
    if (r.x1 > mx1) mx1 = r.x1;
    if (r.z1 > mz1) mz1 = r.z1;
  }
  const pad = MAPGEN.cropPad;
  const ox = mx0 - pad, oz = mz0 - pad;
  const w = mx1 - mx0 + pad * 2, h = mz1 - mz0 + pad * 2;
  const shift = (/** @type {Rect} */ r) => { r.x0 -= ox; r.x1 -= ox; r.z0 -= oz; r.z1 -= oz; };
  for (const r of rooms) shift(r);
  for (const c of cors) shift(c.rect);

  // ── (4) 타일 ──
  const tiles = new Uint8Array(w * h);
  const fill = (/** @type {Rect} */ r) => {
    for (let j = r.z0; j < r.z1; j++) for (let i = r.x0; i < r.x1; i++) tiles[j * w + i] = TILE_FLOOR;
  };
  for (const r of rooms) fill(r);
  for (const c of cors) fill(c.rect);
  markWalls(tiles, w, h);

  // ── 방 깊이(시작 방에서 그래프 거리) ──
  const depth = roomDepths(rooms.length, cors);

  // ── 시작점 ──
  const start = rooms[0];
  const spawnX = (start.x0 + start.x1) / 2 * TILE, spawnZ = (start.z0 + start.z1) / 2 * TILE;
  const firstCor = cors.find(c => c.a === 0 || c.b === 0);
  let facing = Math.PI / 4;
  if (firstCor) {
    const cx = (firstCor.rect.x0 + firstCor.rect.x1) / 2 * TILE, cz = (firstCor.rect.z0 + firstCor.rect.z1) / 2 * TILE;
    facing = yawOf(cx - spawnX, cz - spawnZ);
  }
  const spawn = { x: spawnX, z: spawnZ, facing };

  // ── (5) 소품 ──
  const doorZones = rooms.map((r, ri) => roomDoorZones(r, ri, cors));
  /** @type {Prop[]} */
  const props = [];
  /** @type {Array<Array<Prop>>} */
  const roomProps = rooms.map(() => []);
  rooms.forEach((r, ri) => placeProps(rng, ts, r, ri === 0 ? spawn : null, doorZones[ri], tiles, w, props, roomProps[ri]));

  // ── (6) 빛 ──
  /** @type {LightDef[]} */
  const lights = [];
  rooms.forEach((r, ri) => placeLights(rng, ts, r, roomProps[ri], tiles, w, lights));

  // ── (8) 내비 · (9) 고립 칸 막기 ──
  const nw = w * NAV_PER_TILE, nh = h * NAV_PER_TILE;
  const nav = buildNav(tiles, w, h, props);
  /** @type {MapData} */
  const map = {
    id: '', kind: 'rift', tileset: /** @type {any} */ (ts.id),
    w, h, tiles, nw, nh, nav,
    rooms: rooms.map((r, ri) => toRoom(r, ri, depth[ri])),
    corridors: cors.map(c => ({ a: c.a, b: c.b, cells: rectCells(c.rect) })),
    props,
    lights,
    spawn,
    packSlots: [],
    objects: [],
    bounds: { x0: pad * TILE, z0: pad * TILE, x1: (w - pad) * TILE, z1: (h - pad) * TILE },
  };
  const spawnOk = pruneUnreachable(map, spawn);

  // ── (7) 팩 자리 ──
  const slots = placeSlots(rng, map, rooms, cors, depth, row);
  map.packSlots = slots.list;

  const rulesOk = spawnOk && lay.ok && slots.champion === row.championPacks && slots.elite === row.elitePacks;
  const ok = rulesOk && slots.normal >= MAPGEN.normalMin;
  // 다시 만들어도 못 채우면 규칙을 지킨 것 중 일반 자리가 가장 많은 것
  return { ok, map, score: (rulesOk ? 1 : 0) * MAPGEN.normalMin * 2 + slots.normal };
}

// ───────────────────────── (1)~(3) 배치 ─────────────────────────

/** @param {Rng} rng @returns {{rooms:RoomRect[], cors:Cor[], ok:boolean}} */
function layout(rng) {
  const G = MAPGEN.gridMax, M = MAPGEN.margin;
  /** @type {RoomRect[]} */
  const rooms = [];
  /** @type {Cor[]} */
  const cors = [];
  const sw = rng.int(MAPGEN.startRoomTiles[0], MAPGEN.startRoomTiles[1]);
  const sh = rng.int(MAPGEN.startRoomTiles[0], MAPGEN.startRoomTiles[1]);
  const sx0 = Math.floor((G - sw) / 2), sz0 = Math.floor((G - sh) / 2);
  rooms.push({ x0: sx0, z0: sz0, x1: sx0 + sw, z1: sz0 + sh, big: false });
  const target = rng.int(MAPGEN.rooms[0], MAPGEN.rooms[1]);
  const budget = MAPGEN.attempts * target;
  for (let t = 0; t < budget && rooms.length < target; t++) {
    const pi = rng.chance(MAPGEN.recentChance) ? rooms.length - 1 : rng.int(0, rooms.length - 1);
    const p = rooms[pi];
    const [dx, dz] = DIRS[rng.int(0, DIRS.length - 1)];
    const len = rng.int(MAPGEN.corridorLen[0], MAPGEN.corridorLen[1]);
    const cw = rng.int(MAPGEN.corridorWidth[0], MAPGEN.corridorWidth[1]);
    const big = rng.chance(MAPGEN.bigRoomChance);
    const span = big ? MAPGEN.bigRoomTiles : MAPGEN.roomTiles;
    const rw = rng.int(span[0], span[1]), rh = rng.int(span[0], span[1]);
    /** @type {Rect} */ let c;
    /** @type {RoomRect} */ let r;
    if (dx !== 0) {
      // 통로는 방 모서리에서 한 타일 안쪽(입구 양옆에 벽이 선다)
      const cz0 = rng.int(p.z0 + 1, p.z1 - 1 - cw);
      const cx0 = dx > 0 ? p.x1 : p.x0 - len;
      c = { x0: cx0, x1: cx0 + len, z0: cz0, z1: cz0 + cw };
      const rx0 = dx > 0 ? c.x1 : c.x0 - rw;
      const rz0 = rng.int(cz0 + cw + 1 - rh, cz0 - 1);
      r = { x0: rx0, x1: rx0 + rw, z0: rz0, z1: rz0 + rh, big };
    } else {
      const cx0 = rng.int(p.x0 + 1, p.x1 - 1 - cw);
      const cz0 = dz > 0 ? p.z1 : p.z0 - len;
      c = { x0: cx0, x1: cx0 + cw, z0: cz0, z1: cz0 + len };
      const rz0 = dz > 0 ? c.z1 : c.z0 - rh;
      const rx0 = rng.int(cx0 + cw + 1 - rw, cx0 - 1);
      r = { x0: rx0, x1: rx0 + rw, z0: rz0, z1: rz0 + rh, big };
    }
    if (r.x0 < M || r.z0 < M || r.x1 > G - M || r.z1 > G - M) continue;
    let bad = false;
    for (let i = 0; i < rooms.length && !bad; i++) if (hit(r, rooms[i], M) || (i !== pi && hit(c, rooms[i], M))) bad = true;
    for (let i = 0; i < cors.length && !bad; i++) if (hit(r, cors[i].rect, M) || hit(c, cors[i].rect, M)) bad = true;
    if (bad) continue;
    rooms.push(r);
    cors.push({ a: pi, b: rooms.length - 1, rect: c, axis: dx !== 0 ? 'x' : 'z' });
  }
  addLoops(rng, rooms, cors);
  const ok = rooms.length >= MAPGEN.rooms[0] && rooms.length <= MAPGEN.rooms[1];
  return { rooms, cors, ok };
}

/** (3) 고리 — 같은 x(또는 z) 범위가 겹치고 loopGap 타일 떨어진 방 쌍 사이 곧은 통로 0~2 @param {Rng} rng @param {RoomRect[]} rooms @param {Cor[]} cors */
function addLoops(rng, rooms, cors) {
  const want = rng.int(MAPGEN.loops[0], MAPGEN.loops[1]);
  if (want <= 0) return;
  const M = MAPGEN.margin, wMin = MAPGEN.corridorWidth[0];
  const pairKey = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;
  const linked = new Set(cors.map(c => pairKey(c.a, c.b)));
  /** @type {Array<{i:number, j:number, axis:'x'|'z', o0:number, o1:number, s0:number, s1:number}>} */
  const cand = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (linked.has(pairKey(i, j))) continue;
      const a = rooms[i], b = rooms[j];
      // z 방향 통로(x 범위가 겹친다)
      const xo0 = Math.max(a.x0, b.x0) + 1, xo1 = Math.min(a.x1, b.x1) - 1;
      if (xo1 - xo0 >= wMin) {
        const lo = a.z1 <= b.z0 ? a : b.z1 <= a.z0 ? b : null;
        if (lo) {
          const hi = lo === a ? b : a;
          const gap = hi.z0 - lo.z1;
          if (gap >= MAPGEN.loopGap[0] && gap <= MAPGEN.loopGap[1]) cand.push({ i, j, axis: 'z', o0: xo0, o1: xo1, s0: lo.z1, s1: hi.z0 });
        }
      }
      // x 방향 통로(z 범위가 겹친다)
      const zo0 = Math.max(a.z0, b.z0) + 1, zo1 = Math.min(a.z1, b.z1) - 1;
      if (zo1 - zo0 >= wMin) {
        const lo = a.x1 <= b.x0 ? a : b.x1 <= a.x0 ? b : null;
        if (lo) {
          const hi = lo === a ? b : a;
          const gap = hi.x0 - lo.x1;
          if (gap >= MAPGEN.loopGap[0] && gap <= MAPGEN.loopGap[1]) cand.push({ i, j, axis: 'x', o0: zo0, o1: zo1, s0: lo.x1, s1: hi.x0 });
        }
      }
    }
  }
  rng.shuffle(cand);
  let added = 0;
  for (const k of cand) {
    if (added >= want) break;
    if (linked.has(pairKey(k.i, k.j))) continue;
    const cw = Math.min(rng.int(MAPGEN.corridorWidth[0], MAPGEN.corridorWidth[1]), k.o1 - k.o0);
    const off = rng.int(k.o0, k.o1 - cw);
    /** @type {Rect} */
    const rect = k.axis === 'z' ? { x0: off, x1: off + cw, z0: k.s0, z1: k.s1 } : { x0: k.s0, x1: k.s1, z0: off, z1: off + cw };
    let bad = false;
    for (let r = 0; r < rooms.length && !bad; r++) if (r !== k.i && r !== k.j && hit(rect, rooms[r], M)) bad = true;
    for (let c = 0; c < cors.length && !bad; c++) if (hit(rect, cors[c].rect, M)) bad = true;
    if (bad) continue;
    cors.push({ a: k.i, b: k.j, rect, axis: k.axis });
    linked.add(pairKey(k.i, k.j));
    added++;
  }
}

/** 시작 방(0)에서 그래프 거리 @param {number} n @param {Cor[]} cors @returns {number[]} */
function roomDepths(n, cors) {
  const adj = Array.from({ length: n }, () => /** @type {number[]} */ ([]));
  for (const c of cors) { adj[c.a].push(c.b); adj[c.b].push(c.a); }
  const depth = new Array(n).fill(-1);
  depth[0] = 0;
  const q = [0];
  for (let k = 0; k < q.length; k++) {
    const a = q[k];
    for (const b of adj[a]) if (depth[b] < 0) { depth[b] = depth[a] + 1; q.push(b); }
  }
  return depth.map(d => (d < 0 ? 0 : d));
}

/** @param {Uint8Array} tiles @param {number} w @param {number} h */
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

/** @param {Rect} r @returns {Array<[number, number]>} */
function rectCells(r) {
  /** @type {Array<[number, number]>} */
  const out = [];
  for (let j = r.z0; j < r.z1; j++) for (let i = r.x0; i < r.x1; i++) out.push([i, j]);
  return out;
}

/** @param {RoomRect} r @param {number} id @param {number} depth @returns {Room} */
function toRoom(r, id, depth) {
  const x0 = r.x0 * TILE, z0 = r.z0 * TILE, x1 = r.x1 * TILE, z1 = r.z1 * TILE;
  return { id, x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, depth, kind: id === 0 ? 'start' : r.big ? 'big' : 'room' };
}

/**
 * 통로 입구에서 방 안쪽으로 MAPGEN.doorClear 타일 · 입구 양옆으로 doorClear 타일 넓힌 사각형(m) — 막는 소품 금지 구역(§8.7 「통로 입구 2타일 안 금지」)
 * @param {RoomRect} room @param {number} ri @param {Cor[]} cors @returns {Rect[]}
 */
function roomDoorZones(room, ri, cors) {
  const k = MAPGEN.doorClear;
  /** @type {Rect[]} */
  const out = [];
  for (const c of cors) {
    if (c.a !== ri && c.b !== ri) continue;
    const q = c.rect;
    // 타일 단위 — 입구 폭 [o0, o1) · 방 면에서 안쪽으로 k 타일(바깥으로 1 타일 — 방 밖이라 소품과 상관없다)
    /** @type {Rect|null} */
    let z = null;
    if (c.axis === 'x') {
      if (q.x1 === room.x0) z = { x0: room.x0 - 1, x1: room.x0 + k, z0: q.z0 - k, z1: q.z1 + k };
      else if (q.x0 === room.x1) z = { x0: room.x1 - k, x1: room.x1 + 1, z0: q.z0 - k, z1: q.z1 + k };
    } else {
      if (q.z1 === room.z0) z = { x0: q.x0 - k, x1: q.x1 + k, z0: room.z0 - 1, z1: room.z0 + k };
      else if (q.z0 === room.z1) z = { x0: q.x0 - k, x1: q.x1 + k, z0: room.z1 - k, z1: room.z1 + 1 };
    }
    if (z) out.push({ x0: z.x0 * TILE, z0: z.z0 * TILE, x1: z.x1 * TILE, z1: z.z1 * TILE });
  }
  return out;
}

// ───────────────────────── (5) 소품 ─────────────────────────

/**
 * 벽면에 붙인 자리(m) — 뒤에 벽(비바닥 타일)이 있는 곳만 · facing 은 방 안쪽
 * @param {Rng} rng @param {RoomRect} room @param {number} r @param {number} inset 벽면에서 원 중심까지
 * @param {Uint8Array} tiles @param {number} w @returns {{x:number, z:number, facing:number}|null}
 */
function wallSpot(rng, room, r, inset, tiles, w) {
  const X0 = room.x0 * TILE, X1 = room.x1 * TILE, Z0 = room.z0 * TILE, Z1 = room.z1 * TILE;
  const edge = r + MAPGEN.propEdge;
  const side = rng.int(0, 3);
  let x, z, nx = 0, nz = 0;
  if (side < 2) {
    z = rng.range(Z0 + edge, Z1 - edge);
    x = side === 0 ? X0 + inset : X1 - inset;
    nx = side === 0 ? 1 : -1;
    const ti = side === 0 ? room.x0 - 1 : room.x1;
    for (let tj = Math.floor((z - r) / TILE); tj <= Math.floor((z + r) / TILE); tj++) if (tiles[tj * w + ti] === TILE_FLOOR) return null;
  } else {
    x = rng.range(X0 + edge, X1 - edge);
    z = side === 2 ? Z0 + inset : Z1 - inset;
    nz = side === 2 ? 1 : -1;
    const tj = side === 2 ? room.z0 - 1 : room.z1;
    for (let ti = Math.floor((x - r) / TILE); ti <= Math.floor((x + r) / TILE); ti++) if (tiles[tj * w + ti] === TILE_FLOOR) return null;
  }
  return { x, z, facing: yawOf(nx, nz) };
}

/**
 * 소품 하나가 그 자리에 놓여도 되는가 — 막는 소품: 입구 구역 밖 · 시작점에서 떨어짐 · 다른 소품과 겹치지 않고 막는 것끼리는 propGap 틈
 * @param {{x:number, z:number, r:number, block:boolean}} p @param {Prop[]} placed @param {Rect[]} doors @param {{x:number, z:number}|null} spawn
 */
function propFits(p, placed, doors, spawn) {
  if (p.block) {
    for (const d of doors) if (circleRect(p.x, p.z, p.r, d.x0, d.z0, d.x1, d.z1)) return false;
    if (spawn && Math.hypot(p.x - spawn.x, p.z - spawn.z) < MAPGEN.spawnPropClear + p.r) return false;
  }
  for (const q of placed) {
    const need = p.r + q.r + (p.block && q.block ? MAPGEN.propGap : 0);
    if (Math.hypot(p.x - q.x, p.z - q.z) < need) return false;
  }
  return true;
}

/**
 * 방 하나의 소품 — 큰 방(짧은 변 ≥ pillarRoomMin)은 where 'room' 소품 배열(기둥 · 석순) + 그 밖 소품 propsPerRoom 개(가중치 뽑기)
 * @param {Rng} rng @param {TilesetDef} ts @param {RoomRect} room @param {{x:number, z:number}|null} spawn @param {Rect[]} doors
 * @param {Uint8Array} tiles @param {number} w @param {Prop[]} props @param {Prop[]} mine
 */
function placeProps(rng, ts, room, spawn, doors, tiles, w, props, mine) {
  const X0 = room.x0 * TILE, X1 = room.x1 * TILE, Z0 = room.z0 * TILE, Z1 = room.z1 * TILE;
  const add = (def, x, z, facing) => {
    const p = { id: props.length + 1, kind: def.kind, x, z, facing, r: def.r, h: def.h, block: def.block };
    if (!propFits(p, mine, doors, spawn)) return false;
    props.push(p);
    mine.push(p);
    return true;
  };
  const sw = room.x1 - room.x0, sh = room.z1 - room.z0;
  // 큰 방 — 기둥 배열(축마다 2개 · 긴 축은 3개)
  const roomDefs = ts.props.filter(d => d.where === 'room');
  if (Math.min(sw, sh) >= MAPGEN.pillarRoomMin && roomDefs.length) {
    const di = rng.pickIndex(roomDefs.map(d => d.weight));
    const def = roomDefs[di < 0 ? 0 : di];
    const jit = def.jitter ?? 0;
    const nx = sw >= MAPGEN.pillarTripleTiles ? MAPGEN.pillarGrid[1] : MAPGEN.pillarGrid[0];
    const nz = sh >= MAPGEN.pillarTripleTiles ? MAPGEN.pillarGrid[1] : MAPGEN.pillarGrid[0];
    for (let a = 1; a <= nx; a++) {
      for (let b = 1; b <= nz; b++) {
        const x = X0 + (X1 - X0) * a / (nx + 1) + (jit > 0 ? rng.range(-jit, jit) : 0);
        const z = Z0 + (Z1 - Z0) * b / (nz + 1) + (jit > 0 ? rng.range(-jit, jit) : 0);
        add(def, x, z, jit > 0 ? rng.range(0, Math.PI * 2) : 0);
      }
    }
  }
  // 그 밖 소품 — 벽 · 바닥
  const defs = ts.props.filter(d => d.where !== 'room');
  if (!defs.length) return;
  const n = rng.int(MAPGEN.propsPerRoom[0], MAPGEN.propsPerRoom[1]);
  /** 한 kind 로 propTries 번 @param {any} def */
  const tryDef = (def) => {
    for (let t = 0; t < MAPGEN.propTries; t++) {
      if (def.where === 'wall') {
        const at = wallSpot(rng, room, def.r, def.r + MAPGEN.wallGap, tiles, w);
        if (at && add(def, at.x, at.z, at.facing)) return true;
      } else {
        const inset = def.r + (def.block ? MAPGEN.propGap : MAPGEN.propEdge);
        if (X1 - X0 <= inset * 2 || Z1 - Z0 <= inset * 2) return false;
        const x = rng.range(X0 + inset, X1 - inset), z = rng.range(Z0 + inset, Z1 - inset);
        if (add(def, x, z, rng.range(0, Math.PI * 2))) return true;
      }
    }
    return false;
  };
  for (let k = 0; k < n; k++) {
    // 가중치로 고른 kind 가 들어갈 자리가 없으면(입구 · 시작점 둘레) 남은 kind 를 다시 가중치로 — 방마다 propsPerRoom 개를 채운다
    const weights = defs.map(d => d.weight);
    for (let left = defs.length; left > 0; left--) {
      const di = rng.pickIndex(weights);
      if (di < 0) break;
      if (tryDef(defs[di])) break;
      weights[di] = 0;
    }
  }
}

// ───────────────────────── (6) 빛 ─────────────────────────

/**
 * 방마다 lights.perRoom 개 — kind 를 고르고, 그 kind 의 prop 소품이 방에 있으면 그 자리 · 아니면 where(벽면 · 바닥)
 * @param {Rng} rng @param {TilesetDef} ts @param {RoomRect} room @param {Prop[]} mine @param {Uint8Array} tiles @param {number} w @param {LightDef[]} lights
 */
function placeLights(rng, ts, room, mine, tiles, w, lights) {
  const kinds = ts.lights.kinds;
  if (!kinds.length) return;
  const X0 = room.x0 * TILE, X1 = room.x1 * TILE, Z0 = room.z0 * TILE, Z1 = room.z1 * TILE;
  const n = rng.int(ts.lights.perRoom[0], ts.lights.perRoom[1]);
  /** @type {LightDef[]} */
  const here = [];
  const used = new Set();
  const far = (x, z) => here.every(l => Math.hypot(l.x - x, l.z - z) >= MAPGEN.lightSpacing);
  const clearOfProps = (x, z) => mine.every(p => !p.block || Math.hypot(p.x - x, p.z - z) >= p.r + MAPGEN.propEdge);
  for (let k = 0; k < n; k++) {
    const kd = kinds[rng.int(0, kinds.length - 1)];
    let at = null;
    if (kd.prop) {
      const host = mine.find(p => p.kind === kd.prop && !used.has(p.id) && far(p.x, p.z));
      if (host) { used.add(host.id); at = { x: host.x, z: host.z }; }
    }
    for (let t = 0; t < MAPGEN.lightTries && !at; t++) {
      let x, z;
      if (kd.where === 'wall') {
        const sp = wallSpot(rng, room, MAPGEN.propEdge, MAPGEN.lightWallInset, tiles, w);
        if (!sp) continue;
        x = sp.x; z = sp.z;
      } else {
        const ins = MAPGEN.lightFloorInset;
        if (X1 - X0 <= ins * 2 || Z1 - Z0 <= ins * 2) break;
        x = rng.range(X0 + ins, X1 - ins); z = rng.range(Z0 + ins, Z1 - ins);
      }
      if (far(x, z) && clearOfProps(x, z)) at = { x, z };
    }
    if (!at) continue;
    const l = { x: at.x, y: kd.y, z: at.z, color: kd.color, intensity: kd.intensity, radius: kd.radius, flicker: kd.flicker, kind: kd.kind };
    here.push(l);
    lights.push(l);
  }
}

// ───────────────────────── (8) 내비 · (9) 닿지 않는 칸 ─────────────────────────

/** 바닥 타일의 4 × 4 칸 중 막는 소품 원과 겹치지 않는 칸 = 0 @param {Uint8Array} tiles @param {number} w @param {number} h @param {Prop[]} props */
function buildNav(tiles, w, h, props) {
  const nw = w * NAV_PER_TILE, nh = h * NAV_PER_TILE;
  const nav = new Uint8Array(nw * nh).fill(1);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (tiles[j * w + i] !== TILE_FLOOR) continue;
    for (let b = 0; b < NAV_PER_TILE; b++) {
      const row = (j * NAV_PER_TILE + b) * nw + i * NAV_PER_TILE;
      for (let a = 0; a < NAV_PER_TILE; a++) nav[row + a] = 0;
    }
  }
  for (const p of props) {
    if (!p.block) continue;
    const u0 = Math.max(0, Math.floor((p.x - p.r) / NAV_CELL)), u1 = Math.min(nw - 1, Math.floor((p.x + p.r) / NAV_CELL));
    const v0 = Math.max(0, Math.floor((p.z - p.r) / NAV_CELL)), v1 = Math.min(nh - 1, Math.floor((p.z + p.r) / NAV_CELL));
    for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) {
      if (circleRect(p.x, p.z, p.r, u * NAV_CELL, v * NAV_CELL, (u + 1) * NAV_CELL, (v + 1) * NAV_CELL)) nav[v * nw + u] = 1;
    }
  }
  return nav;
}

/**
 * (9) spawn 에서 닿지 않는 칸을 막는다 — ① 몸 반지름 MAPGEN.bodyR 가 들어가는 칸으로 spawn 에서 BFS 해 그 칸 · 그 8이웃이 아닌 걸을 수 있는 칸
 * (소품 틈 · 벽과 소품 사이 좁은 틈) ② 4이웃 BFS 로 닿지 않는 칸(8방향 · 모서리 자르기 금지와 같은 연결). spawn 칸이 몸에 맞으면 true
 * @param {MapData} map @param {{x:number, z:number}} spawn
 */
function pruneUnreachable(map, spawn) {
  const { nw, nh, nav } = map;
  const n = nw * nh;
  const su = Math.floor(spawn.x / NAV_CELL), sv = Math.floor(spawn.z / NAV_CELL);
  const s = sv * nw + su;
  if (su < 0 || sv < 0 || su >= nw || sv >= nh || nav[s] !== 0) return false;
  const half = NAV_CELL / 2;
  // ① 몸이 들어가는 칸끼리 BFS
  const reach = new Uint8Array(n);   // 1 = 몸이 들어가는 칸으로 닿음
  const q = new Int32Array(n);
  const fitMemo = new Uint8Array(n);   // 0 모름 · 1 들어감 · 2 안 들어감
  const fits = (i) => {
    if (nav[i] !== 0) return false;
    if (fitMemo[i] === 0) fitMemo[i] = isWalkableR(map, (i % nw) * NAV_CELL + half, Math.floor(i / nw) * NAV_CELL + half, MAPGEN.bodyR) ? 1 : 2;
    return fitMemo[i] === 1;
  };
  const spawnFits = fits(s);
  let qh = 0, qt = 0;
  if (spawnFits) { reach[s] = 1; q[qt++] = s; }
  while (qh < qt) {
    const i = q[qh++];
    const u = i % nw, v = (i - u) / nw;
    for (const [du, dv] of N4) {
      const uu = u + du, vv = v + dv;
      if (uu < 0 || vv < 0 || uu >= nw || vv >= nh) continue;
      const k = vv * nw + uu;
      if (reach[k] || !fits(k)) continue;
      reach[k] = 1;
      q[qt++] = k;
    }
  }
  if (spawnFits) {
    for (let i = 0; i < n; i++) {
      if (nav[i] !== 0 || reach[i]) continue;
      const u = i % nw, v = (i - u) / nw;
      let touch = false;
      for (let dv = -1; dv <= 1 && !touch; dv++) for (let du = -1; du <= 1; du++) {
        const uu = u + du, vv = v + dv;
        if (uu >= 0 && vv >= 0 && uu < nw && vv < nh && reach[vv * nw + uu] === 1) { touch = true; break; }
      }
      if (!touch) nav[i] = 1;
    }
  }
  // ② 4이웃 BFS
  const seen = new Uint8Array(n);
  qh = 0; qt = 0;
  seen[s] = 1; q[qt++] = s;
  while (qh < qt) {
    const i = q[qh++];
    const u = i % nw, v = (i - u) / nw;
    for (const [du, dv] of N4) {
      const uu = u + du, vv = v + dv;
      if (uu < 0 || vv < 0 || uu >= nw || vv >= nh) continue;
      const k = vv * nw + uu;
      if (seen[k] || nav[k] !== 0) continue;
      seen[k] = 1;
      q[qt++] = k;
    }
  }
  for (let i = 0; i < n; i++) if (nav[i] === 0 && !seen[i]) nav[i] = 1;
  return spawnFits;
}

// ───────────────────────── (7) 팩 자리 ─────────────────────────

/**
 * 팩 자리(§7.12) — 정예(가장 깊은 방부터) → 챔피언(depth ≥ eliteMinDepth 인 나머지 방을 무작위로) → 일반(방 면적 / normalPerArea 를 [2, 5]로 ·
 * 길이 ≥ corridorSlotMinLen 통로에 1). 모두 서로 slotSpacing · 시작점에서 spawnClear 밖 · slotClearR 원이 걸을 수 있다
 * @param {Rng} rng @param {MapData} map @param {RoomRect[]} rooms @param {Cor[]} cors @param {number[]} depth @param {import('../../types.js').RiftRow} row
 */
function placeSlots(rng, map, rooms, cors, depth, row) {
  /** @type {PackSlot[]} */
  const list = [];
  const sp = map.spawn;
  const okAt = (x, z) => {
    if (Math.hypot(x - sp.x, z - sp.z) < MAPGEN.spawnClear) return false;
    for (const q of list) if (Math.hypot(x - q.x, z - q.z) < MAPGEN.slotSpacing) return false;
    return isWalkableR(map, x, z, MAPGEN.slotClearR);
  };
  /** 방 안 자리 — slotTries 개 후보 중 다른 자리와 가장 먼 것(최선 후보 표집 · 좁은 방에도 고르게 들어간다) @param {number} ri @param {'normal'|'champion'|'elite'} kind */
  const inRoom = (ri, kind) => {
    const r = rooms[ri];
    const X0 = r.x0 * TILE, X1 = r.x1 * TILE, Z0 = r.z0 * TILE, Z1 = r.z1 * TILE;
    const ins = MAPGEN.slotInset;
    let bx = 0, bz = 0, best = -1;
    for (let t = 0; t < MAPGEN.slotTries; t++) {
      const x = rng.range(X0 + ins, X1 - ins), z = rng.range(Z0 + ins, Z1 - ins);
      if (!okAt(x, z)) continue;
      let d = Infinity;
      for (const q of list) {
        const dq = Math.hypot(x - q.x, z - q.z);
        if (dq < d) d = dq;
      }
      if (d > best) { best = d; bx = x; bz = z; }
    }
    if (best < 0) return false;
    list.push({ id: list.length + 1, roomId: ri, x: bx, z: bz, kind, depth: depth[ri] });
    return true;
  };
  // 챔피언 · 정예 — depth ≥ eliteMinDepth 인 방을 깊은 순(같은 깊이는 무작위)
  const keyOf = rooms.map(() => rng.next());
  const deep = rooms.map((_, i) => i).filter(i => depth[i] >= MAPGEN.eliteMinDepth);
  deep.sort((a, b) => depth[b] - depth[a] || keyOf[a] - keyOf[b] || a - b);
  let elite = 0, champion = 0;
  /** 정예: 가장 깊은 방부터 한 방에 하나씩(방이 모자라면 다시 돈다) */
  const eliteRooms = new Set();
  let cursor = 0;
  for (let k = 0; k < row.elitePacks && deep.length; k++) {
    for (let t = 0; t < deep.length; t++) {
      const ri = deep[(cursor + t) % deep.length];
      if (inRoom(ri, 'elite')) { elite++; eliteRooms.add(ri); cursor = (cursor + t + 1) % deep.length; break; }
    }
  }
  /** 챔피언: 정예가 없는 깊은 방을 무작위 순서로 한 방에 하나씩 → 모자라면 깊은 방 전부를 다시 */
  const rest = deep.filter(i => !eliteRooms.has(i));
  rng.shuffle(rest);
  const order = [...rest, ...deep];
  cursor = 0;
  for (let k = 0; k < row.championPacks && order.length; k++) {
    for (let t = 0; t < order.length; t++) {
      const ri = order[(cursor + t) % order.length];
      if (inRoom(ri, 'champion')) { champion++; cursor = (cursor + t + 1) % order.length; break; }
    }
  }
  // 일반 — 방
  for (let ri = 0; ri < rooms.length; ri++) {
    const want = Math.min(MAPGEN.normalPerRoom[1], Math.max(MAPGEN.normalPerRoom[0], Math.round(area(rooms[ri]) / MAPGEN.normalPerArea)));
    for (let k = 0; k < want; k++) inRoom(ri, 'normal');
  }
  // 일반 — 긴 통로 가운데
  for (const c of cors) {
    const q = c.rect;
    const len = c.axis === 'x' ? q.x1 - q.x0 : q.z1 - q.z0;
    if (len < MAPGEN.corridorSlotMinLen) continue;
    const mx = (q.x0 + q.x1) / 2 * TILE, mz = (q.z0 + q.z1) / 2 * TILE;
    const ri = depth[c.a] <= depth[c.b] ? c.a : c.b;
    if (okAt(mx, mz)) list.push({ id: list.length + 1, roomId: ri, x: mx, z: mz, kind: 'normal', depth: Math.min(depth[c.a], depth[c.b]) });
  }
  // 일반 — 바닥(normalMin): 방이 적은 맵도 놓인 게이지가 100%를 넉넉히 넘게(§7.14 「일반 팩 ~60」) 넓은 방부터 하나씩 더한다
  const byArea = rooms.map((_, i) => i).sort((a, b) => area(rooms[b]) - area(rooms[a]) || a - b);
  let normals = list.filter(q => q.kind === 'normal').length;
  for (let added = 1; normals < MAPGEN.normalMin && added > 0;) {
    added = 0;
    for (const ri of byArea) {
      if (normals >= MAPGEN.normalMin) break;
      if (inRoom(ri, 'normal')) { normals++; added++; }
    }
  }
  return { list, elite, champion, normal: normals };
}
