// OWNER: P3 — 계약 §12.2(clock) · §5.7 · §7.1 · §7.2
// 시계(틱 정본 · 시간대 · 해 · 빛) · 건너뛰기(캠프 · 이동 · 수면 — 자정 넘김 · 이벤트 순서) · 날씨(시드 해시 · 예보 = 다음 날 실제).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_IDS, TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MINUTE } from '../src/core/constants.js';
import { EV, EventBus } from '../src/core/events.js';
import { NEUTRAL_INPUT } from '../src/core/inputFrame.js';
import { BANDS, TIME } from '../src/data/time.js';
import { getStage } from '../src/data/stages/index.js';
import {
  advanceClock, bandOf, bandStartTick, deriveClock, formatClock, hourOf, nextBandStart, nextWake, setClock, sunAt,
} from '../src/sim/clock.js';
import { weatherFor } from '../src/sim/weather.js';
import { GameSim } from '../src/sim/GameSim.js';
import { makeTestCtx, makeTestState } from './helpers.js';

const H = TICKS_PER_HOUR;
const EPS_T = 1 / TICKS_PER_HOUR;   // 한 틱의 시간(시)

/** 버스의 이벤트를 이름 · payload 로 모으는 GameSim */
function simAt({ scene = 'lake', hour = 8, seed = 3, weather } = {}) {
  const bus = new EventBus();
  const log = [];
  bus.onAny((name, payload) => log.push({ name, payload }));
  const sim = new GameSim({ bus, seed, start: { scene, hour, weather }, session: { ignoreGates: true, devSession: true } });
  sim.start();
  log.length = 0;
  return { sim, bus, log };
}
const names = (log) => log.map(e => e.name);

test('틱 → 시각: 1분 = 150틱 · 1시간 = 9000틱 · 하루 = 216000틱', () => {
  assert.equal(TICKS_PER_MINUTE * 60, H);
  assert.equal(H * 24, TICKS_PER_DAY);
  assert.equal(hourOf(0), 0);
  assert.equal(hourOf(H), 1);
  assert.ok(hourOf(TICKS_PER_DAY - 1) < 24);
  const c = deriveClock(3, Math.round(13.5 * H) + 7 * TICKS_PER_MINUTE + 20, 'clear');
  assert.equal(c.day, 3);
  assert.equal(c.minute, 37);
  assert.equal(formatClock(c), '13:37');
  assert.equal(formatClock(deriveClock(1, 0, 'clear')), '00:00');
  assert.equal(formatClock(deriveClock(1, TICKS_PER_DAY - 1, 'clear')), '23:59');
  // 실제 1초(60틱) = 게임 24초
  assert.ok(Math.abs(hourOf(60) * 3600 - 24) < 1e-9);
});

test('시간대 경계 04 · 07 · 11 · 17 · 20 · 자정', () => {
  const order = ['dawn', 'morning', 'day', 'evening', 'night'];
  for (let i = 0; i < BANDS.length; i++) {
    const b = BANDS[i];
    assert.equal(bandOf(b.from), b.id, `${b.id} 시작`);
    assert.equal(bandOf(b.from - EPS_T), order[(i + 4) % 5], `${b.id} 직전`);
    assert.equal(bandStartTick(b.id), b.from * H);
    // 틱 단위 경계: 시작 틱부터 그 시간대
    assert.equal(deriveClock(1, b.from * H, 'clear').band, b.id);
    assert.equal(deriveClock(1, b.from * H - 1, 'clear').band, order[(i + 4) % 5]);
  }
  assert.deepEqual([4, 7, 11, 17, 20], BANDS.map(b => b.from));
  // 자정을 넘는 밤
  assert.equal(bandOf(23.999), 'night');
  assert.equal(bandOf(0), 'night');
  assert.equal(bandOf(3.999), 'night');
  assert.equal(deriveClock(1, 0, 'clear').band, 'night');
  assert.equal(deriveClock(1, TICKS_PER_DAY - 1, 'clear').band, 'night');
});

test('해 고도 부호: 일출 05:30 · 일몰 19:30 에 0 · 낮 양수 · 밤 음수 · 방위 동 → 남(물) → 서', () => {
  assert.ok(Math.abs(sunAt(TIME.sunrise).sunElev) < 1e-12);
  assert.ok(sunAt(TIME.sunrise + 0.05).sunElev > 0);
  assert.ok(sunAt(TIME.sunrise - 0.05).sunElev < 0);
  assert.ok(sunAt(TIME.sunset - 0.05).sunElev > 0);
  assert.ok(sunAt(TIME.sunset + 0.05).sunElev < 0);
  assert.ok(Math.abs(sunAt(TIME.sunset).sunElev) < 1e-12);
  assert.ok(Math.abs(sunAt(12.5).sunElev - TIME.maxSunElev) < 1e-12);
  assert.ok(Math.abs(sunAt(0.5).sunElev - TIME.minSunElev) < 1e-12);   // 밤의 가운데 = 00:30(§7.1 식 — 데이터 주석의 01:30 이 아니다 · NOTES-P3)
  for (let h = 0; h < 24; h += 0.25) {
    const s = sunAt(h);
    assert.ok(Number.isFinite(s.sunElev) && Number.isFinite(s.sunAzim) && Number.isFinite(s.light));
    assert.ok(s.light >= TIME.nightFloor - 1e-12 && s.light <= 1 + 1e-12);
  }
  // 동(+X)에서 떠 정오에 −Z(물 위) · 서(−X)로 진다 — yaw 규약: 앞 = (−sin, −cos)
  const fx = (a) => -Math.sin(a);
  const fz = (a) => -Math.cos(a);
  assert.ok(fx(sunAt(TIME.sunrise).sunAzim) > 0.99);
  assert.ok(fz(sunAt(12.5).sunAzim) < -0.99);
  assert.ok(fx(sunAt(TIME.sunset - 1e-9).sunAzim) < -0.99);
  // 빛 · 밤
  assert.ok(Math.abs(sunAt(12.5).light - 1) < 1e-12);
  assert.ok(Math.abs(sunAt(1.5).light - TIME.nightFloor) < 1e-12);
  assert.equal(sunAt(1.5).night, true);
  assert.equal(sunAt(12.5).night, false);
  assert.ok(sunAt(12.5, 0.55).light < sunAt(12.5).light);
  // 비 오는 한낮은 어둡지만 밤은 아니다
  assert.equal(deriveClock(1, 12 * H, 'rain').night, false);
});

test('advanceClock: 시간대 → CLOCK_BAND · 자정 → CLOCK_DAY → WEATHER_CHANGED → SAVE_REQUEST{day} · env', () => {
  const state = makeTestState({ scene: 'lake', hour: 8 });
  state.seed = 11;
  const ctx = makeTestCtx(state);
  // 10:59:59.x → 11:00
  setClock(ctx, 1, 11 * H - 1, 'debug');
  ctx.events.length = 0;
  advanceClock(ctx, 1);
  assert.equal(state.clock.band, 'day');
  assert.deepEqual(ctx.events.map(e => e.name), [EV.CLOCK_BAND]);
  assert.deepEqual(ctx.events[0].payload, { band: 'day', prev: 'morning', day: 1, hour: 11 });
  // 같은 시간대 안: 이벤트 없음
  ctx.events.length = 0;
  advanceClock(ctx, 1);
  assert.equal(ctx.events.length, 0);
  // 자정 넘김
  setClock(ctx, 1, TICKS_PER_DAY - 1, 'debug');
  ctx.events.length = 0;
  advanceClock(ctx, 1);
  assert.deepEqual(ctx.events.map(e => e.name), [EV.CLOCK_DAY, EV.WEATHER_CHANGED, EV.SAVE_REQUEST]);
  assert.deepEqual(ctx.events[0].payload, { day: 2 });
  assert.deepEqual(ctx.events[2].payload, { reason: 'day' });
  assert.equal(state.clock.day, 2);
  assert.equal(state.clock.tickInDay, 0);
  for (const id of STAGE_IDS) assert.equal(state.weather.today[id], weatherFor(11, 2, id));
  // 밤의 야외 → 헤드랜턴
  assert.equal(state.clock.night, true);
  assert.equal(state.env.headlamp, true);
});

test('setClock: 점프 — CLOCK_DAY → WEATHER_CHANGED → CLOCK_BAND → CLOCK_SKIP · 같은 날이면 날씨 그대로', () => {
  const state = makeTestState({ scene: 'lake', hour: 8 });
  state.seed = 5;
  const ctx = makeTestCtx(state);
  ctx.events.length = 0;
  setClock(ctx, 1, 9 * H, 'debug');
  assert.deepEqual(ctx.events.map(e => e.name), [EV.CLOCK_SKIP]);
  assert.deepEqual(ctx.events[0].payload, { fromDay: 1, fromTick: 8 * H, toDay: 1, toTick: 9 * H, reason: 'debug' });
  ctx.events.length = 0;
  setClock(ctx, 2, 5 * H, 'camp');
  assert.deepEqual(ctx.events.map(e => e.name), [EV.CLOCK_DAY, EV.WEATHER_CHANGED, EV.SAVE_REQUEST, EV.CLOCK_BAND, EV.CLOCK_SKIP]);
  assert.equal(state.clock.day, 2);
  assert.equal(state.clock.band, 'dawn');
  // 침대 · 이동은 day 저장을 요청하지 않는다(부르는 쪽이 sleep · scene 으로)
  ctx.events.length = 0;
  setClock(ctx, 3, 6 * H, 'bed');
  assert.deepEqual(ctx.events.map(e => e.name), [EV.CLOCK_DAY, EV.WEATHER_CHANGED, EV.CLOCK_SKIP]);
  // 범위 밖 tickInDay 는 날로 넘긴다
  setClock(ctx, 3, TICKS_PER_DAY + H, 'debug');
  assert.equal(state.clock.day, 4);
  assert.equal(state.clock.tickInDay, H);
});

test('nextBandStart · nextWake', () => {
  assert.deepEqual(nextBandStart(1, 2 * H), { day: 1, tickInDay: 4 * H });
  assert.deepEqual(nextBandStart(1, 4 * H), { day: 1, tickInDay: 7 * H });   // 경계에 서 있으면 그다음
  assert.deepEqual(nextBandStart(1, 8 * H), { day: 1, tickInDay: 11 * H });
  assert.deepEqual(nextBandStart(1, 16 * H), { day: 1, tickInDay: 17 * H });
  assert.deepEqual(nextBandStart(1, 19 * H), { day: 1, tickInDay: 20 * H });
  assert.deepEqual(nextBandStart(1, 21 * H), { day: 2, tickInDay: 4 * H });
  assert.deepEqual(nextWake(1, 22 * H), { day: 2, tickInDay: 6 * H });
  assert.deepEqual(nextWake(2, 2 * H), { day: 2, tickInDay: 6 * H });
  assert.deepEqual(nextWake(2, 6 * H), { day: 3, tickInDay: 6 * H });
});

test('캠프 건너뛰기: 다음 시간대 시작 · 자정 넘김 이벤트 순서 · 걷기/야외만', () => {
  const { sim, log } = simAt({ scene: 'lake', hour: 8.25 });
  assert.equal(sim.waitNextBand().ok, true);
  assert.equal(sim.state.clock.tickInDay, 11 * H);
  assert.equal(sim.state.clock.day, 1);
  assert.deepEqual(names(log), [EV.CLOCK_BAND, EV.CLOCK_SKIP]);
  assert.equal(log[1].payload.reason, 'camp');

  const n = simAt({ scene: 'lake', hour: 21 });
  const today = { ...n.sim.state.weather.today };
  const tomorrow = { ...n.sim.state.weather.tomorrow };
  assert.equal(n.sim.waitNextBand().ok, true);
  assert.equal(n.sim.state.clock.day, 2);
  assert.equal(n.sim.state.clock.tickInDay, 4 * H);
  assert.equal(n.sim.state.clock.band, 'dawn');
  assert.deepEqual(names(n.log), [EV.CLOCK_DAY, EV.WEATHER_CHANGED, EV.SAVE_REQUEST, EV.CLOCK_BAND, EV.CLOCK_SKIP]);
  assert.deepEqual(n.log[4].payload, { fromDay: 1, fromTick: 21 * H, toDay: 2, toTick: 4 * H, reason: 'camp' });
  // 예보 = 다음 날 실제
  assert.deepEqual(n.sim.state.weather.today, tomorrow);
  assert.notEqual(n.sim.state.weather.today, today);

  const h = simAt({ scene: 'home', hour: 8 });
  assert.deepEqual(h.sim.waitNextBand(), { ok: false, reason: 'notHere' });
  assert.equal(h.log.length, 0);
});

test('이동 건너뛰기: +1시간 · 자정을 넘으면 CLOCK_DAY → 날씨 → CLOCK_SKIP{travel}', () => {
  const { sim, log } = simAt({ scene: 'lake', hour: 8 });
  assert.equal(sim.travel('home').ok, true);
  assert.equal(sim.state.clock.tickInDay, 9 * H);
  assert.equal(sim.state.clock.day, 1);
  assert.equal(log.filter(e => e.name === EV.CLOCK_SKIP)[0].payload.reason, 'travel');
  assert.equal(log.filter(e => e.name === EV.CLOCK_DAY).length, 0);

  const n = simAt({ scene: 'lake', hour: 23.5, seed: 77 });
  const tomorrow = { ...n.sim.state.weather.tomorrow };
  assert.equal(n.sim.travel('home').ok, true);
  assert.equal(n.sim.state.clock.day, 2);
  assert.equal(n.sim.state.clock.tickInDay, 0.5 * H);
  const ev = names(n.log);
  const iDay = ev.indexOf(EV.CLOCK_DAY);
  const iSkip = ev.indexOf(EV.CLOCK_SKIP);
  const iWeather = ev.indexOf(EV.WEATHER_CHANGED, iDay);
  assert.ok(iDay >= 0 && iWeather > iDay && iSkip > iWeather, ev.join(' '));
  assert.equal(ev.filter(x => x === EV.CLOCK_DAY).length, 1);
  assert.deepEqual(n.sim.state.weather.today, tomorrow);
  // 집의 current 는 lake 의 날씨
  assert.equal(n.sim.state.weather.current, n.sim.state.weather.today.lake);
});

test('수면: 자정 전 → 다음 날 06:00 · 자정 뒤 06:00 전 → 그날 06:00 · SAVE_REQUEST{sleep} · 집만', () => {
  const a = simAt({ scene: 'home', hour: 22 });
  assert.equal(a.sim.sleep().ok, true);
  assert.equal(a.sim.state.clock.day, 2);
  assert.equal(a.sim.state.clock.tickInDay, 6 * H);
  assert.deepEqual(names(a.log), [EV.CLOCK_DAY, EV.WEATHER_CHANGED, EV.CLOCK_BAND, EV.CLOCK_SKIP, EV.SAVE_REQUEST]);
  assert.equal(a.log[3].payload.reason, 'bed');
  assert.deepEqual(a.log[4].payload, { reason: 'sleep' });

  const b = simAt({ scene: 'home', hour: 2 });
  assert.equal(b.sim.sleep().ok, true);
  assert.equal(b.sim.state.clock.day, 1);
  assert.equal(b.sim.state.clock.tickInDay, 6 * H);
  assert.equal(names(b.log).includes(EV.CLOCK_DAY), false);

  const c = simAt({ scene: 'home', hour: 6 });
  c.sim.sleep();
  assert.equal(c.sim.state.clock.day, 2);
  assert.equal(c.sim.state.clock.tickInDay, 6 * H);

  const d = simAt({ scene: 'lake', hour: 22 });
  assert.deepEqual(d.sim.sleep(), { ok: false, reason: 'notHere' });
});

test('step 으로 자정을 넘는다: 시계는 step 으로만 간다', () => {
  const { sim, log } = simAt({ scene: 'lake', hour: 8 });
  sim.debugSetTime(24);   // 23:59:59.x — 그날의 마지막 틱
  assert.equal(sim.state.clock.tickInDay, TICKS_PER_DAY - 1);
  const tomorrow = { ...sim.state.weather.tomorrow };
  log.length = 0;
  sim.step(NEUTRAL_INPUT);
  assert.equal(sim.state.clock.day, 2);
  assert.equal(sim.state.clock.tickInDay, 0);
  assert.deepEqual(names(log).slice(0, 3), [EV.CLOCK_DAY, EV.WEATHER_CHANGED, EV.SAVE_REQUEST]);
  assert.deepEqual(sim.state.weather.today, tomorrow);
  // 명령(조회)은 시계를 밀지 않는다
  const t = sim.state.clock.tickInDay;
  sim.getForecast();
  sim.getTravel();
  assert.equal(sim.state.clock.tickInDay, t);
});

test('날씨: 시드 해시로 결정적 · 스테이지마다 · 가중치 비율 · 예보 = 다음 날 실제', () => {
  for (const id of STAGE_IDS) {
    for (let d = 1; d < 50; d++) assert.equal(weatherFor(42, d, id), weatherFor(42, d, id));
  }
  assert.equal(weatherFor(42, 1, 'nowhere'), 'clear');
  // 가중치 비율(3,000일 · lake 0.5/0.3/0.2)
  for (const id of STAGE_IDS) {
    const ww = getStage(id).weatherWeights;
    const total = ww.clear + ww.cloudy + ww.rain;
    const cnt = { clear: 0, cloudy: 0, rain: 0 };
    const N = 3000;
    for (let d = 1; d <= N; d++) cnt[weatherFor(9, d, id)]++;
    for (const w of ['clear', 'cloudy', 'rain']) {
      const exp = ww[w] / total;
      assert.ok(Math.abs(cnt[w] / N - exp) < 0.04, `${id} ${w}: ${cnt[w] / N} vs ${exp}`);
    }
  }
  // 시드 · 스테이지가 다르면 다른 날씨열
  const seq = (seed, id) => Array.from({ length: 40 }, (_, i) => weatherFor(seed, i + 1, id)).join();
  assert.notEqual(seq(1, 'lake'), seq(2, 'lake'));
  assert.notEqual(seq(1, 'lake'), seq(1, 'river'));
  // 같은 시드의 GameSim 둘은 같은 날씨 · 예보 = 다음 날 실제
  const a = simAt({ seed: 1234 });
  const b = simAt({ seed: 1234 });
  assert.deepEqual(a.sim.state.weather, b.sim.state.weather);
  for (let d = 1; d <= 5; d++) {
    const tomorrow = { ...a.sim.state.weather.tomorrow };
    for (const id of STAGE_IDS) assert.equal(tomorrow[id], weatherFor(1234, d + 1, id));
    a.sim.waitNextBand(); a.sim.waitNextBand(); a.sim.waitNextBand(); a.sim.waitNextBand(); a.sim.waitNextBand();
    assert.equal(a.sim.state.clock.day, d + 1);
    assert.deepEqual(a.sim.state.weather.today, tomorrow);
  }
});

test('날씨 · 시각이 빛과 env 에 반영된다(비 · 밤 · 집)', () => {
  const r = simAt({ scene: 'lake', hour: 12, weather: 'rain' });
  assert.equal(r.sim.state.weather.current, 'rain');
  assert.ok(r.sim.state.clock.light < 0.6);
  assert.equal(r.sim.state.env.rain, 1);
  assert.ok(r.sim.state.env.waveAmp > getStage('lake').waves.amp);
  const h = simAt({ scene: 'home', hour: 23 });
  assert.equal(h.sim.state.env.headlamp, false);   // 집은 헤드랜턴 없음
  assert.equal(h.sim.state.env.rain, 0);
  assert.equal(h.sim.state.env.waveAmp, 0);
  const n = simAt({ scene: 'lake', hour: 23 });
  assert.equal(n.sim.state.env.headlamp, true);
  n.sim.debugSetTime(12);
  assert.equal(n.sim.state.env.headlamp, false);
  assert.equal(n.sim.debugSetWeather('cloudy').ok, true);
  assert.equal(n.sim.state.weather.current, 'cloudy');
  for (const id of STAGE_IDS) assert.equal(n.sim.state.weather.today[id], 'cloudy');
  assert.deepEqual(n.sim.debugSetWeather('snow'), { ok: false, reason: 'invalid' });
});
