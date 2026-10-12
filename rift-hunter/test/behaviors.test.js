// OWNER: P3 — 계약 §12.2(behaviors.test) · §8.1 · §7.4
// 9 행동: 소인 도망(팩당 한 번) · 주술사 부활(끊김 · 되살린 것 flags) · 궁수 거리 유지 · 조준 고정 0.2초(옆걸음으로 빗나감) · 방패(느린 선회 — 등 뒤면 시작하지 않는다) ·
// 짐승 돌진(표시 전용 선 · 한 번 적중 · 벽 기절) · 역병 덩어리 폭발/웅덩이 · 둥지 상한 · 「닿지 않는 거리에서 헛동작 없음」.
// 판정 결과(플레이어 피해)가 아니라 P3 의 결정(행동 · 효과 정의 · 투사체 방향 · 상태)을 본다. 효과 · 투사체는 contract 모양(spawnEffect · spawnProjectile — W0 완성)으로 본다.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DT } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { angleDiff, yawOf } from '../src/core/math.js';
import { overlaps } from '../src/core/shapes.js';
import { ticks } from '../src/core/time.js';
import { getMonDef } from '../src/data/index.js';
import { MON } from '../src/data/monsters.js';
import { rebuildSpace } from '../src/sim/entities.js';
import { onMonDamaged, onMonDeath, onMonHitPlayer, onMonSpawn, spawnMonster, updateMonsters } from '../src/sim/monsters/monsters.js';
import { attackOf } from '../src/sim/monsters/spawn.js';
import { losClear } from '../src/sim/world/nav.js';
import { assertFiniteDeep, countEvents, makeTestCtx, makeTestMap, makeTestState } from './helpers.js';

const HOOKS = { onMonSpawn, onMonDamaged, onMonDeath, onMonHitPlayer };

function setup({ ascii = null } = {}) {
  const map = ascii ? makeTestMap(ascii) : makeTestMap();
  const state = makeTestState({ map });
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

function newPack(ctx, kind = 'normal') {
  const pk = { id: ctx.nextId(), kind, memberIds: [], awake: true, nextHazardAt: -1, fled: false, anchor: { x: 0, z: 0 } };
  ctx.state.rift.packs.push(pk);
  return pk;
}
function mon(ctx, pk, typeId, x, z, extra = {}) {
  const m = spawnMonster(ctx, { typeId, rank: 'normal', level: 1, packId: pk ? pk.id : -1, x, z, awake: true, ...extra });
  if (pk) pk.memberIds.push(m.id);
  return m;
}
function kill(state, m) { m.hp = 0; m.dead = true; m.deadAt = state.tick; m.act = 'dead'; }
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

test('fallen: 같은 팩 소인 절반이 죽으면 남은 소인 전부 도망(fleeSec · 반대쪽 · speed × fleeSpeedMul) → 다시 추적 · 팩당 한 번', () => {
  const { ctx, state, p } = setup();
  const def = getMonDef('fallen');
  const pk = newPack(ctx);
  const fs = [0, 1, 2, 3, 4, 5].map(k => mon(ctx, pk, 'fallen', p.pos.x - 5 + k * 2, p.pos.z + 6));
  step(ctx, 2);
  assert.ok(fs.every(m => m.act !== 'flee'));
  kill(state, fs[0]); kill(state, fs[1]);
  step(ctx, 1);
  assert.ok(fs.slice(2).every(m => m.act !== 'flee'), '1/3 이면 아직');
  kill(state, fs[2]);
  const d0 = fs.slice(3).map(m => dist(m.pos, p.pos));
  step(ctx, 1);
  assert.equal(pk.fled, true);
  assert.ok(fs.slice(3).every(m => m.act === 'flee'), '절반 → 도망');
  step(ctx, 20);
  fs.slice(3).forEach((m, i) => assert.ok(dist(m.pos, p.pos) > d0[i] + 1, `멀어졌다 ${i}`));
  assert.ok(fs.slice(3).every(m => !m.targeting), '도망 중엔 노리지 않는다');
  // 이동 속도 = speed × fleeSpeedMul
  const m3 = fs[3];
  const a = { ...m3.pos };
  step(ctx, 1);
  assert.ok(dist(a, m3.pos) <= def.speed * def.params.fleeSpeedMul * DT + 1e-6);
  step(ctx, ticks(def.params.fleeSec));
  assert.ok(fs.slice(3).every(m => m.act !== 'flee'), '끝나면 다시');
  kill(state, fs[3]);
  step(ctx, 3);
  assert.ok(fs.slice(4).every(m => m.act !== 'flee'), '팩당 한 번');
});

test('shaman: window 안의 소인 시체를 부활 채널(1.5초) → 되살린 소인 flags {noXp, noDrops, noGauge, revived} · rank normal · 생명 60% · 시체 gone', () => {
  const { ctx, state, p } = setup();
  const rv = attackOf(getMonDef('fallenShaman'), 'revive');
  const pk = newPack(ctx);
  const sh = mon(ctx, pk, 'fallenShaman', p.pos.x, p.pos.z + 8.5);
  const corpses = [0, 1, 2, 3].map(k => mon(ctx, pk, 'fallen', p.pos.x - 3 + k * 1.5, p.pos.z + 5));
  for (const c of corpses) { kill(state, c); c.deadAt = state.tick - 10; }
  const old = mon(ctx, pk, 'fallen', p.pos.x + 3, p.pos.z + 6);
  kill(state, old); old.deadAt = state.tick - ticks(rv.params.window) - 5;
  step(ctx, 1);
  assert.equal(sh.act, 'channel');
  assert.equal(sh.actId, 'revive');
  assert.ok(sh.aim && sh.aimLocked);
  assert.equal(sh.actHit - sh.actStart, ticks(rv.windup));
  step(ctx, sh.actHit - state.tick);
  const revived = state.rift.mons.filter(m => m.flags.revived);
  assert.equal(revived.length, rv.params.max, '최대 3구');
  for (const r of revived) {
    assert.equal(r.typeId, 'fallen');
    assert.equal(r.rank, 'normal');
    assert.deepEqual(r.flags, { noXp: true, noDrops: true, noGauge: true, revived: true });
    assert.ok(Math.abs(r.hp - r.hpMax * rv.params.hp) < 1e-9);
    assert.ok(r.awake);
    assert.ok(pk.memberIds.includes(r.id));
  }
  assert.equal(corpses.filter(c => c.gone).length, rv.params.max);
  assert.equal(old.gone, false, 'window 지난 시체는 그대로');
  const sp = ctx.events.filter(e => e.name === EV.MON_SPAWNED).map(e => e.payload.reason);
  assert.deepEqual(sp.slice(-3), ['revive', 'revive', 'revive']);
  // 되살린 것이 다시 죽은 시체는 다시 살리지 않는다
  for (const r of revived) kill(state, r);
  sh.readyAt.revive = 0;
  step(ctx, 2);
  assert.notEqual(sh.act, 'channel');
});

test('shaman: 부활 채널은 피해(dmg > 0)를 받으면 끊긴다 — 쿨다운은 쓴 채 · 아무도 살아나지 않는다', () => {
  const { ctx, state, p } = setup();
  const pk = newPack(ctx);
  const sh = mon(ctx, pk, 'fallenShaman', p.pos.x, p.pos.z + 8.5);
  const c = mon(ctx, pk, 'fallen', p.pos.x, p.pos.z + 5);
  kill(state, c); c.deadAt = state.tick - 5;
  step(ctx, 1);
  assert.equal(sh.act, 'channel');
  onMonDamaged(ctx, sh, { monId: sh.id, dmg: 0, crit: false, killed: false, immune: true, blocked: false }, {});
  assert.equal(sh.act, 'channel', '무적 적중(0)은 끊지 않는다');
  onMonDamaged(ctx, sh, { monId: sh.id, dmg: 2, crit: false, killed: false, immune: false, blocked: false }, {});
  assert.notEqual(sh.act, 'channel');
  assert.ok(sh.readyAt.revive > state.tick);
  step(ctx, 60);
  assert.equal(state.rift.mons.filter(m => m.flags.revived).length, 0);
  assert.equal(c.gone, false);
});

test('archer: 7~10m 유지 · backoff(4m) 안이면 backoffMul 속도로 뒷걸음 · 뒤가 막히면 그 자리에서 쏜다', () => {
  const { ctx, p, state } = setup();
  const def = getMonDef('skeletonArcher');
  const a = mon(ctx, null, 'skeletonArcher', p.pos.x, p.pos.z + 3, { facing: Math.PI });
  a.readyAt.arrow = state.tick + 9999;
  const z0 = a.pos.z;
  step(ctx, 1);
  assert.ok(a.pos.z > z0, '물러난다');
  assert.ok(Math.abs((a.pos.z - z0) - def.speed * def.params.backoffMul * DT) < 1e-6, '뒷걸음 속도');
  assert.ok(Math.abs(angleDiff(a.facing, yawOf(p.pos.x - a.pos.x, p.pos.z - a.pos.z))) < 0.3, '플레이어를 보며');
  step(ctx, 120);
  const d = dist(a.pos, p.pos);
  assert.ok(d >= def.params.keepMin - 0.2 && d <= def.params.keepMax + 0.2, `유지 ${d}`);
  // 벽 앞(서쪽 벽 x = 2)에서 3m 안 → 막혀서 쏜다
  const { ctx: c2, p: p2, state: s2 } = setup();
  p2.pos.x = 6.0; p2.pos.z = 21;
  const b = mon(c2, null, 'skeletonArcher', 2.45, 21);
  step(c2, 4);
  assert.equal(b.act, 'windup', '뒤가 막히면 그 자리에서');
  assert.equal(b.actId, 'arrow');
  void s2;
});

test('archer: 조준은 예비 동안 플레이어를 따라가다 마지막 aimLock(0.2초)에 멈춘다 → 그 점으로 발사(멈춘 뒤 옆걸음이면 빗나간다)', () => {
  const { ctx, p, state } = setup();
  const atk = attackOf(getMonDef('skeletonArcher'), 'arrow');
  const a = mon(ctx, null, 'skeletonArcher', p.pos.x, p.pos.z + 8);
  step(ctx, 1);
  assert.equal(a.act, 'windup');
  const lockAt = a.actHit - ticks(atk.aimLock);
  p.pos.x += 1;
  step(ctx, 2);
  assert.ok(Math.abs(a.aim.x - p.pos.x) < 1e-9, '따라간다');
  step(ctx, lockAt - state.tick);
  assert.equal(a.aimLocked, true);
  const locked = { ...a.aim };
  p.pos.x += 1.5;   // 멈춘 뒤 옆걸음
  step(ctx, a.actHit - state.tick);
  assert.deepEqual(a.aim, locked);
  const pr = state.rift.projs.at(-1);
  assert.ok(pr && pr.visual === 'arrow' && pr.owner === 'mon' && pr.srcId === a.id);
  const toAim = yawOf(locked.x - a.pos.x, locked.z - a.pos.z), toNow = yawOf(p.pos.x - a.pos.x, p.pos.z - a.pos.z);
  assert.ok(Math.abs(angleDiff(yawOf(pr.vel.x, pr.vel.z), toAim)) < 1e-6, '멈춘 점으로');
  assert.ok(Math.abs(angleDiff(toAim, toNow)) > 0.15);
  assert.ok(Math.abs(Math.hypot(pr.vel.x, pr.vel.z) - atk.proj.speed) < 1e-9);
  assert.equal(pr.spec.via, 'projectile');
  assert.ok(Math.abs(pr.spec.raw - a.dmg * atk.mul) < 1e-9);
  assert.equal(countEvents(ctx.events, EV.MON_STRIKE), 1);
});

test('shield: 선회가 느리다(3 rad/s) — 등 뒤의 플레이어에게는 돌아설 때까지 밀치기를 시작하지 않는다', () => {
  const { ctx, p, state } = setup();
  const def = getMonDef('shieldSkeleton');
  const s = mon(ctx, null, 'shieldSkeleton', p.pos.x, p.pos.z - 1.6);
  s.facing = Math.PI;   // 플레이어(+Z)를 등진다
  let started = -1;
  step(ctx, 40, () => { if (started < 0 && s.act === 'windup') started = state.tick; });
  const need = (Math.PI - (def.attacks[0].coneDeg / 2) * Math.PI / 180) / def.turnRate;
  assert.ok(started > 0, '돌아서면 친다');
  assert.ok(started - 100 >= ticks(need) - 2, `돌아서는 데 ${need}s · 시작 ${started - 100}틱`);
  assert.equal(s.actId, 'shieldBash');
  assert.equal(attackOf(def, 'shieldBash').push, 1.2);
});

test('charger: 5~11m · 시야면 돌진 예비 — chargeLine(적대 · spec null · 폭 2r · 길이 min(13, 거리 + 2) + r · cancelOnSrcDeath) → 판정 틱부터 14 m/s · 한 번만 적중 · 선 끝에서 후딜', () => {
  const { ctx, p, state } = setup();
  const atk = attackOf(getMonDef('charger'), 'charge');
  const c = mon(ctx, null, 'charger', p.pos.x, p.pos.z - 8);
  step(ctx, 1);
  assert.equal(c.act, 'windup');
  assert.equal(c.actId, 'charge');
  const e = state.rift.effects.find(x => x.kind === 'chargeLine');
  assert.ok(e);
  assert.equal(e.hostile, true);
  assert.equal(e.spec, null, '표시 전용 — 충돌은 행동이 판정');
  assert.equal(e.cancelOnSrcDeath, true);
  assert.equal(e.shape.type, 'line');
  assert.ok(Math.abs(e.shape.width - 2 * c.r) < 1e-9);
  assert.ok(Math.abs(e.shape.len - (Math.min(atk.params.maxLen, 8 + atk.params.overshoot) + c.r)) < 1e-6, '몸 중심이 가는 거리 + r(몸 앞 — 리뷰 수정)');
  assert.equal(e.hitAt, c.actHit);
  assert.equal(e.hitAt - e.start, ticks(atk.windup));
  assert.ok(overlaps(e.shape, p.pos.x, p.pos.z, p.r), '표식이 플레이어를 지난다');
  const start = { ...c.pos };
  step(ctx, c.actHit - state.tick);
  assert.equal(c.act, 'charge');
  const prev = { ...c.pos };
  step(ctx, 1);
  assert.ok(Math.abs(dist(prev, c.pos) - atk.params.speed * DT) < 1e-6, '14 m/s');
  let hits = 0;
  step(ctx, 40, () => { if (c.ax.b.charge && c.ax.b.charge.hit) hits = 1; });
  assert.equal(c.ax.b.charge, null);
  assert.ok(dist(start, c.pos) >= e.shape.len - c.r - 0.6 && dist(start, c.pos) <= atk.params.maxLen + 0.01);
  assert.notEqual(c.act, 'charge');
  void hits;
});

test('charger: 벽에 박으면(이번 틱 이동이 계획의 50% 미만) 그 자리에서 끝 · wallStun 기절', () => {
  const { ctx, p, state } = setup();
  // 서쪽 벽(x = 2)을 향해: 짐승 x = 11 → 플레이어 x = 3.5 → 벽(계획 길이 9.5m 가 벽을 넘는다)
  p.pos.x = 3.5; p.pos.z = 21;
  const c = mon(ctx, null, 'charger', 11, 21);
  step(ctx, 1);
  assert.equal(c.actId, 'charge');
  const e = state.rift.effects.find(x => x.kind === 'chargeLine');
  assert.ok(e.shape.len <= 11 - 2 + 0.01, `표식은 벽 앞에서 자른다 ${e.shape.len}`);
  step(ctx, c.actHit - state.tick + 30);
  assert.ok(c.ax.b.wallAt > 0, '벽에 박았다');
  assert.ok(c.pos.x < 2 + c.r + 0.3);
  assert.ok(c.st.stunUntil > c.ax.b.wallAt, '기절(status.applyStun)');
});

test('리뷰 수정: 돌진 표식(chargeLine) 끝과 판정이 같다 — 선 끝 바깥(몸 가장자리) 0.36m 에 선 플레이어는 맞지 않고 0.05m 안쪽은 맞는다(일반 · 정예 · QUALITY §2 ≤ 0.35m)', () => {
  for (const rank of ['normal', 'elite']) {
    for (const [b, want] of [[-0.05, true], [0.36, false], [0.6, false]]) {
      const { ctx, p, state } = setup();
      const c = mon(ctx, null, 'charger', p.pos.x, p.pos.z - 8, { rank });
      step(ctx, 1);
      const e = state.rift.effects.find(x => x.kind === 'chargeLine');
      assert.ok(e, `${rank}: 돌진 예비`);
      const sh = e.shape;
      const fx = Math.sin(sh.facing), fz = Math.cos(sh.facing);
      // 선 끝 바깥 b(플레이어 몸 가장자리 기준 · 음수면 안쪽)
      const d = sh.len + p.r + b;
      p.pos.x = sh.x + fx * d;
      p.pos.z = sh.z + fz * d;
      assert.equal(overlaps(sh, p.pos.x, p.pos.z, p.r), b < 0, '표식과 몸이 겹치는가');
      const charge = c.ax.b.charge;
      step(ctx, 80);
      assert.equal(!!charge && charge.hit, want, `${rank} b=${b}: 표식 ${want ? '안인데 안 맞았다' : '밖인데 맞았다'}`);
    }
  }
});

test('bloater: 2.2m 안이면 부풀기(swell) — bloaterBurst(원 r 2.8 · 실제 spec · cancelOnSrcDeath · delay = 예비) → 판정 틱에 스스로 생명 0 · 웅덩이', () => {
  const { ctx, p, state } = setup();
  const atk = attackOf(getMonDef('bloater'), 'burst');
  const b = mon(ctx, null, 'bloater', p.pos.x, p.pos.z - 4);
  let swellAt = -1;
  step(ctx, 80, () => { if (swellAt < 0 && b.act === 'swell') swellAt = state.tick; });
  assert.ok(swellAt > 0, '부풀었다');
  assert.ok(b.hp <= 0, '스스로 터졌다');
  const e = state.rift.effects.find(x => x.kind === 'bloaterBurst');
  assert.ok(e);
  assert.equal(e.shape.type, 'circle');
  assert.equal(e.shape.r, atk.params.r);
  assert.equal(e.hitAt - e.start, ticks(atk.windup));
  assert.equal(e.start, swellAt);
  assert.equal(e.cancelOnSrcDeath, true);
  assert.equal(e.spec.via, 'explode');
  assert.ok(Math.abs(e.spec.raw - b.dmg * atk.mul) < 1e-9);
  assert.deepEqual([b.flags.noXp, b.flags.noDrops, b.flags.noGauge], [true, true, true]);
  assert.equal(b.lastHit.by, 'mon');
  assert.equal(state.rift.effects.filter(x => x.kind === 'bloaterBurst').length, 1, '판정 주체는 효과 하나');
  // 시작 거리: 중심 거리 ≤ range
  assert.ok(Math.hypot(e.shape.x - p.pos.x, e.shape.z - p.pos.z) <= atk.range + 1e-9);
  // 죽으면(터지기 전 포함) 웅덩이 — 예고 없음 · 3초 · 0.5초 틱 · spec null · tickSpec
  const c = mon(ctx, null, 'bloater', 10, 30);
  kill(state, c);
  onMonDeath(ctx, c);
  const pool = state.rift.effects.find(x => x.kind === 'poisonPool' && x.srcId === c.id);
  assert.ok(pool);
  assert.equal(pool.hitAt, pool.start);
  assert.equal(pool.spec, null);
  assert.equal(pool.tickT, ticks(atk.params.poolTick));
  assert.equal(pool.nextTickAt, pool.hitAt + pool.tickT, '첫 지속 판정 = hitAt + tickT');
  assert.equal(pool.end - pool.hitAt, ticks(atk.params.poolSec));
  assert.ok(Math.abs(pool.tickSpec.raw - c.dmg * atk.params.poolMulPerSec * atk.params.poolTick) < 1e-9);
  assert.equal(pool.shape.r, atk.params.poolR);
});

test('nest: 움직이지 않는다 · 깨어 있고 살아 있는 새끼 < cap(6) · range 안이면 3.5초마다 새끼(rank spawn · 깨어 있게 · 같은 팩 · MON_SPAWNED{nest})', () => {
  const { ctx, p, state } = setup();
  const atk = attackOf(getMonDef('boneNest'), 'spawn');
  const pk = newPack(ctx);
  const n = mon(ctx, pk, 'boneNest', p.pos.x, p.pos.z + 9);
  const n0 = { ...n.pos };
  step(ctx, ticks(atk.cd) * 10 + 30);
  const kids = () => state.rift.mons.filter(m => m.typeId === atk.params.child && !m.dead && !m.gone);
  assert.equal(kids().length, atk.params.cap, '상한');
  assert.deepEqual(n.pos, n0);
  for (const k of kids()) {
    assert.equal(k.rank, 'spawn');
    assert.equal(k.awake, true);
    assert.equal(k.packId, pk.id);
    assert.ok(pk.memberIds.includes(k.id));
  }
  assert.equal(ctx.events.filter(e => e.name === EV.MON_SPAWNED && e.payload.reason === 'nest').length, atk.params.cap);
  kill(state, kids()[0]);
  kill(state, kids()[0]);
  step(ctx, ticks(atk.cd) * 3);
  assert.equal(kids().length, atk.params.cap, '다시 채운다');
  // 플레이어가 range 밖이면 낳지 않는다
  const { ctx: c2, p: p2, state: s2 } = setup();
  p2.pos.z = 2.5;
  const n2 = mon(c2, newPack(c2), 'boneNest', p2.pos.x, 2.5 + atk.range + 2);
  step(c2, 200);
  assert.equal(s2.rift.mons.filter(m => m.typeId === atk.params.child).length, 0);
  void n2;
});

test('「닿지 않는 거리에서 헛동작 없음」 — 모든 종류: 근접은 r + reach + player.r 안 · 원거리는 사거리 · 시야 · 돌진은 5~11m · 위협은 MON.threatRange(11m) 안에서만 시작', () => {
  const { ctx, p, state, map } = setup();
  const types = ['ghoul', 'fallen', 'fallenShaman', 'skeletonArcher', 'shieldSkeleton', 'charger', 'bloater', 'boneNest', 'boneling', 'ashling'];
  const pk = newPack(ctx);
  types.forEach((t, k) => mon(ctx, pk, t, 5 + (k % 5) * 8, 6 + Math.floor(k / 5) * 30));
  const bad = [];
  // 플레이어가 방 안을 돌아다닌다(결정적)
  step(ctx, 1800, (i) => {
    // 이번 틱의 MON_ACT 를 그 틱의 플레이어 자리로 본 뒤 → 다음 틱 자리로 옮긴다
    for (const e of ctx.events.splice(0)) {
      if (e.name !== EV.MON_ACT) continue;
      const m = state.rift.mons.find(x => x.id === e.payload.id);
      const def = getMonDef(m.typeId);
      const atk = attackOf(def, e.payload.actId);
      const d = Math.hypot(p.pos.x - e.payload.x, p.pos.z - e.payload.z);
      const why = `${m.typeId}.${atk.id} d=${d.toFixed(2)}`;
      if (atk.kind === 'melee' && d > m.r + atk.reach + p.r + 1e-6) bad.push('근접 ' + why);
      if ((atk.kind === 'projectile' || atk.kind === 'charge' || atk.kind === 'explode' || atk.kind === 'spawn') && d > atk.range + 1e-6) bad.push('사거리 ' + why);
      if (atk.kind === 'charge' && d < atk.minRange - 1e-6) bad.push('최소 ' + why);
      if (atk.kind === 'projectile' && !losClear(map, e.payload.x, e.payload.z, p.pos.x, p.pos.z, { props: true })) bad.push('시야 ' + why);
      if (d > MON.threatRange + 1e-6 && atk.kind !== 'cast') bad.push('위협 거리 ' + why);
    }
    const a = i * 0.013;
    p.pos.x = 22 + Math.sin(a) * 14;
    p.pos.z = 21 + Math.cos(a * 1.7) * 14;
  });
  assert.deepEqual(bad, []);
  assertFiniteDeep(state.rift.mons);
});
