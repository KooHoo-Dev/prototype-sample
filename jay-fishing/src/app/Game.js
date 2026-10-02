// OWNER: P9 — 계약 §6.12 · §11.1
// STUB — W0 스텁(§6.14 — 빈 export · 시그니처만). W0 의 진입점은 src/main.js 의 최소 부트(§11.8)다. P9 가 W2 에 채우고 main.js 를 교체한다.
// 부팅 표식(markReady · markError)은 ./bootMarker.js 에서 import 해 남긴다(§11.9 · purity.test).

export class Game {
  /** @param {Document} doc */
  constructor(doc) {
    this.doc = doc;
  }

  /** @returns {Promise<void>} */
  start() {
    return Promise.resolve();
  }

  dispose() {}
}
