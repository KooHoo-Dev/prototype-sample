// 계약 §9.7 — FxLayer의 지속 연출(브레스 · 광선)이 교전 종료 뒤에 남지 않는다. Node에서 three만으로(WebGL 없이).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus, EV } from '../src/core/events.js';
import { DEFAULT_SETTINGS } from '../src/data/settings.js';
import { VALDER } from '../src/data/bosses/valder.js';
import { FxLayer } from '../src/view/fx/FxLayer.js';
import { makeTestState } from './helpers.js';

function makeFx() {
  const bus = new EventBus();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
  const fx = new FxLayer({ scene, camera, bus, characters: null, settings: { ...DEFAULT_SETTINGS } });
  const state = makeTestState({ bossDef: VALDER });
  state.boss.attack = /** @type {any} */ ({ id: 'x', seq: 4, phase: 'active', phaseT: 0, t: 0, windup: 0.8, active: 2.0, recovery: 1 });
  const cue = (name, seq) => bus.emit(EV.BOSS_CUE, { bossId: 'valder', attackId: 'x', seq, cue: name, style: 'void', x: 0, z: 5, facing: Math.PI,
    length: 14, width: 1.2, halfAngle: 0.5 });
  const active = () => fx._sustain.filter((s) => s.on).map((s) => `${s.type}:${s.seq}`).sort();
  return { bus, fx, state, cue, active };
}

describe('FxLayer — 지속 연출', () => {
  test('시작 큐로 켜지고 끝 큐로 꺼진다 · 교전 중에는 판정 길이 + 여유까지 유지된다', () => {
    const { fx, state, cue, active } = makeFx();
    fx.update(state, 1, 1 / 60);
    cue('beam_start', 4);
    cue('breath_start', 4);
    fx.update(state, 1, 1 / 60);
    assert.deepEqual(active(), ['beam:4', 'breath:4']);
    assert.equal(fx._beam.visible, true);
    for (let i = 0; i < 90; i++) fx.update(state, 1, 1 / 60);
    assert.deepEqual(active(), ['beam:4', 'breath:4'], '1.5초 뒤에도 난다(판정 2초)');
    cue('beam_end', 4);
    cue('breath_end', 4);
    fx.update(state, 1, 1 / 60);
    assert.deepEqual(active(), []);
    assert.equal(fx._beam.visible, false);
    fx.dispose();
  });

  test('사망 뒤 아웃트로에서 시작된 브레스 · 광선은 교전이 끝나면(phase done) 접힌다 — 얼어붙은 보스에서 계속 나오지 않는다', () => {
    const { bus, fx, state, cue, active } = makeFx();
    fx.update(state, 1, 1 / 60);
    bus.emit(EV.PLAYER_DIED, {});
    state.fight.phase = 'outro';
    state.fight.outcome = 'death';
    cue('beam_start', 4);
    cue('breath_start', 4);
    for (let i = 0; i < 6; i++) fx.update(state, 1, 1 / 60);
    assert.deepEqual(active(), ['beam:4', 'breath:4'], '아웃트로 동안은 난다');
    assert.equal(fx._beam.visible, true);
    // sim이 done에서 멈춘다: 끝 큐도 BOSS_ATTACK_END도 오지 않는다
    state.fight.phase = 'done';
    fx.update(state, 1, 1 / 60);
    assert.deepEqual(active(), [], '결과 화면에 지속 연출이 남았다');
    assert.equal(fx._beam.visible, false, '광선 메시가 남았다');
    // 다음 판에서는 다시 난다
    state.fight.phase = 'fight';
    state.fight.outcome = null;
    cue('beam_start', 9);
    fx.update(state, 1, 1 / 60);
    assert.deepEqual(active(), ['beam:9']);
    fx.dispose();
  });
});
