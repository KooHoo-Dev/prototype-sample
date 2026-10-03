// OWNER: P0 — 계약 §12.2(core.test) (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// rng 결정성 · 분포 · normalCdf/Inv · 각도 규약 · pointInConvex · piecewise · shoreZAt · 이벤트 버스 · 해시.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/core/constants.js';
import { EV, EventBus } from '../src/core/events.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import {
  angleDiff, approach, clamp, clamp01, damp, fwd, fwdX, fwdZ, invLerp, lerp, lerpAngle, piecewise, pointInConvex,
  round1, round3, shoreZAt, smoothstep, triangleWave, v2, v2add, v2dist, v2len, v2norm, v2scale, v2sub, wrapAngle, yawOf,
} from '../src/core/math.js';
import { mean, median, normalCdf, normalInv, quantile, sizeModelFromRange, variance, Z05, Z999 } from '../src/core/stats.js';
import { NEUTRAL_INPUT, makeInput } from '../src/core/inputFrame.js';
import { fnv1a, hash32, hashState, stableStringify } from '../src/core/hash.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b} (±${eps})`);

test('constants: 시간 단위 · 저장 키 · 열거', () => {
  assert.equal(C.DT, 1 / 60);
  assert.equal(C.TICKS_PER_HOUR * 24, C.TICKS_PER_DAY);
  assert.equal(C.TICKS_PER_MINUTE * 60, C.TICKS_PER_HOUR);
  assert.equal(C.TICKS_PER_DAY * C.DT, 3600);
  assert.ok(C.SAVE_KEY.startsWith(C.GAME_ID + ':'));
  assert.ok(C.SETTINGS_KEY.startsWith(C.GAME_ID + ':'));
  assert.ok(C.SAVE_BACKUP_KEY.startsWith(C.GAME_ID + ':'));
  assert.deepEqual(C.STAGE_IDS, C.SCENE_IDS.filter(s => s !== 'home'));
  assert.equal(C.RIG_PHASES.length, 11);
  assert.equal(C.HINT_IDS.length, 11);
  assert.equal(C.SKILL_IDS.length, 10);
});

test('rng: 같은 시드는 같은 열 · 상태는 {s} 하나 · seed 0 은 대체 값', () => {
  const a = makeRng(seedRng(42));
  const b = makeRng(seedRng(42));
  for (let i = 0; i < 1000; i++) assert.equal(a.next(), b.next());
  const st = seedRng(7);
  const r = makeRng(st);
  const before = st.s;
  r.next();
  assert.notEqual(st.s, before, '상태 객체를 직접 고친다');
  assert.deepEqual(Object.keys(st), ['s']);
  assert.equal(seedRng(0).s, 0x9e3779b9);
  assert.deepEqual(JSON.parse(JSON.stringify(st)), structuredClone(st));
  // 상태를 복사하면 같은 열이 이어진다
  const copy = makeRng(structuredClone(st));
  for (let i = 0; i < 50; i++) assert.equal(copy.next(), r.next());
});

test('rng: 분포 — next · range · int · chance · normal · pick', () => {
  const r = makeRng(seedRng(123));
  const N = 100000;
  const xs = [];
  for (let i = 0; i < N; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1);
    xs.push(v);
  }
  close(mean(xs), 0.5, 0.01, 'uniform mean');
  close(variance(xs), 1 / 12, 0.003, 'uniform var');

  const ns = [];
  for (let i = 0; i < N; i++) ns.push(r.normal());
  close(mean(ns), 0, 0.02, 'normal mean');
  close(variance(ns), 1, 0.03, 'normal var');

  const counts = [0, 0, 0, 0];
  for (let i = 0; i < 40000; i++) {
    const v = r.int(1, 3);
    assert.ok(Number.isInteger(v) && v >= 1 && v <= 3);
    counts[v]++;
  }
  for (const k of [1, 2, 3]) close(counts[k] / 40000, 1 / 3, 0.02, `int ${k}`);
  for (let i = 0; i < 1000; i++) {
    const v = r.range(2, 5);
    assert.ok(v >= 2 && v < 5);
    const w = r.range([0.5, 1.2]);
    assert.ok(w >= 0.5 && w < 1.2);
    const n = r.int([0, 1]);
    assert.ok(n === 0 || n === 1);
    const sg = r.sign();
    assert.ok(sg === 1 || sg === -1);
  }
  let hits = 0;
  for (let i = 0; i < N; i++) if (r.chance(0.3)) hits++;
  close(hits / N, 0.3, 0.01, 'chance');
  assert.equal(r.chance(0), false);
  assert.equal(r.chance(1), true);

  const tally = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 30000; i++) tally[r.pick({ a: 1, b: 2, c: 0 })]++;
  assert.equal(tally.c, 0);
  close(tally.b / 30000, 2 / 3, 0.02, 'pick record');
  const t2 = { x: 0, y: 0 };
  for (let i = 0; i < 20000; i++) t2[r.pick([{ id: 'x', w: 3 }, { id: 'y', w: 1 }])]++;
  close(t2.x / 20000, 0.75, 0.02, 'pick array');
  assert.equal(r.pick({ a: 0, b: -1 }), null);
  assert.equal(r.pick([]), null);
});

test('stats: normalCdf · normalInv 왕복 · 기준값', () => {
  // 기준값(배정밀도 참값)
  close(normalCdf(0), 0.5, 1e-12);
  close(normalCdf(1), 0.8413447460685429, 1e-9);
  close(normalCdf(1.96), 0.9750021048517795, 1e-9);
  close(normalCdf(-2.5), 0.006209665325776132, 1e-9);
  close(normalCdf(3.3), 0.9995165758576162, 1e-9);
  close(normalCdf(-6), 9.865876450376946e-10, 1e-12);
  // 심프슨 적분과 비교(계약: 오차 ≤ 1e-7)
  const pdf = x => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
  for (const z of [-3, -1.2, -0.3, 0.7, 2.2, 3.1]) {
    const a = -12;
    const n = 20000;
    const h = (z - a) / n;
    let s = pdf(a) + pdf(z);
    for (let i = 1; i < n; i++) s += pdf(a + i * h) * (i % 2 ? 4 : 2);
    close(normalCdf(z), s * h / 3, 1e-7, `cdf(${z})`);
  }
  // 왕복(계약: normalInv 오차 ≤ 1e-8)
  let worst = 0;
  for (let p = 0.0005; p < 0.9996; p += 0.00049) worst = Math.max(worst, Math.abs(normalCdf(normalInv(p)) - p));
  assert.ok(worst <= 1e-8, `왕복 오차 ${worst}`);
  close(normalInv(0.9), 1.2815515655446004, 1e-8);
  close(normalInv(0.99), 2.3263478740408408, 1e-8);
  close(normalInv(0.05), Z05, 1e-6);
  close(normalInv(0.999), Z999, 1e-6);
  assert.equal(normalInv(0), -Infinity);
  assert.equal(normalInv(1), Infinity);
});

test('stats: sizeModelFromRange 가 두 점을 정확히 지난다(§7.3.4)', () => {
  const m = sizeModelFromRange([40, 110], [1, 25]);
  close(Math.exp(m.mu + Z05 * m.sigma), 40, 1e-9);
  close(Math.exp(m.mu + Z999 * m.sigma), 110, 1e-9);
  close(m.a * Math.pow(40, m.b), 1, 1e-9);
  close(m.a * Math.pow(110, m.b), 25, 1e-9);
  close(Math.exp(m.mu), 56.8, 0.05, 'carp 중앙 cm');
});

test('stats: mean · variance(모분산) · median · quantile', () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.equal(variance([1, 2, 3, 4]), 1.25);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(quantile([0, 10], 0.25), 2.5);
  assert.ok(Number.isNaN(mean([])));
  const a = [3, 1, 2];
  quantile(a, 0.5);
  assert.deepEqual(a, [3, 1, 2], '입력을 정렬하지 않는다');
});

test('math: yaw 규약 — θ 0 은 −Z · +π/2 는 −X · yawOf(fwd(θ)) = θ', () => {
  const f0 = fwd(0);
  close(f0.x, 0, 1e-12);
  close(f0.z, -1, 1e-12);
  const f90 = fwd(Math.PI / 2);
  close(f90.x, -1, 1e-12);
  close(f90.z, 0, 1e-12);
  close(fwdX(0.3), -Math.sin(0.3), 1e-12);
  close(fwdZ(0.3), -Math.cos(0.3), 1e-12);
  for (let th = -3.1; th <= 3.1; th += 0.137) {
    const f = fwd(th, 2.5);
    close(v2len(f), 2.5, 1e-12);
    close(yawOf(f.x, f.z), th, 1e-12, `yawOf(fwd(${th}))`);
  }
  // 오른쪽 벡터 = (cos θ, −sin θ) 는 앞 벡터와 직교 · 위에서 보아 시계 방향
  const th = 0.7;
  const right = { x: Math.cos(th), z: -Math.sin(th) };
  const f = fwd(th);
  close(right.x * f.x + right.z * f.z, 0, 1e-12);
  close(angleDiff(th, yawOf(right.x, right.z)), -Math.PI / 2, 1e-12, '오른쪽 = yaw − π/2');
});

test('math: 각도 · 보간 · 클램프', () => {
  close(wrapAngle(3 * Math.PI), Math.PI, 1e-12);
  close(wrapAngle(-Math.PI), Math.PI, 1e-12, '(−π, π]');
  close(wrapAngle(Math.PI), Math.PI, 1e-12);
  close(angleDiff(3.0, -3.0), 2 * Math.PI - 6, 1e-12);
  close(lerpAngle(3.0, -3.0, 0.5), 3.0 + (Math.PI - 3.0), 1e-9);
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp01(-1), 0);
  assert.equal(lerp(2, 4, 0.25), 2.5);
  assert.equal(invLerp(2, 4, 3), 0.5);
  assert.equal(invLerp(2, 2, 3), 0);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  assert.equal(smoothstep(0, 1, 2), 1);
  assert.equal(approach(0, 10, 3), 3);
  assert.equal(approach(10, 0, 30), 0);
  close(damp(0, 1, 18, 1 / 60), 1 - Math.exp(-0.3), 1e-12);
  assert.equal(triangleWave(0), 0);
  assert.equal(triangleWave(0.5), 1);
  close(triangleWave(0.25), 0.5, 1e-12);
  close(triangleWave(1.75), 0.5, 1e-12);
  assert.equal(round1(22.04), 22);
  assert.equal(round3(1.23456), 1.235);
  assert.deepEqual(v2add(v2(1, 2), v2(3, 4)), { x: 4, z: 6 });
  assert.deepEqual(v2sub(v2(1, 2), v2(3, 4)), { x: -2, z: -2 });
  assert.deepEqual(v2scale(v2(1, 2), 2), { x: 2, z: 4 });
  assert.equal(v2dist(v2(0, 0), v2(3, 4)), 5);
  assert.deepEqual(v2norm(v2(0, 0)), { x: 0, z: 0 });
  close(v2len(v2norm(v2(3, -4))), 1, 1e-12);
});

test('math: piecewise · shoreZAt — 끝점 밖은 끝값 · 실내는 +Infinity', () => {
  const prof = [[0, 0.3], [10, 2.0], [25, 4.5], [45, 7.0]];
  assert.equal(piecewise(prof, -5), 0.3);
  assert.equal(piecewise(prof, 0), 0.3);
  assert.equal(piecewise(prof, 5), 1.15);
  close(piecewise(prof, 35), 5.75, 1e-12);
  assert.equal(piecewise(prof, 100), 7.0);
  assert.equal(piecewise([], 3), 0);
  const shore = [{ x: -60, z: 0.6 }, { x: -30, z: -0.4 }, { x: 0, z: 0 }];
  assert.equal(shoreZAt(shore, -100), 0.6);
  close(shoreZAt(shore, -45), 0.1, 1e-12);
  assert.equal(shoreZAt(shore, 50), 0);
  assert.equal(shoreZAt([], 0), Infinity);
});

test('math: pointInConvex — 신발끈 합 > 0 방향 · 경계 포함', () => {
  const poly = [{ x: -50, z: 1.4 }, { x: 50, z: 1.4 }, { x: 50, z: 36 }, { x: -50, z: 36 }];
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    area += a.x * b.z - b.x * a.z;
  }
  assert.ok(area > 0);
  assert.ok(pointInConvex(poly, 0, 20));
  assert.ok(pointInConvex(poly, -50, 1.4), '꼭짓점');
  assert.ok(pointInConvex(poly, 0, 1.4), '변 위');
  assert.ok(!pointInConvex(poly, 0, 1.39));
  assert.ok(!pointInConvex(poly, 51, 20));
  assert.ok(!pointInConvex([...poly].reverse(), 0, 20), '반대 방향 다각형은 안쪽이 비어 있다');
  assert.ok(!pointInConvex([{ x: 0, z: 0 }, { x: 1, z: 0 }], 0, 0));
});

test('inputFrame: NEUTRAL_INPUT 은 동결 · makeInput 은 새 객체', () => {
  assert.ok(Object.isFrozen(NEUTRAL_INPUT));
  assert.deepEqual(Object.keys(NEUTRAL_INPUT).sort(), [
    'bail', 'depthSteps', 'dragSteps', 'hook', 'interact', 'moveX', 'moveZ', 'pitch', 'primary', 'primaryPressed',
    'primaryReleased', 'secondary', 'selectSet', 'yaw',
  ]);
  assert.equal(NEUTRAL_INPUT.selectSet, null);
  assert.equal(NEUTRAL_INPUT.yaw, 0);
  const a = makeInput({ primary: true });
  const b = makeInput();
  assert.equal(a.primary, true);
  assert.equal(b.primary, false);
  assert.notEqual(a, b);
  a.hook = true;
  assert.equal(NEUTRAL_INPUT.hook, false);
});

test('events: 등록 순서 · onAny 먼저 · off · once · 시작 시점의 목록 · 예외 전파 · count', () => {
  const bus = new EventBus();
  const log = [];
  const offA = bus.on('x', p => log.push('a' + p.v));
  bus.on('x', p => log.push('b' + p.v));
  const offAny = bus.onAny((name, p) => log.push('any:' + name + p.v));
  bus.emit('x', { v: 1 });
  assert.deepEqual(log, ['any:x1', 'a1', 'b1']);
  offA();
  offAny();
  log.length = 0;
  bus.emit('x', { v: 2 });
  assert.deepEqual(log, ['b2']);

  const once = [];
  bus.once('y', p => once.push(p));
  bus.emit('y', 1);
  bus.emit('y', 2);
  assert.deepEqual(once, [1]);

  // 리스너가 emit 도중에 리스너를 더해도 이번 emit 에는 끼지 않는다
  const late = [];
  bus.on('z', () => bus.on('z', () => late.push('new')));
  bus.emit('z');
  assert.deepEqual(late, []);
  bus.emit('z');
  assert.deepEqual(late, ['new']);

  // 재진입: 리스너 안의 emit 은 즉시 동기 호출
  const order = [];
  bus.on('outer', () => { order.push('outer'); bus.emit('inner'); order.push('outer-end'); });
  bus.on('inner', () => order.push('inner'));
  bus.emit('outer');
  assert.deepEqual(order, ['outer', 'inner', 'outer-end']);

  bus.on('boom', () => { throw new Error('listener'); });
  assert.throws(() => bus.emit('boom'), /listener/);

  const n = bus.count();
  const off = bus.on('k', () => {});
  assert.equal(bus.count(), n + 1);
  off();
  assert.equal(bus.count(), n);
  bus.clear();
  assert.equal(bus.count(), 0);
  // 기본 payload
  let got = null;
  bus.on('p', p => { got = p; });
  bus.emit('p');
  assert.deepEqual(got, {});
});

test('events: EV 이름은 계약 §4 의 문자열 · 중복 없음', () => {
  const vals = Object.values(EV);
  assert.equal(new Set(vals).size, vals.length);
  assert.equal(EV.BITE_TAKE, 'bite/take');
  assert.equal(EV.SCENE_CHANGED, 'scene/changed');
  assert.equal(EV.RETRIEVE_DONE, 'rig/retrieved');
  assert.equal(EV.NET_START, 'fight/net');
  assert.equal(EV.PANEL_CLOSED, 'ui/closed');
  assert.equal(EV.AUDIO_UNLOCKED, 'app/audioUnlocked');
  assert.equal(Object.keys(EV).length, 57);
  for (const v of vals) assert.match(v, /^[a-z]+\/[A-Za-z]+$/);
});

test('hash: stableStringify 는 키 순서와 무관 · hashState 는 events · debug 를 뺀다 · hash32', () => {
  assert.equal(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] }), stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 }));
  assert.equal(stableStringify({ a: undefined, b: 1 }), '{"b":1}');
  assert.match(fnv1a('hello'), /^[0-9a-f]{8}$/);
  assert.equal(fnv1a(''), '811c9dc5');
  const s1 = { tick: 3, rng: { s: 9 }, events: [{ name: 'x' }], debug: { noBites: true }, profile: { money: 1 } };
  const s2 = { profile: { money: 1 }, debug: { noBites: false }, events: [], rng: { s: 9 }, tick: 3 };
  assert.equal(hashState(s1), hashState(s2));
  assert.notEqual(hashState(s1), hashState({ ...s2, tick: 4 }));
  const h = hash32(1, 2, 3);
  assert.ok(Number.isInteger(h) && h >= 0 && h < 2 ** 32);
  assert.equal(h, hash32(1, 2, 3));
  assert.notEqual(hash32(1, 2, 3), hash32(1, 2, 4));
  assert.notEqual(hash32(1, 2), hash32(2, 1));
  // 대략 고르게 퍼진다(날씨 뽑기에 쓴다)
  let lo = 0;
  for (let d = 1; d <= 4000; d++) if (hash32(12345, d, 1) / 2 ** 32 < 0.5) lo++;
  close(lo / 4000, 0.5, 0.03, 'hash32 균등');
});
