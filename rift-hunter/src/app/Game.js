// OWNER: P9 — 계약 §11.1 · §11.2 · §11.11
// STUB — W2 에서 P9 가 채운다(부트 순서 · actions · 화면 기계 · 전환 막 · 저장 · 쿼리 · 디버그 API · 봇 구동).
// W0 의 진입점은 src/main.js 의 최소 부트다(§11.10). P9 는 main.js 를 `new Game(document).start()` 로 바꾸고, 부팅 표식(markReady · markError)을 이 파일로 옮긴다.

export class Game {
  /** @param {Document} doc */
  constructor(doc) {
    this.doc = doc;
  }

  /** STUB — §11.1 부트 */
  start() {}
}
