// OWNER: P0 — 계약 §12.2(fixtures.test) · §11.6 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 고정 상태 17개: §3.4 모양 · 유한수 · structuredClone · 결정성 · 계약 식과 맞는 값 · GameSim.debugLoadState 로 이벤트 없이 선다.
// helpers 의 리터럴(makeTestRigStats · makeTestMods · makeTestState)이 실제 함수 · 모양과 같은지도 본다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RIG_PHASES } from '../src/core/constants.js';
import { EventBus } from '../src/core/events.js';
import { hashState } from '../src/core/hash.js';
import { makeRng } from '../src/core/rng.js';
import { angleDiff, fwd, shoreZAt, v2dist } from '../src/core/math.js';
import { CAST } from '../src/data/bite.js';
import { FIGHT } from '../src/data/fight.js';
import { getSpecies } from '../src/data/species/index.js';
import { getSpot, getStage } from '../src/data/stages/index.js';
import { FIXTURE_NAMES, makeFixtureState } from '../src/debug/fixtures.js';
import { computeModifiers, rigStats } from '../src/sim/progression/modifiers.js';
import { createNewProfile } from '../src/sim/progression/profile.js';
import { fightConstants } from '../src/sim/fight/fight.js';
import { GameSim } from '../src/sim/GameSim.js';
import {
  assertFiniteDeep, assertShape, countEvents, makeTestCtx, makeTestMods, makeTestProfile, makeTestRigStats, makeTestState,
  randomInputs, runTicks,
} from './helpers.js';

const APPENDIX_A = ['walkLake', 'ready', 'charging', 'waiting', 'driftRiver', 'nibble', 'take', 'fightRun', 'fightJump', 'fightStress', 'netReady', 'landing', 'result', 'failedRodBreak', 'night', 'rain', 'shopL12'];
const WITH_FIGHT = ['fightRun', 'fightJump', 'fightStress', 'netReady', 'landing'];
const PHASE = {
  walkLake: 'idle', ready: 'ready', charging: 'charging', waiting: 'waiting', driftRiver: 'waiting', nibble: 'bite', take: 'bite',
  fightRun: 'fighting', fightJump: 'fighting', fightStress: 'fighting', netReady: 'fighting', landing: 'landing', result: 'result',
  failedRodBreak: 'failed', night: 'waiting', rain: 'waiting', shopL12: 'idle',
};
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);

test('FIXTURE_NAMES 는 부록 A 의 17개 · 모르는 이름은 throw', () => {
  assert.deepEqual(FIXTURE_NAMES, APPENDIX_A);
  assert.throws(() => makeFixtureState('nope'));
});

for (const name of FIXTURE_NAMES) {
  test(`fixture ${name}: §3.4 모양 · 유한수 · 복제 · 결정성 · 계약 식`, () => {
    const s = makeFixtureState(name);
    assertShape(s, 'GameState', name);
    assertShape(s.clock, 'ClockState', `${name}.clock`);
    assertShape(s.weather, 'WeatherState', `${name}.weather`);
    assertShape(s.env, 'EnvState', `${name}.env`);
    assertShape(s.player, 'PlayerState', `${name}.player`);
    assertShape(s.rig, 'RigState', `${name}.rig`);
    assertShape(s.rig.signal, 'SignalState', `${name}.rig.signal`);
    assertShape(s.profile, 'Profile', `${name}.profile`);
    assertShape(s.profile.sets.float, 'SetConfig', `${name}.profile.sets.float`);
    assertShape(s.profile.sets.bottom, 'SetConfig', `${name}.profile.sets.bottom`);
    assertShape(s.debug, 'DebugState', `${name}.debug`);
    for (const r of s.profile.hold) assertShape(r, 'CatchRecord', `${name}.hold`);
    for (const d of Object.values(s.profile.dex)) assertShape(d, 'DexEntry', `${name}.dex`);
    assert.equal(s.fight !== null, WITH_FIGHT.includes(name), 'fight 은 이름에 맞게 있거나 null');
    assert.equal(s.pendingCatch !== null, name === 'result', 'pendingCatch 는 result 에만');
    assert.equal(s.rig.phase, PHASE[name]);
    assert.ok(RIG_PHASES.includes(s.rig.phase));
    assert.deepEqual(s.events, []);
    assertFiniteDeep(s, name);
    assert.deepEqual(structuredClone(s), s);
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
    assert.equal(hashState(makeFixtureState(name)), hashState(s), '같은 이름이면 같은 해시');

    // rig 의 파생 필드 = syncRig 식(§6.5) · RigStats 와 맞는다
    const rs = rigStats(s.profile, s.rig.set, computeModifiers(s.profile));
    assert.equal(s.rig.dragNotches, rs.dragNotches);
    assert.equal(s.rig.dragNotch, Math.min(Math.max(s.profile.sets[s.rig.set].dragNotch, 0), rs.dragNotches));
    near(s.rig.dragKg, s.rig.dragNotch * rs.dragNotchKg, 1e-9, 'dragKg');
    assert.equal(s.rig.floatDepth, s.profile.sets.float.depthM);
    near(s.rig.perfectFrom, 1 - rs.perfectWindow, 1e-12, 'perfectFrom');

    // 낚시 모드면 자리에 서 있다
    const stage = getStage(s.scene);
    if (s.player.mode === 'fish') {
      const spot = getSpot(s.player.spotId);
      assert.ok(stage.spots.includes(spot), '자리는 지금 씬의 것');
      assert.deepEqual(s.player.pos, spot.stand);
      assert.deepEqual(s.rig.origin, spot.stand);
      if (['waiting', 'bite', 'fighting', 'landing'].includes(s.rig.phase)) {
        assert.ok(s.rig.castBaitId !== null, '물속 미끼(castBaitId)');
        near(v2dist(s.rig.origin, s.rig.bobber), s.rig.dist, 1e-9, 'bobber 거리');
        const margin = ['waiting', 'bite'].includes(s.rig.phase) ? CAST.shoreMarginM : 0;   // 찌는 물가에서 1m 안쪽 · 파이팅 입수점은 물가 너머
        assert.ok(s.rig.bobber.z < shoreZAt(stage.shore, s.rig.bobber.x) - margin, '찌 · 입수점은 물 위');
        assert.ok(Math.abs(angleDiff(spot.facing, s.rig.bearing)) <= CAST.driftArc, 'facing ± driftArc');
      }
    } else {
      assert.equal(s.player.spotId, null);
      assert.equal(s.rig.phase, 'idle');
    }
    assert.equal(s.env.headlamp, stage.kind === 'outdoor' && s.clock.night);

    if (s.fight) {
      const f = s.fight;
      assertShape(f, 'FightState', `${name}.fight`);
      assertShape(f.stats, 'FightStats', `${name}.fight.stats`);
      assertShape(f.roll, 'FishRoll', `${name}.fight.roll`);
      const spot = getSpot(s.player.spotId);
      const k = fightConstants(getSpecies(f.speciesId), f.roll);
      near(f.k.Fmax, k.Fmax, 1e-12, 'k.Fmax');
      near(f.k.vmax, k.vmax, 1e-12, 'k.vmax');
      near(f.k.endurance, k.endurance, 1e-12, 'k.endurance');
      near(f.lineKg, rs.lineKg, 1e-12, 'lineKg');
      near(f.lineEffKg, f.lineKg * (1 - f.abrasion), 1e-12, 'lineEffKg');
      assert.equal(f.rodUp, f.rodLift >= 0.5);
      near(f.limitKg, f.rodUp ? Math.min(f.lineEffKg, rs.rodMaxLoadKg) : f.lineEffKg, 1e-12, 'limitKg');
      near(f.limitRatio, f.tension / f.limitKg, 1e-12, 'limitRatio');
      near(f.tensionRatio, f.tension / f.lineEffKg, 1e-12, 'tensionRatio');
      near(f.rodLoadRatio, f.tension / rs.rodMaxLoadKg, 1e-12, 'rodLoadRatio');
      assert.equal(f.rodStress, f.rodUp && f.rodLoadRatio >= FIGHT.rodStressAt);
      assert.equal(f.lineDanger, f.tensionRatio >= FIGHT.lineDangerAt);
      near(f.minDist, spot.edgeM + FIGHT.minDistPad, 1e-12, 'minDist');
      near(f.netRangeM, spot.edgeM + rs.netReachM, 1e-12, 'netRangeM');
      assert.equal(f.canNet, f.dist <= f.netRangeM && f.stamina <= rs.landStamina);
      assert.equal(f.inSnag, f.dist >= spot.snag.fromM);
      near(f.spoolLeftM, s.profile.sets[s.rig.set].lineM - f.dist, 1e-9, 'spoolLeftM');
      assert.ok(f.dist >= f.minDist, '물고기는 물가 너머');
      assert.ok(Math.abs(angleDiff(spot.facing, f.bearing)) <= f.halfArc, 'bearing 은 halfArc 안');
      assert.equal(f.showStamina, rs.showStamina);
      assert.deepEqual(f.traits, getSpecies(f.speciesId).traits);
      const pos = fwd(f.bearing, f.dist);
      near(s.rig.bobber.x, spot.stand.x + pos.x, 1e-9, '입수점 x');
    }
  });
}

test('fixture 장면별 값 — §11.6 표', () => {
  const run = makeFixtureState('fightRun').fight;
  assert.equal(run.speciesId, 'carp');
  assert.equal(run.roll.tier, 'trophy');
  near(run.roll.weightKg, 7.3, 0.15, '잉어 트로피 무게');
  assert.equal(run.behavior, 'run');
  assert.ok(run.slipping && run.slipSpeed > 0, 'slipping · 클리커');
  near(run.tension, makeFixtureState('fightRun').rig.dragKg, 1e-12, '텐션 = 드랙');
  assert.equal(run.dist, 35);

  const jump = makeFixtureState('fightJump').fight;
  assert.equal(jump.speciesId, 'largemouthBass');
  assert.equal(jump.behavior, 'jump');
  near(jump.airborne, 0.8, 1e-9, 'airborne');
  near(jump.airborne, Math.sin(Math.PI * jump.behaviorT / jump.behaviorDur), 1e-12, 'airborne 식');
  assert.ok(jump.rodUp);
  assert.equal(jump.depth, 0);

  const stress = makeFixtureState('fightStress').fight;
  assert.equal(stress.speciesId, 'carp');
  near(stress.rodLoadRatio, 0.92, 1e-9, '로드 상한 92%');
  assert.ok(stress.rodStress && stress.lineDanger && stress.rodUp);
  assert.equal(stress.limitBy, 'rod');
  assert.ok(!stress.slipping, '드랙이 버틴다');
  assert.ok(stress.tension <= makeFixtureState('fightStress').rig.dragKg);

  const net = makeFixtureState('netReady').fight;
  assert.equal(net.speciesId, 'crucian');
  assert.equal(net.dist, 2.4);
  assert.ok(net.canNet);

  const landing = makeFixtureState('landing');
  near(landing.rig.phaseTime, 0.4, 1e-12, 'landing phaseTime');
  assert.equal(landing.fight.speciesId, 'crucian');

  const res = makeFixtureState('result');
  const c = res.pendingCatch;
  assertShape(c, 'CatchRecord', 'pendingCatch');
  assert.equal(c.speciesId, 'carp');
  assert.equal(c.tier, 'trophy');
  assert.equal(c.firstCatch, true);
  assert.equal(c.recordWeight, false, '첫 포획은 신기록에서 제외(§3.5)');
  assert.ok(!('carp' in res.profile.dex), '잉어는 아직 도감에 없다(첫 포획)');
  assert.equal(res.profile.hold.length, 11);
  assert.equal(c.uid, res.profile.nextUid);
  const sp = getSpecies('carp');
  assert.equal(c.price, Math.round(sp.pricePerKg * c.weightKg * sp.priceMul.trophy));
  assert.ok(c.xpKeep > 0 && c.xpRelease === Math.round(c.xpKeep * 0.7));
  assert.deepEqual(new Set(res.profile.hold.map(h => h.uid)).size, 11);

  const broke = makeFixtureState('failedRodBreak');
  const loss = broke.rig.lastLoss;
  assertShape(loss, 'LossReport', 'lastLoss');
  assert.equal(broke.rig.failReason, 'rodBreak');
  assert.equal(loss.rodLost, 'rod_bottom_2');
  assert.equal(broke.profile.sets.bottom.rod, 'rod_bottom_1', '예비 1단계 로드');
  assert.equal(broke.profile.owned.rod_bottom_2 ?? 0, 0);
  const brs = rigStats(broke.profile, 'bottom', computeModifiers(broke.profile));
  near(loss.dragKgAfter, broke.rig.dragKg, 1e-12, 'dragKgAfter = 지금 드랙');
  assert.ok(loss.dragKgAfter <= 0.9 * brs.rodMaxLoadKg && loss.dragKgAfter + brs.dragNotchKg > 0.9 * brs.rodMaxLoadKg, '0.9 × 상한 아래 가장 가까운 눈금');
  assert.ok(broke.profile.level >= 5, '2단계는 레벨 5부터');

  const charging = makeFixtureState('charging').rig;
  near(charging.power, 0.9, 1e-9, 'power');
  near(charging.aimPreview.distM, 28, 0.5, 'aimPreview ≈ 28m');
  assert.ok(charging.power < charging.perfectFrom, '완벽 띠 바로 아래');

  const waiting = makeFixtureState('waiting');
  const wrs = rigStats(waiting.profile, 'float', computeModifiers(waiting.profile));
  assert.equal(waiting.rig.set, 'float');
  near(waiting.rig.dist, wrs.castMaxM, 1e-9, '최대 비거리');
  assert.equal(waiting.rig.floatDepth, 2);

  const drift = makeFixtureState('driftRiver');
  assert.equal(drift.player.spotId, 'river_tailrace');
  assert.ok(drift.rig.drifting && drift.rig.bailOpen);
  assert.equal(drift.rig.dist, 70);
  assert.ok(drift.rig.dist <= Math.min(getSpot('river_tailrace').maxDriftM, drift.profile.sets.float.lineM - CAST.driftReserveM));

  assert.equal(makeFixtureState('nibble').rig.signal.kind, 'nibble');
  assert.equal(makeFixtureState('nibble').rig.layer, 'bottom', '붕어 — 바닥층');
  const take = makeFixtureState('take').rig;
  assert.equal(take.signal.kind, 'take');
  assert.ok(take.hookWindow.open && take.hookWindow.remaining === take.hookWindow.total);

  const night = makeFixtureState('night');
  assert.ok(night.env.headlamp && night.clock.night);
  near(night.clock.hour, 22, 1e-9, '22:00');
  const rain = makeFixtureState('rain');
  assert.equal(rain.weather.current, 'rain');
  assert.equal(rain.env.rain, 1);
  assert.equal(rain.player.spotId, 'coast_channel');
  near(rain.clock.hour, 18.5, 1e-9, '18:30');

  const shop = makeFixtureState('shopL12');
  assert.equal(shop.scene, 'home');
  assert.equal(shop.profile.level, 12);
  assert.equal(shop.profile.money, 3000000);
  assert.equal(shop.profile.skills.mastery, 2);
  assert.ok(Object.values(shop.profile.owned).some(n => n > 0));
  assert.equal(shop.player.nearby.kind, 'pc');

  const walk = makeFixtureState('walkLake');
  assert.equal(walk.player.nearby.kind, 'npc');
  assert.ok(walk.player.nearby.dist <= getStage('lake').points.find(p => p.kind === 'npc').radius);
});

test('GameSim.debugLoadState: 고정 상태를 이벤트 없이 세우고 ctx 를 다시 계산한다(?fixture 경로)', () => {
  for (const name of FIXTURE_NAMES) {
    const bus = new EventBus();
    const seen = [];
    bus.onAny(n => seen.push(n));
    const sim = new GameSim({ bus, seed: 1 });
    sim.start();
    seen.length = 0;
    const before = sim.state;
    const fx = makeFixtureState(name);
    sim.debugLoadState(fx);
    assert.equal(sim.state, before, `${name}: 같은 상태 객체`);
    assert.deepEqual(seen, [], `${name}: 이벤트 없음`);
    assert.equal(hashState(sim.state), hashState(fx), `${name}: 상태가 그대로`);
    assert.equal(sim.ctx.stage, getStage(fx.scene));
    assert.equal(sim.ctx.spot, fx.player.spotId ? getSpot(fx.player.spotId) : null);
    assert.deepEqual(sim.ctx.rigStats, rigStats(fx.profile, fx.rig.set, computeModifiers(fx.profile)));
    const expect = makeRng({ s: fx.rng.s }).next();
    assert.equal(sim.ctx.rng.next(), expect, `${name}: ctx.rng 가 불러온 rng 상태를 쓴다`);
  }
});

test('helpers: 리터럴이 실제 함수 · 계약 모양과 같다', () => {
  const p = createNewProfile();
  assert.deepEqual(makeTestProfile(), p, 'makeTestProfile = createNewProfile');
  assert.deepEqual(makeTestMods(), computeModifiers(p), 'makeTestMods = 스킬 0 의 computeModifiers');
  for (const set of ['float', 'bottom']) {
    assert.deepEqual(makeTestRigStats(set), rigStats(p, set, computeModifiers(p)), `makeTestRigStats(${set}) = rigStats`);
    assertShape(makeTestRigStats(set), 'RigStats');
  }
  assert.equal(makeTestRigStats('bottom', { lineKg: 8 }).lineKg, 8);
  assertShape(makeTestMods(), 'Modifiers');

  for (const opts of [{}, { spotId: 'lake_gravel' }, { spotId: 'coast_channel', set: 'float', hour: 22, weather: 'rain' }, { scene: 'home' }]) {
    const s = makeTestState(opts);
    assertShape(s, 'GameState');
    assertShape(s.rig, 'RigState');
    assertShape(s.player, 'PlayerState');
    assertShape(s.clock, 'ClockState');
    assertFiniteDeep(s);
    const ctx = makeTestCtx(s);
    const before = structuredClone(s.rig);
    ctx.refresh();
    assert.deepEqual(s.rig, { ...before, perfectFrom: s.rig.perfectFrom }, 'refresh(syncRig) 뒤에도 rig 가 그대로(리터럴이 profile 과 맞다)');
    ctx.emit('x/y', { a: 1 });
    assert.equal(countEvents(ctx.events, 'x/y'), 1);
    assert.equal(countEvents(s.events, 'x/y'), 1);
  }
  const fish = makeTestState({ spotId: 'lake_gravel' });
  assert.equal(fish.player.mode, 'fish');
  assert.equal(fish.rig.phase, 'ready');
  assert.deepEqual(fish.rig.origin, getSpot('lake_gravel').stand);
  assert.equal(makeTestState({ spotId: 'lake_gravel', hour: 22 }).env.headlamp, true);

  // 리터럴 시계 = GameSim 의 시계 — 리터럴은 맑음이므로 같은 날씨로 비교한다(W1 확정: 실제 날씨는 시드 해시라 seed 1 · 1일 · lake 는 비)
  const sim = new GameSim({ bus: new EventBus(), seed: 1, start: { scene: 'lake', hour: 8, weather: 'clear' } });
  assert.deepEqual(makeTestState({ hour: 8 }).clock, sim.state.clock);
  const simRain = new GameSim({ bus: new EventBus(), seed: 1, start: { scene: 'lake', hour: 8 } });
  assert.deepEqual(makeTestState({ hour: 8, weather: simRain.state.weather.current }).clock, simRain.state.clock, '시드 날씨에서도 리터럴 시계 = GameSim 시계');

  const gen = randomInputs(5);
  assert.deepEqual(gen(123), gen(123), 'randomInputs 는 (seed, tick) 의 함수');
  assert.notDeepEqual(randomInputs(6)(123), gen(123));
  let n = 0;
  runTicks(5, () => n++);
  assert.equal(n, 5);
  assert.throws(() => assertFiniteDeep({ a: { b: [1, NaN] } }), /a\.b\[1\]/);
});
