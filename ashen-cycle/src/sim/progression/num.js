// OWNER: P4 — progression 내부 숫자 도우미(다른 패키지는 import하지 않는다)
import { STATS } from '../../data/stats.js';

/**
 * 부동소수 잡음 제거. UI가 조회 값을 계산 없이 그대로 그린다(§13 P4).
 * @param {number} v
 * @returns {number}
 */
export function tidy(v) {
  return Math.round(v * STATS.precision) / STATS.precision;
}

/**
 * 유한한 수가 아니면 fallback, 그 밖에는 내림 후 [lo, hi]로 자른다.
 * 세이브에서 온 값(NaN · 문자열 · 범위 밖)을 그대로 믿지 않기 위한 관문이다.
 * @param {any} v
 * @param {number} lo
 * @param {number} hi
 * @param {number} [fallback]
 * @returns {number}
 */
export function clampInt(v, lo, hi, fallback = lo) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.floor(v)));
}

/**
 * 0 이상 정수(상한 없음 — 안전 정수 범위까지).
 * @param {any} v
 * @returns {number}
 */
export function nonNegInt(v) {
  return clampInt(v, 0, Number.MAX_SAFE_INTEGER, 0);
}

/**
 * @param {any} v
 * @returns {boolean} null · 배열이 아닌 객체인가
 */
export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
