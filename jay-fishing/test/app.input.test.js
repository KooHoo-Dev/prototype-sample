// OWNER: P9 — 계약 §12.2(app.input) · §11.3 · §5.9
// frameFromState(바인딩 · 에지 한 번 · 휠 누적) · 수정키 무시 · 락을 요청하는 클릭은 primary 로 나가지 않는다 · 낚시 모드 A/D 조준 · 루프 누산.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputCollector, applyMouseDelta, frameFromState, wheelToSteps } from '../src/app/input.js';
import { runAccumulator, clampFrameDt } from '../src/app/loop.js';
import { DT, MAX_FRAME_DT, MAX_STEPS_PER_FRAME } from '../src/core/constants.js';
import { EV, EventBus } from '../src/core/events.js';
import { MOUSE } from '../src/data/settings.js';
import { WHEEL } from '../src/data/keybinds.js';

/** 이벤트 대상 가짜 */
class FakeTarget {
  constructor() { this.l = new Map(); }
  addEventListener(n, fn) { (this.l.get(n) || this.l.set(n, []).get(n)).push(fn); }
  removeEventListener(n, fn) { const a = this.l.get(n) || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  fire(n, e = {}) { for (const fn of (this.l.get(n) || []).slice()) fn({ preventDefault() { this.prevented = true; }, cancelable: true, ...e }); }
  count() { let n = 0; for (const a of this.l.values()) n += a.length; return n; }
}

/** 포인터 락 API 가 있는 가짜 캔버스 · 문서 */
function rig({ lockApi = true, lockSucceeds = true } = {}) {
  const win = new FakeTarget();
  const doc = new FakeTarget();
  doc.pointerLockElement = null;
  doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.fire('pointerlockchange'); };
  const canvas = new FakeTarget();
  canvas.requests = 0;
  if (lockApi) {
    canvas.requestPointerLock = () => {
      canvas.requests++;
      if (lockSucceeds) { doc.pointerLockElement = canvas; doc.fire('pointerlockchange'); } else doc.fire('pointerlockerror');
    };
  } else delete doc.pointerLockElement;
  const bus = new EventBus();
  const locks = [];
  bus.on(EV.POINTER_LOCK, (p) => locks.push(p));
  const settings = { mouseSens: 1, invertY: false };
  const input = new InputCollector({ canvas, settings, bus, win, doc });
  return { win, doc, canvas, bus, locks, input, settings };
}

test('frameFromState: 바인딩 · 에지 한 번 · 휠 누적 → 정수 눈금', () => {
  const look = { yaw: 0.5, pitch: -0.2 };
  const f = frameFromState(new Set(['KeyW', 'KeyD', 'Mouse0', 'Mouse2']), { pressed: ['Mouse0', 'Space', 'KeyE', 'KeyR', 'KeyZ', 'KeyZ', 'KeyC', 'ArrowUp', 'Digit1', 'Digit2'], released: [] }, look, 2);
  assert.equal(f.moveZ, 1);
  assert.equal(f.moveX, 1);
  assert.equal(f.primary, true);
  assert.equal(f.secondary, true);
  assert.equal(f.primaryPressed, true);
  assert.equal(f.primaryReleased, false);
  assert.equal(f.hook, true);
  assert.equal(f.interact, true);
  assert.equal(f.bail, true);
  assert.equal(f.dragSteps, 2 + 2 - 1);
  assert.equal(f.depthSteps, 1);
  assert.equal(f.selectSet, 'bottom', '나중에 누른 세트');
  assert.equal(f.yaw, 0.5);
  assert.equal(f.pitch, -0.2);
  const n = frameFromState(new Set(), null, look, 0);
  assert.equal(n.hook || n.primary || n.interact || n.bail, false);
  assert.equal(n.selectSet, null);

  // 휠: deltaY 100px = 1눈금(↑ = +) · 소수는 누적 · 줄 단위 ×33
  let r = wheelToSteps(0, -60, 0);
  assert.equal(r.steps, 0);
  r = wheelToSteps(r.acc, -60, 0);
  assert.equal(r.steps, 1);
  assert.ok(Math.abs(r.acc - 0.2) < 1e-9);
  assert.equal(wheelToSteps(0, 3, 1).steps, Math.trunc(-3 * WHEEL.linePx / WHEEL.pxPerStep));
  assert.equal(wheelToSteps(0, NaN, 0).steps, 0);

  // 수집기: 에지는 첫 buildFrame 에만
  const { win, input } = rig();
  win.fire('keydown', { code: 'Space' });
  win.fire('keydown', { code: 'KeyZ' });
  assert.equal(input.buildFrame().hook, true);
  const second = input.buildFrame();
  assert.equal(second.hook, false, '에지는 한 번만');
  assert.equal(second.dragSteps, 0);
  // 반복 키는 에지가 아니다 · 홀드는 추적
  win.fire('keydown', { code: 'KeyW', repeat: true });
  assert.equal(input.buildFrame().moveZ, 1);
  win.fire('keyup', { code: 'KeyW' });
  assert.equal(input.buildFrame().moveZ, 0);
  // 패널 동안(setCapture false) 에지는 버리고 홀드만 — 닫힌 뒤 눌림
  input.setCapture(false);
  win.fire('keydown', { code: 'KeyE' });
  win.fire('keydown', { code: 'KeyA' });
  input.setCapture(true);
  const after = input.buildFrame();
  assert.equal(after.interact, false);
  assert.equal(after.moveX, -1);
  input.releaseAll();
  assert.equal(input.buildFrame().moveX, 0);
});

test('수정키 무시', () => {
  const { win, input } = rig();
  let handled = 0;
  input.keyHandler = () => { handled++; return false; };
  const ev = { code: 'KeyE', ctrlKey: true };
  win.fire('keydown', ev);
  win.fire('keydown', { code: 'Space', altKey: true });
  win.fire('keydown', { code: 'Tab', metaKey: true });
  const f = input.buildFrame();
  assert.equal(f.interact, false);
  assert.equal(f.hook, false);
  assert.equal(handled, 0, '수정키 조합은 처리기에도 넘기지 않는다');
  // preventDefault 도 하지 않는다
  let prevented = false;
  for (const fn of win.l.get('keydown')) fn({ code: 'Space', ctrlKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  // 수정키가 없으면 Space 는 막고 처리기를 거친다 · 처리기가 삼키면 에지 없음
  input.keyHandler = () => true;
  for (const fn of win.l.get('keydown')) fn({ code: 'Space', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(input.buildFrame().hook, false);
});

test('락을 요청하는 pointerdown 은 primary 로 나가지 않는다', () => {
  const { win, canvas, input, locks } = rig();
  canvas.fire('mousedown', { button: 0 });
  assert.equal(canvas.requests, 1, '락을 요청했다');
  assert.equal(input.pointerLocked, true);
  let f = input.buildFrame();
  assert.equal(f.primary, false);
  assert.equal(f.primaryPressed, false);
  win.fire('mouseup', { button: 0 });
  f = input.buildFrame();
  assert.equal(f.primaryReleased, false, '삼킨 누름은 뗌도 없다');
  assert.deepEqual(locks.at(-1), { locked: true, available: true });
  // 락 중의 클릭은 그대로
  canvas.fire('mousedown', { button: 0 });
  canvas.fire('mousedown', { button: 2 });
  f = input.buildFrame();
  assert.equal(f.primaryPressed, true);
  assert.equal(f.primary, true);
  assert.equal(f.secondary, true, '좌클릭을 누른 채 우클릭(화음)');
  win.fire('mouseup', { button: 0 });
  assert.equal(input.buildFrame().primaryReleased, true);
  // 마우스 이동(락) — 오른쪽이면 yaw 감소 · 스파이크는 자른다
  const y0 = input.look.yaw;
  win.fire('mousemove', { movementX: 10000, movementY: 0 });
  assert.ok(Math.abs((y0 - input.look.yaw) - MOUSE.spikeClampPx * MOUSE.radPerPx) < 1e-9);
  // app 이 풀면 상실로 치지 않는다 · 사용자가 풀면(Esc) onLockLost 한 번
  let lost = 0;
  input.onLockLost = () => lost++;
  input.releaseLock();
  assert.equal(lost, 0);
  canvas.fire('mousedown', { button: 0 });   // 다시 잠금(삼킴)
  win.fire('mouseup', { button: 0 });
  input.doc.pointerLockElement = null;
  input.doc.fire('pointerlockchange');
  assert.equal(lost, 1);
  // 한 번 성공한 뒤의 실패는 available 을 바꾸지 않는다(드래그로 영영 바뀌지 않는다)
  canvas.requestPointerLock = () => { input.doc.fire('pointerlockerror'); };
  canvas.fire('mousedown', { button: 0 });
  assert.deepEqual(locks.at(-1), { locked: false, available: true });
  assert.equal(input.buildFrame().primaryPressed, false);
  // 게이트가 닫혀 있으면 요청하지 않고 그래도 삼킨다
  win.fire('mouseup', { button: 0 });
  let asked = 0;
  canvas.requestPointerLock = () => { asked++; };
  input.lockGate = () => false;
  canvas.fire('mousedown', { button: 0 });
  assert.equal(asked, 0);
  assert.equal(input.buildFrame().primaryPressed, false);
});

test('포인터 락: 첫 요청 실패 → 드래그 대체 · API 없음 → 처음부터 드래그', () => {
  const a = rig({ lockSucceeds: false });
  a.canvas.fire('mousedown', { button: 0 });
  assert.deepEqual(a.locks.at(-1), { locked: false, available: false });
  a.win.fire('mouseup', { button: 0 });
  a.input.setMode('walk');
  a.canvas.fire('mousedown', { button: 0 });
  const f = a.input.buildFrame();
  assert.equal(f.primaryPressed, true, '드래그 대체에서는 클릭이 그대로 나간다');
  const y0 = a.input.look.yaw;
  a.win.fire('mousemove', { movementX: 50, movementY: 0 });
  assert.ok(a.input.look.yaw < y0, '걷기 모드 좌 드래그 = 시선');
  a.win.fire('mouseup', { button: 0 });
  a.input.setMode('fish');
  a.canvas.fire('mousedown', { button: 0 });
  const y1 = a.input.look.yaw;
  a.win.fire('mousemove', { movementX: 50, movementY: 0 });
  assert.equal(a.input.look.yaw, y1, '낚시 모드 좌클릭은 시선이 아니다(릴링)');
  a.win.fire('mouseup', { button: 0 });
  a.canvas.fire('mousedown', { button: 1 });
  a.win.fire('mousemove', { movementX: 50, movementY: 0 });
  assert.ok(a.input.look.yaw < y1, '가운데 드래그는 언제나');

  // 키(Enter)로 연 요청(soft)의 실패는 드래그로 굳히지 않는다
  const c = rig({ lockSucceeds: false });
  c.input.requestLock({ soft: true });
  assert.deepEqual(c.locks.at(-1), { locked: false, available: true });
  c.canvas.fire('mousedown', { button: 0 });
  assert.equal(c.canvas.requests, 2, '다음 클릭은 다시 락을 요청한다');
  assert.equal(c.input.buildFrame().primaryPressed, false);

  const b = rig({ lockApi: false });
  b.canvas.fire('mousedown', { button: 0 });
  assert.equal(b.input.buildFrame().primaryPressed, true);
  b.input.announceLock();
  assert.deepEqual(b.locks.at(-1), { locked: false, available: false });
  b.input.dispose();
  assert.equal(b.win.count() + b.canvas.count() + b.doc.count(), 0, 'dispose 가 리스너를 전부 뗀다');
});

test('낚시 모드 A/D → yaw 회전(keyYawRate)', () => {
  const { win, input } = rig();
  input.setLook(0, 0);
  win.fire('keydown', { code: 'KeyA' });
  input.setMode('walk');
  input.tick(1);
  assert.equal(input.look.yaw, 0, '걷기 모드에서는 돌지 않는다');
  input.setMode('fish');
  input.tick(0.5);
  assert.ok(Math.abs(input.look.yaw - MOUSE.keyYawRate * 0.5) < 1e-9, 'A = 좌회전 = yaw +');
  win.fire('keyup', { code: 'KeyA' });
  win.fire('keydown', { code: 'KeyD' });
  input.tick(0.5);
  assert.ok(Math.abs(input.look.yaw) < 1e-9, 'D = yaw −');
  input.setCapture(false);
  input.tick(0.5);
  assert.ok(Math.abs(input.look.yaw) < 1e-9, '패널 동안은 돌지 않는다');
  // 마우스 감도 · Y 반전 · pitch 자르기
  const l = applyMouseDelta({ yaw: 0, pitch: 0 }, 0, -100, { mouseSens: 2, invertY: true });
  assert.ok(l.pitch < 0);
  assert.equal(applyMouseDelta({ yaw: 0, pitch: 1.39 }, 0, -10000, { mouseSens: 3 }).pitch, 1.4);
});

test('루프 누산: 프레임당 8틱 · 탭 복귀 폭주 없음 · 패널이 열리면 남은 틱 없음', () => {
  assert.equal(clampFrameDt(10_000), MAX_FRAME_DT);
  assert.equal(clampFrameDt(-5), 0);
  assert.equal(clampFrameDt(NaN), 0);
  const st = { acc: 0 };
  let n = 0;
  assert.equal(runAccumulator(st, 100, () => true, () => { n++; return true; }), MAX_STEPS_PER_FRAME);
  assert.equal(st.acc, 0, '밀린 시간은 버린다');
  assert.equal(runAccumulator(st, DT * 2.5, () => true, () => true), 2);
  assert.ok(st.acc > 0 && st.acc < DT, '남은 소수는 다음 프레임으로');
  // 두 번째 틱에서 패널이 열린다
  st.acc = 0;
  let blocking = false;
  let k = 0;
  const steps = runAccumulator(st, DT * 5, () => !blocking, () => { k++; if (k === 2) blocking = true; return true; });
  assert.equal(steps, 2);
  assert.equal(st.acc, 0);
  // 멈춘 동안은 쌓지 않는다
  assert.equal(runAccumulator(st, 0.2, () => false, () => true), 0);
  assert.equal(st.acc, 0);
  // stepOnce 가 false(봇 명령이 막을 열었다) → 멈춤
  assert.equal(runAccumulator(st, DT * 3, () => true, () => false), 0);
  assert.equal(st.acc, 0);
});
