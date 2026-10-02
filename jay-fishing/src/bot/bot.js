// OWNER: P10 — 계약 §6.8 · §12.1
// STUB — W0 스텁(§6.14): createBot = 중립 입력만 내는 봇. P10 이 W2 에 채운다(angler + 걷기 · 하루 계획).
// bot/bot.js → bot/angler.js → bot/policy.js 단방향(§2.2).

import { NEUTRAL_INPUT } from '../core/inputFrame.js';

/** @typedef {import('../types.js').BotAction} BotAction */

/**
 * STUB
 * @param {{strategy:string, seed:number, plan:'lakeDay'|'coastDay'|'riverDay'|'progress'|'stay', spotId?:string, set?:string, baitId?:string}} opts
 * @returns {{name:string, decide(state:Object, sim:Object): BotAction, reset():void}}
 */
export function createBot(opts) {
  void opts;
  return {
    name: 'stub',
    decide: () => ({ input: NEUTRAL_INPUT, command: null }),
    reset() {},
  };
}
