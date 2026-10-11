// OWNER: P3 — 계약 §12.2(guardians.test) · §8.3 · §7.5b
// 수호자 프레임워크(spawnGuardian · init · 위임) + 뼈 거인(대지 분쇄 · 뼈 가시 · 선 사이로 피함 · 판정 주체는 효과 하나) · 출현 자리 규칙(findGuardianSpot).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EV } from '../src/core/events.js';
import { angleDiff, deg2rad, yawOf } from '../src/core/math.js';
import { overlaps } from '../src/core/shapes.js';
import { ticks } from '../src/core/time.js';
import { HAZARD } from '../src/data/combat.js';
import { getMonDef } from '../src/data/index.js';
import { GUARDIAN_SPOT } from '../src/data/guardians.js';
import { riftRow } from '../src/data/rift.js';
import { rebuildSpace } from '../src/sim/entities.js';
import {
  findGuardianSpot, onMonDamaged, onMonDeath, onMonHitPlayer, onMonSpawn, spawnGuardian, spawnMonster, updateMonsters,
} from '../src/sim/monsters/monsters.js';
import { attackOf } from '../src/sim/monsters/spawn.js';
import { isWalkableR, losClear } from '../src/sim/world/nav.js';
import { countEvents, makeTestCtx, makeTestMap, makeTestState } from './helpers.js';

const HOOKS = { onMonSpawn, onMonDamaged, onMonDeath, onMonHitPlayer };

function setup({ ascii = null, level = 1 } = {}) {
  const map = ascii ? makeTestMap(ascii) : makeTestMap();
  const state = makeTestState({ map });
  state.rift.level = level;
  state.rift.guardianType = 'boneGiant';
  state.tick = 100;
  state.flags.invincible = true;
  const ctx = makeTestCtx(state, { map, hooks: HOOKS });
  return { state, ctx, map, p: state.player };
}

function step(ctx, n = 1, each = null) {
  for (let i = 0; i < n; i++) {
    const st = ctx.state;
    st.tick += 1;
    for (const m of st.rift.mons) { m.prevPos.x = m.pos.x; m.prevPos.z = m.pos.z; }
    rebuildSpace(ctx);
    updateMonsters(ctx);
    if (each) each(i);
  }
}

test('spawnGuardian: rift.guardianType · rank guardian · 속성 riftRow.guardianAffixes · 속성 저항 없음 · 깨어 있게 · 팩 하나 · MON_SPAWNED{guardian} · init 이 기술 타이머를 둔다', () => {
  for (const level of [1, 15]) {
    const { ctx, state, p } = setup({ level });
    const g = spawnGuardian(ctx, p.pos.x, p.pos.z + 9);
    const def = getMonDef('boneGiant');
    assert.equal(g.typeId, 'boneGiant');
    assert.equal(g.rank, 'guardian');
    assert.equal(g.affixes.length, riftRow(level).guardianAffixes);
    assert.equal(new Set(g.affixes).size, g.affixes.length);
    assert.deepEqual(g.res, def.res, '속성의 mods.res 를 받지 않는다');
    assert.equal(g.awake, true);
    assert.equal(g.r, def.radius);
    const pk = state.rift.packs.find(x => x.id === g.packId);
    assert.equal(pk.kind, 'guardian');
    assert.deepEqual(pk.memberIds, [g.id]);
    const sp = ctx.events.find(e => e.name === EV.MON_SPAWNED);
    assert.equal(sp.payload.reason, 'guardian');
    assert.equal(g.readyAt.slam, state.tick + ticks(def.params.slamFirst));
    assert.equal(g.readyAt.spikes, state.tick + ticks(def.params.spikesFirst));
    assert.ok(Math.abs(angleDiff(g.facing, yawOf(p.pos.x - g.pos.x, p.pos.z - g.pos.z))) < 1e-9, '플레이어를 본다');
    assert.ok(Number.isFinite(g.hpMax) && Number.isFinite(def.xp));
  }
});

test('뼈 거인 대지 분쇄: 6m 안 · 예비 시작 틱에 효과 slam(원뿔 r 6.5 · 100° · 예고 1.2 · 실제 spec · 흔들림 · cancelOnSrcDeath) — strike 는 효과를 다시 만들지 않는다', () => {
  const { ctx, state, p } = setup();
  const def = getMonDef('boneGiant');
  const slam = attackOf(def, 'slam');
  const g = spawnGuardian(ctx, p.pos.x, p.pos.z + 4.5);
  g.readyAt.slam = 0;
  step(ctx, 1);
  assert.equal(g.actId, 'slam');
  assert.equal(g.act, 'cast');
  const fx = state.rift.effects.filter(e => e.kind === 'slam');
  assert.equal(fx.length, 1);
  const e = fx[0];
  assert.equal(e.start, state.tick);
  assert.equal(e.hitAt - e.start, ticks(slam.windup), '예고 = 예비(빠름 무관)');
  assert.equal(e.hitAt, g.actHit);
  assert.equal(e.shape.type, 'cone');
  assert.equal(e.shape.r, slam.params.r);
  assert.ok(Math.abs(e.shape.angle - deg2rad(slam.params.angleDeg)) < 1e-9);
  assert.ok(overlaps(e.shape, p.pos.x, p.pos.z, p.r));
  assert.equal(e.cancelOnSrcDeath, true);
  assert.equal(e.hostile, true);
  assert.equal(e.packId, g.packId);
  assert.ok(Math.abs(e.spec.raw - g.dmg * slam.mul) < 1e-9);
  assert.equal(e.spec.shake, slam.params.shake);
  // H5: 걸어서 피할 수 있다
  assert.ok(slam.windup >= HAZARD.react + slam.escape / HAZARD.slowSpeed);
  step(ctx, g.actHit - state.tick + 2);
  assert.equal(countEvents(ctx.events, EV.MON_STRIKE), 1);
  assert.equal(state.rift.effects.filter(x => x.kind === 'slam').length, 1, '판정 주체는 효과 하나');
});

test('뼈 가시: 11m 안 · 시야 · 선 5개(플레이어 방향 −50 · −25 · 0 · +25 · +50° · len 12 · 폭 1.4 · 예고 1.4) — 가운데는 플레이어 위 · 선 사이로 피한다', () => {
  const { ctx, state, p } = setup();
  const def = getMonDef('boneGiant');
  const sp = attackOf(def, 'spikes');
  const g = spawnGuardian(ctx, p.pos.x, p.pos.z + 8);
  g.readyAt.slam = state.tick + 9999;
  g.readyAt.spikes = 0;
  step(ctx, 1);
  assert.equal(g.actId, 'spikes');
  const lines = state.rift.effects.filter(e => e.kind === 'boneSpikes');
  assert.equal(lines.length, sp.params.n);
  const base = yawOf(p.pos.x - g.pos.x, p.pos.z - g.pos.z);
  const want = [-50, -25, 0, 25, 50].map(d => base + deg2rad(d));
  lines.forEach((e, i) => {
    assert.equal(e.shape.type, 'line');
    assert.ok(Math.abs(angleDiff(e.shape.facing, want[i])) < 1e-9);
    assert.equal(e.shape.len, sp.params.len);
    assert.equal(e.shape.width, sp.params.width);
    assert.equal(e.hitAt - e.start, ticks(sp.windup));
    assert.equal(e.cancelOnSrcDeath, true);
  });
  assert.ok(overlaps(lines[2].shape, p.pos.x, p.pos.z, p.r), '가운데 선이 플레이어 위');
  // 선 사이(+12.5°) — 거인에서 5.1m 넘으면 몸(0.4)이 어느 선에도 닿지 않는다(틈 = 2d·sin12.5° − 1.4). 더 가까우면 옆으로 나간다(escape 3.9 · H5)
  for (const d of [5.2, 6, 8, 10]) {
    const a = base + deg2rad(12.5);
    const x = g.pos.x + Math.sin(a) * d, z = g.pos.z + Math.cos(a) * d;
    assert.ok(lines.every(e => !overlaps(e.shape, x, z, p.r)), `틈 ${d}m`);
  }
  assert.ok(sp.windup >= HAZARD.react + sp.escape / HAZARD.slowSpeed, 'H5');
  step(ctx, g.actHit - state.tick + 2);
  assert.equal(state.rift.effects.filter(x => x.kind === 'boneSpikes').length, sp.params.n, 'strike 는 다시 만들지 않는다');
});

test('뼈 거인: 기술이 쿨이면 휘두르기(근접 · 시작 관용 없음) · 멀면 추적 · 고정 상태처럼 init 없이 깨어 있어도 think 가 init 한다', () => {
  const { ctx, state, p } = setup();
  const def = getMonDef('boneGiant');
  const sw = attackOf(def, 'swing');
  const g = spawnMonster(ctx, { typeId: 'boneGiant', rank: 'guardian', level: 1, x: p.pos.x, z: p.pos.z + 12, awake: true });
  g.facing = Math.PI;
  step(ctx, 1);
  assert.ok(g.ax.g, 'think 가 init');
  assert.ok(g.readyAt.slam > state.tick);
  let swung = -1;
  step(ctx, 400, () => { if (swung < 0 && g.actId === 'swing') swung = state.tick; });
  assert.ok(swung > 0, '휘두른다');
  assert.ok(Math.hypot(g.pos.x - p.pos.x, g.pos.z - p.pos.z) <= g.r + sw.reach + p.r + 0.3 + 1e-6);
});

test('findGuardianSpot: 플레이어에서 8~10m · 수호자 몸이 들어가는 걷기 가능 점 · 시야 — 좁은 곳에서도 걷기 가능한 점', () => {
  const { ctx, p, map } = setup();
  const r = getMonDef('boneGiant').radius;
  for (const [x, z, f] of [[23, 21, 0], [6, 6, Math.PI], [38, 38, 1], [23, 4, 0]]) {
    p.pos.x = x; p.pos.z = z; p.facing = f;
    const s = findGuardianSpot(ctx);
    const d = Math.hypot(s.x - x, s.z - z);
    assert.ok(d >= GUARDIAN_SPOT.min - 1e-9 && d <= GUARDIAN_SPOT.max + 1e-9, `거리 ${d}`);
    assert.ok(isWalkableR(map, s.x, s.z, r), '몸이 들어간다');
    assert.ok(losClear(map, x, z, s.x, s.z), '시야');
  }
  // 플레이어가 보는 쪽이 먼저
  p.pos.x = 23; p.pos.z = 21; p.facing = Math.PI / 2;
  const s = findGuardianSpot(ctx);
  assert.ok(Math.abs(angleDiff(yawOf(s.x - 23, s.z - 21), Math.PI / 2)) < 0.01);
  // 좁은 통로(폭 4m · 길이 10m) — 8~10m 자리가 없으면 걷기 가능한 가까운 점
  const tiny = ['#######', '#.....#', '#..S..#', '#.....#', '#######'].join('\n');
  const t = setup({ ascii: tiny });
  const q = findGuardianSpot(t.ctx);
  assert.ok(Number.isFinite(q.x) && Number.isFinite(q.z));
});
