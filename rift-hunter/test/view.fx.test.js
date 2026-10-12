// OWNER: P13 — 계약 §12.2 · §9.6 · §9.7 · §9.8
// Node · three 지오메트리만(렌더러 없음 — 가짜 rc): 효과 모양 → 데칼 치수(§9.6 표의 0 칸 — 바깥 가장자리 = 판정 경계) · 적대 = 붉은 테두리 ·
// 플레이어 소유는 붉은색 없음 · 예고 채움 진행 = 틱(spec null 인 돌진 선 포함) · 판정 순간은 모양 안에서만 ≤ 0.6 · 0.1초 ·
// 속성 오라 12 가 서로 구분된다 · 투사체 치수 · 풀 상한(데칼 200 · 입자 2,000 · 투사체 256) · 판을 반복해도 늘지 않는다 · NaN 0.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { EV, EventBus } from '../src/core/events.js';
import { angleDiff, deg2rad, yawOf } from '../src/core/math.js';
import { ticks } from '../src/core/time.js';
import { getMonDef, getSkillDef } from '../src/data/index.js';
import { MON_AFFIXES } from '../src/data/monsterAffixes.js';
import { FIXTURES } from '../src/debug/fixtures.js';
import { FxLayer, styleOf } from '../src/view/FxLayer.js';
import { arrowGeometry } from '../src/view/fx/batches.js';
import { AFFIX_AURA, CAP, DECAL, HOSTILE, KIND_STYLE, PLAYER_FX, PROJ_STYLE, lin } from '../src/view/fx/style.js';
import { createGameState } from '../src/sim/state.js';
import { addTestMonster, makeTestCtx, makeTestState } from './helpers.js';

/** 위치 비교 허용치 — 정점 버퍼가 Float32 라 좌표 20~40m 에서 반올림이 ~4e-6m(판정과의 차이 0 = 이 반올림뿐) */
const EPS = 2e-5;

function fakeRc() { return { layers: { world: new THREE.Group(), actors: new THREE.Group(), fx: new THREE.Group() } }; }

/** 레이어 하나(추적 켬) */
function makeLayer(quality = 'high') {
  const bus = new EventBus();
  const rc = fakeRc();
  const fx = new FxLayer({ rc, bus, settings: { quality } });
  fx.decals.trace = true;
  fx.glow.trace = true;
  fx.swoosh.trace = true;
  for (const b of fx.batches) b.trace = true;
  return { fx, bus, rc };
}

/** 균열 상태(몬스터 없음) — 플레이어는 맵 spawn */
function riftState() {
  const st = makeTestState({ scene: 'rift' });
  st.tick = 600;
  return st;
}

/** 상태에 효과 하나(spawnEffect 와 같은 꼴) — ago = 예고 시작 뒤 틱 · delayT = 예고 틱 */
function addEffect(st, { kind, hostile = true, shape, ago = 10, delayT = 30, durT = 1, spec = {}, tickSpec = null, from = null, owner = 'mon' }) {
  const start = st.tick - ago;
  const e = {
    id: st.nextId++, kind, owner, srcId: -1, packId: -1, cancelOnSrcDeath: false, hostile, shape: { ...shape },
    start, hitAt: start + delayT, end: start + delayT + Math.max(1, durT), tickT: 0, nextTickAt: -1,
    resolved: st.tick >= start + delayT, spec, tickSpec, from,
  };
  st.rift.effects.push(e);
  return e;
}

/** 데칼 묶음에서 꼬리표 · ID 의 정점들 → [{x, z, a, c:[r,g,b]}] */
function spanVerts(batch, tag, id = null) {
  const out = [];
  for (const s of batch.spans) {
    if (s.tag !== tag || (id !== null && s.id !== id)) continue;
    for (let i = s.start; i < s.end; i++) {
      out.push({ x: batch.pos[i * 3], y: batch.pos[i * 3 + 1], z: batch.pos[i * 3 + 2], c: [batch.col[i * 4], batch.col[i * 4 + 1], batch.col[i * 4 + 2]], a: batch.col[i * 4 + 3] });
    }
  }
  return out;
}

/** 원 · 원뿔 꼭짓점에서의 거리 범위 */
function radii(verts, cx, cz) {
  let lo = Infinity, hi = -Infinity;
  for (const v of verts) {
    const d = Math.hypot(v.x - cx, v.z - cz);
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return { lo, hi };
}

/** 선 좌표계(시작 · facing)의 범위 */
function lineExtent(verts, s) {
  const fx = Math.sin(s.facing), fz = Math.cos(s.facing), rx = -Math.cos(s.facing), rz = Math.sin(s.facing);
  let a0 = Infinity, a1 = -Infinity, w0 = Infinity, w1 = -Infinity;
  for (const v of verts) {
    const dx = v.x - s.x, dz = v.z - s.z;
    const a = dx * fx + dz * fz, w = dx * rx + dz * rz;
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); w0 = Math.min(w0, w); w1 = Math.max(w1, w);
  }
  return { a0, a1, w0, w1 };
}

/** 원뿔 정점의 방향 범위(꼭짓점 바로 옆은 뺀다) */
function coneSpan(verts, s) {
  let lo = Infinity, hi = -Infinity;
  for (const v of verts) {
    const dx = v.x - s.x, dz = v.z - s.z;
    if (Math.hypot(dx, dz) < 0.5) continue;
    const d = angleDiff(s.facing, yawOf(dx, dz));
    lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  return { lo, hi };
}

/** 정점이 모두 판정 영역 안(경계 포함)에 있다 */
function assertInside(verts, s, msg) {
  assert.ok(verts.length > 0, `${msg}: 정점 없음`);
  for (const v of verts) {
    const dx = v.x - s.x, dz = v.z - s.z;
    const d = Math.hypot(dx, dz);
    if (s.type === 'circle') assert.ok(d <= s.r + EPS, `${msg}: 원 밖 ${d} > ${s.r}`);
    else if (s.type === 'cone') {
      assert.ok(d <= s.r + EPS, `${msg}: 원뿔 반지름 밖 ${d}`);
      if (d > 1e-3) assert.ok(Math.abs(angleDiff(s.facing, yawOf(dx, dz))) <= s.angle / 2 + 2e-5 / Math.max(d, 0.5), `${msg}: 원뿔 각 밖`);
    } else if (s.type === 'line') {
      const e = lineExtent([v], s);
      assert.ok(e.a0 >= -EPS && e.a1 <= s.len + EPS, `${msg}: 선 길이 밖 ${e.a0}..${e.a1}`);
      assert.ok(e.w0 >= -s.width / 2 - EPS && e.w1 <= s.width / 2 + EPS, `${msg}: 선 폭 밖 ${e.w0}..${e.w1}`);
    }
  }
}

/** 테두리 바깥 가장자리 = 판정 경계(차이 0) */
function assertBorderExact(verts, s, msg) {
  if (s.type === 'circle') {
    const { hi } = radii(verts, s.x, s.z);
    assert.ok(Math.abs(hi - s.r) < EPS, `${msg}: 테두리 바깥 ${hi} ≠ r ${s.r}`);
  } else if (s.type === 'cone') {
    const { hi } = radii(verts, s.x, s.z);
    assert.ok(Math.abs(hi - s.r) < EPS, `${msg}: 원뿔 테두리 ${hi} ≠ r ${s.r}`);
    const sp = coneSpan(verts, s);
    assert.ok(Math.abs(sp.lo + s.angle / 2) < 2e-6 && Math.abs(sp.hi - s.angle / 2) < 2e-6, `${msg}: 원뿔 각 ${sp.lo}..${sp.hi} ≠ ±${s.angle / 2}`);
  } else if (s.type === 'line') {
    const e = lineExtent(verts, s);
    assert.ok(Math.abs(e.a0) < EPS && Math.abs(e.a1 - s.len) < EPS, `${msg}: 선 길이 ${e.a0}..${e.a1} ≠ 0..${s.len}`);
    assert.ok(Math.abs(e.w0 + s.width / 2) < EPS && Math.abs(e.w1 - s.width / 2) < EPS, `${msg}: 선 폭 ${e.w0}..${e.w1} ≠ ±${s.width / 2}`);
  }
  assertInside(verts, s, msg);
}

/** 선형 rgb → sRGB → 색상각(도) · 채도 */
function hueSat(c) {
  const enc = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  const r = enc(c[0]), g = enc(c[1]), b = enc(c[2]);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: mx > 0 ? d / mx : 0 };
}
/** 붉은 색조(345° ~ 15° · 채도 0.35 이상) */
function isRed(c) {
  const { h, s } = hueSat(c);
  return s >= 0.35 && (h <= 15 || h >= 345);
}
const sameColor = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6;

/** 데이터에서 판정 모양(§9.6 의 0 칸 — 만드는 쪽이 쓰는 수치) */
function hostileShapes(st) {
  const aff = (id) => MON_AFFIXES.find(a => a.id === id).params;
  const atk = (typeId, id) => getMonDef(typeId).attacks.find(a => a.id === id);
  const x = st.player.pos.x, z = st.player.pos.z;
  const slam = atk('boneGiant', 'slam').params, spikes = atk('boneGiant', 'spikes').params, ember = atk('ashWitch', 'emberRain').params;
  const charger = getMonDef('charger');
  return [
    { kind: 'jail', shape: { type: 'circle', x, z, r: aff('jailer').r }, table: 1.2 },
    { kind: 'plague', shape: { type: 'circle', x: x + 1, z, r: aff('plague').r }, table: 2.0 },
    { kind: 'mortar', shape: { type: 'circle', x, z: z + 1, r: aff('mortar').r }, table: 1.5 },
    { kind: 'coldNova', shape: { type: 'circle', x: x - 1, z, r: aff('coldEnchanted').novaR }, table: 4.0 },
    { kind: 'fireDeath', shape: { type: 'circle', x, z: z - 1, r: aff('fireEnchanted').deathR }, table: 3.0 },
    { kind: 'bloaterBurst', shape: { type: 'circle', x, z, r: atk('bloater', 'burst').params.r }, table: 2.8 },
    { kind: 'emberRain', shape: { type: 'circle', x: x + 0.5, z, r: ember.r }, table: 1.8 },
    { kind: 'slam', shape: { type: 'cone', x, z, r: slam.r, facing: 0.7, angle: deg2rad(slam.angleDeg) }, table: [6.5, 100] },
    { kind: 'boneSpikes', shape: { type: 'line', x, z, facing: -2.1, len: spikes.len, width: spikes.width }, table: [12, 1.4] },
    { kind: 'chargeLine', shape: { type: 'line', x, z, facing: 1.2, len: 9, width: charger.radius * 2 }, table: [9, 1.2] },
  ];
}

test('§9.6 — 적대 바닥 표식: 바깥 가장자리 = 판정 모양(차이 0) · 채움 · 무늬 · 테두리가 모양 밖으로 새지 않는다', () => {
  const { fx } = makeLayer();
  const st = riftState();
  const rows = hostileShapes(st);
  // 표의 값(§9.6 — 데이터가 바뀌면 계약 표와 함께 바꾼다)
  for (const row of rows) {
    if (Array.isArray(row.table)) {
      if (row.shape.type === 'cone') { assert.equal(row.shape.r, row.table[0]); assert.ok(Math.abs(row.shape.angle - deg2rad(row.table[1])) < 1e-9); }
      else { assert.equal(row.shape.len, row.table[0]); assert.equal(row.shape.width, row.table[1]); }
    } else assert.equal(row.shape.r, row.table, row.kind);
  }
  const effs = rows.map(row => addEffect(st, { kind: row.kind, shape: row.shape, spec: row.kind === 'chargeLine' ? null : {} }));
  fx.setMap(null);
  fx.update(st, 0.5, 0, st.player.pos);
  for (let i = 0; i < rows.length; i++) {
    const e = effs[i], s = e.shape;
    const border = spanVerts(fx.decals, 'border', e.id);
    assertBorderExact(border, s, rows[i].kind);
    for (const tag of ['base', 'fill', 'edge', 'pattern']) {
      const v = spanVerts(fx.decals, tag, e.id);
      if (tag === 'pattern' && !styleOf(e.kind, true).pattern) continue;
      assertInside(v, s, `${rows[i].kind} ${tag}`);
    }
    // 바탕(전체 영역)도 판정 모양 그대로
    const base = spanVerts(fx.decals, 'base', e.id);
    if (s.type === 'line') {
      const ex = lineExtent(base, s);
      assert.ok(Math.abs(ex.a1 - s.len) < EPS && Math.abs(ex.w1 - s.width / 2) < EPS, `${rows[i].kind} 바탕`);
    } else assert.ok(Math.abs(radii(base, s.x, s.z).hi - s.r) < EPS, `${rows[i].kind} 바탕`);
  }
});

// 피드백 1: 지면 강타(cone · 원뿔 r 4.0 · 120°) → 회전 베기(spinSlash · 원 r 2.5 · 360°) · 강타 → 가르기(cleave · 부채꼴 r 1.9 · 180°) · 여진 → 연속 회전(spinEcho).
// 칼자국(바닥 얇은 띠 'slash' · 칼끝 높이 궤적 'swing' · 잔상 'echo')의 바깥 가장자리 = 판정 반지름 · 각 = 판정 각(차이 0 · 계약 §9.6 · §9.7).
test('피드백 1: §9.6 — 회전 베기 칼자국 고리 r 2.5(360°) · 가르기 칼자국 호 r 1.9 · 180°(facing 중심) · 붉은색 없음', () => {
  const spin = getSkillDef('groundStomp'), cleave = getSkillDef('bash');
  assert.equal(spin.radius, 2.5);
  const { fx, bus } = makeLayer();
  const st = riftState();
  const p = st.player;
  fx.update(st, 0, 0, p.pos);
  bus.emit(EV.ACTION_HIT, { skillId: 'groundStomp', x: p.pos.x, z: p.pos.z, facing: 0.4, tx: p.pos.x, tz: p.pos.z, rank: 1, transforms: [] });
  fx.update(st, 0, 0, p.pos);
  const ring = spanVerts(fx.glow, 'slash');
  const circ = { type: 'circle', x: p.pos.x, z: p.pos.z, r: spin.radius };
  assertBorderExact(ring, circ, '회전 베기 칼자국');
  assert.ok(radii(ring, p.pos.x, p.pos.z).lo >= spin.radius - 0.2 - EPS, '얇은 띠(판정 가장자리 안쪽 ≤ 0.2m)');
  // 360° — 네 방위 모두에 정점
  const quads = new Set(ring.map(v => Math.floor(((yawOf(v.x - p.pos.x, v.z - p.pos.z) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 2))));
  assert.equal(quads.size, 4, '고리가 한 바퀴');
  for (const v of ring) assert.ok(!isRed(v.c), '플레이어 칼자국은 붉지 않다');
  // 옛 연출(지면 강타 충격 부채 · 균열 무늬)이 남지 않는다
  assert.equal(spanVerts(fx.glow, 'fan').length + spanVerts(fx.decals, 'pattern').length, 0, '옛 부채 없음');

  const R = p.r + cleave.reach + 0.3;
  assert.ok(Math.abs(R - 1.9) < 1e-9, '가르기 판정 반지름 1.9');
  const { fx: f2, bus: b2 } = makeLayer();
  const s2 = riftState();
  f2.update(s2, 0, 0, s2.player.pos);
  b2.emit(EV.ACTION_HIT, { skillId: 'bash', x: s2.player.pos.x, z: s2.player.pos.z, facing: 0.4, tx: s2.player.pos.x, tz: s2.player.pos.z, rank: 1, transforms: [] });
  f2.update(s2, 0, 0, s2.player.pos);
  const arc = spanVerts(f2.glow, 'slash');
  assertBorderExact(arc, { type: 'cone', x: s2.player.pos.x, z: s2.player.pos.z, r: R, facing: 0.4, angle: deg2rad(cleave.angleDeg) }, '가르기 칼자국');
  for (const v of arc) assert.ok(!isRed(v.c), '가르기 칼자국은 붉지 않다');
  // 0.3초 뒤 사라진다
  s2.tick += ticks(0.3) + 1;
  f2.update(s2, 0, 0, s2.player.pos);
  assert.equal(spanVerts(f2.glow, 'slash').length, 0, '0.3초 뒤 사라짐');
});

test('피드백 1: 칼끝 궤적(상태) — 휘두른 만큼만 · 바깥 = 판정 반지름 · 정지 화면에서도 같은 그림 · 휘두름이 끝나면 사라진다', () => {
  for (const [skillId, R] of [['bash', 1.9], ['groundStomp', 2.5]]) {
    const def = getSkillDef(skillId), sw = def.params.swing;
    const { fx } = makeLayer();
    const st = riftState();
    const p = st.player;
    const T = 20;
    p.act = 'attack'; p.actSkill = skillId; p.actId = 9; p.facing = -0.7;
    p.actStart = st.tick; p.actEnd = st.tick + T; p.actHit = st.tick + Math.round(T * def.hitFrac);
    const at = (k) => { st.tick = p.actStart + Math.floor(k * T); fx.update(st, k * T - Math.floor(k * T), 0, p.pos); return spanVerts(fx.swoosh, 'swing'); };
    assert.equal(at(sw.from * 0.5).length, 0, `${skillId}: 감는 예비에는 궤적 없음`);
    for (const k of [sw.from + (sw.to - sw.from) * 0.3, (sw.from + sw.to) / 2, sw.to]) {
      const v = at(k);
      assert.ok(v.length > 0, `${skillId} k ${k}: 궤적`);
      const { hi } = radii(v, p.pos.x, p.pos.z);
      assert.ok(Math.abs(hi - R) < EPS, `${skillId}: 궤적 바깥 ${hi} ≠ ${R}`);
      // 칼끝(머리) 방위 = facing + arcFrom + (arcTo − arcFrom)·ease(u) · 꼬리는 휘두름 시작보다 뒤로 가지 않는다
      const u = Math.min(1, Math.max(0, (k - sw.from) / (sw.to - sw.from))), e = u * u * (3 - 2 * u);
      const head = deg2rad(sw.arcFrom + (sw.arcTo - sw.arcFrom) * e), tail = deg2rad(sw.arcFrom);
      for (const q of v) {
        if (Math.hypot(q.x - p.pos.x, q.z - p.pos.z) < 0.5) continue;
        const rel = angleDiff(p.facing, yawOf(q.x - p.pos.x, q.z - p.pos.z));
        // 360° 회전은 방위가 감기므로 머리 쪽 각만 본다 — 머리를 넘지 않는다(꼬리는 머리 뒤 tailDeg 안)
        const back = ((head - (p.facing + rel) + p.facing) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        assert.ok(back <= deg2rad(110) + 1e-4 || back >= 2 * Math.PI - 1e-4, `${skillId}: 궤적이 칼끝 앞 · 꼬리 밖 (${back})`);
        if (skillId === 'bash') assert.ok(rel >= tail - 1e-4 && rel <= head + 1e-4, `${skillId}: 휘두른 범위 밖 ${rel}`);
      }
      for (const q of v) assert.ok(!isRed(q.c), '붉지 않다');
      assert.ok(Math.abs(v[0].y - fx.swoosh.y) < 1e-6 && fx.swoosh.y > 0.6 && fx.swoosh.y < 1.3, '칼끝 높이');
    }
    // 정지 화면 — 같은 틱 · alpha 면 같은 정점
    const a = at((sw.from + sw.to) / 2).map(q => q.x + q.z), b = at((sw.from + sw.to) / 2).map(q => q.x + q.z);
    assert.deepEqual(a, b, '같은 틱 같은 그림');
    assert.equal(at(Math.min(0.99, sw.to + 0.2)).length, 0, `${skillId}: 후딜 뒤 사라짐`);
  }
});

test('피드백 1: 연속 회전(spinEcho) — 대기 동안 플레이어를 따라가는 옅은 호 · 판정 직전 잔상 한 바퀴 · 판정에 고리 r 2.5(판정 자리) · 예고 붉은색 없음', () => {
  const { fx, bus } = makeLayer();
  const st = riftState();
  const p = st.player;
  const R = getSkillDef('groundStomp').radius;
  const e = addEffect(st, { kind: 'spinEcho', hostile: false, owner: 'player', shape: { type: 'circle', x: p.pos.x, z: p.pos.z, r: R }, ago: 3, delayT: 15, spec: {} });
  e.follow = 'player';
  // 플레이어가 옮겨 갔다(그린 자리 = 보간 위치) — 호의 중심이 플레이어를 따라간다
  p.prevPos = { x: p.pos.x + 1, z: p.pos.z }; p.pos = { x: p.pos.x + 1, z: p.pos.z };
  e.shape.x = p.pos.x;
  fx.update(st, 0, 0, p.pos);
  const pre = spanVerts(fx.glow, 'echoPre', e.id);
  assert.ok(pre.length > 0, '대기 호');
  assertInside(pre, { type: 'circle', x: p.pos.x, z: p.pos.z, r: R }, '대기 호(플레이어 중심)');
  for (const v of pre) assert.ok(!isRed(v.c) && v.a <= 0.2 + 1e-6, '옅고 붉지 않다');
  assert.equal(spanVerts(fx.decals, 'border', e.id).length, 0, '예고 테두리 없음(판정만)');
  assert.equal(spanVerts(fx.swoosh, 'echo', e.id).length, 0, '잔상은 판정 직전에만');
  st.tick = e.hitAt - 2;
  fx.update(st, 0, 0, p.pos);
  const ghost = spanVerts(fx.swoosh, 'echo', e.id);
  assert.ok(ghost.length > 0, '판정 직전 잔상');
  assert.ok(Math.abs(radii(ghost, p.pos.x, p.pos.z).hi - R) < EPS, '잔상 바깥 = r');
  // 판정 — EFFECT_HIT 의 shape(판정 자리)에 고리
  st.tick = e.hitAt;
  e.resolved = true;
  bus.emit(EV.EFFECT_HIT, { id: e.id, kind: 'spinEcho', hostile: false, shape: { ...e.shape }, hitPlayer: false, targets: 2 });
  fx.update(st, 0, 0, p.pos);
  assertBorderExact(spanVerts(fx.glow, 'slash', e.id), { type: 'circle', x: e.shape.x, z: e.shape.z, r: R }, '연속 회전 칼자국');
  assert.ok(spanVerts(fx.swoosh, 'echo', e.id).length > 0, '판정 뒤 잔상 고리');
  // 이벤트를 놓쳐도(고정 상태) 상태로 한 번 세운다
  const { fx: g } = makeLayer();
  const s2 = riftState();
  const e2 = addEffect(s2, { kind: 'spinEcho', hostile: false, owner: 'player', shape: { type: 'circle', x: 12, z: 14, r: R }, ago: 15, delayT: 15, spec: {} });
  g.update(s2, 0, 0, s2.player.pos);
  assertBorderExact(spanVerts(g.glow, 'slash', e2.id), e2.shape, '놓친 판정');
});

test('§9.6 — 플레이어 쪽: 지진 6.0 · 회오리 2.4 · 돌진 폭 1.6 · 도약 3.5 · 서리 노바 5.0 · 메테오 3.5(예고 · 불타는 바닥) · 화염구 2.5 · 번개 잔상 3.0(피드백 1: 회전 베기 · 가르기는 위)', () => {
  const quake = getSkillDef('earthquake'), whirl = getSkillDef('whirlwind'), charge = getSkillDef('charge');
  const leap = getSkillDef('leap'), nova = getSkillDef('frostNova'), meteor = getSkillDef('meteor'), fireball = getSkillDef('fireball');
  assert.deepEqual([quake.radius, whirl.radius, charge.width, leap.radius, nova.radius, meteor.radius, fireball.params.explodeR],
    [6.0, 2.4, 1.6, 3.5, 5.0, 3.5, 2.5], '§9.6 표의 값');

  const { fx, bus } = makeLayer();
  const st = riftState();
  const p = st.player;
  fx.update(st, 0, 0, p.pos);

  // 도약 착지 · 서리 노바 — 퍼지는 고리의 최종 반지름 = 데이터 radius
  const ringAt = (skillId, batch, r) => {
    const { fx: f2, bus: b2 } = makeLayer();
    const s2 = riftState();
    f2.update(s2, 0, 0, s2.player.pos);
    b2.emit(EV.ACTION_HIT, { skillId, x: 10, z: 12, facing: 0, tx: 10, tz: 12, rank: 1, transforms: [] });
    let hi = 0;
    for (let k = 0; k < 20; k++) {
      f2.update(s2, 0, 0, s2.player.pos);
      const v = spanVerts(f2[batch], 'ring');
      if (v.length) {
        hi = Math.max(hi, radii(v, 10, 12).hi);
        assertInside(v, { type: 'circle', x: 10, z: 12, r }, skillId);
      }
      s2.tick += 1;
    }
    assert.ok(Math.abs(hi - r) < EPS, `${skillId} 고리 최대 ${hi} ≠ ${r}`);
  };
  ringAt('leap', 'decals', leap.radius);
  ringAt('frostNova', 'glow', nova.radius);

  // 회오리 — 바람 고리 바깥 = radius
  p.act = 'channel'; p.actSkill = 'whirlwind'; p.channel = { skillId: 'whirlwind', nextAt: st.tick + 3, startedAt: st.tick - 20 };
  fx.update(st, 0, 0, p.pos);
  const wv = spanVerts(fx.glow, 'whirl');
  assert.ok(Math.abs(radii(wv, p.pos.x, p.pos.z).hi - whirl.radius) < EPS, '회오리 고리');
  assertInside(wv, { type: 'circle', x: p.pos.x, z: p.pos.z, r: whirl.radius }, '회오리');
  p.channel = null;

  // 돌진 — 먼지 자취 폭 = width
  p.act = 'dash'; p.actSkill = 'charge';
  p.air = { from: { x: p.pos.x - 5, z: p.pos.z - 2 }, to: { x: p.pos.x + 2, z: p.pos.z + 1 }, start: st.tick - 5, end: st.tick + 5, kind: 'dash' };
  fx.update(st, 0, 0, p.pos);
  const dv = spanVerts(fx.decals, 'dash');
  const f = Math.atan2(p.pos.x - p.air.from.x, p.pos.z - p.air.from.z);
  const ex = lineExtent(dv, { x: p.air.from.x, z: p.air.from.z, facing: f });
  assert.ok(Math.abs(ex.w0 + charge.width / 2) < EPS && Math.abs(ex.w1 - charge.width / 2) < EPS, `돌진 자취 폭 ${ex.w1 - ex.w0}`);
  // 돌진이 끝나면 같은 폭의 자취가 사라지며 남는다
  p.act = 'idle'; p.air = null;
  fx.update(st, 0, 0, p.pos);
  const tv = spanVerts(fx.decals, 'trail');
  const ex2 = lineExtent(tv, { x: tv[0].x, z: tv[0].z, facing: f });
  assert.ok(Math.abs(ex2.w1 - ex2.w0 - charge.width) < 1e-5, '돌진 자취(사라지는 중) 폭');

  // 지진 파동 · 메테오 — 예고 고리 바깥 = 판정 원 · 지진은 판정 순간 6.0 까지 퍼진다 · 메테오 불타는 바닥 = 3.5
  const st2 = riftState();
  const { fx: g, bus: gb } = makeLayer();
  const q = addEffect(st2, { kind: 'quakeWave', hostile: false, owner: 'player', shape: { type: 'circle', x: 20, z: 20, r: quake.radius }, ago: 4, delayT: 12 });
  const m = addEffect(st2, { kind: 'meteor', hostile: false, owner: 'player', shape: { type: 'circle', x: 14, z: 10, r: meteor.radius }, ago: 10, delayT: ticks(1.2), durT: ticks(3), from: { x: 10, z: 6 } });
  g.update(st2, 0, 0, st2.player.pos);
  assertBorderExact(spanVerts(g.decals, 'border', q.id), q.shape, '지진 예고');
  assertBorderExact(spanVerts(g.decals, 'border', m.id), m.shape, '메테오 예고');
  st2.tick = m.hitAt + 10;
  q.resolved = true;
  g.update(st2, 0, 0, st2.player.pos);
  assertBorderExact(spanVerts(g.decals, 'border', m.id), m.shape, '메테오 불타는 바닥');
  assertInside(spanVerts(g.decals, 'fill', m.id), m.shape, '불타는 바닥 채움');
  gb.emit(EV.EFFECT_HIT, { id: q.id, kind: 'quakeWave', hostile: false, shape: q.shape, hitPlayer: false, targets: 0 });
  let hi = 0;
  for (let k = 0; k < 20; k++) {
    g.update(st2, 0, 0, st2.player.pos);
    const v = spanVerts(g.glow, 'ring', q.id);
    if (v.length) hi = Math.max(hi, radii(v, 20, 20).hi);
    st2.tick += 1;
  }
  assert.ok(Math.abs(hi - quake.radius) < EPS, `지진 고리 최대 ${hi}`);

  // 화염구 폭발 · 번개 잔상 — 구의 최대 반지름 = 판정 원
  for (const [kind, r] of [['fireball', fireball.params.explodeR], ['afterimageBlast', 3.0]]) {
    const { fx: h, bus: hb } = makeLayer();
    const s3 = riftState();
    h.update(s3, 0, 0, s3.player.pos);
    hb.emit(EV.EFFECT_HIT, { id: 77, kind, hostile: false, shape: { type: 'circle', x: 8, z: 9, r }, hitPlayer: false, targets: 3 });
    let mx = 0;
    for (let k = 0; k < 12; k++) {
      h.update(s3, 0, 0, s3.player.pos);
      for (const sp of h.shells.spans) {
        if (sp.tag !== 'sphere') continue;
        const e = h.shells.mat;
        const sx = Math.hypot(e[sp.i * 16], e[sp.i * 16 + 1], e[sp.i * 16 + 2]);
        mx = Math.max(mx, sx);
        assert.ok(sx <= r + EPS, `${kind} 구가 판정보다 크다 ${sx}`);
      }
      s3.tick += 1;
    }
    assert.ok(Math.abs(mx - r) < EPS, `${kind} 구 최대 ${mx} ≠ ${r}`);
  }
});

test('적대 = 붉은 테두리(#ff3b30) · 플레이어 소유 연출은 붉은 색조가 없다', () => {
  assert.ok(sameColor(HOSTILE, lin(0xff3b30)));
  const { fx } = makeLayer();
  const st = riftState();
  const rows = hostileShapes(st);
  const effs = rows.map(row => addEffect(st, { kind: row.kind, shape: row.shape }));
  // 지속 중인 적대 웅덩이(역병 · 독)도 붉은 테두리
  const pool = addEffect(st, { kind: 'poisonPool', shape: { type: 'circle', x: 30, z: 30, r: 2 }, ago: 40, delayT: 0, durT: 90, spec: null, tickSpec: {} });
  const friendly = ['quakeWave', 'meteor', 'vortex'].map((kind, k) => addEffect(st, {
    kind, hostile: false, owner: 'player', shape: { type: 'circle', x: 12 + k * 7, z: 25, r: 2.5 }, ago: kind === 'vortex' ? 20 : 5, delayT: kind === 'vortex' ? 0 : 20, durT: 60,
  }));
  fx.update(st, 0, 0, st.player.pos);
  for (const e of [...effs, pool]) {
    const v = spanVerts(fx.decals, 'border', e.id);
    assert.ok(v.length > 0, e.kind);
    for (const x of v) assert.ok(sameColor(x.c, HOSTILE), `${e.kind} 테두리 색`);
  }
  for (const e of friendly) {
    const v = [...spanVerts(fx.decals, 'border', e.id), ...spanVerts(fx.glow, 'border', e.id)];
    assert.ok(v.length > 0, e.kind);
    for (const x of v) assert.ok(!isRed(x.c), `${e.kind} 테두리가 붉다`);
  }
  // 표 — 플레이어 소유 kind · 플레이어 투사체 · 스킬 연출 색에 붉은 색조 없음(포션 · 맞음은 스킬이 아니다 — §9.9 「붉은 기 · 붉은 튐」)
  const playerKinds = Object.entries(KIND_STYLE).filter(([k]) => !hostileShapes(st).some(r => r.kind === k) && k !== 'poisonPool');
  for (const [k, s] of playerKinds) {
    for (const hex of [s.inner, s.border].filter(v => v !== undefined)) {
      if (k === 'guardianSpawn' && hex === s.inner) continue;   // 검은 균열(채도 0)
      assert.ok(!isRed(lin(hex)), `${k} ${hex.toString(16)}`);
    }
  }
  for (const v of ['magicBolt', 'fireball', 'fireballSplit', 'iceShard']) {
    for (const hex of [PROJ_STYLE[v].core, PROJ_STYLE[v].glow, PROJ_STYLE[v].trailColor].filter(Boolean)) assert.ok(!isRed(lin(hex)), `${v} ${hex.toString(16)}`);
  }
  for (const [k, hex] of Object.entries(PLAYER_FX)) {
    if (typeof hex !== 'number' || k === 'potion' || k === 'hurt' || hex < 0x100) continue;
    assert.ok(!isRed(lin(hex)), `PLAYER_FX.${k}`);
  }
});

test('예고 채움 진행 = 틱 — spec null 인 돌진 선도 같은 표식 · 같은 틱이면 실제 시간과 무관하게 같은 그림', () => {
  const st = riftState();
  const s = { type: 'line', x: 12, z: 14, facing: 0.9, len: 8, width: 1.2 };
  const e = addEffect(st, { kind: 'chargeLine', shape: s, ago: 9, delayT: 27, spec: null });
  const fillLen = (fx) => lineExtent(spanVerts(fx.decals, 'fill', e.id), s).a1;
  const { fx: a } = makeLayer();
  a.update(st, 0, 0, st.player.pos);
  assert.ok(Math.abs(fillLen(a) - (s.len * 9) / 27) < 1e-6, `채움 ${fillLen(a)}`);
  a.update(st, 0.5, 0.016, st.player.pos);
  assert.ok(Math.abs(fillLen(a) - (s.len * 9.5) / 27) < 1e-6, '보간 알파');
  // 같은 틱 · 같은 알파 → 실제 시간(dtReal)이 달라도 채움 · 테두리 정점이 같다
  const { fx: b } = makeLayer();
  b.update(st, 0.5, 0.25, st.player.pos);
  for (const tag of ['fill', 'border', 'pattern']) {
    const va = spanVerts(a.decals, tag, e.id), vb = spanVerts(b.decals, tag, e.id);
    assert.equal(va.length, vb.length, tag);
    for (let i = 0; i < va.length; i++) assert.ok(Math.abs(va[i].x - vb[i].x) < 1e-9 && Math.abs(va[i].z - vb[i].z) < 1e-9, tag);
  }
  // 판정 틱 뒤에는 예고가 없다(돌진 선은 판정이 없어 밝아짐도 없다)
  st.tick = e.hitAt;
  a.update(st, 0, 0, st.player.pos);
  assert.equal(spanVerts(a.decals, 'fill', e.id).length, 0);
  assert.equal(spanVerts(a.decals, 'flash', e.id).length, 0);
});

test('판정 순간 — 그 모양 안에서만 · 불투명도 ≤ 0.6 · 0.1초(3틱) 뒤 사라진다 · 화면을 덮는 것이 없다', () => {
  const { fx, bus } = makeLayer();
  const st = riftState();
  const shapes = [
    { kind: 'coldNova', shape: { type: 'circle', x: 15, z: 15, r: 4 } },
    { kind: 'slam', shape: { type: 'cone', x: 15, z: 15, r: 6.5, facing: 2.0, angle: deg2rad(100) } },
    { kind: 'boneSpikes', shape: { type: 'line', x: 15, z: 15, facing: -0.5, len: 12, width: 1.4 } },
  ];
  fx.update(st, 0, 0, st.player.pos);
  shapes.forEach((row, i) => bus.emit(EV.EFFECT_HIT, { id: 900 + i, kind: row.kind, hostile: true, shape: row.shape, hitPlayer: false, targets: 0 }));
  const durT = Math.max(2, ticks(DECAL.flashSec));
  for (let k = 0; k <= durT + 1; k++) {
    fx.update(st, 0, 0, st.player.pos);
    shapes.forEach((row, i) => {
      const v = spanVerts(fx.decals, 'flash', 900 + i);
      if (k < durT) {
        assertInside(v, row.shape, `${row.kind} 밝아짐`);
        for (const x of v) assert.ok(x.a <= Math.fround(DECAL.flashA) && x.a > 0, `${row.kind} 불투명도 ${x.a}`);
      } else assert.equal(v.length, 0, `${row.kind} 밝아짐이 ${k}틱에 남았다`);
    });
    st.tick += 1;
  }
  // 점 스프라이트 크기 상한 · 화면 공간 겹침 없음(모든 것이 월드 공간 메시)
  fx.group.traverse((o) => {
    if (o === fx.group) return;
    assert.ok(o.isMesh || o.isPoints || o.isInstancedMesh, `${o.name} 은 월드 메시가 아니다`);
  });
  for (const b of [fx.sparks.buf, fx.dust.buf, fx.glyphs]) assert.ok(b.material.uniforms.uMaxPx.value <= 720 * 0.12 + 1e-9);
});

test('속성 오라 12 — 오라만으로 서로 구분된다(강인함은 P8 재질) · 보호막 예고 · 무적 구체 · 사라짐 잔상', () => {
  assert.deepEqual(Object.keys(AFFIX_AURA).sort(), MON_AFFIXES.map(a => a.id).sort(), '속성 표 = 데이터 12');
  /** 몬스터 하나만 둔 상태의 연출 서명(묶음 · 색) */
  const signature = (affixId, setup) => {
    const { fx } = makeLayer();
    const st = riftState();
    const ctx = makeTestCtx(st);
    const p = st.player.pos;
    const m = addTestMonster(ctx, { typeId: 'ghoul', rank: 'elite', x: p.x + 3, z: p.z + 3 });
    m.affixes = [affixId];
    if (setup) setup(m, st);
    fx.update(st, 0.3, 0.016, p);
    const parts = new Set();
    for (const b of fx.batches) {
      for (let i = 0; i < b.n; i++) parts.add(`${b.name}:${b.col.slice(i * 3, i * 3 + 3).map(v => (v > 0 ? 1 : 0)).join('')}:${hueBucket(b.col.slice(i * 3, i * 3 + 3))}`);
    }
    for (let i = 0; i < fx.glyphs.n; i++) parts.add(`glyph:${hueBucket(fx.glyphs.col.slice(i * 4, i * 4 + 3))}`);
    for (let i = 0; i < fx.glow.n; i += 3) parts.add(`glow:${hueBucket(fx.glow.col.slice(i * 4, i * 4 + 3))}`);
    return { sig: [...parts].sort().join('|'), fx, m, st };
  };
  const hueBucket = (c) => {
    const { h, s } = hueSat(c);
    return s < 0.15 ? 'grey' : String(Math.round(h / 20));
  };
  const sigs = new Map();
  for (const a of MON_AFFIXES) {
    const { sig } = signature(a.id);
    if (a.id === 'tough') { assert.equal(sig, '', '강인함은 P13 연출이 없다(P8 재질)'); continue; }
    assert.ok(sig.length > 0, `${a.id} 오라 없음`);
    for (const [other, s] of sigs) assert.notEqual(sig, s, `${a.id} 와 ${other} 의 오라가 같다`);
    sigs.set(a.id, sig);
  }
  assert.equal(sigs.size, 11);
  // 보호막: 예고 동안 반짝임이 늘고 · 무적 동안 금빛 구체(몸을 덮는 크기)
  const idle = signature('shielding');
  const warn = signature('shielding', (m, st) => { m.ax.shielding = { nextAt: st.tick + 99, warnUntil: st.tick + 10, offUntil: -1 }; });
  assert.ok(warn.fx.glyphs.n > idle.fx.glyphs.n, '예고 반짝임');
  const on = signature('shielding', (m, st) => { m.st.invulnUntil = st.tick + 30; m.ax.shielding = { nextAt: st.tick + 200, warnUntil: -1, offUntil: st.tick + 30 }; });
  const shell = on.fx.shells.spans.filter(s => s.tag === 'aura:goldShell');
  assert.equal(shell.length, 1, '금빛 구체');
  const e = on.fx.shells.mat, i = shell[0].i;
  assert.ok(Math.hypot(e[i * 16], e[i * 16 + 1], e[i * 16 + 2]) >= on.m.r, '구체가 몸을 덮는다');
  // 순간이동: 사라짐 동안 보라 기둥(다른 오라는 그리지 않는다)
  const van = signature('teleporter', (m, st) => { m.act = 'vanish'; m.actStart = st.tick - 2; m.actHit = st.tick - 2; m.actEnd = st.tick + 10; });
  assert.ok(van.fx.pillars.spans.some(s => s.tag === 'aura:phase'), '사라짐 잔상');
});

test('상태 표시 — 화상 · 빙결(몸 크기 얼음 껍질) · 감전 · 기절 별 · 냉기', () => {
  const { fx } = makeLayer();
  const st = riftState();
  const ctx = makeTestCtx(st);
  const p = st.player.pos;
  const mk = (dx, set) => { const m = addTestMonster(ctx, { typeId: 'ghoul', x: p.x + dx, z: p.z + 2 }); set(m); return m; };
  mk(-3, m => { m.st.burn = { dps: 3, until: st.tick + 30, nextAt: st.tick + 5 }; });
  const fr = mk(-1, m => { m.act = 'frozen'; m.st.freezeUntil = st.tick + 30; });
  mk(1, m => { m.st.shockUntil = st.tick + 60; });
  mk(3, m => { m.act = 'stunned'; m.st.stunUntil = st.tick + 20; });
  mk(5, m => { m.st.chill = 60; });
  fx.update(st, 0, 0.05, p);
  const freeze = fx.shells.spans.filter(s => s.tag === 'freeze');
  assert.equal(freeze.length, 1, '얼음 껍질 하나');
  const e = fx.shells.mat, i = freeze[0].i;
  const sx = Math.hypot(e[i * 16], e[i * 16 + 1], e[i * 16 + 2]), sy = Math.hypot(e[i * 16 + 4], e[i * 16 + 5], e[i * 16 + 6]);
  assert.ok(sx >= fr.r && sx <= fr.r * 1.5, `껍질 폭 ${sx}`);
  assert.ok(sy * 2 >= fr.height, `껍질 높이 ${sy * 2}`);
  assert.equal(fx.stars.spans.filter(s => s.tag === 'stun').length, 3, '기절 별 셋');
  assert.ok(fx.segs.n >= 2 || fx.glyphs.n > 10, '감전 · 화상 · 냉기');
  assert.ok(fx.glyphs.n >= 5);
});

test('공격 예고 — 궁수 붉은 조준선(조준이 멈추면 굵게) · 시전 손 빛 · 부활 대상 빛기둥', () => {
  const { fx } = makeLayer();
  const st = riftState();
  const ctx = makeTestCtx(st);
  const p = st.player.pos;
  const archer = addTestMonster(ctx, { typeId: 'skeletonArcher', x: p.x + 6, z: p.z + 2 });
  archer.act = 'windup'; archer.actId = 'arrow'; archer.actStart = st.tick - 5; archer.actHit = st.tick + 13; archer.actEnd = st.tick + 25; archer.aim = { x: p.x, z: p.z };
  const shaman = addTestMonster(ctx, { typeId: 'fallenShaman', x: p.x - 5, z: p.z + 1 });
  shaman.act = 'cast'; shaman.actId = 'revive'; shaman.actStart = st.tick - 20; shaman.actHit = st.tick + 25; shaman.actEnd = st.tick + 40; shaman.aim = { x: p.x - 7, z: p.z + 3 };
  fx.update(st, 0, 0, p);
  const aim = fx.segs.spans.filter(s => s.tag === 'tele:aim');
  assert.equal(aim.length, 1, '조준선');
  const i = aim[0].i;
  assert.ok(isRed(fx.segs.col.slice(i * 3, i * 3 + 3)), '조준선은 붉다');
  const w0 = Math.hypot(fx.segs.mat[i * 16], fx.segs.mat[i * 16 + 1], fx.segs.mat[i * 16 + 2]);
  const cast = fx.pillars.spans.filter(s => s.tag === 'tele:cast');
  assert.equal(cast.length, 1, '부활 대상 빛기둥');
  assert.ok(Math.abs(fx.pillars.mat[cast[0].i * 16 + 12] - shaman.aim.x) < 1e-6);
  archer.aimLocked = true;
  fx.update(st, 0, 0, p);
  const j = fx.segs.spans.find(s => s.tag === 'tele:aim').i;
  assert.ok(Math.hypot(fx.segs.mat[j * 16], fx.segs.mat[j * 16 + 1], fx.segs.mat[j * 16 + 2]) > w0, '조준 고정이면 굵다');
});

test('투사체 — 구의 반지름 = proj.r · 화살 0.8m · 모든 visual 이 표에 있다 · 풀 상한 256', () => {
  const visuals = ['magicBolt', 'fireball', 'fireballSplit', 'iceShard', 'arrow', 'shamanFire', 'spark', 'ashBolt'];
  for (const v of visuals) assert.ok(PROJ_STYLE[v], `PROJ_STYLE.${v}`);
  for (const k of ['spinEcho', 'quakeWave', 'shockwave', 'meteor', 'vortex', 'afterimageBlast', 'corpseBlast', 'iceBurst', 'chainArc', 'chargeLine', 'bloaterBurst', 'poisonPool',
    'fireDeath', 'coldNova', 'jail', 'plague', 'mortar', 'slam', 'boneSpikes', 'emberRain', 'guardianSpawn']) assert.ok(KIND_STYLE[k], `KIND_STYLE.${k}(§9.8)`);
  // 화살 0.8m(§9.6)
  const g = arrowGeometry();
  g.computeBoundingBox();
  assert.ok(Math.abs(g.boundingBox.max.z - g.boundingBox.min.z - 0.8) < 0.01, '화살 길이');
  g.dispose();
  const { fx } = makeLayer();
  const st = riftState();
  const p = st.player.pos;
  const radiiBy = { shamanFire: 0.35, ashBolt: 0.4, spark: 0.35, fireball: 0.35 };
  let id = 5000;
  for (const [visual, r] of Object.entries(radiiBy)) {
    st.rift.projs.push({ id: id++, visual, owner: 'mon', srcId: -1, pos: { x: p.x + 2, z: p.z }, prevPos: { x: p.x + 1.8, z: p.z }, vel: { x: 6, z: 0 }, r, born: st.tick - 2, until: st.tick + 20, pierce: 0, hitIds: [], bounce: false, spec: {}, explode: null });
  }
  fx.update(st, 0.5, 0, p);
  const orbScales = fx.orbs.spans.filter(s => s.tag === 'proj').map(s => Math.hypot(fx.orbs.mat[s.i * 16], fx.orbs.mat[s.i * 16 + 1], fx.orbs.mat[s.i * 16 + 2]));
  assert.deepEqual(orbScales.map(v => Math.round(v * 1000) / 1000), Object.values(radiiBy), '구 반지름 = 판정 r');
  // 300개 → 256개까지만
  st.rift.projs.length = 0;
  for (let k = 0; k < 300; k++) {
    st.rift.projs.push({ id: id++, visual: visuals[k % visuals.length], owner: 'player', srcId: -1, pos: { x: p.x + (k % 10), z: p.z + Math.floor(k / 10) * 0.3 }, prevPos: { x: p.x + (k % 10), z: p.z + Math.floor(k / 10) * 0.3 }, vel: { x: 0, z: 10 }, r: 0.3, born: st.tick, until: st.tick + 30, pierce: 0, hitIds: [], bounce: false, spec: {}, explode: null });
  }
  fx.update(st, 0, 0, p);
  assert.ok(fx.orbs.n + fx.shards.n + fx.arrows.n <= CAP.proj, `투사체 ${fx.orbs.n + fx.shards.n + fx.arrows.n}`);
  assert.ok(fx.orbs.n + fx.shards.n + fx.arrows.n >= CAP.proj - 1);
});

test('낙하체 — from → 표식 중심 · 진행 = 틱 · 판정 틱에 땅에 닿는다', () => {
  const { fx } = makeLayer();
  const st = riftState();
  const shape = { type: 'circle', x: 20, z: 18, r: 1.5 };
  const from = { x: 12, z: 12 };
  const e = addEffect(st, { kind: 'mortar', shape, from, ago: 0, delayT: 36 });
  const pos = () => {
    const sp = fx.solids;
    assert.equal(sp.n, 1);
    return { x: sp.mat[12], y: sp.mat[13], z: sp.mat[14] };
  };
  fx.update(st, 0, 0, st.player.pos);
  let q = pos();
  assert.ok(Math.abs(q.x - from.x) < 1e-9 && Math.abs(q.z - from.z) < 1e-9, '출발점');
  st.tick = e.start + 18;
  fx.update(st, 0, 0, st.player.pos);
  q = pos();
  assert.ok(Math.abs(q.x - 16) < 1e-9 && Math.abs(q.z - 15) < 1e-9 && q.y > 2, '가운데(포물선 위)');
  st.tick = e.hitAt - 1;
  fx.update(st, 1, 0, st.player.pos);
  q = pos();
  assert.ok(Math.abs(q.x - shape.x) < 1e-9 && Math.abs(q.z - shape.z) < 1e-9 && q.y < 0.5, `착탄 ${q.y}`);
});

test('풀 상한 — 데칼 200 · 입자 2,000(가산 · 먼지 · 스프라이트) · 판을 반복해도 늘지 않는다 · dispose 가 구독을 푼다', () => {
  const bus = new EventBus();
  const base = bus.count();
  const rc = fakeRc();
  const fx = new FxLayer({ rc, bus, settings: { quality: 'high' } });
  assert.ok(CAP.particlesAdd + CAP.particlesDust + CAP.glyphs <= 2000 && CAP.decals <= 200 && CAP.proj <= 256);
  const census = () => {
    const geos = new Set(), mats = new Set();
    let bytes = 0;
    fx.group.traverse((o) => {
      if (o.geometry) { geos.add(o.geometry); for (const a of Object.values(o.geometry.attributes)) bytes += a.array.byteLength; }
      if (o.material) mats.add(o.material);
      if (o.isInstancedMesh) bytes += o.instanceMatrix.array.byteLength + o.instanceColor.array.byteLength;
    });
    return { geos: geos.size, mats: mats.size, bytes, children: fx.group.children.length };
  };
  const before = census();
  for (let round = 0; round < 3; round++) {
    const st = riftState();
    const ctx = makeTestCtx(st);
    const p = st.player.pos;
    for (let k = 0; k < 300; k++) addEffect(st, { kind: ['jail', 'plague', 'mortar', 'slam', 'boneSpikes'][k % 5], shape: k % 5 === 3 ? { type: 'cone', x: p.x, z: p.z, r: 6.5, facing: k, angle: 1.7 } : k % 5 === 4 ? { type: 'line', x: p.x, z: p.z, facing: k, len: 12, width: 1.4 } : { type: 'circle', x: p.x + (k % 7), z: p.z, r: 2 } });
    for (let k = 0; k < 40; k++) { const m = addTestMonster(ctx, { typeId: 'ghoul', rank: 'elite', x: p.x + (k % 8) - 4, z: p.z + Math.floor(k / 8) - 2 }); m.affixes = MON_AFFIXES.slice(0, 4).map(a => a.id); m.st.burn = { dps: 1, until: st.tick + 99, nextAt: st.tick + 3 }; }
    fx.setMap(null);
    for (let f = 0; f < 40; f++) {
      for (let k = 0; k < 60; k++) bus.emit(EV.HIT, { targetId: -1, x: p.x + (k % 6), z: p.z, amount: 5, type: ['phys', 'fire', 'cold', 'lightning'][k % 4], crit: k % 3 === 0, killed: false, immune: false, blocked: false, dot: false, skillId: 'bash', big: k % 9 === 0 });
      for (let k = 0; k < 8; k++) bus.emit(EV.MON_DIED, { id: k, typeId: 'ghoul', rank: 'normal', x: p.x, z: p.z, facing: 0, launch: null, byPlayer: true, elite: true });
      bus.emit(EV.EFFECT_HIT, { id: 1, kind: 'fireDeath', hostile: true, shape: { type: 'circle', x: p.x, z: p.z, r: 3 }, hitPlayer: false, targets: 0 });
      bus.emit(EV.LEVEL_UP, { level: 2, points: 1 });
      fx.update(st, 0.5, 1 / 60, p);
      st.tick += 1;
      const info = fx.info();
      assert.ok(info.decals <= CAP.decals, `데칼 ${info.decals}`);
      assert.ok(fx.sparks.alive <= CAP.particlesAdd && fx.dust.alive <= CAP.particlesDust && fx.glyphs.n <= CAP.glyphs, '입자 상한');
      assert.ok(fx.sparks.alive + fx.dust.alive + fx.glyphs.n <= 2000);
      assert.ok(fx.decals.n <= CAP.decalVerts && fx.glow.n <= CAP.glowVerts);
    }
    assert.ok(fx.sparks.alive > 100, '입자가 실제로 났다');
    fx.setMap(null);
    assert.equal(fx.sparks.alive + fx.dust.alive, 0, '맵이 바뀌면 입자 정리');
    assert.equal(fx.info().transients, 0);
  }
  assert.deepEqual(census(), before, '지오메트리 · 재질 · 버퍼 크기가 그대로');
  fx.dispose();
  assert.equal(bus.count(), base, 'dispose 뒤 구독 0');
  assert.equal(rc.layers.fx.children.length, 0);
});

test('고정 상태 15개 · 여러 프레임 — 예외 0 · 쓴 버퍼에 NaN 0', () => {
  const { fx, bus } = makeLayer('medium');
  // 캐릭터를 고르기 전(타이틀 뒤 마을 배경)의 상태도 그린다
  fx.update(createGameState({ seed: 1 }), 1, 0, null);
  for (const id of Object.keys(FIXTURES)) {
    const { state, map } = FIXTURES[id](3);
    fx.setMap(map);
    bus.emit(EV.EFFECT_HIT, { id: 1, kind: 'meteor', hostile: false, shape: { type: 'circle', x: state.player.pos.x, z: state.player.pos.z, r: 3.5 }, hitPlayer: false, targets: 2 });
    bus.emit(EV.HIT, { targetId: -1, x: state.player.pos.x, z: state.player.pos.z, amount: 5, type: 'fire', crit: true, killed: false, immune: false, blocked: false, dot: false, skillId: 'bash', big: true });
    for (let f = 0; f < 6; f++) {
      fx.update(state, (f * 0.37) % 1, f % 2 ? 0 : 1 / 60, null);
      for (const [name, arr, n] of [['decals', fx.decals.pos, fx.decals.n * 3], ['glow', fx.glow.pos, fx.glow.n * 3], ['glyphs', fx.glyphs.pos, fx.glyphs.n * 3], ['sparks', fx.sparks.buf.pos, fx.sparks.buf.n * 3]]) {
        for (let i = 0; i < n; i++) assert.ok(Number.isFinite(arr[i]), `${id} ${name}[${i}]`);
      }
      for (const b of fx.batches) for (let i = 0; i < b.n * 16; i++) assert.ok(Number.isFinite(b.mat[i]), `${id} ${b.name}`);
    }
  }
});

test('몸에 붙는 오라(몰타르 포신)는 그린 몸과 같은 방향 보간으로 돈다(리뷰 view-perf — 몸만 alpha 로 돌고 포신이 30Hz 로 끊기지 않게)', () => {
  const { fx } = makeLayer('high');
  const st = riftState();
  const ctx = makeTestCtx(st);
  const p = st.player.pos;
  const m = addTestMonster(ctx, { typeId: 'ghoul', rank: 'elite', x: p.x + 3, z: p.z });
  m.affixes = ['mortar'];
  /** 포신 자리(몸 중심에서 등 쪽) → 그린 방향 */
  const drawn = () => {
    const s = fx.barrels.spans.find((sp) => sp.tag === 'aura:barrel');
    assert.ok(s, '포신');
    const e = fx.barrels.mat, o = s.i * 16;
    return angleDiff(0, Math.atan2(e[o + 12] - m.pos.x, e[o + 14] - m.pos.z) - Math.PI);
  };
  m.facing = 0;
  fx.update(st, 1, 1 / 60, null);
  assert.ok(Math.abs(drawn()) < 1e-4, `시작 ${drawn()}`);
  st.tick += 1; m.facing = 0.6;
  fx.update(st, 0.5, 1 / 60, null);
  assert.ok(Math.abs(drawn() - 0.3) < 1e-4, `틱 사이 가운데 0.3 (${drawn()})`);
  fx.update(st, 1, 1 / 60, null);
  assert.ok(Math.abs(drawn() - 0.6) < 1e-4, `틱 끝 = sim 값 (${drawn()})`);
  fx.dispose();
});
