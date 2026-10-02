// OWNER: P1 — 계약 §6.8 · §12.1
// STUB — W0 스텁(§6.14): createAngler = 중립 입력만 내는 봇. P1 이 W1 에 완성한다(자리 봇 — 캐스팅 · 챔질 · 파이팅 · 뜰채 · 어창/방생).
// bot/angler.js → bot/policy.js 단방향(§2.2).

import { NEUTRAL_INPUT } from '../core/inputFrame.js';

/** @typedef {import('../types.js').BotAction} BotAction */

/**
 * STUB — sim 에서는 getRigStats() 만 읽는다(§6.8).
 * @param {{strategy:string, seed:number, set?:string|null, baitId?:string|null, depthM?:number|null}} opts
 * @returns {{name:string, decide(state:Object, sim:Object): BotAction, reset():void}}
 */
export function createAngler(opts) {
  void opts;
  return {
    name: 'stub',
    decide: () => ({ input: NEUTRAL_INPUT, command: null }),
    reset() {},
  };
}
