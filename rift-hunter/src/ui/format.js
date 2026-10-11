// OWNER: P10 — 계약 §10.8(숫자 표시 · 순수)
// STUB — W2 에서 P10 이 채운다. W0: 단순 형식

/** 천 단위 쉼표 @param {number} v */
export function fmtInt(v) { return Math.round(v).toLocaleString('en-US'); }
/** 비율 → % @param {number} v 0..1 @param {number} [d] 소수 자리 */
export function fmtPct(v, d = 0) { return (v * 100).toFixed(d) + '%'; }
/** 초 → m:ss @param {number} sec */
export function fmtSec(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** DPS @param {number} v */
export function fmtDps(v) { return v >= 100 ? fmtInt(v) : v.toFixed(1); }
/** [a, b] → 'a–b' @param {[number, number]} r */
export function fmtRange(r) { return `${Math.round(r[0])}–${Math.round(r[1])}`; }
