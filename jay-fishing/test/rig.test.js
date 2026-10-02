// OWNER: P1 — 계약 §12.2(rig) · §5.2 · §5.4.4 · §5.5 · §6.5 · §6.8(createAngler)
// 파이팅은 fightImpl 을 가짜로 바꿔 끼운다 — P2 를 기다리지 않는다.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DT } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { makeInput } from '../src/core/inputFrame.js';
import { angleDiff, fwdX, fwdZ, shoreZAt, triangleWave, yawOf } from '../src/core/math.js';
import { hashState } from '../src/core/hash.js';
import { BITE, CAST, RIG, SIGNAL } from '../src/data/bite.js';
import { HOLD } from '../src/data/economy.js';
import { WORLD } from '../src/data/world.js';
import { getSpot, getStage } from '../src/data/stages/index.js';
import {
  fightImpl, syncRig, updateRig, enterSpot, exitSpot, keepCatch, releaseCatch, setFloatDepth,
  forceBite, forceFight, skipToResult, createRigState,
} from '../src/sim/fishing/rig.js';
import { depthAt } from '../src/sim/fishing/biteModel.js';
import { createAngler } from '../src/bot/angler.js';
import {
  makeTestState, makeTestCtx, makeTestProfile, makeTestRigStats, countEvents, assertFiniteDeep, randomInputs, assertShape,
} from './helpers.js';

// ── 가짜 파이팅(§3.4 FightState 전 필드) — after 틱 뒤 outcome 을 돌려준다

const realFight = { createFight: fightImpl.createFight, updateFight: fightImpl.updateFight };
let fakeAfter = 30;
/** @type {any} */
let fakeOutcome = { type: 'net', lineLostM: 0, durationSec: 0.5, cause: null, hookSmall: false };

function makeFakeFight(ctx, { speciesId, roll, dist, bearing, depth }) {
  const rs = ctx.rigStats;
  return {
    speciesId, roll, t: 0, dist, prevDist: dist, minDist: 2, bearing, prevBearing: bearing, halfArc: 0.8,
    depth, airborne: 0, stamina: 1, behavior: 'hold', behaviorName: 'hold', behaviorT: 0, behaviorDur: 2, telegraph: null,
    tension: 0, tensionRatio: 0, limitKg: rs.lineKg, limitBy: 'line', limitRatio: 0, lineKg: rs.lineKg, lineEffKg: rs.lineKg,
    abrasion: 0, inSnag: false, inCover: 0, rodLift: 0, rodUp: false, rodLoadRatio: 0, rodStress: false, rodOverT: 0,
    lineDanger: false, slipping: false, slipSpeed: 0, reeling: false, gainSpeed: 0, slack: false, slackTime: 0,
    spoolLeftM: 100, canNet: false, netRangeM: 3, netBuffer: 0, landStamina: rs.landStamina, showStamina: false, traits: [],
    k: { Fmax: 1, vmax: 1, endurance: 10 },
    stats: { maxTension: 0, sumTension: 0, sumTension2: 0, ticks: 0, runs: 0, jumps: 0, slackTicks: 0, slipTicks: 0 },
    brain: {},
  };
}

beforeEach(() => {
  fakeAfter = 30;
  fakeOutcome = { type: 'net', lineLostM: 0, durationSec: 0.5, cause: null, hookSmall: false };
  fightImpl.createFight = makeFakeFight;
  fightImpl.updateFight = (ctx) => {
    const f = ctx.state.fight;
    f.t += DT;
    f.stats.ticks++;
    return f.stats.ticks >= fakeAfter ? { ...fakeOutcome, durationSec: f.t } : null;
  };
});
afterEach(() => {
  fightImpl.createFight = realFight.createFight;
  fightImpl.updateFight = realFight.updateFight;
});

// ── 도구

function setup({ spotId = 'lake_gravel', set = 'bottom', hour = 8, weather = 'clear', profile, seed = 1, refresh } = {}) {
  const state = makeTestState({ spotId, set, hour, weather, seed, profile: profile ?? makeTestProfile({ baits: { worm: 50, paste: 50, corn: 10, shrimp: 10, krill: 10, live: 10 } }) });
  const ctx = makeTestCtx(state, refresh ? { refresh: null } : {});
  if (refresh) ctx.refresh = () => refresh(ctx);
  ctx.refresh();
  return { state, ctx, r: state.rig };
}

/** GameSim.step 의 rig 부분 흉내(§5.1): tick · prevBobber · 시선 복사 · updateRig */
function step(ctx, partial = {}) {
  const s = ctx.state;
  const input = makeInput({ yaw: s.player.yaw, pitch: s.player.pitch, ...partial });
  s.tick++;
  s.rig.prevBobber = { x: s.rig.bobber.x, z: s.rig.bobber.z };
  if (Number.isFinite(input.yaw)) s.player.yaw = input.yaw;
  updateRig(ctx, input);
  return input;
}

const evs = (ctx, name) => ctx.events.filter(e => e.name === name);
const last = (ctx, name) => { const a = evs(ctx, name); return a[a.length - 1]; };

/** 누름 → n 틱 붙잡고 → 뗌. 뗀 틱의 CAST_RELEASE 를 돌려준다 */
function cast(ctx, holdTicks, partial = {}) {
  step(ctx, { primary: true, primaryPressed: true, ...partial });
  assert.equal(ctx.state.rig.phase, 'charging');
  for (let i = 0; i < holdTicks; i++) step(ctx, { primary: true, ...partial });
  step(ctx, { primaryReleased: true, ...partial });
  return last(ctx, EV.CAST_RELEASE);
}

/** casting → waiting 까지 */
function land(ctx) {
  let n = 0;
  while (ctx.state.rig.phase === 'casting') { step(ctx); n++; assert.ok(n < 600); }
  assert.equal(ctx.state.rig.phase, 'waiting');
}

/** 다음 틱에 본신이 시작되는가 */
function takeNext(r) {
  return r.signal.kind !== 'take' && r.phaseTime + DT >= r.bite.takeAt - RIG.timeEps;
}

/** 본신이 시작되기 직전 틱까지 민다(Space 없이) */
function untilTakeNext(ctx) {
  const r = ctx.state.rig;
  let n = 0;
  while (!takeNext(r)) { step(ctx); n++; assert.equal(r.phase, 'bite'); assert.ok(n < 2000); }
}

// ── 캐스팅

test('캐스팅: 게이지 삼각파 · 거리 식 · 완벽 · 조준 자르기 · 비행 시간 · 착수(CAST_SPLASH)', () => {
  const { ctx, r, state } = setup();
  const rs = ctx.rigStats;
  const spot = ctx.spot;
  // 42틱 = 0.7초 → 게이지 0.875
  const rel = cast(ctx, 41, { yaw: spot.facing + 1.0 });          // 오른쪽 끝 너머를 본다 → arc 로 잘린다
  assert.equal(countEvents(ctx.events, EV.CAST_START), 1);
  const power = triangleWave(42 * DT / CAST.gaugePeriod);
  assert.ok(Math.abs(rel.payload.power - power) < 1e-9);
  assert.ok(Math.abs(power - 0.875) < 1e-9);
  assert.equal(rel.payload.perfect, false);
  const expD = rs.castMaxM * (CAST.minFactor + CAST.slope * power);
  assert.ok(Math.abs(rel.payload.distM - expD) < 1e-9);
  assert.ok(Math.abs(rel.payload.aimYaw - (spot.facing + spot.arc)) < 1e-12);
  assert.equal(r.castBaitId, 'paste');
  assert.equal(state.profile.baits.paste, 49);
  assert.equal(state.profile.stats.casts, 1);
  assert.ok(Math.abs(r.bobber.x - (spot.stand.x + fwdX(r.aimYaw) * expD)) < 1e-9);
  assert.ok(Math.abs(r.bobber.z - (spot.stand.z + fwdZ(r.aimYaw) * expD)) < 1e-9);
  // 비행 시간 = flightBase + d × flightPerM
  const flight = CAST.flightBase + expD * CAST.flightPerM;
  let ticks = 0;
  while (r.phase === 'casting') { step(ctx); ticks++; }
  assert.equal(ticks, Math.ceil(flight / DT - 1e-6));
  const sp = last(ctx, EV.CAST_SPLASH).payload;
  assert.equal(sp.set, 'bottom');
  assert.equal(sp.layer, 'bottom');
  assert.ok(Math.abs(sp.waterDepthM - depthAt(spot, expD)) < 1e-9);
  assert.equal(sp.baitDepthM, sp.waterDepthM);
  assert.equal(r.castT, 1);
});

test('캐스팅: 완벽 띠 = castMaxM · 하한 minCastM · lineM = minLineM 에서도 상 · 하한이 뒤집히지 않는다', () => {
  {
    const { ctx } = setup();
    const rel = cast(ctx, 47);                                      // 48틱 = 0.8초 → 게이지 1
    assert.equal(rel.payload.perfect, true);
    assert.ok(Math.abs(rel.payload.distM - ctx.rigStats.castMaxM) < 1e-9);
  }
  {
    // 비거리가 짧은 로드(12m): 낮은 게이지 → minCastM 으로 올린다
    const { ctx } = setup({ refresh: (c) => { c.rigStats = makeTestRigStats('bottom', { castMaxM: 12 }); syncRig(c); } });
    const rel = cast(ctx, 0);
    assert.equal(rel.payload.distM, ctx.spot.minCastM);
  }
  {
    // 스풀이 minLineM 뿐: hi = lineM − lineReserveM = 10 ≥ lo = minCastM
    const p = makeTestProfile();
    p.sets.bottom.lineM = CAST.minLineM;
    const { ctx } = setup({ profile: p });
    const hiRel = cast(ctx, 47);
    assert.equal(hiRel.payload.distM, CAST.minLineM - CAST.lineReserveM);
    assert.ok(hiRel.payload.distM >= ctx.spot.minCastM);
  }
});

test('캐스팅 불가: 미끼 0 → CAST_BLOCKED{noBait} · 라인 < minLineM → {noLine} · 충전하지 않는다', () => {
  {
    const p = makeTestProfile();
    p.baits.paste = 0;
    const { ctx, r } = setup({ profile: p });
    assert.equal(r.canCast, false);
    assert.equal(r.castBlock, 'noBait');
    step(ctx, { primary: true, primaryPressed: true });
    assert.equal(r.phase, 'ready');
    assert.deepEqual(last(ctx, EV.CAST_BLOCKED).payload, { reason: 'noBait' });
  }
  {
    const p = makeTestProfile();
    p.sets.bottom.lineM = CAST.minLineM - 1;
    const { ctx, r } = setup({ profile: p });
    step(ctx, { primary: true, primaryPressed: true });
    assert.equal(r.phase, 'ready');
    assert.deepEqual(last(ctx, EV.CAST_BLOCKED).payload, { reason: 'noLine' });
  }
});

// ── 미끼 · 회수

test('빈 채비 회수: 릴 속도 × emptyRetrieveMul · 떼면 waiting(minWait 를 다시 세지 않는다) · 끝나면 물속 미끼 환불', () => {
  const { ctx, r, state } = setup();
  state.debug.noBites = true;
  cast(ctx, 47);
  land(ctx);
  const d0 = r.dist;
  for (let i = 0; i < 120; i++) step(ctx);                         // 2초 대기
  const waited = r.phaseTime;
  // 1초 감기
  for (let i = 0; i < 60; i++) step(ctx, { primary: true });
  assert.equal(r.phase, 'retrieving');
  const speed = ctx.rigStats.reelSpeedMS * CAST.emptyRetrieveMul;
  assert.ok(Math.abs(r.dist - (d0 - speed * 59 * DT)) < 1e-6, `${r.dist}`);  // 첫 틱은 waiting → retrieving 전환
  // 놓으면 waiting · phaseTime 은 이어서 센다
  step(ctx);
  assert.equal(r.phase, 'waiting');
  assert.ok(r.phaseTime > waited + 1 - 1e-6);
  // 다시 감아 끝까지
  state.profile.sets.bottom.bait = 'worm';                         // 대기 중 미끼를 바꿔도 환불은 물속 미끼(떡밥)
  let n = 0;
  while (r.phase !== 'ready') { step(ctx, { primary: true }); n++; assert.ok(n < 2000); }
  assert.deepEqual(last(ctx, EV.RETRIEVE_DONE).payload, { baitReturned: true });
  assert.equal(state.profile.baits.paste, 50);
  assert.equal(state.profile.baits.worm, 50);
  assert.equal(r.castBaitId, null);
  assert.equal(r.dist, 0);
  // 28m 회수 시간 ≈ 6초(§7.5 주석)
  assert.ok(Math.abs((28 - CAST.retrieveDoneM) / speed - 5.8) < 0.1);
});

test('물속 미끼(castBaitId)로 입질 가중치를 본다 — 대기 중 profile 의 미끼를 바꿔도 입질 시각 · 어종이 같다', () => {
  const run = (swapTo) => {
    const { ctx, r, state } = setup({ seed: 11, hour: 12 });
    cast(ctx, 47);
    land(ctx);
    if (swapTo) state.profile.sets.bottom.bait = swapTo;
    let n = 0;
    while (r.phase === 'waiting') { step(ctx); n++; assert.ok(n < 60 * 600); }
    return { n, species: r.bite.speciesId, roll: r.bite.roll };
  };
  const a = run(null);
  const b = run('krill');
  assert.deepEqual(a, b);
});

// ── 흘림 · 봉돌 밀림 경계

function checkBoundary(ctx) {
  const r = ctx.state.rig;
  const spot = ctx.spot;
  const dx = r.bobber.x - spot.stand.x;
  const dz = r.bobber.z - spot.stand.z;
  assert.ok(Math.abs(angleDiff(spot.facing, yawOf(dx, dz))) <= CAST.driftArc + 1e-9, 'arc');
  assert.ok(Math.hypot(dx, dz) >= spot.minCastM - 1e-9, 'minCast');
  assert.ok(r.bobber.z < shoreZAt(ctx.stage.shore, r.bobber.x), '땅 위');
  assert.ok(Math.abs(Math.hypot(dx, dz) - r.dist) < 1e-9);
}

test('흘림: 강 꼬리물 · 찌 · 베일 열림 — 흐름을 타고 가다 경계(arc · 해안선 · 라인)에서 멈춘다 · 땅으로 가지 않는다', () => {
  for (const spotId of ['river_tailrace', 'river_riffle', 'river_trench', 'coast_channel', 'coast_cape', 'coast_shoal']) {
    for (const yawOff of [-0.6, 0, 0.6]) {
      const { ctx, r, state } = setup({ spotId, set: 'float' });
      state.debug.noBites = true;
      cast(ctx, 30, { yaw: ctx.spot.facing + yawOff });
      land(ctx);
      step(ctx, { bail: true });
      assert.equal(r.bailOpen, true);
      assert.deepEqual(last(ctx, EV.BAIL_CHANGED).payload, { open: true });
      const start = { ...r.bobber };
      let moved = 0;
      for (let i = 0; i < 60 * 240; i++) {
        step(ctx);
        checkBoundary(ctx);
        assert.ok(r.dist <= Math.min(ctx.spot.maxDriftM, state.profile.sets.float.lineM - CAST.driftReserveM) + 1e-9 || !r.drifting);
        if (r.drifting) moved++;
      }
      const fl = Math.hypot(ctx.spot.flow.x, ctx.spot.flow.z);
      if (fl >= BITE.driftMinFlow) assert.ok(moved > 0 || Math.hypot(r.bobber.x - start.x, r.bobber.z - start.z) === 0, spotId);
      assert.equal(r.drifting, false, `${spotId} 4분 뒤에도 흘림이 끝나지 않았다`);   // 경계에서 멈춘다
      // 베일을 닫으면 흘림이 멈춘다
      step(ctx, { bail: true });
      assert.equal(r.bailOpen, false);
    }
  }
});

test('흘림: 흐름이 driftMinFlow 아래면(호수) 베일을 열어도 움직이지 않는다 · 바닥 세트는 흘리지 않는다', () => {
  const { ctx, r, state } = setup({ set: 'float' });
  state.debug.noBites = true;
  cast(ctx, 30);
  land(ctx);
  step(ctx, { bail: true });
  const b = { ...r.bobber };
  for (let i = 0; i < 300; i++) step(ctx);
  assert.deepEqual(r.bobber, b);
  assert.equal(r.drifting, false);
});

test('봉돌 밀림: 흐름 > sinkerHoldMS 면 (흐름 − 버팀) × bottomSlipSpeed 로 밀리고 경계에서 멈춘다(강 깊은 홈)', () => {
  const { ctx, r, state } = setup({ spotId: 'river_trench', set: 'bottom' });
  state.debug.noBites = true;
  cast(ctx, 30);
  land(ctx);
  const b0 = { ...r.bobber };
  step(ctx);
  assert.equal(r.bottomSlip, true);
  const fl = Math.hypot(ctx.spot.flow.x, ctx.spot.flow.z);
  const v = (fl - ctx.rigStats.sinkerHoldMS) * BITE.bottomSlipSpeed;
  assert.ok(Math.abs(Math.hypot(r.bobber.x - b0.x, r.bobber.z - b0.z) - v * DT) < 1e-9);
  for (let i = 0; i < 60 * 1200; i++) { step(ctx); checkBoundary(ctx); }   // 0.1m/s 로 +X — 약 12분 뒤 arc 경계(1.3rad)에 닿는다
  assert.equal(r.bottomSlip, false);
  // 봉돌이 흐름을 잡으면(호수) 밀리지 않는다
  const lake = setup({ set: 'bottom' });
  lake.state.debug.noBites = true;
  cast(lake.ctx, 30);
  land(lake.ctx);
  step(lake.ctx);
  assert.equal(lake.r.bottomSlip, false);
});

// ── 수심 · 세트 · 드랙

test('수심: 대기 중 변경 → 층 다시 계산 · minWait 다시 세기 · DEPTH_CHANGED · SAVE_REQUEST{tackle} / 입질 중 RIG_BUSY / 바닥 세트는 무시', () => {
  const { ctx, r, state } = setup({ set: 'float' });
  state.debug.noBites = true;
  cast(ctx, 47);
  land(ctx);
  for (let i = 0; i < 180; i++) step(ctx);
  const before = r.floatDepth;
  step(ctx, { depthSteps: 1 });
  assert.equal(r.floatDepth, before + CAST.depthStepM);
  assert.equal(state.profile.sets.float.depthM, r.floatDepth);
  assert.ok(r.phaseTime <= DT + 1e-9);                             // 0 으로 되돌린 뒤 이 틱의 DT 만
  assert.deepEqual(last(ctx, EV.DEPTH_CHANGED).payload, { depthM: r.floatDepth });
  assert.deepEqual(last(ctx, EV.SAVE_REQUEST).payload, { reason: 'tackle' });
  // 깊게 바꾸면 층이 바닥으로
  step(ctx, { depthSteps: 200 });
  assert.equal(r.floatDepth, CAST.depthMaxM);
  assert.equal(r.layer, 'bottom');
  assert.equal(r.baitDepth, r.waterDepth);
  // 명령도 같은 규칙
  assert.deepEqual(setFloatDepth(ctx, 1.5), { ok: true, depthM: 1.5 });
  assert.equal(r.layer, r.waterDepth - 1.5 <= 0.5 ? 'bottom' : 'mid');
  assert.equal(setFloatDepth(ctx, NaN).reason, 'invalid');
  // 입질 중 → 버리고 RIG_BUSY
  forceBite(ctx, 'bluegill', 0.5);
  const busy0 = countEvents(ctx.events, EV.RIG_BUSY);
  step(ctx, { depthSteps: 1 });
  assert.equal(r.floatDepth, 1.5);
  assert.equal(countEvents(ctx.events, EV.RIG_BUSY), busy0 + 1);
  assert.deepEqual(last(ctx, EV.RIG_BUSY).payload, { action: 'depth' });
  assert.equal(setFloatDepth(ctx, 2).reason, 'busy');
  // 바닥 세트는 수심 입력을 무시한다
  const b = setup({ set: 'bottom' });
  const n0 = b.ctx.events.length;
  step(b.ctx, { depthSteps: 1 });
  assert.equal(b.ctx.events.length, n0);
});

test('세트 전환: ready 즉시 · charging 취소 · 물속이면 회수(환불) 후 · failed/landing 은 pendingSet · bite/fighting 은 RIG_BUSY', () => {
  // ready
  {
    const p = makeTestProfile();
    p.sets.float.dragNotch = 9;
    const { ctx, r } = setup({ profile: p });
    step(ctx, { selectSet: 'float' });
    assert.equal(r.set, 'float');
    assert.deepEqual(last(ctx, EV.SET_CHANGED).payload, { set: 'float' });
    assert.equal(r.dragNotch, 9);                                  // syncRig 가 새 세트의 드랙
    assert.equal(ctx.rigStats.set, 'float');
    step(ctx, { selectSet: 'float' });                             // 같은 세트 → 아무 일 없음
    assert.equal(countEvents(ctx.events, EV.SET_CHANGED), 1);
  }
  // charging → 취소 후 전환(미끼를 쓰지 않았다)
  {
    const { ctx, r, state } = setup();
    step(ctx, { primary: true, primaryPressed: true });
    step(ctx, { primary: true, selectSet: 'float' });
    assert.equal(r.set, 'float');
    assert.equal(r.phase, 'ready');
    assert.equal(state.profile.baits.paste, 50);
  }
  // waiting → 회수(환불) → 전환
  {
    const { ctx, r, state } = setup();
    state.debug.noBites = true;
    cast(ctx, 30);
    land(ctx);
    step(ctx, { selectSet: 'float' });
    assert.equal(r.set, 'float');
    assert.equal(r.phase, 'ready');
    assert.equal(state.profile.baits.paste, 50);
    assert.deepEqual(last(ctx, EV.RETRIEVE_DONE).payload, { baitReturned: true });
  }
  // bite → RIG_BUSY{set}
  {
    const { ctx, r } = setup();
    forceBite(ctx, 'crucian', 0.5);
    step(ctx, { selectSet: 'float' });
    assert.equal(r.set, 'bottom');
    assert.deepEqual(last(ctx, EV.RIG_BUSY).payload, { action: 'set' });
    // fighting → RIG_BUSY{set}
    forceFight(ctx, 'crucian', 0.5);
    assert.equal(r.phase, 'fighting');
    step(ctx, { selectSet: 'float' });
    assert.equal(r.set, 'bottom');
    assert.equal(countEvents(ctx.events, EV.RIG_BUSY), 2);
  }
  // failed → pendingSet → ready 첫 틱에 전환 / landing 도
  {
    const { ctx, r } = setup();
    forceBite(ctx, 'crucian', 0.5);
    while (r.phase === 'bite') step(ctx);                          // 늦음
    assert.equal(r.phase, 'failed');
    step(ctx, { selectSet: 'float' });
    assert.equal(r.pendingSet, 'float');
    assert.equal(r.set, 'bottom');
    while (r.phase === 'failed') step(ctx);
    assert.equal(r.set, 'float');
    assert.equal(r.pendingSet, null);
    fakeAfter = 1;
    forceFight(ctx, 'crucian', 0.5);
    step(ctx);
    assert.equal(r.phase, 'landing');
    step(ctx, { selectSet: 'bottom' });
    assert.equal(r.pendingSet, 'bottom');
    while (r.phase === 'landing') step(ctx);
    assert.equal(r.phase, 'result');
    assert.equal(keepCatch(ctx).ok, true);
    step(ctx);
    assert.equal(r.set, 'bottom');
  }
});

test('드랙: 모든 단계에서 profile 눈금을 바꾸고 syncRig · DRAG_CHANGED{notch, notches, kg, ratio} · 0..notches 로 자른다', () => {
  const { ctx, r, state } = setup();
  step(ctx, { dragSteps: 3 });
  assert.equal(state.profile.sets.bottom.dragNotch, 8);
  assert.equal(r.dragNotch, 8);
  assert.equal(r.dragKg, 8 * ctx.rigStats.dragNotchKg);
  assert.deepEqual(last(ctx, EV.DRAG_CHANGED).payload, { notch: 8, notches: 20, kg: 2, ratio: 2 / ctx.rigStats.lineKg });
  step(ctx, { dragSteps: 99 });
  assert.equal(r.dragNotch, 20);
  step(ctx, { dragSteps: -99 });
  assert.equal(r.dragNotch, 0);
  forceFight(ctx, 'crucian', 0.5);
  step(ctx, { dragSteps: 2 });
  assert.equal(r.dragNotch, 2);
  assert.equal(state.profile.sets.bottom.dragNotch, 2);
});

test('syncRig: 장착 · 스킬로 rigStats 가 바뀐 뒤 rig 의 드랙 · 수심 = profile (눈금 수가 줄면 자른다)', () => {
  let notches = 20;
  const { ctx, r, state } = setup({
    refresh: (c) => {
      c.rigStats = makeTestRigStats(c.state.rig.set, { dragNotches: notches, dragNotchKg: 5 / notches });
      syncRig(c);
    },
  });
  state.profile.sets.bottom.dragNotch = 15;
  notches = 30;                                                   // dragSense 스킬
  ctx.refresh();
  assert.equal(r.dragNotches, 30);
  assert.equal(r.dragNotch, 15);
  assert.ok(Math.abs(r.dragKg - 15 * 5 / 30) < 1e-12);
  notches = 10;
  ctx.refresh();
  assert.equal(r.dragNotch, 10);
  state.profile.sets.float.depthM = 4.25;
  ctx.refresh();
  assert.equal(r.floatDepth, 4.25);
  assert.equal(r.perfectFrom, 1 - ctx.rigStats.perfectWindow);
});

// ── 입질 · 챔질 창

/** 자리에서 바로 입질(forceBite) — 그 어종 · 세트의 신호 타임라인 */
function biteSetup(set, speciesId, seed = 3) {
  const s = setup({ set, seed });
  assert.equal(forceBite(s.ctx, speciesId, 0.5).ok, true);
  assert.equal(s.r.phase, 'bite');
  return s;
}

const WINDOWS = [
  ['float', 'bluegill', 'sink', SIGNAL.float.takeWindow],
  ['float', 'crucian', 'lift', SIGNAL.float.takeWindow + SIGNAL.float.liftWindowAdd],
  ['bottom', 'carp', 'pull', SIGNAL.bottom.takeWindow],
];

test('챔질 창: 본신 첫 틱의 Space 는 성공(BITE_TAKE 와 같은 틱 HOOK_SET) · 창 길이 = hookWindowS (+찌올림 0.3초)', () => {
  for (const [set, sp, style, win] of WINDOWS) {
    const { ctx, r, state } = biteSetup(set, sp);
    untilTakeNext(ctx);
    const takes0 = countEvents(ctx.events, EV.BITE_TAKE);
    step(ctx, { hook: true });
    assert.equal(countEvents(ctx.events, EV.BITE_TAKE), takes0 + 1);
    const take = last(ctx, EV.BITE_TAKE).payload;
    assert.equal(take.style, style);
    assert.equal(take.set, set);
    assert.ok(Math.abs(take.window - win) < 1e-12, `${sp} 창 ${take.window}`);
    assert.equal(r.phase, 'fighting', `${sp} 첫 틱 챔질 실패`);
    const hs = last(ctx, EV.HOOK_SET).payload;
    assert.deepEqual(Object.keys(hs).sort(), ['lengthCm', 'weightKg']);
    assert.ok(state.fight);
    assert.equal(state.fight.speciesId, sp);
  }
});

test('챔질 창: 마지막 틱의 Space 는 성공 · 그다음 틱이면 이미 늦음(HOOK_MISS late → FAIL)', () => {
  for (const [set, sp, , win] of WINDOWS) {
    const ticks = Math.round(win / DT);
    // 마지막 틱(본신 틱 + ticks − 1)
    {
      const { ctx, r } = biteSetup(set, sp);
      untilTakeNext(ctx);
      step(ctx);                                                   // 본신 틱(index 0)
      assert.equal(r.signal.kind, 'take');
      assert.equal(r.hookWindow.open, true);
      for (let i = 1; i < ticks - 1; i++) step(ctx);
      assert.equal(r.phase, 'bite');
      step(ctx, { hook: true });                                   // index ticks − 1
      assert.equal(r.phase, 'fighting', `${sp} 마지막 틱 챔질이 실패`);
    }
    // 아무것도 누르지 않으면 index ticks − 1 에서 늦음
    {
      const { ctx, r, state } = biteSetup(set, sp);
      untilTakeNext(ctx);
      for (let i = 0; i < ticks - 1; i++) step(ctx);
      assert.equal(r.phase, 'bite');
      step(ctx);
      assert.equal(r.phase, 'failed', `${sp} 창이 ${ticks}틱보다 길다`);
      const miss = last(ctx, EV.HOOK_MISS).payload;
      assert.equal(miss.reason, 'late');
      assert.equal(typeof miss.baitKept, 'boolean');
      const f = last(ctx, EV.FAIL).payload;
      assert.equal(f.reason, 'late');
      assert.equal(f.loss.baitId, state.profile.sets[set].bait);
      const names = ctx.events.map(e => e.name);
      assert.ok(names.lastIndexOf(EV.HOOK_MISS) < names.lastIndexOf(EV.FAIL));
      assert.ok(names.lastIndexOf(EV.FAIL) < names.lastIndexOf(EV.SAVE_REQUEST));
      assert.deepEqual(last(ctx, EV.SAVE_REQUEST).payload, { reason: 'loss' });
      assert.equal(r.failReason, 'late');
      assert.equal(r.castBaitId, null);
      assert.equal(r.dist, 0);
    }
  }
});

test('챔질: 본신 직전 earlyGrace 안의 Space 는 선입력(본신 첫 틱에 성공) · 그보다 이른 예신 중 Space 는 헛챔질 · 첫 신호 전 Space 는 무시', () => {
  // 선입력: 본신 2틱 전(0.033초 ≤ 0.10초)
  {
    const { ctx, r } = biteSetup('float', 'crucian');
    const b = r.bite;
    while (r.phaseTime + 3 * DT < b.takeAt - RIG.timeEps) step(ctx);
    step(ctx, { hook: true });
    assert.ok(b.takeAt - r.phaseTime <= SIGNAL.earlyGrace + 1e-9);
    assert.equal(r.phase, 'bite');
    let n = 0;
    while (r.phase === 'bite') { step(ctx); n++; assert.ok(n < 10); }
    assert.equal(r.phase, 'fighting');
    assert.equal(countEvents(ctx.events, EV.HOOK_MISS), 0);
  }
  // 헛챔질: 첫 예신 직후(붕어는 예신 2–4회)
  {
    const { ctx, r } = biteSetup('float', 'crucian');
    while (countEvents(ctx.events, EV.BITE_NIBBLE) === 0) step(ctx);
    assert.equal(r.signal.kind, 'nibble');
    const nib = last(ctx, EV.BITE_NIBBLE).payload;
    assert.equal(nib.set, 'float');
    assert.equal(nib.index, 0);
    assert.ok(Math.abs(nib.strength - SIGNAL.baseStrength * ctx.rigStats.signalMul) < 1e-12);
    step(ctx, { hook: true });
    assert.equal(r.phase, 'failed');
    assert.equal(last(ctx, EV.HOOK_MISS).payload.reason, 'early');
    assert.equal(last(ctx, EV.FAIL).payload.reason, 'early');
  }
  // 첫 신호 전 Space: 아무 일 없다
  {
    const { ctx, r } = biteSetup('bottom', 'carp');
    step(ctx, { hook: true });
    assert.equal(r.phase, 'bite');
    assert.equal(r.signal.kind, 'none');
  }
});

test('신호 타임라인: 찌 예신 횟수 = 어종 bite.nibbles 범위 · 첫 예신 firstDelay 뒤 · 바닥은 초리 떨림 pulse 간격 · 본신 strength 1', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { ctx, r } = biteSetup('float', 'crucian', seed);       // nibbles [2, 4]
    const b = r.bite;
    assert.ok(b.nibbleTimes.length >= 2 && b.nibbleTimes.length <= 4);
    assert.ok(b.nibbleTimes[0] >= SIGNAL.firstDelay[0] && b.nibbleTimes[0] <= SIGNAL.firstDelay[1]);
    for (let i = 1; i < b.nibbleTimes.length; i++) {
      const gap = b.nibbleTimes[i] - b.nibbleTimes[i - 1] - SIGNAL.float.nibbleDur;
      assert.ok(gap >= SIGNAL.float.gap[0] - 1e-9 && gap <= SIGNAL.float.gap[1] + 1e-9);
    }
    let n = 0;
    while (r.signal.kind !== 'take') { step(ctx); n++; assert.ok(n < 1000); }
    assert.equal(countEvents(ctx.events, EV.BITE_NIBBLE), b.nibbleTimes.length);
    assert.equal(r.signal.count, b.nibbleTimes.length);
    assert.equal(r.signal.strength, 1);
    assert.equal(r.signal.takeStyle, 'lift');
  }
  {
    const { ctx, r } = biteSetup('float', 'largemouthBass', 5);   // nibbles [0, 1]
    assert.ok(r.bite.nibbleTimes.length <= 1);
  }
  for (let seed = 1; seed <= 20; seed++) {
    const { ctx, r } = biteSetup('bottom', 'carp', seed);
    const b = r.bite;
    const trem = b.takeAt - b.nibbleTimes[0];
    assert.ok(trem >= SIGNAL.bottom.tremble[0] - 1e-9 && trem <= SIGNAL.bottom.tremble[1] + 1e-9);
    for (let i = 1; i < b.nibbleTimes.length; i++) assert.ok(Math.abs(b.nibbleTimes[i] - b.nibbleTimes[i - 1] - SIGNAL.bottom.pulse) < 1e-9);
    while (r.signal.kind !== 'take') {
      step(ctx);
      if (r.phaseTime > b.nibbleTimes[0] + DT && r.signal.kind !== 'take') assert.equal(r.signal.kind, 'nibble');   // 떨림은 본신까지 이어진다
    }
    assert.equal(r.signal.takeStyle, 'pull');
  }
});

test('대기 → 입질: minWait 전에는 물지 않는다 · 입질 순간 bite 단계(어종 · 크기는 rig.bite 에만)', () => {
  const { ctx, r } = setup({ seed: 5 });
  cast(ctx, 47);
  land(ctx);
  let n = 0;
  while (r.phase === 'waiting') { step(ctx); n++; assert.ok(n < 60 * 900); }
  assert.ok(n * DT >= BITE.minWait - 1e-9);
  assert.equal(r.phase, 'bite');
  assert.ok(r.bite.speciesId);
  assert.ok(getSpot('lake_gravel').pool.some(p => p.id === r.bite.speciesId));
  assert.equal(r.signal.kind, 'none');
});

// ── 실패 → 재도전

test('실패 → 알림 RIG.failNotice → RIG_RESTORED · ready → 알림 중 누른 좌클릭으로 1.7초 안 재캐스팅(입력 2번)', () => {
  for (const kind of ['late', 'lineBreak']) {
    const { ctx, r } = setup();
    if (kind === 'late') {
      forceBite(ctx, 'carp', 0.5);
      while (r.phase === 'bite') step(ctx);
    } else {
      fakeAfter = 20;
      fakeOutcome = { type: 'lineBreak', lineLostM: 25, durationSec: 0, cause: null, hookSmall: false };
      forceFight(ctx, 'carp', 0.5);
      while (r.phase === 'fighting') step(ctx);
      assert.equal(last(ctx, EV.FAIL).payload.reason, 'lineBreak');
      assert.equal(ctx.state.fight, null);
    }
    assert.equal(r.phase, 'failed');
    // 누름(알림 중) → 붙잡음 → 게이지 0.875 를 지나면 뗌
    let t = 0;
    step(ctx, { primary: true, primaryPressed: true }); t++;
    assert.equal(r.castBuffered, true);
    let restoredAt = -1;
    while (!evs(ctx, EV.CAST_RELEASE).length) {
      const releasing = r.phase === 'charging' && r.phaseTime + DT >= 0.7 - 1e-9;   // 충전 0.7초째 틱에 뗀다(게이지 0.875)
      step(ctx, releasing ? { primaryReleased: true } : { primary: true });
      t++;
      if (restoredAt < 0 && evs(ctx, EV.RIG_RESTORED).length) restoredAt = t;
      assert.ok(t < 300);
    }
    assert.equal(restoredAt, Math.round(RIG.failNotice / DT));
    assert.ok(Math.abs(last(ctx, EV.CAST_RELEASE).payload.power - 0.875) < 1e-9);
    assert.ok(t * DT <= 1.7 + 1e-9, `${kind}: 재캐스팅까지 ${t * DT}초`);
    const rr = last(ctx, EV.RIG_RESTORED).payload;
    assert.deepEqual(Object.keys(rr).sort(), ['baitLeft', 'dragKg', 'lineM', 'rodReplaced', 'set', 'spoolReplaced']);
  }
});

test('실패 알림 중 탭(누르고 뗌)은 ready 첫 틱에 눌려 있지 않으니 충전하지 않는다 · 다음 누름으로 바로 충전', () => {
  const { ctx, r } = setup();
  forceBite(ctx, 'carp', 0.5);
  while (r.phase === 'bite') step(ctx);
  step(ctx, { primary: true, primaryPressed: true });
  step(ctx, { primaryReleased: true });
  while (r.phase === 'failed') step(ctx);
  assert.equal(r.phase, 'ready');
  assert.equal(r.castBuffered, false);
  step(ctx, { primary: true, primaryPressed: true });
  assert.equal(r.phase, 'charging');
});

test('파이팅 실패: outcome 그대로 applyLoss(물속 미끼 · lineLostM · cause · hookSmall) → FAIL · fight null', () => {
  const { ctx, r, state } = setup();
  cast(ctx, 47);
  land(ctx);
  state.profile.sets.bottom.bait = 'worm';                         // 물속은 떡밥
  forceBite(ctx, 'carp', 0.5);
  untilTakeNext(ctx);
  fakeAfter = 5;
  fakeOutcome = { type: 'hookOff', lineLostM: 0, durationSec: 0, cause: 'slack', hookSmall: true };
  step(ctx, { hook: true });
  while (r.phase === 'fighting') step(ctx);
  const f = last(ctx, EV.FAIL).payload;
  assert.equal(f.reason, 'hookOff');
  assert.equal(f.loss.baitId, 'paste');
  assert.equal(f.loss.cause, 'slack');
  assert.equal(f.loss.hookSmall, true);
  assert.equal(state.fight, null);
  assert.equal(r.lastLoss, f.loss);
  assert.equal(countEvents(ctx.events, EV.HOOK_MISS), 0);
});

// ── 결과

function toResult(ctx) {
  const r = ctx.state.rig;
  fakeAfter = 10;
  forceFight(ctx, 'carp', 0.95);
  let n = 0;
  while (r.phase !== 'result') { step(ctx); n++; assert.ok(n < 200); }
  return n;
}

test('뜰채 → landing(RIG.netTime) → result · CATCH_RESULT{catch, holdFull} · result 에서는 updateRig 가 아무것도 하지 않는다', () => {
  const { ctx, r, state } = setup();
  const n = toResult(ctx);
  assert.equal(n, 10 + Math.round(RIG.netTime / DT));
  const cr = last(ctx, EV.CATCH_RESULT).payload;
  assert.equal(cr.holdFull, false);
  assert.equal(cr.catch.speciesId, 'carp');
  assert.equal(state.pendingCatch, cr.catch);
  assert.equal(state.fight, null);
  assert.equal(r.castBaitId, null);
  const h = JSON.stringify(state);
  step(ctx, { primary: true, primaryPressed: true, hook: true, selectSet: 'float', dragSteps: 3 });
  state.tick--;
  state.rig.prevBobber = JSON.parse(h).rig.prevBobber;
  assert.equal(JSON.stringify(state), h);
});

test('keepCatch / releaseCatch → CATCH_KEPT · CATCH_RELEASED{swapped:false} · SAVE_REQUEST{catch} · ready', () => {
  {
    const { ctx, r, state } = setup();
    assert.equal(keepCatch(ctx).reason, 'notHere');
    toResult(ctx);
    const rec = state.pendingCatch;
    const res = keepCatch(ctx);
    assert.equal(res.ok, true);
    assert.equal(last(ctx, EV.CATCH_KEPT).payload.catch, rec);
    assert.deepEqual(last(ctx, EV.SAVE_REQUEST).payload, { reason: 'catch' });
    assert.equal(r.phase, 'ready');
    assert.equal(state.pendingCatch, null);
    assert.equal(keepCatch(ctx).ok, false);
  }
  {
    const { ctx, r, state } = setup();
    toResult(ctx);
    const rec = state.pendingCatch;
    assert.equal(releaseCatch(ctx).ok, true);
    assert.deepEqual(last(ctx, EV.CATCH_RELEASED).payload, { catch: rec, swapped: false });
    assert.equal(r.phase, 'ready');
  }
});

test('어창 가득: holdFull 표시 · swapUid 없으면 holdFull · 없는 uid 는 invalid · swap 은 CATCH_RELEASED{뺀 것, swapped:true} + CATCH_KEPT', () => {
  const p = makeTestProfile({ baits: { worm: 50, paste: 50, corn: 0, shrimp: 0, krill: 0, live: 0 } });
  for (let i = 0; i < HOLD.capacity; i++) {
    p.hold.push({ uid: 100 + i, speciesId: 'crucian', lengthCm: 20, weightKg: 0.3, pct: 0.5, tier: 'normal', price: 1000 + i, xpKeep: 1, xpRelease: 1,
      firstCatch: false, recordWeight: false, stageId: 'lake', spotId: 'lake_gravel', day: 1, hour: 8, set: 'bottom', fightSec: 3 });
  }
  const { ctx, r, state } = setup({ profile: p });
  toResult(ctx);
  assert.equal(last(ctx, EV.CATCH_RESULT).payload.holdFull, true);
  assert.deepEqual(keepCatch(ctx), { ok: false, reason: 'holdFull' });
  assert.deepEqual(keepCatch(ctx, { swapUid: 999 }), { ok: false, reason: 'invalid' });
  assert.equal(r.phase, 'result');
  const removed = state.profile.hold.find(c => c.uid === 105);
  assert.equal(keepCatch(ctx, { swapUid: 105 }).ok, true);
  assert.deepEqual(last(ctx, EV.CATCH_RELEASED).payload, { catch: removed, swapped: true });
  assert.equal(countEvents(ctx.events, EV.CATCH_KEPT), 1);
  assert.equal(r.phase, 'ready');
});

// ── 자리 들어가기 · 나가기

test('enterSpot / exitSpot: 이벤트 · 위치 · 단계 제한(bite · fighting · landing · result 는 busy · 걷기는 notHere) · 물속 미끼 환불', () => {
  const state = makeTestState({ scene: 'lake', set: 'bottom' });
  const ctx = makeTestCtx(state);
  ctx.refresh();
  assert.equal(exitSpot(ctx).reason, 'notHere');
  assert.equal(enterSpot(ctx, 'nope').ok, false);
  assert.deepEqual(enterSpot(ctx, 'lake_gravel'), { ok: true });
  const spot = getSpot('lake_gravel');
  assert.equal(state.player.mode, 'fish');
  assert.equal(state.player.spotId, 'lake_gravel');
  assert.equal(ctx.spot, spot);
  assert.equal(state.rig.phase, 'ready');
  assert.deepEqual(state.rig.origin, spot.stand);
  assert.deepEqual(last(ctx, EV.PLAYER_PLACED).payload, { x: spot.stand.x, z: spot.stand.z, yaw: spot.facing, pitch: 0, reason: 'spot' });
  assert.deepEqual(last(ctx, EV.FISHING_ENTER).payload, { spotId: 'lake_gravel', set: 'bottom' });
  const names = ctx.events.map(e => e.name);
  assert.ok(names.indexOf(EV.PLAYER_PLACED) < names.indexOf(EV.FISHING_ENTER));
  // 대기 중 → 나가면 환불
  state.debug.noBites = true;
  const paste = state.profile.baits.paste;
  cast(ctx, 30);
  land(ctx);
  assert.equal(state.profile.baits.paste, paste - 1);
  assert.deepEqual(exitSpot(ctx), { ok: true });
  assert.equal(state.profile.baits.paste, paste);
  assert.equal(state.player.mode, 'walk');
  assert.equal(state.player.spotId, null);
  assert.equal(ctx.spot, null);
  assert.equal(state.rig.phase, 'idle');
  assert.deepEqual(last(ctx, EV.FISHING_EXIT).payload, { spotId: 'lake_gravel' });
  const pp = last(ctx, EV.PLAYER_PLACED).payload;
  assert.equal(pp.reason, 'exitSpot');
  assert.ok(Math.abs(pp.x - (spot.stand.x - fwdX(spot.facing) * WORLD.exitStepBack)) < 1e-12);
  assert.ok(Math.abs(pp.z - (spot.stand.z - fwdZ(spot.facing) * WORLD.exitStepBack)) < 1e-12);
  // 걷기 모드에서는 updateRig 가 아무것도 하지 않는다
  const n0 = ctx.events.length;
  step(ctx, { primary: true, primaryPressed: true, selectSet: 'float' });
  assert.equal(ctx.events.length, n0);
  // bite · fighting · landing · result → busy
  enterSpot(ctx, 'lake_gravel');
  forceBite(ctx, 'carp', 0.5);
  assert.equal(exitSpot(ctx).reason, 'busy');
  forceFight(ctx, 'carp', 0.5);
  assert.equal(exitSpot(ctx).reason, 'busy');
  fakeAfter = 1;
  step(ctx);
  assert.equal(state.rig.phase, 'landing');
  assert.equal(exitSpot(ctx).reason, 'busy');
  while (state.rig.phase === 'landing') step(ctx);
  assert.equal(exitSpot(ctx).reason, 'busy');
  assert.equal(releaseCatch(ctx).ok, true);
  assert.equal(exitSpot(ctx).ok, true);
});

test('디버그: forceBite(ready → 착수 → bite) · forceFight(→ fighting · HOOK_SET) · skipToResult(→ result) · 낚시 모드가 아니면 notHere', () => {
  const { ctx, r, state } = setup();
  assert.equal(forceBite(ctx, 'carp', 0.9).ok, true);
  assert.equal(r.phase, 'bite');
  assert.ok(Math.abs(r.dist - Math.min(ctx.rigStats.castMaxM * RIG.debugBiteCastFrac, ctx.rigStats.castMaxM)) < 1e-9);
  assert.equal(r.castBaitId, 'paste');
  assert.equal(r.bite.roll.tier, 'trophy');
  assert.equal(forceBite(ctx, 'carp', 0.5).ok, false);              // 이미 입질 중
  assert.equal(forceFight(ctx, 'carp', 0.5).ok, true);
  assert.equal(r.phase, 'fighting');
  assert.equal(countEvents(ctx.events, EV.HOOK_SET), 1);
  assert.ok(Math.abs(r.dist - ctx.rigStats.castMaxM * RIG.debugFightCastFrac) < 1e-9);
  assert.equal(skipToResult(ctx, 'carp', 0.995).ok, true);
  assert.equal(r.phase, 'result');
  assert.equal(state.pendingCatch.tier, 'legend');
  assert.equal(state.fight, null);
  assert.equal(skipToResult(ctx, 'carp', 0.5).reason, 'busy');
  const walk = makeTestState({ scene: 'lake' });
  const wctx = makeTestCtx(walk);
  assert.equal(forceBite(wctx, 'carp', 0.5).reason, 'notHere');
  assert.equal(forceFight(wctx, 'carp', 0.5).reason, 'notHere');
  assert.equal(skipToResult(wctx, 'carp', 0.5).reason, 'notHere');
  // state.debug.forceBite: 대기 중이면 대기 없이 그 어종 · 퍼센타일
  const s2 = setup();
  cast(s2.ctx, 30);
  land(s2.ctx);
  s2.state.debug.forceBite = { speciesId: 'bluegill', pct: 0.5 };
  step(s2.ctx);
  assert.equal(s2.r.phase, 'bite');
  assert.equal(s2.r.bite.speciesId, 'bluegill');
  assert.equal(s2.state.debug.forceBite, null);
});

test('createRigState: §3.4 RigState 전 필드 · idle · 찌 세트 · profile.sets.float 의 드랙 · 수심', () => {
  const p = makeTestProfile();
  p.sets.float.depthM = 3.5;
  p.sets.float.dragNotch = 7;
  const r = createRigState(p);
  assertShape(r, 'RigState');
  assertShape(r.signal, 'SignalState');
  assert.equal(r.phase, 'idle');
  assert.equal(r.set, 'float');
  assert.equal(r.floatDepth, 3.5);
  assert.equal(r.dragNotch, 7);
});

// ── 퍼즈 · 결정성 · 불변식

test('무작위 입력 20,000틱: 예외 0 · NaN 0 · rig 의 드랙 · 수심 = profile · 찌는 물 위 · 결정성(같은 시드 → 같은 해시)', () => {
  const run = (seed, spotId, set) => {
    fakeAfter = 90;
    const { ctx, r, state } = setup({ spotId, set, seed });
    const inputs = randomInputs(seed);
    for (let t = 0; t < 20000; t++) {
      if (r.phase === 'result') {
        if (t % 2) keepCatch(ctx, { swapUid: state.profile.hold[0] ? state.profile.hold[0].uid : undefined });
        else releaseCatch(ctx);
        continue;
      }
      // 가짜 파이팅의 결말을 섞는다
      fakeOutcome = (t % 3 === 0) ? { type: 'net', lineLostM: 0, durationSec: 0, cause: null, hookSmall: false }
        : (t % 3 === 1) ? { type: 'lineBreak', lineLostM: 12, durationSec: 0, cause: null, hookSmall: false }
          : { type: 'hookOff', lineLostM: 0, durationSec: 0, cause: 'active', hookSmall: false };
      const inp = inputs(t);
      step(ctx, { ...inp, hook: inp.hook || (r.phase === 'bite' && r.signal.kind === 'take') });
      const cfg = state.profile.sets[r.set];
      assert.equal(r.dragNotch, Math.min(cfg.dragNotch, r.dragNotches));
      assert.equal(r.dragKg, r.dragNotch * ctx.rigStats.dragNotchKg);
      assert.equal(r.floatDepth, state.profile.sets.float.depthM);
      if (r.phase === 'waiting' || r.phase === 'bite') assert.ok(r.bobber.z < shoreZAt(ctx.stage.shore, r.bobber.x), '찌가 땅 위');
      for (const k of Object.keys(state.profile.baits)) assert.ok(state.profile.baits[k] >= 0);
    }
    assertFiniteDeep(state);
    return hashState(state);
  };
  for (const [spotId, set] of [['lake_gravel', 'bottom'], ['river_tailrace', 'float'], ['coast_channel', 'float']]) {
    assert.equal(run(7, spotId, set), run(7, spotId, set));
  }
});

// ── 자리 봇

const BOT_COMMANDS = new Set(['keepCatch', 'releaseCatch', 'sellAll', 'buy', 'refillLine', 'equip', 'setBait', 'setDepth', 'learnSkill', 'travel', 'waitNextBand', 'sleep', 'exitFishing']);

test('createAngler: updateRig 와 rig 명령만으로 캐스팅 → 입질 → 챔질 → (가짜) 파이팅 → 결과(keep · 어창이 차면 swap/방생)를 50번 · 명령은 §6.8 목록뿐 · 사람의 입력 모양', () => {
  for (const set of ['bottom', 'float']) {
    fakeAfter = 45;
    const { ctx, state } = setup({ set, seed: 21, profile: makeTestProfile({ baits: { worm: 400, paste: 400, corn: 0, shrimp: 0, krill: 0, live: 0 } }) });
    const sim = { getRigStats: () => ctx.rigStats };
    const bot = createAngler({ strategy: 'basic', seed: 5, set, baitId: set === 'bottom' ? 'paste' : 'worm', depthM: set === 'float' ? 1.5 : null });
    // W1 확정: 실제 applyCatch(P4)는 어창을 채운다 — 12마리 뒤에는 swap(keepCatch{swapUid}) 또는 방생이 계약대로다(§6.8)
    let caught = 0;
    let kept = 0;
    let released = 0;
    let hooked = 0;
    let commands = 0;
    let prevPrimary = false;
    for (let t = 0; t < 60 * 60 * 120 && caught < 50; t++) {
      const a = bot.decide(state, sim);
      const inp = a.input;
      // 사람의 입력 모양: 에지는 홀드와 맞는다 · 드랙은 손의 속도
      assert.equal(inp.primaryPressed, inp.primary && !prevPrimary);
      assert.equal(inp.primaryReleased, !inp.primary && prevPrimary);
      prevPrimary = inp.primary;
      assert.ok(Math.abs(inp.dragSteps) <= 1);
      if (a.command) {
        commands++;
        assert.ok(BOT_COMMANDS.has(a.command.name), a.command.name);
        const { name, args } = a.command;
        let res;
        if (name === 'keepCatch') res = keepCatch(ctx, ...args);
        else if (name === 'releaseCatch') res = releaseCatch(ctx);
        else if (name === 'setDepth') res = setFloatDepth(ctx, args[0]);
        else if (name === 'setBait') { state.profile.sets[args[0]].bait = args[1]; ctx.refresh(); res = { ok: true }; }
        else assert.fail(`자리 봇이 ${name} 을 냈다`);
        assert.equal(res.ok, true, `${name} ${JSON.stringify(res)}`);
        if (name === 'keepCatch') { caught++; kept++; }
        if (name === 'releaseCatch') { caught++; released++; }
        assert.ok(state.profile.hold.length <= HOLD.capacity, '어창이 용량을 넘었다');
      }
      if (state.rig.phase === 'result') continue;                 // 결과 단계는 명령으로만 풀린다(§6.8)
      const before = countEvents(ctx.events, EV.HOOK_SET);
      step(ctx, inp);
      hooked += countEvents(ctx.events, EV.HOOK_SET) - before;
    }
    assert.equal(caught, 50, `${set}: 50판을 다 돌지 못했다(${caught})`);
    assert.ok(hooked >= 50);
    assert.ok(kept >= HOLD.capacity, `${set}: 어창을 채우기 전에 방생했다(keep ${kept})`);
    assert.equal(state.profile.hold.length, HOLD.capacity, `${set}: 50판 뒤 어창이 가득`);
    assert.equal(countEvents(ctx.events, EV.CATCH_KEPT), kept);
    assert.equal(evs(ctx, EV.CATCH_RELEASED).filter(e => !e.payload.swapped).length, released);
    assert.ok(countEvents(ctx.events, EV.CAST_RELEASE) >= 50);
    // 봇은 완벽 띠 근처에서 뗀다(castPower 0.90 ± 0.04)
    const powers = evs(ctx, EV.CAST_RELEASE).map(e => e.payload.power);
    const mean = powers.reduce((a, b) => a + b, 0) / powers.length;
    assert.ok(mean > 0.8 && mean <= 1, `평균 게이지 ${mean}`);
    if (set === 'float') assert.equal(state.rig.floatDepth, 1.5);
    assertFiniteDeep(state);
    void commands;
  }
});

test('createAngler: 같은 시드면 같은 행동 · reset 뒤 처음부터 같다 · 걷기 모드에서는 중립 입력', () => {
  const play = (bot) => {
    fakeAfter = 30;
    const { ctx, state } = setup({ seed: 4 });
    const sim = { getRigStats: () => ctx.rigStats };
    for (let t = 0; t < 60 * 120; t++) {
      const a = bot.decide(state, sim);
      if (a.command) {
        if (a.command.name === 'keepCatch') keepCatch(ctx, ...a.command.args);
        else releaseCatch(ctx);
      }
      if (state.rig.phase !== 'result') step(ctx, a.input);
    }
    return hashState(state);
  };
  const bot = createAngler({ strategy: 'basic', seed: 9 });
  const h1 = play(bot);
  bot.reset();
  assert.equal(play(bot), h1);
  assert.equal(play(createAngler({ strategy: 'basic', seed: 9 })), h1);
  const walk = makeTestState({ scene: 'lake' });
  const a = createAngler({ strategy: 'basic', seed: 1 }).decide(walk, { getRigStats: () => makeTestRigStats() });
  assert.equal(a.command, null);
  assert.equal(a.input.primary, false);
  assert.equal(a.input.hook, false);
  void getStage;
});
