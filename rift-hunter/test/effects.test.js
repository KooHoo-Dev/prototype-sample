// OWNER: P2 — 계약 §12.2 · §5.9 · §5.16-6 · §3.7(Effect · Proj)
// 예고 → 판정 틱 · spec null(표시 전용) · tickSpec · 첫 지속 판정 = hitAt + tickT · 출처 사망 취소 · 같은 틱 취소 · 위협 간격 H1~H4 ·
// 감옥 + 역병 + 몰타르 동시 시도 → 묶인 채 맞는 판정 0 · 투사체(벽 · 관통 · 튕김 · 폭발 · 몬스터 투사체).
// makeTestCtx · addTestMonster · 데이터 행만 쓴다(속성 훅은 아래에서 데이터 값으로 흉내 낸다 — P16 구현을 기다리지 않는다).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EV } from '../src/core/events.js';
import { circle, cone, line } from '../src/core/shapes.js';
import { ticks } from '../src/core/time.js';
import { HAZARD } from '../src/data/combat.js';
import { getMonAffix } from '../src/data/index.js';
import { canStartHazard, noteHazard, spawnEffect, updateEffects } from '../src/sim/effects.js';
import { spawnProjectile, updateProjectiles } from '../src/sim/projectiles.js';
import { removeMarked } from '../src/sim/entities.js';
import { updateStatus } from '../src/sim/status.js';
import { isWalkable } from '../src/sim/world/nav.js';
import { addTestMonster, countEvents, makeTestCtx, makeTestState, makeTestStats } from './helpers.js';

function setup({ hooks = {}, stats = {} } = {}) {
  const state = makeTestState();
  state.tick = 100;
  state.player.lifeMax = 1e6;
  state.player.life = 1e6;
  const ctx = makeTestCtx(state, { stats: makeTestStats({ critChance: 0, ...stats }), hooks });
  return { state, ctx, p: state.player };
}

/** 한 틱: tick + 1 → 투사체 → 효과 → 상태 → cleanup */
function tickWorld(ctx) {
  ctx.state.tick += 1;
  updateProjectiles(ctx);
  updateEffects(ctx);
  updateStatus(ctx);
  removeMarked(ctx);
}

const monSpec = (raw, extra = {}) => ({ srcId: -1, via: 'hazard', raw, type: 'phys', level: 1, ...extra });
const pSpec = (ctx, extra = {}) => ({ skillId: 'meteor', coef: 1, type: 'fire', tags: ['aoe'], actionId: 5000, srcX: ctx.state.player.pos.x, srcZ: ctx.state.player.pos.z, ...extra });
const playerHits = (ctx) => ctx.events.filter(e => e.name === EV.PLAYER_HIT && e.payload.amount > 0);

test('예고 → 판정 틱: [start, hitAt) 동안은 맞지 않고 hitAt 에 한 번 · EFFECT_HIT · end 뒤 cleanup', () => {
  const { state, ctx, p } = setup();
  const e = spawnEffect(ctx, { kind: 'coldNova', owner: 'mon', srcId: -1, hostile: true, shape: circle(p.pos.x, p.pos.z, 2), delay: 1.0, spec: monSpec(10) });
  assert.equal(e.hitAt, e.start + ticks(1.0));
  assert.equal(e.end, e.hitAt + 1);
  const hitTicks = [];
  for (let i = 0; i < 40; i++) {
    const before = playerHits(ctx).length;
    tickWorld(ctx);
    if (playerHits(ctx).length > before) hitTicks.push(state.tick);
  }
  assert.deepEqual(hitTicks, [e.hitAt]);
  const eh = ctx.events.find(x => x.name === EV.EFFECT_HIT);
  assert.equal(eh.payload.hitPlayer, true);
  assert.equal(state.rift.effects.length, 0, 'end 가 지나 cleanup 이 뺐다');
});

test('spec null 예고(돌진 선)는 판정하지 않는다 · 지속 효과의 첫 판정은 hitAt + tickT(놓이는 틱에 맞지 않는다)', () => {
  const { state, ctx, p } = setup();
  spawnEffect(ctx, { kind: 'chargeLine', owner: 'mon', srcId: -1, hostile: true, shape: line(p.pos.x, p.pos.z - 3, 0, 8, 1.2), delay: 0.9, spec: null });
  const pool = spawnEffect(ctx, { kind: 'poisonPool', owner: 'mon', srcId: -1, hostile: true, shape: circle(p.pos.x, p.pos.z, 1.6), delay: 0, dur: 2, tick: 0.5, spec: null, tickSpec: monSpec(3) });
  const hitTicks = [];
  for (let i = 0; i < 80; i++) {
    const before = playerHits(ctx).length;
    tickWorld(ctx);
    if (playerHits(ctx).length > before) hitTicks.push(state.tick - pool.hitAt);
  }
  const T = ticks(0.5);
  assert.deepEqual(hitTicks, [T, 2 * T, 3 * T], '돌진 선 0 · 웅덩이는 hitAt + tickT 부터 tickT 마다 · end 전까지');
});

test('비적대 지속 판정: 충돌은 spec(만든 쪽의 actionId) · 불타는 바닥은 tickSpec(틱마다 새 actionId · tickHit)', () => {
  const ids = [];
  const { state, ctx, p } = setup({ hooks: { onMonDamaged: (c, mon, hit, sp) => ids.push([sp.actionId, !!sp.tickHit, sp.coef]) } });
  addTestMonster(ctx, { x: p.pos.x + 1, z: p.pos.z, hp: 1e6 });
  spawnEffect(ctx, {
    kind: 'meteor', owner: 'player', srcId: -1, hostile: false, shape: circle(p.pos.x + 1, p.pos.z, 3.5), delay: 1.2, dur: 1.5, tick: 0.5,
    spec: pSpec(ctx, { coef: 3.6 }), tickSpec: pSpec(ctx, { coef: 0.35 * 0.5, tags: ['aoe', 'dot'] }),
  });
  for (let i = 0; i < 90; i++) tickWorld(ctx);
  assert.equal(ids[0][0], 5000);
  assert.equal(ids[0][2], 3.6);
  const tickHits = ids.slice(1);
  assert.equal(tickHits.length, 2, '1.5초 · 0.5초 틱 → hitAt + 15 · + 30 (end = hitAt + 45 전)');
  assert.ok(tickHits.every(t => t[1] && t[2] === 0.175));
  assert.equal(new Set(tickHits.map(t => t[0])).size, 2, '틱마다 새 actionId');
  assert.ok(tickHits.every(t => t[0] !== 5000));
  assert.ok(state.tick > 0);
});

test('출처 사망 취소(§5.16-6): 몸에 붙은 예고는 출처가 죽은 첫 틱에 지운다 · hitAt 에 생명 ≤ 0 이 된 출처는 판정한다(역병 덩어리는 한 번만)', () => {
  const { state, ctx, p } = setup();
  // A: 판정 전에 죽은 역병 덩어리 → 지움 · 피해 0
  const a = addTestMonster(ctx, { typeId: 'bloater', x: p.pos.x + 1, z: p.pos.z });
  const ea = spawnEffect(ctx, { kind: 'bloaterBurst', owner: 'mon', srcId: a.id, hostile: true, shape: circle(a.pos.x, a.pos.z, 2.8), delay: 1.0, spec: monSpec(10, { srcId: a.id, via: 'explode' }), cancelOnSrcDeath: true });
  tickWorld(ctx);
  a.hp = 0;
  a.dead = true;
  tickWorld(ctx);
  assert.equal(ea.end, state.tick - 0, '그 틱에 end = tick');
  for (let i = 0; i < 40; i++) tickWorld(ctx);
  assert.equal(playerHits(ctx).length, 0);
  // B: 판정 틱에 스스로 생명 0(아직 dead 아님) → 판정 한 번
  const b = addTestMonster(ctx, { typeId: 'bloater', x: p.pos.x + 1, z: p.pos.z });
  const eb = spawnEffect(ctx, { kind: 'bloaterBurst', owner: 'mon', srcId: b.id, hostile: true, shape: circle(b.pos.x, b.pos.z, 2.8), delay: 1.0, spec: monSpec(10, { srcId: b.id, via: 'explode' }), cancelOnSrcDeath: true });
  while (state.tick + 1 < eb.hitAt) tickWorld(ctx);
  b.hp = 0;   // P3 strike(판정 틱 · step 5)가 스스로 생명 0
  tickWorld(ctx);
  assert.equal(playerHits(ctx).length, 1);
  b.dead = true;
  for (let i = 0; i < 10; i++) tickWorld(ctx);
  assert.equal(playerHits(ctx).length, 1, '두 번 맞지 않는다');
  // C: 바닥에 놓인 것(감옥 · 역병 · 몰타르 — cancelOnSrcDeath 아님)은 출처가 죽어도 판정
  const c = addTestMonster(ctx, { x: p.pos.x + 5, z: p.pos.z });
  spawnEffect(ctx, { kind: 'mortar', owner: 'mon', srcId: c.id, hostile: true, shape: circle(p.pos.x, p.pos.z, 1.5), delay: 1.2, spec: monSpec(10, { srcId: c.id }) });
  c.dead = true;
  for (let i = 0; i < 40; i++) tickWorld(ctx);
  assert.equal(playerHits(ctx).length, 2);
});

test('같은 틱 취소: 판정 틱 전에 end = tick 으로 지운 예고는 그 틱에 판정하지 않는다 · 늦게(정리 단계에) 만든 delay 0 효과는 다음 틱에 판정한다', () => {
  const { state, ctx, p } = setup();
  const e = spawnEffect(ctx, { kind: 'slam', owner: 'mon', srcId: -1, hostile: true, shape: cone(p.pos.x, p.pos.z - 2, 6.5, 0, Math.PI / 2), delay: 0.5, spec: monSpec(10) });
  while (state.tick + 1 < e.hitAt) tickWorld(ctx);
  state.tick += 1;
  e.end = state.tick;   // 다른 쪽이 표시만으로 지웠다(resolved 는 그대로)
  updateEffects(ctx);
  assert.equal(playerHits(ctx).length, 0);
  // 정리 단계(updateEffects 뒤)에 만든 delay 0 효과
  const late = spawnEffect(ctx, { kind: 'corpseBlast', owner: 'mon', srcId: -1, hostile: true, shape: circle(p.pos.x, p.pos.z, 3), delay: 0, spec: monSpec(5) });
  removeMarked(ctx);
  assert.equal(late.end, state.tick + 1);
  tickWorld(ctx);
  assert.equal(playerHits(ctx).length, 1);
});

test('위협 간격 H1(팩 1.2초) · H2(속박 잠금) · H3(감옥 — 발밑 예고 중) · H4(겹침 상한 6 · count) · 기절한 출처', () => {
  const { state, ctx, p } = setup();
  const rift = state.rift;
  rift.packs.push({ id: 1, kind: 'elite', memberIds: [], awake: true, nextHazardAt: -1, fled: false, anchor: { x: 0, z: 0 } });
  rift.packs.push({ id: 2, kind: 'champion', memberIds: [], awake: true, nextHazardAt: -1, fled: false, anchor: { x: 0, z: 0 } });
  const px = p.pos.x, pz = p.pos.z;
  // H1
  assert.equal(canStartHazard(ctx, 1, px, pz), true);
  noteHazard(ctx, 1);
  assert.equal(canStartHazard(ctx, 1, px, pz), false);
  assert.equal(canStartHazard(ctx, 2, px, pz), true, '다른 팩');
  state.tick += ticks(HAZARD.packGap);
  assert.equal(canStartHazard(ctx, 1, px, pz), true, '간격 뒤');
  // H2
  rift.rootLockUntil = state.tick + 10;
  assert.equal(canStartHazard(ctx, 2, px, pz), false, '속박 잠금 — 발밑');
  assert.equal(canStartHazard(ctx, 2, px + 8, pz), true, '멀리는 된다');
  rift.rootLockUntil = -1;
  // H3
  spawnEffect(ctx, { kind: 'plague', owner: 'mon', srcId: -1, packId: 2, hostile: true, shape: circle(px, pz, 2), delay: 1.0, spec: null, tickSpec: monSpec(1) });
  assert.equal(canStartHazard(ctx, 1, px, pz, { jail: true }), false, '발밑 예고 중 감옥 없음');
  assert.equal(canStartHazard(ctx, 1, px, pz), true, '감옥이 아니면 된다');
  // H4: 진행 중 근처 예고 5 + 새 1 = 6 → 된다 · count 3 → 넘는다
  for (let i = 0; i < 4; i++) spawnEffect(ctx, { kind: 'mortar', owner: 'mon', srcId: -1, packId: 2, hostile: true, shape: circle(px + 1, pz, 1.5), delay: 1.2, spec: monSpec(1) });
  assert.equal(canStartHazard(ctx, 1, px, pz), true);
  assert.equal(canStartHazard(ctx, 1, px, pz, { count: 3 }), false);
  assert.equal(canStartHazard(ctx, 1, px + 9, pz, { count: 3 }), true, '플레이어에서 먼 위협은 겹침 수에 들지 않는다');
  // 기절 · 빙결한 출처
  const m = addTestMonster(ctx, { x: px + 5, z: pz });
  m.st.stunUntil = state.tick + 5;
  assert.equal(canStartHazard(ctx, -1, px + 9, pz, { srcId: m.id }), false);
  m.st.stunUntil = -1;
  m.st.freezeUntil = state.tick + 5;
  assert.equal(canStartHazard(ctx, -1, px + 9, pz, { srcId: m.id }), false);
});

/**
 * 감옥 + 역병 + 몰타르를 매 틱 시도(훅은 데이터 행의 first · every · delay · r · escape 로 흉내 · 막히면 다음 틱에 다시 · 훅 순서는 틱마다 돌린다).
 * 플레이어는 서서 다 맞는다(최악) — 판정마다 「예고가 시작된 뒤 반응 0.25초 · 묶인 시간을 빼고 남은 시간 × 3.6m/s ≥ escape」인지 본다.
 * 하나라도 모자라면 「묶인 채 맞는」(걸어서 피할 수 없는) 판정이다.
 * @param {{bypass?:boolean, crossPack?:boolean, secs?:number, speedUp?:number}} o
 */
function hazardChain({ bypass = false, crossPack = false, secs = 180, speedUp = 1 } = {}) {
  const { state, ctx, p } = setup();
  const rift = state.rift;
  const jail = getMonAffix('jailer').params, plague = getMonAffix('plague').params, mortar = getMonAffix('mortar').params;
  const packA = 11, packB = crossPack ? 12 : 11;
  rift.packs.push({ id: 11, kind: 'elite', memberIds: [], awake: true, nextHazardAt: -1, fled: false, anchor: { x: 0, z: 0 } });
  if (crossPack) rift.packs.push({ id: 12, kind: 'champion', memberIds: [], awake: true, nextHazardAt: -1, fled: false, anchor: { x: 0, z: 0 } });
  const m = addTestMonster(ctx, { x: p.pos.x + 7, z: p.pos.z });
  const hooks = [
    { kind: 'jail', pack: packA, first: jail.first, every: jail.every, opts: { jail: true }, make: (x, z) => [{ shape: circle(x, z, jail.r), delay: jail.delay, spec: monSpec(0, { srcId: m.id, onHit: { rootSec: jail.rootSec } }), escape: jail.escape, dmg: false }] },
    { kind: 'plague', pack: packB, first: plague.first, every: plague.every, opts: {}, make: (x, z) => [{ shape: circle(x, z, plague.r), delay: plague.delay, dur: plague.dur, tick: plague.tick, spec: null, tickSpec: monSpec(2, { srcId: m.id }), escape: plague.escape, dmg: true }] },
    { kind: 'mortar', pack: packB, first: mortar.first, every: mortar.every, opts: { count: mortar.n }, make: (x, z) => [[0, 0], [mortar.spread, 0], [-1.4, 1.4]].map(([dx, dz]) => ({ shape: circle(x + dx, z + dz, mortar.r), delay: mortar.delay, spec: monSpec(3, { srcId: m.id }), escape: mortar.escape, dmg: true })) },
  ];
  const nextAt = hooks.map(h => state.tick + ticks(h.first / speedUp));
  /** @type {Array<{start:number, hitAt:number, escape:number}>} */
  const dangerous = [];
  const rooted = new Set();
  for (let t = 0; t < secs * 30; t++) {
    state.tick += 1;
    // 「몬스터 단계」— 훅이 위협을 시도한다(순서를 틱마다 돌린다)
    for (let k = 0; k < hooks.length; k++) {
      const i = (k + state.tick) % hooks.length;
      const h = hooks[i];
      if (state.tick < nextAt[i]) continue;
      const x = p.pos.x, z = p.pos.z;
      if (!bypass && !canStartHazard(ctx, h.pack, x, z, { ...h.opts, srcId: m.id })) continue;
      for (const d of h.make(x, z)) {
        const e = spawnEffect(ctx, { kind: h.kind, owner: 'mon', srcId: m.id, packId: h.pack, hostile: true, ...d });
        if (d.dmg) dangerous.push({ start: e.start, hitAt: e.hitAt, escape: d.escape });
      }
      noteHazard(ctx, h.pack);
      nextAt[i] = state.tick + ticks(h.every / speedUp);
    }
    updateEffects(ctx);
    updateStatus(ctx);
    if (state.tick < p.st.rootUntil) rooted.add(state.tick);
    removeMarked(ctx);
  }
  const react = ticks(HAZARD.react);
  let bad = 0;
  for (const d of dangerous) {
    let free = 0;
    for (let t = d.start + react; t < d.hitAt; t++) if (!rooted.has(t)) free++;
    if ((free / 30) * HAZARD.slowSpeed + 1e-9 < d.escape) bad++;
  }
  return { bad, dangerous: dangerous.length, rootedTicks: rooted.size };
}

test('감옥 + 역병 + 몰타르(같은 정예) 동시 시도 → 묶인 채 맞는 판정 0(H1 · H2 · H3) — 규칙을 끄면 생긴다(검사기가 실제로 잡는다)', () => {
  for (const speedUp of [1, 1.5]) {
    const ok = hazardChain({ speedUp });
    assert.ok(ok.rootedTicks > 0, '감옥이 실제로 묶었다');
    assert.ok(ok.dangerous >= 20, `피해 위협 ${ok.dangerous}`);
    assert.equal(ok.bad, 0, `주기 × ${speedUp}`);
  }
  const control = hazardChain({ bypass: true });
  assert.ok(control.bad > 0, '규칙 없이 같은 시도를 하면 묶인 채 맞는다');
});

test('다른 팩이 감옥 예고 위에 표식을 겹쳐도 묶인 채 맞는 판정 0(H2 — 묶는 예고 진행 중 · 판정 틱 · 속박 잠금)', () => {
  for (const speedUp of [1, 1.5]) {
    const r = hazardChain({ crossPack: true, speedUp });
    assert.ok(r.rootedTicks > 0 && r.dangerous >= 20);
    assert.equal(r.bad, 0, `주기 × ${speedUp}`);
  }
  assert.ok(hazardChain({ crossPack: true, bypass: true }).bad > 0);
});

// ───────────────────────── 투사체 ─────────────────────────

test('플레이어 투사체: 선분 전체로 겹침(빠른 화살이 몸을 건너뛰지 않는다) · 첫 몬스터에 적중 · PROJ_END hit · 수명 L틱이면 L번 움직인다', () => {
  const { state, ctx, p } = setup();
  const m = addTestMonster(ctx, { x: p.pos.x, z: p.pos.z + 6, hp: 1e6 });
  const hp0 = m.hp;
  spawnProjectile(ctx, { visual: 'magicBolt', owner: 'player', srcId: -1, x: p.pos.x, z: p.pos.z, facing: 0, speed: 60, range: 15, r: 0.1, spec: pSpec(ctx, { type: 'lightning', tags: ['projectile'] }) });
  for (let i = 0; i < 20; i++) tickWorld(ctx);
  assert.ok(m.hp < hp0);
  assert.equal(countEvents(ctx.events, EV.HIT), 1);
  const end = ctx.events.find(e => e.name === EV.PROJ_END);
  assert.equal(end.payload.reason, 'hit');
  // 수명: 22 m/s · 15m → 20틱 → 20번 움직여 14.67m
  const pr = spawnProjectile(ctx, { visual: 'magicBolt', owner: 'player', srcId: -1, x: 6, z: 21, facing: Math.PI / 2, speed: 22, range: 15, r: 0.25, spec: pSpec(ctx) });
  const life = pr.until - pr.born;
  // 게임에서는 스킬 판정(§5.1-4)이 쏜 그 틱의 6단계에서 첫 이동을 한다
  let moves = 0, last = pr.pos.x;
  updateProjectiles(ctx);
  if (pr.pos.x !== last) { moves++; last = pr.pos.x; }
  for (let i = 0; i < 40; i++) {
    tickWorld(ctx);
    if (pr.pos.x !== last) { moves++; last = pr.pos.x; }
  }
  assert.equal(moves, life);
  assert.ok(Math.abs(pr.pos.x - 6 - 22 * life / 30) < 1e-6);
  assert.equal(ctx.events.filter(e => e.name === EV.PROJ_END).at(-1).payload.reason, 'expire');
});

test('벽에 닿으면 끝(PROJ_END wall · 걷기 가능한 자리) · bounce 면 튕겨서 계속', () => {
  const { state, ctx, p } = setup();
  const a = spawnProjectile(ctx, { visual: 'arrow', owner: 'player', srcId: -1, x: 38, z: 21, facing: Math.PI / 2, speed: 16, range: 20, r: 0.2, spec: pSpec(ctx) });
  for (let i = 0; i < 20; i++) tickWorld(ctx);
  const end = ctx.events.find(e => e.name === EV.PROJ_END && e.payload.id === a.id);
  assert.equal(end.payload.reason, 'wall');
  assert.ok(isWalkable(ctx.map, end.payload.x, end.payload.z));
  const b = spawnProjectile(ctx, { visual: 'spark', owner: 'mon', srcId: -1, x: 39, z: 30, facing: Math.PI / 2, speed: 6, life: 2, r: 0.35, bounce: true, spec: monSpec(1) });
  for (let i = 0; i < 30; i++) tickWorld(ctx);
  assert.ok(b.vel.x < 0, '튕겼다');
  assert.equal(ctx.events.some(e => e.name === EV.PROJ_END && e.payload.id === b.id && e.payload.reason === 'wall'), false);
  assert.ok(state.tick > 0 && p);
});

test('관통: pierce n 이면 n + 1 마리까지 한 번씩 · 같은 몬스터를 두 번 맞히지 않는다', () => {
  const { ctx, p } = setup();
  const ms = [4, 6, 8, 10].map(d => addTestMonster(ctx, { x: p.pos.x, z: p.pos.z + d, hp: 1e6 }));
  spawnProjectile(ctx, { visual: 'iceShard', owner: 'player', srcId: -1, x: p.pos.x, z: p.pos.z, facing: 0, speed: 16, range: 14, r: 0.25, pierce: 2, spec: pSpec(ctx, { type: 'cold' }) });
  for (let i = 0; i < 40; i++) tickWorld(ctx);
  const hit = ms.map(m => m.hp < 1e6);
  assert.deepEqual(hit, [true, true, true, false]);
  assert.equal(countEvents(ctx.events, EV.HIT), 3);
});

test('W1 통합: 관통이 남은 폭발 투사체(꿰뚫는 화염)는 접촉마다 폭발하고 pierce + 1 번째 접촉에서 끝난다', () => {
  const { ctx, p } = setup();
  const ms = [4, 10, 16, 22].map(d => addTestMonster(ctx, { x: p.pos.x, z: p.pos.z + d, hp: 1e6 }));
  const ex = { r: 2.5, spec: pSpec(ctx, { coef: 1.7, tags: ['projectile', 'aoe'] }), visual: 'fireballBlast' };
  spawnProjectile(ctx, { visual: 'fireball', owner: 'player', srcId: -1, x: p.pos.x, z: p.pos.z, facing: 0, speed: 18, range: 30, r: 0.35, pierce: 2, spec: ex.spec, explode: ex });
  for (let i = 0; i < 60; i++) tickWorld(ctx);
  assert.deepEqual(ms.map(m => m.hp < 1e6), [true, true, true, false]);
  assert.equal(ctx.events.filter(e => e.name === EV.EFFECT_HIT && e.payload.kind === 'fireballBlast').length, 3);
  assert.equal(countEvents(ctx.events, EV.HIT), 3, '접촉한 몬스터는 폭발로만 한 번');
  assert.equal(ctx.events.filter(e => e.name === EV.PROJ_END).at(-1).payload.reason, 'hit');
});

test('폭발(화염구): 첫 접촉에서 폭발만 — 접촉한 몬스터도 폭발 원 안에서 한 번만 맞는다 · 사거리 끝에서도 폭발', () => {
  const { ctx, p } = setup();
  const a = addTestMonster(ctx, { x: p.pos.x, z: p.pos.z + 5, hp: 1e6 });
  const b = addTestMonster(ctx, { x: p.pos.x + 1.5, z: p.pos.z + 6, hp: 1e6 });
  const c = addTestMonster(ctx, { x: p.pos.x + 6, z: p.pos.z + 6, hp: 1e6 });
  const ex = { r: 2.5, spec: pSpec(ctx, { coef: 1.7, tags: ['projectile', 'aoe'] }), visual: 'fireballBlast' };
  spawnProjectile(ctx, { visual: 'fireball', owner: 'player', srcId: -1, x: p.pos.x, z: p.pos.z, facing: 0, speed: 18, range: 16, r: 0.35, spec: ex.spec, explode: ex });
  for (let i = 0; i < 20; i++) tickWorld(ctx);
  const hits = ctx.events.filter(e => e.name === EV.HIT).map(e => e.payload.targetId);
  assert.deepEqual(hits.sort(), [a.id, b.id].sort(), '접촉 · 근처 한 번씩 · 먼 것 없음');
  assert.equal(c.hp, 1e6);
  assert.ok(ctx.events.some(e => e.name === EV.EFFECT_HIT && e.payload.kind === 'fireballBlast' && e.payload.targets === 2));
  // 사거리 끝
  const before = ctx.events.length;
  spawnProjectile(ctx, { visual: 'fireball', owner: 'player', srcId: -1, x: 6, z: 38, facing: Math.PI / 2, speed: 18, range: 5, r: 0.35, spec: ex.spec, explode: ex });
  for (let i = 0; i < 20; i++) tickWorld(ctx);
  const tail = ctx.events.slice(before);
  assert.ok(tail.some(e => e.name === EV.PROJ_END && e.payload.reason === 'expire'));
  assert.ok(tail.some(e => e.name === EV.EFFECT_HIT && e.payload.kind === 'fireballBlast'));
});

test('몬스터 투사체: 출처가 살아 있으면 monsterHitPlayer(속성 onHitPlayer) · 죽었으면 hazardHitPlayer · 도착 보호 중이면 지나간다', () => {
  const calls = [];
  const { state, ctx, p } = setup({ hooks: { onMonHitPlayer: (c, mon) => calls.push(mon.id) } });
  const m = addTestMonster(ctx, { typeId: 'skeletonArcher', x: p.pos.x, z: p.pos.z + 8 });
  const shoot = () => spawnProjectile(ctx, { visual: 'arrow', owner: 'mon', srcId: m.id, x: m.pos.x, z: m.pos.z, facing: Math.PI, speed: 16, life: 1.2, r: 0.2, spec: monSpec(4, { srcId: m.id, via: 'projectile' }) });
  shoot();
  for (let i = 0; i < 20; i++) tickWorld(ctx);
  assert.deepEqual(calls, [m.id]);
  assert.equal(playerHits(ctx).length, 1);
  m.dead = true;
  shoot();
  for (let i = 0; i < 20; i++) tickWorld(ctx);
  assert.equal(calls.length, 1, '죽은 출처 — 속성 훅 없음');
  assert.equal(playerHits(ctx).length, 2);
  m.dead = false;
  p.protectUntil = state.tick + 100;
  const pr = shoot();
  for (let i = 0; i < 20; i++) tickWorld(ctx);
  assert.equal(playerHits(ctx).length, 2);
  assert.notEqual(ctx.events.find(e => e.name === EV.PROJ_END && e.payload.id === pr.id)?.payload.reason, 'hit', '보호 중에는 지나간다');
});
