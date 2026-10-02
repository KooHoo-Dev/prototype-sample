// OWNER: P0 — 계약 §6.1 · §3.1 (완전 구현)
/** @typedef {import('../types.js').InputFrame} InputFrame */

/**
 * 전부 0/false인 입력. 동결돼 있다 — 고치려면 makeInput으로 복사한다.
 * @type {Readonly<InputFrame>}
 */
export const NEUTRAL_INPUT = Object.freeze({
  moveX: 0,
  moveZ: 0,
  sprint: false,
  guard: false,
  heavyHeld: false,
  lightPressed: false,
  heavyPressed: false,
  rollPressed: false,
  flaskPressed: false,
  lockOnPressed: false,
  interactPressed: false,
});

/**
 * 새 InputFrame(NEUTRAL + partial). 반환값은 동결돼 있지 않다.
 * @param {Partial<InputFrame>} [partial]
 * @returns {InputFrame}
 */
export function makeInput(partial = {}) {
  return { ...NEUTRAL_INPUT, ...partial };
}
