// OWNER: P0 — 계약 §12.2(core.test) · §6.1 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// rng 결정성 · 분포 · math(yaw 규약) · shapes overlaps · spatialHash · hash · time(ticks · shiftTicks) · events · inputFrame.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EV, EventBus } from '../src/core/events.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import {
  angleDiff, clamp, deg2rad, fwdX, fwdZ, lerpAngle, rightX, rightZ, segPointDist, turnToward, v2norm, wrapAngle, yawOf, roundTo,
} from '../src/core/math.js';
import { circle, cone, line, overlaps, ring, shapeArea, shapeBounds } from '../src/core/shapes.js';
import { SpatialHash } from '../src/core/spatialHash.js';
import { fnv1a, hash32, hashState, stableStringify } from '../src/core/hash.js';
import { progress, secOf, shiftTicks, ticks } from '../src/core/time.js';
import { NEUTRAL_INPUT, makeInput } from '../src/core/inputFrame.js';
import { PANEL_IDS, TICK_HZ, DT } from '../src/core/constants.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('rng: 같은 시드 → 같은 열 · 상태 객체를 직접 고친다 · seed 0 은 0x9e3779b9', () => {
  const a = makeRng(seedRng(42)), b = makeRng(seedRng(42));
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  const st = seedRng(7);
  const r = makeRng(st);
  const s0 = st.s;
  r.next();
  assert.notEqual(st.s, s0);
  const copy = { s: st.s };
  assert.equal(makeRng(copy).next(), r.next(), '상태 {s} 만으로 이어 굴릴 수 있다');
  assert.equal(seedRng(0).s, 0x9e3779b9);
  assert.notEqual(makeRng(seedRng(1)).next(), makeRng(seedRng(2)).next());
});

test('rng: 범위 · 정수 양끝 포함 · chance · sign · 평균', () => {
  const r = makeRng(seedRng(3));
  let sum = 0, lo = Infinity, hi = -Infinity;
  const ints = new Set();
  for (let i = 0; i < 20000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1);
    sum += v;
    const x = r.range(2, 5);
    lo = Math.min(lo, x); hi = Math.max(hi, x);
    ints.add(r.int(1, 3));
    assert.ok([1, -1].includes(r.sign()));
  }
  close(sum / 20000, 0.5, 0.01);
  assert.ok(lo >= 2 && hi < 5);
  assert.deepEqual([...ints].sort(), [1, 2, 3]);
  let n = 0;
  for (let i = 0; i < 20000; i++) if (r.chance(0.3)) n++;
  close(n / 20000, 0.3, 0.015);
});

test('rng: pick 가중치(키 순서 · 배열 꼴) · 합 ≤ 0 이면 null · pickIndex · shuffle', () => {
  const r = makeRng(seedRng(9));
  const c = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 30000; i++) c[r.pick({ a: 1, b: 2, c: 7 })]++;
  close(c.a / 30000, 0.1, 0.01);
  close(c.b / 30000, 0.2, 0.012);
  close(c.c / 30000, 0.7, 0.012);
  assert.equal(r.pick({ a: 0, b: -1 }), null);
  assert.equal(r.pick([]), null);
  const arr = { x: 0, y: 0 };
  for (let i = 0; i < 10000; i++) arr[r.pick([{ id: 'x', w: 1 }, { id: 'y', w: 3 }])]++;
  close(arr.y / 10000, 0.75, 0.02);
  assert.equal(r.pickIndex([0, 0]), -1);
  for (let i = 0; i < 100; i++) assert.equal(r.pickIndex([0, 5, 0]), 1);
  const s = [1, 2, 3, 4, 5, 6];
  const out = r.shuffle(s);
  assert.equal(out, s);
  assert.deepEqual([...s].sort(), [1, 2, 3, 4, 5, 6]);
});

test('math: yaw 규약 — fwd(0) = +Z · yawOf(1, 0) = π/2 · 오른쪽 = (−cos θ, sin θ)', () => {
  close(fwdX(0), 0); close(fwdZ(0), 1);
  close(fwdX(Math.PI / 2), 1); close(fwdZ(Math.PI / 2), 0, 1e-12);
  close(yawOf(1, 0), Math.PI / 2);
  close(yawOf(0, 1), 0);
  close(yawOf(0, -1), Math.PI);
  close(rightX(0), -1); close(rightZ(0), 0);
  // 오른쪽 = 앞 × 위 — θ = 0 이면 앞 +Z · 오른쪽 −X
  const th = 0.7;
  close(rightX(th) * fwdX(th) + rightZ(th) * fwdZ(th), 0, 1e-12);
});

test('math: 각도 유틸 · 벡터 · 선분 거리 · clamp', () => {
  close(wrapAngle(3 * Math.PI), Math.PI);
  close(wrapAngle(-Math.PI), Math.PI);
  close(angleDiff(Math.PI - 0.1, -Math.PI + 0.1), 0.2, 1e-12);
  close(lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5), Math.PI, 1e-12);
  close(turnToward(0, 1, 0.25), 0.25);
  close(turnToward(0, 0.1, 0.25), 0.1);
  close(deg2rad(180), Math.PI);
  assert.deepEqual(v2norm({ x: 0, z: 0 }), { x: 0, z: 0 });
  close(segPointDist(0, 0, 10, 0, 5, 3), 3);
  close(segPointDist(0, 0, 10, 0, -4, 3), 5);
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(roundTo(1.2345, 2), 1.23);
});

test('shapes: 원 · 원뿔(경계 · 몸 반지름 여유 · 꼭짓점) · 선(투영 · 폭) · 고리 · poly 판정 없음', () => {
  const c = circle(0, 0, 2);
  assert.ok(overlaps(c, 2.4, 0, 0.5));
  assert.ok(!overlaps(c, 2.6, 0, 0.5));
  const k = cone(0, 0, 4, 0, deg2rad(90));    // +Z 쪽 90°
  assert.ok(overlaps(k, 0, 3, 0));
  assert.ok(!overlaps(k, 0, -3, 0));
  assert.ok(overlaps(k, 2.0, 2.0, 0), '경계 45° 는 안');
  assert.ok(!overlaps(k, 2.5, 1.0, 0), '경계 밖');
  assert.ok(overlaps(k, 2.5, 1.0, 1.2), '몸 반지름이 각도 여유를 준다(asin(rb/거리))');
  assert.ok(!overlaps(k, 0, 4.6, 0.5));
  assert.ok(overlaps(k, 0, 4.4, 0.5));
  assert.ok(overlaps(k, 0.1, -0.1, 0.3), '꼭짓점이 몸 안');
  const l = line(0, 0, Math.PI / 2, 10, 2);  // +X 로 10m · 폭 2
  assert.ok(overlaps(l, 5, 0.9, 0));
  assert.ok(!overlaps(l, 5, 1.2, 0));
  assert.ok(overlaps(l, 5, 1.2, 0.3));
  assert.ok(!overlaps(l, -0.5, 0, 0.3), '투영 < −rb');
  assert.ok(overlaps(l, -0.2, 0, 0.3));
  assert.ok(overlaps(l, 10.2, 0, 0.3));
  assert.ok(!overlaps(l, 10.5, 0, 0.3));
  const rg = ring(0, 0, 3, 5);
  assert.ok(!overlaps(rg, 1, 0, 0.5));
  assert.ok(overlaps(rg, 2.6, 0, 0.5));
  assert.ok(overlaps(rg, 5.4, 0, 0.5));
  assert.ok(!overlaps({ type: 'poly', x: 0, z: 0, pts: [{ x: 0, z: 0 }, { x: 1, z: 1 }] }, 0, 0, 1));
  const b = shapeBounds(l);
  close(b.x0, 0); close(b.x1, 10); close(b.z0, -1); close(b.z1, 1);
  close(shapeArea(c), Math.PI * 4);
  close(shapeArea(l), 20);
});

test('spatialHash: 원이 걸치는 칸 · 중복 없이 · 삽입 순 · clear · size', () => {
  const h = new SpatialHash(2);
  h.insert(5, 1, 1, 0.5);
  h.insert(3, 1.5, 1.5, 3);
  h.insert(9, 30, 30, 0.5);
  const got = h.query(1, 1, 1);
  assert.deepEqual(got, [5, 3]);
  assert.deepEqual(h.query(30, 30, 0.1), [9]);
  assert.equal(h.size, 3);
  const out = [];
  h.query(-10, -10, 0.5, out);
  assert.deepEqual(out, []);
  h.clear();
  assert.equal(h.size, 0);
  assert.deepEqual(h.query(1, 1, 5), []);
});

test('hash: 키 정렬 · 타입 배열 · hash32 순서 민감 · hashState 는 events · flags 를 뺀다', () => {
  assert.equal(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] }), '{"a":[1,{"c":3,"d":2}],"b":1}');
  assert.equal(stableStringify({ t: new Uint8Array([1, 2]) }), '{"t":[1,2]}');
  assert.equal(fnv1a('abc'), fnv1a('abc'));
  assert.match(fnv1a('x'), /^[0-9a-f]{8}$/);
  assert.notEqual(hash32(1, 2), hash32(2, 1));
  assert.equal(hash32(1, 2), hash32(1, 2));
  assert.ok(hash32(5) >= 0 && hash32(5) <= 0xffffffff);
  const s1 = { tick: 3, events: [1], flags: { a: 1 }, x: 1 };
  const s2 = { x: 1, tick: 3, events: [], flags: { a: 2 } };
  assert.equal(hashState(s1), hashState(s2));
});

test('time: ticks(초) = max(0, round(초 × 30)) · secOf · progress', () => {
  assert.equal(TICK_HZ, 30);
  close(DT, 1 / 30);
  assert.equal(ticks(1), 30);
  assert.equal(ticks(0.55), 17);
  assert.equal(ticks(-1), 0);
  close(secOf(45), 1.5);
  assert.equal(progress(10, 20, 15), 0.5);
  assert.equal(progress(10, 10, 5), 1);
  assert.equal(progress(10, 20, 30), 1);
});

test('time: shiftTicks — At · Until · start · end · born · at · actStart/Hit/End · readyAt 값 · ≥ 0 만 · ax 안까지 · 다른 이름은 그대로', () => {
  const rift = {
    openedAt: 10, leftAt: 100, ticksIn: 50, rootLockUntil: -1, calmAt: null, guardianSpawn: { x: 1, z: 2, at: 120 },
    mons: [{ actStart: 90, actHit: 95, actEnd: 99, deadAt: -1, sleepAt: 80, readyAt: { claw: 105, arrow: -1 },
      st: { stunUntil: 101, chill: 40, burn: { dps: 3, until: 110, nextAt: 102 } }, ax: { mortar: { nextAt: 130, countT: 6 } }, hp: 50 }],
    effects: [{ start: 90, hitAt: 100, end: 130, tickT: 15, nextTickAt: 115 }],
    projs: [{ born: 95, until: 140, hitIds: [3, 4] }],
    drops: [{ born: 80, amount: 3 }],
    portals: [{ born: 70, r: 1 }],
  };
  shiftTicks(rift, 1000);
  assert.equal(rift.openedAt, 1010);
  assert.equal(rift.leftAt, 1100);
  assert.equal(rift.ticksIn, 50);
  assert.equal(rift.rootLockUntil, -1);
  assert.equal(rift.calmAt, null);
  assert.equal(rift.guardianSpawn.at, 1120);
  assert.equal(rift.guardianSpawn.x, 1);
  const m = rift.mons[0];
  assert.deepEqual([m.actStart, m.actHit, m.actEnd, m.deadAt, m.sleepAt], [1090, 1095, 1099, -1, 1080]);
  assert.deepEqual(m.readyAt, { claw: 1105, arrow: -1 });
  assert.equal(m.st.stunUntil, 1101);
  assert.equal(m.st.chill, 40);
  assert.deepEqual(m.st.burn, { dps: 3, until: 1110, nextAt: 1102 });
  assert.deepEqual(m.ax.mortar, { nextAt: 1130, countT: 6 });
  assert.equal(m.hp, 50);
  assert.deepEqual(rift.effects[0], { start: 1090, hitAt: 1100, end: 1130, tickT: 15, nextTickAt: 1115 });
  assert.deepEqual(rift.projs[0], { born: 1095, until: 1140, hitIds: [3, 4] });
  assert.equal(rift.drops[0].born, 1080);
  assert.equal(rift.drops[0].amount, 3);
  assert.equal(rift.portals[0].born, 1070);
  assert.equal(shiftTicks(rift, 0), rift);
});

test('events: on · once · off · onAny 가 먼저 · 시작 시점 목록 · 예외 전파 · count · EV 값 유일', () => {
  const bus = new EventBus();
  const seen = [];
  const offA = bus.onAny((n) => seen.push('any:' + n));
  const fn = (p) => seen.push('a' + p.v);
  bus.on('x', fn);
  bus.once('x', (p) => seen.push('once' + p.v));
  bus.on('x', () => bus.on('x', () => seen.push('late')));
  bus.emit('x', { v: 1 });
  assert.deepEqual(seen, ['any:x', 'a1', 'once1']);
  seen.length = 0;
  bus.emit('x', { v: 2 });
  assert.deepEqual(seen.slice(0, 2), ['any:x', 'a2']);
  bus.off('x', fn);
  offA();
  const before = bus.count();
  const off = bus.on('y', () => { throw new Error('boom'); });
  assert.throws(() => bus.emit('y'), /boom/);
  off();
  assert.equal(bus.count(), before);
  bus.clear();
  assert.equal(bus.count(), 0);
  const vals = Object.values(EV);
  assert.equal(new Set(vals).size, vals.length, 'EV 값이 겹치지 않는다');
  for (const v of vals) assert.match(v, /^[a-z]+\/[A-Za-z]+$/);
  assert.equal(PANEL_IDS.length, 21);
});

test('inputFrame: NEUTRAL_INPUT 동결 · makeInput 은 배열을 새로 만든다', () => {
  assert.ok(Object.isFrozen(NEUTRAL_INPUT));
  assert.equal(NEUTRAL_INPUT.cursor, null);
  assert.equal(NEUTRAL_INPUT.slot.length, 5);
  const src = { slot: [true], cursor: { x: 1, z: 2 } };
  const a = makeInput(src);
  assert.equal(a.slot.length, 5);
  assert.equal(a.slot[0], true);
  assert.notEqual(a.slot, src.slot);
  assert.notEqual(a.cursor, src.cursor);
  assert.deepEqual(makeInput().slotDown, [false, false, false, false, false]);
  assert.equal(makeInput().lmb, false);
});
