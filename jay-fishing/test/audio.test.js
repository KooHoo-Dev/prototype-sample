// OWNER: P7 — AudioEngine 검사(Node · 가짜 WebAudio).
// 계약 §12.2(W1 확정: test/audio.test.js — 처음엔 src/audio/ 에 있던 것을 통합 게이트가 npm test 글롭 안으로 옮겼다).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EV, EventBus } from '../src/core/events.js';
import { DEFAULT_SETTINGS } from '../src/data/settings.js';
import { makeTestState } from './helpers.js';
import { AudioEngine } from '../src/audio/AudioEngine.js';

/** 계약 §6.13 의 makeTestState 위에 파이팅 · 신호를 얹은 상태(디버그 고정 상태는 app 만 import 한다 — purity) */
function stateFor(kind) {
  const spotOf = { fightRun: 'lake_gravel', fightStress: 'lake_gravel', fightJump: 'lake_gravel', nibble: 'lake_gravel', waiting: 'lake_gravel', night: 'lake_gravel', rain: 'coast_channel' };
  const hourOf = { fightRun: 18, fightStress: 18, night: 22, rain: 18.5 };
  if (kind === 'walkLake') return makeTestState({ scene: 'lake' });
  if (kind === 'shopL12') return makeTestState({ scene: 'home' });
  const s = makeTestState({ spotId: spotOf[kind], hour: hourOf[kind] ?? 8, weather: kind === 'rain' ? 'rain' : 'clear', set: kind === 'nibble' || kind === 'waiting' || kind === 'fightJump' ? 'float' : 'bottom' });
  const o = s.rig.origin;
  if (kind === 'waiting' || kind === 'nibble' || kind === 'night' || kind === 'rain') {
    s.rig.phase = kind === 'nibble' ? 'bite' : 'waiting';
    s.rig.dist = 24;
    s.rig.bearing = 0;
    s.rig.bobber = { x: o.x, z: o.z - 24 };
    s.rig.prevBobber = { x: o.x, z: o.z - 24 };
    if (kind === 'nibble') s.rig.signal = { kind: 'nibble', t: 0.1, strength: 0.7, takeStyle: 'sink', count: 1 };
    return s;
  }
  s.rig.phase = 'fighting';
  const jump = kind === 'fightJump';
  const stress = kind === 'fightStress';
  s.fight = {
    speciesId: jump ? 'largemouthBass' : 'carp', roll: { speciesId: 'carp', z: 1.3, pct: 0.9, lengthCm: jump ? 45 : 72, weightKg: jump ? 1.5 : 7.3, tier: 'trophy' },
    t: 9.5, dist: jump ? 14 : 35, prevDist: jump ? 14 : 34.99, minDist: 2.1, bearing: 0.12, prevBearing: 0.12, halfArc: 1.2, depth: 1.5,
    airborne: jump ? 0.8 : 0, stamina: 0.7, behavior: jump ? 'jump' : stress ? 'hold' : 'run', behaviorName: 'run', behaviorT: 1, behaviorDur: 3,
    telegraph: null, tension: 2.5, tensionRatio: stress ? 0.9 : 0.6, limitKg: 4, limitBy: stress ? 'rod' : 'line', limitRatio: stress ? 0.92 : 0.62,
    lineKg: 4, lineEffKg: 3.9, abrasion: 0.02, inSnag: false, inCover: 0, rodLift: stress ? 1 : 0.3, rodUp: stress, rodLoadRatio: stress ? 0.92 : 0.4,
    rodStress: stress, rodOverT: 0, lineDanger: stress, slipping: !stress, slipSpeed: stress ? 0 : 0.36, reeling: stress, gainSpeed: stress ? 0.8 : 0,
    slack: false, slackTime: 0, spoolLeftM: 80, canNet: false, netRangeM: 3, netBuffer: 0, landStamina: 0.15, showStamina: false, traits: [],
    k: { Fmax: 6, vmax: 3, endurance: 60 }, stats: { maxTension: 3, sumTension: 0, sumTension2: 0, ticks: 0, runs: 1, jumps: 0, slackTicks: 0, slipTicks: 0 }, brain: {},
  };
  return s;
}

// ── 가짜 WebAudio: 모든 값이 유한한지 확인하고, 노드 생성 · 끊김을 센다
const counters = { created: 0, disconnected: 0, ctxs: 0 };
function finite(v, what) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`non-finite ${what}: ${v}`);
}
class Param {
  constructor(v = 0) { this.value = v; this.events = []; }
  setValueAtTime(v, t) { finite(v, 'value'); finite(t, 'time'); this.events.push(['set', v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { finite(v, 'value'); finite(t, 'time'); this.events.push(['lin', v, t]); this.value = v; return this; }
  exponentialRampToValueAtTime(v, t) {
    finite(v, 'value'); finite(t, 'time');
    if (v <= 0) throw new Error('exp ramp to <= 0');
    this.events.push(['exp', v, t]); this.value = v; return this;
  }
  setTargetAtTime(v, t, tc) { finite(v, 'value'); finite(t, 'time'); finite(tc, 'tc'); this.events.push(['target', v, t]); this.target = v; return this; }
  cancelScheduledValues(t) { finite(t, 'time'); this.events.push(['cancel', 0, t]); return this; }
}
class Node {
  constructor(ctx) { this.ctx = ctx; counters.created++; this.outs = []; }
  connect(n) { this.outs.push(n); return n; }
  disconnect() { counters.disconnected++; this.outs = []; }
}
class Src extends Node {
  constructor(ctx) { super(ctx); this.started = false; this.stopped = false; this.onended = null; }
  start(t = 0) { finite(t, 'start'); this.started = true; }
  stop() { if (!this.started) throw new Error('stop before start'); this.stopped = true; }
}
class Osc extends Src { constructor(c) { super(c); this.type = 'sine'; this.frequency = new Param(440); } }
class Buf extends Src { constructor(c) { super(c); this.buffer = null; this.loop = false; } }
class Gain extends Node { constructor(c) { super(c); this.gain = new Param(1); } }
class Biquad extends Node { constructor(c) { super(c); this.type = 'lowpass'; this.frequency = new Param(350); this.Q = new Param(1); } }
class Comp extends Node {
  constructor(c) { super(c); this.threshold = new Param(); this.knee = new Param(); this.ratio = new Param(); this.attack = new Param(); this.release = new Param(); }
}
class Pan extends Node { constructor(c) { super(c); this.pan = new Param(0); } }
class FakeCtx {
  constructor() {
    counters.ctxs++;
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.state = 'running';
    this.destination = { kind: 'dest' };
    this.suspends = 0;
    this.resumes = 0;
  }
  createGain() { return new Gain(this); }
  createOscillator() { return new Osc(this); }
  createBufferSource() { return new Buf(this); }
  createBiquadFilter() { return new Biquad(this); }
  createDynamicsCompressor() { return new Comp(this); }
  createStereoPanner() { return new Pan(this); }
  createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d, length: len }; }
  suspend() { this.suspends++; this.state = 'suspended'; return Promise.resolve(); }
  resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

function setup() {
  globalThis.AudioContext = FakeCtx;
  const bus = new EventBus();
  const settings = structuredClone(DEFAULT_SETTINGS);
  const audio = new AudioEngine({ bus, settings });
  return { bus, settings, audio };
}

/** 한 프레임: 시계 dt 만큼 · sim 틱 1 */
function frame(audio, state, dt = 1 / 60) {
  state.tick += 1;
  audio.ctx.currentTime += dt;
  audio.update(state, dt);
}

/** 마지막으로 예약된 값(set · ramp · target) */
function lastValue(param) {
  for (let i = param.events.length - 1; i >= 0; i--) if (param.events[i][0] !== 'cancel') return param.events[i][1];
  return param.value;
}

function countPulses(param, from, to) {
  return param.events.filter(e => e[0] === 'lin' && e[1] > 0 && e[2] >= from && e[2] < to).length;
}

/** 마지막 cancelScheduledValues 뒤에 남은 펄스(그 전의 예약은 cancel 이 지운다) */
function pulsesAfterCancel(param) {
  let i = param.events.length - 1;
  while (i >= 0 && param.events[i][0] !== 'cancel') i--;
  return param.events.slice(i + 1).filter(e => e[0] === 'lin' && e[1] > 0).length;
}

const ALL_SIM_EVENTS = () => [
  [EV.CAST_RELEASE, { power: 0.9, perfect: true, distM: 24, aimYaw: 0 }],
  [EV.CAST_SPLASH, { x: 0, z: -20, distM: 24, waterDepthM: 3, baitDepthM: 2, layer: 'mid', set: 'float' }],
  [EV.BITE_NIBBLE, { set: 'float', strength: 0.6, index: 0 }],
  [EV.BITE_NIBBLE, { set: 'bottom', strength: 0.6, index: 1 }],
  [EV.BITE_TAKE, { set: 'float', style: 'sink', window: 0.5 }],
  [EV.BITE_TAKE, { set: 'bottom', style: 'pull', window: 0.5 }],
  [EV.HOOK_SET, { weightKg: 2, lengthCm: 40 }],
  [EV.HOOK_MISS, { reason: 'early', baitKept: true }],
  [EV.HOOK_MISS, { reason: 'late', baitKept: false }],
  [EV.FIGHT_TELEGRAPH, { kind: 'run', lead: 0.6 }],
  [EV.FIGHT_TELEGRAPH, { kind: 'jump', lead: 0.5 }],
  [EV.FIGHT_TELEGRAPH, { kind: 'charge', lead: 0.8 }],
  [EV.FIGHT_TELEGRAPH, { kind: 'dive', lead: 3 }],
  [EV.FIGHT_BEHAVIOR, { kind: 'run', name: 'run' }],
  [EV.FIGHT_JUMP, { phase: 'leave', x: 0, z: -14, lengthM: 0.45 }],
  [EV.FIGHT_JUMP, { phase: 'land', x: 0, z: -14, lengthM: 0.45 }],
  [EV.FIGHT_SHAKE, { strength: 0.4 }],
  [EV.FIGHT_SLIP, { on: true }],
  [EV.ROD_STRESS, { on: true }],
  [EV.LINE_DANGER, { on: true }],
  [EV.NET_START, { x: 0, z: -3, lengthM: 0.4 }],
  [EV.CATCH_RESULT, { catch: {}, holdFull: false }],
  [EV.CATCH_KEPT, { catch: {} }],
  [EV.CATCH_RELEASED, { catch: {}, swapped: false }],
  [EV.RECORD, { speciesId: 'carp', kind: 'weight', weightKg: 8, tier: 'trophy' }],
  [EV.RECORD, { speciesId: 'carp', kind: 'first', weightKg: 1, tier: 'normal' }],
  [EV.RECORD, { speciesId: 'carp', kind: 'weight', weightKg: 20, tier: 'legend' }],
  [EV.LEVEL_UP, { level: 2, skillPoints: 1, unlocks: [] }],
  [EV.SOLD, { count: 3, total: 1000, auto: false }],
  [EV.BOUGHT, { itemId: 'worm', qty: 1, cost: 100 }],
  [EV.SKILL_LEARNED, { skillId: 'casting', rank: 1, unlocks: [] }],
  [EV.DRAG_CHANGED, { notch: 6, notches: 20, kg: 1.5, ratio: 0.37 }],
  [EV.DRAG_CHANGED, { notch: 5, notches: 20, kg: 1.25, ratio: 0.31 }],
  [EV.BAIL_CHANGED, { open: true }],
  [EV.CAST_BLOCKED, { reason: 'noBait' }],
  [EV.RIG_BUSY, { action: 'set' }],
  [EV.FISHING_ENTER, { spotId: 'lake_gravel', set: 'float' }],
  [EV.PANEL_OPENED, { panel: 'tackle', depth: 1 }],
  [EV.PANEL_CLOSED, { panel: 'tackle', depth: 0, by: 'esc' }],
  [EV.FIGHT_END, { outcome: 'lineBreak', durationSec: 20, maxTension: 4, distM: 20, cause: null }],
  [EV.FIGHT_END, { outcome: 'rodBreak', durationSec: 20, maxTension: 4, distM: 20, cause: null }],
  [EV.FIGHT_END, { outcome: 'hookOff', durationSec: 20, maxTension: 4, distM: 20, cause: 'slack' }],
  [EV.FIGHT_END, { outcome: 'landed', durationSec: 20, maxTension: 4, distM: 2, cause: null }],
  [EV.SCENE_CHANGED, { from: 'lake', to: 'home', reason: 'travel' }],
];

test('before unlock: no AudioContext, every call and event is a silent no-op', () => {
  counters.ctxs = 0;
  const { bus, audio } = setup();
  assert.equal(counters.ctxs, 0);
  const s = stateFor('fightRun');
  for (const [name, p] of ALL_SIM_EVENTS()) bus.emit(name, p);
  bus.emit(EV.PAUSED, { on: true });
  bus.emit(EV.SETTINGS_CHANGED, { settings: {} });
  audio.update(s, 1 / 60);
  audio.setPaused(false);
  audio.applySettings();
  assert.deepEqual(audio.stats(), { nodes: 0, voices: 0 });
  assert.equal(counters.ctxs, 0);
  audio.dispose();
});

test('unlock builds once with master limiter (-6dB, ratio 20, 3ms, 250ms)', () => {
  counters.ctxs = 0;
  const { audio } = setup();
  audio.unlock();
  audio.unlock();
  assert.equal(counters.ctxs, 1);
  const lim = audio.g.limiter;
  assert.equal(lim.threshold.value, -6);
  assert.equal(lim.ratio.value, 20);
  assert.equal(lim.attack.value, 0.003);
  assert.equal(lim.release.value, 0.25);
  assert.equal(lim.outs[0], audio.ctx.destination);
  assert.ok(audio.g.master.outs.includes(lim));
  for (const b of [audio.g.sfx, audio.g.amb, audio.g.ui]) assert.ok(b.outs.includes(audio.g.master));
  assert.ok(audio.stats().nodes > 0);
  audio.dispose();
});

test('unlock without WebAudio does not throw', () => {
  const bus = new EventBus();
  const saved = globalThis.AudioContext;
  delete globalThis.AudioContext;
  const audio = new AudioEngine({ bus, settings: structuredClone(DEFAULT_SETTINGS) });
  const warn = console.warn;
  console.warn = () => {};
  try {
    audio.unlock();
    bus.emit(EV.HOOK_SET, { weightKg: 1, lengthCm: 30 });
    audio.update(stateFor('fightRun'), 1 / 60);
  } finally {
    console.warn = warn;
    globalThis.AudioContext = saved;
  }
  assert.deepEqual(audio.stats(), { nodes: 0, voices: 0 });
});

test('tension tone follows limitRatio (same value as the gauge) and creaks from 85%', () => {
  const { audio } = setup();
  audio.unlock();
  const s = stateFor('fightRun');
  for (const r of [0, 0.25, 0.5, 0.8, 0.95, 1.0, 1.3]) {
    s.fight.limitRatio = r;
    frame(audio, s);
    const rr = Math.min(r, 1.2);
    const hz = 160 + 540 * Math.min(Math.sqrt(rr), 1.1);
    assert.ok(Math.abs(audio.g.tensionOsc.frequency.target - hz) < 1e-6, `hz at ${r}`);
    assert.ok(Math.abs(audio.g.tensionGain.gain.target - (0.02 + 0.10 * rr)) < 1e-6, `gain at ${r}`);
    const creak = audio.g.creakGain.gain.target;
    if (r < 0.85) assert.equal(creak, 0, `no creak at ${r}`);
    else assert.ok(Math.abs(creak - 0.22 * Math.min(1, (rr - 0.85) / 0.15)) < 1e-6, `creak at ${r}`);
  }
  audio.dispose();
});

test('drag clicker rate is 6 + 40 x slipSpeed per second while slipping', () => {
  const { audio } = setup();
  audio.unlock();
  const s = stateFor('fightRun');
  const p = audio.g.clickGain.gain;
  for (const slip of [0, 0.5, 2]) {
    s.fight.slipping = true;
    s.fight.slipSpeed = slip;
    const t0 = audio.ctx.currentTime + 0.2;
    for (let i = 0; i < 180; i++) frame(audio, s);          // 3초
    const n = countPulses(p, t0, t0 + 2);
    const expect = 2 * (6 + 40 * slip);
    assert.ok(Math.abs(n - expect) <= expect * 0.2 + 2, `slip ${slip}: ${n} clicks vs ${expect}`);
  }
  s.fight.slipping = false;
  for (let i = 0; i < 20; i++) frame(audio, s);
  const t = audio.ctx.currentTime;
  for (let i = 0; i < 60; i++) frame(audio, s);
  assert.equal(countPulses(p, t + 0.01, t + 2), 0, 'no clicks when drag holds');
  audio.dispose();
});

test('reel ratchet follows gainSpeed; retrieving also ratchets', () => {
  const { audio } = setup();
  audio.unlock();
  const s = stateFor('fightRun');
  s.fight.slipping = false;
  s.fight.gainSpeed = 1.2;
  const p = audio.g.ratchetGain.gain;
  const t0 = audio.ctx.currentTime + 0.2;
  for (let i = 0; i < 120; i++) frame(audio, s);
  const n = countPulses(p, t0, t0 + 1);
  assert.ok(Math.abs(n - (10 + 25 * 1.2)) <= 6, `ratchet ${n}`);
  const w = stateFor('waiting');
  w.rig.phase = 'retrieving';
  const t1 = audio.ctx.currentTime + 0.2;
  for (let i = 0; i < 120; i++) frame(audio, w);
  assert.ok(countPulses(p, t1, t1 + 1) > 5);
  audio.dispose();
});

test('FIGHT_END / FISHING_EXIT / SCENE_CHANGED silence fight sustain and it stays silent', () => {
  for (const [name, payload] of [
    [EV.FIGHT_END, { outcome: 'lineBreak', durationSec: 1, maxTension: 1, distM: 1, cause: null }],
    [EV.FISHING_EXIT, { spotId: 'lake_gravel' }],
    [EV.SCENE_CHANGED, { from: 'lake', to: 'home', reason: 'travel' }],
  ]) {
    const { bus, audio } = setup();
    audio.unlock();
    const s = stateFor('fightStress');
    s.fight.slipping = true;
    s.fight.slipSpeed = 1;
    for (let i = 0; i < 30; i++) frame(audio, s);
    assert.ok(audio.g.tensionGain.gain.target > 0);
    assert.ok(countPulses(audio.g.clickGain.gain, 0, 99) > 0 && countPulses(audio.g.rodGain.gain, 0, 99) > 0);
    bus.emit(name, payload);
    const t = audio.ctx.currentTime;
    // 상태는 아직 fighting 이어도(이벤트와 상태가 어긋난 프레임) 다시 켜지지 않는다
    for (let i = 0; i < 60; i++) frame(audio, s);
    assert.equal(lastValue(audio.g.tensionGain.gain), 0, name);
    assert.equal(lastValue(audio.g.creakGain.gain), 0, name);
    assert.equal(lastValue(audio.g.swishGain.gain), 0, name);
    void t;
    assert.equal(pulsesAfterCancel(audio.g.clickGain.gain), 0, `${name}: clicker`);
    assert.equal(pulsesAfterCancel(audio.g.rodGain.gain), 0, `${name}: rod creak`);
    // 새 파이팅이면 다시 들린다
    const s2 = stateFor('fightRun');
    for (let i = 0; i < 10; i++) frame(audio, s2);
    assert.ok(audio.g.tensionGain.gain.target > 0, `${name}: next fight audible`);
    audio.dispose();
  }
});

test('frozen sim (panel / fixture) mutes fight sustain', () => {
  const { audio } = setup();
  audio.unlock();
  const s = stateFor('fightRun');
  for (let i = 0; i < 10; i++) frame(audio, s);
  assert.ok(audio.g.tensionGain.gain.target > 0);
  for (let i = 0; i < 30; i++) { audio.ctx.currentTime += 1 / 60; audio.update(s, 1 / 60); }
  assert.equal(lastValue(audio.g.tensionGain.gain), 0);
  audio.dispose();
});

test('voices are capped at 24 and node count does not grow over 50 rounds', () => {
  const { bus, audio } = setup();
  audio.unlock();
  const base = audio.stats().nodes;
  let maxVoices = 0;
  for (let round = 0; round < 50; round++) {
    const s = stateFor(round % 2 ? 'fightRun' : 'fightStress');
    for (const [name, p] of ALL_SIM_EVENTS()) {
      bus.emit(name, p);
      maxVoices = Math.max(maxVoices, audio.stats().voices);
    }
    for (let i = 0; i < 240; i++) frame(audio, s, 1 / 30);    // 8초 — 모든 일회성 소리가 끝난다
  }
  assert.ok(maxVoices <= 24, `max voices ${maxVoices}`);
  const st = audio.stats();
  assert.ok(st.voices <= 3, `voices left ${st.voices}`);       // 환경음 새소리 정도
  assert.ok(st.nodes <= base + 3 * 7, `nodes ${st.nodes} vs base ${base}`);
  // 끊긴 노드 수와 맞는다(누수 없음)
  assert.equal(counters.created - counters.disconnected >= st.nodes, true);
  audio.dispose();
});

test('100 events in one frame keep at most 24 voices', () => {
  const { bus, audio } = setup();
  audio.unlock();
  for (let i = 0; i < 100; i++) bus.emit(EV.FIGHT_JUMP, { phase: 'land', x: 0, z: -10, lengthM: 1 });
  assert.ok(audio.stats().voices <= 24);
  audio.dispose();
});

test('setPaused / PAUSED suspend and resume; unlock while paused stays suspended', async () => {
  const { bus, audio } = setup();
  audio.setPaused(true);
  audio.unlock();
  assert.equal(audio.ctx.state, 'suspended');
  audio.setPaused(false);
  assert.equal(audio.ctx.state, 'running');
  bus.emit(EV.PAUSED, { on: true });
  assert.equal(audio.ctx.state, 'suspended');
  bus.emit(EV.PAUSED, { on: false });
  assert.equal(audio.ctx.state, 'running');
  audio.dispose();
});

test('volume: four keys and mute override', () => {
  const { bus, settings, audio } = setup();
  audio.unlock();
  assert.equal(audio.g.master.gain.target, 0.8);
  assert.equal(audio.g.amb.gain.target, 0.7);
  settings.volume.sfx = 0.3;
  settings.volume.ui = 0.2;
  settings.volume.master = 0.5;
  bus.emit(EV.SETTINGS_CHANGED, { settings });
  assert.equal(audio.g.sfx.gain.target, 0.3);
  assert.equal(audio.g.ui.gain.target, 0.2);
  assert.equal(audio.g.master.gain.target, 0.5);
  settings.mute = true;
  audio.applySettings();
  assert.equal(audio.g.master.gain.target, 0);
  settings.volume.master = NaN;     // 깨진 값도 던지지 않는다
  delete settings.mute;
  audio.applySettings();
  audio.dispose();
});

test('ambience: scene x band x rain layers', () => {
  const { audio } = setup();
  audio.unlock();
  const L = audio.g.layers;
  const coast = stateFor('rain');           // 갯바위 18:30 비
  for (let i = 0; i < 5; i++) frame(audio, coast);
  assert.ok(L.waves.gain.target > 0.3, 'coast waves');
  assert.ok(L.rain.gain.target > 0, 'rain layer');
  assert.equal(L.room.gain.target, 0);
  const night = stateFor('night');          // 호수 22:00
  for (let i = 0; i < 5; i++) frame(audio, night);
  assert.ok(L.crickets.gain.target > 0, 'lake night crickets');
  assert.equal(L.birds.gain.target, 0);
  assert.ok(L.waves.gain.target < 0.1);
  const home = stateFor('shopL12');
  for (let i = 0; i < 5; i++) frame(audio, home);
  assert.ok(L.room.gain.target > 0 && L.tick.gain.target > 0);
  assert.equal(L.wind.gain.target, 0);
  audio.dispose();
});

test('water rush pans toward the fish side (left fish -> left speaker)', () => {
  const { audio } = setup();
  audio.unlock();
  const s = stateFor('fightRun');
  s.fight.behavior = 'run';
  s.fight.slipping = true;
  s.fight.slipSpeed = 1.5;
  s.player.yaw = 0;
  s.fight.bearing = Math.PI / 2;      // yaw 규약: +pi/2 = -X = 왼쪽
  frame(audio, s);
  assert.ok(audio.g.swishPan.pan.target < -0.9, `pan ${audio.g.swishPan.pan.target}`);
  assert.ok(audio.g.swishGain.gain.target > 0);
  s.fight.bearing = -Math.PI / 2;
  frame(audio, s);
  assert.ok(audio.g.swishPan.pan.target > 0.9);
  audio.dispose();
});

test('dispose unsubscribes every listener and closes the context', () => {
  const { bus, audio } = setup();
  const before = bus.count();
  assert.ok(before > 20);
  audio.unlock();
  const ctx = audio.ctx;
  audio.dispose();
  assert.equal(bus.count(), 0);
  assert.equal(ctx.state, 'closed');
  assert.deepEqual(audio.stats(), { nodes: 0, voices: 0 });
});
