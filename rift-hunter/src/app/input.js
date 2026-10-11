// OWNER: P9 — 계약 §11.5 · §10.5
// STUB — W2 에서 P9 가 채운다(event.code · 기본 동작 막기 · 포커스 · 에지 모으기 · 커서 광선 · hover 조합). W0 의 입력은 main.js 안의 최소 수집기다

export class InputCollector {
  /** @param {{canvas:HTMLCanvasElement, bus:any, ui:any, rc:any, keybinds:any}} deps */
  constructor(deps) {
    this.deps = deps;
  }
  /** STUB — 이번 틱의 InputFrame(에지를 비운다) */
  frame(state, map) { return null; }
  dispose() {}
}
