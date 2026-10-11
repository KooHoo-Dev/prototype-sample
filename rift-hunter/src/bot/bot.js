// OWNER: P15 — 계약 §6.16 · §12.1
// STUB — W2 에서 P15 가 채운다(사람처럼 InputFrame · 마을 정비 · 레벨 선택 · 스킬 배분 · 부활/복귀). W0: frame → NEUTRAL_INPUT · afterStep no-op
// bot/* 는 GameSim.js 를 import 하지 않는다(sim 인스턴스를 인자로 받는다 · 판을 새로 만드는 측정 함수는 makeSim 을 받는다).

import { NEUTRAL_INPUT } from '../core/inputFrame.js';
import { BOT } from '../data/bot.js';

export class Bot {
  /**
   * @param {{sim:any, strategy?:'basic'|'noDodge'|'challenge', cls:import('../types.js').ClassId, preset?:number, seed?:number, params?:typeof BOT, autoCommit?:boolean}} opts
   *   autoCommit false 면 afterStep 이 commitTravel 을 부르지 않는다(브라우저 — app 의 전환 막이 commit · §11.13)
   */
  constructor({ sim, strategy = 'basic', cls, preset = 0, seed = 1, params = BOT, autoCommit = true }) {
    this.sim = sim;
    this.strategy = strategy;
    this.cls = cls;
    this.preset = preset;
    this.seed = seed;
    this.params = params;
    this.autoCommit = autoCommit;
    /** @type {Array<Object>} */
    this._log = [];
  }

  /** STUB — 이번 틱의 입력 @returns {import('../types.js').InputFrame} */
  frame() {
    return /** @type {import('../types.js').InputFrame} */ (NEUTRAL_INPUT);
  }

  /** STUB — step 뒤: commit · 마을 정비 · 레벨 선택 · 스킬 · 부활 · 복귀 */
  afterStep() {}

  /** 결정 기록(측정용 · 순수 배열) */
  get log() {
    return this._log;
  }
}
