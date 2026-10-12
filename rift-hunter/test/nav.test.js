// OWNER: P0 — 계약 §12.2(nav.test) · §6.5 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// moveCircle 벽 미끄러짐 · 모서리 끼임 없음 · 결과 늘 걷기 가능 · losClear · nearestWalkable · raycastWalk · 격자 질의.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE_FLOOR, TILE_VOID, TILE_WALL } from '../src/core/constants.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { mapFromAscii } from '../src/debug/fixtureMap.js';
import {
  cellCenter, cellIndex, inBounds, isWalkable, isWalkableR, losClear, moveCircle, nearestWalkable, randomWalkableNear, raycastWalk, tileAt,
} from '../src/sim/world/nav.js';
import { makeTestMap } from './helpers.js';

// 바닥 8×6 타일(16 × 12m) + 가운데 세로 벽(통로 하나) + 기둥
const ROOM = [
  '##########',
  '#....#...#',
  '#....#...#',
  '#........#',
  '#....#..P#',
  '#....#...#',
  '#S...#...#',
  '##########',
].join('\n');
const map = mapFromAscii(ROOM, { id: 'test:nav' });

test('격자 질의: tileAt · cellIndex · cellCenter · inBounds · 벽 = 바닥에 닿는 비바닥', () => {
  assert.equal(tileAt(map, 3, 3), TILE_FLOOR);
  assert.equal(tileAt(map, 1, 1), TILE_WALL);
  assert.equal(tileAt(map, -1, 3), TILE_VOID);
  assert.equal(tileAt(map, 11, 3), TILE_WALL, '가운데 벽(타일 5)');
  assert.equal(cellIndex(map, -0.1, 1), -1);
  const idx = cellIndex(map, 3.2, 3.9);
  assert.deepEqual(cellCenter(map, idx), { x: 3.25, z: 3.75 });
  assert.ok(inBounds(map, 0, 0));
  assert.ok(!inBounds(map, map.w * 2, 0));
  const big = mapFromAscii(['       ', '       ', '  ...  ', '       ', '       '].join('\n'));
  assert.equal(tileAt(big, 3, 3), TILE_WALL, '대각으로 닿는 것도 벽');
  assert.equal(big.tiles[0], TILE_VOID, '바닥에 닿지 않는 비바닥은 빈 곳');
});

test('isWalkable · isWalkableR: 반지름이 벽 칸과 겹치면 막힘(경계 접촉은 통과)', () => {
  assert.ok(isWalkable(map, 3, 3));
  assert.ok(!isWalkable(map, 11, 3));
  assert.ok(isWalkableR(map, 3, 3, 0.4));
  assert.ok(!isWalkableR(map, 2.2, 3, 0.4), '왼쪽 벽(x < 2)에 겹친다');
  assert.ok(isWalkableR(map, 2.4, 3, 0.4), '벽 가장자리에 닿기만 함');
  const pillar = map.props.find(p => p.block);
  assert.ok(pillar, '기둥이 있다');
  assert.ok(!isWalkable(map, pillar.x, pillar.z), '막는 소품은 내비에 반영');
});

test('moveCircle: 벽을 따라 미끄러진다 · 결과는 늘 걷기 가능 · 벽을 뚫지 않는다', () => {
  // 왼쪽 벽 쪽으로 비스듬히 — x 는 막히고 z 는 간다
  const p = moveCircle(map, { x: 2.6, z: 4 }, 0.4, -2, 2);
  assert.ok(p.x >= 2.4 - 1e-9, `x ${p.x}`);
  assert.ok(Math.abs(p.z - 6) < 1e-9, `z ${p.z}`);
  assert.ok(isWalkableR(map, p.x, p.z, 0.4));
  // 가운데 벽을 향해 곧장 — 벽 앞에서 멈춘다
  const q = moveCircle(map, { x: 8, z: 3 }, 0.4, 6, 0);
  assert.ok(q.x <= 10 - 0.4 + 1e-9 && q.x > 9, `벽 앞 ${q.x}`);
  // 무작위 이동 500번 — 늘 걷기 가능 · 벽 안으로 들어가지 않는다
  const rng = makeRng(seedRng(11));
  let pos = { x: map.spawn.x, z: map.spawn.z };
  for (let i = 0; i < 500; i++) {
    pos = moveCircle(map, pos, 0.4, rng.range(-1.5, 1.5), rng.range(-1.5, 1.5));
    assert.ok(isWalkableR(map, pos.x, pos.z, 0.4), `걸음 ${i}: ${pos.x}, ${pos.z}`);
  }
});

test('moveCircle: 모서리에 끼지 않는다(통로 입구 모서리를 스치며 지나간다) · 박힌 몸은 빼낸다', () => {
  // 통로(타일 5 · z 6..8)로 대각 진입 — 모서리를 스쳐도 계속 나아간다
  let pos = { x: 8.5, z: 5.0 };
  for (let i = 0; i < 40; i++) pos = moveCircle(map, pos, 0.4, 0.15, 0.08);
  assert.ok(pos.x > 11.5, `통로를 지났다 x=${pos.x}`);
  // 벽에 박힌 몸 → 걷기 가능한 자리로
  const out = moveCircle(map, { x: 10.1, z: 3.5 }, 0.4, 0, 0);
  assert.ok(isWalkableR(map, out.x, out.z, 0.4), `빼냈다 ${out.x}, ${out.z}`);
  assert.ok(Math.hypot(out.x - 10.1, out.z - 3.5) < 1.5);
});

test('losClear: 벽이 막는다 · 통로로는 트인다 · props 면 막는 소품도', () => {
  assert.ok(losClear(map, 3, 3, 8, 3));
  assert.ok(!losClear(map, 3, 3, 14, 3), '가운데 벽');
  assert.ok(losClear(map, 3, 7, 14, 7), '통로 줄(z 6..8)');
  const pillar = map.props.find(p => p.block);
  assert.ok(losClear(map, pillar.x - 3, pillar.z, pillar.x + 0.9, pillar.z), '소품은 기본으로 막지 않는다');
  assert.ok(!losClear(map, pillar.x - 3, pillar.z, pillar.x + 0.9, pillar.z, { props: true }));
  // 대각선이 벽 모서리 두 칸 사이를 정확히 지나면 막힌다
  const diag = mapFromAscii(['#####', '#.#.#', '##..#', '#####'].join('\n'));
  assert.ok(!losClear(diag, 3, 3, 5, 5), '모서리 틈');
});

test('raycastWalk: 지나갈 수 있는 마지막 점 · nearestWalkable · randomWalkableNear', () => {
  const r = raycastWalk(map, 3, 3, 14, 3, 0.4);
  assert.ok(r.x > 9 && r.x <= 9.6 + 1e-6, `벽 앞 ${r.x}`);
  assert.ok(isWalkableR(map, r.x, r.z, 0.4));
  assert.deepEqual(raycastWalk(map, 3, 3, 3, 3, 0.4), { x: 3, z: 3 });
  assert.deepEqual(nearestWalkable(map, 3, 3), { x: 3, z: 3 });
  const n = nearestWalkable(map, 11, 3, 3);
  assert.ok(n && isWalkable(map, n.x, n.z));
  assert.ok(Math.abs(n.x - 11) <= 1.3);
  assert.equal(nearestWalkable(map, -20, -20, 1), null);
  const rng = makeRng(seedRng(5));
  const p = randomWalkableNear(map, rng, 4, 4, 1, 2);
  assert.ok(p && isWalkableR(map, p.x, p.z, 0.5));
  const d = Math.hypot(p.x - 4, p.z - 4);
  assert.ok(d >= 1 - 1e-9 && d <= 2 + 1e-9);
});

test('makeTestMap: 기본 40 × 40m 방 · 기둥 4 · 팩 자리 6 · spawn 걷기 가능', () => {
  const m = makeTestMap();
  assert.equal(m.bounds.x1 - m.bounds.x0, 40);
  assert.equal(m.bounds.z1 - m.bounds.z0, 40);
  assert.equal(m.props.filter(p => p.block).length, 4);
  assert.equal(m.packSlots.length, 6);
  assert.ok(isWalkableR(m, m.spawn.x, m.spawn.z, 0.4));
  assert.equal(m.nw, m.w * 4);
  assert.equal(m.nav.length, m.nw * m.nh);
});
