// OWNER: P6 — 계약 §6.9 · §9.8
// STUB — W0 스텁(§6.14): 시그니처대로 no-op. P6 가 물고기 그림자 · 점프 · 뜰채 속 물고기(fishRoot)를 채운다.

export class FishLayer {
  /** @param {{rc:import('../renderer.js').RenderContext, bus:Object, settings:Object, world:Object}} deps */
  constructor({ rc, bus, settings, world }) {
    this.rc = rc;
    this.bus = bus;
    this.settings = settings;
    this.world = world;
  }

  /** @param {Object} state @param {number} alpha @param {number} dt */
  update(state, alpha, dt) { void state; void alpha; void dt; }

  dispose() {}
}
