// OWNER: P9 — 계약 §12.2 · §5.12 · §11.3 · §11.13
// 고정 틱 누산기(스텝 상한 · 폭주 없음 · 멈춘 동안 쌓지 않음 · 보간 alpha) · rAF 구동(가짜 시계) · 화면 상태 기계 · step 조건 · 일시정지 사유

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT, MAX_FRAME_DT, MAX_STEPS_PER_FRAME } from '../src/core/constants.js';
import { EV, EventBus } from '../src/core/events.js';
import { FixedStepper, createLoop } from '../src/app/loop.js';
import { BOT_HALT_PANELS, createScreens, pauseReason, stepAllowed } from '../src/app/screens.js';

/** 프레임 n 개를 dt 로 돌려 step 수 */
function run(stepper, frames, dt, running = true) {
  let steps = 0;
  for (let i = 0; i < frames; i++) steps += stepper.frame(dt, running, () => {});
  return steps;
}

test('app.loop: 60 · 144 · 30Hz 프레임에서 실제 시간과 같은 틱 수(1초 = 30틱 ± 1)', () => {
  for (const hz of [30, 60, 75, 120, 144]) {
    const s = new FixedStepper();
    const steps = run(s, hz * 10, 1 / hz);
    assert.ok(Math.abs(steps - 300) <= 1, `${hz}Hz: 10초에 ${steps}틱`);
    assert.ok(s.alpha >= 0 && s.alpha <= 1);
  }
});

test('app.loop: 60Hz 두 프레임(1/60 + 1/60)이 부동소수 오차로 한 틱을 놓치지 않는다', () => {
  const s = new FixedStepper();
  assert.equal(s.frame(1 / 60, true, () => {}), 0);
  assert.equal(s.frame(1 / 60, true, () => {}), 1);
});

test('app.loop: 큰 dt → MAX_FRAME_DT 로 자르고 프레임당 MAX_STEPS_PER_FRAME · 남은 acc 가 2 × DT 를 넘으면 버린다(폭주 없음)', () => {
  const s = new FixedStepper();
  assert.equal(s.frame(10, true, () => {}), MAX_STEPS_PER_FRAME, '탭이 돌아온 10초 프레임');
  assert.ok(s.acc <= 2 * DT + 1e-9, `acc ${s.acc}`);
  // 0.25 초 프레임이 이어져도 프레임당 상한 · 누적 없음
  let steps = 0;
  for (let i = 0; i < 20; i++) steps += s.frame(MAX_FRAME_DT, true, () => {});
  assert.ok(steps <= 20 * MAX_STEPS_PER_FRAME);
  assert.ok(s.acc <= 2 * DT + 1e-9);
  // 음수 · NaN dt 는 0
  const t = new FixedStepper();
  assert.equal(t.frame(-5, true, () => {}), 0);
  assert.equal(t.frame(NaN, true, () => {}), 0);
  assert.equal(t.acc, 0);
});

test('app.loop: 멈춘 동안(running false — 일시정지 · 모달 · 막 · 히트스톱) 누산기는 쌓지 않는다 · 다시 돌면 따라잡기 없음', () => {
  const s = new FixedStepper();
  s.frame(DT * 0.5, true, () => {});
  const acc = s.acc;
  assert.equal(run(s, 120, 1 / 60, false), 0);
  assert.equal(s.acc, acc, '멈춘 2초 동안 그대로');
  assert.ok(s.frame(1 / 60, true, () => {}) <= 1, '풀린 첫 프레임에 몰아치지 않는다');
});

test('app.loop: canContinue — 한 프레임의 둘째 step 부터 다시 묻는다(그 틱의 히트스톱 · 모달 · 전환이 남은 step 을 막는다)', () => {
  const s = new FixedStepper();
  let n = 0;
  let halted = false;
  const steps = s.frame(MAX_FRAME_DT, true, () => { n++; if (n === 2) halted = true; }, () => !halted);
  assert.equal(steps, 2);
  assert.equal(n, 2);
});

test('app.loop: alpha = acc / DT · hold() 뒤에는 거의 1 이고 덤 step 이 없다', () => {
  const s = new FixedStepper();
  s.frame(DT * 0.25, true, () => {});
  assert.ok(Math.abs(s.alpha - 0.25) < 1e-9);
  s.hold();
  assert.ok(s.alpha > 0.999 && s.alpha <= 1);
  assert.equal(s.frame(0, true, () => {}), 0);
  s.reset();
  assert.equal(s.alpha, 0);
});

test('app.loop: createLoop — 가짜 rAF · 시계로 dt 를 넘기고 자르며 stop 뒤 멈춘다 · 예외는 onError 로(루프는 계속)', () => {
  /** @type {Array<(t:number) => void>} */
  let queue = [];
  let id = 0;
  let clock = 1000;
  const raf = (cb) => { queue.push(cb); return ++id; };
  const caf = () => { queue = []; };
  const dts = [];
  const errs = [];
  let boom = false;
  const loop = createLoop({
    onFrame: (dt) => { dts.push(dt); if (boom) { boom = false; throw new Error('x'); } },
    onError: (e) => errs.push(e), raf, caf, now: () => clock,
  });
  const pump = (ms) => { clock += ms; const q = queue; queue = []; for (const cb of q) cb(clock); };
  loop.start();
  assert.equal(loop.running, true);
  pump(16);
  pump(16);
  pump(5000);                                         // 탭이 오래 숨었다 돌아옴
  boom = true;
  pump(16);
  pump(16);
  assert.equal(dts.length, 5);
  assert.ok(Math.abs(dts[0] - 0.016) < 1e-9);
  assert.equal(dts[2], MAX_FRAME_DT, '큰 dt 는 자른다');
  assert.equal(errs.length, 1, '예외 하나 · 루프 계속');
  loop.resync();
  clock += 3000;
  loop.stop();
  pump(16);
  assert.equal(dts.length, 5, 'stop 뒤 프레임 없음');
  assert.equal(loop.running, false);
});

test('app.screens: boot → title ⇄ play · 어디서든 → fatal · SCREEN_CHANGED{from, to}', () => {
  const bus = new EventBus();
  const seen = [];
  bus.on(EV.SCREEN_CHANGED, (p) => seen.push(`${p.from}>${p.to}`));
  const sc = createScreens({ bus });
  assert.equal(sc.current, 'boot');
  assert.equal(sc.go('title'), true);
  assert.equal(sc.go('title'), true, '같은 화면은 그대로');
  assert.equal(sc.go('boot'), false, '부트로 돌아가지 않는다');
  assert.equal(sc.go('play'), true);
  assert.equal(sc.go('title'), true);
  assert.equal(sc.go('fatal'), true);
  assert.equal(sc.go('play'), false, 'fatal 에서 나가지 않는다');
  assert.equal(sc.is('fatal'), true);
  assert.deepEqual(seen, ['boot>title', 'title>play', 'play>title', 'title>fatal']);
  const d = createScreens({});
  assert.equal(d.go('play'), true, 'dev 부트는 바로 play');
});

const BASE = Object.freeze({
  screen: 'play', hasChar: true, fading: false, hitstop: false, hidden: false, blurred: false, contextLost: false, debugPaused: false,
  modal: false, anyOpen: false, top: null, scene: 'rift', bot: false,
});

test('app.screens: step 조건(§11.3) — play 에서만 · 막 · 히트스톱 · 숨김 · 포커스 · 컨텍스트 · 일시정지 · 모달 · 마을 패널', () => {
  assert.equal(stepAllowed({ ...BASE }), true);
  for (const k of ['fading', 'hitstop', 'hidden', 'blurred', 'contextLost', 'debugPaused', 'modal']) {
    assert.equal(stepAllowed({ ...BASE, [k]: true }), false, k);
  }
  assert.equal(stepAllowed({ ...BASE, screen: 'title' }), false);
  assert.equal(stepAllowed({ ...BASE, hasChar: false }), false);
  // 균열에서 겹쳐 보는 패널은 시간이 흐른다 · 마을에서는 어떤 패널이든 멈춘다
  assert.equal(stepAllowed({ ...BASE, anyOpen: true, top: 'inventory' }), true);
  assert.equal(stepAllowed({ ...BASE, scene: 'town', anyOpen: true, top: 'inventory' }), false);
  assert.equal(stepAllowed({ ...BASE, scene: 'town' }), true);
});

test('app.screens: 봇이 켜져 있으면 마을 패널 · 모달 일반(사망 · 상점)을 보지 않고 사람이 연 일시정지 · 분석만 멈춘다(§11.13)', () => {
  const bot = { ...BASE, bot: true };
  assert.equal(stepAllowed({ ...bot, scene: 'town', anyOpen: true, top: 'blacksmith', modal: false }), true);
  assert.equal(stepAllowed({ ...bot, top: 'death', anyOpen: true, modal: false }), true);
  for (const id of BOT_HALT_PANELS) assert.equal(stepAllowed({ ...bot, top: id, anyOpen: true }), false, id);
  assert.ok(BOT_HALT_PANELS.includes('pause') && BOT_HALT_PANELS.includes('analytics'));
  assert.equal(stepAllowed({ ...bot, fading: true }), false, '봇도 전환 막 동안은 멈춘다(commit 은 app 의 막이 — 두 번 commit 하지 않는다)');
});

test('app.screens: 일시정지 사유(PAUSED reason) — 우선순위 context > hidden > blur > debug > menu > modal · 막 · 마을 패널은 일시정지가 아니다', () => {
  assert.equal(pauseReason({ ...BASE }), null);
  assert.equal(pauseReason({ ...BASE, contextLost: true, hidden: true }), 'context');
  assert.equal(pauseReason({ ...BASE, hidden: true, blurred: true }), 'hidden');
  assert.equal(pauseReason({ ...BASE, blurred: true, debugPaused: true }), 'blur');
  assert.equal(pauseReason({ ...BASE, debugPaused: true, modal: true, top: 'pause' }), 'debug');
  assert.equal(pauseReason({ ...BASE, modal: true, top: 'pause' }), 'menu');
  assert.equal(pauseReason({ ...BASE, modal: true, top: 'settings' }), 'menu');
  assert.equal(pauseReason({ ...BASE, modal: true, top: 'blacksmith' }), 'modal');
  assert.equal(pauseReason({ ...BASE, fading: true }), null);
  assert.equal(pauseReason({ ...BASE, scene: 'town', anyOpen: true, top: 'inventory' }), null);
  assert.equal(pauseReason({ ...BASE, screen: 'title', modal: true, top: 'title' }), null, '타이틀은 일시정지가 아니다');
});
