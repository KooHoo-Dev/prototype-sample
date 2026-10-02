// OWNER: P9 — 계약 §5.9 · §11.1
// 누산 루프: frameDt = min(실제 경과, MAX_FRAME_DT) → 고정 틱(DT)을 프레임당 MAX_STEPS_PER_FRAME 까지.
// 멈춤 조건(패널 · 결과 단계 · 전환 막)은 canStep 이 말한다 — 한 프레임 안에서 패널이 열리면 남은 틱을 돌리지 않고 밀린 시간은 버린다.
// runAccumulator 는 순수(테스트) · createLoop 는 requestAnimationFrame 스케줄(시계는 app 에서만).

import { DT, MAX_FRAME_DT, MAX_STEPS_PER_FRAME } from '../core/constants.js';

/**
 * §5.9 누산. st.acc 를 제자리에서 바꾼다.
 * @param {{acc:number}} st
 * @param {number} frameDt 초(이미 MAX_FRAME_DT 로 자른 값)
 * @param {() => boolean} canStep 지금 틱을 돌려도 되는가(패널 · 결과 · 전환 막이면 false)
 * @param {() => boolean} stepOnce 한 틱을 돌린다 — false 면 돌리지 않았다(봇 명령이 막을 열었다 등) → 멈춘다
 * @returns {number} 돌린 틱 수
 */
export function runAccumulator(st, frameDt, canStep, stepOnce) {
  const d = Number.isFinite(frameDt) && frameDt > 0 ? Math.min(frameDt, MAX_FRAME_DT) : 0;
  st.acc += d;
  let steps = 0;
  let halted = false;
  while (st.acc >= DT && steps < MAX_STEPS_PER_FRAME) {
    if (!canStep() || !stepOnce()) {
      halted = true;
      break;
    }
    st.acc -= DT;
    steps++;
  }
  // 밀린 시간은 버린다(탭 복귀 · 느린 프레임) · 멈춘 동안 쌓지 않는다
  if (steps === MAX_STEPS_PER_FRAME || halted || !canStep()) st.acc = 0;
  return steps;
}

/** 경과(ms) → frameDt(초) · 음수 · NaN 은 0 · 상한 MAX_FRAME_DT @param {number} ms @returns {number} */
export function clampFrameDt(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(ms / 1000, MAX_FRAME_DT);
}

/**
 * requestAnimationFrame 루프. frame(frameDt) 를 부르고, 던지면 onError 로 넘기고 계속 돈다.
 * resetClock() 뒤 첫 프레임의 frameDt 는 0(일시정지 · 탭 복귀에서 틱이 몰리지 않는다).
 * @param {{frame:(dt:number) => void, onError?:(e:unknown) => void,
 *          raf?:(cb:FrameRequestCallback) => number, caf?:(id:number) => void, now?:() => number}} opts
 * @returns {{start():void, stop():void, resetClock():void, readonly running:boolean}}
 */
export function createLoop(opts) {
  const frame = opts.frame;
  const onError = opts.onError || (() => {});
  const raf = opts.raf || ((cb) => requestAnimationFrame(cb));
  const caf = opts.caf || ((id) => cancelAnimationFrame(id));
  const now = opts.now || (() => performance.now());
  let running = false;
  let handle = 0;
  /** @type {number|null} */
  let last = null;

  const tick = () => {
    if (!running) return;
    handle = raf(tick);
    const t = now();
    const dt = last === null ? 0 : clampFrameDt(t - last);
    last = t;
    try {
      frame(dt);
    } catch (e) {
      onError(e);
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      last = null;
      handle = raf(tick);
    },
    stop() {
      running = false;
      if (handle) caf(handle);
      handle = 0;
    },
    resetClock() {
      last = null;
    },
    get running() {
      return running;
    },
  };
}
