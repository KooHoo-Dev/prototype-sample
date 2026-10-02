// OWNER: P9 — 계약 §6.12 · §11.6
// STUB — W0 스텁(빈 export · 시그니처만): 쿼리를 읽지 않은 중립 값. W0 의 쿼리 파싱은 src/main.js 의 최소 부트에 있다. P9 가 채운다.

/** @typedef {import('../types.js').DevQuery} DevQuery */

/** STUB — 순수 @param {string} search @returns {DevQuery} */
export function parseQuery(search) {
  void search;
  return {
    devSession: false, fresh: false, scene: null, spot: null, level: null, money: null, time: null, weather: null,
    seed: null, bot: null, panel: null, fixture: null, nopause: false, overrides: {},
  };
}
