// OWNER: P6 — 계약 §6.9 · §10.2
// STUB — W0 스텁(§6.14): ok = false · snapshot → ''. WebGL 컨텍스트는 첫 show 때 만든다(P6). 생성자에서 DOM 을 쓰는 것은 app 이 만들 때뿐이다.

export class FishPreview {
  constructor() {
    /** @type {HTMLCanvasElement|null} */
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    this.ok = false;
  }

  /** @param {string} speciesId @param {number} lengthCm @param {{silhouette?:boolean, spin?:boolean}} [opts] */
  show(speciesId, lengthCm, opts = {}) { void speciesId; void lengthCm; void opts; }

  hide() {}

  /** @param {number} dt */
  render(dt) { void dt; }

  /** @param {string} speciesId @param {number} lengthCm @param {{silhouette?:boolean, size?:number}} [opts] @returns {string} dataURL(ok 가 false 면 '') */
  snapshot(speciesId, lengthCm, opts = {}) { void speciesId; void lengthCm; void opts; return ''; }

  dispose() {}
}
