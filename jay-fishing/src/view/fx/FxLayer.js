// OWNER: P7 — 계약 §6.9 · §9.9
// STUB — W0 스텁(§6.14): 시그니처대로 no-op · stats() → {particles:0, meshes:0}. P7 가 물보라 · 파문(fxRoot · 풀)을 채운다.

export class FxLayer {
  /** @param {{rc:import('../renderer.js').RenderContext, bus:Object, settings:Object, world:Object}} deps */
  constructor({ rc, bus, settings, world }) {
    this.rc = rc;
    this.bus = bus;
    this.settings = settings;
    this.world = world;
  }

  /** @param {Object} state @param {number} alpha @param {number} dt */
  update(state, alpha, dt) { void state; void alpha; void dt; }

  /** @returns {{particles:number, meshes:number}} */
  stats() { return { particles: 0, meshes: 0 }; }

  dispose() {}
}
