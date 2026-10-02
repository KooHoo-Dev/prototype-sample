// OWNER: P9 — 계약 §5.4 · §11.1
// 고정 틱 누산기(FixedStepper)와 requestAnimationFrame 구동(FrameLoop). Game.js만 import 하는 패키지 내부 파일이다.
// sim의 dt는 항상 DT다 — 프레임 시간은 누산해서 틱으로 쪼개고, 남은 조각은 렌더 보간 계수(alpha)가 된다.
import { DT, MAX_FRAME_DT, MAX_STEPS_PER_FRAME } from '../core/constants.js';

/**
 * §5.4의 누산 루프.
 *   acc += min(frameDt, MAX_FRAME_DT) × timeScale
 *   while (acc >= DT && steps < 상한) { step(); acc -= DT }
 *   steps === 상한이면 acc = 0   (죽음의 나선 방지)
 *   alpha = acc / DT
 * 상한은 MAX_STEPS_PER_FRAME × ceil(timeScale)이다 — 디버그 배속(최대 8)이 60fps에서도 제 속도를 낸다.
 */
export class FixedStepper {
  constructor() {
    /** 아직 틱으로 쓰지 않은 시간(초) */
    this.acc = 0;
  }

  /**
   * @param {number} frameDt 렌더 프레임 시간(초)
   * @param {number} timeScale 배속(1 = 정속)
   * @param {()=>void} step 한 틱
   * @returns {number} 이번 프레임에 돈 틱 수
   */
  advance(frameDt, timeScale, step) {
    const scale = timeScale > 0 ? timeScale : 1;
    const dt = frameDt > 0 ? Math.min(frameDt, MAX_FRAME_DT) : 0;
    this.acc += dt * scale;
    const cap = MAX_STEPS_PER_FRAME * Math.max(1, Math.ceil(scale));
    let steps = 0;
    while (this.acc >= DT && steps < cap) {
      step();
      this.acc -= DT;
      steps += 1;
    }
    if (steps === cap) this.acc = 0;
    return steps;
  }

  /** 렌더 보간 계수 0..1. @returns {number} */
  get alpha() {
    const a = this.acc / DT;
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  /** 탭 복귀 · 일시정지 해제 · 화면 전환: 밀린 시간을 버린다(돌아온 프레임에 틱이 몰아 돌지 않게). */
  reset() {
    this.acc = 0;
  }
}

/**
 * requestAnimationFrame 루프. 콜백에는 직전 프레임부터의 경과(초)를 넘긴다 — rAF가 주는 시각으로만 잰다
 * (자동화가 콜백에 가짜 시각을 넣어 프레임을 손으로 밀어도 같은 식으로 돈다).
 */
export class FrameLoop {
  /**
   * @param {Window} win
   * @param {(frameDt:number)=>void} onFrame
   */
  constructor(win, onFrame) {
    this._win = win;
    this._onFrame = onFrame;
    this._id = 0;
    this._running = false;
    this._last = 0;
    this._resync = true;
    // 이름이 'frame'인 콜백 — W1의 스모크 방식(rAF를 감싸 이 콜백을 잡아 손으로 민다)이 그대로 통한다
    const frame = (/** @type {number} */ now) => {
      if (!this._running) return;
      this._id = this._win.requestAnimationFrame(frame);
      let dt = (now - this._last) / 1000;
      if (this._resync || !(dt > 0)) dt = 0;
      this._resync = false;
      this._last = now;
      this._onFrame(dt);
    };
    this._frame = frame;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._resync = true;
    this._id = this._win.requestAnimationFrame(this._frame);
  }

  stop() {
    this._running = false;
    this._win.cancelAnimationFrame(this._id);
  }

  /** 다음 프레임의 경과 시간을 0으로 본다(창 포커스 복귀 · 탭이 다시 보일 때). */
  resetClock() {
    this._resync = true;
  }
}
