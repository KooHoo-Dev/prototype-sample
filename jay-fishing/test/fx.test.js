// OWNER: P7 — FxLayer 검사(Node · three 만 · WebGL 없음).
// 계약 §12.2(W1 확정: test/fx.test.js — 처음엔 src/view/fx/ 에 있던 것을 통합 게이트가 npm test 글롭 안으로 옮겼다).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EV, EventBus } from '../src/core/events.js';
import { DEFAULT_SETTINGS } from '../src/data/settings.js';
import { makeTestState } from './helpers.js';
import { FxLayer } from '../src/view/fx/FxLayer.js';

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

function setup(quality = 'medium') {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 2500);
  camera.position.set(0, 1.65, 1.6);
  const rc = { scene, camera, quality, renderer: { domElement: { height: 720 } } };
  const bus = new EventBus();
  const world = { heightAt: (x, z) => (z < 0 ? -2 : 0.5) };     // −Z 가 물
  const fx = new FxLayer({ rc, bus, settings: structuredClone(DEFAULT_SETTINGS), world });
  return { rc, bus, fx, scene };
}

function checkFinite(fx) {
  for (let i = 0; i < fx.pPos.length; i++) assert.ok(Number.isFinite(fx.pPos[i]), 'particle position');
  for (let i = 0; i < fx.pAlpha.length; i++) {
    assert.ok(Number.isFinite(fx.pAlpha[i]) && fx.pAlpha[i] <= 0.8 + 1e-9, `particle alpha ${fx.pAlpha[i]}`);
    assert.ok(Number.isFinite(fx.pSize[i]));
  }
  for (const r of fx.rings) {
    assert.ok(r.mat.opacity <= 0.8 + 1e-9, 'ring opacity');
    assert.ok(Number.isFinite(r.mesh.position.x) && Number.isFinite(r.mesh.scale.x));
  }
}

const DT = 1 / 60;
const KINDS = ['walkLake', 'waiting', 'nibble', 'fightRun', 'fightJump', 'fightStress', 'night', 'rain', 'shopL12'];

test('fxRoot is one group under rc.scene; pools are 400 particles and 24 rings', () => {
  const { fx, scene } = setup();
  assert.equal(fx.root.parent, scene);
  assert.equal(fx.root.name, 'fxRoot');
  assert.equal(fx.pPos.length, 400 * 3);
  assert.equal(fx.rings.length, 24);
  assert.equal(fx.root.children.length, 25);
  assert.deepEqual(fx.stats(), { particles: 0, meshes: 1 });
});

test('CAST_SPLASH: 20 spray particles + 1 ripple at the splash point', () => {
  const { bus, fx } = setup();
  const s = stateFor('waiting');
  bus.emit(EV.CAST_SPLASH, { x: 1, z: -20, distM: 21, waterDepthM: 3, baitDepthM: 2, layer: 'mid', set: 'float' });
  fx.update(s, 1, DT);
  assert.equal(fx.stats().particles, 20);
  const live = fx.rings.filter(r => r.life > 0);
  assert.equal(live.length, 1);
  assert.equal(live[0].x, 1);
  assert.equal(live[0].z, -20);
  checkFinite(fx);
});

test('bite ripples go around the bobber (float only) and start outside it', () => {
  const { bus, fx } = setup();
  const s = stateFor('nibble');
  const b = s.rig.bobber;
  bus.emit(EV.BITE_NIBBLE, { set: 'float', strength: 0.7, index: 0 });
  fx.update(s, 1, DT);
  let live = fx.rings.filter(r => r.life > 0);
  assert.equal(live.length, 1);
  assert.equal(live[0].x, b.x);
  assert.equal(live[0].z, b.z);
  // 찌 몸통 반경(0.05m × 보이는 크기)보다 안쪽 가장자리가 바깥
  const dist = Math.hypot(b.x - s.rig.origin.x, b.z - s.rig.origin.z);
  const bobberR = 0.05 * Math.min(18, Math.max(1, dist / 7));
  assert.ok(live[0].r0 * 0.8 > bobberR, `ring inner ${live[0].r0 * 0.8} vs bobber ${bobberR}`);
  bus.emit(EV.BITE_NIBBLE, { set: 'bottom', strength: 0.7, index: 1 });
  fx.update(s, 1, DT);
  assert.equal(fx.rings.filter(r => r.life > 0).length, 1, 'bottom set has no ripple');
  bus.emit(EV.BITE_TAKE, { set: 'float', style: 'sink', window: 0.5 });
  fx.update(s, 1, DT);
  assert.equal(fx.rings.filter(r => r.life > 0).length, 3, 'take = 2 ripples');
  checkFinite(fx);
});

test('fight: run/slip spray stream, jump splash from state (no event) and from event once', () => {
  const { bus, fx } = setup();
  const run = stateFor('fightRun');
  for (let i = 0; i < 60; i++) fx.update(run, 1, DT);
  assert.ok(fx.stats().particles > 5, 'stream particles');
  checkFinite(fx);
  fx.clear();
  const jump = stateFor('fightJump');
  fx.update(jump, 1, DT);
  const afterState = fx.stats().particles;
  assert.ok(afterState >= 20, `jump splash from state ${afterState}`);
  // 같은 공중 구간의 leave 이벤트는 두 번 내지 않는다
  bus.emit(EV.FIGHT_JUMP, { phase: 'leave', x: 0, z: -14, lengthM: 0.4 });
  fx.update(jump, 1, DT);
  assert.ok(fx.stats().particles <= afterState + 5);
  // land 는 낸다
  bus.emit(EV.FIGHT_JUMP, { phase: 'land', x: 0, z: -14, lengthM: 0.4 });
  fx.update(jump, 1, DT);
  assert.ok(fx.stats().particles > afterState + 10);
  checkFinite(fx);
});

test('FIGHT_END stops the stream for that fight', () => {
  const { bus, fx } = setup();
  const run = stateFor('fightRun');
  bus.emit(EV.FIGHT_END, { outcome: 'lineBreak', durationSec: 9, maxTension: 3, distM: 35, cause: null });
  for (let i = 0; i < 120; i++) fx.update(run, 1, DT);
  assert.equal(fx.stats().particles, 0);
});

test('pools never grow: 200 rounds of every event + every fixture', () => {
  const { bus, fx } = setup('high');
  const childCount = fx.root.children.length;
  let maxP = 0;
  let maxR = 0;
  for (let round = 0; round < 200; round++) {
    const s = stateFor(KINDS[round % KINDS.length]);
    bus.emit(EV.CAST_SPLASH, { x: 0, z: -24, distM: 24, waterDepthM: 3, baitDepthM: 2, layer: 'mid', set: 'float' });
    bus.emit(EV.BITE_NIBBLE, { set: 'float', strength: 1, index: 0 });
    bus.emit(EV.BITE_TAKE, { set: 'float', style: 'sink', window: 0.5 });
    bus.emit(EV.HOOK_SET, { weightKg: 2, lengthCm: 40 });
    bus.emit(EV.FIGHT_JUMP, { phase: 'leave', x: 0, z: -14, lengthM: 2.5 });
    bus.emit(EV.FIGHT_JUMP, { phase: 'land', x: 0, z: -14, lengthM: 2.5 });
    bus.emit(EV.NET_START, { x: 0, z: -2, lengthM: 0.4 });
    bus.emit(EV.CATCH_RELEASED, { catch: {}, swapped: false });
    for (let i = 0; i < 20; i++) {
      fx.update(s, 0.5, DT);
      const st = fx.stats();
      maxP = Math.max(maxP, st.particles);
      maxR = Math.max(maxR, st.meshes - 1);
    }
  }
  assert.ok(maxP <= 400);
  assert.ok(maxR <= 24);
  assert.equal(fx.root.children.length, childCount);
  checkFinite(fx);
  // 큰 dt(탭 복귀) 에서도 유한
  fx.update(stateFor('fightRun'), 1, 5);
  checkFinite(fx);
  // 시간이 지나면 비워진다(비가 없는 상태)
  const calm = stateFor('walkLake');
  for (let i = 0; i < 300; i++) fx.update(calm, 1, DT);
  assert.deepEqual(fx.stats(), { particles: 0, meshes: 1 });
});

test('rain splashes only at medium+ and only on water', () => {
  for (const q of ['low', 'medium']) {
    const { fx } = setup(q);
    const s = stateFor('rain');
    s.env.rain = 1;
    let any = 0;
    for (let i = 0; i < 120; i++) {
      fx.update(s, 1, DT);
      any = Math.max(any, fx.stats().particles);
      for (let k = 0; k < 400; k++) if (fx.pLife[k] > 0) assert.ok(fx.pPos[k * 3 + 2] < 0, 'rain on water');
    }
    if (q === 'low') assert.equal(any, 0);
    else assert.ok(any > 0);
  }
});

test('scene change (event or state) clears everything; dispose unsubscribes', () => {
  const { bus, fx, scene } = setup();
  const s = stateFor('fightRun');
  for (let i = 0; i < 30; i++) fx.update(s, 1, DT);
  assert.ok(fx.stats().particles > 0);
  bus.emit(EV.SCENE_CHANGED, { from: 'lake', to: 'home', reason: 'travel' });
  const home = stateFor('shopL12');
  fx.update(home, 1, DT);
  assert.deepEqual(fx.stats(), { particles: 0, meshes: 1 });
  for (let i = 0; i < 30; i++) fx.update(s, 1, DT);
  assert.ok(fx.stats().particles > 0);
  fx.update(home, 1, DT);                    // 이벤트 없이 상태만 바뀌어도
  assert.equal(fx.stats().particles, 0);
  fx.dispose();
  assert.equal(bus.count(), 0);
  assert.equal(fx.root.parent, null);
  assert.ok(!scene.children.includes(fx.root));
});
