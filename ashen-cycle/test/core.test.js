// OWNER: P0 — 계약 §12.2 「core.test.js」
// 수학 · 난수 · 버스 · 입력 프레임 · 셰이프 판정 · 충돌 기하 + test/helpers.js 자체 점검.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as C from '../src/core/constants.js';
import { EV, EventBus } from '../src/core/events.js';
import { NEUTRAL_INPUT, makeInput } from '../src/core/inputFrame.js';
import {
  clamp, clamp01, lerp, invLerp, smoothstep, approach, damp, len, dist, distSq, normalize, angleOf, dirX, dirZ,
  fromAngle, wrapAngle, angleDiff, turnToward, lerpAngle, localToWorld, distPointSegment, isFiniteVec,
} from '../src/core/math2d.js';
import { createRng, hashSeed } from '../src/core/rng.js';
import { resolveShape, shapeHitsCircle, ringFromGrow } from '../src/core/hitShapes.js';
import {
  resolveCircleVsWorld, pushOutOfCircle, circleOverlapsWorld, segmentHitsCircle, sweepCircleVsWorld,
} from '../src/core/collide.js';
import {
  makeTestStats, makeTestProfile, makeTestPlayer, makeTestBoss, makeTestState, makeTestCtx, makeSynthBossDef,
  runTicks, countEvents, assertFiniteDeep,
} from './helpers.js';

const PI = Math.PI;
const near = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
const nearVec = (v, x, z, eps = 1e-9) => {
  near(v.x, x, eps, 'x');
  near(v.z, z, eps, 'z');
};
/** 각도 비교(±π 경계에서 부호가 갈려도 같은 각으로 본다). */
const nearAngle = (a, b, eps = 1e-9) => {
  near(Math.sin(a), Math.sin(b), eps, 'sin');
  near(Math.cos(a), Math.cos(b), eps, 'cos');
};

/**
 * src/types.js에서 `@typedef {Object} <name>`의 필수 @property 이름을 뽑는다(선택 필드 [x]는 뺀다).
 * @param {string} name
 * @returns {string[]}
 */
function typedefProps(name) {
  const src = readFileSync(new URL('../src/types.js', import.meta.url), 'utf8');
  const start = src.search(new RegExp(`@typedef \\{Object\\} ${name}\\r?\\n`));
  assert.ok(start >= 0, `typedef ${name} not found`);
  const body = src.slice(start, src.indexOf('*/', start));
  const out = [];
  for (const line of body.split(/\r?\n/)) {
    const at = line.indexOf('@property');
    if (at < 0) continue;
    let i = line.indexOf('{', at);
    let depth = 0;
    for (; i < line.length; i++) {
      if (line[i] === '{') depth += 1;
      else if (line[i] === '}' && --depth === 0) break;
    }
    const m = /^\s*(\[?)(\w+)/.exec(line.slice(i + 1));
    assert.ok(m, `cannot parse: ${line}`);
    if (!m[1]) out.push(m[2]);
  }
  return out.sort();
}
const keysOf = (o) => Object.keys(o).sort();

describe('constants', () => {
  test('고정 틱 · ID 목록', () => {
    near(C.DT, 1 / 60);
    near(C.TAU, PI * 2);
    assert.deepEqual(C.BOSS_IDS, ['valder', 'fenrir', 'nihil']);
    assert.deepEqual(C.WEAPON_IDS, ['longsword', 'greatsword', 'spear']);
    assert.deepEqual(C.STAT_IDS, ['vit', 'end', 'str', 'dex']);
    assert.deepEqual(C.FACILITY_IDS, ['bonfire', 'blacksmith', 'merchant', 'gate']);
    assert.equal(C.PANEL_IDS.length, 7);
    assert.equal(C.CUE_IDS.length, 16);
    assert.equal(new Set(C.CUE_IDS).size, 16);
    assert.equal(C.HAZARD_KINDS.length, 6);
    assert.deepEqual(C.PROJECTILE_KINDS, ['void_orb']);
    assert.equal(C.SAVE_KEY, 'ashen-cycle/save');
    assert.equal(C.SAVE_BACKUP_KEY, 'ashen-cycle/save.bak');
    assert.equal(C.SETTINGS_KEY, 'ashen-cycle/settings');
  });
});

describe('math2d — 각도 규약(§0.2)', () => {
  test('fromAngle · angleOf · dirX/dirZ', () => {
    nearVec(fromAngle(0), 0, 1);
    nearVec(fromAngle(PI / 2), 1, 0);
    nearVec(fromAngle(PI), 0, -1);
    nearVec(fromAngle(PI / 2, 3), 3, 0);
    near(angleOf(1, 0), PI / 2);
    near(angleOf(0, 1), 0);
    near(angleOf(0, -1), PI);
    near(angleOf(-1, 0), -PI / 2);
    near(dirX(PI / 2), 1);
    near(dirZ(0), 1);
  });

  test('localToWorld — 오른쪽 = −X(+Z를 볼 때)', () => {
    nearVec(localToWorld(0, 0, 0, 0, 1), -1, 0);
    nearVec(localToWorld(0, 0, 0, 2, 0), 0, 2);
    // +X를 보면(θ = π/2) 앞 = +X, 오른쪽 = +Z
    nearVec(localToWorld(1, 1, PI / 2, 2, 0), 3, 1);
    nearVec(localToWorld(1, 1, PI / 2, 0, 1), 1, 2);
    // 오른쪽 벡터 = (−cos θ, sin θ)
    const th = 0.7;
    nearVec(localToWorld(0, 0, th, 0, 1), -Math.cos(th), Math.sin(th));
  });

  test('wrapAngle 경계 — (−π, π]', () => {
    near(wrapAngle(0), 0);
    near(wrapAngle(PI), PI);
    near(wrapAngle(-PI), PI);
    nearAngle(wrapAngle(3 * PI), PI);
    nearAngle(wrapAngle(-3 * PI), PI);
    near(wrapAngle(PI + 0.1), -PI + 0.1);
    near(wrapAngle(-PI - 0.1), PI - 0.1);
    near(wrapAngle(2 * PI), 0);
    near(wrapAngle(7 * PI + 0.25), -PI + 0.25, 1e-9);
    for (let a = -20; a <= 20; a += 0.37) {
      const w = wrapAngle(a);
      assert.ok(w > -PI && w <= PI, `wrapAngle(${a}) = ${w}`);
      near(Math.sin(w), Math.sin(a), 1e-9);
      near(Math.cos(w), Math.cos(a), 1e-9);
    }
  });

  test('angleDiff 부호 — +는 θ가 커지는 방향', () => {
    near(angleDiff(0, 0.5), 0.5);
    near(angleDiff(0.5, 0), -0.5);
    near(angleDiff(PI - 0.1, -PI + 0.1), 0.2);
    near(angleDiff(-PI + 0.1, PI - 0.1), -0.2);
  });

  test('turnToward — 최단 호로 돌고 넘치지 않는다', () => {
    near(turnToward(0, 1, 0.3), 0.3);
    near(turnToward(0, -1, 0.3), -0.3);
    near(turnToward(0, 0.2, 0.3), 0.2);
    // ±π를 건너는 최단 호
    near(turnToward(PI - 0.1, -PI + 0.1, 0.05), PI - 0.05);
    near(turnToward(PI - 0.1, -PI + 0.1, 0.15), -PI + 0.05);
    near(turnToward(PI - 0.1, -PI + 0.1, 1), -PI + 0.1);
    // 반복해도 목표를 지나치지 않는다
    let a = 2.5;
    for (let i = 0; i < 100; i++) a = turnToward(a, -2.5, 0.07);
    near(a, -2.5);
  });

  test('lerpAngle — ±π를 건넌다', () => {
    nearAngle(lerpAngle(PI - 0.2, -PI + 0.2, 0.5), PI);
    near(lerpAngle(PI - 0.2, -PI + 0.2, 0.25), PI - 0.1);
    near(lerpAngle(0, 1, 0), 0);
    near(lerpAngle(0, 1, 1), 1);
  });

  test('스칼라 · 벡터 보조', () => {
    assert.equal(clamp(5, 0, 3), 3);
    assert.equal(clamp(-1, 0, 3), 0);
    assert.equal(clamp(2, 0, 3), 2);
    assert.equal(clamp01(1.5), 1);
    assert.equal(clamp01(-0.5), 0);
    near(lerp(2, 6, 0.25), 3);
    near(invLerp(2, 6, 3), 0.25);
    near(invLerp(2, 6, 10), 2); // clamp 없음
    assert.equal(invLerp(1, 1, 5), 0);
    assert.equal(smoothstep(0), 0);
    assert.equal(smoothstep(1), 1);
    near(smoothstep(0.5), 0.5);
    assert.equal(smoothstep(2), 1);
    near(len(3, 4), 5);
    near(dist(1, 1, 4, 5), 5);
    near(distSq(1, 1, 4, 5), 25);
    nearVec(normalize(3, 4), 0.6, 0.8);
    assert.deepEqual(normalize(0, 0), { x: 0, z: 0 });
    assert.equal(isFiniteVec({ x: 1, z: 2 }), true);
    assert.equal(isFiniteVec({ x: NaN, z: 2 }), false);
    assert.equal(isFiniteVec({ x: 1, z: Infinity }), false);
    assert.equal(isFiniteVec(null), false);
  });

  test('distPointSegment — 끝점 · 중간', () => {
    near(distPointSegment(0, 1, -1, 0, 1, 0), 1); // 중간
    near(distPointSegment(3, 0, -1, 0, 1, 0), 2); // b 끝 너머
    near(distPointSegment(-4, 4, -1, 0, 1, 0), 5); // a 끝 너머(3-4-5)
    near(distPointSegment(0.5, 0, -1, 0, 1, 0), 0); // 선분 위
    near(distPointSegment(3, 4, 0, 0, 0, 0), 5); // 길이 0 선분
  });

  test('approach · damp 수렴', () => {
    assert.equal(approach(0, 1, 0.3), 0.3);
    assert.equal(approach(0.9, 1, 0.3), 1);
    near(approach(1, 0, 0.3), 0.7);
    assert.equal(approach(0.1, 0, 0.3), 0);
    assert.equal(approach(5, 5, 1), 5);
    let v = 0;
    for (let i = 0; i < 600; i++) v = damp(v, 10, 8, C.DT);
    near(v, 10, 1e-6);
    near(damp(0, 10, 8, 0), 0); // dt 0이면 그대로
    const one = damp(0, 10, 8, C.DT);
    assert.ok(one > 0 && one < 10);
    near(one, 10 * (1 - Math.exp(-8 * C.DT)));
  });
});

describe('rng', () => {
  test('같은 시드 → 같은 수열, 다른 시드 → 다른 수열', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    const c = createRng(1235);
    const sa = Array.from({ length: 50 }, () => a.next());
    const sb = Array.from({ length: 50 }, () => b.next());
    const sc = Array.from({ length: 50 }, () => c.next());
    assert.deepEqual(sa, sb);
    assert.notDeepEqual(sa, sc);
    for (const v of sa) assert.ok(v >= 0 && v < 1);
    // 값이 한쪽에 몰리지 않는다
    const mean = sa.reduce((s, v) => s + v, 0) / sa.length;
    assert.ok(mean > 0.3 && mean < 0.7, `mean ${mean}`);
  });

  test('getState/setState 왕복', () => {
    const r = createRng(99);
    for (let i = 0; i < 10; i++) r.next();
    const s = r.getState();
    assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff);
    const after = Array.from({ length: 20 }, () => r.next());
    r.setState(s);
    assert.deepEqual(Array.from({ length: 20 }, () => r.next()), after);
    const r2 = createRng(0);
    r2.setState(s);
    assert.deepEqual(Array.from({ length: 20 }, () => r2.next()), after);
  });

  test('시드는 uint32로 강제된다', () => {
    assert.equal(createRng(-1).getState(), 0xffffffff);
    assert.equal(createRng(2 ** 32 + 5).getState(), 5);
    assert.equal(createRng(undefined).getState(), 0);
  });

  test('range/int/chance/pick 범위', () => {
    const r = createRng(7);
    const ints = new Set();
    for (let i = 0; i < 2000; i++) {
      const f = r.range(-2, 3);
      assert.ok(f >= -2 && f < 3);
      const n = r.int(2, 5);
      assert.ok(Number.isInteger(n) && n >= 2 && n <= 5);
      ints.add(n);
    }
    assert.deepEqual([...ints].sort(), [2, 3, 4, 5]); // 양끝 포함
    assert.equal(r.int(4, 4), 4);
    for (let i = 0; i < 200; i++) {
      assert.equal(r.chance(0), false);
      assert.equal(r.chance(1), true);
    }
    let hits = 0;
    for (let i = 0; i < 4000; i++) if (r.chance(0.25)) hits += 1;
    assert.ok(hits > 800 && hits < 1200, `chance(0.25) hits ${hits}/4000`);
    const arr = ['a', 'b', 'c'];
    const picked = new Set();
    for (let i = 0; i < 200; i++) {
      const v = r.pick(arr);
      assert.ok(arr.includes(v));
      picked.add(v);
    }
    assert.equal(picked.size, 3);
    assert.equal(r.pick([]), undefined);
  });

  test('hashSeed — uint32 · 결정적 · 인자에 민감', () => {
    const h = hashSeed(1, 0);
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
    assert.equal(hashSeed(1, 0), h);
    const set = new Set();
    for (let a = 0; a < 20; a++) for (let b = 0; b < 20; b++) set.add(hashSeed(a, b));
    assert.equal(set.size, 400);
    assert.notEqual(hashSeed(1, 2), hashSeed(2, 1));
  });
});

describe('EventBus', () => {
  test('등록 순서 호출 · 기본 payload', () => {
    const bus = new EventBus();
    const log = [];
    bus.on('a', (p) => log.push(['1', p]));
    bus.on('a', (p) => log.push(['2', p]));
    bus.on('b', () => log.push(['b']));
    const payload = { v: 1 };
    bus.emit('a', payload);
    assert.deepEqual(log.map((l) => l[0]), ['1', '2']);
    assert.equal(log[0][1], payload);
    let got;
    bus.on('c', (p) => { got = p; });
    bus.emit('c');
    assert.deepEqual(got, {});
    bus.emit('none'); // 리스너 없음 — 예외 없음
  });

  test('off · on이 돌려준 off 함수', () => {
    const bus = new EventBus();
    let n = 0;
    const fn = () => { n += 1; };
    const off = bus.on('a', fn);
    bus.emit('a');
    off();
    bus.emit('a');
    assert.equal(n, 1);
    bus.on('a', fn);
    bus.off('a', fn);
    bus.emit('a');
    assert.equal(n, 1);
    bus.off('zzz', fn); // 없는 이름 — 예외 없음
  });

  test('once', () => {
    const bus = new EventBus();
    let n = 0;
    bus.once('a', () => { n += 1; });
    bus.emit('a');
    bus.emit('a');
    assert.equal(n, 1);
    // off 함수로 미리 해제
    const off = bus.once('a', () => { n += 10; });
    off();
    bus.emit('a');
    assert.equal(n, 1);
    // 원래 함수로도 해제된다
    const fn = () => { n += 100; };
    bus.once('a', fn);
    bus.off('a', fn);
    bus.emit('a');
    assert.equal(n, 1);
  });

  test('onAny — 이름 리스너보다 먼저, off 가능', () => {
    const bus = new EventBus();
    const log = [];
    const off = bus.onAny((name, p) => log.push(`any:${name}:${p.v ?? ''}`));
    bus.on('a', () => log.push('a'));
    bus.emit('a', { v: 7 });
    bus.emit('b');
    assert.deepEqual(log, ['any:a:7', 'a', 'any:b:']);
    off();
    bus.emit('a');
    assert.equal(log.length, 4);
  });

  test('리스너 예외는 전파된다', () => {
    const bus = new EventBus();
    let after = 0;
    bus.on('a', () => { throw new Error('boom'); });
    bus.on('a', () => { after += 1; });
    assert.throws(() => bus.emit('a'), /boom/);
    assert.equal(after, 0);
  });

  test('emit 도중의 on/off · 재진입', () => {
    const bus = new EventBus();
    const log = [];
    const second = () => log.push('second');
    bus.on('a', () => {
      log.push('first');
      bus.off('a', second); // 도중에 해제된 리스너는 불리지 않는다
      bus.on('a', () => log.push('late')); // 도중에 등록된 리스너는 이번 emit에 불리지 않는다
    });
    bus.on('a', second);
    bus.emit('a');
    assert.deepEqual(log, ['first']);
    // 리스너 안에서 다른 이벤트를 내도 된다
    const bus2 = new EventBus();
    const order = [];
    bus2.on('x', () => { order.push('x1'); bus2.emit('y'); order.push('x1-end'); });
    bus2.on('x', () => order.push('x2'));
    bus2.on('y', () => order.push('y'));
    bus2.emit('x');
    assert.deepEqual(order, ['x1', 'y', 'x1-end', 'x2']);
  });

  test('clear', () => {
    const bus = new EventBus();
    let n = 0;
    bus.on('a', () => { n += 1; });
    bus.onAny(() => { n += 1; });
    bus.clear();
    bus.emit('a');
    assert.equal(n, 0);
  });

  test('EV — 키 52개 · 값이 서로 다르다', () => {
    const values = Object.values(EV);
    assert.equal(values.length, 52);
    assert.equal(new Set(values).size, values.length);
    assert.equal(EV.MODE_CHANGED, 'mode/changed');
    assert.equal(EV.HIT, 'combat/hit');
    assert.equal(EV.LOCKON_CHANGED, 'player/lockOn');
    assert.equal(EV.PROFILE_CHANGED, 'profile/changed');
    assert.equal(EV.SAVED, 'app/saved');
    assert.ok(Object.isFrozen(EV));
  });
});

describe('inputFrame', () => {
  test('NEUTRAL_INPUT 동결 · 전 필드', () => {
    assert.ok(Object.isFrozen(NEUTRAL_INPUT));
    assert.deepEqual(keysOf(NEUTRAL_INPUT), typedefProps('InputFrame'));
    assert.deepEqual(Object.keys(NEUTRAL_INPUT).sort(), [
      'flaskPressed', 'guard', 'heavyHeld', 'heavyPressed', 'interactPressed', 'lightPressed', 'lockOnPressed',
      'moveX', 'moveZ', 'rollPressed', 'sprint',
    ]);
    assert.throws(() => { 'use strict'; NEUTRAL_INPUT.moveX = 1; }, TypeError);
    assert.equal(NEUTRAL_INPUT.moveX, 0);
  });

  test('makeInput — 새 객체 · partial 반영', () => {
    const a = makeInput();
    assert.deepEqual(a, { ...NEUTRAL_INPUT });
    assert.notEqual(a, NEUTRAL_INPUT);
    assert.equal(Object.isFrozen(a), false);
    const b = makeInput({ moveX: 0.5, lightPressed: true });
    assert.equal(b.moveX, 0.5);
    assert.equal(b.lightPressed, true);
    assert.equal(b.rollPressed, false);
    assert.equal(NEUTRAL_INPUT.lightPressed, false);
  });
});

describe('hitShapes', () => {
  test('resolveShape — circle fwd/side', () => {
    const s = resolveShape({ type: 'circle', r: 2, fwd: 3, side: 1 }, 10, 5, 0);
    assert.equal(s.type, 'circle');
    near(s.x, 9); // 오른쪽 = −X
    near(s.z, 8);
    near(s.r, 2);
    const s0 = resolveShape({ type: 'circle', r: 1 }, 1, 2, 1.3);
    nearVec(s0, 1, 2);
    const s2 = resolveShape({ type: 'circle', r: 1, fwd: 2 }, 0, 0, PI / 2);
    nearVec(s2, 2, 0);
  });

  test('resolveShape — arc dirOffset · rInner 기본값', () => {
    const s = resolveShape({ type: 'arc', r: 4, halfAngle: 1 }, 1, 2, 0.5);
    assert.deepEqual(s, { type: 'arc', x: 1, z: 2, r: 4, rInner: 0, dir: 0.5, halfAngle: 1 });
    const back = resolveShape({ type: 'arc', r: 5, rInner: 1, halfAngle: 1.75, dirOffset: PI }, 0, 0, 0.5);
    near(back.dir, wrapAngle(0.5 + PI));
    assert.equal(back.rInner, 1);
  });

  test('resolveShape — ring · capsule · 모르는 타입', () => {
    assert.deepEqual(resolveShape({ type: 'ring', rInner: 2, rOuter: 3 }, 4, 5, 1), { type: 'ring', x: 4, z: 5, rInner: 2, rOuter: 3 });
    const c = resolveShape({ type: 'capsule', fwd0: 1, fwd1: 4, side: 0.5, r: 0.7 }, 0, 0, 0);
    near(c.ax, -0.5);
    near(c.az, 1);
    near(c.bx, -0.5);
    near(c.bz, 4);
    near(c.r, 0.7);
    const c2 = resolveShape({ type: 'capsule', fwd0: 0, fwd1: 3, r: 1 }, 1, 1, PI / 2);
    near(c2.ax, 1);
    near(c2.az, 1);
    near(c2.bx, 4);
    near(c2.bz, 1);
    assert.throws(() => resolveShape({ type: 'box' }, 0, 0, 0));
  });

  test('circle — 명중/빗나감 경계', () => {
    const s = { type: 'circle', x: 0, z: 0, r: 2 };
    assert.equal(shapeHitsCircle(s, 2.39, 0, 0.4), true);
    assert.equal(shapeHitsCircle(s, 2.41, 0, 0.4), false);
    assert.equal(shapeHitsCircle(s, 0, 0, 0.4), true);
  });

  test('ring — 안쪽 구멍 · 바깥', () => {
    const s = { type: 'ring', x: 0, z: 0, rInner: 3, rOuter: 4 };
    assert.equal(shapeHitsCircle(s, 0, 0, 0.4), false); // 구멍 한가운데
    assert.equal(shapeHitsCircle(s, 2.5, 0, 0.4), false); // 구멍 안(2.9 < 3)
    assert.equal(shapeHitsCircle(s, 2.7, 0, 0.4), true); // 안쪽 가장자리에 걸침
    assert.equal(shapeHitsCircle(s, 3.5, 0, 0.4), true);
    assert.equal(shapeHitsCircle(s, 0, -4.3, 0.4), true); // 바깥 가장자리에 걸침
    assert.equal(shapeHitsCircle(s, 4.5, 0, 0.4), false);
  });

  test('arc — 정면 · 등 뒤 · 안쪽 반경 · 가장자리 여유', () => {
    const s = resolveShape({ type: 'arc', r: 4, rInner: 1, halfAngle: 1.0 }, 0, 0, 0);
    assert.equal(shapeHitsCircle(s, 0, 3, 0.4), true); // 정면
    assert.equal(shapeHitsCircle(s, 0, -3, 0.4), false); // 등 뒤
    assert.equal(shapeHitsCircle(s, 0, 4.3, 0.4), true); // 반경 끝에 걸침
    assert.equal(shapeHitsCircle(s, 0, 4.5, 0.4), false); // 반경 밖
    assert.equal(shapeHitsCircle(s, 0, 0.5, 0.4), false); // 안쪽 반경보다 안(0.9 < 1)
    assert.equal(shapeHitsCircle(s, 0, 0.7, 0.4), true); // 안쪽 반경에 걸침
    // 각 가장자리: 원의 각반경 asin(cr/d)만큼 여유
    const d = 3;
    const cr = 0.4;
    const edge = 1.0 + Math.asin(cr / d);
    const at = (a) => fromAngle(a, d);
    const inP = at(edge - 0.01);
    const outP = at(edge + 0.01);
    assert.equal(shapeHitsCircle(s, inP.x, inP.z, cr), true);
    assert.equal(shapeHitsCircle(s, outP.x, outP.z, cr), false);
    const inN = at(-edge + 0.01);
    assert.equal(shapeHitsCircle(s, inN.x, inN.z, cr), true);
  });

  test('arc — halfAngle ≥ π면 원 · 원점을 덮는 대상 · dirOffset', () => {
    const full = resolveShape({ type: 'arc', r: 3, halfAngle: PI }, 0, 0, 0);
    assert.equal(shapeHitsCircle(full, 0, -2, 0.4), true);
    const narrow = resolveShape({ type: 'arc', r: 3, halfAngle: 0.2 }, 0, 0, 0);
    assert.equal(shapeHitsCircle(narrow, 0, -0.3, 0.4), true); // d ≤ cr — 원점을 덮는다
    assert.equal(shapeHitsCircle(narrow, 0, -1, 0.4), false);
    const tail = resolveShape({ type: 'arc', r: 5, halfAngle: 1.0, dirOffset: PI }, 0, 0, 0);
    assert.equal(shapeHitsCircle(tail, 0, -3, 0.4), true); // 뒤쪽 부채
    assert.equal(shapeHitsCircle(tail, 0, 3, 0.4), false);
    // ±π를 건너는 각 비교
    const wrap = resolveShape({ type: 'arc', r: 5, halfAngle: 0.5 }, 0, 0, PI - 0.1);
    const p = fromAngle(-PI + 0.2, 3);
    assert.equal(shapeHitsCircle(wrap, p.x, p.z, 0.1), true);
  });

  test('capsule — 옆 · 끝', () => {
    const s = resolveShape({ type: 'capsule', fwd0: 0.5, fwd1: 3, r: 0.6 }, 0, 0, 0);
    assert.equal(shapeHitsCircle(s, 0.9, 2, 0.4), true); // 옆(0.9 < 1.0)
    assert.equal(shapeHitsCircle(s, 1.1, 2, 0.4), false);
    assert.equal(shapeHitsCircle(s, 0, 3.9, 0.4), true); // 앞 끝(0.9 < 1.0)
    assert.equal(shapeHitsCircle(s, 0, 4.1, 0.4), false);
    assert.equal(shapeHitsCircle(s, 0, -0.4, 0.4), true); // 뒤 끝(0.9 < 1.0)
    assert.equal(shapeHitsCircle(s, 0, -0.6, 0.4), false);
    // 모서리(끝점 대각): 거리 = hypot(0.8, 0.8) = 1.13 > 1.0
    assert.equal(shapeHitsCircle(s, 0.8, 3.8, 0.4), false);
    assert.throws(() => shapeHitsCircle({ type: 'box' }, 0, 0, 1));
  });

  test('ringFromGrow — u = 0 · 1 · 중간 · rInner 하한', () => {
    const grow = { r0: 2, r1: 10, width: 1 };
    assert.deepEqual(ringFromGrow(1, 2, grow, 0), { type: 'ring', x: 1, z: 2, rInner: 1.5, rOuter: 2.5 });
    assert.deepEqual(ringFromGrow(1, 2, grow, 1), { type: 'ring', x: 1, z: 2, rInner: 9.5, rOuter: 10.5 });
    const mid = ringFromGrow(0, 0, grow, 0.5);
    near(mid.rInner, 5.5);
    near(mid.rOuter, 6.5);
    const small = ringFromGrow(0, 0, { r0: 0.2, r1: 5, width: 1 }, 0);
    assert.equal(small.rInner, 0);
    near(small.rOuter, 0.7);
    assert.deepEqual(ringFromGrow(0, 0, grow, 2), ringFromGrow(0, 0, grow, 1)); // 범위 밖은 자른다
  });
});

describe('collide', () => {
  const world = {
    id: 'test', kind: 'arena', theme: 'ember', radius: 10,
    colliders: [
      { type: 'circle', x: 5, z: 0, r: 1 },
      { type: 'box', x: -5, z: 0, hw: 2, hd: 1 },
    ],
    playerSpawn: { x: 0, z: 0, facing: 0 }, bossSpawn: null, facilities: [], dummy: null, npcs: [],
  };

  test('pushOutOfCircle — 겹침 없음 · 겹침 · 중심 일치(NaN 없음)', () => {
    const a = { x: 3, z: 0 };
    assert.equal(pushOutOfCircle(a, 0.4, 0, 0, 1), false);
    assert.deepEqual(a, { x: 3, z: 0 });
    const b = { x: 1, z: 0 };
    assert.equal(pushOutOfCircle(b, 0.4, 0, 0, 1), true);
    nearVec(b, 1.4, 0);
    const c = { x: 2, z: 3 };
    assert.equal(pushOutOfCircle(c, 0.4, 2, 3, 1), true);
    nearVec(c, 2, 4.4); // +Z 쪽으로
    assert.ok(isFiniteVec(c));
    const d = { x: -0.3, z: -0.4 };
    pushOutOfCircle(d, 0.5, 0, 0, 1);
    near(len(d.x, d.z), 1.5);
    near(d.x / d.z, 0.75); // 방향 유지
  });

  test('resolveCircleVsWorld — 경계 안으로', () => {
    const p = { x: 0, z: 12 };
    assert.equal(resolveCircleVsWorld(p, 0.4, world), true);
    nearVec(p, 0, 9.6);
    const q = { x: 0, z: 3 };
    assert.equal(resolveCircleVsWorld(q, 0.4, world), false);
    assert.deepEqual(q, { x: 0, z: 3 });
    const diag = { x: 20, z: 20 };
    resolveCircleVsWorld(diag, 0.4, world);
    near(len(diag.x, diag.z), 9.6);
  });

  test('resolveCircleVsWorld — 원 콜라이더 밀어내기', () => {
    const p = { x: 4.2, z: 0 };
    assert.equal(resolveCircleVsWorld(p, 0.4, world), true);
    nearVec(p, 3.6, 0);
    assert.equal(circleOverlapsWorld(p.x, p.z, 0.4, world), false);
  });

  test('resolveCircleVsWorld — 상자 밀어내기(변 · 모서리 · 안쪽)', () => {
    // 변: 상자 위쪽(z+) 면에 걸침
    const side = { x: -5, z: 1.2 };
    assert.equal(resolveCircleVsWorld(side, 0.4, world), true);
    nearVec(side, -5, 1.4);
    // 모서리: (−3, 1) 꼭짓점 근처
    const corner = { x: -2.8, z: 1.2 };
    assert.equal(resolveCircleVsWorld(corner, 0.4, world), true);
    near(dist(corner.x, corner.z, -3, 1), 0.4);
    // 안쪽: 가장 얕은 축(z)으로
    const inside = { x: -5.5, z: 0.6 };
    assert.equal(resolveCircleVsWorld(inside, 0.4, world), true);
    nearVec(inside, -5.5, 1.4);
    // 안쪽: x가 더 얕다
    const insideX = { x: -3.2, z: 0.1 };
    resolveCircleVsWorld(insideX, 0.4, world);
    nearVec(insideX, -2.6, 0.1);
    // 정중앙도 NaN 없이 밖으로
    const center = { x: -5, z: 0 };
    resolveCircleVsWorld(center, 0.4, world);
    assert.ok(isFiniteVec(center));
    assert.equal(circleOverlapsWorld(center.x, center.z, 0.4, world), false);
    // 닿지 않으면 그대로
    const far = { x: -5, z: 3 };
    assert.equal(resolveCircleVsWorld(far, 0.4, world), false);
  });

  test('circleOverlapsWorld', () => {
    assert.equal(circleOverlapsWorld(0, 0, 0.4, world), false);
    assert.equal(circleOverlapsWorld(0, 9.7, 0.4, world), true); // 경계 밖(9.7 + 0.4 > 10)
    assert.equal(circleOverlapsWorld(0, 9.5, 0.4, world), false);
    assert.equal(circleOverlapsWorld(4, 0, 0.4, world), true); // 원 콜라이더(1 < 1.4)
    assert.equal(circleOverlapsWorld(3.5, 0, 0.4, world), false);
    assert.equal(circleOverlapsWorld(-5, 1.3, 0.4, world), true); // 상자 변
    assert.equal(circleOverlapsWorld(-5, 1.5, 0.4, world), false);
    assert.equal(circleOverlapsWorld(-5, 0, 0.4, world), true); // 상자 안
    assert.equal(circleOverlapsWorld(-2.7, 1.3, 0.4, world), false); // 모서리 대각(거리 0.42 > 0.4)
    assert.equal(circleOverlapsWorld(-2.8, 1.2, 0.4, world), true); // 모서리 대각(거리 0.28)
  });

  test('segmentHitsCircle — 관통 · 스침 · 빗나감 · 시작점이 원 안', () => {
    near(segmentHitsCircle(-5, 0, 5, 0, 0, 0, 1), 0.4); // 관통: x = −1에서 처음 닿는다
    const graze = segmentHitsCircle(-5, 0.999, 5, 0.999, 0, 0, 1); // 스침
    assert.ok(graze !== null && graze > 0.45 && graze < 0.5, `graze ${graze}`);
    assert.equal(segmentHitsCircle(-5, 1.001, 5, 1.001, 0, 0, 1), null); // 빗나감
    assert.equal(segmentHitsCircle(0.2, 0.1, 5, 0, 0, 0, 1), 0); // 시작점이 원 안
    assert.equal(segmentHitsCircle(-5, 0, -2, 0, 0, 0, 1), null); // 닿기 전에 끝난다
    assert.equal(segmentHitsCircle(2, 0, 5, 0, 0, 0, 1), null); // 원에서 멀어진다
    assert.equal(segmentHitsCircle(3, 3, 3, 3, 0, 0, 1), null); // 길이 0 · 원 밖
    near(segmentHitsCircle(-3, 0, -1, 0, 0, 0, 1), 1); // 끝점이 딱 닿는다
  });

  test('(W5) sweepCircleVsWorld — 콜라이더 · 경계에 처음 닿기까지의 거리', () => {
    // 원 콜라이더 (5, 0, r 1) · 반경 0.5의 원을 +X로: 중심 거리 1.5에서 닿는다 → 3.5
    near(sweepCircleVsWorld(0, 0, 1, 0, 9, 0.5, world), 3.5);
    // 닿기 전에 끝나면 그대로 · 길이 0이면 0
    assert.equal(sweepCircleVsWorld(0, 0, 1, 0, 2, 0.5, world), 2);
    assert.equal(sweepCircleVsWorld(0, 0, 1, 0, 0, 0.5, world), 0);
    // 스쳐 지나가면(옆으로 1.6m — 1.5m보다 멀다) 막히지 않고 경계(10 − 0.5)까지: z 1.6에서 x = sqrt(9.5² − 1.6²)
    near(sweepCircleVsWorld(0, 1.6, 1, 0, 30, 0.5, world), Math.sqrt(9.5 * 9.5 - 1.6 * 1.6));
    // 옆으로 1.2m면 걸린다: x = 5 − sqrt(1.5² − 1.2²)
    near(sweepCircleVsWorld(0, 1.2, 1, 0, 30, 0.5, world), 5 - Math.sqrt(1.5 * 1.5 - 1.2 * 1.2));
    // 닿은 자리에 서면 콜라이더와 겹치지 않는다(맞닿음)
    const d = sweepCircleVsWorld(0, 1.2, 1, 0, 30, 0.5, world);
    assert.equal(circleOverlapsWorld(d, 1.2, 0.5, world), false);
    // 이미 맞닿은 채 파고드는 방향이면 0, 멀어지는 방향이면 막지 않는다
    assert.equal(sweepCircleVsWorld(3.5, 0, 1, 0, 3, 0.5, world), 0);
    assert.equal(sweepCircleVsWorld(3.5, 0, -1, 0, 3, 0.5, world), 3);
    assert.equal(sweepCircleVsWorld(3.5, 0, 0, 1, 3, 0.5, world), 3, '접선 방향');
    // 상자 (−5, 0, hw 2 · hd 1): 반경만큼 부푼 상자의 +X 면(x = −2.5)에서 멎는다
    near(sweepCircleVsWorld(0, 0, -1, 0, 9, 0.5, world), 2.5);
    near(sweepCircleVsWorld(0, 0.9, -1, 0, 9, 0.5, world), 2.5);
    // 상자 옆(z 1.6 — 부푼 상자 1.5 밖)으로는 지나간다
    near(sweepCircleVsWorld(0, 1.6, -1, 0, 30, 0.5, world), Math.sqrt(9.5 * 9.5 - 1.6 * 1.6));
    // 경계: 원점에서 +Z로 → 10 − 0.5. 경계에 닿은 채 바깥으로는 0, 안쪽으로는 간다
    near(sweepCircleVsWorld(0, 0, 0, 1, 30, 0.5, world), 9.5);
    assert.equal(sweepCircleVsWorld(0, 9.5, 0, 1, 3, 0.5, world), 0);
    assert.equal(sweepCircleVsWorld(0, 9.5, 0, -1, 3, 0.5, world), 3);
    // 대각선 · 결과는 항상 0..dist의 유한한 수
    for (const [x, z, a] of [[0, 0, 0.3], [-9, 0, 1.2], [4, 4, -2.5], [9.5, 0, 3.1], [3.5, 0, 0.01]]) {
      const got = sweepCircleVsWorld(x, z, Math.sin(a), Math.cos(a), 12, 0.5, world);
      assert.ok(Number.isFinite(got) && got >= 0 && got <= 12, `(${x}, ${z}, ${a}) → ${got}`);
    }
  });
});

describe('test/helpers.js', () => {
  test('makeTestStats — §7.4 기본 StatBlock', () => {
    const s = makeTestStats();
    assert.deepEqual(keysOf(s), typedefProps('StatBlock'));
    assert.equal(keysOf(s).length, 23);
    assert.equal(s.hpMax, 100);
    assert.equal(s.weaponDamage, 20);
    assert.equal(s.critMul, 1.25);
    assert.equal(makeTestStats({ hpMax: 150 }).hpMax, 150);
    assertFiniteDeep(s, 'stats');
  });

  test('makeTestProfile', () => {
    const p = makeTestProfile({ points: { vit: 12, str: 3 }, weaponLevel: 5, embers: 100, cycle: 1 });
    assert.deepEqual(p.stats, { vit: 12, end: 0, str: 3, dex: 0 });
    assert.equal(p.weapons.longsword.level, 5);
    assert.equal(p.weapons.spear.level, 0);
    assert.equal(p.embers, 100);
    assert.equal(p.cycle, 1);
    assert.equal(p.bosses.valder.unlocked, true);
    assert.equal(p.bosses.fenrir.unlocked, false);
    assert.deepEqual(p.relicsEquipped, [null, null]);
    assert.deepEqual(keysOf(p), typedefProps('Profile'));
    assert.deepEqual(keysOf(p.bosses.valder), typedefProps('BossProgress'));
    structuredClone(p);
  });

  test('makeTestPlayer · makeTestBoss — 전 필드 · prev 동기화', () => {
    const pl = makeTestPlayer(makeTestStats(), { pos: { x: 2, z: 3 }, facing: 1 });
    assert.deepEqual(keysOf(pl), typedefProps('PlayerState'));
    assert.deepEqual(keysOf(pl.buffer), typedefProps('InputBuffer'));
    assert.deepEqual(pl.prevPos, { x: 2, z: 3 });
    assert.notEqual(pl.prevPos, pl.pos);
    assert.equal(pl.prevFacing, 1);
    assert.equal(pl.flasks, 3);
    const def = makeSynthBossDef();
    const b = makeTestBoss(def, { pos: { x: 1, z: 1 } });
    assert.deepEqual(keysOf(b), typedefProps('BossState'));
    assert.deepEqual(b.prevPos, { x: 1, z: 1 });
    assert.equal(b.hp, def.hp);
    assert.equal(b.state, 'idle');
    near(b.facing, PI);
    const b0 = makeTestBoss(def);
    assert.deepEqual(b0.pos, { x: 0, z: 6 });
  });

  test('makeTestState — 마을 · 보스전', () => {
    const town = makeTestState();
    assert.equal(town.mode, 'town');
    assert.equal(town.world.id, 'town');
    assert.equal(town.boss, null);
    assert.equal(town.fight, null);
    assert.deepEqual({ x: town.dummy.x, z: town.dummy.z, radius: town.dummy.radius }, { x: -6, z: -6, radius: 0.5 });
    assert.deepEqual(keysOf(town), typedefProps('GameState'));
    assert.deepEqual(keysOf(town.dummy), typedefProps('DummyState'));
    const def = makeSynthBossDef();
    const fight = makeTestState({ bossDef: def });
    assert.equal(fight.mode, 'boss');
    assert.equal(fight.world.id, 'arena_valder');
    assert.equal(fight.fight.phase, 'fight');
    assert.equal(fight.boss.hpMax, def.hp);
    assert.equal(fight.dummy, null);
    assert.deepEqual(keysOf(fight.fight), typedefProps('FightState'));
    structuredClone(fight);
    assertFiniteDeep(fight);
    assertFiniteDeep(town);
  });

  test('makeTestCtx — emit · nextHitId · hitstop · shake · spawn 기록', () => {
    const def = makeSynthBossDef();
    const state = makeTestState({ bossDef: def });
    const ctx = makeTestCtx(state, { bossDef: def, seed: 5, scaling: { dmgMul: 1.3 } });
    assert.equal(ctx.bossDef, def);
    assert.deepEqual(keysOf(ctx).filter((k) => k !== 'events' && k !== 'spawned'), typedefProps('SimCtx'));
    assert.deepEqual(ctx.bossHooks, {});
    assert.equal(ctx.scaling.dmgMul, 1.3);
    assert.equal(ctx.scaling.hpMul, 1);
    assert.equal(ctx.scaling.chainBonus, 0);
    ctx.emit(EV.BOSS_STEP, { x: 0, z: 0, heavy: false });
    assert.equal(countEvents(ctx.events, EV.BOSS_STEP), 1);
    assert.equal(countEvents(state.events, EV.BOSS_STEP), 1);
    assert.equal(ctx.nextHitId(), 1);
    assert.equal(ctx.nextHitId(), 2);
    ctx.requestHitstop(0.05);
    ctx.requestHitstop(0.03);
    assert.equal(state.hitstop, 0.05);
    ctx.requestHitstop(5);
    assert.equal(state.hitstop, 0.2); // COMBAT.hitstopMax
    ctx.shake(0.1, 0.2);
    assert.deepEqual(ctx.events.at(-1), { name: EV.CAMERA_SHAKE, payload: { amp: 0.1, dur: 0.2 } });
    const spec = {
      kind: 'void_orb', style: 'void', speed: 9, r: 0.45, life: 5, homing: 2.2, homingTime: 2.5, damage: 18,
      guardable: true, parryable: true, knockdown: false, y: 1.4,
    };
    const proj = ctx.spawnProjectile(spec, 1, 2, 0.5, 2);
    assert.equal(proj.damage, 36);
    assert.deepEqual(keysOf(proj), typedefProps('Projectile'));
    assert.equal(proj.prevX, 1);
    assert.equal(ctx.spawned.projectiles.length, 1);
    assert.equal(state.projectiles.length, 0); // 기록만
    const hz = ctx.spawnHazard({
      kind: 'shockwave', style: 'fire', warn: 0, active: 0.8, interval: 0, damage: 18, guardable: true,
      knockdown: false, grow: { r0: 2, r1: 10, width: 1 },
    }, 0, 0, 0, 1.5);
    assert.equal(hz.state, 'active');
    assert.deepEqual(keysOf(hz), typedefProps('Hazard'));
    assert.deepEqual(hz.shape, { type: 'ring', x: 0, z: 0, rInner: 1.5, rOuter: 2.5 });
    assert.equal(hz.damage, 27);
    const hz2 = ctx.spawnHazard({
      kind: 'fire_pillar', style: 'fire', shape: { type: 'circle', r: 2 }, warn: 0.8, active: 0.2, interval: 0,
      damage: 22, guardable: true, knockdown: false,
    }, 3, 4, 0, 1);
    assert.equal(hz2.state, 'warn');
    assert.deepEqual(hz2.shape, { type: 'circle', x: 3, z: 4, r: 2 });
    assert.equal(hz2.grow, null);
    assert.equal(ctx.spawned.hazards.length, 2);
    assert.notEqual(proj.hitId, hz.hitId);
    // 같은 시드의 ctx는 같은 난수를 낸다
    const ctx2 = makeTestCtx(makeTestState({ bossDef: def }), { seed: 5 });
    const ctx3 = makeTestCtx(makeTestState({ bossDef: def }), { seed: 5 });
    assert.equal(ctx2.rng.next(), ctx3.rng.next());
    assert.equal(ctx2.bossDef, null);
    assertFiniteDeep(state);
  });

  test('makeSynthBossDef — 공격 2개 · 덮어쓰기 · 매번 새 객체', () => {
    const a = makeSynthBossDef();
    const b = makeSynthBossDef({ hp: 500, kite: true });
    assert.deepEqual(Object.keys(a.attacks), ['synth_melee', 'synth_ranged']);
    assert.deepEqual(keysOf(a), typedefProps('BossDef'));
    assert.deepEqual(keysOf(a.attacks.synth_melee), typedefProps('BossAttackDef'));
    assert.deepEqual(keysOf(a.attacks.synth_melee.hits[0]), typedefProps('BossHitDef'));
    assert.equal(a.attacks.synth_melee.hits[0].shape.type, 'arc');
    assert.equal(a.attacks.synth_ranged.hits[0].shape.type, 'capsule');
    assert.equal(a.fallbackAttack, 'synth_melee');
    assert.equal(b.hp, 500);
    assert.equal(b.kite, true);
    assert.equal(a.hp, 1000);
    a.attacks.synth_melee.windup = 99;
    assert.equal(makeSynthBossDef().attacks.synth_melee.windup, 0.6);
    for (const atk of Object.values(makeSynthBossDef().attacks)) {
      assert.ok(atk.windup >= 0.45 && atk.recovery >= 0.3);
      assert.ok(atk.track.lockLead <= atk.windup * 0.75);
      for (const h of atk.hits) assert.ok(h.t0 >= 0 && h.t0 < h.t1 && h.t1 <= atk.active + 1e-6 && h.damage > 0);
    }
    assertFiniteDeep(a, 'def');
  });

  test('runTicks · countEvents · assertFiniteDeep', () => {
    const seen = [];
    runTicks(3, (i) => seen.push(i));
    assert.deepEqual(seen, [0, 1, 2]);
    assert.equal(countEvents([{ name: 'a' }, { name: 'b' }, { name: 'a' }], 'a'), 2);
    assert.equal(countEvents([], 'a'), 0);
    assertFiniteDeep({ a: 1, b: [1, 2, { c: 3 }], d: null, e: 'x', f: true, g: () => NaN });
    assert.throws(() => assertFiniteDeep({ a: { b: [1, NaN] } }, 'root'), /root\.a\.b\[1\]/);
    assert.throws(() => assertFiniteDeep({ pos: { x: Infinity } }), /state\.pos\.x/);
    const cyc = { n: 1 };
    cyc.self = cyc;
    assertFiniteDeep(cyc); // 순환 참조에 안전
  });
});
