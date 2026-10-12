// OWNER: P4 — 계약 §12.2 · §8.7 · §7.12
// 균열 생성: 결정성 · 방 10~14 · 통로 4~6m · 모든 바닥이 spawn 에서 닿는다(몸 반지름 포함 — 고립된 소품 틈 없음) · 팩 자리 규칙(18m · 6m · 깊이)
// · 생성 ≤ 150ms(시드 20개 최대) · 타일셋 2의 소품 · 빛 · 마을 맵 물체(§7.12 표 그대로)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_CELL, NAV_PER_TILE, TILE, TILE_FLOOR, TILE_VOID, TILE_WALL, TOWN_OBJECT_IDS } from '../src/core/constants.js';
import { hash32 } from '../src/core/hash.js';
import { getTileset } from '../src/data/index.js';
import { MAPGEN } from '../src/data/mapgen.js';
import { riftRow } from '../src/data/rift.js';
import { TILESETS } from '../src/data/tilesets.js';
import { TOWN } from '../src/data/town.js';
import { townMapFromData } from '../src/debug/fixtureMap.js';
import { generateRift } from '../src/sim/world/mapgen.js';
import { isWalkable, isWalkableR, cellIndex } from '../src/sim/world/nav.js';
import { findPath } from '../src/sim/world/path.js';
import { buildTownMap } from '../src/sim/world/townMap.js';

/** @typedef {import('../src/types.js').MapData} MapData */

const SEEDS = Array.from({ length: 20 }, (_, i) => hash32(i + 1, 77));
const LEVELS = [1, 5, 10, 20];
/** 시드 20 × 레벨 4 — 한 번만 만든다 */
const MAPS = [];
for (const s of SEEDS) for (const L of LEVELS) MAPS.push({ seed: s, level: L, map: generateRift(s, L) });

/** 4이웃 BFS(8방향 · 모서리 자르기 금지와 같은 연결) — 걸을 수 있는 칸 중 시작에서 닿는 것 @param {MapData} map @param {number} start @param {(i:number)=>boolean} ok */
function bfs(map, start, ok) {
  const seen = new Uint8Array(map.nw * map.nh);
  if (start < 0 || !ok(start)) return seen;
  const q = [start];
  seen[start] = 1;
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    const u = i % map.nw, v = (i - u) / map.nw;
    for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const uu = u + du, vv = v + dv;
      if (uu < 0 || vv < 0 || uu >= map.nw || vv >= map.nh) continue;
      const j = vv * map.nw + uu;
      if (seen[j] || !ok(j)) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return seen;
}

const centerOf = (map, i) => ({ x: (i % map.nw + 0.5) * NAV_CELL, z: (Math.floor(i / map.nw) + 0.5) * NAV_CELL });

test('결정성 — 같은 시드 · 레벨 = 같은 맵(타일 · 내비 · 방 · 소품 · 빛 · 팩 자리) · 다른 시드 = 다른 맵', () => {
  for (const { seed, level, map } of MAPS.slice(0, 12)) {
    const again = generateRift(seed, level);
    assert.deepEqual(again, map, `시드 ${seed} L${level}`);
  }
  const a = generateRift(SEEDS[0], 1), b = generateRift(SEEDS[1], 1);
  assert.notDeepEqual(a.tiles, b.tiles);
  // 레벨은 맵 id · 타일셋 · 팩 수에 들어간다
  assert.equal(a.id, `rift:${SEEDS[0]}:1`);
  assert.equal(generateRift(SEEDS[0], 5).id, `rift:${SEEDS[0]}:5`);
  // 이상한 입력에도 던지지 않고 같은 꼴
  for (const [s, L] of [[0, 0], [-3, 1.7], [NaN, 200], [2 ** 32 + 5, -4]]) {
    const m = generateRift(s, L);
    assert.equal(m.kind, 'rift');
    assert.ok(m.rooms.length >= MAPGEN.rooms[0]);
  }
});

test('모양 — MapData 필드 · 내비 = 타일 × 4 · 좌표 ≥ 0 · 벽 = 바닥에 8방향으로 닿는 비바닥 · 가장자리는 바닥이 아니다', () => {
  for (const { map } of MAPS) {
    assert.equal(map.kind, 'rift');
    assert.ok(['crypt', 'cavern'].includes(map.tileset));
    assert.equal(map.nw, map.w * NAV_PER_TILE);
    assert.equal(map.nh, map.h * NAV_PER_TILE);
    assert.ok(map.tiles instanceof Uint8Array && map.tiles.length === map.w * map.h);
    assert.ok(map.nav instanceof Uint8Array && map.nav.length === map.nw * map.nh);
    assert.ok(map.w <= MAPGEN.gridMax + MAPGEN.cropPad * 2 && map.h <= MAPGEN.gridMax + MAPGEN.cropPad * 2);
    assert.deepEqual(map.objects, []);
    for (let j = 0; j < map.h; j++) for (let i = 0; i < map.w; i++) {
      const t = map.tiles[j * map.w + i];
      if (i === 0 || j === 0 || i === map.w - 1 || j === map.h - 1) assert.notEqual(t, TILE_FLOOR, '가장자리 바닥');
      if (t === TILE_FLOOR) continue;
      let near = false;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < map.w && jj < map.h && map.tiles[jj * map.w + ii] === TILE_FLOOR) near = true;
      }
      assert.equal(t, near ? TILE_WALL : TILE_VOID, `타일 (${i}, ${j})`);
    }
    // 걸을 수 있는 칸은 바닥 타일 위에만
    for (let v = 0; v < map.nh; v++) for (let u = 0; u < map.nw; u++) {
      if (map.nav[v * map.nw + u] !== 0) continue;
      assert.equal(map.tiles[Math.floor(v / NAV_PER_TILE) * map.w + Math.floor(u / NAV_PER_TILE)], TILE_FLOOR);
    }
    const b = map.bounds;
    assert.ok(b.x0 >= 0 && b.z0 >= 0 && b.x1 > b.x0 && b.z1 > b.z0 && b.x1 <= map.w * TILE && b.z1 <= map.h * TILE);
    for (const r of map.rooms) assert.ok(r.x0 >= b.x0 && r.x1 <= b.x1 && r.z0 >= b.z0 && r.z1 <= b.z1);
    // 시작점 — 시작 방 가운데 · 몸이 들어간다 · facing 유한
    const start = map.rooms[0];
    assert.equal(start.kind, 'start');
    assert.equal(start.depth, 0);
    assert.equal(map.spawn.x, start.cx);
    assert.equal(map.spawn.z, start.cz);
    assert.ok(Number.isFinite(map.spawn.facing));
    assert.ok(isWalkableR(map, map.spawn.x, map.spawn.z, MAPGEN.spawnPropClear - 1), '시작점 둘레가 트였다');
  }
});

test('방 10~14 · 크기(시작 8~9 · 보통 8~13 · 큰 방 13~16 타일) · 깊이 = 시작 방에서 그래프 거리 · 서로 margin 타일 떨어진다', () => {
  let big = 0;
  for (const { map } of MAPS) {
    assert.ok(map.rooms.length >= MAPGEN.rooms[0] && map.rooms.length <= MAPGEN.rooms[1], `방 ${map.rooms.length}`);
    map.rooms.forEach((r, i) => {
      assert.equal(r.id, i);
      const sw = (r.x1 - r.x0) / TILE, sh = (r.z1 - r.z0) / TILE;
      const span = r.kind === 'start' ? MAPGEN.startRoomTiles : r.kind === 'big' ? MAPGEN.bigRoomTiles : MAPGEN.roomTiles;
      for (const sd of [sw, sh]) assert.ok(Number.isInteger(sd) && sd >= span[0] && sd <= span[1], `${r.kind} ${sd}`);
      assert.equal(r.cx, (r.x0 + r.x1) / 2);
      assert.equal(r.cz, (r.z0 + r.z1) / 2);
      if (r.kind === 'big') big++;
      // 방 바닥은 전부 바닥 타일
      for (let j = r.z0 / TILE; j < r.z1 / TILE; j++) for (let i = r.x0 / TILE; i < r.x1 / TILE; i++) assert.equal(map.tiles[j * map.w + i], TILE_FLOOR);
      for (let k = i + 1; k < map.rooms.length; k++) {
        const o = map.rooms[k], m = MAPGEN.margin * TILE;
        const overlap = r.x0 - m < o.x1 && o.x0 < r.x1 + m && r.z0 - m < o.z1 && o.z0 < r.z1 + m;
        assert.ok(!overlap, `방 ${i} · ${k} 이 margin 안`);
      }
    });
    // 깊이 = BFS 거리
    const adj = map.rooms.map(() => []);
    for (const c of map.corridors) { adj[c.a].push(c.b); adj[c.b].push(c.a); }
    const d = map.rooms.map(() => -1);
    d[0] = 0;
    const q = [0];
    for (let k = 0; k < q.length; k++) for (const b of adj[q[k]]) if (d[b] < 0) { d[b] = d[q[k]] + 1; q.push(b); }
    assert.deepEqual(map.rooms.map(r => r.depth), d, '깊이');
    assert.ok(d.every(x => x >= 0), '모든 방이 그래프로 이어진다');
    // 나무(방 수 − 1) + 고리 0~2
    const extra = map.corridors.length - (map.rooms.length - 1);
    assert.ok(extra >= MAPGEN.loops[0] && extra <= MAPGEN.loops[1], `고리 ${extra}`);
  }
  assert.ok(big > 0, '큰 방이 나온다');
});

test('통로 폭 4~6m — 단면마다 바닥 2~3타일 · 양옆은 벽 · 막는 소품 없이 내비도 그 폭', () => {
  const widths = new Set();
  for (const { map } of MAPS) {
    for (const c of map.corridors) {
      assert.ok(c.cells.length > 0);
      const is = c.cells.map(q => q[0]), js = c.cells.map(q => q[1]);
      const i0 = Math.min(...is), i1 = Math.max(...is), j0 = Math.min(...js), j1 = Math.max(...js);
      assert.equal(c.cells.length, (i1 - i0 + 1) * (j1 - j0 + 1), '통로는 사각형');
      // 방 a · b 사이를 잇는다 — 축 방향 끝이 두 방에 닿는다
      const ra = map.rooms[c.a], rb = map.rooms[c.b];
      assert.ok(ra && rb && c.a !== c.b);
      const alongX = [ra, rb].every(r => r.x1 / TILE === i0 || r.x0 / TILE === i1 + 1);
      const alongZ = [ra, rb].every(r => r.z1 / TILE === j0 || r.z0 / TILE === j1 + 1);
      assert.ok(alongX !== alongZ, '한 축으로 두 방에 닿는다');
      const width = alongX ? j1 - j0 + 1 : i1 - i0 + 1;
      const len = alongX ? i1 - i0 + 1 : j1 - j0 + 1;
      widths.add(width);
      assert.ok(width * TILE >= 4 && width * TILE <= 6, `통로 폭 ${width * TILE}m`);
      assert.ok(len >= 1);
      // 단면마다: 폭 바깥 양옆 타일은 바닥이 아니다(다른 바닥과 붙어 넓어지지 않는다) · 내비 칸 = 폭 × 4 모두 걸을 수 있다
      for (let s = alongX ? i0 : j0; s <= (alongX ? i1 : j1); s++) {
        const side = alongX ? [[s, j0 - 1], [s, j1 + 1]] : [[i0 - 1, s], [i1 + 1, s]];
        for (const [i, j] of side) assert.notEqual(map.tiles[j * map.w + i], TILE_FLOOR, `통로 옆 (${i}, ${j})`);
        let walk = 0;
        for (let k = 0; k < width * NAV_PER_TILE; k++) {
          const u = alongX ? s * NAV_PER_TILE + 1 : i0 * NAV_PER_TILE + k;
          const v = alongX ? j0 * NAV_PER_TILE + k : s * NAV_PER_TILE + 1;
          if (map.nav[v * map.nw + u] === 0) walk++;
        }
        assert.equal(walk, width * NAV_PER_TILE, '통로 단면이 다 걸을 수 있다');
      }
    }
  }
  assert.deepEqual([...widths].sort(), [2, 3], '폭 2 · 3 타일이 둘 다 나온다');
});

test('모든 바닥이 spawn 에서 닿는다 — 걸을 수 있는 칸 전부 · 방마다 · 몸(0.4m)이 닿지 못하는 고립 틈 없음 · 막는 소품 칸은 막힘', () => {
  for (const { map } of MAPS) {
    const s = cellIndex(map, map.spawn.x, map.spawn.z);
    const seen = bfs(map, s, i => map.nav[i] === 0);
    let walk = 0, reached = 0;
    for (let i = 0; i < map.nav.length; i++) if (map.nav[i] === 0) { walk++; if (seen[i]) reached++; }
    assert.equal(reached, walk, `${map.id}: 닿지 않는 칸 ${walk - reached}`);
    // 몸이 들어가는 칸끼리 닿는 영역 — 걸을 수 있는 칸은 모두 그 칸이거나 그 칸의 8이웃
    const fit = (i) => map.nav[i] === 0 && isWalkableR(map, centerOf(map, i).x, centerOf(map, i).z, MAPGEN.bodyR);
    const body = bfs(map, s, fit);
    for (let i = 0; i < map.nav.length; i++) {
      if (map.nav[i] !== 0 || body[i]) continue;
      const u = i % map.nw, v = (i - u) / map.nw;
      let touch = false;
      for (let dv = -1; dv <= 1; dv++) for (let du = -1; du <= 1; du++) if (body[(v + dv) * map.nw + u + du]) touch = true;
      assert.ok(touch, `${map.id}: 몸이 닿지 못하는 틈 칸 (${u}, ${v})`);
    }
    // 방마다 몸이 서는 칸이 있다
    for (const r of map.rooms) {
      let any = false;
      for (let z = r.z0 + 0.25; z < r.z1 && !any; z += NAV_CELL) for (let x = r.x0 + 0.25; x < r.x1; x += NAV_CELL) if (body[cellIndex(map, x, z)]) { any = true; break; }
      assert.ok(any, `${map.id}: 방 ${r.id} 에 닿지 못한다`);
    }
    for (const p of map.props) if (p.block) assert.ok(!isWalkable(map, p.x, p.z), `막는 소품 ${p.kind} 칸이 막혔다`);
  }
});

test('타일셋 — hash32(seed, level, 9) % 2 · 두 타일셋 다 나온다 · 소품 kind · r · h · 막음이 그 타일셋 표 · 방마다 소품 2~6 · 큰 방에 기둥', () => {
  const rifts = TILESETS.filter(t => t.weight > 0);
  const seenTs = new Set();
  for (const { seed, level, map } of MAPS) {
    assert.equal(map.tileset, rifts[hash32(seed, level, 9) % rifts.length].id);
    seenTs.add(map.tileset);
    const ts = getTileset(map.tileset);
    const byKind = Object.fromEntries(ts.props.map(d => [d.kind, d]));
    const ids = new Set();
    for (const p of map.props) {
      const d = byKind[p.kind];
      assert.ok(d, `${map.tileset} 소품 ${p.kind}`);
      assert.equal(p.r, d.r); assert.equal(p.h, d.h); assert.equal(p.block, d.block);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.facing));
      assert.ok(!ids.has(p.id)); ids.add(p.id);
    }
    for (const r of map.rooms) {
      const inside = map.props.filter(p => p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1);
      for (const p of inside) {
        // 원이 방 안에 있다
        assert.ok(p.x - p.r >= r.x0 - 1e-9 && p.x + p.r <= r.x1 + 1e-9 && p.z - p.r >= r.z0 - 1e-9 && p.z + p.r <= r.z1 + 1e-9, `${p.kind} 이 방 밖으로`);
        const d = byKind[p.kind];
        if (d.where === 'wall') {
          const gap = Math.min(p.x - r.x0, r.x1 - p.x, p.z - r.z0, r.z1 - p.z) - p.r;
          assert.ok(Math.abs(gap - MAPGEN.wallGap) < 1e-9, `벽 소품 ${p.kind} 이 벽에 붙는다(${gap})`);
        }
        if (d.block && d.where === 'floor') {
          const gap = Math.min(p.x - r.x0, r.x1 - p.x, p.z - r.z0, r.z1 - p.z) - p.r;
          assert.ok(gap >= MAPGEN.propGap - 1e-9, '막는 바닥 소품과 벽 사이 틈');
        }
      }
      const others = inside.filter(p => byKind[p.kind].where !== 'room');
      assert.ok(others.length >= MAPGEN.propsPerRoom[0] && others.length <= MAPGEN.propsPerRoom[1], `${map.id} 방 ${r.id} 소품 ${others.length}`);
      const minSide = Math.min(r.x1 - r.x0, r.z1 - r.z0) / TILE;
      const pillars = inside.filter(p => byKind[p.kind].where === 'room');
      if (minSide >= MAPGEN.pillarRoomMin) assert.ok(pillars.length >= 1, `큰 방(${minSide})에 기둥`);
      else assert.equal(pillars.length, 0, '작은 방에는 기둥이 없다');
      // 막는 소품끼리 propGap 틈
      const blocks = inside.filter(p => p.block);
      for (let a = 0; a < blocks.length; a++) for (let b = a + 1; b < blocks.length; b++) {
        const d = Math.hypot(blocks[a].x - blocks[b].x, blocks[a].z - blocks[b].z) - blocks[a].r - blocks[b].r;
        assert.ok(d >= MAPGEN.propGap - 1e-9, '막는 소품 사이 틈');
      }
    }
    // 소품 평균 — 방마다 2~6 의 기대값 근처
    assert.ok(map.props.length >= map.rooms.length * MAPGEN.propsPerRoom[0] * 0.75, `소품 ${map.props.length}`);
  }
  assert.deepEqual([...seenTs].sort(), ['cavern', 'crypt']);
});

test('막는 소품은 통로 입구 2타일 안에 없다 · 시작점 둘레 spawnPropClear 안에 없다', () => {
  const k = MAPGEN.doorClear * TILE;
  for (const { map } of MAPS) {
    for (const c of map.corridors) {
      const is = c.cells.map(q => q[0]), js = c.cells.map(q => q[1]);
      const i0 = Math.min(...is) * TILE, i1 = (Math.max(...is) + 1) * TILE, j0 = Math.min(...js) * TILE, j1 = (Math.max(...js) + 1) * TILE;
      for (const ri of [c.a, c.b]) {
        const r = map.rooms[ri];
        // 입구 = 통로 끝이 방 면에 닿는 선분 → 방 안쪽으로 2타일 · 양옆으로 2타일
        let zone = null;
        if (i1 === r.x0) zone = [r.x0, j0 - k, r.x0 + k, j1 + k];
        else if (i0 === r.x1) zone = [r.x1 - k, j0 - k, r.x1, j1 + k];
        else if (j1 === r.z0) zone = [i0 - k, r.z0, i1 + k, r.z0 + k];
        else if (j0 === r.z1) zone = [i0 - k, r.z1 - k, i1 + k, r.z1];
        assert.ok(zone, `${map.id}: 통로 ${c.a}–${c.b} 가 방 ${ri} 면에 닿는다`);
        const [x0, z0, x1, z1] = zone;
        for (const p of map.props) {
          if (!p.block) continue;
          const cx = Math.max(x0, Math.min(p.x, x1)), cz = Math.max(z0, Math.min(p.z, z1));
          assert.ok(Math.hypot(p.x - cx, p.z - cz) >= p.r - 1e-9, `${map.id}: ${p.kind} 가 통로 입구 2타일 안`);
        }
      }
    }
    for (const p of map.props) if (p.block) assert.ok(Math.hypot(p.x - map.spawn.x, p.z - map.spawn.z) >= MAPGEN.spawnPropClear, '시작점 둘레');
  }
});

test('빛 — 방마다 lights.perRoom(2~4) · 그 타일셋 빛 kind 의 색 · 세기 · 반경 · 높이', () => {
  for (const { map } of MAPS) {
    const ts = getTileset(map.tileset);
    const kinds = Object.fromEntries(ts.lights.kinds.map(k => [k.kind, k]));
    for (const l of map.lights) {
      const k = kinds[l.kind];
      assert.ok(k, `빛 ${l.kind}`);
      assert.equal(l.color, k.color); assert.equal(l.intensity, k.intensity); assert.equal(l.radius, k.radius);
      assert.equal(l.flicker, k.flicker); assert.equal(l.y, k.y);
      // 방 바닥 위 · 막는 소품 원 밖(벽 횃불이 관 옆이면 그 내비 칸은 막혀 있어도 된다)
      assert.ok(map.rooms.some(r => l.x > r.x0 && l.x < r.x1 && l.z > r.z0 && l.z < r.z1), '빛이 방 안');
      for (const p of map.props) if (p.block) assert.ok(Math.hypot(p.x - l.x, p.z - l.z) >= p.r, `빛이 ${p.kind} 안`);
    }
    for (const r of map.rooms) {
      const n = map.lights.filter(l => l.x > r.x0 && l.x < r.x1 && l.z > r.z0 && l.z < r.z1).length;
      assert.ok(n >= ts.lights.perRoom[0] && n <= ts.lights.perRoom[1], `방 ${r.id} 빛 ${n}`);
    }
  }
});

test('팩 자리 — 시작점 18m 밖 · 서로 6m · 챔피언/정예 수 = riftRow · depth ≥ 2 · 정예는 가장 깊은 방부터 · 일반 ≥ normalMin · 자리가 트였다', () => {
  let normalSum = 0;
  for (const { level, map } of MAPS) {
    const row = riftRow(level);
    const slots = map.packSlots;
    const ids = new Set(slots.map(s => s.id));
    assert.equal(ids.size, slots.length, 'id 유일');
    for (const s of slots) {
      assert.ok(['normal', 'champion', 'elite'].includes(s.kind));
      assert.ok(Math.hypot(s.x - map.spawn.x, s.z - map.spawn.z) >= MAPGEN.spawnClear, `시작점에서 ${MAPGEN.spawnClear}m 밖`);
      assert.ok(isWalkableR(map, s.x, s.z, MAPGEN.slotClearR), '자리가 트였다');
      const room = map.rooms[s.roomId];
      assert.ok(room, 'roomId');
      assert.ok(Number.isInteger(s.depth) && s.depth >= 0);
    }
    for (let a = 0; a < slots.length; a++) for (let b = a + 1; b < slots.length; b++) {
      assert.ok(Math.hypot(slots[a].x - slots[b].x, slots[a].z - slots[b].z) >= MAPGEN.slotSpacing - 1e-9, `자리 ${slots[a].id} · ${slots[b].id} 가 ${MAPGEN.slotSpacing}m 안`);
    }
    const champ = slots.filter(s => s.kind === 'champion'), elite = slots.filter(s => s.kind === 'elite'), normal = slots.filter(s => s.kind === 'normal');
    assert.equal(champ.length, row.championPacks, `L${level} 챔피언`);
    assert.equal(elite.length, row.elitePacks, `L${level} 정예`);
    for (const s of [...champ, ...elite]) {
      const room = map.rooms[s.roomId];
      assert.ok(s.depth >= MAPGEN.eliteMinDepth && room.depth === s.depth, `${s.kind} 깊이 ${s.depth}`);
      assert.ok(s.x > room.x0 && s.x < room.x1 && s.z > room.z0 && s.z < room.z1, '그 방 안');
    }
    const maxDepth = Math.max(...map.rooms.map(r => r.depth));
    assert.equal(elite[0].depth, maxDepth, '첫 정예는 가장 깊은 방');
    assert.ok(normal.length >= MAPGEN.normalMin, `일반 ${normal.length}`);
    normalSum += normal.length;
  }
  const avg = normalSum / MAPS.length;
  assert.ok(avg >= MAPGEN.normalMin && avg <= 80, `일반 평균 ${avg.toFixed(1)}(§7.14 ~60)`);
});

test('생성 ≤ 150ms — 시드 20개 각각(최대)', () => {
  generateRift(12345, 3);   // 첫 JIT
  let worst = 0;
  for (const s of SEEDS) {
    const t0 = performance.now();
    generateRift(s ^ 0x5bd1e995, 1 + (s % 20));
    const ms = performance.now() - t0;
    if (ms > worst) worst = ms;
  }
  assert.ok(worst <= 150, `최대 ${worst.toFixed(1)}ms`);
});

test('마을 맵 — §7.12 표 그대로(물체 7 + 모닥불 · 자리 · facing · r · look) · 장식 건물 4 · 내비 · 도착점 · 빛 · 고정 상태 마을과 같은 내비', () => {
  const m = buildTownMap();
  const PI = Math.PI;
  assert.equal(m.id, 'town'); assert.equal(m.kind, 'town'); assert.equal(m.tileset, 'town');
  assert.equal(m.w, 24); assert.equal(m.h, 24);
  assert.equal(m.nw, 96); assert.equal(m.nh, 96);
  // 계약 §7.12 표의 리터럴
  const TABLE = {
    townPortal: ['townPortal', 24, 16, 0, 1.2, 'portal'],
    riftStone: ['riftStone', 31, 22, -PI / 2, 1.2, 'riftStone'],
    stash: ['stash', 17, 22, PI / 2, 1.0, 'stash'],
    blacksmith: ['npc', 14, 31, 3 * PI / 4, 1.0, 'npcSmith'],
    general: ['npc', 34, 31, -3 * PI / 4, 1.0, 'npcGrocer'],
    gambler: ['npc', 14, 13, PI / 4, 1.0, 'npcGambler'],
    mystic: ['npc', 34, 13, -PI / 4, 1.0, 'npcMystic'],
    bonfire: ['deco', 24, 25, 0, 1.0, 'bonfire'],
  };
  for (const [id, [kind, x, z, facing, r, look]] of Object.entries(TABLE)) {
    const o = m.objects.find(q => q.id === id);
    assert.ok(o, id);
    assert.equal(o.kind, kind, `${id} kind`);
    assert.equal(o.x, x); assert.equal(o.z, z);
    assert.ok(Math.abs(o.facing - facing) < 1e-12, `${id} facing`);
    assert.equal(o.r, r); assert.equal(o.look, look);
    if (kind === 'npc') assert.equal(o.npc, id);
  }
  for (const id of TOWN_OBJECT_IDS) assert.ok(m.objects.some(o => o.id === id && o.kind !== 'deco'), id);
  assert.equal(m.objects.filter(o => o.kind !== 'deco').length, 7);
  // 장식 건물 — 상자(w · d · h) · 막음
  const BUILD = { smithy: [8, 16, 33, 40], grocery: [32, 40, 33, 40], tent: [8, 14, 8, 13], tower: [35, 40, 8, 13] };
  for (const [id, [x0, x1, z0, z1]] of Object.entries(BUILD)) {
    const o = m.objects.find(q => q.id === id);
    assert.ok(o && o.kind === 'deco' && o.block, id);
    assert.equal(o.x, (x0 + x1) / 2); assert.equal(o.z, (z0 + z1) / 2); assert.equal(o.w, x1 - x0); assert.equal(o.d, z1 - z0);
    assert.ok(o.h > 0);
    assert.ok(!isWalkable(m, (x0 + x1) / 2, (z0 + z1) / 2), `${id} 막힘`);
    assert.ok(isWalkable(m, x0 - 0.3, (z0 + z1) / 2) || x0 <= 2, `${id} 바깥은 트였다`);
  }
  assert.ok(!isWalkable(m, 24, 25), '모닥불 막힘');
  // 상호작용 물체 자리는 걸을 수 있고(막지 않는다) 도착점에서 경로로 r 안까지 닿는다
  for (const id of TOWN_OBJECT_IDS) {
    const o = m.objects.find(q => q.id === id);
    const path = findPath(m, TOWN.arrive, { x: o.x, z: o.z }, { r: 0.4 });
    const end = path[path.length - 1] ?? TOWN.arrive;
    assert.ok(Math.hypot(end.x - o.x, end.z - o.z) <= o.r, `${id} 에 닿는다`);
  }
  // 도착 · 부활
  assert.deepEqual(m.spawn, { x: 24, z: 20, facing: PI });
  assert.ok(isWalkableR(m, TOWN.respawn.x, TOWN.respawn.z, 0.5));
  assert.equal(TOWN.respawn.x, 24); assert.equal(TOWN.respawn.z, 18.5);
  // 가장자리 1타일 벽 · 걸을 수 있는 칸 전부 도착점에서 닿는다
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
    const edge = i === 0 || j === 0 || i === m.w - 1 || j === m.h - 1;
    assert.equal(m.tiles[j * m.w + i], edge ? TILE_WALL : TILE_FLOOR);
  }
  const seen = bfs(m, cellIndex(m, m.spawn.x, m.spawn.z), i => m.nav[i] === 0);
  for (let i = 0; i < m.nav.length; i++) if (m.nav[i] === 0) assert.ok(seen[i], '마을 칸이 닿는다');
  // 빛 — 모닥불 1 · 횃불 6
  assert.equal(m.lights.filter(l => l.kind === 'bonfire').length, 1);
  assert.equal(m.lights.filter(l => l.kind === 'torch').length, 6);
  assert.deepEqual(m.bounds, { x0: 2, z0: 2, x1: 46, z1: 46 });
  // 고정 상태의 마을(townMapFromData)과 같은 타일 · 내비 · 물체 자리(app 이 바꿔 넘겨도 같은 자리)
  const f = townMapFromData();
  assert.deepEqual(m.tiles, f.tiles);
  assert.deepEqual(m.nav, f.nav);
  assert.deepEqual(m.objects.map(o => [o.id, o.x, o.z, o.r]), f.objects.map(o => [o.id, o.x, o.z, o.r]));
  // 부를 때마다 새 객체
  const m2 = buildTownMap();
  assert.notEqual(m2.objects, m.objects);
  assert.notEqual(m2.objects[0], m.objects[0]);
  m2.objects[0].x = -1;
  assert.equal(buildTownMap().objects[0].x, TOWN.objects[0].x, 'data 를 고치지 않는다');
});
