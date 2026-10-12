// OWNER: P9 — 계약 §5.12 · §11.3
// 고정 틱 누산기(FixedStepper — 순수 · 가짜 시계로 테스트) + rAF 프레임 구동(createLoop — raf · now 를 주입할 수 있다).
//   acc += min(실제 dt, MAX_FRAME_DT) → while (acc ≥ DT && steps < MAX_STEPS_PER_FRAME) step → 남은 acc 가 2 × DT 를 넘으면 버린다(폭주 금지).
//   step 할 수 없는 동안(일시정지 · 모달 · 전환 막 · 히트스톱 …) 누산기는 쌓지 않는다. 렌더 보간 alpha = acc / DT.

import { DT, MAX_FRAME_DT, MAX_STEPS_PER_FRAME } from '../core/constants.js';

/** 부동소수 누적 오차(1/60 + 1/60 < 1/30)로 step 이 한 프레임 밀리지 않게 */
const EPS = 1e-9;

export class FixedStepper {
  /** @param {{dt?:number, maxFrameDt?:number, maxSteps?:number}} [o] */
  constructor({ dt = DT, maxFrameDt = MAX_FRAME_DT, maxSteps = MAX_STEPS_PER_FRAME } = {}) {
    this.dt = dt;
    this.maxFrameDt = maxFrameDt;
    this.maxSteps = maxSteps;
    /** 남은 실제 시간(초) */
    this.acc = 0;
  }

  /**
   * 한 프레임 — 이번 프레임에 부른 step 수를 돌려준다.
   * @param {number} dtReal 실제 경과(초 — 음수 · NaN 은 0 · MAX_FRAME_DT 로 자른다)
   * @param {boolean} running 지금 step 해도 되는가(아니면 누산기를 쌓지 않는다)
   * @param {() => void} stepFn 한 틱
   * @param {(() => boolean)|null} [canContinue] 두 번째 step 부터 앞에서 다시 묻는다(그 틱의 이벤트가 모달 · 전환 · 히트스톱을 세웠으면 멈춘다)
   */
  frame(dtReal, running, stepFn, canContinue = null) {
    const d = Math.min(Math.max(0, Number(dtReal) || 0), this.maxFrameDt);
    if (!running) return 0;
    this.acc += d;
    let n = 0;
    while (this.acc + EPS >= this.dt && n < this.maxSteps) {
      if (n > 0 && canContinue && !canContinue()) break;
      stepFn();
      this.acc -= this.dt;
      n++;
    }
    if (this.acc < 0) this.acc = 0;
    if (this.acc > 2 * this.dt) this.acc = 0;
    return n;
  }

  /** 렌더 보간 0..1 */
  get alpha() {
    const a = this.acc / this.dt;
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  /** 디버그 step 뒤 — 지금 상태를 그대로 그리게(alpha ≈ 1) · 다음 프레임에 덤으로 step 하지 않게 */
  hold() { this.acc = this.dt * (1 - 1e-6); }

  reset() { this.acc = 0; }
}

/**
 * rAF 프레임 구동 — onFrame(dtSec, nowMs) 를 매 프레임 부른다(dt 는 MAX_FRAME_DT 로 자른다 · 첫 프레임 0).
 * onFrame 이 던지면 onError 로 넘기고 다음 프레임을 계속 건다(루프가 한 번의 예외로 멎지 않게).
 * @param {{onFrame:(dt:number, now:number) => void, onError?:(e:unknown) => void, raf?:(cb:FrameRequestCallback) => number, caf?:(id:number) => void, now?:() => number}} o
 */
export function createLoop({ onFrame, onError = null, raf = null, caf = null, now = null }) {
  const req = raf ?? ((cb) => requestAnimationFrame(cb));
  const cancel = caf ?? ((id) => cancelAnimationFrame(id));
  const clock = now ?? (() => performance.now());
  let running = false;
  let handle = 0;
  let last = 0;
  const tick = (ts) => {
    if (!running) return;
    const t = typeof ts === 'number' && Number.isFinite(ts) ? ts : clock();
    const dt = Math.min(Math.max(0, (t - last) / 1000), MAX_FRAME_DT);
    last = t;
    try {
      onFrame(dt, t);
    } catch (e) {
      if (onError) onError(e);
      else throw e;
    }
    if (running) handle = req(tick);
  };
  return {
    start() {
      if (running) return;
      running = true;
      last = clock();
      handle = req(tick);
    },
    stop() {
      running = false;
      if (handle) cancel(handle);
      handle = 0;
    },
    /** 탭이 돌아왔을 때 등 — 다음 프레임의 dt 를 0 부터(시간 폭주 없음) */
    resync() { last = clock(); },
    get running() { return running; },
  };
}
