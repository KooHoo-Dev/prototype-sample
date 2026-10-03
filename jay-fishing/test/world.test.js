// OWNER: P3 — 계약 §12.2(world) · §7.2b · §5.6(집 도착 순서)
// 걷기(볼록 다각형 · 벽 미끄러짐 · obstacles) · 상호작용(반경 · 시선) · 자리 진입(enterSpotId) · 이동 게이트 · 집 도착 처리의 순서.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT } from '../src/core/constants.js';
import { EV, EventBus } from '../src/core/events.js';
import { makeInput } from '../src/core/inputFrame.js';
import { pointInConvex } from '../src/core/math.js';
import { WORLD } from '../src/data/world.js';
import { FREE_BAIT } from '../src/data/economy.js';
import { getSpot, getStage } from '../src/data/stages/index.js';
import { findNearby, homeArrival, placePlayer, updateWalk } from '../src/sim/world.js';
import { GameSim } from '../src/sim/GameSim.js';
import { makeTestCtx, makeTestProfile, makeTestState, runTicks } from './helpers.js';

/** 걷기 상태 · 문맥 — 그 씬의 (x, z)에 yaw 로 선다 */
function walker(scene, x, z, yaw) {
  const state = makeTestState({ scene, mode: 'walk' });
  const ctx = makeTestCtx(state);
  state.player.pos = { x, z };
  state.player.prevPos = { x, z };
  state.player.yaw = yaw;
  return { state, ctx };
}

/** n틱 걷기(시선 고정) — 매 틱 walk 안 · 장애물 밖을 검사 */
function walk(ctx, n, partial) {
  const stage = ctx.stage;
  const input = makeInput({ yaw: ctx.state.player.yaw, ...partial });
  runTicks(n, () => {
    const p = ctx.state.player;
    p.prevPos = { x: p.pos.x, z: p.pos.z };
    updateWalk(ctx, input);
    assert.ok(pointInConvex(stage.walk, p.pos.x, p.pos.z), `walk 밖: ${p.pos.x}, ${p.pos.z}`);
    for (const o of stage.obstacles) assert.ok(Math.hypot(p.pos.x - o.x, p.pos.z - o.z) >= o.r - 1e-9, '장애물 안');
    assert.ok(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z) && Number.isFinite(p.speed));
  });
}

test('걷기 속도: 앞 walkSpeed · 뒤 × backMul · 옆 × strafeMul · 대각선 정규화 · accel 로 다가간다', () => {
  const { state, ctx } = walker('lake', 0, 20, 0);
  updateWalk(ctx, makeInput({ moveZ: 1 }));
  assert.ok(Math.abs(state.player.speed - WORLD.accel * DT) < 1e-9, '첫 틱은 accel × DT');
  walk(ctx, 60, { moveZ: 1 });
  assert.ok(Math.abs(state.player.speed - WORLD.walkSpeed) < 1e-9);
  // yaw 0 → −Z 로 간다
  assert.ok(state.player.pos.z < 20 - 2);
  assert.ok(Math.abs(state.player.pos.x) < 1e-9);

  const b = walker('lake', 0, 20, 0);
  walk(b.ctx, 60, { moveZ: -1 });
  assert.ok(Math.abs(b.state.player.speed - WORLD.walkSpeed * WORLD.backMul) < 1e-9);
  assert.ok(b.state.player.pos.z > 20);

  const r = walker('lake', 0, 20, 0);
  walk(r.ctx, 60, { moveX: 1 });
  assert.ok(Math.abs(r.state.player.speed - WORLD.walkSpeed * WORLD.strafeMul) < 1e-9);
  assert.ok(r.state.player.pos.x > 0, '오른쪽 = +X(yaw 0)');

  const d = walker('lake', 0, 20, 0);
  walk(d.ctx, 60, { moveX: 1, moveZ: 1 });
  assert.ok(d.state.player.speed <= WORLD.walkSpeed + 1e-9, '대각선이 빠르지 않다');

  // 멈출 때도 같은 가속
  walk(ctx, 1, {});
  assert.ok(Math.abs(state.player.speed - (WORLD.walkSpeed - WORLD.accel * DT)) < 1e-9);
  walk(ctx, 30, {});
  assert.equal(state.player.speed, 0);

  // 이상한 입력(NaN · 범위 밖)은 유한하게
  const n = walker('lake', 0, 20, 0);
  walk(n.ctx, 30, { moveX: NaN, moveZ: 7 });
  assert.ok(n.state.player.speed <= WORLD.walkSpeed + 1e-9);
});

test('볼록 충돌: 벽을 따라 미끄러진다 · 모서리 · 밖에서 시작하면 안으로', () => {
  // 호수 물가 벽(z = 1.4)으로 비스듬히(앞 = (−sin, −cos), yaw π/4 → −X · −Z)
  const { state, ctx } = walker('lake', 10, 3, Math.PI / 4);
  walk(ctx, 240, { moveZ: 1 });
  assert.ok(Math.abs(state.player.pos.z - 1.4) < 1e-6, `벽에 붙는다: ${state.player.pos.z}`);
  assert.ok(state.player.pos.x < 10 - 5, `x 로 미끄러진다: ${state.player.pos.x}`);
  assert.ok(state.player.speed > 0.5, '미끄러지는 동안 움직인다');

  // 모서리(−50, 1.4)로
  const c = walker('lake', -45, 5, Math.PI / 4);
  walk(c.ctx, 600, { moveZ: 1 });
  assert.ok(Math.abs(c.state.player.pos.x + 50) < 1e-6 && Math.abs(c.state.player.pos.z - 1.4) < 1e-6);
  assert.equal(c.state.player.speed, 0);

  // 집 벽
  const h = walker('home', 0, 0, Math.PI / 2);   // −X 로
  walk(h.ctx, 240, { moveZ: 1 });
  assert.ok(Math.abs(h.state.player.pos.x + 3.1) < 1e-6);

  // 밖에서 시작(잘못된 배치) → 첫 틱에 경계 안으로
  const o = walker('lake', 0, -5, 0);
  walk(o.ctx, 1, {});
  assert.ok(pointInConvex(getStage('lake').walk, o.state.player.pos.x, o.state.player.pos.z));
});

test('obstacles: 원 안으로 들어가지 않는다(둘레로 밀려 돌아간다)', () => {
  // 판매상 좌판(14, 10 r 1.2)으로 정면 돌진
  const { state, ctx } = walker('lake', 14, 14, 0);
  walk(ctx, 240, { moveZ: 1 });
  assert.ok(Math.hypot(state.player.pos.x - 14, state.player.pos.z - 10) >= 1.2 - 1e-9);
  // 살짝 비켜 가면 둘레를 타고 지나간다
  const s = walker('lake', 14.3, 14, 0);
  walk(s.ctx, 400, { moveZ: 1 });
  assert.ok(s.state.player.pos.z < 10 - 1.2, `지나갔다: ${s.state.player.pos.z}`);
  // 집 침대
  const b = walker('home', 2.3, -1, Math.PI);   // +Z 로
  walk(b.ctx, 240, { moveZ: 1 });
  assert.ok(Math.hypot(b.state.player.pos.x - 2.3, b.state.player.pos.z - 1.7) >= 0.85 - 1e-9);
});

test('상호작용: 반경 · 시선(interactFov) · 가장 가까운 것 · E → INTERACT', () => {
  const home = getStage('home');
  const pc = home.points.find(p => p.id === 'pc');
  // approach 에서 PC 쪽(−Z)을 본다
  const { state, ctx } = walker('home', pc.approach.x, pc.approach.z, 0);
  updateWalk(ctx, makeInput({ yaw: 0 }));
  assert.deepEqual({ kind: state.player.nearby.kind, id: state.player.nearby.id }, { kind: 'pc', id: 'pc' });
  assert.ok(Math.abs(state.player.nearby.dist - Math.hypot(pc.x - pc.approach.x, pc.z - pc.approach.z)) < 0.05);
  // 시선 밖(뒤를 본다) → 없음
  state.player.yaw = Math.PI;
  updateWalk(ctx, makeInput({}));
  assert.equal(state.player.nearby, null);
  // 시선 경계: interactFov 안쪽은 되고 바깥은 안 된다
  state.player.yaw = WORLD.interactFov - 0.01;
  assert.equal(findNearby(state, home)?.id, 'pc');
  state.player.yaw = WORLD.interactFov + 0.01;
  assert.equal(findNearby(state, home), null);
  // 반경 밖
  state.player.pos = { x: 0, z: 1.2 };
  state.player.yaw = 0;
  assert.equal(findNearby(state, home), null);
  // E 에지 → INTERACT{kind, id} · 자리 진입 아님
  state.player.pos = { x: pc.approach.x, z: pc.approach.z };
  ctx.events.length = 0;
  const r = updateWalk(ctx, makeInput({ yaw: 0, interact: true }));
  assert.deepEqual(r, { enterSpotId: null });
  assert.deepEqual(ctx.events.filter(e => e.name === EV.INTERACT).map(e => e.payload), [{ kind: 'pc', id: 'pc' }]);
  // 대상이 없으면 E 는 아무것도 하지 않는다
  state.player.yaw = Math.PI;
  ctx.events.length = 0;
  updateWalk(ctx, makeInput({ yaw: Math.PI, interact: true }));
  assert.equal(ctx.events.filter(e => e.name === EV.INTERACT).length, 0);
  // 모든 상호작용 점은 approach 에서 그 점을 보면 잡힌다(봇이 걸어가는 목표)
  for (const id of ['home', 'lake']) {
    const st = getStage(id);
    for (const p of st.points) {
      const w = walker(id, p.approach.x, p.approach.z, Math.atan2(-(p.x - p.approach.x), -(p.z - p.approach.z)));
      assert.equal(findNearby(w.state, st)?.id, p.id, `${id}.${p.id}`);
    }
  }
  // 낚시 모드면 대상이 없다
  const f = walker('home', pc.approach.x, pc.approach.z, 0);
  f.state.player.mode = 'fish';
  assert.equal(findNearby(f.state, home), null);
});

test('상호작용(리뷰 수정): 문 쪽 벽에 몸을 붙여도 「문」이 잡힌다(시선이 점 뒤 interactDepthM 을 향한다) · 등을 돌리면 없음', () => {
  const home = getStage('home');
  const door = home.points.find(p => p.id === 'door');
  for (const x0 of [0.3, -0.5, 0.7]) {
    const { state, ctx } = walker('home', x0, door.approach.z, Math.PI);   // +Z(문 쪽)를 보고 걷는다
    let seen = false;
    for (let i = 0; i < 90; i++) {
      walk(ctx, 1, { moveZ: 1 });
      const p = state.player;
      if (Math.hypot(p.pos.x - door.x, p.pos.z - door.z) <= door.radius - 0.2) {
        assert.equal(p.nearby?.id, 'door', `x0 ${x0}: (${p.pos.x.toFixed(3)}, ${p.pos.z.toFixed(3)})에서 문 프롬프트가 사라졌다`);
        seen = true;
      }
    }
    assert.ok(seen);
    assert.ok(state.player.pos.z > door.z - 0.01, '벽에 붙었다');
    ctx.events.length = 0;
    updateWalk(ctx, makeInput({ yaw: Math.PI, interact: true }));
    assert.deepEqual(ctx.events.filter(e => e.name === EV.INTERACT).map(e => e.payload), [{ kind: 'door', id: 'door' }]);
    // 벽에 붙은 채 등을 돌리면(방 안을 본다) 잡히지 않는다
    state.player.yaw = 0;
    assert.equal(findNearby(state, home), null);
  }
});

test('자리 진입: spotRadius 안의 자리가 먼저 · E 면 updateWalk 가 enterSpotId 를 돌려준다(INTERACT 없음)', () => {
  const spot = getSpot('lake_gravel');
  const { state, ctx } = walker('lake', spot.stand.x, spot.stand.z + 1.0, Math.PI);   // 자리를 등지고 있어도
  updateWalk(ctx, makeInput({ yaw: Math.PI }));
  assert.deepEqual({ kind: state.player.nearby.kind, id: state.player.nearby.id }, { kind: 'spot', id: 'lake_gravel' });
  ctx.events.length = 0;
  const r = updateWalk(ctx, makeInput({ yaw: Math.PI, interact: true }));
  assert.deepEqual(r, { enterSpotId: 'lake_gravel' });
  assert.equal(ctx.events.length, 0);
  assert.equal(state.player.mode, 'walk', 'world 는 rig 를 모른다 — 진입은 GameSim 이');
  // 반경 밖
  state.player.pos = { x: spot.stand.x, z: spot.stand.z + WORLD.spotRadius + 0.2 };
  assert.equal(findNearby(state, getStage('lake')), null);
  // 자리와 상호작용 점이 같이 닿으면 자리가 먼저
  const stage = {
    walk: [{ x: -5, z: -5 }, { x: 5, z: -5 }, { x: 5, z: 5 }, { x: -5, z: 5 }],
    spots: [{ id: 'x_spot', stand: { x: 0, z: 1 } }],
    points: [{ kind: 'npc', id: 'vendor', x: 0, z: -0.3, radius: 2, yaw: 0, approach: { x: 0, z: 0 } }],
    obstacles: [],
  };
  const t = walker('lake', 0, 0, 0);
  assert.equal(findNearby(t.state, stage).kind, 'spot');
  // GameSim.step 이 enterSpotId 로 enterSpot 을 부른다
  const bus = new EventBus();
  const seen = [];
  bus.onAny(n => seen.push(n));
  const sim = new GameSim({ bus, seed: 1, start: { scene: 'lake', hour: 8 }, session: { ignoreGates: true, devSession: true } });
  sim.start();
  placePlayer(sim.ctx, { x: spot.stand.x, z: spot.stand.z + 1 }, 0, 0, 'debug');
  sim.step(makeInput({ yaw: 0 }));
  seen.length = 0;
  sim.step(makeInput({ yaw: 0, interact: true }));
  assert.equal(sim.state.player.mode, 'fish');
  assert.equal(sim.state.player.spotId, 'lake_gravel');
  assert.equal(sim.ctx.spot.id, 'lake_gravel');
  assert.ok(seen.includes(EV.FISHING_ENTER));
  assert.equal(seen.includes(EV.INTERACT), false);
});

function makeSim(opts = {}) {
  const bus = new EventBus();
  const log = [];
  bus.onAny((name, payload) => log.push({ name, payload }));
  const sim = new GameSim({ bus, seed: 7, ...opts });
  sim.start();
  log.length = 0;
  return { sim, bus, log };
}

test('이동 게이트: 잠김 {locked, params:{n}} · 야외 → 야외 notHere · 같은 씬 same · 낚시 중 busy · ignoreGates', () => {
  const { sim } = makeSim();
  assert.equal(sim.state.scene, 'home');
  assert.deepEqual(sim.travel('coast'), { ok: false, reason: 'locked', params: { n: 5 } });
  assert.deepEqual(sim.travel('river'), { ok: false, reason: 'locked', params: { n: 10 } });
  assert.deepEqual(sim.travel('home'), { ok: false, reason: 'same' });
  assert.deepEqual(sim.travel('mars'), { ok: false, reason: 'invalid' });
  assert.equal(sim.state.scene, 'home');
  const tr = sim.getTravel();
  assert.deepEqual(tr.map(t => t.id), ['lake', 'coast', 'river']);
  assert.deepEqual(tr.map(t => t.ok), [true, false, false]);
  assert.deepEqual(tr[1].reasonParams, { n: 5 });
  assert.equal(tr[1].reason, 'locked');
  assert.equal(tr[0].unlockLevel, 1);
  assert.equal(tr[0].weather, sim.state.weather.today.lake);
  assert.equal(sim.travel('lake').ok, true);
  assert.equal(sim.state.scene, 'lake');
  assert.equal(sim.ctx.stage.id, 'lake');
  // 야외 → 다른 야외는 집을 거친다(레벨이 되어도)
  sim.state.profile.level = 20;
  assert.deepEqual(sim.travel('coast'), { ok: false, reason: 'notHere' });
  assert.deepEqual(sim.travel('river'), { ok: false, reason: 'notHere' });
  assert.deepEqual(sim.getTravel().map(t => [t.id, t.ok, t.weather]), [['home', true, null]]);
  // 낚시 중 busy
  sim.debugGotoSpot('lake_gravel');
  assert.deepEqual(sim.travel('home'), { ok: false, reason: 'busy' });
  assert.deepEqual(sim.waitNextBand(), { ok: false, reason: 'busy' });
  assert.equal(sim.getTravel()[0].ok, false);
  sim.exitFishing();
  assert.equal(sim.travel('home').ok, true);
  assert.equal(sim.travel('coast').ok, true, '레벨 20이면 집에서 갯바위');
  // 개발 세션은 게이트를 무시한다
  const d = makeSim({ session: { ignoreGates: true, devSession: true } });
  assert.equal(d.sim.travel('river').ok, true);
  assert.equal(d.sim.state.scene, 'river');
});

test('이동: 씬 교체 · spawn 배치 · 이벤트(SCENE_CHANGED{travel} → PLAYER_PLACED{spawn} → … → SAVE_REQUEST{scene})', () => {
  const { sim, log } = makeSim();
  sim.travel('lake');
  const lake = getStage('lake');
  assert.deepEqual(sim.state.player.pos, { x: lake.spawn.x, z: lake.spawn.z });
  assert.equal(sim.state.player.yaw, lake.spawn.yaw);
  assert.equal(sim.state.player.mode, 'walk');
  const n = log.map(e => e.name);
  assert.equal(n[0], EV.SCENE_CHANGED);
  assert.deepEqual(log[0].payload, { from: 'home', to: 'lake', reason: 'travel' });
  assert.equal(n[1], EV.PLAYER_PLACED);
  assert.equal(log[1].payload.reason, 'spawn');
  assert.ok(n.includes(EV.CLOCK_SKIP));
  assert.equal(n[n.length - 1], EV.SAVE_REQUEST);
  assert.deepEqual(log[log.length - 1].payload, { reason: 'scene' });
  assert.equal(sim.state.weather.current, sim.state.weather.today.lake);
});

/** 집 도착 처리의 P4 함수를 계약 의미대로 흉내 내는 가짜로 바꿔 끼운다(P4 를 기다리지 않는다) */
function withFakeArrival(fn) {
  const orig = { ...homeArrival };
  const calls = [];
  homeArrival.sellAll = (ctx, opts) => {
    calls.push(['sellAll', opts]);
    const p = ctx.state.profile;
    const total = p.hold.reduce((a, c) => a + c.price, 0);
    p.money += total;
    p.hold = [];
    ctx.emit('test/sold', { total });
    ctx.refresh();
    return { ok: true, count: 1, total };
  };
  homeArrival.refillLine = (ctx, set, lineId, opts) => {
    calls.push(['refillLine', set, lineId, opts]);
    ctx.state.profile.sets[set].lineM = 120;
    ctx.emit('test/refill', { set });
    ctx.refresh();
    return { ok: true, cost: 0, meters: 1 };
  };
  homeArrival.grantFreeBaitIfNeeded = (ctx) => {
    const p = ctx.state.profile;
    const none = Object.values(p.baits).every(v => !v);
    const granted = p.money < FREE_BAIT.moneyBelow && none ? FREE_BAIT.count : 0;
    calls.push(['grant', granted]);
    if (granted) p.baits[FREE_BAIT.baitId] = granted;
    ctx.emit('test/grant', { granted });
    ctx.refresh();
    return { granted };
  };
  try {
    fn(calls);
  } finally {
    Object.assign(homeArrival, orig);
  }
}

test('집 도착 처리 순서: 자동 판매 → line_1 무료 감기 → 무료 미끼 → SAVE_REQUEST{scene} · 팔 물고기가 있으면 무료 미끼 없음', () => {
  withFakeArrival((calls) => {
    const profile = makeTestProfile({
      money: 0,
      baits: { worm: 0, paste: 0, corn: 0, shrimp: 0, krill: 0, live: 0 },
      hold: [{ uid: 1, speciesId: 'crucian', price: 5000 }],
    });
    profile.sets.float.lineM = 40;
    profile.sets.bottom.lineId = 'line_2';
    profile.sets.bottom.lineM = 40;
    const { sim, log } = makeSim({ profile, start: { scene: 'lake', hour: 10 } });
    assert.equal(sim.travel('home').ok, true);
    assert.deepEqual(calls, [
      ['sellAll', { auto: true }],
      ['refillLine', 'float', 'line_1', { free: true }],   // line_2 세트는 감지 않는다
      ['grant', 0],                                         // 판매 뒤의 돈(5000)으로 판정 → 주지 않는다
    ]);
    assert.equal(sim.state.profile.baits.worm, 0);
    assert.equal(sim.state.profile.money, 5000);
    const n = log.map(e => e.name);
    const iSold = n.indexOf('test/sold');
    const iRefill = n.indexOf('test/refill');
    const iGrant = n.indexOf('test/grant');
    const iSave = n.lastIndexOf(EV.SAVE_REQUEST);
    assert.ok(iSold > n.indexOf(EV.SCENE_CHANGED) && iSold < iRefill && iRefill < iGrant && iGrant < iSave, n.join(' '));
    assert.deepEqual(log[iSave].payload, { reason: 'scene' });
    assert.equal(n.filter(x => x === EV.SAVE_REQUEST).length, 1);
  });
  // 팔 것이 없고 돈 · 미끼가 없으면 무료 미끼 · 라인이 가득이면 감지 않는다
  withFakeArrival((calls) => {
    const profile = makeTestProfile({ money: 0, baits: { worm: 0, paste: 0, corn: 0, shrimp: 0, krill: 0, live: 0 } });
    const { sim } = makeSim({ profile, start: { scene: 'lake', hour: 10 } });
    sim.travel('home');
    assert.deepEqual(calls, [['grant', FREE_BAIT.count]]);
    assert.equal(sim.state.profile.baits.worm, FREE_BAIT.count);
  });
  // 야외 도착에는 집 처리가 없다
  withFakeArrival((calls) => {
    const { sim, log } = makeSim();
    sim.travel('lake');
    assert.deepEqual(calls, []);
    assert.deepEqual(log.filter(e => e.name === EV.SAVE_REQUEST).map(e => e.payload), [{ reason: 'scene' }]);
  });
});
