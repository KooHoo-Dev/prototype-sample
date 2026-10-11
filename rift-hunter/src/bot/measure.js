// OWNER: P15 — 계약 §6.16 · §12.5
// STUB — W2 에서 P15 가 채운다(순수 — 테스트 · scripts/measure.mjs 공용 · makeSim 을 받는다). W0: 빈 결과 · measureTable '(측정 없음)'

/**
 * STUB @param {{cls:string, strategy:string, preset:number, seed:number, hours:number, makeSim:(seed:number, account:any) => any, riftLevel?:number|null, char?:any, onRun?:Function|null}} opts
 * @returns {{runs:import('../types.js').RunSummary[], timeline:Array<{playSec:number, level:number, riftUnlocked:number}>, char:any}}
 */
export function runSession({ cls, strategy, preset, seed, hours, makeSim, riftLevel = null, char = null, onRun = null }) {
  return { runs: [], timeline: [], char: null };
}

/** STUB — 균열 한 판 → RunSummary(W0: null) @param {{sim:any, bot:any, maxSec:number}} opts @returns {import('../types.js').RunSummary|null} */
export function runRift({ sim, bot, maxSec }) {
  return null;
}

/** STUB — 그 속성 하나만 단 정예 팩 @param {{cls:string, affixId:string, level:number, seed:number, makeSim:Function}} opts */
export function affixProbe({ cls, affixId, level, seed, makeSim }) {
  return { dmgTaken: 0, ttkSec: 0, deaths: 0 };
}

/** STUB — MEASURE.md 마크다운 문자열 @param {Object} opts @returns {string} */
export function measureTable(opts = {}) {
  return '(측정 없음)';
}
