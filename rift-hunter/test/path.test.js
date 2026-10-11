// OWNER: P4 — 계약 §12.2 · §6.6
// 클릭 경로: 벽 돌아가기 · 막힌 곳 → 가장 가까운 점 · 닿지 않는 곳 → 탐색한 칸 중 가장 가까운 칸 · 줄 당기기 결과가 벽 · 모서리를 뚫지 않는다(r 여유)
// · 따라 걸으면(nav.moveCircle) 끼지 않고 끝까지 간다 · 노드 상한 · 결정성.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_CELL, TILE } from '../src/core/constants.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { PATHING } from '../src/data/mapgen.js';
import { mapFromAscii } from '../src/debug/fixtureMap.js';
import { generateRift } from '../src/sim/world/mapgen.js';
import { isWalkable, isWalkableR, losClear, moveCircle } from '../src/sim/world/nav.js';
import { findPath } from '../src/sim/world/path.js';

/** @typedef {import('../src/types.js').MapData} MapData */
/** @typedef {import('../src/types.js').Vec2} Vec2 */

const R = 0.4;
const T = (i) => (i + 0.5) * TILE;   // 타일 가운데(m)

/** 가운데 벽(행 2~9) — 위 · 아래 1타일 틈 */
const WALL_MAP = mapFromAscii([
  '####################',
  '#..................#',
  '#........#.........#',
  '#........#.........#',
  '#........#.........#',
  '#...S....#.........#',
  '#........#.........#',
  '#........#.........#',
  '#........#.........#',
  '#........#.........#',
  '#..................#',
  '####################',
].join('\n'));

/** ㄱ자 통로(폭 2타일) */
const L_MAP = mapFromAscii([
  '##########',
  '#S.......#',
  '#........#',
  '#######..#',
  '      #..#',
  '      #..#',
  '      #..#',
  '      ####',
].join('\n'));

/** 닫힌 상자 방(바닥이지만 닿지 않는다) */
const BOX_MAP = mapFromAscii([
  '################',
  '#..............#',
  '#.S............#',
  '#..............#',
  '#.......#####..#',
  '#.......#...#..#',
  '#.......#...#..#',
  '#.......#####..#',
  '#..............#',
  '################',
].join('\n'));

/** 가로 벽에 좁은 틈(1타일 = 2m) 하나와 넓은 틈(3타일) 하나 */
const GAP_MAP = mapFromAscii([
  '######################',
  '#....................#',
  '#.........S..........#',
  '#....................#',
  '#########.######...###',
  '#....................#',
  '#....................#',
  '######################',
].join('\n'));

/** 선분이 반지름 r 로 지나간다(0.05m 표본 · 바닥 시야) @param {MapData} map */
function segOk(map, a, b, r) {
  if (!losClear(map, a.x, a.z, b.x, b.z, { props: true })) return false;
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!isWalkableR(map, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, r - 0.02)) return false;
  }
  return true;
}

/** 경로가 몸 반지름으로 지나간다(시작점이 몸에 맞을 때) */
function pathOk(map, from, path, r) {
  let a = from;
  for (const b of path) {
    if (!segOk(map, a, b, r)) return false;
    a = b;
  }
  return true;
}

/**
 * P1 처럼 따라 걷는다(경유점 도착 0.15m · moveCircle) → {end, ok, ticks}
 * @param {MapData} map @param {Vec2} from @param {Vec2[]} path
 */
function follow(map, from, path, r = R, speed = 6) {
  let p = { x: from.x, z: from.z };
  const q = path.slice();
  let t = 0;
  for (; t < 30 * 120 && q.length; t++) {
    let budget = speed / 30;
    while (budget > 1e-9 && q.length) {
      const wp = q[0];
      const dx = wp.x - p.x, dz = wp.z - p.z, d = Math.hypot(dx, dz);
      if (d <= 0.15) { q.shift(); continue; }
      const s = Math.min(d, budget);
      const np = moveCircle(map, p, r, dx / d * s, dz / d * s);
      const moved = Math.hypot(np.x - p.x, np.z - p.z);
      if (!(moved > 1e-6)) return { end: p, ok: false, ticks: t };
      budget -= moved;
      p = np;
      if (Math.hypot(wp.x - p.x, wp.z - p.z) <= 0.15) q.shift();
    }
  }
  return { end: p, ok: q.length === 0, ticks: t };
}

const plen = (from, path) => { let a = from, s = 0; for (const b of path) { s += Math.hypot(b.x - a.x, b.z - a.z); a = b; } return s; };

test('시야 안이면 [to] — 같은 칸이어도 그 점 · 결과는 새 객체', () => {
  const from = WALL_MAP.spawn;
  const to = { x: T(6), z: T(3) };
  const p = findPath(WALL_MAP, from, to, { r: R });
  assert.deepEqual(p, [to]);
  assert.notEqual(p[0], to);
  const near = { x: from.x + 0.1, z: from.z + 0.1 };
  assert.deepEqual(findPath(WALL_MAP, from, near, { r: R }), [near]);
});

test('벽 돌아가기 — 가운데 벽을 틈으로 돌아 목적지에 닿고 모든 구간이 몸 반지름으로 지나간다 · 줄 당기기로 경유점이 적다', () => {
  const from = WALL_MAP.spawn;
  const to = { x: T(14), z: T(5) };
  assert.ok(!losClear(WALL_MAP, from.x, from.z, to.x, to.z), '직선은 벽에 막힌다');
  const path = findPath(WALL_MAP, from, to, { r: R });
  assert.ok(path.length >= 2 && path.length <= 4, `경유점 ${path.length}`);
  assert.deepEqual(path[path.length - 1], to, '마지막 = 목적지');
  assert.ok(pathOk(WALL_MAP, from, path, R), '구간이 벽을 뚫지 않는다(r 여유)');
  // 위 틈(행 1) 또는 아래 틈(행 10)으로 간다 — 벽 열(x 18..20m)을 지나는 점의 z 가 틈 안
  const L = plen(from, path);
  assert.ok(L < 32, `돌아가는 길 ${L.toFixed(1)}m`);
  const f = follow(WALL_MAP, from, path);
  assert.ok(f.ok, '따라 걸으면 끼지 않고 끝까지');
  assert.ok(Math.hypot(f.end.x - to.x, f.end.z - to.z) <= 0.15);
});

test('ㄱ자 모서리 — 줄 당기기가 모서리를 자르지 않는다(몸 반지름만큼 떨어져 돈다) · 경유점은 모서리 앞 하나', () => {
  const from = L_MAP.spawn;
  const to = { x: T(8), z: T(6) };
  const path = findPath(L_MAP, from, to, { r: R });
  assert.ok(path.length >= 2 && path.length <= 3, `경유점 ${path.length}`);
  assert.ok(pathOk(L_MAP, from, path, R));
  // 모서리(막힌 칸 (7, 3) 의 바깥 모서리 x 14 · z 6) 에서 경유점까지 거리 ≥ r
  for (const w of path.slice(0, -1)) {
    const cx = Math.min(Math.max(w.x, 0), 14), cz = Math.max(w.z, 6);
    assert.ok(Math.hypot(w.x - cx, w.z - cz) >= R - 1e-6 || w.x >= 14 + R - 1e-6, '경유점이 모서리에서 r 떨어진다');
  }
  // 큰 몸(r 0.9)도 같은 규칙 — 통로 폭 4m 에서 지나간다
  const big = findPath(L_MAP, from, to, { r: 0.9 });
  assert.ok(pathOk(L_MAP, from, big, 0.9), 'r 0.9 경로도 벽을 뚫지 않는다');
  assert.ok(follow(L_MAP, from, big, 0.9).ok, 'r 0.9 로 따라 걸어 끝까지');
});

test('막힌 곳을 누르면 가장 가까운 닿는 점 — 벽 · 소품 안 · 몸이 들어가는 점 · 맵 밖은 그 방향의 바닥', () => {
  const from = WALL_MAP.spawn;
  // 벽 열 안(타일 (9, 5) 가운데)
  const inWall = { x: T(9), z: T(5) };
  assert.ok(!isWalkable(WALL_MAP, inWall.x, inWall.z));
  const p1 = findPath(WALL_MAP, from, inWall, { r: R });
  const e1 = p1[p1.length - 1];
  assert.ok(p1.length >= 1 && isWalkableR(WALL_MAP, e1.x, e1.z, R), '끝이 몸에 맞는다');
  assert.ok(Math.hypot(e1.x - inWall.x, e1.z - inWall.z) <= TILE / 2 + R + NAV_CELL, `가장 가까운 점 ${Math.hypot(e1.x - inWall.x, e1.z - inWall.z).toFixed(2)}m`);
  assert.ok(e1.x < inWall.x, '같은 쪽(시작 쪽)의 벽 앞');
  assert.ok(follow(WALL_MAP, from, p1).ok);
  // 벽에 붙은 점(걸을 수 있지만 몸이 안 들어간다) → 몸이 들어가는 가까운 점
  const hug = { x: T(8) + 0.9, z: T(5) };   // 벽면(x 18) 에서 0.1m
  assert.ok(isWalkable(WALL_MAP, hug.x, hug.z) && !isWalkableR(WALL_MAP, hug.x, hug.z, R));
  const p2 = findPath(WALL_MAP, from, hug, { r: R });
  const e2 = p2[p2.length - 1];
  assert.ok(isWalkableR(WALL_MAP, e2.x, e2.z, R));
  assert.ok(Math.hypot(e2.x - hug.x, e2.z - hug.z) <= R, `벽 앞 ${Math.hypot(e2.x - hug.x, e2.z - hug.z).toFixed(3)}m`);
  // 맵 밖(빈 곳) → 그 방향 바닥까지 걸어간다(시작보다 가깝다)
  const out = { x: -30, z: T(5) };
  const p3 = findPath(WALL_MAP, from, out, { r: R });
  assert.ok(p3.length >= 1);
  const e3 = p3[p3.length - 1];
  assert.ok(isWalkableR(WALL_MAP, e3.x, e3.z, R));
  assert.ok(Math.hypot(e3.x - out.x, e3.z - out.z) < Math.hypot(from.x - out.x, from.z - out.z) - 1);
  // 소품(기둥) 안
  const pillarMap = mapFromAscii(['#########', '#.......#', '#.S..P..#', '#.......#', '#########'].join('\n'));
  const pp = pillarMap.props[0];
  const p4 = findPath(pillarMap, pillarMap.spawn, { x: pp.x, z: pp.z }, { r: R });
  const e4 = p4[p4.length - 1];
  assert.ok(isWalkableR(pillarMap, e4.x, e4.z, R));
  assert.ok(Math.hypot(e4.x - pp.x, e4.z - pp.z) <= pp.r + R + NAV_CELL * 1.5, '기둥 앞');
});

test('닿지 않는 곳(닫힌 방) → 탐색한 칸 중 그곳에 가장 가까운 칸까지 · 그 칸은 몸이 들어가고 닿는다', () => {
  const from = BOX_MAP.spawn;
  const inside = { x: T(10), z: T(5) + 1 };   // 닫힌 상자 안 바닥
  assert.ok(isWalkable(BOX_MAP, inside.x, inside.z));
  const path = findPath(BOX_MAP, from, inside, { r: R });
  assert.ok(path.length >= 1);
  const end = path[path.length - 1];
  assert.ok(isWalkableR(BOX_MAP, end.x, end.z, R));
  // 손으로: 밖의 몸이 들어가는 칸 가운데 중 가장 가까운 거리
  let best = Infinity;
  for (let v = 0; v < BOX_MAP.nh; v++) for (let u = 0; u < BOX_MAP.nw; u++) {
    const x = (u + 0.5) * NAV_CELL, z = (v + 0.5) * NAV_CELL;
    const outside = !(x > 16 && x < 26 && z > 8 && z < 16);
    if (outside && isWalkableR(BOX_MAP, x, z, R)) best = Math.min(best, Math.hypot(x - inside.x, z - inside.z));
  }
  const got = Math.hypot(end.x - inside.x, end.z - inside.z);
  assert.ok(Math.abs(got - best) < 1e-9, `가장 가까운 칸 ${got.toFixed(3)} vs ${best.toFixed(3)}`);
  assert.ok(pathOk(BOX_MAP, from, path, R));
  assert.ok(follow(BOX_MAP, from, path).ok);
});

test('몸 반지름 — r 0.4 는 좁은 틈(2m)으로 · r 1.2 는 좁은 틈을 피해 넓은 틈(6m)으로', () => {
  const from = GAP_MAP.spawn;
  const to = { x: T(10), z: T(6) };
  const small = findPath(GAP_MAP, from, to, { r: 0.4 });
  assert.ok(pathOk(GAP_MAP, from, small, 0.4));
  assert.ok(plen(from, small) < 10, `작은 몸은 바로 아래 틈 ${plen(from, small).toFixed(1)}m`);
  const big = findPath(GAP_MAP, from, to, { r: 1.2 });
  assert.ok(pathOk(GAP_MAP, from, big, 1.2), '큰 몸 경로가 좁은 틈 · 벽을 지나지 않는다');
  assert.ok(big.some(w => w.x > T(15)), '넓은 틈 쪽으로 돈다');
  assert.ok(follow(GAP_MAP, from, big, 1.2).ok);
});

test('벽에 붙어 선 자리(몸 여유 없음)에서도 경로가 나오고 따라 걸어 빠져나온다', () => {
  const from = { x: T(8) + 0.75, z: T(4) };   // 벽면(x 18) 에서 0.25m
  assert.ok(isWalkable(WALL_MAP, from.x, from.z) && !isWalkableR(WALL_MAP, from.x, from.z, R));
  const to = { x: T(14), z: T(7) };
  const path = findPath(WALL_MAP, from, to, { r: R });
  assert.ok(path.length >= 2);
  assert.deepEqual(path[path.length - 1], to);
  const f = follow(WALL_MAP, from, path);
  assert.ok(f.ok, '끼지 않는다');
});

test('노드 상한 — maxNodes 가 작으면 탐색한 칸 중 가장 가까운 칸까지(던지지 않는다 · 시작보다 가깝다) · 기본 상한은 PATHING.maxNodes', () => {
  const from = WALL_MAP.spawn;
  const to = { x: T(14), z: T(5) };
  const part = findPath(WALL_MAP, from, to, { r: R, maxNodes: 30 });
  assert.ok(part.length >= 1, '부분 경로');
  const end = part[part.length - 1];
  assert.notDeepEqual(end, to);
  assert.ok(Math.hypot(end.x - to.x, end.z - to.z) < Math.hypot(from.x - to.x, from.z - to.z));
  assert.ok(pathOk(WALL_MAP, from, part, R));
  assert.equal(PATHING.maxNodes, 6000);
  // 상한 1 — 더 갈 곳이 없으면 [](서 있는다)
  const none = findPath(WALL_MAP, from, to, { r: R, maxNodes: 1 });
  assert.ok(Array.isArray(none));
  // 잘못된 입력
  assert.deepEqual(findPath(null, from, to), []);
  assert.deepEqual(findPath(WALL_MAP, { x: NaN, z: 1 }, to), []);
  assert.deepEqual(findPath(WALL_MAP, from, { x: Infinity, z: 0 }), []);
});

test('결정성 · 작업 배열을 나눠 써도 결과가 같다(A → B → A)', () => {
  const from = WALL_MAP.spawn;
  const a = { x: T(14), z: T(5) }, b = { x: T(15), z: T(9) };
  const pa = findPath(WALL_MAP, from, a, { r: R });
  findPath(BOX_MAP, BOX_MAP.spawn, { x: 30, z: 4 }, { r: 0.7 });
  findPath(WALL_MAP, from, b, { r: R });
  assert.deepEqual(findPath(WALL_MAP, from, a, { r: R }), pa);
});

test('생성 균열 — 무작위 시작 · 목적지 300쌍: 끝이 몸에 맞고 구간이 벽을 뚫지 않으며 따라 걸어 끼지 않는다 · 평균 시간', () => {
  const rng = makeRng(seedRng(4242));
  let n = 0, total = 0;
  for (const seed of [11, 222, 3333]) {
    const map = generateRift(seed, 1);
    const walk = [];
    for (let i = 0; i < map.nav.length; i++) if (map.nav[i] === 0) walk.push(i);
    while (n < (seed === 11 ? 100 : seed === 222 ? 200 : 300)) {
      const c = walk[rng.int(0, walk.length - 1)];
      const from = { x: (c % map.nw + rng.next()) * NAV_CELL, z: (Math.floor(c / map.nw) + rng.next()) * NAV_CELL };
      if (!isWalkableR(map, from.x, from.z, R)) continue;
      const a = rng.range(0, Math.PI * 2), d = rng.range(2, 24);
      const to = { x: from.x + Math.sin(a) * d, z: from.z + Math.cos(a) * d };
      const t0 = performance.now();
      const path = findPath(map, from, to, { r: R });
      total += performance.now() - t0;
      n++;
      if (!path.length) continue;
      const end = path[path.length - 1];
      assert.ok(isWalkableR(map, end.x, end.z, R - 1e-6), `${map.id}: 끝이 몸에 맞는다`);
      assert.ok(pathOk(map, from, path, R), `${map.id}: (${from.x.toFixed(2)}, ${from.z.toFixed(2)}) → (${to.x.toFixed(2)}, ${to.z.toFixed(2)}) 구간이 벽을 뚫는다`);
      assert.ok(follow(map, from, path).ok, `${map.id}: 따라 걷다 낀다`);
    }
  }
  assert.ok(total / n < 5, `평균 ${(total / n).toFixed(2)}ms`);
});
