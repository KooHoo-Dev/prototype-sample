// OWNER: P7 — 계약 §6.10 · §9.12
// STUB — W0 스텁(§6.14): 전부 no-op · stats() → {nodes:0, voices:0}. AudioContext 는 unlock 에서만 만든다(P7).

export class AudioEngine {
  /** @param {{bus:Object, settings:Object}} deps — AudioContext 를 만들지 않는다 */
  constructor({ bus, settings }) {
    this.bus = bus;
    this.settings = settings;
  }

  /** 첫 사용자 제스처에서 app 이 부른다 */
  unlock() {}

  /** @param {Object} state @param {number} dt */
  update(state, dt) { void state; void dt; }

  /** @param {boolean} on */
  setPaused(on) { void on; }

  applySettings() {}

  /** @returns {{nodes:number, voices:number}} */
  stats() { return { nodes: 0, voices: 0 }; }

  dispose() {}
}
