// 계약 §9.7 — AudioEngine의 지속음(브레스 · 광선) 수명. Node에는 WebAudio가 없다:
// 잠금 해제 전의 no-op과, 가짜 sfx/music을 끼운 뒤의 「언제 켜고 언제 끄는가」만 본다(소리 자체는 보지 않는다).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus, EV } from '../src/core/events.js';
import { DEFAULT_SETTINGS } from '../src/data/settings.js';
import { VALDER } from '../src/data/bosses/valder.js';
import { AudioEngine } from '../src/audio/AudioEngine.js';
import { makeTestState } from './helpers.js';

/** 지속음의 켜짐/꺼짐만 기억하는 가짜 Sfx(나머지 메서드는 전부 no-op). */
function fakeSfx() {
  const loops = new Set();
  const base = {
    loops,
    loopStart(key) { loops.add(key); },
    loopStop(key) { loops.delete(key); },
    loopStopAll() { loops.clear(); },
  };
  return new Proxy(base, { get: (t, k) => (k in t ? t[k] : () => {}) });
}

/** unlock()을 거치지 않고 잠금 해제된 상태를 만든다(AudioContext가 없는 환경). */
function makeEngine() {
  const bus = new EventBus();
  const audio = new AudioEngine({ bus, settings: { ...DEFAULT_SETTINGS } });
  const sfx = fakeSfx();
  audio.ctx = /** @type {any} */ ({ currentTime: 0, state: 'running' });
  audio.sfx = /** @type {any} */ (sfx);
  audio.music = /** @type {any} */ ({ setTrack() {}, update() {}, dispose() {} });
  const cue = (name, seq) => bus.emit(EV.BOSS_CUE, { bossId: 'x', attackId: 'x', seq, cue: name, style: 'frost', x: 0, z: 5, facing: 0 });
  return { bus, audio, sfx, cue };
}

describe('AudioEngine — 지속음', () => {
  test('잠금 해제 전에는 이벤트 · update가 전부 no-op이다', () => {
    const bus = new EventBus();
    const audio = new AudioEngine({ bus, settings: { ...DEFAULT_SETTINGS } });
    const state = makeTestState({ bossDef: VALDER });
    bus.emit(EV.BOSS_CUE, { bossId: 'x', attackId: 'x', seq: 1, cue: 'breath_start', style: 'frost', x: 0, z: 0, facing: 0 });
    bus.emit(EV.FIGHT_PHASE, { phase: 'done' });
    bus.emit(EV.FIGHT_ENDED, { bossId: 'valder', outcome: 'death' });
    bus.emit(EV.PLAYER_DIED, {});
    audio.update(state, 1 / 60);
    audio.setPaused(true);
    assert.equal(audio.ctx, null);
    assert.equal(audio.sfx, null);
    audio.dispose();
  });

  test('시작 큐로 켜지고 끝 큐 · BOSS_ATTACK_END · BOSS_DEFEATED · MODE_CHANGED로 꺼진다 · 끝 이벤트가 없으면 6초 상한', () => {
    const { bus, audio, sfx, cue } = makeEngine();
    const state = makeTestState({ bossDef: VALDER });
    cue('breath_start', 7);
    assert.deepEqual([...sfx.loops], ['breath:7']);
    cue('breath_end', 7);
    assert.equal(sfx.loops.size, 0);
    cue('beam_start', 8);
    bus.emit(EV.BOSS_ATTACK_END, { bossId: 'x', attackId: 'x', seq: 8 });
    assert.equal(sfx.loops.size, 0);
    cue('beam_start', 9);
    bus.emit(EV.BOSS_DEFEATED, { bossId: 'x' });
    assert.equal(sfx.loops.size, 0);
    cue('breath_start', 10);
    bus.emit(EV.MODE_CHANGED, { mode: 'town', worldId: 'town', bossId: null });
    assert.equal(sfx.loops.size, 0);
    // 끝 이벤트를 놓쳐도 교전 중이면 상한(6초)까지만 난다
    cue('breath_start', 11);
    for (let i = 0; i < 5 * 60; i++) audio.update(state, 1 / 60);
    assert.equal(sfx.loops.size, 1, '5초에는 아직 난다');
    for (let i = 0; i < 70; i++) audio.update(state, 1 / 60);
    assert.equal(sfx.loops.size, 0, '6초 상한');
    audio.ctx = null;
    audio.dispose();
  });

  test('사망 뒤 아웃트로에서 시작된 브레스 · 광선은 교전이 끝나는 순간 꺼진다(결과 화면까지 남지 않는다)', () => {
    // sim의 실제 순서: player/died → fight/phase:outro → boss/attackActive → boss/cue:breath_start → fight/phase:done → fight/ended
    // (보스는 active에서 얼어붙는다 — breath_end · BOSS_ATTACK_END가 오지 않는다)
    for (const end of ['phase', 'ended', 'state']) {
      const { bus, audio, sfx, cue } = makeEngine();
      const state = makeTestState({ bossDef: VALDER });
      cue('breath_start', 3);
      bus.emit(EV.PLAYER_DIED, {});
      assert.equal(sfx.loops.size, 0, '사망 시점의 지속음은 꺼진다');
      bus.emit(EV.FIGHT_PHASE, { phase: 'outro' });
      cue('breath_start', 4);
      cue('beam_start', 5);
      assert.equal(sfx.loops.size, 2, '아웃트로 동안은 난다(보스는 계속 움직인다)');
      state.fight.phase = 'outro';
      audio.update(state, 1 / 60);
      assert.equal(sfx.loops.size, 2);
      // 교전 종료: 이벤트(FIGHT_PHASE{done} — 포기는 이것만 온다 · FIGHT_ENDED) 또는, 이벤트를 놓쳤으면 상태
      state.fight.phase = 'done';
      state.fight.outcome = 'death';
      if (end === 'phase') bus.emit(EV.FIGHT_PHASE, { phase: 'done' });
      else if (end === 'ended') bus.emit(EV.FIGHT_ENDED, { bossId: 'valder', outcome: 'death', reward: null, duration: 10, damageFraction: 0.3 });
      else audio.update(state, 0);   // 일시정지(dt 0)여도 끈다
      assert.equal(sfx.loops.size, 0, `교전 종료(${end}) 뒤에 지속음이 남았다`);
      // 다음 판의 지속음은 다시 난다
      state.fight.phase = 'fight';
      state.fight.outcome = null;
      cue('beam_start', 6);
      audio.update(state, 1 / 60);
      assert.deepEqual([...sfx.loops], ['beam:6']);
      audio.ctx = null;
      audio.dispose();
    }
  });
});
