// OWNER: P0 — 계약 §3.2 · §6.1 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 사람(app)과 봇이 매 틱 같은 모양으로 만드는 입력.

/** @typedef {import('../types.js').InputFrame} InputFrame */

/** 전부 0 · false · null · yaw 0 · pitch 0 인 동결 객체 @type {Readonly<InputFrame>} */
export const NEUTRAL_INPUT = Object.freeze({
  moveX: 0,
  moveZ: 0,
  yaw: 0,
  pitch: 0,
  primary: false,
  primaryPressed: false,
  primaryReleased: false,
  secondary: false,
  hook: false,
  interact: false,
  dragSteps: 0,
  bail: false,
  depthSteps: 0,
  selectSet: null,
});

/** @param {Partial<InputFrame>} [partial] @returns {InputFrame} 새 객체 */
export function makeInput(partial = {}) {
  return { ...NEUTRAL_INPUT, ...partial };
}
