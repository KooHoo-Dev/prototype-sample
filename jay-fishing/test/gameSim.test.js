// OWNER: P3 — 계약 §12.2(gameSim) · §6.3 · §5.1 · §4.1 · §12.3
// 틱 순서 · 재진입 안전 플러시 · 명령 결과 모양 · ctx.stage/spot · newGame 리셋 · debugLoadState · debugForceFight
// · 세이브 → 새 GameSim → 같은 프로필 · 패널 없이 1시간 예외 0 · 결정성.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TICKS_PER_DAY, TICKS_PER_HOUR, GAME_ID, SAVE_VERSION } from '../src/core/constants.js';
import { EV, EventBus } from '../src/core/events.js';
import { hashState } from '../src/core/hash.js';
import { makeInput, NEUTRAL_INPUT } from '../src/core/inputFrame.js';
import { seedRng } from '../src/core/rng.js';
import { TIME } from '../src/data/time.js';
import { WORLD } from '../src/data/world.js';
import { getStage } from '../src/data/stages/index.js';
import { FIXTURE_NAMES, makeFixtureState } from '../src/debug/fixtures.js';
import { GameSim } from '../src/sim/GameSim.js';
import { fightImpl } from '../src/sim/fishing/rig.js';
import { createNewProfile } from '../src/sim/progression/profile.js';
import { assertFiniteDeep, assertShape, randomInputs } from './helpers.js';

function makeSim(opts = {}) {
  const bus = new EventBus();
  const log = [];
  bus.onAny((name, payload) => log.push({ name, payload }));
  const sim = new GameSim({ bus, seed: 7, ...opts });
  sim.start();
  log.length = 0;
  return { sim, bus, log };
}
const names = (log) => log.map(e => e.name);

/** 파이팅을 P2 없이 — 고정 상태의 FightState 를 돌려주는 가짜 */
function withFakeFight(fn) {
  const orig = { ...fightImpl };
  const proto = makeFixtureState('fightRun').fight;
  fightImpl.createFight = (ctx, { speciesId, roll, dist, bearing, depth }) => ({
    ...structuredClone(proto), speciesId, roll, dist, prevDist: dist, bearing, prevBearing: bearing, depth, t: 0,
  });
  fightImpl.updateFight = () => null;
  try { fn(); } finally { Object.assign(fightImpl, orig); }
}

test('생성자는 이벤트를 내지 않는다 · start() 가 SCENE_CHANGED → PLAYER_PLACED → WEATHER_CHANGED · 상태 모양', () => {
  const bus = new EventBus();
  const log = [];
  bus.onAny(n => log.push(n));
  const sim = new GameSim({ bus, seed: 3 });
  assert.equal(log.length, 0);
  assert.equal(sim.state.events.length, 0);
  assertShape(sim.state, 'GameState');
  assertShape(sim.state.clock, 'ClockState');
  assertShape(sim.state.player, 'PlayerState');
  assertShape(sim.state.env, 'EnvState');
  assertShape(sim.state.rig, 'RigState');
  assertFiniteDeep(sim.state);
  assert.equal(sim.state.scene, 'home');
  assert.equal(sim.state.clock.day, TIME.startDay);
  assert.equal(sim.state.clock.tickInDay, TIME.startHour * TICKS_PER_HOUR);
  assert.equal(sim.ctx.stage.id, 'home');
  assert.equal(sim.ctx.spot, null);
  assert.ok(sim.ctx.mods && sim.ctx.rigStats);
  structuredClone(sim.state);
  JSON.stringify(sim.state);
  sim.start();
  assert.deepEqual(log, [EV.SCENE_CHANGED, EV.PLAYER_PLACED, EV.WEATHER_CHANGED]);
  // start.spotId → 그 자리에서 낚시 모드
  const f = makeSim({ start: { spotId: 'lake_cape' } });
  assert.equal(f.sim.state.scene, 'lake');
  assert.equal(f.sim.state.player.mode, 'fish');
  assert.equal(f.sim.ctx.spot.id, 'lake_cape');
  assert.equal(f.sim.ctx.stage.id, 'lake');
  // 잘못된 start 값은 무시
  const g = makeSim({ start: { scene: 'mars', spotId: 'nowhere', hour: NaN, weather: 'snow' } });
  assert.equal(g.sim.state.scene, 'home');
  assertFiniteDeep(g.sim.state);
});

test('틱 순서(§5.1): tick → 직전 값 → 시계 → 시선 → 걷기(새 시선으로) → 플러시', () => {
  const { sim, log } = makeSim({ start: { scene: 'lake', hour: 8 } });
  const s = sim.state;
  const before = { ...s.player.pos };
  const t0 = s.clock.tickInDay;
  // 첫 틱: yaw π/2(−X) 로 앞 → 같은 틱의 이동이 새 시선을 따른다
  sim.step(makeInput({ yaw: Math.PI / 2, pitch: 0.3, moveZ: 1 }));
  assert.equal(s.tick, 1);
  assert.equal(s.clock.tickInDay, t0 + 1);
  assert.equal(s.player.yaw, Math.PI / 2);
  assert.equal(s.player.pitch, 0.3);
  assert.deepEqual(s.player.prevPos, before);
  assert.ok(s.player.pos.x < before.x, '−X 로 움직였다');
  assert.ok(Math.abs(s.player.pos.z - before.z) < 1e-9);
  const p1 = { ...s.player.pos };
  sim.step(makeInput({ yaw: NaN, pitch: 9, moveZ: 1 }));
  assert.equal(s.player.yaw, Math.PI / 2, '유한수가 아니면 직전 값');
  assert.equal(s.player.pitch, WORLD.pitchMax, 'pitch 는 자른다');
  assert.deepEqual(s.player.prevPos, p1);
  assert.notEqual(s.player.prevPos, s.player.pos);
  assert.equal(s.events.length, 0, '플러시 뒤 큐는 비어 있다');
  // 시간대가 바뀌는 틱: 이벤트가 그 틱 끝에 나간다
  sim.debugSetTime(11 - 1 / TICKS_PER_HOUR);
  log.length = 0;
  sim.step(NEUTRAL_INPUT);
  assert.deepEqual(names(log), [EV.CLOCK_BAND]);
  // 결정성의 정본 — 입력 없이는 시계만 간다
  sim.step(undefined);
  assert.equal(s.tick, 4);
});

test('플러시는 재진입에 안전하다 — 리스너가 명령을 불러도 순서가 어긋나지 않는다 · 예외는 전파되고 다음 플러시는 돈다', () => {
  const { sim, bus, log } = makeSim();
  let inner = null;
  const off = bus.on(EV.SCENE_CHANGED, () => { inner = sim.markHintSeen('stage'); });
  sim.travel('lake');
  off();
  assert.deepEqual(inner, { ok: true });
  const n = names(log);
  const iScene = n.indexOf(EV.SAVE_REQUEST);
  const saves = log.filter(e => e.name === EV.SAVE_REQUEST).map(e => e.payload.reason);
  assert.deepEqual(saves, ['scene', 'hint'], '바깥 틱의 이벤트가 다 나간 뒤에 안쪽 명령의 이벤트');
  assert.equal(n[n.length - 1], EV.SAVE_REQUEST);
  assert.equal(log[log.length - 1].payload.reason, 'hint');
  assert.ok(iScene > n.indexOf(EV.CLOCK_SKIP));
  assert.equal(n.filter(x => x === EV.SCENE_CHANGED).length, 1, '같은 이벤트를 두 번 내지 않는다');
  assert.equal(sim.state.events.length, 0);
  assert.equal(sim._flushing, false);
  // 리스너 예외: 삼키지 않는다 → 그 뒤 명령도 정상 플러시
  const off2 = bus.on(EV.CLOCK_SKIP, () => { throw new Error('boom'); });
  assert.throws(() => sim.waitNextBand(), /boom/);
  off2();
  assert.equal(sim._flushing, false);
  log.length = 0;
  sim.waitNextBand();
  assert.ok(names(log).includes(EV.CLOCK_SKIP));
  assert.equal(sim.state.events.length, 0);
  // step 안의 리스너가 명령을 불러도 같은 규칙
  const { sim: s2, bus: b2, log: l2 } = makeSim({ start: { scene: 'lake', hour: 11 - 1 / TICKS_PER_HOUR } });
  b2.once(EV.CLOCK_BAND, () => s2.markHintSeen('controls'));
  s2.step(NEUTRAL_INPUT);
  assert.deepEqual(names(l2), [EV.CLOCK_BAND, EV.SAVE_REQUEST]);
});

test('명령 결과 모양: {ok:true, …} | {ok:false, reason, params?}', () => {
  const { sim } = makeSim();
  const isResult = (r) => {
    assert.equal(typeof r.ok, 'boolean');
    if (!r.ok) {
      assert.equal(typeof r.reason, 'string');
      if ('params' in r) assert.equal(typeof r.params, 'object');
    }
    return r;
  };
  assert.deepEqual(isResult(sim.travel('coast')), { ok: false, reason: 'locked', params: { n: 5 } });
  assert.deepEqual(isResult(sim.exitFishing()), { ok: false, reason: 'notHere' });
  assert.deepEqual(isResult(sim.waitNextBand()), { ok: false, reason: 'notHere' });
  assert.deepEqual(isResult(sim.markHintSeen('nope')), { ok: false, reason: 'invalid' });
  assert.deepEqual(isResult(sim.markHintSeen('start')), { ok: true });
  assert.equal(sim.state.profile.flags.hints.start, true);
  assert.deepEqual(isResult(sim.refillLine('middle')), { ok: false, reason: 'invalid' });
  assert.deepEqual(isResult(sim.debugGotoScene('mars')), { ok: false, reason: 'invalid' });
  assert.deepEqual(isResult(sim.debugGotoSpot('mars_pier')), { ok: false, reason: 'invalid' });
  assert.deepEqual(isResult(sim.debugSetTime(NaN)), { ok: false, reason: 'invalid' });
  assert.deepEqual(isResult(sim.debugSetGear('rod', 'reel_2', 'float')), { ok: false, reason: 'invalid' });
  assert.deepEqual(isResult(sim.debugSetGear('rod', 'rod_bottom_2', 'float')), { ok: false, reason: 'wrongSet' });
  isResult(sim.keepCatch());
  isResult(sim.releaseCatch());
  isResult(sim.sellAll());
  isResult(sim.sellOne(999));
  isResult(sim.buy('bait_worm', 1));
  isResult(sim.refillLine('float'));
  isResult(sim.setBait('float', 'worm'));
  isResult(sim.setDepth(2));
  isResult(sim.learnSkill('casting'));
  assert.equal(sim.keepCatch().ok, false, 'result 밖');
  // 파이팅 중에는 장착 · 이동 · 캠프가 busy
  withFakeFight(() => {
    sim.debugForceFight('carp', 0.5);
    assert.equal(sim.state.rig.phase, 'fighting');
    assert.deepEqual(isResult(sim.equip('float', 'rod', 'rod_float_1')), { ok: false, reason: 'busy' });
    assert.deepEqual(isResult(sim.travel('home')), { ok: false, reason: 'busy' });
    assert.deepEqual(isResult(sim.waitNextBand()), { ok: false, reason: 'busy' });
  });
  // 조회 모양
  const q = sim.getSellQuote();
  assert.ok(Array.isArray(q.items) && typeof q.total === 'number');
  const fc = sim.getForecast();
  for (const id of ['lake', 'coast', 'river']) {
    assert.ok(['clear', 'cloudy', 'rain'].includes(fc.today[id]));
    assert.ok(['clear', 'cloudy', 'rain'].includes(fc.tomorrow[id]));
    assert.deepEqual(Object.keys(fc.activeByBand[id]), ['dawn', 'morning', 'day', 'evening', 'night']);
  }
  assert.equal(typeof sim.hash(), 'string');
  assert.equal(sim.getRigStats('bottom').set, 'bottom');
});

test('getForecast: 어종 지식 1 이상이면 시간대별 활동 H 어종(판타지 제외)', () => {
  const { sim } = makeSim();
  const fc0 = sim.getForecast();
  assert.equal(fc0.activeByBand.lake.dawn.length, 0, '지식 0 이면 비운다');
  sim.ctx.mods = { ...sim.ctx.mods, knowledge: 1 };
  const fc = sim.getForecast();
  assert.ok(fc.activeByBand.lake.dawn.includes('crucian'));
  assert.ok(!Object.values(fc.activeByBand.lake).flat().includes('goldenDragon'));
});

test('집의 line_1 감기: getShop · buy · refillLine 이 같은 값(무료) · 야외는 유료(W1 확정)', () => {
  const { sim } = makeSim();
  assert.equal(sim.state.scene, 'home');
  const p = sim.state.profile;
  p.money = 0;
  p.sets.float.lineM = 60;
  sim.ctx.refresh();
  const item = sim.getShop().find(i => i.id === 'refill_float_line_1');
  assert.equal(item.price, 0);
  assert.equal(item.ok, true, '돈 0 이어도 집에서는 감을 수 있다');
  const full = sim.getShop().find(i => i.id === 'refill_bottom_line_1');
  assert.equal(full.reason, 'full');
  const r = sim.buy('refill_float_line_1');
  assert.equal(r.ok, true);
  assert.equal(r.cost, 0);
  assert.equal(p.money, 0);
  assert.equal(p.sets.float.lineM, sim.getRigStats('float').spoolCapM);
  assert.deepEqual(sim.buy('refill_float'), { ok: false, reason: 'invalid' });
  sim.debugGotoScene('lake');
  p.sets.float.lineM = 60;
  sim.ctx.refresh();
  const out = sim.getShop().find(i => i.id === 'refill_float_line_1');
  assert.ok(out.price > 0, '야외는 판매상 단가');
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'money');
  assert.equal(sim.buy('refill_float_line_1').reason, 'money');
});

test('ctx.stage · ctx.spot 은 바뀐 그 자리에서 맞춰진다', () => {
  const { sim } = makeSim();
  sim.travel('lake');
  assert.equal(sim.ctx.stage, getStage('lake'));
  assert.equal(sim.ctx.spot, null);
  sim.debugGotoSpot('lake_shallows');
  assert.equal(sim.ctx.spot.id, 'lake_shallows');
  assert.equal(sim.state.player.spotId, 'lake_shallows');
  assert.equal(sim.state.rig.phase, 'ready');
  sim.exitFishing();
  assert.equal(sim.ctx.spot, null);
  assert.equal(sim.state.player.mode, 'walk');
  sim.debugGotoScene('river');
  assert.equal(sim.ctx.stage.id, 'river');
  assert.equal(sim.state.scene, 'river');
  sim.debugGotoSpot('lake_cape');   // 다른 씬의 자리 → 씬부터
  assert.equal(sim.ctx.stage.id, 'lake');
  assert.equal(sim.ctx.spot.id, 'lake_cape');
  // 낚시 중의 debugGotoScene 은 낚시를 남김없이 정리한다
  sim.debugGotoScene('home');
  assert.equal(sim.state.player.mode, 'walk');
  assert.equal(sim.ctx.spot, null);
  assert.equal(sim.state.rig.phase, 'idle');
  sim.newGame(5);
  assert.equal(sim.ctx.stage.id, 'home');
  assert.equal(sim.ctx.spot, null);
});

test('newGame: 파이팅 · 결과 대기 · 낚시 모드 · 옛 시드 · 옛 프로필이 남지 않는다(새로 만든 것과 같은 해시)', () => {
  for (const name of ['fightRun', 'result', 'landing', 'shopL12']) {
    const { sim, log } = makeSim({ seed: 1 });
    sim.debugLoadState(makeFixtureState(name));
    const prof = sim.state.profile;
    const rng = sim.state.rng;
    sim.state.debug.noBites = true;
    log.length = 0;
    assert.deepEqual(sim.newGame(77), { ok: true });
    const s = sim.state;
    assert.equal(s.fight, null, name);
    assert.equal(s.pendingCatch, null);
    assert.equal(s.scene, 'home');
    assert.equal(s.player.mode, 'walk');
    assert.equal(s.player.spotId, null);
    assert.equal(s.rig.phase, 'idle');
    assert.equal(s.seed, 77);
    assert.equal(s.rng.s, seedRng(77).s);
    assert.equal(s.rng, rng, 'rng 는 같은 객체(ctx.rng 가 붙들고 있다)');
    assert.equal(s.profile, prof, '프로필은 같은 객체에 내용만');
    assert.deepEqual(s.profile, createNewProfile());
    assert.equal(s.clock.day, TIME.startDay);
    assert.equal(s.clock.tickInDay, TIME.startHour * TICKS_PER_HOUR);
    assert.equal(s.debug.noBites, false);
    assert.equal(sim.ctx.spot, null);
    assert.equal(sim.ctx.stage.id, 'home');
    const n = names(log);
    const tail = n.filter(x => x !== EV.FISHING_EXIT);
    assert.deepEqual(tail, [EV.SCENE_CHANGED, EV.PLAYER_PLACED, EV.WEATHER_CHANGED, EV.SAVE_REQUEST]);
    assert.deepEqual(log.find(e => e.name === EV.SCENE_CHANGED).payload, { from: makeFixtureState(name).scene, to: 'home', reason: 'new' });
    assert.equal(log.find(e => e.name === EV.PLAYER_PLACED).payload.reason, 'spawn');
    assert.deepEqual(log[log.length - 1].payload, { reason: 'new' });
    // 새로 만든 GameSim 과 같은 상태
    const fresh = new GameSim({ bus: new EventBus(), seed: 77 });
    fresh.state.session = { ...s.session };
    assert.equal(hashState(s), hashState(fresh.state), name);
    assert.deepEqual(sim.ctx.rigStats, fresh.ctx.rigStats);
    // 그 뒤로 돌려도 같다
    for (let i = 0; i < 300; i++) { sim.step(NEUTRAL_INPUT); fresh.step(NEUTRAL_INPUT); }
    assert.equal(sim.hash(), fresh.hash());
  }
});

test('debugLoadState: 고정 상태를 같은 객체에 덮어쓴다 · ctx 를 다시 계산 · syncRig 없이 · 이벤트 없음', () => {
  const { sim, log } = makeSim();
  const stateRef = sim.state;
  const rngRef = sim.state.rng;
  for (const name of FIXTURE_NAMES) {
    const fx = makeFixtureState(name);
    log.length = 0;
    assert.deepEqual(sim.debugLoadState(fx), { ok: true });
    assert.equal(log.length, 0, `${name}: 이벤트 없음`);
    assert.equal(sim.state, stateRef);
    assert.equal(sim.state.rng, rngRef);
    assert.equal(sim.state.events.length, 0);
    assert.equal(sim.ctx.stage.id, fx.scene, name);
    assert.equal(sim.ctx.spot ? sim.ctx.spot.id : null, fx.player.spotId, name);
    assert.equal(sim.ctx.rigStats.set, fx.rig.set, name);
    assert.deepEqual(sim.state.rig, fx.rig, `${name}: rig 는 고정 값 그대로`);
    assert.equal(hashState(sim.state), hashState(fx), name);
    assert.notEqual(sim.state.player, fx.player, '사본을 쓴다');
    // 조회가 그 상태로 돈다
    sim.getTravel();
    sim.getForecast();
    sim.getSellQuote();
  }
});

test('debugForceFight: 집에서도 lake_gravel 에 서서 입질 · 챔질을 건너뛰고 fighting(HOOK_SET → 파이팅)', () => {
  withFakeFight(() => {
    const { sim, log } = makeSim();
    const r = sim.debugForceFight('carp', 0.9);
    assert.deepEqual(r, { ok: true });
    const s = sim.state;
    assert.equal(s.scene, 'lake');
    assert.equal(s.player.spotId, 'lake_gravel');
    assert.equal(sim.ctx.spot.id, 'lake_gravel');
    assert.equal(s.rig.phase, 'fighting');
    assert.ok(s.fight);
    assert.equal(s.fight.speciesId, 'carp');
    assert.ok(s.rig.dist > 0);
    assert.equal(s.rig.castBaitId, s.profile.sets[s.rig.set].bait);
    const n = names(log);
    assert.ok(n.indexOf(EV.SCENE_CHANGED) < n.indexOf(EV.FISHING_ENTER));
    assert.ok(n.indexOf(EV.FISHING_ENTER) < n.indexOf(EV.HOOK_SET));
    // 파이팅 중 step 은 prevDist · prevBearing 을 복사한다
    s.fight.dist = 12.5;
    sim.step(NEUTRAL_INPUT);
    assert.equal(s.fight.prevDist, 12.5);
    // 모르는 어종은 invalid
    const b = makeSim();
    assert.equal(b.sim.debugForceFight('nessie', 0.5).ok, false);
  });
});

test('debugSkipToResult · debugGrant · debugSetGear · debugNoBites', () => {
  const { sim, log } = makeSim();
  assert.equal(sim.debugSkipToResult().ok, true);
  assert.equal(sim.state.rig.phase, 'result');
  assert.ok(sim.state.pendingCatch);
  assert.equal(sim.state.pendingCatch.spotId, 'lake_gravel');
  assert.equal(sim.state.pendingCatch.stageId, 'lake');
  log.length = 0;
  sim.debugGrant({ money: 1234 });
  assert.equal(sim.state.profile.money, createNewProfile().money + 1234);
  assert.deepEqual(log.find(e => e.name === EV.MONEY_CHANGED).payload, { money: sim.state.profile.money, delta: 1234, reason: 'grant' });
  sim.debugGrant({ money: -1e12 });
  assert.equal(sim.state.profile.money, 0, '돈은 음수가 되지 않는다');
  assert.equal(sim.releaseCatch().ok, true);
  assert.equal(sim.state.rig.phase, 'ready');
  assert.deepEqual(sim.debugSetGear('reel', 'reel_3', 'bottom'), { ok: true });
  assert.equal(sim.state.profile.sets.bottom.reel, 'reel_3');
  assert.deepEqual(sim.debugSetGear('line', 'line_3', 'bottom'), { ok: true });
  assert.equal(sim.state.profile.sets.bottom.lineId, 'line_3');
  assert.equal(sim.state.profile.sets.bottom.lineM, 300);
  assert.equal(sim.getRigStats('bottom').reelMaxDragKg, 16);
  assert.deepEqual(sim.debugNoBites(true), { ok: true });
  assert.equal(sim.state.debug.noBites, true);
});

test('세이브 → 새 GameSim → 같은 프로필 · 시계 · 씬(spawn 에 걷기) · 깨진 세이브에서 던지지 않는다', () => {
  const { sim } = makeSim({ seed: 4242 });
  sim.travel('lake');
  const p = sim.state.profile;
  p.money = 12345;
  p.baits.worm = 3;
  p.flags.hints.start = true;
  p.sets.float.depthM = 2.5;
  p.stats.casts = 9;
  sim.debugSetTime(15.25);
  const save = JSON.parse(JSON.stringify({
    game: GAME_ID, version: SAVE_VERSION, savedAt: 0, seed: sim.state.seed,
    clock: { day: sim.state.clock.day, tickInDay: sim.state.clock.tickInDay }, scene: sim.state.scene, profile: p,
  }));
  const bus = new EventBus();
  const seen = [];
  bus.onAny(n => seen.push(n));
  const loaded = new GameSim({ bus, seed: 1, save });
  assert.deepEqual(loaded.state.profile, sim.state.profile);
  assert.equal(loaded.state.seed, 4242);
  assert.equal(loaded.state.scene, 'lake');
  assert.equal(loaded.state.clock.day, sim.state.clock.day);
  assert.equal(loaded.state.clock.tickInDay, sim.state.clock.tickInDay);
  assert.deepEqual(loaded.state.weather, sim.state.weather);
  const lake = getStage('lake');
  assert.deepEqual(loaded.state.player.pos, { x: lake.spawn.x, z: lake.spawn.z });
  assert.equal(loaded.state.player.mode, 'walk');
  assert.equal(loaded.ctx.stage.id, 'lake');
  assert.equal(loaded.state.rig.floatDepth, 2.5);
  loaded.start();
  assert.equal(seen[0], EV.SCENE_CHANGED);
  // 깨진 세이브(범위 밖 · 모르는 씬)
  const bad = { ...save, scene: 'mars', clock: { day: NaN, tickInDay: 1e12 } };
  const b = new GameSim({ bus: new EventBus(), seed: 1, save: bad });
  assert.equal(b.state.scene, 'home');
  assert.equal(b.state.clock.day, 1);
  assert.ok(b.state.clock.tickInDay < TICKS_PER_DAY);
  assertFiniteDeep(b.state);
});

test('결정성: 같은 시드 · 같은 입력열 → 같은 해시(걷기 · 낚시)', () => {
  const run = (seed, opts) => {
    const { sim } = makeSim({ seed, ...opts });
    const inp = randomInputs(seed);
    for (let t = 0; t < 6000; t++) {
      if (sim.state.rig.phase === 'result') { sim.releaseCatch(); continue; }
      sim.step(inp(t));
    }
    return sim.hash();
  };
  const walkOpts = { start: { scene: 'lake', hour: 8 }, session: { ignoreGates: true, devSession: true } };
  assert.equal(run(31, walkOpts), run(31, walkOpts));
  assert.notEqual(run(31, walkOpts), run(32, walkOpts));
  const fishOpts = { start: { spotId: 'lake_gravel', hour: 8 } };
  assert.equal(run(9, fishOpts), run(9, fishOpts));
});

test('패널 없이 1시간(216,000틱 = 게임 하루) 돌려 예외 0 · NaN 0 · 자정 한 번', { timeout: 300000 }, () => {
  const { sim, bus, log } = makeSim({ seed: 20261002, start: { spotId: 'lake_gravel' } });
  let days = 0;
  bus.on(EV.CLOCK_DAY, () => { days++; });
  const inp = randomInputs(5);
  let commands = 0;
  let guard = 0;
  while (sim.state.tick < TICKS_PER_DAY) {
    if (sim.state.rig.phase === 'result') {
      // 결과 단계는 명령으로만 풀린다(봇 러너와 같은 규칙) — 번갈아 어창 · 방생
      const r = (commands++ % 2) ? sim.releaseCatch() : sim.keepCatch();
      if (!r.ok) sim.releaseCatch();
      assert.ok(++guard < 100000, '결과 단계가 풀리지 않는다');
      continue;
    }
    const t = sim.state.tick;
    sim.step(inp(t));
    if (t % 20000 === 0) assertFiniteDeep(sim.state);
    if (log.length > 5000) log.length = 0;
  }
  assertFiniteDeep(sim.state);
  structuredClone(sim.state);
  assert.equal(sim.state.events.length, 0);
  assert.equal(sim.state.clock.day, 2);
  assert.equal(days, 1);
  assert.equal(sim.state.tick, TICKS_PER_DAY);
});
