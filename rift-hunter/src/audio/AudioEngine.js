// OWNER: P14 — 계약 §6.15 · §9.9 · §9.11
// STUB — W2 에서 P14 가 채운다(WebAudio 합성 · 리미터 · 동시 발음 상한 · 지속음 · 환경음). W0: 모든 메서드 no-op · stats {0, 0}
// AudioContext 는 unlock() 에서 처음 만든다(그 전 호출은 조용히 무시).

export class AudioEngine {
  /** @param {{bus:any, settings:any}} deps */
  constructor({ bus, settings }) {
    this.bus = bus;
    this.settings = settings;
  }
  /** 첫 사용자 제스처(app 이 부른다) */
  unlock() {}
  /** 지속음 상태 맞추기 @param {import('../types.js').GameState} state @param {number} dtReal */
  update(state, dtReal) {}
  /** @param {boolean} on */
  setPaused(on) {}
  /** @param {import('../types.js').Settings} settings */
  applySettings(settings) {}
  /** 누수 검사 */
  stats() { return { voices: 0, nodes: 0 }; }
  dispose() {}
}
