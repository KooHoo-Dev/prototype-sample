// OWNER: P9 — 계약 §6.12 · §11.3
// STUB — W0 스텁(빈 export · 시그니처만). W0 의 최소 입력 수집기는 src/main.js 안에 있다. P9 가 채운다.

import { makeInput } from '../core/inputFrame.js';

/** @typedef {import('../types.js').InputFrame} InputFrame */

export class InputCollector {
  /** @param {{canvas:HTMLCanvasElement, settings:Object, bus:Object}} deps */
  constructor({ canvas, settings, bus }) {
    this.canvas = canvas;
    this.settings = settings;
    this.bus = bus;
    this._look = { yaw: 0, pitch: 0 };
  }

  /** @returns {InputFrame} */
  buildFrame() { return makeInput({ yaw: this._look.yaw, pitch: this._look.pitch }); }

  /** @returns {{yaw:number, pitch:number}} */
  get look() { return { ...this._look }; }

  setLook(yaw, pitch) { this._look = { yaw, pitch }; }

  releaseAll() {}

  /** @param {boolean} on */
  setCapture(on) { void on; }

  /** @param {'walk'|'fish'} mode */
  setMode(mode) { void mode; }

  /** @param {number} dt */
  tick(dt) { void dt; }

  get pointerLocked() { return false; }

  dispose() {}
}

/**
 * STUB — 순수(테스트)
 * @param {Object} keys @param {Object} edges @param {{yaw:number, pitch:number}} look @param {number} wheelSteps @param {Object} bindings
 * @returns {InputFrame}
 */
export function frameFromState(keys, edges, look, wheelSteps, bindings) {
  void keys; void edges; void wheelSteps; void bindings;
  return makeInput({ yaw: look ? look.yaw : 0, pitch: look ? look.pitch : 0 });
}
