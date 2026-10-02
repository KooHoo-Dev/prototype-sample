// OWNER: P2 — 계약 §6.8 · §12.1
// STUB — W0 스텁(§6.14): createFightPolicy = 아무것도 하지 않는 손. P2 가 W1 에 완성한다(전략 넷 — basic · controlled · mindless · locked).
// 순수 · 다른 bot 파일을 import 하지 않는다(§2.2). 사람에게 보이는 값만 읽는다.

/** @typedef {'basic'|'controlled'|'mindless'|'locked'} BotStrategy */

/**
 * STUB — 파이팅 한 틱의 손.
 * @param {BotStrategy} strategy @param {number} seed
 * @returns {{decide(state:Object, rigStats:Object): {primary:boolean, secondary:boolean, dragSteps:number, hook:boolean}, reset():void}}
 */
export function createFightPolicy(strategy, seed) {
  void strategy; void seed;
  return {
    decide: () => ({ primary: false, secondary: false, dragSteps: 0, hook: false }),
    reset() {},
  };
}
