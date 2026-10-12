// OWNER: P4 — 계약 §12.2 · §6.6 · §3.10(FlowField)
// 흐름장: 갱신 조건(칸 recenterCells 넘게 · everySec · force · 처음) · 방향이 늘 거리를 줄인다 · 모서리 자르기 없음 · 닿지 않는 곳 null ·
// 같으면 인덱스 작은 쪽 · 벽을 돌아 몰려온다(moveCircle 로 따라가 플레이어 앞에 닿는다) · maxSteps 밖은 Infinity · 시간.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_CELL, TILE } from '../src/core/constants.js';
import { ticks } from '../src/core/time.js';
import { FLOW } from '../src/data/mapgen.js';
import { mapFromAscii } from '../src/debug/fixtureMap.js';
import { generateRift } from '../src/sim/world/mapgen.js';
import { cellIndex, isWalkable, moveCircle } from '../src/sim/world/nav.js';
import { createFlow, flowDir, flowDist, updateFlow } from '../src/sim/world/flow.js';
import { makeTestMap } from './helpers.js';

/** @typedef {import('../src/types.js').MapData} MapData */

const T = (i) => (i + 0.5) * TILE;
const UNREACHED = 0xffff;

/** 가운데 벽(행 2~9 — 위 · 아래 틈) · 오른쪽 아래에 닫힌 상자 */
const WALL_MAP = mapFromAscii([
  '######################',
  '#....................#',
  '#........#...........#',
  '#........#...........#',
  '#........#...........#',
  '#...S....#...........#',
  '#........#....#####..#',
  '#........#....#...#..#',
  '#........#....#####..#',
  '#........#...........#',
  '#....................#',
  '######################',
].join('\n'));

/** 긴 통로(폭 2타일 · 바닥 70m) */
const LONG_MAP = mapFromAscii([
  '#######################################',
  '#S....................................#',
  '#.....................................#',
  '#######################################',
].join('\n'));

const centerOf = (map, i) => ({ x: (i % map.nw + 0.5) * NAV_CELL, z: (Math.floor(i / map.nw) + 0.5) * NAV_CELL });

test('createFlow — dist = nw × nh 의 0xffff · 기준 칸 −1 · builtAt −1 · 맵이 없어도 던지지 않는다', () => {
  const map = makeTestMap();
  const f = createFlow(map);
  assert.ok(f.dist instanceof Uint16Array);
  assert.equal(f.dist.length, map.nw * map.nh);
  assert.ok(f.dist.every(d => d === UNREACHED));
  assert.equal(f.cx, -1); assert.equal(f.cz, -1); assert.equal(f.builtAt, -1);
  assert.equal(createFlow(null).dist.length, 0);
  // 만들기 전 질의
  assert.equal(flowDir(f, map, map.spawn.x, map.spawn.z), null);
  assert.equal(flowDist(f, map, map.spawn.x, map.spawn.z), Infinity);
});

test('updateFlow 갱신 조건 — 처음 · everySec(6틱) 지남 · 칸이 recenterCells(2칸) 넘게 바뀜 · force 일 때만 true', () => {
  const map = makeTestMap();
  const f = createFlow(map);
  const p = { x: map.spawn.x + 0.1, z: map.spawn.z + 0.1 };
  const every = ticks(FLOW.everySec);
  assert.equal(every, 6);
  assert.equal(updateFlow(f, map, p, 100), true, '처음');
  assert.equal(f.builtAt, 100);
  assert.equal(f.cx, Math.floor(p.x / NAV_CELL)); assert.equal(f.cz, Math.floor(p.z / NAV_CELL));
  assert.equal(updateFlow(f, map, p, 100), false, '같은 틱');
  assert.equal(updateFlow(f, map, p, 100 + every - 1), false, '5틱');
  // 2칸(1m) 움직임 — 아직 아니다
  const p2 = { x: p.x + FLOW.recenterCells * NAV_CELL, z: p.z };
  assert.equal(updateFlow(f, map, p2, 101), false, `${FLOW.recenterCells}칸`);
  // 3칸 — 다시
  const p3 = { x: p.x + (FLOW.recenterCells + 1) * NAV_CELL, z: p.z };
  assert.equal(updateFlow(f, map, p3, 102), true, `${FLOW.recenterCells + 1}칸`);
  assert.equal(f.builtAt, 102);
  assert.equal(flowDist(f, map, p3.x, p3.z), 0, '근원은 새 자리');
  assert.equal(updateFlow(f, map, p3, 102 + every - 1), false);
  assert.equal(updateFlow(f, map, p3, 102 + every), true, '6틱');
  assert.equal(updateFlow(f, map, p3, 102 + every, true), true, 'force');
  // 대각으로 2칸씩은 체비쇼프 2 — 아니다
  const pd = { x: p3.x + 2 * NAV_CELL, z: p3.z + 2 * NAV_CELL };
  assert.equal(updateFlow(f, map, pd, 102 + every + 1), false);
  // 이상한 입력은 false · 던지지 않는다
  assert.equal(updateFlow(null, map, p, 1), false);
  assert.equal(updateFlow(f, null, p, 1), false);
  assert.equal(updateFlow(f, map, { x: NaN, z: 0 }, 1), false);
  // 다른 맵의 흐름장(길이가 다르다) → 다시 만든다
  const g = createFlow(LONG_MAP);
  assert.equal(updateFlow(g, map, p, 1), true);
  assert.equal(g.dist.length, map.nw * map.nh);
});

test('거리 — 근원 0 · 트인 곳의 곧은 걸음 k 칸 = k · 대각 ≈ 1.4k · flowDist 는 걸음 수 · dist 는 정수(걸음 × orthCost)', () => {
  const map = makeTestMap();
  const f = createFlow(map);
  const p = { x: T(10) + 0.25, z: T(10) + 0.25 };
  updateFlow(f, map, p, 0);
  assert.equal(flowDist(f, map, p.x, p.z), 0);
  for (const k of [1, 3, 6]) {
    assert.equal(flowDist(f, map, p.x + k * NAV_CELL, p.z), k, `곧은 ${k}`);
    assert.ok(Math.abs(flowDist(f, map, p.x + k * NAV_CELL, p.z + k * NAV_CELL) - k * FLOW.diagCost / FLOW.orthCost) < 1e-9, `대각 ${k}`);
  }
  for (const d of f.dist) assert.ok(Number.isInteger(d) && d >= 0 && d <= UNREACHED);
});

test('방향이 늘 거리를 줄인다 — 닿는 모든 칸: 고른 이웃의 dist < 지금 칸 · 모서리 자르기 없음 · 따라가면 근원에 닿는다', () => {
  for (const map of [WALL_MAP, makeTestMap(), generateRift(77, 1)]) {
    const f = createFlow(map);
    const p = map.spawn;
    updateFlow(f, map, p, 0);
    const src = cellIndex(map, p.x, p.z);
    let checked = 0;
    for (let i = 0; i < f.dist.length; i++) {
      if (f.dist[i] === UNREACHED || i === src) continue;
      const c = centerOf(map, i);
      const dir = flowDir(f, map, c.x, c.z);
      assert.ok(dir, '닿는 칸은 방향이 있다');
      assert.ok(Math.abs(Math.hypot(dir.x, dir.z) - 1) < 1e-9, '단위');
      const du = Math.round(dir.x / Math.max(Math.abs(dir.x), Math.abs(dir.z)) || 0), dv = Math.round(dir.z / Math.max(Math.abs(dir.x), Math.abs(dir.z)) || 0);
      const j = i + dv * map.nw + du;
      assert.ok(f.dist[j] < f.dist[i], '거리가 준다');
      if (du !== 0 && dv !== 0) assert.ok(map.nav[i + du] === 0 && map.nav[i + dv * map.nw] === 0, '대각은 양옆이 트였다');
      checked++;
    }
    assert.ok(checked > 100);
    // 근원 칸은 null(그 자리 — 플레이어 쪽 직선은 부르는 쪽이)
    assert.equal(flowDir(f, map, p.x, p.z), null);
    // 아무 칸에서 따라가면 근원에 닿는다
    let i = f.dist.findIndex(d => d !== UNREACHED && d > 50);
    for (let k = 0; k < 2000 && i !== src; k++) {
      const c = centerOf(map, i);
      const dir = flowDir(f, map, c.x, c.z);
      const s = Math.max(Math.abs(dir.x), Math.abs(dir.z));
      i += Math.round(dir.z / s) * map.nw + Math.round(dir.x / s);
    }
    assert.equal(i, src, '근원에 닿는다');
  }
});

test('트인 곳의 방향은 플레이어 쪽(내적 > 0) · 같으면 인덱스 작은 쪽', () => {
  const map = makeTestMap();
  const f = createFlow(map);
  const p = { x: T(10) + 0.25, z: T(10) + 0.25 };
  updateFlow(f, map, p, 0);
  for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [4, 2], [-3, 5], [5, -5], [-2, -6]]) {
    const x = p.x + dx, z = p.z + dz;
    const dir = flowDir(f, map, x, z);
    assert.ok(dir.x * (p.x - x) + dir.z * (p.z - z) > 0, `(${dx}, ${dz})`);
  }
  // 곧은 축 위는 곧게
  assert.deepEqual(flowDir(f, map, p.x + 3, p.z), { x: -1, z: 0 });
  assert.deepEqual(flowDir(f, map, p.x, p.z - 3), { x: 0, z: 1 });
  // 같은 거리의 이웃 둘 — 인덱스 작은 쪽(v−1 줄이 먼저)
  const g = createFlow(map);
  g.dist.fill(UNREACHED);
  const c = cellIndex(map, p.x, p.z);
  g.dist[c] = 20;
  g.dist[c + 1] = 10;                 // (u+1, v)
  g.dist[c - map.nw] = 10;            // (u, v−1) — 인덱스가 더 작다
  assert.deepEqual(flowDir(g, map, p.x, p.z), { x: 0, z: -1 });
  g.dist[c - map.nw - 1] = 10;        // (u−1, v−1) — 가장 작다
  const d = flowDir(g, map, p.x, p.z);
  assert.ok(d.x < 0 && d.z < 0);
});

test('닿지 않는 곳 — 닫힌 상자 안 · 맵 밖은 null · Infinity · maxSteps(100걸음) 밖도', () => {
  const f = createFlow(WALL_MAP);
  updateFlow(f, WALL_MAP, WALL_MAP.spawn, 0);
  const box = { x: T(16) + 0.25, z: T(7) + 0.25 };
  assert.ok(isWalkable(WALL_MAP, box.x, box.z));
  assert.equal(flowDir(f, WALL_MAP, box.x, box.z), null);
  assert.equal(flowDist(f, WALL_MAP, box.x, box.z), Infinity);
  assert.equal(flowDir(f, WALL_MAP, -5, 3), null);
  assert.equal(flowDist(f, WALL_MAP, 999, 3), Infinity);
  // 긴 통로 — 50m(100걸음) 안은 닿고 그 밖은 닿지 않는다
  const g = createFlow(LONG_MAP);
  const s = { x: T(1) + 0.25, z: T(1) + 0.25 };
  updateFlow(g, LONG_MAP, s, 0);
  assert.ok(Number.isFinite(flowDist(g, LONG_MAP, s.x + 40, s.z)), '40m');
  assert.ok(flowDist(g, LONG_MAP, s.x + 40, s.z) <= FLOW.maxSteps);
  assert.equal(flowDist(g, LONG_MAP, s.x + 65, s.z), Infinity, '65m');
  assert.equal(flowDir(g, LONG_MAP, s.x + 65, s.z), null);
});

test('벽을 돌아 몰려온다 — 벽 건너편 몬스터들이 flowDir · moveCircle 로 틈을 돌아 플레이어 3m 안에 닿는다(갱신 조건 그대로)', () => {
  const map = WALL_MAP;
  const player = { x: T(4), z: T(5) };
  const f = createFlow(map);
  const starts = [{ x: T(13), z: T(5) }, { x: T(12), z: T(3) }, { x: T(19), z: T(9) }, { x: T(11), z: T(7) }];
  for (const st of starts) {
    let pos = { x: st.x, z: st.z };
    let reached = false;
    for (let tick = 0; tick < 30 * 20 && !reached; tick++) {
      updateFlow(f, map, player, tick);
      const d = Math.hypot(player.x - pos.x, player.z - pos.z);
      if (d <= 3) { reached = true; break; }
      const dir = flowDir(f, map, pos.x, pos.z);
      assert.ok(dir, '방향이 있다');
      const step = 4 / 30;
      pos = moveCircle(map, pos, 0.45, dir.x * step, dir.z * step);
    }
    assert.ok(reached, `(${st.x}, ${st.z}) 에서 출발한 몬스터가 닿는다`);
  }
});

test('생성 균열 — 다시 계산 ≤ 4ms(평균) · 120마리 질의는 가볍다', () => {
  const map = generateRift(9001, 1);
  const f = createFlow(map);
  updateFlow(f, map, map.spawn, 0);
  const n = 30;
  const t0 = performance.now();
  for (let k = 1; k <= n; k++) updateFlow(f, map, { x: map.spawn.x + (k % 3) * 0.5, z: map.spawn.z }, k * 6);
  const ms = (performance.now() - t0) / n;
  assert.ok(ms < 4, `다시 계산 ${ms.toFixed(2)}ms`);
  let reach = 0;
  for (const d of f.dist) if (d !== UNREACHED) reach++;
  assert.ok(reach > 1000, '근처 방들에 퍼진다');
  const t1 = performance.now();
  for (let k = 0; k < 120 * 30; k++) flowDir(f, map, map.spawn.x + (k % 60) - 30, map.spawn.z + ((k * 7) % 60) - 30);
  assert.ok(performance.now() - t1 < 50, '3600 질의');
});
