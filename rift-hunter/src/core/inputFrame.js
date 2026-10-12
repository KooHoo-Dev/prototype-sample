// OWNER: P0 — 계약 §3.2 · §6.1 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// InputFrame — app 의 InputCollector 와 봇이 매 틱 하나씩 만든다.

import { SKILL_BAR } from './constants.js';

/** @typedef {import('../types.js').InputFrame} InputFrame */

/** 동결 · cursor null · 전부 false @type {Readonly<InputFrame>} */
export const NEUTRAL_INPUT = Object.freeze({
  cursor: null,
  hover: null,
  lmb: false,
  lmbDown: false,
  slot: Object.freeze(new Array(SKILL_BAR).fill(false)),
  slotDown: Object.freeze(new Array(SKILL_BAR).fill(false)),
  shift: false,
  potionDown: false,
  recallDown: false,
});

/**
 * 새 InputFrame(배열 · cursor 는 새로 만든다 — 넘긴 것을 붙잡지 않는다)
 * @param {Partial<InputFrame>} [partial]
 * @returns {InputFrame}
 */
export function makeInput(partial = {}) {
  const slot = new Array(SKILL_BAR).fill(false);
  const slotDown = new Array(SKILL_BAR).fill(false);
  if (partial.slot) for (let i = 0; i < SKILL_BAR; i++) slot[i] = !!partial.slot[i];
  if (partial.slotDown) for (let i = 0; i < SKILL_BAR; i++) slotDown[i] = !!partial.slotDown[i];
  const c = partial.cursor;
  const h = partial.hover;
  return {
    cursor: c ? { x: c.x, z: c.z } : null,
    hover: h ? { ...h } : null,
    lmb: !!partial.lmb,
    lmbDown: !!partial.lmbDown,
    slot,
    slotDown,
    shift: !!partial.shift,
    potionDown: !!partial.potionDown,
    recallDown: !!partial.recallDown,
  };
}
